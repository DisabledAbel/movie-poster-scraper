#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required (v18+)."
  exit 1
fi

if [[ ! -f .env.local ]]; then
  echo "Error: .env.local not found."
  echo "Create it with: FIRECRAWL_API_KEY=your_key_here"
  exit 1
fi

if ! grep -q '^FIRECRAWL_API_KEY=' .env.local; then
  echo "Error: FIRECRAWL_API_KEY is missing in .env.local"
  exit 1
fi

echo "Starting local dev server on http://localhost:3000"
exec npx vercel dev --listen 3000
