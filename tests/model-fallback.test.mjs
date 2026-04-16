import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

const TEST_API_KEY = "test-api-key-12345";

const loadAIService = async () => {
  const module = await import("../dist/index.js");
  return await module.AIService();
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

test("transient errors retry across the model fallback chain", async () => {
  process.env.GEMINI_API_KEY = TEST_API_KEY;
  const AIService = await loadAIService();
  const service = new AIService();

  service.aiCache = {
    generateKey: () => "k",
    get: async () => null,
    set: async () => {},
  };

  let calls = 0;
  service.genAI = {
    models: {
      generateContent: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error("connection refused");
          err.code = "ECONNREFUSED";
          throw err;
        }
        return {
          text: JSON.stringify({
            groups: [
              {
                files: ["src/app.ts"],
                message: "Updated app module",
                confidence: 0.9,
              },
            ],
          }),
        };
      },
    },
  };

  const result = await service.generateAggregatedCommits(makeDiffs(), {});
  assert.equal(
    calls,
    2,
    "a transient error on model 1 should trigger exactly one fallback attempt"
  );
  assert.equal(
    result.groups.find(g => g.files.includes("src/app.ts"))?.message,
    "Updated app module"
  );
});

test("VALIDATION_ERROR short-circuits the fallback chain (H1)", async () => {
  process.env.GEMINI_API_KEY = TEST_API_KEY;
  const AIService = await loadAIService();
  const service = new AIService();

  service.aiCache = {
    generateKey: () => "k",
    get: async () => null,
    set: async () => {},
  };

  let calls = 0;
  service.genAI = {
    models: {
      generateContent: async () => {
        calls += 1;
        return { text: "" };
      },
    },
  };

  // A single sensitive file gets dropped by the privacy gate, producing a
  // VALIDATION_ERROR ("No valid diffs after privacy gate"). Per H1, that error
  // type should short-circuit — no model fallback attempts at all.
  await assert.rejects(
    service.generateAggregatedCommits(
      [
        {
          file: ".env",
          additions: 1,
          deletions: 0,
          changes: "API_KEY=secret",
          isNew: false,
          isDeleted: false,
          isRenamed: false,
        },
      ],
      {}
    ),
    /no valid diffs/i
  );
  assert.equal(
    calls,
    0,
    "validation errors must not trigger model fallback retries"
  );
});
