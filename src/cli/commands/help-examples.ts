import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";

export const registerHelpExamplesCommand = (program: Command): void => {
  program
    .command("help-examples")
    .description("Show usage examples")
    .action(async (): Promise<void> => {
      console.log(`${lightColors.magenta("📚 Commit-X Usage Examples:\n")}

${lightColors.yellow("Basic usage:")}
  cx                             # Process files with AI
  cx commit --dry-run            # Preview commits
  cx commit                      # Direct CLI access
  cx commit --use-cached         # Reuse cached AI results

${lightColors.yellow("Traditional workflow:")}
  cx commit --all                # Stage all files and commit together
  cx commit -m "fix: bug"        # Use custom message (traditional)

${lightColors.yellow("Status and information:")}
  cx status                      # Show repository status
  cx diff                        # Show changes summary

${lightColors.yellow("Configuration:")}
  cx setup                       # Validate GEMINI_API_KEY
  cx config                      # View configuration
  cx privacy                     # Show privacy information`);
    });
};
