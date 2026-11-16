import process from "node:process";
import { basename } from "node:path";
import { lightColors } from "../utils/colors.js";
import { lightSpinner } from "../utils/spinner.js";
import type { GitService } from "../services/git.js";
import type { AIService } from "../services/ai.js";
import type { TimeoutCalculationOptions } from "../utils/timeout.js";
import type { CommitGroup, CommitOptions, GitDiff } from "../types/common.js";
import { preGroupDeterministicFiles } from "../services/ai-commit-group.js";

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
  diffsByFile: ReadonlyMap<string, GitDiff>
): Omit<TimeoutCalculationOptions, "operationType"> => {
  let totalChanges = 0;
  let totalDiffSize = 0;
  for (const file of groupFiles) {
    const diff = diffsByFile.get(file);
    if (!diff) continue;
    totalChanges += diff.additions + diff.deletions;
    totalDiffSize += diff.changes?.length || 0;
  }
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
  diffsByFile: ReadonlyMap<string, GitDiff>
): Promise<number> => {
  const commitSpinner = lightSpinner(`Committing ${groupName}...`).start();
  const timeoutOptions = buildTimeoutOptions(group.files, diffsByFile);
  logTimeoutMetrics(timeoutOptions);

  let staged = false;
  try {
    await gitService.stageFiles(group.files, timeoutOptions);
    staged = true;

    await gitService.commit(group.message, timeoutOptions);

    commitSpinner.succeed(`✅ ${groupName}: ${group.message}`);
    return group.files.length;
  } catch (error) {
    if (staged) {
      try {
        await gitService.unstageFiles(group.files, timeoutOptions);
      } catch (rollbackError) {
        console.error(
          lightColors.red(`  Failed to restore Git index: ${rollbackError}`)
        );
      }
    }
    commitSpinner.fail(`Failed to commit ${groupName}`);
    throw error;
  }
};

const processGroup = async (
  gitService: GitService,
  group: CommitGroup,
  diffsByFile: ReadonlyMap<string, GitDiff>,
  dryRun: boolean
): Promise<number> => {
  const firstFile = group.files[0];
  const groupName =
    group.files.length > 1
      ? `${group.files.length} files`
      : basename(firstFile ?? "file");

  return dryRun
    ? previewGroupDryRun(group, groupName)
    : executeGroupCommit(gitService, group, groupName, diffsByFile);
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

    const plan = preGroupDeterministicFiles(diffs, gitService.root);
    let groups = plan.autoGroups;

    if (plan.aiDiffs.length > 0) {
      spinner.message = "Using AI to group related changes...";
      const aiService = await getAIService();
      ({ groups } = await aiService.generateAggregatedCommits(plan, options));
    }

    if (groups.length === 0) {
      spinner.fail("AI grouping returned no commit groups");
      return undefined;
    }

    spinner.succeed(
      plan.aiDiffs.length === 0
        ? `Grouped ${diffs.length} files into ${groups.length} logical commits`
        : `AI grouped ${diffs.length} files into ${groups.length} logical commits`
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

  const diffsByFile = new Map(plan.diffs.map(diff => [diff.file, diff]));
  let processedCount = 0;
  for (const group of plan.groups) {
    processedCount += await processGroup(
      gitService,
      group,
      diffsByFile,
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
