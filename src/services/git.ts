import { simpleGit, type SimpleGit } from "simple-git";
import { resolve } from "node:path";
import type { GitDiff } from "../types/common.js";
import {
  validateAndSanitizePath,
  withTimeout,
  validateGitRepository,
  validateCommitMessage,
} from "../utils/security.js";
import { ErrorType } from "../types/error-handler.js";
import { withErrorHandling, SecureError } from "../utils/error-handler.js";
import {
  calculateGitTimeout,
  type TimeoutCalculationOptions,
} from "../utils/timeout.js";
import {
  buildFileDiff,
  fetchPatches,
  needsPatch,
  resolveDiffTarget,
  type DiffTarget,
  type RawGitStatus,
} from "./git-diff-builder.js";
import { mapWithConcurrency } from "../utils/request-batcher.js";

const DIFF_COLLECTION_CONCURRENCY = 4;
const STATUS_CACHE_TTL_MS = 5000;

type GitTimeoutOptions = Omit<TimeoutCalculationOptions, "operationType">;

// Every path with working-tree changes, listed once.
const changedPaths = (status: RawGitStatus): string[] => [
  ...new Set([
    ...status.modified,
    ...status.not_added,
    ...status.deleted,
    ...status.renamed.map(rename => rename.to),
  ]),
];

export class GitService {
  private git: SimpleGit;
  private repositoryPath: string;
  private statusSnapshot: { status: RawGitStatus; takenAt: number } | undefined;

  constructor(repositoryPath: string = process.cwd()) {
    this.repositoryPath = resolve(repositoryPath);
    this.git = simpleGit({ baseDir: this.repositoryPath });
  }

  // Failures with no recognisable cause are git failures by construction.
  private readonly run = <T>(
    operation: string,
    action: () => Promise<T>,
    file?: string
  ): Promise<T> =>
    withErrorHandling(
      action,
      file === undefined ? { operation } : { operation, file },
      ErrorType.GIT_ERROR
    );

  private async getRawStatus(): Promise<RawGitStatus> {
    const snapshot = this.statusSnapshot;
    if (snapshot && Date.now() - snapshot.takenAt < STATUS_CACHE_TTL_MS) {
      return snapshot.status;
    }
    const status = await withTimeout(
      this.git.status(),
      calculateGitTimeout({})
    );
    this.statusSnapshot = { status, takenAt: Date.now() };
    return status;
  }

  private readonly validateFilePaths = (filePaths: string[]): string[] => {
    const validPaths: string[] = [];
    for (const filePath of filePaths) {
      const validation = validateAndSanitizePath(filePath, this.repositoryPath);
      if (validation.isValid && validation.sanitizedValue) {
        validPaths.push(validation.sanitizedValue);
      } else {
        console.warn(
          `Skipping invalid file path: ${filePath} - ${validation.error}`
        );
      }
    }
    return validPaths;
  };

  private readonly requireValidPaths = (
    files: string[],
    operation: string
  ): string[] =>
    files.map(file => {
      const validation = validateAndSanitizePath(file, this.repositoryPath);
      if (!validation.isValid || !validation.sanitizedValue) {
        throw new SecureError(
          validation.error ?? `Invalid file path: ${file}`,
          ErrorType.SECURITY_ERROR,
          { operation, file },
          false
        );
      }
      return validation.sanitizedValue;
    });

  // Compares the index with HEAD only, which is far cheaper than a status
  // (that also scans the working tree).
  private readonly hasStagedChanges = async (): Promise<boolean> => {
    const stagedNames = await withTimeout(
      this.git.diff(["--cached", "--name-only"]),
      calculateGitTimeout({})
    );
    return stagedNames.trim() !== "";
  };

  // Paths are validated here, once; invalid ones are skipped with a warning.
  private readonly collectDiffs = async (
    files: string[],
    status: RawGitStatus
  ): Promise<GitDiff[]> => {
    const skip = (file: string, error: unknown): null => {
      console.warn(`Failed to get diff for ${file}:`, error);
      return null;
    };

    const targets = files.flatMap((file): DiffTarget[] => {
      try {
        return [resolveDiffTarget(file, this.repositoryPath)];
      } catch (error) {
        skip(file, error);
        return [];
      }
    });

    const patches = await fetchPatches(
      this.git,
      targets
        .map(target => target.relativeFile)
        .filter(relativeFile => needsPatch(relativeFile, status))
    ).catch(() => undefined);

    const results = await mapWithConcurrency(
      targets,
      DIFF_COLLECTION_CONCURRENCY,
      async target => {
        try {
          return await buildFileDiff(this.git, target, status, patches);
        } catch (error) {
          return skip(target.file, error);
        }
      }
    );
    return results.filter((diff): diff is GitDiff => diff !== null);
  };

  // Also re-roots the service at the repository's top level.
  isGitRepository = async (): Promise<boolean> => {
    const validation = await validateGitRepository(this.repositoryPath);
    if (!validation.isValid || !validation.sanitizedValue) return false;
    this.repositoryPath = validation.sanitizedValue;
    this.git = simpleGit({ baseDir: this.repositoryPath });
    return true;
  };

  getUnstagedFiles = async (): Promise<string[]> =>
    this.run("getUnstagedFiles", async () =>
      this.validateFilePaths(changedPaths(await this.getRawStatus()))
    );

  getFileDiff = async (file: string): Promise<GitDiff> =>
    this.run(
      "getFileDiff",
      async () =>
        buildFileDiff(
          this.git,
          resolveDiffTarget(file, this.repositoryPath),
          await this.getRawStatus()
        ),
      file
    );

  getFileDiffs = async (files: string[]): Promise<GitDiff[]> =>
    this.run("getFileDiffs", async () => {
      if (files.length === 0) return [];
      return this.collectDiffs(files, await this.getRawStatus());
    });

  stageFiles = async (
    files: string[],
    timeoutOptions?: GitTimeoutOptions
  ): Promise<void> =>
    this.run("stageFiles", async () => {
      if (await this.hasStagedChanges()) {
        throw new SecureError(
          "Cannot stage an intelligent commit group while the Git index contains other changes.",
          ErrorType.GIT_ERROR,
          { operation: "stageFiles" },
          true
        );
      }

      if (files.length === 0) {
        throw new SecureError(
          "Every requested file must be valid before staging",
          ErrorType.SECURITY_ERROR,
          { operation: "stageFiles" },
          false
        );
      }

      await withTimeout(
        this.git.add(this.requireValidPaths(files, "stageFiles")),
        calculateGitTimeout(timeoutOptions ?? {})
      );
      this.statusSnapshot = undefined;
    });

  unstageFiles = async (
    files: string[],
    timeoutOptions?: GitTimeoutOptions
  ): Promise<void> =>
    this.run("unstageFiles", async () => {
      const validatedFiles = this.requireValidPaths(files, "unstageFiles");
      if (validatedFiles.length === 0) return;
      await withTimeout(
        this.git.reset(["--", ...validatedFiles]),
        calculateGitTimeout(timeoutOptions ?? {})
      );
      this.statusSnapshot = undefined;
    });

  assertCleanIndexForBatch = async (): Promise<void> => {
    const status = await this.getRawStatus();
    if (status.staged.length > 0) {
      throw new SecureError(
        "Intelligent multi-commit mode requires an empty Git index. Commit or unstage existing staged changes first.",
        ErrorType.GIT_ERROR,
        { operation: "assertCleanIndexForBatch" },
        true
      );
    }
  };

  commit = async (
    message: string,
    timeoutOptions?: GitTimeoutOptions
  ): Promise<void> =>
    this.run("commit", async () => {
      const messageValidation = validateCommitMessage(message);
      if (!messageValidation.isValid || !messageValidation.sanitizedValue) {
        throw new SecureError(
          messageValidation.error ?? "Invalid commit message",
          ErrorType.VALIDATION_ERROR,
          { operation: "commit" },
          true
        );
      }
      const result = await withTimeout(
        this.git.commit(messageValidation.sanitizedValue),
        calculateGitTimeout(timeoutOptions ?? {})
      );
      this.statusSnapshot = undefined;

      // A hook that exits non-zero without writing to stderr is reported by
      // simple-git as success, with no commit hash.
      if (!result.commit) {
        throw new SecureError(
          "Git did not create a commit; a hook may have rejected it.",
          ErrorType.GIT_ERROR,
          { operation: "commit" },
          true
        );
      }
    });
}
