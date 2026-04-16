import type { GitDiff } from "../types/common.js";
import {
  sanitizeGitDiff,
  shouldSkipFileForAI,
  createPrivacyReport,
  type SanitizedDiff,
} from "../utils/data-sanitization.js";
import { GitDiffSchema } from "../schemas/validation.js";

export interface SkippedFile {
  file: string;
  reason: string;
}

export interface PrivacyReport {
  totalFiles: number;
  sanitizedFiles: number;
  warnings: string[];
}

export interface PrivacyGateResult {
  approvedDiffs: GitDiff[];
  sanitizedDiffs: SanitizedDiff[];
  skippedFiles: SkippedFile[];
  report: PrivacyReport;
}

export const enforcePrivacyGate = (
  diffs: GitDiff[],
  baseDir: string
): PrivacyGateResult => {
  const approvedDiffs: GitDiff[] = [];
  const skippedFiles: SkippedFile[] = [];

  for (const diff of diffs) {
    const skipCheck = shouldSkipFileForAI(diff.file, diff.changes || "");
    if (skipCheck.skip) {
      skippedFiles.push({
        file: diff.file,
        reason: skipCheck.reason ?? "Sensitive content",
      });
      continue;
    }

    const validated = GitDiffSchema.safeParse(diff);
    if (!validated.success) {
      skippedFiles.push({
        file: diff.file,
        reason: `Invalid diff: ${validated.error.issues.map(i => i.message).join(", ")}`,
      });
      continue;
    }

    approvedDiffs.push(validated.data);
  }

  const sanitizedDiffs = approvedDiffs.map(diff =>
    sanitizeGitDiff(diff, baseDir)
  );
  const report = createPrivacyReport(sanitizedDiffs);

  return { approvedDiffs, sanitizedDiffs, skippedFiles, report };
};

export const logPrivacyGateOutcome = (result: PrivacyGateResult): void => {
  for (const skipped of result.skippedFiles) {
    console.warn("--------------------------------");
    console.warn(`⚠️  Skipping ${skipped.file}: ${skipped.reason}`);
  }

  if (result.report.sanitizedFiles > 0) {
    console.warn("--------------------------------");
    console.warn(
      `⚠️  Privacy Notice: ${result.report.sanitizedFiles} files were sanitized before sending to AI`
    );
    if (result.report.warnings.length > 0) {
      console.warn(`⚠️  Warnings: ${result.report.warnings.join(" & ")}`);
    }
  }
  console.warn("--------------------------------");
};
