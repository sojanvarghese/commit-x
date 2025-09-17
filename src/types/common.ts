export interface CommitConfig {
  apiKey?: string;
  model?: string;
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
}

export interface PlaywrightPatterns {
  isPOM: boolean;
  isSpec: boolean;
  isFixture: boolean;
  isConfig: boolean;
  isUtil: boolean;
  testType: 'unit' | 'integration' | 'e2e' | 'unknown';
}
