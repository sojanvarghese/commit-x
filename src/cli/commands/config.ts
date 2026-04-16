import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";
import { lazyModules } from "../../utils/lazy-loader.js";

const parseConfigValue = (value: string): string | number | boolean => {
  const lowerValue = value.toLowerCase();
  if (lowerValue === "true") return true;
  if (lowerValue === "false") return false;
  return !isNaN(Number(value)) ? Number(value) : value;
};

export const registerConfigCommand = (program: Command): void => {
  const configCmd = program
    .command("config")
    .description("Manage Commit-X configuration");

  configCmd
    .command("set <key> <value>")
    .description("Set configuration value")
    .action(async (key: string, value: string): Promise<void> => {
      const { withErrorHandling, SecureError } = await import(
        "../../utils/error-handler.js"
      );
      await withErrorHandling(
        async (): Promise<void> => {
          const { CommitConfigSchema } = await import(
            "../../schemas/validation.js"
          );
          const { ErrorType } = await import("../../types/error-handler.js");
          const { ConfigManager } = await lazyModules.config();

          if (!(key in CommitConfigSchema.shape)) {
            throw new SecureError(
              `Invalid configuration key: ${key}. Allowed keys: ${Object.keys(CommitConfigSchema.shape).join(", ")}`,
              ErrorType.VALIDATION_ERROR,
              { operation: "configSet", key },
              true
            );
          }

          const config = ConfigManager.getInstance();
          const parsedValue = parseConfigValue(value);
          await config.set(key as keyof typeof config.getConfig, parsedValue);
          console.log(lightColors.green(`✅ Set ${key} = ${parsedValue}`));
        },
        { operation: "configSet", key }
      );
    });

  configCmd
    .command("get [key]")
    .description("Get configuration value(s)")
    .action(async (key?: string): Promise<void> => {
      const { withErrorHandling, SecureError } = await import(
        "../../utils/error-handler.js"
      );
      await withErrorHandling(
        async (): Promise<void> => {
          const { ConfigManager } = await lazyModules.config();
          const { CommitConfigSchema } = await import(
            "../../schemas/validation.js"
          );
          const { ErrorType } = await import("../../types/error-handler.js");

          const config = ConfigManager.getInstance();
          const allKeys = Object.keys(CommitConfigSchema.shape);

          if (key) {
            if (!allKeys.includes(key)) {
              throw new SecureError(
                `Invalid configuration key: ${key}. Allowed keys: ${allKeys.join(", ")}`,
                ErrorType.VALIDATION_ERROR,
                { operation: "configGet", key },
                true
              );
            }
            const value =
              key === "apiKey"
                ? config.getApiKey()
                : config.get(key as keyof typeof config.getConfig);
            console.log(
              `${key}: ${key === "apiKey" && value ? "********" : value}`
            );
            return;
          }

          const allConfig = config.getConfig();
          const apiKey = config.getApiKey();

          console.log(lightColors.blue("Current configuration:"));
          for (const [k, v] of Object.entries(allConfig)) {
            const displayValue = k === "apiKey" ? "********" : v;
            console.log(`  ${k}: ${displayValue}`);
          }

          if (!("apiKey" in allConfig)) {
            console.log(`  apiKey: ${apiKey ? "********" : "Not set"}`);
          }
        },
        { operation: "configGet", key }
      );
    });

  configCmd
    .command("reset")
    .description("Reset configuration to defaults")
    .action(async () => {
      try {
        const inquirer = await lazyModules.inquirer();
        const { confirm } = await inquirer.default.prompt({
          confirm: {
            type: "confirm",
            message:
              "Are you sure you want to reset all configuration to defaults?",
            default: false,
          },
        });

        if (confirm) {
          const { ConfigManager } = await lazyModules.config();
          const config = ConfigManager.getInstance();
          config.reset();
          console.log(lightColors.green("✅ Configuration reset to defaults"));
        } else {
          console.log(lightColors.yellow("Reset cancelled"));
        }
      } catch (error) {
        const { handleErrorImmediate } = await import(
          "../../utils/process-utils.js"
        );
        handleErrorImmediate(error);
      }
    });
};
