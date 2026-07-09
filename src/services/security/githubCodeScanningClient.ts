import { httpRequest } from "../../util/http";
import { log } from "../../core/context";

/**
 * Port of com.bmo.devai.intellij.services.GitHubCodeScanningClient.
 *
 * Read-only HTTP client for the GitHub Code Scanning REST API. Reads CodeQL
 * (and other tool) alerts already published to GitHub by CI; does not run
 * scanners. Authentication: Bearer token (PAT or fine-grained token).
 *
 * Deviation from the IntelliJ original: the core `http` util does not surface
 * response headers, so pagination uses the `page` query parameter (GitHub
 * supports it) rather than following the RFC 5988 Link header. We stop when a
 * short/empty page is returned or the MAX_PAGES guard trips.
 */
const TIMEOUT_MS = 15000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const GITHUB_API_VERSION = "2022-11-28";

function stripTrailingSlash(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length - 1) : trimmed;
}

function parseErrorMessage(body: string): string {
  if (!body || body.trim().length === 0) return "";
  try {
    const el = JSON.parse(body);
    if (el && typeof el === "object" && typeof el.message === "string") {
      return el.message;
    }
  } catch {
    /* not JSON */
  }
  return "";
}

export class GitHubCodeScanningClient {
  private static _instance: GitHubCodeScanningClient | undefined;

  static getInstance(): GitHubCodeScanningClient {
    if (!GitHubCodeScanningClient._instance) {
      GitHubCodeScanningClient._instance = new GitHubCodeScanningClient();
    }
    return GitHubCodeScanningClient._instance;
  }

  /**
   * Fetch all open Code Scanning alerts for the given repo. Returns the raw
   * alert JSON objects (caller maps to SastFinding).
   */
  async fetchOpenAlerts(
    baseUrl: string,
    owner: string,
    repo: string,
    ref: string | null,
    token: string
  ): Promise<Record<string, unknown>[]> {
    if (
      baseUrl.trim().length === 0 ||
      owner.trim().length === 0 ||
      repo.trim().length === 0 ||
      token.trim().length === 0
    ) {
      return [];
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      Authorization: "Bearer " + token,
    };

    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        stripTrailingSlash(baseUrl) +
        "/repos/" +
        encodeURIComponent(owner) +
        "/" +
        encodeURIComponent(repo) +
        "/code-scanning/alerts" +
        "?state=open&per_page=" +
        PAGE_SIZE +
        "&page=" +
        page +
        (ref && ref.trim().length > 0 ? "&ref=" + encodeURIComponent(ref) : "");
      const resp = await httpRequest(url, { method: "GET", headers, timeoutMs: TIMEOUT_MS });
      if (resp.status !== 200) {
        const msg = parseErrorMessage(resp.body);
        log(`GitHub Code Scanning GET ${url} returned HTTP ${resp.status} body=${resp.body.slice(0, 300)}`);
        throw new Error(
          "GitHub Code Scanning returned HTTP " + resp.status + (msg ? ": " + msg : "")
        );
      }
      const parsed = JSON.parse(resp.body);
      if (!Array.isArray(parsed)) break;
      for (const el of parsed) {
        if (el && typeof el === "object") out.push(el as Record<string, unknown>);
      }
      if (parsed.length < PAGE_SIZE) break;
    }
    return out;
  }
}
