import * as path from "path";
import * as os from "os";
import {
  SENSITIVE_EXTENSIONS,
  SENSITIVE_JSON_FILES,
  SENSITIVE_DIRECTORIES,
} from "../constants/security.js";

// Common patterns that might indicate sensitive information
const SENSITIVE_PATTERNS = [
  // API keys and tokens
  /(api[_-]?key|token|secret|password|pwd)\s*[:=]\s*['"]?[a-zA-Z0-9+/=]{20,}['"]?/gi,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // URLs with credentials
  /https?:\/\/[^:\s]+:[^@\s]+@[^\s]+/g,
  // Credit card numbers (basic pattern)
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  // Social Security Numbers (US)
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Phone numbers
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  // IP addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  // Database connection strings
  /(mongodb|postgresql|mysql|redis):\/\/[^\s]+/gi,
  // JWT tokens
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  // Private keys
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
];

// Patterns to detect potential secrets in comments
const SECRET_COMMENT_PATTERNS = [
  /\/\*[\s\S]*?(?:password|secret|key|token)[\s\S]*?\*\//gi,
  /\/\/.*?(?:password|secret|key|token).*$/gim,
  /#.*?(?:password|secret|key|token).*$/gim,
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
    // Get the relative path from the base directory
    const relativePath = path.relative(baseDir, filePath);

    // If it's outside the base directory, return just the filename
    if (relativePath.startsWith("..")) {
      return path.basename(filePath);
    }

    // Replace username in path with placeholder
    const homeDir = os.homedir();
    if (filePath.startsWith(homeDir)) {
      const relativeToHome = path.relative(homeDir, filePath);
      return `~/${relativeToHome}`;
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

  // Check for sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      warnings.push(
        `Potential sensitive data detected: ${matches[0].substring(0, 20)}...`
      );
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
  }

  // Check for secrets in comments
  for (const pattern of SECRET_COMMENT_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      warnings.push("Potential secrets detected in comments");
      sanitized = sanitized.replace(pattern, "/* [REDACTED COMMENT] */");
    }
  }

  // Remove or mask common sensitive file patterns
  const sensitiveFilePatterns = [
    /\.env/gi,
    /\.key/gi,
    /\.pem/gi,
    /\.p12/gi,
    /\.pfx/gi,
    /config\.json/gi,
    /secrets\.json/gi,
    /credentials\.json/gi,
  ];

  for (const pattern of sensitiveFilePatterns) {
    if (pattern.test(sanitized)) {
      warnings.push("Sensitive file pattern detected");
      sanitized = sanitized.replace(pattern, "[SENSITIVE_FILE]");
    }
  }

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
    oldPath: diff.oldPath ? sanitizeFilePath(diff.oldPath, baseDir) : undefined,
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

  if (SENSITIVE_EXTENSIONS.includes(ext)) {
    return { skip: true, reason: "Sensitive file type" };
  }

  // Skip specific sensitive JSON files, but allow standard config files
  if (ext === ".json" && SENSITIVE_JSON_FILES.includes(fileName)) {
    return { skip: true, reason: "Sensitive file type" };
  }

  // Skip files with sensitive patterns in content
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(content)) {
      return { skip: true, reason: "Contains potential sensitive data" };
    }
  }

  // Skip files in sensitive directories
  const pathParts = filePath.toLowerCase().split(path.sep);

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
  recommendations: string[];
} => {
  const sanitizedFiles = sanitizedDiffs.filter(diff => diff.sanitized).length;
  const allWarnings = sanitizedDiffs.flatMap(diff => diff.warnings);

  const recommendations: string[] = [];

  if (sanitizedFiles > 0) {
    recommendations.push(
      "Consider using .gitignore to exclude sensitive files from version control"
    );
    recommendations.push(
      "Use environment variables for sensitive configuration"
    );
    recommendations.push("Review sanitized content before committing");
  }

  if (allWarnings.some(w => w.includes("API key") || w.includes("token"))) {
    recommendations.push(
      "Ensure API keys are stored in environment variables, not in code"
    );
  }

  if (allWarnings.some(w => w.includes("password"))) {
    recommendations.push(
      "Use secure password management solutions instead of hardcoded passwords"
    );
  }

  return {
    totalFiles: sanitizedDiffs.length,
    sanitizedFiles,
    warnings: allWarnings,
    recommendations,
  };
};
