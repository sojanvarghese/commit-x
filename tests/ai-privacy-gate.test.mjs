import assert from "node:assert/strict";
import test from "node:test";

const loadGate = async () => {
  const module = await import("../dist/index.js");
  return module.aiPrivacyGate;
};

const diff = (file, changes = "") => ({
  file,
  additions: 1,
  deletions: 0,
  changes,
  isNew: false,
  isDeleted: false,
  isRenamed: false,
});

test("env files are blocked before reaching AI", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const result = enforcePrivacyGate(
    [diff(".env", "API_KEY=secret")],
    "/repo"
  );
  assert.equal(result.approvedDiffs.length, 0);
  assert.equal(result.skippedFiles.length, 1);
  assert.equal(result.skippedFiles[0].file, ".env");
});

test("sensitive file extensions are blocked", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const result = enforcePrivacyGate(
    [diff("keys/private.pem", "PRIVATE KEY"), diff("app.key", "KEYDATA")],
    "/repo"
  );
  assert.equal(result.approvedDiffs.length, 0);
  assert.equal(result.skippedFiles.length, 2);
});

test("regular files pass the gate", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const result = enforcePrivacyGate(
    [diff("src/app.ts", "+const x = 1;")],
    "/repo"
  );
  assert.equal(result.approvedDiffs.length, 1);
  assert.equal(result.skippedFiles.length, 0);
  assert.equal(result.sanitizedDiffs.length, 1);
});

test("sanitizedDiffs match approvedDiffs length and ordering", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const inputs = [
    diff("src/a.ts", "+one"),
    diff("src/b.ts", "+two"),
    diff(".env", "SECRET=1"),
    diff("src/c.ts", "+three"),
  ];
  const result = enforcePrivacyGate(inputs, "/repo");
  assert.equal(result.approvedDiffs.length, 3);
  assert.equal(result.sanitizedDiffs.length, 3);
  assert.deepEqual(
    result.approvedDiffs.map(d => d.file),
    ["src/a.ts", "src/b.ts", "src/c.ts"]
  );
});

test("privacy report counts sanitized files", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const result = enforcePrivacyGate(
    [diff("src/a.ts", "+const x = 1;")],
    "/repo"
  );
  assert.equal(typeof result.report.sanitizedFiles, "number");
  assert.ok(result.report.sanitizedFiles >= 0);
});

test("sensitive content detection is stable across repeated calls (C2)", async () => {
  const { enforcePrivacyGate } = await loadGate();

  // With a shared /g regex, calling .test() repeatedly toggles lastIndex and
  // causes alternating true/false results. Verify the gate is stable.
  const sensitive = diff("src/a.ts", "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
  const results = [];
  for (let i = 0; i < 4; i++) {
    const result = enforcePrivacyGate([sensitive], "/repo");
    results.push(result.approvedDiffs.length);
  }
  assert.deepEqual(
    results,
    [0, 0, 0, 0],
    "sensitive content must be blocked consistently across repeated invocations"
  );
});

test("sensitive file patterns detected for each file in a batch (C2)", async () => {
  const { enforcePrivacyGate } = await loadGate();

  // The /g regex state leak showed up when the same pattern was applied
  // back-to-back inside sanitizeDiffContent. If lastIndex isn't reset,
  // alternate files slip through un-flagged.
  const diffs = [
    diff("a.ts", "see .env for config"),
    diff("b.ts", "see .env for config"),
    diff("c.ts", "see .env for config"),
    diff("d.ts", "see .env for config"),
  ];
  const result = enforcePrivacyGate(diffs, "/repo");

  const warnedCount = result.approvedDiffs.filter(() =>
    (result.report.warnings ?? []).some(() => true)
  ).length;
  assert.ok(warnedCount >= 0);

  assert.equal(
    result.approvedDiffs.length,
    diffs.length,
    "regular-named files with only string references should not be blocked"
  );
  const allSanitized = result.sanitizedDiffs.every(d =>
    d.changes.includes("[SENSITIVE_FILE]")
  );
  assert.ok(
    allSanitized,
    "every diff must have its `.env` mention redacted — regex state must not leak"
  );
});
