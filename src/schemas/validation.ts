import * as v from "valibot";
import { SUSPICIOUS_COMMIT_PATTERNS } from "../constants/security.js";

export const ApiKeySchema = v.pipe(
  v.string(),
  v.minLength(10, "API key must be at least 10 characters long"),
  v.maxLength(200, "API key must be 200 characters or less"),
  v.regex(/^[A-Za-z0-9_-]+$/, "API key contains invalid characters"),
  v.transform(val => val.trim())
);

export const CommitConfigSchema = v.object({
  apiKey: v.optional(ApiKeySchema),
});

export const GitDiffSchema = v.object({
  file: v.pipe(v.string(), v.minLength(1, "File path is required")),
  additions: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(0, "Additions must be non-negative")
  ),
  deletions: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(0, "Deletions must be non-negative")
  ),
  changes: v.string(),
  isNew: v.optional(v.boolean(), false),
  isDeleted: v.optional(v.boolean(), false),
  isRenamed: v.optional(v.boolean(), false),
  oldPath: v.optional(v.string()),
});

export const CommitMessageSchema = v.pipe(
  v.string(),
  v.minLength(1, "Commit message must be a non-empty string"),
  v.maxLength(200, "Commit message must be 200 characters or less"),
  v.check(msg => msg.trim().length > 0, "Commit message cannot be empty"),
  v.check(
    message =>
      !SUSPICIOUS_COMMIT_PATTERNS.some(pattern => pattern.test(message)),
    "Commit message contains potentially malicious content"
  ),
  v.transform(val => val.trim())
);

export const CommitGroupSchema = v.object({
  files: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1))),
    v.minLength(1, "A commit group must contain at least one file")
  ),
  message: CommitMessageSchema,
  description: v.optional(v.pipe(v.string(), v.maxLength(500))),
  confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
});

// Validation result type
export type ValidationResult<T = unknown> = {
  isValid: boolean;
  error?: string;
  sanitizedValue?: T;
};
