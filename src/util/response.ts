import * as fs from "fs";
import * as path from "path";

/**
 * Port of com.bmo.devai.intellij.util.ResponseUtil.
 * Helpers for cleaning AI responses and resolving output file paths.
 */

/** Strips a single leading/trailing markdown code fence and trims. */
export function stripCodeFences(response: string): string {
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    const nl = cleaned.indexOf("\n");
    if (nl >= 0) cleaned = cleaned.substring(nl + 1);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

/**
 * Extracts the contents of the first fenced code block. If no fence is
 * present, returns the trimmed input unchanged.
 */
export function extractFirstCodeBlock(content: string): string {
  const cleaned = content.trim();
  const fenceStart = cleaned.indexOf("```");
  if (fenceStart < 0) return cleaned;
  const afterOpen = cleaned.indexOf("\n", fenceStart);
  if (afterOpen < 0) return cleaned;
  const fenceEnd = cleaned.indexOf("```", afterOpen + 1);
  return (fenceEnd > 0
    ? cleaned.substring(afterOpen + 1, fenceEnd)
    : cleaned.substring(afterOpen + 1)
  ).trim();
}

export function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolves an available markdown path with numbered suffixes: if base.md
 * exists, returns base(1).md, base(2).md, etc.
 */
export function resolveAvailableMarkdownPath(outputDir: string, baseOutputName: string): string {
  const basePath = path.join(outputDir, `${baseOutputName}.md`);
  if (!fs.existsSync(basePath)) return basePath;
  let maxIndex = 0;
  try {
    const prefix = `${baseOutputName}(`;
    const suffix = ").md";
    for (const name of fs.readdirSync(outputDir)) {
      if (name.startsWith(prefix) && name.endsWith(suffix)) {
        const idxStr = name.substring(prefix.length, name.length - suffix.length);
        const n = parseInt(idxStr, 10);
        if (!isNaN(n) && n > maxIndex) maxIndex = n;
      }
    }
  } catch {
    return path.join(outputDir, `${baseOutputName}(1).md`);
  }
  return path.join(outputDir, `${baseOutputName}(${maxIndex + 1}).md`);
}
