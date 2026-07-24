[![License](https://badgen.net/badge/license/MIT/blue)](https://opensource.org/licenses/MIT)
[![NPM Version](https://badgen.net/npm/v/@sojanvarghese/commit-x)](https://www.npmjs.com/package/@sojanvarghese/commit-x)
[![NPM Downloads](https://badgen.net/npm/dw/@sojanvarghese/commit-x)](https://www.npmjs.com/package/@sojanvarghese/commit-x)
[![Node.js](https://badgen.net/badge/node/24.0.0+/green)](https://nodejs.org/)
[![TypeScript](https://badgen.net/badge/TypeScript/6.0.3/blue)](https://www.typescriptlang.org/)
[![Yarn](https://badgen.net/badge/yarn/4.13.0+/blue)](https://yarnpkg.com/)
[![AI](https://badgen.net/badge/AI/Gemini/4285F4)](https://ai.google.dev/)
[![CLI](https://badgen.net/badge/CLI/Tool/green)](https://en.wikipedia.org/wiki/Command-line_interface)

> AI-powered Git commit assistant that intelligently analyzes your code changes
> and generates clear, concise, and context-aware commit messages using Google's
> Gemini AI.

## ✨ Features

- **Intelligent grouping** — Groups related unstaged changes into multiple
  logical commits (default `cx` flow)
- **Smart analysis** — Gemini reads sanitized diffs; large diffs are compressed
  (additions prioritized over deletions past a size threshold)
- **Deterministic pre-grouping** — Lockfiles, manifests, docs, and similar files
  get sensible commits without overloading the model
- **Dropped-file recovery** — If the model omits paths from its JSON, a focused
  second pass retries those files before any minimal fallback
- **Structured output** — Gemini returns schema-constrained JSON using opaque
  file IDs and an explicit untrusted-diff boundary
- **Bounded batching** — Large file sets are chunked and processed with limited
  concurrency
- **Dynamic timeouts** — Timeouts scale with diff size, file count, and change
  volume
- **Security-first** — Privacy gate, strict path containment, cancellable AI
  calls, and an environment-only API key
- **Resilience** — Model fallback chain, retries, and optional `--use-cached` to
  reuse on-disk AI results when you want speed over freshness
- **Index-safe multi-commit flow** — Intelligent mode requires an empty index
  and restores the current group if a commit fails

## 🚀 Quick Start

### Prerequisites

- Node.js 24.0.0+
- [Gemini AI API key](https://aistudio.google.com/app/apikey)

### Installation

```bash
# Install globally from npm
npm install -g @sojanvarghese/commit-x
```

### Upgrading

If you already installed the CLI globally with npm, pull the latest published
version:

```bash
npm install -g @sojanvarghese/commit-x@latest
```

Check the installed version:

```bash
cx --version
```

### Setup

```bash
# Set the API key in your shell, then verify setup
export GEMINI_API_KEY="your_api_key_here"
cx setup
```

### Usage

```bash
# Default: AI groups unstaged changes into multiple commits (recommended)
cx

# Traditional workflow: stage everything (prompted), then one commit
# (AI suggests a single message from the staged diff unless you use -m)
cx commit --all

# Preview multi-commit AI plan without committing
cx commit --dry-run

# Reuse cached AI grouping from a previous run (default is always fresh)
cx commit --use-cached
```

## 📖 Commands

| Command                         | Description                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| `cx`                            | AI groups **unstaged** changes into multiple logical commits             |
| `cx commit --all`               | Traditional workflow: stage all (with confirmation), then **one** commit |
| `cx commit --dry-run`           | Show the AI commit plan without running `git commit`                     |
| `cx commit --use-cached`        | Reuse on-disk cached AI results (off by default)                         |
| `cx commit -m "message"`        | Traditional workflow with your message (skips AI message)                |
| `cx commit --all --interactive` | Traditional workflow with interactive message selection                  |
| `cx status`                     | Show repository status                                                   |
| `cx diff`                       | Show unstaged changes summary                                            |
| `cx config`                     | View configuration                                                       |
| `cx config get [key]`           | Show environment-based configuration; **never prints a raw API key**     |
| `cx setup`                      | Validate environment-based authentication                                |
| `cx privacy`                    | Show privacy settings and data handling information                      |
| `cx debug`                      | Debug repository detection                                               |
| `cx help-examples`              | Show usage examples                                                      |

## ⚙️ Configuration

```bash
# View current configuration
cx config
```

### Configuration options

Use the **`GEMINI_API_KEY`** environment variable for Gemini authentication.
Commit-X does not persist API keys. **`cx config get`** never prints the key in
plain text; it reports only whether one is set.

The model chain is chosen in code: `gemini-3.5-flash-lite` first for low latency
and cost, then `gemini-3.6-flash` if the primary model fails. Requests use JSON
Schema output, minimal thinking, bounded retries, and an abort signal.

### Privacy and cache behavior

Diff snippets, change counts, and file status leave the machine when Gemini is
called. Prompt metadata uses opaque IDs instead of repository paths, Git patch
headers are removed, high-confidence credential files are skipped, and other
detected sensitive values are redacted. Source code can still contain
identifying data that no pattern-based detector can guarantee to find; review
changes before using any hosted AI service.

Caching is off by default. `--use-cached` stores generated commit groups—not raw
diffs—under `~/.commit-x/cache` for up to seven days. Keys include the
repository, model, prompt version, and exact diff hashes; entries are validated
for complete file coverage and written atomically with owner-only permissions.

## Acknowledgments

- [Google Gemini AI](https://ai.google.dev/) for the AI capabilities
- [Simple Git](https://github.com/steveukx/git-js) for Git operations
- [Commander.js](https://github.com/tj/commander.js) for CLI interface
