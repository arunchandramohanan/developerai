/**
 * Port of com.bmo.devai.intellij.util.DiffFormatUtil (kept in the review
 * cluster because src/util is core and off-limits).
 * Formatting helpers for diff content and review metadata.
 */
import { CodeSelection, lineCount } from "../models";

export const MAX_DIFF_LENGTH = 30_000;

/**
 * Generates a synthetic unified-diff from a code selection.
 * Used when reviewing a file or selection that has no real diff.
 */
export function buildSyntheticDiff(selection: CodeSelection): string {
  let sb = "";
  sb += "--- /dev/null\n";
  sb += `+++ b/${selection.filePath}\n`;
  sb += `@@ -0,0 +1,${lineCount(selection)} @@\n`;
  for (const line of selection.text.split("\n")) {
    sb += `+${line}\n`;
  }
  return sb;
}

/** Builds the focus-areas section for a review prompt. */
export function buildFocusAreaString(focusAreas: string[] | null): string {
  if (focusAreas == null || focusAreas.length === 0) return "";
  return "### Focus Areas\nPlease pay special attention to: " + focusAreas.join(", ");
}

/** Formats a single changed-file entry (e.g. "- Foo.java (full file)"). */
export function buildChangedFilesEntry(filePath: string, isFullFile: boolean): string {
  return "- " + filePath + (isFullFile ? " (full file)" : " (selected code)");
}

/** Formats a changed-lines summary entry for a single file. */
export function buildChangedLinesEntry(filePath: string, count: number, isFullFile: boolean): string {
  return "**" + filePath + "**:\n  - Lines 1-" + count + (isFullFile ? " (entire file)\n" : " (selected)\n");
}

/** Truncates a diff string to a maximum length, appending an indicator if truncated. */
export function truncateDiff(diff: string, maxLength: number): string {
  if (diff.length <= maxLength) return diff;
  return diff.substring(0, maxLength) + "\n\n... (diff truncated, " + (diff.length - maxLength) + " characters omitted)";
}
