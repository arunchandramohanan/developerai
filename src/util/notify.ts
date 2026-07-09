import * as vscode from "vscode";

/**
 * Port of com.bmo.devai.intellij.util.NotificationUtil.
 * IntelliJ balloon notifications map to VS Code window messages.
 */
export const DEFAULT_TITLE = "BMO GenAI Developer";

function format(title: string, content: string): string {
  return title ? `${title}: ${content}` : content;
}

export function showInfo(title: string, content: string): void {
  void vscode.window.showInformationMessage(format(title, content));
}

export function showWarning(title: string, content: string): void {
  void vscode.window.showWarningMessage(format(title, content));
}

export function showError(title: string, content: string): void {
  void errorWithMaybeModeActions(format(title, content));
}

/**
 * Detects mode-availability failures (SDK/Chat unavailable, no mode available)
 * raised by ModeManager and surfaces one-click recovery actions instead of a
 * dead-end message.
 */
function hasModeIssue(text: string): boolean {
  return /SDK mode is not available|Chat mode is not available|No execution mode available/i.test(text);
}

async function errorWithMaybeModeActions(full: string): Promise<void> {
  if (!hasModeIssue(full)) {
    void vscode.window.showErrorMessage(full);
    return;
  }
  const SWITCH_CHAT = "Switch to Chat Mode";
  const SWITCH_AUTO = "Switch to Auto";
  const SETTINGS = "Open Settings";
  const choice = await vscode.window.showErrorMessage(full, SWITCH_CHAT, SWITCH_AUTO, SETTINGS);
  if (choice === SWITCH_CHAT || choice === SWITCH_AUTO) {
    const target = choice === SWITCH_CHAT ? "CHAT_ONLY" : "AUTO";
    try {
      await vscode.workspace
        .getConfiguration("devai")
        .update("modePreference", target, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `${DEFAULT_TITLE}: Execution mode set to ${
          target === "CHAT_ONLY" ? "Chat Only" : "Auto"
        }. Re-run the command. (Chat mode needs GitHub Copilot Chat installed & signed in.)`
      );
    } catch {
      /* ignore */
    }
  } else if (choice === SETTINGS) {
    void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:bmo.bmo-genai-developer");
  }
}

export function notifyInfo(message: string): void {
  showInfo(DEFAULT_TITLE, message);
}
export function notifyWarning(message: string): void {
  showWarning(DEFAULT_TITLE, message);
}
export function notifyError(message: string): void {
  showError(DEFAULT_TITLE, message);
}

/** Info message with action buttons; resolves to the chosen label or undefined. */
export async function showInfoWithActions(
  title: string,
  content: string,
  ...actions: string[]
): Promise<string | undefined> {
  return vscode.window.showInformationMessage(format(title, content), ...actions);
}
