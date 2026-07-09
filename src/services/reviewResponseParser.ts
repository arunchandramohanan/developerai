/**
 * Port of com.bmo.devai.intellij.services.impl.ReviewResponseParser.
 * Parses AI review responses into structured ReviewFinding lists.
 *
 * Supports three response formats (tried in order):
 *   1. <review-json> tags wrapping JSON
 *   2. Bare JSON array in the response body
 *   3. Plain-text bullet list (last resort)
 * Also handles file-path resolution and emoji stripping.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  CodeIssue,
  IssueCategory,
  ReviewFinding,
  Severity,
  categoryFromString,
  codeIssueWithFilePath,
  severityFromString,
} from "../models/review";
import { workspaceRoot, log } from "../core/context";

// Matches both object { "findings": [...] } and bare array [...] inside tags.
const REVIEW_JSON_PATTERN = /<review-json>\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*<\/review-json>/;
const JSON_ARRAY_PATTERN = /\[\s*\{[\s\S]*?\}\s*\]/;

export class ReviewResponseParser {
  // ---- public API --------------------------------------------------------

  parseFindings(content: string): ReviewFinding[] {
    const tagMatcher = REVIEW_JSON_PATTERN.exec(content);
    if (tagMatcher != null) {
      return this.parseFindingsFromJsonBlock(tagMatcher[1].trim());
    }

    const arrayMatcher = JSON_ARRAY_PATTERN.exec(content);
    if (arrayMatcher != null) {
      return this.parseFindingsJson(arrayMatcher[0]);
    }

    const trimmed = content.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      return this.parseFindingsFromJsonBlock(trimmed);
    }

    log("Could not find JSON in review response, attempting text parsing");
    return this.parseTextFindings(content);
  }

  /**
   * Resolves a CodeIssue's file path to an absolute path. The AI often returns
   * relative or bare file names but fix application requires absolute paths.
   */
  async resolveIssueFilePath(issue: CodeIssue, knownPath: string | null): Promise<CodeIssue> {
    const p = issue.filePath;

    // Already an absolute path -- verify it exists.
    if (path.isAbsolute(p)) {
      if (this.exists(p)) return issue;
    }

    // Try resolving relative to the workspace root.
    const basePath = workspaceRoot();
    if (basePath != null) {
      const resolved = path.join(basePath, p);
      if (this.exists(resolved)) {
        return codeIssueWithFilePath(issue, resolved);
      }
    }

    // Try searching for the file by name in the workspace.
    const fileName = p.includes("/") ? p.substring(p.lastIndexOf("/") + 1) : p;
    if (fileName.trim().length > 0 && fileName !== "unknown") {
      try {
        const files = await vscode.workspace.findFiles(`**/${fileName}`, "**/node_modules/**", 50);
        if (files.length === 1) {
          return codeIssueWithFilePath(issue, files[0].fsPath);
        }
        for (const f of files) {
          const fp = f.fsPath.replace(/\\/g, "/");
          if (fp.endsWith(p) || fp.endsWith("/" + p)) {
            return codeIssueWithFilePath(issue, f.fsPath);
          }
        }
        if (files.length > 0) {
          return codeIssueWithFilePath(issue, files[0].fsPath);
        }
      } catch {
        /* ignore search failures */
      }
    }

    if (knownPath != null && knownPath.trim().length > 0) {
      return codeIssueWithFilePath(issue, knownPath);
    }

    log("Could not resolve file path for issue: " + p);
    return issue;
  }

  /** Builds a human-readable summary line from the issue list and diff metadata. */
  buildSummary(issues: CodeIssue[], fileCount: number): string {
    if (issues.length === 0) {
      return `No issues found across ${fileCount} file(s)`;
    }
    const counts = new Map<Severity, number>();
    for (const issue of issues) counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);

    let sb = `${issues.length} issue(s) found across ${fileCount} file(s): `;
    let first = true;
    for (const severity of [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO]) {
      const count = counts.get(severity);
      if (count && count > 0) {
        if (!first) sb += ", ";
        sb += `${count} ${severityDisplay(severity)}`;
        first = false;
      }
    }
    return sb;
  }

  // ---- JSON parsing internals -------------------------------------------

  private parseFindingsFromJsonBlock(json: string): ReviewFinding[] {
    if (json.startsWith("{")) {
      const findingsIdx = json.indexOf('"findings"');
      if (findingsIdx >= 0) {
        const bracketStart = json.indexOf("[", findingsIdx);
        if (bracketStart >= 0) {
          let depth = 0;
          let inString = false;
          let escaped = false;
          for (let i = bracketStart; i < json.length; i++) {
            const c = json.charAt(i);
            if (escaped) { escaped = false; continue; }
            if (c === "\\") { escaped = true; continue; }
            if (c === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (c === "[") depth++;
            else if (c === "]") {
              depth--;
              if (depth === 0) {
                return this.parseFindingsJson(json.substring(bracketStart, i + 1));
              }
            }
          }
        }
      }
      return this.parseFindingsJson("[" + json + "]");
    }
    return this.parseFindingsJson(json);
  }

  private parseFindingsJson(json: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    try {
      for (const obj of this.splitJsonArray(json)) {
        try {
          const finding = this.parseJsonObject(obj);
          if (finding != null) findings.push(finding);
        } catch {
          /* skip bad object */
        }
      }
    } catch {
      /* ignore */
    }
    return findings;
  }

  private splitJsonArray(json: string): string[] {
    const objects: string[] = [];
    json = json.trim();
    if (!json.startsWith("[")) return objects;

    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < json.length; i++) {
      const c = json.charAt(i);
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (c === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          objects.push(json.substring(start, i + 1));
          start = -1;
        }
      }
    }
    return objects;
  }

  private parseJsonObject(obj: string): ReviewFinding | null {
    const title = this.extractJsonString(obj, "title");
    const severity = this.extractJsonString(obj, "severity");
    const category = this.extractJsonString(obj, "category");

    let file = this.extractJsonString(obj, "filePath");
    if (file == null) file = this.extractJsonString(obj, "file");

    let startLineStr = this.extractJsonValue(obj, "lineNumber");
    if (startLineStr == null) startLineStr = this.extractJsonValue(obj, "startLine");

    let endLineStr = this.extractJsonValue(obj, "endLineNumber");
    if (endLineStr == null) endLineStr = this.extractJsonValue(obj, "endLine");

    const description = this.extractJsonString(obj, "description");
    const recommendation = this.extractJsonString(obj, "recommendation");
    const suggestedFix = this.extractJsonString(obj, "suggestedFix");

    if (title == null || title.trim().length === 0) return null;

    let startLine = 1;
    let endLine = 1;
    if (startLineStr != null) {
      const n = parseInt(startLineStr.trim(), 10);
      if (!isNaN(n)) startLine = n;
    }
    if (endLineStr != null) {
      const n = parseInt(endLineStr.trim(), 10);
      if (!isNaN(n)) endLine = n;
    }
    if (endLine < startLine) endLine = startLine;

    return {
      title: stripEmojis(title),
      severity: severity != null ? severityFromString(severity) : Severity.MEDIUM,
      category: category != null ? this.mapCategory(category) : IssueCategory.OTHER,
      filePath: file != null ? file : "unknown",
      startLine,
      endLine,
      description: description != null ? stripEmojis(description) : stripEmojis(title),
      recommendation: recommendation != null ? stripEmojis(recommendation) : "",
      suggestedFix,
    };
  }

  private mapCategory(category: string): IssueCategory {
    const normalized = category.toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
    switch (normalized) {
      case "bug": case "bugs": case "logic": return IssueCategory.BUG;
      case "security": case "vulnerability": return IssueCategory.SECURITY;
      case "performance": case "perf": return IssueCategory.PERFORMANCE;
      case "error_handling": case "errorhandling": return IssueCategory.ERROR_HANDLING;
      case "best_practice": case "bestpractice": return IssueCategory.BEST_PRACTICE;
      case "maintainability": case "readability": case "code_quality": return IssueCategory.MAINTAINABILITY;
      case "type_safety": case "typesafety": return IssueCategory.BEST_PRACTICE;
      case "concurrency": case "threading": return IssueCategory.CONCURRENCY;
      case "resource": case "resources": return IssueCategory.RESOURCE;
      case "style": case "formatting": return IssueCategory.STYLE;
      case "documentation": case "docs": return IssueCategory.DOCUMENTATION;
      default: return categoryFromString(category);
    }
  }

  private extractJsonString(json: string, key: string): string | null {
    const pattern = new RegExp('"' + escapeRegex(key) + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
    const matcher = pattern.exec(json);
    if (matcher != null) {
      return matcher[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\");
    }
    return null;
  }

  private extractJsonValue(json: string, key: string): string | null {
    const pattern = new RegExp('"' + escapeRegex(key) + '"\\s*:\\s*([^,}\\s]+)');
    const matcher = pattern.exec(json);
    if (matcher != null) {
      const value = matcher[1].trim();
      if (value === "null") return null;
      return value.replace(/"/g, "");
    }
    return null;
  }

  // ---- text fallback parsing --------------------------------------------

  private parseTextFindings(content: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("-") || line.startsWith("*") || /^\d+\..*/.test(line)) {
        const text = line.replace(/^[-*]|^\d+\./, "").trim();
        if (text.length > 15) {
          findings.push({
            title: stripEmojis(this.extractTitle(text)),
            severity: Severity.MEDIUM,
            category: IssueCategory.OTHER,
            filePath: "unknown",
            startLine: 1,
            endLine: 1,
            description: stripEmojis(text),
            recommendation: "",
            suggestedFix: null,
          });
        }
      }
    }
    return findings;
  }

  private extractTitle(description: string): string {
    const dotIndex = description.indexOf(".");
    if (dotIndex > 0 && dotIndex < 100) return description.substring(0, dotIndex);
    if (description.length > 80) return description.substring(0, 77) + "...";
    return description;
  }

  private exists(p: string): boolean {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }
}

function severityDisplay(s: Severity): string {
  return { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", INFO: "Info" }[s];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips emoji and decorative Unicode symbols from AI-generated text. */
export function stripEmojis(text: string | null | undefined): string {
  if (text == null || text.length === 0) return "";
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/[\u{20E3}]/gu, "")
    .replace(/[\u{E0020}-\u{E007F}]/gu, "")
    .replace(/[\u{2300}-\u{23FF}]/gu, "")
    .replace(/[\u{2B50}-\u{2B55}]/gu, "")
    .replace(/[\u{1FA00}-\u{1FAFF}]/gu, "")
    .replace(/[\u{E000}-\u{F8FF}]/gu, "")
    .replace(/[✓✗✔✘✖✕✅❌⚠️❗❓❕❔⭐]/g, "")
    .replace(/^\s+/, "")
    .trim();
}
