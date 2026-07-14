import * as vscode from "vscode";
import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { getActiveSelection } from "../util/codeSelection";
import { notifyError, notifyInfo, notifyWarning } from "../util/notify";
import { readFileContent, resolveAvailableMarkdownPath } from "../util/response";
import { writeTextFile, openFile } from "../util/files";
import { DevAIException } from "../util/exception";
import { GeneratedTest } from "../models/testing";
import {
  FolderGenerationListener,
  generateTestForSelection,
  generateTestsForFolder,
} from "../services/testGenerationService";
import { generateShakedownSuite } from "../services/shakedownTestService";
import { showTestPreview } from "../ui/testPreviewPanel";
import { showBatchTestPreview } from "../ui/testBatchPreviewPanel";
import { showShakedownPreview } from "../ui/shakedownPreviewPanel";
import { handleIfChatMode, handleIfChatModeFolder } from "../chatmode/integrator";
import { TaskType } from "../models/chat";

/**
 * Testing feature cluster — port of:
 *  - actions/generation/GenerateTestsAction.java
 *  - actions/generation/GenerateTestsForFolderAction.java
 *  - actions/GenerateTestScenariosAndCasesAction.java
 *  - actions/GenerateShakedownTestsAction.java (spec-file resolution +
 *    validation) and services/ShakedownTestService[Impl].java (generation).
 *
 * Commands intercept into the Copilot Chat pipeline when Chat Mode is active
 * (mirroring the ChatModeIntegrator calls in the Java actions). Teaser quota
 * gating and Save & Verify / Auto-Fix (via TestRunnerService) have no
 * equivalent core service in this extension and are intentionally omitted —
 * see the ui/* panel files for notes on the latter.
 */
export function registerTesting(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateTests", () => {
      void runGenerateTests();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateTestsForFolder", (uri?: vscode.Uri) => {
      void runGenerateTestsForFolder(uri);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateTestScenariosAndCases", (uri?: vscode.Uri) => {
      void runGenerateTestScenariosAndCases(uri);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.generateShakedownTests", (uri?: vscode.Uri) => {
      void runGenerateShakedownTests(uri);
    })
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Port of GenerateTestsAction.actionPerformed. */
async function runGenerateTests(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    notifyWarning("Please open a file to generate tests.");
    return;
  }

  if (await handleIfChatMode(TaskType.TEST_GENERATION, editor.document.uri.fsPath)) return;

  const selection = await getActiveSelection();
  if (!selection) {
    notifyWarning("No Code Selected: Please select code or position cursor in a method/class to generate tests.");
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Generating Tests", cancellable: true },
    async (progress, token) => {
      progress.report({ message: "Connecting to GitHub Copilot..." });
      try {
        const result = await generateTestForSelection(selection, null);
        if (token.isCancellationRequested) return;
        showTestPreview(result);
        maybeShowLanguageHint(selection.languageName);
      } catch (e) {
        notifyError(errorMessage(e));
      }
    }
  );
}

/**
 * Port of GenerateTestsAction.maybeShowSdkHint, renamed since this port has
 * no distinct "SDK vs interpreter" IDE concept — it's the same language-setup
 * nudge either way.
 */
function maybeShowLanguageHint(language: string): void {
  const normalized = language.trim().toLowerCase();
  let hint: string | null = null;
  if (normalized === "python") {
    hint =
      "Generated Python tests. If you see unresolved-import errors, make sure a Python interpreter and the test dependencies are configured for this workspace.";
  } else if (normalized === "javascript" || normalized === "js" || normalized === "jsx") {
    hint = "Generated JavaScript tests. Ensure Node.js/npm dependencies are configured for this project.";
  }
  if (hint) notifyInfo(hint);
}

/** Port of GenerateTestsForFolderAction.actionPerformed. */
async function runGenerateTestsForFolder(uri?: vscode.Uri): Promise<void> {
  let folderUri = uri;

  if (!folderUri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Select Folder",
    });
    if (!picked || picked.length === 0) return; // user cancelled
    folderUri = picked[0];
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(folderUri);
  } catch (e) {
    notifyError(errorMessage(e));
    return;
  }
  if ((stat.type & vscode.FileType.Directory) === 0) {
    notifyWarning("Please select a folder to generate tests for.");
    return;
  }

  const folderPath = folderUri.fsPath;
  const folderName = path.basename(folderPath);

  if (await handleIfChatModeFolder(TaskType.FOLDER_TEST_GENERATION, folderPath)) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating Tests for Folder '${folderName}'`,
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: "Scanning folder for source files..." });

      const listener: FolderGenerationListener = {
        onFileStarted: (fileName, current, total) => {
          progress.report({ message: `${current}/${total} — ${fileName}`, increment: total > 0 ? 100 / total : 0 });
        },
      };

      let results: GeneratedTest[];
      try {
        results = await generateTestsForFolder(folderPath, listener, token);
      } catch (e) {
        notifyError(errorMessage(e));
        return;
      }

      if (results.length === 0) {
        notifyWarning(`No eligible source files found in '${folderName}'.`);
        return;
      }

      showBatchTestPreview(results);
    }
  );
}

/** Port of GenerateTestScenariosAndCasesAction.actionPerformed. */
async function runGenerateTestScenariosAndCases(uri?: vscode.Uri): Promise<void> {
  let target = uri;

  if (!target) {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri && activeUri.fsPath.toLowerCase().endsWith(".md")) {
      target = activeUri;
    }
  }

  if (!target) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      filters: { Markdown: ["md"] },
      openLabel: "Select Business Requirements File",
    });
    if (!picked || picked.length === 0) return; // user cancelled
    target = picked[0];
  }

  if (!target.fsPath.toLowerCase().endsWith(".md")) {
    notifyError("Please select a markdown (.md) file containing business requirements.");
    return;
  }

  const targetPath = target.fsPath;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Generate Test Scenarios and Cases", cancellable: false },
    async (progress) => {
      progress.report({ message: "Reading business requirements..." });

      const requirementsContent = readFileContent(targetPath);
      if (!requirementsContent || requirementsContent.trim().length === 0) {
        notifyError("The selected file is empty.");
        return;
      }

      const targetName = path.basename(targetPath, path.extname(targetPath));
      const request = newRequest(OperationType.TEST_SCENARIOS, null, requirementsContent, { targetName });

      progress.report({ message: "Generating test scenarios and cases..." });
      try {
        const content = await executeForContent(request);
        if (!content || content.trim().length === 0) {
          notifyError("Empty response");
          return;
        }

        const outputDir = path.dirname(targetPath);
        const outputPath = resolveAvailableMarkdownPath(outputDir, `${targetName}-test-scenarios`);
        writeTextFile(outputPath, content);
        await openFile(outputPath);
        notifyInfo(`${path.basename(outputPath)} created successfully.`);
      } catch (e) {
        notifyError(e instanceof DevAIException ? e.message : errorMessage(e));
      }
    }
  );
}

/**
 * Port of GenerateShakedownTestsAction.actionPerformed + ShakedownTestServiceImpl.generate.
 * Resolves the spec file from the invocation context (explorer/editor Uri) when it
 * is a supported OpenAPI/Swagger file; otherwise (missing, a directory, or an
 * unsupported extension) prompts a file chooser and validates the picked file.
 */
const SHAKEDOWN_SUPPORTED_EXTENSIONS = new Set(["yaml", "yml", "json"]);

function isSupportedSpecFile(uri: vscode.Uri): boolean {
  const name = uri.fsPath.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return SHAKEDOWN_SUPPORTED_EXTENSIONS.has(name.substring(dot + 1));
}

async function isDirectoryUri(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

async function runGenerateShakedownTests(uri?: vscode.Uri): Promise<void> {
  let target = uri;

  // Prompt for a spec file whenever the context doesn't supply a usable one
  // (no selection, a directory, or a file with an unsupported extension).
  const isDirectory = target ? await isDirectoryUri(target) : false;
  if (!target || isDirectory || !isSupportedSpecFile(target)) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      title: "Select OpenAPI/Swagger Spec",
      filters: { "OpenAPI/Swagger Spec": ["yaml", "yml", "json"] },
      openLabel: "Select API Specification",
    });
    if (!picked || picked.length === 0) return; // user cancelled
    target = picked[0];
    if (!isSupportedSpecFile(target)) {
      notifyError("Please select an OpenAPI/Swagger spec file (.yaml, .yml, or .json).");
      return;
    }
  }

  const specFilePath = target.fsPath;

  if (await handleIfChatMode(TaskType.SHAKEDOWN_TEST_GENERATION, specFilePath)) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Generate Shakedown Test Suite", cancellable: false },
    async (progress) => {
      progress.report({ message: "Checking SDK mode availability..." });
      try {
        progress.report({ message: "Generating Postman shakedown collection..." });
        const result = await generateShakedownSuite(specFilePath);
        showShakedownPreview(specFilePath, result);
      } catch (e) {
        notifyError(e instanceof DevAIException ? e.message : errorMessage(e));
      }
    }
  );
}
