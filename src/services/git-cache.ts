import type { GitStatus } from "../types/common.js";

export interface RepoInfo {
  name: string;
  branch: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class GitCache {
  private readonly ttlMs: number;
  private statusEntry?: CacheEntry<GitStatus>;
  private repoInfoEntry?: CacheEntry<RepoInfo>;

  constructor(ttlMs: number = 5000) {
    this.ttlMs = ttlMs;
  }

  private isFresh<T>(entry?: CacheEntry<T>): entry is CacheEntry<T> {
    if (!entry) return false;
    return Date.now() - entry.timestamp < this.ttlMs;
  }

  getStatus(): GitStatus | undefined {
    return this.isFresh(this.statusEntry) ? this.statusEntry.data : undefined;
  }

  setStatus(data: GitStatus): void {
    this.statusEntry = { data, timestamp: Date.now() };
  }

  getRepoInfo(): RepoInfo | undefined {
    return this.isFresh(this.repoInfoEntry) ? this.repoInfoEntry.data : undefined;
  }

  setRepoInfo(data: RepoInfo): void {
    this.repoInfoEntry = { data, timestamp: Date.now() };
  }

  clear(): void {
    this.statusEntry = undefined;
    this.repoInfoEntry = undefined;
  }
}
