# BelowNormal priority, TEMP under BN_TMP, cwd BN_CWD, then run the given command line (children inherit all three)
if ($env:BN_TMP) { $env:TEMP = $env:BN_TMP; $env:TMP = $env:BN_TMP }
if ($env:BN_CWD) { Set-Location $env:BN_CWD }
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'
$free = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)
Write-Output "[bn] free memory GB: $free"
& $args[0] $args[1..($args.Count-1)]
exit $LASTEXITCODE
