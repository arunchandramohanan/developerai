/**
 * Port of com.bmo.devai.intellij.services.impl.FixApplicator.
 * Handles fix-related operations: applying inline fixes, generating AI-powered
 * fixes, batch fixes, and fix previews. IntelliJ WriteCommandAction /
 * Document mutation maps to vscode.WorkspaceEdit.
 */
import * as vscode from "vscode";
import { newRequest, OperationType } from "../models";
import { executeForContent } from "../core/copilotService";
import { readFileContent, stripCodeFences } from "../util/response";
import { DevAIException, ErrorCode } from "../util/exception";
import { log } from "../core/context";
import {
  CodeIssue,
  FixPreview,
  ReviewResult,
  codeIssueHasFix,
  fixPreviewHasChanges,
} from "../models/review";
import { buildBatchFixPrompt, buildFixPrompt } from "./reviewPromptBuilder";

export type FixAppliedCallback = (issue: CodeIssue) => void;

export class FixApplicator {
  constructor(private readonly onFixApplied: FixAppliedCallback) {}

  // ---- single fix --------------------------------------------------------

  async applyFix(issue: CodeIssue): Promise<void> {
    if (!codeIssueHasFix(issue)) {
      return this.generateAndApplyFix(issue);
    }
    await this.applyInlineFix(issue);
    this.onFixApplied(issue);
  }

  // ---- apply all fixes ---------------------------------------------------

  async applyAllFixes(result: ReviewResult): Promise<number> {
    const allIssues = result.issues;
    if (allIssues.length === 0) return 0;

    const issuesByFile = groupByFile(allIssues);
    let applied = 0;
    for (const [filePath, issues] of issuesByFile) {
      try {
        await this.applyBatchFix(filePath, issues);
        applied += issues.length;
      } catch (e) {
        log("Failed to apply batch fix for file: " + filePath);
      }
    }
    return applied;
  }

  // ---- fix preview -------------------------------------------------------

  async generateFixPreview(issue: CodeIssue): Promise<FixPreview> {
    const fileContent = readFileContent(issue.filePath);
    if (fileContent == null) {
      throw new DevAIException("File not found: " + issue.filePath, ErrorCode.FILE_NOT_FOUND);
    }
    const prompt = buildFixPrompt(issue, fileContent);
    const content = await executeForContent(
      newRequest(OperationType.APPLY_FIX, null, prompt, { filePath: issue.filePath })
    );
    if (content == null || content.trim().length === 0) {
      throw new DevAIException("Failed to generate fix: empty response", ErrorCode.GENERATION_FAILED);
    }
    return { filePath: issue.filePath, originalContent: fileContent, fixedContent: stripCodeFences(content), issues: [issue] };
  }

  async generateAllFixPreviews(result: ReviewResult): Promise<FixPreview[]> {
    const allIssues = result.issues;
    if (allIssues.length === 0) return [];

    const issuesByFile = groupByFile(allIssues);
    const previews: FixPreview[] = [];
    for (const [filePath, issues] of issuesByFile) {
      try {
        const preview = await this.generateBatchFixPreview(filePath, issues);
        if (fixPreviewHasChanges(preview)) previews.push(preview);
      } catch (e) {
        log("Failed to generate fix preview for: " + filePath);
      }
    }
    return previews;
  }

  async applyFixPreview(preview: FixPreview): Promise<void> {
    await this.writeFullContent(preview.filePath, preview.fixedContent);
    for (const issue of preview.issues) this.onFixApplied(issue);
  }

  // ---- internals ---------------------------------------------------------

  private async generateAndApplyFix(issue: CodeIssue): Promise<void> {
    const fileContent = readFileContent(issue.filePath);
    if (fileContent == null) {
      throw new DevAIException("File not found: " + issue.filePath, ErrorCode.FILE_NOT_FOUND);
    }
    const prompt = buildFixPrompt(issue, fileContent);
    const content = await executeForContent(
      newRequest(OperationType.APPLY_FIX, null, prompt, { filePath: issue.filePath })
    );
    await this.writeFixedContent(content, issue.filePath, [issue]);
  }

  private async applyBatchFix(filePath: string, issues: CodeIssue[]): Promise<void> {
    const fileContent = readFileContent(filePath);
    if (fileContent == null) {
      throw new DevAIException("File not found: " + filePath, ErrorCode.FILE_NOT_FOUND);
    }
    const prompt = buildBatchFixPrompt(filePath, issues, fileContent);
    const content = await executeForContent(
      newRequest(OperationType.APPLY_FIX, null, prompt, { filePath })
    );
    await this.writeFixedContent(content, filePath, issues);
  }

  private async generateBatchFixPreview(filePath: string, issues: CodeIssue[]): Promise<FixPreview> {
    const fileContent = readFileContent(filePath);
    if (fileContent == null) {
      throw new DevAIException("File not found: " + filePath, ErrorCode.FILE_NOT_FOUND);
    }
    const prompt = buildBatchFixPrompt(filePath, issues, fileContent);
    const content = await executeForContent(
      newRequest(OperationType.APPLY_FIX, null, prompt, { filePath })
    );
    if (content == null || content.trim().length === 0) {
      throw new DevAIException("Failed to generate fix: empty response", ErrorCode.GENERATION_FAILED);
    }
    return { filePath, originalContent: fileContent, fixedContent: stripCodeFences(content), issues };
  }

  /** Cleans an AI response and writes it to the file, notifying listeners. */
  private async writeFixedContent(content: string, filePath: string, issues: CodeIssue[]): Promise<void> {
    if (content == null || content.trim().length === 0) {
      throw new DevAIException("Failed to generate fix: empty response", ErrorCode.GENERATION_FAILED);
    }
    await this.writeFullContent(filePath, stripCodeFences(content));
    for (const issue of issues) this.onFixApplied(issue);
  }

  /** Replaces the entire content of a file via a WorkspaceEdit. */
  private async writeFullContent(filePath: string, fixedContent: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, fullRange, fixedContent);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) await doc.save();
  }

  /** Replaces the issue's line range with its suggested fix via a WorkspaceEdit. */
  private async applyInlineFix(issue: CodeIssue): Promise<void> {
    const fix = issue.suggestedFix;
    if (fix == null) return;

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.filePath));
    const startLine = Math.max(0, issue.startLine - 1);
    const endLineIdx = issue.endLine - 1;
    const start = new vscode.Position(startLine, 0);
    const end =
      endLineIdx < doc.lineCount
        ? doc.lineAt(endLineIdx).range.end
        : doc.positionAt(doc.getText().length);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(start, end), fix);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) await doc.save();
  }
}

function groupByFile(issues: CodeIssue[]): Map<string, CodeIssue[]> {
  const map = new Map<string, CodeIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.filePath);
    if (list) list.push(issue);
    else map.set(issue.filePath, [issue]);
  }
  return map;
}
