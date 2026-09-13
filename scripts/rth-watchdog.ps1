<#
    rth-watchdog.ps1 - did the run actually start?

    A scheduled task that never fires produces no log, no error and no alert. From the
    outside that is indistinguishable from a quiet, healthy morning. This is the check
    that turns "nothing happened" into a message.

    Open  watchdog: 09:35 ET - run-open.json must exist and be from today.
    Close watchdog: 16:35 ET - run-close.json must exist and be from today.
#>
[CmdletBinding()]
param([ValidateSet('open','close')][string] $Phase = 'open')

$repo   = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
Set-Location $repo
$runJson = Join-Path $repo ("scratchpad\monday-rth\run-{0}.json" -f $Phase)
$alert   = Join-Path $repo 'scripts\rth-alert.ps1'
$taskName = "UCT RTH " + (Get-Culture).TextInfo.ToTitleCase($Phase)

$info = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Get-ScheduledTaskInfo
$lastRun = if ($info) { $info.LastRunTime } else { $null }
$lastRes = if ($info) { $info.LastTaskResult } else { 'no task' }

if (-not (Test-Path $runJson)) {
    & $alert -Level FAIL -Title ("{0} run DID NOT START" -f $Phase.ToUpper()) `
        -Message ("No {0} by the watchdog time. Task '{1}' last run: {2}, last result: {3}." -f `
                  (Split-Path $runJson -Leaf), $taskName, $lastRun, $lastRes) `
        -Fix ("schtasks /run /tn `"{0}`"    (check the screen is unlocked first)" -f $taskName)
    exit 1
}

# Present, but is it from TODAY? A stale file from a previous run reads as success, which
# is the exact failure this watchdog exists to catch - one level deeper.
$age = (Get-Date) - (Get-Item $runJson).LastWriteTime
if ($age.TotalHours -gt 12) {
    & $alert -Level FAIL -Title ("{0} run file is STALE" -f $Phase.ToUpper()) `
        -Message ("{0} exists but was last written {1:N1} h ago - it is from a previous run, not today's." -f `
                  (Split-Path $runJson -Leaf), $age.TotalHours) `
        -Fix ("schtasks /run /tn `"{0}`"" -f $taskName)
    exit 1
}

$r = Get-Content -Raw $runJson | ConvertFrom-Json
& $alert -Level $(if ($r.exit_code -eq 0) { 'OK' } else { 'WARN' }) `
    -Title ("{0} run watchdog: started" -f $Phase.ToUpper()) `
    -Message ("verdict={0} exit={1} wall={2}s refusals={3}" -f $r.verdict, $r.exit_code, $r.wall_seconds,
              $(if ($r.refusals) { ($r.refusals -join '; ') } else { 'none' }))
exit 0
