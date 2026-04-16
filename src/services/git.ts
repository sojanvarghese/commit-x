import simpleGit, { type SimpleGit } from "simple-git";
import { access } from "fs/promises";
import type { GitDiff, GitStatus } from "../types/common.js";
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
import { ERROR_MESSAGES } from "../constants/messages.js";
import { UI_CONSTANTS } from "../constants/ui.js";
import { GitCache, type RepoInfo } from "./git-cache.js";
import {
  buildFileDiff,
  mapWithConcurrency,
  type RawGitStatus,
} from "./git-diff-builder.js";

const DIFF_COLLECTION_CONCURRENCY = 4;

export class GitService {
  private readonly git: SimpleGit;
  private repositoryPath: string;
  private readonly cache: GitCache;

  constructor() {
    this.git = simpleGit();
    this.repositoryPath = process.cwd();
    this.cache = new GitCache();
  }

  private async getRawStatus(): Promise<RawGitStatus> {
    return withTimeout(this.git.status(), calculateGitTimeout({}));
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

  private readonly collectDiffs = async (
    files: string[],
    status: RawGitStatus,
    staged: boolean = false
  ): Promise<GitDiff[]> => {
    const results = await mapWithConcurrency(
      files,
      DIFF_COLLECTION_CONCURRENCY,
      async file => {
        try {
          return await buildFileDiff(
            this.git,
            file,
            this.repositoryPath,
            status,
            staged
          );
        } catch (error) {
          console.warn(`Failed to get diff for ${file}:`, error);
          return null;
        }
      }
    );
    return results.filter((diff): diff is GitDiff => diff !== null);
  };

  private async initializeRepositoryPath(): Promise<void> {
    const validation = await validateGitRepository(this.repositoryPath);
    if (validation.isValid && validation.sanitizedValue) {
      this.repositoryPath = validation.sanitizedValue;
      process.chdir(this.repositoryPath);
    }
  }

  isGitRepository = async (): Promise<boolean> => {
    return withErrorHandling(
      async () => {
        await this.initializeRepositoryPath();
        const validation = await validateGitRepository(this.repositoryPath);
        if (!validation.isValid) {
          throw new SecureError(
            `Git repository validation failed for path: ${this.repositoryPath}\nError: ${validation.error}`,
            ErrorType.GIT_ERROR,
            { operation: "isGitRepository" },
            false
          );
        }
        return true;
      },
      { operation: "isGitRepository" }
    );
  };

  getStatus = async (): Promise<GitStatus> => {
    return withErrorHandling(
      async () => {
        const cached = this.cache.getStatus();
        if (cached) return cached;

        const rawStatus = await this.getRawStatus();
        const staged = this.validateFilePaths(rawStatus.staged);
        const unstaged = this.validateFilePaths(rawStatus.modified);
        const untracked = this.validateFilePaths(rawStatus.not_added);
        const result: GitStatus = {
          staged,
          unstaged,
          untracked,
          total: staged.length + unstaged.length + untracked.length,
        };
        this.cache.setStatus(result);
        return result;
      },
      { operation: "getStatus" }
    );
  };

  getUnstagedFiles = async (): Promise<string[]> => {
    return withErrorHandling(
      async () => {
        const status = await this.getRawStatus();
        const allFiles = [
          ...status.modified,
          ...status.not_added,
          ...status.deleted,
        ];
        return this.validateFilePaths(allFiles);
      },
      { operation: "getUnstagedFiles" }
    );
  };

  getFileDiff = async (
    file: string,
    staged: boolean = false
  ): Promise<GitDiff> => {
    return withErrorHandling(
      async () =>
        buildFileDiff(
          this.git,
          file,
          this.repositoryPath,
          await this.getRawStatus(),
          staged
        ),
      { operation: "getFileDiff", file }
    );
  };

  getFileDiffs = async (
    files: string[],
    staged: boolean = false
  ): Promise<GitDiff[]> => {
    return withErrorHandling(
      async () => {
        const validatedFiles = this.validateFilePaths(files);
        if (validatedFiles.length === 0) return [];
        return this.collectDiffs(
          validatedFiles,
          await this.getRawStatus(),
          staged
        );
      },
      { operation: "getFileDiffs" }
    );
  };

  getStagedDiff = async (): Promise<GitDiff[]> => {
    return withErrorHandling(
      async () => {
        const status = await this.getRawStatus();
        if (status.staged.length === 0) {
          throw new SecureError(
            ERROR_MESSAGES.NO_STAGED_CHANGES,
            ErrorType.GIT_ERROR,
            { operation: "getStagedDiff" },
            true
          );
        }
        const validatedFiles = this.validateFilePaths(status.staged);
        return this.collectDiffs(validatedFiles, status, true);
      },
      { operation: "getStagedDiff" }
    );
  };

  getChangesSummary = async (): Promise<string> => {
    const status = await this.getRawStatus();
    const unstagedFiles = [
      ...status.modified,
      ...status.not_added,
      ...status.deleted,
    ];

    if (unstagedFiles.length === 0) return "No unstaged changes found.";

    const validatedFiles = this.validateFilePaths(unstagedFiles);
    const diffs = await this.collectDiffs(validatedFiles, status, false);

    if (diffs.length === 0) return "No valid changes found.";

    const totalAdditions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
    const totalDeletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

    const fileLines = diffs
      .map(
        diff =>
          `- ${this.getFileStatus(diff)} ${diff.file} (+${diff.additions}/-${diff.deletions})`
      )
      .join("\n");

    return [
      "Changes summary:",
      `- ${diffs.length} file(s) modified`,
      `- ${totalAdditions} line(s) added`,
      `- ${totalDeletions} line(s) deleted`,
      "",
      "Files:",
      fileLines,
      "",
    ].join("\n");
  };

  stageAll = async (): Promise<void> => {
    return withErrorHandling(
      async () => {
        await withTimeout(this.git.add("."), calculateGitTimeout({}));
        this.cache.clear();
      },
      { operation: "stageAll" }
    );
  };

  stageFile = async (
    file: string,
    timeoutOptions?: Omit<TimeoutCalculationOptions, "operationType">
  ): Promise<void> => {
    return withErrorHandling(
      async () => {
        const pathValidation = validateAndSanitizePath(
          file,
          this.repositoryPath
        );
        if (!pathValidation.isValid || !pathValidation.sanitizedValue) {
          throw new SecureError(
            pathValidation.error ?? "Invalid file path",
            ErrorType.SECURITY_ERROR,
            { operation: "stageFile", file },
            false
          );
        }
        await withTimeout(
          this.git.add(pathValidation.sanitizedValue),
          calculateGitTimeout(timeoutOptions ?? {})
        );
        this.cache.clear();
      },
      { operation: "stageFile", file }
    );
  };

  stageFiles = async (
    files: string[],
    timeoutOptions?: Omit<TimeoutCalculationOptions, "operationType">
  ): Promise<void> => {
    return withErrorHandling(
      async () => {
        const sanitizedFiles = files
          .map(
            file =>
              validateAndSanitizePath(file, this.repositoryPath).sanitizedValue
          )
          .filter((file): file is string => Boolean(file));

        if (sanitizedFiles.length === 0) {
          throw new SecureError(
            "No valid files to stage",
            ErrorType.SECURITY_ERROR,
            { operation: "stageFiles" },
            false
          );
        }

        await withTimeout(
          this.git.add(sanitizedFiles),
          calculateGitTimeout(timeoutOptions ?? {})
        );
        this.cache.clear();
      },
      { operation: "stageFiles" }
    );
  };

  commit = async (
    message: string,
    timeoutOptions?: Omit<TimeoutCalculationOptions, "operationType">
  ): Promise<void> => {
    return withErrorHandling(
      async () => {
        const messageValidation = validateCommitMessage(message);
        if (!messageValidation.isValid || !messageValidation.sanitizedValue) {
          throw new SecureError(
            messageValidation.error ?? "Invalid commit message",
            ErrorType.VALIDATION_ERROR,
            { operation: "commit" },
            true
          );
        }
        await withTimeout(
          this.git.commit(messageValidation.sanitizedValue),
          calculateGitTimeout(timeoutOptions ?? {})
        );
        this.cache.clear();
      },
      { operation: "commit" }
    );
  };

  getLastCommitMessage = async (): Promise<string | null> => {
    try {
      const log = await this.git.log({ maxCount: 1 });
      return log.latest?.message ?? null;
    } catch {
      return null;
    }
  };

  getRepoInfo = async (): Promise<RepoInfo> => {
    const cached = this.cache.getRepoInfo();
    if (cached) return cached;

    const status = await this.getRawStatus();
    const remotes = await this.git.getRemotes(true);

    let repoName = "unknown";
    if (remotes.length > 0) {
      const origin = remotes.find(
        (r: { name: string; refs?: { fetch?: string } }) => r.name === "origin"
      );
      if (origin?.refs?.fetch) {
        const match = origin.refs.fetch.match(/\/([^/]+?)(?:\.git)?$/);
        if (match) {
          repoName = match[1];
        }
      }
    }

    const result: RepoInfo = { name: repoName, branch: status.current };
    this.cache.setRepoInfo(result);
    return result;
  };

  private readonly getFileStatus = (diff: GitDiff): string => {
    switch (true) {
      case diff.isNew:
        return UI_CONSTANTS.FILE_STATUS.NEW;
      case diff.isDeleted:
        return UI_CONSTANTS.FILE_STATUS.DELETED;
      case diff.isRenamed:
        return UI_CONSTANTS.FILE_STATUS.RENAMED;
      default:
        return UI_CONSTANTS.FILE_STATUS.MODIFIED;
    }
  };

  waitForLockRelease = async (maxWaitMs: number = 250): Promise<void> => {
    const lockPath = `${this.repositoryPath}/.git/index.lock`;
    const checkInterval = 10;
    const maxChecks = Math.floor(maxWaitMs / checkInterval);

    for (let i = 0; i < maxChecks; i++) {
      try {
        await access(lockPath);
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch {
        await new Promise(resolve => setTimeout(resolve, 5));
        return;
      }
    }

    console.warn("⚠️  Git lock file persisted longer than expected");
  };
}
