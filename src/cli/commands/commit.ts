import process from "process";
import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";
import { lazyModules } from "../../utils/lazy-loader.js";

interface CommitCliOptions {
  message?: string;
  dryRun?: boolean;
  interactive?: boolean;
  all?: boolean;
  useCached?: boolean;
}

const printInteractiveUsageHint = (): void => {
  console.error(
    lightColors.red(
      "❌ Error: --interactive option can only be used with --all flag"
    )
  );
  console.log(`${lightColors.yellow("\n💡 Correct usage:")}
${lightColors.blue("  cx commit --all --interactive    # Interactive traditional workflow")}
${lightColors.blue("  cx commit --all                  # Non-interactive traditional workflow")}
${lightColors.blue("  cx commit                        # AI-powered intelligent grouping (default)")}
${lightColors.blue("  cx commit --help                 # Show all options")}`);
};

const validateMessage = async (message: string): Promise<string> => {
  const { CommitMessageSchema } = await import(
    "../../schemas/validation.js"
  );
  const { ErrorType } = await import("../../types/error-handler.js");
  const { SecureError } = await import("../../utils/error-handler.js");

  const result = CommitMessageSchema.safeParse(message);
  if (!result.success) {
    throw new SecureError(
      `Invalid commit message: ${result.error.issues.map(e => e.message).join(", ")}`,
      ErrorType.VALIDATION_ERROR,
      { operation: "commit" },
      true
    );
  }
  return result.data;
};

export const registerCommitCommand = (program: Command): void => {
  program
    .command("commit")
    .alias("c")
    .description("Generate and create AI-powered commit messages")
    .option(
      "-m, --message <message>",
      "Use provided commit message instead of generating one (uses traditional workflow)"
    )
    .option(
      "-d, --dry-run",
      "Show what would be committed without actually committing"
    )
    .option(
      "-i, --interactive",
      "Use interactive mode (for traditional workflow only)"
    )
    .option(
      "--all",
      "Stage all files and commit together (traditional workflow)"
    )
    .option(
      "--use-cached",
      "Reuse cached AI results (fresh by default)",
      false
    )
    .action(async (options: CommitCliOptions): Promise<void> => {
      const { withErrorHandling } = await import(
        "../../utils/error-handler.js"
      );
      return withErrorHandling(
        async (): Promise<void> => {
          if (options.interactive && !options.all) {
            printInteractiveUsageHint();
            process.exit(1);
          }

          if (options.message) {
            options.message = await validateMessage(options.message);
          }

          const operation = options.all ? "commit-traditional" : "commit-ai";
          const { withPerformanceTracking } = await import(
            "../../utils/performance.js"
          );

          await withPerformanceTracking(operation, async () => {
            const { CommitX } = await lazyModules.commitX();
            const commitX = new CommitX();
            await commitX.commit({
              message: options.message,
              dryRun: options.dryRun,
              interactive: options.interactive,
              all: options.all,
              useCached: options.useCached,
            });
          });
        },
        { operation: "commit" }
      );
    });
};
