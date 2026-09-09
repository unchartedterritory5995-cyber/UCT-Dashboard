# run-phase2.ps1 - the joystick-hub Phase 2 device gate, end to end.
#
# Order matters and is not negotiable:
#
#   1. SNAPSHOT the shared data root (content hash of every main .db)
#   2. verify the sandbox is serving
#   3. bring up the BrowserStack Local tunnel
#   4. run the four-device suite
#   5. RE-COMPARE the shared data root, and refuse to report results if it moved
#
# Step 5 is why step 1 exists. "Reports clean" is never evidence of "wrote
# nowhere": the boot that started all this printed a clean startup and a healthy
# /api/health while writing to the live auth.db. A device result gathered during
# a run that touched production is not a result, it is a liability - so the
# compare gates the REPORT, not just the log.
#
# The BrowserStack binary and the node suite are OPERATOR TOOLING on this
# machine (C:\tools\...), deliberately not repo dependencies: they appear in no
# package.json and no requirements.txt. This orchestrator lives in the repo so
# the procedure is reviewable and versioned; the tools it drives do not.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\run-phase2.ps1
#         powershell -ExecutionPolicy Bypass -File scripts\run-phase2.ps1 -Device iphone-15-pro

param(
    [string]$Device = '',
    [int]$Port = 8077,
    [string]$ToolsDir = 'C:\tools\hub-devicetests'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$runLog = Join-Path $repoRoot "docs\plans\joystick\sandbox-runs\$stamp-devicerun.md"
$baseline = Join-Path $env:TEMP "phase2_baseline_$stamp.json"

function Fail($msg) {
    Write-Host ''
    Write-Host "  ABORTING: $msg" -ForegroundColor Red
    Write-Host ''
    exit 1
}

# -- 0. Credentials ------------------------------------------------------------
# Stored at USER scope, which a process started BEFORE they were set does not
# inherit. Read them from the registry into this process only.
# The tunnel script already does exactly this; doing it in one place and not the
# other is what made the first run fail after the tunnel had come up fine.
# NEVER printed, logged, echoed or committed - only their presence is reported.
foreach ($name in @('BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        $v = [Environment]::GetEnvironmentVariable($name, 'User')
        if (-not $v) { Fail "$name is not set at User or Process scope." }
        Set-Item -Path "env:$name" -Value $v
    }
    Write-Host "        $name : present" -ForegroundColor DarkGray
}

# -- 1. Baseline ---------------------------------------------------------------
Write-Host ''
Write-Host '  [1/5] Hashing the shared data root (this is the FIRST thing reported).' -ForegroundColor Cyan
python (Join-Path $repoRoot 'scripts\data_root_snapshot.py') --snapshot $baseline --log $runLog --label 'pre-suite'
if ($LASTEXITCODE -ne 0) { Fail 'could not take a data-root baseline' }

# -- 2. Sandbox must already be serving ---------------------------------------
Write-Host ''
Write-Host '  [2/5] Checking the sandbox is up.' -ForegroundColor Cyan
try {
    $health = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "        /api/health -> $($health.StatusCode)" -ForegroundColor Green
} catch {
    Fail "the sandbox is not serving on port $Port. Start it first: .\scripts\hub-sandbox.ps1"
}

# -- 3. Tunnel -----------------------------------------------------------------
Write-Host ''
Write-Host '  [3/5] Bringing up the BrowserStack Local tunnel.' -ForegroundColor Cyan
& (Join-Path $ToolsDir 'start-tunnel.ps1') -Port $Port
if ($LASTEXITCODE -ne 0) { Fail 'the BrowserStack Local tunnel did not come up' }

# -- 4. The suite --------------------------------------------------------------
Write-Host ''
Write-Host '  [4/5] Running the device suite.' -ForegroundColor Cyan
Push-Location $ToolsDir
try {
    if ($Device) { node tests/run.js $Device } else { node tests/run.js }
    $suiteExit = $LASTEXITCODE
} finally { Pop-Location }

# -- 5. The compare that gates the report --------------------------------------
Write-Host ''
Write-Host '  [5/5] Re-hashing the shared data root.' -ForegroundColor Cyan
python (Join-Path $repoRoot 'scripts\data_root_snapshot.py') --compare $baseline --log $runLog --label 'post-suite'
$compareExit = $LASTEXITCODE

Write-Host ''
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
if ($compareExit -ne 0) {
    Write-Host '  THE SHARED DATA ROOT CHANGED DURING THIS RUN.' -ForegroundColor Red
    Write-Host '  Do NOT record these device results. Investigate the diff above'
    Write-Host "  and in $runLog first."
    exit 2
}
Write-Host '  Shared data root CLEAN across the whole run.' -ForegroundColor Green
Write-Host "  Integrity log : $runLog"
Write-Host "  Raw results   : $ToolsDir\results\*.json"
if ($suiteExit -ne 0) {
    Write-Host '  Suite: FAILING STEPS PRESENT - record them as failures, do not retry blind.' -ForegroundColor Yellow
} else {
    Write-Host '  Suite: all steps passed.' -ForegroundColor Green
}
Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
exit $suiteExit
