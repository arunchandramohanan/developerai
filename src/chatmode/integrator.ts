import { ExecutionMode, ModePreference } from "../models";
import { settings } from "../core/settings";
import { ModeManager } from "../core/modeManager";
import { TaskType, taskTypeTemplateId } from "../models/chat";
import { ChatModeTrigger } from "./trigger";
import { ChatModePromptComposer } from "./promptComposer";
import { ChatModeContextGatherer, DiffScope } from "./contextGatherer";
import { chatTriggerFailedMessage } from "./constants";
import { notifyWarning } from "../util/notify";
import { log } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.chatmode.ChatModeIntegrator.
 *
 * Integration helper for routing DevAI actions through Copilot Chat when Chat
 * Mode is active. Other clusters COULD call {@link handleIfChatMode} at the top
 * of a command to short-circuit into the chat pipeline — but the helpers are
 * self-contained (nothing else is required to import them).
 */

/**
 * Resolves the effective execution mode from settings, mirroring
 * ChatModeExecutionStrategyServiceImpl.loadModeFromSettings():
 * CHAT_ONLY ⇒ CHAT, SDK_ONLY ⇒ SDK, AUTO ⇒ honour the chatModeEnabled toggle.
 */
export function currentExecutionMode(): ExecutionMode {
  const pref = ModeManager.getInstance().getModePreference();
  if (pref === ModePreference.CHAT_ONLY) return ExecutionMode.CHAT;
  if (pref === ModePreference.SDK_ONLY) return ExecutionMode.SDK;
  return settings().isChatModeEnabled() ? ExecutionMode.CHAT : ExecutionMode.SDK;
}

/** Whether Chat Mode is currently the active execution mode. */
export function isChatModeActive(): boolean {
  return currentExecutionMode() === ExecutionMode.CHAT;
}

/**
 * If Chat Mode is active, routes the task through the Copilot Chat pipeline and
 * returns true (caller should skip its SDK logic). Otherwise returns false.
 */
export async function handleIfChatMode(taskType: TaskType, filePath?: string | null): Promise<boolean> {
  if (!isChatModeActive()) return false;
  log(`Executing ${taskType} with CHAT mode`);
  const result = await ChatModeTrigger.getInstance().trigger(taskType, filePath ?? null);
  if (!result.success && shouldShowFailureWarning(result.error)) {
    notifyWarning(chatTriggerFailedMessage(result.error));
  }
  return true;
}

/** Folder-scoped variant of {@link handleIfChatMode}. */
export async function handleIfChatModeFolder(taskType: TaskType, folderPath: string): Promise<boolean> {
  if (!isChatModeActive()) return false;
  log(`Executing ${taskType} for folder with CHAT mode: ${folderPath}`);
  const result = await ChatModeTrigger.getInstance().triggerFolder(taskType, folderPath);
  if (!result.success && shouldShowFailureWarning(result.error)) {
    notifyWarning(chatTriggerFailedMessage(result.error));
  }
  return true;
}

/** Diff-based review variant; returns true if Chat Mode handled it. */
export async function handleDiffReview(
  scope: DiffScope,
  baseBranch?: string | null,
  currentFilePath?: string | null
): Promise<boolean> {
  if (!isChatModeActive()) return false;
  const result = await ChatModeTrigger.getInstance().triggerDiffReview(
    scope,
    baseBranch ?? null,
    currentFilePath ?? null
  );
  if (!result.success && shouldShowFailureWarning(result.error)) {
    notifyWarning(chatTriggerFailedMessage(result.error));
  }
  return true;
}

/**
 * Documentation-update variant: gathers uncommitted changes and sends a
 * doc-update prompt to Copilot Chat. Returns true if Chat Mode handled it.
 */
export async function handleDocUpdate(): Promise<boolean> {
  if (!isChatModeActive()) return false;
  const context = await ChatModeContextGatherer.getInstance().buildContextForReview(
    DiffScope.UNCOMMITTED,
    null,
    null
  );
  if (context.diffContent == null || context.diffContent.trim().length === 0 || context.diffContent.startsWith("(No changes")) {
    notifyWarning("No local changes found. Stage or modify files first.");
    return true;
  }
  const prompt = ChatModePromptComposer.getInstance().compose(taskTypeTemplateId(TaskType.DOC_UPDATE), context);
  const result = await ChatModeTrigger.getInstance().triggerWithPrompt(prompt);
  if (!result.success && shouldShowFailureWarning(result.error)) {
    notifyWarning(chatTriggerFailedMessage(result.error));
  }
  return true;
}

function shouldShowFailureWarning(error: string | null): boolean {
  return error == null || !error.toLowerCase().includes("preflight failed");
}
