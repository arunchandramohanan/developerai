/**
 * Diff domain models, ported from com.bmo.devai.intellij.models.diff.
 * Records with helper methods become interfaces + free functions.
 */

// ---- DiffScope ------------------------------------------------------------

export enum DiffScope {
  /** Compare current branch against the default/main branch. */
  FEATURE_BRANCH = "FEATURE_BRANCH",
  /** All uncommitted changes (staged + unstaged). */
  UNCOMMITTED = "UNCOMMITTED",
  /** Only staged changes (git add). */
  STAGED = "STAGED",
  /** Changes in the currently open file. */
  CURRENT_FILE = "CURRENT_FILE",
}

const DIFF_SCOPE_META: Record<DiffScope, { displayName: string; description: string }> = {
  [DiffScope.FEATURE_BRANCH]: { displayName: "Feature Branch", description: "Review all changes on this branch vs main" },
  [DiffScope.UNCOMMITTED]: { displayName: "Uncommitted Changes", description: "Review all uncommitted changes" },
  [DiffScope.STAGED]: { displayName: "Staged Changes", description: "Review only staged changes" },
  [DiffScope.CURRENT_FILE]: { displayName: "Current File", description: "Review changes in the current file" },
};

export function diffScopeDisplayName(scope: DiffScope): string { return DIFF_SCOPE_META[scope].displayName; }
export function diffScopeDescription(scope: DiffScope): string { return DIFF_SCOPE_META[scope].description; }

// ---- ChangeType -----------------------------------------------------------

export enum ChangeType {
  ADDED = "ADDED",
  MODIFIED = "MODIFIED",
  DELETED = "DELETED",
  RENAMED = "RENAMED",
}

const CHANGE_TYPE_DISPLAY: Record<ChangeType, string> = {
  [ChangeType.ADDED]: "Added",
  [ChangeType.MODIFIED]: "Modified",
  [ChangeType.DELETED]: "Deleted",
  [ChangeType.RENAMED]: "Renamed",
};

export function changeTypeDisplayName(t: ChangeType): string { return CHANGE_TYPE_DISPLAY[t]; }

// ---- DiffHunk -------------------------------------------------------------

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  content: string;
}

export function hunkLineRange(hunk: DiffHunk): string {
  if (hunk.newCount <= 1) return String(hunk.newStart);
  return `${hunk.newStart}-${hunk.newStart + hunk.newCount - 1}`;
}

// ---- DiffChange -----------------------------------------------------------

export interface DiffChange {
  filePath: string;
  changeType: ChangeType;
  oldFilePath: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export function changeFullDiffContent(change: DiffChange): string {
  return change.hunks.map((h) => h.content).join("");
}

export function changeTotalChanges(change: DiffChange): number {
  return change.additions + change.deletions;
}

export function changeFileName(change: DiffChange): string {
  const lastSlash = change.filePath.lastIndexOf("/");
  return lastSlash >= 0 ? change.filePath.substring(lastSlash + 1) : change.filePath;
}

// ---- DiffSummary ----------------------------------------------------------

export interface DiffSummary {
  scope: DiffScope;
  changes: DiffChange[];
  totalAdditions: number;
  totalDeletions: number;
  rawDiff: string;
  baseBranch: string | null;
}

export function diffFileCount(summary: DiffSummary): number {
  return summary.changes.length;
}

export function diffHasChanges(summary: DiffSummary): boolean {
  return summary.changes.length > 0;
}

export function diffTotalChanges(summary: DiffSummary): number {
  return summary.totalAdditions + summary.totalDeletions;
}

export function diffChangedFilesList(summary: DiffSummary): string {
  let sb = "";
  for (const change of summary.changes) {
    sb +=
      `- ${change.filePath} (${changeTypeDisplayName(change.changeType)}, +${change.additions}/-${change.deletions})\n`;
  }
  return sb;
}

export function diffChangedLinesSummary(summary: DiffSummary): string {
  let sb = "";
  for (const change of summary.changes) {
    if (change.hunks.length === 0) continue;
    sb += `**${change.filePath}**:\n`;
    for (const hunk of change.hunks) {
      if (hunk.newCount > 0) {
        sb += `  - Lines ${hunk.newStart}-${hunk.newStart + hunk.newCount - 1} (new)\n`;
      }
      if (hunk.oldCount > 0) {
        sb += `  - Lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldCount - 1} (removed)\n`;
      }
    }
  }
  return sb;
}

/** Builds the template-variable map used by prompt templates. */
export function diffSummaryTemplateVars(summary: DiffSummary): Record<string, string> {
  return {
    scope: diffScopeDisplayName(summary.scope),
    baseBranch: summary.baseBranch != null ? summary.baseBranch : "N/A",
    totalFiles: String(diffFileCount(summary)),
    totalAdditions: String(summary.totalAdditions),
    totalDeletions: String(summary.totalDeletions),
    changedFiles: diffChangedFilesList(summary),
    changedLines: diffChangedLinesSummary(summary),
    diffContent: summary.rawDiff,
  };
}
