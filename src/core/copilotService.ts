import {
  AIRequest,
  AIResponse,
  ExecutionContext,
  ExecutionMode,
  RequestStatus,
  errorResponse,
  isSuccess,
} from "../models";
import { ModeManager } from "./modeManager";
import { CopilotSdkExecutor } from "./sdkExecutor";
import { CopilotChatExecutor } from "./chatExecutor";
import { DevAIException } from "../util/exception";
import { showInfo } from "../util/notify";
import { settings } from "./settings";
import { logError } from "./context";

/**
 * Port of com.bmo.devai.intellij.services.impl.CopilotServiceImpl.
 * Orchestrates between the SDK and Chat executors based on ModeManager,
 * handles AUTO fallback, and tracks request status for cancellation.
 */
export interface ExecutionListener {
  onExecutionStarted?(request: AIRequest, context: ExecutionContext): void;
  onExecutionCompleted?(request: AIRequest, response: AIResponse): void;
  onExecutionFailed?(request: AIRequest, error: unknown): void;
  onFallbackOccurred?(from: ExecutionMode, to: ExecutionMode, reason: string): void;
}

export class CopilotService {
  private static _instance: CopilotService | undefined;
  private requestStatuses = new Map<string, RequestStatus>();
  private listeners: ExecutionListener[] = [];
  private lastExecutionContext: ExecutionContext | null = null;

  static getInstance(): CopilotService {
    if (!CopilotService._instance) CopilotService._instance = new CopilotService();
    return CopilotService._instance;
  }

  async execute(request: AIRequest): Promise<AIResponse> {
    this.requestStatuses.set(request.id, RequestStatus.PENDING);
    try {
      this.requestStatuses.set(request.id, RequestStatus.PROCESSING);

      const modeManager = ModeManager.getInstance();
      const context = await modeManager.getExecutionContext();
      this.lastExecutionContext = context;

      for (const l of this.listeners) {
        try { l.onExecutionStarted?.(request, context); } catch { /* ignore */ }
      }
      if (context.fallbackOccurred) {
        this.notifyFallback(ExecutionMode.SDK, ExecutionMode.CHAT, context.fallbackReason ?? "");
      }

      const response = await this.executeWithMode(request, context);
      this.requestStatuses.set(request.id, isSuccess(response) ? RequestStatus.COMPLETED : RequestStatus.FAILED);
      for (const l of this.listeners) {
        try { l.onExecutionCompleted?.(request, response); } catch { /* ignore */ }
      }
      return response;
    } catch (e) {
      this.requestStatuses.set(request.id, RequestStatus.FAILED);
      for (const l of this.listeners) {
        try { l.onExecutionFailed?.(request, e); } catch { /* ignore */ }
      }
      const msg = e instanceof DevAIException ? e.message : e instanceof Error ? "Unexpected error: " + e.message : String(e);
      logError("Execution failed", e);
      return errorResponse(request.id, msg, 0);
    }
  }

  private async executeWithMode(request: AIRequest, context: ExecutionContext): Promise<AIResponse> {
    if (context.activeMode === ExecutionMode.SDK) {
      return CopilotSdkExecutor.getInstance().execute(request);
    }
    return CopilotChatExecutor.getInstance().execute(request);
  }

  getLastExecutionContext(): ExecutionContext | null {
    return this.lastExecutionContext;
  }

  cancelRequest(requestId: string): boolean {
    const status = this.requestStatuses.get(requestId);
    if (status !== RequestStatus.PROCESSING && status !== RequestStatus.PENDING) return false;
    let cancelled = false;
    try { cancelled = CopilotSdkExecutor.getInstance().cancel(requestId); } catch { /* ignore */ }
    if (!cancelled) {
      try { cancelled = CopilotChatExecutor.getInstance().cancel(requestId); } catch { /* ignore */ }
    }
    if (cancelled) this.requestStatuses.set(requestId, RequestStatus.CANCELLED);
    return cancelled;
  }

  getRequestStatus(requestId: string): RequestStatus | undefined {
    return this.requestStatuses.get(requestId);
  }

  addExecutionListener(l: ExecutionListener): void { this.listeners.push(l); }
  removeExecutionListener(l: ExecutionListener): void { this.listeners = this.listeners.filter((x) => x !== l); }

  private notifyFallback(from: ExecutionMode, to: ExecutionMode, reason: string): void {
    if (settings().isShowModeNotifications()) {
      showInfo("BMO GenAI Mode Fallback", `Switched to ${to === ExecutionMode.CHAT ? "Chat Mode" : "SDK Mode"}: ${reason}`);
    }
    for (const l of this.listeners) {
      try { l.onFallbackOccurred?.(from, to, reason); } catch { /* ignore */ }
    }
  }
}

/** Convenience: execute a request and return content or throw on error. */
export async function executeForContent(request: AIRequest): Promise<string> {
  const response = await CopilotService.getInstance().execute(request);
  if (!isSuccess(response)) {
    throw new DevAIException(response.errorMessage ?? "AI request failed");
  }
  return response.content;
}
