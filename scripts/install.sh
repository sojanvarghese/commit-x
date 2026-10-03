#!/bin/bash

# Commit-X Installation Script
set -e

echo "🚀 Installing Commit-X - AI-Powered Git Commit Assistant"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 24+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 24 ]; then
    echo "❌ Node.js 24+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Use the package-manager version declared by the repository
corepack enable

if ! command -v yarn &> /dev/null; then
    echo "❌ Yarn is unavailable through Corepack."
    echo "   Visit: https://yarnpkg.com/getting-started/install"
    exit 1
fi

echo "✅ Yarn $(yarn --version) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies with Yarn..."
yarn install --immutable

# Build the project
echo ""
echo "🔧 Building TypeScript..."
yarn build

# Make CLI executable
echo ""
echo "🔗 Setting up CLI..."
chmod +x dist/cli.js

# Optionally link globally
echo ""
read -p "🌍 Link Commit-X globally? This allows you to use 'cx' from anywhere (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm link
    echo "✅ Commit-X linked globally"
    echo "   You can now use: cx"
else
    echo "ℹ️  To use Commit-X, run: yarn cx or node dist/cli.js"
fi

echo ""
echo "🔑 API Key Setup"
if [ -n "${GEMINI_API_KEY:-}" ]; then
    echo "✅ GEMINI_API_KEY is set"
else
    echo "⚠️  GEMINI_API_KEY is not set"
    echo "   Create a key at https://aistudio.google.com/app/apikey"
    echo "   Then set it in your shell: export GEMINI_API_KEY=your_api_key"
fi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "Next steps:"
echo "1. Get your Gemini API key: https://aistudio.google.com/app/apikey"
echo "2. Export GEMINI_API_KEY in your shell"
echo "3. Navigate to a git repository"
echo "4. Run: yarn commit (to start making AI-powered commits)"
echo ""
echo "Examples:"
echo "  yarn commit                 # Process files with AI"
echo "  yarn commit:dry             # Preview the commit plan"
echo ""
echo "Happy committing! 🚀"
