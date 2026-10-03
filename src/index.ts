// Not a public API: this entry exists so the test suite can reach internals
// through the built bundle. The class getters stay lazy so importing it does
// not pull in the Gemini SDK.
import type { CommitX as CommitXClass } from "./core/commitx.js";
import type { GitService as GitServiceClass } from "./services/git.js";
import type { AIService as AIServiceClass } from "./services/ai.js";

export const CommitX = (): Promise<typeof CommitXClass> =>
  import("./core/commitx.js").then(m => m.CommitX);
export const GitService = (): Promise<typeof GitServiceClass> =>
  import("./services/git.js").then(m => m.GitService);
export const AIService = (): Promise<typeof AIServiceClass> =>
  import("./services/ai.js").then(m => m.AIService);

export * as diffMinimizer from "./utils/diff-minimizer.js";
export * as fileClassifier from "./utils/file-classifier.js";
export * as aiPrivacyGate from "./services/ai-privacy-gate.js";
export * as aiPrompt from "./services/ai-prompt.js";
export * as aiCommitGroup from "./services/ai-commit-group.js";
export * as validation from "./schemas/validation.js";
export * as security from "./utils/security.js";
