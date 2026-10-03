import { lightColors } from "./colors.js";
import { sanitizeError } from "./security.js";
import {
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
} from "../constants/error-handler.js";
import { ErrorType, type ErrorContext } from "../types/error-handler.js";

const assertNever = (value: never): never => {
  throw new Error(`Unhandled error type: ${String(value)}`);
};

export class SecureError extends Error {
  public readonly type: ErrorType;
  public readonly context: ErrorContext;
  public readonly isRecoverable: boolean;
  public readonly userMessage: string;

  constructor(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    context: ErrorContext = {},
    isRecoverable: boolean = false,
    userMessage?: string
  ) {
    super(sanitizeError(message));
    this.name = "SecureError";
    this.type = type;
    this.context = { ...context, timestamp: new Date() };
    this.isRecoverable = isRecoverable;
    this.userMessage = userMessage ?? this.getDefaultUserMessage();
  }

  private getDefaultUserMessage(): string {
    switch (this.type) {
      case ErrorType.VALIDATION_ERROR:
        return "Invalid input provided. Please check your input and try again.";
      case ErrorType.SECURITY_ERROR:
        return "Security validation failed. Please check your input for suspicious content.";
      case ErrorType.NETWORK_ERROR:
        return "Network connection failed. Please check your internet connection and try again.";
      case ErrorType.FILE_SYSTEM_ERROR:
        return "File operation failed. Please check file permissions and try again.";
      case ErrorType.GIT_ERROR:
        return "Git operation failed. Please ensure you are in a valid git repository.";
      case ErrorType.AI_SERVICE_ERROR:
        return "AI service failed. Please check your API key and try again.";
      case ErrorType.CONFIG_ERROR:
        return "Configuration error. Please check your environment and try again.";
      case ErrorType.TIMEOUT_ERROR:
        return "Operation timed out. Please try again with a smaller file or check your connection.";
      case ErrorType.UNKNOWN_ERROR:
        return "An unexpected error occurred. Please try again.";
      default:
        return assertNever(this.type);
    }
  }
}

const typeFromHttpStatus = (status: unknown): ErrorType | undefined => {
  switch (status) {
    case 400:
      return ErrorType.VALIDATION_ERROR;
    case 401:
    case 403:
      return ErrorType.CONFIG_ERROR;
    case 408:
      return ErrorType.TIMEOUT_ERROR;
    case 429:
    case 500:
    case 502:
    case 503:
    case 504:
      return ErrorType.NETWORK_ERROR;
    default:
      return undefined;
  }
};

const typeFromErrorCode = (code: unknown): ErrorType | undefined => {
  switch (code) {
    case "ENOENT":
    case "EACCES":
    case "EPERM":
    case "ENOTDIR":
    case "EISDIR":
      return ErrorType.FILE_SYSTEM_ERROR;
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "ETIMEDOUT":
      return ErrorType.NETWORK_ERROR;
    default:
      return undefined;
  }
};

const isRecoverableType = (type: ErrorType): boolean =>
  type !== ErrorType.SECURITY_ERROR && type !== ErrorType.UNKNOWN_ERROR;

// Classifies a foreign error from what it carries (HTTP status, errno code,
// error name). Anything unrecognised takes `fallbackType`, which the caller
// sets from where the failure happened.
export const toSecureError = (
  error: unknown,
  context: ErrorContext = {},
  fallbackType: ErrorType = ErrorType.UNKNOWN_ERROR
): SecureError => {
  if (error instanceof SecureError) return error;

  const details = (error ?? {}) as {
    message?: unknown;
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const type =
    typeFromHttpStatus(details.status ?? details.statusCode ?? details.code) ??
    typeFromErrorCode(details.code) ??
    (details.name === "TimeoutError" ? ErrorType.TIMEOUT_ERROR : fallbackType);
  const message =
    typeof details.message === "string"
      ? details.message
      : "Unknown error occurred";

  return new SecureError(message, type, context, isRecoverableType(type));
};

const getErrorColor = (type: ErrorType): ((text: string) => string) => {
  switch (type) {
    case ErrorType.SECURITY_ERROR:
    case ErrorType.UNKNOWN_ERROR:
      return lightColors.red;
    case ErrorType.VALIDATION_ERROR:
    case ErrorType.CONFIG_ERROR:
      return lightColors.yellow;
    case ErrorType.NETWORK_ERROR:
    case ErrorType.TIMEOUT_ERROR:
    case ErrorType.AI_SERVICE_ERROR:
      return lightColors.blue;
    case ErrorType.FILE_SYSTEM_ERROR:
      return lightColors.cyan;
    case ErrorType.GIT_ERROR:
      return lightColors.green;
    default:
      return assertNever(type);
  }
};

// The single place a failure is shown to the user. Everything below the CLI
// only classifies and rethrows.
export const reportError = (
  error: unknown,
  context: ErrorContext = {}
): void => {
  const secureError = toSecureError(error, context);
  const { operation, file } = secureError.context;

  const lines = [
    getErrorColor(secureError.type)(`❌ ${secureError.message}`),
    lightColors.gray(`   ${secureError.userMessage}`),
  ];
  if (operation) lines.push(lightColors.gray(`   Operation: ${operation}`));
  if (file) lines.push(lightColors.gray(`   File: ${file}`));
  if (secureError.isRecoverable) {
    lines.push(
      lightColors.yellow(
        "   💡 This error might be recoverable. Please try again."
      )
    );
  }

  console.error(lines.join("\n"));
  process.exitCode = 1;
};

export const withErrorHandling = async <T>(
  operation: () => T | Promise<T>,
  context: ErrorContext = {},
  fallbackType?: ErrorType
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw toSecureError(error, context, fallbackType);
  }
};

export const withRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = DEFAULT_RETRY_ATTEMPTS,
  baseDelay: number = DEFAULT_RETRY_DELAY_MS,
  context: ErrorContext = {}
): Promise<T> => {
  let lastError: SecureError | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = toSecureError(error, { ...context, attempt, maxRetries });

      const retryableType =
        lastError.type === ErrorType.NETWORK_ERROR ||
        lastError.type === ErrorType.TIMEOUT_ERROR ||
        lastError.type === ErrorType.AI_SERVICE_ERROR;

      if (
        !lastError.isRecoverable ||
        !retryableType ||
        attempt === maxRetries
      ) {
        break;
      }

      const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.floor(
        Math.random() * Math.min(250, Math.max(1, baseDelay))
      );
      const delay = exponentialDelay + jitter;
      console.log(
        lightColors.yellow(
          `⏳ Retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`
        )
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Retry failed with unknown error");
};
