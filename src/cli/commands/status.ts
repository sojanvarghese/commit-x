import type { Command } from "commander";
import { lazyModules } from "../../utils/lazy-loader.js";

export const registerStatusCommand = (program: Command): void => {
  program
    .command("status")
    .alias("s")
    .description("Show repository status and changes")
    .action(async () => {
      const { withErrorHandling } = await import(
        "../../utils/error-handler.js"
      );
      return withErrorHandling(
        async (): Promise<void> => {
          const { CommitX } = await lazyModules.commitX();
          const commitX = new CommitX();
          await commitX.status();
        },
        { operation: "status" }
      );
    });
};
