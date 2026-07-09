import * as vscode from "vscode";

/**
 * Lightweight webview for previewing a rendered Mermaid/SVG diagram inside VS Code,
 * in addition to writing the .svg file to disk (there is no equivalent IntelliJ tool
 * window for this — the Java action only opens the file in the editor — so this is an
 * additive convenience for the VS Code port).
 */
let currentPanel: vscode.WebviewPanel | undefined;

export function showDiagramSvgPreview(title: string, svg: string): void {
  if (currentPanel) {
    currentPanel.title = title;
    currentPanel.webview.html = renderHtml(title, svg);
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel("devai.diagramPreview", title, vscode.ViewColumn.Beside, {
    enableScripts: false,
    retainContextWhenHidden: true,
  });
  currentPanel.webview.html = renderHtml(title, svg);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });
}

function renderHtml(title: string, svg: string): string {
  const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapedTitle}</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  .toolbar {
    padding: 6px 10px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    opacity: 0.75;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  }
  .diagram-container {
    width: 100%;
    height: calc(100% - 30px);
    overflow: auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }
  .diagram-container svg {
    max-width: none;
    background: #ffffff;
    border-radius: 4px;
  }
</style>
</head>
<body>
  <div class="toolbar">${escapedTitle}</div>
  <div class="diagram-container">${svg}</div>
</body>
</html>`;
}
