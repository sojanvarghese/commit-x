import type { SanitizedDiff } from "./data-sanitization.js";
import type { GitDiff } from "../types/common.js";

export const DIFF_LOC_AGGRESSIVE_THRESHOLD = 250;

export const countDiffLines = (content: string): number => {
  if (!content) return 0;
  let count = 0;
  for (const line of content.split("\n")) {
    if (
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") &&
      !line.startsWith("---")
    ) {
      count++;
    }
  }
  return count;
};

export const shouldAggressivelyMinimize = (diff: {
  changes?: string;
}): boolean =>
  countDiffLines(diff.changes ?? "") > DIFF_LOC_AGGRESSIVE_THRESHOLD;

export const normalizeDiffWhitespace = (content: string): string =>
  content
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

export const keepSignificantDiffLines = (content: string): string =>
  content
    .split("\n")
    .filter(
      line =>
        ((line.startsWith("+") || line.startsWith("-")) &&
          !line.startsWith("+++") &&
          !line.startsWith("---")) ||
        line.startsWith("@@")
    )
    .join("\n")
    .trim();

export const stripBoilerplate = (content: string): string => {
  const lines = content.split("\n");
  const filtered: string[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/^[+-]\s*/, "");

    if (/^(import\s.+|export\s+(?:\*|\{).*from\s.+);?\s*$/.test(trimmed)) continue;
    if (/^\/\/.*$/.test(trimmed)) continue;
    if (/^\s*(\*|\/\*\*|\/\*|\*\/)/.test(trimmed)) continue;
    if (/^console\.(log|debug|info)\(/.test(trimmed)) continue;
    if (trimmed.trim() === "") continue;

    filtered.push(line);
  }

  return filtered.join("\n").trim();
};

export const collapseRepetitiveLines = (content: string): string => {
  const lines = content.split("\n");
  if (lines.length < 10) return content;

  const normalizePattern = (line: string): string =>
    line
      .replace(/[0-9]+/g, "N")
      .replace(/"[^"]*"/g, '"S"')
      .replace(/'[^']*'/g, "'S'");

  const flushRepeated = (result: string[], repeatedLines: string[]): void => {
    if (repeatedLines.length >= 6) {
      result.push(repeatedLines[0]);
      result.push(`  [... ${repeatedLines.length - 1} similar lines omitted]`);
    } else {
      result.push(...repeatedLines);
    }
  };

  const result: string[] = [];
  let repeatedLines: string[] = [lines[0]];
  let prevPattern = normalizePattern(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const pattern = normalizePattern(lines[i]);

    if (pattern === prevPattern) {
      repeatedLines.push(lines[i]);
      continue;
    }

    flushRepeated(result, repeatedLines);
    repeatedLines = [lines[i]];
    prevPattern = pattern;
  }

  flushRepeated(result, repeatedLines);

  return result.join("\n");
};

export const truncatePreservingEdges = (
  content: string,
  budget: number
): string => {
  if (content.length <= budget) return content;

  const separator = "\n...[truncated]...\n";
  if (budget <= separator.length + 40) {
    return content.slice(0, budget).trim();
  }

  const available = budget - separator.length;
  const headBudget = Math.ceil(available * 0.6);
  const tailBudget = Math.floor(available * 0.4);
  const head = content.slice(0, headBudget).trimEnd();
  const tail = content.slice(-tailBudget).trimStart();

  return `${head}${separator}${tail}`.trim();
};

export interface CompressionResult {
  content: string;
  compressed: boolean;
}

export const compressDiffForPrompt = (
  diff: SanitizedDiff | GitDiff,
  budget: number
): CompressionResult => {
  const normalized = normalizeDiffWhitespace(diff.changes ?? "");

  if (!normalized) {
    return {
      content: `${diff.file} changed (+${diff.additions}/-${diff.deletions})`,
      compressed: true,
    };
  }

  const aggressive = shouldAggressivelyMinimize({ changes: normalized });

  // Tier 0: fits as-is AND not aggressive mode
  if (!aggressive && normalized.length <= budget) {
    return { content: normalized, compressed: false };
  }

  // Tier 1: keep only +/- lines and @@ headers
  const significantLines = keepSignificantDiffLines(normalized);
  if (!aggressive && significantLines && significantLines.length <= budget) {
    return { content: significantLines, compressed: true };
  }

  // Tier 2: strip boilerplate (always for aggressive mode, or when still too big)
  const stripped = stripBoilerplate(significantLines || normalized);
  if (stripped && stripped.length <= budget) {
    return { content: stripped, compressed: true };
  }

  // Tier 3: collapse repetitive patterns
  const collapsed = collapseRepetitiveLines(
    stripped || significantLines || normalized
  );
  if (collapsed && collapsed.length <= budget) {
    return { content: collapsed, compressed: true };
  }

  // Tier 4: hard truncate the best we have
  const best = collapsed || stripped || significantLines || normalized;
  if (best) {
    return {
      content: truncatePreservingEdges(best, budget),
      compressed: true,
    };
  }

  return {
    content: `${diff.file} changed (+${diff.additions}/-${diff.deletions})`,
    compressed: true,
  };
};
