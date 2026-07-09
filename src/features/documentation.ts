import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ExecutionMode } from "../models";
import { workspaceRoot } from "../core/context";
import { notifyInfo, notifyWarning, notifyError } from "../util/notify";
import { readTextFile, writeAndOpen, writeTextFile, baseName, stripExtension, extensionOf } from "../util/files";
import { resolveAvailableMarkdownPath } from "../util/response";
import { getActiveSelection } from "../util/codeSelection";
import {
  DocFormat,
  docFormatFromLanguage,
  docFormatStartDelimiter,
  docFormatEndDelimiter,
} from "../models/documentation";
import {
  generateDocumentationComment,
  generateReadme,
  generateFileDocumentation,
  generateFolderDocumentation,
  isFolderSourceExtension,
  FolderSourceFile,
  buildBusinessLogicContext,
  generateBusinessLogicSummary,
  updateDocsOnChanges,
} from "../services/documentationService";
import {
  isAcceptedRequirementsFormat,
  readRequirementsDocument,
  generateUserStoriesContent,
  parseUserStoriesFromResponse,
  rowsToCsv,
  resolveAvailableCsvPath,
} from "../services/userStoriesService";

/**
 * Registers the documentation command cluster, ported from:
 *  - actions/generation/GenerateDocumentationAction.java   -> devai.generateDocumentation
 *  - actions/generation/GenerateReadmeAction.java           -> devai.generateReadme
 *  - actions/GenerateFileDocumentationAction.java           -> devai.generateFileDocumentation
 *  - actions/GenerateFolderDocumentationAction.java         -> devai.generateFolderDocumentation
 *  - actions/generation/UpdateDocsOnChangesAction.java      -> devai.updateDocsOnChanges
 *  - actions/GetBusinessLogicSummaryAction.java             -> devai.getBusinessLogicSummary
 *  - actions/generation/GenerateUserStoriesAction.java      -> devai.generateUserStories
 */
export function registerDocumentation(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateDocumentation", handleGenerateDocumentation),
    vscode.commands.registerCommand("devai.generateReadme", handleGenerateReadme),
    vscode.commands.registerCommand("devai.generateFileDocumentation", handleGenerateFileDocumentation),
    vscode.commands.registerCommand("devai.generateFolderDocumentation", handleGenerateFolderDocumentation),
    vscode.commands.registerCommand("devai.updateDocsOnChanges", handleUpdateDocsOnChanges),
    vscode.commands.registerCommand("devai.getBusinessLogicSummary", handleGetBusinessLogicSummary),
    vscode.commands.registerCommand("devai.generateUserStories", handleGenerateUserStories)
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function withProgressNotification<T>(title: string, task: () => Promise<T>): Promise<T | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    async () => {
      try {
        return await task();
      } catch (e) {
        notifyError(errMsg(e));
        return undefined;
      }
    }
  );
}

// ---------------------------------------------------------------------------
// devai.generateDocumentation — inline doc comment for the active selection
// ---------------------------------------------------------------------------

async function handleGenerateDocumentation(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    notifyWarning("Open a file and position the cursor on a class, method, or field.");
    return;
  }
  const selection = await getActiveSelection();
  if (!selection || !selection.text || selection.text.trim().length === 0) {
    notifyWarning("Please position the cursor on a class, method, or field, or select code.");
    return;
  }

  await withProgressNotification("Generating Documentation", async () => {
    const format = docFormatFromLanguage(selection.languageName);
    const comment = await generateDocumentationComment(selection, format);
    const action = await applyDocumentationEdit(editor.document, selection, format, comment.fullComment);
    notifyInfo(action === "updated" ? "Documentation has been updated." : "Documentation has been added.");
  });
}

/**
 * Port of GenerateDocumentationAction.applyDocumentation. Detects an existing
 * doc-comment block immediately above the target symbol and replaces it;
 * otherwise inserts a new, correctly indented comment at the symbol's start.
 * Simplification vs. the Java version: the Java action shows an Accept/Edit/
 * Cancel preview popup before applying. VS Code has no direct equivalent of
 * that inline popup, so this port applies the edit immediately (matching the
 * DEV_NOTES guidance to insert directly when an exact interactive preview
 * isn't feasible) and reports success via a notification.
 */
async function applyDocumentationEdit(
  document: vscode.TextDocument,
  selection: { startOffset: number },
  format: DocFormat,
  commentText: string
): Promise<"updated" | "added"> {
  const insertPos = document.positionAt(selection.startOffset);
  const lineStart = document.lineAt(insertPos.line).range.start;
  const indent = document.getText(new vscode.Range(lineStart, insertPos)).match(/^\s*/)?.[0] ?? "";

  const existingRange = findExistingDocCommentRange(document, insertPos, format);
  const indented = indentCommentBlock(commentText, indent);

  const edit = new vscode.WorkspaceEdit();
  if (existingRange) {
    edit.replace(document.uri, existingRange, `${indented}\n${indent}`);
    await vscode.workspace.applyEdit(edit);
    return "updated";
  }
  edit.insert(document.uri, lineStart, `${indented}\n${indent}`);
  await vscode.workspace.applyEdit(edit);
  return "added";
}

function indentCommentBlock(comment: string, indent: string): string {
  return comment
    .split("\n")
    .map((line, i) => (i === 0 ? line : indent + line))
    .join("\n");
}

/** Scans upward from insertPos for an existing doc-comment block to replace. */
function findExistingDocCommentRange(
  doc: vscode.TextDocument,
  insertPos: vscode.Position,
  format: DocFormat
): vscode.Range | null {
  const endDelim = docFormatEndDelimiter(format).trim();
  const startDelim = docFormatStartDelimiter(format).trim();
  if (!endDelim) return null; // e.g. XML doc `///` line comments — always insert fresh

  let line = insertPos.line - 1;
  while (line >= 0 && doc.lineAt(line).text.trim().length === 0) line--;
  if (line < 0 || !doc.lineAt(line).text.trim().endsWith(endDelim)) return null;

  while (line >= 0 && !doc.lineAt(line).text.trim().startsWith(startDelim)) line--;
  if (line < 0) return null;

  const startLine = line;
  const start = new vscode.Position(startLine, doc.lineAt(startLine).firstNonWhitespaceCharacterIndex);
  return new vscode.Range(start, insertPos);
}

// ---------------------------------------------------------------------------
// devai.generateReadme — project -> README.md
// ---------------------------------------------------------------------------

async function handleGenerateReadme(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    notifyWarning("Open a project folder to generate a README.");
    return;
  }
  await withProgressNotification("Generating README", async () => {
    const projectName = path.basename(root);
    const content = await generateReadme(root, projectName);
    if (!content || content.trim().length === 0) throw new Error("Empty response");
    const outPath = path.join(root, "README.md");
    await writeAndOpen(outPath, content);
    notifyInfo("README.md has been created in the project root.");
  });
}

// ---------------------------------------------------------------------------
// devai.generateFileDocumentation — a source file -> technical .md
// ---------------------------------------------------------------------------

async function handleGenerateFileDocumentation(uri?: vscode.Uri): Promise<void> {
  const filePath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!filePath) {
    notifyWarning("Open or select a file to generate documentation for.");
    return;
  }
  let isDir = false;
  try {
    isDir = fs.statSync(filePath).isDirectory();
  } catch {
    notifyWarning("The selected file could not be found.");
    return;
  }
  if (isDir) {
    notifyWarning("Select a file (not a folder) to generate file documentation for.");
    return;
  }

  await withProgressNotification("Generating File Documentation", async () => {
    const content = readTextFile(filePath);
    if (content == null) throw new Error(`Failed to read file: ${filePath}`);

    const languageId = extensionOf(filePath) ?? "code";
    const docContent = await generateFileDocumentation(baseName(filePath), languageId, content);
    if (!docContent || docContent.trim().length === 0) throw new Error("Empty response");

    const docDir = path.join(path.dirname(filePath), "documentation");
    const docName = `${stripExtension(baseName(filePath))}.md`;
    await writeAndOpen(path.join(docDir, docName), docContent);
    notifyInfo(`${docName} created in documentation/ folder.`);
  });
}

// ---------------------------------------------------------------------------
// devai.generateFolderDocumentation — explorer folder -> summary .md
// ---------------------------------------------------------------------------

async function handleGenerateFolderDocumentation(uri?: vscode.Uri): Promise<void> {
  let folderPath = uri?.fsPath;
  if (!folderPath) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Folder",
    });
    folderPath = picked?.[0]?.fsPath;
  }
  if (!folderPath) return;
  const targetFolder = folderPath;

  await withProgressNotification("Generating Folder Documentation", async () => {
    const files = collectFolderSourceFiles(targetFolder);
    if (files.length === 0) throw new Error(`No source files found in ${baseName(targetFolder)}`);

    const docContent = await generateFolderDocumentation(baseName(targetFolder), files);
    if (!docContent || docContent.trim().length === 0) throw new Error("Empty response");

    const docName = `${baseName(targetFolder)}-summary.md`;
    await writeAndOpen(path.join(targetFolder, docName), docContent);
    notifyInfo(`${docName} created in ${baseName(targetFolder)}/`);
  });
}

function collectFolderSourceFiles(folderPath: string): FolderSourceFile[] {
  const files: FolderSourceFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = extensionOf(e.name);
    if (!isFolderSourceExtension(ext)) continue;
    const content = readTextFile(path.join(folderPath, e.name));
    if (content != null) files.push({ name: e.name, ext: ext ?? "code", content });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

// ---------------------------------------------------------------------------
// devai.updateDocsOnChanges — update existing docs based on git diff
// ---------------------------------------------------------------------------

async function handleUpdateDocsOnChanges(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    notifyWarning("Open a project folder to update documentation.");
    return;
  }
  await withProgressNotification("Updating Documentation", async () => {
    const outcome = await updateDocsOnChanges(root);
    if (!outcome) {
      notifyInfo("No uncommitted changes detected to update documentation for.");
      return;
    }
    if (outcome.mode === ExecutionMode.SDK) {
      notifyInfo("Copilot applied documentation updates directly to source files.");
    } else {
      // Chat mode (VS Code Language Model API) can only return text — it cannot
      // edit files the way the Copilot CLI's --allow-tool=write can. Show the
      // suggested updates instead of falsely claiming files were changed.
      const doc = await vscode.workspace.openTextDocument({ content: outcome.content, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: false });
      notifyInfo(
        "Chat mode returned suggested documentation updates (opened in a new editor). Switch to SDK mode to apply edits automatically."
      );
    }
  });
}

// ---------------------------------------------------------------------------
// devai.getBusinessLogicSummary — file or folder -> business summary .md
// ---------------------------------------------------------------------------

async function handleGetBusinessLogicSummary(uri?: vscode.Uri): Promise<void> {
  let targetPath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!targetPath) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select File or Folder",
    });
    targetPath = picked?.[0]?.fsPath;
  }
  if (!targetPath) return;
  const target = targetPath;

  await withProgressNotification("Generating Business Logic Summary", async () => {
    let isDir: boolean;
    try {
      isDir = fs.statSync(target).isDirectory();
    } catch {
      throw new Error(`Could not access: ${target}`);
    }

    const codeContext = buildBusinessLogicContext(target, isDir);
    if (!codeContext || codeContext.trim().length === 0) {
      throw new Error("No supported source files found in the selected target.");
    }

    const content = await generateBusinessLogicSummary(codeContext, baseName(target));
    if (!content || content.trim().length === 0) throw new Error("Empty response");

    const outDir = isDir ? target : path.dirname(target);
    const baseOutputName = isDir
      ? `${baseName(target)}-business-summary`
      : `${stripExtension(baseName(target))}-business-summary`;
    const outPath = resolveAvailableMarkdownPath(outDir, baseOutputName);
    await writeAndOpen(outPath, content);
    notifyInfo(`${baseName(outPath)} created successfully.`);
  });
}

// ---------------------------------------------------------------------------
// devai.generateUserStories — requirements doc -> Jira-ready user stories
// ---------------------------------------------------------------------------

async function handleGenerateUserStories(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Select Requirements Document",
    filters: { "Requirements documents": ["md", "txt", "doc", "docx", "pdf"] },
  });
  const file = picked?.[0];
  if (!file) return;
  const filePath = file.fsPath;

  if (!isAcceptedRequirementsFormat(filePath)) {
    notifyError("Unsupported file type. Supported requirements formats are .md, .txt, .doc, .docx, .pdf");
    return;
  }

  await withProgressNotification("Generating User Stories", async () => {
    const requirementsContent = readRequirementsDocument(filePath);
    if (!requirementsContent || requirementsContent.trim().length === 0) {
      throw new Error("The selected requirements file is empty.");
    }

    const targetName = stripExtension(baseName(filePath));
    const content = await generateUserStoriesContent(requirementsContent, targetName);
    if (!content || content.trim().length === 0) throw new Error("Empty response");

    const outDir = path.dirname(filePath);
    const outPath = resolveAvailableMarkdownPath(outDir, `${targetName}-user-stories`);
    await writeAndOpen(outPath, content);
    notifyInfo(`${baseName(outPath)} created successfully.`);

    // Best-effort: emit a companion Jira-import-ready CSV when the response
    // contains the mandatory ```csv section (see resources/prompts/user-stories-generation.md).
    const rows = parseUserStoriesFromResponse(content);
    if (rows.length > 0) {
      const csvPath = resolveAvailableCsvPath(outDir, `${targetName}-user-stories`);
      writeTextFile(csvPath, rowsToCsv(rows));
      notifyInfo(`${baseName(csvPath)} created for Jira import.`);
    }
  });
}
