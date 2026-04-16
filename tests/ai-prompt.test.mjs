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

  // Two files share basename `index.ts`. The AI returning `index.ts`
  // alone must not collide — the resolver should refuse the ambiguous match.
  const response = JSON.stringify({
    groups: [{ files: ["index.ts"], message: "Updated index file", confidence: 0.9 }],
  });

  const result = parseAggregatedResponse(response, diffs, sanitizedDiffs);
  const matched = result.groups.find(g => g.files.includes("index.ts"));
  assert.equal(
    matched,
    undefined,
    "ambiguous basename must not be resolved to either candidate"
  );
  assert.equal(
    result.groups.every(g => g.files.length === 1),
    true,
    "remaining diffs fall through as individual commits"
  );
});
