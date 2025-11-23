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
  suggestions: CommitSuggestion[];
  timestamp: number;
  version: string;
  compressed: boolean;
}

export interface AICache {
  get(key: string): Promise<CommitSuggestion[] | null>;
  set(key: string, suggestions: CommitSuggestion[]): Promise<void>;
  generateKey(diffs: GitDiff[]): string;
  clear(): Promise<void>;
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

  async get(key: string): Promise<CommitSuggestion[] | null> {
    try {
      // Check memory cache first
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry && this.isValidEntry(memoryEntry)) {
        this.stats.hits++;
        return memoryEntry.suggestions;
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

        let suggestions = entry.suggestions;

        // Decompress if needed
        if (entry.compressed && typeof suggestions === "string") {
          const decompressed = await gunzipAsync(
            Buffer.from(suggestions as unknown as string, "base64")
          );
          suggestions = JSON.parse(decompressed.toString());
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
      Array.isArray(entry.suggestions) &&
      entry.suggestions.length > 0
    );
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    // Note: Not clearing disk cache to preserve across sessions
  }

  async getStats(): Promise<{ size: number; hitRate: number }> {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      size: this.memoryCache.size,
      hitRate,
    };
  }
}

// Request batching and deduplication
export class RequestBatcher {
  private readonly pendingRequests = new Map<
    string,
    Promise<CommitSuggestion[]>
  >();
  private readonly batchTimeout = 50; // 50ms batch window

  async batch<T>(
    key: string,
    requestFn: () => Promise<T>,
    timeoutMs: number = this.batchTimeout
  ): Promise<T> {
    // Check if we already have a pending request for this key
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as unknown as T;
    }

    // Create a new batched request
    const promise = new Promise<T>((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await requestFn();
          this.pendingRequests.delete(key);
          resolve(result);
        } catch (error) {
          this.pendingRequests.delete(key);
          reject(error);
        }
      }, timeoutMs);
    });

    this.pendingRequests.set(
      key,
      promise as unknown as Promise<CommitSuggestion[]>
    );
    return promise;
  }

  clear(): void {
    this.pendingRequests.clear();
  }
}
