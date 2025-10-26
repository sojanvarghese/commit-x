import { z } from 'zod';

// Base validation schemas
export const ApiKeySchema = z
  .string()
  .min(10, 'API key must be at least 10 characters long')
  .max(200, 'API key must be 200 characters or less')
  .regex(/^[A-Za-z0-9_-]+$/, 'API key contains invalid characters')
  .transform((val) => val.trim());

export const ModelSchema = z.enum([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

// Configuration schema
export const CommitConfigSchema = z.object({
  apiKey: ApiKeySchema.optional(),
  model: ModelSchema.default('gemini-2.5-flash'),
});

// Git diff schema
export const GitDiffSchema = z.object({
  file: z.string().min(1, 'File path is required'),
  additions: z.number().int().min(0, 'Additions must be non-negative'),
  deletions: z.number().int().min(0, 'Deletions must be non-negative'),
  changes: z.string(),
  isNew: z.boolean().default(false),
  isDeleted: z.boolean().default(false),
  isRenamed: z.boolean().default(false),
  oldPath: z.string().optional(),
});

// Commit suggestion schema
export const CommitSuggestionSchema = z.object({
  message: z.string().min(1, 'Commit message is required'),
  description: z.string().optional(),
  type: z.string().optional(),
  scope: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});

// File path validation schema
export const FilePathSchema = z
  .string()
  .min(1, 'File path is required')
  .refine((path) => {
    // Check for path traversal attempts
    return !path.includes('..') && !path.includes('~') && !path.startsWith('/');
  }, 'Path traversal detected: file path is outside allowed directory')
  .refine((path) => {
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /\.\./,
      /~/,
      /\/etc\//,
      /\/proc\//,
      /\/sys\//,
      /\/dev\//,
      /\.env/,
      /\.ssh/,
      /\.aws/,
      /\.config/,
      /\.git\//,
    ];
    return !suspiciousPatterns.some((pattern) => pattern.test(path));
  }, 'Suspicious path pattern detected');

// Commit message validation schema
export const CommitMessageSchema = z
  .string()
  .min(1, 'Commit message must be a non-empty string')
  .max(200, 'Commit message must be 200 characters or less')
  .refine((message) => {
    const trimmed = message.trim();
    return trimmed.length > 0;
  }, 'Commit message cannot be empty')
  .refine((message) => {
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /data:/i,
      /vbscript:/i,
      /onload=/i,
      /onerror=/i,
      /onclick=/i,
      /<iframe/i,
    ];
    return !suspiciousPatterns.some((pattern) => pattern.test(message));
  }, 'Commit message contains potentially malicious content')
  .transform((val) => val.trim());

// Diff content validation schema
export const DiffContentSchema = z
  .string()
  .max(100000, 'Diff content size exceeds limit of 100,000 characters');

// File size validation schema
export const FileSizeSchema = z
  .number()
  .int()
  .min(0)
  .max(10 * 1024 * 1024, 'File size exceeds limit of 10MB'); // 10MB limit

// Git repository validation schema
export const GitRepositorySchema = z
  .string()
  .min(1, 'Repository path is required')
  .refine(async (path) => {
    try {
      const { access } = await import('fs/promises');
      const { join } = await import('path');
      await access(join(path, '.git'), 0); // Check if .git directory exists
      return true;
    } catch {
      return false;
    }
  }, 'Not a valid git repository');

// Validation result type
export type ValidationResult<T = unknown> = {
  isValid: boolean;
  error?: string;
  sanitizedValue?: T;
};

// Type-safe configuration validation
export type ValidatedCommitConfig = z.infer<typeof CommitConfigSchema>;
export type ValidatedGitDiff = z.infer<typeof GitDiffSchema>;
export type ValidatedCommitSuggestion = z.infer<typeof CommitSuggestionSchema>;

// Type exports for use throughout the application
export type {
  CommitConfig,
  GitDiff,
  CommitSuggestion,
  GitStatus,
  CommitOptions,
} from '../types/common.js';
