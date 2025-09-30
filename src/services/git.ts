import simpleGit, { type SimpleGit } from 'simple-git';
import type { GitDiff, GitStatus } from '../types/common.js';
import {
  validateAndSanitizePath,
  validateDiffSize,
  withTimeout,
  validateGitRepository,
  validateCommitMessage,
} from '../utils/security.js';
import { ErrorType } from '../types/error-handler.js';
import { ErrorHandler, withErrorHandling, SecureError } from '../utils/error-handler.js';
import { calculateGitTimeout } from '../utils/timeout.js';
import { ERROR_MESSAGES } from '../constants/messages.js';
import { UI_CONSTANTS } from '../constants/ui.js';

// Simple cache for Git operations
interface GitCache {
  status?: { data: GitStatus; timestamp: number };
  repoInfo?: { data: { name: string; branch: string }; timestamp: number };
}

export class GitService {
  private readonly git: SimpleGit;
  private readonly errorHandler: ErrorHandler;
  private repositoryPath: string;
  private cache: GitCache = {};
  private readonly CACHE_TTL_MS = 5000; // 5 seconds cache TTL

  constructor() {
    this.git = simpleGit();
    this.errorHandler = ErrorHandler.getInstance();
    this.repositoryPath = process.cwd();
  }

  private isCacheValid<T>(cacheEntry?: { data: T; timestamp: number }): cacheEntry is { data: T; timestamp: number } {
    if (!cacheEntry) return false;
    return Date.now() - cacheEntry.timestamp < this.CACHE_TTL_MS;
  }

  private clearCache(): void {
    this.cache = {};
  }

  // Initialize the repository path by finding the actual git root
  private async initializeRepositoryPath(): Promise<void> {
    const validation = await validateGitRepository(this.repositoryPath);
    if (validation.isValid && validation.sanitizedValue) {
      this.repositoryPath = validation.sanitizedValue;
      // Change working directory to the git repository root
      process.chdir(this.repositoryPath);
    }
  }

  isGitRepository = async (): Promise<boolean> => {
    return withErrorHandling(
      async () => {
        // Initialize repository path to find the actual git root
        await this.initializeRepositoryPath();

        const validation = await validateGitRepository(this.repositoryPath);
        if (!validation.isValid) {
          // Provide more detailed error information
          const errorMessage = `Git repository validation failed for path: ${this.repositoryPath}\nError: ${validation.error}`;
          throw new SecureError(
            errorMessage,
            ErrorType.GIT_ERROR,
            { operation: 'isGitRepository' },
            false
          );
        }
        return true;
      },
      { operation: 'isGitRepository' }
    );
  };

  getStatus = async (): Promise<GitStatus> => {
    return withErrorHandling(
      async () => {
        // Check cache first
        if (this.isCacheValid(this.cache.status)) {
          return this.cache.status.data;
        }

        const status = await withTimeout(this.git.status(), calculateGitTimeout({}));

        const staged = this.validateFilePaths(status.staged);
        const unstaged = this.validateFilePaths(status.modified);
        const untracked = this.validateFilePaths(status.not_added);

        const result = {
          staged,
          unstaged,
          untracked,
          total: staged.length + unstaged.length + untracked.length,
        };

        // Cache the result
        this.cache.status = { data: result, timestamp: Date.now() };

        return result;
      },
      { operation: 'getStatus' }
    );
  };

  private readonly validateFilePaths = (filePaths: string[]): string[] => {
    const validPaths: string[] = [];

    for (const filePath of filePaths) {
      const validation = validateAndSanitizePath(filePath, this.repositoryPath);
      if (validation.isValid && validation.sanitizedValue) {
        validPaths.push(validation.sanitizedValue);
      } else {
        console.warn(`Skipping invalid file path: ${filePath} - ${validation.error}`);
      }
    }

    return validPaths;
  };

  getUnstagedFiles = async (): Promise<string[]> => {
    return withErrorHandling(
      async () => {
        const status = await withTimeout(this.git.status(), calculateGitTimeout({}));

        const allFiles = [...status.modified, ...status.not_added, ...status.deleted];
        return this.validateFilePaths(allFiles);
      },
      { operation: 'getUnstagedFiles' }
    );
  };

  getFileDiff = async (file: string, staged: boolean = false): Promise<GitDiff> => {
    return withErrorHandling(
      async () => {
        const pathValidation = validateAndSanitizePath(file, this.repositoryPath);
        if (!pathValidation.isValid || !pathValidation.sanitizedValue) {
          throw new SecureError(
            pathValidation.error ?? 'Invalid file path',
            ErrorType.SECURITY_ERROR,
            { operation: 'getFileDiff', file },
            false
          );
        }

        const validatedFile = pathValidation.sanitizedValue;
        const status = await withTimeout(this.git.status(), calculateGitTimeout({}));

        // Convert absolute path to relative path for comparison with git status
        const relativeFile = file.startsWith(this.repositoryPath)
          ? file.substring(this.repositoryPath.length + 1)
          : file;

        try {
          const isDeleted = status.deleted.includes(relativeFile);

          if (isDeleted && !staged) {
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

          const isUntracked = status.not_added.includes(relativeFile);

          if (isUntracked && !staged) {
            // For untracked files, read the file content directly
            const { readFile } = await import('fs/promises');
            const fileContent = await readFile(validatedFile, 'utf-8');
            const lines = fileContent.split('\n').length;

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

          const diffArgs = staged ? ['--cached', validatedFile] : [validatedFile];
          const diffTimeout = calculateGitTimeout({ diffSize: 0 }); // Will be adjusted after getting diff
          const diff = await withTimeout(this.git.diff(diffArgs), diffTimeout);
          const diffSummary = await withTimeout(this.git.diffSummary(diffArgs), diffTimeout);

          const diffValidation = validateDiffSize(diff);
          if (!diffValidation.isValid) {
            // For lock files, use summary data instead of full diff content
            const isLockFile =
              relativeFile.includes('yarn.lock') ||
              relativeFile.includes('package-lock.json') ||
              relativeFile.includes('pnpm-lock.yaml');

            if (isLockFile) {
              const fileSummary = diffSummary.files.find((f: { file: string; insertions?: number; deletions?: number }) => f.file === relativeFile);
              return {
                file: validatedFile,
                additions: fileSummary?.insertions ?? 0,
                deletions: fileSummary?.deletions ?? 0,
                changes: `Lock file updated: ${fileSummary?.insertions ?? 0} additions, ${fileSummary?.deletions ?? 0} deletions`,
                isNew:
                  status.created.includes(relativeFile) || status.not_added.includes(relativeFile),
                isDeleted: status.deleted.includes(relativeFile),
                isRenamed: status.renamed.some((r: { to: string }) => r.to === relativeFile),
                oldPath: status.renamed.find((r: { to: string; from: string }) => r.to === relativeFile)?.from ?? undefined,
              };
            }

            throw new SecureError(
              diffValidation.error ?? 'Validation failed',
              ErrorType.VALIDATION_ERROR,
              { operation: 'getFileDiff', file: validatedFile },
              true
            );
          }

          const fileSummary = diffSummary.files.find((f: { file: string; insertions?: number; deletions?: number }) => f.file === relativeFile);

          return {
            file: validatedFile,
            additions: fileSummary?.insertions ?? 0,
            deletions: fileSummary?.deletions ?? 0,
            changes: diffValidation.sanitizedValue ?? '',
            isNew: status.created.includes(relativeFile) || status.not_added.includes(relativeFile),
            isDeleted: status.deleted.includes(relativeFile),
            isRenamed: status.renamed.some((r: { to: string }) => r.to === relativeFile),
            oldPath: status.renamed.find((r: { to: string; from: string }) => r.to === relativeFile)?.from ?? undefined,
          };
        } catch {
          return {
            file: validatedFile,
            additions: 0,
            deletions: 0,
            changes: '',
            isNew: status.created.includes(relativeFile) || status.not_added.includes(relativeFile),
            isDeleted: status.deleted.includes(relativeFile),
            isRenamed: status.renamed.some((r: { to: string }) => r.to === relativeFile),
            oldPath: status.renamed.find((r: { to: string; from: string }) => r.to === relativeFile)?.from ?? undefined,
          };
        }
      },
      { operation: 'getFileDiff', file }
    );
  };

  getStagedDiff = async (): Promise<GitDiff[]> => {
    return withErrorHandling(
      async () => {
        const status = await withTimeout(this.git.status(), calculateGitTimeout({}));

        if (status.staged.length === 0) {
          throw new SecureError(
            ERROR_MESSAGES.NO_STAGED_CHANGES,
            ErrorType.GIT_ERROR,
            { operation: 'getStagedDiff' },
            true
          );
        }

        const diffs: GitDiff[] = [];
        const validatedFiles = this.validateFilePaths(status.staged);

        for (const file of validatedFiles) {
          try {
            const diffTimeout = calculateGitTimeout({ diffSize: 0 });
            const diff = await withTimeout(this.git.diff(['--cached', file]), diffTimeout);
            const diffSummary = await withTimeout(
              this.git.diffSummary(['--cached', file]),
              diffTimeout
            );

            const diffValidation = validateDiffSize(diff);
            if (!diffValidation.isValid) {
              console.warn(`Diff too large for ${file}, skipping content`);
              continue;
            }

            const fileSummary = diffSummary.files.find((f: { file: string; insertions?: number; deletions?: number }) => f.file === file);

            diffs.push({
              file,
              additions: fileSummary?.insertions ?? 0,
              deletions: fileSummary?.deletions ?? 0,
              changes: diffValidation.sanitizedValue ?? '',
              isNew: status.created.includes(file),
              isDeleted: status.deleted.includes(file),
              isRenamed: status.renamed.some((r: { to: string }) => r.to === file),
              oldPath: status.renamed.find((r: { to: string; from: string }) => r.to === file)?.from ?? undefined,
            });
          } catch (error) {
            console.warn(`Failed to get diff for ${file}:`, error);
          }
        }

        return diffs;
      },
      { operation: 'getStagedDiff' }
    );
  };

  getChangesSummary = async (): Promise<string> => {
    const status = await withTimeout(this.git.status(), calculateGitTimeout({}));
    const unstagedFiles = [...status.modified, ...status.not_added, ...status.deleted];

    if (unstagedFiles.length === 0) return 'No unstaged changes found.';

    const diffs: GitDiff[] = [];
    const validatedFiles = this.validateFilePaths(unstagedFiles);

    for (const file of validatedFiles) {
      try {
        const diff = await this.getFileDiff(file, false);
        diffs.push(diff);
      } catch (error) {
        console.warn(`Failed to get diff: ${error}`);
        continue;
      }
    }

    if (diffs.length === 0)  return 'No valid changes found.';

    let summary = `Changes summary:\n`;
    summary += `- ${diffs.length} file(s) modified\n`;

    const totalAdditions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
    const totalDeletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

    summary += `- ${totalAdditions} line(s) added\n`;
    summary += `- ${totalDeletions} line(s) deleted\n\n`;

    summary += `Files:\n${diffs.map((diff) =>
    `- ${this.getFileStatus(diff)} ${diff.file} (+${diff.additions}/-${diff.deletions})`
    ).join('\n')}\n`;

    return summary;
  };

  stageAll = async (): Promise<void> => {
    return withErrorHandling(
      async () => {
        await withTimeout(this.git.add('.'), calculateGitTimeout({}));
        this.clearCache(); // Clear cache after staging
      },
      { operation: 'stageAll' }
    );
  };

  stageFiles = async (files: string[]): Promise<void> => {
    return withErrorHandling(
      async () => {
        const validatedFiles = this.validateFilePaths(files);
        if (validatedFiles.length === 0) {
          throw new SecureError(
            ERROR_MESSAGES.NO_VALID_FILES,
            ErrorType.VALIDATION_ERROR,
            { operation: 'stageFiles' },
            true
          );
        }
        await withTimeout(this.git.add(validatedFiles), calculateGitTimeout({}));
      },
      { operation: 'stageFiles' }
    );
  };

  stageFile = async (file: string): Promise<void> => {
    return withErrorHandling(
      async () => {
        const pathValidation = validateAndSanitizePath(file, this.repositoryPath);
        if (!pathValidation.isValid || !pathValidation.sanitizedValue) {
          throw new SecureError(
            pathValidation.error ?? 'Invalid file path',
            ErrorType.SECURITY_ERROR,
            { operation: 'stageFile', file },
            false
          );
        }

        const sanitizedFile = pathValidation.sanitizedValue;

        await withTimeout(this.git.add(sanitizedFile), calculateGitTimeout({}));
        this.clearCache(); // Clear cache after staging
      },
      { operation: 'stageFile', file }
    );
  };

  commit = async (message: string): Promise<void> => {
    return withErrorHandling(
      async () => {
        const messageValidation = validateCommitMessage(message);
        if (!messageValidation.isValid || !messageValidation.sanitizedValue) {
          throw new SecureError(
            messageValidation.error ?? 'Invalid commit message',
            ErrorType.VALIDATION_ERROR,
            { operation: 'commit' },
            true
          );
        }

        const sanitizedMessage = messageValidation.sanitizedValue;

        await withTimeout(this.git.commit(sanitizedMessage), calculateGitTimeout({}));
        this.clearCache(); // Clear cache after commit
      },
      { operation: 'commit' }
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

  getRepoInfo = async (): Promise<{ name: string; branch: string }> => {
    // Check cache first
    if (this.isCacheValid(this.cache.repoInfo)) {
      return this.cache.repoInfo.data;
    }

    const status = await this.git.status();
    const remotes = await this.git.getRemotes(true);

    let repoName = 'unknown';
    if (remotes.length > 0) {
      const origin = remotes.find((r: { name: string; refs?: { fetch?: string } }) => r.name === 'origin');
      if (origin?.refs?.fetch) {
        const match = origin.refs.fetch.match(/\/([^\/]+?)(?:\.git)?$/);
        if (match) {
          repoName = match[1];
        }
      }
    }

    const result = {   name: repoName,    branch: status.current,};
    // Cache the result for longer since repo info changes less frequently
    this.cache.repoInfo = { data: result, timestamp: Date.now() };

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

  // Wait for Git to naturally release the lock file
  waitForLockRelease = async (maxWaitMs: number = 250): Promise<void> => {
    const { access } = await import('fs/promises');
    const lockPath = `${this.repositoryPath}/.git/index.lock`;
    const checkInterval = 10; // Check every 10ms for very fast responsiveness
    const maxChecks = Math.floor(maxWaitMs / checkInterval);

    for (let i = 0; i < maxChecks; i++) {
      try {
        await access(lockPath);
        // Lock file exists, wait a bit
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      } catch {
        // Lock file doesn't exist, Git has released it
        // Add a tiny buffer to ensure Git is completely done
        await new Promise((resolve) => setTimeout(resolve, 5));
        return;
      }
    }

    // If we get here, lock file still exists after timeout
    // This is unusual but we should continue anyway
    console.warn('⚠️  Git lock file persisted longer than expected');
  };
}
