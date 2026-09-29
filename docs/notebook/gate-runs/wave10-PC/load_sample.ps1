# Lane PC load sampler: one line per call, appended to the file named by $args[0].
# Records the box's CPU % and every foreign test/browser process (vitest, pytest,
# gate_shards, playwright, hub_sandbox) by pid and command-line head, so every
# curve reading carries the load it was taken under.
param([string]$Out, [string]$Tag = "")
$pat = 'vitest|pytest|gate_shards|playwright|hub_sandbox'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pat -and $_.CommandLine -notmatch 'load_sample' }
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$mem = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
$ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
$line = "$ts tag=$Tag cpu=$cpu free_mb=$mem foreign_procs=$(@($procs).Count)"
Add-Content -Path $Out -Value $line
foreach ($p in $procs) {
  $cl = $p.CommandLine
  if ($cl.Length -gt 140) { $cl = $cl.Substring(0, 140) }
  Add-Content -Path $Out -Value "    pid=$($p.ProcessId) $($p.Name) :: $cl"
}
