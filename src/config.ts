import process from "node:process";
import * as v from "valibot";
import { ApiKeySchema } from "./schemas/validation.js";

// The key is read from the environment only and is never persisted.
export const getApiKey = (): string => {
  const result = v.safeParse(ApiKeySchema, process.env.GEMINI_API_KEY ?? "");
  return result.success ? result.output : "";
};
