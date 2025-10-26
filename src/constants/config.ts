import type { CommitConfig } from '../types/common.js';

export const CONFIG_DIR = '.commit-x';
export const CONFIG_FILE = 'config.json';
export const CONFIG_FILE_MODE = 0o600;
export const CONFIG_DIR_MODE = 0o700;

export const DEFAULT_CONFIG: CommitConfig = {
  model: 'gemini-2.0-flash-lite',
};
