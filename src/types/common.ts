export interface GitDiff {
  file: string;
  additions: number;
  deletions: number;
  changes: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  oldPath?: string;
}

export interface CommitOptions {
  dryRun?: boolean;
  useCached?: boolean; // Reuse persisted AI results across runs (default: false)
}

export interface CommitGroup {
  files: string[];
  message: string;
  description?: string;
  confidence: number;
}

export interface AggregatedCommitResponse {
  groups: CommitGroup[];
}
