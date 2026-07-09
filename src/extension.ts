import * as vscode from "vscode";
import { setExtensionContext, log } from "./core/context";
import { ModeManager } from "./core/modeManager";
import { registerTesting } from "./features/testing";
import { registerDocumentation } from "./features/documentation";
import { registerReview } from "./features/review";
import { registerDiagrams } from "./features/diagrams";
import { registerDelivery } from "./features/delivery";
import { registerSecurity } from "./features/security";
import { registerChatMode } from "./features/chatmode";

/**
 * Extension entry point. Mirrors DevAIStartupActivity + plugin.xml wiring:
 * registers every action (command), tool window (view), the status-bar widget,
 * and the settings surface.
 */
export function activate(context: vscode.ExtensionContext): void {
  setExtensionContext(context);
  log("BMO GenAI Developer activating…");

  // Register all feature clusters (commands + views + status bar).
  registerTesting(context);
  registerDocumentation(context);
  registerReview(context);
  registerDiagrams(context);
  registerDelivery(context);
  registerSecurity(context);
  registerChatMode(context);

  // Warm up mode availability in the background (non-blocking).
  void ModeManager.getInstance()
    .refreshAvailability()
    .catch(() => {
      /* best-effort */
    });

  log("BMO GenAI Developer activated.");
}

export function deactivate(): void {
  /* nothing to clean up beyond disposables registered in context.subscriptions */
}
