// Lazy loading utilities for optimized startup performance

export type LazyModule<T> = () => Promise<T>;

// Cache for lazy-loaded modules
const moduleCache = new Map<string, any>();

/**
 * Create a lazy-loaded module wrapper
 */
export const createLazyModule = <T>(
  moduleId: string,
  loader: () => Promise<T>
): LazyModule<T> => {
  return async (): Promise<T> => {
    if (moduleCache.has(moduleId)) {
      return moduleCache.get(moduleId);
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

  // File system utilities
  fs: createLazyModule("fs", () => import("fs/promises")),

  // Configuration
  config: createLazyModule("config", () => import("../config.js")),

  // Enhanced utilities
  enhancedErrorHandler: createLazyModule(
    "enhancedErrorHandler",
    () => import("./enhanced-error-handler.js")
  ),
  progress: createLazyModule("progress", () => import("./progress.js")),

  // Lightweight alternatives
  colors: createLazyModule("colors", () => import("./colors.js")),
  spinner: createLazyModule("spinner", () => import("./spinner.js")),
};

/**
 * Preload critical modules in background after startup
 */
export const preloadCriticalModules = (): void => {
  // Don't await - just start loading in background
  setTimeout(() => {
    void lazyModules.commitX();
    void lazyModules.security();
    void lazyModules.colors();
    void lazyModules.enhancedErrorHandler();
  }, 100); // Small delay to not interfere with startup
};

/**
 * Clear module cache (useful for testing)
 */
export const clearModuleCache = (): void => {
  moduleCache.clear();
};

/**
 * Get cache statistics
 */
export const getCacheStats = () => {
  return {
    cachedModules: Array.from(moduleCache.keys()),
    cacheSize: moduleCache.size,
  };
};
