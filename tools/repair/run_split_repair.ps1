# Repair the split-rescale damage via the documented operator workflow:
#   POST /api/admin/refresh-bars/{T}?tf=X  -> wipes SQLite + disk + memory + the
#                                             histfull_ deep-history marker
#   GET  /api/bars/{T}?tf=X&bars=5000      -> repopulates from upstream, deep
#
# ASCII ONLY IN THIS FILE. Windows PowerShell 5.1 reads it as cp1252, so a stray
# em-dash or emoji becomes mojibake that can contain a quote character and break the
# parse. That is exactly how the first version of this script failed.
#
# ---------------------------------------------------------------------------
# THE YFINANCE BREAKER IS THE WHOLE SAFETY STORY. Read this before editing.
#
# Run 1 of this script deleted BF-A's 5000 daily rows and got 1 bar back. The
# refetch was not broken -- the script had broken it. Each deep refetch pulls
# yfinance period="max", 58 of them in a row rate-limited the account, and the
# pod's circuit breaker opened. With yfinance suppressed the deep fetch falls back
# to Massive alone, and Massive does not carry BF-A's pre-2003 tail. So the wipe
# destroyed history that the refetch could no longer restore.
#
# A destructive step whose repair path depends on a rate-limited external provider
# MUST check that provider first. The abort caught the damage after one ticker,
# which is why this is a recoverable story instead of 28 emptied charts -- but an
# abort is a net, not a guard. These are the guards:
#   1. Pre-flight: refuse to start with the breaker open.
#   2. Per-ticker: re-check, and WAIT OUT the cooldown rather than wiping blind.
#   3. Pace: a deliberate gap between tickers so the sweep does not trip it at all.
# ---------------------------------------------------------------------------
#
# BARS_SPLIT_REPAIR_ENABLED must stay 0 throughout. Before the serve-path gate
# shipped, the sanitizer re-applied the bogus rescale to the response and wrote it
# straight back -- which is why run 1 of the earlier repair looked like a no-op.

param(
  [string[]] $Only,          # optional: repair just these tickers
  [switch]   $WhatIf         # measure and report, wipe nothing
)

$ErrorActionPreference = "Stop"
Set-Location C:\Users\Patrick\uct-dashboard

$line = (railway variables --service web --kv 2>$null | Select-String -Pattern '^PUSH_SECRET=')
if (-not $line) { Write-Error "PUSH_SECRET not found on the web service"; exit 1 }
$sec = $line.ToString().Split('=', 2)[1].Trim()

$UA    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
$auth  = @{ Authorization = "Bearer $sec"; "User-Agent" = $UA }
$plain = @{ "User-Agent" = $UA }
$BASE  = "https://uctintelligence.com"

function Get-Breaker {
  try {
    return Invoke-RestMethod -Uri "$BASE/api/admin/yfinance-guard" -Headers $plain -TimeoutSec 30
  } catch { return $null }
}

function Wait-Breaker([int]$maxWaitSec = 900) {
  $waited = 0
  while ($true) {
    $g = Get-Breaker
    if ($null -eq $g) { return $false }          # cannot tell -> caller decides
    if (-not $g.breaker_open) { return $true }
    $cool = [int]([math]::Max(15, $g.cooldown_seconds_remaining + 5))
    if ($waited + $cool -gt $maxWaitSec) { return $false }
    Write-Output ("  [breaker OPEN - waiting {0}s, suppressed_total={1}]" -f $cool, $g.suppressed_total)
    Start-Sleep -Seconds $cool
    $waited += $cool
  }
}

$syms = @("BF-A","LBTYA","VOD","BBD","IDT","SKM","CIG","TWO","WIT","VTR","TRI",
          "VNO","EGBN","ITUB","SRCE","SLG","RVT","IMOS","VFC","TR","MT","BAP",
          "TGS","FWONK","TRC","SQM","UTG","WPC")
if ($Only) { $syms = $Only }

# --- Guard 1: pre-flight -----------------------------------------------------
$g0 = Get-Breaker
if ($null -eq $g0) {
  Write-Error "Cannot read the yfinance guard. Refusing to wipe blind."; exit 1
}
if ($g0.breaker_open) {
  Write-Output "yfinance breaker is OPEN. Waiting before touching anything..."
  if (-not (Wait-Breaker)) { Write-Error "Breaker still open. Aborting."; exit 1 }
}
Write-Output ("REPAIR START  {0} tickers x 2 timeframes   (breaker closed, calls_total={1})" -f $syms.Count, $g0.calls_total)
if ($WhatIf) { Write-Output "WHATIF MODE - nothing will be wiped" }

$failed = @()
foreach ($s in $syms) {
  foreach ($tf in @("D","W")) {
    try {
      # --- Guard 2: never wipe while the repair path is suppressed ------------
      if (-not (Wait-Breaker)) {
        $failed += "$s/$tf"
        Write-Warning "Breaker stuck open before $s/$tf. Stopping with nothing wiped for it."
        break
      }

      $before = Invoke-RestMethod -Uri "$BASE/api/bars/$s`?tf=$tf&bars=5000" -Headers $plain -TimeoutSec 90
      $nb = @($before.bars).Count

      if ($WhatIf) {
        Write-Output ("  {0,-6} {1}  before={2,-5} (whatif)" -f $s, $tf, $nb)
        continue
      }

      $w = Invoke-RestMethod -Uri "$BASE/api/admin/refresh-bars/$s`?tf=$tf" -Method Post -Headers $auth -TimeoutSec 120

      # THE REPOPULATE FINISHES AFTER THE RESPONSE RETURNS, SO POLL -- DO NOT
      # SNAP-JUDGE. The first version read the count once, immediately, and called
      # a mid-flight fetch a failure. It aborted on BF-A and then on VOD; both were
      # fully restored seconds later, untouched. That false "SHORT" cost an hour of
      # chasing damage that had already healed itself, and -- worse -- it is the
      # failure direction that LOOKS responsible. A guard that cries wolf on a race
      # gets switched off, and then it is not there for the real thing.
      $na = 0
      foreach ($try in 1..12) {
        Start-Sleep -Seconds 10
        try {
          $after = Invoke-RestMethod -Uri "$BASE/api/bars/$s`?tf=$tf&bars=5000" -Headers $plain -TimeoutSec 240
          $na = @($after.bars).Count
        } catch { $na = 0 }
        if ($nb -le 0 -or $na -ge ($nb * 0.5)) { break }
      }

      $short = ($na -eq 0) -or ($nb -gt 0 -and $na -lt ($nb * 0.5))
      $flag = if ($short) { "  <-- SHORT (was $nb)" } else { "" }
      Write-Output ("  {0,-6} {1}  wiped={2,-6} before={3,-5} after={4,-5}{5}" -f $s, $tf, $w.sqlite_rows_deleted, $nb, $na, $flag)

      if ($short) {
        $failed += "$s/$tf"
        Write-Warning "ABORTING: $s/$tf came back short. Leaving the rest untouched."
        break
      }

      # --- Guard 3: pace, so the sweep does not trip the breaker at all -------
      Start-Sleep -Seconds 3
    } catch {
      $failed += "$s/$tf"
      Write-Output ("  {0,-6} {1}  ERROR: {2}" -f $s, $tf, $_.Exception.Message)
      Write-Warning "ABORTING after an error on $s/$tf."
      break
    }
  }
  if ($failed.Count -gt 0) { break }
}

Write-Output ""
$gz = Get-Breaker
if ($gz) { Write-Output ("breaker_open={0}  suppressed_total={1}  calls_total={2}" -f $gz.breaker_open, $gz.suppressed_total, $gz.calls_total) }
if ($failed.Count -gt 0) {
  Write-Output ("REPAIR STOPPED EARLY. Problem at: " + ($failed -join ', '))
  Write-Output "Everything before that point is repaired; nothing after it was touched."
} else {
  Write-Output ("REPAIR DONE. All " + $syms.Count + " tickers refreshed on D and W.")
}
