import * as path from "path";
import { workspaceRoot, log } from "../../core/context";
import { writeTextFile } from "../../util/files";
import { PromptTemplateService } from "../../core/promptTemplateService";
import { RemediationResult } from "../../models/security";

/**
 * Port of com.bmo.devai.intellij.util.SastReportWriter.
 *
 * Writes a human-readable Markdown summary of a SAST run to
 * .devai/reports/sast-fix-<timestamp>.md for auditability. The layout lives in
 * prompts/sast-fix-report.md and is rendered via PromptTemplateService.
 */
function escape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderRows(results: RemediationResult[]): string {
  return results
    .map(
      (r) =>
        "| " +
        r.status +
        " | " +
        r.severity +
        " | " +
        escape(r.finding.rule) +
        " | " +
        escape(r.finding.filePath) +
        ":" +
        r.finding.line +
        " | " +
        escape(r.finding.message) +
        " |"
    )
    .join("\n");
}

function timestamp(now: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

export class SastReportWriter {
  /** Write the report and return the absolute path written, or null on failure. Never throws. */
  static write(
    sourceLabel: string,
    mode: string,
    results: RemediationResult[]
  ): string | null {
    const base = workspaceRoot();
    if (!base) {
      log("Cannot write SAST report: workspace root is null");
      return null;
    }
    const now = new Date();
    const file = path.join(base, ".devai", "reports", "sast-fix-" + timestamp(now) + ".md");
    const body = PromptTemplateService.loadAndRender("sast-fix-report.md", {
      source: sourceLabel,
      mode,
      generated: now.toISOString(),
      findingCount: String(results.length),
      tableRows: renderRows(results),
    });
    try {
      writeTextFile(file, body);
      return file;
    } catch (e) {
      log("Failed to write SAST report: " + (e instanceof Error ? e.message : String(e)));
      return null;
    }
  }
}
