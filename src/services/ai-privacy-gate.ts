import type { GitDiff } from "../types/common.js";
import * as v from "valibot";
import {
  sanitizeGitDiff,
  shouldSkipFileForAI,
  createPrivacyReport,
  type PrivacyReport,
  type SanitizedDiff,
} from "../utils/data-sanitization.js";
import { GitDiffSchema } from "../schemas/validation.js";

export interface SkippedFile {
  file: string;
  reason: string;
}

export type { PrivacyReport };

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

    const validated = v.safeParse(GitDiffSchema, diff);
    if (!validated.success) {
      skippedFiles.push({
        file: diff.file,
        reason: `Invalid diff: ${validated.issues.map(i => i.message).join(", ")}`,
      });
      continue;
    }

    const { oldPath, ...validatedDiff } = validated.output;
    approvedDiffs.push({
      ...validatedDiff,
      ...(oldPath === undefined ? {} : { oldPath }),
    });
  }

  const sanitizedDiffs = approvedDiffs.map(diff =>
    sanitizeGitDiff(diff, baseDir)
  );
  const report = createPrivacyReport(sanitizedDiffs);

  return { approvedDiffs, sanitizedDiffs, skippedFiles, report };
};

export const logPrivacyGateOutcome = (result: PrivacyGateResult): void => {
  for (const skipped of result.skippedFiles) {
    console.warn(`⚠️  Skipping ${skipped.file}: ${skipped.reason} \n`);
  }

  if (result.report.sanitizedFiles > 0) {
    console.warn(
      `⚠️  Privacy Notice: ${result.report.sanitizedFiles} files were sanitized before sending to AI \n`
    );
    if (result.report.warnings.length > 0) {
      console.warn(`⚠️  Warnings: ${result.report.warnings.join(" & ")} \n`);
    }
  }
};
