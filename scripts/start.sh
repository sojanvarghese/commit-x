#!/bin/bash

# Quick start script for development
echo "🚀 Starting Commitron in development mode..."

# Build and run
npm run build && node dist/cli.js "$@"
