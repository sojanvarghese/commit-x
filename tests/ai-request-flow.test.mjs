import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

const TEST_API_KEY = "test-api-key-12345";

const makeDiff = (file, changes = "+const value = true;") => ({
  file,
  additions: 1,
  deletions: 0,
  changes,
  isNew: false,
  isDeleted: false,
  isRenamed: false,
});

const groupsResponse = groups => ({ text: JSON.stringify({ groups }) });

const createService = async () => {
  process.env.GEMINI_API_KEY = TEST_API_KEY;
  const module = await import("../dist/index.js");
  const AIService = await module.AIService();
  const service = new AIService();
  service.aiCache = {
    generateKey: diffs => diffs.map(diff => diff.file).join("|"),
    get: async () => null,
    set: async () => {},
  };
  return service;
};

const captureWarnings = async run => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warnings;
};

test("the privacy gate runs once per request even when the model call is retried", async () => {
  const service = await createService();
  let calls = 0;
  service.genAI = {
    models: {
      generateContent: async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("connection refused");
          error.code = "ECONNREFUSED";
          throw error;
        }
        return groupsResponse([
          { files: ["F1"], message: "Updated contact owner", confidence: 0.9 },
        ]);
      },
    },
  };

  const warnings = await captureWarnings(() =>
    service.generateAggregatedCommits([
      makeDiff("src/contact.ts", '+const owner = "person@example.com";'),
    ])
  );

  assert.equal(calls, 2);
  assert.equal(
    warnings.filter(warning => warning.includes("Privacy Notice")).length,
    1
  );
});

test("malformed model output is retried instead of aborting the run", async () => {
  const service = await createService();
  let calls = 0;
  service.genAI = {
    models: {
      generateContent: async () => {
        calls += 1;
        return calls === 1
          ? { text: JSON.stringify({ groups: "not-an-array" }) }
          : groupsResponse([
              {
                files: ["F1"],
                message: "Updated app behavior",
                confidence: 0.9,
              },
            ]);
      },
    },
  };

  const result = await service.generateAggregatedCommits([
    makeDiff("src/app.ts"),
  ]);

  assert.equal(calls, 2);
  assert.equal(result.groups[0].message, "Updated app behavior");
});
