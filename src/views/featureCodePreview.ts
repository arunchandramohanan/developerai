import * as vscode from "vscode";
import { FeatureCodeFileSpec } from "../models/delivery";

/**
 * Preview webview for feature-code generation. Lists the files to be created
 * (marking overwrites), surfaces the collected assumptions, and lets the user
 * choose which files to write. Resolves to the approved specs, or {@code null}
 * if cancelled.
 */
export function showFeatureCodePreview(
  specs: FeatureCodeFileSpec[],
  existingPaths: Set<string>,
  title: string
): Promise<FeatureCodeFileSpec[] | null> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "devaiFeatureCodePreview",
      title,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = renderHtml(specs, existingPaths, title);

    let settled = false;
    const finish = (value: FeatureCodeFileSpec[] | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      panel.dispose();
    };

    panel.webview.onDidReceiveMessage((msg: { command?: string; selected?: number[] }) => {
      if (msg.command === "apply") {
        const indices = new Set(msg.selected ?? []);
        finish(specs.filter((_, i) => indices.has(i)));
      } else if (msg.command === "cancel") {
        finish(null);
      }
    });
    panel.onDidDispose(() => finish(null));
  });
}

function renderHtml(specs: FeatureCodeFileSpec[], existingPaths: Set<string>, title: string): string {
  const assumptions = Array.from(new Set(specs.flatMap((s) => s.assumptions)));
  const assumptionsHtml =
    assumptions.length > 0
      ? `<div class="assumptions"><h3>Assumptions</h3><ul>${assumptions
          .map((a) => `<li>${esc(a)}</li>`)
          .join("")}</ul></div>`
      : "";

  const rows = specs
    .map((s, i) => {
      const overwrite = existingPaths.has(s.targetPath);
      return `
      <div class="file">
        <label class="file-head">
          <input type="checkbox" data-idx="${i}" checked />
          <span class="badge ${overwrite ? "ow" : "new"}">${overwrite ? "OVERWRITE" : "NEW"}</span>
          <span class="path">${esc(s.targetPath)}</span>
        </label>
        <pre>${esc(s.content)}</pre>
      </div>`;
    })
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
    h2 { margin: 0 0 8px 0; }
    .assumptions { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
    .file { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; margin-bottom: 12px; }
    .file-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
    .path { font-family: var(--vscode-editor-font-family); }
    .badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; }
    .badge.new { background: var(--vscode-editorInfo-foreground); color: var(--vscode-editor-background); }
    .badge.ow { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
    pre { white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 8px 0 0 0; max-height: 320px; }
    .bar { position: sticky; bottom: 0; padding: 10px 0; background: var(--vscode-editor-background); display: flex; gap: 8px; }
    button { padding: 6px 14px; cursor: pointer; border: none; border-radius: 4px; }
    .apply { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style></head><body>
    <h2>${esc(title)}</h2>
    <div class="summary">${specs.length} file(s) will be written.</div>
    ${assumptionsHtml}
    ${rows}
    <div class="bar">
      <button class="apply" id="applyBtn">Write Selected Files</button>
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
