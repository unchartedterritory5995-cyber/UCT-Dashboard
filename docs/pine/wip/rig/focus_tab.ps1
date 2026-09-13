param([string]$Match = "UCT Intelligence", [int]$TabIndex = 2)
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class WE {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
$found = [IntPtr]::Zero
$title = ""
$cb = [WE+EnumProc]{
  param($h, $l)
  if (-not [WE]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [WE]::GetWindowText($h, $sb, 512) | Out-Null
  $t = $sb.ToString()
  if ($t -like "*$Match*" -and $t -like "*Chrome*") {
    $script:found = $h; $script:title = $t; return $false
  }
  return $true
}
[WE]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($found -eq [IntPtr]::Zero) { Write-Output "NOT_FOUND: $Match"; exit 1 }
[WE]::ShowWindow($found, 9) | Out-Null
$fg  = [WE]::GetForegroundWindow()
$tid = [WE]::GetWindowThreadProcessId($fg, [ref]$null)
$cur = [WE]::GetCurrentThreadId()
[WE]::AttachThreadInput($cur, $tid, $true) | Out-Null
[WE]::BringWindowToTop($found) | Out-Null
[WE]::SetForegroundWindow($found) | Out-Null
[WE]::AttachThreadInput($cur, $tid, $false) | Out-Null
Start-Sleep -Milliseconds 350
if ($TabIndex -gt 0) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait("^$TabIndex")
  Start-Sleep -Milliseconds 350
}
Write-Output ("FOCUSED [" + $title + "] tab=" + $TabIndex)
