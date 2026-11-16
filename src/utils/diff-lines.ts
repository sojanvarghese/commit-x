// Each input describes one file. Git puts file headers before the first hunk.
// Untracked files use headerless "+" lines and can start with "+++" themselves.
export const patchBody = (lines: string[]): string[] => {
  const firstHunk = lines.findIndex(line => line.startsWith("@@ "));
  if (firstHunk >= 0) return lines.slice(firstHunk);
  return lines[0]?.startsWith("diff --git ") ? [] : lines;
};

export const countChanges = (
  lines: readonly string[]
): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
};
