import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";
import { lazyModules } from "../../utils/lazy-loader.js";

export const registerSetupCommand = (program: Command): void => {
  program
    .command("setup")
    .description("Check first-time authentication setup")
    .action(async () => {
      console.log(lightColors.blue("🚀 Welcome to Commit-X Setup!\n"));

      try {
        const { ConfigManager } = await lazyModules.config();
        const config = ConfigManager.getInstance();

        if (!config.getApiKey()) {
          console.log(
            `${lightColors.yellow("GEMINI_API_KEY is not set or is invalid.")}\n${lightColors.blue("Create a key at https://aistudio.google.com/app/apikey, then set it in your shell:")}\n${lightColors.gray('  export GEMINI_API_KEY="your_api_key_here"')}`
          );
          return;
        }

        console.log(`${lightColors.green("\n✅ Setup completed successfully!")}
${lightColors.blue('You can now use "cx" to start making AI-powered commits.')}
${lightColors.gray("The API key is read from GEMINI_API_KEY and is never persisted by Commit-X.")}`);
      } catch (error) {
        const { handleErrorImmediate } =
          await import("../../utils/process-utils.js");
        handleErrorImmediate(error, "Setup failed");
      }
    });
};
