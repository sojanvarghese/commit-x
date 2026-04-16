# Commit-X Refactor & Improvement Design

**Date:** 2026-04-16
**Scope:** AI commit-generation pipeline
**Approach:** B (Structural — full-repo sweep)

## Goals

1. **File filtering** — auto-group lock files, docs, minified, generated, build artifacts into deterministic commits without AI call.
2. **Large-diff minimization** — when diff > 250 changed lines, force aggressive compression (strip imports, comments, whitespace) regardless of byte budget.
3. **Fresh-by-default commits** — skip AI result cache + request deduplication unless `--use-cached` is passed.
4. **Privacy enforcement** — single choke point (`enforcePrivacyGate`) ensures no AI call bypasses sanitization. No new patterns (existing layer covers API keys, tokens, secrets, personal data, .env files).
5. **No model prompt** — already satisfied; `AI_DEFAULT_MODEL` → fallback chain used deterministically. Documented only.
6. **Prompt clarity** — rewrite `buildAggregatedPrompt` with labeled sections, explicit forbidden prefix list, explicit confidence range, stricter output schema. Same length.
7. **Refactor** — split every file > 500 LOC into focused modules ≤ 300 LOC. Target files: `services/ai.ts` (681), `services/git.ts` (658), `core/commitx.ts` (535), `cli.ts` (525).
8. **Dead code** — full `src/` sweep via `ts-prune` + manual audit. Verify every removal with build + tests.

## Architecture

```
src/
├── cli.ts                         # program wiring only
├── cli/commands/                  # one file per subcommand
├── core/
│   ├── commitx.ts                 # public CLI entry
│   └── commit-orchestrator.ts     # batch/group loop
├── services/
│   ├── ai.ts                      # AIService orchestration only
│   ├── ai-prompt.ts               # buildAggregatedPrompt + parser
│   ├── ai-commit-group.ts         # classifier-driven pre-grouping
│   ├── ai-privacy-gate.ts         # single enforcement point
│   ├── git.ts                     # public GitService API
│   ├── git-diff-builder.ts        # buildFileDiff
│   └── git-cache.ts               # GitCache TTL wrapper
├── utils/
│   ├── file-classifier.ts         # NEW: 7 categories, deterministic messages
│   ├── diff-minimizer.ts          # NEW: compression tiers + 250-LOC threshold
│   ├── ai-cache.ts                # PersistentAICache only
│   └── request-batcher.ts         # NEW: RequestBatcher extracted
```

## File Classifier Categories

| Category | Match | Auto-message |
|---|---|---|
| `LOCK` | `*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `bun.lockb`, `go.sum` | "Updated project dependencies" |
| `DOC` | README/LICENSE/CHANGELOG/CONTRIBUTING/CODE_OF_CONDUCT (any extension) | "Updated documentation" |
| `MINIFIED` | `.min.js`, `.min.css`, `.min.mjs`, `.map` | "Rebuilt minified assets" |
| `GENERATED` | `.generated.*`, `.g.ts`, `.pb.go`, `*_pb.js` | "Regenerated derived files" |
| `BUILD_ARTIFACT` | path contains `dist/build/out/.next/target/_build` | "Rebuilt project artifacts" |
| `MANIFEST` | `package.json`/`Gemfile`/`Cargo.toml`/etc | grouped with LOCK if paired |
| `REGULAR` | everything else | sent to AI |

## Cache Flag Semantics

- Default: skip `aiCache.get`, skip `aiCache.set`, skip `requestBatcher.batch`
- `--use-cached`: all three enabled

## Large-Diff Threshold

- `countDiffLines(diff.changes) > 250` → skip Tier 0 (as-is), start at Tier 2 (strip boilerplate)

## Prompt Rewrite

Sections: Task / Output / Rules / Files. Explicit forbidden-prefix list, explicit confidence range (0.5-0.95), explicit "ONLY JSON, no prose, no markdown fence".

## Non-Breaking Changes

- Config schema unchanged
- Cache dir unchanged (`~/.commitx/cache`)
- CLI output format unchanged
- New flag: `--use-cached` (opt-in)
- Default behavior changes: fresh messages every run (was cached)

## Testing

- `file-classifier.test.mjs` — 7 categories + edge cases
- `diff-minimizer.test.mjs` — threshold + tier boundaries
- `ai-privacy-gate.test.mjs` — sensitive blocking
- `cache-flag.test.mjs` — useCached on/off paths
- Existing `runtime-optimizations.test.mjs` — updated to new module paths
