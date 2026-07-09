import * as fs from "fs";
import { resourcePath, logError } from "./context";

/**
 * Port of com.bmo.devai.intellij.services.InputFilterService.
 * Sanitizes user-supplied text before it is substituted into prompts:
 * replaces configured dangerous phrases and fuzzy words (and scrambled
 * anagram variants of fuzzy words) with [FILTERED].
 */
export class InputFilterService {
  private static _instance: InputFilterService | undefined;
  private dangerousPhrases: string[] = [];
  private fuzzyWords: string[] = [];
  private variantTargets: string[] = [];

  private constructor() {
    this.dangerousPhrases = this.loadNonEmptyLines("dangerous-phrases.txt");
    this.fuzzyWords = this.loadNonEmptyLines("fuzzy-words.txt");
    this.variantTargets = Array.from(new Set(this.fuzzyWords.map((w) => w.toLowerCase())));
  }

  static getInstance(): InputFilterService {
    if (!InputFilterService._instance) InputFilterService._instance = new InputFilterService();
    return InputFilterService._instance;
  }

  private loadNonEmptyLines(name: string): string[] {
    try {
      const text = fs.readFileSync(resourcePath("input-filter", name), "utf8");
      return text
        .split(/\r\n|\r|\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
    } catch (e) {
      logError(`InputFilter: failed to load ${name}`, e);
      return [];
    }
  }

  filter(input: string | null | undefined): string {
    if (input === null || input === undefined || input.trim().length === 0) {
      return input ?? "";
    }
    return this.filterRenderedPrompt(input);
  }

  /** Filters an individual user value before template substitution. */
  filterInputValue(value: string | null | undefined, _fieldName: string): string {
    if (value === null || value === undefined || value.length === 0) return value ?? "";
    return this.filter(value);
  }

  filterRenderedPrompt(input: string): string {
    let sanitized = input;
    for (const phrase of this.dangerousPhrases) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(phrase), "gi"), "[FILTERED]");
    }
    for (const word of this.fuzzyWords) {
      sanitized = sanitized.replace(new RegExp("\\b" + escapeRegExp(word) + "\\b", "gi"), "[FILTERED]");
    }
    sanitized = this.replaceScrambledVariants(sanitized);
    return sanitized;
  }

  private replaceScrambledVariants(input: string): string {
    return input.replace(/\b[A-Za-z]{4,}\b/g, (token) =>
      this.isVariantOfBlockedWord(token) ? "[FILTERED]" : token
    );
  }

  private isVariantOfBlockedWord(token: string): boolean {
    const candidate = token.toLowerCase();
    return this.variantTargets.some((t) => isScrambledVariant(candidate, t));
  }

  getDangerousPhrases(): string[] {
    return this.dangerousPhrases;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isScrambledVariant(candidate: string, target: string): boolean {
  if (candidate.length !== target.length) return false;
  if (candidate.length < 4) return false;
  if (candidate[0] !== target[0]) return false;
  if (candidate[candidate.length - 1] !== target[target.length - 1]) return false;
  if (candidate === target) return false;
  const cm = candidate.slice(1, -1).split("").sort().join("");
  const tm = target.slice(1, -1).split("").sort().join("");
  return cm === tm;
}
