import process from "node:process";
import { basename } from "node:path";
import { lightColors } from "../utils/colors.js";
import { lightSpinner } from "../utils/spinner.js";
import type { GitService } from "../services/git.js";
import type { AIService } from "../services/ai.js";
import type { TimeoutCalculationOptions } from "../utils/timeout.js";
import type { CommitGroup, CommitOptions, GitDiff } from "../types/common.js";

const shouldSkipFile = (diff: GitDiff): boolean => {
  const totalChanges = diff.additions + diff.deletions;
  return (
    totalChanges === 0 &&
    (!diff.changes || diff.changes.trim() === "") &&
    !diff.isDeleted
  );
};

const logSkippedFile = (diff: GitDiff): void => {
  const fileName = basename(diff.file);
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
        `  Files: ${group.files.map(f => basename(f)).join(", ")}`
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

    await gitService.commit(group.message, timeoutOptions);

    const onlyFile = stagedFiles[0];
    const actualGroupName =
      stagedFiles.length > 1
        ? `${stagedFiles.length} files`
        : basename(onlyFile ?? "file");

    commitSpinner.succeed(`✅ ${actualGroupName}: ${group.message}`);
    return stagedFiles.length;
  } catch (error) {
    try {
      await gitService.unstageFiles(group.files, timeoutOptions);
    } catch (rollbackError) {
      console.error(
        lightColors.red(`  Failed to restore Git index: ${rollbackError}`)
      );
    }
    commitSpinner.fail(`Failed to commit ${groupName}`);
    throw error;
  }
};

const processGroup = async (
  gitService: GitService,
  group: CommitGroup,
  allDiffs: GitDiff[],
  dryRun: boolean
): Promise<number> => {
  const firstFile = group.files[0];
  const groupName =
    group.files.length > 1
      ? `${group.files.length} files`
      : basename(firstFile ?? "file");

  return dryRun
    ? previewGroupDryRun(group, groupName)
    : executeGroupCommit(gitService, group, groupName, allDiffs);
};

interface CommitPlan {
  groups: CommitGroup[];
  diffs: GitDiff[];
  skippedCount: number;
}

const planCommits = async (
  gitService: GitService,
  getAIService: () => Promise<AIService>,
  files: string[],
  options: CommitOptions
): Promise<CommitPlan | undefined> => {
  const spinner = lightSpinner(
    "Analyzing files for intelligent grouping... \n\n"
  ).start();

  try {
    if (!options.dryRun) {
      await gitService.assertCleanIndexForBatch();
    }

    const diffs: GitDiff[] = [];
    let skippedCount = 0;

    for (const diff of await gitService.getFileDiffs(files)) {
      if (shouldSkipFile(diff)) {
        logSkippedFile(diff);
        skippedCount++;
        continue;
      }
      diffs.push(diff);
    }

    if (diffs.length === 0) {
      spinner.fail("No valid files to process");
      return undefined;
    }

    spinner.message = "Using AI to group related changes...";

    const aiService = await getAIService();
    const { groups } = await aiService.generateAggregatedCommits(
      diffs,
      options.useCached === undefined ? {} : { useCached: options.useCached }
    );

    if (groups.length === 0) {
      spinner.fail("AI grouping returned no commit groups");
      return undefined;
    }

    spinner.succeed(
      `AI grouped ${diffs.length} files into ${groups.length} logical commits`
    );
    return { groups, diffs, skippedCount };
  } catch (error) {
    spinner.fail("Commit processing failed");
    throw error;
  }
};

export const commitFilesBatch = async (
  gitService: GitService,
  getAIService: () => Promise<AIService>,
  files: string[],
  options: CommitOptions
): Promise<number> => {
  const plan = await planCommits(gitService, getAIService, files, options);
  if (!plan) return 0;

  let processedCount = 0;
  for (const group of plan.groups) {
    processedCount += await processGroup(
      gitService,
      group,
      plan.diffs,
      Boolean(options.dryRun)
    );
  }

  if (plan.skippedCount > 0) {
    console.log(
      lightColors.yellow(
        `Skipped ${plan.skippedCount} files (empty or failed analysis)`
      )
    );
  }

  return processedCount;
};
