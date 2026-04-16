import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";
import { lazyModules } from "../../utils/lazy-loader.js";

export const registerSetupCommand = (program: Command): void => {
  program
    .command("setup")
    .description("Interactive setup for first-time users")
    .action(async () => {
      const inquirer = await lazyModules.inquirer();
      console.log(lightColors.blue("🚀 Welcome to Commit-X Setup!\n"));

      try {
        const { ConfigManager } = await lazyModules.config();
        const config = ConfigManager.getInstance();

        const answers = await inquirer.default.prompt({
          apiKey: {
            type: "input",
            message: "Enter your Gemini AI API key:",
            validate: (input: string): string | boolean => {
              if (!input.trim()) {
                return "API key is required. Get one from https://makersuite.google.com/app/apikey";
              }
              return true;
            },
          },
        });

        await config.saveConfig(answers);

        console.log(`${lightColors.green("\n✅ Setup completed successfully!")}
${lightColors.blue('You can now use "cx" to start making AI-powered commits.')}
${lightColors.gray('Use "cx config" to modify settings later.')}`);
      } catch (error) {
        const { handleErrorImmediate } = await import(
          "../../utils/process-utils.js"
        );
        handleErrorImmediate(error, "Setup failed");
      }
    });
};
