/**
 * Port of com.bmo.devai.intellij.services.impl.CodeReviewServiceImpl.
 * Orchestrates diff analysis, prompt building, AI execution, response parsing,
 * and fix delegation. IntelliJ CompletableFuture chains become async/await.
 */
import * as vscode from "vscode";
import {
  AIRequest,
  CodeSelection,
  ElementType,
  ExecutionMode,
  newRequest,
  OperationType,
} from "../models";
import { CopilotService, executeForContent } from "../core/copilotService";
import { ModeManager } from "../core/modeManager";
import { ModePreference } from "../models";
import { DevAIException, ErrorCode } from "../util/exception";
import { log, logError } from "../core/context";
import { displayNameForLanguage } from "../util/codeSelection";
import {
  CodeIssue,
  FixPreview,
  ReviewResult,
  Severity,
  findingToCodeIssue,
  reviewResultForChanges,
  reviewResultForFile,
  severityIsAtLeast,
} from "../models/review";
import { DiffScope, DiffSummary, diffFileCount, diffHasChanges, diffScopeDisplayName, diffTotalChanges } from "../models/diff";
import { DiffChangeAnalyzer } from "./diffChangeAnalyzer";
import { ReviewResponseParser } from "./reviewResponseParser";
import { FixApplicator } from "./fixApplicator";
import { buildDiffReviewPrompt, buildCodeSelectionReviewPrompt } from "./reviewPromptBuilder";

const MAX_HISTORY_SIZE = 20;

export interface ReviewListener {
  onReviewStarted?(): void;
  onProgress?(message: string): void;
  onReviewCompleted?(result: ReviewResult): void;
  onReviewFailed?(error: unknown): void;
  onReviewCancelled?(): void;
  onFixApplied?(issue: CodeIssue): void;
}

export class CodeReviewService {
  private static _instance: CodeReviewService | undefined;

  private readonly copilotService = CopilotService.getInstance();
  private readonly diffAnalyzer = new DiffChangeAnalyzer();
  private readonly parser = new ReviewResponseParser();
  private readonly fixApplicator = new FixApplicator((issue) => this.notifyFixApplied(issue));

  private readonly listeners: ReviewListener[] = [];
  private readonly reviewHistory: ReviewResult[] = [];
  private reviewing = false;
  private currentRequestId: string | null = null;
  /** Show everything by default; the view applies the settings-based threshold. */
  private minimumSeverity: Severity = Severity.INFO;

  static getInstance(): CodeReviewService {
    if (!CodeReviewService._instance) CodeReviewService._instance = new CodeReviewService();
    return CodeReviewService._instance;
  }

  getDiffAnalyzer(): DiffChangeAnalyzer {
    return this.diffAnalyzer;
  }

  // ---- Diff-based review -------------------------------------------------

  async reviewDiff(scope: DiffScope, filePath: string | null, baseBranch: string | null): Promise<ReviewResult> {
    if (this.reviewing) {
      throw new DevAIException("Review already in progress", ErrorCode.REQUEST_IN_PROGRESS);
    }

    this.reviewing = true;
    const startTime = Date.now();
    this.notify((l) => l.onReviewStarted?.());

    try {
      const diffSummary = await this.diffAnalyzer.analyzeDiffs(scope, filePath, baseBranch);

      if (!diffHasChanges(diffSummary)) {
        const empty = reviewResultForChanges([], await this.activeMode(), startTime,
          "No changes found for scope: " + diffScopeDisplayName(scope));
        this.notify((l) => l.onReviewCompleted?.(empty));
        return empty;
      }

      this.notify((l) => l.onProgress?.(`Analyzing ${diffFileCount(diffSummary)} changed file(s)...`));

      const prompt = buildDiffReviewPrompt(diffSummary);
      const request = newRequest(OperationType.CODE_REVIEW, null, prompt, {
        scope,
        fileCount: String(diffFileCount(diffSummary)),
        totalChanges: String(diffTotalChanges(diffSummary)),
      });
      this.currentRequestId = request.id;
      this.notify((l) => l.onProgress?.("Sending changes to GitHub Copilot..."));

      const result = await this.buildDiffResult(request, diffSummary, startTime);
      this.addToHistory(result);
      this.notify((l) => l.onReviewCompleted?.(result));
      return result;
    } catch (error) {
      logError("Diff-based code review failed", error);
      this.notify((l) => l.onReviewFailed?.(error));
      throw error;
    } finally {
      this.reviewing = false;
      this.currentRequestId = null;
    }
  }

  // ---- Code selection / file review -------------------------------------

  async reviewCode(selection: CodeSelection, focusAreas: string[] | null): Promise<ReviewResult> {
    if (this.reviewing) {
      throw new DevAIException("Review already in progress", ErrorCode.REQUEST_IN_PROGRESS);
    }

    this.reviewing = true;
    const startTime = Date.now();
    this.notify((l) => l.onReviewStarted?.());

    try {
      const prompt = buildCodeSelectionReviewPrompt(selection, focusAreas);
      const request = newRequest(OperationType.CODE_REVIEW, selection, prompt, {
        filePath: selection.filePath,
        focusAreas: focusAreas != null ? focusAreas.join(",") : "",
      });
      this.currentRequestId = request.id;
      this.notify((l) => l.onProgress?.("Analyzing code..."));

      const result = await this.buildFileResult(request, selection.filePath, startTime);
      this.addToHistory(result);
      this.notify((l) => l.onReviewCompleted?.(result));
      return result;
    } catch (error) {
      logError("Code review failed", error);
      this.notify((l) => l.onReviewFailed?.(error));
      throw error;
    } finally {
      this.reviewing = false;
      this.currentRequestId = null;
    }
  }

  async reviewFile(filePath: string): Promise<ReviewResult> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    } catch {
      throw new DevAIException("Cannot open file: " + filePath, ErrorCode.INVALID_SELECTION);
    }
    const content = doc.getText();
    const selection: CodeSelection = {
      text: content,
      filePath,
      languageName: displayNameForLanguage(doc.languageId),
      startOffset: 0,
      endOffset: content.length,
      elementType: ElementType.FILE,
    };
    return this.reviewCode(selection, null);
  }

  reviewVcsChanges(): Promise<ReviewResult> {
    return this.reviewDiff(DiffScope.UNCOMMITTED, null, null);
  }

  reviewFileChanges(filePath: string): Promise<ReviewResult> {
    return this.reviewDiff(DiffScope.CURRENT_FILE, filePath, null);
  }

  // ---- Fix delegation ---------------------------------------------------

  applyFix(issue: CodeIssue): Promise<void> { return this.fixApplicator.applyFix(issue); }
  applyAllFixes(result: ReviewResult): Promise<number> { return this.fixApplicator.applyAllFixes(result); }
  generateFixPreview(issue: CodeIssue): Promise<FixPreview> { return this.fixApplicator.generateFixPreview(issue); }
  generateAllFixPreviews(result: ReviewResult): Promise<FixPreview[]> { return this.fixApplicator.generateAllFixPreviews(result); }
  applyFixPreview(preview: FixPreview): Promise<void> { return this.fixApplicator.applyFixPreview(preview); }

  // ---- State & history --------------------------------------------------

  getLatestResult(): ReviewResult | null {
    return this.reviewHistory.length === 0 ? null : this.reviewHistory[this.reviewHistory.length - 1];
  }

  getReviewHistory(maxResults: number): ReviewResult[] {
    const start = Math.max(0, this.reviewHistory.length - maxResults);
    return this.reviewHistory.slice(start);
  }

  clearHistory(): void {
    this.reviewHistory.length = 0;
  }

  cancelReview(): void {
    if (this.currentRequestId != null && this.reviewing) {
      this.copilotService.cancelRequest(this.currentRequestId);
      this.reviewing = false;
      this.currentRequestId = null;
      this.notify((l) => l.onReviewCancelled?.());
    }
  }

  isReviewing(): boolean {
    return this.reviewing;
  }

  getMinimumSeverity(): Severity { return this.minimumSeverity; }
  setMinimumSeverity(severity: Severity): void { this.minimumSeverity = severity; }

  addReviewListener(listener: ReviewListener): void { this.listeners.push(listener); }
  removeReviewListener(listener: ReviewListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  // ---- Result building --------------------------------------------------

  private async buildDiffResult(request: AIRequest, diffSummary: DiffSummary, startTime: number): Promise<ReviewResult> {
    const content = await this.executeReview(request);
    const mode = await this.activeMode();
    if (content == null || content.trim().length === 0) {
      return reviewResultForChanges([], mode, startTime, "No issues found");
    }

    const issues = await this.parseAndResolve(content, null);
    return reviewResultForChanges(issues, mode, startTime, this.parser.buildSummary(issues, diffFileCount(diffSummary)));
  }

  private async buildFileResult(request: AIRequest, filePath: string, startTime: number): Promise<ReviewResult> {
    const content = await this.executeReview(request);
    const mode = await this.activeMode();
    if (content == null || content.trim().length === 0) {
      return reviewResultForFile(filePath, [], mode, startTime, "No issues found");
    }

    const issues = await this.parseAndResolve(content, filePath);
    const summary = issues.length === 0 ? "No issues found" : `${issues.length} issue(s) found in ${filePath}`;
    return reviewResultForFile(filePath, issues, mode, startTime, summary);
  }

  private async executeReview(request: AIRequest): Promise<string> {
    this.notify((l) => l.onProgress?.("Processing review results..."));
    try {
      return await executeForContent(request);
    } catch (e) {
      throw new DevAIException(
        "Code review failed: " + (e instanceof Error ? e.message : String(e)),
        ErrorCode.GENERATION_FAILED
      );
    }
  }

  private async parseAndResolve(content: string, knownPath: string | null): Promise<CodeIssue[]> {
    const findings = this.parser.parseFindings(content);
    const resolved: CodeIssue[] = [];
    for (const finding of findings) {
      const issue = await this.parser.resolveIssueFilePath(findingToCodeIssue(finding), knownPath);
      if (severityIsAtLeast(issue.severity, this.minimumSeverity)) resolved.push(issue);
    }
    return resolved;
  }

  private async activeMode(): Promise<ExecutionMode> {
    const last = this.copilotService.getLastExecutionContext();
    if (last != null) return last.activeMode;
    try {
      return (await ModeManager.getInstance().getExecutionContext()).activeMode;
    } catch {
      return ModeManager.getInstance().getModePreference() === ModePreference.SDK_ONLY
        ? ExecutionMode.SDK
        : ExecutionMode.CHAT;
    }
  }

  // ---- listener & history helpers ---------------------------------------

  private addToHistory(result: ReviewResult): void {
    this.reviewHistory.push(result);
    while (this.reviewHistory.length > MAX_HISTORY_SIZE) this.reviewHistory.shift();
  }

  private notify(action: (l: ReviewListener) => void): void {
    for (const listener of this.listeners) {
      try {
        action(listener);
      } catch (e) {
        log("Error notifying review listener");
      }
    }
  }

  private notifyFixApplied(issue: CodeIssue): void {
    this.notify((l) => l.onFixApplied?.(issue));
  }
}
