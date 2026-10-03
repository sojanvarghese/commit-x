import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const originalCwd = process.cwd();

// One commit group per file, named after it, so the flow is deterministic.
const stubAIService = () => ({
  generateAggregatedCommits: async diffs => ({
    groups: diffs.map(diff => ({
      files: [diff.file],
      message: `Added ${path.basename(diff.file)} sample`,
      confidence: 0.9,
    })),
  }),
});

const withRepository = async run => {
  const repositoryPath = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "commitx-flow-"))
  );
  const git = async (...args) =>
    (await execFileAsync("git", args, { cwd: repositoryPath })).stdout.trim();

  try {
    await git("init", "-q", "-b", "main");
    await git("config", "user.name", "Commit-X Test");
    await git("config", "user.email", "commit-x@example.invalid");
    await writeFile(path.join(repositoryPath, "seed.txt"), "seed\n", "utf8");
    await git("add", "-A");
    await git("commit", "-q", "-m", "Initial commit");
    await writeFile(
      path.join(repositoryPath, "one.ts"),
      "export const one = 1;\n"
    );
    await writeFile(
      path.join(repositoryPath, "two.ts"),
      "export const two = 2;\n"
    );

    process.chdir(repositoryPath);
    const module = await import("../dist/index.js");
    const CommitX = await module.CommitX();
    const commitX = new CommitX();
    commitX.aiService = Promise.resolve(stubAIService());

    await run({ commitX, git, repositoryPath });
  } finally {
    process.chdir(originalCwd);
    await rm(repositoryPath, { recursive: true, force: true });
  }
};

test("each AI group becomes its own commit and the index ends clean", async () => {
  await withRepository(async ({ commitX, git }) => {
    await commitX.commit();

    assert.deepEqual((await git("log", "--format=%s")).split("\n"), [
      "Added two.ts sample",
      "Added one.ts sample",
      "Initial commit",
    ]);
    assert.equal(await git("status", "--porcelain"), "");
  });
});

test("a dry run reports the plan without committing", async () => {
  await withRepository(async ({ commitX, git }) => {
    await commitX.commit({ dryRun: true });

    assert.equal(await git("log", "--format=%s"), "Initial commit");
    assert.equal(await git("diff", "--cached", "--name-only"), "");
  });
});

test("a failed commit rejects and restores the index", async () => {
  await withRepository(async ({ commitX, git, repositoryPath }) => {
    const hookPath = path.join(repositoryPath, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
    await chmod(hookPath, 0o755);

    await assert.rejects(commitX.commit(), { type: "GIT_ERROR" });

    assert.equal(await git("log", "--format=%s"), "Initial commit");
    assert.equal(await git("diff", "--cached", "--name-only"), "");
  });
});

test("commands outside a repository reject with a git error", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "commitx-norepo-"));
  try {
    process.chdir(dir);
    const module = await import("../dist/index.js");
    const CommitX = await module.CommitX();

    await assert.rejects(new CommitX().commit({ dryRun: true }), {
      type: "GIT_ERROR",
      message: /not a git repository/i,
    });
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
