/**
 * Port of com.bmo.devai.intellij.util.JsonUtil (lenient JSON helpers).
 */

/** Extracts the first balanced JSON object or array substring from text. */
export function extractJson(text: string): string | null {
  if (!text) return null;
  // Prefer fenced ```json blocks
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = firstBraceOrBracket(candidate);
  if (start < 0) return null;
  const openChar = candidate[start];
  const closeChar = openChar === "{" ? "}" : "]";
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
    else if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return candidate.substring(start, i + 1);
    }
  }
  return null;
}

function firstBraceOrBracket(s: string): number {
  const b = s.indexOf("{");
  const a = s.indexOf("[");
  if (b < 0) return a;
  if (a < 0) return b;
  return Math.min(a, b);
}

export function parseJsonLenient<T = unknown>(text: string): T | null {
  const json = extractJson(text) ?? text;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
