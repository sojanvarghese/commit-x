import type { ResourceLimits } from "../types/security.js";

export const DEFAULT_LIMITS: ResourceLimits = {
  maxFileSize: 25 * 1024 * 1024, // 30 MB (based on average use cases)
  maxDiffSize: 100_000, // 100 KB (increased from 50 KB)
  maxApiRequestSize: 750_000, // ~750 KB (aligned with average TPM capacity)
  timeoutMs: 25_000, // 25 seconds (middle ground from performance)
};

export const ALLOWED_CONFIG_KEYS = ["apiKey", "model"];
export const ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
];

export const SUSPICIOUS_PATTERNS = [
  /\.\./, // Parent directory references
  /\/\.\./, // Parent directory references with slash
  /\\\.\./, // Windows parent directory references
  /\/\//, // Double slashes
  /\\\\/, // Double backslashes
  /[<>:"|?*]/, // Invalid characters
];

export const SUSPICIOUS_COMMIT_PATTERNS = [
  /[<>]/, // HTML tags
  /javascript:/i, // JavaScript protocol
  /data:/i, // Data protocol
  /vbscript:/i, // VBScript protocol
  /on\w+\s*=/i, // Event handlers
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
export const SENSITIVE_JSON_FILES = [
  "secrets.json",
  "credentials.json",
  "config.json",
];
export const SENSITIVE_DIRECTORIES = [
  "secrets",
  "keys",
  "credentials",
  "config",
  ".env",
];
