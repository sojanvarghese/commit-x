#!/usr/bin/env node

import { Command } from "commander";
import process from "node:process";
import type { CommitOptions } from "./types/common.js";

// Failures from anywhere below surface here and are reported once.
const runCommit = async (options: CommitOptions = {}): Promise<void> => {
  try {
    const { CommitX } = await import("./core/commitx.js");
    await new CommitX().commit(options);
  } catch (error) {
    const { reportError } = await import("./utils/error-handler.js");
    reportError(error, { operation: "commit" });
  }
};

const program = new Command();

program
  .name("cx")
  .description("🚀 AI-powered Git commit assistant")
  .version(__COMMIT_X_VERSION__)
  .action(() => runCommit());

program
  .command("commit")
  .alias("c")
  .description("Generate and create AI-powered commit messages")
  .option(
    "-d, --dry-run",
    "Show what would be committed without actually committing"
  )
  .option("--use-cached", "Reuse cached AI results (fresh by default)", false)
  .action((options: CommitOptions) => runCommit(options));

program.parse(process.argv);
