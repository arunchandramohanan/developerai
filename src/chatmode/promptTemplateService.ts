import * as fs from "fs";
import * as path from "path";
import { PromptTemplate } from "../models/chat";
import { resourcePath, workspaceRoot, log, logError } from "../core/context";
import { PROMPT_RESOURCE_DIR, PROMPT_FILE_EXTENSION, CUSTOM_PROMPTS_DIR } from "./constants";

interface BuiltInSpec {
  id: string;
  name: string;
  description: string;
  requiredContext: string[];
  category: string;
}

/**
 * Port of ChatModePromptTemplateServiceImpl.
 * Built-in templates are loaded from resources/prompts/chatmode/<id>.md.
 * Workspace custom templates (with optional YAML front-matter) are loaded from
 * <workspaceRoot>/.github/prompts.
 */
export class ChatModePromptTemplateService {
  private static _instance: ChatModePromptTemplateService | undefined;

  private readonly builtInTemplates = new Map<string, PromptTemplate>();
  private readonly customTemplates = new Map<string, PromptTemplate>();

  static getInstance(): ChatModePromptTemplateService {
    if (!ChatModePromptTemplateService._instance) {
      ChatModePromptTemplateService._instance = new ChatModePromptTemplateService();
    }
    return ChatModePromptTemplateService._instance;
  }

  private constructor() {
    this.initializeBuiltInTemplates();
    this.reloadCustomTemplates();
  }

  private static readonly BUILT_IN_SPECS: BuiltInSpec[] = [
    { id: "test-generation", name: "Test Generation", description: "Generate comprehensive unit tests", requiredContext: ["file"], category: "generation" },
    { id: "folder-test-generation", name: "Folder Test Generation", description: "Generate tests for all eligible source files in a folder", requiredContext: ["folder"], category: "generation" },
    { id: "docs-generation", name: "Documentation Generation", description: "Generate documentation comments", requiredContext: ["file"], category: "generation" },
    { id: "code-review", name: "Code Review", description: "Perform AI-powered code review", requiredContext: ["file"], category: "review" },
    { id: "diff-review", name: "Diff Review", description: "Review code changes (diff-based)", requiredContext: [], category: "review" },
    { id: "selection-review", name: "Selection Review", description: "Review selected code snippet", requiredContext: ["file"], category: "review" },
    { id: "sast-fix", name: "SAST Fix", description: "Fix security vulnerabilities found by SAST scanning", requiredContext: ["file", "issue"], category: "fix" },
    { id: "iac-fix", name: "IaC Fix", description: "Fix infrastructure-as-code security issues", requiredContext: ["file", "issue"], category: "fix" },
    { id: "coverage-boost", name: "Coverage Boost", description: "Generate additional tests to improve code coverage", requiredContext: ["file"], category: "generation" },
    { id: "readme-generation", name: "README Generation", description: "Generate a project README.md", requiredContext: [], category: "generation" },
    { id: "file-documentation", name: "File Documentation", description: "Generate technical documentation for a single file", requiredContext: ["file"], category: "generation" },
    { id: "folder-documentation", name: "Folder Documentation", description: "Generate summary documentation for a folder", requiredContext: [], category: "generation" },
    { id: "uml-diagram", name: "UML Diagram", description: "Generate UML diagrams from code", requiredContext: [], category: "generation" },
    { id: "uml-class-diagram", name: "UML Class Diagram", description: "Generate a class diagram from code", requiredContext: [], category: "generation" },
    { id: "uml-sequence-diagram", name: "UML Sequence Diagram", description: "Generate a sequence diagram from code", requiredContext: [], category: "generation" },
    { id: "uml-flow-diagram", name: "UML Flow Diagram", description: "Generate a flow diagram from code", requiredContext: [], category: "generation" },
    { id: "update-diagram", name: "Update Diagram", description: "Update an existing Mermaid diagram to match current source code", requiredContext: ["file"], category: "generation" },
    { id: "story-generation", name: "Story Generation", description: "Generate Jira-ready user stories from a requirements document", requiredContext: [], category: "generation" },
    { id: "feature-scaffold", name: "Feature Scaffold", description: "Generate a complete feature scaffold from a requirements document", requiredContext: ["file"], category: "generation" },
    { id: "doc-update", name: "Documentation Update", description: "Update documentation based on code changes", requiredContext: [], category: "review" },
    { id: "api-drift", name: "API Drift Detection", description: "Detect API specification drift", requiredContext: [], category: "review" },
    { id: "shakedown-test-generation", name: "Shakedown Test Generation", description: "Generate a Postman shakedown test collection from an OpenAPI spec", requiredContext: ["file"], category: "generation" },
    { id: "feature-update", name: "Feature Update", description: "Update existing feature code based on revised requirements", requiredContext: ["file"], category: "generation" },
    { id: "dependency-analysis", name: "Dependency Analysis", description: "Analyze project dependencies for updates, vulnerabilities, and breaking changes", requiredContext: ["file"], category: "review" },
    { id: "dependency-migration", name: "Dependency Migration", description: "Generate migration code changes from a dependency analysis report", requiredContext: ["file"], category: "generation" },
    { id: "chat-mode", name: "Chat Mode", description: "Interactive AI assistant for development tasks", requiredContext: [], category: "assistant" },
  ];

  private initializeBuiltInTemplates(): void {
    for (const spec of ChatModePromptTemplateService.BUILT_IN_SPECS) {
      const filePath = resourcePath("prompts", PROMPT_RESOURCE_DIR, spec.id + PROMPT_FILE_EXTENSION);
      const content = this.loadResource(filePath);
      if (content == null || content.trim().length === 0) {
        logError(`Built-in chat mode template not found or blank: ${filePath}`);
        continue;
      }
      this.builtInTemplates.set(spec.id, {
        id: spec.id,
        name: spec.name,
        description: spec.description,
        template: content,
        requiredContext: spec.requiredContext,
        category: spec.category,
        isBuiltIn: true,
      });
    }
  }

  private loadResource(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content.length === 0 ? null : content;
    } catch (e) {
      logError(`Failed to read chat mode template resource: ${filePath}`, e);
      return null;
    }
  }

  getTemplate(templateId: string): PromptTemplate | null {
    return this.customTemplates.get(templateId) ?? this.builtInTemplates.get(templateId) ?? null;
  }

  getAllTemplates(): PromptTemplate[] {
    const merged = new Map<string, PromptTemplate>(this.builtInTemplates);
    for (const [k, v] of this.customTemplates) merged.set(k, v);
    return Array.from(merged.values());
  }

  getBuiltInTemplates(): PromptTemplate[] {
    return Array.from(this.builtInTemplates.values());
  }

  getCustomTemplates(): PromptTemplate[] {
    return Array.from(this.customTemplates.values());
  }

  reloadCustomTemplates(): void {
    this.customTemplates.clear();
    const root = workspaceRoot();
    if (!root) return;
    const promptsDir = path.join(root, ...CUSTOM_PROMPTS_DIR.split("/"));
    let entries: string[];
    try {
      if (!fs.statSync(promptsDir).isDirectory()) return;
      entries = fs.readdirSync(promptsDir);
    } catch {
      // No custom prompts directory — that's fine.
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith(PROMPT_FILE_EXTENSION)) continue;
      this.loadCustomTemplate(path.join(promptsDir, entry));
    }
    if (this.customTemplates.size > 0) {
      log(`Loaded ${this.customTemplates.size} custom chat mode templates from ${promptsDir}`);
    }
  }

  private loadCustomTemplate(filePath: string): void {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      logError(`Failed to load custom template: ${filePath}`, e);
      return;
    }
    const fileName = path.basename(filePath);
    const id = fileName.slice(0, fileName.length - PROMPT_FILE_EXTENSION.length);

    let template = content;
    let name = id;
    let description = "Custom template";
    let category = "custom";
    let requiredContext: string[] = [];

    if (content.startsWith("---")) {
      const endFm = content.indexOf("---", 3);
      if (endFm > 0) {
        const frontmatter = content.substring(3, endFm).trim();
        template = content.substring(endFm + 3).trim();
        for (let line of frontmatter.split("\n")) {
          line = line.trim();
          if (line.startsWith("name:")) name = stripQuotes(line.substring(5));
          else if (line.startsWith("description:")) description = stripQuotes(line.substring(12));
          else if (line.startsWith("category:")) category = stripQuotes(line.substring(9));
          else if (line.startsWith("requires:")) requiredContext = parseCommaSeparated(line.substring(9));
        }
      }
    }

    if (!template || template.trim().length === 0) {
      return;
    }

    this.customTemplates.set(id, {
      id,
      name,
      description,
      template,
      requiredContext,
      category,
      isBuiltIn: false,
    });
    log(`Loaded custom chat mode template: ${id} from ${fileName}`);
  }
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseCommaSeparated(value: string): string[] {
  return value
    .trim()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
