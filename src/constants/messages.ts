// Error messages and user-facing text constants
export const ERROR_MESSAGES = {
  API_KEY_NOT_FOUND:
    'Gemini API key not found. Please set GEMINI_API_KEY environment variable or configure it with "commit-x config set apiKey YOUR_API_KEY"',
  NO_STAGED_CHANGES:
    'No staged changes found. Please stage your changes with "git add" first.',
  NO_STAGED_CHANGES_DIFF: "No staged changes found.",
  NO_VALID_FILES: "No valid files to stage",
  INVALID_COMMIT_MESSAGE: "Commit message cannot be empty",
  COMMIT_MESSAGE_TOO_LONG: "First line should be 72 characters or less",
  INVALID_CONFIG_KEY: "Invalid configuration key",
  INVALID_COMMIT_MESSAGE_VALIDATION: "Invalid commit message",
  PROMPT_SIZE_EXCEEDED: "Prompt size exceeds limit of",
  DIFF_TOO_LARGE: "Diff too large for",
  JSON_NOT_FOUND: "No JSON found in response",
  FAILED_PARSE_JSON:
    "Failed to parse JSON response, falling back to text parsing",
} as const;

export const SUCCESS_MESSAGES = {
  SETUP_COMPLETED: "Setup completed successfully!",
  CONFIGURATION_RESET: "Configuration reset to defaults",
  FILES_STAGED: "Files staged successfully",
  COMMIT_CREATED: "Creating commit...",
  FILES_COMMITTED: "Committed files successfully",
  AI_MESSAGES_GENERATED: "Generated AI commit messages",
  COMMIT_MESSAGES_GENERATED: "Generated commit message suggestions",
} as const;

export const INFO_MESSAGES = {
  WELCOME_SETUP: "🚀 Welcome to Commit-X Setup!",
  USAGE_EXAMPLES: "📚 Commit-X Usage Examples:",
  CHANGES_SUMMARY: "📋 Changes Summary:",
  REPOSITORY_INFO: "📁 Repository:",
  BRANCH_INFO: "🌿 Branch:",
  STAGED_CHANGES: "✅ Staged changes:",
  UNSTAGED_CHANGES: "📝 Unstaged changes:",
  UNTRACKED_FILES: "❓ Untracked files:",
  WORKING_DIRECTORY_CLEAN: "✨ Working directory is clean",
  TOTAL_CHANGES: "📊 Total changes:",
  LAST_COMMIT: "💬 Last commit:",
  DRY_RUN_COMMIT: "Dry run - would commit with message:",
  WOULD_STAGE_COMMIT: "Would stage and commit:",
  GENERATING_MESSAGE: "Generating commit message...",
  ANALYZING_CHANGES: "Analyzing changes...",
  ANALYZING_FILES: "Analyzing files...",
  STAGING_FILES: "Staging files...",
  COMMITTING_FILES: "Committing files...",
} as const;

export const WARNING_MESSAGES = {
  NO_FILES_STAGED: "No files staged. Aborting commit.",
  NO_CHANGES_DETECTED: "No changes detected. Working directory is clean.",
  NO_COMMIT_MESSAGE: "No commit message provided. Aborting commit.",
  SKIPPING_EMPTY_NEW_FILE: "Skipping empty new file:",
  SKIPPING_NO_CHANGES: "Skipping file with no changes:",
  SKIPPING_INVALID_PATH: "Skipping invalid file path:",
  SKIPPING_DIFF_TOO_LARGE: "Skipping diff for",
  SKIPPING_INVALID_DIFF: "Skipping invalid diff for",
  AI_GENERATION_FAILED: "AI generation failed, using fallback messages",
  USING_FALLBACK_MESSAGES: "Using fallback messages due to AI error:",
  FAILED_TO_ANALYZE: "Failed to analyze",
  FAILED_TO_COMMIT: "Failed to commit",
  FAILED_TO_GET_DIFF: "Failed to get diff for",
  SKIPPING_INVALID_SUGGESTION: "Skipping invalid suggestion:",
  RESET_CANCELLED: "Reset cancelled",
  NOT_GIT_REPOSITORY: "Not a git repository",
  SETUP_FAILED: "Setup failed:",
} as const;

export const HELP_MESSAGES = {
  USAGE_COMMANDS: 'Use "commit-x --help" for available commands',
  CONFIG_MODIFY: 'Use "commit-x config" to modify settings later.',
  COMMIT_X_USAGE:
    'You can now use "commit-x" or "cx" to start making AI-powered commits.',
} as const;
