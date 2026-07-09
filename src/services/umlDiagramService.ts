import * as fs from "fs";
import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { PromptTemplateService } from "../core/promptTemplateService";
import { workspaceRoot, log, logError } from "../core/context";
import { DevAIException, ErrorCode } from "../util/exception";
import { mermaidToSvg, mermaidToDrawIoXml } from "./mermaid";
import {
  DiagramContext,
  DiagramResult,
  DiagramType,
  ExportFormat,
  diagramError,
  diagramSuccess,
  diagramTypeDisplayName,
  diagramTypeTemplateId,
} from "../models/diagram";

/**
 * Port of com.bmo.devai.intellij.services.impl.UMLDiagramServiceImpl.
 * Pipeline: collect source code → load Mermaid prompt template → call Copilot → write output.
 * Output is written to `docs/diagrams/` at the workspace root (mirrors the Java's project.getBasePath()).
 */

/** Max characters to include per individual source file (matches UMLDiagramServiceImpl). */
const MAX_CONTENT_PER_FILE = 8_000;

/** Max total characters across all source files to avoid exceeding token limits. */
const MAX_TOTAL_CHARS = 120_000;

/** File extensions recognized as source code, so only relevant files are included in diagram generation. */
export const SOURCE_EXTENSIONS = new Set([
  "java",
  "kt",
  "py",
  "go",
  "rs",
  "cs",
  "ts",
  "js",
  "tsx",
  "jsx",
  "cpp",
  "c",
  "h",
  "hpp",
  "rb",
  "swift",
  "scala",
  "php",
]);

interface SbRef {
  text: string;
}

/** Recursively lists every file under `dir` (best-effort — unreadable subdirectories are skipped). */
function walkFilesSync(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesSync(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/** Appends a single file's content as a fenced code block, truncating if necessary. */
function appendFileContent(file: string, sbRef: SbRef, totalChars: number, maxContentPerFile: number): number {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    // Skip unreadable file, leave totalChars unchanged.
    return totalChars;
  }
  if (content.length > maxContentPerFile) {
    content = content.substring(0, maxContentPerFile) + "\n// ... (truncated)";
  }
  const name = path.basename(file);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.substring(dot + 1) : "";

  sbRef.text += `### \`${name}\`\n`;
  sbRef.text += "```" + ext + "\n" + content + "\n```\n\n";
  return sbRef.text.length;
}

/** Recursively collects source files from a directory, filtered by SOURCE_EXTENSIONS. */
function collectFromDirectory(dir: string, sbRef: SbRef, totalChars: number, maxContentPerFile: number, maxTotalChars: number): number {
  const files = walkFilesSync(dir)
    .filter((p) => {
      const name = path.basename(p);
      const dot = name.lastIndexOf(".");
      return dot > 0 && SOURCE_EXTENSIONS.has(name.substring(dot + 1));
    })
    .sort();

  for (const file of files) {
    if (totalChars > maxTotalChars) break;
    totalChars = appendFileContent(file, sbRef, totalChars, maxContentPerFile);
  }
  return totalChars;
}

/**
 * Reads source files from the given paths (files or directories) and concatenates them into a
 * single prompt-ready string, respecting the given per-file/total character limits.
 * Shared by both diagram generation (UMLDiagramServiceImpl limits) and diagram update
 * (UpdateDiagramAction limits), which use different limit constants.
 */
export function collectSourceCode(paths: string[], maxContentPerFile: number, maxTotalChars: number): string {
  const sbRef: SbRef = { text: "" };
  let totalChars = 0;

  for (const p of paths) {
    if (totalChars > maxTotalChars) break;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      totalChars = collectFromDirectory(p, sbRef, totalChars, maxContentPerFile, maxTotalChars);
    } else if (stat.isFile()) {
      totalChars = appendFileContent(p, sbRef, totalChars, maxContentPerFile);
    }
  }
  return sbRef.text;
}

/**
 * Renders the per-type prompt template with source code. Uses the same prompt files as chat mode.
 * Source code is appended directly (not via placeholder) so the chat mode prompts stay clean.
 * A CLI output override is appended last to prevent the model producing a file-write summary.
 */
function buildPrompt(diagramType: DiagramType, sourceCode: string): string {
  const promptFile =
    diagramType === DiagramType.CLASS_DIAGRAM
      ? "chatmode/uml-class-diagram.md"
      : diagramType === DiagramType.SEQUENCE_DIAGRAM
      ? "chatmode/uml-sequence-diagram.md"
      : "chatmode/uml-flow-diagram.md";
  const prompt = PromptTemplateService.loadAndRender(promptFile, {});
  const cliOverride = PromptTemplateService.loadAndRender("chatmode/uml-cli-output-override.md", {});
  return prompt + "\n\n## Source Code\n\n" + sourceCode + "\n\n" + cliOverride;
}

/** Writes the final diagram output and Mermaid source to docs/diagrams/ at the workspace root. */
async function writeOutput(context: DiagramContext, mermaidText: string): Promise<string> {
  const base = workspaceRoot();
  if (!base) {
    throw new DevAIException("Workspace root is not available.", ErrorCode.FILE_WRITE_FAILED);
  }

  const diagramsDir = path.join(base, "docs", "diagrams");
  fs.mkdirSync(diagramsDir, { recursive: true });

  // Always save the Mermaid source for version control and future re-rendering
  const baseName = `${context.scopeName}-${diagramTypeTemplateId(context.diagramType)}`;
  const mmdFile = path.join(diagramsDir, `${baseName}.mmd`);
  fs.writeFileSync(mmdFile, mermaidText, "utf8");
  log(`Mermaid source written to: ${mmdFile}`);

  // For Mermaid format, we're done
  if (context.exportFormat === ExportFormat.MERMAID_MD) {
    return mmdFile;
  }

  // Post-process: render Mermaid to the requested format via Kroki API
  try {
    let rendered: string;
    let ext: string;
    if (context.exportFormat === ExportFormat.SVG) {
      rendered = await mermaidToSvg(mermaidText);
      ext = ".svg";
    } else {
      rendered = await mermaidToDrawIoXml(mermaidText);
      ext = ".drawio";
    }

    const outputFile = path.join(diagramsDir, baseName + ext);
    fs.writeFileSync(outputFile, rendered, "utf8");
    log(`Rendered diagram written to: ${outputFile}`);
    return outputFile;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`Post-processing failed, Mermaid source still available at: ${mmdFile}`, e);
    throw new DevAIException(
      `Diagram rendering failed (Mermaid source saved to ${mmdFile}): ${msg}`,
      ErrorCode.GENERATION_FAILED
    );
  }
}

/**
 * Generate a UML diagram based on the given context.
 * Port of UMLDiagramService.generateDiagram / UMLDiagramServiceImpl.
 */
export async function generateDiagram(context: DiagramContext): Promise<DiagramResult> {
  try {
    const sourceCode = collectSourceCode(context.sourcePaths, MAX_CONTENT_PER_FILE, MAX_TOTAL_CHARS);
    if (sourceCode.trim().length === 0) {
      return diagramError("No source files found at the specified paths.", context.exportFormat);
    }

    const prompt = buildPrompt(context.diagramType, sourceCode);
    const request = newRequest(OperationType.GENERATE_UML_DIAGRAM, null, prompt, {
      diagramType: diagramTypeDisplayName(context.diagramType),
    });

    let content: string;
    try {
      content = await executeForContent(request);
    } catch (e) {
      const msg = e instanceof DevAIException ? e.message : e instanceof Error ? e.message : "Empty response from Copilot";
      return diagramError(msg, context.exportFormat);
    }

    if (!content || content.trim().length === 0) {
      return diagramError("Empty response from Copilot", context.exportFormat);
    }

    const outputPath = await writeOutput(context, content);
    return diagramSuccess(outputPath, content, context.exportFormat);
  } catch (e) {
    logError("UML diagram generation failed", e);
    const msg = e instanceof Error && e.message ? e.message : "Unknown error";
    return diagramError(msg, context.exportFormat);
  }
}
