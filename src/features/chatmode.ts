import * as vscode from "vscode";
import { ExecutionMode, ModePreference, executionModeDisplayName } from "../models";
import { ModeManager } from "../core/modeManager";
import { notifyWarning, showInfo } from "../util/notify";
import { log } from "../core/context";
import { ChatModeTrigger } from "../chatmode/trigger";
import { ChatModePromptTemplateService } from "../chatmode/promptTemplateService";
import { currentExecutionMode } from "../chatmode/integrator";
import { MODE_NOTIFICATION_TITLE, modeSwitchedMessage } from "../chatmode/constants";
import { MainViewProvider } from "../views/mainView";
import { ChatModeStatusBar } from "../views/statusBar";

/**
 * Chat Mode cluster registration.
 *
 * Wires the three commands (openCopilotChat, toggleChatMode, openSettings),
 * the main sidebar webview (`devai.mainView`), and the SDK/Chat status-bar item.
 * Ports ChatModeIntegrator / ChatModeOpenCopilotChatAction / ChatModeToggleAction /
 * ChatModeWidgetFactory / DevAIMainPanel behaviour, adapted to VS Code.
 */
export function registerChatMode(context: vscode.ExtensionContext): void {
  // Warm the template cache so composition is ready when a task routes to chat.
  try {
    ChatModePromptTemplateService.getInstance();
  } catch (e) {
    log("Chat mode template service init failed: " + (e instanceof Error ? e.message : String(e)));
  }

  // ── Main sidebar view (devai.mainView) ────────────────────────────────────
  const mainView = new MainViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, mainView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ── Status bar item (SDK / Chat) ──────────────────────────────────────────
  const statusBar = new ChatModeStatusBar();
  context.subscriptions.push(statusBar);

  const refreshUi = (): void => {
    statusBar.refresh();
    mainView.postMode();
  };

  // ── devai.openCopilotChat ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.openCopilotChat", async () => {
      const result = await ChatModeTrigger.getInstance().openCopilotChat();
      if (!result.success) {
        notifyWarning("Could not open Copilot Chat: " + (result.error ?? "unknown error"));
      }
    })
  );

  // ── devai.toggleChatMode ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.toggleChatMode", async () => {
      const wasChat = currentExecutionMode() === ExecutionMode.CHAT;
      // Flip SDK ↔ Chat, like ChatModeToggleAction. AUTO stays reachable via settings.
      const next = wasChat ? ModePreference.SDK_ONLY : ModePreference.CHAT_ONLY;
      await ModeManager.getInstance().setModePreference(next);
      refreshUi();
      const newMode = wasChat ? ExecutionMode.SDK : ExecutionMode.CHAT;
      showInfo(
        MODE_NOTIFICATION_TITLE,
        modeSwitchedMessage(executionModeDisplayName(newMode), newMode === ExecutionMode.CHAT)
      );
    })
  );

  // ── devai.openSettings ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.openSettings", async () => {
      try {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:bmo.bmo-genai-developer");
      } catch {
        try {
          await vscode.commands.executeCommand("workbench.action.openSettings", "devai.");
        } catch (e) {
          notifyWarning("Could not open settings: " + (e instanceof Error ? e.message : String(e)));
        }
      }
    })
  );

  // ── Keep status bar + main view in sync with config-driven mode changes ───
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("devai.modePreference") ||
        e.affectsConfiguration("devai.chatModeEnabled")
      ) {
        refreshUi();
      }
    })
  );

  // ── Reflect programmatic mode changes (e.g. AUTO fallback) in the UI ──────
  ModeManager.getInstance().addModeChangeListener(() => refreshUi());
}
