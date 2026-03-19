// Lazy loading utilities for optimized startup performance

export type LazyModule<T> = () => Promise<T>;

// Cache for lazy-loaded modules
const moduleCache = new Map<string, unknown>();

/**
 * Create a lazy-loaded module wrapper
 */
export const createLazyModule = <T>(
  moduleId: string,
  loader: () => Promise<T>
): LazyModule<T> => {
  return async (): Promise<T> => {
    if (moduleCache.has(moduleId)) {
      return moduleCache.get(moduleId) as T;
    }

    const module = await loader();
    moduleCache.set(moduleId, module);
    return module;
  };
};

/**
 * Pre-defined lazy loaders for dependencies
 */
export const lazyModules = {
  // Lightweight UI alternatives (prioritized over heavy deps)
  inquirer: createLazyModule("inquirer", () => import("./prompts.js")),
  gradientString: createLazyModule(
    "gradient-string",
    () => import("gradient-string")
  ),

  // Core services (loaded on demand)
  commitX: createLazyModule("commitX", () => import("../core/commitx.js")),

  // Security utilities
  security: createLazyModule("security", () => import("./security.js")),

  // Configuration
  config: createLazyModule("config", () => import("../config.js")),

  // Lightweight alternatives
  colors: createLazyModule("colors", () => import("./colors.js")),
};

const COMMITX_PRELOAD_COMMANDS = new Set(["commit", "status", "diff"]);

/**
 * Preload critical modules in background after startup
 */
export const preloadCriticalModules = (requestedCommand?: string): void => {
  setTimeout(() => {
    if (!requestedCommand || COMMITX_PRELOAD_COMMANDS.has(requestedCommand)) {
      void lazyModules.commitX();
    }

    if (requestedCommand === "debug") {
      void lazyModules.security();
    }
  }, 100);
};
