# hub-sandbox.ps1 — boot the app for joystick-hub device testing, against a SANDBOX data dir.
# See docs/plans/joystick/00-master-spec-v1.4.md and docs/plans/joystick/40-phase2-device.md.
#
# ⛔ WHY THIS SCRIPT EXISTS INSTEAD OF A LIST OF ENV VARS IN A DOC.
#
# Two hazards, both of which have already cost this project real incidents:
#
#   1. `C:\data` IS REAL ON THIS MACHINE. Every product path that resolves to `/data` resolves to
#      the owner's LIVE files — that is how `C:\data\auth.db` grew to ~1 GB of real members, and how
#      a stray daemon thread wrote into the live screener DB. A device-testing run that forgets one
#      env var does not fail; it succeeds against production data. So the FIRST thing this script
#      does is refuse to run if DATA_DIR would resolve to the shared root.
#
#   2. THIS APP'S ENV VARS ARM SCHEDULERS. Booting it with production-shaped config posts to a
#      ~750-member Discord channel, publishes to YouTube, and emails members via Resend. The
#      kill-list below is not defensive tidiness — every entry is a live outbound channel.
#
# ⭐ Webhooks are BLANKED, never left unset. An unset webhook var and an intentionally-disabled one
# are indistinguishable to a reader, and code that treats "missing" as "use the default" would then
# reach the real channel. Blank is an explicit statement.
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

# ── GUARD ─────────────────────────────────────────────────────────────────────
# Refuse the shared data root, in every spelling. Checked BEFORE anything is set, created or built.
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
    Write-Host '  this machine. A test run against it does not fail loudly — it succeeds against'
    Write-Host '  real member data, which is worse.'
    Write-Host ''
    Write-Host '  Pass a sandbox path instead, e.g.:' -ForegroundColor Yellow
    Write-Host '      .\scripts\hub-sandbox.ps1 -DataDir C:\data-hubtest'
    Write-Host ''
    exit 1
}

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Write-Host "  Created sandbox data dir: $DataDir" -ForegroundColor Green
}

# ── Seed a synthetic wire_data.json ───────────────────────────────────────────
# Without it, Dashboard / Morning Wire / Breadth render empty and there is nothing for the device
# script's Home, Wire and Breadth steps to act on. This fixture is SYNTHETIC and obviously so —
# it must never be mistaken for a production snapshot.
$fixture = Join-Path $repoRoot 'scripts\fixtures\wire_data.sample.json'
$target = Join-Path $DataDir 'wire_data.json'
if ((Test-Path $fixture) -and -not (Test-Path $target)) {
    Copy-Item $fixture $target
    Write-Host "  Seeded synthetic wire_data.json -> $target" -ForegroundColor Green
}

# ── The kill-list ─────────────────────────────────────────────────────────────
# Ordered: sandbox identity first, then every automation that can reach the outside world.
$flags = [ordered]@{
    # Identity / sandboxing
    'DATA_DIR'                     = $DataDir
    'ADMIN_EMAILS'                 = $TestEmail
    'PUSH_SECRET'                  = 'hub-sandbox-local-only-not-the-real-secret'

    # Background workers — none of them belong in a device-test boot
    'WORKER_ENABLED'               = '0'
    'FLOW_WORKER_ENABLED'          = '0'
    'BARS_API_ENABLED'             = '0'

    # Automations that SEND (Discord / YouTube / email / member alerts)
    'CATALYST_ENGINE_ENABLED'      = '0'
    'CATALYST_ALERTS_ENABLED'      = '0'
    'BUZZ_DIGEST_ENABLED'          = '0'
    'DESK_DAILY_SESSION_ENABLED'   = '0'
    'DESK_TSDR_ANNOUNCE_ENABLED'   = '0'
    'DESK_SESSION_AUDIT_ENABLED'   = '0'
    'COMPASS_AUTOMATION_ENABLED'   = '0'
    'AWARENESS_ENGINE_ENABLED'     = '0'
    'CALENDAR_ALERTS_ENABLED'      = '0'
    'DOWN_ALERT_ENABLED'           = '0'

    # Scheduled compute that writes shared state
    'SCAN_SWEEP_ENABLED'           = '0'
    'BROKER_SYNC_ENABLED'          = '0'
    'NOTE_SYNC_ENABLED'            = '0'
    'THEME_ENGINE_ENABLED'         = '0'
    'RECONCILE_ENABLED'            = '0'
    'COT_PREWARM_ENABLED'          = '0'
    'FUNDAMENTALS_MONITOR_ENABLED' = '0'
    'TWITTERAPI_IO_ENABLED'        = '0'

    # Prewarmers — they hammer providers for thousands of tickers we do not need
    'BARS_PREWARM_DISABLED'        = '1'
    'TICKER_NAMES_PREWARM_DISABLED' = '1'

    # Outbound channels — BLANKED, not unset (see the header note)
    'DISCORD_WEBHOOK_URL'          = ''
    'DISCORD_TSDR_WEBHOOK_URL'     = ''
    'COT_WEEKLY_DISCORD_WEBHOOK_URL' = ''
    'BUZZ_DIGEST_CHANNEL'          = ''

    # R2 / shared object storage — blank kills the capability, not just one door
    'DATA_SYNC_ACCESS_KEY'         = ''
    'DATA_SYNC_SECRET_KEY'         = ''
    'DATA_SYNC_BUCKET'             = ''
    'DATA_SYNC_ENDPOINT'           = ''
}

foreach ($k in $flags.Keys) { Set-Item -Path "env:$k" -Value $flags[$k] }

# ── Build ─────────────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host ''
    Write-Host '  Building the frontend (the backend serves app/dist, so this must run after any UI change)...' -ForegroundColor Cyan
    Push-Location (Join-Path $repoRoot 'app')
    try {
        if (-not (Test-Path 'node_modules')) {
            Write-Host '  node_modules missing — running npm ci first.' -ForegroundColor Yellow
            npm ci
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
}

# ── The eyeball line ──────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ─────────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host '  HUB SANDBOX — every flag this run set:' -ForegroundColor Cyan
foreach ($k in $flags.Keys) {
    $v = $flags[$k]
    $shown = if ($v -eq '') { '(blank)' } else { $v }
    $colour = if ($v -eq '' -or $v -eq '0') { 'DarkGray' } else { 'White' }
    Write-Host ("    {0,-32} {1}" -f $k, $shown) -ForegroundColor $colour
}
Write-Host '  ─────────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host ''
Write-Host "  Data dir : $DataDir   (NOT the shared root — verified above)" -ForegroundColor Green
Write-Host "  Admin    : $TestEmail  (sign up with this address to mint the admin)" -ForegroundColor Green
Write-Host "  URL      : http://localhost:$Port" -ForegroundColor Green
Write-Host ''
Write-Host '  Next: start BrowserStack Local, then follow docs/plans/joystick/40-phase2-device.md.' -ForegroundColor Cyan
Write-Host ''

Push-Location $repoRoot
try {
    python -m uvicorn api.main:app --host 0.0.0.0 --port $Port
} finally { Pop-Location }
