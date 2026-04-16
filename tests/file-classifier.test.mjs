import assert from "node:assert/strict";
import test from "node:test";

const loadClassifier = async () => {
  const module = await import("../dist/index.js");
  return module.fileClassifier;
};

test("lock files get LOCK category with deterministic message", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("yarn.lock").category, "LOCK");
  assert.equal(classifyFile("package-lock.json").category, "LOCK");
  assert.equal(classifyFile("pnpm-lock.yaml").category, "LOCK");
  assert.equal(classifyFile("Gemfile.lock").category, "LOCK");
  assert.equal(classifyFile("Cargo.lock").category, "LOCK");
  assert.equal(classifyFile("go.sum").category, "LOCK");
  assert.equal(
    classifyFile("yarn.lock").deterministicMessage,
    "Updated project dependencies"
  );
});

test("documentation files get DOC category", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("README.md").category, "DOC");
  assert.equal(classifyFile("README").category, "DOC");
  assert.equal(classifyFile("LICENSE").category, "DOC");
  assert.equal(classifyFile("LICENSE.txt").category, "DOC");
  assert.equal(classifyFile("CHANGELOG.md").category, "DOC");
  assert.equal(classifyFile("CONTRIBUTING.md").category, "DOC");
  assert.equal(classifyFile("CODE_OF_CONDUCT.md").category, "DOC");
  assert.equal(
    classifyFile("README.md").deterministicMessage,
    "Updated documentation"
  );
});

test("minified and map files get MINIFIED category", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("dist/app.min.js").category, "MINIFIED");
  assert.equal(classifyFile("styles.min.css").category, "MINIFIED");
  assert.equal(classifyFile("bundle.js.map").category, "MINIFIED");
});

test("generated files get GENERATED category", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("src/types.generated.ts").category, "GENERATED");
  assert.equal(classifyFile("api.g.ts").category, "GENERATED");
  assert.equal(classifyFile("user.pb.go").category, "GENERATED");
});

test("files under build dirs get BUILD_ARTIFACT category", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("dist/index.js").category, "BUILD_ARTIFACT");
  assert.equal(classifyFile("build/output.html").category, "BUILD_ARTIFACT");
  assert.equal(classifyFile(".next/server.js").category, "BUILD_ARTIFACT");
  assert.equal(classifyFile("target/release/app").category, "BUILD_ARTIFACT");
  assert.equal(
    classifyFile("packages/foo/dist/index.js").category,
    "BUILD_ARTIFACT",
    "monorepo package build dirs should still classify"
  );
});

test("source files under source dirs named like build dirs are NOT BUILD_ARTIFACT (C3)", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(
    classifyFile("src/build/utils.ts").category,
    "REGULAR",
    "src/build/utils.ts is a source file, not a build artifact"
  );
  assert.equal(classifyFile("src/out/helper.rs").category, "REGULAR");
  assert.equal(classifyFile("tests/dist/fixture.json").category, "REGULAR");
  assert.equal(classifyFile("lib/target/helper.go").category, "REGULAR");
});

test("classifyFile exposes ecosystem on locks and manifests (H6)", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("yarn.lock").ecosystem, "NPM");
  assert.equal(classifyFile("package.json").ecosystem, "NPM");
  assert.equal(classifyFile("Gemfile.lock").ecosystem, "RUBY");
  assert.equal(classifyFile("Gemfile").ecosystem, "RUBY");
  assert.equal(classifyFile("Cargo.lock").ecosystem, "CARGO");
  assert.equal(classifyFile("go.mod").ecosystem, "GO");
  assert.equal(classifyFile("pyproject.toml").ecosystem, "PYTHON");
  assert.equal(classifyFile("Pipfile.lock").ecosystem, "PYTHON");
  assert.equal(classifyFile("composer.json").ecosystem, "PHP");
});

test("manifest files get MANIFEST category without deterministic message", async () => {
  const { classifyFile } = await loadClassifier();
  const result = classifyFile("package.json");
  assert.equal(result.category, "MANIFEST");
  assert.equal(result.deterministicMessage, undefined);
});

test("regular source files fall through to REGULAR", async () => {
  const { classifyFile } = await loadClassifier();
  assert.equal(classifyFile("src/app.ts").category, "REGULAR");
  assert.equal(classifyFile("src/index.js").category, "REGULAR");
  assert.equal(classifyFile("test/user.test.mjs").category, "REGULAR");
});
