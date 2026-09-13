<#
    rth-alert.ps1 - the one place an RTH alert is raised.

    CHANNEL CHOICE, and why it is not Discord.
    The only Discord webhooks configured on this machine are SUNDAY_SCAN_WEBHOOK_URL and
    SUNDAY_SCAN_BRACCO_WEBHOOK_URL. Those belong to the Sunday-scan PUBLISHING path - a
    content channel with an audience. Ops chatter from a scheduled measurement run does
    not belong there, and creating a new webhook was explicitly out of scope. So:

        1. a Windows toast  (WinRT, works under Windows PowerShell 5.1)
        2. C:\Users\Patrick\Desktop\UCT-RTH-STATUS.txt  - overwritten with the LATEST status
        3. logs\rth-alerts.log                          - appended, the full history

    Both 2 and 3 exist because a toast is missable and transient; the file is the record.
    If DISCORD_WEBHOOK_URL (an ops webhook, not a content one) is ever set in the
    environment, this script will additionally post to it - opt-in by presence, never
    created here, never printed.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('OK','WARN','FAIL','INFO')][string] $Level,
    [Parameter(Mandatory)][string] $Title,
    [Parameter(Mandatory)][string] $Message,
    [string] $Fix = ''                # the ONE command that fixes it, when there is one
)

$repo       = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
# Desktop is OneDrive-redirected on this box, so GetFolderPath resolves to the VISIBLE
# desktop while the literal C:\Users\Patrick\Desktop also exists. Write BOTH: one is what
# you actually see, the other is the path named in the runbook.
$statusFiles = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'UCT-RTH-STATUS.txt'),
    'C:\Users\Patrick\Desktop\UCT-RTH-STATUS.txt'
) | Select-Object -Unique | Where-Object { Test-Path (Split-Path $_ -Parent) }
$statusFile = $statusFiles[0]
$histLog    = Join-Path $repo 'logs\rth-alerts.log'
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'logs') | Out-Null

$now   = Get-Date
$etNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($now, 'Eastern Standard Time')
$icon  = switch ($Level) { 'OK' {'[OK]'} 'WARN' {'[WARN]'} 'FAIL' {'[FAIL]'} default {'[INFO]'} }

$body = @()
$body += "$icon  $Title"
$body += ""
$body += $Message
if ($Fix) { $body += ""; $body += "FIX:"; $body += "  $Fix" }
$body += ""
$body += ("local {0}   |   ET {1}" -f $now.ToString('yyyy-MM-dd HH:mm:ss'), $etNow.ToString('yyyy-MM-dd HH:mm:ss'))
$body += "(this file is overwritten by the next alert; full history: logs\rth-alerts.log)"
$text = ($body -join [Environment]::NewLine)

# --- 2. desktop status file: LATEST only, overwritten -------------------------
foreach ($f in $statusFiles) {
    try { [System.IO.File]::WriteAllText($f, $text, (New-Object System.Text.UTF8Encoding($false))) } catch {}
}

# --- 3. history log: append, never truncated ---------------------------------
$line = "[{0:yyyy-MM-dd HH:mm:ss}] {1,-6} {2} :: {3}{4}" -f $now, $Level, $Title,
        ($Message -replace '\r?\n',' | '), $(if ($Fix) { "  FIX: $Fix" } else { '' })
[System.IO.File]::AppendAllText($histLog, $line + [Environment]::NewLine,
                                (New-Object System.Text.UTF8Encoding($false)))

# --- 1. toast ----------------------------------------------------------------
# WinRT types do not load in PowerShell 7. The scheduled tasks run powershell.exe (5.1),
# where they do; if we are somehow in 7, shell out to 5.1 rather than silently skipping.
$toastResult = 'skipped'
$toastScript = {
    param($t, $m)
    try {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime]
        $tpl  = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
                    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $node = $tpl.GetElementsByTagName('text')
        $node.Item(0).AppendChild($tpl.CreateTextNode($t)) | Out-Null
        $node.Item(1).AppendChild($tpl.CreateTextNode($m)) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($tpl)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(
            'Microsoft.WindowsPowerShell').Show($toast)
        'ok'
    } catch { 'fail: ' + $_.Exception.Message }
}
$toastTitle = "$icon UCT RTH - $Title"
$toastMsg   = (($Message -replace '\r?\n',' ') + $(if ($Fix) { "  FIX: $Fix" } else { '' }))
if ($toastMsg.Length -gt 180) { $toastMsg = $toastMsg.Substring(0,177) + '...' }

try {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(
                   "& {$toastScript} '$($toastTitle -replace "'","''")' '$($toastMsg -replace "'","''")'"))
        $toastResult = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
                         -NoProfile -EncodedCommand $enc 2>&1 | Select-Object -Last 1
    } else {
        $toastResult = & $toastScript $toastTitle $toastMsg
    }
} catch { $toastResult = 'fail: ' + $_.Exception.Message }

# --- optional ops Discord, by presence only -----------------------------------
$hook = [Environment]::GetEnvironmentVariable('DISCORD_WEBHOOK_URL')
if (-not $hook) { $hook = [Environment]::GetEnvironmentVariable('DISCORD_WEBHOOK_URL','User') }
$discordResult = 'not configured (no ops DISCORD_WEBHOOK_URL; SUNDAY_SCAN_* is a content channel and is deliberately not used)'
if ($hook) {
    try {
        $payload = @{ content = ("**$icon UCT RTH - $Title**`n$Message" +
                                 $(if ($Fix) { "`n**FIX:** ``$Fix``" } else { '' })) } | ConvertTo-Json -Depth 3
        Invoke-RestMethod -Uri $hook -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 20 | Out-Null
        $discordResult = 'posted'
    } catch { $discordResult = 'failed: ' + $_.Exception.Message }
}

Write-Host ("[alert] {0} {1} | toast={2} | files={3} | discord={4}" -f $Level, $Title, $toastResult, ($statusFiles -join "; "), $discordResult)
