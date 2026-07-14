import { OperationType } from "../models";
import { stripCodeFences } from "../util/response";
import { log } from "../core/context";
import { AiCodeMetrics, metricsHasChanges, reportCodeMetrics } from "./aiCodeCapture";

/**
 * Port of com.bmo.devai.intellij.services.impl.SdkCodeMetricsReporter +
 * util.ResponseMetricsUtil.
 *
 * Reports use-case-specific analytics metrics for the SDK / CLI execution path
 * by reading the AI's response directly. Unlike Chat Mode (which is blindfolded
 * and polls git), the CLI runs synchronously and its full output is captured
 * deterministically — so metrics are counted straight from the response text,
 * regardless of whether the user accepts the generation.
 *
 * Every function is fire-and-forget and never throws.
 */

/**
 * Small delay before posting the metric, mirroring the IntelliJ reporter (it
 * gives the audit transaction posted on the same call time to land first).
 */
const REPORT_DELAY_MS = 10_000;

// ---- ResponseMetricsUtil port ----------------------------------------------

/** Counts non-blank lines in the text. */
export function nonBlankLines(content: string): number {
  return content.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0).length;
}

/** Counts markdown headers of level 1-3 (`#`, `##`, `###` followed by text). */
export function headerCount(content: string): number {
  return content.split(/\r\n|\r|\n/).filter(isMarkdownHeader).length;
}

function isMarkdownHeader(line: string): boolean {
  const s = line.trim();
  let hashes = 0;
  while (hashes < s.length && s.charAt(hashes) === "#") hashes++;
  return hashes >= 1 && hashes <= 3 && hashes < s.length && /\s/.test(s.charAt(hashes));
}

/**
 * Counts fenced code blocks and the non-blank lines inside them.
 * @returns `[blockCount, codeLineCount]`
 */
export function countFences(content: string): [number, number] {
  let blocks = 0;
  let codeLines = 0;
  let inside = false;
  for (const line of content.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inside) {
        inside = true;
        blocks++;
      } else {
        inside = false;
      }
      continue;
    }
    if (inside && trimmed.length > 0) codeLines++;
  }
  return [blocks, codeLines];
}

// ---- Counting ----------------------------------------------------------------

/**
 * Derives {@link AiCodeMetrics} from the response text for the given operation.
 * Returns null when there is nothing meaningful to report (blank response, or CHAT).
 */
export function countFromResponse(type: OperationType, content: string | null | undefined): AiCodeMetrics | null {
  if (!content || content.trim().length === 0) return null;
  switch (type) {
    // Text ops — the deliverable is prose; count non-blank lines.
    case OperationType.CODE_REVIEW:
    case OperationType.TEST_SCENARIOS:
    case OperationType.BUSINESS_SUMMARY:
    case OperationType.GENERATE_USER_STORIES:
      return linesMetric(nonBlankLines(content));

    // Tickets — count markdown headers (at least one).
    case OperationType.GENERATE_STORY:
      return { filesChanged: Math.max(1, headerCount(content)), linesAdded: 0, linesDeleted: 0 };

    // A single diagram artifact.
    case OperationType.GENERATE_UML_DIAGRAM:
      return { filesChanged: 1, linesAdded: 0, linesDeleted: 0 };

    // Structured JSON — parse for exact counts (fallback to generic).
    case OperationType.FEATURE_UPDATE:
      return countFeatureUpdate(content);
    case OperationType.FIX_SAST_FINDINGS:
      return countSastFindings(content);

    // Code-generating / analysis ops — count fenced code, else text.
    case OperationType.GENERATE_TESTS:
    case OperationType.GENERATE_DOCUMENTATION:
    case OperationType.GENERATE_README:
    case OperationType.GENERATE_SCAFFOLD:
    case OperationType.GENERATE_FEATURE_CODE:
    case OperationType.GENERATE_SHAKEDOWN_TESTS:
    case OperationType.UPDATE_DOCUMENTATION:
    case OperationType.PLATFORM_UPGRADE:
    case OperationType.API_DRIFT:
    case OperationType.DEPENDENCY_ANALYSIS:
    case OperationType.DEPENDENCY_MIGRATION:
    case OperationType.APPLY_FIX:
      return countGeneric(content);

    // No per-use-case metric for free-form chat.
    case OperationType.CHAT:
      return null;
  }
}

/**
 * Generic counter for code-generating responses: fenced code blocks become
 * files and the non-blank lines inside them become generated lines. When the
 * response carries no fences, treats it as a single file with the response's
 * non-blank line count.
 */
function countGeneric(content: string): AiCodeMetrics | null {
  const [blocks, codeLines] = countFences(content);
  if (blocks > 0) {
    return { filesChanged: blocks, linesAdded: codeLines, linesDeleted: 0 };
  }
  const nb = nonBlankLines(content);
  if (nb === 0) return null;
  return { filesChanged: 1, linesAdded: nb, linesDeleted: 0 };
}

/**
 * Parses a FEATURE_UPDATE JSON response ({summary, files[].patches[].updatedBlock})
 * into exact file and updated-line counts. Falls back to {@link countGeneric}
 * if the response is not the expected JSON.
 */
function countFeatureUpdate(content: string): AiCodeMetrics | null {
  try {
    const parsed: unknown = JSON.parse(stripCodeFences(content));
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return countGeneric(content);
    }
    const files = (parsed as { files?: unknown }).files;
    if (!Array.isArray(files)) return countGeneric(content);

    let fileCount = 0;
    let lineCount = 0;
    for (const fileElem of files) {
      if (fileElem == null || typeof fileElem !== "object") continue;
      fileCount++;
      lineCount += countUpdatedLines(fileElem as { patches?: unknown });
    }
    if (fileCount === 0 && lineCount === 0) return null;
    // Backend reads linesUpdated = linesAdded; filesChanged is carried too.
    return { filesChanged: fileCount, linesAdded: lineCount, linesDeleted: 0 };
  } catch (e) {
    log("countFeatureUpdate parse failed, using generic: " + (e instanceof Error ? e.message : String(e)));
    return countGeneric(content);
  }
}

/** Sums the non-blank lines across one feature-update file's patches[].updatedBlock entries. */
function countUpdatedLines(fileObj: { patches?: unknown }): number {
  if (!Array.isArray(fileObj.patches)) return 0;
  let lines = 0;
  for (const patchElem of fileObj.patches) {
    if (patchElem == null || typeof patchElem !== "object") continue;
    const updated = (patchElem as { updatedBlock?: unknown }).updatedBlock;
    if (typeof updated === "string") lines += nonBlankLines(updated);
  }
  return lines;
}

/**
 * Counts a FIX_SAST_FINDINGS JSON-array response. Each element with a non-blank
 * replacementSnippet is a fixed issue. Falls back to {@link countGeneric} if
 * the response is not a JSON array.
 */
function countSastFindings(content: string): AiCodeMetrics | null {
  try {
    const parsed: unknown = JSON.parse(stripCodeFences(content));
    if (!Array.isArray(parsed)) return countGeneric(content);
    let fixed = 0;
    for (const elem of parsed) {
      if (elem == null || typeof elem !== "object") continue;
      const replacement = (elem as { replacementSnippet?: unknown }).replacementSnippet;
      if (typeof replacement === "string" && replacement.trim().length > 0) fixed++;
    }
    if (fixed === 0) return null;
    // Backend reads issuesFixed = filesChanged.
    return { filesChanged: fixed, linesAdded: 0, linesDeleted: 0 };
  } catch (e) {
    log("countSastFindings parse failed, using generic: " + (e instanceof Error ? e.message : String(e)));
    return countGeneric(content);
  }
}

/** Builds a lines-only metric (files = 0), or null when count is 0. */
function linesMetric(lines: number): AiCodeMetrics | null {
  return lines > 0 ? { filesChanged: 0, linesAdded: lines, linesDeleted: 0 } : null;
}

// ---- Public API (called by CopilotSdkExecutor) -------------------------------

/**
 * Computes use-case-specific metrics from a successful SDK response and reports
 * them after a short delay. Reads the AI output directly — no git, no disk, no
 * polling. Never throws.
 */
export function reportFromResponse(opType: OperationType | null | undefined, content: string | null | undefined): void {
  try {
    if (opType == null) return;
    const metrics = countFromResponse(opType, content);
    if (metrics == null || !metricsHasChanges(metrics)) return;
    const timer = setTimeout(() => {
      try {
        log(`SDK code metrics (from response): op=${opType} files=${metrics.filesChanged} +${metrics.linesAdded} -${metrics.linesDeleted}`);
        reportCodeMetrics(opType, metrics);
      } catch (e) {
        log("SDK reportCodeMetrics failed (non-blocking): " + (e instanceof Error ? e.message : String(e)));
      }
    }, REPORT_DELAY_MS);
    // Don't keep the extension host alive just for a metrics post.
    timer.unref?.();
  } catch (e) {
    log("SDK reportFromResponse failed (non-blocking): " + (e instanceof Error ? e.message : String(e)));
  }
}
