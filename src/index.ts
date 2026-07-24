import type { CommitX as CommitXClass } from "./core/commitx.js";
import type { GitService as GitServiceClass } from "./services/git.js";
import type { AIService as AIServiceClass } from "./services/ai.js";
import type { ConfigManager as ConfigManagerClass } from "./config.js";

export const CommitX = (): Promise<typeof CommitXClass> =>
  import("./core/commitx.js").then(m => m.CommitX);
export const GitService = (): Promise<typeof GitServiceClass> =>
  import("./services/git.js").then(m => m.GitService);
export const AIService = (): Promise<typeof AIServiceClass> =>
  import("./services/ai.js").then(m => m.AIService);
export const ConfigManager = (): Promise<typeof ConfigManagerClass> =>
  import("./config.js").then(m => m.ConfigManager);

export type * from "./types/common.js";

export {
  PerformanceMonitor,
  withPerformanceTracking,
} from "./utils/performance.js";

export * as diffMinimizer from "./utils/diff-minimizer.js";
export * as fileClassifier from "./utils/file-classifier.js";
export * as aiPrivacyGate from "./services/ai-privacy-gate.js";
export * as aiPrompt from "./services/ai-prompt.js";
export * as aiCommitGroup from "./services/ai-commit-group.js";
export * as validation from "./schemas/validation.js";
export * as security from "./utils/security.js";

const getCommitX = async (): Promise<typeof CommitXClass> => {
  const { CommitX } = await import("./core/commitx.js");
  return CommitX;
};

export default getCommitX;
