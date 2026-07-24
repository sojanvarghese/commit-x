import type { ResourceLimits } from "../types/security.js";

export const DEFAULT_LIMITS: ResourceLimits = {
  maxFileSize: 25 * 1024 * 1024, // 25 MB
  maxDiffSize: 100_000, // 100 KB (increased from 50 KB)
  maxApiRequestSize: 750_000, // ~750 KB (aligned with average TPM capacity)
  timeoutMs: 25_000, // 25 seconds (middle ground from performance)
};

export const SUSPICIOUS_PATTERNS = [
  /\0/, // Null bytes are never valid in filesystem paths
];

export const SUSPICIOUS_COMMIT_PATTERNS = [
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f]/, // Terminal/control characters
];

// Sensitive file patterns for data sanitization
export const SENSITIVE_EXTENSIONS = [
  ".env",
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".p8",
];
export const SENSITIVE_JSON_FILES = ["secrets.json", "credentials.json"];
export const SENSITIVE_DIRECTORIES = ["secrets", "keys", "credentials"];
