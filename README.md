# Commitron

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![version](https://img.shields.io/npm/v/commitron.svg)](https://www.npmjs.com/package/commitron)
[![downloads](https://img.shields.io/npm/dm/commitron.svg)](https://www.npmjs.com/package/commitron)
[![Node.js](https://img.shields.io/node/v/commitron.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)


> AI-powered Git commit assistant that intelligently analyzes your code changes and generates clear, concise, and context-aware commit messages using Google's Gemini AI.

## ✨ Features

- 🤖 **Smart Analysis** - Automatically understands code changes and generates contextual commit messages
- 📝 **Multiple Workflows** - Batch processing for optimal performance or traditional commits
- 🎯 **Intelligent Fallbacks** - Summary messages for large files, lock files, and build artifacts
- 🔧 **Interactive Mode** - Choose from AI-generated suggestions or write custom messages
- 🔒 **Security-First** - Path validation, input sanitization, and secure API key handling
- ⚡ **Fast & Reliable** - Optimized performance with retry logic and error recovery

## 🚀 Quick Start

### Prerequisites
- Node.js 20.0.0+
- Git repository
- [Gemini AI API key](https://makersuite.google.com/app/apikey)

### Installation

```bash
# Install globally from npm
npm install -g commitron
```

### Setup

```bash
# Interactive setup
cx setup

# Or set API key directly
export GEMINI_API_KEY="your_api_key_here"
```

### Uninstall

```bash
# Remove the package
npm uninstall -g commitron
```

### Usage

```bash
# Process files with AI (recommended)
cx

# Traditional workflow
cx commit --all

# Preview changes
cx commit --dry-run
```

## 📖 Commands

| Command | Description |
|---------|-------------|
| `cx` | Process files with AI |
| `cx commit --all` | Stage all files and commit together |
| `cx commit --dry-run` | Preview commits without executing |
| `cx commit -m "message"` | Use custom commit message |
| `cx status` | Show repository status |
| `cx diff` | Show unstaged changes summary |
| `cx config` | View configuration |
| `cx config set <key> <value>` | Set configuration value |
| `cx config reset` | Reset configuration to defaults |
| `cx setup` | Interactive setup |
| `cx privacy` | Show privacy information |
| `cx debug` | Debug repository detection |
| `cx help-examples` | Show usage examples |

### Command Options

#### Commit Command Options
- `--all` - Stage all files and commit together (traditional workflow)
- `--dry-run` - Show what would be committed without actually committing
- `--interactive` - Use interactive mode (for traditional workflow only)
- `-m, --message <message>` - Use provided commit message instead of generating one

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


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Google Gemini AI](https://ai.google.dev/) for the AI capabilities
- [Simple Git](https://github.com/steveukx/git-js) for Git operations
- [Commander.js](https://github.com/tj/commander.js) for CLI interface
