import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import * as v from "valibot";
import type { CommitGroup, GitDiff } from "../types/common.js";
import { CommitGroupSchema } from "../schemas/validation.js";
import {
  CONFIG_DIR,
  CONFIG_DIR_MODE,
  CONFIG_FILE_MODE,
} from "../constants/config.js";

interface CacheEntry {
  groups: unknown;
  timestamp: number;
  version: string;
}

export interface AICache {
  get(key: string): Promise<CommitGroup[] | null>;
  set(key: string, groups: CommitGroup[]): Promise<void>;
  generateKey(diffs: GitDiff[], context?: CacheKeyContext): string;
}

export interface CacheKeyContext {
  repositoryPath?: string;
  model?: string;
  promptVersion?: string;
}

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = "4.0";
const CACHE_KEY_LENGTH = 48;

const parseGroups = (value: unknown): CommitGroup[] | null => {
  const result = v.safeParse(v.array(CommitGroupSchema), value);
  return result.success && result.output.length > 0
    ? result.output.map(group => ({
        files: group.files,
        message: group.message,
        confidence: group.confidence,
        ...(group.description === undefined
          ? {}
          : { description: group.description }),
      }))
    : null;
};

const isFreshEntry = (value: unknown): value is CacheEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CacheEntry>;
  return (
    entry.version === CACHE_VERSION &&
    typeof entry.timestamp === "number" &&
    entry.timestamp > Date.now() - CACHE_MAX_AGE_MS
  );
};

export class PersistentAICache implements AICache {
  private readonly cacheDir: string;

  constructor(cacheDir: string = join(homedir(), CONFIG_DIR, "cache")) {
    this.cacheDir = cacheDir;
  }

  private getCacheFilePath(key: string): string {
    return join(this.cacheDir, `${key}.cache`);
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  generateKey(diffs: GitDiff[], context: CacheKeyContext = {}): string {
    const keyComponents = diffs
      .map(diff => {
        const contentHash = this.hashContent(diff.changes || "");
        return [
          diff.file,
          diff.additions,
          diff.deletions,
          diff.isNew,
          diff.isDeleted,
          diff.isRenamed,
          diff.oldPath ?? "",
          contentHash,
        ].join("\0");
      })
      .sort();

    const repositoryHash = this.hashContent(
      resolve(context.repositoryPath ?? process.cwd())
    );

    return createHash("sha256")
      .update(
        [
          CACHE_VERSION,
          context.promptVersion ?? "unknown",
          context.model ?? "unknown",
          repositoryHash,
          ...keyComponents,
        ].join("\0")
      )
      .digest("hex")
      .substring(0, CACHE_KEY_LENGTH);
  }

  async get(key: string): Promise<CommitGroup[] | null> {
    try {
      const entry: unknown = JSON.parse(
        await readFile(this.getCacheFilePath(key), "utf8")
      );
      return isFreshEntry(entry) ? parseGroups(entry.groups) : null;
    } catch {
      // A missing or unreadable entry is a cache miss.
      return null;
    }
  }

  async set(key: string, groups: CommitGroup[]): Promise<void> {
    try {
      const validGroups = parseGroups(groups);
      if (!validGroups) return;

      await mkdir(this.cacheDir, { recursive: true, mode: CONFIG_DIR_MODE });
      await chmod(this.cacheDir, CONFIG_DIR_MODE);

      const entry: CacheEntry = {
        groups: validGroups,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      };
      const filePath = this.getCacheFilePath(key);
      const temporaryPath = join(
        this.cacheDir,
        `${key}.${process.pid}.${randomUUID()}.tmp`
      );

      try {
        await writeFile(temporaryPath, JSON.stringify(entry), {
          mode: CONFIG_FILE_MODE,
          flag: "wx",
        });
        await rename(temporaryPath, filePath);
        await chmod(filePath, CONFIG_FILE_MODE);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      console.warn("Cache write error:", error);
    }
  }
}
