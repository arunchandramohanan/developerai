import * as fs from "fs";
import * as path from "path";
import { workspaceRoot, logError } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.services.CoverageService +
 * impl.CoverageServiceImpl: language-agnostic coverage estimation via static
 * file analysis. Scans the workspace for source files and checks whether
 * corresponding test files exist, reporting coverage based on line counts.
 */

export interface ClassCoverage {
  className: string;
  packageName: string;
  lineCovered: number;
  lineMissed: number;
  branchCovered: number;
  branchMissed: number;
}

export interface TestResults {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
}

export const EMPTY_TEST_RESULTS: TestResults = { passed: 0, failed: 0, errors: 0, skipped: 0 };

export interface CoverageReport {
  lineCovered: number;
  lineMissed: number;
  branchCovered: number;
  branchMissed: number;
  classes: ClassCoverage[];
  testResults: TestResults;
}

export function coverageTotalLines(r: CoverageReport): number {
  return r.lineCovered + r.lineMissed;
}
export function coverageTotalBranches(r: CoverageReport): number {
  return r.branchCovered + r.branchMissed;
}
export function coverageLinePercent(r: CoverageReport): number {
  const total = coverageTotalLines(r);
  return total === 0 ? 0 : (r.lineCovered * 100) / total;
}

export function testResultsTotal(t: TestResults): number {
  return t.passed + t.failed + t.errors + t.skipped;
}
export function testResultsAllPassed(t: TestResults): boolean {
  return t.failed === 0 && t.errors === 0 && testResultsTotal(t) > 0;
}

/** File extensions recognized as source code. */
const SOURCE_EXTENSIONS = new Set([
  "java", "kt", "py", "ts", "tsx", "js", "jsx", "go", "rb", "cs", "swift", "scala",
]);

/** Directories excluded from scanning (build output, dependencies, VCS). */
const EXCLUDED_DIRS = new Set([
  "node_modules", "build", "dist", "target", ".gradle", ".git",
  "__pycache__", ".tox", "venv", ".venv", "vendor", "out", "bin", ".idea",
]);

export class CoverageService {
  private static _instance: CoverageService | undefined;

  static getInstance(): CoverageService {
    if (!CoverageService._instance) CoverageService._instance = new CoverageService();
    return CoverageService._instance;
  }

  private running = false;
  private lastReport: CoverageReport | null = null;

  isRunning(): boolean {
    return this.running;
  }

  getLastReport(): CoverageReport | null {
    return this.lastReport;
  }

  async runCoverage(): Promise<CoverageReport> {
    if (this.running) {
      if (this.lastReport) return this.lastReport;
      throw new Error("Coverage run already in progress");
    }
    this.running = true;
    try {
      const report = await this.scanProject();
      this.lastReport = report;
      return report;
    } catch (e) {
      logError("Coverage scan failed", e);
      throw new Error("Coverage scan failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      this.running = false;
    }
  }

  /**
   * Scans the workspace for source files and matches them with test files.
   * Source files with a corresponding test file are counted as "covered".
   */
  private async scanProject(): Promise<CoverageReport> {
    const root = workspaceRoot();
    if (!root) {
      throw new Error("Open a workspace folder to estimate coverage");
    }

    const sourceFiles: string[] = [];
    const testFiles: string[] = [];
    await walk(root, root, sourceFiles, testFiles);

    const testTargets = new Set<string>();
    for (const tf of testFiles) {
      testTargets.add(extractTestTarget(tf));
    }

    const classes: ClassCoverage[] = [];
    let totalCovered = 0;
    let totalMissed = 0;

    for (const src of sourceFiles) {
      const baseName = stripExtension(path.basename(src)).toLowerCase();
      const pkg = derivePackage(root, src);
      const lines = await countNonBlankLines(src);
      if (lines === 0) continue;

      if (testTargets.has(baseName)) {
        classes.push({ className: path.basename(src), packageName: pkg, lineCovered: lines, lineMissed: 0, branchCovered: 0, branchMissed: 0 });
        totalCovered += lines;
      } else {
        classes.push({ className: path.basename(src), packageName: pkg, lineCovered: 0, lineMissed: lines, branchCovered: 0, branchMissed: 0 });
        totalMissed += lines;
      }
    }

    return {
      lineCovered: totalCovered,
      lineMissed: totalMissed,
      branchCovered: 0,
      branchMissed: 0,
      classes,
      testResults: EMPTY_TEST_RESULTS,
    };
  }
}

async function walk(root: string, dir: string, sourceFiles: string[], testFiles: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        await walk(root, full, sourceFiles, testFiles);
      }
    } else if (entry.isFile() && hasSourceExtension(entry.name)) {
      if (isTestFile(root, full)) testFiles.push(full);
      else sourceFiles.push(full);
    }
  }
}

export function hasSourceExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return SOURCE_EXTENSIONS.has(fileName.substring(dot + 1).toLowerCase());
}

export function isTestFile(projectRoot: string, filePath: string): boolean {
  const relative = path.relative(projectRoot, filePath);
  const parts = relative.split(path.sep);
  for (let i = 0; i < parts.length - 1; i++) {
    const dir = parts[i].toLowerCase();
    if (dir === "test" || dir === "tests" || dir === "__tests__" || dir === "spec") {
      return true;
    }
  }

  const name = path.basename(filePath);
  const lowerName = name.toLowerCase();
  if (lowerName.includes(".test.") || lowerName.includes(".spec.")) return true;

  const noExt = stripExtension(name);
  if (noExt.toLowerCase().startsWith("test_")) return true;
  if (noExt.endsWith("Test") || noExt.endsWith("Tests") || noExt.endsWith("Spec")) return true;

  const lower = noExt.toLowerCase();
  return lower.endsWith("_test") || lower.endsWith("_tests") || lower.endsWith("_spec");
}

export function extractTestTarget(testFilePath: string): string {
  const name = path.basename(testFilePath);
  const lower = name.toLowerCase();

  for (const middle of [".test.", ".spec."]) {
    const idx = lower.indexOf(middle);
    if (idx > 0) return lower.substring(0, idx);
  }

  const noExt = stripExtension(name);
  const noExtLower = noExt.toLowerCase();

  if (noExtLower.startsWith("test_")) return noExtLower.substring(5);

  if (noExt.endsWith("Tests")) return noExtLower.substring(0, noExtLower.length - 5);
  if (noExt.endsWith("Test")) return noExtLower.substring(0, noExtLower.length - 4);
  if (noExt.endsWith("Spec")) return noExtLower.substring(0, noExtLower.length - 4);
  if (noExtLower.endsWith("_tests")) return noExtLower.substring(0, noExtLower.length - 6);
  if (noExtLower.endsWith("_test")) return noExtLower.substring(0, noExtLower.length - 5);
  if (noExtLower.endsWith("_spec")) return noExtLower.substring(0, noExtLower.length - 5);

  return noExtLower;
}

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.substring(0, dot) : fileName;
}

function derivePackage(root: string, filePath: string): string {
  const relative = path.dirname(path.relative(root, filePath));
  return relative === "." ? "" : relative.split(path.sep).join("/");
}

async function countNonBlankLines(filePath: string): Promise<number> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return content.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}
