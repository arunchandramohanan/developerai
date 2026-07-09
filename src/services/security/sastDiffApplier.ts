import * as path from "path";
import { workspaceRoot, log } from "../../core/context";
import { readTextFile, fileExists } from "../../util/files";
import { SastFixProposal, proposalHasFix } from "../../models/security";

/**
 * Port of com.bmo.devai.intellij.util.SastDiffApplier.
 *
 * Resolves a SastFixProposal against the live workspace and produces the
 * patched file content using a literal find-and-replace of the proposal's
 * originalSnippet with its replacementSnippet. Deliberately avoids
 * unified-diff parsing: LLMs are far more reliable at copying an exact block.
 */
export interface SastPatch {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  snippetMatched: boolean;
}

export function patchIsApplicable(p: SastPatch): boolean {
  return p.snippetMatched && p.originalContent !== p.patchedContent;
}

/** Absolute path of the file referenced by proposal.filePath, or null. */
export function resolveFilePath(proposal: SastFixProposal): string | null {
  const base = workspaceRoot();
  if (!base) return null;
  return path.join(base, proposal.filePath);
}

export class SastDiffApplier {
  /**
   * Build a SastPatch for the given proposal. Returns null if the file cannot
   * be found or the proposal carries no fix.
   */
  static buildPatch(proposal: SastFixProposal): SastPatch | null {
    if (!proposalHasFix(proposal)) return null;
    const abs = resolveFilePath(proposal);
    if (!abs || !fileExists(abs)) {
      log("SAST patch: file not found for " + proposal.filePath);
      return null;
    }
    const original = readTextFile(abs);
    if (original === null) {
      log("SAST patch: failed to read " + abs);
      return null;
    }
    const snippet = proposal.originalSnippet;
    const replacement = proposal.replacementSnippet;
    if (snippet === null || replacement === null) {
      return { filePath: abs, originalContent: original, patchedContent: original, snippetMatched: false };
    }

    // 1. Exact literal match — preferred path.
    const idx = original.indexOf(snippet);
    if (idx >= 0) {
      const patched = original.substring(0, idx) + replacement + original.substring(idx + snippet.length);
      return { filePath: abs, originalContent: original, patchedContent: patched, snippetMatched: true };
    }

    // 2. Tolerant fallback: normalise CRLF->LF and trim per-line trailing
    //    whitespace, then look for a unique whole-line match.
    const tm = SastDiffApplier.findTolerant(original, snippet);
    if (tm) {
      const patched = original.substring(0, tm.startOffset) + replacement + original.substring(tm.endOffset);
      log("SAST patch: applied tolerant (whitespace-normalised) match in " + proposal.filePath);
      return { filePath: abs, originalContent: original, patchedContent: patched, snippetMatched: true };
    }

    log("SAST patch: originalSnippet not found verbatim or tolerantly in " + proposal.filePath);
    return { filePath: abs, originalContent: original, patchedContent: original, snippetMatched: false };
  }

  private static findTolerant(
    original: string,
    snippet: string
  ): { startOffset: number; endOffset: number } | null {
    const origLines = original.split("\n");
    const origNorm = SastDiffApplier.normaliseEachLine(origLines);
    const snipNorm = SastDiffApplier.normaliseEachLine(snippet.split("\n"));
    if (snipNorm.length === 0 || origLines.length < snipNorm.length) return null;
    const matchLine = SastDiffApplier.findUniqueLineMatch(origNorm, snipNorm);
    if (matchLine < 0) return null;
    const startOffset = SastDiffApplier.lineStartOffset(origLines, matchLine);
    const endLineExclusive = matchLine + snipNorm.length;
    const endOffset =
      SastDiffApplier.lineStartOffset(origLines, endLineExclusive) -
      (endLineExclusive < origLines.length ? 1 : 0);
    if (endOffset < startOffset || endOffset > original.length) return null;
    return { startOffset, endOffset };
  }

  private static findUniqueLineMatch(haystack: string[], needle: string[]): number {
    let found = -1;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        if (found >= 0) return -1; // ambiguous
        found = i;
      }
    }
    return found;
  }

  private static normaliseEachLine(lines: string[]): string[] {
    return lines.map((l) => SastDiffApplier.stripTrailing(l.replace(/\r/g, "")));
  }

  private static lineStartOffset(lines: string[], lineIndex: number): number {
    let offset = 0;
    const upTo = Math.min(lineIndex, lines.length);
    for (let i = 0; i < upTo; i++) offset += lines[i].length + 1;
    return offset;
  }

  private static stripTrailing(line: string): string {
    let end = line.length;
    while (end > 0 && /\s/.test(line.charAt(end - 1))) end--;
    return line.substring(0, end);
  }
}
