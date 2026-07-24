import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  minify: true,
  splitting: true,
  treeshake: true,
  external: ["@google/genai", "commander", "simple-git", "valibot"],
  define: {
    __COMMIT_X_VERSION__: JSON.stringify(packageJson.version),
  },
  esbuildOptions(options) {
    options.treeShaking = true;
    options.minifyIdentifiers = true;
    options.minifySyntax = true;
    options.minifyWhitespace = true;
  },
});
