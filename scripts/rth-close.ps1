<#
    rth-close.ps1 - unattended launcher for the Monday RTH CLOSE run (items 16-23).

    Differs from rth-open.ps1 in exactly three ways, and each difference has a reason:

      * NO health refusal. The close run reads files and pushes docs; it does not
        measure anything, so an origin blip is not a reason to lose the write-up.
        (Weekday and free-memory refusals still apply - the box still has to work.)
      * git push IS allowed. It is the whole point: the OPEN run's commit is local and
        this run lands it, after 16:15 ET.
      * The rig is NOT allowed. Nothing in items 16-23 may re-measure, and the cheapest
        way to guarantee that is to take the tool away rather than to ask nicely.
#>
[CmdletBinding()]
param(
    [string] $PromptFile = "docs\runbooks\monday-rth-prompt-close.md",
    [string] $Phase      = "close",
    [double] $MinFreeGB  = 3.0,
    [switch] $AllowWeekend
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
Set-Location $repo

$stamp   = Get-Date -Format 'yyyy-MM-dd'
$logDir  = Join-Path $repo 'logs'
$outDir  = Join-Path $repo 'scratchpad\monday-rth'
New-Item -ItemType Directory -Force -Path $logDir, $outDir | Out-Null
$log     = Join-Path $logDir  ("rth-{0}-{1}.log" -f $stamp, $Phase)
$runJson = Join-Path $outDir  ("run-{0}.json" -f $Phase)

$started  = Get-Date
$refusals = @()
$warnings = @()

function Say([string]$m) {
    $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $line
    [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-RunJson([int]$code, [string]$verdict) {
    $finished = Get-Date
    [pscustomobject]@{
        phase = $Phase; verdict = $verdict; exit_code = $code
        started_local = $started.ToString('o'); finished_local = $finished.ToString('o')
        wall_seconds  = [math]::Round(($finished - $started).TotalSeconds, 1)
        started_et    = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
                            $started, 'Eastern Standard Time').ToString('o')
        prompt_file = $PromptFile; log = $log
        refusals = $refusals; warnings = $warnings; host_name = $env:COMPUTERNAME
    } | ConvertTo-Json -Depth 6 |
        ForEach-Object { [System.IO.File]::WriteAllText($runJson, $_, (New-Object System.Text.UTF8Encoding($false))) }
    Say ("run.json -> {0} (verdict={1}, exit={2})" -f $runJson, $verdict, $code)
}


function Send-Alert([string]$Level,[string]$Title,[string]$Message,[string]$Fix='') {
    try { & (Join-Path $repo 'scripts\rth-alert.ps1') -Level $Level -Title $Title -Message $Message -Fix $Fix }
    catch { Say ("alert failed: {0}" -f $_.Exception.Message) }
}

Say "=== RTH $Phase launcher ==="
Say ("local now   : {0}" -f $started.ToString('yyyy-MM-dd HH:mm:ss zzz'))
$etNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($started, 'Eastern Standard Time')
Say ("ET now      : {0}" -f $etNow.ToString('yyyy-MM-dd HH:mm:ss'))

foreach ($n in 'MEMBER_SMOKE_EMAIL','MEMBER_SMOKE_PASSWORD','SMOKE_EMAIL','SMOKE_PASSWORD','RAILWAY_TOKEN','RAILWAY_API_TOKEN') {
    if (-not [Environment]::GetEnvironmentVariable($n)) {
        $v = [Environment]::GetEnvironmentVariable($n, 'User')
        if ($v) { [Environment]::SetEnvironmentVariable($n, $v) }
    }
}

$dow = $started.DayOfWeek
if ($dow -eq 'Saturday' -or $dow -eq 'Sunday') {
    if ($AllowWeekend) { $warnings += "weekend run allowed explicitly: $dow" }
    else { $refusals += "not a weekday: $dow" }
}

$os     = Get-CimInstance Win32_OperatingSystem
$freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
Say ("free memory : {0} GB (floor {1} GB)" -f $freeGB, $MinFreeGB)
if ($freeGB -lt $MinFreeGB) { $refusals += "free memory ${freeGB} GB is under the ${MinFreeGB} GB floor" }

# Not a refusal - a loud warning. The write-up is still worth producing early; the
# prompt itself is told to wait for 16:15 ET before pushing.
if ($etNow.Hour -lt 16 -or ($etNow.Hour -eq 16 -and $etNow.Minute -lt 15)) {
    $warnings += "started before 16:15 ET - the prompt must hold the push until after it"
    Say 'WARN: before 16:15 ET; the push gate is enforced inside the prompt'
}

if ($refusals.Count -gt 0) {
    Say '--- REFUSING TO START ---'
    foreach ($x in $refusals) { Say ("  refusal: {0}" -f $x) }
    Write-RunJson 3 'refused'
    Send-Alert 'FAIL' "$Phase run REFUSED" ($refusals -join '; ') 'Fix the precondition, then: schtasks /run /tn "UCT RTH Close"'
    exit 3
}

$promptPath = Join-Path $repo $PromptFile
if (-not (Test-Path $promptPath)) { $refusals += "prompt file not found: $promptPath"; Write-RunJson 4 'refused'; exit 4 }

# git push IS allowed here. The rig is NOT - items 16-23 must not re-measure.
$allowed = @(
    'Read','Write','Edit','Glob','Grep','TodoWrite','NotebookEdit',
    'Bash(git add *)','Bash(git commit *)','Bash(git status*)','Bash(git log*)',
    'Bash(git diff*)','Bash(git show*)','Bash(git rev-parse*)','Bash(git branch*)',
    'Bash(git fetch*)','Bash(git merge-base*)','Bash(git rev-list*)','Bash(git rebase*)',
    'Bash(git push origin HEAD:master)','Bash(git config*)',
    'Bash(railway deployment*)','Bash(railway status*)',
    'Bash(curl *)','Bash(mkdir *)','Bash(ls*)','Bash(cat*)','Bash(head*)','Bash(tail*)',
    'Bash(grep*)','Bash(find *)','Bash(date*)','Bash(echo *)','Bash(wc*)','Bash(sed -n*)',
    'Bash(cp *)','Bash(sort*)','Bash(uniq*)','Bash(jq*)','Bash(python *)'
) -join ','

$denied = @(
    'Bash(git push --force*)','Bash(git push -f*)',
    'Bash(python tools/flow_cold_paint_rig.py*)','Bash(python tools/flow_storm_probe.py*)',
    'Bash(railway variables*)','Bash(railway redeploy*)','Bash(railway up*)','Bash(railway ssh*)',
    'WebFetch','WebSearch'
) -join ','

Say 'preconditions passed - starting headless session'
Say ("allowedTools: {0}" -f $allowed)
Say ("disallowed  : {0}" -f $denied)
Say '--- claude output follows ---'

$claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path $claude)) { $claude = 'claude' }

$code = 0
try {
    Get-Content -Raw -Encoding utf8 $promptPath |
        & $claude -p --permission-mode acceptEdits --permission-prompts none `
                  --allowedTools $allowed --disallowedTools $denied 2>&1 |
        Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
} catch {
    Say ("launcher caught: {0}" -f $_.Exception.Message); $code = 1
}

Say ("--- claude exited {0} ---" -f $code)
Write-RunJson $code $(if ($code -eq 0) { 'completed' } else { 'failed' })

$final = Join-Path $repo 'docs\runbooks\monday-rth-results\FINAL-REPORT.md'
if (Test-Path $final) {
    Send-Alert $(if ($code -eq 0) { 'OK' } else { 'WARN' }) "$Phase run FINISHED - report ready" `
        ("exit={0}. Read: {1}" -f $code, $final) ("notepad `"{0}`"" -f $final)
} else {
    Send-Alert 'WARN' "$Phase run FINISHED - NO REPORT" `
        ("exit={0} but FINAL-REPORT.md was not written. Check {1}" -f $code, $log) `
        ("type `"{0}`"" -f $log)
}
exit $code
