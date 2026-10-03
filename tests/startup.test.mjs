import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INDEX_URL = new URL("../dist/index.js", import.meta.url).href;

// Runs `body` in a child process where resolving the Gemini SDK throws.
const runWithoutGeminiSdk = body => {
  const hook = `export async function resolve(specifier, context, next) {
    if (specifier === "@google/genai") throw new Error("Gemini SDK was loaded");
    return next(specifier, context);
  }`;
  const script = `
    import { register } from "node:module";
    register("data:text/javascript," + encodeURIComponent(${JSON.stringify(hook)}));
    const module = await import(${JSON.stringify(INDEX_URL)});
    ${body}
  `;
  return execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
};

test("constructing CommitX does not load the Gemini SDK", async () => {
  await runWithoutGeminiSdk(`
    const CommitX = await module.CommitX();
    new CommitX();
  `);
});

test("the Gemini SDK is still loaded once the AI service is requested", async () => {
  await assert.rejects(
    runWithoutGeminiSdk("await module.AIService();"),
    /Gemini SDK was loaded/
  );
});
