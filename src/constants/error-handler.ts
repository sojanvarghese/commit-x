import { ErrorType } from '../types/error-handler.js';

export const ERROR_LOG_LIMIT = 100;
export const RECENT_ERROR_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY_MS = 500;

export const ERROR_PATTERNS = [
  { type: ErrorType.TIMEOUT_ERROR, patterns: ['timeout', 'timed out'] },
  { type: ErrorType.VALIDATION_ERROR, patterns: ['validation', 'invalid'] },
  { type: ErrorType.SECURITY_ERROR, patterns: ['security', 'path traversal', 'suspicious'] },
  { type: ErrorType.GIT_ERROR, patterns: ['git', 'repository'] },
  { type: ErrorType.AI_SERVICE_ERROR, patterns: ['api', 'gemini', 'ai'] },
  { type: ErrorType.CONFIG_ERROR, patterns: ['config', 'configuration'] },
];
