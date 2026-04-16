import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_API_KEY = "test-api-key-12345";

const loadAIService = async () => {
  const module = await import("../dist/index.js");
  return await module.AIService();
};

const stubGenAI = service => {
  let callCount = 0;
  service.genAI = {
    models: {
      generateContent: async () => {
        callCount += 1;
        return {
          text: JSON.stringify({
            groups: [
              {
                files: ["src/app.ts"],
                message: "Updated app module logic",
                confidence: 0.9,
              },
            ],
          }),
        };
      },
    },
  };
  return () => callCount;
};

const makeDiffs = () => [
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

test("default (no --use-cached) generates fresh results and does not read cache", async () => {
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "commitx-nocache-"));
  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  try {
    const AIService = await loadAIService();
    const service = new AIService();

    let cacheReads = 0;
    let cacheWrites = 0;
    service.aiCache = {
      generateKey: () => "testkey",
      get: async () => {
        cacheReads += 1;
        return null;
      },
      set: async () => {
        cacheWrites += 1;
      },
    };

    const getCallCount = stubGenAI(service);

    await service.generateAggregatedCommits(makeDiffs(), {});
    assert.equal(cacheReads, 0, "cache read should not happen without --use-cached");
    assert.equal(cacheWrites, 0, "cache write should not happen without --use-cached");
    assert.equal(getCallCount(), 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("--use-cached reads cache first and short-circuits on hit", async () => {
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "commitx-cache-"));
  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  try {
    const AIService = await loadAIService();
    const service = new AIService();

    let cacheReads = 0;
    service.aiCache = {
      generateKey: () => "testkey",
      get: async () => {
        cacheReads += 1;
        return [
          {
            files: ["src/app.ts"],
            message: "Cached message one",
            confidence: 0.9,
          },
          {
            files: ["src/other.ts"],
            message: "Cached message two",
            confidence: 0.85,
          },
        ];
      },
      set: async () => {},
    };

    const getCallCount = stubGenAI(service);

    const result = await service.generateAggregatedCommits(makeDiffs(), {
      useCached: true,
    });
    assert.equal(cacheReads, 1);
    assert.equal(getCallCount(), 0, "AI should not be called on cache hit");
    assert.equal(result.groups.length, 2, "cache hit must preserve all groups (C1)");
    assert.equal(result.groups[0].message, "Cached message one");
    assert.equal(result.groups[0].files[0], "src/app.ts");
    assert.equal(result.groups[1].message, "Cached message two");
    assert.equal(result.groups[1].files[0], "src/other.ts");
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("--use-cached writes to cache when no cached result exists", async () => {
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "commitx-cache-miss-"));
  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  try {
    const AIService = await loadAIService();
    const service = new AIService();

    let cacheReads = 0;
    let cacheWrites = 0;
    let lastWritten = null;
    service.aiCache = {
      generateKey: () => "testkey",
      get: async () => {
        cacheReads += 1;
        return null;
      },
      set: async (_key, payload) => {
        cacheWrites += 1;
        lastWritten = payload;
      },
    };

    stubGenAI(service);

    await service.generateAggregatedCommits(makeDiffs(), { useCached: true });

    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(cacheReads, 1);
    assert.equal(cacheWrites, 1);
    assert.ok(Array.isArray(lastWritten), "cache write payload should be an array of groups");
    assert.ok(
      lastWritten.length > 0 && Array.isArray(lastWritten[0].files),
      "cache writes must persist full CommitGroup shape (C1)"
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});
