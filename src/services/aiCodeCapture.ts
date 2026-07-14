import { OperationType, operationDisplayName } from "../models";
import { settings } from "../core/settings";
import { workspaceRoot, log, logError } from "../core/context";
import { runProcess } from "../util/exec";
import { postJson } from "../util/http";

/**
 * Port of com.bmo.devai.intellij.services.AiCodeCaptureService (git working-tree
 * snapshots), models.core.GitSnapshot / AiCodeMetrics, and the code-metrics
 * reporting sink of UsageServiceImpl + AnalyticsApiClient.
 *
 * Chat Mode is blindfolded — it injects a prompt into the Copilot Chat UI and
 * cannot see the model's output, so AI-generated code is measured by polling
 * git for working-tree deltas (see {@link scheduleCodeMetricsCapture}).
 */

// ---- GitSnapshot -----------------------------------------------------------

/** A point-in-time snapshot of the git working tree state. */
export interface GitSnapshot {
  /** Tracked files with uncommitted changes (from `git diff HEAD --numstat`). */
  trackedFilesChanged: number;
  /** Untracked files (from `git ls-files --others --exclude-standard`). */
  untrackedFileCount: number;
  additions: number;
  deletions: number;
  timestampMs: number;
}

export const EMPTY_SNAPSHOT: GitSnapshot = {
  trackedFilesChanged: 0,
  untrackedFileCount: 0,
  additions: 0,
  deletions: 0,
  timestampMs: 0,
};

export function snapshotTotalFilesChanged(s: GitSnapshot): number {
  return s.trackedFilesChanged + s.untrackedFileCount;
}

function snapshotsEqual(a: GitSnapshot, b: GitSnapshot): boolean {
  return (
    a.trackedFilesChanged === b.trackedFilesChanged &&
    a.untrackedFileCount === b.untrackedFileCount &&
    a.additions === b.additions &&
    a.deletions === b.deletions
  );
}

const GIT_TIMEOUT_MS = 15_000; // 15 seconds — stat is fast

/**
 * Captures a point-in-time snapshot of the current git working tree state.
 * Lightweight (~100ms even on large repos); returns {@link EMPTY_SNAPSHOT}
 * if the workspace is not inside a git repository.
 */
export async function captureGitStat(): Promise<GitSnapshot> {
  const basePath = await getGitRoot();
  if (!basePath) {
    log("Cannot capture git stat — not a git repository");
    return EMPTY_SNAPSHOT;
  }

  try {
    // 1. Get tracked file changes: additions/deletions per file
    let trackedFilesChanged = 0;
    let additions = 0;
    let deletions = 0;

    const numstat = await runGit(basePath, ["diff", "HEAD", "--numstat"]);
    if (numstat.exitCode === 0) {
      for (const line of numstat.stdout.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        // Format: "additions\tdeletions\tfilename"; binary files show "-\t-\tfilename".
        const parts = line.split("\t");
        if (parts.length >= 2) {
          trackedFilesChanged++;
          if (parts[0] !== "-") additions += parseIntSafe(parts[0]);
          if (parts[1] !== "-") deletions += parseIntSafe(parts[1]);
        }
      }
    }

    // 2. Count untracked files
    let untrackedFileCount = 0;
    const untracked = await runGit(basePath, ["ls-files", "--others", "--exclude-standard"]);
    if (untracked.exitCode === 0) {
      untrackedFileCount = untracked.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    }

    const snapshot: GitSnapshot = { trackedFilesChanged, untrackedFileCount, additions, deletions, timestampMs: Date.now() };
    log(`Git stat captured: tracked=${trackedFilesChanged} untracked=${untrackedFileCount} +${additions} -${deletions}`);
    return snapshot;
  } catch (e) {
    log("Failed to capture git stat: " + (e instanceof Error ? e.message : String(e)));
    return EMPTY_SNAPSHOT;
  }
}

/** Resolves the repository root for the workspace, or null when not a git repo. */
async function getGitRoot(): Promise<string | null> {
  const basePath = workspaceRoot();
  if (!basePath) return null;
  try {
    const output = await runGit(basePath, ["rev-parse", "--show-toplevel"]);
    if (output.exitCode === 0) return output.stdout.trim();
  } catch (e) {
    log("Not a git repository: " + basePath);
  }
  return null;
}

async function runGit(workDir: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  try {
    return await runProcess("git", args, { cwd: workDir, timeoutMs: GIT_TIMEOUT_MS });
  } catch (e) {
    log("Git command failed: git " + args.join(" ") + " — " + (e instanceof Error ? e.message : String(e)));
    return { stdout: "", exitCode: -1 };
  }
}

function parseIntSafe(value: string): number {
  const parsed = parseInt(value.trim(), 10);
  return isNaN(parsed) ? 0 : parsed;
}

// ---- AiCodeMetrics ---------------------------------------------------------

/** The delta of AI-generated code changes detected via git diff. */
export interface AiCodeMetrics {
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

export function metricsHasChanges(m: AiCodeMetrics): boolean {
  return m.filesChanged > 0 || m.linesAdded > 0 || m.linesDeleted > 0;
}

/** Compute the delta between a pre-submit snapshot and a post-response snapshot. */
export function metricsFromDelta(before: GitSnapshot, after: GitSnapshot): AiCodeMetrics {
  let deltaFiles = Math.max(0, snapshotTotalFilesChanged(after) - snapshotTotalFilesChanged(before));
  const deltaAdded = Math.max(0, after.additions - before.additions);
  const deltaDeleted = Math.max(0, after.deletions - before.deletions);

  // If lines changed but file count delta is 0 (e.g. delete + create = net 0),
  // infer at least 1 file was touched
  if (deltaFiles === 0 && (deltaAdded > 0 || deltaDeleted > 0)) {
    deltaFiles = 1;
  }

  return { filesChanged: deltaFiles, linesAdded: deltaAdded, linesDeleted: deltaDeleted };
}

// ---- Analytics sink (port of AnalyticsApiClient.reportCodeGenerationMetric) -

/** Maps an OperationType to the backend analytics endpoint path. */
function mapMetricEndpoint(operationType: OperationType): string {
  switch (operationType) {
    case OperationType.GENERATE_TESTS: return "/analytics/unit-test-generation-metrics";
    case OperationType.CODE_REVIEW: return "/analytics/code-review-metrics";
    case OperationType.API_DRIFT: return "/analytics/api-drift-remediation-metrics";
    case OperationType.APPLY_FIX:
    case OperationType.FIX_SAST_FINDINGS: return "/analytics/vpm-remediation-metrics";
    case OperationType.GENERATE_DOCUMENTATION:
    case OperationType.GENERATE_README: return "/analytics/documentation-generation-metrics";
    case OperationType.UPDATE_DOCUMENTATION: return "/analytics/documentation-updated-metrics";
    case OperationType.GENERATE_UML_DIAGRAM: return "/analytics/diagram-generation-metrics";
    case OperationType.GENERATE_STORY: return "/analytics/ticket-generation-metrics";
    case OperationType.GENERATE_SCAFFOLD:
    case OperationType.CHAT: return "/analytics/code-scaffold-generation-metrics";
    case OperationType.FEATURE_UPDATE: return "/analytics/code-scaffold-updated-metrics";
    case OperationType.DEPENDENCY_ANALYSIS:
    case OperationType.DEPENDENCY_MIGRATION: return "/analytics/dependency-remediation-metrics";
    case OperationType.GENERATE_SHAKEDOWN_TESTS: return "/analytics/shakedown-test-metrics";
    case OperationType.TEST_SCENARIOS: return "/analytics/test-scenario-generation-metrics";
    case OperationType.BUSINESS_SUMMARY: return "/analytics/business-summary-generation-metrics";
    case OperationType.PLATFORM_UPGRADE: return "/analytics/platform-upgrade-metrics";
    case OperationType.GENERATE_FEATURE_CODE: return "/analytics/feature-code-generation-metrics";
    case OperationType.GENERATE_USER_STORIES: return "/analytics/user-stories-generation-metrics";
  }
}

/**
 * Builds the metric body. The backend reads exactly one field per operation
 * (e.g. testFilesGenerated = filesChanged, linesUpdated = linesAdded).
 */
function buildMetricBody(operationType: OperationType, metrics: AiCodeMetrics): Record<string, unknown> {
  switch (operationType) {
    case OperationType.GENERATE_TESTS: return { testFilesGenerated: metrics.filesChanged };
    case OperationType.CODE_REVIEW: return { linesUpdated: metrics.linesAdded };
    case OperationType.API_DRIFT: return { linesRemediated: metrics.linesAdded };
    case OperationType.APPLY_FIX:
    case OperationType.FIX_SAST_FINDINGS: return { issuesFixed: metrics.filesChanged, severity: "" };
    case OperationType.GENERATE_DOCUMENTATION:
    case OperationType.GENERATE_README: return { filesGenerated: metrics.filesChanged };
    case OperationType.UPDATE_DOCUMENTATION: return { linesUpdated: metrics.linesAdded };
    case OperationType.GENERATE_UML_DIAGRAM: return { filesGenerated: metrics.filesChanged };
    case OperationType.GENERATE_STORY: return { ticketsGenerated: metrics.filesChanged, epicsGenerated: 0, ticketType: "JIRA" };
    case OperationType.GENERATE_SCAFFOLD:
    case OperationType.CHAT: return { filesGenerated: metrics.filesChanged };
    case OperationType.FEATURE_UPDATE: return { linesUpdated: metrics.linesAdded };
    case OperationType.DEPENDENCY_ANALYSIS:
    case OperationType.DEPENDENCY_MIGRATION: return { linesRemediated: metrics.linesAdded };
    case OperationType.GENERATE_SHAKEDOWN_TESTS: return { filesCreated: metrics.filesChanged };
    case OperationType.TEST_SCENARIOS:
    case OperationType.BUSINESS_SUMMARY:
    case OperationType.GENERATE_USER_STORIES: return { linesGenerated: metrics.linesAdded };
    case OperationType.PLATFORM_UPGRADE: return { linesUpdated: metrics.linesAdded };
    case OperationType.GENERATE_FEATURE_CODE: return { filesGenerated: metrics.filesChanged };
  }
}

/**
 * Reports a code-generation metric to the analytics backend. Fire-and-forget:
 * never throws, no-ops when no analytics URL is configured or when the
 * operation is CHAT (no use-case-specific endpoint) or metrics are empty.
 */
export function reportCodeMetrics(operationType: OperationType, metrics: AiCodeMetrics): void {
  try {
    if (!metricsHasChanges(metrics)) {
      log("No AI code changes detected, skipping code metrics report");
      return;
    }
    if (operationType === OperationType.CHAT) {
      log("Skipping code metric for CHAT — no use-case-specific endpoint");
      return;
    }
    const s = settings();
    const url = s.getAnalyticsApiUrl();
    if (!url || url.trim().length === 0) {
      log(`code metrics (skipped, no analytics url): op=${operationType} files=${metrics.filesChanged} +${metrics.linesAdded} -${metrics.linesDeleted}`);
      return;
    }

    const path = mapMetricEndpoint(operationType);
    const body = buildMetricBody(operationType, metrics);
    const headers: Record<string, string> = {};
    const key = s.getAnalyticsApiKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;

    log(`Reporting code metric: ${operationDisplayName(operationType)} → POST ${path} ${JSON.stringify(body)}`);
    void postJson(url.replace(/\/$/, "") + path, body, headers).catch((e) =>
      logError("code metrics report failed (non-blocking)", e)
    );
  } catch (e) {
    logError("code metrics report failed (non-blocking)", e);
  }
}

// ---- Chat Mode poller (port of ChatModeTriggerServiceImpl polling) ---------

// The first interval tick doubles as the IntelliJ CODE_METRICS_INITIAL_DELAY_MS
// (both are 10s in the Java implementation).
const CODE_METRICS_POLL_INTERVAL_MS = 10_000;
const CODE_METRICS_STABLE_THRESHOLD_MS = 120_000; // 2 minutes
const CODE_METRICS_MAX_TOTAL_MS = 30 * 60 * 1000; // 30 minutes

let activeCodeMetricsTimer: NodeJS.Timeout | null = null;

/**
 * Polls git for the AI-generated code delta after a Chat Mode prompt has been
 * submitted, then reports code metrics once the working tree has been quiet for
 * {@link CODE_METRICS_STABLE_THRESHOLD_MS}. A hard time cap ensures the poller
 * always terminates. Only one poller runs at a time — starting a new capture
 * cancels the previous one.
 */
export function scheduleCodeMetricsCapture(preGitSnapshot: GitSnapshot, operationType: OperationType): void {
  if (activeCodeMetricsTimer != null) {
    clearInterval(activeCodeMetricsTimer);
    activeCodeMetricsTimer = null;
    log("Cancelled previous code metrics poller (new use case started)");
  }

  let lastStat = preGitSnapshot;
  let lastChangeTime = 0;
  let seenChange = false;
  const startTime = Date.now();
  let polling = false;

  log(`Starting code metrics poller (interval=${CODE_METRICS_POLL_INTERVAL_MS}ms, stableThreshold=${CODE_METRICS_STABLE_THRESHOLD_MS}ms, maxTotal=${CODE_METRICS_MAX_TOTAL_MS}ms)`);

  const stop = () => {
    if (activeCodeMetricsTimer === timer) activeCodeMetricsTimer = null;
    clearInterval(timer);
  };

  const finishAndReport = (finalStat: GitSnapshot, reason: string) => {
    stop();
    const metrics = metricsFromDelta(preGitSnapshot, finalStat);
    log(`Code metrics ${reason}: files=${metrics.filesChanged} +${metrics.linesAdded} -${metrics.linesDeleted}`);
    if (metricsHasChanges(metrics)) {
      reportCodeMetrics(operationType, metrics);
    } else {
      log("No AI code changes detected — skipping metrics report");
    }
  };

  const timer = setInterval(() => {
    void (async () => {
      if (polling) return; // skip overlapping polls
      polling = true;
      try {
        const elapsedMs = Date.now() - startTime;

        if (elapsedMs >= CODE_METRICS_MAX_TOTAL_MS) {
          const finalStat = await captureGitStat();
          finishAndReport(finalStat, `poller reached max time cap (${elapsedMs}ms elapsed)`);
          return;
        }

        const currentStat = await captureGitStat();
        if (!snapshotsEqual(currentStat, lastStat)) {
          // Agent is still writing files — reset quiet timer
          lastStat = currentStat;
          lastChangeTime = Date.now();
          if (!seenChange) {
            seenChange = true;
            log(`First git change detected: tracked=${currentStat.trackedFilesChanged} untracked=${currentStat.untrackedFileCount} +${currentStat.additions} -${currentStat.deletions} (entering quiet phase)`);
          }
        } else if (seenChange) {
          const quietMs = Date.now() - lastChangeTime;
          if (quietMs >= CODE_METRICS_STABLE_THRESHOLD_MS) {
            finishAndReport(currentStat, `stable (quiet=${quietMs}ms)`);
          }
        }
      } catch (e) {
        log("Code metrics poll failed (non-blocking): " + (e instanceof Error ? e.message : String(e)));
      } finally {
        polling = false;
      }
    })();
  }, CODE_METRICS_POLL_INTERVAL_MS);
  activeCodeMetricsTimer = timer;
}
