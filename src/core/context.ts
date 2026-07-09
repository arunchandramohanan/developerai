import * as vscode from "vscode";
import * as path from "path";

/**
 * Holds the activated ExtensionContext and provides access to bundled
 * resource paths and the shared output channel. Set once during activate().
 */
let ctx: vscode.ExtensionContext | undefined;
let output: vscode.OutputChannel | undefined;

export function setExtensionContext(context: vscode.ExtensionContext): void {
  ctx = context;
  output = vscode.window.createOutputChannel("BMO GenAI Developer");
  context.subscriptions.push(output);
}

export function getExtensionContext(): vscode.ExtensionContext {
  if (!ctx) {
    throw new Error("Extension context not initialized");
  }
  return ctx;
}

export function extensionPath(): string {
  return getExtensionContext().extensionPath;
}

/** Absolute path to a bundled resource, e.g. resourcePath("prompts", "chat-user.md"). */
export function resourcePath(...segments: string[]): string {
  return path.join(extensionPath(), "resources", ...segments);
}

export function log(message: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : err ? String(err) : "";
  output?.appendLine(`[${new Date().toISOString()}] ERROR ${message}${detail ? " :: " + detail : ""}`);
}

/** The first workspace folder's fsPath, or undefined. */
export function workspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}
