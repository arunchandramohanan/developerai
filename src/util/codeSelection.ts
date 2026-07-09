import * as vscode from "vscode";
import { CodeSelection, ElementType } from "../models";

/**
 * Port of com.bmo.devai.intellij.util.CodeSelectionUtil, adapted to VS Code.
 * PSI-based element resolution maps to the DocumentSymbol provider.
 */

const LANGUAGE_DISPLAY: Record<string, string> = {
  java: "Java",
  kotlin: "Kotlin",
  scala: "Scala",
  groovy: "Groovy",
  python: "Python",
  javascript: "JavaScript",
  javascriptreact: "JavaScript",
  typescript: "TypeScript",
  typescriptreact: "TypeScript",
  go: "Go",
  rust: "Rust",
  ruby: "Ruby",
  php: "PHP",
  csharp: "C#",
  c: "C",
  cpp: "C++",
  swift: "Swift",
  yaml: "YAML",
  json: "JSON",
  markdown: "Markdown",
  xml: "XML",
  sql: "SQL",
  shellscript: "Shell Script",
};

export function displayNameForLanguage(languageId: string): string {
  return LANGUAGE_DISPLAY[languageId] ?? capitalize(languageId);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function symbolElementType(kind: vscode.SymbolKind): ElementType {
  switch (kind) {
    case vscode.SymbolKind.Class:
    case vscode.SymbolKind.Struct:
    case vscode.SymbolKind.Interface:
    case vscode.SymbolKind.Enum:
      return ElementType.CLASS;
    case vscode.SymbolKind.Method:
    case vscode.SymbolKind.Function:
    case vscode.SymbolKind.Constructor:
      return ElementType.METHOD;
    case vscode.SymbolKind.Field:
    case vscode.SymbolKind.Property:
    case vscode.SymbolKind.Variable:
      return ElementType.FIELD;
    default:
      return ElementType.UNKNOWN;
  }
}

/** Builds a CodeSelection from the given editor, resolving the enclosing symbol when nothing is selected. */
export async function getSelection(editor: vscode.TextEditor): Promise<CodeSelection | null> {
  const doc = editor.document;
  const filePath = doc.uri.fsPath;
  const language = displayNameForLanguage(doc.languageId);

  // Explicit selection
  if (!editor.selection.isEmpty) {
    const text = doc.getText(editor.selection);
    if (text && text.trim().length > 0) {
      return {
        text,
        filePath,
        languageName: language,
        startOffset: doc.offsetAt(editor.selection.start),
        endOffset: doc.offsetAt(editor.selection.end),
        elementType: ElementType.BLOCK,
      };
    }
  }

  // No selection: try to resolve enclosing method/class via symbols
  const enclosing = await findEnclosingSymbol(doc.uri, editor.selection.active);
  if (enclosing) {
    const text = doc.getText(enclosing.range);
    return {
      text,
      filePath,
      languageName: language,
      startOffset: doc.offsetAt(enclosing.range.start),
      endOffset: doc.offsetAt(enclosing.range.end),
      elementType: symbolElementType(enclosing.kind),
    };
  }

  // Fallback: whole file
  const fileText = doc.getText();
  if (!fileText || fileText.trim().length === 0) return null;
  return {
    text: fileText,
    filePath,
    languageName: language,
    startOffset: 0,
    endOffset: fileText.length,
    elementType: ElementType.FILE,
  };
}

/** Convenience for the current active editor. */
export async function getActiveSelection(): Promise<CodeSelection | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  return getSelection(editor);
}

/** Builds a whole-file CodeSelection for a document/uri. */
export function fileSelection(doc: vscode.TextDocument): CodeSelection {
  const text = doc.getText();
  return {
    text,
    filePath: doc.uri.fsPath,
    languageName: displayNameForLanguage(doc.languageId),
    startOffset: 0,
    endOffset: text.length,
    elementType: ElementType.FILE,
  };
}

async function findEnclosingSymbol(
  uri: vscode.Uri,
  position: vscode.Position
): Promise<{ range: vscode.Range; kind: vscode.SymbolKind } | null> {
  let symbols: vscode.DocumentSymbol[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri
    );
  } catch {
    return null;
  }
  if (!symbols || symbols.length === 0) return null;

  // Prefer the deepest method/function; otherwise the deepest class.
  const methods: vscode.DocumentSymbol[] = [];
  const classes: vscode.DocumentSymbol[] = [];

  const visit = (sym: vscode.DocumentSymbol): void => {
    if (sym.range.contains(position)) {
      const et = symbolElementType(sym.kind);
      if (et === ElementType.METHOD) methods.push(sym);
      else if (et === ElementType.CLASS) classes.push(sym);
      for (const child of sym.children) visit(child);
    }
  };
  for (const sym of symbols) visit(sym);

  const chosen = methods.length > 0 ? methods[methods.length - 1] : classes[classes.length - 1];
  return chosen ? { range: chosen.range, kind: chosen.kind } : null;
}
