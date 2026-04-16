import assert from "node:assert/strict";
import test from "node:test";

const loadPrompt = async () => {
  const module = await import("../dist/index.js");
  return module.aiPrompt;
};

const diff = (file, opts = {}) => ({
  file,
  additions: opts.additions ?? 1,
  deletions: opts.deletions ?? 0,
  changes: opts.changes ?? "+change",
  isNew: opts.isNew ?? false,
  isDeleted: false,
  isRenamed: false,
});

const sanitized = (file, overrides = {}) => ({
  file,
  additions: 1,
  deletions: 0,
  changes: "+change",
  isNew: false,
  isDeleted: false,
  isRenamed: false,
  sanitized: false,
  warnings: [],
  ...overrides,
});

test("parseAggregatedResponse resolves exact file names", async () => {
  const { parseAggregatedResponse } = await loadPrompt();
  const diffs = [diff("src/app.ts"), diff("src/other.ts")];
  const sanitizedDiffs = [sanitized("src/app.ts"), sanitized("src/other.ts")];

  const response = JSON.stringify({
    groups: [
      { files: ["src/app.ts", "src/other.ts"], message: "Updated modules", confidence: 0.9 },
    ],
  });

  const result = parseAggregatedResponse(response, diffs, sanitizedDiffs);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].files, ["src/app.ts", "src/other.ts"]);
});

test("parseAggregatedResponse resolves unique basenames when AI trims prefixes (H3)", async () => {
  const { parseAggregatedResponse } = await loadPrompt();
  const diffs = [diff("src/deep/app.ts"), diff("src/other.ts")];
  const sanitizedDiffs = [sanitized("src/deep/app.ts"), sanitized("src/other.ts")];

  // AI echoes bare basenames — must still land on originals via basename fallback.
  const response = JSON.stringify({
    groups: [{ files: ["app.ts", "other.ts"], message: "Updated modules", confidence: 0.9 }],
  });

  const result = parseAggregatedResponse(response, diffs, sanitizedDiffs);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(
    result.groups[0].files.sort(),
    ["src/deep/app.ts", "src/other.ts"].sort()
  );
});

test("parseAggregatedResponse does NOT use basename fallback when ambiguous (H3)", async () => {
  const { parseAggregatedResponse } = await loadPrompt();
  const diffs = [diff("src/a/index.ts"), diff("src/b/index.ts")];
  const sanitizedDiffs = [sanitized("src/a/index.ts"), sanitized("src/b/index.ts")];

  const response = JSON.stringify({
    groups: [{ files: ["index.ts"], message: "Updated index file", confidence: 0.9 }],
  });

  const result = parseAggregatedResponse(response, diffs, sanitizedDiffs);
  assert.equal(
    result.groups.length,
    0,
    "ambiguous basename must not be resolved to either candidate"
  );
  assert.equal(
    result.unusedDiffs.length,
    2,
    "both ambiguous files surface as unused for the orchestrator to retry"
  );
});

test("parseAggregatedResponse surfaces files AI dropped as unusedDiffs (no templated fallback)", async () => {
  const { parseAggregatedResponse } = await loadPrompt();
  const diffs = [
    diff("src/kept.ts"),
    diff("src/new-big.ts", { isNew: true, additions: 300 }),
  ];
  const sanitizedDiffs = [sanitized("src/kept.ts"), sanitized("src/new-big.ts")];

  // AI only returns the small file — the new big one is dropped.
  const response = JSON.stringify({
    groups: [{ files: ["src/kept.ts"], message: "Updated kept module", confidence: 0.9 }],
  });

  const result = parseAggregatedResponse(response, diffs, sanitizedDiffs);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(
    result.unusedDiffs.map(d => d.file),
    ["src/new-big.ts"],
    "dropped new files are surfaced so orchestrator can retry, not auto-templated"
  );
  // Critically, no templated 'Created new <file>' group was synthesized.
  assert.equal(
    result.groups.some(g =>
      g.message.toLowerCase().includes("initial implementation")
    ),
    false
  );
});

test("generateFactualFallback stays factual about status without speculating on content", async () => {
  const { generateFactualFallback } = await loadPrompt();
  assert.equal(
    generateFactualFallback({
      file: "src/new.ts",
      additions: 200,
      deletions: 0,
      changes: "",
      isNew: true,
      isDeleted: false,
      isRenamed: false,
    }),
    "Added new.ts"
  );
  assert.equal(
    generateFactualFallback({
      file: "src/old.ts",
      additions: 0,
      deletions: 50,
      changes: "",
      isNew: false,
      isDeleted: true,
      isRenamed: false,
    }),
    "Removed old.ts"
  );
  assert.equal(
    generateFactualFallback({
      file: "src/changed.ts",
      additions: 10,
      deletions: 3,
      changes: "",
      isNew: false,
      isDeleted: false,
      isRenamed: false,
    }),
    "Updated changed.ts"
  );
});
