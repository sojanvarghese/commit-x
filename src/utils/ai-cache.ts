import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import type { CommitSuggestion, GitDiff } from "../types/common.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface CacheEntry {
  suggestions: CommitSuggestion[] | string;
  timestamp: number;
  version: string;
  compressed: boolean;
}

export interface AICache {
  get(key: string): Promise<CommitSuggestion[] | null>;
  set(key: string, suggestions: CommitSuggestion[]): Promise<void>;
  generateKey(diffs: GitDiff[]): string;
  /** @internal */
  clear(): Promise<void>;
  /** @internal */
  getStats(): Promise<{ size: number; hitRate: number }>;
}

export class PersistentAICache implements AICache {
  private readonly cacheDir: string;
  private readonly maxAge: number = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly version: string = "1.0";
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly stats = { hits: 0, misses: 0 };

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

  generateKey(diffs: GitDiff[]): string {
    // Create a more sophisticated cache key that includes:
    // - File paths and their relative importance
    // - Change patterns (additions/deletions ratio)
    // - Content similarity hash
    const keyComponents = diffs
      .map(diff => {
        const contentHash = this.hashContent(diff.changes || "");
        const ratio =
          diff.additions + diff.deletions > 0
            ? diff.additions / (diff.additions + diff.deletions)
            : 0;

        return `${diff.file}:${diff.additions}:${diff.deletions}:${ratio.toFixed(2)}:${contentHash}`;
      })
      .sort(); // Sort for consistent keys regardless of diff order

    return createHash("sha256")
      .update(keyComponents.join("|"))
      .digest("hex")
      .substring(0, 16); // Use shorter hash for filesystem compatibility
  }

  private hashContent(content: string): string {
    // Hash significant parts of content, ignoring whitespace variations
    const normalized = content
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .toLowerCase();

    return createHash("sha256")
      .update(normalized)
      .digest("hex")
      .substring(0, 8);
  }

  private async readSuggestions(
    entry: CacheEntry
  ): Promise<CommitSuggestion[] | null> {
    if (entry.compressed) {
      if (typeof entry.suggestions !== "string") {
        return null;
      }

      const decompressed = await gunzipAsync(
        Buffer.from(entry.suggestions, "base64")
      );

      const parsedSuggestions = JSON.parse(decompressed.toString());
      return Array.isArray(parsedSuggestions) ? parsedSuggestions : null;
    }

    return Array.isArray(entry.suggestions) ? entry.suggestions : null;
  }

  async get(key: string): Promise<CommitSuggestion[] | null> {
    try {
      // Check memory cache first
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry && this.isValidEntry(memoryEntry)) {
        this.stats.hits++;
        const suggestions = memoryEntry.suggestions;
        return Array.isArray(suggestions) ? suggestions : null;
      }

      // Check disk cache
      await this.ensureCacheDir();
      const filePath = this.getCacheFilePath(key);

      try {
        const fileStats = await stat(filePath);
        if (Date.now() - fileStats.mtime.getTime() > this.maxAge) {
          // Cache entry too old, remove it
          return null;
        }

        const rawData = await readFile(filePath);
        const entry: CacheEntry = JSON.parse(rawData.toString());

        if (!this.isValidEntry(entry)) {
          return null;
        }

        const suggestions = await this.readSuggestions(entry);
        if (!suggestions || suggestions.length === 0) {
          return null;
        }

        // Store in memory cache for faster access
        this.memoryCache.set(key, { ...entry, suggestions, compressed: false });

        this.stats.hits++;
        return suggestions;
      } catch {
        this.stats.misses++;
        return null;
      }
    } catch (error) {
      console.warn("Cache read error:", error);
      this.stats.misses++;
      return null;
    }
  }

  async set(key: string, suggestions: CommitSuggestion[]): Promise<void> {
    try {
      await this.ensureCacheDir();

      const entry: CacheEntry = {
        suggestions,
        timestamp: Date.now(),
        version: this.version,
        compressed: false,
      };

      // Store in memory cache
      this.memoryCache.set(key, entry);

      // Compress for disk storage if suggestions are large
      const dataSize = JSON.stringify(suggestions).length;
      let diskEntry = entry;

      if (dataSize > 1024) {
        // Compress if larger than 1KB
        const compressed = await gzipAsync(JSON.stringify(suggestions));
        diskEntry = {
          ...entry,
          suggestions: compressed.toString(
            "base64"
          ) as unknown as CommitSuggestion[],
          compressed: true,
        };
      }

      const filePath = this.getCacheFilePath(key);
      await writeFile(filePath, JSON.stringify(diskEntry));
    } catch (error) {
      console.warn("Cache write error:", error);
    }
  }

  private isValidEntry(entry: CacheEntry): boolean {
    return (
      entry.version === this.version &&
      entry.timestamp > Date.now() - this.maxAge &&
      (entry.compressed
        ? typeof entry.suggestions === "string"
        : Array.isArray(entry.suggestions))
    );
  }

  /** @internal */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    // Note: Not clearing disk cache to preserve across sessions
  }

  /** @internal */
  async getStats(): Promise<{ size: number; hitRate: number }> {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      size: this.memoryCache.size,
      hitRate,
    };
  }
}

// Request deduplication (prevents duplicate concurrent requests)
export class RequestBatcher {
  private readonly pendingRequests = new Map<
    string,
    Promise<CommitSuggestion[]>
  >();

  async batch<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    // Check if we already have a pending request for this key
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as unknown as T;
    }

    // Create a new request with deduplication
    const promise = (async (): Promise<T> => {
      try {
        const result = await requestFn();
        this.pendingRequests.delete(key);
        return result;
      } catch (error) {
        this.pendingRequests.delete(key);
        throw error;
      }
    })();

    this.pendingRequests.set(
      key,
      promise as unknown as Promise<CommitSuggestion[]>
    );
    return promise;
  }
}
