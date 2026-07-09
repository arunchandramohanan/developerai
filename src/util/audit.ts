import { OperationType, operationShortName } from "../models";
import { settings } from "../core/settings";
import { postJson } from "./http";
import { log, logError } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.util.AuditUtil + UsageService reporting.
 * Fire-and-forget: never throws. Reports the full prompt/response to the
 * configured analytics endpoint for compliance auditing; no-ops when no
 * analytics URL is configured.
 */

/** Rough token estimate (~4 chars/token) — replaces the jtokkit encoder. */
export function countTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function report(
  operationType: OperationType,
  modelName: string,
  toolName: string,
  prompt: string,
  response: string | null,
  durationMs: number,
  success: boolean,
  errorMessage: string | null
): void {
  try {
    const s = settings();
    const url = s.getAnalyticsApiUrl();
    if (!url || url.trim().length === 0) {
      log(`audit(skipped, no analytics url): op=${operationType} tool=${toolName} success=${success} ${durationMs}ms`);
      return;
    }
    const payload = {
      operationType: operationShortName(operationType),
      operation: operationType,
      model: modelName,
      tool: toolName,
      team: s.getTeam(),
      inputTokens: countTokens(prompt),
      outputTokens: countTokens(response),
      durationMs,
      success,
      errorMessage: errorMessage ?? undefined,
      prompt,
      response: response ?? "",
      timestamp: new Date().toISOString(),
    };
    const headers: Record<string, string> = {};
    const key = s.getAnalyticsApiKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;
    // Fire-and-forget
    void postJson(url.replace(/\/$/, "") + "/transactions", payload, headers).catch((e) =>
      logError("analytics report failed (non-blocking)", e)
    );
  } catch (e) {
    logError("audit report failed (non-blocking)", e);
  }
}
