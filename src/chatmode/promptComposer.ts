import * as fs from "fs";
import * as path from "path";
import {
  ComposedPrompt,
  FileContext,
  PromptContext,
  PromptIssue,
  PromptTemplate,
  composedPrompt,
  hasDiffContext,
  hasFileContext,
  hasIssues,
  hasRagContext,
  hasSelection,
  requiresFileContext,
  requiresFolderContext,
  requiresIssueContext,
} from "../models/chat";
import { ChatModePromptTemplateService } from "./promptTemplateService";
import { InputFilterService } from "../core/inputFilterService";
import { PromptTemplateService } from "../core/promptTemplateService";
import { log } from "../core/context";

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const IF_BLOCK_PATTERN = /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

/**
 * Port of ChatModePromptComposerServiceImpl.
 * Handles {{variable}} substitution and {{#if condition}}...{{/if}} blocks,
 * then appends the shared ai-tag instruction.
 */
export class ChatModePromptComposer {
  private static _instance: ChatModePromptComposer | undefined;

  static getInstance(): ChatModePromptComposer {
    if (!ChatModePromptComposer._instance) {
      ChatModePromptComposer._instance = new ChatModePromptComposer();
    }
    return ChatModePromptComposer._instance;
  }

  compose(templateId: string, context: PromptContext): ComposedPrompt {
    const templateService = ChatModePromptTemplateService.getInstance();
    const template = templateService.getTemplate(templateId);
    if (!template) {
      throw new Error("Template not found: " + templateId);
    }
    this.validateContext(template, context);
    const text = this.substituteVariables(template.template, context) + buildAiTagInstruction();
    const contextSummary = generateContextSummary(context);
    return composedPrompt(text, templateId, contextSummary);
  }

  composeFromText(templateText: string, context: PromptContext): ComposedPrompt {
    const text = this.substituteVariables(templateText, context);
    const contextSummary = generateContextSummary(context);
    return composedPrompt(text, "ad-hoc", contextSummary);
  }

  private validateContext(template: PromptTemplate, context: PromptContext): void {
    if (requiresFileContext(template) && !hasFileContext(context)) {
      throw new Error(`Template '${template.id}' requires file context but no file is open`);
    }
    if (requiresFolderContext(template) && context.selectedFolder == null) {
      throw new Error(`Template '${template.id}' requires folder context`);
    }
    if (requiresIssueContext(template) && !hasIssues(context)) {
      throw new Error(`Template '${template.id}' requires issue context`);
    }
  }

  private substituteVariables(template: string, context: PromptContext): string {
    let result = processConditionalBlocks(template, context);

    if (context.activeFile != null) {
      const file = context.activeFile;
      result = replaceAll(result, "{{fileName}}", file.fileName);
      result = replaceAll(result, "{{relativePath}}", file.relativePath);
      result = replaceAll(result, "{{language}}", file.language);
      result = replaceAll(result, "{{fileContent}}", filterValue(file.content, "fileContent"));
      result = replaceAll(result, "{{filePath}}", file.path);
      result = replaceAll(result, "{{lineCount}}", String(file.lineCount));
    }

    if (context.selectedFolder != null) {
      result = replaceAll(result, "{{folderPath}}", context.selectedFolder);
      // UML prompts use {{filePath}} as the scope reference — populate from folder when no active file
      if (context.activeFile == null) {
        result = replaceAll(result, "{{filePath}}", context.selectedFolder);
      }
    }

    result = replaceAll(result, "{{workspaceRoot}}", context.workspaceRoot);

    if (result.includes("{{testFramework}}")) {
      result = replaceAll(result, "{{testFramework}}", detectTestFramework(context));
    }

    if (context.diffContent != null) {
      result = replaceAll(result, "{{diffContent}}", filterValue(context.diffContent, "diffContent"));
    }
    if (context.changedFiles != null) {
      result = replaceAll(result, "{{changedFiles}}", filterValue(context.changedFiles, "changedFiles"));
    }

    if (context.selectedText != null) {
      result = replaceAll(result, "{{selectedText}}", filterValue(context.selectedText, "selectedText"));
    }
    if (context.selectionStartLine > 0) {
      result = replaceAll(result, "{{selectionStartLine}}", String(context.selectionStartLine));
    }
    if (context.selectionEndLine > 0) {
      result = replaceAll(result, "{{selectionEndLine}}", String(context.selectionEndLine));
    }

    if (hasIssues(context)) {
      let issueText = "";
      for (const issue of context.issues) {
        const filteredDescription = filterValue(issue.description, "issueDescription");
        issueText += `- **${issue.severity}** [${issue.category}]: ${filteredDescription} (line ${issue.startLine})\n`;
      }
      result = replaceAll(result, "{{issueDetails}}", issueText.trim());
    }

    if (hasRagContext(context)) {
      result = replaceAll(result, "{{ragExamples}}", context.ragExamples ?? "");
    }

    // Strip any remaining unresolved {{var}} placeholders.
    result = result.replace(VARIABLE_PATTERN, "");
    return result.trim();
  }
}

function replaceAll(source: string, search: string, replacement: string): string {
  return source.split(search).join(replacement);
}

function filterValue(value: string | null | undefined, fieldName: string): string {
  if (value == null) return "";
  return InputFilterService.getInstance().filterInputValue(value, fieldName);
}

function processConditionalBlocks(template: string, context: PromptContext): string {
  return template.replace(IF_BLOCK_PATTERN, (_match, condition: string, blockContent: string) =>
    evaluateCondition(condition, context) ? blockContent : ""
  );
}

function evaluateCondition(condition: string, context: PromptContext): boolean {
  switch (condition) {
    case "hasFile":
      return hasFileContext(context);
    case "hasDiff":
      return hasDiffContext(context);
    case "hasSelection":
      return hasSelection(context);
    case "hasIssues":
      return hasIssues(context);
    case "hasFolder":
      return context.selectedFolder != null;
    case "hasRagExamples":
      return hasRagContext(context);
    default:
      return false;
  }
}

function generateContextSummary(context: PromptContext): string {
  const parts: string[] = [];
  if (hasFileContext(context) && context.activeFile) {
    const file = context.activeFile;
    parts.push(`File: ${file.relativePath} (${file.language}, ${file.lineCount} lines)`);
  }
  if (context.selectedFolder != null) {
    parts.push(`Folder: ${context.selectedFolder}`);
  }
  if (hasIssues(context)) {
    parts.push(`Issues: ${context.issues.length}`);
  }
  if (hasDiffContext(context)) {
    parts.push("Has diff context");
  }
  if (hasSelection(context)) {
    parts.push(`Selection: lines ${context.selectionStartLine}–${context.selectionEndLine}`);
  }
  return parts.join(" | ");
}

/** Loads the shared ai-tag instruction and stamps today's date. */
export function buildAiTagInstruction(): string {
  const template = PromptTemplateService.loadTemplate("ai-tag-instruction.md");
  const today = new Date().toISOString().slice(0, 10);
  return "\n\n" + replaceAll(template, "{{date}}", today);
}

function readIfExists(root: string, fileName: string): string | null {
  const p = path.join(root, fileName);
  try {
    if (fs.statSync(p).isFile()) return fs.readFileSync(p, "utf8");
  } catch {
    /* not present */
  }
  return null;
}

/** Mirrors ChatModePromptComposerServiceImpl.detectTestFramework. */
export function detectTestFramework(context: PromptContext): string {
  const root = context.workspaceRoot;
  if (!root) return "the standard testing framework for the language";
  try {
    const gradleKts = readIfExists(root, "build.gradle.kts");
    if (gradleKts) {
      if (gradleKts.includes("junit-jupiter") || gradleKts.includes("org.junit.jupiter")) return "JUnit 5 (Jupiter)";
      if (gradleKts.includes("testng")) return "TestNG";
      if (gradleKts.includes("junit")) return "JUnit 4";
    }
    const gradle = readIfExists(root, "build.gradle");
    if (gradle) {
      if (gradle.includes("junit-jupiter") || gradle.includes("org.junit.jupiter")) return "JUnit 5 (Jupiter)";
      if (gradle.includes("testng")) return "TestNG";
      if (gradle.includes("junit")) return "JUnit 4";
    }
    const pom = readIfExists(root, "pom.xml");
    if (pom) {
      if (pom.includes("junit-jupiter") || pom.includes("org.junit.jupiter")) return "JUnit 5 (Jupiter)";
      if (pom.includes("testng")) return "TestNG";
      if (pom.includes("junit")) return "JUnit 4";
    }
    const pkg = readIfExists(root, "package.json");
    if (pkg) {
      if (pkg.includes("vitest")) return "Vitest";
      if (pkg.includes("jest")) return "Jest";
      if (pkg.includes("mocha")) return "Mocha";
    }
    const pyproject = readIfExists(root, "pyproject.toml");
    if (pyproject && pyproject.includes("pytest")) return "pytest";
    const setup = readIfExists(root, "setup.cfg");
    if (setup && setup.includes("pytest")) return "pytest";
    const requirements = readIfExists(root, "requirements.txt");
    if (requirements && requirements.includes("pytest")) return "pytest";
    const reqDev = readIfExists(root, "requirements-dev.txt");
    if (reqDev && reqDev.includes("pytest")) return "pytest";
  } catch (e) {
    log("Test framework detection skipped: " + (e instanceof Error ? e.message : String(e)));
  }
  return "the standard testing framework for the language";
}
