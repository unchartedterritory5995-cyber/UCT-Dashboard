<#
    rth-preflight.ps1 - everything that must be true before the RTH open, checked twice.

    Runs Sunday 20:00 ET and Monday 07:45 ET. Writes
    scratchpad\monday-rth\preflight-<sun|mon>.json plus one human line per check, and
    alerts either way.

    ⭐ IT ALERTS ON SUCCESS TOO. "RTH open is GO" exists so that silence never has to be
    interpreted. A monitor that only speaks on failure is indistinguishable from a
    monitor that is not running - which is exactly the failure mode this whole exercise
    is about.
#>
[CmdletBinding()]
param(
    [ValidateSet('sun','mon','rehearsal')][string] $Phase = 'mon',
    [switch] $SkipRig,                 # the Sunday run does not fire the rig
    [switch] $AllowWeekend
)

$ErrorActionPreference = 'Continue'
$repo   = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
Set-Location $repo
$outDir = Join-Path $repo 'scratchpad\monday-rth'
New-Item -ItemType Directory -Force -Path $outDir, (Join-Path $repo 'logs') | Out-Null
$jsonOut = Join-Path $outDir ("preflight-{0}.json" -f $Phase)
$log     = Join-Path $repo ("logs\rth-preflight-{0}.log" -f $Phase)

$checks = New-Object System.Collections.ArrayList
$started = Get-Date

function Say([string]$m) {
    Write-Host $m
    [System.IO.File]::AppendAllText($log, $m + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}
function Add-Check([string]$name, [bool]$ok, [string]$detail, [string]$fix = '', [bool]$fatal = $true) {
    $null = $checks.Add([pscustomobject]@{ check = $name; ok = $ok; fatal = $fatal; detail = $detail; fix = $fix })
    Say ("{0}  {1,-34} {2}" -f $(if ($ok) { '[PASS]' } elseif (-not $fatal) { '[WARN]' } else { '[FAIL]' }), $name, $detail)
}

Say ("=== RTH preflight ({0}) {1} local / {2} ET ===" -f $Phase,
     $started.ToString('yyyy-MM-dd HH:mm:ss'),
     [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($started,'Eastern Standard Time').ToString('yyyy-MM-dd HH:mm:ss'))

# hydrate creds the same way the runners do
foreach ($n in 'MEMBER_SMOKE_EMAIL','MEMBER_SMOKE_PASSWORD','SMOKE_EMAIL','SMOKE_PASSWORD','RAILWAY_TOKEN','RAILWAY_API_TOKEN') {
    if (-not [Environment]::GetEnvironmentVariable($n)) {
        $v = [Environment]::GetEnvironmentVariable($n,'User'); if ($v) { [Environment]::SetEnvironmentVariable($n,$v) }
    }
}

# 1 -- AC power ---------------------------------------------------------------
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if (-not $bat) { Add-Check 'on AC power' $true 'no battery present (desktop) - always on AC' }
else {
    $onAC = $bat.BatteryStatus -in 2,6,7,8,9
    Add-Check 'on AC power' $onAC ("BatteryStatus={0} charge={1}%" -f $bat.BatteryStatus, $bat.EstimatedChargeRemaining) 'Plug the machine in.'
}

# 2 -- network ----------------------------------------------------------------
$net = Test-Connection -ComputerName '1.1.1.1' -Count 1 -Quiet -ErrorAction SilentlyContinue
Add-Check 'network up' ([bool]$net) $(if ($net) { 'ICMP to 1.1.1.1 OK' } else { 'no ICMP reply' }) 'Check the network connection.'

# 3 -- /api/health ------------------------------------------------------------
$podAge = $null
try {
    $r = Invoke-WebRequest -Uri 'https://uctintelligence.com/api/health' -TimeoutSec 25 -UseBasicParsing `
            -Headers @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36' }
    $j = $r.Content | ConvertFrom-Json
    # measured: the payload field is `uptime_seconds`. The other spellings are fallbacks.
    $podAge = $j.uptime_seconds; if (-not $podAge) { $podAge = $j.uptime_s }; if (-not $podAge) { $podAge = $j.uptime }
    Add-Check '/api/health 200' ($r.StatusCode -eq 200) ("HTTP {0}, pod age {1}s" -f $r.StatusCode, $podAge) 'Check production is up.'
} catch { Add-Check '/api/health 200' $false ("unreachable: {0}" -f $_.Exception.Message) 'Check production / network.' }

# 4 -- railway auth -----------------------------------------------------------
# A project token, if ever set, takes precedence over the CLI session and is stated.
$authSrc = if ([Environment]::GetEnvironmentVariable('RAILWAY_TOKEN')) { 'RAILWAY_TOKEN (project token - takes precedence over the CLI session)' }
           elseif ([Environment]::GetEnvironmentVariable('RAILWAY_API_TOKEN')) { 'RAILWAY_API_TOKEN (account token)' }
           else { 'railway CLI session (~/.railway/config.json)' }
$who = (& railway whoami 2>&1 | Out-String).Trim()
$whoOK = ($LASTEXITCODE -eq 0 -and $who -match 'Logged in as')
$stat = (& railway status --json 2>&1 | Out-String)
$statOK = ($LASTEXITCODE -eq 0 -and $stat -match '"name"')
Add-Check 'railway auth valid' ($whoOK -and $statOK) ("via {0}; whoami={1} status={2}" -f $authSrc, $whoOK, $statOK) `
    'Open a terminal, run:  railway login    then:  schtasks /run /tn "UCT RTH Preflight Monday"'

# token expiry, reported for information
try {
    $cfg = Get-Content -Raw "$env:USERPROFILE\.railway\config.json" | ConvertFrom-Json
    $exp = [DateTimeOffset]::FromUnixTimeSeconds($cfg.user.tokenExpiresAt).LocalDateTime
    $expET = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($exp,'Eastern Standard Time')
    $mins = [int]($exp - (Get-Date)).TotalMinutes
    Add-Check 'railway token not expiring soon' ($mins -gt 60) `
        ("accessToken expires {0} ET ({1} min); a refreshToken is present and the CLI rolls it" -f $expET.ToString('yyyy-MM-dd HH:mm'), $mins) `
        'If railway commands start failing:  railway login' $false
} catch { Add-Check 'railway token expiry readable' $false 'could not read tokenExpiresAt' '' $false }

# 5 -- member smoke creds (names only) ----------------------------------------
$haveCreds = [bool][Environment]::GetEnvironmentVariable('MEMBER_SMOKE_EMAIL') -and
             [bool][Environment]::GetEnvironmentVariable('MEMBER_SMOKE_PASSWORD')
Add-Check 'MEMBER_SMOKE_* present' $haveCreds $(if ($haveCreds) { 'both names set (values never read out)' } else { 'one or both absent' }) `
    'setx MEMBER_SMOKE_EMAIL ... ; setx MEMBER_SMOKE_PASSWORD ...'

# 6 -- one paced member login -------------------------------------------------
if ($haveCreds) {
    try {
        $body = @{ email = [Environment]::GetEnvironmentVariable('MEMBER_SMOKE_EMAIL')
                   password = [Environment]::GetEnvironmentVariable('MEMBER_SMOKE_PASSWORD') } | ConvertTo-Json
        $lr = Invoke-WebRequest -Uri 'https://uctintelligence.com/api/auth/login' -Method Post -Body $body `
                -ContentType 'application/json' -TimeoutSec 30 -UseBasicParsing `
                -Headers @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36' }
        $lj = $lr.Content | ConvertFrom-Json
        $role = $lj.user.role; if (-not $role) { $role = $lj.role }
        Add-Check 'member-smoke login 200 role=member' (($lr.StatusCode -eq 200) -and ($role -eq 'member')) `
            ("HTTP {0} role={1}  (ONE login only - the endpoint is rate limited 5/min)" -f $lr.StatusCode, $role) `
            'Check the member-smoke account still exists and is not locked.'
    } catch {
        Add-Check 'member-smoke login 200 role=member' $false ("login failed: {0}" -f $_.Exception.Message) `
            'If 429, wait a minute - the endpoint is 5/min per IP.'
    }
} else { Add-Check 'member-smoke login 200 role=member' $false 'skipped - credentials absent' '' }

# 7 -- memory -----------------------------------------------------------------
$os = Get-CimInstance Win32_OperatingSystem
$freeGB = [math]::Round($os.FreePhysicalMemory/1MB,2)
Add-Check 'free memory >= 3 GB' ($freeGB -ge 3.0) ("{0} GB free" -f $freeGB) 'Close memory-hungry processes.'

# 8 -- no runaway process -----------------------------------------------------
$hogs = Get-Process | Where-Object { $_.WorkingSet64 -gt 4GB } |
        Select-Object @{n='n';e={$_.ProcessName}}, Id, @{n='GB';e={[math]::Round($_.WorkingSet64/1GB,2)}}
# ⛔ Not "any pytest": another session running a SCOPED suite is normal here and is not
# a reason to cancel the open. The hazards are a runaway (memory) and a bare
# directory-wide run, which is the shape that reached 18 GB on this box.
$pytest = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
          Where-Object {
              $_.CommandLine -match 'pytest' -and (
                  $_.WorkingSetSize -gt 2GB -or
                  $_.CommandLine -match 'pytest\s+(tests|api)[\/]?\s*$' -or
                  $_.CommandLine -match 'pytest\s+(tests|api)[\/]?\s+-' )
          }
$hogDetail = if ($hogs) { ($hogs | ForEach-Object { "$($_.n)($($_.Id)) $($_.GB)GB" }) -join ', ' } else { 'none over 4 GB' }
if ($pytest) { $hogDetail += ('; runaway/directory-wide pytest pid ' + (($pytest | ForEach-Object { $_.ProcessId }) -join ',')) }
Add-Check 'no runaway process' (-not $hogs -and -not $pytest) $hogDetail 'Stop the process before the open.'

# 9 -- screen not locked ------------------------------------------------------
# LogonUI.exe runs exactly while the secure desktop (lock screen) is up.
$locked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue)
Add-Check 'screen not locked' (-not $locked) $(if ($locked) { 'LogonUI is running - the session is LOCKED' } else { 'no LogonUI - session is unlocked' }) `
    'unlock the screen'

# 10 -- the two RTH tasks still armed -----------------------------------------
foreach ($tn in 'UCT RTH Open','UCT RTH Close') {
    $t = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
    if (-not $t) { Add-Check "task '$tn' registered" $false 'NOT REGISTERED' 'Re-register: see docs/runbooks/rth-scheduling.md' ; continue }
    $i = $t | Get-ScheduledTaskInfo
    $ok = ($t.State -ne 'Disabled') -and ($t.Triggers.Count -gt 0) -and ($null -ne $i.NextRunTime)
    Add-Check "task '$tn' armed" $ok ("state={0} next={1}" -f $t.State, $i.NextRunTime) 'Re-arm per the runbook.'
}

# 11 -- worktree clean and current --------------------------------------------
$dirty = (& git status --porcelain | Out-String).Trim()
Add-Check 'worktree clean' ([string]::IsNullOrWhiteSpace($dirty)) `
    $(if ($dirty) { ($dirty -split "`n").Count.ToString() + ' modified path(s)' } else { 'clean' }) `
    'git status - commit or stash before the run.' $false
& git fetch origin master --quiet 2>&1 | Out-Null
$behind = (& git rev-list --count HEAD..origin/master | Out-String).Trim()
if ($behind -ne '0') {
    & git merge-base --is-ancestor HEAD origin/master 2>&1 | Out-Null
    $ff = ($LASTEXITCODE -eq 0)
    if ($ff -and [string]::IsNullOrWhiteSpace($dirty)) {
        & git merge --ff-only origin/master 2>&1 | Out-Null
        $behind2 = (& git rev-list --count HEAD..origin/master | Out-String).Trim()
        Add-Check '0 behind origin/master' ($behind2 -eq '0') ("was $behind behind; fast-forwarded to " + (& git rev-parse --short HEAD)) ''
    } else {
        $why = if (-not [string]::IsNullOrWhiteSpace($dirty)) { 'the worktree is dirty' }
               elseif (-not $ff) { 'local commits have diverged from master (you are ahead AND behind)' }
               else { 'unknown' }
        Add-Check '0 behind origin/master' $false ("$behind behind; cannot fast-forward because $why") `
            $(if (-not $ff) { 'git fetch origin master; git rebase origin/master   (then re-run the preflight)' }
              else { 'git status; commit or stash, then re-run the preflight' })
    }
} else { Add-Check '0 behind origin/master' $true 'up to date' }

# 12 -- no leftover rig browser -----------------------------------------------
$stale = Get-Process -ErrorAction SilentlyContinue |
         Where-Object { $_.Path -like '*ms-playwright*' }
Add-Check 'no leftover rig browser' (-not $stale) `
    $(if ($stale) { ($stale | ForEach-Object { "$($_.ProcessName)($($_.Id))" }) -join ',' } else { 'none' }) `
    'Stop-Process the listed ms-playwright processes.'

# 13 -- Monday only: prove the whole chain with one rig run -------------------
if (-not $SkipRig) {
    try {
        $rigOut = Join-Path $outDir ("preflight-rig-{0}.json" -f $Phase)
        Say '  running one path-B rig dry run (NOT A MEASUREMENT) ...'
        $rigLog = & python (Join-Path $repo 'tools\flow_cold_paint_rig.py') --path b --runs 1 --out $rigOut 2>&1 | Out-String
        $rigOK = ($LASTEXITCODE -eq 0)
        Add-Check 'rig path-B dry run (NOT A MEASUREMENT)' $rigOK `
            ("exit={0} out={1}" -f $LASTEXITCODE, $(if (Test-Path $rigOut) { $rigOut } else { 'no file' })) `
            'Run it by hand to see the error: python tools\flow_cold_paint_rig.py --path b --runs 1'
    } catch { Add-Check 'rig path-B dry run (NOT A MEASUREMENT)' $false ("threw: {0}" -f $_.Exception.Message) '' }
} else { Say '  (rig dry run skipped for this phase)' }

# ---------------------------------------------------------------- verdict
$fails = @($checks | Where-Object { -not $_.ok -and $_.fatal })
$warns = @($checks | Where-Object { -not $_.ok -and -not $_.fatal })
$verdict = if ($fails.Count -eq 0) { 'GO' } else { 'NO-GO' }

[ordered]@{
    phase = $Phase; verdict = $verdict
    started_local = $started.ToString('o')
    started_et = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($started,'Eastern Standard Time').ToString('o')
    pod_age_s = $podAge; fail_count = $fails.Count; warn_count = $warns.Count
    checks = $checks
} | ConvertTo-Json -Depth 6 |
  ForEach-Object { [System.IO.File]::WriteAllText($jsonOut, $_, (New-Object System.Text.UTF8Encoding($false))) }
Say ("verdict: {0}  ({1} fail, {2} warn)  -> {3}" -f $verdict, $fails.Count, $warns.Count, $jsonOut)

$alert = Join-Path $repo 'scripts\rth-alert.ps1'
if ($verdict -eq 'GO') {
    $msg = "RTH open is GO. $($checks.Count) checks, 0 failures" + $(if ($warns) { ", $($warns.Count) warning(s): " + (($warns | ForEach-Object { $_.check }) -join ', ') } else { '.' })
    if ($Phase -eq 'sun') {
        $msg = "LEAVE THE MACHINE ON (or asleep) - it cannot wake from a full shutdown. " + $msg
    }
    & $alert -Level OK -Title ("preflight {0}: GO" -f $Phase) -Message $msg
} else {
    $first = $fails[0]
    & $alert -Level FAIL -Title ("preflight {0}: NO-GO" -f $Phase) `
        -Message (("Failed: " + (($fails | ForEach-Object { $_.check }) -join '; ')) + ".  First: " + $first.detail) `
        -Fix $first.fix
}
exit $(if ($verdict -eq 'GO') { 0 } else { 1 })
