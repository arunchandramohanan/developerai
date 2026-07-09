import * as vscode from "vscode";
import * as fs from "fs";
import {
  ChatTriggerResult,
  ComposedPrompt,
  DeliveryMethod,
  PromptContext,
  TaskType,
  hasDiffContext,
  taskTypeTemplateId,
  taskTypeToOperationType,
  triggerClipboardFallback,
  triggerFailure,
  triggerSuccess,
} from "../models/chat";
import { OperationType } from "../models";
import { ChatModeContextGatherer, DiffScope } from "./contextGatherer";
import { ChatModePromptComposer } from "./promptComposer";
import { enrich as ragEnrich } from "../rag/ragContextEnricher";
import { log, logError } from "../core/context";
import { notifyWarning } from "../util/notify";
import { copilotChatNotFoundMessage, copilotChatNotFoundTitle, copilotNotInstalledMessage } from "./constants";
import { showWarning } from "../util/notify";

/**
 * Built-in VS Code commands that open the chat view, tried in order.
 * The first form accepts a `{ query }` argument to pre-fill the input.
 */
const CHAT_OPEN_COMMANDS = [
  "workbench.action.chat.open",
  "workbench.panel.chat.view.copilot.focus",
  "github.copilot.chat.focus",
  "workbench.action.chat.openInSidebar",
];

/**
 * Port of ChatModeTriggerServiceImpl, adapted to VS Code.
 *
 * The IntelliJ implementation drove the Copilot Chat Swing tool window via
 * reflection + Robot key events. VS Code exposes chat through built-in
 * commands: we open the chat view with the composed prompt as the query, and
 * fall back to copying the prompt to the clipboard.
 */
export class ChatModeTrigger {
  private static _instance: ChatModeTrigger | undefined;

  static getInstance(): ChatModeTrigger {
    if (!ChatModeTrigger._instance) ChatModeTrigger._instance = new ChatModeTrigger();
    return ChatModeTrigger._instance;
  }

  /** Whether any Copilot Chat open command is available in this VS Code install. */
  async isCopilotChatAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return CHAT_OPEN_COMMANDS.some((c) => commands.includes(c));
    } catch {
      return false;
    }
  }

  /** Opens the Copilot Chat panel without sending a prompt. */
  async openCopilotChat(): Promise<ChatTriggerResult> {
    for (const command of CHAT_OPEN_COMMANDS) {
      try {
        await vscode.commands.executeCommand(command);
        log("Opened Copilot Chat via command: " + command);
        return triggerSuccess(null, DeliveryMethod.CHAT_PANEL);
      } catch (e) {
        log(`Chat open command failed (${command}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return triggerFailure(copilotNotInstalledMessage(), DeliveryMethod.CHAT_PANEL);
  }

  /** Opens Copilot Chat pre-filled with the composed prompt; clipboard fallback on failure. */
  async triggerWithPrompt(prompt: ComposedPrompt): Promise<ChatTriggerResult> {
    // Always copy to clipboard first so a manual paste is possible even if the
    // programmatic open partially fails.
    await copyToClipboard(prompt.text);

    // Preferred path: open chat with the query pre-filled.
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt.text });
      log("Delivered prompt to Copilot Chat via workbench.action.chat.open");
      return triggerSuccess(prompt.text, DeliveryMethod.CHAT_PANEL);
    } catch (e) {
      log("chat.open with query failed: " + (e instanceof Error ? e.message : String(e)));
    }

    // Fallback: just focus the chat view; the prompt is on the clipboard.
    for (const command of CHAT_OPEN_COMMANDS.slice(1)) {
      try {
        await vscode.commands.executeCommand(command);
        showWarning(copilotChatNotFoundTitle(), copilotChatNotFoundMessage());
        return triggerClipboardFallback(prompt.text);
      } catch {
        /* try next */
      }
    }

    return this.clipboardFallback(prompt);
  }

  private clipboardFallback(prompt: ComposedPrompt): ChatTriggerResult {
    notifyWarning(copilotChatNotFoundMessage());
    log("Copilot Chat not available — prompt copied to clipboard");
    return triggerClipboardFallback(prompt.text);
  }

  /** Routes a file/active-file task through the chat pipeline. */
  async trigger(taskType: TaskType, filePath: string | null): Promise<ChatTriggerResult> {
    try {
      const gatherer = ChatModeContextGatherer.getInstance();
      let context: PromptContext;
      if (taskType === TaskType.FOLDER_DOCUMENTATION && filePath) {
        context = gatherer.buildContextForFolder(filePath);
      } else if (isUmlDiagramTask(taskType) && filePath && isDirectory(filePath)) {
        context = gatherer.buildContextForFolder(filePath);
      } else if (filePath) {
        context = gatherer.buildContextForFile(filePath);
      } else {
        context = gatherer.buildContextForActiveFile();
      }
      context = await enrichWithRag(taskTypeToOperationType(taskType), context);
      return await this.composeAndTrigger(taskTypeTemplateId(taskType), context);
    } catch (e) {
      logError("Failed to trigger Copilot Chat for task: " + taskType, e);
      return triggerFailure("Error: " + (e instanceof Error ? e.message : String(e)), DeliveryMethod.CHAT_PANEL);
    }
  }

  /** Routes a folder task through the chat pipeline. */
  async triggerFolder(taskType: TaskType, folderPath: string): Promise<ChatTriggerResult> {
    try {
      const gatherer = ChatModeContextGatherer.getInstance();
      let context = gatherer.buildContextForFolder(folderPath);
      context = await enrichWithRag(taskTypeToOperationType(taskType), context);
      return await this.composeAndTrigger(taskTypeTemplateId(taskType), context);
    } catch (e) {
      logError("Failed to trigger Copilot Chat for folder task: " + taskType, e);
      return triggerFailure("Error: " + (e instanceof Error ? e.message : String(e)), DeliveryMethod.CHAT_PANEL);
    }
  }

  /** Opens chat for a free-form chat-mode session with the active file as context. */
  async triggerChatMode(filePath: string | null): Promise<ChatTriggerResult> {
    return this.trigger(TaskType.CHAT_MODE, filePath);
  }

  /** Routes a diff-based review through the chat pipeline. */
  async triggerDiffReview(
    scope: DiffScope,
    baseBranch: string | null,
    currentFilePath: string | null
  ): Promise<ChatTriggerResult> {
    try {
      const gatherer = ChatModeContextGatherer.getInstance();
      const context = await gatherer.buildContextForReview(scope, baseBranch, currentFilePath);
      const templateId = hasDiffContext(context) ? "diff-review" : "code-review";
      return await this.composeAndTrigger(templateId, context);
    } catch (e) {
      logError("Failed to trigger diff review for scope: " + scope, e);
      return triggerFailure("Error: " + (e instanceof Error ? e.message : String(e)), DeliveryMethod.CHAT_PANEL);
    }
  }

  private async composeAndTrigger(templateId: string, context: PromptContext): Promise<ChatTriggerResult> {
    const prompt = ChatModePromptComposer.getInstance().compose(templateId, context);
    return this.triggerWithPrompt(prompt);
  }
}

async function enrichWithRag(operationType: OperationType, context: PromptContext): Promise<PromptContext> {
  try {
    if (context.activeFile == null) return context;
    const file = context.activeFile;
    const ragExamples = await ragEnrich(operationType, file.fileName, file.content, file.language);
    if (ragExamples) {
      return { ...context, ragExamples };
    }
  } catch (e) {
    log("RAG enrichment failed, continuing without RAG: " + (e instanceof Error ? e.message : String(e)));
  }
  return context;
}

function isUmlDiagramTask(taskType: TaskType): boolean {
  return (
    taskType === TaskType.UML_DIAGRAM ||
    taskType === TaskType.UML_CLASS_DIAGRAM ||
    taskType === TaskType.UML_SEQUENCE_DIAGRAM ||
    taskType === TaskType.UML_FLOW_DIAGRAM
  );
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await vscode.env.clipboard.writeText(text);
  } catch (e) {
    log("Failed to copy prompt to clipboard: " + (e instanceof Error ? e.message : String(e)));
  }
}
