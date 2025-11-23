export interface TimeoutCalculationOptions {
  fileSize?: number; // in bytes
  diffSize?: number; // in characters
  totalChanges?: number; // additions + deletions
  fileCount?: number; // number of files being processed
  operationType: "git" | "ai" | "file";
}

export const calculateDynamicTimeout = (
  options: TimeoutCalculationOptions
): number => {
  const {
    fileSize = 0,
    diffSize = 0,
    totalChanges = 0,
    fileCount = 1,
    operationType,
  } = options;

  const baseTimeouts = {
    git: 15000, // 15 seconds for git operations
    ai: 20000, // 20 seconds for AI operations
    file: 10000, // 10 seconds for file operations
  };

  const maxTimeouts = {
    git: 60000, // 60 seconds max for git operations
    ai: 90000, // 90 seconds max for AI operations
    file: 30000, // 30 seconds max for file operations
  };

  let timeout = baseTimeouts[operationType];

  if (fileSize > 0) {
    const fileSizeMB = fileSize / (1024 * 1024);
    timeout += Math.floor(fileSizeMB * 1000);
  }

  if (diffSize > 0) {
    const diffSizeKB = diffSize / 1024;
    timeout += Math.floor(diffSizeKB / 10) * 1000;
  }

  if (totalChanges > 0) {
    const changeTimeout = Math.min(totalChanges * 100, 30000);
    timeout += changeTimeout;
  }

  if (fileCount > 1) {
    const batchTimeout = (fileCount - 1) * 2000; // 2s per additional file
    timeout += batchTimeout;
  }

  timeout = Math.min(timeout, maxTimeouts[operationType]);
  timeout = Math.max(timeout, baseTimeouts[operationType]);

  return timeout;
};

export const calculateGitTimeout = (
  options: Omit<TimeoutCalculationOptions, "operationType">
): number => calculateDynamicTimeout({ ...options, operationType: "git" });

export const calculateAITimeout = (
  options: Omit<TimeoutCalculationOptions, "operationType">
): number => calculateDynamicTimeout({ ...options, operationType: "ai" });

export const calculateFileTimeout = (
  options: Omit<TimeoutCalculationOptions, "operationType">
): number => calculateDynamicTimeout({ ...options, operationType: "file" });
