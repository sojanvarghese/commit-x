import { lightColors } from "../utils/colors.js";
import { GitService } from "../services/git.js";
import type { AIService } from "../services/ai.js";
import type { CommitOptions } from "../types/common.js";
import { WARNING_MESSAGES } from "../constants/messages.js";
import { ErrorType } from "../types/error-handler.js";
import { SecureError } from "../utils/error-handler.js";
import { commitFilesBatch } from "./commit-orchestrator.js";

export class CommitX {
  private readonly gitService: GitService;
  private aiService: Promise<AIService> | undefined;

  constructor() {
    this.gitService = new GitService();
  }

  // Imported on first use so runs that end early (not a repository, nothing
  // to commit) skip loading the Gemini SDK.
  private readonly getAIService = (): Promise<AIService> =>
    (this.aiService ??= import("../services/ai.js").then(
      ({ AIService }) => new AIService()
    ));

  commit = async (options: CommitOptions = {}): Promise<void> => {
    if (!(await this.gitService.isGitRepository())) {
      throw new SecureError(
        "Not a git repository. Please run this command from within a git repository.",
        ErrorType.GIT_ERROR,
        { operation: "commit" },
        false
      );
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

    if (processedCount === 0) {
      console.log(
        lightColors.yellow("\nNo files were committed or included in the plan.")
      );
      return;
    }

    console.log(
      lightColors.green(
        processedCount > 1
          ? `\n✅ Successfully processed ${processedCount} of ${unstagedFiles.length} files.`
          : `\n✅ Successfully processed the file.`
      )
    );
  };
}
