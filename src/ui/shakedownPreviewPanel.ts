import * as vscode from "vscode";
import * as path from "path";
import { ShakedownResult } from "../services/shakedownTestService";
import { writeTextFile, openFile } from "../util/files";
import { notifyError, notifyInfo } from "../util/notify";

/**
 * Preview/apply webview for the shakedown suite response — the shakedown
 * analog of TestPreviewDialog. "Save" writes the raw LLM response to the
 * `*-shakedown-response.md` log (matching ShakedownTestServiceImpl.generate)
 * and, when a Postman collection could be parsed out of the response, also
 * writes `*-collection.json` (see shakedownTestService.ts's deviation note).
 */
export function showShakedownPreview(specFilePath: string, result: ShakedownResult): void {
  const panel = vscode.window.createWebviewPanel(
    "devaiShakedownPreview",
    `Shakedown Suite Preview — ${path.basename(specFilePath)}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = renderHtml(nonce, specFilePath, result);

  panel.webview.onDidReceiveMessage(async (message: { command: string }) => {
    if (message.command === "save") {
      try {
        writeTextFile(result.responseMarkdownPath, result.responseContent);
        const createdNames = [path.basename(result.responseMarkdownPath)];
        if (result.collectionPath && result.collectionJson) {
          writeTextFile(result.collectionPath, JSON.stringify(result.collectionJson, null, 2));
          createdNames.unshift(path.basename(result.collectionPath));
        }
        notifyInfo(`Shakedown Test Suite Generated: ${createdNames.join(" and ")} created successfully.`);
        if (result.collectionPath && result.collectionJson) {
          await openFile(result.collectionPath);
        } else {
          await openFile(result.responseMarkdownPath);
        }
        panel.dispose();
      } catch (e) {
        notifyError(`Failed to save shakedown output: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (message.command === "discard") {
      panel.dispose();
    }
  });
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

function renderHtml(nonce: string, specFilePath: string, result: ShakedownResult): string {
  const willWrite = [path.basename(result.responseMarkdownPath)];
  if (result.collectionPath) willWrite.unshift(path.basename(result.collectionPath));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  .meta { font-size: 13px; margin-bottom: 10px; }
  .meta .label { opacity: 0.75; }
  #preview {
    width: 100%; height: 58vh; overflow: auto; box-sizing: border-box; margin: 0;
    background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-input-border); padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; white-space: pre-wrap;
  }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  button { padding: 6px 14px; border: none; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
  <div class="meta">
    <span class="label">Spec:</span> ${esc(path.basename(specFilePath))}<br/>
    <span class="label">Will create:</span> ${esc(willWrite.join(", "))}
  </div>
  <pre id="preview">${esc(result.responseContent)}</pre>
  <div class="actions">
    <button class="secondary" id="discard">Discard</button>
    <button id="save">Save</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('save').addEventListener('click', () => {
    vscode.postMessage({ command: 'save' });
  });
  document.getElementById('discard').addEventListener('click', () => {
    vscode.postMessage({ command: 'discard' });
  });
</script>
</body>
</html>`;
}
