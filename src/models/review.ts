/**
 * Code-review domain models, ported from com.bmo.devai.intellij.models.review.
 * Java records with helper methods become interfaces + free functions;
 * enums keep their metadata in lookup tables.
 */
import { ExecutionMode, cryptoRandomId } from "../models";

// ---- Severity -------------------------------------------------------------

export enum Severity {
  CRITICAL = "CRITICAL",
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
  INFO = "INFO",
}

const SEVERITY_META: Record<Severity, { displayName: string; priority: number }> = {
  [Severity.CRITICAL]: { displayName: "Critical", priority: 1 },
  [Severity.HIGH]: { displayName: "High", priority: 2 },
  [Severity.MEDIUM]: { displayName: "Medium", priority: 3 },
  [Severity.LOW]: { displayName: "Low", priority: 4 },
  [Severity.INFO]: { displayName: "Info", priority: 5 },
};

/** Declaration order, matching Java's Severity.values(). */
export const SEVERITY_ORDER: Severity[] = [
  Severity.CRITICAL,
  Severity.HIGH,
  Severity.MEDIUM,
  Severity.LOW,
  Severity.INFO,
];

export function severityDisplayName(s: Severity): string { return SEVERITY_META[s].displayName; }
export function severityPriority(s: Severity): number { return SEVERITY_META[s].priority; }

/** True if `s` is at least as severe as `level` (lower priority number = more severe). */
export function severityIsAtLeast(s: Severity, level: Severity): boolean {
  return SEVERITY_META[s].priority <= SEVERITY_META[level].priority;
}

export function severityFromString(value: string): Severity {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "CRITICAL": case "BLOCKER": case "FATAL": return Severity.CRITICAL;
    case "HIGH": case "MAJOR": case "ERROR": return Severity.HIGH;
    case "MEDIUM": case "NORMAL": case "MODERATE": case "WARNING": return Severity.MEDIUM;
    case "LOW": case "MINOR": case "SUGGESTION": return Severity.LOW;
    case "INFO": case "TRIVIAL": case "HINT": case "NOTE": return Severity.INFO;
    default:
      return (Object.values(Severity) as string[]).includes(normalized)
        ? (normalized as Severity)
        : Severity.MEDIUM;
  }
}

// ---- IssueCategory --------------------------------------------------------

export enum IssueCategory {
  BUG = "BUG",
  SECURITY = "SECURITY",
  PERFORMANCE = "PERFORMANCE",
  STYLE = "STYLE",
  BEST_PRACTICE = "BEST_PRACTICE",
  MAINTAINABILITY = "MAINTAINABILITY",
  ERROR_HANDLING = "ERROR_HANDLING",
  CONCURRENCY = "CONCURRENCY",
  DOCUMENTATION = "DOCUMENTATION",
  TESTING = "TESTING",
  COMPLEXITY = "COMPLEXITY",
  DUPLICATION = "DUPLICATION",
  MEMORY = "MEMORY",
  RESOURCE = "RESOURCE",
  OTHER = "OTHER",
}

const CATEGORY_META: Record<IssueCategory, { displayName: string; description: string }> = {
  [IssueCategory.BUG]: { displayName: "Bug", description: "Potential bugs and logic errors" },
  [IssueCategory.SECURITY]: { displayName: "Security", description: "Security vulnerabilities" },
  [IssueCategory.PERFORMANCE]: { displayName: "Performance", description: "Performance issues and optimizations" },
  [IssueCategory.STYLE]: { displayName: "Style", description: "Code style and formatting issues" },
  [IssueCategory.BEST_PRACTICE]: { displayName: "Best Practice", description: "Best practice violations" },
  [IssueCategory.MAINTAINABILITY]: { displayName: "Maintainability", description: "Code maintainability concerns" },
  [IssueCategory.ERROR_HANDLING]: { displayName: "Error Handling", description: "Exception and error handling issues" },
  [IssueCategory.CONCURRENCY]: { displayName: "Concurrency", description: "Thread safety and concurrency issues" },
  [IssueCategory.DOCUMENTATION]: { displayName: "Documentation", description: "Missing or incorrect documentation" },
  [IssueCategory.TESTING]: { displayName: "Testing", description: "Testing-related issues" },
  [IssueCategory.COMPLEXITY]: { displayName: "Complexity", description: "Code complexity concerns" },
  [IssueCategory.DUPLICATION]: { displayName: "Duplication", description: "Code duplication detected" },
  [IssueCategory.MEMORY]: { displayName: "Memory", description: "Memory management issues" },
  [IssueCategory.RESOURCE]: { displayName: "Resource", description: "Resource management issues" },
  [IssueCategory.OTHER]: { displayName: "Other", description: "Other issues" },
};

/** Declaration order, matching Java's IssueCategory.values(). */
export const CATEGORY_ORDER: IssueCategory[] = [
  IssueCategory.BUG, IssueCategory.SECURITY, IssueCategory.PERFORMANCE, IssueCategory.STYLE,
  IssueCategory.BEST_PRACTICE, IssueCategory.MAINTAINABILITY, IssueCategory.ERROR_HANDLING,
  IssueCategory.CONCURRENCY, IssueCategory.DOCUMENTATION, IssueCategory.TESTING,
  IssueCategory.COMPLEXITY, IssueCategory.DUPLICATION, IssueCategory.MEMORY,
  IssueCategory.RESOURCE, IssueCategory.OTHER,
];

export function categoryDisplayName(c: IssueCategory): string { return CATEGORY_META[c].displayName; }
export function categoryDescription(c: IssueCategory): string { return CATEGORY_META[c].description; }

export function categoryFromString(value: string): IssueCategory {
  const normalized = value.trim().toUpperCase().replace(/ /g, "_").replace(/-/g, "_");
  switch (normalized) {
    case "BUG": case "BUGS": case "DEFECT": case "ERROR": return IssueCategory.BUG;
    case "SECURITY": case "VULNERABILITY": case "SEC": return IssueCategory.SECURITY;
    case "PERFORMANCE": case "PERF": case "OPTIMIZATION": return IssueCategory.PERFORMANCE;
    case "STYLE": case "FORMAT": case "FORMATTING": case "CODE_STYLE": return IssueCategory.STYLE;
    case "BEST_PRACTICE": case "BESTPRACTICE": case "PRACTICE": return IssueCategory.BEST_PRACTICE;
    case "MAINTAINABILITY": case "MAINTAIN": case "READABILITY": return IssueCategory.MAINTAINABILITY;
    case "ERROR_HANDLING": case "ERRORHANDLING": case "EXCEPTION": return IssueCategory.ERROR_HANDLING;
    case "CONCURRENCY": case "THREADING": case "THREAD_SAFETY": return IssueCategory.CONCURRENCY;
    case "DOCUMENTATION": case "DOC": case "DOCS": case "COMMENT": return IssueCategory.DOCUMENTATION;
    case "TESTING": case "TEST": case "TESTS": return IssueCategory.TESTING;
    case "COMPLEXITY": case "COMPLEX": return IssueCategory.COMPLEXITY;
    case "DUPLICATION": case "DUPLICATE": case "COPY": return IssueCategory.DUPLICATION;
    case "MEMORY": case "MEMORY_LEAK": case "LEAK": return IssueCategory.MEMORY;
    case "RESOURCE": case "RESOURCES": case "IO": return IssueCategory.RESOURCE;
    default:
      return (Object.values(IssueCategory) as string[]).includes(normalized)
        ? (normalized as IssueCategory)
        : IssueCategory.OTHER;
  }
}

// ---- CodeIssue ------------------------------------------------------------

export interface CodeIssue {
  id: string;
  severity: Severity;
  category: IssueCategory;
  title: string;
  description: string;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  suggestedFix: string | null;
  fixDescription: string | null;
  ruleId: string | null;
}

export function codeIssueOf(
  severity: Severity, category: IssueCategory, title: string,
  description: string, filePath: string, line: number
): CodeIssue {
  return {
    id: cryptoRandomId(), severity, category, title, description, filePath,
    startLine: line, endLine: line, startColumn: 0, endColumn: -1,
    suggestedFix: null, fixDescription: null, ruleId: null,
  };
}

export function codeIssueWithFix(
  severity: Severity, category: IssueCategory, title: string, description: string,
  filePath: string, startLine: number, endLine: number,
  suggestedFix: string, fixDescription: string | null
): CodeIssue {
  return {
    id: cryptoRandomId(), severity, category, title, description, filePath,
    startLine, endLine, startColumn: 0, endColumn: -1,
    suggestedFix, fixDescription, ruleId: null,
  };
}

export function codeIssueHasFix(issue: CodeIssue): boolean {
  return issue.suggestedFix != null && issue.suggestedFix.trim().length > 0;
}

export function codeIssueWithFilePath(issue: CodeIssue, newFilePath: string): CodeIssue {
  return { ...issue, filePath: newFilePath };
}

export function codeIssueIsMultiLine(issue: CodeIssue): boolean {
  return issue.endLine > issue.startLine;
}

export function codeIssueLocationString(issue: CodeIssue): string {
  const fileName = issue.filePath.substring(issue.filePath.lastIndexOf("/") + 1);
  return codeIssueIsMultiLine(issue)
    ? `${fileName}:${issue.startLine}-${issue.endLine}`
    : `${fileName}:${issue.startLine}`;
}

export function codeIssueLineRange(issue: CodeIssue): string {
  return issue.startLine === issue.endLine
    ? String(issue.startLine)
    : `${issue.startLine}-${issue.endLine}`;
}

export function codeIssueDisplayText(issue: CodeIssue): string {
  return `${issue.title} (${codeIssueLocationString(issue)})`;
}

/** Builds the template-variable map used by fix prompt templates. */
export function codeIssueTemplateVars(issue: CodeIssue, issueNumber: number): Record<string, string> {
  return {
    issueNumber: String(issueNumber),
    title: issue.title,
    severity: severityDisplayName(issue.severity),
    category: categoryDisplayName(issue.category),
    filePath: issue.filePath,
    lineRange: codeIssueLineRange(issue),
    description: issue.description,
    recommendation: issue.fixDescription != null ? issue.fixDescription : "",
    suggestedFix: issue.suggestedFix != null ? issue.suggestedFix : "",
  };
}

// ---- ReviewFinding --------------------------------------------------------

export interface ReviewFinding {
  title: string;
  severity: Severity;
  category: IssueCategory;
  filePath: string;
  startLine: number;
  endLine: number;
  description: string;
  recommendation: string;
  suggestedFix: string | null;
}

export function findingToCodeIssue(finding: ReviewFinding): CodeIssue {
  if (finding.suggestedFix != null && finding.suggestedFix.trim().length > 0) {
    return codeIssueWithFix(
      finding.severity, finding.category, finding.title,
      finding.description + "\n\nRecommendation: " + finding.recommendation,
      finding.filePath, finding.startLine, finding.endLine,
      finding.suggestedFix, finding.recommendation
    );
  }
  return codeIssueOf(
    finding.severity, finding.category, finding.title,
    finding.description + "\n\nRecommendation: " + finding.recommendation,
    finding.filePath, finding.startLine > 0 ? finding.startLine : 1
  );
}

// ---- ReviewResult ---------------------------------------------------------

export enum ReviewScope {
  FILE = "FILE",
  SELECTION = "SELECTION",
  VCS_CHANGES = "VCS_CHANGES",
  PROJECT = "PROJECT",
}

const REVIEW_SCOPE_DISPLAY: Record<ReviewScope, string> = {
  [ReviewScope.FILE]: "File",
  [ReviewScope.SELECTION]: "Selection",
  [ReviewScope.VCS_CHANGES]: "VCS Changes",
  [ReviewScope.PROJECT]: "Project",
};

export function reviewScopeDisplayName(s: ReviewScope): string { return REVIEW_SCOPE_DISPLAY[s]; }

export interface ReviewResult {
  id: string;
  issues: CodeIssue[];
  filePath: string | null;
  reviewScope: ReviewScope;
  startTime: number;
  endTime: number;
  mode: ExecutionMode;
  summary: string | null;
}

export function reviewResultForFile(
  filePath: string, issues: CodeIssue[], mode: ExecutionMode, startTime: number, summary: string | null
): ReviewResult {
  return {
    id: cryptoRandomId(), issues, filePath, reviewScope: ReviewScope.FILE,
    startTime, endTime: Date.now(), mode, summary,
  };
}

export function reviewResultForChanges(
  issues: CodeIssue[], mode: ExecutionMode, startTime: number, summary: string | null
): ReviewResult {
  return {
    id: cryptoRandomId(), issues, filePath: null, reviewScope: ReviewScope.VCS_CHANGES,
    startTime, endTime: Date.now(), mode, summary,
  };
}

export function reviewTotalIssueCount(result: ReviewResult): number {
  return result.issues.length;
}

export function reviewIssuesBySeverity(result: ReviewResult, severity: Severity): CodeIssue[] {
  return result.issues.filter((i) => i.severity === severity);
}

export function reviewIssuesByCategory(result: ReviewResult, category: IssueCategory): CodeIssue[] {
  return result.issues.filter((i) => i.category === category);
}

export function reviewFixableIssues(result: ReviewResult): CodeIssue[] {
  return result.issues.filter(codeIssueHasFix);
}

export function reviewCountBySeverity(result: ReviewResult): Map<Severity, number> {
  const map = new Map<Severity, number>();
  for (const i of result.issues) map.set(i.severity, (map.get(i.severity) ?? 0) + 1);
  return map;
}

export function reviewDurationMs(result: ReviewResult): number {
  return result.endTime - result.startTime;
}

export function reviewHasHighSeverityIssues(result: ReviewResult): boolean {
  return result.issues.some((i) => severityIsAtLeast(i.severity, Severity.HIGH));
}

export function reviewIssuesSortedBySeverity(result: ReviewResult): CodeIssue[] {
  return [...result.issues].sort((a, b) => severityPriority(a.severity) - severityPriority(b.severity));
}

export function reviewDisplaySummary(result: ReviewResult): string {
  const counts = reviewCountBySeverity(result);
  if (result.issues.length === 0) return "No issues found";
  let sb = `${result.issues.length} issue(s) found: `;
  let first = true;
  for (const severity of SEVERITY_ORDER) {
    const count = counts.get(severity);
    if (count && count > 0) {
      if (!first) sb += ", ";
      sb += `${count} ${severityDisplayName(severity).toLowerCase()}`;
      first = false;
    }
  }
  return sb;
}

// ---- FixPreview -----------------------------------------------------------

export interface FixPreview {
  filePath: string;
  originalContent: string;
  fixedContent: string;
  issues: CodeIssue[];
}

export function fixPreviewFileName(preview: FixPreview): string {
  const lastSlash = preview.filePath.lastIndexOf("/");
  return lastSlash >= 0 ? preview.filePath.substring(lastSlash + 1) : preview.filePath;
}

export function fixPreviewHasChanges(preview: FixPreview): boolean {
  return preview.originalContent !== preview.fixedContent;
}
