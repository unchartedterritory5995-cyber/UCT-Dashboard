<#
    rth-open.ps1 - unattended launcher for the Monday RTH OPEN run (items 1-15).

    Also used, with -PromptFile, for the smoke run that proves the chain works.

    WHAT IT GUARANTEES
      * a fixed working directory (the flow-watch-rail worktree)
      * MEMBER_SMOKE_* / SMOKE_* hydrated from the USER environment even when the
        process was not started from a fresh login shell
      * three refusals BEFORE burning a session: weekday, /api/health, free memory
      * every byte of stdout+stderr teed to logs\rth-<date>-<phase>.log
      * exit code and wall time recorded to scratchpad\monday-rth\run-<phase>.json

    WHY A REFUSAL AND NOT A BEST EFFORT: a run that starts against a dead origin or a
    memory-starved box produces a plausible-looking transcript full of failures that
    reads, later, like a product finding. Refusing costs nothing; a false finding costs
    a day.
#>
[CmdletBinding()]
param(
    [string] $PromptFile = "docs\runbooks\monday-rth-prompt-open.md",
    [string] $Phase      = "open",
    # Overridable ONLY so the failure path can be exercised deliberately. Never change
    # it for a real run.
    [string] $HealthUrl  = "https://uctintelligence.com/api/health",
    [double] $MinFreeGB  = 3.0,
    [switch] $AllowWeekend          # smoke/rehearsal runs happen on a Saturday
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

$started   = Get-Date
$refusals  = @()
$warnings  = @()

function Say([string]$m) {
    $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $line
    [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-RunJson([int]$code, [string]$verdict) {
    $finished = Get-Date
    [pscustomobject]@{
        phase          = $Phase
        verdict        = $verdict
        exit_code      = $code
        started_local  = $started.ToString('o')
        finished_local = $finished.ToString('o')
        wall_seconds   = [math]::Round(($finished - $started).TotalSeconds, 1)
        started_et     = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
                            $started, 'Eastern Standard Time').ToString('o')
        prompt_file    = $PromptFile
        health_url     = $HealthUrl
        log            = $log
        refusals       = $refusals
        warnings       = $warnings
        host_name      = $env:COMPUTERNAME
    } | ConvertTo-Json -Depth 6 |
        ForEach-Object { [System.IO.File]::WriteAllText($runJson, $_, (New-Object System.Text.UTF8Encoding($false))) }
    Say ("run.json -> {0} (verdict={1}, exit={2})" -f $runJson, $verdict, $code)
}

Say "=== RTH $Phase launcher ==="
Say ("repo        : {0}" -f $repo)
Say ("prompt      : {0}" -f $PromptFile)
Say ("local now   : {0}" -f $started.ToString('yyyy-MM-dd HH:mm:ss zzz'))
Say ("ET now      : {0}" -f [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
                                $started, 'Eastern Standard Time').ToString('yyyy-MM-dd HH:mm:ss'))

# ---------------------------------------------------------------- credentials
# setx writes the USER scope in the registry; a process started from an older parent
# never sees it. Hydrate explicitly rather than hoping the task inherits a fresh block.
foreach ($n in 'MEMBER_SMOKE_EMAIL','MEMBER_SMOKE_PASSWORD','SMOKE_EMAIL','SMOKE_PASSWORD','RAILWAY_TOKEN','RAILWAY_API_TOKEN') {
    if (-not [Environment]::GetEnvironmentVariable($n)) {
        $v = [Environment]::GetEnvironmentVariable($n, 'User')
        if ($v) { [Environment]::SetEnvironmentVariable($n, $v); Say ("env: {0} hydrated from User scope" -f $n) }
    }
}
foreach ($n in 'MEMBER_SMOKE_EMAIL','MEMBER_SMOKE_PASSWORD') {
    if (-not [Environment]::GetEnvironmentVariable($n)) {
        $warnings += "$n is not set - rig logins will fail"
        Say ("WARN: {0} absent" -f $n)          # names only, never values
    }
}
# Railway auth on this box is the CLI's own rolling session file, NOT a token env var.
if (-not (Test-Path (Join-Path $env:USERPROFILE '.railway\config.json'))) {
    $warnings += 'no ~/.railway/config.json - railway ssh/logs probes will fail'
    Say 'WARN: railway session file absent'
}

# ------------------------------------------------------------------ refusal 1
$dow = $started.DayOfWeek
if ($dow -eq 'Saturday' -or $dow -eq 'Sunday') {
    if ($AllowWeekend) { $warnings += "weekend run allowed explicitly (-AllowWeekend): $dow"; Say "WARN: $dow, allowed by -AllowWeekend" }
    else { $refusals += "not a weekday: $dow" }
}

# ------------------------------------------------------------------ refusal 2
try {
    $r = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 25 -UseBasicParsing `
             -Headers @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36' }
    if ($r.StatusCode -ne 200) { $refusals += "health returned HTTP $($r.StatusCode)" }
    else { Say ("health      : 200 ({0} bytes)" -f $r.Content.Length) }
} catch {
    $refusals += "health unreachable at ${HealthUrl}: $($_.Exception.Message)"
}

# ------------------------------------------------------------------ refusal 3
$os     = Get-CimInstance Win32_OperatingSystem
$freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
Say ("free memory : {0} GB (floor {1} GB)" -f $freeGB, $MinFreeGB)
if ($freeGB -lt $MinFreeGB) { $refusals += "free memory ${freeGB} GB is under the ${MinFreeGB} GB floor" }

if ($refusals.Count -gt 0) {
    Say '--- REFUSING TO START ---'
    foreach ($x in $refusals) { Say ("  refusal: {0}" -f $x) }
    Say 'No session was started. Nothing was measured.'
    Write-RunJson 3 'refused'
    exit 3
}

# ------------------------------------------------------------------- the run
$promptPath = Join-Path $repo $PromptFile
if (-not (Test-Path $promptPath)) {
    $refusals += "prompt file not found: $promptPath"
    Write-RunJson 4 'refused'; exit 4
}

# Narrowest allowlist that still does the job. Anything not listed is DENIED outright by
# --permission-prompts none, so an unattended run can never hang on a prompt.
$allowed = @(
    'Read','Write','Edit','Glob','Grep','TodoWrite','NotebookEdit',
    'Bash(python *)','Bash(py *)',
    'Bash(git add *)','Bash(git commit *)','Bash(git status*)','Bash(git log*)',
    'Bash(git diff*)','Bash(git show*)','Bash(git rev-parse*)','Bash(git branch*)',
    'Bash(git fetch*)','Bash(git merge-base*)','Bash(git rev-list*)','Bash(git config*)',
    'Bash(railway logs*)','Bash(railway status*)','Bash(railway deployment*)','Bash(railway ssh*)',
    'Bash(curl *)','Bash(mkdir *)','Bash(ls*)','Bash(cat*)','Bash(head*)','Bash(tail*)',
    'Bash(grep*)','Bash(find *)','Bash(date*)','Bash(echo *)','Bash(wc*)','Bash(sed -n*)',
    'Bash(cp *)','Bash(sort*)','Bash(uniq*)','Bash(jq*)','Bash(timeout *)',
    # the smoke run could not confirm it left no browser behind: tasklist was denied.
    # read-only process listing, so the run can check its own cleanup.
    'Bash(tasklist*)','Bash(ps*)'
) -join ','

# Belt and braces: these must never run in an RTH session even if an allow rule widens.
$denied = @(
    'Bash(git push*)','Bash(railway variables*)','Bash(railway redeploy*)','Bash(railway up*)',
    'Bash(railway run*)','Bash(npm run deploy*)','WebFetch','WebSearch'
) -join ','

Say 'preconditions passed - starting headless session'
Say ("allowedTools: {0}" -f $allowed)
Say ("disallowed  : {0}" -f $denied)
Say '--- claude output follows ---'

$claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path $claude)) { $claude = 'claude' }

$code = 0
try {
    # stdin carries the prompt; stdout+stderr are teed so the log is the record of truth.
    Get-Content -Raw -Encoding utf8 $promptPath |
        & $claude -p --permission-mode acceptEdits --permission-prompts none `
                  --allowedTools $allowed --disallowedTools $denied 2>&1 |
        Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
} catch {
    Say ("launcher caught: {0}" -f $_.Exception.Message)
    $code = 1
}

Say ("--- claude exited {0} ---" -f $code)
Write-RunJson $code $(if ($code -eq 0) { 'completed' } else { 'failed' })
exit $code
