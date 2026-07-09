import { DevAISettings, settings } from "../../core/settings";
import { SastFinding, Source, SecuritySeverity, fromGitHubAlert } from "../../models/security";
import { SonarQubeClient } from "./sonarQubeClient";
import { GitHubCodeScanningClient } from "./githubCodeScanningClient";

/**
 * Port of com.bmo.devai.intellij.services.security.SastFindingProvider and its
 * SonarQube / GitHub implementations, plus SastSourceFactory.
 *
 * A provider is a source-agnostic adapter that fetches SAST findings from one
 * specific upstream system. Providers emit source-namespaced keys
 * ("sonar:..." / "gh:...") so identifiers don't collide across sources in the
 * shared store.
 */
export interface SastFindingProvider {
  /** Fetch all currently-open findings from the upstream source. */
  fetch(): Promise<SastFinding[]>;
  /** Human-readable label for this source instance, used in UI headers. */
  displayName(): string;
  /** Stable identifier for the upstream scope this provider is configured against. */
  scopeKey(): string;
  /** The Source this provider speaks to. */
  source(): Source;
  /** Whether the supplied settings contain everything the provider needs. */
  isConfigured(s: DevAISettings): boolean;
}

/** Namespace prefix for SonarQube finding keys in the shared store. */
export const SONAR_KEY_PREFIX = "sonar:";
/** Namespace prefix for GitHub Code Scanning finding keys in the shared store. */
export const GITHUB_KEY_PREFIX = "gh:";

export class SonarQubeFindingProvider implements SastFindingProvider {
  constructor(private readonly s: DevAISettings) {}

  async fetch(): Promise<SastFinding[]> {
    const projectKey = this.s.getSonarQubeProjectKey();
    if (projectKey.trim().length === 0) return [];
    const client = SonarQubeClient.getInstance();
    const findings = await client.fetchSecurityFindings(projectKey);
    return findings.map(SonarQubeFindingProvider.namespaceKey);
  }

  private static namespaceKey(f: SastFinding): SastFinding {
    if (f.key && f.key.startsWith(SONAR_KEY_PREFIX)) return f;
    return { ...f, key: SONAR_KEY_PREFIX + f.key };
  }

  displayName(): string {
    return "SonarQube";
  }

  scopeKey(): string {
    return this.s.getSonarQubeProjectKey();
  }

  source(): Source {
    return Source.SONARQUBE;
  }

  isConfigured(s: DevAISettings): boolean {
    return s.getSonarQubeUrl().trim().length > 0 && s.getSonarQubeProjectKey().trim().length > 0;
  }
}

/** CodeQL doesn't separate vulnerability from hotspot, so collapse to one type. */
const GITHUB_FINDING_TYPE = "VULNERABILITY";

export class GitHubCodeScanningFindingProvider implements SastFindingProvider {
  constructor(private readonly s: DevAISettings) {}

  async fetch(): Promise<SastFinding[]> {
    const owner = this.s.getGithubOwner();
    const repo = this.s.getGithubRepo();
    if (owner.trim().length === 0 || repo.trim().length === 0) return [];
    const client = GitHubCodeScanningClient.getInstance();
    const alerts = await client.fetchOpenAlerts(
      this.s.getGithubBaseUrl(),
      owner,
      repo,
      this.s.getGithubRef(),
      this.s.getGithubToken()
    );
    const stripPrefix = this.s.getGithubPathStripPrefix();
    const addPrefix = this.s.getGithubPathAddPrefix();
    const out: SastFinding[] = [];
    for (const alert of alerts) {
      const f = GitHubCodeScanningFindingProvider.toFinding(alert, owner, repo, stripPrefix, addPrefix);
      if (f) out.push(f);
    }
    return out;
  }

  displayName(): string {
    const ref = this.s.getGithubRef();
    return (
      "GitHub Code Scanning · " +
      this.s.getGithubOwner() +
      "/" +
      this.s.getGithubRepo() +
      (ref.trim().length === 0 ? "" : "@" + ref)
    );
  }

  scopeKey(): string {
    const ref = this.s.getGithubRef();
    return (
      this.s.getGithubOwner() +
      "/" +
      this.s.getGithubRepo() +
      (ref.trim().length === 0 ? "" : "@" + ref)
    );
  }

  source(): Source {
    return Source.GITHUB;
  }

  isConfigured(s: DevAISettings): boolean {
    return (
      s.getGithubBaseUrl().trim().length > 0 &&
      s.getGithubOwner().trim().length > 0 &&
      s.getGithubRepo().trim().length > 0 &&
      s.getGithubToken().trim().length > 0
    );
  }

  /** Map one Code Scanning alert JSON object onto a SastFinding. */
  private static toFinding(
    alert: Record<string, unknown>,
    owner: string,
    repo: string,
    stripPrefix: string,
    addPrefix: string
  ): SastFinding | null {
    const number = typeof alert.number === "number" ? alert.number : 0;
    if (number <= 0) return null;
    const key = GITHUB_KEY_PREFIX + owner + "/" + repo + "#" + number;
    const status = optString(alert, "state");

    const rule = optObject(alert, "rule");
    const ruleId = rule ? optString(rule, "id") : "";
    const ruleSeverity = rule ? optString(rule, "severity") : "";
    const securitySeverityLevel = rule ? optString(rule, "security_severity_level") : "";
    const severity: SecuritySeverity = fromGitHubAlert(securitySeverityLevel, ruleSeverity);

    const mri = optObject(alert, "most_recent_instance");
    let message = "";
    let filePath = "";
    let line = 0;
    if (mri) {
      const msg = optObject(mri, "message");
      if (msg) message = optString(msg, "text");
      const loc = optObject(mri, "location");
      if (loc) {
        filePath = GitHubCodeScanningFindingProvider.applyPathMapping(
          optString(loc, "path"),
          stripPrefix,
          addPrefix
        );
        line = typeof loc.start_line === "number" ? loc.start_line : 0;
      }
    }

    // component is SonarQube-specific; reuse it for the html_url so the UI's
    // "open in browser" affordance works without a model change.
    const htmlUrl = optString(alert, "html_url");

    return {
      key,
      component: htmlUrl,
      filePath,
      line,
      rule: ruleId,
      severity: severity,
      type: GITHUB_FINDING_TYPE,
      message,
      status,
    };
  }

  /**
   * Strip stripPrefix from the start of path (if present), then prepend
   * addPrefix. Both prefixes are optional.
   */
  static applyPathMapping(path: string | null, stripPrefix: string, addPrefix: string): string {
    if (path === null || path === undefined) return "";
    let p = path;
    if (stripPrefix && stripPrefix.length > 0 && p.startsWith(stripPrefix)) {
      p = p.substring(stripPrefix.length);
      if (p.startsWith("/")) p = p.substring(1);
    }
    if (addPrefix && addPrefix.length > 0) {
      const prefix = addPrefix.endsWith("/") ? addPrefix : addPrefix + "/";
      p = prefix + p;
    }
    return p;
  }
}

function optString(o: Record<string, unknown>, field: string): string {
  const v = o[field];
  return v !== undefined && v !== null ? String(v) : "";
}

function optObject(o: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const v = o[field];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseSource(raw: string | null | undefined): Source {
  if (!raw || raw.trim().length === 0) return Source.SONARQUBE;
  const upper = raw.trim().toUpperCase();
  return upper === Source.GITHUB ? Source.GITHUB : Source.SONARQUBE;
}

/**
 * Resolves the active SastFindingProvider for the current workspace based on
 * settings().getSastSource(). Defaults to SonarQube when absent/unrecognised.
 */
export class SastSourceFactory {
  static resolve(s: DevAISettings): SastFindingProvider {
    const source = parseSource(s.getSastSource());
    return source === Source.GITHUB
      ? new GitHubCodeScanningFindingProvider(s)
      : new SonarQubeFindingProvider(s);
  }
}

/** Convenience helper used by the feature layer. */
export function resolveProvider(): SastFindingProvider {
  return SastSourceFactory.resolve(settings());
}
