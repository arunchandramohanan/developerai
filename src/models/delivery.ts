/**
 * Models ported from com.bmo.devai.intellij.models.generation
 * (FeatureCodeFileSpec, CodePatch, UpdateResult).
 */

/**
 * A single source file parsed from feature-code generation output. Each spec
 * maps to one file that should be created in the project.
 */
export interface FeatureCodeFileSpec {
  /** Relative file path, e.g. "src/main/java/com/example/AuthService.java". */
  targetPath: string;
  /** Language identifier from the code fence, e.g. "java", "kotlin". */
  language: string | null;
  /** The source code to write. */
  content: string;
  /** Inline assumptions extracted from ASSUMPTION: comments. */
  assumptions: string[];
}

export function fileSpecFileName(spec: FeatureCodeFileSpec): string {
  const lastSep = Math.max(spec.targetPath.lastIndexOf("/"), spec.targetPath.lastIndexOf("\\"));
  return lastSep >= 0 ? spec.targetPath.substring(lastSep + 1) : spec.targetPath;
}

export function fileSpecExtension(spec: FeatureCodeFileSpec): string {
  const name = fileSpecFileName(spec);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.substring(dot + 1) : "";
}

/**
 * A targeted search-and-replace patch for a single code block in a file.
 * The LLM returns the exact original block to find and the replacement block,
 * allowing precise edits without rewriting the entire file.
 */
export interface CodePatch {
  /** Relative path from the project root. */
  filePath: string;
  /** The exact code block to find in the file (copied verbatim by the LLM). */
  originalBlock: string;
  /** The replacement code block. */
  updatedBlock: string;
  /** Human-readable description of why this change is needed. */
  changeReason: string;
}

export function codePatchFileName(p: CodePatch): string {
  const lastSep = Math.max(p.filePath.lastIndexOf("/"), p.filePath.lastIndexOf("\\"));
  return lastSep >= 0 ? p.filePath.substring(lastSep + 1) : p.filePath;
}

/**
 * The outcome of a feature-update operation: a human-readable summary, the
 * list of affected files, and the individual code patches to apply.
 */
export interface UpdateResult {
  summary: string;
  affectedFiles: string[];
  patches: CodePatch[];
}

export function emptyUpdateResult(summary: string): UpdateResult {
  return { summary, affectedFiles: [], patches: [] };
}
