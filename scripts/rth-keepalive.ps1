<#
    rth-keepalive.ps1 - keep the session awake and unlocked for the RTH window.

    SAVE FIRST, THEN CHANGE. Every value this touches is written to
    scratchpad\monday-rth\lock-state-saved.json BEFORE it is changed, and rth-restore.ps1
    puts them back. A "keep awake" script with no saved baseline is a permanent settings
    change wearing a temporary name.

    ⛔ This cannot unlock an already-locked screen - nothing in user space can. It only
    prevents a lock from happening. The preflight is what catches an already-locked box.
#>
[CmdletBinding()]
param(
    # ⛔ [string], NOT [datetime]. Through `powershell -File`, a quoted argument arrives
    # WITH its quotes and fails to coerce - and a parameter-binding failure happens BEFORE
    # the script body, so it exits 1 having written no log at all. Measured twice.
    [string] $Deadline = '',                                    # local ISO; empty = today 18:00
    [switch]   $DryRun                                          # apply, read back, restore
)

$ErrorActionPreference = 'Stop'
$DeadlineTime = if ($Deadline) { [datetime]::Parse($Deadline.Trim("'").Trim('"')) }
                else { [datetime]::Today.AddHours(18) }
$repo   = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
$outDir = Join-Path $repo 'scratchpad\monday-rth'
New-Item -ItemType Directory -Force -Path $outDir, (Join-Path $repo 'logs') | Out-Null
$saveFile = Join-Path $outDir 'lock-state-saved.json'
$stopFile = Join-Path $outDir 'keepalive.stop'
$log      = Join-Path $repo 'logs\rth-keepalive.log'

function Say([string]$m) {
    $l = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $l
    [System.IO.File]::AppendAllText($log, $l + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

$DESK  = 'HKCU:\Control Panel\Desktop'
$WLOG  = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

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

Say '=== RTH keepalive ==='
$before = Read-State
Say ('BEFORE: ' + (($before.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))

# ⛔ Never overwrite a saved baseline with an already-modified state. If the file exists,
# a previous run did not restore, and its values are the real ones.
if (Test-Path $saveFile) {
    Say "WARN: $saveFile already exists - a previous keepalive did not restore. Keeping the OLDER baseline."
} else {
    $before | ConvertTo-Json -Depth 4 |
        ForEach-Object { [System.IO.File]::WriteAllText($saveFile, $_, (New-Object System.Text.UTF8Encoding($false))) }
    Say "saved baseline -> $saveFile"
}

# ---------------------------------------------------------------- apply
Set-ItemProperty -Path $DESK -Name ScreenSaveActive    -Value '0'
Set-ItemProperty -Path $DESK -Name ScreenSaverIsSecure -Value '0'
New-ItemProperty -Path $WLOG -Name EnableGoodbye -Value 0 -PropertyType DWord -Force | Out-Null  # dynamic lock off
powercfg /change monitor-timeout-ac 0 | Out-Null
powercfg /change standby-timeout-ac 0 | Out-Null
Say 'applied: screensaver off, not-secure, dynamic lock off, monitor/standby AC = never'

$after = Read-State
Say ('AFTER : ' + (($after.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))

if ($DryRun) {
    Say 'DRY RUN - restoring immediately'
    & (Join-Path $repo 'scripts\rth-restore.ps1')
    exit 0
}

Remove-Item $stopFile -ErrorAction SilentlyContinue
Say ("holding execution state until {0} (or the stop file)" -f $DeadlineTime)
& python (Join-Path $repo 'scripts\rth_keepalive_hold.py') $stopFile $DeadlineTime.ToString('s')
$code = $LASTEXITCODE
Say ("hold loop exited {0}" -f $code)
exit $code
