export interface CommitConfig {
  apiKey?: string;
  model?: string;
  aggregation?: {
    enabled: boolean;
  };
}

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

export interface CommitSuggestion {
  message: string;
  description?: string;
  type?: string;
  scope?: string;
  confidence: number;
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  total: number;
}

export interface CommitOptions {
  message?: string;
  dryRun?: boolean;
  interactive?: boolean;
  all?: boolean; // Stage all files and commit together (traditional workflow)
  aggregate?: boolean; // Enable/disable commit aggregation (AI grouping)
}

export interface PlaywrightPatterns {
  isPOM: boolean;
  isSpec: boolean;
  isFixture: boolean;
  isConfig: boolean;
  isUtil: boolean;
  testType: 'unit' | 'integration' | 'e2e' | 'unknown';
}

export interface CommitGroup {
  files: string[];
  message: string;
  description?: string;
  confidence: number;
}

export interface AggregatedCommitResponse {
  groups: CommitGroup[];
  fallbackToIndividual?: boolean;
}
