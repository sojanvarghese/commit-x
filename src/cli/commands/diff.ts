import type { Command } from "commander";
import { lazyModules } from "../../utils/lazy-loader.js";

export const registerDiffCommand = (program: Command): void => {
  program
    .command("diff")
    .alias("d")
    .description("Show unstaged changes summary")
    .action(async () => {
      const { withErrorHandling } = await import(
        "../../utils/error-handler.js"
      );
      return withErrorHandling(
        async (): Promise<void> => {
          const { CommitX } = await lazyModules.commitX();
          const commitX = new CommitX();
          await commitX.diff();
        },
        { operation: "diff" }
      );
    });
};
