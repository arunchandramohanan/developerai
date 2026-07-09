import { OperationType, newRequest } from "../../models";
import { executeForContent } from "../../core/copilotService";
import { PromptTemplateService } from "../../core/promptTemplateService";
import { settings } from "../../core/settings";
import { workspaceRoot, log } from "../../core/context";
import {
  RemediationOutcome,
  RemediationResult,
  RemediationStatus,
  SastFinding,
  SastFixProposal,
  proposalHasFix,
  remediationOutcomeOf,
} from "../../models/security";
import { SastFindingProvider, SastSourceFactory } from "./providers";
import { SastFindingsStore, StoreEntry } from "./sastFindingsStore";
import { SastProposalParser } from "./sastProposalParser";
import { SastResultMapper } from "./sastResultMapper";

/**
 * Port of com.bmo.devai.intellij.services.security.SecurityRemediationService
 * (+ impl and the SDK dispatch strategy).
 *
 * Pulls SAST findings from the configured upstream source and dispatches an AI
 * prompt that references the master findings JSON store. The core
 * `executeForContent` abstracts the SDK-vs-Chat transport, so — unlike the
 * IntelliJ original which forked into two dispatch code paths — this port
 * always renders the proposal-oriented prompt (sdk-sast-fix.md) and parses the
 * response into SastFixProposals so the feature layer can offer diff preview
 * and apply. See DEV_NOTES "Implementation guidance".
 */

/**
 * Chunk size for batching findings into one AI invocation. Kept small so a
 * bad chunk doesn't kill the whole run and to bound each request's size.
 */
const CHUNK_SIZE = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, Math.min(i + size, items.length)));
  }
  return out;
}

function indexByKey(proposals: SastFixProposal[]): Map<string, SastFixProposal> {
  const map = new Map<string, SastFixProposal>();
  for (const p of proposals) map.set(p.key, p);
  return map;
}

function buildResults(
  entries: StoreEntry[],
  proposalsByKey: Map<string, SastFixProposal>
): RemediationResult[] {
  return entries.map((e) => {
    const p = proposalsByKey.get(e.key);
    if (p && proposalHasFix(p)) {
      return SastResultMapper.result(e, RemediationStatus.PROPOSED, "Proposed - awaiting developer approval");
    }
    return SastResultMapper.result(e, RemediationStatus.FAILED, "Agent did not propose a fix");
  });
}

export class SecurityRemediationService {
  private static _instance: SecurityRemediationService | undefined;

  static getInstance(): SecurityRemediationService {
    if (!SecurityRemediationService._instance) {
      SecurityRemediationService._instance = new SecurityRemediationService();
    }
    return SecurityRemediationService._instance;
  }

  /** Fetch open VULNERABILITY + SECURITY_HOTSPOT findings from the active source. */
  async fetchFindings(): Promise<SastFinding[]> {
    const provider: SastFindingProvider = SastSourceFactory.resolve(settings());
    if (!provider.isConfigured(settings())) return [];
    return provider.fetch();
  }

  /**
   * Dispatch the AI remediation pipeline for the supplied entries. Returns one
   * RemediationResult per input entry plus any proposed fixes keyed by finding.
   */
  async triggerFixesOutcome(entries: StoreEntry[]): Promise<RemediationOutcome> {
    if (entries.length === 0) return remediationOutcomeOf([]);

    const chunks = chunk(entries, CHUNK_SIZE);
    log(`SAST dispatch: ${entries.length} finding(s) split into ${chunks.length} chunk(s) of up to ${CHUNK_SIZE}`);

    const proposalsByKey = new Map<string, SastFixProposal>();
    const results: RemediationResult[] = [];
    for (let i = 0; i < chunks.length; i++) {
      log(`SAST dispatch: chunk ${i + 1}/${chunks.length} — ${chunks[i].length} finding(s)`);
      const partial = await this.dispatchChunk(chunks[i]);
      for (const [k, v] of partial.proposals) proposalsByKey.set(k, v);
      results.push(...partial.results);
    }
    return { results, proposals: proposalsByKey };
  }

  private async dispatchChunk(entries: StoreEntry[]): Promise<RemediationOutcome> {
    const storeRelPath = SastFindingsStore.relativePath();
    const findingKeys = entries.map((e) => "- " + e.key).join("\n");
    const prompt = PromptTemplateService.loadAndRender("sdk-sast-fix.md", {
      storeFile: storeRelPath,
      findingCount: String(entries.length),
      findingKeys,
    });
    if (prompt.trim().length === 0) {
      return remediationOutcomeOf(
        SastResultMapper.allFailed(entries, "SAST prompt template not found on classpath")
      );
    }

    const ctx: Record<string, string> = {};
    const root = workspaceRoot();
    if (root) ctx.workingDirectory = root;

    let content: string;
    try {
      content = await executeForContent(newRequest(OperationType.FIX_SAST_FINDINGS, null, prompt, ctx));
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : String(ex);
      log("AI SAST execution failed: " + msg);
      return remediationOutcomeOf(SastResultMapper.allFailed(entries, msg));
    }

    const proposalsByKey = indexByKey(SastProposalParser.parse(content));
    return { results: buildResults(entries, proposalsByKey), proposals: proposalsByKey };
  }
}
