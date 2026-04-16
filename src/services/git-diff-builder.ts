import type { SimpleGit } from "simple-git";
import { readFile } from "fs/promises";
import type { GitDiff } from "../types/common.js";
import {
  validateAndSanitizePath,
  validateDiffSize,
  withTimeout,
} from "../utils/security.js";
import { ErrorType } from "../types/error-handler.js";
import { SecureError } from "../utils/error-handler.js";
import { calculateGitTimeout } from "../utils/timeout.js";
import { classifyFile } from "../utils/file-classifier.js";

export type RawGitStatus = Awaited<ReturnType<SimpleGit["status"]>>;

export interface DiffSummaryFile {
  file: string;
  insertions?: number;
  deletions?: number;
}

const toRelativeFilePath = (file: string, repositoryPath: string): string =>
  file.startsWith(repositoryPath)
    ? file.substring(repositoryPath.length + 1)
    : file;

const findFileSummary = (
  diffSummary: { files: DiffSummaryFile[] },
  relativeFile: string,
  validatedFile: string
): DiffSummaryFile | undefined =>
  diffSummary.files.find(
    summary =>
      summary.file === relativeFile ||
      summary.file === validatedFile ||
      summary.file.endsWith(`/${relativeFile}`)
  );

const renamedFrom = (
  status: RawGitStatus,
  relativeFile: string
): string | undefined =>
  status.renamed.find(
    (renamed: { to: string; from: string }) => renamed.to === relativeFile
  )?.from;

const isRenamedTo = (status: RawGitStatus, relativeFile: string): boolean =>
  status.renamed.some(
    (renamed: { to: string }) => renamed.to === relativeFile
  );

const isNewFile = (status: RawGitStatus, relativeFile: string): boolean => {
  if (status.created.includes(relativeFile)) return true;
  return status.not_added.includes(relativeFile);
};

const isBulkFilePath = (relativeFile: string): boolean => {
  const { category } = classifyFile(relativeFile);
  return category === "MINIFIED" || category === "BUILD_ARTIFACT";
};

const buildSummaryDiff = (
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus,
  fileSummary: DiffSummaryFile | undefined,
  changesLabel: string
): GitDiff => ({
  file: validatedFile,
  additions: fileSummary?.insertions ?? 0,
  deletions: fileSummary?.deletions ?? 0,
  changes: changesLabel,
  isNew: isNewFile(status, relativeFile),
  isDeleted: status.deleted.includes(relativeFile),
  isRenamed: isRenamedTo(status, relativeFile),
  oldPath: renamedFrom(status, relativeFile),
});

const emptyDiff = (
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus
): GitDiff => ({
  file: validatedFile,
  additions: 0,
  deletions: 0,
  changes: "",
  isNew: isNewFile(status, relativeFile),
  isDeleted: status.deleted.includes(relativeFile),
  isRenamed: isRenamedTo(status, relativeFile),
  oldPath: renamedFrom(status, relativeFile),
});

const handleBulkFile = async (
  git: SimpleGit,
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus,
  staged: boolean
): Promise<GitDiff | null> => {
  const summaryArgs = staged ? ["--cached", validatedFile] : [validatedFile];
  const summaryTimeout = calculateGitTimeout({ diffSize: 0 });
  try {
    const diffSummary = await withTimeout(
      git.diffSummary(summaryArgs),
      summaryTimeout
    );
    const fileSummary = findFileSummary(diffSummary, relativeFile, validatedFile);
    const additions = fileSummary?.insertions ?? 0;
    const deletions = fileSummary?.deletions ?? 0;

    return buildSummaryDiff(
      validatedFile,
      relativeFile,
      status,
      fileSummary,
      `Generated file updated: +${additions}/-${deletions}`
    );
  } catch {
    return null;
  }
};

const handleLockFileFallback = (
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus,
  fileSummary: DiffSummaryFile | undefined
): GitDiff => {
  const additions = fileSummary?.insertions ?? 0;
  const deletions = fileSummary?.deletions ?? 0;
  return buildSummaryDiff(
    validatedFile,
    relativeFile,
    status,
    fileSummary,
    `Lock file updated: ${additions} additions, ${deletions} deletions`
  );
};

export const buildFileDiff = async (
  git: SimpleGit,
  file: string,
  repositoryPath: string,
  status: RawGitStatus,
  staged: boolean = false
): Promise<GitDiff> => {
  const pathValidation = validateAndSanitizePath(file, repositoryPath);
  if (!pathValidation.isValid || !pathValidation.sanitizedValue) {
    throw new SecureError(
      pathValidation.error ?? "Invalid file path",
      ErrorType.SECURITY_ERROR,
      { operation: "getFileDiff", file },
      false
    );
  }

  const validatedFile = pathValidation.sanitizedValue;
  const relativeFile = toRelativeFilePath(file, repositoryPath);

  if (status.deleted.includes(relativeFile) && !staged) {
    return {
      file: validatedFile,
      additions: 0,
      deletions: 1,
      changes: `File deleted: ${validatedFile}`,
      isNew: false,
      isDeleted: true,
      isRenamed: false,
      oldPath: undefined,
    };
  }

  if (status.not_added.includes(relativeFile) && !staged) {
    const fileContent = await readFile(validatedFile, "utf-8");
    const lines = fileContent.split("\n").length;
    return {
      file: validatedFile,
      additions: lines,
      deletions: 0,
      changes: `+${fileContent}`,
      isNew: true,
      isDeleted: false,
      isRenamed: false,
      oldPath: undefined,
    };
  }

  if (isBulkFilePath(relativeFile)) {
    const bulkResult = await handleBulkFile(
      git,
      validatedFile,
      relativeFile,
      status,
      staged
    );
    if (bulkResult) return bulkResult;
  }

  const diffArgs = staged
    ? ["--cached", "-U0", validatedFile]
    : ["-U0", validatedFile];
  const diffTimeout = calculateGitTimeout({ diffSize: 0 });

  try {
    const [diff, diffSummary] = await Promise.all([
      withTimeout(git.diff(diffArgs), diffTimeout),
      withTimeout(git.diffSummary([validatedFile]), diffTimeout),
    ]);

    const diffValidation = validateDiffSize(diff);
    const fileSummary = findFileSummary(diffSummary, relativeFile, validatedFile);

    if (!diffValidation.isValid) {
      const { category } = classifyFile(relativeFile);
      if (category === "LOCK") {
        return handleLockFileFallback(
          validatedFile,
          relativeFile,
          status,
          fileSummary
        );
      }

      throw new SecureError(
        diffValidation.error ?? "Validation failed",
        ErrorType.VALIDATION_ERROR,
        { operation: "getFileDiff", file: validatedFile },
        true
      );
    }

    return {
      file: validatedFile,
      additions: fileSummary?.insertions ?? 0,
      deletions: fileSummary?.deletions ?? 0,
      changes: diffValidation.sanitizedValue ?? "",
      isNew: isNewFile(status, relativeFile),
      isDeleted: status.deleted.includes(relativeFile),
      isRenamed: isRenamedTo(status, relativeFile),
      oldPath: renamedFrom(status, relativeFile),
    };
  } catch {
    return emptyDiff(validatedFile, relativeFile, status);
  }
};

export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let currentIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const runners = Array.from({ length: workerCount }, async () => {
    while (currentIndex < items.length) {
      const itemIndex = currentIndex++;
      results[itemIndex] = await worker(items[itemIndex]);
    }
  });

  await Promise.all(runners);

  return results;
};
