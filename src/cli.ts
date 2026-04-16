#!/usr/bin/env node

const startupStart = performance.now();

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import process from "process";
import { lightColors } from "./utils/colors.js";
import { lazyModules, preloadCriticalModules } from "./utils/lazy-loader.js";
import { PERFORMANCE_FLAGS } from "./constants/performance.js";
import { registerCommitCommand } from "./cli/commands/commit.js";
import { registerStatusCommand } from "./cli/commands/status.js";
import { registerDiffCommand } from "./cli/commands/diff.js";
import { registerConfigCommand } from "./cli/commands/config.js";
import { registerSetupCommand } from "./cli/commands/setup.js";
import { registerPrivacyCommand } from "./cli/commands/privacy.js";
import { registerHelpExamplesCommand } from "./cli/commands/help-examples.js";
import { registerDebugCommand } from "./cli/commands/debug.js";

preloadCriticalModules(process.argv[2]);

if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING) {
  process.nextTick(() => {
    const startupTime = performance.now() - startupStart;
    if (startupTime > 200) {
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

program
  .name("cx")
  .description("🚀 AI-powered Git commit assistant")
  .version(packageJson.version);

registerCommitCommand(program);
registerStatusCommand(program);
registerDiffCommand(program);
registerConfigCommand(program);
registerSetupCommand(program);
registerPrivacyCommand(program);
registerHelpExamplesCommand(program);
registerDebugCommand(program);

const runDefaultCommit = async (): Promise<void> => {
  try {
    const { withPerformanceTracking } = await import(
      "./utils/performance.js"
    );
    await withPerformanceTracking("default-commit", async () => {
      const { CommitX } = await lazyModules.commitX();
      const commitX = new CommitX();
      await commitX.commit();
    });
  } catch (error) {
    const { handleErrorImmediate } = await import(
      "./utils/process-utils.js"
    );
    handleErrorImmediate(error);
  }
};

program.action(runDefaultCommit);

program.on("command:*", async (): Promise<void> => {
  console.error(
    lightColors.red(`❌ Unknown command: ${program.args.join(" ")}`)
  );
  console.log(`${lightColors.yellow("\n💡 Available commands:")}
${lightColors.blue("  cx --help              # Show all available commands")}
${lightColors.blue("  cx commit --help       # Show commit command options")}
${lightColors.blue("  cx help-examples       # Show usage examples")}
${lightColors.gray("\nFor more information, visit: https://github.com/sojanvarghese/commit-x")}`);
  process.exit(1);
});

program.on("option:*", async (): Promise<void> => {
  console.error(
    lightColors.red(`❌ Unknown option: ${program.args.join(" ")}`)
  );
  console.log(`${lightColors.yellow("\n💡 Available options:")}
${lightColors.blue("  cx --help              # Show all available commands")}
${lightColors.blue("  cx commit --help       # Show commit command options")}
${lightColors.gray("\nFor more information, visit: https://github.com/sojanvarghese/commit-x")}`);
  process.exit(1);
});

if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING) {
  process.on("exit", async () => {
    try {
      const { PerformanceMonitor } = await import("./utils/performance.js");
      const monitor = PerformanceMonitor.getInstance();
      monitor.logMetrics();
    } catch {
      /* empty */
    }
  });
}

// Commander invokes `program.action(runDefaultCommit)` when no subcommand is
// given, so parse unconditionally — no need to branch on argv length.
program.parse(process.argv);
