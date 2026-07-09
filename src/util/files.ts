import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/** Opens a file in an editor and reveals it. */
export async function openFile(filePath: string): Promise<vscode.TextEditor | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    return await vscode.window.showTextDocument(doc);
  } catch {
    return undefined;
  }
}

/** Writes the file, refreshes it in VS Code, and opens it. */
export async function writeAndOpen(filePath: string, content: string): Promise<void> {
  writeTextFile(filePath, content);
  await openFile(filePath);
}

export function baseName(p: string): string {
  return path.basename(p);
}

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.substring(0, dot) : fileName;
}

export function extensionOf(p: string | null | undefined): string | null {
  if (!p) return null;
  const name = path.basename(p);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.substring(dot + 1) : null;
}
