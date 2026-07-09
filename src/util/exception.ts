/** Port of com.bmo.devai.intellij.util.DevAIException. */
export enum ErrorCode {
  AUTH_REQUIRED = "Authentication required",
  AUTH_FAILED = "Authentication failed",
  SDK_UNAVAILABLE = "SDK mode is not available",
  CHAT_UNAVAILABLE = "Chat mode is not available",
  NO_MODE_AVAILABLE = "No execution mode available",
  REQUEST_IN_PROGRESS = "Request already in progress",
  REQUEST_TIMEOUT = "Request timed out",
  REQUEST_CANCELLED = "Request was cancelled",
  REQUEST_FAILED = "Request failed",
  NO_SELECTION = "No code selected",
  INVALID_SELECTION = "Invalid code selection",
  UNSUPPORTED_LANGUAGE = "Language not supported",
  UNSUPPORTED_ELEMENT = "Element type not supported",
  NO_FIX_AVAILABLE = "No fix available for this issue",
  GENERATION_FAILED = "Code generation failed",
  PARSING_FAILED = "Failed to parse response",
  INVALID_RESPONSE = "Invalid response from service",
  FILE_NOT_FOUND = "File not found",
  FILE_WRITE_FAILED = "Failed to write file",
  GIT_ERROR = "Git operation failed",
  INTERNAL_ERROR = "Internal error",
  CONFIGURATION_ERROR = "Configuration error",
}

export class DevAIException extends Error {
  readonly errorCode: ErrorCode;
  constructor(message: string, errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR) {
    super(message);
    this.name = "DevAIException";
    this.errorCode = errorCode;
  }
}
