import { GoogleGenAI } from '@google/genai';
import type { CommitSuggestion, GitDiff, CommitGroup, AggregatedCommitResponse } from '../types/common.js';
import { ConfigManager } from '../config.js';
import { GitDiffSchema, CommitSuggestionSchema, DiffContentSchema } from '../schemas/validation.js';
import { withTimeout } from '../utils/security.js';
import { ErrorType } from '../types/error-handler.js';
import { ErrorHandler, withErrorHandling, withRetry, SecureError } from '../utils/error-handler.js';
import { DEFAULT_LIMITS } from '../constants/security.js';
import { calculateAITimeout } from '../utils/timeout.js';
import {
  AI_RETRY_ATTEMPTS,
  AI_RETRY_DELAY_MS,
  AI_DEFAULT_MODEL,
  AI_MAX_SUGGESTIONS,
} from '../constants/ai.js';
import { ERROR_MESSAGES, COMMIT_MESSAGES } from '../constants/messages.js';
import { UI_CONSTANTS, COMMIT_MESSAGE_PATTERNS } from '../constants/ui.js';
import {
  sanitizeGitDiff,
  shouldSkipFileForAI,
  createPrivacyReport,
  type SanitizedDiff,
} from '../utils/data-sanitization.js';

// Simple LRU cache for AI responses
class LRUCache<K, V> {
  private readonly cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used
      const firstKey = this.cache.keys().next().value as K;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export class AIService {
  private readonly genAI: GoogleGenAI;
  private readonly config: ConfigManager;
  private readonly errorHandler: ErrorHandler;
  private readonly responseCache = new LRUCache<string, CommitSuggestion[]>(100);
  private modelName: string | null = null; // Cache the model name

  constructor() {
    this.config = ConfigManager.getInstance();
    this.errorHandler = ErrorHandler.getInstance();

    const apiKey = this.config.getApiKey();

    if (!apiKey) {
      throw new SecureError(
        ERROR_MESSAGES.API_KEY_NOT_FOUND,
        ErrorType.CONFIG_ERROR,
        { operation: 'AIService.constructor' },
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

  // Generate cache key from diffs for deduplication
  private generateCacheKey(diffs: GitDiff[]): string {
    return diffs
      .map((diff) => `${diff.file}:${diff.additions}:${diff.deletions}:${diff.changes?.substring(0, 100)}`)
      .join('|');
  }

  generateCommitMessage = async (diffs: GitDiff[]): Promise<CommitSuggestion[]> => {
    return withRetry(
      async () => {
        return withErrorHandling(
          async () => {
            if (!diffs || diffs.length === 0) {
              throw new SecureError(
                ERROR_MESSAGES.NO_DIFFS_PROVIDED,
                ErrorType.VALIDATION_ERROR,
                { operation: 'generateCommitMessage' },
                true
              );
            }

            // Check cache first
            const cacheKey = this.generateCacheKey(diffs);
            const cached = this.responseCache.get(cacheKey);
            if (cached) {
              return cached;
            }

            // Filter out sensitive files and validate diffs
            const validatedDiffs: GitDiff[] = [];
            const skippedFiles: string[] = [];

            for (const diff of diffs) {
              // Check if file should be skipped for privacy reasons
              const skipCheck = shouldSkipFileForAI(diff.file, diff.changes || '');
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
                console.warn(`Skipping invalid diff for ${diff.file}:`, diffResult.error.issues);
              }
            }

            // Log privacy summary
            if (skippedFiles.length > 0) {
              console.warn(
                `🔒 Privacy: Skipped ${skippedFiles.length} sensitive files from AI processing`
              );
            }

            if (validatedDiffs.length === 0) {
              throw new SecureError(
                ERROR_MESSAGES.NO_VALID_DIFFS,
                ErrorType.VALIDATION_ERROR,
                { operation: 'generateCommitMessage' },
                true
              );
            }

            const modelName = this.getModelName();

            const { prompt, sanitizedDiffs } = this.buildJsonPrompt(validatedDiffs);

            if (prompt.length > DEFAULT_LIMITS.maxApiRequestSize) {
              throw new SecureError(
                `${ERROR_MESSAGES.PROMPT_SIZE_EXCEEDED} ${DEFAULT_LIMITS.maxApiRequestSize} characters`,
                ErrorType.VALIDATION_ERROR,
                { operation: 'generateCommitMessage' },
                true
              );
            }

            const totalChanges = validatedDiffs.reduce((sum, diff) => sum + diff.additions + diff.deletions, 0);
            const aiTimeout = calculateAITimeout({
              diffSize: prompt.length,
              fileCount: validatedDiffs.length,
              totalChanges
            });
            const result = await withTimeout(
              this.genAI.models.generateContent({
                model: modelName,
                contents: prompt
              }),
              aiTimeout
            );
            const text = result.text ?? '';

            // Use parseBatchResponse for consistency
            const batchResults = this.parseBatchResponse(text, validatedDiffs, sanitizedDiffs);
            const suggestions = batchResults[validatedDiffs[0]?.file] ?? [];

            // Validate suggestions using Zod
            const validatedSuggestions = this.validateAndImprove(suggestions);

            // Cache the result
            this.responseCache.set(cacheKey, validatedSuggestions);

            return validatedSuggestions;
          },
          { operation: 'generateCommitMessage' }
        );
      },
      AI_RETRY_ATTEMPTS,
      AI_RETRY_DELAY_MS,
      { operation: 'generateCommitMessage' }
    );
  };


  private readonly buildJsonPrompt = (
    diffs: GitDiff[],
    baseDir: string = process.cwd()
  ): { prompt: string; sanitizedDiffs: SanitizedDiff[] } => {
    // Sanitize all diffs before sending to AI
    const sanitizedDiffs = diffs.map((diff) => sanitizeGitDiff(diff, baseDir));

    // Create privacy report
    const privacyReport = createPrivacyReport(sanitizedDiffs);

    // Log privacy warnings if any
    if (privacyReport.sanitizedFiles > 0) {
      console.warn(''); // Add newline before privacy notice
      console.warn(
        `⚠️  Privacy Notice: ${privacyReport.sanitizedFiles} files were sanitized before sending to AI`
      );
      if (privacyReport.warnings.length > 0) {
        console.warn('   Warnings:');
        privacyReport.warnings.slice(0, 5).forEach((warning, index) => {
          console.warn(`   ${index + 1}. ${warning}`);
        });
        if (privacyReport.warnings.length > 5) {
          console.warn(`   ... and ${privacyReport.warnings.length - 5} more warnings`);
        }
      }
    }

    const promptData = {
      role: 'Expert Git Commit Message Generator',
      task: "Generate concise Git commit messages (3-20 words each) for each file's specific changes. Each message must accurately describe WHAT WAS CHANGED in that specific file.",
      instructions: [
        '**Focus:** Describe new functionality, features, or significant changes introduced.',
        "**Tense:** Use strong past tense action verbs (e.g., 'Implemented', 'Added', 'Created', 'Refactored', 'Fixed', 'Optimized') at the start of the message.",
        "**Purpose/Value:** Clearly articulate the 'why' behind the change and its benefit to the system or users.",
        '**Specificity:** Be highly specific. Avoid generic or vague statements. Detail the exact functionality or change.',
        "**Prefixes:** DO NOT include conventional prefixes (e.g., 'feat:', 'fix:', 'chore:').",
        '**Length:** Strictly adhere to the 3 to 20-word limit.',
        '**Output Format:** Provide the response in JSON, following the specified structure.',
        '**Analysis:** Thoroughly analyze the provided `code_diffs` to infer the core functional changes.',
        '**Individual Focus:** Generate UNIQUE messages for each file based on its specific changes. Do not reuse the same message for different files.',
      ],
      examples: {
        good_commit_messages: [
          {
            message: 'Implemented Zod validation for type-safe configuration',
            rationale: "More concise, removed 'management' without losing meaning.",
          },
          {
            message: 'Added ts-pattern utilities for error handling and file type detection',
            rationale: "Removed 'robust' for brevity, retaining core functionality.",
          },
          {
            message: 'Created centralized validation with comprehensive type definitions',
            rationale: "Removed 'system' as it's implied by 'centralized validation'.",
          },
          {
            message: 'Integrated tsup build configuration for optimized bundles',
            rationale: "Shortened 'bundle generation' to 'bundles' for conciseness.",
          },
          {
            message: 'Built pattern matching for commit message classification',
            rationale: "Removed 'utilities' as 'pattern matching' implies the feature itself.",
          },
        ],
        bad_commit_messages: [
          {
            message: 'Major updates to validation.ts (+279/-0 lines)',
            reason_for_badness:
              "Focuses on metrics (line changes) rather than functional impact. Lacks 'what' and 'why'.",
          },
          {
            message: 'Improved code quality and maintainability',
            reason_for_badness:
              'Generic statement of intent, not a description of concrete functional changes or features.',
          },
          {
            message: 'Enhanced data processing capabilities',
            reason_for_badness: 'Lacks details on *how* or *what* was enhanced. Too abstract.',
          },
          {
            message: 'Added 15 new functions and 3 classes',
            reason_for_badness:
              'Focuses on quantity of code elements, not the functional purpose or value they provide.',
          },
          {
            message: 'Implemented a new system for the purpose of managing user authentication',
            reason_for_badness:
              "Contains filler words like 'a new system for the purpose of' and 'managing'. Can be much more concise.",
          },
        ],
      },
      input_files: sanitizedDiffs.map((diff, index) => ({
        id: index + 1,
        name: diff.file,
        status: diff.isNew
          ? 'new file created'
          : diff.isDeleted
            ? 'file deleted'
            : diff.isRenamed
              ? 'file renamed'
              : 'modified',
        changes: diff.changes?.substring(0, UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT) || '',
        truncated: diff.changes && diff.changes.length > UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT,
        additions: diff.additions,
        deletions: diff.deletions,
        sanitized: diff.sanitized,
      })),
      output_format_instructions: {
        description:
          "The output must be a JSON object containing suggested commit messages. Confidence scores (0-1) indicate the model's certainty.",
        structure:
          diffs.length === 1
            ? {
                schema: {
                  suggestions: [
                    {
                      message: 'string (3-20 words, concise functional summary)',
                      confidence: 'number (0-1, likelihood of message accuracy)',
                    },
                  ],
                },
              }
            : {
                schema: {
                  files: {
                    'filename1.ts': {
                      message: 'string (3-20 words, concise functional summary for filename1)',
                      confidence: 'number (0-1, likelihood of message accuracy)',
                    },
                    'filename2.js': {
                      message: 'string (3-20 words, concise functional summary for filename2)',
                      confidence: 'number (0-1, likelihood of message accuracy)',
                    },
                  },
                },
              },
        example:
          diffs.length === 1
            ? {
                suggestions: [
                  {
                    message: 'Implemented user authentication system',
                    confidence: 0.9,
                  },
                ],
              }
            : {
                files: {
                  'auth.ts': {
                    message: 'Implemented user authentication system',
                    confidence: 0.9,
                  },
                  'user.js': {
                    message: 'Added user profile management features',
                    confidence: 0.8,
                  },
                },
              },
      },
    };

    return {
      prompt: JSON.stringify(promptData, null, 2),
      sanitizedDiffs,
    };
  };

  private readonly parseBatchResponse = (
    response: string,
    diffs: GitDiff[],
    sanitizedDiffs: SanitizedDiff[]
  ): { [filename: string]: CommitSuggestion[] } => {
    const results: { [filename: string]: CommitSuggestion[] } = {};

    try {
      const jsonMatch = response.match(COMMIT_MESSAGE_PATTERNS.JSON_PATTERN);
      if (!jsonMatch) {
        throw new Error(ERROR_MESSAGES.JSON_NOT_FOUND);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Handle different response formats
      if (parsed.files && typeof parsed.files === 'object') {
        // Batch format: { files: { filename: { message, description, confidence } } }
        for (let i = 0; i < diffs.length; i++) {
          const diff = diffs[i];
          const sanitizedDiff = sanitizedDiffs[i];
          const fileResult = parsed.files[sanitizedDiff.file];
          if (fileResult?.message) {
            const suggestion: CommitSuggestion = {
              message: fileResult.message,
              description: fileResult.description ?? '',
              type: fileResult.type ?? '',
              scope: fileResult.scope ?? '',
              confidence:
                typeof fileResult.confidence === 'number'
                  ? fileResult.confidence
                  : (parseFloat(fileResult.confidence) ?? UI_CONSTANTS.CONFIDENCE_DEFAULT),
            };
            results[diff.file] = this.validateAndImprove([suggestion]);
          } else {
            // Fallback if specific file not found in response
            results[diff.file] = [
              {
                message: this.generateFallbackMessage(diff),
                description: 'Generated fallback commit message',
                confidence: UI_CONSTANTS.CONFIDENCE_FALLBACK,
              },
            ];
          }
        }
      } else if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        // Single file format: { suggestions: [{ message, description, confidence }] }
        // Apply the same suggestion to all files
        const suggestions = parsed.suggestions.map((suggestion: { message?: string; description?: string; type?: string; scope?: string; confidence?: number | string }) => ({
          message: suggestion.message ?? '',
          description: suggestion.description ?? '',
          type: suggestion.type ?? '',
          scope: suggestion.scope ?? '',
          confidence:
            typeof suggestion.confidence === 'number'
              ? suggestion.confidence
              : (parseFloat(suggestion.confidence?.toString() ?? '0') ?? UI_CONSTANTS.CONFIDENCE_DEFAULT),
        }));

        for (const diff of diffs) {
          results[diff.file] = this.validateAndImprove(suggestions);
        }
      } else {
        // Try to extract any commit messages from the response text
        const textSuggestions = this.parseTextResponse(response);
        for (const diff of diffs) {
          results[diff.file] =
            textSuggestions.length > 0
              ? textSuggestions
              : [
                  {
                    message: this.generateFallbackMessage(diff),
                    description: 'Generated fallback commit message',
                    confidence: UI_CONSTANTS.CONFIDENCE_FALLBACK,
                  },
                ];
        }
      }
    } catch (error) {
      console.warn(ERROR_MESSAGES.FAILED_PARSE_BATCH_JSON, error);
      // Generate fallback messages for all files
      for (const diff of diffs) {
        results[diff.file] = [
          {
            message: this.generateFallbackMessage(diff),
            description: 'Generated fallback commit message due to parsing error',
            confidence: UI_CONSTANTS.CONFIDENCE_FALLBACK,
          },
        ];
      }
    }

    return results;
  };

  private readonly generateFallbackMessage = (diff: GitDiff): string => {
    const fileName = diff.file.split('/').pop() ?? diff.file;

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

  private readonly validateAndImprove = (suggestions: CommitSuggestion[]): CommitSuggestion[] => {
    const validatedSuggestions: CommitSuggestion[] = [];

    for (const suggestion of suggestions) {
      const result = CommitSuggestionSchema.safeParse(suggestion);
      if (result.success) {
        let improvedMessage = result.data.message.trim();

        // Validate word count - reject messages that are too short/long
        const wordCount = improvedMessage.split(/\s+/).length;
        let confidence = result.data.confidence;

        if (wordCount < UI_CONSTANTS.MIN_WORD_COUNT) {
          // Don't add filler words - mark as low confidence instead
          confidence = Math.max(
            UI_CONSTANTS.CONFIDENCE_MIN,
            confidence - UI_CONSTANTS.CONFIDENCE_DECREASE
          );
        } else if (wordCount > UI_CONSTANTS.MAX_WORD_COUNT) {
          // Truncate to exactly max words without adding filler
          const words = improvedMessage.split(/\s+/);
          improvedMessage = words.slice(0, UI_CONSTANTS.MAX_WORD_COUNT).join(' ');
          confidence = Math.max(0.6, confidence - 0.1);
        }

        if (improvedMessage.length > UI_CONSTANTS.MESSAGE_MAX_LENGTH) {
          improvedMessage = `${improvedMessage.substring(0, UI_CONSTANTS.MESSAGE_MAX_LENGTH)}...`;
        }

        validatedSuggestions.push({
          ...result.data,
          message: improvedMessage,
          confidence,
        });
      } else {
        console.warn('Skipping invalid suggestion:', result.error.issues);
      }
    }

    return validatedSuggestions;
  };

  private readonly parseTextResponse = (response: string): CommitSuggestion[] => {
    const lines = response.split('\n').filter((line) => line.trim());
    const suggestions: CommitSuggestion[] = [];

    for (const line of lines) {
      if (
        line.match(COMMIT_MESSAGE_PATTERNS.NUMBERED_PATTERN) ||
        COMMIT_MESSAGE_PATTERNS.AVOID_PREFIXES.some((prefix) => line.includes(prefix))
      ) {
        const message = line.replace(COMMIT_MESSAGE_PATTERNS.NUMBERED_PATTERN, '').trim();
        if (message && message.length > 5) {
          suggestions.push({
            message,
            confidence: UI_CONSTANTS.CONFIDENCE_DEFAULT,
          });
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        message: COMMIT_MESSAGES.FALLBACK_IMPLEMENT,
        description: COMMIT_MESSAGES.FALLBACK_DESCRIPTION,
        confidence: UI_CONSTANTS.CONFIDENCE_FALLBACK,
      });
    }

    return suggestions.slice(0, AI_MAX_SUGGESTIONS);
  };

  generateAggregatedCommits = async (diffs: GitDiff[]): Promise<AggregatedCommitResponse> => {
    return withRetry(
      async () => {
        return withErrorHandling(
          async () => {
            if (!diffs || diffs.length === 0) {
              throw new SecureError(
                'No diffs provided for aggregated commits',
                ErrorType.VALIDATION_ERROR,
                { operation: 'generateAggregatedCommits' },
                true
              );
            }


            // Filter out sensitive files and validate diffs
            const validatedDiffs: GitDiff[] = [];
            const skippedFiles: string[] = [];

            for (const diff of diffs) {
              const skipCheck = shouldSkipFileForAI(diff.file, diff.changes || '');
              if (skipCheck.skip) {
                console.warn(`⚠️  Skipping ${diff.file}: ${skipCheck.reason}`);
                skippedFiles.push(diff.file);
                continue;
              }

              const diffResult = GitDiffSchema.safeParse(diff);
              if (diffResult.success) {
                const contentResult = DiffContentSchema.safeParse(diff.changes);
                if (contentResult.success) {
                  validatedDiffs.push(diffResult.data);
                } else {
                  console.warn(`Skipping diff for ${diff.file}: content too large`);
                }
              } else {
                console.warn(`Skipping invalid diff for ${diff.file}:`, diffResult.error.issues);
              }
            }

            if (validatedDiffs.length === 0) {
              throw new SecureError(
                'No valid diffs after filtering',
                ErrorType.VALIDATION_ERROR,
                { operation: 'generateAggregatedCommits' },
                true
              );
            }

            // If only one file, return individual commit
            if (validatedDiffs.length === 1) {
              const suggestions = await this.generateCommitMessage(validatedDiffs);
              return {
                groups: [{
                  files: [validatedDiffs[0].file],
                  message: suggestions[0]?.message || this.generateFallbackMessage(validatedDiffs[0]),
                  description: suggestions[0]?.description,
                  confidence: suggestions[0]?.confidence || 0.7
                }]
              };
            }

            const modelName = this.getModelName();
            const { prompt, sanitizedDiffs } = this.buildAggregatedPrompt(validatedDiffs);

            if (prompt.length > DEFAULT_LIMITS.maxApiRequestSize) {
              throw new SecureError(
                `Prompt size ${prompt.length} exceeds limit of ${DEFAULT_LIMITS.maxApiRequestSize} characters`,
                ErrorType.VALIDATION_ERROR,
                { operation: 'generateAggregatedCommits' },
                true
              );
            }

            const totalChanges = validatedDiffs.reduce((sum, diff) => sum + diff.additions + diff.deletions, 0);
            const aiTimeout = calculateAITimeout({
              diffSize: prompt.length,
              fileCount: validatedDiffs.length,
              totalChanges
            });

            const result = await withTimeout(
              this.genAI.models.generateContent({
                model: modelName,
                contents: prompt
              }),
              aiTimeout
            );

            const text = result.text ?? '';
            const aggregatedResult = this.parseAggregatedResponse(text, validatedDiffs, sanitizedDiffs);


            return aggregatedResult;
          },
          { operation: 'generateAggregatedCommits' }
        );
      },
      AI_RETRY_ATTEMPTS,
      AI_RETRY_DELAY_MS,
      { operation: 'generateAggregatedCommits' }
    );
  };

  private readonly buildAggregatedPrompt = (
    diffs: GitDiff[],
    baseDir: string = process.cwd()
  ): { prompt: string; sanitizedDiffs: SanitizedDiff[] } => {
    // Sanitize all diffs before sending to AI
    const sanitizedDiffs = diffs.map((diff) => sanitizeGitDiff(diff, baseDir));

    // Create privacy report
    const privacyReport = createPrivacyReport(sanitizedDiffs);

    // Log privacy warnings if any
    if (privacyReport.sanitizedFiles > 0) {
      console.warn(''); // Add newline before privacy notice
      console.warn(
        `⚠️  Privacy Notice: ${privacyReport.sanitizedFiles} files were sanitized before sending to AI`
      );
      if (privacyReport.warnings.length > 0) {
        console.warn('   Warnings:');
        privacyReport.warnings.slice(0, 5).forEach((warning, index) => {
          console.warn(`   ${index + 1}. ${warning}`);
        });
        if (privacyReport.warnings.length > 5) {
          console.warn(`   ... and ${privacyReport.warnings.length - 5} more warnings`);
        }
      }
    }

    const promptData = {
      role: 'Expert Git Commit Grouping and Message Generator',
      task: 'Analyze file changes and intelligently group related modifications into logical commits with appropriate messages.',
      instructions: [
        '**Primary Goal:** Group related file changes into logical commits to reduce redundant commit messages while maintaining clarity.',
        '**Grouping Priorities (in order):**',
        '1. **Dependency Files**: ALWAYS group package.json, yarn.lock, package-lock.json, pnpm-lock.yaml together',
        '2. **Similar Changes**: Files with identical or very similar functionality changes (same method added, same parameter made optional, etc.)',
        '3. **Feature-Related**: Files in same directory/module implementing related functionality',
        '4. **Cross-cutting Changes**: Import updates, renames, refactoring that affects multiple files',
        '**Individual Commits for:**',
        '- Complex changes that deserve separate attention',
        '- Unrelated modifications that don\'t fit any grouping pattern',
        '- Files with mixed types of changes (keep focused commits)',
        '**Message Guidelines:**',
        '- Group messages: "Updated package to v2.34 and dependencies" or "Made page parameter optional across entities"',
        '- Individual messages: Follow existing 3-20 word descriptive format',
        '- Use past tense action verbs (Implemented, Added, Updated, etc.)',
        '- Be specific about what changed and why',
        '**Output Format:** Provide the response in JSON, following the specified structure.',
        '**Analysis:** Thoroughly analyze the provided `code_diffs` to infer relationships between file changes.',
        '**Grouping Focus:** Prioritize logical groupings that make sense to developers reviewing commit history.',
      ],
      examples: {
        good_groupings: [
          {
            scenario: 'Dependency update',
            input_files: ['package.json', 'yarn.lock'],
            rationale: 'Package management files should always be grouped together as they represent a single logical dependency update.',
            output: {
              groups: [
                {
                  files: ['package.json', 'yarn.lock'],
                  message: 'Updated axios to v1.5.0 and dependencies',
                  confidence: 0.95
                }
              ]
            }
          },
          {
            scenario: 'Similar functionality across files',
            input_files: ['Animal.ts', 'Car.ts', 'House.ts'],
            rationale: 'Same change applied to multiple files should be grouped to show the cross-cutting nature of the modification.',
            output: {
              groups: [
                {
                  files: ['Animal.ts', 'Car.ts', 'House.ts'],
                  message: 'Made page parameter optional across entity classes',
                  confidence: 0.9
                }
              ]
            }
          },
          {
            scenario: 'Mixed related and unrelated changes',
            input_files: ['package.json', 'yarn.lock', 'README.md', 'auth.ts', 'users.ts'],
            rationale: 'Group related changes together while keeping unrelated changes separate for clear commit history.',
            output: {
              groups: [
                {
                  files: ['package.json', 'yarn.lock'],
                  message: 'Added axios v1.5.0 dependency',
                  confidence: 0.95
                },
                {
                  files: ['auth.ts', 'users.ts'],
                  message: 'Implemented user authentication and profile management',
                  confidence: 0.85
                },
                {
                  files: ['README.md'],
                  message: 'Updated API documentation',
                  confidence: 0.8
                }
              ]
            }
          }
        ],
        bad_groupings: [
          {
            scenario: 'Unrelated files grouped together',
            input_files: ['package.json', 'README.md', 'auth.ts'],
            reason_for_badness: 'Groups unrelated changes (dependency update, documentation, authentication) that should be separate commits.',
            better_approach: 'Keep each change type in its own commit for cleaner history.'
          },
          {
            scenario: 'Too many files in one group',
            input_files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts', 'file6.ts', 'file7.ts', 'file8.ts'],
            reason_for_badness: 'Grouping too many files makes the commit too large and hard to review.',
            better_approach: 'Split into smaller logical groups or by feature areas.'
          },
          {
            scenario: 'Missing dependency grouping',
            input_files: ['package.json', 'yarn.lock'],
            bad_output: {
              groups: [
                { files: ['package.json'], message: 'Updated package.json' },
                { files: ['yarn.lock'], message: 'Updated yarn.lock' }
              ]
            },
            reason_for_badness: 'Dependency files should always be grouped together as they represent a single logical change.',
          }
        ]
      },
      input_files: sanitizedDiffs.map((diff, index) => ({
        id: index + 1,
        name: diff.file,
        status: diff.isNew
          ? 'new file created'
          : diff.isDeleted
            ? 'file deleted'
            : diff.isRenamed
              ? 'file renamed'
              : 'modified',
        changes: diff.changes?.substring(0, UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT) || '',
        truncated: diff.changes && diff.changes.length > UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT,
        additions: diff.additions,
        deletions: diff.deletions,
        sanitized: diff.sanitized,
      })),
      output_format_instructions: {
        description:
          'The output must be a JSON object containing grouped commits with their respective files and commit messages. Confidence scores (0-1) indicate certainty about grouping decisions.',
        structure: {
          schema: {
            groups: [
              {
                files: ['array of filenames to group together'],
                message: 'descriptive commit message for the group (3-20 words)',
                description: 'optional brief explanation of why these files are grouped',
                confidence: 'number 0-1 indicating confidence in grouping decision'
              }
            ]
          }
        },
        example: {
          groups: [
            {
              files: ['package.json', 'yarn.lock'],
              message: 'Updated axios to v1.5.0 and dependencies',
              description: 'Dependency update with lock file changes',
              confidence: 0.95
            },
            {
              files: ['auth.ts', 'users.ts'],
              message: 'Implemented user authentication system',
              description: 'Related authentication files',
              confidence: 0.9
            }
          ]
        },
        requirements: [
          'Each file MUST appear in exactly one group',
          'Groups should have 1-7 files (prefer smaller logical groups)',
          'Dependency files (package.json, lock files) MUST be grouped together if present',
          'Messages must be descriptive and specific to the grouped changes',
          'Confidence should reflect how certain you are about the grouping logic'
        ]
      }
    };

    const prompt = JSON.stringify(promptData, null, 2);
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
        throw new Error('No valid JSON found in AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.groups || !Array.isArray(parsed.groups)) {
        throw new Error('Invalid groups structure in AI response');
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
          console.warn('Skipping invalid group structure:', group);
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
          groups.push({
            files: validFiles,
            message: group.message.trim(),
            description: group.description?.trim(),
            confidence: typeof group.confidence === 'number' ? group.confidence : 0.7
          });
        }
      }

      // Handle any files not included in groups
      const unusedFiles = diffs.filter(diff => !usedFiles.has(diff.file));
      if (unusedFiles.length > 0) {
        console.warn(`${unusedFiles.length} files not included in AI grouping, adding as individual commits`);
        for (const diff of unusedFiles) {
          groups.push({
            files: [diff.file],
            message: this.generateFallbackMessage(diff),
            confidence: 0.6
          });
        }
      }

      return { groups };
    } catch (error) {
      console.warn('Failed to parse aggregated response:', error);
      throw new Error(`Failed to parse AI response: ${error}`);
    }
  };

}
