import type {
  AggregatedCommitResponse,
  CommitGroup,
  GitDiff,
} from "../types/common.js";
import type { SanitizedDiff } from "../utils/data-sanitization.js";
import { DEFAULT_LIMITS } from "../constants/security.js";
import { UI_CONSTANTS, COMMIT_MESSAGE_PATTERNS } from "../constants/ui.js";
import { lightColors } from "../utils/colors.js";
import { compressDiffForPrompt } from "../utils/diff-minimizer.js";

export interface BuiltPrompt {
  prompt: string;
}

const TOTAL_CONTENT_BUDGET_CAP = 50_000;

const formatStatus = (diff: SanitizedDiff): string => {
  if (diff.isNew) return "A";
  if (diff.isDeleted) return "D";
  if (diff.isRenamed) return "R";
  return "M";
};

const renderFileEntry = (
  diff: SanitizedDiff,
  index: number,
  perFileBudget: number
): string => {
  const compressed = compressDiffForPrompt(diff, perFileBudget);
  const status = formatStatus(diff);
  const header = `[${index + 1}] ${status} ${diff.file} (+${diff.additions}/-${diff.deletions})`;
  return compressed.content ? `${header}\n${compressed.content}` : header;
};

export const buildAggregatedPrompt = (
  sanitizedDiffs: SanitizedDiff[]
): BuiltPrompt => {
  const totalContentBudget = Math.min(
    DEFAULT_LIMITS.maxApiRequestSize / 2,
    TOTAL_CONTENT_BUDGET_CAP
  );
  const perFileBudget = Math.max(
    200,
    Math.min(
      UI_CONSTANTS.DIFF_CONTENT_TRUNCATE_LIMIT,
      Math.floor(totalContentBudget / Math.max(1, sanitizedDiffs.length))
    )
  );

  const fileEntries = sanitizedDiffs.map((diff, index) =>
    renderFileEntry(diff, index, perFileBudget)
  );

  const prompt = [
    "Task: Group the file changes below into logical git commits.",
    'Output: ONLY a JSON object matching this schema, no prose, no markdown fence: {"groups":[{"files":["<file>"],"message":"<subject>","confidence":<0..1>}]}',
    "Rules:",
    "- Each file appears in exactly one group.",
    "- 1 to 7 files per group. Split unrelated changes into separate groups.",
    "- message: 3-20 words, capitalized past-tense verb first (e.g. Added, Fixed, Updated, Refactored), no trailing period.",
    "- FORBIDDEN prefixes: feat:, fix:, chore:, docs:, refactor:, style:, test:, perf:, build:, ci:, revert:. No type(scope): syntax.",
    "- confidence: 0.5 (unsure) to 0.95 (clear intent).",
    "Files:",
    "---",
    ...fileEntries,
  ].join("\n");

  return { prompt };
};

interface PathResolver {
  resolve(candidate: string): string | undefined;
}

const basename = (filePath: string): string => {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
};

// Lenient resolver: exact match wins; falls back to unique basename lookup so
// models that trim a leading `./`, normalize slashes, or emit the bare filename
// still land on the right file.
const createPathResolver = (
  diffs: GitDiff[],
  sanitizedDiffs: SanitizedDiff[]
): PathResolver => {
  const exact = new Map<string, string>();
  const basenameHits = new Map<string, string[]>();

  const record = (candidate: string, original: string): void => {
    if (!exact.has(candidate)) exact.set(candidate, original);
    const baseKey = basename(candidate);
    const existing = basenameHits.get(baseKey);
    if (existing) {
      if (!existing.includes(original)) existing.push(original);
    } else {
      basenameHits.set(baseKey, [original]);
    }
  };

  for (let i = 0; i < sanitizedDiffs.length; i++) {
    const original = diffs[i].file;
    record(sanitizedDiffs[i].file, original);
    record(original, original);
  }

  return {
    resolve: (candidate: string): string | undefined => {
      const direct = exact.get(candidate);
      if (direct) return direct;
      const byBase = basenameHits.get(basename(candidate));
      return byBase && byBase.length === 1 ? byBase[0] : undefined;
    },
  };
};

const generateFallbackMessage = (diff: GitDiff): string => {
  const fileName = diff.file.split("/").pop() ?? diff.file;

  if (diff.isNew) return `Created new ${fileName} file with initial implementation`;
  if (diff.isDeleted) return `Removed ${fileName} file as it is no longer needed`;
  if (diff.additions > diff.deletions * 2) return `Added new functionality to ${fileName} file`;
  if (diff.deletions > diff.additions * 2) return `Removed unused code from ${fileName} file`;
  return `Updated ${fileName} file with code improvements`;
};

interface FormatValidation {
  isValid: boolean;
  correctedMessage?: string;
}

const validateCommitMessageFormat = (message: string): FormatValidation => {
  if (!message || typeof message !== "string") return { isValid: false };

  const trimmed = message.trim();
  const hasBannedPrefix = COMMIT_MESSAGE_PATTERNS.AVOID_PREFIXES.some(prefix =>
    trimmed.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (hasBannedPrefix) {
    console.log(
      lightColors.yellow(
        `⚠️  Detected conventional commit prefix in: "${trimmed}"`
      )
    );
    return { isValid: false };
  }

  const hasConventionalPattern =
    COMMIT_MESSAGE_PATTERNS.CONVENTIONAL_COMMIT_PATTERNS.some(pattern =>
      pattern.test(trimmed)
    );

  if (hasConventionalPattern) {
    console.log(
      lightColors.yellow(
        `⚠️  Detected conventional commit format in: "${trimmed}"`
      )
    );
    const corrected = trimmed.replace(/^[a-z]+(\([^)]*\))?:\s*/i, "");
    if (corrected && corrected.length > 10) {
      const correctedMessage =
        corrected.charAt(0).toUpperCase() + corrected.slice(1);
      console.log(lightColors.blue(`  ✓ Corrected to: "${correctedMessage}"`));
      return { isValid: true, correctedMessage };
    }
    return { isValid: false };
  }

  return { isValid: true };
};

const resolveFinalMessage = (
  rawMessage: string,
  firstValidFile: string,
  diffs: GitDiff[]
): string => {
  const trimmed = rawMessage.trim();
  const validation = validateCommitMessageFormat(trimmed);

  if (validation.correctedMessage) return validation.correctedMessage;

  if (!validation.isValid) {
    console.log(
      lightColors.red(`❌ Rejecting invalid commit message format: "${trimmed}"`)
    );
    const firstDiff = diffs.find(d => d.file === firstValidFile);
    const fallback = firstDiff ? generateFallbackMessage(firstDiff) : "Updated files";
    console.log(lightColors.blue(`  ✓ Using fallback message: "${fallback}"`));
    return fallback;
  }

  return trimmed;
};

interface RawGroup {
  files?: unknown;
  message?: unknown;
  description?: unknown;
  confidence?: unknown;
}

export const parseAggregatedResponse = (
  response: string,
  diffs: GitDiff[],
  sanitizedDiffs: SanitizedDiff[]
): AggregatedCommitResponse => {
  const jsonMatch = response.match(COMMIT_MESSAGE_PATTERNS.JSON_PATTERN);
  if (!jsonMatch) {
    throw new Error("No valid JSON found in AI response");
  }

  let parsed: { groups?: RawGroup[] };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(`Failed to parse AI JSON response: ${error}`, {
      cause: error,
    });
  }

  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    throw new Error("Invalid groups structure in AI response");
  }

  const resolver = createPathResolver(diffs, sanitizedDiffs);
  const groups: CommitGroup[] = [];
  const usedFiles = new Set<string>();

  for (const group of parsed.groups) {
    if (
      !group.files ||
      !Array.isArray(group.files) ||
      typeof group.message !== "string"
    ) {
      console.warn("Skipping invalid group structure:", group);
      continue;
    }

    const validFiles: string[] = [];
    for (const candidate of group.files) {
      if (typeof candidate !== "string") continue;
      const original = resolver.resolve(candidate);
      if (original && !usedFiles.has(original)) {
        validFiles.push(original);
        usedFiles.add(original);
      }
    }

    if (validFiles.length === 0) continue;

    const finalMessage = resolveFinalMessage(group.message, validFiles[0], diffs);
    const description =
      typeof group.description === "string"
        ? group.description.trim()
        : undefined;
    const confidence =
      typeof group.confidence === "number" ? group.confidence : 0.7;

    groups.push({
      files: validFiles,
      message: finalMessage,
      description,
      confidence,
    });
  }

  const unusedFiles = diffs.filter(diff => !usedFiles.has(diff.file));
  if (unusedFiles.length > 0) {
    console.warn(
      `${unusedFiles.length} files not included in AI grouping, adding as individual commits`
    );
    for (const diff of unusedFiles) {
      groups.push({
        files: [diff.file],
        message: generateFallbackMessage(diff),
        confidence: 0.6,
      });
    }
  }

  return { groups };
};

export { generateFallbackMessage };
