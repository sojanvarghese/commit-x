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

const makeDiffs = () => [
  {
    file: "src/existing.ts",
    additions: 5,
    deletions: 1,
    changes: "+const existing = 1;",
    isNew: false,
    isDeleted: false,
    isRenamed: false,
  },
  {
    file: "src/brand-new.ts",
    additions: 120,
    deletions: 0,
    changes: Array.from({ length: 120 }, (_, i) => `+const fresh${i} = ${i};`).join(
      "\n"
    ),
    isNew: true,
    isDeleted: false,
    isRenamed: false,
  },
];

test("new files dropped by AI trigger a focused retry (no templated fallback)", async () => {
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "commitx-retry-"));
  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  try {
    const AIService = await loadAIService();
    const service = new AIService();
    service.aiCache = {
      generateKey: () => "k",
      get: async () => null,
      set: async () => {},
    };

    const callLog = [];
    service.genAI = {
      models: {
        generateContent: async ({ contents }) => {
          callLog.push(contents);
          if (callLog.length === 1) {
            return {
              text: JSON.stringify({
                groups: [
                  {
                    files: ["src/existing.ts"],
                    message: "Updated existing module",
                    confidence: 0.9,
                  },
                ],
              }),
            };
          }
          return {
            text: JSON.stringify({
              groups: [
                {
                  files: ["src/brand-new.ts"],
                  message: "Added fresh constants module",
                  confidence: 0.85,
                },
              ],
            }),
          };
        },
      },
    };

    const result = await service.generateAggregatedCommits(makeDiffs(), {});

    assert.equal(callLog.length, 2, "orchestrator must retry for the dropped file");
    assert.ok(
      callLog[1].includes("src/brand-new.ts"),
      "retry prompt must target only the dropped file"
    );
    assert.equal(
      callLog[1].includes("src/existing.ts"),
      false,
      "retry must not re-send files already grouped"
    );

    const newFileGroup = result.groups.find(g => g.files.includes("src/brand-new.ts"));
    assert.ok(newFileGroup, "dropped new file must appear in final groups");
    assert.equal(
      newFileGroup.message,
      "Added fresh constants module",
      "dropped new file must use the retry's AI message, not a templated fallback"
    );
    assert.equal(
      newFileGroup.message.includes("initial implementation"),
      false,
      "MUST NOT fall back to speculative 'initial implementation' template"
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("factual fallback (not speculative template) applies only when retry also fails", async () => {
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "commitx-factual-"));
  process.env.HOME = homeDir;
  process.env.GEMINI_API_KEY = TEST_API_KEY;

  try {
    const AIService = await loadAIService();
    const service = new AIService();
    service.aiCache = {
      generateKey: () => "k",
      get: async () => null,
      set: async () => {},
    };

    let callCount = 0;
    service.genAI = {
      models: {
        generateContent: async () => {
          callCount += 1;
          return {
            text: JSON.stringify({
              groups: [
                {
                  files: ["src/existing.ts"],
                  message: "Updated existing module",
                  confidence: 0.9,
                },
              ],
            }),
          };
        },
      },
    };

    const result = await service.generateAggregatedCommits(makeDiffs(), {});
    const newFileGroup = result.groups.find(g => g.files.includes("src/brand-new.ts"));

    assert.ok(newFileGroup);
    assert.equal(
      newFileGroup.message,
      "Added brand-new.ts",
      "when retry also drops the file, message must be the factual 'Added <basename>' form"
    );
    assert.equal(
      newFileGroup.message.includes("initial implementation"),
      false
    );
    assert.equal(
      newFileGroup.message.includes("with code improvements"),
      false
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});
