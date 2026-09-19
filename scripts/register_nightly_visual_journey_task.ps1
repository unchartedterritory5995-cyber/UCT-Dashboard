# scripts/register_nightly_visual_journey_task.ps1
# One-time registration. Run manually once; re-run to update the trigger/action
# if either changes. Matches this repo's existing Register-ScheduledTask
# convention (docs/runbooks/rth-scheduling.md) rather than legacy schtasks.exe.

$taskName = "UCT Visual Journey Nightly"
$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $repoRoot "scripts\run_nightly_visual_journey.ps1"

$action = New-ScheduledTaskAction -Execute "pwsh.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At "01:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Nightly full Pine-import visual journey against tools/c0_oos_fixtures" `
    -Force

Write-Host "Registered '$taskName' -> daily 01:00 CT, action: $scriptPath"
