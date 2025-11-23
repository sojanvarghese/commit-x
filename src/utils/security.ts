import * as path from "path";
import * as fs from "fs";
import { promisify } from "util";
import type { ValidationResult } from "../types/security.js";
import {
  ALLOWED_CONFIG_KEYS,
  ALLOWED_MODELS,
  DEFAULT_LIMITS,
  SUSPICIOUS_COMMIT_PATTERNS,
  SUSPICIOUS_PATTERNS,
} from "../constants/security.js";

const stat = promisify(fs.stat);
const access = promisify(fs.access);

export const validateAndSanitizePath = (
  filePath: string,
  baseDir: string
): ValidationResult => {
  try {
    const normalizedPath = path.normalize(filePath);
    const resolvedPath = path.resolve(baseDir, normalizedPath);
    const baseResolved = path.resolve(baseDir);

    // Check for path traversal attacks
    if (!resolvedPath.startsWith(baseResolved)) {
      return {
        isValid: false,
        error:
          "Path traversal detected: file path is outside allowed directory",
      };
    }

    // Check for suspicious patterns more efficiently
    const suspiciousPattern = SUSPICIOUS_PATTERNS.find(pattern =>
      pattern.test(normalizedPath)
    );
    if (suspiciousPattern) {
      return {
        isValid: false,
        error: `Suspicious path pattern detected: ${suspiciousPattern.source}`,
      };
    }

    return {
      isValid: true,
      sanitizedValue: resolvedPath,
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Path validation error: ${error}`,
    };
  }
};

export const validateFileSize = async (
  filePath: string,
  maxSize: number = DEFAULT_LIMITS.maxFileSize
): Promise<ValidationResult> => {
  try {
    const stats = await stat(filePath);

    if (stats.size > maxSize) {
      return {
        isValid: false,
        error: `File size ${stats.size} bytes exceeds limit of ${maxSize} bytes`,
      };
    }

    return {
      isValid: true,
      sanitizedValue: filePath,
    };
  } catch (error) {
    return {
      isValid: false,
      error: `File size validation error: ${error}`,
    };
  }
};

export const validateConfigKey = (key: string): ValidationResult => {
  if (!key || typeof key !== "string") {
    return {
      isValid: false,
      error: "Configuration key must be a non-empty string",
    };
  }

  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    return {
      isValid: false,
      error: `Invalid configuration key: ${key}. Allowed keys: ${ALLOWED_CONFIG_KEYS.join(", ")}`,
    };
  }

  return {
    isValid: true,
    sanitizedValue: key,
  };
};

export const validateConfigValue = (
  key: string,
  value: any
): ValidationResult => {
  switch (key) {
    case "apiKey":
      if (typeof value !== "string" || value.length < 10) {
        return {
          isValid: false,
          error: "API key must be a string with at least 10 characters",
        };
      }
      return {
        isValid: true,
        sanitizedValue: value.trim(),
      };

    case "model":
      if (!ALLOWED_MODELS.includes(value)) {
        return {
          isValid: false,
          error: `Invalid model: ${value}. Allowed models: ${ALLOWED_MODELS.join(", ")}`,
        };
      }
      return { isValid: true, sanitizedValue: value };

    default:
      return {
        isValid: false,
        error: `Unknown configuration key: ${key}`,
      };
  }
};

export const validateCommitMessage = (message: string): ValidationResult => {
  if (!message || typeof message !== "string") {
    return {
      isValid: false,
      error: "Commit message must be a non-empty string",
    };
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: "Commit message cannot be empty",
    };
  }

  if (trimmed.length > 200) {
    return {
      isValid: false,
      error: "Commit message must be 200 characters or less",
    };
  }

  for (const pattern of SUSPICIOUS_COMMIT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isValid: false,
        error: "Commit message contains potentially malicious content",
      };
    }
  }

  return {
    isValid: true,
    sanitizedValue: trimmed,
  };
};

export const validateDiffSize = (
  diff: string,
  maxSize: number = DEFAULT_LIMITS.maxDiffSize
): ValidationResult => {
  if (typeof diff !== "string") {
    return {
      isValid: false,
      error: "Diff content must be a string",
    };
  }

  if (diff.length > maxSize) {
    return {
      isValid: false,
      error: `Diff content size ${diff.length} characters exceeds limit of ${maxSize} characters`,
    };
  }

  return {
    isValid: true,
    sanitizedValue: diff,
  };
};

export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_LIMITS.timeoutMs
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
};

export const safeReadFile = async (
  filePath: string,
  baseDir: string,
  maxSize: number = DEFAULT_LIMITS.maxFileSize
): Promise<{ content: string; error?: string }> => {
  try {
    const pathValidation = validateAndSanitizePath(filePath, baseDir);
    if (!pathValidation.isValid) {
      return { content: "", error: pathValidation.error };
    }

    const sizeValidation = await validateFileSize(
      pathValidation.sanitizedValue!,
      maxSize
    );
    if (!sizeValidation.isValid) {
      return { content: "", error: sizeValidation.error };
    }

    const content = await withTimeout(
      promisify(fs.readFile)(pathValidation.sanitizedValue!, "utf-8"),
      DEFAULT_LIMITS.timeoutMs
    );

    return { content };
  } catch (error) {
    return {
      content: "",
      error: `Failed to read file: ${error}`,
    };
  }
};

export const validateApiKey = (apiKey: string): ValidationResult => {
  if (!apiKey || typeof apiKey !== "string") {
    return {
      isValid: false,
      error: "API key must be a non-empty string",
    };
  }

  const trimmed = apiKey.trim();

  if (trimmed.length < 10) {
    return {
      isValid: false,
      error: "API key must be at least 10 characters long",
    };
  }

  if (trimmed.length > 200) {
    return {
      isValid: false,
      error: "API key must be 200 characters or less",
    };
  }

  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return {
      isValid: false,
      error: "API key contains invalid characters",
    };
  }

  return {
    isValid: true,
    sanitizedValue: trimmed,
  };
};

export const sanitizeError = (error: any): string => {
  if (typeof error === "string") {
    return error
      .replace(/api[_-]?key[=:]\s*[^\s]+/gi, "api_key=***")
      .replace(/token[=:]\s*[^\s]+/gi, "token=***")
      .replace(/password[=:]\s*[^\s]+/gi, "password=***")
      .replace(/secret[=:]\s*[^\s]+/gi, "secret=***");
  }

  if (error instanceof Error) {
    return sanitizeError(error.message);
  }

  return "An unknown error occurred";
};

export const validateGitRepository = async (
  dir: string
): Promise<ValidationResult> => {
  try {
    // Resolve the directory path to handle symlinks and relative paths
    let currentDir = path.resolve(dir);
    const rootDir = path.parse(currentDir).root;

    // Traverse up the directory tree to find the .git directory
    while (currentDir !== rootDir) {
      const gitDir = path.join(currentDir, ".git");

      try {
        // Check if .git directory exists and is readable
        await access(gitDir, fs.constants.R_OK);

        // Check if HEAD file exists and is readable
        const headFile = path.join(gitDir, "HEAD");
        await access(headFile, fs.constants.R_OK);

        // Additional check: verify it's actually a git repository by checking if HEAD contains a ref
        const headContent = await fs.promises.readFile(headFile, "utf8");
        if (!headContent.trim()) {
          return {
            isValid: false,
            error: "Invalid git repository: HEAD file is empty",
          };
        }

        return {
          isValid: true,
          sanitizedValue: currentDir, // Return the actual git repository root
        };
      } catch {
        // .git directory not found in current directory, try parent
        currentDir = path.dirname(currentDir);
      }
    }

    // No .git directory found in any parent directory
    return {
      isValid: false,
      error:
        "Not a valid git repository: No .git directory found in current or parent directories",
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Not a valid git repository: ${error}`,
    };
  }
};
