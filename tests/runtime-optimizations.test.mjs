import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const TEST_API_KEY = "test-api-key-12345";

const loadClasses = async () => {
  const module = await import("../dist/index.js");

  return {
    AIService: await module.AIService(),
    CommitX: await module.CommitX(),
    GitService: await module.GitService(),
  };
};

const createGitStatus = files => ({
  modified: files,
  not_added: [],
  deleted: [],
  staged: [],
  created: [],
  renamed: [],
  current: "main",
});

const createGitServiceForSummaryTests = async files => {
  const { GitService } = await loadClasses();
  const service = new GitService();
  const status = createGitStatus(files);

  service.repositoryPath = "/repo";
  service.validateFilePaths = input => input;

  return { service, status };
};

test("compressed AI cache entries round-trip from disk", async () => {
  const { AIService } = await loadClasses();
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "commitx-home-"));

  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  try {
    const firstService = new AIService();
    const secondService = new AIService();
    const diffs = [
      {
        file: "/repo/example.ts",
        additions: 2,
        deletions: 1,
        changes: "const value = 1;",
        isNew: false,
        isDeleted: false,
        isRenamed: false,
      },
    ];
    const suggestions = [
      {
        message: "Updated cache handling",
        description: "x".repeat(1500),
        confidence: 0.93,
      },
    ];
    const cache = firstService.aiCache;
    const key = cache.generateKey(diffs);

    await cache.set(key, suggestions);

    const diskEntryPath = path.join(homeDir, ".commitx", "cache", `${key}.cache`);
    const diskEntry = JSON.parse(await readFile(diskEntryPath, "utf8"));

    assert.equal(diskEntry.compressed, true);
    assert.deepEqual(await secondService.aiCache.get(key), suggestions);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("getChangesSummary reuses one git status snapshot", async () => {
  const files = ["src/a.ts", "src/b.ts"];
  const { service, status } = await createGitServiceForSummaryTests(files);
  let statusCalls = 0;

  service.git = {
    status: async () => {
      statusCalls += 1;
      return status;
    },
    diff: async args => `diff for ${args.at(-1)}`,
    diffSummary: async args => ({
      files: [
        {
          file: path.basename(args.at(-1)),
          insertions: 3,
          deletions: 1,
        },
      ],
    }),
  };

  await service.getChangesSummary();

  assert.equal(statusCalls, 1);
});

test("getChangesSummary collects diffs with bounded concurrency", async () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
  const { service, status } = await createGitServiceForSummaryTests(files);
  let inFlightDiffs = 0;
  let maxInFlightDiffs = 0;

  service.git = {
    status: async () => status,
    diff: async () => {
      inFlightDiffs += 1;
      maxInFlightDiffs = Math.max(maxInFlightDiffs, inFlightDiffs);

      await delay(25);
      inFlightDiffs -= 1;

      return "diff";
    },
    diffSummary: async args => ({
      files: [
        {
          file: path.basename(args.at(-1)),
          insertions: 1,
          deletions: 0,
        },
      ],
    }),
  };

  await service.getChangesSummary();

  assert.ok(maxInFlightDiffs > 1, "expected concurrent diff collection");
  assert.ok(maxInFlightDiffs <= 4, "expected bounded concurrency");
});

test("commitFilesBatch stages grouped files in one git add", async () => {
  const { CommitX } = await loadClasses();
  const commitX = new CommitX();
  const stageFilesCalls = [];
  const stageFileCalls = [];

  commitX.gitService = {
    getFileDiffs: async files =>
      files.map(file => ({
        file,
        additions: 4,
        deletions: 1,
        changes: `diff for ${file}`,
        isNew: false,
        isDeleted: false,
        isRenamed: false,
      })),
    stageFiles: async files => {
      stageFilesCalls.push(files);
    },
    stageFile: async file => {
      stageFileCalls.push(file);
    },
    waitForLockRelease: async () => {},
    commit: async () => {},
  };
  commitX.getAIService = () => ({
    generateAggregatedCommits: async () => ({
      groups: [
        {
          files: ["src/a.ts", "src/b.ts"],
          message: "Updated grouped files together",
          confidence: 0.92,
        },
      ],
    }),
  });

  await commitX.commitFilesBatch(["src/a.ts", "src/b.ts"], {});

  assert.deepEqual(stageFilesCalls, [["src/a.ts", "src/b.ts"]]);
  assert.deepEqual(stageFileCalls, []);
});

test("AI prompt builder keeps the prompt lean", async () => {
  const { AIService } = await loadClasses();
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  const service = new AIService();
  const diffs = [
    {
      file: "/repo/src/a.ts",
      additions: 12,
      deletions: 3,
      changes: "a".repeat(1200),
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    },
    {
      file: "/repo/src/b.ts",
      additions: 8,
      deletions: 2,
      changes: "b".repeat(1200),
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    },
  ];

  const { prompt } = service.buildAggregatedPrompt(diffs, "/repo");

  assert.ok(prompt.length < 7000, `prompt was too large: ${prompt.length}`);
  assert.equal(prompt.includes("good_groupings"), false);
  assert.equal(prompt.includes("bad_groupings"), false);
});
