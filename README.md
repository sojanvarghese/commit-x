[![License](https://badgen.net/badge/license/MIT/blue)](https://opensource.org/licenses/MIT)
[![NPM Version](https://badgen.net/npm/v/@sojanvarghese/commit-x)](https://www.npmjs.com/package/@sojanvarghese/commit-x)
[![NPM Downloads](https://badgen.net/npm/dw/@sojanvarghese/commit-x)](https://www.npmjs.com/package/@sojanvarghese/commit-x)
[![Node.js](https://badgen.net/badge/node/20.0.0+/green)](https://nodejs.org/)
[![TypeScript](https://badgen.net/badge/TypeScript/5.9.2/blue)](https://www.typescriptlang.org/)
[![Yarn](https://badgen.net/badge/yarn/4.9.4+/blue)](https://yarnpkg.com/)
[![AI](https://badgen.net/badge/AI/Gemini/4285F4)](https://ai.google.dev/)
[![CLI](https://badgen.net/badge/CLI/Tool/green)](https://en.wikipedia.org/wiki/Command-line_interface)

> AI-powered Git commit assistant that intelligently analyzes your code changes and generates clear, concise, and context-aware commit messages using Google's Gemini AI.

## ✨ Features

- **Intelligent Grouping** - Automatically groups related file changes into logical commits
- **Smart Analysis** - Understands code changes and generates contextual commit messages
- **Intelligent Fallbacks** - Summary messages for large files, lock files, and build artifacts
- **Security-First** - Path validation, input sanitization, and secure API key handling
- **Fast & Reliable** - Optimized performance with retry logic and error recovery

## 🚀 Quick Start

### Prerequisites
- Node.js 20.0.0+
- [Gemini AI API key](https://aistudio.google.com/app/apikey)

### Installation

```bash
# Install globally from npm
npm install -g @sojanvarghese/commit-x
```

### Setup

```bash
# Interactive setup
cx setup

# Or set API key directly
export GEMINI_API_KEY="your_api_key_here"
```

### Usage

```bash
# Process files with AI-powered intelligent grouping (recommended)
cx

# Stage all files and commit together (also uses AI grouping)
cx commit --all

# Preview commits without executing
cx commit --dry-run
```

## 📖 Commands

| Command | Description |
|---------|-------------|
| `cx` | Process files with AI-powered intelligent grouping |
| `cx commit --all` | Stage all files and commit together (uses AI grouping) |
| `cx commit --dry-run` | Preview commits without executing |
| `cx commit -m "message"` | Use custom commit message |
| `cx commit --all --interactive` | Interactive mode for traditional workflow |
| `cx status` | Show repository status |
| `cx diff` | Show unstaged changes summary |
| `cx config` | View configuration |
| `cx config set <key> <value>` | Set configuration value |
| `cx config reset` | Reset configuration to defaults |
| `cx setup` | Interactive setup |
| `cx privacy` | Show privacy settings and data handling information |
| `cx debug` | Debug repository detection |
| `cx help-examples` | Show usage examples |

## ⚙️ Configuration

```bash
# View current configuration
cx config

# Set configuration values
cx config set model gemini-2.0-flash-lite

# Reset to defaults
cx config reset
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | - | Gemini AI API key (use environment variable) |
| `model` | string | `gemini-2.0-flash-lite` | AI model to use |

## Acknowledgments

- [Google Gemini AI](https://ai.google.dev/) for the AI capabilities
- [Simple Git](https://github.com/steveukx/git-js) for Git operations
- [Commander.js](https://github.com/tj/commander.js) for CLI interface
