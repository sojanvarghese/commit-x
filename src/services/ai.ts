import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  AggregatedCommitResponse,
  CommitGroup,
  GitDiff,
} from "../types/common.js";
import { getApiKey } from "../config.js";
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
import { chunkByBudget, mapWithConcurrency } from "../utils/request-batcher.js";
import type { SanitizedDiff } from "../utils/data-sanitization.js";
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

// The parts of a request that are identical across retries and models.
interface PreparedRequest {
  approvedDiffs: GitDiff[];
  sanitizedDiffs: SanitizedDiff[];
  prompt: string;
  timeoutMs: number;
}

// One focused retry is enough — if the AI drops files twice, they get
// factual fallback messages rather than a third round of speculation.
const MAX_DROPPED_FILE_RETRIES = 1;
const AI_CHUNK_MAX_FILES = 30;
const AI_CHUNK_CONTENT_BUDGET = 50_000;
const AI_CHUNK_CONCURRENCY = 2;

export class AIService {
  private readonly genAI: GoogleGenAI;
  private readonly aiCache: AICache;

  constructor() {
    this.aiCache = new PersistentAICache();

    const apiKey = getApiKey();
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

  private readonly prepareRequest = (diffs: GitDiff[]): PreparedRequest => {
    if (diffs.length === 0) {
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

    const { prompt } = buildAggregatedPrompt(gate.sanitizedDiffs);

    if (prompt.length > DEFAULT_LIMITS.maxApiRequestSize) {
      throw new SecureError(
        `Prompt size ${prompt.length} exceeds limit of ${DEFAULT_LIMITS.maxApiRequestSize} characters`,
        ErrorType.VALIDATION_ERROR,
        { operation: "generateAggregatedCommits" },
        true
      );
    }

    return {
      approvedDiffs: gate.approvedDiffs,
      sanitizedDiffs: gate.sanitizedDiffs,
      prompt,
      timeoutMs: calculateAITimeout({
        diffSize: prompt.length,
        fileCount: gate.approvedDiffs.length,
        totalChanges: gate.approvedDiffs.reduce(
          (sum, diff) => sum + diff.additions + diff.deletions,
          0
        ),
      }),
    };
  };

  private readonly runAIWithModelFallback = async (
    diffs: GitDiff[],
    options: GenerateOptions
  ): Promise<ParseResult> => {
    const request = this.prepareRequest(diffs);

    let lastError: unknown;
    for (const [index, model] of AI_MODEL_FALLBACK_CHAIN.entries()) {
      try {
        return await withRetry(
          async () => this.requestCommitGroups(request, model, options),
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

        const next = AI_MODEL_FALLBACK_CHAIN[index + 1];
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

  private readonly requestCommitGroups = async (
    request: PreparedRequest,
    modelName: string,
    options: GenerateOptions
  ): Promise<ParseResult> => {
    return withErrorHandling(
      async () => {
        const cacheKey = options.useCached
          ? this.aiCache.generateKey(request.approvedDiffs, {
              repositoryPath: process.cwd(),
              model: modelName,
              promptVersion: AI_PROMPT_VERSION,
            })
          : undefined;

        if (cacheKey) {
          const validatedCache = this.validateCachedGroups(
            await this.aiCache.get(cacheKey),
            request.approvedDiffs
          );
          if (validatedCache) {
            return validatedCache;
          }
        }

        const result = await withTimeout(
          signal =>
            this.genAI.models.generateContent({
              model: modelName,
              contents: request.prompt,
              config: {
                abortSignal: signal,
                systemInstruction: AI_SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseJsonSchema: createAggregatedResponseSchema(
                  request.approvedDiffs.length
                ),
                temperature: 0.1,
                maxOutputTokens: 4096,
                thinkingConfig: {
                  thinkingLevel: ThinkingLevel.MINIMAL,
                  includeThoughts: false,
                },
              },
            }),
          request.timeoutMs
        );

        const parseResult = parseAggregatedResponse(
          result.text ?? "",
          request.approvedDiffs,
          request.sanitizedDiffs
        );

        if (cacheKey && parseResult.groups.length > 0) {
          await this.aiCache.set(cacheKey, parseResult.groups);
        }

        return parseResult;
      },
      { operation: "generateAggregatedCommits" },
      ErrorType.AI_SERVICE_ERROR
    );
  };

  private readonly validateCachedGroups = (
    groups: CommitGroup[] | null,
    diffs: GitDiff[]
  ): ParseResult | null => {
    if (!groups || groups.length === 0) return null;

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
