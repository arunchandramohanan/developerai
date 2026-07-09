/**
 * Port of com.bmo.devai.intellij.models.security.*
 *
 * Source-agnostic SAST domain model shared by the SonarQube and GitHub Code
 * Scanning providers, the findings store, the remediation service and the UI.
 */

/**
 * The SAST data source a workspace is configured to pull findings from.
 * Mutually exclusive per workspace (see settings().getSastSource()).
 */
export enum Source {
  SONARQUBE = "SONARQUBE",
  GITHUB = "GITHUB",
}

/**
 * Normalized severity buckets for security findings. Maps SonarQube's
 * BLOCKER/CRITICAL/MAJOR/MINOR/INFO model into the Critical/High/Medium/Low
 * scheme used in the plugin UI.
 */
export enum SecuritySeverity {
  CRITICAL = "CRITICAL",
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
}

/** Maps a SonarQube severity string to the normalized enum. Unknown -> LOW. */
export function fromSonarSeverity(sonarSeverity: string | null | undefined): SecuritySeverity {
  if (!sonarSeverity) return SecuritySeverity.LOW;
  switch (sonarSeverity.toUpperCase()) {
    case "BLOCKER":
    case "CRITICAL":
      return SecuritySeverity.CRITICAL;
    case "MAJOR":
      return SecuritySeverity.HIGH;
    case "MINOR":
      return SecuritySeverity.MEDIUM;
    case "INFO":
      return SecuritySeverity.LOW;
    default:
      return SecuritySeverity.LOW;
  }
}

/**
 * Maps a GitHub Code Scanning alert severity to the normalized enum.
 * Prefers securitySeverityLevel (critical/high/medium/low) when present,
 * falling back to the analysis-level severity (error/warning/note).
 */
export function fromGitHubAlert(
  securitySeverityLevel: string | null | undefined,
  severity: string | null | undefined
): SecuritySeverity {
  if (securitySeverityLevel && securitySeverityLevel.trim().length > 0) {
    switch (securitySeverityLevel.toLowerCase()) {
      case "critical":
        return SecuritySeverity.CRITICAL;
      case "high":
        return SecuritySeverity.HIGH;
      case "medium":
        return SecuritySeverity.MEDIUM;
      case "low":
        return SecuritySeverity.LOW;
      default:
        return SecuritySeverity.LOW;
    }
  }
  if (!severity) return SecuritySeverity.LOW;
  switch (severity.toLowerCase()) {
    case "error":
      return SecuritySeverity.HIGH;
    case "warning":
      return SecuritySeverity.MEDIUM;
    case "note":
      return SecuritySeverity.LOW;
    default:
      return SecuritySeverity.LOW;
  }
}

/**
 * Source-agnostic parser. Accepts already-normalized enum names directly,
 * falling back to the SonarQube vocabulary. Unknown/blank -> LOW.
 */
export function parseSeverity(raw: string | null | undefined): SecuritySeverity {
  if (!raw || raw.trim().length === 0) return SecuritySeverity.LOW;
  const upper = raw.trim().toUpperCase();
  if ((Object.values(SecuritySeverity) as string[]).includes(upper)) {
    return upper as SecuritySeverity;
  }
  return fromSonarSeverity(upper);
}

/**
 * Source-agnostic projection of a single SAST finding fetched from any
 * upstream system. The `key` is namespaced by source ("sonar:" / "gh:") so
 * identifiers stay unique across providers in the shared store.
 */
export interface SastFinding {
  key: string;
  component: string | null;
  filePath: string;
  line: number;
  rule: string;
  severity: string;
  type: string;
  message: string;
  status: string | null;
}

/**
 * A single fix proposed by the AI for one SAST finding. Proposals are
 * read-only suggestions; they become applied changes only after a developer
 * approves them in the review flow.
 */
export interface SastFixProposal {
  key: string;
  filePath: string;
  line: number;
  rationale: string;
  originalSnippet: string | null;
  replacementSnippet: string | null;
}

/** True when the proposal carries a non-empty before/after pair. */
export function proposalHasFix(p: SastFixProposal): boolean {
  return (
    p.originalSnippet !== null &&
    p.originalSnippet.trim().length > 0 &&
    p.replacementSnippet !== null
  );
}

/** Outcome of attempting to remediate a single SAST finding. */
export enum RemediationStatus {
  /** Fix prompt was successfully sent / changes applied to disk. */
  PROCESSED = "PROCESSED",
  /** Finding known to the store but not yet dispatched. */
  UNPROCESSED = "UNPROCESSED",
  /** Agentic CLI returned a proposed fix awaiting developer approval. */
  PROPOSED = "PROPOSED",
  /** An error occurred while preparing or sending the prompt. */
  FAILED = "FAILED",
}

export interface RemediationResult {
  finding: SastFinding;
  severity: SecuritySeverity;
  status: RemediationStatus;
  message: string;
}

/**
 * Outcome of a triggerFixes call: per-finding results plus an optional map of
 * proposals keyed by finding key.
 */
export interface RemediationOutcome {
  results: RemediationResult[];
  proposals: Map<string, SastFixProposal>;
}

export function remediationOutcomeOf(results: RemediationResult[]): RemediationOutcome {
  return { results, proposals: new Map() };
}
