import * as path from "node:path";
import {
  SENSITIVE_EXTENSIONS,
  SENSITIVE_JSON_FILES,
  SENSITIVE_DIRECTORIES,
} from "../constants/security.js";

interface SensitivePattern {
  pattern: RegExp;
  label: string;
  blockFile: boolean;
  // Narrows a regex hit before it is redacted.
  confirm?: (match: string) => boolean;
}

const passesLuhnCheck = (candidate: string): boolean => {
  const digits = candidate.replace(/\D/g, "");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

const SENSITIVE_PATTERNS: readonly SensitivePattern[] = [
  {
    pattern:
      /(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|pwd)\s*[:=]\s*['"]?[a-zA-Z0-9+/_.=-]{16,}['"]?/gi,
    label: "credential assignment",
    blockFile: true,
  },
  {
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    label: "Google API key",
    blockFile: true,
  },
  {
    pattern:
      /\b(?:gh[opusr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
    label: "GitHub token",
    blockFile: true,
  },
  {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    label: "Slack token",
    blockFile: true,
  },
  {
    pattern: /https?:\/\/[^:\s]+:[^@\s]+@[^\s]+/g,
    label: "URL credentials",
    blockFile: true,
  },
  {
    pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s]+/gi,
    label: "database connection string",
    blockFile: true,
  },
  {
    pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
    label: "JWT",
    blockFile: true,
  },
  {
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    label: "AWS access key",
    blockFile: true,
  },
  {
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    label: "private key",
    blockFile: true,
  },
  {
    // The local part is bounded: unbounded, it rescans a long token from every
    // start position when no "@" follows, which is quadratic.
    pattern: /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    label: "email address",
    blockFile: false,
  },
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    label: "US social security number",
    blockFile: false,
  },
  {
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    label: "possible payment card number",
    blockFile: false,
    // Timestamps and numeric IDs are 13-19 digits too; the checksum tells
    // them apart from card numbers.
    confirm: passesLuhnCheck,
  },
];

export interface SanitizedDiff {
  file: string;
  additions: number;
  deletions: number;
  changes: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  oldPath?: string;
  sanitized: boolean;
  warnings: string[];
}

export const sanitizeFilePath = (filePath: string, baseDir: string): string => {
  try {
    const relativePath = path.relative(baseDir, filePath);

    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return path.basename(filePath);
    }

    return relativePath;
  } catch {
    // If any error occurs, just return the filename
    return path.basename(filePath);
  }
};

export const sanitizeDiffContent = (
  content: string
): { sanitized: string; warnings: string[] } => {
  const warnings: string[] = [];
  let sanitized = content;

  for (const { pattern, label, confirm } of SENSITIVE_PATTERNS) {
    let redacted = false;
    sanitized = sanitized.replace(pattern, match => {
      if (confirm && !confirm(match)) return match;
      redacted = true;
      return "[REDACTED]";
    });
    if (redacted) warnings.push(`Potential ${label} redacted`);
  }

  // Git patch headers repeat repository paths. The model receives opaque file
  // IDs, so these transport-level paths add tokens without useful semantics.
  sanitized = sanitized
    .replace(/^diff --git .+$/gm, "diff --git [PATHS OMITTED]")
    .replace(/^(---|\+\+\+|rename from|rename to) .+$/gm, "$1 [PATH OMITTED]");

  return { sanitized, warnings };
};

export const sanitizeGitDiff = (
  diff: {
    file: string;
    additions: number;
    deletions: number;
    changes: string;
    isNew: boolean;
    isDeleted: boolean;
    isRenamed: boolean;
    oldPath?: string;
  },
  baseDir: string
): SanitizedDiff => {
  const sanitizedPath = sanitizeFilePath(diff.file, baseDir);
  const { sanitized: sanitizedChanges, warnings } = sanitizeDiffContent(
    diff.changes
  );

  return {
    file: sanitizedPath,
    additions: diff.additions,
    deletions: diff.deletions,
    changes: sanitizedChanges,
    isNew: diff.isNew,
    isDeleted: diff.isDeleted,
    isRenamed: diff.isRenamed,
    ...(diff.oldPath
      ? { oldPath: sanitizeFilePath(diff.oldPath, baseDir) }
      : {}),
    sanitized: warnings.length > 0,
    warnings,
  };
};

export const shouldSkipFileForAI = (
  filePath: string,
  content: string
): { skip: boolean; reason?: string } => {
  // Skip sensitive file types
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    SENSITIVE_EXTENSIONS.includes(ext)
  ) {
    return { skip: true, reason: "Sensitive file type" };
  }

  // Skip specific sensitive JSON files, but allow standard config files
  if (ext === ".json" && SENSITIVE_JSON_FILES.includes(fileName)) {
    return { skip: true, reason: "Sensitive file type" };
  }

  // High-confidence credentials block the whole file. Personal identifiers
  // are redacted instead, avoiding false-positive file drops.
  for (const { pattern, blockFile } of SENSITIVE_PATTERNS) {
    if (!blockFile) continue;
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      return { skip: true, reason: "Contains potential sensitive data" };
    }
  }

  // Skip files in sensitive directories
  const pathParts = filePath.toLowerCase().split("/");

  for (const part of pathParts) {
    if (SENSITIVE_DIRECTORIES.includes(part)) {
      return { skip: true, reason: "Located in sensitive directory" };
    }
  }

  return { skip: false };
};

export const createPrivacyReport = (
  sanitizedDiffs: SanitizedDiff[]
): {
  totalFiles: number;
  sanitizedFiles: number;
  warnings: string[];
} => {
  const sanitizedFiles = sanitizedDiffs.filter(diff => diff.sanitized).length;
  const allWarnings = sanitizedDiffs.flatMap(diff => diff.warnings);

  return {
    totalFiles: sanitizedDiffs.length,
    sanitizedFiles,
    warnings: [...new Set(allWarnings)],
  };
};
