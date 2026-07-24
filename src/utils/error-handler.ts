import { lightColors } from "./colors.js";
import { sanitizeError } from "./security.js";
import {
  ERROR_LOG_LIMIT,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  ERROR_PATTERNS,
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
        return "Configuration error. Please run setup again or check your configuration.";
      case ErrorType.TIMEOUT_ERROR:
        return "Operation timed out. Please try again with a smaller file or check your connection.";
      case ErrorType.UNKNOWN_ERROR:
        return "An unexpected error occurred. Please try again.";
      default:
        return assertNever(this.type);
    }
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private readonly errorLog: Array<{ error: SecureError; timestamp: Date }> =
    [];

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  public handleError = (
    error: unknown,
    context: ErrorContext = {}
  ): SecureError => {
    let secureError: SecureError;

    if (error instanceof SecureError) {
      secureError = error;
    } else {
      secureError = this.createSecureError(error, context);
    }

    this.logError(secureError);
    this.displayError(secureError);

    return secureError;
  };

  private readonly createSecureError = (
    error: unknown,
    context: ErrorContext
  ): SecureError => {
    const message = (error as Error)?.message ?? "Unknown error occurred";
    const sanitizedMessage = sanitizeError(message);

    const errorDetails = error as {
      code?: string | number;
      status?: number;
      statusCode?: number;
    };
    const errorCode = errorDetails.code;
    const httpStatus =
      errorDetails.status ??
      errorDetails.statusCode ??
      (typeof errorCode === "number" ? errorCode : undefined);
    let errorType: ErrorType;
    switch (httpStatus) {
      case 400:
        errorType = ErrorType.VALIDATION_ERROR;
        break;
      case 401:
      case 403:
        errorType = ErrorType.CONFIG_ERROR;
        break;
      case 408:
        errorType = ErrorType.TIMEOUT_ERROR;
        break;
      case 429:
      case 500:
      case 502:
      case 503:
      case 504:
        errorType = ErrorType.NETWORK_ERROR;
        break;
      default:
        errorType = ErrorType.UNKNOWN_ERROR;
    }

    if (errorType === ErrorType.UNKNOWN_ERROR) {
      switch (errorCode) {
        case "ENOENT":
        case "EACCES":
        case "EPERM":
        case "ENOTDIR":
        case "EISDIR":
          errorType = ErrorType.FILE_SYSTEM_ERROR;
          break;
        case "ECONNREFUSED":
        case "ENOTFOUND":
        case "ETIMEDOUT":
          errorType = ErrorType.NETWORK_ERROR;
          break;
        default:
          errorType = this.detectErrorTypeFromMessage(message);
          break;
      }
    }

    const isRecoverable = this.isRecoverableError(errorType);

    return new SecureError(sanitizedMessage, errorType, context, isRecoverable);
  };

  private readonly detectErrorTypeFromMessage = (
    message: string
  ): ErrorType => {
    const lowerMsg = message.toLowerCase();

    for (const { type, patterns } of ERROR_PATTERNS) {
      if (patterns.some(pattern => lowerMsg.includes(pattern))) {
        return type;
      }
    }

    return ErrorType.UNKNOWN_ERROR;
  };

  private readonly logError = (error: SecureError): void => {
    this.errorLog.push({ error, timestamp: new Date() });

    if (this.errorLog.length > ERROR_LOG_LIMIT) {
      this.errorLog.shift();
    }

    // Development mode removed - error details logging disabled
  };

  private readonly displayError = (error: SecureError): void => {
    const color = this.getErrorColor(error.type);
    console.error(color(`❌ ${error.userMessage}`));

    if (error.context.operation) {
      console.error(
        lightColors.gray(`   Operation: ${error.context.operation}`)
      );
    }

    if (error.context.file) {
      console.error(lightColors.gray(`   File: ${error.context.file}`));
    }

    if (error.isRecoverable) {
      console.error(
        lightColors.yellow(
          "   💡 This error might be recoverable. Please try again."
        )
      );
    }
  };

  private readonly getErrorColor = (
    type: ErrorType
  ): ((text: string) => string) => {
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

  private readonly isRecoverableError = (type: ErrorType): boolean => {
    switch (type) {
      case ErrorType.FILE_SYSTEM_ERROR:
      case ErrorType.NETWORK_ERROR:
      case ErrorType.TIMEOUT_ERROR:
      case ErrorType.VALIDATION_ERROR:
      case ErrorType.GIT_ERROR:
      case ErrorType.AI_SERVICE_ERROR:
      case ErrorType.CONFIG_ERROR:
        return true;
      case ErrorType.SECURITY_ERROR:
      case ErrorType.UNKNOWN_ERROR:
        return false;
      default:
        return assertNever(type);
    }
  };
}

export const withErrorHandling = <T>(
  operation: () => T | Promise<T>,
  context: ErrorContext = {}
): T | Promise<T> => {
  const errorHandler = ErrorHandler.getInstance();

  try {
    const result = operation();

    if (result instanceof Promise) {
      return result.catch(error => {
        const secureError = errorHandler.handleError(error, context);

        throw secureError;
      });
    }

    return result;
  } catch (error) {
    const secureError = errorHandler.handleError(error, context);

    throw secureError;
  }
};

export const withRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = DEFAULT_RETRY_ATTEMPTS,
  baseDelay: number = DEFAULT_RETRY_DELAY_MS,
  context: ErrorContext = {}
): Promise<T> => {
  const errorHandler = ErrorHandler.getInstance();
  let lastError: SecureError | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError =
        error instanceof SecureError
          ? error
          : errorHandler.handleError(error, {
              ...context,
              attempt,
              maxRetries,
            });

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
