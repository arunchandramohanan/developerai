import * as fs from "fs";
import * as path from "path";
import { CodeSelection, ExecutionMode, OperationType, newRequest, isSuccess } from "../models";
import { CopilotService, executeForContent } from "../core/copilotService";
import { buildDocumentationPrompt, collectExistingDocs } from "../core/promptBuilder";
import { PromptTemplateService } from "../core/promptTemplateService";
import { runProcess } from "../util/exec";
import { DevAIException, ErrorCode } from "../util/exception";
import { log } from "../core/context";
import {
  DocFormat,
  docFormatFromLanguage,
  docFormatDisplayName,
  docFormatStartDelimiter,
  docFormatEndDelimiter,
  ParamDoc,
  paramDocOf,
  ThrowsDoc,
  throwsDocOf,
  DocumentationComment,
} from "../models/documentation";

/**
 * Business logic for the documentation command cluster, ported from
 * com.bmo.devai.intellij.services.impl.DocumentationServiceImpl and the
 * scanning/prompt-building helpers embedded in the individual Actions
 * (GenerateReadmeAction, GenerateFileDocumentationAction,
 * GenerateFolderDocumentationAction, GetBusinessLogicSummaryAction,
 * UpdateDocsOnChangesAction). Pure logic lives here; UI/editor orchestration
 * lives in features/documentation.ts.
 */

// ---------------------------------------------------------------------------
// Inline documentation (devai.generateDocumentation)
// ---------------------------------------------------------------------------

const PARAM_PATTERN = /@param\s+(\w+)\s+(.+)/g;
const RETURN_PATTERN = /@return\s+(.+)/;
const THROWS_PATTERN = /@throws\s+([\w.]+)\s+(.+)/g;

/** Port of DocumentationServiceImpl.generateDocumentation. */
export async function generateDocumentationComment(
  selection: CodeSelection,
  format?: DocFormat | null
): Promise<DocumentationComment> {
  const effectiveFormat = format ?? docFormatFromLanguage(selection.languageName);
  const prompt = buildDocumentationPrompt(selection, docFormatDisplayName(effectiveFormat));
  const request = newRequest(OperationType.GENERATE_DOCUMENTATION, selection, prompt, {
    format: effectiveFormat,
    filePath: selection.filePath,
  });
  const content = await executeForContent(request);
  return processDocumentationResponse(content, selection, effectiveFormat);
}

/** Port of DocumentationServiceImpl.processResponse + its extractXxx helpers. */
export function processDocumentationResponse(
  content: string,
  selection: CodeSelection,
  format: DocFormat
): DocumentationComment {
  if (!content || content.trim().length === 0) {
    throw new DevAIException("Empty response from Copilot", ErrorCode.INVALID_RESPONSE);
  }
  const cleaned = cleanGeneratedContent(content, format);
  return {
    elementName: extractElementName(selection),
    elementType: selection.elementType,
    format,
    summary: extractSummary(cleaned),
    paramDocs: extractParams(cleaned),
    returnDoc: extractReturn(cleaned),
    throwsDocs: extractThrows(cleaned),
    seeAlso: [],
    sinceVersion: null,
    deprecatedReason: null,
    fullComment: cleaned,
    targetFilePath: selection.filePath,
    insertOffset: selection.startOffset,
    generatedAt: Date.now(),
  };
}

function cleanGeneratedContent(content: string, format: DocFormat): string {
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    const nl = cleaned.indexOf("\n");
    if (nl > 0) cleaned = cleaned.substring(nl + 1);
  }
  if (cleaned.endsWith("```")) cleaned = cleaned.substring(0, cleaned.length - 3);
  cleaned = cleaned.trim();
  const start = docFormatStartDelimiter(format);
  const end = docFormatEndDelimiter(format);
  if (!cleaned.startsWith(start)) cleaned = `${start}\n${cleaned}`;
  if (end.trim().length > 0 && !cleaned.endsWith(end)) cleaned = `${cleaned}\n${end}`;
  return cleaned;
}

function extractSummary(content: string): string {
  const lines = content.split("\n");
  const summary: string[] = [];
  let inSummary = false;
  for (const raw of lines) {
    const trimmed = raw.trim().replace(/^\*\s*/, "");
    if (trimmed.startsWith("/**") || trimmed === "*") continue;
    if (trimmed.startsWith("*/")) break;
    if (trimmed.startsWith("@")) break;
    if (trimmed.length > 0) {
      summary.push(trimmed);
      inSummary = true;
    } else if (inSummary) {
      break;
    }
  }
  return summary.join(" ").trim();
}

function extractParams(content: string): ParamDoc[] {
  const params: ParamDoc[] = [];
  const re = new RegExp(PARAM_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    params.push(paramDocOf(m[1], m[2].trim()));
  }
  return params;
}

function extractReturn(content: string): string | null {
  const m = RETURN_PATTERN.exec(content);
  return m ? m[1].trim() : null;
}

function extractThrows(content: string): ThrowsDoc[] {
  const throwsDocs: ThrowsDoc[] = [];
  const re = new RegExp(THROWS_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    throwsDocs.push(throwsDocOf(m[1], m[2].trim()));
  }
  return throwsDocs;
}

function extractElementName(selection: CodeSelection): string {
  const text = selection.text;
  if (text && text.trim().length > 0) {
    const classMatch = /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/.exec(text);
    if (classMatch) return classMatch[1];
    const methodMatch = /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*\w+\s+(\w+)\s*\(/.exec(text);
    if (methodMatch) return methodMatch[1];
  }
  const filePath = selection.filePath ?? "";
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  return fileName.replace(/\.[^.]+$/, "");
}

// ---------------------------------------------------------------------------
// README generation (devai.generateReadme)
// ---------------------------------------------------------------------------

const MAX_FILE_CONTENT_CHARS = 800;
const MAX_TOTAL_PROMPT_CHARS = 60_000;

const CONFIG_FILES = [
  "build.gradle.kts", "build.gradle", "settings.gradle.kts", "settings.gradle", "pom.xml",
  "package.json", "tsconfig.json",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile",
  "go.mod",
  "Cargo.toml",
  "*.csproj", "*.sln", "Directory.Build.props",
  "Gemfile",
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  ".github/workflows/ci.yml", ".github/workflows/build.yml",
  "Makefile", "CMakeLists.txt",
];

const README_IGNORED_DIRS = new Set([
  ".git", ".idea", ".gradle", ".intellijPlatform", ".vscode",
  "build", "out", "dist", "target", "bin", "obj",
  "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache",
  "venv", ".venv", "env", ".env", ".tox",
  "vendor", ".bundle",
]);

const README_SOURCE_EXTENSIONS = new Set([
  "java", "kt", "py", "go", "rs", "cs", "ts", "js", "tsx", "jsx", "rb", "swift",
  "cpp", "c", "h", "xml", "yaml", "yml", "gradle", "properties", "md", "toml", "json",
]);

const KEY_FILE_NAMES = new Set([
  "plugin.xml", "main.py", "app.py", "__init__.py", "main.go", "main.rs", "lib.rs",
  "main.ts", "main.js", "index.ts", "index.js", "App.tsx", "App.jsx",
  "Program.cs", "Startup.cs", "application.yml", "application.properties",
]);

function isKeyFileName(name: string): boolean {
  return (
    KEY_FILE_NAMES.has(name) ||
    name.endsWith("Service.java") ||
    name.endsWith("Action.java") ||
    name.endsWith("Activity.java")
  );
}

/** Port of GenerateReadmeAction.buildProjectSummary + helpers. */
export function buildProjectSummary(rootPath: string, projectName: string): string {
  const parts: string[] = [];
  parts.push(`Project name: ${projectName}\n\n`);

  parts.push("Directory structure:\n");
  parts.push(buildDirectoryTree(rootPath));
  parts.push("\n");

  for (const cfg of CONFIG_FILES) appendFileIfExists(parts, rootPath, cfg);

  parts.push("Source files:\n");
  const sourceFiles = collectReadmeSourceFiles(rootPath);
  let total = parts.join("").length;
  for (const file of sourceFiles) {
    if (total > MAX_TOTAL_PROMPT_CHARS) break;
    const rel = path.relative(rootPath, file).replace(/\\/g, "/");
    const line = `- ${rel}\n`;
    parts.push(line);
    total += line.length;
  }
  parts.push("\n");

  const keyFiles = sourceFiles.filter((f) => isKeyFileName(path.basename(f))).slice(0, 20);
  for (const file of keyFiles) {
    if (total > MAX_TOTAL_PROMPT_CHARS) break;
    const snippet = readFileSnippet(rootPath, file, MAX_FILE_CONTENT_CHARS);
    parts.push(snippet);
    total += snippet.length;
  }

  return parts.join("");
}

function buildDirectoryTree(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") || README_IGNORED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const relDepth = path.relative(root, full).split(path.sep).length;
      lines.push(`${"  ".repeat(relDepth)}${e.name}/`);
      walk(full, depth + 1);
    }
  };
  walk(root, 1);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

function collectReadmeSourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 10) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || README_IGNORED_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf(".");
        const ext = dot > 0 ? e.name.substring(dot + 1).toLowerCase() : "";
        if (README_SOURCE_EXTENSIONS.has(ext)) files.push(full);
      }
    }
  };
  walk(root, 0);
  return files;
}

function appendFileIfExists(parts: string[], root: string, fileName: string): void {
  if (fileName.startsWith("*")) {
    const ext = fileName.substring(1);
    try {
      const match = fs.readdirSync(root).find((n) => n.endsWith(ext));
      if (match) parts.push(readFileSnippet(root, path.join(root, match), MAX_FILE_CONTENT_CHARS));
    } catch {
      /* ignore */
    }
    return;
  }
  const file = path.join(root, fileName);
  try {
    if (fs.statSync(file).isFile()) parts.push(readFileSnippet(root, file, MAX_FILE_CONTENT_CHARS));
  } catch {
    /* ignore */
  }
}

function readFileSnippet(root: string, file: string, maxChars: number): string {
  try {
    let content = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (content.length > maxChars) content = content.substring(0, maxChars) + "\n... (truncated)";
    return `--- ${rel} ---\n${content}\n\n`;
  } catch {
    return "";
  }
}

/** Port of GenerateReadmeAction.sanitizeReadmeContent. */
export function sanitizeReadmeContent(raw: string): string {
  if (!raw || raw.trim().length === 0) return raw;
  let trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const nl = trimmed.indexOf("\n");
    if (nl > 0) trimmed = trimmed.substring(nl + 1);
    if (trimmed.endsWith("```")) trimmed = trimmed.substring(0, trimmed.length - 3).trimEnd();
  }
  let headingIndex = trimmed.indexOf("\n#");
  if (headingIndex < 0 && trimmed.startsWith("#")) {
    headingIndex = 0;
  } else if (headingIndex >= 0) {
    headingIndex += 1;
  }
  if (headingIndex > 0) trimmed = trimmed.substring(headingIndex);
  return trimmed.trim();
}

/** Port of GenerateReadmeAction — scans the project, calls Copilot, sanitizes the result. */
export async function generateReadme(rootPath: string, projectName: string): Promise<string> {
  const summary = buildProjectSummary(rootPath, projectName);
  const request = newRequest(OperationType.GENERATE_README, null, summary, { projectName });
  const content = await executeForContent(request);
  return sanitizeReadmeContent(content);
}

// ---------------------------------------------------------------------------
// Single-file technical documentation (devai.generateFileDocumentation)
// ---------------------------------------------------------------------------

/**
 * Port of GenerateFileDocumentationAction's prompt build. NOTE: the Java
 * action (faithfully reproduced here) reuses the same `documentation-user.md`
 * template as the inline doc-comment generator, rather than a dedicated
 * "technical file overview" template — this is a quirk inherited from the
 * original code, not a deliberate design choice of this port. Unlike the
 * Java version (which omits `docFormat` and leaves the placeholder
 * unresolved), we default it to "documentation" so the rendered prompt never
 * contains a literal unresolved `{{docFormat}}` token.
 */
export function buildFileDocumentationPrompt(fileName: string, languageId: string, content: string): string {
  const language = languageId && languageId.trim().length > 0 ? languageId : "code";
  return PromptTemplateService.loadAndRender("documentation-user.md", {
    docFormat: "documentation",
    language,
    languageLower: language.toLowerCase(),
    fileName,
    code: content,
  });
}

export async function generateFileDocumentation(fileName: string, languageId: string, content: string): Promise<string> {
  const prompt = buildFileDocumentationPrompt(fileName, languageId, content);
  const request = newRequest(OperationType.GENERATE_DOCUMENTATION, null, prompt, { fileName });
  return executeForContent(request);
}

// ---------------------------------------------------------------------------
// Folder documentation (devai.generateFolderDocumentation)
// ---------------------------------------------------------------------------

const FOLDER_SOURCE_EXTENSIONS = new Set([
  "java", "kt", "py", "go", "rs", "cs", "ts", "js", "tsx", "jsx",
  "cpp", "c", "h", "hpp", "rb", "swift", "scala", "php",
]);
const MAX_CONTENT_PER_FILE_FOLDER = 2000;
const MAX_TOTAL_CHARS_FOLDER = 80_000;

export interface FolderSourceFile {
  name: string;
  ext: string;
  content: string;
}

export function isFolderSourceExtension(ext: string | null | undefined): boolean {
  return !!ext && FOLDER_SOURCE_EXTENSIONS.has(ext.toLowerCase());
}

/** Port of GenerateFolderDocumentationAction.buildFolderPrompt. */
export function buildFolderDocumentationPrompt(folderName: string, files: FolderSourceFile[]): string {
  let snippets = "";
  for (const file of files) {
    if (snippets.length > MAX_TOTAL_CHARS_FOLDER) break;
    let content = file.content;
    if (content.length > MAX_CONTENT_PER_FILE_FOLDER) {
      content = content.substring(0, MAX_CONTENT_PER_FILE_FOLDER) + "\n// ... (truncated)";
    }
    const ext = file.ext || "code";
    snippets += `### \`${file.name}\`\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
  }
  return PromptTemplateService.loadAndRender("folder-documentation-user.md", {
    folderName,
    fileSnippets: snippets,
  });
}

export async function generateFolderDocumentation(folderName: string, files: FolderSourceFile[]): Promise<string> {
  const prompt = buildFolderDocumentationPrompt(folderName, files);
  const request = newRequest(OperationType.GENERATE_DOCUMENTATION, null, prompt, { folderName });
  return executeForContent(request);
}

// ---------------------------------------------------------------------------
// Business logic summary (devai.getBusinessLogicSummary)
// ---------------------------------------------------------------------------

const BUSINESS_SOURCE_EXTENSIONS = new Set([
  "java", "kt", "py", "go", "rs", "cs", "ts", "js", "tsx", "jsx",
  "cpp", "c", "h", "hpp", "rb", "swift", "scala", "php", "sql", "yaml", "yml", "json",
]);
const MAX_CONTENT_PER_FILE_BIZ = 3000;
const MAX_TOTAL_CHARS_BIZ = 100_000;
const TRUNCATE_SUFFIX = "\n// ... (truncated)";

/** Port of SourceContextUtil.collectSourceFiles(root, extensions, recursive=true), skipping dot-dirs. */
export function collectBusinessSourceFiles(rootPath: string): string[] {
  const files: string[] = [];
  const queue: string[] = [rootPath];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".")) queue.push(full);
        continue;
      }
      const dot = e.name.lastIndexOf(".");
      const ext = dot > 0 ? e.name.substring(dot + 1).toLowerCase() : "";
      if (BUSINESS_SOURCE_EXTENSIONS.has(ext)) files.push(full);
    }
  }
  files.sort();
  return files;
}

/** Port of SourceContextUtil.buildCodeSnippet. */
export function buildCodeSnippet(filePath: string, title: string): string {
  let content = fs.readFileSync(filePath, "utf8");
  if (content.length > MAX_CONTENT_PER_FILE_BIZ) content = content.substring(0, MAX_CONTENT_PER_FILE_BIZ) + TRUNCATE_SUFFIX;
  const name = path.basename(filePath);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.substring(dot + 1) : "code";
  return `### \`${title}\`\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
}

/** Port of GetBusinessLogicSummaryAction.buildContext. */
export function buildBusinessLogicContext(targetPath: string, isDirectory: boolean): string {
  if (!isDirectory) {
    try {
      return buildCodeSnippet(targetPath, targetPath);
    } catch {
      return "";
    }
  }
  const files = collectBusinessSourceFiles(targetPath);
  let out = "";
  for (const file of files) {
    if (out.length >= MAX_TOTAL_CHARS_BIZ) break;
    try {
      out += buildCodeSnippet(file, file);
    } catch (e) {
      log("Skipping unreadable file: " + file);
    }
  }
  return out;
}

export async function generateBusinessLogicSummary(codeContext: string, targetName: string): Promise<string> {
  const request = newRequest(OperationType.BUSINESS_SUMMARY, null, codeContext, { targetName });
  return executeForContent(request);
}

// ---------------------------------------------------------------------------
// Update docs on changes (devai.updateDocsOnChanges)
// ---------------------------------------------------------------------------

/** Runs `git diff HEAD` in the given workspace root (uncommitted + staged changes). */
export async function runGitDiff(cwd: string): Promise<string> {
  const result = await runProcess("git", ["diff", "HEAD"], { cwd, timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new DevAIException(
      result.stderr && result.stderr.trim().length > 0 ? result.stderr : "git diff failed",
      ErrorCode.GIT_ERROR
    );
  }
  return result.stdout;
}

/** Extracts the changed file paths (post-change side) from a unified git diff. */
export function parseChangedFilePaths(diffContent: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const re = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(diffContent)) !== null) {
    const p = m[2] || m[1];
    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }
  return paths;
}

/** Port of PromptBuilder.buildDocUpdatePrompt(diffSummary, basePath), using the ported collectExistingDocs. */
export function buildDocUpdatePrompt(changedFilePaths: string[], diffContent: string, basePath: string): string {
  const existingDocs = collectExistingDocs(basePath, changedFilePaths);
  const changedFiles =
    changedFilePaths.length > 0
      ? changedFilePaths.map((f) => `- ${f}`).join("\n")
      : "(unable to determine changed file list from the diff; see diff content below)";
  return PromptTemplateService.loadAndRender("doc-update-user.md", {
    changedFiles,
    diffContent,
    existingDocs: existingDocs.trim().length > 0 ? existingDocs : null,
  });
}

export interface DocUpdateOutcome {
  content: string;
  mode: ExecutionMode;
}

/**
 * Port of UpdateDocsOnChangesAction.runCliMode. Uses CopilotService.execute
 * directly (rather than executeForContent) so the caller can see which
 * execution mode actually ran — SDK mode edits files directly via the
 * Copilot CLI's `--allow-tool=write`; Chat mode can only return text (VS
 * Code's Language Model API cannot edit files), so the caller needs to
 * present that difference to the user.
 */
export async function updateDocsOnChanges(basePath: string): Promise<DocUpdateOutcome | null> {
  const diffContent = await runGitDiff(basePath);
  if (!diffContent || diffContent.trim().length === 0) return null;

  const changedFiles = parseChangedFilePaths(diffContent);
  const prompt = buildDocUpdatePrompt(changedFiles, diffContent, basePath);
  const request = newRequest(OperationType.UPDATE_DOCUMENTATION, null, prompt, {
    scope: "uncommitted",
    workingDirectory: basePath,
  });

  const response = await CopilotService.getInstance().execute(request);
  if (!isSuccess(response)) {
    throw new DevAIException(response.errorMessage ?? "Documentation update failed", ErrorCode.REQUEST_FAILED);
  }
  return { content: response.content, mode: response.executionMode ?? ExecutionMode.CHAT };
}
