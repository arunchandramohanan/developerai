import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { SonatypeApiClient } from "./sonatypeApiClient";
import { readTextFile, writeAndOpen, baseName } from "../util/files";
import { resolveAvailableMarkdownPath } from "../util/response";
import { resourcePath, workspaceRoot, log, logError } from "../core/context";
import { notifyError, notifyInfo } from "../util/notify";

/**
 * Port of com.bmo.devai.intellij.services.impl.DependencyMigrationServiceImpl.
 *
 * Two-step workflow (UC-12):
 *   1. analyzeImpact — fetch Sonatype IQ reports, run dependency impact analysis,
 *      and write the analysis report as markdown.
 *   2. migrateDependency — take the approved analysis report and generate the
 *      migration code changes.
 *
 * The IntelliJ service delegates prompt delivery to Chat Mode; here we build the
 * chat-mode prompt templates directly and run them through the core executor.
 */
export class DependencyMigrationService {
  private readonly sonatype = SonatypeApiClient.getInstance();

  /**
   * Runs full-project dependency impact analysis.
   * @param stageVersion Sonatype pipeline stage — "build" or "develop".
   */
  async analyzeImpact(stageVersion: string): Promise<void> {
    const projectBase = workspaceRoot();
    if (!projectBase) {
      notifyError("Cannot determine project base path.");
      return;
    }

    // Clean up stale reports from any prior aborted run
    cleanupSonatypeReports(projectBase);

    let reportPaths: string[] = [];
    try {
      reportPaths = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Analyze Dependency Migration", cancellable: false },
        async (progress) => {
          progress.report({ message: `Fetching Sonatype IQ reports (${stageVersion})…` });
          return this.sonatype.fetchReports(projectBase, stageVersion);
        }
      );
    } catch (e) {
      logError("Dependency analysis: Sonatype fetch failed", e);
    }

    if (reportPaths.length === 0) {
      notifyError(
        "Sonatype IQ Unavailable: failed to retrieve dependency reports. " +
          "Verify the Sonatype server availability and your credentials in settings, then try again."
      );
      return;
    }

    const reportList = reportPaths.map((p) => `- ${p}`).join("\n");
    const prompt = renderChatModeTemplate("dependency-analysis", { sonatypeReportPaths: reportList }, {});

    let content: string;
    try {
      content = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Analyze Dependency Migration", cancellable: false },
        async (progress) => {
          progress.report({ message: "Analyzing dependencies…" });
          return executeForContent(
            newRequest(OperationType.DEPENDENCY_ANALYSIS, null, prompt, { workingDirectory: projectBase })
          );
        }
      );
    } catch (e) {
      notifyError("Dependency analysis failed: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    const outputPath = resolveAvailableMarkdownPath(projectBase, "Dependency-Migration-Report");
    await writeAndOpen(outputPath, content);
    notifyInfo(`Dependency analysis complete: ${baseName(outputPath)} created.`);
  }

  /**
   * Runs dependency migration code generation from a previously approved report.
   * @param reportPath absolute path to the Dependency-Migration-Report.md file.
   */
  async migrateDependency(reportPath: string): Promise<void> {
    const projectBase = workspaceRoot();
    const reportContent = readTextFile(reportPath);
    if (reportContent == null || reportContent.trim() === "") {
      notifyError("The migration report file is empty or could not be read.");
      return;
    }

    const prompt = renderChatModeTemplate(
      "dependency-migration",
      { fileName: baseName(reportPath), fileContent: reportContent, language: "markdown" },
      {}
    );

    let content: string;
    try {
      content = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Execute Dependency Migration", cancellable: false },
        async (progress) => {
          progress.report({ message: "Generating migration changes…" });
          return executeForContent(
            newRequest(OperationType.DEPENDENCY_MIGRATION, null, prompt, {
              workingDirectory: projectBase ?? "",
            })
          );
        }
      );
    } catch (e) {
      notifyError("Dependency migration failed: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    const outputDir = projectBase ?? path.dirname(reportPath);
    const outputPath = resolveAvailableMarkdownPath(outputDir, "Dependency-Migration-Changes");
    await writeAndOpen(outputPath, content);
    notifyInfo(`Dependency migration complete: ${baseName(outputPath)} created.`);
  }
}

/**
 * Deletes the {@code sonatype-reports/} directory and its contents so stale JSON
 * from a prior aborted run does not pollute the analysis.
 */
function cleanupSonatypeReports(projectBasePath: string): void {
  const reportDir = path.join(projectBasePath, "sonatype-reports");
  try {
    if (fs.existsSync(reportDir)) {
      fs.rmSync(reportDir, { recursive: true, force: true });
      log("Cleaned up stale sonatype-reports/ directory");
    }
  } catch (e) {
    logError("Failed to clean up sonatype-reports/ directory", e);
  }
}

/**
 * Lightweight renderer for the chatmode/* templates, which use handlebars-style
 * {{#if flag}}…{{/if}} conditionals and {{var}} placeholders (a different syntax
 * from the core PromptTemplateService). Unset conditional blocks are stripped;
 * set ones are unwrapped; then {{var}} placeholders are substituted.
 */
function renderChatModeTemplate(
  name: string,
  vars: Record<string, string>,
  flags: Record<string, boolean>
): string {
  let template: string;
  try {
    template = fs.readFileSync(resourcePath("prompts", "chatmode", name), "utf8");
  } catch (e) {
    logError(`Chatmode template not found: ${name}`, e);
    template = "";
  }

  // Resolve {{#if flag}}…{{/if}} blocks
  const ifRe = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  template = template.replace(ifRe, (_full, flag: string, body: string) => (flags[flag] ? body : ""));

  // Substitute {{var}} placeholders
  for (const key of Object.keys(vars)) {
    template = template.split(`{{${key}}}`).join(vars[key]);
  }
  return template;
}
