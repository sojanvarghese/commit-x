import * as path from "node:path";
import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { ValidationResult } from "../types/security.js";
import * as v from "valibot";
import { CommitMessageSchema } from "../schemas/validation.js";
import { DEFAULT_LIMITS, SUSPICIOUS_PATTERNS } from "../constants/security.js";

export const validateAndSanitizePath = (
  filePath: string,
  baseDir: string
): ValidationResult => {
  try {
    if (!filePath.trim()) {
      return { isValid: false, error: "File path cannot be empty" };
    }

    const normalizedPath = path.normalize(filePath);
    const resolvedPath = path.resolve(baseDir, normalizedPath);
    const baseResolved = path.resolve(baseDir);

    const relativePath = path.relative(baseResolved, resolvedPath);

    // Prefix checks confuse sibling paths such as /repo and /repo-secret.
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
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

export const validateCommitMessage = (message: string): ValidationResult => {
  const result = v.safeParse(CommitMessageSchema, message);
  return result.success
    ? { isValid: true, sanitizedValue: result.output }
    : {
        isValid: false,
        error: result.issues.map(issue => issue.message).join(", "),
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
  operation: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number = DEFAULT_LIMITS.timeoutMs
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise =
    typeof operation === "function" ? operation(controller.signal) : operation;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Operation timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

export const sanitizeError = (error: unknown): string => {
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
    let currentDir = path.resolve(dir);
    const rootDir = path.parse(currentDir).root;

    while (true) {
      const gitDir = path.join(currentDir, ".git");

      try {
        await access(gitDir, fsConstants.R_OK);
        const gitStats = await stat(gitDir);
        let actualGitDir = gitDir;

        if (gitStats.isFile()) {
          const pointer = (await readFile(gitDir, "utf8")).trim();
          const match = /^gitdir:\s*(.+)$/i.exec(pointer);
          if (!match?.[1]) throw new Error("Invalid .git file");
          actualGitDir = path.resolve(currentDir, match[1]);
        }

        const headFile = path.join(actualGitDir, "HEAD");
        await access(headFile, fsConstants.R_OK);
        const headContent = await readFile(headFile, "utf8");
        if (!headContent.trim()) {
          return {
            isValid: false,
            error: "Invalid git repository: HEAD file is empty",
          };
        }

        return {
          isValid: true,
          sanitizedValue: currentDir,
        };
      } catch {
        if (currentDir === rootDir) break;
      }

      currentDir = path.dirname(currentDir);
    }

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
