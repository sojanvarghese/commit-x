import { GoogleGenAI } from "@google/genai";
import type {
  CommitSuggestion,
  GitDiff,
  CommitGroup,
  AggregatedCommitResponse,
} from "../types/common.js";
import { ConfigManager } from "../config.js";
import { GitDiffSchema, DiffContentSchema } from "../schemas/validation.js";
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
  AI_DEFAULT_MODEL,
  AI_FALLBACK_MODEL,
} from "../constants/ai.js";
import { ERROR_MESSAGES } from "../constants/messages.js";
import { UI_CONSTANTS, COMMIT_MESSAGE_PATTERNS } from "../constants/ui.js";
import { lightColors } from "../utils/colors.js";
import {
  sanitizeGitDiff,
  shouldSkipFileForAI,
  createPrivacyReport,
  type SanitizedDiff,
} from "../utils/data-sanitization.js";
import {
  PersistentAICache,
  RequestBatcher,
  type AICache,
} from "../utils/ai-cache.js";

export class AIService {
  private readonly genAI: GoogleGenAI;
  private readonly config: ConfigManager;
  private readonly aiCache: AICache;
  private readonly requestBatcher: RequestBatcher;
  private modelName: string | null = null; // Cache the model name

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

    // API key is already validated by ConfigManager.getApiKey()
    this.genAI = new GoogleGenAI({ apiKey });
  }

  private getModelName(): string {
    if (!this.modelName) {
      const config = this.config.getConfig();
      this.modelName = config.model ?? AI_DEFAULT_MODEL;
    }
    return this.modelName;
  }

  private readonly logPrivacyReport = (privacyReport: {
    sanitizedFiles: number;
    warnings: string[];
  }): void => {
    if (privacyReport.sanitizedFiles > 0) {
      console.warn(""); // Add newline before privacy notice
      console.warn(
        `⚠️  Privacy Notice: ${privacyReport.sanitizedFiles} files were sanitized before sending to AI`
      );
      if (privacyReport.warnings.length > 0) {
        console.warn(`   Warnings: ${privacyReport.warnings.join(" & ")}`);
      }
    }
  };

  private readonly validateAndFilterDiffs = (
    diffs: GitDiff[]
  ): { validatedDiffs: GitDiff[]; skippedFiles: string[] } => {
    const validatedDiffs: GitDiff[] = [];
    const skippedFiles: string[] = [];

    for (const diff of diffs) {
      // Check if file should be skipped for privacy reasons
      const skipCheck = shouldSkipFileForAI(diff.file, diff.changes || "");
      if (skipCheck.skip) {
        console.warn(`⚠️  Skipping ${diff.file}: ${skipCheck.reason}`);
        skippedFiles.push(diff.file);
        continue;
      }

      const diffResult = GitDiffSchema.safeParse(diff);
      if (diffResult.success) {
        // Additional validation for diff content size
        const contentResult = DiffContentSchema.safeParse(diff.changes);
        if (contentResult.success) {
          validatedDiffs.push(diffResult.data);
        } else {
          console.warn(`Skipping diff for ${diff.file}: content too large`);
        }
      } else {
        console.warn(
          `Skipping invalid diff for ${diff.file}:`,
          diffResult.error.issues
        );
      }
    }

    return { validatedDiffs, skippedFiles };
  };

  private readonly generateCacheKey = (diffs: GitDiff[]): string =>
    this.aiCache.generateKey(diffs);

  private readonly generateFallbackMessage = (diff: GitDiff): string => {
    const fileName = diff.file.split("/").pop() ?? diff.file;

    if (diff.isNew) {
      return `Created new ${fileName} file with initial implementation`;
    } else if (diff.isDeleted) {
      return `Removed ${fileName} file as it is no longer needed`;
    } else if (diff.additions > diff.deletions * 2) {
      return `Added new functionality to ${fileName} file`;
    } else if (diff.deletions > diff.additions * 2) {
      return `Removed unused code from ${fileName} file`;
    } else {
      return `Updated ${fileName} file with code improvements`;
    }
  };

  private readonly executeAggregatedCommitGeneration = async (
    diffs: GitDiff[],
    modelName: string
  ): Promise<AggregatedCommitResponse> => {
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

        // Filter out sensitive files and validate diffs
        const { validatedDiffs } = this.validateAndFilterDiffs(diffs);

        if (validatedDiffs.length === 0) {
          throw new SecureError(
            "No valid diffs after filtering",
            ErrorType.VALIDATION_ERROR,
            { operation: "generateAggregatedCommits" },
            true
          );
        }

        const { prompt, sanitizedDiffs } =
          this.buildAggregatedPrompt(validatedDiffs);

        if (prompt.length > DEFAULT_LIMITS.maxApiRequestSize) {
          throw new SecureError(
            `Prompt size ${prompt.length} exceeds limit of ${DEFAULT_LIMITS.maxApiRequestSize} characters`,
            ErrorType.VALIDATION_ERROR,
            { operation: "generateAggregatedCommits" },
            true
          );
        }

        // Check cache for aggregated requests too
        const aggregatedCacheKey = `agg_${this.generateCacheKey(validatedDiffs)}`;
        const cachedAggregated = await this.aiCache.get(aggregatedCacheKey);
        if (cachedAggregated) {
          // Convert cached suggestions back to aggregated format
          return {
            groups: [
              {
                files: validatedDiffs.map(d => d.file),
                message:
                  cachedAggregated[0]?.message ||
                  this.generateFallbackMessage(validatedDiffs[0]),
                description: cachedAggregated[0]?.description,
                confidence: cachedAggregated[0]?.confidence || 0.7,
              },
            ],
          };
        }

        const totalChanges = validatedDiffs.reduce(
          (sum, diff) => sum + diff.additions + diff.deletions,
          0
        );

        const aiTimeout = calculateAITimeout({
          diffSize: prompt.length,
          fileCount: validatedDiffs.length,
          totalChanges,
        });

        const result = await this.requestBatcher.batch(
          aggregatedCacheKey,
          async () =>
            withTimeout(
              this.genAI.models.generateContent({
                model: modelName,
                contents: prompt,
              }),
              aiTimeout
            )
        );

        const aggregatedResult = this.parseAggregatedResponse(
          result.text ?? "",
          validatedDiffs,
          sanitizedDiffs
        );

        // Cache the aggregated result (convert to suggestions format for caching)
        if (aggregatedResult.groups.length > 0) {
          const cacheableSuggestions: CommitSuggestion[] =
            aggregatedResult.groups.map(group => ({
              message: group.message,
              description: group.description,
              confidence: group.confidence || 0.7,
            }));
          void this.aiCache.set(aggregatedCacheKey, cacheableSuggestions);
        }

        return aggregatedResult;
      },
      { operation: "generateAggregatedCommits" }
    );
  };

  generateAggregatedCommits = async (
    diffs: GitDiff[]
  ): Promise<AggregatedCommitResponse> => {
    const primaryModel = this.getModelName();

    try {
      return await withRetry(
        async () => this.executeAggregatedCommitGeneration(diffs, primaryModel),
        AI_RETRY_ATTEMPTS,
        AI_RETRY_DELAY_MS,
        { operation: "generateAggregatedCommits" }
      );
    } catch {
      // If retry with primary model fails, try once with fallback model
      console.warn(
        `⚠️  Primary model (${primaryModel}) failed, attempting with fallback model (${AI_FALLBACK_MODEL})...`
      );
      return await this.executeAggregatedCommitGeneration(
        diffs,
        AI_FALLBACK_MODEL
      );
    }
  };

  private readonly buildAggregatedPrompt = (
    diffs: GitDiff[],
    baseDir: string = process.cwd()
  ): { prompt: string; sanitizedDiffs: SanitizedDiff[] } => {
    // Sanitize all diffs before sending to AI
    const sanitizedDiffs = diffs.map(diff => sanitizeGitDiff(diff, baseDir));

    // Create privacy report
    const privacyReport = createPrivacyReport(sanitizedDiffs);

    // Log privacy warnings if any
    this.logPrivacyReport(privacyReport);

    const inputFiles = sanitizedDiffs.map((diff, index) => ({
      id: index + 1,
      name: diff.file,
      status: diff.isNew
        ? "new"
        : diff.isDeleted
          ? "deleted"
          : diff.isRenamed
            ? "renamed"
            : "modified",
      stats: `+${diff.additions}/-${diff.deletions}`,
      changes:
        diff.changes?.slice(0, UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT) || "",
      truncated:
        Boolean(diff.changes) &&
        diff.changes.length > UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT,
      sanitized: diff.sanitized,
    }));

    const prompt = [
      "You group related file changes into logical git commits.",
      "Return JSON only with this shape:",
      '{"groups":[{"files":["file1"],"message":"Updated something clearly","description":"optional","confidence":0.9}]}',
      "Rules:",
      "- Every file must appear exactly once",
      "- Prefer 1-7 files per group",
      "- Always group dependency manifests and lock files together",
      "- Group similar, feature-related, or cross-cutting changes together",
      `- Messages must not use conventional commit prefixes (${COMMIT_MESSAGE_PATTERNS.AVOID_PREFIXES.join(", ")}) or scoped forms like feat(scope):`,
      "- Messages should be 3-20 words, start with a capitalized past-tense verb, and have no period",
      "- Confidence must be a number between 0 and 1",
      "Files:",
      JSON.stringify(inputFiles),
    ].join("\n");

    return { prompt, sanitizedDiffs };
  };

  private readonly parseAggregatedResponse = (
    response: string,
    diffs: GitDiff[],
    sanitizedDiffs: SanitizedDiff[]
  ): AggregatedCommitResponse => {
    try {
      const jsonMatch = response.match(COMMIT_MESSAGE_PATTERNS.JSON_PATTERN);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in AI response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.groups || !Array.isArray(parsed.groups)) {
        throw new Error("Invalid groups structure in AI response");
      }

      // Create mapping from sanitized filename back to original file path
      const sanitizedToOriginal = new Map<string, string>();
      for (let i = 0; i < sanitizedDiffs.length; i++) {
        sanitizedToOriginal.set(sanitizedDiffs[i].file, diffs[i].file);
      }

      const groups: CommitGroup[] = [];
      const usedFiles = new Set<string>();

      // Process each group from AI response
      for (const group of parsed.groups) {
        if (!group.files || !Array.isArray(group.files) || !group.message) {
          console.warn("Skipping invalid group structure:", group);
          continue;
        }

        // Map sanitized filenames back to original file paths
        const validFiles: string[] = [];
        for (const sanitizedFileName of group.files) {
          const originalFile = sanitizedToOriginal.get(sanitizedFileName);
          if (originalFile && !usedFiles.has(originalFile)) {
            validFiles.push(originalFile);
            usedFiles.add(originalFile);
          }
        }

        if (validFiles.length > 0) {
          const trimmedMessage = group.message.trim();
          const validation = this.validateCommitMessageFormat(trimmedMessage);

          // Use corrected message if validation provided one, or generate fallback if invalid
          let finalMessage = trimmedMessage;
          if (validation.correctedMessage) {
            finalMessage = validation.correctedMessage;
          } else if (!validation.isValid) {
            console.log(
              lightColors.red(
                `❌ Rejecting invalid commit message format: "${trimmedMessage}"`
              )
            );
            // Generate fallback message for the first file in the group
            const firstDiff = diffs.find(d => d.file === validFiles[0]);
            finalMessage = firstDiff
              ? this.generateFallbackMessage(firstDiff)
              : "Updated files";
            console.log(
              lightColors.blue(`  ✓ Using fallback message: "${finalMessage}"`)
            );
          }

          groups.push({
            files: validFiles,
            message: finalMessage,
            description: group.description?.trim(),
            confidence:
              typeof group.confidence === "number" ? group.confidence : 0.7,
          });
        }
      }

      // Handle any files not included in groups
      const unusedFiles = diffs.filter(diff => !usedFiles.has(diff.file));
      if (unusedFiles.length > 0) {
        console.warn(
          `${unusedFiles.length} files not included in AI grouping, adding as individual commits`
        );
        for (const diff of unusedFiles) {
          groups.push({
            files: [diff.file],
            message: this.generateFallbackMessage(diff),
            confidence: 0.6,
          });
        }
      }

      return { groups };
    } catch (error) {
      console.warn("Failed to parse aggregated response:", error);
      throw new Error(`Failed to parse AI response: ${error}`, {
        cause: error,
      });
    }
  };

  private readonly validateCommitMessageFormat = (
    message: string
  ): { isValid: boolean; correctedMessage?: string } => {
    if (!message || typeof message !== "string") {
      return { isValid: false };
    }

    const trimmedMessage = message.trim();
    const hasSimplePrefix = COMMIT_MESSAGE_PATTERNS.AVOID_PREFIXES.some(
      prefix => trimmedMessage.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (hasSimplePrefix) {
      console.log(
        lightColors.yellow(
          `⚠️  Detected conventional commit prefix in: "${trimmedMessage}"`
        )
      );
      return { isValid: false };
    }

    const hasConventionalPattern =
      COMMIT_MESSAGE_PATTERNS.CONVENTIONAL_COMMIT_PATTERNS.some(pattern =>
        pattern.test(trimmedMessage)
      );

    if (hasConventionalPattern) {
      console.log(
        lightColors.yellow(
          `⚠️  Detected conventional commit format in: "${trimmedMessage}"`
        )
      );
      const corrected = trimmedMessage.replace(/^[a-z]+(\([^)]*\))?:\s*/i, "");
      if (corrected && corrected.length > 10) {
        const correctedMessage =
          corrected.charAt(0).toUpperCase() + corrected.slice(1);
        console.log(
          lightColors.blue(`  ✓ Corrected to: "${correctedMessage}"`)
        );
        return { isValid: true, correctedMessage };
      }
      return { isValid: false };
    }

    return { isValid: true };
  };
}
