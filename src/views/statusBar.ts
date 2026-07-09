import * as vscode from "vscode";
import { ExecutionMode } from "../models";
import { currentExecutionMode } from "../chatmode/integrator";
import { WIDGET_CHAT_LABEL, WIDGET_SDK_LABEL, modePreferenceDisplayName } from "../chatmode/constants";
import { ModeManager } from "../core/modeManager";

/**
 * Status-bar item mirroring ChatModeWidgetFactory: shows "BMO GenAI: SDK" or
 * "BMO GenAI: Chat" and toggles the execution mode on click.
 */
export class ChatModeStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "devai.toggleChatMode";
    this.refresh();
    this.item.show();
  }

  /** Recomputes the label/tooltip from the current execution mode. */
  refresh(): void {
    const mode = currentExecutionMode();
    const isChat = mode === ExecutionMode.CHAT;
    this.item.text = `$(${isChat ? "comment-discussion" : "terminal"}) ${isChat ? WIDGET_CHAT_LABEL : WIDGET_SDK_LABEL}`;
    const pref = ModeManager.getInstance().getModePreference();
    this.item.tooltip = `BMO GenAI execution mode: ${modePreferenceDisplayName(pref)} — click to toggle SDK ↔ Chat`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
