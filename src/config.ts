import process from "node:process";
import * as v from "valibot";
import { CommitConfigSchema, ApiKeySchema } from "./schemas/validation.js";
import type { CommitConfig } from "./types/common.js";
import { ErrorType } from "./types/error-handler.js";
import { withErrorHandling, SecureError } from "./utils/error-handler.js";

export class ConfigManager {
  private static instance: ConfigManager;
  private config: CommitConfig = {};

  private constructor() {
    // Singleton: use getInstance().
  }

  public static getInstance(): ConfigManager {
    ConfigManager.instance ??= new ConfigManager();
    return ConfigManager.instance;
  }

  public saveConfig = async (config: Partial<CommitConfig>): Promise<void> => {
    await withErrorHandling(
      async (): Promise<void> => {
        const result = v.safeParse(v.partial(CommitConfigSchema), config);
        if (!result.success) {
          throw new SecureError(
            `Invalid configuration: ${result.issues.map(issue => issue.message).join(", ")}`,
            ErrorType.VALIDATION_ERROR,
            { operation: "saveConfig" },
            true
          );
        }
        if (result.output.apiKey !== undefined) {
          throw new SecureError(
            "API keys are environment-only. Set GEMINI_API_KEY in your shell.",
            ErrorType.CONFIG_ERROR,
            { operation: "saveConfig" },
            true
          );
        }
      },
      { operation: "saveConfig" }
    );
  };

  public getConfig = (): CommitConfig => ({ ...this.config });

  public get = (key: keyof CommitConfig): unknown => this.config[key];

  public set = async (
    key: keyof CommitConfig,
    _value: unknown
  ): Promise<void> => {
    await withErrorHandling(
      async (): Promise<void> => {
        throw new SecureError(
          `${String(key)} is environment-only and cannot be persisted. Set GEMINI_API_KEY in your shell.`,
          ErrorType.CONFIG_ERROR,
          { operation: "setConfig", key },
          true
        );
      },
      { operation: "setConfig", key }
    );
  };

  public getApiKey = (): string => {
    const result = v.safeParse(ApiKeySchema, process.env.GEMINI_API_KEY ?? "");
    return result.success ? result.output : "";
  };

  public reset = async (): Promise<void> => {
    this.config = {};
  };
}
