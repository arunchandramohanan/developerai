import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { FeatureUpdateService } from "../services/featureUpdateService";
import { DependencyMigrationService } from "../services/dependencyMigrationService";
import { PlatformUpgradeService } from "../services/platformUpgradeService";
import { parseFeatureCode } from "../services/featureCodeParser";
import { FeatureCodeFileSpec } from "../models/delivery";
import { UpgradeRecommendation, recommendationLabel, isUpgradeNeeded } from "../models/upgrade";
import {
  PlatformUpgradesProvider,
  SHOW_DETAIL_COMMAND,
} from "../views/platformUpgradesView";
import { showUpgradeDetail } from "../views/upgradeRecommendationDetail";
import { showFeatureCodePreview } from "../views/featureCodePreview";
import {
  readTextFile,
  writeTextFile,
  writeAndOpen,
  openFile,
  fileExists,
  baseName,
  stripExtension,
  extensionOf,
} from "../util/files";
import { resolveAvailableMarkdownPath } from "../util/response";
import { workspaceRoot, log } from "../core/context";
import { notifyError, notifyInfo, notifyWarning, showInfoWithActions } from "../util/notify";

const BATCH_APPLY_COMMAND = "devai.platformUpgrades.apply";

/**
 * Delivery feature cluster: feature-code generation/update/scaffold, dependency
 * analysis/migration, and platform/framework upgrades (with the
 * devai.platformUpgradesView tree).
 */
export function registerDelivery(context: vscode.ExtensionContext): void {
  const featureUpdateService = new FeatureUpdateService();
  const dependencyService = new DependencyMigrationService();
  const upgradeService = PlatformUpgradeService.getInstance();
  const upgradesProvider = new PlatformUpgradesProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("devai.platformUpgradesView", upgradesProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateFeatureCode", (uri?: vscode.Uri) =>
      runFeatureCodeGeneration(uri, "Generate Feature Code")
    ),
    vscode.commands.registerCommand("devai.generateFeatureScaffold", (uri?: vscode.Uri) =>
      runFeatureCodeGeneration(uri, "Generate Feature Scaffold")
    ),
    vscode.commands.registerCommand("devai.updateFeatureCode", () =>
      runFeatureCodeUpdate(featureUpdateService)
    ),
    vscode.commands.registerCommand("devai.analyzeDependency", () => runAnalyzeDependency(dependencyService)),
    vscode.commands.registerCommand("devai.executeDependencyMigration", () =>
      runExecuteDependencyMigration(dependencyService)
    ),
    vscode.commands.registerCommand("devai.upgradePlatform", () =>
      runUpgradePlatform(upgradeService, upgradesProvider)
    ),
    // Internal commands (not contributed to menus) used by the tree view.
    vscode.commands.registerCommand(SHOW_DETAIL_COMMAND, (rec: UpgradeRecommendation) => showUpgradeDetail(rec)),
    vscode.commands.registerCommand(BATCH_APPLY_COMMAND, () =>
      runBatchApply(upgradeService, upgradesProvider.getRecommendations())
    )
  );
}

// ── Feature code generation / scaffold ─────────────────────────────────
async function runFeatureCodeGeneration(uri: vscode.Uri | undefined, title: string): Promise<void> {
  const requirementsPath = await resolveRequirementsFile(uri, "Select Requirements Document");
  if (!requirementsPath) return;

  const ext = (extensionOf(requirementsPath) ?? "").toLowerCase();
  if (ext !== "md") {
    notifyError("Please select a markdown (.md) requirements file.");
    return;
  }

  const requirementsContent = readTextFile(requirementsPath);
  if (requirementsContent == null || requirementsContent.trim() === "") {
    notifyError("The selected requirements file is empty.");
    return;
  }

  const targetName = stripExtension(baseName(requirementsPath));

  let content: string;
  try {
    content = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      async (progress) => {
        progress.report({ message: "Generating feature code…" });
        return executeForContent(
          newRequest(OperationType.GENERATE_FEATURE_CODE, null, requirementsContent, { targetName })
        );
      }
    );
  } catch (e) {
    notifyError("Feature code generation failed: " + (e instanceof Error ? e.message : String(e)));
    return;
  }

  const specs = parseFeatureCode(content);
  const requirementsDir = path.dirname(requirementsPath);

  if (specs.length === 0) {
    // Fallback: write the raw output as a markdown artifact after confirmation.
    const choice = await showInfoWithActions(
      title,
      "No individual source files could be parsed from the output. Save the raw output as a markdown file?",
      "Write File"
    );
    if (choice !== "Write File") {
      notifyInfo("Feature code generation was cancelled.");
      return;
    }
    const outputPath = resolveAvailableMarkdownPath(requirementsDir, targetName + "-feature-code");
    await writeAndOpen(outputPath, content);
    notifyInfo(`${baseName(outputPath)} created successfully.`);
    return;
  }

  const projectRoot = workspaceRoot();
  if (!projectRoot) {
    notifyError("Cannot determine project base path.");
    return;
  }

  // Validate paths — reject any that escape the project root.
  const safeSpecs: FeatureCodeFileSpec[] = [];
  const rejected: string[] = [];
  for (const spec of specs) {
    const resolved = path.resolve(projectRoot, spec.targetPath);
    if (isInside(projectRoot, resolved)) safeSpecs.push(spec);
    else rejected.push(spec.targetPath);
  }
  if (rejected.length > 0) log(`Feature code: rejected unsafe paths: ${rejected.join(", ")}`);
  if (safeSpecs.length === 0) {
    notifyError("All generated file paths were rejected as unsafe.");
    return;
  }

  const existing = new Set(
    safeSpecs.filter((s) => fileExists(path.resolve(projectRoot, s.targetPath))).map((s) => s.targetPath)
  );

  const approved = await showFeatureCodePreview(safeSpecs, existing, title);
  if (approved == null) {
    notifyInfo("Feature code generation was cancelled.");
    return;
  }
  if (approved.length === 0) {
    notifyInfo("No files were selected for writing.");
    return;
  }

  let written = 0;
  const writtenPaths: string[] = [];
  for (const spec of approved) {
    const resolved = path.resolve(projectRoot, spec.targetPath);
    try {
      writeTextFile(resolved, spec.content);
      writtenPaths.push(resolved);
      written++;
    } catch (e) {
      log(`Feature code: failed to write ${resolved}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Save the raw markdown as an audit artifact (best-effort).
  try {
    const artifactPath = resolveAvailableMarkdownPath(requirementsDir, targetName + "-feature-code");
    writeTextFile(artifactPath, content);
  } catch {
    /* best-effort */
  }

  if (writtenPaths.length > 0) await openFile(writtenPaths[0]);
  notifyInfo(`Feature Code Generated: ${written} file(s) created successfully.`);
}

// ── Feature code update ────────────────────────────────────────────────
async function runFeatureCodeUpdate(service: FeatureUpdateService): Promise<void> {
  const source = await vscode.window.showQuickPick(
    [
      { label: "Choose a requirements file", id: "file" },
      { label: "Paste requirements text", id: "paste" },
    ],
    { placeHolder: "How would you like to provide the revised requirements?" }
  );
  if (!source) return;

  let requirementsPath: string | undefined;
  if (source.id === "file") {
    requirementsPath = await resolveRequirementsFile(undefined, "Select Requirements Document");
  } else {
    const pasted = await vscode.window.showInputBox({
      prompt: "Paste the revised requirements",
      placeHolder: "Describe the change to implement…",
      ignoreFocusOut: true,
    });
    if (pasted == null || pasted.trim() === "") return;
    requirementsPath = writeTempRequirements(pasted);
    if (!requirementsPath) {
      notifyError("Failed to save pasted content to a temporary file.");
      return;
    }
  }
  if (!requirementsPath) return;

  await service.executeCliUpdate(requirementsPath, null);
}

// ── Dependency analysis / migration ────────────────────────────────────
async function runAnalyzeDependency(service: DependencyMigrationService): Promise<void> {
  const stage = await vscode.window.showQuickPick(["build", "develop"], {
    placeHolder: "Select the Sonatype pipeline stage for vulnerability report retrieval",
  });
  if (!stage) return;
  await service.analyzeImpact(stage);
}

async function runExecuteDependencyMigration(service: DependencyMigrationService): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Execute Migration",
    title: "Choose Dependency Migration Report",
    filters: { Markdown: ["md"] },
    defaultUri: workspaceRoot() ? vscode.Uri.file(workspaceRoot()!) : undefined,
  });
  if (!picked || picked.length === 0) {
    notifyWarning("No migration report file was selected.");
    return;
  }
  const reportPath = picked[0].fsPath;
  if ((extensionOf(reportPath) ?? "").toLowerCase() !== "md") {
    notifyError("Please select a Markdown (.md) report file.");
    return;
  }
  await service.migrateDependency(reportPath);
}

// ── Platform upgrades ──────────────────────────────────────────────────
async function runUpgradePlatform(
  service: PlatformUpgradeService,
  provider: PlatformUpgradesProvider
): Promise<void> {
  if (service.isProcessing()) {
    notifyWarning("An upgrade operation is already running.");
    return;
  }

  let recommendations: UpgradeRecommendation[];
  try {
    recommendations = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Automate Platform and Framework Upgrades",
        cancellable: false,
      },
      async (progress) => service.scanAndRecommend((msg) => progress.report({ message: msg }))
    );
  } catch (e) {
    notifyError("Upgrade scan failed: " + (e instanceof Error ? e.message : String(e)));
    return;
  }

  provider.setRecommendations(recommendations);
  await vscode.commands.executeCommand("devai.platformUpgradesView.focus").then(undefined, () => undefined);

  if (recommendations.length === 0) {
    notifyInfo("No supported dependency manifest files or upgrade recommendations were found.");
    return;
  }

  const actionable = recommendations.filter(isUpgradeNeeded);
  if (actionable.length === 0) {
    notifyInfo(`${recommendations.length} dependency(ies) scanned — all are up to date.`);
    return;
  }

  const choice = await showInfoWithActions(
    "Platform Upgrades",
    `Found ${actionable.length} actionable upgrade(s) of ${recommendations.length} scanned.`,
    "Apply Upgrades…"
  );
  if (choice === "Apply Upgrades…") {
    await runBatchApply(service, recommendations);
  }
}

async function runBatchApply(
  service: PlatformUpgradeService,
  recommendations: UpgradeRecommendation[]
): Promise<void> {
  if (service.isProcessing()) {
    notifyWarning("An upgrade operation is already running.");
    return;
  }
  const actionable = recommendations.filter(isUpgradeNeeded);
  if (actionable.length === 0) {
    notifyWarning("There are no actionable upgrades to apply. Run a scan first.");
    return;
  }

  const picks = await vscode.window.showQuickPick(
    actionable.map((rec) => ({
      label: recommendationLabel(rec),
      description: rec.severity,
      detail: rec.rationale,
      picked: true,
      rec,
    })),
    { canPickMany: true, placeHolder: "Select the upgrades to apply" }
  );
  if (!picks || picks.length === 0) return;

  const confirm = await showInfoWithActions(
    "Confirm Upgrade Apply",
    `Apply ${picks.length} selected upgrade(s) now?`,
    "Apply"
  );
  if (confirm !== "Apply") return;

  const selected = picks.map((p) => p.rec);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Applying Upgrades", cancellable: false },
      async (progress) => service.applyUpgrades(selected, (msg) => progress.report({ message: msg }))
    );
    notifyInfo("Upgrades applied. Check the generated report for details.");
  } catch (e) {
    notifyError("Upgrade apply failed: " + (e instanceof Error ? e.message : String(e)));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
async function resolveRequirementsFile(
  uri: vscode.Uri | undefined,
  title: string
): Promise<string | undefined> {
  if (uri && uri.fsPath) return uri.fsPath;

  const active = vscode.window.activeTextEditor?.document;
  if (active && !active.isUntitled) {
    return active.uri.fsPath;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Select",
    title,
    filters: { Markdown: ["md"], "All files": ["*"] },
    defaultUri: workspaceRoot() ? vscode.Uri.file(workspaceRoot()!) : undefined,
  });
  return picked && picked.length > 0 ? picked[0].fsPath : undefined;
}

function writeTempRequirements(content: string): string | undefined {
  try {
    const tempPath = path.join(os.tmpdir(), `devai-requirements-${Date.now()}.md`);
    writeTextFile(tempPath, content);
    return tempPath;
  } catch {
    return undefined;
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
