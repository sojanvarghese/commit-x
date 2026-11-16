import { countChanges, patchBody } from "../utils/diff-lines.js";
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

interface ChangeCounts {
  additions: number;
  deletions: number;
}

export interface DiffTarget {
  file: string;
  relativeFile: string;
}

// Keeps the argument list far below ARG_MAX for long path lists.
const PATCH_BATCH_SIZE = 100;

// Pins the header format (a/ and b/ prefixes, one path per section) so a
// batched patch can be split per file whatever the user's diff config says.
const PATCH_ARGS = [
  "-U0",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];
const SECTION_HEADER = "diff --git ";

export const isBulkFilePath = (relativeFile: string): boolean => {
  const { category } = classifyFile(relativeFile);
  return (
    category === "MINIFIED" ||
    category === "BUILD_ARTIFACT" ||
    category === "LOCK" ||
    category === "GENERATED"
  );
};

export interface StatusIndex {
  untracked: ReadonlySet<string>;
  created: ReadonlySet<string>;
  deleted: ReadonlySet<string>;
  workingDirDeleted: ReadonlySet<string>;
  renamedFromByTo: ReadonlyMap<string, string>;
}

export const indexStatus = (status: RawGitStatus): StatusIndex => {
  const workingDirDeleted = new Set<string>();
  for (const file of status.files ?? []) {
    if (file.working_dir === "D") workingDirDeleted.add(file.path);
  }
  return {
    untracked: new Set(status.not_added),
    created: new Set(status.created),
    deleted: new Set(status.deleted),
    workingDirDeleted,
    renamedFromByTo: new Map(
      status.renamed.map(rename => [rename.to, rename.from])
    ),
  };
};

const buildDiffMetadata = (
  relativeFile: string,
  status: StatusIndex
): Pick<GitDiff, "isNew" | "isDeleted" | "isRenamed" | "oldPath"> => {
  const oldPath = status.renamedFromByTo.get(relativeFile);
  return {
    isNew:
      status.created.has(relativeFile) || status.untracked.has(relativeFile),
    isDeleted:
      status.deleted.has(relativeFile) ||
      status.workingDirDeleted.has(relativeFile),
    isRenamed: oldPath !== undefined,
    ...(oldPath === undefined ? {} : { oldPath }),
  };
};

const emptyDiff = (
  validatedFile: string,
  relativeFile: string,
  status: StatusIndex
): GitDiff => ({
  file: validatedFile,
  additions: 0,
  deletions: 0,
  changes: "",
  ...buildDiffMetadata(relativeFile, status),
});

// Reads the path back out of `diff --git a/<path> b/<path>`. Both sides are
// the same path, so it is split at the midpoint; headers git had to quote
// (non-ASCII or control characters) do not match and return undefined.
const sectionPath = (section: string): string | undefined => {
  if (!section.startsWith(SECTION_HEADER)) return undefined;
  const lineEnd = section.indexOf("\n");
  const header = section.slice(
    SECTION_HEADER.length,
    lineEnd === -1 ? undefined : lineEnd
  );
  const path = header.slice(2, 2 + (header.length - 5) / 2);
  return header === `a/${path} b/${path}` ? path : undefined;
};

// One `git diff` for many files instead of one process per file. Purely an
// optimisation: any file absent from the result is diffed on its own.
export const fetchPatches = async (
  git: SimpleGit,
  relativeFiles: string[]
): Promise<Map<string, string>> => {
  const patches = new Map<string, string>();
  if (relativeFiles.length < 2) return patches;

  for (let i = 0; i < relativeFiles.length; i += PATCH_BATCH_SIZE) {
    const batch = relativeFiles.slice(i, i + PATCH_BATCH_SIZE);
    const output = await withTimeout(
      git.diff([...PATCH_ARGS, "--", ...batch]),
      calculateGitTimeout({ fileCount: batch.length })
    );
    for (const section of output.split(/^(?=diff --git )/m)) {
      const path = sectionPath(section);
      if (path !== undefined) patches.set(path, section);
    }
  }
  return patches;
};

// NUL-delimited numstat preserves filenames and gives exact counts even for
// large patches. Disabling rename detection keeps one path per record.
export const fetchBulkSummaries = async (
  git: SimpleGit,
  relativeFiles: string[]
): Promise<Map<string, ChangeCounts>> => {
  const summaries = new Map<string, ChangeCounts>();
  for (let i = 0; i < relativeFiles.length; i += PATCH_BATCH_SIZE) {
    const batch = relativeFiles.slice(i, i + PATCH_BATCH_SIZE);
    const output = await withTimeout(
      git.raw(["diff", "--no-renames", "--numstat", "-z", "--", ...batch]),
      calculateGitTimeout({ fileCount: batch.length })
    );
    for (const record of output.split("\0")) {
      if (!record) continue;
      const firstTab = record.indexOf("\t");
      const secondTab = record.indexOf("\t", firstTab + 1);
      // Git reports "-" in both count columns for binary files.
      const additions = Number(record.slice(0, firstTab)) || 0;
      const deletions = Number(record.slice(firstTab + 1, secondTab)) || 0;
      summaries.set(record.slice(secondTab + 1), { additions, deletions });
    }
  }
  return summaries;
};

const readUntrackedDiff = async (
  validatedFile: string
): Promise<Pick<GitDiff, "additions" | "deletions" | "changes">> => {
  const fileStats = await lstat(validatedFile);
  if (fileStats.isSymbolicLink()) {
    return {
      additions: 1,
      deletions: 0,
      changes: "Symlink added",
    };
  }
  if (!fileStats.isFile()) {
    return {
      additions: 0,
      deletions: 0,
      changes: "Non-regular file added",
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
    if (bytesRead === 0)
      return { additions: 0, deletions: 0, changes: "Empty file added" };
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
    if (lines.at(-1) === "") lines.pop();
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

export const resolveDiffTarget = (
  file: string,
  repositoryPath: string
): DiffTarget => {
  const pathValidation = validateAndSanitizePath(file, repositoryPath);
  if (!pathValidation.isValid || !pathValidation.sanitizedValue) {
    throw new SecureError(
      pathValidation.error ?? "Invalid file path",
      ErrorType.SECURITY_ERROR,
      { operation: "getFileDiff", file },
      false
    );
  }

  return {
    file: pathValidation.sanitizedValue,
    relativeFile: relative(repositoryPath, pathValidation.sanitizedValue),
  };
};

export const buildFileDiff = async (
  git: SimpleGit,
  { file: validatedFile, relativeFile }: DiffTarget,
  status: StatusIndex,
  patches?: ReadonlyMap<string, string>,
  summaries?: ReadonlyMap<string, ChangeCounts>
): Promise<GitDiff> => {
  if (status.untracked.has(relativeFile)) {
    const untracked = await readUntrackedDiff(validatedFile);
    return {
      file: validatedFile,
      ...untracked,
      isNew: true,
      isDeleted: false,
      isRenamed: false,
    };
  }

  if (isBulkFilePath(relativeFile)) {
    try {
      const counts =
        summaries ?? (await fetchBulkSummaries(git, [relativeFile]));
      const { additions, deletions } = counts.get(relativeFile) ?? {
        additions: 0,
        deletions: 0,
      };
      const label =
        classifyFile(relativeFile).category === "LOCK" ? "Lock" : "Generated";
      return {
        file: validatedFile,
        additions,
        deletions,
        changes: `${label} file updated: +${additions}/-${deletions}`,
        ...buildDiffMetadata(relativeFile, status),
      };
    } catch {
      // Fall back to the patch if Git could not produce a summary.
    }
  }

  try {
    const diff =
      patches?.get(relativeFile) ??
      (await withTimeout(
        git.diff([...PATCH_ARGS, "--", relativeFile]),
        calculateGitTimeout({ diffSize: 0 })
      ));

    const diffValidation = validateDiffSize(diff);

    if (!diffValidation.isValid) {
      throw new SecureError(
        diffValidation.error ?? "Validation failed",
        ErrorType.VALIDATION_ERROR,
        { operation: "getFileDiff", file: validatedFile },
        true
      );
    }

    const changeCounts = countChanges(patchBody(diff.split("\n")));
    return {
      file: validatedFile,
      additions: changeCounts.additions,
      deletions: changeCounts.deletions,
      changes: diffValidation.sanitizedValue ?? "",
      ...buildDiffMetadata(relativeFile, status),
    };
  } catch (error) {
    if (error instanceof SecureError) throw error;
    return emptyDiff(validatedFile, relativeFile, status);
  }
};
