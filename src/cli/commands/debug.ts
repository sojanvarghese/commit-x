import process from "process";
import type { Command } from "commander";
import { lightColors } from "../../utils/colors.js";
import { lazyModules } from "../../utils/lazy-loader.js";

const probeGitRepository = async (): Promise<string> => {
  try {
    const security = await lazyModules.security();
    const validation = await security.validateGitRepository(process.cwd());
    let output = `\n  Valid Git repository: ${validation.isValid ? "✅ Yes" : "❌ No"}`;
    if (!validation.isValid) {
      output += `\n  Error: ${validation.error}`;
    } else {
      output += `\n  Repository path: ${validation.sanitizedValue}`;
    }
    return output;
  } catch (error) {
    return `\n  Error during validation: ${error}`;
  }
};

const probeGitDirectory = async (): Promise<string> => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const gitDir = path.join(process.cwd(), ".git");
    let output = `\n  .git directory exists: ${fs.existsSync(gitDir) ? "✅ Yes" : "❌ No"}`;
    if (fs.existsSync(gitDir)) {
      const headFile = path.join(gitDir, "HEAD");
      output += `\n  HEAD file exists: ${fs.existsSync(headFile) ? "✅ Yes" : "❌ No"}`;
      if (fs.existsSync(headFile)) {
        const headContent = fs.readFileSync(headFile, "utf8");
        output += `\n  HEAD content: ${headContent.trim()}`;
      }
    }
    return output;
  } catch (error) {
    return `\n  Error checking Git structure: ${error}`;
  }
};

export const registerDebugCommand = (program: Command): void => {
  program
    .command("debug")
    .description("Debug Git repository detection and environment")
    .action(async (): Promise<void> => {
      const environment = `${lightColors.blue("\n🔍 Commit-X Debug Information:\n")}

${lightColors.gray("Environment:")}
  Current working directory: ${process.cwd()}
  Node.js version: ${process.version}
  Platform: ${process.platform}
  Architecture: ${process.arch}

${lightColors.gray("\nGit repository detection:")}`;

      const gitRepoOutput = await probeGitRepository();
      const gitDirOutput = `\n\n${lightColors.gray("Git directory structure:")}${await probeGitDirectory()}`;

      console.log(`${environment}${gitRepoOutput}${gitDirOutput}`);
    });
};
