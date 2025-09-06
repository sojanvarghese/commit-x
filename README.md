# CommitX

**CommitX** is your AI-powered Git commit assistant that intelligently analyzes your code changes and generates clear, concise, and context-aware commit messages — all with minimal effort. Powered by Gemini AI, CommitX helps you maintain a clean, professional, and meaningful Git history while saving time and boosting productivity.

---

## ✨ Features

- **🧠 Smart Diff Analysis**
  Automatically understands the nuances and intent behind your code changes.

- **🤖 Contextual AI Messaging**
  Generates human-like, relevant commit messages tailored to your project.

- **⚡ One-Command Commit & Push**
  Streamline your workflow with a single command to commit and push.

- **🎨 Customizable Prompts**
  Adjust commit message style to fit your team's conventions or personal preferences.

- **📋 Supports Conventional Commits**
  Keeps your Git history structured and easy to navigate.

- **🚀 Lightning-Fast Performance**
  Optimized to deliver results quickly, so you stay focused on coding.

---

## 📦 Installation

### Prerequisites

- Node.js 16.0.0 or higher
- Yarn package manager
- Git repository
- Gemini AI API key ([Get one here](https://makersuite.google.com/app/apikey))

### Quick Install

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/commit-x.git
   cd commit-x
   ```

2. **Run the installer:**
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

### Manual Install

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Build the project:**
   ```bash
   yarn build
   # or use: make build
   ```

3. **Link globally (optional):**
   ```bash
   yarn global add file:.
   ```

### Development Setup

```bash
# Quick setup
yarn install && yarn build

# Or use Makefile
make setup

# Development mode
yarn dev
# or: make dev

# Using start script
chmod +x start.sh
./start.sh
```

### Environment Setup

1. **Copy the environment example:**
   ```bash
   cp env.example .env
   ```

2. **Add your Gemini AI API key:**
   ```bash
   # Get your API key from: https://makersuite.google.com/app/apikey
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

---

## 🚀 Quick Start

1. **Run the interactive setup:**
   ```bash
   commit-x setup
   ```

2. **Navigate to your Git repository:**
   ```bash
   cd your-project
   ```

3. **Make some changes and stage them:**
   ```bash
   git add .
   ```

4. **Generate and commit with AI:**
   ```bash
   commit-x
   # or
   cx commit
   ```

---

## 💻 Usage

### Basic Commands

```bash
# 🆕 Individual file processing (DEFAULT behavior)
commit-x                        # Process each file individually
commit-x commit                 # Same as above
cx c                            # Short alias

# Traditional workflow (all files together)
commit-x commit --all           # Stage all files and commit together
commit-x commit --all --push    # Stage all, commit, and push

# Custom message (uses traditional workflow)
commit-x commit -m "fix: resolve authentication bug"

# Preview without committing
commit-x commit --dry-run       # Preview individual commits
commit-x commit --all --dry-run # Preview traditional commit

# Repository information
commit-x status                 # Show repository status
commit-x diff                   # Show changes summary
cx s                            # Status alias
cx d                            # Diff alias
```

### Configuration

```bash
# Interactive setup
commit-x setup

# Set configuration values
commit-x config set style conventional
commit-x config set maxLength 50
commit-x config set autoPush true

# View configuration
commit-x config get
commit-x config get apiKey

# Reset to defaults
commit-x config reset
```

### Advanced Usage

```bash
# Non-interactive mode (useful for scripts)
commit-x commit --no-interactive

# Help and examples
commit-x --help
commit-x help-examples
```

---

## ⚙️ Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | - | Gemini AI API key |
| `model` | string | `gemini-1.5-flash` | AI model to use |
| `style` | string | `conventional` | Commit message style (`conventional`, `descriptive`, `minimal`) |
| `maxLength` | number | `72` | Maximum commit message length |
| `includeFiles` | boolean | `true` | Include file diffs in AI analysis |
| `autoCommit` | boolean | `false` | Auto-commit without confirmation |
| `autoPush` | boolean | `false` | Auto-push after committing |
| `customPrompt` | string | - | Custom AI prompt template |

### Configuration File Location

CommitX stores its configuration in:
- **macOS/Linux:** `~/.commit-x/config.json`
- **Windows:** `%USERPROFILE%\.commit-x\config.json`

---

## 🎨 Commit Message Styles & Best Practices

CommitX follows industry best practices for commit messages:

### ✅ **Best Practices Enforced:**
- **🔠 Capital Letters**: All messages start with capital letters (e.g., "Added", "Fixed", "Updated")
- **📝 Past Tense**: All messages use past tense (e.g., "Added", "Fixed", "Updated")
- **🔍 Meaningful Descriptions**: Specific, contextual messages avoiding generic terms
- **⚛️ Atomic Commits**: Each commit represents a single logical change
- **🎭 E2E Testing**: Smart detection of Playwright tests, POMs, fixtures, and specs
- **📏 Proper Length**: First line kept under 72 characters

### Conventional Commits (Recommended)
```
feat(auth): Added OAuth2 integration with Google provider
fix(api): Resolved null pointer exception in user validation
e2e(playwright): Added page object model for login flow
e2e(spec): Updated E2E test assertions for checkout process
docs(readme): Updated installation instructions for clarity
refactor(utils): Extracted validation logic into separate module
```

### Descriptive
```
Added OAuth2 integration for user authentication
Fixed memory leak in event listener cleanup
Added E2E test spec for user registration flow
Updated page object model with new login selectors
Updated installation instructions with detailed steps
Refactored user authentication to use JWT tokens
```

### Minimal
```
Added OAuth2 support
Fixed login validation
Added E2E tests
Updated page objects
Updated documentation
Refactored auth module
```

### ❌ **What CommitX Avoids:**
- Generic messages like "updated files" or "fixed bug"
- Present tense verbs ("add", "fix", "update")
- Lowercase starting letters ("added" instead of "Added")
- Vague descriptions without context
- Overly long commit messages

### 🎭 **E2E Testing & Playwright Support:**
CommitX intelligently detects Playwright patterns and generates appropriate commit messages:
- **Page Object Models (POMs)**: Files with `.page.` or containing "pageobject"
- **Test Specs**: Files with `.spec.` or `.test.` in E2E directories
- **Fixtures**: Test data and setup files containing "fixture" or "setup"
- **Config Files**: `playwright.config.ts` and test configuration files
- **Utilities**: Test helpers and common utilities

**Example E2E Commit Messages:**
```
e2e(login): Added page object model for login flow
e2e(checkout): Updated E2E test assertions for payment process
e2e(fixture): Added test data fixtures for user registration
e2e(config): Updated Playwright configuration for CI environment
```

---

## 🔥 Individual File Processing

**NEW:** CommitX now processes files individually by default, creating focused commits for each file!

### How It Works

1. **Analyzes each changed file separately**
2. **Stages one file at a time**
3. **Generates specific commit message for each file**
4. **Creates individual commits**
5. **Repeats for all changed files**

### Benefits

- ✅ **Focused commits**: Each commit addresses a single file/concern
- ✅ **Better Git history**: Easier to track, review, and revert changes
- ✅ **Granular control**: Skip files you don't want to commit
- ✅ **Parallel development**: Team members can work on different files without conflicts

### Example Workflow

```bash
# You have 3 files changed: auth.ts, api.ts, styles.css
commit-x

# CommitX will process each file:
# 📄 Processing: src/auth.ts
# ✅ Committed: feat(auth): add OAuth2 integration

# 📄 Processing: src/api.ts
# ✅ Committed: fix(api): handle null response errors

# 📄 Processing: styles.css
# ✅ Committed: style: update button hover effects

# Result: 3 focused commits instead of 1 large commit
```

### Interactive Mode

For each file, you can:
- **Choose from AI-generated suggestions**
- **Write a custom commit message**
- **Skip the file** (leave it unstaged)
- **Cancel the entire process**

---

## 📝 Examples

### Basic Workflow
```bash
# 1. Make changes to your code
echo "console.log('Hello World');" > hello.js

# 2. Stage changes
git add hello.js

# 3. Generate AI commit message
commit-x commit
# CommitX will analyze the changes and suggest:
# "feat: add hello world console output"

# 4. Choose from suggestions or write custom message
# 5. Commit is created automatically
```

### Team Workflow
```bash
# Set team conventions
commit-x config set style conventional
commit-x config set maxLength 50

# Work with confidence knowing all commits follow the same format
commit-x commit --push
```

---

## 🛠️ Development

### Build from Source

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Run in development mode
yarn dev

# Run tests
yarn test

# Lint code
yarn lint

# Format code
yarn format
```

### Project Structure

```
commit-x/
├── src/
│   ├── core/           # Main CommitX class
│   ├── services/       # Git and AI services
│   ├── config/         # Configuration management
│   ├── types/          # TypeScript type definitions
│   ├── cli.ts          # CLI interface
│   └── index.ts        # Main entry point
├── dist/               # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`commit-x commit`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Gemini AI](https://ai.google.dev/) for powerful language model capabilities
- [Conventional Commits](https://conventionalcommits.org/) for commit message standards
- The open-source community for inspiration and tools

---

## 📞 Support

- 🐛 [Report Bugs](https://github.com/yourusername/commit-x/issues)
- 💬 [Discussions](https://github.com/yourusername/commit-x/discussions)
- 📧 [Email Support](mailto:support@commit-x.dev)

---

**Made with ❤️ by developers, for developers.**
