/**
 * Port of com.bmo.devai.intellij.services.impl.DiffChangeAnalyzerImpl.
 * Uses `git` via runProcess (in the workspace root) to compute diffs for a
 * DiffScope and parses the unified diff into a DiffSummary.
 */
import { runProcess } from "../util/exec";
import { workspaceRoot, log, logError } from "../core/context";
import { DevAIException, ErrorCode } from "../util/exception";
import {
  ChangeType,
  DiffChange,
  DiffHunk,
  DiffScope,
  DiffSummary,
} from "../models/diff";

const GIT_TIMEOUT_MS = 30_000;

const FILE_HEADER_PATTERN = /^diff --git a\/(.+?) b\/(.+?)$/m;
const HUNK_HEADER_PATTERN = /^@@\s+-(?:(\d+)(?:,(\d+))?)\s+\+(?:(\d+)(?:,(\d+))?)\s+@@(.*)$/;
const RENAME_PATTERN = /^rename from (.+)$/m;

export class DiffChangeAnalyzer {
  async analyzeDiffs(scope: DiffScope, filePath: string | null, baseBranch: string | null = null): Promise<DiffSummary> {
    try {
      const basePath = await this.getGitRoot();
      log(`analyzeDiffs: scope=${scope}, basePath=${basePath}, baseBranch=${baseBranch}`);
      if (basePath == null) {
        throw new DevAIException("Not a git repository", ErrorCode.GIT_ERROR);
      }

      const rawDiff = await this.getDiffForScope(scope, filePath, basePath, baseBranch);
      log(`analyzeDiffs: rawDiff length = ${rawDiff != null ? rawDiff.length : "null"}`);

      if (rawDiff == null || rawDiff.trim().length === 0) {
        const resolvedBranch =
          scope === DiffScope.FEATURE_BRANCH
            ? baseBranch != null ? baseBranch : await this.getDefaultBranch(basePath)
            : null;
        return { scope, changes: [], totalAdditions: 0, totalDeletions: 0, rawDiff: "", baseBranch: resolvedBranch };
      }

      const changes = this.parseDiff(rawDiff);
      const totalAdditions = changes.reduce((s, c) => s + c.additions, 0);
      const totalDeletions = changes.reduce((s, c) => s + c.deletions, 0);
      const resolvedBranch =
        scope === DiffScope.FEATURE_BRANCH
          ? baseBranch != null ? baseBranch : await this.getDefaultBranch(basePath)
          : null;

      return { scope, changes, totalAdditions, totalDeletions, rawDiff, baseBranch: resolvedBranch };
    } catch (e) {
      if (e instanceof DevAIException) throw e;
      logError("Failed to analyze diffs", e);
      throw new DevAIException("Failed to analyze diffs: " + (e instanceof Error ? e.message : String(e)), ErrorCode.GIT_ERROR);
    }
  }

  async detectDefaultBranch(): Promise<string> {
    const basePath = await this.getGitRoot();
    if (basePath == null) return "main";
    return this.getDefaultBranch(basePath);
  }

  // ── Git command execution ─────────────────────────────────────────────

  private async getGitRoot(): Promise<string | null> {
    const basePath = workspaceRoot();
    if (basePath == null) return null;
    try {
      const output = await this.runGit(basePath, "rev-parse", "--show-toplevel");
      if (output.exitCode === 0) return output.stdout.trim();
    } catch (e) {
      log("Not a git repository: " + basePath);
    }
    return null;
  }

  private async getDefaultBranch(basePath: string): Promise<string> {
    try {
      const output = await this.runGit(basePath, "symbolic-ref", "refs/remotes/origin/HEAD", "--short");
      if (output.exitCode === 0) {
        const ref = output.stdout.trim();
        const slash = ref.lastIndexOf("/");
        return slash >= 0 ? ref.substring(slash + 1) : ref;
      }
    } catch (e) {
      log("Failed to detect default branch from remote");
    }
    for (const branch of ["main", "master", "develop"]) {
      try {
        const output = await this.runGit(basePath, "rev-parse", "--verify", branch);
        if (output.exitCode === 0) return branch;
      } catch {
        /* try next */
      }
    }
    return "main";
  }

  private getDiffForScope(
    scope: DiffScope,
    filePath: string | null,
    basePath: string,
    baseBranch: string | null
  ): Promise<string | null> {
    switch (scope) {
      case DiffScope.FEATURE_BRANCH: return this.getFeatureBranchDiff(basePath, baseBranch);
      case DiffScope.UNCOMMITTED: return this.getUncommittedDiff(basePath);
      case DiffScope.STAGED: return this.getStagedDiff(basePath);
      case DiffScope.CURRENT_FILE: return this.getCurrentFileDiff(basePath, filePath);
    }
  }

  private async getFeatureBranchDiff(basePath: string, baseBranch: string | null): Promise<string | null> {
    const defaultBranch = baseBranch != null ? baseBranch : await this.getDefaultBranch(basePath);
    log(`Feature branch diff: using base branch '${defaultBranch}'`);
    try {
      const branchOutput = await this.runGit(basePath, "rev-parse", "--abbrev-ref", "HEAD");
      const currentBranch = branchOutput.stdout.trim();
      log(`Feature branch diff: current branch = '${currentBranch}'`);

      if (currentBranch === defaultBranch) {
        log("Already on default branch, showing uncommitted changes instead");
        return this.getUncommittedDiff(basePath);
      }

      let baseRef = defaultBranch;
      const verifyLocal = await this.runGit(basePath, "rev-parse", "--verify", defaultBranch);
      if (verifyLocal.exitCode !== 0) {
        const remoteRef = "origin/" + defaultBranch;
        const verifyRemote = await this.runGit(basePath, "rev-parse", "--verify", remoteRef);
        if (verifyRemote.exitCode === 0) {
          baseRef = remoteRef;
          log(`Using remote ref '${remoteRef}' (local '${defaultBranch}' not found)`);
        } else {
          log(`Neither local '${defaultBranch}' nor remote '${remoteRef}' exist`);
        }
      }

      const mergeBaseOutput = await this.runGit(basePath, "merge-base", baseRef, currentBranch);
      if (mergeBaseOutput.exitCode !== 0) {
        log("merge-base failed, falling back to three-dot diff");
        const diffOutput = await this.runGit(basePath, "diff", baseRef + "...HEAD");
        return diffOutput.stdout;
      }

      const mergeBase = mergeBaseOutput.stdout.trim();
      log("Feature branch diff: merge-base = " + mergeBase);
      const diffOutput = await this.runGit(basePath, "diff", mergeBase, "HEAD");
      return diffOutput.stdout;
    } catch (e) {
      log("Failed to get feature branch diff");
      return this.getUncommittedDiff(basePath);
    }
  }

  private async getUncommittedDiff(basePath: string): Promise<string | null> {
    try {
      const output = await this.runGit(basePath, "diff", "HEAD");
      let result = output.stdout;

      const untrackedOutput = await this.runGit(basePath, "ls-files", "--others", "--exclude-standard");
      if (untrackedOutput.exitCode === 0) {
        const untrackedFiles = untrackedOutput.stdout.trim();
        if (untrackedFiles.length > 0) {
          for (const file of untrackedFiles.split("\n")) {
            if (file.trim().length > 0) {
              const fileContent = await this.runGit(basePath, "diff", "--no-index", "/dev/null", file);
              if (fileContent.exitCode !== 128) {
                result += "\n" + fileContent.stdout;
              }
            }
          }
        }
      }
      return result;
    } catch (e) {
      log("Failed to get uncommitted diff");
      return null;
    }
  }

  private async getStagedDiff(basePath: string): Promise<string | null> {
    try {
      const output = await this.runGit(basePath, "diff", "--cached");
      return output.stdout;
    } catch (e) {
      log("Failed to get staged diff");
      return null;
    }
  }

  private async getCurrentFileDiff(basePath: string, filePath: string | null): Promise<string | null> {
    if (filePath == null || filePath.trim().length === 0) return null;
    try {
      let relativePath = filePath;
      if (filePath.startsWith(basePath)) {
        relativePath = filePath.substring(basePath.length);
        if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);
      }

      let output = await this.runGit(basePath, "diff", "HEAD", "--", relativePath);
      let diff = output.stdout;

      if (diff == null || diff.trim().length === 0) {
        output = await this.runGit(basePath, "diff", "--cached", "--", relativePath);
        diff = output.stdout;
      }

      if (diff == null || diff.trim().length === 0) {
        const statusOutput = await this.runGit(basePath, "status", "--porcelain", "--", relativePath);
        const status = statusOutput.stdout.trim();
        if (status.startsWith("??")) {
          output = await this.runGit(basePath, "diff", "--no-index", "/dev/null", relativePath);
          diff = output.stdout;
        }
      }
      return diff;
    } catch (e) {
      log("Failed to get current file diff");
      return null;
    }
  }

  // ── Diff parsing ──────────────────────────────────────────────────────

  private parseDiff(rawDiff: string): DiffChange[] {
    const changes: DiffChange[] = [];
    // Split before each "diff --git " while keeping the delimiter.
    const fileSections = rawDiff.split(/(?=diff --git )/);
    for (const section of fileSections) {
      if (section.trim().length === 0 || !section.startsWith("diff --git")) continue;
      try {
        const change = this.parseFileSection(section);
        if (change != null) changes.push(change);
      } catch (e) {
        log("Failed to parse diff section");
      }
    }
    return changes;
  }

  private parseFileSection(section: string): DiffChange | null {
    const headerMatcher = FILE_HEADER_PATTERN.exec(section);
    if (headerMatcher == null) return null;

    const newPath = headerMatcher[2];

    let changeType: ChangeType;
    let renamedFrom: string | null = null;

    if (section.includes("new file mode")) {
      changeType = ChangeType.ADDED;
    } else if (section.includes("deleted file mode")) {
      changeType = ChangeType.DELETED;
    } else if (section.includes("rename from")) {
      changeType = ChangeType.RENAMED;
      const renameMatcher = RENAME_PATTERN.exec(section);
      if (renameMatcher != null) renamedFrom = renameMatcher[1];
    } else {
      changeType = ChangeType.MODIFIED;
    }

    const hunks = this.parseHunks(section);

    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.content.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    return { filePath: newPath, changeType, oldFilePath: renamedFrom, hunks, additions, deletions };
  }

  private parseHunks(section: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = section.split("\n");

    let i = 0;
    while (i < lines.length) {
      const hunkMatcher = HUNK_HEADER_PATTERN.exec(lines[i]);
      if (hunkMatcher != null) {
        const oldStart = parseInt(hunkMatcher[1], 10);
        const oldCount = hunkMatcher[2] != null ? parseInt(hunkMatcher[2], 10) : 1;
        const newStart = parseInt(hunkMatcher[3], 10);
        const newCount = hunkMatcher[4] != null ? parseInt(hunkMatcher[4], 10) : 1;

        let content = lines[i] + "\n";
        i++;
        while (i < lines.length) {
          if (HUNK_HEADER_PATTERN.test(lines[i]) || lines[i].startsWith("diff --git")) break;
          content += lines[i] + "\n";
          i++;
        }
        hunks.push({ oldStart, oldCount, newStart, newCount, content });
      } else {
        i++;
      }
    }
    return hunks;
  }

  // ── Process execution ─────────────────────────────────────────────────

  private async runGit(workDir: string, ...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const output = await runProcess("git", args, { cwd: workDir, timeoutMs: GIT_TIMEOUT_MS });
    if (output.exitCode === -1 && output.stderr) {
      log("Git command failed: git " + args.join(" "));
    }
    return output;
  }
}
