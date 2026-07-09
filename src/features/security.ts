import * as vscode from "vscode";
import * as path from "path";
import { notifyError, notifyInfo, showInfo, showError } from "../util/notify";
import { workspaceRoot, log, logError } from "../core/context";
import { settings } from "../core/settings";
import { CopilotService } from "../core/copilotService";
import {
  RemediationResult,
  RemediationStatus,
  SastFinding,
  SastFixProposal,
  SecuritySeverity,
  Source,
  parseSeverity,
} from "../models/security";
import { SastSourceFactory, SastFindingProvider } from "../services/security/providers";
import {
  SastFindingsStore,
  StoreEntry,
  StoreStatus,
  entryFromFinding,
} from "../services/security/sastFindingsStore";
import { SecurityRemediationService } from "../services/security/securityRemediationService";
import { SastReportWriter } from "../services/security/sastReportWriter";
import { SastDiffApplier, SastPatch, patchIsApplicable } from "../services/security/sastDiffApplier";
import { SastResultsProvider } from "../views/sastResultsView";
import { JiraApiClient, fetchTicketSuccess } from "../services/jiraApiClient";

const TITLE_SAST = "SAST Findings";
const PROPOSED_SCHEME = "devai-sast-proposed";

// Backing store for the virtual "proposed fix" documents shown in the diff view.
const proposedContent = new Map<string, string>();

/** Reconstruct a SastFinding from a store entry (for panel/diagnostic display). */
function findingFromEntry(e: StoreEntry): SastFinding {
  return {
    key: e.key,
    component: null,
    filePath: e.filePath,
    line: e.line,
    rule: e.rule,
    severity: e.severity,
    type: e.type,
    message: e.message,
    status: null,
  };
}

/** Convert a store entry to a RemediationResult reflecting its persisted status. */
function toStoreResult(e: StoreEntry): RemediationResult {
  const processed = e.status === StoreStatus.PROCESSED;
  return {
    finding: findingFromEntry(e),
    severity: e.severity,
    status: processed ? RemediationStatus.PROCESSED : RemediationStatus.UNPROCESSED,
    message: processed ? "Sent to Copilot" : "Awaiting dispatch",
  };
}

function diagnosticSeverity(s: SecuritySeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case SecuritySeverity.CRITICAL:
    case SecuritySeverity.HIGH:
      return vscode.DiagnosticSeverity.Error;
    case SecuritySeverity.MEDIUM:
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/** Publish current store entries as VS Code diagnostics grouped per file. */
function publishDiagnostics(
  diagnostics: vscode.DiagnosticCollection,
  entries: StoreEntry[],
  sourceLabel: string
): void {
  diagnostics.clear();
  const base = workspaceRoot();
  if (!base) return;
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const e of entries) {
    if (!e.filePath) continue;
    const abs = path.isAbsolute(e.filePath) ? e.filePath : path.join(base, e.filePath);
    const line = Math.max(0, e.line - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    const diag = new vscode.Diagnostic(
      range,
      `[${e.rule}] ${e.message}`,
      diagnosticSeverity(e.severity)
    );
    diag.source = sourceLabel ? `DevAI SAST · ${sourceLabel}` : "DevAI SAST";
    diag.code = e.rule;
    const list = byFile.get(abs) ?? [];
    list.push(diag);
    byFile.set(abs, list);
  }
  for (const [file, diags] of byFile) {
    diagnostics.set(vscode.Uri.file(file), diags);
  }
}

/** Load the store and refresh the tree view + diagnostics. */
function refreshView(
  provider: SastResultsProvider,
  diagnostics: vscode.DiagnosticCollection,
  sourceLabel: string
): StoreEntry[] {
  const store = new SastFindingsStore();
  const entries = Array.from(store.load().values());
  provider.setResults(entries.map(toStoreResult), sourceLabel);
  publishDiagnostics(diagnostics, entries, sourceLabel);
  return entries;
}

/** Multi-select QuickPick to choose which findings to remediate (scope dialog). */
async function pickFindings(
  findings: SastFinding[],
  alreadyProcessed: Set<string>,
  sourceLabel: string
): Promise<SastFinding[] | undefined> {
  interface FindingItem extends vscode.QuickPickItem {
    finding: SastFinding;
  }
  const items: FindingItem[] = findings.map((f) => {
    const sev = parseSeverity(f.severity);
    const processed = alreadyProcessed.has(f.key);
    return {
      label: `$(${processed ? "check" : "circle-outline"}) [${sev}] ${f.filePath}:${f.line}`,
      description: `[${f.rule}]${processed ? " · processed" : ""}`,
      detail: f.message,
      finding: f,
      picked: !processed,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `Fix ${sourceLabel} Findings`,
    placeHolder: `Select findings to remediate (${findings.length} total). Processed findings are unchecked by default.`,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (selected === undefined) return undefined;
  return selected.map((s) => s.finding);
}

/** Walk proposals: preview each in a diff, apply accepted ones. Returns applied keys. */
async function reviewProposals(
  proposals: Map<string, SastFixProposal>
): Promise<string[]> {
  const queue = Array.from(proposals.values());
  if (queue.length === 0) return [];

  const applied: string[] = [];
  let skipped = 0;
  let rejected = 0;
  let cancelled = false;
  const total = queue.length;

  for (let i = 0; i < total; i++) {
    const proposal = queue[i];
    const patch = SastDiffApplier.buildPatch(proposal);
    if (!patch || !patchIsApplicable(patch)) {
      skipped++;
      continue;
    }

    const decision = await previewAndDecide(proposal, patch, i, total);
    if (decision === "cancel") {
      cancelled = true;
      break;
    }
    if (decision === "accept") {
      const ok = await applyPatch(patch);
      if (ok) applied.push(proposal.key);
    } else {
      rejected++;
    }
  }

  const summary =
    `Applied ${applied.length} of ${total} proposal(s). Rejected: ${rejected}, ` +
    `Skipped (no applicable patch): ${skipped}` +
    (cancelled ? ", Cancelled remaining" : "");
  showInfo("SAST Fix Review", summary);
  return applied;
}

type ReviewDecision = "accept" | "reject" | "cancel";

/** Show a native diff (original vs proposed) then prompt for a decision. */
async function previewAndDecide(
  proposal: SastFixProposal,
  patch: SastPatch,
  index: number,
  total: number
): Promise<ReviewDecision> {
  const fileName = path.basename(proposal.filePath);
  const title = `SAST Fix ${index + 1}/${total} — ${fileName}:${proposal.line}`;

  // Register the proposed content behind a virtual URI so the diff editor can
  // render it read-only alongside the on-disk original.
  const proposedUri = vscode.Uri.parse(
    `${PROPOSED_SCHEME}:/${proposal.filePath}?${index}-${Date.now()}`
  );
  proposedContent.set(proposedUri.toString(), patch.patchedContent);
  try {
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(patch.filePath),
      proposedUri,
      `${title} (Original ↔ Proposed Fix)`,
      { preview: true }
    );

    const buttons = total > 1 ? ["Accept Fix", "Skip", "Cancel All"] : ["Accept Fix", "Reject"];
    const choice = await vscode.window.showInformationMessage(
      `${title}\n\n${proposal.rationale || "Proposed fix"}`,
      { modal: true },
      ...buttons
    );
    if (choice === "Accept Fix") return "accept";
    if (choice === "Cancel All") return "cancel";
    return "reject";
  } finally {
    proposedContent.delete(proposedUri.toString());
  }
}

/** Apply a patch's full-file content via a WorkspaceEdit and save. */
async function applyPatch(patch: SastPatch): Promise<boolean> {
  try {
    const uri = vscode.Uri.file(patch.filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, patch.patchedContent);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      await doc.save();
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, 0);
      editor.revealRange(new vscode.Range(line, 0, line, 0));
    }
    return ok;
  } catch (e) {
    logError("SAST review: failed to apply patch to " + patch.filePath, e);
    showError("SAST Fix Review", "Failed to apply fix: " + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

/** The Fix SAST Findings command handler. */
async function fixSastFindings(
  provider: SastResultsProvider,
  diagnostics: vscode.DiagnosticCollection
): Promise<void> {
  if (!workspaceRoot()) {
    notifyError("Open a workspace folder before running Fix SAST Findings.");
    return;
  }

  const provDef: SastFindingProvider = SastSourceFactory.resolve(settings());
  if (!provDef.isConfigured(settings())) {
    showError(
      "SAST Source Not Configured",
      `${provDef.displayName()} is the active SAST source but its required settings are missing. ` +
        "Update them in BMO GenAI settings."
    );
    return;
  }
  const sourceLabel = provDef.displayName();
  const source: Source = provDef.source();
  const scopeKey = provDef.scopeKey();
  const service = SecurityRemediationService.getInstance();
  const store = new SastFindingsStore();

  // Step 1 — fetch findings and merge into the master store.
  let findings: SastFinding[];
  try {
    findings = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, cancellable: false, title: `Fetching findings from ${sourceLabel}…` },
      () => service.fetchFindings()
    );
  } catch (ex) {
    logError("SAST findings fetch failed", ex);
    notifyError("SAST Findings Failed: " + (ex instanceof Error ? ex.message : String(ex)));
    return;
  }

  const merged = store.mergeFromApi(source, scopeKey, findings);
  const alreadyProcessed = new Set<string>();
  for (const e of merged.values()) {
    if (e.status === StoreStatus.PROCESSED) alreadyProcessed.add(e.key);
  }

  // Populate the view/diagnostics from the freshly merged store.
  provider.setResults(Array.from(merged.values()).map(toStoreResult), sourceLabel);
  publishDiagnostics(diagnostics, Array.from(merged.values()), sourceLabel);

  if (findings.length === 0) {
    notifyInfo("No open vulnerabilities or hotspots were found for this project.");
    return;
  }

  // Step 2 — scope dialog.
  const selected = await pickFindings(findings, alreadyProcessed, sourceLabel);
  if (selected === undefined || selected.length === 0) return;

  // Convert selection into store entries (using the merged map as source of truth).
  const entries: StoreEntry[] = selected.map((f) => {
    const existing = merged.get(f.key);
    return existing ?? entryFromFinding(f, source, scopeKey, StoreStatus.UNPROCESSED);
  });

  // Step 3 — dispatch.
  try {
    const outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
        title: `Dispatching ${entries.length} finding(s) for AI remediation…`,
      },
      () => service.triggerFixesOutcome(entries)
    );

    const activeMode = CopilotService.getInstance().getLastExecutionContext()?.activeMode;
    SastReportWriter.write(sourceLabel, activeMode ?? "AI", outcome.results);

    // Step 4 — review proposals (preview + apply).
    if (outcome.proposals.size > 0) {
      const appliedKeys = await reviewProposals(outcome.proposals);
      if (appliedKeys.length > 0) store.markProcessed(appliedKeys);
    } else {
      notifyInfo("The AI did not return any actionable fix proposals for the selected findings.");
    }

    // Step 5 — refresh view/diagnostics from the now-authoritative store.
    refreshView(provider, diagnostics, sourceLabel);
  } catch (ex) {
    logError("SAST dispatch failed", ex);
    notifyError("SAST Findings Failed: " + (ex instanceof Error ? ex.message : String(ex)));
  }
}

/** Re-fetch findings for the active source and repopulate the view (no dispatch). */
async function refreshSastResults(
  provider: SastResultsProvider,
  diagnostics: vscode.DiagnosticCollection
): Promise<void> {
  const provDef = SastSourceFactory.resolve(settings());
  if (!provDef.isConfigured(settings())) {
    // Nothing configured — just render whatever is persisted.
    refreshView(provider, diagnostics, "");
    return;
  }
  const sourceLabel = provDef.displayName();
  try {
    const findings = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Refreshing SAST findings from ${sourceLabel}…` },
      () => SecurityRemediationService.getInstance().fetchFindings()
    );
    new SastFindingsStore().mergeFromApi(provDef.source(), provDef.scopeKey(), findings);
    refreshView(provider, diagnostics, sourceLabel);
    notifyInfo(`Loaded ${findings.length} finding(s) from ${sourceLabel}.`);
  } catch (ex) {
    logError("SAST refresh failed", ex);
    notifyError("SAST Refresh Failed: " + (ex instanceof Error ? ex.message : String(ex)));
  }
}

/** The Fetch Jira Ticket command handler. */
async function fetchJiraTicket(): Promise<void> {
  const client = JiraApiClient.getInstance();
  if (!client.isConfigured()) {
    showError(
      "Jira Not Configured",
      "Set jira.baseUrl, jira.email, and jira.apiToken in BMO GenAI settings before fetching a ticket."
    );
    return;
  }
  const ticketKey = await vscode.window.showInputBox({
    title: "Fetch Jira Ticket",
    prompt: "Enter Jira ticket key (e.g. LIN-16991):",
    ignoreFocusOut: true,
    validateInput: (v) => (v && v.trim().length > 0 ? undefined : "Enter a ticket key."),
  });
  if (!ticketKey || ticketKey.trim().length === 0) return;
  const trimmedKey = ticketKey.trim();

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching Jira ticket ${trimmedKey}…` },
    () => client.fetchTicket(trimmedKey)
  );

  if (!fetchTicketSuccess(result) || result.body === null) {
    notifyError(result.message || `Could not fetch ${trimmedKey}.`);
    return;
  }

  // Pretty-print the raw JSON and show it in a new editor.
  let content = result.body;
  try {
    content = JSON.stringify(JSON.parse(result.body), null, 2);
  } catch {
    /* leave raw if not parseable */
  }
  const doc = await vscode.workspace.openTextDocument({ language: "json", content });
  await vscode.window.showTextDocument(doc, { preview: false });
  notifyInfo(`Jira ticket ${trimmedKey} fetched (${result.body.length} chars).`);
}

export function registerSecurity(context: vscode.ExtensionContext): void {
  const provider = new SastResultsProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection("devai-sast");
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("devai.sastResultsView", provider)
  );

  // Virtual document provider for proposed-fix diff previews.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, {
      provideTextDocumentContent(uri: vscode.Uri): string {
        return proposedContent.get(uri.toString()) ?? "";
      },
    })
  );

  // Render anything already persisted on activation.
  try {
    refreshView(provider, diagnostics, "");
  } catch (e) {
    log("SAST initial view load skipped: " + (e instanceof Error ? e.message : String(e)));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("devai.fixSastFindings", () =>
      fixSastFindings(provider, diagnostics)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.refreshSastResults", () =>
      refreshSastResults(provider, diagnostics)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("devai.fetchJiraTicket", () => fetchJiraTicket())
  );
}
