import { httpRequest, basicAuthHeader } from "../util/http";
import { settings } from "../core/settings";
import { log } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.jira.JiraTicketService / services.JiraApiClient
 * (fetch-ticket surface only).
 *
 * Fetches a Jira issue by key and returns the raw JSON response. Uses the Jira
 * Cloud REST API v3 with HTTP Basic auth (email:apiToken), per DEV_NOTES
 * guidance. (The IntelliJ original used v2 + Bearer for Jira Server; this port
 * targets Jira Cloud v3.)
 */
const TIMEOUT_MS = 15000;

function stripTrailingSlash(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length - 1) : trimmed;
}

export interface FetchTicketResult {
  body: string | null;
  message: string;
}

export function fetchTicketSuccess(r: FetchTicketResult): boolean {
  return r.body !== null;
}

export class JiraApiClient {
  private static _instance: JiraApiClient | undefined;

  static getInstance(): JiraApiClient {
    if (!JiraApiClient._instance) JiraApiClient._instance = new JiraApiClient();
    return JiraApiClient._instance;
  }

  isConfigured(): boolean {
    const s = settings();
    return (
      s.getJiraBaseUrl().trim().length > 0 &&
      s.getJiraEmail().trim().length > 0 &&
      s.getJiraApiToken().trim().length > 0
    );
  }

  private authHeader(): string {
    return basicAuthHeader(settings().getJiraEmail().trim(), settings().getJiraApiToken().trim());
  }

  /**
   * Fetch a Jira ticket and return its raw JSON body (or null on error).
   *
   * @param ticketKey e.g. "PROJ-123"
   */
  async fetchTicket(ticketKey: string): Promise<FetchTicketResult> {
    const baseUrl = stripTrailingSlash(settings().getJiraBaseUrl());
    if (baseUrl.length === 0) {
      return { body: null, message: "Jira base URL is not configured." };
    }
    if (settings().getJiraApiToken().trim().length === 0 || settings().getJiraEmail().trim().length === 0) {
      return { body: null, message: "Jira email or API token is not configured." };
    }

    const url = baseUrl + "/rest/api/3/issue/" + encodeURIComponent(ticketKey);
    try {
      log("Fetching Jira ticket: " + url);
      const resp = await httpRequest(url, {
        method: "GET",
        headers: { Authorization: this.authHeader(), Accept: "application/json" },
        timeoutMs: TIMEOUT_MS,
      });
      if (resp.status === 200) {
        log(`Jira ticket fetched: ${ticketKey} (${resp.body.length} chars)`);
        return { body: resp.body, message: "OK" };
      }
      return { body: null, message: buildFetchErrorMessage(ticketKey, resp.status) };
    } catch (e) {
      const message = "Failed to fetch Jira ticket " + ticketKey + ": " + (e instanceof Error ? e.message : String(e));
      log(message);
      return { body: null, message };
    }
  }
}

function buildFetchErrorMessage(ticketKey: string, statusCode: number): string {
  switch (statusCode) {
    case 401:
    case 403:
      return (
        "Jira authentication failed for " +
        ticketKey +
        " (HTTP " +
        statusCode +
        "). Check the Jira URL, email, and API token in settings."
      );
    case 404:
      return "Jira ticket " + ticketKey + " was not found (HTTP 404).";
    default:
      return "Jira API returned HTTP " + statusCode + " for " + ticketKey + ".";
  }
}
