import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  AggregatedCommitResponse,
  CommitGroup,
  GitDiff,
} from "../types/common.js";
import { ConfigManager } from "../config.js";
import { withTimeout } from "../utils/security.js";
import { ErrorType } from "../types/error-handler.js";
import {
  withErrorHandling,
  withRetry,
  SecureError,
} from "../utils/error-handler.js";
import { DEFAULT_LIMITS } from "../constants/security.js";
import { calculateAITimeout } from "../utils/timeout.js";
import {
  AI_MAX_ATTEMPTS_PER_MODEL,
  AI_RETRY_DELAY_MS,
  AI_MODEL_FALLBACK_CHAIN,
} from "../constants/ai.js";
import { ERROR_MESSAGES } from "../constants/messages.js";
import { PersistentAICache, type AICache } from "../utils/ai-cache.js";
import {
  InFlightRequestDeduplicator,
  chunkByBudget,
  mapWithConcurrency,
} from "../utils/request-batcher.js";
import {
  enforcePrivacyGate,
  logPrivacyGateOutcome,
} from "./ai-privacy-gate.js";
import {
  buildAggregatedPrompt,
  createAggregatedResponseSchema,
  generateFactualFallback,
  AI_PROMPT_VERSION,
  AI_SYSTEM_INSTRUCTION,
  parseAggregatedResponse,
  type ParseResult,
} from "./ai-prompt.js";
import { preGroupDeterministicFiles } from "./ai-commit-group.js";

interface GenerateOptions {
  useCached?: boolean;
}

interface InternalGenerateOptions extends GenerateOptions {
  singleGroup?: boolean;
}

// One focused retry is enough — if the AI drops files twice, they get
// factual fallback messages rather than a third round of speculation.
const MAX_DROPPED_FILE_RETRIES = 1;
const AI_CHUNK_MAX_FILES = 30;
const AI_CHUNK_CONTENT_BUDGET = 50_000;
const AI_CHUNK_CONCURRENCY = 2;

export class AIService {
  private readonly genAI: GoogleGenAI;
  private readonly config: ConfigManager;
  private readonly aiCache: AICache;
  private readonly requestDeduplicator: InFlightRequestDeduplicator;

  constructor() {
    this.config = ConfigManager.getInstance();
    this.aiCache = new PersistentAICache();
    this.requestDeduplicator = new InFlightRequestDeduplicator();

    const apiKey = this.config.getApiKey();
    if (!apiKey) {
      throw new SecureError(
        ERROR_MESSAGES.API_KEY_NOT_FOUND,
        ErrorType.CONFIG_ERROR,
        { operation: "AIService.constructor" },
        true
      );
    }

    this.genAI = new GoogleGenAI({ apiKey });
  }

  generateAggregatedCommits = async (
    diffs: GitDiff[],
    options: GenerateOptions = {}
  ): Promise<AggregatedCommitResponse> => {
    const { aiDiffs, autoGroups } = preGroupDeterministicFiles(diffs);

    if (aiDiffs.length === 0) {
      return { groups: autoGroups };
    }

    if (AI_MODEL_FALLBACK_CHAIN.length === 0) {
      throw new SecureError(
        "AI_MODEL_FALLBACK_CHAIN is empty; at least one model must be configured",
        ErrorType.CONFIG_ERROR,
        { operation: "generateAggregatedCommits" },
        true
      );
    }

    const primaryResults = await this.generateAIChunks(aiDiffs, options);
    const allGroups: CommitGroup[] = [
      ...autoGroups,
      ...primaryResults.flatMap(result => result.groups),
    ];

    let leftover = primaryResults.flatMap(result => result.unusedDiffs);
    for (
      let attempt = 0;
      attempt < MAX_DROPPED_FILE_RETRIES && leftover.length > 0;
      attempt++
    ) {
      console.warn(
        `${leftover.length} file(s) dropped by AI; running focused retry...`
      );
      try {
        const retries = await this.generateAIChunks(leftover, options);
        allGroups.push(...retries.flatMap(result => result.groups));
        leftover = retries.flatMap(result => result.unusedDiffs);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`Focused retry failed: ${reason}`);
        break;
      }
    }

    // Anything still missing after retries gets a factual, status-based label.
    // Intentionally not speculative about content — we have no AI analysis.
    for (const diff of leftover) {
      allGroups.push({
        files: [diff.file],
        message: generateFactualFallback(diff),
        confidence: 0.6,
      });
    }

    return { groups: allGroups };
  };

  generateSingleCommit = async (
    diffs: GitDiff[],
    options: GenerateOptions = {}
  ): Promise<CommitGroup> => {
    const result = await this.runAIWithModelFallback(diffs, {
      ...options,
      singleGroup: true,
    });
    const group = result.groups[0];
    if (
      result.groups.length !== 1 ||
      !group ||
      result.unusedDiffs.length > 0 ||
      group.files.length !== diffs.length
    ) {
      throw new Error("AI did not return one commit group covering every file");
    }
    return group;
  };

  private readonly generateAIChunks = async (
    diffs: GitDiff[],
    options: GenerateOptions
  ): Promise<ParseResult[]> => {
    const chunks = chunkByBudget(diffs, {
      maxItems: AI_CHUNK_MAX_FILES,
      maxBudget: AI_CHUNK_CONTENT_BUDGET,
      sizeOf: diff =>
        Math.min(diff.changes.length, UI_DIFF_ESTIMATE_PER_FILE) +
        diff.file.length +
        100,
    });

    return mapWithConcurrency(chunks, AI_CHUNK_CONCURRENCY, chunk =>
      this.runAIWithModelFallback(chunk, options)
    );
  };

  private readonly runAIWithModelFallback = async (
    diffs: GitDiff[],
    options: InternalGenerateOptions
  ): Promise<ParseResult> => {
    let lastError: unknown;
    for (let i = 0; i < AI_MODEL_FALLBACK_CHAIN.length; i++) {
      const model = AI_MODEL_FALLBACK_CHAIN[i];
      if (!model) continue;
      try {
        return await withRetry(
          async () =>
            this.executeAggregatedCommitGeneration(diffs, model, options),
          AI_MAX_ATTEMPTS_PER_MODEL,
          AI_RETRY_DELAY_MS,
          { operation: "generateAggregatedCommits" }
        );
      } catch (err) {
        lastError = err;

        if (
          err instanceof SecureError &&
          (err.type === ErrorType.VALIDATION_ERROR ||
            err.type === ErrorType.CONFIG_ERROR ||
            err.type === ErrorType.SECURITY_ERROR)
        ) {
          throw err;
        }

        const next = AI_MODEL_FALLBACK_CHAIN[i + 1];
        const reason = err instanceof Error ? err.message : String(err);
        if (next) {
          console.warn(
            `⚠️  Model (${model}) failed: ${reason}. Trying (${next})...`
          );
        }
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(String(lastError), { cause: lastError });
  };

  private readonly executeAggregatedCommitGeneration = async (
    diffs: GitDiff[],
    modelName: string,
    options: InternalGenerateOptions
  ): Promise<ParseResult> => {
    return withErrorHandling(
      async () => {
        if (!diffs || diffs.length === 0) {
          throw new SecureError(
            "No diffs provided for aggregated commits",
            ErrorType.VALIDATION_ERROR,
            { operation: "generateAggregatedCommits" },
            true
          );
        }

        const gate = enforcePrivacyGate(diffs, process.cwd());
        logPrivacyGateOutcome(gate);

        if (gate.approvedDiffs.length === 0) {
          throw new SecureError(
            "No valid diffs after privacy gate",
            ErrorType.VALIDATION_ERROR,
            { operation: "generateAggregatedCommits" },
            true
          );
        }

        const { prompt } = buildAggregatedPrompt(gate.sanitizedDiffs, {
          singleGroup: Boolean(options.singleGroup),
        });

        if (prompt.length > DEFAULT_LIMITS.maxApiRequestSize) {
          throw new SecureError(
            `Prompt size ${prompt.length} exceeds limit of ${DEFAULT_LIMITS.maxApiRequestSize} characters`,
            ErrorType.VALIDATION_ERROR,
            { operation: "generateAggregatedCommits" },
            true
          );
        }

        const cacheKey = `${options.singleGroup ? "single" : "agg"}_${this.aiCache.generateKey(
          gate.approvedDiffs,
          {
            repositoryPath: process.cwd(),
            model: modelName,
            promptVersion: AI_PROMPT_VERSION,
          }
        )}`;

        if (options.useCached) {
          const cached = await this.aiCache.get(cacheKey);
          const validatedCache = this.validateCachedGroups(
            cached,
            gate.approvedDiffs,
            Boolean(options.singleGroup)
          );
          if (validatedCache) {
            return validatedCache;
          }
        }

        const totalChanges = gate.approvedDiffs.reduce(
          (sum, diff) => sum + diff.additions + diff.deletions,
          0
        );

        const aiTimeout = calculateAITimeout({
          diffSize: prompt.length,
          fileCount: gate.approvedDiffs.length,
          totalChanges,
        });

        const callModel = async (): Promise<{ text: string | undefined }> =>
          withTimeout(
            signal =>
              this.genAI.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                  abortSignal: signal,
                  systemInstruction: AI_SYSTEM_INSTRUCTION,
                  responseMimeType: "application/json",
                  responseJsonSchema: createAggregatedResponseSchema(
                    gate.approvedDiffs.length,
                    Boolean(options.singleGroup)
                  ),
                  temperature: 0.1,
                  maxOutputTokens: 4096,
                  thinkingConfig: {
                    thinkingLevel: ThinkingLevel.MINIMAL,
                    includeThoughts: false,
                  },
                },
              }),
            aiTimeout
          );

        const result = await this.requestDeduplicator.run(cacheKey, callModel);

        const parseResult = parseAggregatedResponse(
          result.text ?? "",
          gate.approvedDiffs,
          gate.sanitizedDiffs
        );

        if (
          options.singleGroup &&
          (parseResult.groups.length !== 1 ||
            parseResult.unusedDiffs.length > 0)
        ) {
          throw new Error(
            "AI response did not contain one group covering every file"
          );
        }

        if (options.useCached && parseResult.groups.length > 0) {
          await this.aiCache.set(cacheKey, parseResult.groups);
        }

        return parseResult;
      },
      { operation: "generateAggregatedCommits" }
    );
  };

  private readonly validateCachedGroups = (
    groups: CommitGroup[] | null,
    diffs: GitDiff[],
    singleGroup: boolean
  ): ParseResult | null => {
    if (
      !groups ||
      groups.length === 0 ||
      (singleGroup && groups.length !== 1)
    ) {
      return null;
    }

    const expected = new Set(diffs.map(diff => diff.file));
    const seen = new Set<string>();
    for (const group of groups) {
      for (const file of group.files) {
        if (!expected.has(file) || seen.has(file)) return null;
        seen.add(file);
      }
    }

    if (seen.size !== expected.size) return null;
    return { groups: structuredClone(groups), unusedDiffs: [] };
  };
}

const UI_DIFF_ESTIMATE_PER_FILE = 3_000;
