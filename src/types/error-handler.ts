export enum ErrorType {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  SECURITY_ERROR = "SECURITY_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  FILE_SYSTEM_ERROR = "FILE_SYSTEM_ERROR",
  GIT_ERROR = "GIT_ERROR",
  AI_SERVICE_ERROR = "AI_SERVICE_ERROR",
  CONFIG_ERROR = "CONFIG_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export interface ErrorContext {
  operation?: string;
  file?: string;
  userId?: string;
  timestamp?: Date;
  key?: string;
  attempt?: number;
  maxRetries?: number;
  additionalInfo?: Record<string, any>;
}
