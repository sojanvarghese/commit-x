import { lightColors } from "./colors.js";
import { match } from "ts-pattern";
import { sanitizeError } from "./security.js";
import {
  ERROR_LOG_LIMIT,
  RECENT_ERROR_THRESHOLD_MS,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  ERROR_PATTERNS,
} from "../constants/error-handler.js";
import { ErrorType, type ErrorContext } from "../types/error-handler.js";

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
    return match(this.type)
      .with(
        ErrorType.VALIDATION_ERROR,
        () => "Invalid input provided. Please check your input and try again."
      )
      .with(
        ErrorType.SECURITY_ERROR,
        () =>
          "Security validation failed. Please check your input for suspicious content."
      )
      .with(
        ErrorType.NETWORK_ERROR,
        () =>
          "Network connection failed. Please check your internet connection and try again."
      )
      .with(
        ErrorType.FILE_SYSTEM_ERROR,
        () =>
          "File operation failed. Please check file permissions and try again."
      )
      .with(
        ErrorType.GIT_ERROR,
        () =>
          "Git operation failed. Please ensure you are in a valid git repository."
      )
      .with(
        ErrorType.AI_SERVICE_ERROR,
        () => "AI service failed. Please check your API key and try again."
      )
      .with(
        ErrorType.CONFIG_ERROR,
        () =>
          "Configuration error. Please run setup again or check your configuration."
      )
      .with(
        ErrorType.TIMEOUT_ERROR,
        () =>
          "Operation timed out. Please try again with a smaller file or check your connection."
      )
      .otherwise(() => "An unexpected error occurred. Please try again.");
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: Array<{ error: SecureError; timestamp: Date }> = [];

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

    // Use pattern matching for error type detection
    const errorType = match((error as { code?: string })?.code)
      .with(
        "ENOENT",
        "EACCES",
        "EPERM",
        "ENOTDIR",
        "EISDIR",
        () => ErrorType.FILE_SYSTEM_ERROR
      )
      .with(
        "ECONNREFUSED",
        "ENOTFOUND",
        "ETIMEDOUT",
        () => ErrorType.NETWORK_ERROR
      )
      .otherwise(() => this.detectErrorTypeFromMessage(message));

    const isRecoverable = match(errorType)
      .with(
        ErrorType.FILE_SYSTEM_ERROR,
        ErrorType.NETWORK_ERROR,
        ErrorType.TIMEOUT_ERROR,
        ErrorType.VALIDATION_ERROR,
        ErrorType.GIT_ERROR,
        ErrorType.AI_SERVICE_ERROR,
        ErrorType.CONFIG_ERROR,
        () => true
      )
      .with(ErrorType.SECURITY_ERROR, ErrorType.UNKNOWN_ERROR, () => false)
      .exhaustive();

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
      this.errorLog = this.errorLog.slice(-ERROR_LOG_LIMIT);
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
    return match(type)
      .with(ErrorType.SECURITY_ERROR, () => lightColors.red)
      .with(
        ErrorType.VALIDATION_ERROR,
        ErrorType.CONFIG_ERROR,
        () => lightColors.yellow
      )
      .with(
        ErrorType.NETWORK_ERROR,
        ErrorType.TIMEOUT_ERROR,
        ErrorType.AI_SERVICE_ERROR,
        () => lightColors.blue
      )
      .with(ErrorType.FILE_SYSTEM_ERROR, () => lightColors.cyan)
      .with(ErrorType.GIT_ERROR, () => lightColors.green)
      .otherwise(() => lightColors.red);
  };

  public getErrorStats = (): {
    total: number;
    byType: Record<string, number>;
    recent: number;
  } => {
    const byType: Record<string, number> = {};
    const recent = this.errorLog.filter(
      entry =>
        Date.now() - entry.timestamp.getTime() < RECENT_ERROR_THRESHOLD_MS // Last 24 hours
    ).length;

    this.errorLog.forEach(entry => {
      byType[entry.error.type] = (byType[entry.error.type] || 0) + 1;
    });

    return {
      total: this.errorLog.length,
      byType,
      recent,
    };
  };

  public handleProcessExit = (code: number = 1): void => {
    if (this.errorLog.length > 0) {
      console.error(
        lightColors.gray(
          `\n📊 Error Summary: ${this.errorLog.length} errors logged`
        )
      );
    }
    process.exit(code);
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

        if (!secureError.isRecoverable) {
          errorHandler.handleProcessExit(1);
        }

        throw secureError;
      });
    }

    return result;
  } catch (error) {
    const secureError = errorHandler.handleError(error, context);

    if (!secureError.isRecoverable) {
      errorHandler.handleProcessExit(1);
    }

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
      lastError = errorHandler.handleError(error, {
        ...context,
        attempt,
        maxRetries,
      });

      if (!lastError.isRecoverable || attempt === maxRetries) {
        break;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
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
