import { SastFixProposal } from "../../models/security";
import { log } from "../../core/context";

/**
 * Port of com.bmo.devai.intellij.util.SastProposalParser.
 *
 * Parses the strict JSON-array response produced by sdk-sast-fix.md into a
 * list of SastFixProposals. Tolerant by design: extra Markdown fences or stray
 * prose around the JSON array are stripped before parsing.
 */

/** Extract the first balanced JSON array substring from text (fence-aware). */
function extractJsonArray(text: string): string | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return candidate.substring(start, i + 1);
    }
  }
  return null;
}

function getString(o: Record<string, unknown>, field: string, def: string): string {
  const v = o[field];
  return v !== undefined && v !== null ? String(v) : def;
}

function mapElement(obj: Record<string, unknown>): SastFixProposal | null {
  const key = getString(obj, "key", "");
  if (key.trim().length === 0) return null;
  const filePath = getString(obj, "filePath", "");
  const line = typeof obj.line === "number" ? (obj.line as number) : 0;
  const rationale = getString(obj, "rationale", "");
  const original = getString(obj, "originalSnippet", "");
  const replacement = getString(obj, "replacementSnippet", "");
  return {
    key,
    filePath,
    line,
    rationale,
    originalSnippet: original.length === 0 ? null : original,
    replacementSnippet: replacement.length === 0 ? null : replacement,
  };
}

export class SastProposalParser {
  static parse(rawResponse: string): SastFixProposal[] {
    const json = extractJsonArray(rawResponse);
    if (json === null) {
      log("SAST proposal parse: no JSON array found in response");
      return [];
    }
    try {
      const root = JSON.parse(json);
      if (!Array.isArray(root)) {
        log("SAST proposal parse: top-level value is not an array");
        return [];
      }
      const out: SastFixProposal[] = [];
      for (const el of root) {
        if (el && typeof el === "object" && !Array.isArray(el)) {
          const p = mapElement(el as Record<string, unknown>);
          if (p) out.push(p);
        }
      }
      return out;
    } catch (e) {
      log("SAST proposal parse failed: " + (e instanceof Error ? e.message : String(e)));
      return [];
    }
  }
}
