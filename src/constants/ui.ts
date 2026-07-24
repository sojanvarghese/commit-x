export const UI_CONSTANTS = {
  DIFF_CONTENT_TRUNCATE_LIMIT: 3000,
  PAGE_SIZE: 10,
  FILE_STATUS: {
    NEW: "[NEW]",
    DELETED: "[DELETED]",
    RENAMED: "[RENAMED]",
    MODIFIED: "[MODIFIED]",
  },
  SPINNER_MESSAGES: {
    STAGING: "Staging files...",
    COMMITTING: "Creating commit...",
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
    /^feat\([^)]*\):/i, // feat(scope):
    /^fix\([^)]*\):/i, // fix(scope):
    /^chore\([^)]*\):/i, // chore(scope):
    /^refactor\([^)]*\):/i, // refactor(scope):
    /^test\([^)]*\):/i, // test(scope):
    /^docs\([^)]*\):/i, // docs(scope):
    /^style\([^)]*\):/i, // style(scope):
    /^perf\([^)]*\):/i, // perf(scope):
    /^ci\([^)]*\):/i, // ci(scope):
    /^build\([^)]*\):/i, // build(scope):
    /^revert\([^)]*\):/i, // revert(scope):
    /^[a-z]+\([^)]*\):/i, // any lowercase word followed by (scope):
  ],
} as const;
