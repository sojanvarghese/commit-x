import assert from "node:assert/strict";
import test from "node:test";

const loadMinimizer = async () => {
  const module = await import("../dist/index.js");
  return module.diffMinimizer;
};

test("countDiffLines only counts +/- lines (ignores @@ and +++/---)", async () => {
  const { countDiffLines } = await loadMinimizer();
  const diff = [
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,4 @@",
    " context line",
    "+added one",
    "+added two",
    "-removed one",
    " another context",
  ].join("\n");
  assert.equal(countDiffLines(diff), 3);
});

test("shouldAggressivelyMinimize triggers above the 250-LOC threshold", async () => {
  const { shouldAggressivelyMinimize } = await loadMinimizer();
  const below = { changes: Array.from({ length: 100 }, () => "+line").join("\n") };
  const above = { changes: Array.from({ length: 260 }, () => "+line").join("\n") };
  assert.equal(shouldAggressivelyMinimize(below), false);
  assert.equal(shouldAggressivelyMinimize(above), true);
});

test("compressDiffForPrompt preserves content under threshold with ample budget", async () => {
  const { compressDiffForPrompt } = await loadMinimizer();
  const diff = {
    file: "src/small.ts",
    additions: 3,
    deletions: 1,
    changes: "+const value = 1;\n+const other = 2;\n-const old = 0;",
  };
  const result = compressDiffForPrompt(diff, 5000);
  assert.equal(result.compressed, false);
  assert.ok(result.content.includes("const value = 1"));
});

test("compressDiffForPrompt forces compression when diff exceeds 250 LOC even with ample budget", async () => {
  const { compressDiffForPrompt } = await loadMinimizer();
  const lines = Array.from({ length: 280 }, (_, i) => `+const v${i} = ${i};`);
  const diff = {
    file: "src/big.ts",
    additions: 280,
    deletions: 0,
    changes: lines.join("\n"),
  };
  const result = compressDiffForPrompt(diff, 50_000);
  assert.equal(result.compressed, true);
});

test("stripBoilerplate drops imports, comments, console.log, empty lines", async () => {
  const { stripBoilerplate } = await loadMinimizer();
  const input = [
    "+import foo from 'foo';",
    "+// a comment",
    "+/** jsdoc */",
    "+console.log('debug');",
    "+const real = computeReal();",
    "+    ",
  ].join("\n");
  const stripped = stripBoilerplate(input);
  assert.equal(stripped.includes("import foo"), false);
  assert.equal(stripped.includes("a comment"), false);
  assert.equal(stripped.includes("jsdoc"), false);
  assert.equal(stripped.includes("console.log"), false);
  assert.ok(stripped.includes("computeReal"));
});

test("truncatePreservingEdges keeps head and tail with separator", async () => {
  const { truncatePreservingEdges } = await loadMinimizer();
  const head = "BEGIN " + "x".repeat(300);
  const tail = "y".repeat(300) + " END";
  const content = head + "\n" + tail;
  const out = truncatePreservingEdges(content, 200);
  assert.ok(out.includes("BEGIN"));
  assert.ok(out.includes("END"));
  assert.ok(out.includes("[truncated]"));
});
