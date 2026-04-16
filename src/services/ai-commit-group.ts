import type { CommitGroup, GitDiff } from "../types/common.js";
import {
  classifyFile,
  DETERMINISTIC_MESSAGES,
  type Classification,
  type Ecosystem,
  type FileCategory,
} from "../utils/file-classifier.js";

export interface PreGroupingResult {
  aiDiffs: GitDiff[];
  autoGroups: CommitGroup[];
}

type SimpleAutoCategory = Exclude<
  FileCategory,
  "REGULAR" | "MANIFEST" | "LOCK"
>;

// LOCK is handled explicitly (paired with MANIFEST per ecosystem).
const SIMPLE_AUTO_CATEGORIES: readonly SimpleAutoCategory[] = [
  "DOC",
  "MINIFIED",
  "GENERATED",
  "BUILD_ARTIFACT",
];

const DEFAULT_AUTO_CONFIDENCE = 0.95;

interface ClassifiedDiff {
  diff: GitDiff;
  classification: Classification;
}

const classifyAll = (diffs: GitDiff[]): ClassifiedDiff[] =>
  diffs.map(diff => ({ diff, classification: classifyFile(diff.file) }));

const groupByEcosystem = (
  classified: ClassifiedDiff[],
  category: FileCategory
): Map<Ecosystem, GitDiff[]> => {
  const buckets = new Map<Ecosystem, GitDiff[]>();
  for (const entry of classified) {
    if (entry.classification.category !== category) continue;
    const eco = entry.classification.ecosystem;
    if (!eco) continue;
    const existing = buckets.get(eco);
    if (existing) existing.push(entry.diff);
    else buckets.set(eco, [entry.diff]);
  }
  return buckets;
};

export const preGroupDeterministicFiles = (
  diffs: GitDiff[]
): PreGroupingResult => {
  const classified = classifyAll(diffs);
  const autoGroups: CommitGroup[] = [];
  const handled = new Set<string>();

  const locksByEco = groupByEcosystem(classified, "LOCK");
  const manifestsByEco = groupByEcosystem(classified, "MANIFEST");

  // Pair lock+manifest by ecosystem so npm lockfiles aren't mixed with
  // Gemfile.lock in a single "Updated project dependencies" commit.
  for (const [eco, lockDiffs] of locksByEco) {
    const manifestDiffs = manifestsByEco.get(eco) ?? [];
    const files = [...manifestDiffs, ...lockDiffs].map(d => d.file);
    if (files.length === 0) continue;
    autoGroups.push({
      files,
      message: DETERMINISTIC_MESSAGES.LOCK,
      confidence: DEFAULT_AUTO_CONFIDENCE,
    });
    files.forEach(file => handled.add(file));
  }

  for (const category of SIMPLE_AUTO_CATEGORIES) {
    const files = classified
      .filter(c => c.classification.category === category)
      .map(c => c.diff.file)
      .filter(file => !handled.has(file));
    if (files.length === 0) continue;
    autoGroups.push({
      files,
      message: DETERMINISTIC_MESSAGES[category],
      confidence: DEFAULT_AUTO_CONFIDENCE,
    });
    files.forEach(file => handled.add(file));
  }

  const aiDiffs = diffs.filter(diff => !handled.has(diff.file));

  return { aiDiffs, autoGroups };
};
