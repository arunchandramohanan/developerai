import { ModePreference } from "../models";

/**
 * Constants used throughout the Chat Mode module.
 * Port of com.bmo.devai.intellij.chatmode.models.ChatModeConstants, trimmed to
 * what the VS Code port needs (Swing/Robot/IntelliJ tool-window internals dropped).
 */

// Branding
export const PLUGIN_NAME = "BMO GenAI Developer";
export const NOTIFICATION_TITLE = "BMO GenAI Developer";
export const MODE_NOTIFICATION_TITLE = "BMO GenAI Mode";

// Status bar widget
export const WIDGET_SDK_LABEL = "BMO GenAI: SDK";
export const WIDGET_CHAT_LABEL = "BMO GenAI: Chat";

// Chat Mode models
export const DEFAULT_CHAT_MODE_MODEL = "GPT-4o";
export const DEFAULT_AGENT_MODE = true;

// Prompt resources
/** Resource subdirectory (under resources/prompts) for built-in chat mode templates. */
export const PROMPT_RESOURCE_DIR = "chatmode";
export const PROMPT_FILE_EXTENSION = ".md";
/** Workspace custom templates directory (relative to workspace root). */
export const CUSTOM_PROMPTS_DIR = ".github/prompts";

// Content limits
export const MAX_CONTENT_LENGTH = 100_000;
/** Git command timeout in milliseconds. */
export const GIT_TIMEOUT_MS = 30_000;

// Notification messages
export function chatModeNotAvailableMessage(): string {
  return "Chat mode not available, please use SDK mode";
}
export function chatTriggerFailedMessage(error: string | null | undefined): string {
  return "Chat mode failed: " + (error ?? "unknown error");
}
export function copilotChatNotFoundMessage(): string {
  return (
    "GitHub Copilot Chat could not be opened automatically. " +
    "The prompt has been copied to your clipboard. " +
    "Open Copilot Chat manually and paste (Cmd+V / Ctrl+V)."
  );
}
export function copilotChatNotFoundTitle(): string {
  return PLUGIN_NAME + " — Copilot Chat Not Found";
}
export function copilotNotInstalledMessage(): string {
  return "GitHub Copilot Chat is not available. Please install the GitHub Copilot Chat extension.";
}
export function modeSwitchedMessage(modeDisplayName: string, isChatMode: boolean): string {
  return (
    "Switched to " +
    modeDisplayName +
    " — " +
    (isChatMode
      ? "operations will now open GitHub Copilot Chat with pre-composed prompts."
      : "operations will now use GitHub Copilot CLI (SDK).")
  );
}
export function strategyServiceNotAvailableMessage(): string {
  return "Execution strategy service not available";
}
export function triggerServiceNotAvailableMessage(): string {
  return "Chat trigger service not available";
}

/** Human-readable name for a ModePreference (mirrors ModePreference.getDisplayName()). */
export function modePreferenceDisplayName(pref: ModePreference): string {
  switch (pref) {
    case ModePreference.SDK_ONLY:
      return "SDK Only";
    case ModePreference.CHAT_ONLY:
      return "Chat Only";
    case ModePreference.AUTO:
    default:
      return "Auto";
  }
}
