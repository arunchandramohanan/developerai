import * as vscode from "vscode";
import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { PromptTemplateService } from "../core/promptTemplateService";
import { workspaceRoot } from "../core/context";
import { showInfo, showError } from "../util/notify";
import { readTextFile, writeTextFile, openFile, baseName, stripExtension } from "../util/files";
import { generateDiagram, collectSourceCode } from "../services/umlDiagramService";
import { mermaidToSvg, mermaidToDrawIoXml } from "../services/mermaid";
import { showDiagramSvgPreview } from "../views/diagramView";
import {
  DiagramScope,
  DiagramType,
  ExportFormat,
  diagramOutputFileName,
  diagramScopeDisplayName,
  diagramTypeDisplayName,
  diagramTypeFromTemplateId,
  diagramTypeTemplateId,
  exportFormatDisplayName,
  newDiagramContext,
} from "../models/diagram";
import { handleIfChatMode } from "../chatmode/integrator";
import { TaskType } from "../models/chat";

/** Port of GenerateUMLDiagramAction's DiagramType → chat TaskType mapping. */
function diagramTaskType(diagramType: DiagramType): TaskType {
  switch (diagramType) {
    case DiagramType.CLASS_DIAGRAM:
      return TaskType.UML_CLASS_DIAGRAM;
    case DiagramType.SEQUENCE_DIAGRAM:
      return TaskType.UML_SEQUENCE_DIAGRAM;
    case DiagramType.FLOW_DIAGRAM:
      return TaskType.UML_FLOW_DIAGRAM;
    default:
      return TaskType.UML_DIAGRAM;
  }
}

/**
 * Port of the diagrams action cluster:
 *   actions/generation/{GenerateUMLDiagramAction,GenerateSequenceDiagramAction,
 *   GenerateFlowDiagramAction,RenderMermaidDiagramAction,UpdateDiagramAction}.java
 * plus services/UMLDiagramService(Impl) and util/MermaidRendererUtil.
 *
 * When Chat Mode is active, generate/update commands intercept into the
 * Copilot Chat pipeline (mirroring the ChatModeIntegrator calls in the Java
 * actions); rendering is always local.
 */

/** Limits used when collecting source for the "update diagram" flow (matches UpdateDiagramAction.java). */
const UPDATE_MAX_CONTENT_PER_FILE = 2_000;
const UPDATE_MAX_TOTAL_CHARS = 80_000;

export function registerDiagrams(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateUMLDiagram", () => handleGenerate(DiagramType.CLASS_DIAGRAM))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateSequenceDiagram", () => handleGenerate(DiagramType.SEQUENCE_DIAGRAM))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateFlowDiagram", () => handleGenerate(DiagramType.FLOW_DIAGRAM))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.renderMermaidDiagram", (uri?: vscode.Uri) => handleRender(uri))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.updateDiagram", (uri?: vscode.Uri) => handleUpdate(uri))
  );
}

// ═══════════════════════════════════════════════════════════════
//  generateUMLDiagram / generateSequenceDiagram / generateFlowDiagram
// ═══════════════════════════════════════════════════════════════

async function handleGenerate(diagramType: DiagramType): Promise<void> {
  const scope = await pickScope();
  if (!scope) return;

  const resolved = await resolvePathsForScope(scope);
  if (!resolved) return;

  if (await handleIfChatMode(diagramTaskType(diagramType), resolved.paths[0] ?? null)) return;

  const diagramContext = newDiagramContext(diagramType, ExportFormat.MERMAID_MD, resolved.paths, scope, resolved.scopeName);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating ${diagramTypeDisplayName(diagramType)}...`,
      cancellable: false,
    },
    async () => {
      const result = await generateDiagram(diagramContext);
      if (!result.success) {
        showError("UML Diagram Generation Failed", result.error ?? "Diagram generation failed.");
        return;
      }
      if (result.outputPath) {
        await openFile(result.outputPath);
      }
      showInfo("UML Diagram Generated", `${diagramOutputFileName(diagramContext)} created in docs/diagrams/`);
    }
  );
}

async function pickScope(): Promise<DiagramScope | undefined> {
  const items = Object.values(DiagramScope).map((s) => ({ label: diagramScopeDisplayName(s), scope: s }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select Scope" });
  return picked?.scope;
}

/** Resolves source paths + a display name for the selected scope, mirroring GenerateUMLDiagramAction.resolveAndGenerate. */
async function resolvePathsForScope(scope: DiagramScope): Promise<{ paths: string[]; scopeName: string } | undefined> {
  switch (scope) {
    case DiagramScope.FILE: {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || uri.scheme !== "file") {
        showError("UML Diagram Generation Failed", "No file is open in the editor.");
        return undefined;
      }
      return { paths: [uri.fsPath], scopeName: stripExtension(baseName(uri.fsPath)) };
    }
    case DiagramScope.FOLDER: {
      const defaultUri = workspaceRoot() ? vscode.Uri.file(workspaceRoot()!) : undefined;
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Folder",
        title: "Select Folder for Diagram Generation",
        defaultUri,
      });
      if (!picked || picked.length === 0) return undefined; // cancelled
      const folder = picked[0].fsPath;
      return { paths: [folder], scopeName: baseName(folder) };
    }
    case DiagramScope.MODULE: {
      // VS Code has no direct equivalent of an IntelliJ Module; a workspace folder in a
      // multi-root workspace plays the closest analogous role.
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        showError("UML Diagram Generation Failed", "No modules found in the project.");
        return undefined;
      }
      if (folders.length === 1) {
        return { paths: [folders[0].uri.fsPath], scopeName: folders[0].name };
      }
      const items = folders.map((f) => ({ label: f.name, folder: f }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select Module" });
      if (!picked) return undefined;
      return { paths: [picked.folder.uri.fsPath], scopeName: picked.folder.name };
    }
    case DiagramScope.WORKSPACE: {
      const base = workspaceRoot();
      if (!base) {
        showError("UML Diagram Generation Failed", "Cannot determine project base path.");
        return undefined;
      }
      const name = vscode.workspace.name ?? baseName(base);
      return { paths: [base], scopeName: name };
    }
    default:
      return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════
//  renderMermaidDiagram
// ═══════════════════════════════════════════════════════════════

async function handleRender(uri?: vscode.Uri): Promise<void> {
  const mmdPath = await resolveMmdFile(uri, "Select Mermaid Diagram", "Choose a .mmd file to render");
  if (!mmdPath) return;

  const formatPick = await vscode.window.showQuickPick(
    [
      { label: exportFormatDisplayName(ExportFormat.SVG), format: ExportFormat.SVG },
      { label: exportFormatDisplayName(ExportFormat.DRAW_IO), format: ExportFormat.DRAW_IO },
    ],
    { placeHolder: "Render As" }
  );
  if (!formatPick) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Rendering to ${formatPick.label} via Kroki...`,
      cancellable: false,
    },
    async () => {
      try {
        const mermaidText = readTextFile(mmdPath);
        if (mermaidText == null || mermaidText.trim().length === 0) {
          showError("Mermaid Rendering Failed", "The .mmd file is empty.");
          return;
        }

        let rendered: string;
        let ext: string;
        let svgForPreview: string | null = null;

        if (formatPick.format === ExportFormat.SVG) {
          rendered = await mermaidToSvg(mermaidText);
          svgForPreview = rendered;
          ext = ".svg";
        } else {
          rendered = await mermaidToDrawIoXml(mermaidText);
          ext = ".drawio";
          try {
            svgForPreview = await mermaidToSvg(mermaidText);
          } catch {
            svgForPreview = null; // preview is best-effort; the .drawio file was still written below
          }
        }

        const outFileName = stripExtension(baseName(mmdPath)) + ext;
        const outputFile = path.join(path.dirname(mmdPath), outFileName);
        writeTextFile(outputFile, rendered);
        await openFile(outputFile);

        if (svgForPreview) {
          showDiagramSvgPreview(outFileName, svgForPreview);
        }

        showInfo("Diagram Rendered", `${outFileName} created`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showError("Mermaid Rendering Failed", msg);
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════════
//  updateDiagram
// ═══════════════════════════════════════════════════════════════

async function handleUpdate(uri?: vscode.Uri): Promise<void> {
  const mmdPath = await resolveMmdFile(uri, "Select Diagram to Update", "Choose a .mmd file with scope metadata to update");
  if (!mmdPath) return;

  if (await handleIfChatMode(TaskType.UPDATE_DIAGRAM, mmdPath)) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Updating Diagram", cancellable: false },
    async () => {
      try {
        const existingDiagram = readTextFile(mmdPath);
        if (existingDiagram == null || existingDiagram.trim().length === 0) {
          showError("Diagram Update Failed", "The .mmd file is empty.");
          return;
        }

        const scopeLine = extractMetadata(existingDiagram, "scope");
        const typeLine = extractMetadata(existingDiagram, "type");

        if (!scopeLine || scopeLine.trim().length === 0) {
          showError("Diagram Update Failed", "No %% scope: metadata found in the diagram. Cannot determine source files.");
          return;
        }

        const diagramType = diagramTypeFromTemplateId(typeLine);

        const scopePaths = scopeLine
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const sourceCode = collectSourceCode(scopePaths, UPDATE_MAX_CONTENT_PER_FILE, UPDATE_MAX_TOTAL_CHARS);
        if (sourceCode.trim().length === 0) {
          showError("Diagram Update Failed", `No source files found at scope: ${scopeLine}`);
          return;
        }

        const prompt = PromptTemplateService.loadAndRender("update-diagram-user.md", {
          diagramType: diagramTypeDisplayName(diagramType),
          existingDiagram,
          sourceCode,
        });

        const request = newRequest(OperationType.GENERATE_UML_DIAGRAM, null, prompt, {
          diagramType: diagramTypeDisplayName(diagramType),
        });

        let content: string;
        try {
          content = await executeForContent(request);
        } catch (e) {
          showError("Diagram Update Failed", e instanceof Error ? e.message : String(e));
          return;
        }
        if (!content || content.trim().length === 0) {
          showError("Diagram Update Failed", "Empty response from Copilot");
          return;
        }

        // Ensure metadata is preserved — if Copilot dropped it, re-add it
        let updatedContent = content;
        if (!updatedContent.startsWith("%% scope:")) {
          updatedContent = `%% scope: ${scopeLine}\n%% type: ${diagramTypeTemplateId(diagramType)}\n${updatedContent}`;
        }

        writeTextFile(mmdPath, updatedContent);
        await openFile(mmdPath);

        showInfo("Diagram Updated", `${baseName(mmdPath)} updated successfully`);
      } catch (e) {
        showError("Diagram Update Failed", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════════
//  Shared helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Resolves the .mmd file to operate on: the explorer-context Uri, else the active editor's
 * document if it's a .mmd file, else prompts the user with an open-file dialog — mirroring
 * RenderMermaidDiagramAction/UpdateDiagramAction's "file in context, else FileChooser" fallback.
 */
async function resolveMmdFile(uri: vscode.Uri | undefined, dialogTitle: string, description: string): Promise<string | undefined> {
  if (uri && uri.scheme === "file" && uri.fsPath.endsWith(".mmd")) {
    return uri.fsPath;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri && activeUri.scheme === "file" && activeUri.fsPath.endsWith(".mmd")) {
    return activeUri.fsPath;
  }

  const defaultUri = workspaceRoot() ? vscode.Uri.file(workspaceRoot()!) : undefined;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: dialogTitle,
    openLabel: "Select",
    filters: { Mermaid: ["mmd"] },
    defaultUri,
  });
  if (!picked || picked.length === 0) return undefined;
  void description; // retained for parity with the Java FileChooserDescriptor#withDescription call
  return picked[0].fsPath;
}

/** Extracts a metadata value from the first lines of the diagram (e.g. "%% scope: path/to/file"). */
function extractMetadata(content: string, key: string): string | null {
  const prefix = `%% ${key}:`;
  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.substring(prefix.length).trim();
    }
    // Stop scanning after non-comment lines (metadata must be at the top)
    if (!trimmed.startsWith("%%") && trimmed.length > 0) {
      break;
    }
  }
  return null;
}
