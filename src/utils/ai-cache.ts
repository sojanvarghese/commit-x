import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import type { CommitGroup, GitDiff } from "../types/common.js";

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
  generateKey(diffs: GitDiff[]): string;
}

// v2 preserves full group structure; pre-v2 entries are ignored.
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = "2.0";
const CACHE_COMPRESS_THRESHOLD_BYTES = 1024;

export class PersistentAICache implements AICache {
  private readonly cacheDir: string;
  private readonly memoryCache = new Map<string, CacheEntry>();

  constructor() {
    this.cacheDir = join(homedir(), ".commitx", "cache");
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
    } catch {
      /* empty */
    }
  }

  private getCacheFilePath(key: string): string {
    return join(this.cacheDir, `${key}.cache`);
  }

  private hashContent(content: string): string {
    const normalized = content
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .toLowerCase();

    return createHash("sha256").update(normalized).digest("hex").substring(0, 8);
  }

  generateKey(diffs: GitDiff[]): string {
    const keyComponents = diffs
      .map(diff => {
        const contentHash = this.hashContent(diff.changes || "");
        const total = diff.additions + diff.deletions;
        const ratio = total > 0 ? diff.additions / total : 0;

        return `${diff.file}:${diff.additions}:${diff.deletions}:${ratio.toFixed(2)}:${contentHash}`;
      })
      .sort();

    return createHash("sha256")
      .update(keyComponents.join("|"))
      .digest("hex")
      .substring(0, 16);
  }

  private async readGroups(entry: CacheEntry): Promise<CommitGroup[] | null> {
    if (entry.compressed) {
      if (typeof entry.groups !== "string") {
        return null;
      }

      const decompressed = await gunzipAsync(
        Buffer.from(entry.groups, "base64")
      );

      const parsed = JSON.parse(decompressed.toString());
      return Array.isArray(parsed) ? parsed : null;
    }

    return Array.isArray(entry.groups) ? entry.groups : null;
  }

  private isValidEntry(entry: CacheEntry): boolean {
    return (
      entry.version === CACHE_VERSION &&
      entry.timestamp > Date.now() - CACHE_MAX_AGE_MS &&
      (entry.compressed
        ? typeof entry.groups === "string"
        : Array.isArray(entry.groups))
    );
  }

  async get(key: string): Promise<CommitGroup[] | null> {
    try {
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry && this.isValidEntry(memoryEntry)) {
        const groups = memoryEntry.groups;
        return Array.isArray(groups) ? groups : null;
      }

      await this.ensureCacheDir();
      const filePath = this.getCacheFilePath(key);

      try {
        const fileStats = await stat(filePath);
        if (Date.now() - fileStats.mtime.getTime() > CACHE_MAX_AGE_MS) {
          return null;
        }

        const rawData = await readFile(filePath);
        const entry: CacheEntry = JSON.parse(rawData.toString());

        if (!this.isValidEntry(entry)) {
          return null;
        }

        const groups = await this.readGroups(entry);
        if (!groups || groups.length === 0) {
          return null;
        }

        this.memoryCache.set(key, { ...entry, groups, compressed: false });

        return groups;
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

      const entry: CacheEntry = {
        groups,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        compressed: false,
      };

      this.memoryCache.set(key, entry);

      const serialized = JSON.stringify(groups);
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
      await writeFile(filePath, JSON.stringify(diskEntry));
    } catch (error) {
      console.warn("Cache write error:", error);
    }
  }
}
