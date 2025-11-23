// Lazy exports for better tree shaking and startup performance
export const CommitX = () => import("./core/commitx.js").then(m => m.CommitX);
export const GitService = () =>
  import("./services/git.js").then(m => m.GitService);
export const AIService = () =>
  import("./services/ai.js").then(m => m.AIService);
export const ConfigManager = () =>
  import("./config.js").then(m => m.ConfigManager);

// Type exports are compile-time only, so they don't affect runtime performance
export type * from "./types/common.js";

// Performance monitoring
export {
  PerformanceMonitor,
  withPerformanceTracking,
} from "./utils/performance.js";

// Main entry point for programmatic usage with lazy loading
const getCommitX = async () => {
  const { CommitX } = await import("./core/commitx.js");
  return CommitX;
};

export default getCommitX;
