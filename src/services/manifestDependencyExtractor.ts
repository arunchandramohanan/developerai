import * as path from "path";
import { readTextFile, fileExists } from "../util/files";
import { log } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.services.ManifestDependencyExtractor.
 *
 * Scans the project root for known manifest types and returns a set of
 * normalised {@code groupId:artifactId} (Maven/Gradle) or plain package
 * names (npm/pip) that can be matched against Sonatype IQ report components.
 */
export function extractManifestDependencies(projectBasePath: string): Set<string> {
  const deps = new Set<string>();

  const pomXml = path.join(projectBasePath, "pom.xml");
  if (fileExists(pomXml)) addAll(deps, extractFromPom(pomXml));

  const buildGradle = path.join(projectBasePath, "build.gradle");
  const buildGradleKts = path.join(projectBasePath, "build.gradle.kts");
  if (fileExists(buildGradle)) addAll(deps, extractFromGradle(buildGradle));
  if (fileExists(buildGradleKts)) addAll(deps, extractFromGradle(buildGradleKts));

  const packageJson = path.join(projectBasePath, "package.json");
  if (fileExists(packageJson)) addAll(deps, extractFromPackageJson(packageJson));

  const requirementsTxt = path.join(projectBasePath, "requirements.txt");
  if (fileExists(requirementsTxt)) addAll(deps, extractFromRequirements(requirementsTxt));
  const pyprojectToml = path.join(projectBasePath, "pyproject.toml");
  if (fileExists(pyprojectToml)) addAll(deps, extractFromPyproject(pyprojectToml));

  log(`ManifestDependencyExtractor: extracted ${deps.size} dependency identifiers`);
  return deps;
}

function addAll(target: Set<string>, source: Set<string>): void {
  for (const s of source) target.add(s);
}

// ── Maven pom.xml ────────────────────────────────────────────────────
function extractFromPom(pomPath: string): Set<string> {
  const deps = new Set<string>();
  const content = readTextFile(pomPath);
  if (content == null) return deps;
  const depBlock = /<dependency>([\s\S]*?)<\/dependency>/g;
  let block: RegExpExecArray | null;
  while ((block = depBlock.exec(content)) !== null) {
    const g = block[1].match(/<groupId>\s*([^<]+?)\s*<\/groupId>/);
    const a = block[1].match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
    if (g && a) {
      deps.add((g[1] + ":" + a[1]).toLowerCase());
    }
  }
  return deps;
}

// ── Gradle build.gradle / build.gradle.kts ──────────────────────────
const GRADLE_DEP =
  /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor)\s*\(?\s*['"]([^'"]+:[^'"]+)['"]/g;

function extractFromGradle(gradlePath: string): Set<string> {
  const deps = new Set<string>();
  const content = readTextFile(gradlePath);
  if (content == null) return deps;
  const re = new RegExp(GRADLE_DEP);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const parts = m[1].split(":");
    if (parts.length >= 2) {
      deps.add((parts[0] + ":" + parts[1]).toLowerCase());
    }
  }
  return deps;
}

// ── npm package.json ────────────────────────────────────────────────
function extractFromPackageJson(packageJsonPath: string): Set<string> {
  const deps = new Set<string>();
  const content = readTextFile(packageJsonPath);
  if (content == null) return deps;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    collectNpmDeps(root, "dependencies", deps);
    collectNpmDeps(root, "devDependencies", deps);
    collectNpmDeps(root, "peerDependencies", deps);
  } catch {
    /* ignore malformed package.json */
  }
  return deps;
}

function collectNpmDeps(root: Record<string, unknown>, key: string, deps: Set<string>): void {
  const section = root[key];
  if (section && typeof section === "object") {
    for (const name of Object.keys(section as Record<string, unknown>)) {
      deps.add(name.toLowerCase());
    }
  }
}

// ── Python requirements.txt ─────────────────────────────────────────
const REQ_LINE = /^\s*([A-Za-z0-9_][A-Za-z0-9._-]*)/;

function extractFromRequirements(reqPath: string): Set<string> {
  const deps = new Set<string>();
  const content = readTextFile(reqPath);
  if (content == null) return deps;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const m = trimmed.match(REQ_LINE);
    if (m) deps.add(m[1].toLowerCase());
  }
  return deps;
}

// ── Python pyproject.toml (simple extraction) ───────────────────────
const PYPROJECT_DEP = /['"]\s*([A-Za-z0-9_][A-Za-z0-9._-]*)/;

function extractFromPyproject(tomlPath: string): Set<string> {
  const deps = new Set<string>();
  const content = readTextFile(tomlPath);
  if (content == null) return deps;
  let inDeps = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (/^\[.*dependencies.*\]$/i.test(trimmed) || /^dependencies\s*=\s*\[/i.test(trimmed)) {
      inDeps = true;
      continue;
    }
    if (inDeps) {
      if (trimmed.startsWith("[") || (trimmed.includes("=") && !trimmed.includes('"'))) {
        inDeps = false;
        continue;
      }
      const m = trimmed.match(PYPROJECT_DEP);
      if (m) deps.add(m[1].toLowerCase());
    }
  }
  return deps;
}
