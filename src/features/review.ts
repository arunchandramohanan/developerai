/**
 * Code-review feature cluster. Ports the IntelliJ review actions
 * (ReviewCodeAction, ReviewChangesAction, DetectApiDriftAction),
 * ReviewResultPresenter, the Review Results tool window, and the gutter/Problems
 * surface (via a DiagnosticCollection) into VS Code.
 */
import * as vscode from "vscode";
import * as path from "path";
import { getSelection } from "../util/codeSelection";
import { notifyError, notifyInfo, notifyWarning, showInfoWithActions } from "../util/notify";
import { workspaceRoot, logError } from "../core/context";
import { runProcess } from "../util/exec";
import { extensionOf } from "../util/files";
import {
  CodeIssue,
  FixPreview,
  ReviewResult,
  Severity,
  fixPreviewFileName,
  reviewDisplaySummary,
  reviewDurationMs,
  reviewHasHighSeverityIssues,
  reviewTotalIssueCount,
  severityFromString,
  severityIsAtLeast,
  codeIssueLineRange,
} from "../models/review";
import { DiffScope, diffScopeDescription, diffScopeDisplayName } from "../models/diff";
import { CodeReviewService, ReviewListener } from "../services/codeReviewService";
import { buildApiDriftPrompt } from "../services/reviewPromptBuilder";
import { newRequest, OperationType } from "../models";
import { executeForContent } from "../core/copilotService";
import { settings } from "../core/settings";
import { OPEN_ISSUE_COMMAND, ReviewResultsProvider } from "../views/reviewResultsView";
import {
  handleApiDrift,
  handleDiffReview,
  handleIfChatMode,
  handleSelectionReview,
  isChatModeActive,
} from "../chatmode/integrator";
import { TaskType } from "../models/chat";

const DIAGNOSTIC_SOURCE = "BMO GenAI Review";
const FIX_PREVIEW_SCHEME = "devai-review-fix";

export function registerReview(context: vscode.ExtensionContext): void {
  const service = CodeReviewService.getInstance();
  const provider = new ReviewResultsProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection("devai-review");

  // Content provider backing the right-hand side of fix diff previews.
  const previewContents = new Map<string, string>();
  const previewProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return previewContents.get(uri.toString()) ?? "";
    },
  };

  context.subscriptions.push(
    diagnostics,
    vscode.window.registerTreeDataProvider("devai.reviewResultsView", provider),
    vscode.workspace.registerTextDocumentContentProvider(FIX_PREVIEW_SCHEME, previewProvider)
  );

  // ── devai.reviewCode ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.reviewCode", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        notifyWarning("Please open a file to review.");
        return;
      }
      if (service.isReviewing()) {
        notifyWarning("A code review is already in progress.");
        return;
      }

      // Chat Mode intercept, mirroring ReviewCodeAction: a selection routes
      // through selection-review, otherwise the whole file goes to code-review.
      if (isChatModeActive()) {
        const filePath = editor.document.uri.fsPath;
        if (!editor.selection.isEmpty) {
          const selectedText = editor.document.getText(editor.selection);
          if (
            await handleSelectionReview(
              filePath,
              selectedText,
              editor.selection.start.line + 1,
              editor.selection.end.line + 1
            )
          ) {
            return;
          }
        }
        if (await handleIfChatMode(TaskType.CODE_REVIEW, filePath)) return;
      }

      if (!editor.selection.isEmpty) {
        const selection = await getSelection(editor);
        if (!selection) {
          notifyWarning("Unable to get code selection.");
          return;
        }
        await runReview(() => service.reviewCode(selection, null), "Reviewing Selection", service, provider, diagnostics, null);
      } else {
        const filePath = editor.document.uri.fsPath;
        await runReview(() => service.reviewFile(filePath), `Reviewing ${editor.document.fileName}`, service, provider, diagnostics, null);
      }
    })
  );

  // Shared scoped-review runner used by devai.reviewChanges (after a
  // QuickPick) and by the per-scope commands surfaced in the main view
  // (mirroring the four review entries of the IntelliJ tool-window tree).
  async function runScopedReview(scope: DiffScope): Promise<void> {
    if (service.isReviewing()) {
      notifyWarning("A code review is already in progress.");
      return;
    }

    let baseBranch: string | null = null;
    if (scope === DiffScope.FEATURE_BRANCH) {
      const detected = await service.getDiffAnalyzer().detectDefaultBranch().catch(() => "main");
      const input = await vscode.window.showInputBox({
        title: "Base Branch",
        prompt: "Enter the base branch to compare against:",
        value: detected,
      });
      if (input === undefined) return; // cancelled
      baseBranch = input.trim().length === 0 ? null : input.trim();
    }

    const currentFilePath =
      scope === DiffScope.CURRENT_FILE ? vscode.window.activeTextEditor?.document.uri.fsPath ?? null : null;
    if (scope === DiffScope.CURRENT_FILE && !currentFilePath) {
      notifyWarning("No file is open in the editor. Open a source file first.");
      return;
    }

    // Chat Mode intercept, mirroring ReviewChangesAction.
    if (await handleDiffReview(scope, baseBranch, currentFilePath)) return;

    const scopeLabel = diffScopeDisplayName(scope).toLowerCase();
    if (scope === DiffScope.CURRENT_FILE && currentFilePath) {
      // reviewFile falls back to full-file content review, matching the IntelliJ flow.
      await runReview(() => service.reviewFile(currentFilePath), `Reviewing ${diffScopeDisplayName(scope)}`, service, provider, diagnostics, scopeLabel);
    } else {
      await runReview(() => service.reviewDiff(scope, null, baseBranch), `Reviewing ${diffScopeDisplayName(scope)}`, service, provider, diagnostics, scopeLabel);
    }
  }

  // ── devai.reviewChanges ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.reviewChanges", async () => {
      const scope = await pickScope();
      if (!scope) return;
      await runScopedReview(scope);
    })
  );

  // ── Per-scope review commands (main-view tree entries) ────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.reviewFeatureBranch", () => runScopedReview(DiffScope.FEATURE_BRANCH)),
    vscode.commands.registerCommand("devai.reviewUncommitted", () => runScopedReview(DiffScope.UNCOMMITTED)),
    vscode.commands.registerCommand("devai.reviewStaged", () => runScopedReview(DiffScope.STAGED)),
    vscode.commands.registerCommand("devai.reviewCurrentFile", () => runScopedReview(DiffScope.CURRENT_FILE))
  );

  // ── devai.detectApiDrift ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.detectApiDrift", async () => {
      await detectApiDrift();
    })
  );

  // ── devai.refreshReviewResults ────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.refreshReviewResults", () => {
      provider.refresh();
      updateDiagnostics(diagnostics, provider.getCurrentResult());
    })
  );

  // ── devai.clearReviewResults ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.clearReviewResults", () => {
      provider.clear();
      diagnostics.clear();
      service.clearHistory();
    })
  );

  // ── Open an issue in the editor at its line ───────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_ISSUE_COMMAND, async (issue: CodeIssue) => {
      if (!issue) return;
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.filePath));
        const line = Math.max(0, issue.startLine - 1);
        const pos = new vscode.Position(line, 0);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
      } catch {
        notifyWarning("Cannot open file: " + issue.filePath);
      }
    })
  );

  // ── Suggested-change (fix) flow, offered from the completion notification ─
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.reviewResults.viewSuggestedChanges", async () => {
      await viewSuggestedChanges(service, provider.getCurrentResult(), previewContents);
    })
  );

  // ---- API drift -------------------------------------------------------

  async function detectApiDrift(): Promise<void> {
    const root = workspaceRoot();
    if (!root) {
      notifyWarning("Open a workspace folder to detect API drift.");
      return;
    }

    const picked = await pickApiSpecFile();
    if (!picked) return;

    const relSpec = normalizeSpecPathForGit(root, picked);
    if (!relSpec) {
      notifyWarning("The selected OpenAPI/Swagger file must be inside the current project so its git diff can be analyzed.");
      return;
    }

    // Chat Mode intercept, mirroring DetectApiDriftAction.
    if (await handleApiDrift(relSpec)) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Detecting API drift", cancellable: false },
      async () => {
        try {
          const specDiff = (await runGit(root, ["diff", "HEAD", "--", relSpec])).trim();
          const codeDiff = (await runGit(root, ["diff", "HEAD"])).trim();

          let diffContent = `## Selected OpenAPI/Swagger file: ${relSpec}\n\n`;
          diffContent += specDiff.length > 0
            ? "### Spec git diff\n```diff\n" + specDiff + "\n```\n\n"
            : "### Spec git diff\nNo committed-vs-working changes detected for the selected spec file.\n\n";
          diffContent += codeDiff.length > 0
            ? "### Code git diff (uncommitted)\n```diff\n" + codeDiff + "\n```\n"
            : "### Code git diff (uncommitted)\nNo uncommitted code changes detected.\n";

          const prompt = buildApiDriftPrompt(relSpec, diffContent);
          const content = await executeForContent(newRequest(OperationType.API_DRIFT, null, prompt, { specFile: relSpec }));

          const doc = await vscode.workspace.openTextDocument({ language: "markdown", content });
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (e) {
          logError("API drift detection failed", e);
          notifyError("API Drift detection failed: " + extractErrorMessage(e));
        }
      }
    );
  }
}

// ─── Review execution & presentation ────────────────────────────────────

async function runReview(
  task: () => Promise<ReviewResult>,
  title: string,
  service: CodeReviewService,
  provider: ReviewResultsProvider,
  diagnostics: vscode.DiagnosticCollection,
  scope: string | null
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (progress, token) => {
      const listener: ReviewListener = {
        onProgress: (message) => progress.report({ message }),
      };
      service.addReviewListener(listener);
      token.onCancellationRequested(() => service.cancelReview());

      try {
        const result = await task();
        provider.setResult(result);
        updateDiagnostics(diagnostics, result);
        await presentResult(result, scope);
      } catch (e) {
        logError("Code review failed", e);
        notifyError("Code Review Failed: " + extractErrorMessage(e));
      } finally {
        service.removeReviewListener(listener);
      }
    }
  );
}

/** Port of ReviewResultPresenter.present. */
async function presentResult(result: ReviewResult, scope: string | null): Promise<void> {
  const total = reviewTotalIssueCount(result);

  if (total === 0) {
    const suffix = result.summary ?? "";
    const scopeText = scope ?? "the reviewed code";
    notifyInfo(`No issues found in ${scopeText}. ${suffix}`);
    return;
  }

  const seconds = Math.round(reviewDurationMs(result) / 1000);
  const details = `${reviewDisplaySummary(result)} (${seconds}s)`;
  const heading = `Review Complete -- ${total} Issue(s): ${details}`;

  const action = reviewHasHighSeverityIssues(result)
    ? await vscode.window.showWarningMessage(heading, "View Suggested Changes")
    : await showInfoWithActions("", heading, "View Suggested Changes");

  if (action === "View Suggested Changes") {
    await vscode.commands.executeCommand("devai.reviewResults.viewSuggestedChanges");
  }
}

/** Surfaces findings as diagnostics (the VS Code gutter/Problems equivalent). */
function updateDiagnostics(collection: vscode.DiagnosticCollection, result: ReviewResult | null): void {
  collection.clear();
  if (result == null) return;

  const min = severityFromString(settings().getMinSeverityToShow());
  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const issue of result.issues) {
    if (!severityIsAtLeast(issue.severity, min)) continue;
    const startLine = Math.max(0, issue.startLine - 1);
    const endLine = Math.max(startLine, issue.endLine - 1);
    const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
    const diag = new vscode.Diagnostic(range, `${issue.title}\n${issue.description}`, mapSeverity(issue.severity));
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = codeIssueLineRange(issue);
    const list = byFile.get(issue.filePath);
    if (list) list.push(diag);
    else byFile.set(issue.filePath, [diag]);
  }

  for (const [filePath, diags] of byFile) {
    try {
      collection.set(vscode.Uri.file(filePath), diags);
    } catch {
      /* ignore unresolvable paths */
    }
  }
}

function mapSeverity(severity: Severity): vscode.DiagnosticSeverity {
  switch (severity) {
    case Severity.CRITICAL:
    case Severity.HIGH:
      return vscode.DiagnosticSeverity.Error;
    case Severity.MEDIUM:
      return vscode.DiagnosticSeverity.Warning;
    case Severity.LOW:
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

// ─── Suggested-change (fix) flow ─────────────────────────────────────────

async function viewSuggestedChanges(
  service: CodeReviewService,
  result: ReviewResult | null,
  previewContents: Map<string, string>
): Promise<void> {
  if (result == null || reviewTotalIssueCount(result) === 0) {
    notifyInfo("No review results to fix.");
    return;
  }

  const previews = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Generating suggested changes with AI", cancellable: false },
    async () => {
      try {
        return await service.generateAllFixPreviews(result);
      } catch (e) {
        logError("Failed to generate fix previews", e);
        notifyError("Failed to generate suggestions: " + extractErrorMessage(e));
        return [] as FixPreview[];
      }
    }
  );

  if (previews.length === 0) {
    notifyInfo("No suggestions generated by AI.");
    return;
  }

  let applied = 0;
  for (const preview of previews) {
    const accepted = await showFixPreview(preview, previewContents);
    if (accepted) {
      try {
        await service.applyFixPreview(preview);
        applied += preview.issues.length;
      } catch (e) {
        notifyError("Failed to apply fix for " + fixPreviewFileName(preview) + ": " + extractErrorMessage(e));
      }
    }
  }

  if (applied > 0) {
    notifyInfo(`Applied ${applied} suggested change(s). Use Undo to revert if needed.`);
  }
}

/** Shows a side-by-side diff of the proposed fix and asks the user to apply it. */
async function showFixPreview(preview: FixPreview, previewContents: Map<string, string>): Promise<boolean> {
  const original = vscode.Uri.file(preview.filePath);
  const proposed = vscode.Uri.parse(`${FIX_PREVIEW_SCHEME}:${preview.filePath}?v=${Date.now()}`);
  previewContents.set(proposed.toString(), preview.fixedContent);

  try {
    await vscode.commands.executeCommand(
      "vscode.diff",
      original,
      proposed,
      `${fixPreviewFileName(preview)} (suggested change)`,
      { preview: true }
    );

    const choice = await vscode.window.showInformationMessage(
      `Apply suggested change to ${fixPreviewFileName(preview)}?`,
      { modal: true },
      "Apply"
    );
    return choice === "Apply";
  } finally {
    previewContents.delete(proposed.toString());
  }
}

// ─── Pickers & helpers ───────────────────────────────────────────────────

async function pickScope(): Promise<DiffScope | undefined> {
  const items = [
    DiffScope.FEATURE_BRANCH,
    DiffScope.UNCOMMITTED,
    DiffScope.STAGED,
    DiffScope.CURRENT_FILE,
  ].map((scope) => ({
    label: diffScopeDisplayName(scope),
    detail: diffScopeDescription(scope),
    scope,
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    title: "Select Review Scope",
    placeHolder: "Choose what changes to review",
  });
  return chosen?.scope;
}

async function pickApiSpecFile(): Promise<string | undefined> {
  const found = await vscode.workspace.findFiles("**/*.{yaml,yml,json}", "**/node_modules/**", 200);
  const items = found
    .map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri: uri as vscode.Uri | undefined }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const browseItem = { label: "$(folder-opened) Browse for file...", uri: undefined as vscode.Uri | undefined };
  const chosen = await vscode.window.showQuickPick([browseItem, ...items], {
    title: "Detect API Drift",
    placeHolder: "Select an OpenAPI/Swagger file (YAML or JSON)",
  });
  if (!chosen) return undefined;

  if (!chosen.uri) {
    const opened = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Analyze Drift",
      filters: { "OpenAPI/Swagger": ["yaml", "yml", "json"] },
    });
    if (!opened || opened.length === 0) return undefined;
    const ext = (extensionOf(opened[0].fsPath) ?? "").toLowerCase();
    if (!["yaml", "yml", "json"].includes(ext)) {
      notifyWarning("Please select a YAML (.yaml, .yml) or JSON (.json) OpenAPI/Swagger file.");
      return undefined;
    }
    return opened[0].fsPath;
  }
  return chosen.uri.fsPath;
}

/** Port of DetectApiDriftAction.normalizeSpecPathForGit. */
function normalizeSpecPathForGit(workspaceRootPath: string, apiSpecPath: string): string | null {
  if (workspaceRootPath.trim().length === 0) return null;
  const wsPath = path.resolve(workspaceRootPath);
  const specPath = path.resolve(apiSpecPath);
  const rel = path.relative(wsPath, specPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const out = await runProcess("git", args, { cwd, timeoutMs: 30_000 });
  return out.stdout;
}

function extractErrorMessage(ex: unknown): string {
  if (ex instanceof Error) return ex.message || "Unknown error occurred";
  return ex ? String(ex) : "Unknown error occurred";
}
