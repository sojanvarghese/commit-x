import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const loadGitService = async () => {
  const module = await import("../dist/index.js");
  return module.GitService();
};

const createStatus = (overrides = {}) => ({
  modified: [],
  not_added: [],
  deleted: [],
  staged: [],
  created: [],
  renamed: [],
  current: "main",
  ...overrides,
});

const createService = async () => {
  const GitService = await loadGitService();
  const service = new GitService();
  service.repositoryPath = "/repo";
  return service;
};

const patchFor = file =>
  [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1,2 @@",
    `-old ${file}`,
    `+new ${file}`,
    `+more ${file}`,
    "",
  ].join("\n");

const isBatchCall = args =>
  args.filter(arg => arg.startsWith("src/")).length > 1;

test("tracked-file patches are collected with one git diff call", async () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const service = await createService();
  const diffCalls = [];
  service.git = {
    status: async () => createStatus({ modified: files }),
    diff: async args => {
      diffCalls.push(args);
      return files.map(patchFor).join("");
    },
  };

  const diffs = await service.getFileDiffs(files.map(file => `/repo/${file}`));

  assert.equal(diffCalls.length, 1);
  assert.deepEqual(
    diffs.map(diff => [diff.file, diff.additions, diff.deletions]),
    files.map(file => [`/repo/${file}`, 2, 1])
  );
  assert.equal(diffs[1].changes, patchFor("src/b.ts"));
});

test("a file missing from the batched output falls back to its own diff", async () => {
  const files = ["src/a.ts", "src/b.ts"];
  const service = await createService();
  const singleCalls = [];
  service.git = {
    status: async () => createStatus({ modified: files }),
    diff: async args => {
      if (isBatchCall(args)) return patchFor("src/a.ts");
      singleCalls.push(args.at(-1));
      return patchFor(args.at(-1));
    },
  };

  const diffs = await service.getFileDiffs(files.map(file => `/repo/${file}`));

  assert.deepEqual(singleCalls, ["src/b.ts"]);
  assert.deepEqual(
    diffs.map(diff => diff.changes),
    files.map(patchFor)
  );
});

test("a failed batch diff falls back to per-file diffs", async () => {
  const files = ["src/a.ts", "src/b.ts"];
  const service = await createService();
  service.git = {
    status: async () => createStatus({ modified: files }),
    diff: async args => {
      if (isBatchCall(args)) throw new Error("argument list too long");
      return patchFor(args.at(-1));
    },
  };

  const diffs = await service.getFileDiffs(files.map(file => `/repo/${file}`));

  assert.deepEqual(
    diffs.map(diff => diff.changes),
    files.map(patchFor)
  );
});

test("staging a group checks the index without a full status scan", async () => {
  const service = await createService();
  let statusCalls = 0;
  const diffCalls = [];
  const added = [];
  service.git = {
    status: async () => {
      statusCalls += 1;
      return createStatus();
    },
    diff: async args => {
      diffCalls.push(args);
      return "";
    },
    add: async files => {
      added.push(...files);
    },
  };

  await service.stageFiles(["/repo/src/a.ts"]);

  assert.equal(statusCalls, 0);
  assert.deepEqual(diffCalls, [["--cached", "--name-only"]]);
  assert.deepEqual(added, ["/repo/src/a.ts"]);
});

test("staging a group is refused while the index holds other changes", async () => {
  const service = await createService();
  let addCalled = false;
  service.git = {
    status: async () => createStatus(),
    diff: async () => "already-staged.ts\n",
    add: async () => {
      addCalled = true;
    },
  };

  await assert.rejects(
    service.stageFiles(["/repo/src/a.ts"]),
    /index contains other changes/i
  );
  assert.equal(addCalled, false);
});

test("batched diffs match per-file diffs in a real repository", async () => {
  const GitService = await loadGitService();
  const repositoryPath = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "commitx-batch-"))
  );
  const git = (...args) => execFileAsync("git", args, { cwd: repositoryPath });
  const names = ["plain.ts", "with space.ts", "café.ts", "a b/nested file.ts"];

  try {
    await git("init", "-q", "-b", "main");
    await git("config", "user.name", "Commit-X Test");
    await git("config", "user.email", "commit-x@example.invalid");
    // Header formats the user may have configured must not break batching.
    await git("config", "diff.mnemonicPrefix", "true");
    await execFileAsync("mkdir", ["a b"], { cwd: repositoryPath });
    for (const name of names) {
      await writeFile(path.join(repositoryPath, name), `one\ntwo\n`, "utf8");
    }
    await git("add", "-A");
    await git("commit", "-q", "-m", "Initial commit");
    for (const name of names) {
      await writeFile(
        path.join(repositoryPath, name),
        `one\nchanged in ${name}\nadded\n`,
        "utf8"
      );
    }

    const service = new GitService(repositoryPath);
    assert.equal(await service.isGitRepository(), true);
    const files = await service.getUnstagedFiles();
    assert.equal(files.length, names.length);

    const batched = await service.getFileDiffs(files);
    const single = [];
    for (const file of files) single.push(await service.getFileDiff(file));

    assert.deepEqual(batched, single);
    for (const diff of batched) {
      const name = path.relative(repositoryPath, diff.file);
      assert.equal(diff.additions, 2, name);
      assert.equal(diff.deletions, 1, name);
      assert.match(diff.changes, new RegExp(`^\\+changed in ${name}$`, "m"));
      assert.equal(diff.changes.match(/^\+changed in /gm).length, 1, name);
    }
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
});
