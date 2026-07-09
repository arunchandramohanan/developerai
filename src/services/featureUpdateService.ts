import * as vscode from "vscode";
import * as path from "path";
import { CodePatch, UpdateResult, emptyUpdateResult } from "../models/delivery";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { PromptTemplateService } from "../core/promptTemplateService";
import { readTextFile, writeTextFile, openFile } from "../util/files";
import { workspaceRoot, log, logError } from "../core/context";
import { notifyError, notifyInfo } from "../util/notify";
import { showPatchPreview } from "../views/featurePatchPreview";

/**
 * Port of com.bmo.devai.intellij.services.impl.FeatureUpdateServiceImpl.
 *
 * Sends revised requirements to the AI executor (which uses read-only agentic
 * tools to discover/read affected files) and receives targeted search-and-replace
 * patches. The patches are previewed, then applied as block-level replacements.
 */
const TEMPLATE_NAME = "feature-code-update.md";

export class FeatureUpdateService {
  /** Builds the prompt by loading the template and injecting requirements. */
  buildPrompt(requirementsContent: string): string {
    return PromptTemplateService.loadAndRender(TEMPLATE_NAME, {
      requirements: requirementsContent,
      ragExamples: "", // populated by RAG integration if available
    });
  }

  /** Parses the JSON patch response from the LLM into an UpdateResult. */
  parsePatchResponse(response: string, projectRoot: string): UpdateResult {
    let trimmed = response.trim();
    log(`FeatureUpdate: raw LLM response length ${trimmed.length}`);

    // Strip markdown code fences if the LLM wraps the JSON
    if (trimmed.startsWith("```")) {
      const firstNewline = trimmed.indexOf("\n");
      const lastFence = trimmed.lastIndexOf("```");
      if (firstNewline > 0 && lastFence > firstNewline) {
        trimmed = trimmed.substring(firstNewline + 1, lastFence).trim();
      }
    }

    // Try to isolate the JSON object if surrounded by prose
    if (!trimmed.startsWith("{")) {
      const jsonStart = trimmed.indexOf("{");
      const jsonEnd = trimmed.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        trimmed = trimmed.substring(jsonStart, jsonEnd + 1);
      }
    }

    try {
      const root = JSON.parse(trimmed) as {
        summary?: string;
        files?: Array<{ filePath?: string; patches?: Array<Record<string, string>> }>;
      };

      const summary = typeof root.summary === "string" ? root.summary : "Feature update";
      const patches: CodePatch[] = [];
      const rootPath = path.resolve(projectRoot);

      for (const f of root.files ?? []) {
        const filePath = f.filePath ?? "";
        if (filePath === "") continue;

        // Security: reject paths that escape the project root
        const absPath = path.resolve(rootPath, filePath);
        if (!isInside(rootPath, absPath)) {
          log(`FeatureUpdate: skipping file outside project root: ${filePath}`);
          continue;
        }

        for (const p of f.patches ?? []) {
          const originalBlock = p["originalBlock"] ?? "";
          const updatedBlock = p["updatedBlock"] ?? "";
          const changeReason = p["changeReason"] ?? "";
          if (originalBlock === "") continue;
          patches.push({ filePath, originalBlock, updatedBlock, changeReason });
        }
      }

      const affectedFiles = Array.from(new Set(patches.map((p) => p.filePath)));
      return { summary, affectedFiles, patches };
    } catch (e) {
      logError("FeatureUpdate: failed to parse response as JSON", e);
      return emptyUpdateResult("Failed to parse response: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /**
   * Executes the full feature-update workflow: reads requirements, builds a
   * prompt, calls the executor, parses patches, previews, and applies approved
   * patches as block-level replacements.
   */
  async executeCliUpdate(requirementsFilePath: string, jiraTicketKey: string | null): Promise<void> {
    const projectRoot = workspaceRoot();
    if (!projectRoot) {
      notifyError("Cannot determine project base path.");
      return;
    }

    const requirementsContent = readTextFile(requirementsFilePath);
    if (requirementsContent == null || requirementsContent.trim() === "") {
      notifyError("The requirements file is empty or could not be read.");
      return;
    }

    const prompt = this.buildPrompt(requirementsContent);
    const startTime = Date.now();

    let content: string;
    try {
      content = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Update Feature Code", cancellable: false },
        async (progress) => {
          progress.report({ message: "Analyzing codebase via Copilot…" });
          return executeForContent(
            newRequest(OperationType.FEATURE_UPDATE, null, prompt, {
              targetName: jiraTicketKey ?? "feature-update",
              workingDirectory: projectRoot,
            })
          );
        }
      );
    } catch (e) {
      notifyError("Update failed: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    const updateResult = this.parsePatchResponse(content, projectRoot);
    if (updateResult.patches.length === 0) {
      notifyInfo("No changes proposed. " + updateResult.summary);
      return;
    }

    const approved = await showPatchPreview(updateResult);
    if (approved == null) {
      notifyInfo("Feature update: all changes discarded.");
      return;
    }
    if (approved.length === 0) {
      notifyInfo("Feature update: no changes were selected for application.");
      return;
    }

    const modified = await this.applyApprovedPatches(approved, projectRoot);
    const durationMs = Date.now() - startTime;
    notifyInfo(
      `Feature Update Complete: ${approved.length} patch(es) applied across ${modified.length} file(s) in ${(
        durationMs / 1000
      ).toFixed(1)}s.`
    );
  }

  /**
   * Applies approved patches by block-level search-and-replace, grouped by file.
   * Returns the list of modified relative paths.
   */
  private async applyApprovedPatches(approvedPatches: CodePatch[], projectRoot: string): Promise<string[]> {
    const rootPath = path.resolve(projectRoot);
    const modified: string[] = [];

    // Group patches by file to apply sequentially
    const byFile = new Map<string, CodePatch[]>();
    for (const patch of approvedPatches) {
      const list = byFile.get(patch.filePath) ?? [];
      list.push(patch);
      byFile.set(patch.filePath, list);
    }

    for (const [relPath, patches] of byFile) {
      const resolved = path.resolve(rootPath, relPath);
      if (!isInside(rootPath, resolved)) {
        log(`FeatureUpdate: rejected patch path outside project: ${relPath}`);
        continue;
      }
      const original = readTextFile(resolved);
      if (original == null) {
        log(`FeatureUpdate: file not found for patch: ${resolved}`);
        continue;
      }

      let content = normalizeLineEndings(original);
      let anyApplied = false;

      for (const patch of patches) {
        const originalBlock = normalizeLineEndings(patch.originalBlock);
        const updatedBlock = normalizeLineEndings(patch.updatedBlock);

        // Skip if the patch was already applied
        if (content.includes(updatedBlock) && !content.includes(originalBlock)) {
          log(`FeatureUpdate: patch already applied in ${relPath}, skipping`);
          continue;
        }
        const idx = content.indexOf(originalBlock);
        if (idx < 0) {
          log(`FeatureUpdate: original block not found in ${relPath}`);
          continue;
        }
        content = content.substring(0, idx) + updatedBlock + content.substring(idx + originalBlock.length);
        anyApplied = true;
      }

      if (anyApplied) {
        writeTextFile(resolved, content);
        modified.push(relPath);
        log(`FeatureUpdate: applied ${patches.length} patch(es) to ${relPath}`);
      }
    }

    if (modified.length > 0) {
      await openFile(path.resolve(rootPath, modified[0]));
    }
    return modified;
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
