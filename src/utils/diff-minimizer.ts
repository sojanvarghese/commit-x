import { countChanges, patchBody } from "./diff-lines.js";
import type { SanitizedDiff } from "./data-sanitization.js";
import type { GitDiff } from "../types/common.js";

export const DIFF_LOC_AGGRESSIVE_THRESHOLD = 250;

const BLANK_LINE = /^\s*$/;
const DIFF_MARKER = /^[+-]\s*/;
const IMPORT_OR_EXPORT = /^(import\s.+|export\s+(?:\*|\{).*from\s.+);?\s*$/;
const LINE_COMMENT = /^\/\/.*$/;
const BLOCK_COMMENT = /^\s*(\*|\/\*\*|\/\*|\*\/)/;
const CONSOLE_CALL = /^console\.(log|debug|info)\(/;
const NUMBER_RUN = /[0-9]+/g;
const DOUBLE_QUOTED = /"[^"]*"/g;
const SINGLE_QUOTED = /'[^']*'/g;

export const countDiffLines = (content: string): number => {
  const { additions, deletions } = countChanges(patchBody(content.split("\n")));
  return additions + deletions;
};

export const shouldAggressivelyMinimize = (diff: {
  changes?: string;
}): boolean =>
  countDiffLines(diff.changes ?? "") > DIFF_LOC_AGGRESSIVE_THRESHOLD;

const normalizeLines = (content: string): string[] => {
  if (!content) return [];
  const lines: string[] = [];
  for (const raw of content.split("\n")) {
    if (BLANK_LINE.test(raw)) {
      if (lines.length && lines.at(-1) !== "") lines.push("");
    } else {
      lines.push(raw.trimEnd());
    }
  }
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const joinLines = (lines: readonly string[]): string => lines.join("\n");

export const normalizeDiffWhitespace = (content: string): string =>
  joinLines(normalizeLines(content));

const keepSignificantLines = (lines: readonly string[]): string[] =>
  lines.filter(
    line =>
      line.startsWith("+") || line.startsWith("-") || line.startsWith("@@")
  );

export const keepSignificantDiffLines = (content: string): string =>
  joinLines(keepSignificantLines(patchBody(content.split("\n")))).trim();

const prioritizeAdditionLines = (lines: readonly string[]): string[] =>
  lines.filter(line => line.startsWith("@@") || line.startsWith("+"));

// Large diffs: additions describe the post-change state and carry intent;
// deletions are context we can usually drop to make room for more files.
export const prioritizeAdditions = (content: string): string =>
  joinLines(prioritizeAdditionLines(patchBody(content.split("\n")))).trim();

const stripBoilerplateLines = (lines: readonly string[]): string[] => {
  const filtered: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(DIFF_MARKER, "");
    if (IMPORT_OR_EXPORT.test(trimmed)) continue;
    if (LINE_COMMENT.test(trimmed)) continue;
    if (BLOCK_COMMENT.test(trimmed)) continue;
    if (CONSOLE_CALL.test(trimmed)) continue;
    if (trimmed.trim() === "") continue;
    filtered.push(line);
  }
  return filtered;
};

export const stripBoilerplate = (content: string): string =>
  joinLines(stripBoilerplateLines(content.split("\n"))).trim();

const normalizePattern = (line: string): string =>
  line
    .replace(NUMBER_RUN, "N")
    .replace(DOUBLE_QUOTED, '"S"')
    .replace(SINGLE_QUOTED, "'S'");

const collapseLines = (lines: readonly string[]): string[] => {
  if (lines.length < 10) return [...lines];

  const flushRepeated = (result: string[], repeatedLines: string[]): void => {
    if (repeatedLines.length >= 6) {
      const firstRepeatedLine = repeatedLines[0];
      if (firstRepeatedLine) result.push(firstRepeatedLine);
      result.push(`  [... ${repeatedLines.length - 1} similar lines omitted]`);
    } else {
      result.push(...repeatedLines);
    }
  };

  const result: string[] = [];
  const firstLine = lines[0];
  if (firstLine === undefined) return [...lines];
  let repeatedLines: string[] = [firstLine];
  let prevPattern = normalizePattern(firstLine);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const pattern = normalizePattern(line);
    if (pattern === prevPattern) {
      repeatedLines.push(line);
      continue;
    }
    flushRepeated(result, repeatedLines);
    repeatedLines = [line];
    prevPattern = pattern;
  }

  flushRepeated(result, repeatedLines);
  return result;
};

export const collapseRepetitiveLines = (content: string): string => {
  const lines = content.split("\n");
  if (lines.length < 10) return content;
  return joinLines(collapseLines(lines));
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
  const lines = normalizeLines(diff.changes ?? "");
  if (lines.length === 0) return { content: "", compressed: true };

  const body = patchBody(lines);
  const { additions, deletions } = countChanges(body);
  const aggressive = additions + deletions > DIFF_LOC_AGGRESSIVE_THRESHOLD;
  if (!aggressive) {
    const normalized = joinLines(lines);
    if (normalized.length <= budget) {
      return { content: normalized, compressed: false };
    }
  }

  // With only deletions, the removed lines still describe what changed.
  let selected =
    aggressive && additions > 0
      ? prioritizeAdditionLines(body)
      : keepSignificantLines(body);
  if (selected.length === 0) selected = lines;
  let content = joinLines(selected);
  if (content.length > budget) {
    const stripped = stripBoilerplateLines(selected);
    if (stripped.some(line => !line.startsWith("@@"))) {
      selected = stripped;
      content = joinLines(selected);
    }
  }
  if (content.length > budget && selected.length >= 10) {
    content = joinLines(collapseLines(selected));
  }
  return {
    content: truncatePreservingEdges(content, budget),
    compressed: true,
  };
};
