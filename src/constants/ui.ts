export const UI_CONSTANTS = {
  EXIT_DELAY_MS: 100,
  COMMIT_MESSAGE_MAX_LENGTH: 72,
  MESSAGE_MAX_LENGTH: 120,
  MAX_WORD_COUNT: 25,
  MIN_WORD_COUNT: 7,
  DIFF_CONTENT_TRUNCATE_LIMIT: 3000,
  PAGE_SIZE: 10,
  CONFIDENCE_DECREASE: 0.4,
  CONFIDENCE_MIN: 0.3,
  CONFIDENCE_DEFAULT: 0.8,
  CONFIDENCE_FALLBACK: 0.3,
  FILE_STATUS: {
    NEW: "[NEW]",
    DELETED: "[DELETED]",
    RENAMED: "[RENAMED]",
    MODIFIED: "[MODIFIED]",
  },
  GIT_STATUS: {
    STAGED: "A",
    MODIFIED: "M",
    UNTRACKED: "??",
  },
  SPINNER_MESSAGES: {
    STAGING: "Staging files...",
    COMMITTING: "Creating commit...",
    ANALYZING: "Analyzing files...",
    GENERATING_AI: "Generating commit messages for",
    GENERATING_MESSAGE: "Generating commit message...",
    ANALYZING_CHANGES: "Analyzing changes...",
  },
} as const;

export const COMMIT_MESSAGE_PATTERNS = {
  // Simple prefixes (original patterns)
  AVOID_PREFIXES: [
    "feat:",
    "fix:",
    "chore:",
    "refactor:",
    "test:",
    "docs:",
    "style:",
    "perf:",
    "ci:",
    "build:",
    "revert:",
  ],
  // Regex patterns to catch scoped conventional commit formats like feat(scope):, refactor(component):
  CONVENTIONAL_COMMIT_PATTERNS: [
    /^feat\([^)]*\):/i,        // feat(scope):
    /^fix\([^)]*\):/i,         // fix(scope):
    /^chore\([^)]*\):/i,       // chore(scope):
    /^refactor\([^)]*\):/i,    // refactor(scope):
    /^test\([^)]*\):/i,        // test(scope):
    /^docs\([^)]*\):/i,        // docs(scope):
    /^style\([^)]*\):/i,       // style(scope):
    /^perf\([^)]*\):/i,        // perf(scope):
    /^ci\([^)]*\):/i,          // ci(scope):
    /^build\([^)]*\):/i,       // build(scope):
    /^revert\([^)]*\):/i,      // revert(scope):
    /^[a-z]+\([^)]*\):/i,      // any lowercase word followed by (scope):
  ],
  NUMBERED_PATTERN: /^\d+\./,
  JSON_PATTERN: /\{[\s\S]*\}/,
} as const;
