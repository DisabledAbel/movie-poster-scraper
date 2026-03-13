$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required (v18+)."
}

if (-not (Test-Path ".env.local")) {
  Write-Error " .env.local not found. Create it with FIRECRAWL_API_KEY=your_key_here"
}

$envFile = Get-Content ".env.local"
if (-not ($envFile -match '^FIRECRAWL_API_KEY=')) {
  Write-Error "FIRECRAWL_API_KEY is missing in .env.local"
}

Write-Host "Starting local dev server on http://localhost:3000"
npx vercel dev --listen 3000
