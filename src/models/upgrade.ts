/**
 * Models ported from com.bmo.devai.intellij.models.upgrade.
 */

/** Information about a project dependency. */
export interface DependencyInfo {
  name: string;
  groupId: string | null;
  artifactId: string | null;
  currentVersion: string;
  /** e.g. "maven", "gradle", "npm", "pip" */
  type: string;
}

export function dependencyInfoLabel(d: DependencyInfo): string {
  return `${d.name} (${d.currentVersion})`;
}

/** Recommendation for upgrading a dependency to a new version. */
export interface UpgradeRecommendation {
  currentDependency: DependencyInfo;
  recommendedVersion: string;
  rationale: string;
  /** Empty list if none detected. */
  breakingChanges: string[];
  /** "LOW", "MEDIUM", "HIGH", "CRITICAL" (case as returned by the model). */
  severity: string;
  /** Empty list if none provided. */
  migrationSteps: string[];
  /** Relative path of manifest file to edit. */
  sourceFile: string;
  /** Exact block to replace. */
  oldDependencyBlock: string;
  /** Replacement block. */
  newDependencyBlock: string;
}

export function recommendationLabel(r: UpgradeRecommendation): string {
  return `${r.currentDependency.name}: ${r.currentDependency.currentVersion} → ${r.recommendedVersion}`;
}

export function recommendationHasBreakingChanges(r: UpgradeRecommendation): boolean {
  return r.breakingChanges.length > 0;
}

export function recommendationHasMigrationSteps(r: UpgradeRecommendation): boolean {
  return r.migrationSteps.length > 0;
}

/**
 * Port of PlatformUpgradePanel.isUpgradeNeeded — true when the current and
 * recommended versions differ (or either is unknown).
 */
export function isUpgradeNeeded(r: UpgradeRecommendation): boolean {
  const current = r.currentDependency.currentVersion;
  const target = r.recommendedVersion;
  if (!current || !target) return true;
  return current.trim().toLowerCase() !== target.trim().toLowerCase();
}
