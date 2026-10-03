import assert from "node:assert/strict";
import test from "node:test";
import * as v from "valibot";

const loadValidation = async () => {
  const module = await import("../dist/index.js");
  return module.validation;
};

test("ApiKeySchema accepts valid keys and exposes output", async () => {
  const { ApiKeySchema } = await loadValidation();
  const result = v.safeParse(ApiKeySchema, "valid_key-12345");

  assert.equal(result.success, true);
  assert.equal(result.output, "valid_key-12345");
});

test("ApiKeySchema rejects invalid key formats", async () => {
  const { ApiKeySchema } = await loadValidation();
  const result = v.safeParse(ApiKeySchema, "invalid key 12345");

  assert.equal(result.success, false);
  assert.equal(result.issues[0].message, "API key contains invalid characters");
});

test("GitDiffSchema rejects negative additions", async () => {
  const { GitDiffSchema } = await loadValidation();
  const result = v.safeParse(GitDiffSchema, {
    file: "src/file.ts",
    additions: -1,
    deletions: 0,
    changes: "diff",
  });

  assert.equal(result.success, false);
  assert.equal(result.issues[0].message, "Additions must be non-negative");
});

test("CommitMessageSchema rejects terminal control characters", async () => {
  const { CommitMessageSchema } = await loadValidation();
  const result = v.safeParse(CommitMessageSchema, "Updated module\u001b[31m");

  assert.equal(result.success, false);
  assert.equal(
    result.issues[0].message,
    "Commit message contains potentially malicious content"
  );
});

test("CommitMessageSchema accepts and trims safe content", async () => {
  const { CommitMessageSchema } = await loadValidation();
  const result = v.safeParse(CommitMessageSchema, "  Updated safe module  ");

  assert.equal(result.success, true);
  assert.equal(result.output, "Updated safe module");
});
