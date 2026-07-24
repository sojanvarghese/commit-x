export const AI_MAX_ATTEMPTS_PER_MODEL = 2;
export const AI_RETRY_DELAY_MS = 750;

export const AI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
const AI_FALLBACK_MODELS_AFTER_DEFAULT = ["gemini-3.6-flash"] as const;

export const AI_MODEL_FALLBACK_CHAIN: readonly string[] = Array.from(
  new Set<string>([AI_DEFAULT_MODEL, ...AI_FALLBACK_MODELS_AFTER_DEFAULT])
);
