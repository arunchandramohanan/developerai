import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  AIRequest,
  AIResponse,
  ExecutionMode,
  ModeStatus,
  OperationType,
  errorResponse,
  successResponse,
  modeAvailable,
  modeUnavailable,
} from "../models";
import { settings } from "./settings";
import { PromptTemplateService } from "./promptTemplateService";
import { runProcess } from "../util/exec";
import { report } from "../util/audit";
import { reportFromResponse } from "../services/sdkCodeMetricsReporter";
import { enrichWithRag } from "../rag/ragContextEnricher";
import { log } from "./context";

/**
 * Port of com.bmo.devai.intellij.services.impl.CopilotSdkExecutorImpl.
 * Executes AI operations by shelling out to the GitHub Copilot CLI
 * (`gh copilot -p <prompt> --yolo --silent --model <id>`).
 */
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_MODEL = "gpt-4o";

const activeKills = new Map<string, () => void>();

export class CopilotSdkExecutor {
  private static _instance: CopilotSdkExecutor | undefined;
  static getInstance(): CopilotSdkExecutor {
    if (!CopilotSdkExecutor._instance) CopilotSdkExecutor._instance = new CopilotSdkExecutor();
    return CopilotSdkExecutor._instance;
  }

  private getSelectedModel(): string {
    const configured = settings().getCopilotModel();
    const chosen = !configured || configured.trim().length === 0 ? DEFAULT_MODEL : configured;
    return toCliModelId(chosen);
  }

  /**
   * Resolves how to invoke the Copilot CLI. Prefers the standalone GitHub
   * Copilot CLI (`copilot -p …`); falls back to the `gh copilot` extension
   * form (`gh copilot -p …`). Returns the base command + the arg prefix that
   * precedes `-p`.
   */
  private resolveCli(): { command: string; prefix: string[]; kind: "copilot" | "gh" } {
    // 1) Explicit standalone copilot path
    const configuredCopilot = settings().getCopilotCliPath();
    if (configuredCopilot && configuredCopilot.trim().length > 0) {
      return { command: configuredCopilot.trim(), prefix: [], kind: "copilot" };
    }
    // 2) Auto-detect a standalone `copilot` binary
    const copilot = this.findCopilotBinary();
    if (copilot) return { command: copilot, prefix: [], kind: "copilot" };
    // 3) Fall back to `gh copilot`
    return { command: this.getGhPath(), prefix: ["copilot"], kind: "gh" };
  }

  private findCopilotBinary(): string | null {
    const isWin = os.platform() === "win32";
    const exe = isWin ? "copilot.cmd" : "copilot";
    const candidates: string[] = [];

    // Alongside the running Node binary — catches nvm, Volta, and npm-global
    // installs (copilot is installed next to node), which GUI-launched VS Code
    // often can't reach via PATH.
    try {
      const nodeDir = path.dirname(process.execPath);
      candidates.push(path.join(nodeDir, exe));
      if (isWin) candidates.push(path.join(nodeDir, "copilot.exe"));
    } catch {
      /* ignore */
    }

    // npm global prefix
    const prefix = process.env.npm_config_prefix;
    if (prefix) candidates.push(isWin ? path.join(prefix, exe) : path.join(prefix, "bin", exe));

    if (isWin) {
      candidates.push(path.join(os.homedir(), "AppData", "Roaming", "npm", exe));
    } else {
      candidates.push(
        "/opt/homebrew/bin/copilot",
        "/usr/local/bin/copilot",
        "/home/linuxbrew/.linuxbrew/bin/copilot",
        path.join(os.homedir(), ".local/bin/copilot"),
        path.join(os.homedir(), ".npm-global/bin/copilot"),
        "/usr/bin/copilot"
      );
    }

    // Scan PATH entries.
    const pathEnv = process.env.PATH || "";
    for (const dir of pathEnv.split(path.delimiter)) {
      if (dir) candidates.push(path.join(dir, exe));
    }

    for (const c of candidates) {
      if (c && fileCanExecute(c)) return c;
    }
    return null; // not found in known locations; checkAvailability still probes `copilot` bare via PATH
  }

  private getGhPath(): string {
    const configured = settings().getGhCliPath();
    if (configured && configured.trim().length > 0) return configured;
    if (os.platform() === "win32") {
      for (const dir of ["C:\\Program Files\\GitHub CLI", "C:\\Program Files (x86)\\GitHub CLI"]) {
        const exe = path.join(dir, "gh.exe");
        if (fileCanExecute(exe)) return exe;
      }
    } else {
      for (const p of [
        "/opt/homebrew/bin/gh",
        "/usr/local/bin/gh",
        "/home/linuxbrew/.linuxbrew/bin/gh",
        path.join(os.homedir(), ".local/bin/gh"),
      ]) {
        if (fileCanExecute(p)) return p;
      }
    }
    return "gh";
  }

  async checkAvailability(): Promise<ModeStatus> {
    try {
      // Prefer the standalone Copilot CLI.
      const standalone = settings().getCopilotCliPath().trim() || this.findCopilotBinary() || "copilot";
      const copilotCheck = await runProcess(standalone, ["--version"], { timeoutMs: 15000 });
      if (copilotCheck.exitCode === 0) {
        const version = copilotCheck.stdout.split(/\r?\n/)[0] || "GitHub Copilot CLI";
        return modeAvailable(ExecutionMode.SDK, version);
      }

      // Fall back to the `gh copilot` extension.
      const gh = this.getGhPath();
      const ghCheck = await runProcess(gh, ["--version"], { timeoutMs: 15000 });
      if (ghCheck.exitCode !== 0) {
        return modeUnavailable(
          ExecutionMode.SDK,
          "GitHub Copilot CLI not found. Install it with 'npm install -g @github/copilot' (or install the GitHub CLI 'gh')."
        );
      }
      const authCheck = await runProcess(gh, ["auth", "status"], { timeoutMs: 15000 });
      if (authCheck.exitCode !== 0) {
        return modeUnavailable(ExecutionMode.SDK, "Not authenticated with GitHub CLI. Run 'gh auth login'");
      }
      const ghCopilotCheck = await runProcess(gh, ["copilot", "--help"], { timeoutMs: 15000 });
      if (ghCopilotCheck.exitCode !== 0) {
        return modeUnavailable(
          ExecutionMode.SDK,
          "Copilot CLI not available. Install 'npm install -g @github/copilot' or 'gh extension install github/gh-copilot'."
        );
      }
      const version = ghCheck.stdout.split(/\r?\n/)[0] || "unknown";
      return modeAvailable(ExecutionMode.SDK, version);
    } catch (e) {
      return modeUnavailable(ExecutionMode.SDK, "Error checking SDK: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async execute(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    const model = this.getSelectedModel();

    // Central RAG hook — the single chokepoint for all SDK requests.
    const enriched = await enrichWithRag(request);
    log(`SDK execute: op=${enriched.operationType} model=${model} requestId=${enriched.id}`);

    try {
      const { command, args } = this.buildCommand(enriched, model);
      const workDir = enriched.context["workingDirectory"];
      const output = await runProcess(command, args, {
        cwd: workDir && workDir.trim().length > 0 ? workDir : undefined,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        onStart: (kill) => activeKills.set(enriched.id, kill),
      });
      const duration = Date.now() - startTime;
      if (output.exitCode !== 0) {
        let error = output.stderr;
        if (!error || error.trim().length === 0) error = `Command failed with exit code ${output.exitCode}`;
        return errorResponse(enriched.id, error, duration);
      }
      const content = output.stdout;
      report(enriched.operationType, model, "CopilotSdkExecutor", enriched.prompt, content, duration, true, null);
      // Use-case-specific code metrics, counted straight from the response.
      reportFromResponse(enriched.operationType, content);
      return successResponse(enriched.id, content, duration, ExecutionMode.SDK);
    } catch (e) {
      const duration = Date.now() - startTime;
      const msg = e instanceof Error ? e.message : String(e);
      report(enriched.operationType, model, "CopilotSdkExecutor", enriched.prompt, "", duration, false, msg);
      return errorResponse(enriched.id, msg, duration);
    } finally {
      activeKills.delete(enriched.id);
    }
  }

  cancel(requestId: string): boolean {
    const kill = activeKills.get(requestId);
    if (kill) {
      kill();
      activeKills.delete(requestId);
      return true;
    }
    return false;
  }

  private buildCommand(request: AIRequest, model: string): { command: string; args: string[] } {
    const cli = this.resolveCli();
    const p = request.prompt;
    let prompt: string;
    switch (request.operationType) {
      case OperationType.GENERATE_TESTS:
        prompt = PromptTemplateService.loadAndRender("sdk-test-generation.md", { prompt: p });
        break;
      case OperationType.GENERATE_DOCUMENTATION:
        prompt = PromptTemplateService.loadAndRender("sdk-documentation.md", { prompt: p });
        break;
      case OperationType.GENERATE_README:
        prompt = PromptTemplateService.loadAndRender("readme-generation-user.md", { prompt: p });
        break;
      case OperationType.CODE_REVIEW:
        prompt = PromptTemplateService.loadAndRender("sdk-code-review.md", { prompt: p });
        break;
      case OperationType.APPLY_FIX:
        prompt = PromptTemplateService.loadAndRender("sdk-apply-fix.md", { prompt: p });
        break;
      case OperationType.TEST_SCENARIOS:
        prompt = PromptTemplateService.loadAndRender("test-scenarios-and-cases.md", { prompt: p });
        break;
      case OperationType.GENERATE_SHAKEDOWN_TESTS:
        prompt = PromptTemplateService.loadAndRender("shakedown-test-generation.md", {
          prompt: p,
          fileName: request.context["fileName"] ?? request.context["targetName"] ?? "collection",
          outputDir: request.context["outputDir"] ?? "",
        });
        break;
      case OperationType.BUSINESS_SUMMARY:
        prompt = PromptTemplateService.loadAndRender("business-logic-summary.md", { prompt: p });
        break;
      case OperationType.GENERATE_FEATURE_CODE:
        prompt = PromptTemplateService.loadAndRender("feature-code-generation.md", { prompt: p });
        break;
      case OperationType.GENERATE_USER_STORIES:
        prompt = PromptTemplateService.loadAndRender("user-stories-generation.md", { prompt: p });
        break;
      default:
        // UPDATE_DOCUMENTATION, GENERATE_UML_DIAGRAM, PLATFORM_UPGRADE, GENERATE_STORY,
        // FEATURE_UPDATE, GENERATE_SCAFFOLD, API_DRIFT, DEPENDENCY_*, FIX_SAST_FINDINGS, CHAT
        prompt = p;
        break;
    }

    // `copilot -p …` (standalone) or `gh copilot -p …` (extension form).
    const base = [...cli.prefix, "-p", prompt];
    const wrap = (args: string[]) => ({ command: cli.command, args });
    switch (request.operationType) {
      case OperationType.FEATURE_UPDATE:
        return wrap([...base, "--yolo", "--silent", "--available-tools=view,grep,glob", "--model", model]);
      case OperationType.UPDATE_DOCUMENTATION:
        return wrap([...base, "--available-tools=edit,view,grep,glob", "--allow-tool=write", "--model", model]);
      case OperationType.FIX_SAST_FINDINGS:
        return wrap([...base, "--available-tools=view,grep,glob", "--model", model]);
      case OperationType.CODE_REVIEW:
        return wrap([...base, "--yolo", "--silent", "--available-tools=view,grep,glob", "--model", model]);
      case OperationType.GENERATE_SHAKEDOWN_TESTS:
        return wrap([...base, "--yolo", "--silent", "--available-tools=view,grep,glob", "--model", model]);
      case OperationType.GENERATE_TESTS:
        return wrap([...base, "--yolo", "--silent", "--available-tools=view,grep,glob", "--model", model]);
      default:
        return wrap([...base, "--yolo", "--silent", "--model", model]);
    }
  }
}

/**
 * Converts a Copilot model display name into the CLI id the `--model` flag
 * expects: collapse whitespace to dashes and lowercase. Already-normalized
 * ids pass through unchanged.
 */
export function toCliModelId(displayName: string | null | undefined): string {
  if (!displayName) return DEFAULT_MODEL;
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return DEFAULT_MODEL;
  return trimmed.replace(/\s+/g, "-").toLowerCase();
}

function fileCanExecute(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
