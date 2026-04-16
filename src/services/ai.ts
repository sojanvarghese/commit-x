import { GoogleGenAI } from "@google/genai";
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
  AI_RETRY_ATTEMPTS,
  AI_RETRY_DELAY_MS,
  AI_MODEL_FALLBACK_CHAIN,
} from "../constants/ai.js";
import { ERROR_MESSAGES } from "../constants/messages.js";
import { PersistentAICache, type AICache } from "../utils/ai-cache.js";
import { RequestBatcher } from "../utils/request-batcher.js";
import {
  enforcePrivacyGate,
  logPrivacyGateOutcome,
} from "./ai-privacy-gate.js";
import {
  buildAggregatedPrompt,
  generateFactualFallback,
  parseAggregatedResponse,
  type ParseResult,
} from "./ai-prompt.js";
import { preGroupDeterministicFiles } from "./ai-commit-group.js";

interface GenerateOptions {
  useCached?: boolean;
}

// One focused retry is enough — if the AI drops files twice, they get
// factual fallback messages rather than a third round of speculation.
const MAX_DROPPED_FILE_RETRIES = 1;

export class AIService {
  private readonly genAI: GoogleGenAI;
  private readonly config: ConfigManager;
  private readonly aiCache: AICache;
  private readonly requestBatcher: RequestBatcher;

  constructor() {
    this.config = ConfigManager.getInstance();
    this.aiCache = new PersistentAICache();
    this.requestBatcher = new RequestBatcher();

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

    const primary = await this.runAIWithModelFallback(aiDiffs, options);
    const allGroups: CommitGroup[] = [...autoGroups, ...primary.groups];

    let leftover = primary.unusedDiffs;
    for (let attempt = 0; attempt < MAX_DROPPED_FILE_RETRIES && leftover.length > 0; attempt++) {
      console.warn(
        `${leftover.length} file(s) dropped by AI; running focused retry...`
      );
      try {
        const retry = await this.runAIWithModelFallback(leftover, options);
        allGroups.push(...retry.groups);
        leftover = retry.unusedDiffs;
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

  private readonly runAIWithModelFallback = async (
    diffs: GitDiff[],
    options: GenerateOptions
  ): Promise<ParseResult> => {
    let lastError: unknown;
    for (let i = 0; i < AI_MODEL_FALLBACK_CHAIN.length; i++) {
      const model = AI_MODEL_FALLBACK_CHAIN[i];
      try {
        return await withRetry(
          async () => this.executeAggregatedCommitGeneration(diffs, model, options),
          AI_RETRY_ATTEMPTS,
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
    options: GenerateOptions
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

        const { prompt } = buildAggregatedPrompt(gate.sanitizedDiffs);

        if (prompt.length > DEFAULT_LIMITS.maxApiRequestSize) {
          throw new SecureError(
            `Prompt size ${prompt.length} exceeds limit of ${DEFAULT_LIMITS.maxApiRequestSize} characters`,
            ErrorType.VALIDATION_ERROR,
            { operation: "generateAggregatedCommits" },
            true
          );
        }

        const cacheKey = `agg_${this.aiCache.generateKey(gate.approvedDiffs)}`;

        if (options.useCached) {
          const cached = await this.aiCache.get(cacheKey);
          if (cached && cached.length > 0) {
            return { groups: cached, unusedDiffs: [] };
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

        const callModel = async (): Promise<{ text?: string }> =>
          withTimeout(
            this.genAI.models.generateContent({
              model: modelName,
              contents: prompt,
            }),
            aiTimeout
          );

        const result = await this.requestBatcher.batch(cacheKey, callModel);

        const parseResult = parseAggregatedResponse(
          result.text ?? "",
          gate.approvedDiffs,
          gate.sanitizedDiffs
        );

        if (options.useCached && parseResult.groups.length > 0) {
          void this.aiCache.set(cacheKey, parseResult.groups);
        }

        return parseResult;
      },
      { operation: "generateAggregatedCommits" }
    ) as Promise<ParseResult>;
  };
}
