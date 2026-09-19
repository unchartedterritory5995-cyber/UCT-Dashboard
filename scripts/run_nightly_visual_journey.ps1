# Boots a lightweight local backend+frontend, runs the full c0_visual_journey.py
# corpus pass against it, tears both down, and writes a dated report. Meant to be
# invoked by the "UCT Visual Journey Nightly" Task Scheduler job (Task 2), but is
# runnable by hand for manual verification (Task 3).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$env:ADMIN_EMAILS = "visualjourney@local.dev"
$env:WORKER_ENABLED = "0"
$env:CATALYST_ENGINE_ENABLED = "0"
$env:TWITTERAPI_IO_ENABLED = "0"
$env:BARS_PREWARM_DISABLED = "1"
$env:TICKER_NAMES_PREWARM_DISABLED = "1"
$env:C0_EMAIL = "gj_automation@local.dev"
$env:C0_PASSWORD = "OosTest2026!"

$backendPort = 18501
$frontendPort = 18500
$backendOk = $false
$frontendOk = $false
$exitCode = 1

$backendProc = Start-Process -PassThru -NoNewWindow `
    -FilePath "python" `
    -ArgumentList "-m", "uvicorn", "api.main:app", "--port", "$backendPort"

$frontendProc = Start-Process -PassThru -NoNewWindow `
    -WorkingDirectory "$repoRoot\app" `
    -FilePath "npm" `
    -ArgumentList "run", "dev", "--", "--port", "$frontendPort"

try {
    # Poll each server's own port rather than sleeping a fixed guess (a fixed
    # sleep is exactly the "sampling where a waiter was available" mistake this
    # repo's own CLAUDE.md warns about).
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$backendPort/api/health" -TimeoutSec 2 | Out-Null
            $backendOk = $true
            break
        } catch { Start-Sleep -Seconds 2 }
    }

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort" -TimeoutSec 2 | Out-Null
            $frontendOk = $true
            break
        } catch { Start-Sleep -Seconds 2 }
    }

    $reportPath = $null
    if ($backendOk -and $frontendOk) {
        $outDir = "tools/c0_out/$(Get-Date -Format 'yyyy-MM-dd')"
        python tools/c0_visual_journey.py `
            --base "http://127.0.0.1:$frontendPort" `
            --fixtures "tools/c0_oos_fixtures" `
            --out $outDir
        $exitCode = $LASTEXITCODE
        $reportPath = Join-Path $outDir "report.json"
    }
} finally {
    Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
}

$backendOkStr = if ($backendOk) { "true" } else { "false" }
$frontendOkStr = if ($frontendOk) { "true" } else { "false" }

$reportArgs = @(
    "scripts/nightly_visual_journey_report.py",
    "--exit-code", "$exitCode",
    "--backend-boot-ok", $backendOkStr,
    "--frontend-boot-ok", $frontendOkStr
)
if ($reportPath -and (Test-Path $reportPath)) {
    $reportArgs += @("--journey-report-path", $reportPath)
}
python @reportArgs

exit $exitCode
