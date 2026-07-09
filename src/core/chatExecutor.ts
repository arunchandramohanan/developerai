import * as vscode from "vscode";
import * as fs from "fs";
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
import { report } from "../util/audit";
import { log } from "./context";

/**
 * Port of com.bmo.devai.intellij.services.impl.CopilotChatExecutorImpl.
 * The IntelliJ implementation delegated to the IDE's Copilot Chat plugin; the
 * VS Code equivalent is the Language Model API (vscode.lm), which drives
 * GitHub Copilot's chat models directly and is the working Chat-mode path.
 */
const DEFAULT_MODEL = "gpt-4o";

const cancellers = new Map<string, vscode.CancellationTokenSource>();

export class CopilotChatExecutor {
  private static _instance: CopilotChatExecutor | undefined;
  static getInstance(): CopilotChatExecutor {
    if (!CopilotChatExecutor._instance) CopilotChatExecutor._instance = new CopilotChatExecutor();
    return CopilotChatExecutor._instance;
  }

  async checkAvailability(): Promise<ModeStatus> {
    try {
      if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
        return modeUnavailable(
          ExecutionMode.CHAT,
          "Language Model API unavailable. Install GitHub Copilot Chat and update VS Code."
        );
      }
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (models && models.length > 0) {
        return modeAvailable(ExecutionMode.CHAT, models[0].family || "Copilot Chat");
      }
      // Try any available model
      const anyModels = await vscode.lm.selectChatModels();
      if (anyModels && anyModels.length > 0) {
        return modeAvailable(ExecutionMode.CHAT, anyModels[0].family || "Chat");
      }
      return modeUnavailable(
        ExecutionMode.CHAT,
        "No chat models available. Sign in to GitHub Copilot Chat."
      );
    } catch (e) {
      return modeUnavailable(ExecutionMode.CHAT, "Error checking Chat mode: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async execute(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    const prompt = this.buildPrompt(request);
    const source = new vscode.CancellationTokenSource();
    cancellers.set(request.id, source);
    try {
      const response = await this.sendChat(prompt, source.token);
      const duration = Date.now() - startTime;
      report(request.operationType, this.modelName(), "CopilotChatExecutor", prompt, response, duration, true, null);
      return successResponse(request.id, response, duration, ExecutionMode.CHAT);
    } catch (e) {
      const duration = Date.now() - startTime;
      const msg = e instanceof Error ? e.message : String(e);
      log(`Chat execution failed: ${msg}`);
      report(request.operationType, this.modelName(), "CopilotChatExecutor", prompt, "", duration, false, msg);
      return errorResponse(request.id, msg, duration);
    } finally {
      cancellers.delete(request.id);
      source.dispose();
    }
  }

  cancel(requestId: string): boolean {
    const source = cancellers.get(requestId);
    if (source) {
      source.cancel();
      cancellers.delete(requestId);
      return true;
    }
    return false;
  }

  private modelName(): string {
    return settings().getChatModeModel() || DEFAULT_MODEL;
  }

  private async selectModel(): Promise<vscode.LanguageModelChat> {
    const desired = this.modelName().toLowerCase();
    // Try to match the configured model family, fall back to any copilot model.
    let models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (!models || models.length === 0) models = await vscode.lm.selectChatModels();
    if (!models || models.length === 0) {
      throw new Error(
        "No chat models available. Install and sign in to GitHub Copilot Chat, or switch to SDK mode."
      );
    }
    const matched = models.find(
      (m) => m.family.toLowerCase().includes(desired) || desired.includes(m.family.toLowerCase())
    );
    return matched ?? models[0];
  }

  private async sendChat(prompt: string, token: vscode.CancellationToken): Promise<string> {
    const model = await this.selectModel();
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const chatResponse = await model.sendRequest(messages, {}, token);
    let out = "";
    for await (const fragment of chatResponse.text) {
      out += fragment;
    }
    return out;
  }

  private buildPrompt(request: AIRequest): string {
    const code = request.codeSelection?.text ?? "";
    const language = request.codeSelection?.languageName ?? "code";
    switch (request.operationType) {
      case OperationType.GENERATE_TESTS: {
        const vars: Record<string, string> = {
          language,
          code: code.trim().length === 0 ? request.prompt : code,
        };
        if (request.codeSelection) {
          const fullFile = readFileQuietly(request.codeSelection.filePath);
          if (fullFile) vars.fullFile = fullFile;
        }
        return PromptTemplateService.loadAndRender("chat-executor-test-generation.md", vars);
      }
      case OperationType.GENERATE_DOCUMENTATION:
        return PromptTemplateService.loadAndRender("chat-executor-documentation.md", {
          language,
          code: code.trim().length === 0 ? request.prompt : code,
        });
      case OperationType.CODE_REVIEW:
        return PromptTemplateService.loadAndRender("chat-executor-code-review.md", {
          language,
          code: code.trim().length === 0 ? request.prompt : code,
        });
      case OperationType.GENERATE_README:
        return PromptTemplateService.loadAndRender("readme-generation-user.md", { prompt: request.prompt });
      default:
        // APPLY_FIX and all agentic/document operations pass the prompt through.
        return request.prompt;
    }
  }
}

function readFileQuietly(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
