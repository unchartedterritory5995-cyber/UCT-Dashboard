<#
  scripts/resume-windows.ps1 - open one PowerShell window per ACTIVE worktree after a restart.

  "Active" = a commit in the last -Hours hours (default 12), capped at -Max windows (default 12).
  The Discord render worktree always opens. Each window is titled "UCT - <branch>", starts in the
  worktree, and shows `git status -sb`; nothing else runs in it.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\resume-windows.ps1 [-Hours 12] [-Max 12]
#>
param([int]$Hours = 12, [int]$Max = 12)

$Main = 'C:\Users\Patrick\uct-dashboard'
$Always = @('C:\Users\Patrick\uct-worktrees\discord-render')
$cut = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - ($Hours * 3600)

$wts = @()
$cur = $null
foreach ($l in (git -C $Main worktree list --porcelain 2>$null)) {
    if ($l -like 'worktree *') { $cur = @{ path = $l.Substring(9).Replace('/', '\'); branch = '(detached)' }; $wts += $cur }
    elseif ($l -like 'branch *' -and $cur) { $cur.branch = ($l.Substring(7) -replace '^refs/heads/', '') }
}

$pick = @()
foreach ($w in $wts) {
    if (-not (Test-Path $w.path)) { continue }
    $ct = git -C $w.path log -1 --format=%ct 2>$null
    $recent = $false
    if ($ct) { $recent = ([int64]$ct -ge $cut) }
    if (($Always -contains $w.path) -or $recent) { $pick += $w }
}
$pick = @($pick | Sort-Object { if ($Always -contains $_.path) { 0 } else { 1 } } | Select-Object -First $Max)

foreach ($w in $pick) {
    $title = 'UCT - ' + $w.branch
    $cmd = "Set-Location -LiteralPath '$($w.path)'; `$Host.UI.RawUI.WindowTitle = '$title'; git status -sb | Select-Object -First 3"
    Start-Process powershell -ArgumentList @('-NoExit', '-Command', $cmd) | Out-Null
    Write-Host ('  opened  {0,-50} {1}' -f $title, $w.path)
}
if ($pick.Count -eq 0) { Write-Host '  no active worktrees found' -ForegroundColor Red }
