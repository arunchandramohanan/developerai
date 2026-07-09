import * as vscode from "vscode";
import * as path from "path";
import { workspaceRoot } from "../core/context";
import {
  RemediationResult,
  RemediationStatus,
  SecuritySeverity,
} from "../models/security";

/**
 * TreeDataProvider for the `devai.sastResultsView` view. Mirrors the role of
 * com.bmo.devai.intellij.ui.SastResultsPanel: findings grouped by severity, with
 * each leaf showing rule + file:line + message. Double-/single-clicking a leaf
 * opens the source file at the reported line.
 */

const SEVERITY_ORDER: SecuritySeverity[] = [
  SecuritySeverity.CRITICAL,
  SecuritySeverity.HIGH,
  SecuritySeverity.MEDIUM,
  SecuritySeverity.LOW,
];

interface SeverityNode {
  kind: "severity";
  severity: SecuritySeverity;
  results: RemediationResult[];
}

interface FindingNode {
  kind: "finding";
  result: RemediationResult;
}

type SastTreeNode = SeverityNode | FindingNode;

function statusLabel(s: RemediationStatus): string {
  switch (s) {
    case RemediationStatus.PROCESSED:
      return "processed";
    case RemediationStatus.PROPOSED:
      return "proposed";
    case RemediationStatus.FAILED:
      return "failed";
    default:
      return "unprocessed";
  }
}

function statusIcon(s: RemediationStatus): vscode.ThemeIcon {
  switch (s) {
    case RemediationStatus.PROCESSED:
      return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
    case RemediationStatus.PROPOSED:
      return new vscode.ThemeIcon("lightbulb", new vscode.ThemeColor("charts.yellow"));
    case RemediationStatus.FAILED:
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    default:
      return new vscode.ThemeIcon("eye");
  }
}

function severityIcon(s: SecuritySeverity): vscode.ThemeIcon {
  switch (s) {
    case SecuritySeverity.CRITICAL:
    case SecuritySeverity.HIGH:
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    case SecuritySeverity.MEDIUM:
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
    default:
      return new vscode.ThemeIcon("info");
  }
}

export class SastResultsProvider implements vscode.TreeDataProvider<SastTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SastTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private results: RemediationResult[] = [];
  private sourceLabel = "";

  setResults(results: RemediationResult[], sourceLabel: string): void {
    this.results = results;
    this.sourceLabel = sourceLabel;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.results = [];
    this.sourceLabel = "";
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: SastTreeNode): vscode.TreeItem {
    if (node.kind === "severity") {
      const item = new vscode.TreeItem(
        `${node.severity} (${node.results.length})`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = severityIcon(node.severity);
      item.contextValue = "sastSeverity";
      return item;
    }
    const r = node.result;
    const item = new vscode.TreeItem(
      `${r.finding.filePath}:${r.finding.line}`,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = `[${r.finding.rule}] ${r.finding.message}`;
    item.tooltip = `${statusLabel(r.status)} — ${r.message}\n${r.finding.rule}\n${r.finding.message}`;
    item.iconPath = statusIcon(r.status);
    item.contextValue = "sastFinding";
    const abs = this.absolutePath(r.finding.filePath);
    if (abs) {
      item.resourceUri = vscode.Uri.file(abs);
      item.command = {
        command: "vscode.open",
        title: "Open Finding",
        arguments: [
          vscode.Uri.file(abs),
          {
            selection: new vscode.Range(
              Math.max(0, r.finding.line - 1),
              0,
              Math.max(0, r.finding.line - 1),
              0
            ),
          } as vscode.TextDocumentShowOptions,
        ],
      };
    }
    return item;
  }

  getChildren(node?: SastTreeNode): SastTreeNode[] {
    if (!node) {
      const out: SastTreeNode[] = [];
      for (const severity of SEVERITY_ORDER) {
        const bucket = this.results.filter((r) => r.severity === severity);
        if (bucket.length > 0) out.push({ kind: "severity", severity, results: bucket });
      }
      return out;
    }
    if (node.kind === "severity") {
      return node.results.map((result) => ({ kind: "finding", result }));
    }
    return [];
  }

  private absolutePath(filePath: string): string | null {
    if (!filePath) return null;
    if (path.isAbsolute(filePath)) return filePath;
    const base = workspaceRoot();
    return base ? path.join(base, filePath) : null;
  }

  /** Header label describing the current source (used by the feature layer). */
  getSourceLabel(): string {
    return this.sourceLabel;
  }
}
