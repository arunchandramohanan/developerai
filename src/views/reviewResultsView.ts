/**
 * TreeDataProvider for the `devai.reviewResultsView` view.
 * Port of the IntelliJ ReviewResultsPanel tree: findings are grouped by file,
 * then category, then individual issues (sorted by severity). The
 * settings().getMinSeverityToShow() threshold is applied here (display time).
 */
import * as vscode from "vscode";
import { settings } from "../core/settings";
import {
  CodeIssue,
  IssueCategory,
  ReviewResult,
  Severity,
  categoryDisplayName,
  codeIssueLineRange,
  severityDisplayName,
  severityFromString,
  severityIsAtLeast,
  severityPriority,
} from "../models/review";
import { baseName } from "../util/files";

export const OPEN_ISSUE_COMMAND = "devai.reviewResults.openIssue";

type NodeKind = "file" | "category" | "issue";

export interface ReviewNode {
  kind: NodeKind;
  label: string;
  filePath?: string;
  category?: IssueCategory;
  issue?: CodeIssue;
  children?: ReviewNode[];
  count?: number;
}

export class ReviewResultsProvider implements vscode.TreeDataProvider<ReviewNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ReviewNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private result: ReviewResult | null = null;

  setResult(result: ReviewResult | null): void {
    this.result = result;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.result = null;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getCurrentResult(): ReviewResult | null {
    return this.result;
  }

  /** Issues passing the configured minimum-severity threshold. */
  private visibleIssues(): CodeIssue[] {
    if (this.result == null) return [];
    const min = severityFromString(settings().getMinSeverityToShow());
    return this.result.issues.filter((i) => severityIsAtLeast(i.severity, min));
  }

  getTreeItem(node: ReviewNode): vscode.TreeItem {
    if (node.kind === "issue" && node.issue) {
      const issue = node.issue;
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = `${baseName(issue.filePath)}:${codeIssueLineRange(issue)}`;
      item.tooltip = new vscode.MarkdownString(
        `**${issue.title}**\n\n` +
          `_${categoryDisplayName(issue.category)} - ${severityDisplayName(issue.severity)}_\n\n` +
          issue.description
      );
      item.iconPath = severityIcon(issue.severity);
      item.contextValue = "reviewIssue";
      item.command = {
        command: OPEN_ISSUE_COMMAND,
        title: "Go to Issue",
        arguments: [issue],
      };
      return item;
    }

    if (node.kind === "category") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("tag");
      item.contextValue = "reviewCategory";
      return item;
    }

    // file
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = vscode.ThemeIcon.File;
    item.resourceUri = node.filePath ? vscode.Uri.file(node.filePath) : undefined;
    item.contextValue = "reviewFile";
    return item;
  }

  getChildren(node?: ReviewNode): ReviewNode[] {
    if (node) return node.children ?? [];

    const issues = this.visibleIssues();
    if (issues.length === 0) return [];

    // Group by file path, then category.
    const byFile = new Map<string, CodeIssue[]>();
    for (const issue of issues) {
      const list = byFile.get(issue.filePath);
      if (list) list.push(issue);
      else byFile.set(issue.filePath, [issue]);
    }

    const fileNodes: ReviewNode[] = [];
    for (const [filePath, fileIssues] of byFile) {
      const categoryNodes: ReviewNode[] = [];
      const byCategory = new Map<IssueCategory, CodeIssue[]>();
      for (const issue of fileIssues) {
        const list = byCategory.get(issue.category);
        if (list) list.push(issue);
        else byCategory.set(issue.category, [issue]);
      }
      for (const [category, catIssues] of byCategory) {
        const sorted = [...catIssues].sort((a, b) => severityPriority(a.severity) - severityPriority(b.severity));
        categoryNodes.push({
          kind: "category",
          category,
          count: sorted.length,
          label: `${categoryDisplayName(category)} (${sorted.length})`,
          children: sorted.map((issue) => ({
            kind: "issue",
            issue,
            label: `[${severityDisplayName(issue.severity)}] ${issue.title}`,
          })),
        });
      }
      fileNodes.push({
        kind: "file",
        filePath,
        count: fileIssues.length,
        label: `${baseName(filePath)} (${fileIssues.length})`,
        children: categoryNodes,
      });
    }
    return fileNodes;
  }
}

function severityIcon(severity: Severity): vscode.ThemeIcon {
  switch (severity) {
    case Severity.CRITICAL:
    case Severity.HIGH:
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
    case Severity.MEDIUM:
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
    default:
      return new vscode.ThemeIcon("info");
  }
}
