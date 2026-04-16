import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const TEST_API_KEY = "test-api-key-12345";

const loadModule = async () => import("../dist/index.js");

const loadClasses = async () => {
  const module = await loadModule();
  return {
    AIService: await module.AIService(),
    CommitX: await module.CommitX(),
    GitService: await module.GitService(),
    aiPrompt: module.aiPrompt,
    aiCommitGroup: module.aiCommitGroup,
    diffMinimizer: module.diffMinimizer,
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

test("AI prompt builder keeps the prompt lean", async () => {
  const { aiPrompt } = await loadClasses();
  const diffs = [
    {
      file: "src/a.ts",
      additions: 12,
      deletions: 3,
      changes: "a".repeat(1200),
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    },
    {
      file: "src/b.ts",
      additions: 8,
      deletions: 2,
      changes: "b".repeat(1200),
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    },
  ];

  const { prompt } = aiPrompt.buildAggregatedPrompt(diffs);

  assert.ok(prompt.length < 7000, `prompt was too large: ${prompt.length}`);
  assert.equal(prompt.includes("good_groupings"), false);
  assert.equal(prompt.includes("bad_groupings"), false);
});

test("oversized prompt content drops import churn and collapses blank lines", async () => {
  const { aiPrompt } = await loadClasses();
  const diff = {
    file: "src/routes.ts",
    additions: 80,
    deletions: 12,
    changes: [
      ...Array.from(
        { length: 300 },
        (_, index) => `+import dependency${index} from "lib-${index}";`
      ),
      "",
      "",
      "",
      "+const routeConfig = createRoutes(app);",
      "+registerRoute(routeConfig);",
    ].join("\n"),
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  };

  const { prompt } = aiPrompt.buildAggregatedPrompt([diff]);

  assert.equal(prompt.includes('import dependency0 from "lib-0"'), false);
  assert.equal(prompt.includes("\n\n\n"), false);
  assert.equal(prompt.includes("registerRoute(routeConfig);"), true);
});

test("boilerplate stripping removes comments, console.log, and whitespace-only changes", async () => {
  const { aiPrompt } = await loadClasses();
  const boilerplateLines = Array.from(
    { length: 200 },
    (_, i) => `+// Comment line ${i} that adds bulk`
  );
  const diff = {
    file: "src/handler.ts",
    additions: 220,
    deletions: 5,
    changes: [
      ...boilerplateLines,
      "+/** JSDoc block */",
      "+ * @param x description",
      "+ */",
      "+console.log('debug output');",
      "+console.debug('more debug');",
      "+   ",
      "+const handler = async (req) => {",
      "+  return processRequest(req);",
      "+};",
    ].join("\n"),
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  };

  const filler = Array.from({ length: 29 }, (_, i) => ({
    file: `src/filler${i}.ts`,
    additions: 5,
    deletions: 1,
    changes: `+const filler${i} = true;`,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  }));

  const { prompt } = aiPrompt.buildAggregatedPrompt([diff, ...filler]);

  assert.equal(prompt.includes("Comment line"), false);
  assert.equal(prompt.includes("JSDoc block"), false);
  assert.equal(prompt.includes("console.log"), false);
  assert.equal(prompt.includes("console.debug"), false);
  assert.equal(prompt.includes("processRequest"), true);
});

test("repetitive diff lines are collapsed", async () => {
  const { aiPrompt } = await loadClasses();
  const diffs = Array.from({ length: 60 }, (_, i) => ({
    file: `src/file${i}.ts`,
    additions: 30,
    deletions: 0,
    changes: Array.from(
      { length: 30 },
      (_, j) => `+const variable${j} = getValue(${j});`
    ).join("\n"),
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  }));

  const { prompt } = aiPrompt.buildAggregatedPrompt(diffs);

  assert.ok(prompt.includes("similar lines omitted"));
});

test("small repeated diff lines are preserved below collapse threshold", async () => {
  const { diffMinimizer } = await loadClasses();
  const content = [
    "+const value = getThing();",
    "+const value = getThing();",
    "+const value = getThing();",
    "+const value = getThing();",
    "+const value = getThing();",
    "+const alpha = 1;",
    "+const beta = 2;",
    "+const gamma = 3;",
    "+const delta = 4;",
    "+const epsilon = 5;",
  ].join("\n");

  const collapsed = diffMinimizer.collapseRepetitiveLines(content);

  assert.equal(
    collapsed.match(/\+const value = getThing\(\);/g)?.length ?? 0,
    5
  );
  assert.equal(collapsed.includes("similar lines omitted"), false);
});

test("pre-grouping auto-groups lockfile + manifest and sends other changes to AI", async () => {
  const { aiCommitGroup } = await loadClasses();
  const diffs = [
    { file: "package.json", additions: 2, deletions: 1, changes: "dep change", isNew: false, isDeleted: false, isRenamed: false },
    { file: "yarn.lock", additions: 100, deletions: 50, changes: "lock update", isNew: false, isDeleted: false, isRenamed: false },
    { file: "src/old-a.ts", additions: 0, deletions: 10, changes: "", isNew: false, isDeleted: true, isRenamed: false },
    { file: "src/old-b.ts", additions: 0, deletions: 20, changes: "", isNew: false, isDeleted: true, isRenamed: false },
    { file: "src/old-c.ts", additions: 0, deletions: 15, changes: "", isNew: false, isDeleted: true, isRenamed: false },
  ];

  const result = aiCommitGroup.preGroupDeterministicFiles(diffs);

  assert.equal(result.autoGroups.length, 1);
  assert.ok(result.autoGroups[0].files.includes("package.json"));
  assert.ok(result.autoGroups[0].files.includes("yarn.lock"));
  assert.equal(result.autoGroups[0].message, "Updated project dependencies");

  assert.deepEqual(
    result.aiDiffs.map(diff => diff.file),
    ["src/old-a.ts", "src/old-b.ts", "src/old-c.ts"]
  );
});

test("package.json without a lockfile stays in AI path (manifest category)", async () => {
  const { aiCommitGroup } = await loadClasses();
  const diffs = [
    {
      file: "package.json",
      additions: 2,
      deletions: 1,
      changes: '+  "scripts": {\n+    "build": "node cli.js"\n+  }',
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    },
  ];

  const result = aiCommitGroup.preGroupDeterministicFiles(diffs);

  assert.equal(result.autoGroups.length, 0);
  assert.equal(result.aiDiffs.length, 1);
  assert.equal(result.aiDiffs[0].file, "package.json");
});

test("compact prompt format uses pipe-delimited headers", async () => {
  const { aiPrompt } = await loadClasses();
  const diffs = [
    {
      file: "src/app.ts",
      additions: 5,
      deletions: 2,
      changes: "+const x = 1;",
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    },
  ];

  const { prompt } = aiPrompt.buildAggregatedPrompt(diffs);

  assert.ok(prompt.includes("[1] M src/app.ts (+5/-2)"));
  assert.equal(prompt.includes('"name"'), false);
  assert.equal(prompt.includes('"status"'), false);
  assert.equal(prompt.includes('"stats"'), false);
});

test("hard truncation keeps both early and late diff context", async () => {
  const { diffMinimizer } = await loadClasses();
  const diff = {
    file: "src/feature.ts",
    additions: 40,
    deletions: 0,
    changes: [
      "+const startMarker = initializeFeature('alpha');",
      ...Array.from(
        { length: 40 },
        (_, index) =>
          `+const intermediateValue${index} = computeThing(${index}, "${"x".repeat(24)}");`
      ),
      "+return finalizeFeature('omega');",
    ].join("\n"),
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  };

  const compressed = diffMinimizer.compressDiffForPrompt(diff, 160);

  assert.equal(compressed.compressed, true);
  assert.ok(compressed.content.includes("startMarker"));
  assert.ok(compressed.content.includes("finalizeFeature"));
  assert.ok(compressed.content.includes("omitted"));
});

test("generated files get summary-only diffs in git layer", async () => {
  const files = ["dist/bundle.min.js"];
  const { service, status } = await createGitServiceForSummaryTests(files);
  let fullDiffCalled = false;

  service.git = {
    status: async () => status,
    diff: async () => {
      fullDiffCalled = true;
      return "full diff content";
    },
    diffSummary: async () => ({
      files: [{ file: "dist/bundle.min.js", insertions: 500, deletions: 200 }],
    }),
  };

  const result = await service.getFileDiff("/repo/dist/bundle.min.js", false);

  assert.equal(fullDiffCalled, false);
  assert.ok(result.changes.includes("Generated file updated"));
  assert.equal(result.additions, 500);
  assert.equal(result.deletions, 200);
});

test("git diff requests zero context for AI grouping", async () => {
  const files = ["src/a.ts"];
  const { service, status } = await createGitServiceForSummaryTests(files);
  let diffArgs = null;

  service.git = {
    status: async () => status,
    diff: async args => {
      diffArgs = args;
      return "@@ -1 +1 @@\n+const value = 1;";
    },
    diffSummary: async () => ({
      files: [{ file: "src/a.ts", insertions: 1, deletions: 0 }],
    }),
  };

  await service.getFileDiff("/repo/src/a.ts", false);

  assert.ok(diffArgs.includes("-U0"));
});
