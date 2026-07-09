import * as vscode from "vscode";
import { UpgradeRecommendation, recommendationLabel } from "../models/upgrade";

/**
 * Renders a read-only webview with the full details of a single upgrade
 * recommendation (port of the detail presentation in UpgradeRecommendationsDialog
 * / PlatformUpgradePanel row rendering).
 */
export function showUpgradeDetail(rec: UpgradeRecommendation): void {
  const panel = vscode.window.createWebviewPanel(
    "devaiUpgradeDetail",
    "Upgrade — " + rec.currentDependency.name,
    vscode.ViewColumn.Active,
    { enableScripts: false }
  );
  panel.webview.html = renderHtml(rec);
}

function renderHtml(rec: UpgradeRecommendation): string {
  const breaking =
    rec.breakingChanges.length > 0
      ? "<ul>" + rec.breakingChanges.map((c) => `<li>${esc(c)}</li>`).join("") + "</ul>"
      : "<p class='none'>None</p>";
  const migration =
    rec.migrationSteps.length > 0
      ? "<ol>" + rec.migrationSteps.map((s) => `<li>${esc(s)}</li>`).join("") + "</ol>"
      : "<p class='none'>None</p>";

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
    h1 { font-size: 18px; }
    .sev { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    table { border-collapse: collapse; margin: 12px 0; }
    td { padding: 4px 12px 4px 0; vertical-align: top; }
    td.k { opacity: 0.7; }
    code { font-family: var(--vscode-editor-font-family); }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
    .none { opacity: 0.6; }
  </style></head><body>
    <h1>${esc(recommendationLabel(rec))}</h1>
    <p><span class="sev">Severity: ${esc(rec.severity)}</span></p>
    <table>
      <tr><td class="k">Name</td><td>${esc(rec.currentDependency.name)}</td></tr>
      <tr><td class="k">Type</td><td>${esc(rec.currentDependency.type)}</td></tr>
      <tr><td class="k">Current Version</td><td><code>${esc(rec.currentDependency.currentVersion)}</code></td></tr>
      <tr><td class="k">Target Version</td><td><code>${esc(rec.recommendedVersion)}</code></td></tr>
      <tr><td class="k">Source File</td><td><code>${esc(rec.sourceFile || "n/a")}</code></td></tr>
    </table>
    <h3>Rationale</h3>
    <p>${esc(rec.rationale)}</p>
    <h3>Breaking Changes</h3>
    ${breaking}
    <h3>Migration Steps</h3>
    ${migration}
    ${blockSection("Old Dependency Block", rec.oldDependencyBlock)}
    ${blockSection("New Dependency Block", rec.newDependencyBlock)}
  </body></html>`;
}

function blockSection(title: string, block: string): string {
  if (!block || block.trim() === "") return "";
  return `<h3>${esc(title)}</h3><pre>${esc(block)}</pre>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
