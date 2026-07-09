import * as path from "path";
import { workspaceRoot, log } from "../../core/context";
import { readTextFile, writeTextFile, fileExists } from "../../util/files";
import { SastFinding, Source, SecuritySeverity, parseSeverity } from "../../models/security";
import { SONAR_KEY_PREFIX } from "./providers";

/**
 * Port of com.bmo.devai.intellij.services.security.SastFindingsStore.
 *
 * Persistent JSON-backed store for SAST findings + their dispatch status.
 * One file per workspace at .devai/sast-findings.json. Merges are scoped per
 * (source, scopeKey) so refreshing one source's findings never prunes another.
 */
const REL_PATH = ".devai/sast-findings.json";

export enum StoreStatus {
  UNPROCESSED = "UNPROCESSED",
  PROCESSED = "PROCESSED",
}

/** One row in the store. */
export interface StoreEntry {
  key: string;
  severity: SecuritySeverity;
  type: string;
  filePath: string;
  line: number;
  rule: string;
  message: string;
  status: StoreStatus;
  source: Source;
  scopeKey: string;
}

export function entryWithStatus(e: StoreEntry, newStatus: StoreStatus): StoreEntry {
  return { ...e, status: newStatus };
}

export function entryFromFinding(
  f: SastFinding,
  source: Source,
  scopeKey: string | null,
  status: StoreStatus
): StoreEntry {
  return {
    key: f.key,
    severity: parseSeverity(f.severity),
    type: f.type === null || f.type === undefined ? "VULNERABILITY" : f.type,
    filePath: f.filePath,
    line: f.line,
    rule: f.rule,
    message: f.message,
    status,
    source,
    scopeKey: scopeKey === null || scopeKey === undefined ? "" : scopeKey,
  };
}

function optJsonString(o: Record<string, unknown>, field: string): string {
  const v = o[field];
  return v !== undefined && v !== null ? String(v) : "";
}

/** Tolerant status parser — maps legacy PENDING/SENT values to the new names. */
function parseStatus(raw: string | null | undefined): StoreStatus {
  if (!raw) return StoreStatus.UNPROCESSED;
  switch (raw) {
    case "PROCESSED":
    case "SENT":
      return StoreStatus.PROCESSED;
    default:
      return StoreStatus.UNPROCESSED;
  }
}

/** Tolerant source parser — defaults to SONARQUBE for legacy entries. */
function parseSource(raw: string | null | undefined): Source {
  if (!raw || raw.trim().length === 0) return Source.SONARQUBE;
  return raw.trim().toUpperCase() === Source.GITHUB ? Source.GITHUB : Source.SONARQUBE;
}

/** Pre-namespacing legacy SonarQube keys get the "sonar:" prefix on read. */
function migrateLegacyKey(raw: string | null | undefined, source: Source): string {
  if (!raw) return "";
  if (raw.includes(":")) return raw;
  if (source === Source.SONARQUBE) return SONAR_KEY_PREFIX + raw;
  return raw;
}

function matchesScope(e: StoreEntry, source: Source, scopeKey: string): boolean {
  return e.source === source && e.scopeKey === scopeKey;
}

export class SastFindingsStore {
  private resolvePath(): string | null {
    const base = workspaceRoot();
    if (!base) return null;
    return path.join(base, REL_PATH);
  }

  /** Load the full store. Returns an empty map if the file is missing/unreadable. */
  load(): Map<string, StoreEntry> {
    const p = this.resolvePath();
    const out = new Map<string, StoreEntry>();
    if (!p || !fileExists(p)) return out;
    try {
      const text = readTextFile(p);
      if (text === null) return out;
      const root = JSON.parse(text) as { findings?: Record<string, unknown>[] };
      const arr = Array.isArray(root.findings) ? root.findings : [];
      for (const o of arr) {
        const source = parseSource(optJsonString(o, "source"));
        const key = migrateLegacyKey(optJsonString(o, "key"), source);
        const entry: StoreEntry = {
          key,
          severity: parseSeverity(optJsonString(o, "severity")),
          type: optJsonString(o, "type"),
          filePath: optJsonString(o, "filePath"),
          line: typeof o.line === "number" ? (o.line as number) : 0,
          rule: optJsonString(o, "rule"),
          message: optJsonString(o, "message"),
          status: parseStatus(optJsonString(o, "status")),
          source,
          scopeKey: optJsonString(o, "scopeKey"),
        };
        out.set(entry.key, entry);
      }
      return out;
    } catch (e) {
      log("Could not read SAST findings store: " + (e instanceof Error ? e.message : String(e)));
      return new Map();
    }
  }

  /**
   * Merge a fresh API result into the store, scoped to (source, scopeKey).
   * Entries belonging to other sources/scopes are preserved untouched. Within
   * the matching scope PROCESSED status survives, new findings arrive as
   * UNPROCESSED, and findings the API no longer reports are dropped.
   */
  mergeFromApi(source: Source, scopeKey: string, apiFindings: SastFinding[]): Map<string, StoreEntry> {
    const existing = this.load();
    const merged = new Map<string, StoreEntry>();

    // 1. Preserve every entry that doesn't belong to this (source, scope) bucket.
    for (const e of existing.values()) {
      if (!matchesScope(e, source, scopeKey)) merged.set(e.key, e);
    }

    // 2. Replay the fresh API result for this bucket.
    for (const f of apiFindings) {
      const prior = existing.get(f.key);
      const status =
        prior && matchesScope(prior, source, scopeKey) && prior.status === StoreStatus.PROCESSED
          ? StoreStatus.PROCESSED
          : StoreStatus.UNPROCESSED;
      merged.set(f.key, entryFromFinding(f, source, scopeKey, status));
    }

    this.write(merged.values());
    return merged;
  }

  /** Flip the given keys to PROCESSED and persist. No-op if keys is empty. */
  markProcessed(keys: Iterable<string>): void {
    const set = new Set(keys);
    if (set.size === 0) return;
    const current = this.load();
    let changed = false;
    for (const k of set) {
      const e = current.get(k);
      if (e && e.status !== StoreStatus.PROCESSED) {
        current.set(k, entryWithStatus(e, StoreStatus.PROCESSED));
        changed = true;
      }
    }
    if (changed) this.write(current.values());
  }

  private write(entries: Iterable<StoreEntry>): void {
    const p = this.resolvePath();
    if (!p) return;
    try {
      const findings = [];
      for (const e of entries) {
        findings.push({
          key: e.key,
          source: e.source,
          scopeKey: e.scopeKey,
          severity: e.severity,
          type: e.type,
          filePath: e.filePath,
          line: e.line,
          rule: e.rule,
          message: e.message,
          status: e.status,
        });
      }
      const root = { generated: new Date().toISOString(), findings };
      writeTextFile(p, JSON.stringify(root, null, 2));
    } catch (e) {
      log("Failed to write SAST findings store: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Where the master JSON lives (for #file: references), relative to the workspace root. */
  static relativePath(): string {
    return REL_PATH;
  }
}
