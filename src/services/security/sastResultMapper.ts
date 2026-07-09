import {
  RemediationResult,
  RemediationStatus,
  SastFinding,
} from "../../models/security";
import { StoreEntry } from "./sastFindingsStore";

/**
 * Port of com.bmo.devai.intellij.util.SastResultMapper.
 * Converts StoreEntry objects into RemediationResults / SastFindings.
 */
export class SastResultMapper {
  /** Reconstruct a SastFinding from a persisted store entry. */
  static toFinding(e: StoreEntry): SastFinding {
    return {
      key: e.key,
      component: null,
      filePath: e.filePath,
      line: e.line,
      rule: e.rule,
      severity: e.severity,
      type: e.type,
      message: e.message,
      status: null,
    };
  }

  /** Build a single result with the given status and message. */
  static result(e: StoreEntry, status: RemediationStatus, message: string): RemediationResult {
    return { finding: SastResultMapper.toFinding(e), severity: e.severity, status, message };
  }

  /** Map every entry to a result with the same status + message. */
  static allWith(entries: StoreEntry[], status: RemediationStatus, message: string): RemediationResult[] {
    return entries.map((e) => SastResultMapper.result(e, status, message));
  }

  /** Convenience for wrapping a uniform failure across all entries. */
  static allFailed(entries: StoreEntry[], reason: string): RemediationResult[] {
    return SastResultMapper.allWith(entries, RemediationStatus.FAILED, reason);
  }
}
