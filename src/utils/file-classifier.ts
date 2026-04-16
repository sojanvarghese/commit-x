import * as path from "path";

export type FileCategory =
  | "LOCK"
  | "DOC"
  | "MINIFIED"
  | "GENERATED"
  | "BUILD_ARTIFACT"
  | "MANIFEST"
  | "REGULAR";

export type Ecosystem =
  | "NPM"
  | "RUBY"
  | "CARGO"
  | "GO"
  | "PYTHON"
  | "PHP";

export interface Classification {
  category: FileCategory;
  ecosystem?: Ecosystem;
  deterministicMessage?: string;
}

const LOCK_FILES: Readonly<Record<string, Ecosystem>> = {
  "package-lock.json": "NPM",
  "yarn.lock": "NPM",
  "pnpm-lock.yaml": "NPM",
  "bun.lockb": "NPM",
  "Gemfile.lock": "RUBY",
  "Cargo.lock": "CARGO",
  "go.sum": "GO",
  "poetry.lock": "PYTHON",
  "Pipfile.lock": "PYTHON",
  "composer.lock": "PHP",
};

const MANIFEST_FILES: Readonly<Record<string, Ecosystem>> = {
  "package.json": "NPM",
  Gemfile: "RUBY",
  "Cargo.toml": "CARGO",
  "go.mod": "GO",
  "pyproject.toml": "PYTHON",
  Pipfile: "PYTHON",
  "composer.json": "PHP",
};

const DOC_FILE_PATTERNS: readonly RegExp[] = [
  /^README(\.(md|txt|rst|markdown))?$/i,
  /^LICENSE(\..+)?$/i,
  /^LICENCE(\..+)?$/i,
  /^CHANGELOG(\.(md|txt|rst))?$/i,
  /^HISTORY(\.(md|txt))?$/i,
  /^CONTRIBUTING(\.md)?$/i,
  /^CODE_OF_CONDUCT(\.md)?$/i,
  /^AUTHORS(\..+)?$/i,
  /^NOTICE(\..+)?$/i,
];

const MINIFIED_SUFFIXES = [".min.js", ".min.css", ".min.mjs", ".map"] as const;

const GENERATED_PATTERNS: readonly RegExp[] = [
  /\.generated\./i,
  /\.g\.(ts|dart|js|kt)$/i,
  /\.pb\.(go|ts|js)$/i,
  /_pb\.(js|ts)$/i,
  /\.freezed\.dart$/i,
];

const BUILD_PATH_SEGMENTS = new Set([
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "_build",
  ".nuxt",
  ".output",
]);

// Path segments that indicate source code lives "upstream" of this point,
// so any build segment found after one of these is almost certainly a
// developer-authored file (e.g. `src/build/utils.ts`, not a build artifact).
const SOURCE_DIR_SEGMENTS = new Set([
  "src",
  "lib",
  "source",
  "sources",
  "tests",
  "test",
  "__tests__",
  "spec",
  "specs",
]);

export const DETERMINISTIC_MESSAGES: Readonly<
  Record<Exclude<FileCategory, "REGULAR" | "MANIFEST">, string>
> = {
  LOCK: "Updated project dependencies",
  DOC: "Updated documentation",
  MINIFIED: "Rebuilt minified assets",
  GENERATED: "Regenerated derived files",
  BUILD_ARTIFACT: "Rebuilt project artifacts",
};

const endsWithAny = (file: string, suffixes: readonly string[]): boolean =>
  suffixes.some(suffix => file.endsWith(suffix));

const lockEcosystem = (baseName: string): Ecosystem | undefined =>
  LOCK_FILES[baseName];

const manifestEcosystem = (baseName: string): Ecosystem | undefined =>
  MANIFEST_FILES[baseName];

const isDoc = (baseName: string): boolean =>
  DOC_FILE_PATTERNS.some(pattern => pattern.test(baseName));

const isMinified = (filePath: string): boolean =>
  endsWithAny(filePath, MINIFIED_SUFFIXES);

const isGenerated = (filePath: string): boolean =>
  GENERATED_PATTERNS.some(pattern => pattern.test(filePath));

const isBuildArtifact = (filePath: string): boolean => {
  const segments = filePath.split(/[\\/]/);
  for (let i = 0; i < segments.length; i++) {
    if (!BUILD_PATH_SEGMENTS.has(segments[i])) continue;
    // `src/build/foo.ts`, `tests/dist/fixture.json`, etc. are source-tree
    // files coincidentally named like build dirs — don't auto-commit them.
    for (let j = 0; j < i; j++) {
      if (SOURCE_DIR_SEGMENTS.has(segments[j])) return false;
    }
    return true;
  }
  return false;
};

export const classifyFile = (filePath: string): Classification => {
  const baseName = path.basename(filePath);

  const lockEco = lockEcosystem(baseName);
  if (lockEco) {
    return {
      category: "LOCK",
      ecosystem: lockEco,
      deterministicMessage: DETERMINISTIC_MESSAGES.LOCK,
    };
  }

  if (isDoc(baseName)) {
    return { category: "DOC", deterministicMessage: DETERMINISTIC_MESSAGES.DOC };
  }

  if (isMinified(filePath)) {
    return {
      category: "MINIFIED",
      deterministicMessage: DETERMINISTIC_MESSAGES.MINIFIED,
    };
  }

  if (isGenerated(filePath)) {
    return {
      category: "GENERATED",
      deterministicMessage: DETERMINISTIC_MESSAGES.GENERATED,
    };
  }

  if (isBuildArtifact(filePath)) {
    return {
      category: "BUILD_ARTIFACT",
      deterministicMessage: DETERMINISTIC_MESSAGES.BUILD_ARTIFACT,
    };
  }

  const manifestEco = manifestEcosystem(baseName);
  if (manifestEco) {
    return { category: "MANIFEST", ecosystem: manifestEco };
  }

  return { category: "REGULAR" };
};
