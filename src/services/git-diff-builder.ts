import type { SimpleGit } from "simple-git";
import { lstat, open } from "node:fs/promises";
import { relative } from "node:path";
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
import { DEFAULT_LIMITS } from "../constants/security.js";

export type RawGitStatus = Awaited<ReturnType<SimpleGit["status"]>>;

export interface DiffSummaryFile {
  file: string;
  insertions?: number;
  deletions?: number;
}

const toRelativeFilePath = (file: string, repositoryPath: string): string =>
  relative(repositoryPath, file).split("\\").join("/");

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
  status.renamed.some((renamed: { to: string }) => renamed.to === relativeFile);

const isNewFile = (status: RawGitStatus, relativeFile: string): boolean => {
  if (status.created.includes(relativeFile)) return true;
  return status.not_added.includes(relativeFile);
};

const isBulkFilePath = (relativeFile: string): boolean => {
  const { category } = classifyFile(relativeFile);
  return (
    category === "MINIFIED" ||
    category === "BUILD_ARTIFACT" ||
    category === "LOCK"
  );
};

const buildDiffMetadata = (
  relativeFile: string,
  status: RawGitStatus,
  staged: boolean
): Pick<GitDiff, "isNew" | "isDeleted" | "isRenamed" | "oldPath"> => {
  const oldPath = renamedFrom(status, relativeFile);
  const fileStatus = status.files?.find(file => file.path === relativeFile);
  return {
    isNew:
      isNewFile(status, relativeFile) || (staged && fileStatus?.index === "A"),
    isDeleted:
      status.deleted.includes(relativeFile) ||
      (staged ? fileStatus?.index === "D" : fileStatus?.working_dir === "D"),
    isRenamed: isRenamedTo(status, relativeFile),
    ...(oldPath === undefined ? {} : { oldPath }),
  };
};

const buildSummaryDiff = (
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus,
  fileSummary: DiffSummaryFile | undefined,
  changesLabel: string,
  staged: boolean
): GitDiff => ({
  file: validatedFile,
  additions: fileSummary?.insertions ?? 0,
  deletions: fileSummary?.deletions ?? 0,
  changes: changesLabel,
  ...buildDiffMetadata(relativeFile, status, staged),
});

const emptyDiff = (
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus,
  staged: boolean
): GitDiff => ({
  file: validatedFile,
  additions: 0,
  deletions: 0,
  changes: "",
  ...buildDiffMetadata(relativeFile, status, staged),
});

const handleBulkFile = async (
  git: SimpleGit,
  validatedFile: string,
  relativeFile: string,
  status: RawGitStatus,
  staged: boolean
): Promise<GitDiff | null> => {
  const summaryArgs = staged
    ? ["--cached", "--", relativeFile]
    : ["--", relativeFile];
  const summaryTimeout = calculateGitTimeout({ diffSize: 0 });
  try {
    const diffSummary = await withTimeout(
      git.diffSummary(summaryArgs),
      summaryTimeout
    );
    const fileSummary = findFileSummary(
      diffSummary,
      relativeFile,
      validatedFile
    );
    const additions = fileSummary?.insertions ?? 0;
    const deletions = fileSummary?.deletions ?? 0;

    const { category } = classifyFile(relativeFile);
    return buildSummaryDiff(
      validatedFile,
      relativeFile,
      status,
      fileSummary,
      category === "LOCK"
        ? `Lock file updated: +${additions}/-${deletions}`
        : `Generated file updated: +${additions}/-${deletions}`,
      staged
    );
  } catch {
    return null;
  }
};

const countPatchChanges = (
  diff: string
): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
};

const readUntrackedDiff = async (
  validatedFile: string,
  relativeFile: string
): Promise<Pick<GitDiff, "additions" | "deletions" | "changes">> => {
  const fileStats = await lstat(validatedFile);
  if (fileStats.isSymbolicLink()) {
    return {
      additions: 1,
      deletions: 0,
      changes: `Symlink added: ${relativeFile}`,
    };
  }
  if (!fileStats.isFile()) {
    return {
      additions: 0,
      deletions: 0,
      changes: `Non-regular file added: ${relativeFile}`,
    };
  }
  if (fileStats.size > DEFAULT_LIMITS.maxFileSize) {
    return {
      additions: 0,
      deletions: 0,
      changes: `Large file added (${fileStats.size} bytes; content omitted)`,
    };
  }

  const handle = await open(validatedFile, "r");
  try {
    // Prefixing every line with "+" can nearly double newline-heavy input.
    const bytesToRead = Math.min(
      fileStats.size,
      Math.floor(DEFAULT_LIMITS.maxDiffSize / 2)
    );
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const content = buffer.subarray(0, bytesRead);
    if (content.includes(0)) {
      return {
        additions: 0,
        deletions: 0,
        changes: `Binary file added (${fileStats.size} bytes; content omitted)`,
      };
    }

    const text = content.toString("utf8");
    const lines = text.split("\n");
    const truncated = fileStats.size > bytesRead;
    return {
      additions: lines.length,
      deletions: 0,
      changes: [
        ...lines.map(line => `+${line}`),
        ...(truncated ? ["+[content truncated]"] : []),
      ].join("\n"),
    };
  } finally {
    await handle.close();
  }
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

  if (status.not_added.includes(relativeFile) && !staged) {
    const untracked = await readUntrackedDiff(validatedFile, relativeFile);
    return {
      file: validatedFile,
      ...untracked,
      isNew: true,
      isDeleted: false,
      isRenamed: false,
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
    ? ["--cached", "-U0", "--", relativeFile]
    : ["-U0", "--", relativeFile];
  const diffTimeout = calculateGitTimeout({ diffSize: 0 });

  try {
    const diff = await withTimeout(git.diff(diffArgs), diffTimeout);

    const diffValidation = validateDiffSize(diff);

    if (!diffValidation.isValid) {
      throw new SecureError(
        diffValidation.error ?? "Validation failed",
        ErrorType.VALIDATION_ERROR,
        { operation: "getFileDiff", file: validatedFile },
        true
      );
    }

    const changeCounts = countPatchChanges(diff);
    return {
      file: validatedFile,
      additions: changeCounts.additions,
      deletions: changeCounts.deletions,
      changes: diffValidation.sanitizedValue ?? "",
      ...buildDiffMetadata(relativeFile, status, staged),
    };
  } catch (error) {
    if (error instanceof SecureError) throw error;
    return emptyDiff(validatedFile, relativeFile, status, staged);
  }
};
