import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INDEX_URL = new URL("../dist/index.js", import.meta.url).href;
const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// Runs `body` in a child process where resolving the Gemini SDK throws.
const runWithoutGeminiSdk = body => {
  const hook = `export async function resolve(specifier, context, next) {
    if (specifier === "@google/genai") throw new Error("Gemini SDK was loaded");
    return next(specifier, context);
  }`;
  const script = `
    import { register } from "node:module";
    register("data:text/javascript," + encodeURIComponent(${JSON.stringify(hook)}));
    const module = await import(${JSON.stringify(INDEX_URL)});
    ${body}
  `;
  return execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
};

test("constructing CommitX does not load the Gemini SDK", async () => {
  await runWithoutGeminiSdk(`
    const CommitX = await module.CommitX();
    new CommitX();
  `);
});

test("the Gemini SDK is still loaded once the AI service is requested", async () => {
  await assert.rejects(
    runWithoutGeminiSdk("await module.AIService();"),
    /Gemini SDK was loaded/
  );
});

test("a documentation-only change does not load the Gemini SDK", async () => {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "commitx-docs-"));
  const git = (...args) => execFileAsync("git", args, { cwd: repositoryPath });

  try {
    await git("init", "-q", "-b", "main");
    await git("config", "user.name", "Commit-X Test");
    await git("config", "user.email", "commit-x@example.invalid");
    await writeFile(path.join(repositoryPath, "README.md"), "seed\n", "utf8");
    await git("add", "README.md");
    await git("commit", "-q", "-m", "Initial commit");
    await writeFile(
      path.join(repositoryPath, "README.md"),
      "seed\nupdated\n",
      "utf8"
    );

    await runWithoutGeminiSdk(`
      process.chdir(${JSON.stringify(repositoryPath)});
      delete process.env.GEMINI_API_KEY;
      const CommitX = await module.CommitX();
      await new CommitX().commit({ dryRun: true });
    `);
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
});

test("root flags route to the default commit command", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "commitx-cli-"));
  try {
    for (const args of [["--dry-run"], ["--use-cached"], ["c", "--dry-run"]]) {
      let code = 0;
      let stderr = "";
      try {
        await execFileAsync(process.execPath, [CLI_PATH, ...args], {
          cwd: dir,
          env: { ...process.env, NO_COLOR: "1" },
        });
      } catch (error) {
        code = error.code;
        stderr = error.stderr ?? "";
      }
      assert.equal(code, 1, args.join(" "));
      assert.match(stderr, /not a git repository/i);
      assert.doesNotMatch(stderr, /unknown option/i);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
