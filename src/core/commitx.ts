import process from "process";
import { lightColors } from "../utils/colors.js";
import { lightSpinner } from "../utils/spinner.js";
import { prompt } from "../utils/prompts.js";
import { GitService } from "../services/git.js";
import { AIService } from "../services/ai.js";
import type {
  CommitOptions,
  CommitSuggestion,
  GitStatus,
} from "../types/common.js";
import {
  WARNING_MESSAGES,
  SUCCESS_MESSAGES,
  INFO_MESSAGES,
} from "../constants/messages.js";
import { UI_CONSTANTS } from "../constants/ui.js";
import { exitProcess, handleError } from "../utils/process-utils.js";
import { commitFilesBatch } from "./commit-orchestrator.js";

export class CommitX {
  private readonly gitService: GitService;
  private static aiServiceInstance: AIService | null = null;

  constructor() {
    this.gitService = new GitService();
  }

  private getAIService(): AIService {
    if (!CommitX.aiServiceInstance) {
      try {
        CommitX.aiServiceInstance = new AIService();
      } catch (error) {
        throw new Error(`Failed to initialize AI service: ${error}`, {
          cause: error,
        });
      }
    }
    return CommitX.aiServiceInstance;
  }

  commit = async (options: CommitOptions = {}): Promise<void> => {
    try {
      if (!(await this.gitService.isGitRepository())) {
        throw new Error(
          "Not a git repository. Please run this command from within a git repository."
        );
      }

      if (options.message || options.all) {
        return this.commitTraditional(options);
      }

      const unstagedFiles = await this.gitService.getUnstagedFiles();
      if (unstagedFiles.length === 0) {
        console.log(lightColors.yellow(WARNING_MESSAGES.NO_CHANGES_DETECTED));
        return;
      }

      const processedCount = await commitFilesBatch(
        this.gitService,
        () => this.getAIService(),
        unstagedFiles,
        options
      );

      console.log(
        lightColors.green(
          processedCount > 1
            ? `\n✅ Successfully processed ${processedCount} of ${unstagedFiles.length} files.`
            : `\n✅ Successfully processed the file.`
        )
      );

      if (options.dryRun || processedCount > 0) {
        exitProcess(0);
      }
    } catch (error) {
      handleError(error);
    }
  };

  private readonly commitTraditional = async (
    options: CommitOptions
  ): Promise<void> => {
    const status = await this.gitService.getStatus();

    if (status.staged.length === 0) {
      if (status.unstaged.length > 0 || status.untracked.length > 0) {
        const shouldStage = await this.promptStageFiles(status);
        if (shouldStage) {
          const spinner = lightSpinner(
            UI_CONSTANTS.SPINNER_MESSAGES.STAGING
          ).start();
          await this.gitService.stageAll();
          spinner.succeed(SUCCESS_MESSAGES.FILES_STAGED);
        } else {
          console.log(lightColors.yellow(WARNING_MESSAGES.NO_FILES_STAGED));
          return;
        }
      } else {
        console.log(lightColors.yellow(WARNING_MESSAGES.NO_CHANGES_DETECTED));
        return;
      }
    }

    const commitMessage: string =
      options.message ??
      (await this.generateCommitMessage(options));

    if (!commitMessage) {
      console.log(lightColors.yellow(WARNING_MESSAGES.NO_COMMIT_MESSAGE));
      return;
    }

    if (options.dryRun) {
      console.log(
        `${lightColors.blue(INFO_MESSAGES.DRY_RUN_COMMIT)}\n${lightColors.white(`"${commitMessage}"`)}`
      );
      return;
    }

    const commitSpinner = lightSpinner(
      UI_CONSTANTS.SPINNER_MESSAGES.COMMITTING
    ).start();
    await this.gitService.commit(commitMessage);
    commitSpinner.succeed(`Committed: ${lightColors.green(commitMessage)}`);

    exitProcess(0);
  };

  private readonly generateCommitMessage = async (
    options: CommitOptions
  ): Promise<string> => {
    const spinner = lightSpinner("Analyzing changes...").start();

    try {
      const diffs = await this.gitService.getStagedDiff();

      if (diffs.length === 0) {
        spinner.fail("No staged changes found");
        return "";
      }

      spinner.message = "Using AI to group related changes...";
      const aggregatedResult = await this.getAIService().generateAggregatedCommits(
        diffs,
        { useCached: options.useCached }
      );

      if (aggregatedResult.groups.length === 0) {
        spinner.fail("AI grouping returned no commit groups");
        return "";
      }

      const group = aggregatedResult.groups[0];
      const commitMessage = group.message;

      spinner.succeed(
        `Generated commit message for ${group.files.length} file(s)`
      );

      const interactive = options.interactive ?? true;
      if (!interactive || !process.stdin.isTTY) {
        return commitMessage;
      }

      const suggestions: CommitSuggestion[] = [
        {
          message: commitMessage,
          description: group.description,
          confidence: group.confidence ?? 0.7,
        },
      ];

      return await this.promptCommitSelection(suggestions);
    } catch (error) {
      spinner.fail(`Failed to generate commit message: ${error}`);
      throw error;
    }
  };

  private readonly promptCommitSelection = async (
    suggestions: CommitSuggestion[],
    file?: string
  ): Promise<string> => {
    const choices = suggestions.map(suggestion => ({
      name: `${lightColors.green(suggestion.message)}${suggestion.description ? lightColors.gray(` - ${suggestion.description}`) : ""}`,
      value: suggestion.message,
      short: suggestion.message,
    }));

    choices.push({
      name: lightColors.blue("✏️  Write custom message"),
      value: "custom",
      short: "Custom",
    });

    if (file) {
      choices.push({
        name: lightColors.yellow("⏭️  Skip this file"),
        value: "skip",
        short: "Skip",
      });
    }

    choices.push({
      name: lightColors.red("❌ Cancel"),
      value: "cancel",
      short: "Cancel",
    });

    const message = file
      ? `Select commit message for ${lightColors.cyan(file)}:`
      : "Select a commit message:";

    const { selected } = await prompt({
      selected: {
        type: "list",
        message,
        choices,
        pageSize: UI_CONSTANTS.PAGE_SIZE,
      },
    });

    switch (selected) {
      case "cancel":
      case "skip":
        return "";

      case "custom": {
        const { customMessage } = await prompt({
          customMessage: {
            type: "input",
            message: `Enter commit message${file ? ` for ${lightColors.cyan(file)}` : ""}:`,
            validate: (input: string): string | boolean => {
              if (!input.trim()) return "Commit message cannot be empty";
              if (input.length > 72) return "First line should be 72 characters or less";
              return true;
            },
          },
        });
        return customMessage;
      }

      default:
        return selected;
    }
  };

  private readonly promptStageFiles = async (status: {
    unstaged: string[];
    untracked: string[];
  }): Promise<boolean> => {
    let output = `${lightColors.yellow("\nUnstaged changes detected:")}`;

    if (status.unstaged.length > 0) {
      output += `\n${lightColors.yellow("Modified files:")}`;
      output += status.unstaged
        .map(file => `\n  ${lightColors.red("M")} ${file}`)
        .join("");
    }

    if (status.untracked.length > 0) {
      output += `\n${lightColors.yellow("Untracked files:")}`;
      output += status.untracked
        .map(file => `\n  ${lightColors.red("??")} ${file}`)
        .join("");
    }

    console.log(output);

    const { shouldStage } = await prompt({
      shouldStage: {
        type: "confirm",
        message: "Stage all changes and continue?",
        default: true,
      },
    });

    return shouldStage;
  };

  status = async (): Promise<void> => {
    try {
      if (!(await this.gitService.isGitRepository())) {
        console.log(lightColors.red("Not a git repository"));
        return;
      }

      const status = await this.gitService.getStatus();
      const repoInfo = await this.gitService.getRepoInfo();

      console.log(this.renderStatus(status, repoInfo));

      console.log(
        status.total === 0
          ? lightColors.green("✨ Working directory is clean")
          : lightColors.blue(`📊 Total changes: ${status.total}`)
      );

      const lastCommit = await this.gitService.getLastCommitMessage();
      if (lastCommit) {
        console.log(lightColors.gray(`\n💬 Last commit: "${lastCommit}"`));
      }

      exitProcess(0);
    } catch (error) {
      handleError(error);
    }
  };

  private readonly renderStatus = (
    status: GitStatus,
    repoInfo: { name: string; branch: string }
  ): string => {
    let output = `${lightColors.bold(`\n📁 Repository: ${repoInfo.name}`)}\n${lightColors.bold(`🌿 Branch: ${repoInfo.branch}`)}\n`;

    if (status.staged.length > 0) {
      output += `\n${lightColors.green("✅ Staged changes:")}`;
      output += status.staged
        .map(file => `\n  ${lightColors.green("A")} ${file}`)
        .join("");
      output += "\n";
    }

    if (status.unstaged.length > 0) {
      output += `\n${lightColors.yellow("📝 Unstaged changes:")}`;
      output += status.unstaged
        .map(file => `\n  ${lightColors.yellow("M")} ${file}`)
        .join("");
      output += "\n";
    }

    if (status.untracked.length > 0) {
      output += `\n${lightColors.red("❓ Untracked files:")}`;
      output += status.untracked
        .map(file => `\n  ${lightColors.red("??")} ${file}`)
        .join("");
      output += "\n";
    }

    return output;
  };

  diff = async (): Promise<void> => {
    try {
      if (!(await this.gitService.isGitRepository())) {
        console.log(lightColors.red("Not a git repository"));
        exitProcess(1);
        return;
      }

      const summary = await this.gitService.getChangesSummary();
      console.log(`${lightColors.blue("📋 Changes Summary:")}\n\n${summary}`);

      exitProcess(0);
    } catch (error) {
      handleError(error);
    }
  };
}
