export const CommitX = (): Promise<typeof import("./core/commitx.js").CommitX> =>
  import("./core/commitx.js").then(m => m.CommitX);
export const GitService = (): Promise<typeof import("./services/git.js").GitService> =>
  import("./services/git.js").then(m => m.GitService);
export const AIService = (): Promise<typeof import("./services/ai.js").AIService> =>
  import("./services/ai.js").then(m => m.AIService);
export const ConfigManager = (): Promise<typeof import("./config.js").ConfigManager> =>
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

const getCommitX = async (): Promise<
  typeof import("./core/commitx.js").CommitX
> => {
  const { CommitX } = await import("./core/commitx.js");
  return CommitX;
};

export default getCommitX;
