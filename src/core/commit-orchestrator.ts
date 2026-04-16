import process from "process";
import { lightColors } from "../utils/colors.js";
import { lightSpinner } from "../utils/spinner.js";
import type { GitService } from "../services/git.js";
import type { AIService } from "../services/ai.js";
import type { TimeoutCalculationOptions } from "../utils/timeout.js";
import type {
  CommitGroup,
  CommitOptions,
  GitDiff,
} from "../types/common.js";

const getFileName = (filePath: string): string =>
  filePath.split("/").pop() ?? filePath;

const shouldSkipFile = (diff: GitDiff): boolean => {
  const totalChanges = diff.additions + diff.deletions;
  return (
    totalChanges === 0 &&
    (!diff.changes || diff.changes.trim() === "") &&
    !diff.isDeleted
  );
};

const logSkippedFile = (diff: GitDiff): void => {
  const fileName = getFileName(diff.file);
  if (diff.isNew) {
    console.log(lightColors.yellow(`  Skipping empty new file: ${fileName}`));
  } else {
    console.log(
      lightColors.yellow(`  Skipping file with no changes: ${fileName}`)
    );
  }
};

const buildTimeoutOptions = (
  groupFiles: string[],
  allDiffs: GitDiff[]
): Omit<TimeoutCalculationOptions, "operationType"> => {
  const groupDiffs = allDiffs.filter(diff => groupFiles.includes(diff.file));
  const totalChanges = groupDiffs.reduce(
    (sum, diff) => sum + diff.additions + diff.deletions,
    0
  );
  const totalDiffSize = groupDiffs.reduce(
    (sum, diff) => sum + (diff.changes?.length || 0),
    0
  );
  return {
    fileCount: groupFiles.length,
    totalChanges,
    diffSize: totalDiffSize,
  };
};

const logTimeoutMetrics = (
  opts: Omit<TimeoutCalculationOptions, "operationType">
): void => {
  if (process.env.DEBUG_TIMEOUTS || process.env.NODE_ENV === "development") {
    console.log(
      lightColors.gray(
        `  🕒 Timeout metrics: ${opts.fileCount} files, ${opts.totalChanges} changes, ${Math.round(
          (opts.diffSize ?? 0) / 1024
        )}KB diff`
      )
    );
  }
};

const previewGroupDryRun = (group: CommitGroup, groupName: string): number => {
  console.log(
    [
      lightColors.blue(`  Would commit ${groupName}:`),
      lightColors.gray(
        `  Files: ${group.files.map(f => getFileName(f)).join(", ")}`
      ),
      lightColors.blue(`  Message: "${group.message}"`),
    ].join("\n")
  );
  return group.files.length;
};

const executeGroupCommit = async (
  gitService: GitService,
  group: CommitGroup,
  groupName: string,
  allDiffs: GitDiff[]
): Promise<number> => {
  const commitSpinner = lightSpinner(`Committing ${groupName}...`).start();
  const timeoutOptions = buildTimeoutOptions(group.files, allDiffs);
  logTimeoutMetrics(timeoutOptions);

  const stagedFiles: string[] = [];
  try {
    await gitService.stageFiles(group.files, timeoutOptions);
    stagedFiles.push(...group.files);
  } catch (error) {
    commitSpinner.fail(
      lightColors.yellow(`Failed to stage files for group: ${error}`)
    );
    return 0;
  }

  await gitService.waitForLockRelease();
  await gitService.commit(group.message, timeoutOptions);

  const actualGroupName =
    stagedFiles.length > 1
      ? `${stagedFiles.length} files`
      : getFileName(stagedFiles[0]);

  commitSpinner.succeed(`✅ ${actualGroupName}: ${group.message}`);
  return stagedFiles.length;
};

const processGroup = async (
  gitService: GitService,
  group: CommitGroup,
  allDiffs: GitDiff[],
  dryRun: boolean
): Promise<number> => {
  const groupName =
    group.files.length > 1
      ? `${group.files.length} files`
      : getFileName(group.files[0]);

  try {
    return dryRun
      ? previewGroupDryRun(group, groupName)
      : await executeGroupCommit(gitService, group, groupName, allDiffs);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(lightColors.red(`  Failed to commit group: ${errorMessage}`));
    return 0;
  }
};

export const commitFilesBatch = async (
  gitService: GitService,
  getAIService: () => AIService,
  files: string[],
  options: CommitOptions
): Promise<number> => {
  const spinner = lightSpinner(
    "Analyzing files for intelligent grouping... \n\n"
  ).start();

  try {
    const analyzedDiffs = await gitService.getFileDiffs(files, false);
    const allDiffs: GitDiff[] = [];
    const skippedFiles: string[] = [];

    for (const diff of analyzedDiffs) {
      if (shouldSkipFile(diff)) {
        logSkippedFile(diff);
        skippedFiles.push(diff.file);
        continue;
      }
      allDiffs.push(diff);
    }

    if (allDiffs.length === 0) {
      spinner.fail("No valid files to process");
      return 0;
    }

    spinner.message = "Using AI to group related changes...";

    const aggregatedResult = await getAIService().generateAggregatedCommits(
      allDiffs,
      { useCached: options.useCached }
    );

    if (aggregatedResult.groups.length === 0) {
      spinner.fail("AI grouping returned no commit groups");
      return 0;
    }

    spinner.succeed(
      `AI grouped ${allDiffs.length} files into ${aggregatedResult.groups.length} logical commits`
    );

    let processedCount = 0;
    for (const group of aggregatedResult.groups) {
      processedCount += await processGroup(
        gitService,
        group,
        allDiffs,
        Boolean(options.dryRun)
      );
    }

    if (skippedFiles.length > 0) {
      console.log(
        lightColors.yellow(
          `Skipped ${skippedFiles.length} files (empty or failed analysis)`
        )
      );
    }

    return processedCount;
  } catch (error) {
    spinner.fail("Commit processing failed");
    console.error(lightColors.red(`Processing error: ${error}`));
    return 0;
  }
};
