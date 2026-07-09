import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  FileContext,
  PromptContext,
  forChat,
  forFile,
  forFolder,
  forReview,
} from "../models/chat";
import { workspaceRoot as coreWorkspaceRoot, log } from "../core/context";
import { runProcess } from "../util/exec";
import { MAX_CONTENT_LENGTH, GIT_TIMEOUT_MS } from "./constants";

/** Diff scope for chat-mode code review. Port of models.diff.DiffScope. */
export enum DiffScope {
  FEATURE_BRANCH = "FEATURE_BRANCH",
  UNCOMMITTED = "UNCOMMITTED",
  STAGED = "STAGED",
  CURRENT_FILE = "CURRENT_FILE",
}

export function diffScopeDisplayName(scope: DiffScope): string {
  switch (scope) {
    case DiffScope.FEATURE_BRANCH:
      return "Feature Branch";
    case DiffScope.UNCOMMITTED:
      return "Uncommitted Changes";
    case DiffScope.STAGED:
      return "Staged Changes";
    case DiffScope.CURRENT_FILE:
      return "Current File";
  }
}

const LANGUAGE_MAP: Record<string, string> = {
  java: "java", kt: "kotlin", kts: "kotlin", py: "python", ts: "typescript",
  tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", cs: "csharp",
  go: "go", rs: "rust", rb: "ruby", php: "php", swift: "swift", scala: "scala",
  cpp: "cpp", c: "c", h: "c", hpp: "cpp", sql: "sql", html: "html", css: "css",
  xml: "xml", json: "json", yaml: "yaml", yml: "yaml", md: "markdown", tf: "terraform",
  tfvars: "terraform", sh: "shellscript", bash: "shellscript", gradle: "groovy", groovy: "groovy",
};

/**
 * Port of ChatModeContextGathererServiceImpl, adapted to VS Code.
 * IntelliJ VFS/PSI reads map to the workspace filesystem and the active editor.
 */
export class ChatModeContextGatherer {
  private static _instance: ChatModeContextGatherer | undefined;

  static getInstance(): ChatModeContextGatherer {
    if (!ChatModeContextGatherer._instance) {
      ChatModeContextGatherer._instance = new ChatModeContextGatherer();
    }
    return ChatModeContextGatherer._instance;
  }

  private getWorkspaceRoot(): string {
    return coreWorkspaceRoot() ?? "";
  }

  getActiveFileContext(): FileContext | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    return this.getFileContextFromPath(editor.document.uri.fsPath);
  }

  getFileContextFromPath(filePath: string): FileContext | null {
    let content: string;
    let isTruncated = false;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      log("Failed to read file content: " + filePath + " — " + (e instanceof Error ? e.message : String(e)));
      content = "// Unable to read file content";
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + "\n\n... (content truncated)";
      isTruncated = true;
    }

    const fileName = path.basename(filePath);
    const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : null;
    const language = extension ? LANGUAGE_MAP[extension] ?? "plaintext" : "plaintext";

    const basePath = this.getWorkspaceRoot();
    const relativePath =
      basePath && filePath.startsWith(basePath) ? filePath.substring(basePath.length + 1) : fileName;

    const lineCount = content.split("\n").length;
    return { path: filePath, relativePath, fileName, language, content, isTruncated, lineCount };
  }

  buildContextForActiveFile(): PromptContext {
    const workspaceRoot = this.getWorkspaceRoot();
    const fileContext = this.getActiveFileContext();
    return fileContext ? forFile(fileContext, workspaceRoot) : forChat(null, workspaceRoot);
  }

  buildContextForFile(filePath: string): PromptContext {
    const workspaceRoot = this.getWorkspaceRoot();
    const fileContext = this.getFileContextFromPath(filePath);
    return fileContext ? forFile(fileContext, workspaceRoot) : forChat(null, workspaceRoot);
  }

  buildContextForFolder(folderPath: string): PromptContext {
    return forFolder(folderPath, this.getWorkspaceRoot());
  }

  async buildContextForReview(
    scope: DiffScope,
    baseBranch: string | null,
    currentFilePath: string | null
  ): Promise<PromptContext> {
    const workspaceRoot = this.getWorkspaceRoot();

    let fileContext: FileContext | null = null;
    if (currentFilePath) {
      fileContext = this.getFileContextFromPath(currentFilePath);
    } else {
      fileContext = this.getActiveFileContext();
    }

    let diffContent = await this.runGitDiff(scope, baseBranch, currentFilePath, workspaceRoot);
    const changedFiles = await this.runGitChangedFiles(scope, baseBranch, currentFilePath, workspaceRoot);

    if (diffContent.trim().length === 0) {
      log("No diff content found for scope: " + scope);
      diffContent = `(No changes detected for scope: ${diffScopeDisplayName(scope)})`;
    }

    return forReview(fileContext, workspaceRoot, diffContent, changedFiles);
  }

  private async runGitDiff(
    scope: DiffScope,
    baseBranch: string | null,
    currentFilePath: string | null,
    workspaceRoot: string
  ): Promise<string> {
    const args = await this.buildGitDiffArgs(scope, baseBranch, currentFilePath, workspaceRoot);
    return this.executeGit(args, workspaceRoot);
  }

  private async runGitChangedFiles(
    scope: DiffScope,
    baseBranch: string | null,
    currentFilePath: string | null,
    workspaceRoot: string
  ): Promise<string> {
    const args = await this.buildGitChangedFilesArgs(scope, baseBranch, currentFilePath, workspaceRoot);
    const output = await this.executeGit(args, workspaceRoot);
    if (output.trim().length === 0) return "(No changed files)";
    const files = output.split("\n");
    return `${files.length} file(s) changed:\n${output}`;
  }

  private async buildGitDiffArgs(
    scope: DiffScope,
    baseBranch: string | null,
    currentFilePath: string | null,
    workspaceRoot: string
  ): Promise<string[]> {
    switch (scope) {
      case DiffScope.FEATURE_BRANCH: {
        const base = baseBranch ?? (await this.detectDefaultBranch(workspaceRoot));
        return ["diff", `${base}...HEAD`];
      }
      case DiffScope.UNCOMMITTED:
        return ["diff", "HEAD"];
      case DiffScope.STAGED:
        return ["diff", "--cached"];
      case DiffScope.CURRENT_FILE:
        return currentFilePath ? ["diff", "HEAD", "--", currentFilePath] : ["diff", "HEAD"];
    }
  }

  private async buildGitChangedFilesArgs(
    scope: DiffScope,
    baseBranch: string | null,
    currentFilePath: string | null,
    workspaceRoot: string
  ): Promise<string[]> {
    switch (scope) {
      case DiffScope.FEATURE_BRANCH: {
        const base = baseBranch ?? (await this.detectDefaultBranch(workspaceRoot));
        return ["diff", "--name-status", `${base}...HEAD`];
      }
      case DiffScope.UNCOMMITTED:
        return ["diff", "--name-status", "HEAD"];
      case DiffScope.STAGED:
        return ["diff", "--name-status", "--cached"];
      case DiffScope.CURRENT_FILE:
        return currentFilePath
          ? ["diff", "--name-status", "HEAD", "--", currentFilePath]
          : ["diff", "--name-status", "HEAD"];
    }
  }

  private async detectDefaultBranch(workspaceRoot: string): Promise<string> {
    for (const branch of ["main", "master", "develop"]) {
      const result = await this.executeGit(["rev-parse", "--verify", branch], workspaceRoot);
      if (result.trim().length > 0 && !result.startsWith("fatal")) return branch;
    }
    return "main";
  }

  private async executeGit(args: string[], workingDir: string): Promise<string> {
    if (!workingDir) return "";
    const result = await runProcess("git", args, { cwd: workingDir, timeoutMs: GIT_TIMEOUT_MS });
    if (result.timedOut) {
      log("Git command timed out: git " + args.join(" "));
      return "";
    }
    if (result.exitCode !== 0) {
      log(`Git command failed (exit ${result.exitCode}): git ${args.join(" ")} — ${result.stderr}`);
      return "";
    }
    let output = result.stdout.replace(/\n$/, "");
    if (output.length > MAX_CONTENT_LENGTH) {
      output =
        output.substring(0, MAX_CONTENT_LENGTH) + `\n\n... (diff truncated — ${output.length} total chars)`;
    }
    return output;
  }
}
