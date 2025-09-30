import type { ResourceLimits } from '../types/security.js';

export const DEFAULT_LIMITS: ResourceLimits = {
  maxFileSize: 25 * 1024 * 1024, // 30 MB (based on average use cases)
  maxDiffSize: 100_000, // 100 KB (increased from 50 KB)
  maxApiRequestSize: 750_000, // ~750 KB (aligned with average TPM capacity)
  timeoutMs: 25_000, // 15 seconds (middle ground from performance)
};

export const ALLOWED_CONFIG_KEYS = ['apiKey', 'model'];

export const ALLOWED_MODELS = [
  'gemini-1.5-flash', // Gemini 1.5 Flash	5	250,000	100 (DEPRECATED)
  'gemini-1.5-pro',
  'gemini-2.0-flash', // Gemini 2.0 Flash	15	1,000,000	200
  'gemini-2.0-flash-lite', // Gemini 2.0 Flash-Lite	30	1,000,000	200
  'gemini-2.5-pro', // Gemini 2.5 Pro	5	250,000	100
  'gemini-2.5-flash', // Gemini 2.5 Flash	10	250,000	250
  'gemini-2.5-flash-lite', // Gemini 2.5 Flash-Lite	15	250,000	1,000
  'gemini-2.0-flash-exp', // Gemini 2.0 Flash-Exp	5	1,000,000	200
  'gemma-3-2b', // Gemini 3 2B	10	1,000,000	200
  'gemma-3-9b', // Gemini 3 9B	20	1,000,000	200
  'gemma-3-27b', // Gemini 3 27B	40	1,000,000	200
  'gemma-3n-2b', // Gemini 3N 2B	10	1,000,000	200
  'gemma-3n-9b', // Gemini 3N 9B	20	1,000,000	200
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
export const SENSITIVE_EXTENSIONS = ['.env', '.key', '.pem', '.p12', '.pfx', '.p8'];
export const SENSITIVE_JSON_FILES = ['secrets.json', 'credentials.json', 'config.json'];
export const SENSITIVE_DIRECTORIES = ['secrets', 'keys', 'credentials', 'config', '.env'];

// Build directory patterns
export const BUILD_DIR_PATTERNS = ['/build/', '/dist/', '/out/', '/target/'];
