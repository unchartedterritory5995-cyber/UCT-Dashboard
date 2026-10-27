$SCR  = 'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\5effcdc4-7e7d-42f4-a3df-67b99c63791b\scratchpad'
$SBX  = "$SCR\sbx"
$WALK = "$SBX\walk"; $DEV = "$SBX\dev"
$IMPL = 'C:\Users\Patrick\uct-worktrees\nbw-p2-impl'
$PY   = 'C:\Python314\python.exe'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:TEMP = "$SCR\tmp-walk2"; $env:TMP = "$SCR\tmp-walk2"; $env:SBX_LOCKWATCH = '1'

function Start-Sbx($name, $dir, $port, $clock, $personas, $overrides) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "port $port busy: not ours, not touched" }
  $env:SBX_FLAG_OVERRIDES = $overrides
  $a = @("$SBX\boot_sandbox.py", '--clock', $clock, '--data-dir', $dir, '--port', $port, '--host', '127.0.0.1',
         '--app-root', $IMPL, '--test-email', 'hubtest@local.dev', '--personas', $personas)
  $p = Start-Process -FilePath $PY -ArgumentList $a -WorkingDirectory $IMPL -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput "$SBX\logs\$name.out.log" -RedirectStandardError "$SBX\logs\$name.err.log"
  "$($p.Id) $port $dir" | Set-Content "$SBX\pids\$name.pid"
  $deadline = (Get-Date).AddSeconds(400)
  do { Start-Sleep 2; try { $id = Invoke-RestMethod "http://127.0.0.1:$port/__uct_sandbox_identity" } catch { $id = $null } }
  until ($id -or $p.HasExited -or (Get-Date) -gt $deadline)
  if (-not $id -or $id.pid -ne $p.Id -or $id.data_dir -ne $dir) { throw "identity did not prove PID $($p.Id) on $dir" }
  $id | ConvertTo-Json -Depth 6 | Set-Content "$SBX\logs\$name.identity.json"
  "PID $($p.Id) port $port"
  Select-String -Path "$SBX\logs\$name.out.log","$SBX\logs\$name.err.log" -Pattern 'routine reminders registered','SHARED-ROOT WRITE BLOCKED','SHIFTED NOW','\[sbx\] flags' | ForEach-Object { $_.Line.Substring(0, [Math]::Min(400, $_.Line.Length)) }
}

function Stop-Sbx($name) {
  $pid0, $port, $dir = (Get-Content "$SBX\pids\$name.pid") -split ' ', 3
  try { $id = Invoke-RestMethod "http://127.0.0.1:$port/__uct_sandbox_identity" } catch { $id = $null }
  if ($id -and ($id.pid -ne [int]$pid0 -or $id.data_dir -ne $dir)) { throw "port $port is not ours any more; nothing killed" }
  Stop-Process -Id ([int]$pid0) -ErrorAction SilentlyContinue
  Start-Sleep 3
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "port $port still held" }
  Remove-Item "$SBX\pids\$name.pid"
  "stopped $name pid $pid0"
  Select-String -Path "$SBX\logs\$name.out.log","$SBX\logs\$name.err.log" -Pattern 'SHARED-ROOT WRITE BLOCKED'
}
