import assert from "node:assert/strict";
import test from "node:test";

const loadGroup = async () => {
  const module = await import("../dist/index.js");
  return module.aiCommitGroup;
};

const diff = file => ({
  file,
  additions: 1,
  deletions: 0,
  changes: "+change",
  isNew: false,
  isDeleted: false,
  isRenamed: false,
});

test("lock + manifest are paired within the same ecosystem (H6)", async () => {
  const { preGroupDeterministicFiles } = await loadGroup();
  const { autoGroups } = preGroupDeterministicFiles([
    diff("package.json"),
    diff("yarn.lock"),
  ]);

  assert.equal(autoGroups.length, 1);
  assert.deepEqual(autoGroups[0].files.sort(), ["package.json", "yarn.lock"]);
  assert.equal(autoGroups[0].message, "Updated project dependencies");
});

test("different ecosystems are NOT mixed (H6)", async () => {
  const { preGroupDeterministicFiles } = await loadGroup();
  const { autoGroups } = preGroupDeterministicFiles([
    diff("package.json"),
    diff("yarn.lock"),
    diff("Gemfile"),
    diff("Gemfile.lock"),
    diff("Cargo.toml"),
    diff("Cargo.lock"),
  ]);

  assert.equal(
    autoGroups.length,
    3,
    "each ecosystem must get its own commit group"
  );

  for (const group of autoGroups) {
    assert.equal(
      group.message,
      "Updated project dependencies",
      "every lock+manifest group uses the same deterministic message"
    );
  }

  const groupForFile = name =>
    autoGroups.find(g => g.files.includes(name));
  assert.deepEqual(
    groupForFile("package.json").files.sort(),
    ["package.json", "yarn.lock"]
  );
  assert.deepEqual(
    groupForFile("Gemfile").files.sort(),
    ["Gemfile", "Gemfile.lock"]
  );
  assert.deepEqual(
    groupForFile("Cargo.toml").files.sort(),
    ["Cargo.lock", "Cargo.toml"]
  );
});

test("orphaned manifest without a matching lock is left to AI", async () => {
  const { preGroupDeterministicFiles } = await loadGroup();
  const { aiDiffs, autoGroups } = preGroupDeterministicFiles([
    diff("package.json"),
  ]);

  assert.equal(autoGroups.length, 0, "bare manifest alone is not auto-grouped");
  assert.equal(aiDiffs.length, 1);
  assert.equal(aiDiffs[0].file, "package.json");
});

test("orphaned lock without a manifest still forms a deterministic group", async () => {
  const { preGroupDeterministicFiles } = await loadGroup();
  const { autoGroups } = preGroupDeterministicFiles([diff("yarn.lock")]);

  assert.equal(autoGroups.length, 1);
  assert.deepEqual(autoGroups[0].files, ["yarn.lock"]);
});
