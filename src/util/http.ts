import * as http from "http";
import * as https from "https";
import { URL } from "url";

export interface HttpResponse {
  status: number;
  body: string;
  ok: boolean;
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Minimal promise-based HTTP client (no external deps), mirroring the role of
 * HttpClientUtil / InstrumentedHttpClient in the IntelliJ plugin.
 */
export function httpRequest(urlStr: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: opts.headers,
        timeout: opts.timeoutMs ?? 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({ status, body: data, ok: status >= 200 && status < 300 });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export async function getJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await httpRequest(url, { method: "GET", headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.body.slice(0, 300)}`);
  return JSON.parse(res.body) as T;
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const res = await httpRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.body.slice(0, 300)}`);
  return (res.body ? JSON.parse(res.body) : {}) as T;
}

export function basicAuthHeader(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}
