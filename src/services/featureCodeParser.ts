import { FeatureCodeFileSpec } from "../models/delivery";
import { log } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.util.FeatureCodeParser.
 *
 * Parses feature-code generation CLI output into individual file specs.
 * Expected format (enforced by feature-code-generation.md prompt):
 *   <!-- file: src/main/java/com/example/MyService.java -->
 *   ```java
 *   package com.example;
 *   // ASSUMPTION: Using Spring framework
 *   public class MyService { ... }
 *   ```
 * Also supports labels like **File: `path`**, ### `path`, // File: path.
 */

/** Matches a file path label before a code block. */
const FILE_PATH_PATTERN = new RegExp(
  "(?:" +
    "<!--\\s*file:\\s*(.+?)\\s*-->" + // <!-- file: path -->
    "|\\*\\*(?:File|Target|Path)?:?\\s*`([^`]+)`\\*\\*" + // **File: `path`**
    "|#{1,4}\\s*`([^`]+)`" + // ### `path`
    "|//\\s*(?:File|Target):\\s*(.+?)\\s*$" + // // File: path
    "|(?:File|Target|Path):\\s*`?([^`\\n]+?)`?\\s*$" + // File: path or File: `path`
    ")",
  "gm"
);

/** Matches fenced code blocks: ```lang ... ``` */
const CODE_BLOCK_PATTERN = /```(\w*)\s*\n([\s\S]*?)```/g;

/** Matches // ASSUMPTION: ... comments */
const ASSUMPTION_PATTERN = /\/\/\s*ASSUMPTION:\s*(.+)/gm;

/**
 * Parses CLI markdown output into a list of file specs (may be empty).
 */
export function parseFeatureCode(cliOutput: string): FeatureCodeFileSpec[] {
  const specs: FeatureCodeFileSpec[] = [];

  const codeRe = new RegExp(CODE_BLOCK_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = codeRe.exec(cliOutput)) !== null) {
    const language = match[1] || null;
    const codeContent = match[2].trim();
    if (codeContent.length === 0) continue;

    // Look backwards up to 500 chars from the code block start for a path label
    const blockStart = match.index;
    const textBefore = cliOutput.substring(Math.max(0, blockStart - 500), blockStart);

    let targetPath = extractFilePath(textBefore);
    if (targetPath == null) {
      targetPath = inferPathFromCode(codeContent, language);
    }
    if (targetPath == null) {
      log("FeatureCodeParser: skipping code block with no identifiable target path");
      continue;
    }

    targetPath = targetPath.replace(/\\/g, "/");
    const assumptions = extractAssumptions(codeContent);
    specs.push({ targetPath, language, content: codeContent, assumptions });
  }

  log(`FeatureCodeParser: parsed ${specs.length} file spec(s) from CLI output`);
  return specs;
}

/** Extracts the closest file path label from text preceding a code block. */
export function extractFilePath(textBefore: string): string | null {
  const re = new RegExp(FILE_PATH_PATTERN);
  let lastMatch: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(textBefore)) !== null) {
    for (let i = 1; i < m.length; i++) {
      if (m[i] != null) {
        lastMatch = m[i].trim();
        break;
      }
    }
    // Guard against zero-length matches causing an infinite loop
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return lastMatch;
}

/**
 * Infers a file path from Java/Kotlin source using package + class name.
 */
export function inferPathFromCode(code: string, language: string | null): string | null {
  if (language == null || (language !== "java" && language !== "kotlin")) {
    return null;
  }

  const pkgMatch = code.match(/^package\s+([\w.]+)\s*;?/m);
  const packageName = pkgMatch ? pkgMatch[1] : null;

  const classMatch = code.match(
    /(?:public\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:class|interface|enum|record)\s+(\w+)/m
  );
  const className = classMatch ? classMatch[1] : null;
  if (className == null) return null;

  const ext = language === "java" ? ".java" : ".kt";
  let dir = "src/main/" + language + "/";
  if (packageName != null) {
    dir += packageName.replace(/\./g, "/") + "/";
  }
  return dir + className + ext;
}

/** Extracts all ASSUMPTION comments from code content. */
export function extractAssumptions(code: string): string[] {
  const assumptions: string[] = [];
  const re = new RegExp(ASSUMPTION_PATTERN);
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    assumptions.push(m[1].trim());
  }
  return assumptions;
}
