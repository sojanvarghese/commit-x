import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const ESCAPE = "\u001B[";

const loadModule = async () => import("../dist/index.js");

const runCli = async (args, { cwd, env = {} } = {}) => {
  const childEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [CLI_PATH, ...args],
      { cwd, env: childEnv }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
};

const withTempDir = async run => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "commitx-norepo-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// A repository with nothing to commit: `cx commit --dry-run` prints one
// coloured line to stdout and touches nothing.
const withCleanRepository = run =>
  withTempDir(async cwd => {
    const git = (...args) => execFileAsync("git", args, { cwd });
    await git("init", "-q", "-b", "main");
    await git("config", "user.name", "Commit-X Test");
    await git("config", "user.email", "commit-x@example.invalid");
    await git("commit", "-q", "--allow-empty", "-m", "Initial commit");
    return run(cwd);
  });

const DRY_RUN = ["commit", "--dry-run"];

const captureConsoleErrors = async run => {
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args.join(" "));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return calls;
};

test("a failed command is reported exactly once", async () => {
  const result = await withTempDir(cwd =>
    runCli(DRY_RUN, {
      cwd,
      env: { NO_COLOR: "1", FORCE_COLOR: undefined },
    })
  );

  assert.equal(result.code, 1);
  assert.equal(result.stderr.match(/❌/g)?.length, 1);
  assert.match(result.stderr, /not a git repository/i);
  assert.doesNotMatch(result.stderr, /SecureError/);
});

test("isGitRepository reports false outside a repository", async () => {
  const module = await loadModule();
  const GitService = await module.GitService();

  await withTempDir(async dir => {
    assert.equal(await new GitService(dir).isGitRepository(), false);
  });
});

test("service failures are classified by where they happened, without printing", async () => {
  const module = await loadModule();
  const GitService = await module.GitService();
  const service = new GitService();
  service.git = {
    status: async () => {
      throw new Error("Something failed");
    },
  };

  let failure;
  const printed = await captureConsoleErrors(async () => {
    failure = await service.getUnstagedFiles().catch(error => error);
  });

  assert.equal(failure.type, "GIT_ERROR");
  assert.equal(failure.message, "Something failed");
  assert.deepEqual(printed, []);
});

test("timeouts are identifiable by error name", async () => {
  const { security } = await loadModule();

  await assert.rejects(security.withTimeout(new Promise(() => {}), 10), {
    name: "TimeoutError",
  });
});

test("output is plain when piped", async () => {
  const result = await withCleanRepository(cwd =>
    runCli(DRY_RUN, {
      cwd,
      env: { NO_COLOR: undefined, FORCE_COLOR: undefined },
    })
  );
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No changes detected/);
  assert.equal(result.stdout.includes(ESCAPE), false);
});

test("FORCE_COLOR enables colour when piped", async () => {
  const result = await withCleanRepository(cwd =>
    runCli(DRY_RUN, {
      cwd,
      env: { NO_COLOR: undefined, FORCE_COLOR: "1" },
    })
  );
  assert.equal(result.stdout.includes(ESCAPE), true);
});

test("NO_COLOR disables colour", async () => {
  const result = await withCleanRepository(cwd =>
    runCli(DRY_RUN, {
      cwd,
      env: { NO_COLOR: "1", FORCE_COLOR: undefined },
    })
  );
  assert.equal(result.stdout.includes(ESCAPE), false);
});
