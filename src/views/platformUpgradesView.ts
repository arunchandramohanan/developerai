import * as vscode from "vscode";
import {
  UpgradeRecommendation,
  recommendationLabel,
  recommendationHasBreakingChanges,
  isUpgradeNeeded,
} from "../models/upgrade";

/** A node in the Platform Upgrades tree. */
export interface UpgradeNode {
  kind: "recommendation" | "field" | "listItem" | "empty";
  label: string;
  description?: string;
  rec?: UpgradeRecommendation;
  /** Sub-items (breaking changes / migration steps) for expandable field nodes. */
  items?: string[];
}

export const SHOW_DETAIL_COMMAND = "devai.platformUpgrades.showDetail";

/**
 * TreeDataProvider for the {@code devai.platformUpgradesView} view (port of the
 * PlatformUpgradePanel / UpgradeRecommendationsDialog presentation). Each
 * recommendation is a top-level node; expanding it reveals detail fields.
 */
export class PlatformUpgradesProvider implements vscode.TreeDataProvider<UpgradeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<UpgradeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private recommendations: UpgradeRecommendation[] = [];

  setRecommendations(recommendations: UpgradeRecommendation[]): void {
    this.recommendations = recommendations;
    this._onDidChangeTreeData.fire();
  }

  getRecommendations(): UpgradeRecommendation[] {
    return this.recommendations;
  }

  clear(): void {
    this.recommendations = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: UpgradeNode): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = node.description;
      return item;
    }

    if (node.kind === "recommendation") {
      const rec = node.rec!;
      const needed = isUpgradeNeeded(rec);
      const item = new vscode.TreeItem(
        recommendationLabel(rec),
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = rec.severity + (needed ? "" : " (no upgrade needed)");
      item.tooltip = rec.rationale;
      item.iconPath = new vscode.ThemeIcon(iconForSeverity(rec.severity, needed));
      item.contextValue = needed ? "upgradeRecommendation" : "upgradeRecommendationNoop";
      item.command = { command: SHOW_DETAIL_COMMAND, title: "Show Upgrade Details", arguments: [rec] };
      return item;
    }

    if (node.kind === "field") {
      const collapsible =
        node.items && node.items.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(node.label, collapsible);
      item.description = node.description;
      return item;
    }

    // listItem
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = node.label;
    return item;
  }

  getChildren(element?: UpgradeNode): UpgradeNode[] {
    if (!element) {
      if (this.recommendations.length === 0) {
        return [
          {
            kind: "empty",
            label: "No recommendations",
            description: "Run 'Automate Platform and Framework Upgrades' to scan.",
          },
        ];
      }
      return this.recommendations.map((rec) => ({ kind: "recommendation", label: recommendationLabel(rec), rec }));
    }

    if (element.kind === "recommendation") {
      const rec = element.rec!;
      const fields: UpgradeNode[] = [
        { kind: "field", label: "Name", description: rec.currentDependency.name },
        { kind: "field", label: "Current Version", description: rec.currentDependency.currentVersion },
        { kind: "field", label: "Target Version", description: rec.recommendedVersion },
        { kind: "field", label: "Type", description: rec.currentDependency.type },
        { kind: "field", label: "Risk", description: rec.severity },
        { kind: "field", label: "Rationale", description: rec.rationale },
      ];
      fields.push({
        kind: "field",
        label: "Breaking Changes",
        description: recommendationHasBreakingChanges(rec) ? String(rec.breakingChanges.length) : "none",
        items: rec.breakingChanges,
      });
      fields.push({
        kind: "field",
        label: "Migration Steps",
        description: rec.migrationSteps.length > 0 ? String(rec.migrationSteps.length) : "none",
        items: rec.migrationSteps,
      });
      return fields;
    }

    if (element.kind === "field" && element.items) {
      return element.items.map((s) => ({ kind: "listItem", label: s }));
    }

    return [];
  }
}

function iconForSeverity(severity: string, needed: boolean): string {
  if (!needed) return "check";
  switch (severity.toUpperCase()) {
    case "CRITICAL":
    case "HIGH":
      return "error";
    case "MEDIUM":
      return "warning";
    default:
      return "arrow-up";
  }
}
