import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CodeSelection, OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { buildTestGenerationPrompt } from "../core/promptBuilder";
import { fileSelection } from "../util/codeSelection";
import { workspaceRoot, logError } from "../core/context";
import { GeneratedTest, TestFramework, newGeneratedTest } from "../models/testing";

/**
 * Port of com.bmo.devai.intellij.services.impl.TestGenerationServiceImpl.
 * PSI-based class/method lookup and IntelliJ's ProjectRootManager test-root
 * discovery have no VS Code equivalent; both are replaced with
 * selection/file-path heuristics (see suggestTestFilePath/findTestSourceRoot).
 */

const AGENT_PATH_HINT = /^(?:\/\/|#|--|;)\s*@devai-test-path:\s*(.+)$/;
const AGENT_FRAMEWORK_HINT = /^(?:\/\/|#|--|;)\s*@devai-framework:\s*(.+)$/;

export interface FolderGenerationListener {
  onFileStarted?(fileName: string, current: number, total: number): void;
  onFileCompleted?(fileName: string, result: GeneratedTest): void;
  onFileSkipped?(fileName: string, reason: string): void;
  onFileFailed?(fileName: string, error: unknown): void;
}

// Broader than the Java folder action (which was Java-only): reuses the same
// multi-language source-extension set as the folder-documentation feature,
// since the underlying generation core (doGenerateTests) is already
// language-agnostic for the single-file action.
const SOURCE_EXTENSIONS = new Set([
  "java", "kt", "py", "go", "rs", "cs", "ts", "js", "tsx", "jsx",
  "cpp", "c", "h", "hpp", "rb", "swift", "scala", "php", "mjs", "cjs",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", ".vscode", "__pycache__", ".venv", "venv",
]);

const TEST_NAME_SUFFIXES = [
  /Test\.\w+$/, /Tests\.\w+$/, /IT\.\w+$/, /\.test\.\w+$/, /\.spec\.\w+$/, /_test\.\w+$/, /_spec\.\w+$/,
];

function isTestFileName(fileName: string): boolean {
  if (/^test_/.test(fileName)) return true;
  return TEST_NAME_SUFFIXES.some((re) => re.test(fileName));
}

/**
 * Idiomatic test-file base name for the given file extension (no extension
 * appended). Only reached when the agent did not emit a @devai-test-path
 * hint. Port of TestGenerationServiceImpl.buildTestFileBaseName.
 */
export function buildTestFileBaseName(targetClassName: string, sourceExt: string): string {
  switch (sourceExt.toLowerCase()) {
    case "py":
      return `test_${targetClassName}`;
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
    case "mjs":
    case "cjs":
    case "mts":
    case "cts":
      return `${targetClassName}.test`;
    case "go":
    case "rs":
    case "c":
      return `${targetClassName}_test`;
    case "rb":
      return `${targetClassName}_spec`;
    default:
      return `${targetClassName}Test`;
  }
}

/** Port of TestGenerationServiceImpl.extractAgentSuggestedPath. */
export function extractAgentSuggestedPath(rawContent: string): string | null {
  const trimmed = rawContent.trim();
  const fenceStart = trimmed.indexOf("```");
  if (fenceStart < 0) return null;
  const afterOpen = trimmed.indexOf("\n", fenceStart);
  if (afterOpen < 0) return null;
  const firstLine = trimmed
    .substring(afterOpen + 1)
    .replace(/^\s+/, "")
    .split(/\r?\n/)[0]
    ?.trim() ?? "";
  const m = AGENT_PATH_HINT.exec(firstLine);
  return m ? m[1].trim() : null;
}

/** Port of TestGenerationServiceImpl.extractAgentSuggestedFramework. */
export function extractAgentSuggestedFramework(rawContent: string): string | null {
  const trimmed = rawContent.trim();
  let scanFrom = 0;
  const fenceStart = trimmed.indexOf("```");
  if (fenceStart >= 0) {
    const afterOpen = trimmed.indexOf("\n", fenceStart);
    if (afterOpen >= 0) scanFrom = afterOpen + 1;
  }
  const lines = trimmed.substring(scanFrom).replace(/^\s+/, "").split(/\r?\n/).slice(0, 3);
  for (const line of lines) {
    const m = AGENT_FRAMEWORK_HINT.exec(line.trim());
    if (m) return m[1].trim();
  }
  return null;
}

/** Port of TestGenerationServiceImpl.extractPackageName. */
export function extractPackageName(selection: CodeSelection): string | null {
  const text = selection.text;
  if (text && text.trim().length > 0) {
    const m = /^\s*package\s+([a-zA-Z_][a-zA-Z0-9_.]*);/m.exec(text);
    if (m) return m[1];
  }
  const filePath = selection.filePath;
  if (filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const marker = "/src/main/java/";
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const after = normalized.substring(idx + marker.length);
      const lastSlash = after.lastIndexOf("/");
      if (lastSlash > 0) return after.substring(0, lastSlash).replace(/\//g, ".");
    }
  }
  return null;
}

function resolveAgentPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  const root = workspaceRoot();
  return root ? path.join(root, relativePath) : relativePath;
}

/**
 * Heuristic replacement for ProjectRootManager.getContentSourceRoots(): looks
 * for a conventional test source directory under the workspace root.
 */
function findTestSourceRoot(): string | null {
  const root = workspaceRoot();
  if (!root) return null;
  for (const candidate of ["src/test/java", "src/test/kotlin", "src/test/scala", "test", "tests"]) {
    const p = path.join(root, candidate);
    try {
      if (fs.statSync(p).isDirectory()) return p;
    } catch {
      /* not present */
    }
  }
  return null;
}

/** Port of TestGenerationServiceImpl.suggestTestFilePath (language-aware variant). */
export function suggestTestFilePath(
  targetClassName: string,
  packageName: string | null,
  sourceExt: string,
  sourceFilePath: string
): string {
  const testFileName = `${buildTestFileBaseName(targetClassName, sourceExt)}.${sourceExt}`;
  const testRoot = findTestSourceRoot();
  if (testRoot) {
    const base = packageName && packageName.trim().length > 0
      ? path.join(testRoot, ...packageName.split("."))
      : testRoot;
    return path.join(base, testFileName);
  }
  const parent = path.dirname(sourceFilePath);
  return path.join(parent, testFileName);
}

/** Port of TestGenerationServiceImpl.cleanGeneratedContent. */
function cleanGeneratedContent(content: string, packageName: string | null, language: string): string {
  let cleaned = content.trim();

  const fenceStart = cleaned.indexOf("```");
  if (fenceStart >= 0) {
    const afterOpen = cleaned.indexOf("\n", fenceStart);
    if (afterOpen > 0) {
      const fenceEnd = cleaned.indexOf("```", afterOpen + 1);
      cleaned = fenceEnd > 0 ? cleaned.substring(afterOpen + 1, fenceEnd) : cleaned.substring(afterOpen + 1);
    }
  }
  cleaned = cleaned.trim();

  cleaned = cleaned.replace(/^(?:\/\/|#|--|;)\s*@devai-test-path:[^\n]*\n?/, "");
  cleaned = cleaned.replace(/^(?:\/\/|#|--|;)\s*@devai-framework:[^\n]*\n?/, "");
  cleaned = cleaned.trim();

  if (language.toLowerCase() === "java" && packageName && packageName.trim().length > 0 && !cleaned.startsWith("package ")) {
    cleaned = `package ${packageName};\n\n${cleaned}`;
  }
  return cleaned;
}

function processResponse(content: string, selection: CodeSelection, framework: TestFramework): GeneratedTest {
  const fileName = path.basename(selection.filePath);
  const dot = fileName.lastIndexOf(".");
  const sourceExt = dot > 0 ? fileName.substring(dot + 1) : "java";
  const targetClassName = dot > 0 ? fileName.substring(0, dot) : fileName;
  const language = selection.languageName ?? "";

  const testClassName = buildTestFileBaseName(targetClassName, sourceExt);
  const packageName = extractPackageName(selection);

  const agentPath = extractAgentSuggestedPath(content);
  const suggestedPath = agentPath
    ? resolveAgentPath(agentPath)
    : suggestTestFilePath(targetClassName, packageName, sourceExt, selection.filePath);

  const cleanContent = cleanGeneratedContent(content, packageName, language);
  const detectedLabel = extractAgentSuggestedFramework(content);

  return newGeneratedTest(testClassName, packageName, cleanContent, framework, targetClassName, suggestedPath, detectedLabel);
}

function readFileQuietly(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Core generation logic — port of TestGenerationServiceImpl.doGenerateTests.
 * Framework choice is delegated to Copilot (via the sdk-test-generation.md /
 * chat-executor-test-generation.md templates) unless a display name is
 * pinned explicitly.
 */
export async function generateTestForSelection(
  selection: CodeSelection,
  framework: string | null = null
): Promise<GeneratedTest> {
  const fullFileContent = readFileQuietly(selection.filePath);
  const prompt = buildTestGenerationPrompt(selection, framework, fullFileContent);
  const request = newRequest(OperationType.GENERATE_TESTS, selection, prompt, {
    framework: framework ?? TestFramework.UNKNOWN,
    filePath: selection.filePath,
  });
  const content = await executeForContent(request);
  return processResponse(content, selection, TestFramework.UNKNOWN);
}

function isEligibleForTestGeneration(filePath: string, content: string): boolean {
  const fileName = path.basename(filePath);
  if (fileName === "package-info.java" || fileName === "module-info.java") return false;
  if (isTestFileName(fileName)) return false;

  // No PSI available in VS Code — lightweight regex heuristic to skip
  // interface-only / annotation-only Java files (there is no meaningful
  // "class under test" to generate against).
  if (fileName.endsWith(".java")) {
    const hasClass = /\b(class|enum|record)\s+\w+/.test(content);
    const isInterfaceOnly = /\binterface\s+\w+/.test(content) && !hasClass;
    const isAnnotationOnly = /@interface\s+\w+/.test(content) && !hasClass;
    if (isInterfaceOnly || isAnnotationOnly) return false;
  }
  return true;
}

function collectSourceFilesRecursive(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectSourceFilesRecursive(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
      if (SOURCE_EXTENSIONS.has(ext)) out.push(full);
    }
  }
}

/** Port of TestGenerationServiceImpl.collectJavaFiles + isEligibleForTestGeneration, generalized to multiple languages. */
export function collectEligibleSourceFiles(folderPath: string): string[] {
  const all: string[] = [];
  collectSourceFilesRecursive(folderPath, all);
  const eligible: string[] = [];
  for (const filePath of all) {
    const content = readFileQuietly(filePath);
    if (content == null) continue;
    if (isEligibleForTestGeneration(filePath, content)) eligible.push(filePath);
  }
  eligible.sort();
  return eligible;
}

/** Port of TestGenerationServiceImpl.generateTestsForFolder. */
export async function generateTestsForFolder(
  folderPath: string,
  listener: FolderGenerationListener,
  cancellation?: vscode.CancellationToken
): Promise<GeneratedTest[]> {
  const files = collectEligibleSourceFiles(folderPath);
  const results: GeneratedTest[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    if (cancellation?.isCancellationRequested) break;

    const filePath = files[i];
    const fileName = path.basename(filePath);
    const current = i + 1;
    listener.onFileStarted?.(fileName, current, total);

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const selection = fileSelection(doc);
      if (!selection.text || selection.text.trim().length === 0) {
        listener.onFileSkipped?.(fileName, "Empty file");
        continue;
      }
      const result = await generateTestForSelection(selection, null);
      results.push(result);
      listener.onFileCompleted?.(fileName, result);
    } catch (e) {
      logError(`Test generation failed for ${fileName}`, e);
      listener.onFileFailed?.(fileName, e);
    }
  }

  return results;
}
