import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import process from "process";
import { CommitConfigSchema, ApiKeySchema } from "./schemas/validation.js";
import type { CommitConfig } from "./types/common.js";
import { sanitizeError } from "./utils/security.js";
import { ErrorType } from "./types/error-handler.js";
import { withErrorHandling, SecureError } from "./utils/error-handler.js";
import {
  CONFIG_DIR as CONFIG_DIR_NAME,
  CONFIG_FILE as CONFIG_FILE_NAME,
  CONFIG_FILE_MODE,
  CONFIG_DIR_MODE,
  DEFAULT_CONFIG,
} from "./constants/config.js";

const CONFIG_DIR = path.join(os.homedir(), CONFIG_DIR_NAME);
const CONFIG_FILE = path.join(CONFIG_DIR, CONFIG_FILE_NAME);

export class ConfigManager {
  private static instance: ConfigManager;
  private config: CommitConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private readonly loadConfig = (): CommitConfig => {
    try {
      // Create config directory if it doesn't exist
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE }); // Secure permissions
      }

      if (fs.existsSync(CONFIG_FILE)) {
        const configData = fs.readFileSync(CONFIG_FILE, "utf-8");
        const userConfig = JSON.parse(configData);

        // Validate loaded configuration using Zod
        const result = CommitConfigSchema.safeParse(userConfig);
        if (result.success) {
          return { ...DEFAULT_CONFIG, ...result.data };
        } else {
          console.warn(
            "Invalid config data, using defaults:",
            result.error.issues
          );
        }
      }
    } catch (error) {
      console.warn(
        "Failed to load config, using defaults:",
        sanitizeError(error)
      );
    }

    return DEFAULT_CONFIG;
  };

  public saveConfig = async (config: Partial<CommitConfig>): Promise<void> => {
    await withErrorHandling(
      async (): Promise<void> => {
        // Validate configuration before saving using Zod
        const result = CommitConfigSchema.partial().safeParse(config);
        if (!result.success) {
          throw new SecureError(
            `Invalid configuration: ${result.error.issues.map((e: { message: string }) => e.message).join(", ")}`,
            ErrorType.VALIDATION_ERROR,
            { operation: "saveConfig" },
            true
          );
        }

        this.config = { ...this.config, ...result.data };

        if (!fs.existsSync(CONFIG_DIR)) {
          fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
        }

        // Create a safe config object without sensitive data
        const safeConfig = { ...this.config };
        // Never save API key to file - always use environment variable
        delete safeConfig.apiKey;

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(safeConfig, null, 2), {
          mode: CONFIG_FILE_MODE,
        });
      },
      { operation: "saveConfig" }
    );
  };

  public getConfig = (): CommitConfig => {
    return { ...this.config };
  };

  public get = (key: keyof CommitConfig): unknown => {
    return this.config[key];
  };

  public set = async (
    key: keyof CommitConfig,
    value: unknown
  ): Promise<void> => {
    await withErrorHandling(
      async (): Promise<void> => {
        // Validate the specific key-value pair using Zod
        const partialSchema = CommitConfigSchema.pick({ [key]: true });
        const result = partialSchema.safeParse({ [key]: value });

        if (!result.success) {
          throw new SecureError(
            `Invalid value for ${key}: ${result.error.issues.map((e: { message: string }) => e.message).join(", ")}`,
            ErrorType.VALIDATION_ERROR,
            { operation: "setConfig", key },
            true
          );
        }

        this.config[key] = result.data[key];
        void this.saveConfig({});
      },
      { operation: "setConfig", key }
    );
  };

  public getApiKey = (): string => {
    // Always prioritize environment variable for security
    const envKey = process.env.GEMINI_API_KEY;
    if (envKey) {
      const result = ApiKeySchema.safeParse(envKey);
      if (result.success) {
        return result.data;
      }
    }

    // Fallback to config (less secure)
    const configKey = this.config.apiKey;
    if (configKey) {
      const result = ApiKeySchema.safeParse(configKey);
      if (result.success) {
        return result.data;
      }
    }

    return "";
  };

  public reset = (): void => {
    this.config = { ...DEFAULT_CONFIG };
    void this.saveConfig(this.config);
  };
}
