# Hourly stacked-push audit — see docs/breadth/gates.md.
#
# Appends to logs/stacked-push-audit.log, which is GITIGNORED on purpose: a
# scheduled job writing into a tracked file would leave the tree permanently dirty,
# and scripts/gate_shards.py refuses a dirty tree — every gate run would then come
# back INVALID for a reason that has nothing to do with the branch under test.
#
# ⛔ It reports SUSPECTED, never CONFIRMED. Railway's deployment list carries only
# `status` and `createdAt`, so it can show that two distinct commits were deployed
# closer together than a build takes and cannot show the first was still building.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'logs') | Out-Null
$log = Join-Path $repo 'logs/stacked-push-audit.log'
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + ' UTC'

try {
    $out = & python tools/pre_push_guard.py --audit 2>&1
} catch {
    # ⛔ An unreadable run is recorded as unreadable. "No findings" and "could not
    # look" must never share a line in a log somebody will later read as clean.
    $out = "AUDIT FAILED TO RUN: $($_.Exception.Message)"
}

Add-Content -Path $log -Value "=== $stamp ==="
Add-Content -Path $log -Value $out
