import * as vscode from "vscode";
import { CodePatch, UpdateResult } from "../models/delivery";

/**
 * Port of the role of com.bmo.devai.intellij.ui.PatchPreviewRenderer.
 *
 * Renders a webview listing the proposed search-and-replace patches (grouped by
 * file) with per-patch checkboxes, and resolves to the list of approved patches
 * when the user clicks Apply, or {@code null} if the dialog is cancelled/closed.
 */
export function showPatchPreview(result: UpdateResult): Promise<CodePatch[] | null> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "devaiFeaturePatchPreview",
      "Feature Update — Review Changes",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = renderHtml(result);

    let settled = false;
    const finish = (value: CodePatch[] | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      panel.dispose();
    };

    panel.webview.onDidReceiveMessage((msg: { command?: string; selected?: number[] }) => {
      if (msg.command === "apply") {
        const indices = new Set(msg.selected ?? []);
        finish(result.patches.filter((_, i) => indices.has(i)));
      } else if (msg.command === "cancel") {
        finish(null);
      }
    });

    panel.onDidDispose(() => finish(null));
  });
}

function renderHtml(result: UpdateResult): string {
  const rows = result.patches
    .map((p, i) => {
      return `
      <div class="patch">
        <label class="patch-head">
          <input type="checkbox" data-idx="${i}" checked />
          <span class="file">${esc(p.filePath)}</span>
        </label>
        <div class="reason">${esc(p.changeReason)}</div>
        <div class="cols">
          <div class="col">
            <div class="col-title">Original</div>
            <pre class="orig">${esc(p.originalBlock)}</pre>
          </div>
          <div class="col">
            <div class="col-title">Updated</div>
            <pre class="upd">${esc(p.updatedBlock)}</pre>
          </div>
        </div>
      </div>`;
    })
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
    h2 { margin: 0 0 4px 0; }
    .summary { margin-bottom: 12px; opacity: 0.85; }
    .patch { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; margin-bottom: 12px; }
    .patch-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
    .file { font-family: var(--vscode-editor-font-family); }
    .reason { opacity: 0.8; margin: 6px 0; }
    .cols { display: flex; gap: 12px; }
    .col { flex: 1; min-width: 0; }
    .col-title { font-size: 11px; text-transform: uppercase; opacity: 0.7; margin-bottom: 2px; }
    pre { white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0; }
    .orig { border-left: 3px solid var(--vscode-editorError-foreground); }
    .upd { border-left: 3px solid var(--vscode-editorInfo-foreground); }
    .bar { position: sticky; bottom: 0; padding: 10px 0; background: var(--vscode-editor-background); display: flex; gap: 8px; }
    button { padding: 6px 14px; cursor: pointer; border: none; border-radius: 4px; }
    .apply { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style></head>
  <body>
    <h2>Feature Update</h2>
    <div class="summary">${esc(result.summary)} — ${result.patches.length} patch(es) across ${result.affectedFiles.length} file(s).</div>
    ${rows}
    <div class="bar">
      <button class="apply" id="applyBtn">Apply Selected</button>
      <button class="cancel" id="cancelBtn">Cancel</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('applyBtn').addEventListener('click', () => {
        const selected = Array.from(document.querySelectorAll('input[type=checkbox]'))
          .filter(cb => cb.checked)
          .map(cb => parseInt(cb.getAttribute('data-idx'), 10));
        vscode.postMessage({ command: 'apply', selected });
      });
      document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
    </script>
  </body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
