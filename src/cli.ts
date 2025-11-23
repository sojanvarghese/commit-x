#!/usr/bin/env node

// Track startup performance from the very beginning
const startupStart = performance.now();

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import process from "process";
import { lightColors } from "./utils/colors.js";
import { lazyModules, preloadCriticalModules } from "./utils/lazy-loader.js";
import { PERFORMANCE_FLAGS } from "./constants/performance.js";

// Start background preloading of critical modules
preloadCriticalModules();

// Log startup time
if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING) {
  process.nextTick(() => {
    const startupTime = performance.now() - startupStart;
    if (startupTime > 200) {
      // Lowered threshold to 200ms target
      console.log(`🚀 Startup time: ${startupTime.toFixed(2)}ms`);
    }
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);

const program = new Command();

// Helper function to parse configuration values
const parseConfigValue = (value: string): string | number | boolean => {
  const lowerValue = value.toLowerCase();

  switch (lowerValue) {
    case "true":
      return true;
    case "false":
      return false;
    default:
      return !isNaN(Number(value)) ? Number(value) : value;
  }
};

program
  .name("cx")
  .description("🚀 AI-powered Git commit assistant")
  .version(packageJson.version);

// Main commit command
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
  .option("--all", "Stage all files and commit together (traditional workflow)")
  .action(
    async (options: {
      message?: string;
      dryRun?: boolean;
      interactive?: boolean;
      all?: boolean;
    }): Promise<void> => {
      const { withErrorHandling } = await import("./utils/error-handler.js");
      return withErrorHandling(
        async (): Promise<void> => {
          // Validate command combinations
          if (options.interactive && !options.all) {
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
            process.exit(1);
          }

          // Validate commit message if provided (lazy load validation)
          if (options.message) {
            const { CommitMessageSchema } = await import(
              "./schemas/validation.js"
            );
            const { ErrorType } = await import("./types/error-handler.js");
            const { SecureError } = await import("./utils/error-handler.js");

            const result = CommitMessageSchema.safeParse(options.message);
            if (!result.success) {
              throw new SecureError(
                `Invalid commit message: ${result.error.issues.map((e: { message: string }) => e.message).join(", ")}`,
                ErrorType.VALIDATION_ERROR,
                { operation: "commit" },
                true
              );
            }
            options.message = result.data;
          }

          // Use lazy loading for core functionality
          const operation = options.all ? "commit-traditional" : "commit-ai";

          const { withPerformanceTracking } = await import(
            "./utils/performance.js"
          );
          await withPerformanceTracking(operation, async () => {
            const { CommitX } = await lazyModules.commitX();
            const commitX = new CommitX();

            await commitX.commit({
              message: options.message,
              dryRun: options.dryRun,
              interactive: options.interactive,
              all: options.all,
            });
          });
        },
        { operation: "commit" }
      );
    }
  );

// Status command
program
  .command("status")
  .alias("s")
  .description("Show repository status and changes")
  .action(async () => {
    const { withErrorHandling } = await import("./utils/error-handler.js");
    return withErrorHandling(
      async (): Promise<void> => {
        // Use lazy loading for core functionality
        const { CommitX } = await lazyModules.commitX();
        const commitX = new CommitX();
        await commitX.status();
      },
      { operation: "status" }
    );
  });

// Diff command
program
  .command("diff")
  .alias("d")
  .description("Show unstaged changes summary")
  .action(async () => {
    const { withErrorHandling } = await import("./utils/error-handler.js");
    return withErrorHandling(
      async (): Promise<void> => {
        // Use lazy loading for core functionality
        const { CommitX } = await lazyModules.commitX();
        const commitX = new CommitX();
        await commitX.diff();
      },
      { operation: "diff" }
    );
  });

// Configuration commands
const configCmd = program
  .command("config")
  .description("Manage Commitron configuration");

configCmd
  .command("set <key> <value>")
  .description("Set configuration value")
  .action(async (key: string, value: string): Promise<void> => {
    const { withErrorHandling, SecureError } = await import(
      "./utils/error-handler.js"
    );
    await withErrorHandling(
      async (): Promise<void> => {
        // Lazy load validation and config
        const { CommitConfigSchema } = await import("./schemas/validation.js");
        const { ErrorType } = await import("./types/error-handler.js");
        const { ConfigManager } = await lazyModules.config();

        // Validate that the key is a valid config key
        if (!(key in CommitConfigSchema.shape)) {
          throw new SecureError(
            `Invalid configuration key: ${key}. Allowed keys: ${Object.keys(CommitConfigSchema.shape).join(", ")}`,
            ErrorType.VALIDATION_ERROR,
            { operation: "configSet", key },
            true
          );
        }

        const config = ConfigManager.getInstance();

        // Parse boolean values
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
      "./utils/error-handler.js"
    );
    await withErrorHandling(
      async (): Promise<void> => {
        // Lazy load config and validation
        const { ConfigManager } = await lazyModules.config();
        const { CommitConfigSchema } = await import("./schemas/validation.js");
        const { ErrorType } = await import("./types/error-handler.js");

        const config = ConfigManager.getInstance();
        const allKeys = Object.keys(CommitConfigSchema.shape);

        const isValidKey = (k: string): boolean => allKeys.includes(k);

        if (key) {
          if (!isValidKey(key)) {
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
        } else {
          const allConfig = config.getConfig();
          const apiKey = config.getApiKey();

          console.log(lightColors.blue("Current configuration:"));
          for (const [k, v] of Object.entries(allConfig)) {
            const isSensitive = k === "apiKey";
            const displayValue = isSensitive ? "********" : v;
            console.log(`  ${k}: ${displayValue}`);
          }

          if (!("apiKey" in allConfig)) {
            console.log(`  apiKey: ${apiKey ? "********" : "Not set"}`);
          }
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
      const { handleErrorImmediate } = await import("./utils/process-utils.js");
      handleErrorImmediate(error);
    }
  });

// Setup command for first-time configuration
program
  .command("setup")
  .description("Interactive setup for first-time users")
  .action(async () => {
    const inquirer = await lazyModules.inquirer();
    console.log(lightColors.blue("🚀 Welcome to Commitron Setup!\n"));

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
      const { handleErrorImmediate } = await import("./utils/process-utils.js");
      handleErrorImmediate(error, "Setup failed");
    }
  });

// Privacy command
program
  .command("privacy")
  .description("Show privacy settings and data handling information")
  .action(async (): Promise<void> => {
    console.log(`${lightColors.blue("🔒 Commitron Privacy Information:\n")}

${lightColors.yellow("Data Sent to AI:")}
  • File paths (sanitized to remove usernames)
  • Code changes (up to 3000 characters per file)
  • File metadata (additions/deletions counts)
  • File status (new/modified/deleted/renamed)

${lightColors.yellow("Data NOT Sent to AI:")}
  • API keys or authentication tokens
  • Personal information (names, emails)
  • System information (OS, hardware)
  • Repository metadata (URLs, branch names)

${lightColors.yellow("Privacy Protections:")}
  • Sensitive files are automatically skipped
  • File paths are sanitized to remove usernames
  • Potential secrets are redacted from content
  • Content is limited to 3000 characters per file
  • Total request size is capped at 100KB

${lightColors.yellow("Sensitive File Types (Auto-skipped):")}
  • .env, .key, .pem, .p12, .pfx, .p8 files
  • Files in secrets/, keys/, credentials/ directories
  • Files containing API keys, passwords, or tokens

${lightColors.yellow("Common Warning Types:")}
  • Potential sensitive data detected
  • Sensitive file pattern detected
  • Potential secrets detected in comments
  • Sensitive file type
  • Located in sensitive directory

${lightColors.gray("For more information, visit: https://github.com/sojanvarghese/commitx#privacy")}`);
  });

// Help command with examples
program
  .command("help-examples")
  .description("Show usage examples")
  .action(async (): Promise<void> => {
    const gradientString = await lazyModules.gradientString();
    console.log(`${gradientString.pastel("📚 Commitron Usage Examples:\n")}

${lightColors.yellow("Basic usage:")}
  cx                             # Process files with AI
  cx commit --dry-run            # Preview commits
  cx commit                      # Direct CLI access

${lightColors.yellow("Traditional workflow:")}
  cx commit --all                # Stage all files and commit together
  cx commit -m "fix: bug"        # Use custom message (traditional)

${lightColors.yellow("Status and information:")}
  cx status                      # Show repository status
  cx diff                        # Show changes summary

${lightColors.yellow("Configuration:")}
  cx setup                       # Interactive setup
  cx config                      # View configuration
  cx config set <key> <value>    # Set configuration values
  cx config reset                # Reset configuration
  cx privacy                     # Show privacy information`);
  });

// Debug command
program
  .command("debug")
  .description("Debug Git repository detection and environment")
  .action(async (): Promise<void> => {
    let debugOutput = `${lightColors.blue("\n🔍 Commitron Debug Information:\n")}

${lightColors.gray("Environment:")}
  Current working directory: ${process.cwd()}
  Node.js version: ${process.version}
  Platform: ${process.platform}
  Architecture: ${process.arch}

${lightColors.gray("\nGit repository detection:")}`;

    try {
      const security = await lazyModules.security();
      const validation = await security.validateGitRepository(process.cwd());
      debugOutput += `\n  Valid Git repository: ${validation.isValid ? "✅ Yes" : "❌ No"}`;
      if (!validation.isValid) {
        debugOutput += `\n  Error: ${validation.error}`;
      } else {
        debugOutput += `\n  Repository path: ${validation.sanitizedValue}`;
      }
    } catch (error) {
      debugOutput += `\n  Error during validation: ${error}`;
    }

    debugOutput += `\n\n${lightColors.gray("Git directory structure:")}`;
    try {
      const fs = await import("fs");
      const path = await import("path");
      const gitDir = path.join(process.cwd(), ".git");
      debugOutput += `\n  .git directory exists: ${fs.existsSync(gitDir) ? "✅ Yes" : "❌ No"}`;
      if (fs.existsSync(gitDir)) {
        const headFile = path.join(gitDir, "HEAD");
        debugOutput += `\n  HEAD file exists: ${fs.existsSync(headFile) ? "✅ Yes" : "❌ No"}`;
        if (fs.existsSync(headFile)) {
          const headContent = fs.readFileSync(headFile, "utf8");
          debugOutput += `\n  HEAD content: ${headContent.trim()}`;
        }
      }
    } catch (error) {
      debugOutput += `\n  Error checking Git structure: ${error}`;
    }

    console.log(debugOutput);
  });

// Default action for commit when no subcommand is provided
program.action(async (): Promise<void> => {
  try {
    // Use lazy loading for core functionality
    const { CommitX } = await lazyModules.commitX();
    const commitX = new CommitX();
    await commitX.commit(); // Uses AI processing by default
  } catch (error) {
    const { handleErrorImmediate } = await import("./utils/process-utils.js");
    handleErrorImmediate(error);
  }
});

// Error handling for unknown commands
program.on("command:*", async (): Promise<void> => {
  console.error(
    lightColors.red(`❌ Unknown command: ${program.args.join(" ")}`)
  );
  console.log(`${lightColors.yellow("\n💡 Available commands:")}
${lightColors.blue("  cx --help              # Show all available commands")}
${lightColors.blue("  cx commit --help       # Show commit command options")}
${lightColors.blue("  cx help-examples       # Show usage examples")}
${lightColors.gray("\nFor more information, visit: https://github.com/sojanvarghese/commitx")}`);
  process.exit(1);
});

// Error handling for invalid options
program.on("option:*", async (): Promise<void> => {
  console.error(
    lightColors.red(`❌ Unknown option: ${program.args.join(" ")}`)
  );
  console.log(`${lightColors.yellow("\n💡 Available options:")}
${lightColors.blue("  cx --help              # Show all available commands")}
${lightColors.blue("  cx commit --help       # Show commit command options")}
${lightColors.gray("\nFor more information, visit: https://github.com/sojanvarghese/commitx")}`);
  process.exit(1);
});

// Performance monitoring exit handler
if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING) {
  process.on("exit", async () => {
    try {
      const { PerformanceMonitor } = await import("./utils/performance.js");
      const monitor = PerformanceMonitor.getInstance();
      monitor.logMetrics();
    } catch {
      // Ignore errors during cleanup
    }
  });
}

// Parse command line arguments
if (process.argv.length === 2) {
  // No arguments provided, run default commit
  void (async (): Promise<void> => {
    try {
      // Use lazy loading for performance tracking and core functionality
      const { withPerformanceTracking } = await import(
        "./utils/performance.js"
      );
      await withPerformanceTracking("default-commit", async () => {
        const { CommitX } = await lazyModules.commitX();
        const commitX = new CommitX();
        await commitX.commit();
      });
    } catch (error) {
      const { handleErrorImmediate } = await import("./utils/process-utils.js");
      handleErrorImmediate(error);
    }
  })();
} else {
  program.parse(process.argv);
}
