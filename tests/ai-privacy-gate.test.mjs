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
  const result = enforcePrivacyGate([diff(".env", "API_KEY=secret")], "/repo");
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

test("redaction applies to every file in a batch (C2)", async () => {
  const { enforcePrivacyGate } = await loadGate();

  // The /g regex state leak showed up when the same pattern was applied
  // back-to-back inside sanitizeDiffContent. If lastIndex isn't reset,
  // alternate files slip through un-redacted.
  const diffs = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file =>
    diff(file, '+const owner = "person@example.com";')
  );
  const result = enforcePrivacyGate(diffs, "/repo");

  assert.equal(result.approvedDiffs.length, diffs.length);
  assert.ok(
    result.sanitizedDiffs.every(
      d =>
        d.changes.includes("[REDACTED]") &&
        !d.changes.includes("person@example.com")
    ),
    "every diff must have its email redacted — regex state must not leak"
  );
});

test("code that merely resembles a sensitive filename reaches the model intact", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const changes = [
    "+const url = process.env.API_URL;",
    "+for (const k of Object.keys(map)) handle(event.key, k);",
    '+import cfg from "./tsconfig.json";',
  ].join("\n");

  const result = enforcePrivacyGate([diff("src/a.ts", changes)], "/repo");

  assert.equal(result.sanitizedDiffs[0].changes, changes);
  assert.equal(result.report.sanitizedFiles, 0);
});

test("epoch timestamps are not mistaken for payment card numbers", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const changes = "+const startedAt = 1719432000000;";

  const result = enforcePrivacyGate([diff("src/a.ts", changes)], "/repo");

  assert.equal(result.sanitizedDiffs[0].changes, changes);
});

test("checksum-valid payment card numbers are still redacted", async () => {
  const { enforcePrivacyGate } = await loadGate();

  const result = enforcePrivacyGate(
    [diff("src/a.ts", '+const card = "4111 1111 1111 1111";')],
    "/repo"
  );

  assert.equal(result.sanitizedDiffs[0].changes, '+const card = "[REDACTED]";');
});

test("a long unbroken token is sanitized in linear time", async () => {
  const { enforcePrivacyGate } = await loadGate();
  const token = `+${"a1B2c3D4e5".repeat(5_000)}`;

  const start = performance.now();
  enforcePrivacyGate([diff("src/blob.ts", token)], "/repo");
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 300, `sanitizing 50KB took ${elapsed.toFixed(0)}ms`);
});
