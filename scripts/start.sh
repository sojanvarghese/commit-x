#!/bin/bash

# Quick start script for development
echo "🚀 Starting Commit-X in development mode..."

# Build and run
yarn build && node dist/cli.js "$@"
