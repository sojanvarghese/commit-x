import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import * as v from "valibot";
import type { CommitGroup, GitDiff } from "../types/common.js";
import { CommitGroupSchema } from "../schemas/validation.js";
import {
  CONFIG_DIR,
  CONFIG_DIR_MODE,
  CONFIG_FILE_MODE,
} from "../constants/config.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface CacheEntry {
  groups: CommitGroup[] | string;
  timestamp: number;
  version: string;
  compressed: boolean;
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
const CACHE_VERSION = "3.0";
const CACHE_COMPRESS_THRESHOLD_BYTES = 1024;
const CACHE_KEY_LENGTH = 48;

const cloneGroups = (groups: CommitGroup[]): CommitGroup[] =>
  structuredClone(groups);

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

const isCacheEntry = (value: unknown): value is CacheEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CacheEntry>;
  return (
    entry.version === CACHE_VERSION &&
    typeof entry.timestamp === "number" &&
    typeof entry.compressed === "boolean" &&
    (typeof entry.groups === "string" || Array.isArray(entry.groups))
  );
};

export class PersistentAICache implements AICache {
  private readonly cacheDir: string;
  private readonly memoryCache = new Map<string, CacheEntry>();

  constructor(cacheDir: string = join(homedir(), CONFIG_DIR, "cache")) {
    this.cacheDir = cacheDir;
  }

  private async ensureCacheDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true, mode: CONFIG_DIR_MODE });
    await chmod(this.cacheDir, CONFIG_DIR_MODE);
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

  private async readGroups(entry: CacheEntry): Promise<CommitGroup[] | null> {
    if (entry.compressed) {
      if (typeof entry.groups !== "string") {
        return null;
      }

      const decompressed = await gunzipAsync(
        Buffer.from(entry.groups, "base64")
      );

      return parseGroups(JSON.parse(decompressed.toString()));
    }

    return parseGroups(entry.groups);
  }

  private isValidEntry(entry: CacheEntry): boolean {
    return (
      entry.version === CACHE_VERSION &&
      entry.timestamp > Date.now() - CACHE_MAX_AGE_MS &&
      isCacheEntry(entry)
    );
  }

  async get(key: string): Promise<CommitGroup[] | null> {
    try {
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry && this.isValidEntry(memoryEntry)) {
        const groups = await this.readGroups(memoryEntry);
        return groups ? cloneGroups(groups) : null;
      }

      await this.ensureCacheDir();
      const filePath = this.getCacheFilePath(key);

      try {
        const fileStats = await stat(filePath);
        if (Date.now() - fileStats.mtime.getTime() > CACHE_MAX_AGE_MS) {
          return null;
        }

        const rawData = await readFile(filePath);
        const parsed: unknown = JSON.parse(rawData.toString());

        if (!isCacheEntry(parsed) || !this.isValidEntry(parsed)) {
          return null;
        }

        const groups = await this.readGroups(parsed);
        if (!groups || groups.length === 0) {
          return null;
        }

        this.memoryCache.set(key, {
          ...parsed,
          groups: cloneGroups(groups),
          compressed: false,
        });

        return cloneGroups(groups);
      } catch {
        return null;
      }
    } catch (error) {
      console.warn("Cache read error:", error);
      return null;
    }
  }

  async set(key: string, groups: CommitGroup[]): Promise<void> {
    try {
      await this.ensureCacheDir();

      const validGroups = parseGroups(groups);
      if (!validGroups) return;

      const entry: CacheEntry = {
        groups: cloneGroups(validGroups),
        timestamp: Date.now(),
        version: CACHE_VERSION,
        compressed: false,
      };

      this.memoryCache.set(key, entry);

      const serialized = JSON.stringify(validGroups);
      let diskEntry = entry;

      if (serialized.length > CACHE_COMPRESS_THRESHOLD_BYTES) {
        const compressed = await gzipAsync(serialized);
        diskEntry = {
          ...entry,
          groups: compressed.toString("base64"),
          compressed: true,
        };
      }

      const filePath = this.getCacheFilePath(key);
      const temporaryPath = join(
        this.cacheDir,
        `${key}.${process.pid}.${randomUUID()}.tmp`
      );

      try {
        await writeFile(temporaryPath, JSON.stringify(diskEntry), {
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
