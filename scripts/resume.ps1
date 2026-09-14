<#
  scripts/resume.ps1 - restart resume for the Discord render hardening program.

  Idempotent and read-only: prints docs/RESUME.md, runs the verification checklist (RESUME.md section g),
  prints every worktree's live state, opens one window per active worktree (scripts/resume-windows.ps1),
  and prints the prompt to paste into Claude Code. It never writes, pushes or deploys.
  Every external call has a timeout; a failed check prints a red line and the script continues.

  Usage:  powershell -ExecutionPolicy Bypass -File C:\Users\Patrick\uct-worktrees\discord-render\scripts\resume.ps1 [-NoWindows]
#>
param([switch]$NoWindows)

$ErrorActionPreference = 'Continue'
$Repo = 'C:\Users\Patrick\uct-worktrees\discord-render'
$Branch = 'discord-render-hardening'
$CodeTip = '3f71d5364'
$LastOnMaster = 'd32d14d60'
$Site = 'https://uctintelligence.com'
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

function Ok($m)   { Write-Host "  [ OK ] $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Info($m) { Write-Host "  [INFO] $m" -ForegroundColor Cyan }

function Invoke-Bounded {
    param([scriptblock]$Block, [object[]]$ArgList = @(), [int]$Seconds = 60)
    $job = Start-Job -ScriptBlock $Block -ArgumentList $ArgList
    if (Wait-Job $job -Timeout $Seconds) {
        $out = Receive-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -Force
        return ,$out
    }
    Stop-Job $job
    Remove-Job $job -Force
    return $null
}

function Get-Status {
    param([string]$Method, [string]$Url, [string]$Body = $null, [hashtable]$Headers = @{})
    try {
        $p = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; UserAgent = $UA; TimeoutSec = 25; Headers = $Headers }
        if ($Body) { $p.Body = $Body; $p.ContentType = 'application/json' }
        $r = Invoke-WebRequest @p
        return [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return -1
    }
}

Write-Host ''
Write-Host '=== docs/RESUME.md ===' -ForegroundColor Yellow
if (Test-Path "$Repo\docs\RESUME.md") { Get-Content "$Repo\docs\RESUME.md" } else { Bad "missing $Repo\docs\RESUME.md" }

Write-Host ''
Write-Host '=== Verification (RESUME.md section g) ===' -ForegroundColor Yellow

# 1. clean tree
if (-not (Test-Path $Repo)) { Bad "worktree missing: $Repo" }
else {
    Set-Location $Repo
    $dirty = git status --porcelain 2>$null
    if ([string]::IsNullOrWhiteSpace(($dirty | Out-String))) { Ok 'worktree clean' } else { Bad "worktree dirty:`n$($dirty | Out-String)" }

    # 2. code tip present, branch pushed
    git merge-base --is-ancestor $CodeTip HEAD 2>$null
    if ($LASTEXITCODE -eq 0) { Ok "HEAD contains code tip $CodeTip ($(git rev-parse --short HEAD))" } else { Bad "HEAD does not contain $CodeTip" }
    $fetched = Invoke-Bounded -Block { param($r) Set-Location $r; git fetch -q origin 2>&1; 'done' } -ArgList @($Repo) -Seconds 90
    if ($null -eq $fetched) { Bad 'git fetch timed out (network or credentials)' }
    $head = (git rev-parse HEAD).Trim()
    $remote = (git rev-parse "origin/$Branch" 2>$null)
    if ($remote -and $remote.Trim() -eq $head) { Ok "origin/$Branch == HEAD" } else { Bad "origin/$Branch is not HEAD (push the branch)" }

    # 3. master drift (information)
    $behind = (git rev-list --count "HEAD..origin/master" 2>$null)
    Info "origin/master is $behind commit(s) ahead of this branch (merge it before new work)"
}

# 4 + 5. Railway deployments
$rail = {
    param($svc)
    $raw = railway deployment list --service $svc --json 2>$null | Out-String
    try { $d = $raw | ConvertFrom-Json; if ($d.Count -gt 0) { return "{0}|{1}" -f $d[0].status, $d[0].meta.commitHash } } catch { }
    return 'ERROR|'
}
foreach ($svc in @('web', 'chart-renderer')) {
    $res = Invoke-Bounded -Block $rail -ArgList @($svc) -Seconds 75
    if ($null -eq $res) { Bad "railway $svc timed out (run: railway login)"; continue }
    $parts = ([string]$res).Trim().Split('|')
    $status = $parts[0]; $commit = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    if ($status -eq 'SUCCESS') { Ok "$svc newest deployment SUCCESS $commit" }
    elseif ($status -eq 'ERROR') { Bad "${svc}: could not read deployments (railway login / railway link?)" }
    else { Bad "$svc newest deployment is $status $commit" }
    if ($svc -eq 'web' -and $commit) {
        git -C $Repo merge-base --is-ancestor $LastOnMaster $commit 2>$null
        if ($LASTEXITCODE -eq 0) { Ok "running web commit contains $LastOnMaster" } else { Bad "running web commit $commit does not contain $LastOnMaster (or is not fetched)" }
    }
}

# 6-8. HTTP
$h = Get-Status -Method Get -Url "$Site/api/health"
if ($h -eq 200) { Ok '/api/health 200' } else { Bad "/api/health returned $h" }
$ts = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$s = Get-Status -Method Post -Url "$Site/api/discord/interactions" -Body '{"type":1}' -Headers @{ 'X-Signature-Ed25519' = ('00' * 64); 'X-Signature-Timestamp' = $ts }
if ($s -eq 401) { Ok 'interactions endpoint refuses a bad signature (401)' } else { Bad "interactions endpoint returned $s for a bad signature" }
$rh = Get-Status -Method Get -Url "$Site/api/discord/render-health"
if ($rh -eq 401) { Ok 'render-health route live and gated (401 without bearer)' } else { Bad "render-health returned $rh" }

Write-Host ''
Write-Host '=== Every worktree (live) ===' -ForegroundColor Yellow
$lines = git -C 'C:\Users\Patrick\uct-dashboard' worktree list --porcelain 2>$null
$cur = $null
foreach ($l in $lines) {
    if ($l -like 'worktree *') { $cur = @{ path = $l.Substring(9); branch = '(detached)' } }
    elseif ($l -like 'branch *' -and $cur) { $cur.branch = ($l.Substring(7) -replace '^refs/heads/', '') }
    elseif ([string]::IsNullOrWhiteSpace($l) -and $cur) {
        $p = $cur.path.Replace('/', '\')
        if (Test-Path $p) {
            $n = (git -C $p status --porcelain 2>$null | Measure-Object).Count
            $sha = (git -C $p rev-parse --short HEAD 2>$null)
            $line = '{0,-40} {1,-10} dirty={2,-4} {3}' -f $cur.branch, $sha, $n, $p
            if ($n -gt 0) { Write-Host "  $line" -ForegroundColor Magenta } else { Write-Host "  $line" }
        }
        $cur = $null
    }
}

Write-Host ''
Write-Host '=== Processes to start ===' -ForegroundColor Yellow
Info 'None for the Discord render program (no dev server, bench, soak or watcher was running). Task Scheduler jobs resume on their own.'

if (-not $NoWindows) {
    Write-Host ''
    Write-Host '=== Windows ===' -ForegroundColor Yellow
    $w = Join-Path $Repo 'scripts\resume-windows.ps1'
    if (Test-Path $w) { & $w } else { Bad "missing $w" }
}

Write-Host ''
Write-Host '=== Paste this into Claude Code (in the discord-render window) ===' -ForegroundColor Yellow
Write-Host '  Read docs/RESUME.md in C:\Users\Patrick\uct-worktrees\discord-render and continue the Discord render program from "The very next action" (2.1-2.4a are live and dark at d623baf1d; start step 2.4b).' -ForegroundColor White
Write-Host ''
