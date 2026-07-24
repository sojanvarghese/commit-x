// Native ESM already caches dynamic imports, so these loaders need no second
// cache or background preloading layer.
export const lazyModules = {
  commitX: () => import("../core/commitx.js"),
  security: () => import("./security.js"),
  config: () => import("../config.js"),
} as const;
