# run-local.ps1 — start the UCT Dashboard locally for fast UI iteration.
#
#   Right-click → "Run with PowerShell", or from a terminal:  .\run-local.ps1
#
# Opens two windows:
#   • Backend  — FastAPI on http://localhost:8000 (heavy background jobs OFF)
#   • Frontend — Vite dev server with hot-reload on http://localhost:5173
#
# Edit a file in app/src and the browser updates instantly. When it looks
# right, commit + push to deploy to Railway (production).
#
# First account you sign up with becomes an admin automatically (ADMIN_EMAILS),
# so you can see every page + admin tools without email verification.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py   = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Host "Python venv not found at $py" -ForegroundColor Red
  Write-Host "Run once:  C:\Users\blake\AppData\Local\Programs\Python\Python312\python.exe -m venv .venv ; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
  exit 1
}
if (-not (Test-Path "C:\data")) { New-Item -ItemType Directory "C:\data" | Out-Null }

# Backend — port 8000 (the port app/vite.config.js proxies /api to).
$backend = @"
`$env:WORKER_ENABLED='0'
`$env:CATALYST_ENGINE_ENABLED='0'
`$env:TWITTERAPI_IO_ENABLED='0'
`$env:BARS_PREWARM_DISABLED='1'
`$env:TICKER_NAMES_PREWARM_DISABLED='1'
`$env:COT_SEED_DISABLED='1'
`$env:ADMIN_EMAILS='dev@local.dev'
Set-Location '$root'
Write-Host 'UCT backend → http://localhost:8000' -ForegroundColor Cyan
& '$py' -m uvicorn api.main:app --reload --port 8000
"@

# Frontend — Vite dev server (hot-reload), proxies /api to the backend.
$frontend = @"
Set-Location '$root\app'
Write-Host 'UCT frontend → http://localhost:5173' -ForegroundColor Green
npm run dev
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backend
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontend

Write-Host ""
Write-Host "Starting two windows…" -ForegroundColor Yellow
Write-Host "  Backend:  http://localhost:8000   (API)"
Write-Host "  Frontend: http://localhost:5173   ← open THIS in your browser"
Write-Host ""
Write-Host "Edit anything under app/src and the browser reloads instantly."
Write-Host "Close either window to stop that server."
