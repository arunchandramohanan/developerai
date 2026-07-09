import { httpRequest, basicAuthHeader } from "../../util/http";
import { settings } from "../../core/settings";
import { log } from "../../core/context";
import { SastFinding } from "../../models/security";

/**
 * Port of com.bmo.devai.intellij.services.SonarQubeClient.
 *
 * Read-only HTTP client for the SonarQube REST API. Reads issues already
 * published to a SonarQube server by CI; does not run scanners.
 * Authentication: HTTP Basic auth. Either a username/password pair, or a
 * SonarQube user token in the username field with an empty password.
 */
const TIMEOUT_MS = 15000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

function stripTrailingSlash(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length - 1) : trimmed;
}

function optString(o: Record<string, unknown>, field: string): string {
  const v = o[field];
  return v !== undefined && v !== null ? String(v) : "";
}

function optInt(o: Record<string, unknown>, field: string): number {
  const v = o[field];
  return typeof v === "number" ? v : 0;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const username = settings().getSonarQubeUsername();
  const password = settings().getSonarQubePassword();
  if (username && username.length > 0) {
    headers.Authorization = basicAuthHeader(username, password ?? "");
  }
  return headers;
}

export class SonarQubeClient {
  private static _instance: SonarQubeClient | undefined;

  static getInstance(): SonarQubeClient {
    if (!SonarQubeClient._instance) SonarQubeClient._instance = new SonarQubeClient();
    return SonarQubeClient._instance;
  }

  /**
   * Fetch all open VULNERABILITY issues AND security hotspots ("TO_REVIEW")
   * for a project. Vulnerabilities from /api/issues/search; hotspots from
   * /api/hotspots/search. Both are paged.
   */
  async fetchSecurityFindings(projectKey: string): Promise<SastFinding[]> {
    const baseUrl = settings().getSonarQubeUrl();
    if (baseUrl.trim().length === 0 || projectKey.trim().length === 0) {
      return [];
    }
    const all: SastFinding[] = [];
    all.push(...(await this.fetchVulnerabilities(baseUrl, projectKey)));
    all.push(...(await this.fetchHotspots(baseUrl, projectKey)));
    return all;
  }

  private async fetchVulnerabilities(baseUrl: string, projectKey: string): Promise<SastFinding[]> {
    const out: SastFinding[] = [];
    let page = 1;
    for (;;) {
      const path =
        "/api/issues/search" +
        "?componentKeys=" +
        encodeURIComponent(projectKey) +
        "&types=VULNERABILITY" +
        "&resolved=false" +
        "&ps=" +
        PAGE_SIZE +
        "&p=" +
        page;
      const resp = await httpRequest(stripTrailingSlash(baseUrl) + path, {
        method: "GET",
        headers: authHeaders(),
        timeoutMs: TIMEOUT_MS,
      });
      if (resp.status !== 200) {
        log(`SonarQube ${path} returned HTTP ${resp.status} body=${resp.body.slice(0, 300)}`);
        throw new Error("SonarQube returned HTTP " + resp.status);
      }
      const body = JSON.parse(resp.body) as { issues?: Record<string, unknown>[]; total?: number };
      const issues = body.issues ?? [];
      for (const issue of issues) {
        out.push(SonarQubeClient.toFinding(issue));
      }
      const total = typeof body.total === "number" ? body.total : out.length;
      if (out.length >= total || issues.length === 0) break;
      page++;
      if (page > MAX_PAGES) {
        log(`SonarQube issues pagination guard hit at ${MAX_PAGES} pages for ${projectKey}`);
        break;
      }
    }
    return out;
  }

  private async fetchHotspots(baseUrl: string, projectKey: string): Promise<SastFinding[]> {
    const out: SastFinding[] = [];
    let page = 1;
    for (;;) {
      const path =
        "/api/hotspots/search" +
        "?projectKey=" +
        encodeURIComponent(projectKey) +
        "&status=TO_REVIEW" +
        "&ps=" +
        PAGE_SIZE +
        "&p=" +
        page;
      const resp = await httpRequest(stripTrailingSlash(baseUrl) + path, {
        method: "GET",
        headers: authHeaders(),
        timeoutMs: TIMEOUT_MS,
      });
      if (resp.status !== 200) {
        log(`SonarQube ${path} returned HTTP ${resp.status} body=${resp.body.slice(0, 300)}`);
        throw new Error("SonarQube returned HTTP " + resp.status);
      }
      const body = JSON.parse(resp.body) as {
        hotspots?: Record<string, unknown>[];
        paging?: { total?: number };
      };
      const hotspots = body.hotspots ?? [];
      for (const h of hotspots) {
        out.push(SonarQubeClient.toHotspotFinding(h));
      }
      const total =
        body.paging && typeof body.paging.total === "number" ? body.paging.total : out.length;
      if (out.length >= total || hotspots.length === 0) break;
      page++;
      if (page > MAX_PAGES) {
        log(`SonarQube hotspots pagination guard hit at ${MAX_PAGES} pages for ${projectKey}`);
        break;
      }
    }
    return out;
  }

  /**
   * Maps a SonarQube hotspot JSON object onto SastFinding. Hotspots use
   * vulnerabilityProbability (HIGH/MEDIUM/LOW) instead of severity; map it to
   * the SonarQube severity vocabulary so fromSonarSeverity works downstream.
   */
  private static toHotspotFinding(h: Record<string, unknown>): SastFinding {
    const key = optString(h, "key");
    const component = optString(h, "component");
    const filePath = component.includes(":")
      ? component.substring(component.indexOf(":") + 1)
      : component;
    const line = optInt(h, "line");
    const rule = optString(h, "ruleKey");
    const prob = optString(h, "vulnerabilityProbability").toUpperCase();
    const severity =
      prob === "HIGH" ? "CRITICAL" : prob === "MEDIUM" ? "MAJOR" : prob === "LOW" ? "MINOR" : "MINOR";
    const message = optString(h, "message");
    const status = optString(h, "status");
    return {
      key,
      component,
      filePath,
      line,
      rule,
      severity,
      type: "SECURITY_HOTSPOT",
      message,
      status,
    };
  }

  private static toFinding(issue: Record<string, unknown>): SastFinding {
    const key = optString(issue, "key");
    const component = optString(issue, "component");
    // SonarQube components look like "projectKey:src/main/java/Foo.java"
    const filePath = component.includes(":")
      ? component.substring(component.indexOf(":") + 1)
      : component;
    const line = optInt(issue, "line");
    const rule = optString(issue, "rule");
    const severity = optString(issue, "severity");
    const type = optString(issue, "type");
    const message = optString(issue, "message");
    const status = optString(issue, "status");
    return { key, component, filePath, line, rule, severity, type, message, status };
  }
}
