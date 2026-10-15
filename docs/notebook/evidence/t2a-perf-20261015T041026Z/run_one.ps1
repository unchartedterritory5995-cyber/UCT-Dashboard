# One typing run of tools/notebook_perf_harness.py through runner.py, in a fresh sandbox data dir (never C:\data).
#   .\run_one.ps1 -Name on-plain-r1 -Chips on|off [-Blocks] [-AlertCaret]
# The harness's own arguments are exactly the p2b-ab ones (docs/notebook/perf-runs/p2b-ab/RESULT.md, commit
# 8bdf38beb2): --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60 [--with-blocks]. `--out` is NOT a flag of
# this harness; its outputs go next to `--json` (`--md`, and the launcher's integrity log is moved beside them).
# The ONLY env difference between an `on` and an `off` run is NOTEBOOK_SMART_CHIPS_ENABLED, whose read sites are
# api/routers/auth.py:266 (NOTEBOOK_FLAGS, served on /api/auth/me) and api/routers/notebook_smart_chips.py:27.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][ValidateSet('on', 'off')][string]$Chips,
  [switch]$Blocks,
  [switch]$AlertCaret
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here '..\..\..\..')).Path
Set-Location $repo
$env:PYTHONIOENCODING = 'utf-8'
if ($Chips -eq 'on') { $env:NOTEBOOK_SMART_CHIPS_ENABLED = '1' } else { Remove-Item Env:NOTEBOOK_SMART_CHIPS_ENABLED -ErrorAction SilentlyContinue }
if ($AlertCaret) { $env:T2A_ALERT_CARET = '1' } else { Remove-Item Env:T2A_ALERT_CARET -ErrorAction SilentlyContinue }
$env:T2A_FLAGCHECK = Join-Path $here "$Name.flagcheck.json"
$data = "C:\data-t2a-typing-$Name"
if (Test-Path -LiteralPath $data) { throw "the sandbox data dir $data already exists; a run needs a fresh one" }

function Box([string]$point) {
  $mem = (Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
  $cpu = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 5).CounterSamples | ForEach-Object { $_.CookedValue }
  $m = ($cpu | Measure-Object -Average -Maximum)
  $line = '{0} {1,-22} available_MB={2,6:N0} cpu_mean={3,5:N1} cpu_max={4,5:N1}' -f (Get-Date -Format HH:mm:ss), $point, $mem, $m.Average, $m.Maximum
  Add-Content -LiteralPath (Join-Path $here "$Name.box.txt") -Value $line -Encoding utf8
  $line
}

$argsList = @('docs\notebook\evidence\t2a-perf-20261015T041026Z\runner.py', '--boot', '--busy', '--data-dir', $data, '--port', '8095',
  '--sizes', '1,1000,2000', '--opens', '20', '--chars', '60',
  '--json', (Join-Path $here "$Name.json"), '--md', (Join-Path $here "$Name.md"))
if ($Blocks) { $argsList += '--with-blocks' }
Box "before $Name" | Out-Host
$stamp = Get-Date -Format o
python @argsList *> (Join-Path $here "$Name.run.log")
$code = $LASTEXITCODE
Box "after $Name" | Out-Host
Add-Content -LiteralPath (Join-Path $here "$Name.box.txt") -Value "started=$stamp exit=$code" -Encoding utf8
"$Name exit=$code"
exit $code
