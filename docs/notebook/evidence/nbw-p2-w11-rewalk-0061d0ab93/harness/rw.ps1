$SCR  = 'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\5effcdc4-7e7d-42f4-a3df-67b99c63791b\scratchpad'
$WORK = "$SCR\rewalk-20261027091520-work"
$DATA = "$SCR\sbx-rewalk-20261027091520"
$IMPL = 'C:\Users\Patrick\uct-worktrees\nbw-p2-impl'
$PY   = 'C:\Python314\python.exe'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:TEMP = "$WORK\tmp"; $env:TMP = "$WORK\tmp"; $env:SBX_LOCKWATCH = '1'
$MEMBERS = 'P01,P04,P08,P14,P25,P28,P29,P35,P36,P40,P45,P46'

function Start-Rw($name, $port, $clock, $overrides) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "port $port busy: not ours, not touched" }
  $env:SBX_FLAG_OVERRIDES = $overrides
  $a = @("$WORK\boot_sandbox.py", '--clock', $clock, '--data-dir', $DATA, '--port', $port, '--host', '127.0.0.1',
         '--app-root', $IMPL, '--test-email', 'hubtest@local.dev', '--personas', $MEMBERS)
  $p = Start-Process -FilePath $PY -ArgumentList $a -WorkingDirectory $IMPL -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput "$WORK\logs\$name.out.log" -RedirectStandardError "$WORK\logs\$name.err.log"
  "$($p.Id) $port $DATA" | Set-Content "$WORK\pids\$name.pid"
  $deadline = (Get-Date).AddSeconds(400)
  do { Start-Sleep 2; try { $id = Invoke-RestMethod "http://127.0.0.1:$port/__uct_sandbox_identity" } catch { $id = $null } }
  until ($id -or $p.HasExited -or (Get-Date) -gt $deadline)
  if (-not $id -or $id.pid -ne $p.Id -or $id.data_dir -ne $DATA) { throw "identity did not prove PID $($p.Id) on $DATA" }
  $id | ConvertTo-Json -Depth 6 | Set-Content "$WORK\logs\$name.identity.json"
  "PID $($p.Id) port $port"
}

function Stop-Rw($name) {
  $pid0, $port, $dir = (Get-Content "$WORK\pids\$name.pid") -split ' ', 3
  try { $id = Invoke-RestMethod "http://127.0.0.1:$port/__uct_sandbox_identity" } catch { $id = $null }
  if ($id -and ($id.pid -ne [int]$pid0 -or $id.data_dir -ne $dir)) { throw "port $port is not ours any more; nothing killed" }
  Stop-Process -Id ([int]$pid0) -ErrorAction SilentlyContinue
  $t = (Get-Date).AddSeconds(30)
  while ((Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) -and (Get-Date) -lt $t) { Start-Sleep 1 }
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "port $port still held" }
  Remove-Item "$WORK\pids\$name.pid"
  "stopped $name pid $pid0"
}
