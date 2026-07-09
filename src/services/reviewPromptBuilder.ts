/**
 * Diff/review/fix prompt builders ported from com.bmo.devai.intellij.util.PromptBuilder.
 * These live in the review cluster because they depend on DiffSummary and CodeIssue
 * (the core PromptBuilder intentionally left them out).
 */
import { CodeSelection, ElementType, lineCount } from "../models";
import { PromptTemplateService } from "../core/promptTemplateService";
import { DiffSummary, diffSummaryTemplateVars } from "../models/diff";
import { CodeIssue, codeIssueTemplateVars } from "../models/review";
import {
  MAX_DIFF_LENGTH,
  buildChangedFilesEntry,
  buildChangedLinesEntry,
  buildFocusAreaString,
  buildSyntheticDiff,
  truncateDiff,
} from "./diffFormat";

/** Builds a diff-based review prompt from a DiffSummary. */
export function buildDiffReviewPrompt(diffSummary: DiffSummary): string {
  const vars: Record<string, string | null> = { ...diffSummaryTemplateVars(diffSummary) };
  vars.diffContent = truncateDiff(diffSummary.rawDiff, MAX_DIFF_LENGTH);
  vars.focusAreas = "";
  return PromptTemplateService.buildFullPrompt("code-review-system.md", "code-review-user.md", vars);
}

/** Builds a review prompt for a code selection or full-file review. */
export function buildCodeSelectionReviewPrompt(selection: CodeSelection, focusAreas: string[] | null): string {
  const isFullFile = selection.elementType === ElementType.FILE;
  const vars: Record<string, string | null> = {
    scope: isFullFile ? "Full File Review" : "Code Selection",
    baseBranch: "N/A",
    totalFiles: "1",
    totalAdditions: String(lineCount(selection)),
    totalDeletions: "0",
    changedFiles: buildChangedFilesEntry(selection.filePath, isFullFile),
    changedLines: buildChangedLinesEntry(selection.filePath, lineCount(selection), isFullFile),
    diffContent: buildSyntheticDiff(selection),
    focusAreas: buildFocusAreaString(focusAreas),
  };
  return PromptTemplateService.buildFullPrompt("code-review-system.md", "code-review-user.md", vars);
}

/** Builds a single-issue fix prompt. */
export function buildFixPrompt(issue: CodeIssue, fileContent: string): string {
  const vars: Record<string, string | null> = { ...codeIssueTemplateVars(issue, 1) };
  vars.fileContent = fileContent;
  return PromptTemplateService.buildFullPrompt("code-review-fix-system.md", "code-review-fix-user.md", vars);
}

/** Builds a batch (multi-issue) fix prompt for a single file. */
export function buildBatchFixPrompt(filePath: string, issues: CodeIssue[], fileContent: string): string {
  let issueList = "";
  for (let i = 0; i < issues.length; i++) {
    issueList += PromptTemplateService.loadAndRender("code-review-fix-issue.md", codeIssueTemplateVars(issues[i], i + 1));
  }
  return PromptTemplateService.buildFullPrompt("code-review-fix-system.md", "code-review-fix-all-user.md", {
    filePath,
    totalIssues: String(issues.length),
    issueList,
    fileContent,
  });
}

/**
 * Builds an API-drift detection prompt from the spec+code git diff.
 * Uses the chatmode api-drift.md template; the RAG conditional block is stripped
 * since RAG enrichment (when eligible) is applied by the core executor.
 */
export function buildApiDriftPrompt(changedFiles: string, diffContent: string): string {
  let template = PromptTemplateService.loadTemplate("chatmode/api-drift.md");
  // Strip the Handlebars-style RAG block ({{#if hasRagExamples}}...{{/if}}),
  // which the core template renderer does not understand.
  template = template.replace(/\{\{#if hasRagExamples\}\}[\s\S]*?\{\{\/if\}\}/g, "");
  return PromptTemplateService.render(template, {
    changedFiles,
    diffContent: truncateDiff(diffContent, MAX_DIFF_LENGTH),
  });
}
