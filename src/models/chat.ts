/**
 * Chat Mode domain models, ported from
 * com.bmo.devai.intellij.chatmode.models.*
 *
 * These are self-contained to the chat-mode cluster (per DEV_NOTES ground rules).
 */
import { OperationType } from "../models";

/**
 * Type of task that can be executed via the chat mode execution strategy.
 * Each type maps to a specific prompt template for context-aware prompt composition.
 * Port of chatmode.models.TaskType.
 */
export enum TaskType {
  TEST_GENERATION = "TEST_GENERATION",
  FOLDER_TEST_GENERATION = "FOLDER_TEST_GENERATION",
  DOCS_GENERATION = "DOCS_GENERATION",
  CODE_REVIEW = "CODE_REVIEW",
  SAST_FIX = "SAST_FIX",
  IAC_FIX = "IAC_FIX",
  COVERAGE_BOOST = "COVERAGE_BOOST",
  README_GENERATION = "README_GENERATION",
  FILE_DOCUMENTATION = "FILE_DOCUMENTATION",
  FOLDER_DOCUMENTATION = "FOLDER_DOCUMENTATION",
  UML_DIAGRAM = "UML_DIAGRAM",
  UML_CLASS_DIAGRAM = "UML_CLASS_DIAGRAM",
  UML_SEQUENCE_DIAGRAM = "UML_SEQUENCE_DIAGRAM",
  UML_FLOW_DIAGRAM = "UML_FLOW_DIAGRAM",
  UPDATE_DIAGRAM = "UPDATE_DIAGRAM",
  STORY_GENERATION = "STORY_GENERATION",
  FEATURE_SCAFFOLD = "FEATURE_SCAFFOLD",
  DOC_UPDATE = "DOC_UPDATE",
  API_DRIFT = "API_DRIFT",
  FEATURE_UPDATE = "FEATURE_UPDATE",
  DEPENDENCY_ANALYSIS = "DEPENDENCY_ANALYSIS",
  DEPENDENCY_MIGRATION = "DEPENDENCY_MIGRATION",
  SHAKEDOWN_TEST_GENERATION = "SHAKEDOWN_TEST_GENERATION",
  CHAT_MODE = "CHAT_MODE",
}

const TASK_TYPE_META: Record<TaskType, { displayName: string; templateId: string }> = {
  [TaskType.TEST_GENERATION]: { displayName: "Test Generation", templateId: "test-generation" },
  [TaskType.FOLDER_TEST_GENERATION]: { displayName: "Folder Test Generation", templateId: "folder-test-generation" },
  [TaskType.DOCS_GENERATION]: { displayName: "Documentation Generation", templateId: "docs-generation" },
  [TaskType.CODE_REVIEW]: { displayName: "Code Review", templateId: "code-review" },
  [TaskType.SAST_FIX]: { displayName: "SAST Fix", templateId: "sast-fix" },
  [TaskType.IAC_FIX]: { displayName: "IaC Fix", templateId: "iac-fix" },
  [TaskType.COVERAGE_BOOST]: { displayName: "Coverage Boost", templateId: "coverage-boost" },
  [TaskType.README_GENERATION]: { displayName: "README Generation", templateId: "readme-generation" },
  [TaskType.FILE_DOCUMENTATION]: { displayName: "File Documentation", templateId: "file-documentation" },
  [TaskType.FOLDER_DOCUMENTATION]: { displayName: "Folder Documentation", templateId: "folder-documentation" },
  [TaskType.UML_DIAGRAM]: { displayName: "UML Diagram", templateId: "uml-diagram" },
  [TaskType.UML_CLASS_DIAGRAM]: { displayName: "UML Class Diagram", templateId: "uml-class-diagram" },
  [TaskType.UML_SEQUENCE_DIAGRAM]: { displayName: "UML Sequence Diagram", templateId: "uml-sequence-diagram" },
  [TaskType.UML_FLOW_DIAGRAM]: { displayName: "UML Flow Diagram", templateId: "uml-flow-diagram" },
  [TaskType.UPDATE_DIAGRAM]: { displayName: "Update Diagram", templateId: "update-diagram" },
  [TaskType.STORY_GENERATION]: { displayName: "Story Generation", templateId: "story-generation" },
  [TaskType.FEATURE_SCAFFOLD]: { displayName: "Feature Scaffold", templateId: "feature-scaffold" },
  [TaskType.DOC_UPDATE]: { displayName: "Documentation Update", templateId: "doc-update" },
  [TaskType.API_DRIFT]: { displayName: "API Drift Detection", templateId: "api-drift" },
  [TaskType.FEATURE_UPDATE]: { displayName: "Feature Update", templateId: "feature-update" },
  [TaskType.DEPENDENCY_ANALYSIS]: { displayName: "Dependency Analysis", templateId: "dependency-analysis" },
  [TaskType.DEPENDENCY_MIGRATION]: { displayName: "Dependency Migration", templateId: "dependency-migration" },
  [TaskType.SHAKEDOWN_TEST_GENERATION]: { displayName: "Shakedown Test Generation", templateId: "shakedown-test-generation" },
  [TaskType.CHAT_MODE]: { displayName: "Chat Mode", templateId: "chat-mode" },
};

export function taskTypeDisplayName(t: TaskType): string {
  return TASK_TYPE_META[t].displayName;
}

export function taskTypeTemplateId(t: TaskType): string {
  return TASK_TYPE_META[t].templateId;
}

/** Maps a TaskType to its corresponding {@link OperationType} for analytics tracking. */
export function taskTypeToOperationType(t: TaskType): OperationType {
  switch (t) {
    case TaskType.TEST_GENERATION:
    case TaskType.FOLDER_TEST_GENERATION:
    case TaskType.COVERAGE_BOOST:
      return OperationType.GENERATE_TESTS;
    case TaskType.DOCS_GENERATION:
    case TaskType.FILE_DOCUMENTATION:
    case TaskType.FOLDER_DOCUMENTATION:
    case TaskType.README_GENERATION:
      return OperationType.GENERATE_DOCUMENTATION;
    case TaskType.DOC_UPDATE:
      return OperationType.UPDATE_DOCUMENTATION;
    case TaskType.CODE_REVIEW:
      return OperationType.CODE_REVIEW;
    case TaskType.API_DRIFT:
      return OperationType.API_DRIFT;
    case TaskType.SAST_FIX:
      return OperationType.FIX_SAST_FINDINGS;
    case TaskType.IAC_FIX:
      return OperationType.APPLY_FIX;
    case TaskType.UML_DIAGRAM:
    case TaskType.UML_CLASS_DIAGRAM:
    case TaskType.UML_SEQUENCE_DIAGRAM:
    case TaskType.UML_FLOW_DIAGRAM:
    case TaskType.UPDATE_DIAGRAM:
      return OperationType.GENERATE_UML_DIAGRAM;
    case TaskType.STORY_GENERATION:
      return OperationType.GENERATE_STORY;
    case TaskType.FEATURE_UPDATE:
      return OperationType.FEATURE_UPDATE;
    case TaskType.FEATURE_SCAFFOLD:
      return OperationType.GENERATE_SCAFFOLD;
    case TaskType.DEPENDENCY_ANALYSIS:
      return OperationType.DEPENDENCY_ANALYSIS;
    case TaskType.DEPENDENCY_MIGRATION:
      return OperationType.DEPENDENCY_MIGRATION;
    case TaskType.SHAKEDOWN_TEST_GENERATION:
      return OperationType.GENERATE_SHAKEDOWN_TESTS;
    case TaskType.CHAT_MODE:
    default:
      return OperationType.CHAT;
  }
}

/**
 * Context about a file for prompt composition.
 * Port of chatmode.models.FileContext.
 */
export interface FileContext {
  path: string;
  relativePath: string;
  fileName: string;
  language: string;
  content: string;
  isTruncated: boolean;
  lineCount: number;
}

/**
 * Lightweight issue DTO used by Chat Mode for prompt composition.
 * Port of chatmode.models.PromptIssue.
 */
export interface PromptIssue {
  severity: string;
  category: string;
  description: string;
  startLine: number;
}

/**
 * Context gathered for prompt composition.
 * Port of chatmode.models.PromptContext.
 */
export interface PromptContext {
  activeFile: FileContext | null;
  selectedFolder: string | null;
  workspaceRoot: string;
  issues: PromptIssue[];
  diffContent: string | null;
  changedFiles: string | null;
  selectedText: string | null;
  selectionStartLine: number;
  selectionEndLine: number;
  ragExamples: string | null;
}

function baseContext(workspaceRoot: string): PromptContext {
  return {
    activeFile: null,
    selectedFolder: null,
    workspaceRoot: workspaceRoot ?? "",
    issues: [],
    diffContent: null,
    changedFiles: null,
    selectedText: null,
    selectionStartLine: 0,
    selectionEndLine: 0,
    ragExamples: null,
  };
}

export function forFile(fileContext: FileContext, workspaceRoot: string): PromptContext {
  return { ...baseContext(workspaceRoot), activeFile: fileContext };
}

export function forChat(fileContext: FileContext | null, workspaceRoot: string): PromptContext {
  return { ...baseContext(workspaceRoot), activeFile: fileContext };
}

export function forReview(
  fileContext: FileContext | null,
  workspaceRoot: string,
  diffContent: string,
  changedFiles: string
): PromptContext {
  return { ...baseContext(workspaceRoot), activeFile: fileContext, diffContent, changedFiles };
}

export function forSelection(
  fileContext: FileContext,
  workspaceRoot: string,
  selectedText: string,
  startLine: number,
  endLine: number
): PromptContext {
  return {
    ...baseContext(workspaceRoot),
    activeFile: fileContext,
    selectedText,
    selectionStartLine: startLine,
    selectionEndLine: endLine,
  };
}

export function forIssueFix(
  fileContext: FileContext,
  workspaceRoot: string,
  issues: PromptIssue[]
): PromptContext {
  return { ...baseContext(workspaceRoot), activeFile: fileContext, issues };
}

export function forFolder(folderPath: string, workspaceRoot: string): PromptContext {
  return { ...baseContext(workspaceRoot), selectedFolder: folderPath };
}

export function withRagExamples(ctx: PromptContext, ragExamples: string | null): PromptContext {
  return { ...ctx, ragExamples };
}

export function hasRagContext(ctx: PromptContext): boolean {
  return ctx.ragExamples != null && ctx.ragExamples.trim().length > 0;
}
export function hasFileContext(ctx: PromptContext): boolean {
  return ctx.activeFile != null;
}
export function hasDiffContext(ctx: PromptContext): boolean {
  return ctx.diffContent != null && ctx.diffContent.trim().length > 0;
}
export function hasSelection(ctx: PromptContext): boolean {
  return ctx.selectedText != null && ctx.selectedText.trim().length > 0;
}
export function hasIssues(ctx: PromptContext): boolean {
  return ctx.issues.length > 0;
}

/**
 * A fully composed prompt ready to be sent to Copilot Chat.
 * Port of chatmode.models.ComposedPrompt.
 */
export interface ComposedPrompt {
  text: string;
  templateId: string;
  contextSummary: string | null;
  timestamp: number;
}

export function composedPrompt(text: string, templateId: string, contextSummary: string | null): ComposedPrompt {
  return { text, templateId, contextSummary, timestamp: Date.now() };
}

/**
 * A prompt template with placeholder variables for context substitution.
 * Port of chatmode.models.PromptTemplate.
 */
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  requiredContext: string[];
  category: string;
  isBuiltIn: boolean;
}

export function requiresFileContext(t: PromptTemplate): boolean {
  return t.requiredContext.includes("file");
}
export function requiresFolderContext(t: PromptTemplate): boolean {
  return t.requiredContext.includes("folder");
}
export function requiresIssueContext(t: PromptTemplate): boolean {
  return t.requiredContext.includes("issue");
}

/** How the prompt was delivered to Copilot Chat. Port of ChatTriggerResult.DeliveryMethod. */
export enum DeliveryMethod {
  CHAT_PANEL = "CHAT_PANEL",
  CLIPBOARD = "CLIPBOARD",
}

/**
 * Result of triggering the Copilot Chat panel with a prompt.
 * Port of chatmode.models.ChatTriggerResult.
 */
export interface ChatTriggerResult {
  success: boolean;
  error: string | null;
  promptSent: string | null;
  method: DeliveryMethod;
}

export function triggerSuccess(promptSent: string | null, method: DeliveryMethod): ChatTriggerResult {
  return { success: true, error: null, promptSent, method };
}
export function triggerFailure(error: string, method: DeliveryMethod): ChatTriggerResult {
  return { success: false, error, promptSent: null, method };
}
export function triggerClipboardFallback(promptSent: string): ChatTriggerResult {
  return { success: true, error: null, promptSent, method: DeliveryMethod.CLIPBOARD };
}
