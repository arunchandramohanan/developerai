import * as vscode from "vscode";
import * as path from "path";
import { GeneratedTest, frameworkDisplayNameFor } from "../models/testing";
import { writeAndOpen } from "../util/files";
import { notifyError, notifyInfo, notifyWarning } from "../util/notify";

/**
 * Webview replacement for com.bmo.devai.intellij.ui.TestPreviewDialog.
 * Shows the generated test with an editable save path; "Accept & Create"
 * writes the (possibly edited) content to the (possibly edited) path and
 * opens it. The Save & Verify / Auto-Fix buttons from the IntelliJ dialog
 * depend on TestRunnerService, which has no port in this extension (out of
 * scope for the testing cluster) — omitted here.
 */
export function showTestPreview(test: GeneratedTest): void {
  const panel = vscode.window.createWebviewPanel(
    "devaiTestPreview",
    `Test Preview — ${test.className}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = renderHtml(nonce, test);

  panel.webview.onDidReceiveMessage(
    async (message: { command: string; content?: string; filePath?: string }) => {
      switch (message.command) {
        case "accept": {
          const filePath = (message.filePath ?? "").trim();
          const content = message.content ?? "";
          if (!filePath) {
            notifyWarning("Please specify a file path.");
            return;
          }
          try {
            await writeAndOpen(filePath, content);
            notifyInfo(`Test file created: ${path.basename(filePath)}`);
            panel.dispose();
          } catch (e) {
            notifyError(`Failed to save test file: ${e instanceof Error ? e.message : String(e)}`);
          }
          return;
        }
        case "browse": {
          const current = (message.filePath ?? test.suggestedFilePath).trim();
          const picked = await vscode.window.showSaveDialog({
            defaultUri: current ? vscode.Uri.file(current) : undefined,
            saveLabel: "Save Test File",
          });
          if (picked) {
            void panel.webview.postMessage({ command: "setPath", filePath: picked.fsPath });
          }
          return;
        }
        case "discard":
          panel.dispose();
          return;
      }
    }
  );
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderHtml(nonce: string, test: GeneratedTest): string {
  const frameworkLabel = frameworkDisplayNameFor(test);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  .meta { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin-bottom: 12px; font-size: 13px; }
  .meta .label { opacity: 0.75; }
  textarea#content {
    width: 100%; height: 58vh; box-sizing: border-box;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 13px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); padding: 8px; resize: vertical;
  }
  .pathRow { display: flex; gap: 8px; margin: 12px 0; align-items: center; }
  .pathRow label { white-space: nowrap; }
  .pathRow input {
    flex: 1; box-sizing: border-box; padding: 4px 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
  }
  button { padding: 6px 14px; border: none; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
</head>
<body>
  <div class="meta">
    <div class="label">Test Class:</div><div>${esc(test.className)}</div>
    <div class="label">Target Class:</div><div>${esc(test.targetClassName)}</div>
    <div class="label">Framework:</div><div>${esc(frameworkLabel)}</div>
    ${test.packageName ? `<div class="label">Package:</div><div>${esc(test.packageName)}</div>` : ""}
  </div>
  <textarea id="content" spellcheck="false">${esc(test.content)}</textarea>
  <div class="pathRow">
    <label for="path">Save to:</label>
    <input id="path" type="text" value="${esc(test.suggestedFilePath)}" />
    <button class="secondary" id="browse">Browse...</button>
  </div>
  <div class="actions">
    <button class="secondary" id="discard">Discard</button>
    <button id="accept">Accept &amp; Create</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const pathInput = document.getElementById('path');
  const contentArea = document.getElementById('content');
  document.getElementById('accept').addEventListener('click', () => {
    vscode.postMessage({ command: 'accept', filePath: pathInput.value, content: contentArea.value });
  });
  document.getElementById('discard').addEventListener('click', () => {
    vscode.postMessage({ command: 'discard' });
  });
  document.getElementById('browse').addEventListener('click', () => {
    vscode.postMessage({ command: 'browse', filePath: pathInput.value });
  });
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.command === 'setPath') {
      pathInput.value = message.filePath;
    }
  });
</script>
</body>
</html>`;
}
