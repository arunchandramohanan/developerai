import * as http from "http";
import * as https from "https";
import { URL } from "url";
import * as path from "path";
import { writeTextFile } from "../util/files";
import { settings } from "../core/settings";
import { log, logError } from "../core/context";
import { extractManifestDependencies } from "./manifestDependencyExtractor";

/**
 * Port of com.bmo.devai.intellij.services.SonatypeApiClient.
 *
 * HTTP client for the Sonatype IQ Server API. Fetches dependency/vulnerability
 * reports for known application public IDs by chaining three API calls:
 *   1. resolve the internal application ID from the public ID
 *   2. find the latest scan ID for the requested stage
 *   3. download the full report JSON
 * Reports are saved as JSON files under {@code <projectDir>/sonatype-reports/}.
 *
 * Like the Java client, TLS certificate validation is relaxed to tolerate
 * corporate internal CAs.
 */

const TIMEOUT_MS = 30000;

/** The two known Sonatype application public IDs to scan. */
export const APPLICATION_PUBLIC_IDS = ["Client_Portal", "AMS_Platform"];

export class SonatypeApiClient {
  private static _instance: SonatypeApiClient | undefined;

  static getInstance(): SonatypeApiClient {
    if (!SonatypeApiClient._instance) SonatypeApiClient._instance = new SonatypeApiClient();
    return SonatypeApiClient._instance;
  }

  /**
   * Fetches Sonatype IQ reports for all known applications, filters each report
   * to retain only components matching this project's declared dependencies, and
   * writes the filtered JSON to {@code <projectDir>/sonatype-reports/<publicId>-report.json}.
   *
   * @returns list of absolute paths to the saved report files (may be empty)
   */
  async fetchReports(projectBasePath: string, stage: string): Promise<string[]> {
    const projectDeps = extractManifestDependencies(projectBasePath);
    log(`Sonatype: project dependencies for filtering: ${projectDeps.size}`);

    const savedPaths: string[] = [];
    for (const publicId of APPLICATION_PUBLIC_IDS) {
      try {
        let reportJson = await this.fetchReportForApp(publicId, stage);
        if (reportJson != null) {
          if (projectDeps.size > 0) {
            reportJson = this.filterReport(reportJson, projectDeps);
          }
          const reportFile = path.join(projectBasePath, "sonatype-reports", `${publicId}-report.json`);
          writeTextFile(reportFile, reportJson);
          savedPaths.push(reportFile);
          log(`Sonatype: saved report for ${publicId} → ${reportFile}`);
        }
      } catch (e) {
        logError(`Sonatype: failed to fetch report for ${publicId}`, e);
      }
    }
    return savedPaths;
  }

  /** Fetches the full report JSON for a single application, or null on failure. */
  async fetchReportForApp(publicId: string, stage: string): Promise<string | null> {
    const internalId = await this.resolveInternalAppId(publicId);
    if (internalId == null) {
      log(`Sonatype: could not resolve internal ID for publicId ${publicId}`);
      return null;
    }
    const scanId = await this.resolveScanId(internalId, stage);
    if (scanId == null) {
      log(`Sonatype: could not resolve scanId for app ${publicId} stage ${stage}`);
      return null;
    }
    return this.downloadReport(publicId, scanId);
  }

  /** GET /api/v2/applications?publicId={publicId} */
  async resolveInternalAppId(publicId: string): Promise<string | null> {
    const body = await this.get(`/api/v2/applications?publicId=${publicId}`);
    if (body == null) return null;
    try {
      const root = JSON.parse(body) as { applications?: Array<{ id?: string }> };
      const apps = root.applications;
      if (apps && apps.length > 0 && apps[0].id) return apps[0].id;
    } catch (e) {
      logError(`Sonatype: failed to parse internal app ID for ${publicId}`, e);
    }
    return null;
  }

  /** GET /api/v2/reports/applications/{internalId} — finds the scan for the stage. */
  async resolveScanId(internalId: string, stage: string): Promise<string | null> {
    const body = await this.get(`/api/v2/reports/applications/${internalId}`);
    if (body == null) return null;
    try {
      const reports = JSON.parse(body) as Array<{ stage?: string; reportHtmlUrl?: string }>;
      for (const report of reports) {
        const reportStage = report.stage ?? "";
        if (stage.toLowerCase() === reportStage.toLowerCase() && report.reportHtmlUrl) {
          const htmlUrl = report.reportHtmlUrl;
          const lastSlash = htmlUrl.lastIndexOf("/");
          if (lastSlash >= 0 && lastSlash < htmlUrl.length - 1) {
            return htmlUrl.substring(lastSlash + 1);
          }
        }
      }
    } catch (e) {
      logError(`Sonatype: failed to parse scan ID for internalId ${internalId}`, e);
    }
    return null;
  }

  /** GET /api/v2/applications/{publicId}/reports/{scanId}/policy */
  async downloadReport(publicId: string, scanId: string): Promise<string | null> {
    return this.get(`/api/v2/applications/${publicId}/reports/${scanId}/policy`);
  }

  /**
   * Filters a Sonatype IQ policy report JSON to retain only components matching
   * any project dependency identifier. Components with policy violations are
   * always kept (they may be transitive dependencies with real security risks).
   */
  filterReport(reportJson: string, projectDeps: Set<string>): string {
    try {
      const root = JSON.parse(reportJson) as { components?: unknown };
      if (!Array.isArray(root.components)) return reportJson;

      const components = root.components as Array<Record<string, unknown>>;
      const filtered: Array<Record<string, unknown>> = [];
      let removed = 0;

      for (const comp of components) {
        if (typeof comp !== "object" || comp == null) {
          filtered.push(comp);
          continue;
        }
        const identifier = extractComponentIdentifier(comp);
        if (identifier == null || projectDeps.has(identifier) || hasViolations(comp)) {
          filtered.push(comp);
        } else {
          removed++;
        }
      }

      (root as Record<string, unknown>).components = filtered;
      log(`Sonatype: filtered report — kept ${filtered.length}, removed ${removed}`);
      return JSON.stringify(root);
    } catch (e) {
      logError("Sonatype: failed to filter report, returning unfiltered", e);
      return reportJson;
    }
  }

  private get(apiPath: string): Promise<string | null> {
    const baseUrl = getBaseUrl();
    if (baseUrl === "") {
      log("Sonatype: server URL not configured");
      return Promise.resolve(null);
    }
    return sonatypeGet(baseUrl + apiPath);
  }
}

function extractComponentIdentifier(component: Record<string, unknown>): string | null {
  const cid = component["componentIdentifier"];
  if (typeof cid !== "object" || cid == null) return null;
  const cidObj = cid as Record<string, unknown>;
  const format = typeof cidObj["format"] === "string" ? (cidObj["format"] as string).toLowerCase() : "";
  const coords = cidObj["coordinates"];
  if (typeof coords !== "object" || coords == null) return null;
  const c = coords as Record<string, unknown>;

  switch (format) {
    case "maven": {
      const groupId = getStr(c, "groupId");
      const artifactId = getStr(c, "artifactId");
      return groupId != null && artifactId != null ? (groupId + ":" + artifactId).toLowerCase() : null;
    }
    case "npm": {
      const name = getStr(c, "packageId");
      return name != null ? name.toLowerCase() : null;
    }
    case "pypi": {
      const name = getStr(c, "name");
      return name != null ? name.toLowerCase() : null;
    }
    default:
      return null; // unknown format — keep the component
  }
}

function getStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function hasViolations(component: Record<string, unknown>): boolean {
  const v = component["violations"];
  return Array.isArray(v) && v.length > 0;
}

function getBaseUrl(): string {
  let url = settings().getSonatypeServerUrl();
  while (url.endsWith("/")) url = url.substring(0, url.length - 1);
  return url;
}

function buildBasicAuthHeader(): string | null {
  const username = settings().getSonatypeUsername();
  const password = settings().getSonatypePassword();
  if (username === "" || password === "") return null;
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

/** GET helper with relaxed TLS validation, mirroring the Java trust-all client. */
function sonatypeGet(urlStr: string): Promise<string | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch (e) {
      logError("Sonatype: invalid URL " + urlStr, e);
      resolve(null);
      return;
    }
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const headers: Record<string, string> = {};
    const auth = buildBasicAuthHeader();
    if (auth != null) headers["Authorization"] = auth;
    else log("Sonatype: credentials not configured — request will be unauthenticated");

    log(`Sonatype GET ${urlStr}`);
    const req = lib.request(
      url,
      {
        method: "GET",
        headers,
        timeout: TIMEOUT_MS,
        // Corporate environments often use internal CAs Node does not trust.
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve(data);
          } else {
            log(`Sonatype GET ${url.pathname} returned HTTP ${status}: ${data.slice(0, 200)}`);
            resolve(null);
          }
        });
      }
    );
    req.on("error", (e) => {
      logError(`Sonatype GET ${url.pathname} failed`, e);
      resolve(null);
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.end();
  });
}
