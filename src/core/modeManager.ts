import {
  ExecutionContext,
  ExecutionMode,
  ModePreference,
  ModeStatus,
  modePreferenceDefault,
  executionModeDisplayName,
} from "../models";
import { settings } from "./settings";
import { CopilotSdkExecutor } from "./sdkExecutor";
import { CopilotChatExecutor } from "./chatExecutor";
import { DevAIException, ErrorCode } from "../util/exception";
import { showInfo } from "../util/notify";
import { log } from "./context";

/**
 * Port of com.bmo.devai.intellij.services.impl.ModeManagerImpl.
 * Selects between SDK and Chat execution modes with AUTO fallback.
 */
export type ModeChangeListener = (from: ExecutionMode, to: ExecutionMode, reason: string) => void;

export class ModeManager {
  private static _instance: ModeManager | undefined;
  private cachedSdkStatus: ModeStatus | null = null;
  private cachedChatStatus: ModeStatus | null = null;
  private listeners: ModeChangeListener[] = [];

  static getInstance(): ModeManager {
    if (!ModeManager._instance) ModeManager._instance = new ModeManager();
    return ModeManager._instance;
  }

  getModePreference(): ModePreference {
    try {
      return settings().getModePreference();
    } catch {
      return modePreferenceDefault();
    }
  }

  async setModePreference(preference: ModePreference): Promise<void> {
    const s = settings();
    await s.setModePreference(preference);
    if (preference === ModePreference.CHAT_ONLY) await s.setChatModeEnabled(true);
    else if (preference === ModePreference.SDK_ONLY) await s.setChatModeEnabled(false);
    log(`Mode preference changed to ${preference}`);
  }

  async checkSdkAvailability(): Promise<ModeStatus> {
    try {
      this.cachedSdkStatus = await CopilotSdkExecutor.getInstance().checkAvailability();
    } catch (e) {
      this.cachedSdkStatus = {
        mode: ExecutionMode.SDK,
        available: false,
        lastChecked: Date.now(),
        errorMessage: e instanceof Error ? e.message : String(e),
        version: null,
      };
    }
    return this.cachedSdkStatus;
  }

  async checkChatAvailability(): Promise<ModeStatus> {
    try {
      this.cachedChatStatus = await CopilotChatExecutor.getInstance().checkAvailability();
    } catch (e) {
      this.cachedChatStatus = {
        mode: ExecutionMode.CHAT,
        available: false,
        lastChecked: Date.now(),
        errorMessage: e instanceof Error ? e.message : String(e),
        version: null,
      };
    }
    return this.cachedChatStatus;
  }

  async getExecutionContext(): Promise<ExecutionContext> {
    switch (this.getModePreference()) {
      case ModePreference.SDK_ONLY:
        return this.handleSdkOnly();
      case ModePreference.CHAT_ONLY:
        return this.handleChatOnly();
      case ModePreference.AUTO:
      default:
        return this.handleAuto();
    }
  }

  private async handleSdkOnly(): Promise<ExecutionContext> {
    const sdkStatus = await this.checkSdkAvailability();
    if (!sdkStatus.available) {
      throw new DevAIException("SDK mode is not available: " + sdkStatus.errorMessage, ErrorCode.SDK_UNAVAILABLE);
    }
    return { activeMode: ExecutionMode.SDK, preference: ModePreference.SDK_ONLY, sdkStatus, chatStatus: null, fallbackOccurred: false, fallbackReason: null };
  }

  private async handleChatOnly(): Promise<ExecutionContext> {
    const chatStatus = await this.checkChatAvailability();
    if (!chatStatus.available) {
      throw new DevAIException("Chat mode is not available: " + chatStatus.errorMessage, ErrorCode.CHAT_UNAVAILABLE);
    }
    return { activeMode: ExecutionMode.CHAT, preference: ModePreference.CHAT_ONLY, sdkStatus: null, chatStatus, fallbackOccurred: false, fallbackReason: null };
  }

  private async handleAuto(): Promise<ExecutionContext> {
    const sdkStatus = await this.checkSdkAvailability();
    if (sdkStatus.available) {
      return { activeMode: ExecutionMode.SDK, preference: ModePreference.AUTO, sdkStatus, chatStatus: null, fallbackOccurred: false, fallbackReason: null };
    }
    const fallbackReason = "SDK unavailable: " + sdkStatus.errorMessage;
    log("Falling back to Chat mode: " + fallbackReason);
    const chatStatus = await this.checkChatAvailability();
    if (!chatStatus.available) {
      throw new DevAIException(
        `No execution mode available. SDK: ${sdkStatus.errorMessage}, Chat: ${chatStatus.errorMessage}`,
        ErrorCode.NO_MODE_AVAILABLE
      );
    }
    this.notifyFallback(ExecutionMode.SDK, ExecutionMode.CHAT, fallbackReason);
    return { activeMode: ExecutionMode.CHAT, preference: ModePreference.AUTO, sdkStatus, chatStatus, fallbackOccurred: true, fallbackReason };
  }

  private notifyFallback(from: ExecutionMode, to: ExecutionMode, reason: string): void {
    for (const l of this.listeners) {
      try { l(from, to, reason); } catch { /* ignore */ }
    }
    if (settings().isShowModeNotifications()) {
      showInfo("BMO GenAI Mode Switch", `Switched from ${executionModeDisplayName(from)} to ${executionModeDisplayName(to)}. Reason: ${reason}`);
    }
  }

  async refreshAvailability(): Promise<void> {
    await Promise.all([this.checkSdkAvailability(), this.checkChatAvailability()]);
  }

  addModeChangeListener(l: ModeChangeListener): void { this.listeners.push(l); }
  removeModeChangeListener(l: ModeChangeListener): void { this.listeners = this.listeners.filter((x) => x !== l); }
  getCachedSdkStatus(): ModeStatus | null { return this.cachedSdkStatus; }
  getCachedChatStatus(): ModeStatus | null { return this.cachedChatStatus; }
}
