import * as fs from "fs";
import * as path from "path";
import { CodeSelection } from "../models";
import { PromptTemplateService } from "./promptTemplateService";
import { log } from "./context";

/**
 * Port of com.bmo.devai.intellij.util.PromptBuilder (selection-based builders).
 * Diff/review/fix builders that depend on DiffSummary & CodeIssue live in the
 * code-review feature module.
 */
const MAX_DOC_FILE_SIZE = 10_000;

export function buildTestGenerationPrompt(
  selection: CodeSelection,
  framework: string | null,
  fullFileContent: string | null = null
): string {
  const sourceFileName = path.basename(selection.filePath);
  const dot = sourceFileName.lastIndexOf(".");
  const sourceModuleName = dot > 0 ? sourceFileName.substring(0, dot) : sourceFileName;

  const selectionIsSubset =
    fullFileContent != null && fullFileContent.trim().length > 0 && fullFileContent !== selection.text;

  const vars: Record<string, string | null> = {
    language: selection.languageName,
    languageLower: selection.languageName.toLowerCase(),
    framework: framework,
    sourceFileName,
    sourceModuleName,
  };
  if (selectionIsSubset) {
    vars.fullFileContent = fullFileContent;
    vars.targetCode = selection.text;
    vars.simpleCode = null;
  } else {
    vars.fullFileContent = null;
    vars.simpleCode = fullFileContent != null && fullFileContent.trim().length > 0 ? fullFileContent : selection.text;
  }
  return PromptTemplateService.loadAndRender("test-generation-user.md", vars);
}

export function buildDocumentationPrompt(selection: CodeSelection, docFormat: string | null): string {
  return PromptTemplateService.loadAndRender("documentation-user.md", {
    docFormat: docFormat ?? "documentation",
    language: selection.languageName,
    languageLower: selection.languageName.toLowerCase(),
    code: selection.text,
  });
}

export function buildCodeReviewPrompt(selection: CodeSelection, focusAreas: string[] | null): string {
  return PromptTemplateService.loadAndRender("code-review-inline-user.md", {
    language: selection.languageName,
    languageLower: selection.languageName.toLowerCase(),
    code: selection.text,
    focusAreas: focusAreas && focusAreas.length > 0 ? focusAreas.join(", ") : null,
  });
}

export function buildApplyFixPrompt(
  selection: CodeSelection,
  issueDescription: string,
  suggestedFix: string | null
): string {
  return PromptTemplateService.loadAndRender("apply-fix-user.md", {
    language: selection.languageName,
    languageLower: selection.languageName.toLowerCase(),
    issueDescription,
    suggestedFix,
    code: selection.text,
  });
}

export function buildChatPrompt(message: string, selection: CodeSelection | null): string {
  if (!selection) return message;
  return PromptTemplateService.loadAndRender("chat-user.md", {
    language: selection.languageName,
    languageLower: selection.languageName.toLowerCase(),
    filePath: selection.filePath,
    code: selection.text,
    message,
  });
}

export function buildTestFixPrompt(testCode: string, errorOutput: string, sourceCode: string | null): string {
  const trimmedError =
    errorOutput.length > 3000 ? errorOutput.substring(0, 3000) + "\n... (truncated)" : errorOutput;
  return PromptTemplateService.loadAndRender("test-fix-user.md", {
    sourceCode: sourceCode && sourceCode.trim().length > 0 ? sourceCode : null,
    testCode,
    errorOutput: trimmedError,
  });
}

/**
 * Scans the project for .md documentation files and returns their content
 * formatted for prompt inclusion. Searches doc folders, root-level .md, and
 * files matching changed source file base names.
 */
export function collectExistingDocs(basePath: string, changedFilePaths: string[] = []): string {
  const docsParts: string[] = [];
  const seen = new Set<string>();
  const docFolders = ["docs", "doc", "documentation", "wiki", "guides", "api-docs", "reference"];

  const appendFile = (file: string) => {
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_DOC_FILE_SIZE) return;
      const rel = path.relative(basePath, file).replace(/\\/g, "/");
      const content = fs.readFileSync(file, "utf8");
      docsParts.push(`### File: \`${rel}\`\n\`\`\`\n${content}\n\`\`\`\n`);
    } catch (e) {
      log("Failed to read doc file: " + file);
    }
  };

  const walk = (dir: string, depth: number) => {
    if (depth < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth - 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        const norm = path.resolve(full);
        if (!seen.has(norm)) {
          seen.add(norm);
          appendFile(full);
        }
      }
    }
  };

  for (const folder of docFolders) {
    const docDir = path.join(basePath, folder);
    try {
      if (fs.statSync(docDir).isDirectory()) walk(docDir, 3);
    } catch {
      /* ignore */
    }
  }

  // Root-level .md
  try {
    for (const name of fs.readdirSync(basePath)) {
      if (name.toLowerCase().endsWith(".md")) {
        const full = path.join(basePath, name);
        const norm = path.resolve(full);
        if (fs.statSync(full).isFile() && !seen.has(norm)) {
          seen.add(norm);
          appendFile(full);
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Files matching changed source base names
  if (changedFilePaths.length > 0) {
    const mdNames = new Set<string>();
    for (const fp of changedFilePaths) {
      const fileName = fp.includes("/") ? fp.substring(fp.lastIndexOf("/") + 1) : fp;
      const dotIdx = fileName.lastIndexOf(".");
      if (dotIdx > 0) mdNames.add(fileName.substring(0, dotIdx).toLowerCase() + ".md");
    }
    if (mdNames.size > 0) {
      const walkMatch = (dir: string, depth: number) => {
        if (depth < 0) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === ".git") continue;
            walkMatch(full, depth - 1);
          } else if (e.isFile() && mdNames.has(e.name.toLowerCase())) {
            const norm = path.resolve(full);
            if (!seen.has(norm)) {
              seen.add(norm);
              appendFile(full);
            }
          }
        }
      };
      walkMatch(basePath, 10);
    }
  }

  return docsParts.join("\n");
}
