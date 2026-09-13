<#
    rth-restore.ps1 - put every setting the keepalive changed back, and prove it.

    THE GUARANTEE: this runs on its OWN one-time trigger regardless of how the open or
    close run ended - success, failure, crash, or never started. A restore that only runs
    on the happy path is not a restore; it is a leak that usually goes unnoticed.

    Idempotent. If there is no saved baseline it says so and changes nothing, rather than
    inventing defaults - guessing a value here would silently rewrite a real preference.
#>
[CmdletBinding()]
param([switch] $Quiet)

$ErrorActionPreference = 'Continue'
$repo   = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
$outDir = Join-Path $repo 'scratchpad\monday-rth'
$saveFile = Join-Path $outDir 'lock-state-saved.json'
$stopFile = Join-Path $outDir 'keepalive.stop'
$log      = Join-Path $repo 'logs\rth-keepalive.log'
New-Item -ItemType Directory -Force -Path $outDir, (Join-Path $repo 'logs') | Out-Null

function Say([string]$m) {
    $l = "[{0:HH:mm:ss}] restore: {1}" -f (Get-Date), $m
    Write-Host $l
    [System.IO.File]::AppendAllText($log, $l + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

$DESK = 'HKCU:\Control Panel\Desktop'
$WLOG = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

# 1. stop the hold loop first, so nothing re-asserts wakefulness after we restore.
[System.IO.File]::WriteAllText($stopFile, (Get-Date).ToString('o'), (New-Object System.Text.UTF8Encoding($false)))
Say "stop file written -> $stopFile"
Start-Sleep -Seconds 3

if (-not (Test-Path $saveFile)) {
    Say 'NO SAVED BASELINE - nothing restored (this is correct: guessing a value would rewrite a real preference)'
    & (Join-Path $repo 'scripts\rth-alert.ps1') -Level WARN -Title 'restore: nothing to restore' `
        -Message 'lock-state-saved.json was absent, so no settings were changed back. If the keepalive ran, check it by hand.' `
        -Fix 'Check HKCU\Control Panel\Desktop ScreenSaveActive / ScreenSaverIsSecure and powercfg /query'
    exit 0
}

$saved = Get-Content -Raw $saveFile | ConvertFrom-Json
Say ('restoring: ' + (($saved.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' '))

foreach ($k in 'ScreenSaveActive','ScreenSaverIsSecure','ScreenSaveTimeOut') {
    $v = $saved.$k
    if ($null -ne $v -and "$v" -ne '') { Set-ItemProperty -Path $DESK -Name $k -Value "$v" }
    else { Remove-ItemProperty -Path $DESK -Name $k -ErrorAction SilentlyContinue }   # was unset: leave it unset
}
if ($null -ne $saved.EnableGoodbye) {
    New-ItemProperty -Path $WLOG -Name EnableGoodbye -Value ([int]$saved.EnableGoodbye) -PropertyType DWord -Force | Out-Null
} else {
    Remove-ItemProperty -Path $WLOG -Name EnableGoodbye -ErrorAction SilentlyContinue
}
if ($null -ne $saved.MonitorTimeoutAC) { powercfg /change monitor-timeout-ac ([int]$saved.MonitorTimeoutAC / 60) | Out-Null }
if ($null -ne $saved.StandbyTimeoutAC) { powercfg /change standby-timeout-ac ([int]$saved.StandbyTimeoutAC / 60) | Out-Null }

# 2. read back and DIFF. A restore nobody verified is a claim, not a fact.
function Read-State {
    # ⛔ Each setting lives in its OWN subgroup: VIDEOIDLE under SUB_VIDEO, STANDBYIDLE
    # under SUB_SLEEP. Querying the wrong pair returns "does not exist", which under
    # ErrorActionPreference=Stop kills the script - the first version did exactly that.
    $s = [ordered]@{}
    foreach ($k in 'ScreenSaveActive','ScreenSaverIsSecure','ScreenSaveTimeOut') {
        $s[$k] = (Get-ItemProperty -Path $DESK -Name $k -ErrorAction SilentlyContinue).$k
    }
    $s['EnableGoodbye'] = (Get-ItemProperty -Path $WLOG -Name 'EnableGoodbye' -ErrorAction SilentlyContinue).EnableGoodbye
    $guid = $null
    $m = (powercfg /getactivescheme 2>$null | Out-String) -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
    if ($m) { $guid = $Matches[1] }
    $s['SchemeGuid'] = $guid
    foreach ($q in @(@('SUB_VIDEO','VIDEOIDLE','MonitorTimeoutAC'), @('SUB_SLEEP','STANDBYIDLE','StandbyTimeoutAC'))) {
        $val = $null
        if ($guid) {
            try {
                $raw = (powercfg /query $guid $q[0] $q[1] 2>$null | Out-String)
                if ($raw -match 'Current AC Power Setting Index:\s*(0x[0-9a-f]+)') {
                    $val = [Convert]::ToInt32($Matches[1], 16)
                }
            } catch { $val = $null }
        }
        $s[$q[2]] = $val
    }
    return $s
}
$now = Read-State
$mismatch = @()
foreach ($k in 'ScreenSaveActive','ScreenSaverIsSecure','ScreenSaveTimeOut','EnableGoodbye','MonitorTimeoutAC','StandbyTimeoutAC') {
    if ("$($now[$k])" -ne "$($saved.$k)") { $mismatch += ("{0}: saved='{1}' now='{2}'" -f $k, $saved.$k, $now[$k]) }
}
Say ('AFTER : ' + (($now.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))

$report = Join-Path $outDir 'restore-report.json'
[ordered]@{ restored_at = (Get-Date).ToString('o'); saved = $saved; now = $now; mismatches = $mismatch } |
    ConvertTo-Json -Depth 5 |
    ForEach-Object { [System.IO.File]::WriteAllText($report, $_, (New-Object System.Text.UTF8Encoding($false))) }

if ($mismatch.Count -eq 0) {
    Say 'all settings restored and verified'
    Rename-Item $saveFile ($saveFile + '.done') -Force -ErrorAction SilentlyContinue
    if (-not $Quiet) {
        & (Join-Path $repo 'scripts\rth-alert.ps1') -Level OK -Title 'lock settings restored' `
            -Message 'Screensaver, secure-lock, dynamic lock and power timeouts are back to their pre-RTH values, verified by read-back.'
    }
    exit 0
} else {
    Say ('MISMATCH after restore: ' + ($mismatch -join '; '))
    & (Join-Path $repo 'scripts\rth-alert.ps1') -Level FAIL -Title 'restore INCOMPLETE' `
        -Message ('These did not come back: ' + ($mismatch -join '; ')) `
        -Fix 'powershell -File scripts\rth-restore.ps1   (or set them by hand from scratchpad\monday-rth\lock-state-saved.json)'
    exit 1
}
