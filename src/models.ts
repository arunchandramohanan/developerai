/**
 * Core domain models & enums, ported from com.bmo.devai.intellij.models.core.
 */

export enum OperationType {
  GENERATE_TESTS = "GENERATE_TESTS",
  GENERATE_DOCUMENTATION = "GENERATE_DOCUMENTATION",
  GENERATE_README = "GENERATE_README",
  CODE_REVIEW = "CODE_REVIEW",
  API_DRIFT = "API_DRIFT",
  APPLY_FIX = "APPLY_FIX",
  GENERATE_UML_DIAGRAM = "GENERATE_UML_DIAGRAM",
  TEST_SCENARIOS = "TEST_SCENARIOS",
  GENERATE_SHAKEDOWN_TESTS = "GENERATE_SHAKEDOWN_TESTS",
  BUSINESS_SUMMARY = "BUSINESS_SUMMARY",
  PLATFORM_UPGRADE = "PLATFORM_UPGRADE",
  GENERATE_FEATURE_CODE = "GENERATE_FEATURE_CODE",
  GENERATE_USER_STORIES = "GENERATE_USER_STORIES",
  UPDATE_DOCUMENTATION = "UPDATE_DOCUMENTATION",
  GENERATE_STORY = "GENERATE_STORY",
  FEATURE_UPDATE = "FEATURE_UPDATE",
  GENERATE_SCAFFOLD = "GENERATE_SCAFFOLD",
  DEPENDENCY_ANALYSIS = "DEPENDENCY_ANALYSIS",
  DEPENDENCY_MIGRATION = "DEPENDENCY_MIGRATION",
  FIX_SAST_FINDINGS = "FIX_SAST_FINDINGS",
  CHAT = "CHAT",
}

const OPERATION_META: Record<OperationType, { displayName: string; shortName: string; ragEligible: boolean }> = {
  [OperationType.GENERATE_TESTS]: { displayName: "Generate Tests", shortName: "test", ragEligible: true },
  [OperationType.GENERATE_DOCUMENTATION]: { displayName: "Generate Documentation", shortName: "doc", ragEligible: true },
  [OperationType.GENERATE_README]: { displayName: "Generate README", shortName: "readme", ragEligible: true },
  [OperationType.CODE_REVIEW]: { displayName: "Code Review", shortName: "review", ragEligible: true },
  [OperationType.API_DRIFT]: { displayName: "API Drift Detection", shortName: "api-drift", ragEligible: true },
  [OperationType.APPLY_FIX]: { displayName: "Apply Fix", shortName: "fix", ragEligible: true },
  [OperationType.GENERATE_UML_DIAGRAM]: { displayName: "Generate UML Diagram", shortName: "uml", ragEligible: true },
  [OperationType.TEST_SCENARIOS]: { displayName: "Test Scenarios and Cases", shortName: "test-scenarios", ragEligible: true },
  [OperationType.GENERATE_SHAKEDOWN_TESTS]: { displayName: "Generate Shakedown Test Suite", shortName: "shakedown-tests", ragEligible: true },
  [OperationType.BUSINESS_SUMMARY]: { displayName: "Business Logic Summary", shortName: "summary", ragEligible: true },
  [OperationType.PLATFORM_UPGRADE]: { displayName: "Platform Upgrade", shortName: "platform-upgrade", ragEligible: true },
  [OperationType.GENERATE_FEATURE_CODE]: { displayName: "Generate Feature Code", shortName: "feature-code", ragEligible: true },
  [OperationType.GENERATE_USER_STORIES]: { displayName: "Generate User Stories", shortName: "user-stories", ragEligible: true },
  [OperationType.UPDATE_DOCUMENTATION]: { displayName: "Update Documentation", shortName: "doc-update", ragEligible: true },
  [OperationType.GENERATE_STORY]: { displayName: "User Story Generation", shortName: "story", ragEligible: true },
  [OperationType.FEATURE_UPDATE]: { displayName: "Feature Update", shortName: "feature-update", ragEligible: true },
  [OperationType.GENERATE_SCAFFOLD]: { displayName: "Feature Scaffold", shortName: "scaffold", ragEligible: true },
  [OperationType.DEPENDENCY_ANALYSIS]: { displayName: "Dependency Analysis", shortName: "dep-analysis", ragEligible: true },
  [OperationType.DEPENDENCY_MIGRATION]: { displayName: "Dependency Migration", shortName: "dep-migration", ragEligible: true },
  [OperationType.FIX_SAST_FINDINGS]: { displayName: "Fix SAST Findings", shortName: "sast-fix", ragEligible: true },
  [OperationType.CHAT]: { displayName: "Chat", shortName: "chat", ragEligible: false },
};

export function operationDisplayName(op: OperationType): string { return OPERATION_META[op].displayName; }
export function operationShortName(op: OperationType): string { return OPERATION_META[op].shortName; }
export function operationRagEligible(op: OperationType): boolean { return OPERATION_META[op].ragEligible; }

export enum ExecutionMode {
  SDK = "SDK",
  CHAT = "CHAT",
}
export function executionModeDisplayName(m: ExecutionMode): string {
  return m === ExecutionMode.SDK ? "SDK Mode" : "Chat Mode";
}

export enum ModePreference {
  SDK_ONLY = "SDK_ONLY",
  CHAT_ONLY = "CHAT_ONLY",
  AUTO = "AUTO",
}
export function modePreferenceDefault(): ModePreference { return ModePreference.CHAT_ONLY; }

export enum ResponseStatus {
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  TIMEOUT = "TIMEOUT",
}

export enum RequestStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export enum ElementType {
  CLASS = "CLASS",
  METHOD = "METHOD",
  FIELD = "FIELD",
  FILE = "FILE",
  BLOCK = "BLOCK",
  UNKNOWN = "UNKNOWN",
}

export interface CodeSelection {
  text: string;
  filePath: string;
  languageName: string;
  startOffset: number;
  endOffset: number;
  elementType: ElementType;
}

export function lineCount(sel: CodeSelection): number {
  if (!sel.text) return 0;
  return sel.text.split(/\r\n|\r|\n/).length;
}

export interface AIRequest {
  id: string;
  operationType: OperationType;
  codeSelection?: CodeSelection | null;
  prompt: string;
  context: Record<string, string>;
  timestamp: number;
}

export function newRequest(
  operationType: OperationType,
  codeSelection: CodeSelection | null,
  prompt: string,
  context: Record<string, string> = {}
): AIRequest {
  return {
    id: cryptoRandomId(),
    operationType,
    codeSelection,
    prompt,
    context,
    timestamp: Date.now(),
  };
}

export interface AIResponse {
  requestId: string;
  status: ResponseStatus;
  content: string;
  errorMessage?: string | null;
  durationMs: number;
  timestamp: number;
  executionMode?: ExecutionMode | null;
}

export function successResponse(requestId: string, content: string, durationMs: number, mode: ExecutionMode): AIResponse {
  return { requestId, status: ResponseStatus.SUCCESS, content, durationMs, timestamp: Date.now(), executionMode: mode };
}
export function errorResponse(requestId: string, errorMessage: string, durationMs: number): AIResponse {
  return { requestId, status: ResponseStatus.ERROR, content: "", errorMessage, durationMs, timestamp: Date.now(), executionMode: null };
}
export function isSuccess(r: AIResponse): boolean { return r.status === ResponseStatus.SUCCESS; }

export interface ModeStatus {
  mode: ExecutionMode;
  available: boolean;
  lastChecked: number;
  errorMessage?: string | null;
  version?: string | null;
}
export function modeAvailable(mode: ExecutionMode, version?: string | null): ModeStatus {
  return { mode, available: true, lastChecked: Date.now(), errorMessage: null, version: version ?? null };
}
export function modeUnavailable(mode: ExecutionMode, errorMessage: string): ModeStatus {
  return { mode, available: false, lastChecked: Date.now(), errorMessage, version: null };
}

export interface ExecutionContext {
  activeMode: ExecutionMode;
  preference: ModePreference;
  sdkStatus?: ModeStatus | null;
  chatStatus?: ModeStatus | null;
  fallbackOccurred: boolean;
  fallbackReason?: string | null;
}

export function cryptoRandomId(): string {
  // RFC4122-ish v4 without importing crypto types
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
