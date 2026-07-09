import * as vscode from "vscode";
import * as path from "path";
import { GeneratedTest, frameworkDisplayNameFor } from "../models/testing";
import { writeTextFile, openFile } from "../util/files";
import { notifyError, notifyInfo, notifyWarning } from "../util/notify";

/**
 * Webview replacement for com.bmo.devai.intellij.ui.BatchTestPreviewDialog.
 * Checkbox list on the left (all selected by default), read-only content
 * preview on the right, "Accept Selected" writes every checked test to its
 * suggested path and opens the first one. The Save & Verify / Auto-Fix flows
 * from the IntelliJ dialog depend on TestRunnerService, which has no port in
 * this extension — omitted here (see testPreviewPanel.ts for the same note).
 */
export function showBatchTestPreview(tests: GeneratedTest[]): void {
  if (tests.length === 0) return;

  const panel = vscode.window.createWebviewPanel(
    "devaiBatchTestPreview",
    `Generated Tests — ${tests.length} file(s)`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = renderHtml(nonce, tests);

  panel.webview.onDidReceiveMessage(async (message: { command: string; selected?: number[] }) => {
    if (message.command === "accept") {
      const selectedIdx = new Set(message.selected ?? []);
      const chosen = tests.filter((_, i) => selectedIdx.has(i));
      if (chosen.length === 0) {
        notifyWarning("No tests selected.");
        return;
      }
      let saved = 0;
      let failed = 0;
      for (const t of chosen) {
        try {
          writeTextFile(t.suggestedFilePath, t.content);
          saved++;
        } catch {
          failed++;
        }
      }
      if (failed === 0) {
        notifyInfo(`${saved} test file(s) created successfully.`);
      } else {
        notifyWarning(`${saved} saved, ${failed} failed.`);
      }
      const first = chosen[0];
      if (first) await openFile(first.suggestedFilePath);
      panel.dispose();
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

interface BatchItemDto {
  index: number;
  className: string;
  targetClassName: string;
  frameworkLabel: string;
  suggestedFilePath: string;
  content: string;
}

function renderHtml(nonce: string, tests: GeneratedTest[]): string {
  const items: BatchItemDto[] = tests.map((t, i) => ({
    index: i,
    className: t.className,
    targetClassName: t.targetClassName,
    frameworkLabel: frameworkDisplayNameFor(t),
    suggestedFilePath: t.suggestedFilePath,
    content: t.content,
  }));
  // Escape '<' so no literal tag (in particular '</script>') can appear
  // inside embedded file content and break out of the script element.
  const dataJson = JSON.stringify(items).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; padding: 10px; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .toolbar .spacer { flex: 1; }
  .main { flex: 1; display: flex; gap: 10px; min-height: 0; }
  #list { width: 300px; overflow-y: auto; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; }
  .row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; font-size: 13px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .previewPane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #previewHeader { font-size: 12px; opacity: 0.8; margin-bottom: 4px; word-break: break-all; }
  #preview {
    flex: 1; margin: 0; overflow: auto; padding: 8px; box-sizing: border-box;
    background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family, monospace); font-size: 13px;
    white-space: pre;
  }
  #status { font-size: 12px; opacity: 0.85; }
  .bottom { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  button { padding: 6px 14px; border: none; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
  <div class="toolbar">
    <strong>Test Files</strong>
    <button class="secondary" id="selectAll">All</button>
    <button class="secondary" id="selectNone">None</button>
    <div class="spacer"></div>
  </div>
  <div class="main">
    <div id="list"></div>
    <div class="previewPane">
      <div id="previewHeader"></div>
      <pre id="preview"></pre>
    </div>
  </div>
  <div class="bottom">
    <span id="status"></span>
    <div class="spacer"></div>
    <button class="secondary" id="discard">Discard All</button>
    <button id="accept">Accept Selected</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const testData = ${dataJson};
  let currentIndex = testData.length > 0 ? testData[0].index : -1;
  const checked = new Set(testData.map(t => t.index));

  function renderList() {
    const list = document.getElementById('list');
    list.innerHTML = '';
    for (const item of testData) {
      const row = document.createElement('div');
      row.className = 'row' + (item.index === currentIndex ? ' active' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(item.index);
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(item.index); else checked.delete(item.index);
        updateStatus();
      });
      const label = document.createElement('span');
      label.textContent = item.targetClassName + ' → ' + item.className;
      row.addEventListener('click', (e) => {
        if (e.target === cb) return;
        currentIndex = item.index;
        renderList();
        renderPreview();
      });
      row.appendChild(cb);
      row.appendChild(label);
      list.appendChild(row);
    }
  }

  function renderPreview() {
    const item = testData.find(t => t.index === currentIndex);
    document.getElementById('previewHeader').textContent = item ? (item.suggestedFilePath + '  [' + item.frameworkLabel + ']') : '';
    document.getElementById('preview').textContent = item ? item.content : '';
  }

  function updateStatus() {
    document.getElementById('status').textContent = checked.size + ' of ' + testData.length + ' selected';
  }

  document.getElementById('selectAll').addEventListener('click', () => {
    testData.forEach(t => checked.add(t.index));
    renderList();
    updateStatus();
  });
  document.getElementById('selectNone').addEventListener('click', () => {
    checked.clear();
    renderList();
    updateStatus();
  });
  document.getElementById('accept').addEventListener('click', () => {
    vscode.postMessage({ command: 'accept', selected: Array.from(checked) });
  });
  document.getElementById('discard').addEventListener('click', () => {
    vscode.postMessage({ command: 'discard' });
  });

  renderList();
  renderPreview();
  updateStatus();
</script>
</body>
</html>`;
}
