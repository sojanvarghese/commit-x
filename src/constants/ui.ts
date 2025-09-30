// UI and display constants
export const UI_CONSTANTS = {
  // Timeouts and delays
  EXIT_DELAY_MS: 100,

  // Text limits
  COMMIT_MESSAGE_MAX_LENGTH: 72,
  MESSAGE_MAX_LENGTH: 120,
  MAX_WORD_COUNT: 25,
  MIN_WORD_COUNT: 7,
  DIFF_CONTENT_TRUNCATE_LIMIT: 3000,

  // Display settings
  PAGE_SIZE: 10,
  CONFIDENCE_DECREASE: 0.4,
  CONFIDENCE_MIN: 0.3,
  CONFIDENCE_DEFAULT: 0.8,
  CONFIDENCE_FALLBACK: 0.3,

  // File status indicators
  FILE_STATUS: {
    NEW: '[NEW]',
    DELETED: '[DELETED]',
    RENAMED: '[RENAMED]',
    MODIFIED: '[MODIFIED]',
  },

  // Git status indicators
  GIT_STATUS: {
    STAGED: 'A',
    MODIFIED: 'M',
    UNTRACKED: '??',
  },

  // Spinner messages
  SPINNER_MESSAGES: {
    STAGING: 'Staging files...',
    COMMITTING: 'Creating commit...',
    ANALYZING: 'Analyzing files...',
    GENERATING_AI: 'Generating commit messages for',
    GENERATING_MESSAGE: 'Generating commit message...',
    ANALYZING_CHANGES: 'Analyzing changes...',
  },
} as const;


export const COMMIT_MESSAGE_PATTERNS = {
  // Conventional commit prefixes to avoid
  AVOID_PREFIXES: ['feat:', 'fix:', 'chore:'],

  // Numbered list pattern
  NUMBERED_PATTERN: /^\d+\./,

  // JSON pattern for parsing
  JSON_PATTERN: /\{[\s\S]*\}/,
} as const;
