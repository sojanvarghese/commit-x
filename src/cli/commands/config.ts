import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";
import { lazyModules } from "../../utils/lazy-loader.js";

const showConfig = async (key?: string): Promise<void> => {
  const { withErrorHandling, SecureError } =
    await import("../../utils/error-handler.js");
  await withErrorHandling(
    async (): Promise<void> => {
      const { ConfigManager } = await lazyModules.config();
      const { CommitConfigSchema } =
        await import("../../schemas/validation.js");
      const { ErrorType } = await import("../../types/error-handler.js");

      const config = ConfigManager.getInstance();
      const allKeys = Object.keys(CommitConfigSchema.entries);

      if (key && !allKeys.includes(key)) {
        throw new SecureError(
          `Invalid configuration key: ${key}. Allowed keys: ${allKeys.join(", ")}`,
          ErrorType.VALIDATION_ERROR,
          { operation: "configGet", key },
          true
        );
      }

      if (key === "apiKey") {
        console.log(`apiKey: ${config.getApiKey() ? "********" : "Not set"}`);
        return;
      }

      console.log(lightColors.blue("Current configuration:"));
      console.log(`  apiKey: ${config.getApiKey() ? "********" : "Not set"}`);
      console.log(
        lightColors.gray("  API keys are read only from GEMINI_API_KEY.")
      );
    },
    {
      operation: "configGet",
      ...(key === undefined ? {} : { key }),
    }
  );
};

export const registerConfigCommand = (program: Command): void => {
  const configCmd = program
    .command("config")
    .description("Show Commit-X configuration")
    .action(() => showConfig());

  configCmd
    .command("get [key]")
    .description("Get configuration value(s)")
    .action((key?: string) => showConfig(key));
};
