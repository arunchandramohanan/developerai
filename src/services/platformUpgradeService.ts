import { DependencyInfo, UpgradeRecommendation } from "../models/upgrade";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { PromptTemplateService } from "../core/promptTemplateService";
import { parseJsonLenient } from "../util/json";
import { writeAndOpen } from "../util/files";
import { resolveAvailableMarkdownPath } from "../util/response";
import { workspaceRoot, log, logError } from "../core/context";

/**
 * Port of the PlatformDetectService / PlatformAnalyzeService /
 * PlatformUpgradeService (+ PlatformUpgradeSupport) trio.
 *
 * Runs the three-stage platform-upgrade flow through the core executor:
 *   1. detect  — find dependency manifest files in the workspace
 *   2. analyze — produce an upgrade inventory with migration guidance
 *   3. apply   — batch-apply approved upgrades and produce a markdown report
 */
export class PlatformUpgradeService {
  private static _instance: PlatformUpgradeService | undefined;
  private processing = false;

  static getInstance(): PlatformUpgradeService {
    if (!PlatformUpgradeService._instance) PlatformUpgradeService._instance = new PlatformUpgradeService();
    return PlatformUpgradeService._instance;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  /** Scan project dependencies and return upgrade recommendations. */
  async scanAndRecommend(onProgress?: (message: string) => void): Promise<UpgradeRecommendation[]> {
    if (this.processing) throw new Error("Upgrade scan already in progress");
    this.processing = true;
    try {
      onProgress?.("Pre-checking workspace for dependency manifests…");
      const manifestFiles = await this.detectDependencyFiles();
      if (manifestFiles.length === 0) {
        onProgress?.("No supported dependency manifest files found in the workspace");
        return [];
      }
      onProgress?.(
        `Found ${manifestFiles.length} dependency manifest file(s); requesting upgrade recommendations…`
      );
      return await this.analyzeDependencies(manifestFiles);
    } finally {
      this.processing = false;
    }
  }

  /** Apply selected upgrades in batch mode and write the update report. */
  async applyUpgrades(
    recommendations: UpgradeRecommendation[],
    onProgress?: (message: string) => void
  ): Promise<void> {
    if (this.processing) throw new Error("Upgrade apply already in progress");
    this.processing = true;
    try {
      onProgress?.(`Applying ${recommendations.length} selected upgrade(s) via CLI in batch mode…`);
      const batchPrompt = this.buildBatchApplyPrompt(recommendations);
      const markdownReport = await this.executeUpgradePrompt(batchPrompt, "apply-batch");

      const basePath = workspaceRoot();
      if (basePath && basePath.trim() !== "") {
        const outputPath = resolveAvailableMarkdownPath(basePath, "dependency-update-report-after-apply");
        await writeAndOpen(outputPath, markdownReport);
        onProgress?.("Saved dependency update report.");
      }
      onProgress?.("Upgrade complete.");
    } finally {
      this.processing = false;
    }
  }

  // ── detect ──────────────────────────────────────────────────────────
  async detectDependencyFiles(): Promise<string[]> {
    const basePath = workspaceRoot() ?? "";
    const prompt = PromptTemplateService.loadAndRender("platform-upgrade-detect-user.md", {
      workspacePath: basePath,
    });
    const rawContent = await this.executeUpgradePrompt(prompt, "detect");

    const arr = parseJsonLenient<unknown[]>(rawContent);
    if (Array.isArray(arr)) {
      const files = arr
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      const distinct = Array.from(new Set(files));
      if (distinct.length > 0) {
        log(`PlatformUpgrade: detected dependency manifest files: ${distinct.join(", ")}`);
        return distinct;
      }
    }
    log("PlatformUpgrade: no parseable dependency manifest detection results");
    return [];
  }

  // ── analyze ─────────────────────────────────────────────────────────
  async analyzeDependencies(manifestFiles: string[]): Promise<UpgradeRecommendation[]> {
    if (manifestFiles.length === 0) return [];
    const basePath = workspaceRoot() ?? "";
    const prompt = PromptTemplateService.loadAndRender("platform-upgrade-analyze-user.md", {
      workspacePath: basePath,
      manifestFilesJson: JSON.stringify(manifestFiles),
    });
    const rawContent = await this.executeUpgradePrompt(prompt, "analyze");

    const root = parseJsonLenient<{ inventory?: unknown[] }>(rawContent);
    if (root && Array.isArray(root.inventory)) {
      const out: UpgradeRecommendation[] = [];
      for (const elem of root.inventory) {
        if (elem && typeof elem === "object") {
          out.push(mapInventoryRecommendation(elem as Record<string, unknown>));
        }
      }
      return out;
    }
    log("PlatformUpgrade: no parseable upgrade recommendations");
    return [];
  }

  // ── apply prompt ────────────────────────────────────────────────────
  private buildBatchApplyPrompt(recommendations: UpgradeRecommendation[]): string {
    const basePath = workspaceRoot() ?? "";
    const manifestFiles = Array.from(new Set(recommendations.map((r) => r.sourceFile)));
    return PromptTemplateService.loadAndRender("platform-upgrade-apply-batch-user.md", {
      workspacePath: basePath,
      manifestFilesJson: JSON.stringify(manifestFiles),
      recommendationsJson: JSON.stringify(buildRecommendationPayload(recommendations)),
    });
  }

  // ── shared executor (PlatformUpgradeSupport.executeUpgradePrompt) ────
  private async executeUpgradePrompt(prompt: string, stage: string): Promise<string> {
    const basePath = workspaceRoot();
    log(`PlatformUpgrade: running stage '${stage}' with prompt size ${prompt.length} chars`);

    const context: Record<string, string> = { intent: "platform-upgrades", stage };
    if (basePath && basePath.trim() !== "") context.workingDirectory = basePath;

    try {
      const content = await executeForContent(newRequest(OperationType.PLATFORM_UPGRADE, null, prompt, context));
      log(`PlatformUpgrade: stage '${stage}' response (${content.length} chars)`);
      return content;
    } catch (e) {
      const msg = `Copilot CLI ${stage} failed: ${e instanceof Error ? e.message : String(e)}`;
      logError(msg, e);
      throw new Error(msg);
    }
  }
}

function buildRecommendationPayload(recommendations: UpgradeRecommendation[]): Array<Record<string, unknown>> {
  return recommendations.map((r) => ({
    name: r.currentDependency.name ?? "",
    fileName: r.sourceFile ?? "",
    currentVersion: r.currentDependency.currentVersion ?? "",
    targetVersion: r.recommendedVersion ?? "",
    type: r.currentDependency.type ?? "",
    severity: r.severity ?? "",
    rationale: r.rationale ?? "",
    breakingChanges: r.breakingChanges ?? [],
    migrationSteps: r.migrationSteps ?? [],
  }));
}

/** Port of PlatformAnalyzeServiceImpl.mapInventoryRecommendation. */
function mapInventoryRecommendation(obj: Record<string, unknown>): UpgradeRecommendation {
  const depName = getString(obj, "name", "Unknown");
  const currentVersion = getString(obj, "currentVersion", "unknown");
  const version = getString(obj, "targetVersion", "unknown");
  const risk = getString(obj, "risk", "medium");
  const severity = risk;
  const type = getString(obj, "type", "unknown");
  const sourceFile = getString(obj, "fileName", "");
  const oldBlock = getString(obj, "oldDependencyBlock", "");
  const newBlock = getString(obj, "newDependencyBlock", "");

  const changes = getStringArray(obj, "breakingChanges");
  const migrationSteps = getStringArray(obj, "migrationSteps");

  let rationale = getString(obj, "rationale", "Risk: " + risk.toLowerCase());
  if (migrationSteps.length > 0) {
    rationale += ". Migration: " + migrationSteps.join(" ");
  }

  const current: DependencyInfo = { name: depName, groupId: null, artifactId: null, currentVersion, type };
  return {
    currentDependency: current,
    recommendedVersion: version,
    rationale,
    breakingChanges: changes,
    severity,
    migrationSteps,
    sourceFile,
    oldDependencyBlock: oldBlock,
    newDependencyBlock: newBlock,
  };
}

function getString(obj: Record<string, unknown>, key: string, def: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : v != null && typeof v === "number" ? String(v) : def;
}

function getStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}
