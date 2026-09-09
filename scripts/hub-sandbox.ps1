# hub-sandbox.ps1 - boot the app for joystick-hub device testing, against a SANDBOX data dir.
# See docs/plans/joystick/00-master-spec-v1.5.md and docs/plans/joystick/40-phase2-device.md.
#
# This script builds the frontend and then hands off to scripts/hub_sandbox_boot.py,
# which owns ALL environment sandboxing. Read that file's header before changing
# anything here.
#
# WHY THE ENV VARS ARE NOT IN THIS FILE ANY MORE.
#
# They were, and the list was wrong in a way that reached production. This script
# set DATA_DIR and nothing else, on the assumption that DATA_DIR is what points
# the app at its data. It is not: 72 separate environment variables name paths
# inside the shared data root, and they resolve INDEPENDENTLY of DATA_DIR. The
# first sandbox boot wrote to the live C:\data\auth.db, desk.db, flow.db and
# buzz.db while printing a clean startup.
#
# The Python launcher derives that list of 72 by AST from api/** (via the same
# census the pytest suite uses) instead of restating it, and arms a tripwire that
# RAISES on any write into C:\data. A hand-typed list here would be a second
# authority over one value, which is exactly the defect that caused the incident.
#
# The DATA_DIR refusal below is kept as defence in depth. The launcher performs
# the same check, against roots it derives rather than roots typed by hand.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1
#         powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1 -SkipBuild

param(
    [string]$DataDir = 'C:\data-hubtest',
    [string]$TestEmail = 'hubtest@local.dev',
    [int]$Port = 8077,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# -- GUARD (defence in depth; the launcher checks this too) --------------------
# Refuse the shared data root, in every spelling. Checked BEFORE anything is set,
# created or built.
$resolved = $DataDir.TrimEnd('\', '/')
$forbidden = @('C:\data', 'c:\data', 'C:/data', '/data', '\data')
$isForbidden = $false
foreach ($f in $forbidden) {
    if ($resolved -ieq $f.TrimEnd('\', '/')) { $isForbidden = $true }
}
# Also catch a bare drive-root spelling like "C:\Data\" or a UNC pointing at the same place.
if ($resolved -imatch '^[A-Za-z]:[\\/]data$' -or $resolved -imatch '^[\\/]data$') { $isForbidden = $true }

if ($isForbidden) {
    Write-Host ''
    Write-Host '  REFUSING TO RUN.' -ForegroundColor Red
    Write-Host ''
    Write-Host "  DATA_DIR resolved to '$DataDir', which is the SHARED DATA ROOT." -ForegroundColor Red
    Write-Host '  That directory holds the live auth database and every production SQLite file on'
    Write-Host '  this machine. A test run against it does not fail loudly - it succeeds against'
    Write-Host '  real member data, which is worse.'
    Write-Host ''
    Write-Host '  Pass a sandbox path instead, e.g.:' -ForegroundColor Yellow
    Write-Host '      .\scripts\hub-sandbox.ps1 -DataDir C:\data-hubtest'
    Write-Host ''
    exit 1
}

# -- Build ---------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host ''
    Write-Host '  Building the frontend (the backend serves app/dist, so this must run after any UI change)...' -ForegroundColor Cyan
    Push-Location (Join-Path $repoRoot 'app')
    try {
        if (-not (Test-Path 'node_modules')) {
            Write-Host '  node_modules missing - running npm ci first.' -ForegroundColor Yellow
            npm ci
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
}

# -- Hand off to the launcher --------------------------------------------------
Write-Host ''
Write-Host '  Handing off to scripts/hub_sandbox_boot.py (it owns all env sandboxing).' -ForegroundColor Cyan
Write-Host '  Next: start BrowserStack Local, then follow docs/plans/joystick/40-phase2-device.md.' -ForegroundColor Cyan
Write-Host ''

Push-Location $repoRoot
try {
    python scripts/hub_sandbox_boot.py --data-dir $DataDir --test-email $TestEmail --port $Port
} finally { Pop-Location }
