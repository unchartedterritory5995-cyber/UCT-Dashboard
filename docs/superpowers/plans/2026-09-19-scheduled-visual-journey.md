# Scheduled Full-Journey Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `tools/c0_visual_journey.py`'s full import→render→save→reload journey against
the primary corpus every night, unattended, without needing a human to invoke it.

**Architecture:** A PowerShell wrapper script boots a lightweight local backend (heavy jobs
disabled, matching this repo's existing `mobile_audit.py` tight-loop recipe) and the frontend
dev server on the port `c0_visual_journey.py` already documents as its own example
(`127.0.0.1:18500`), waits for both to be ready, runs the harness against
`tools/c0_oos_fixtures/`, tears both servers down, and writes a dated report. A Windows
Task Scheduler job runs the wrapper nightly, following this repo's existing
`"UCT <Program> <Verb>"` naming and `Register-ScheduledTask` registration convention.

**Tech Stack:** PowerShell, the existing `uvicorn`/`npm run dev` local-run recipe, Playwright
(already a dependency via `c0_visual_journey.py`), Windows Task Scheduler.

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md`
§4.2 (nightly piece) and §6 OD1.

## Global Constraints

- Resolves OD1: this runs **locally via Task Scheduler, not GitHub Actions** — this repo's
  existing heavy/full-stack Playwright checks (`mobile_audit.py`, hub sandbox boots) are
  uniformly local, and standing up a representative full app (real API keys, SQLite,
  external services) inside a hosted CI runner would be new infrastructure of its own, not
  a rewiring of what exists. Stated plainly in Task 1 rather than left implicit.
- Never run during any other scheduled job's window. Existing weekday jobs (from `CLAUDE.md`):
  7:00a scanner · 6:35a morning_wire · 5:00a wire_critic · 3:15p breadth_collector · 3:20p
  UCT20 EOD · 3:30p brain pre-close · 4:05p eod_updater · 8:05p market_ingest (all ET except
  scanner, which is CT). This job runs **01:00 CT / 02:00 ET**, clear of all of them.
- Must not touch port `8077` (owned by the hub sandbox per `CLAUDE.md`) or any other
  in-use local port — uses `18500`, the port `c0_visual_journey.py`'s own `--base` usage
  example already documents, so it matches existing convention rather than inventing one.
- Heavy background jobs disabled via the exact env-var set `mobile_audit.py`'s recipe uses
  (`WORKER_ENABLED=0`, `CATALYST_ENGINE_ENABLED=0`, `TWITTERAPI_IO_ENABLED=0`,
  `BARS_PREWARM_DISABLED=1`, `TICKER_NAMES_PREWARM_DISABLED=1`) plus a dedicated
  `ADMIN_EMAILS` test account, so this job never contends for the same resources a real
  member-facing request would need.

---

### Task 1: Wrapper script — boot, run, teardown, report

**Files:**
- Create: `scripts/run_nightly_visual_journey.ps1`
- Create: `scripts/nightly_visual_journey_report.py`
- Test: `tests/test_nightly_visual_journey_report.py`

**Interfaces:**
- Consumes: `tools/c0_visual_journey.py`'s existing CLI (`--base`, `--fixtures`, `--out`,
  `--email`/`--password` via `C0_EMAIL`/`C0_PASSWORD` env, `--limit`, `--keep`) — confirmed
  at `tools/c0_visual_journey.py:884-892`. No changes to that script.
- Produces: a JSON report at `docs/pine/nightly-journey/<YYYY-MM-DD>.json` with shape
  `{"date": str, "base": str, "fixtures_dir": str, "exit_code": int, "rows": list, "backend_boot_ok": bool, "frontend_boot_ok": bool}`
  — this is what Task 2's Task Scheduler registration checks for on next-day verification,
  and what any future dashboard/report-only CI hook (out of scope here) would read.

- [ ] **Step 1: Write the failing test for the report writer**

```python
# tests/test_nightly_visual_journey_report.py
import json
from pathlib import Path

from scripts.nightly_visual_journey_report import write_report


def test_write_report_creates_dated_json(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    journey_report = {
        "base": "http://127.0.0.1:18500",
        "fixtures": "tools/c0_oos_fixtures",
        "rows": [{"file": "high_engagement__02-waddah-attar-explosion-lazybear.pine", "ok": True}],
    }
    out_path = write_report(
        journey_report=journey_report,
        exit_code=0,
        backend_boot_ok=True,
        frontend_boot_ok=True,
        date_str="2026-09-20",
    )
    assert out_path == Path("docs/pine/nightly-journey/2026-09-20.json")
    saved = json.loads(out_path.read_text(encoding="utf-8"))
    assert saved["date"] == "2026-09-20"
    assert saved["exit_code"] == 0
    assert saved["backend_boot_ok"] is True
    assert saved["rows"] == journey_report["rows"]


def test_write_report_records_boot_failure_without_rows(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    out_path = write_report(
        journey_report=None,
        exit_code=1,
        backend_boot_ok=False,
        frontend_boot_ok=False,
        date_str="2026-09-20",
    )
    saved = json.loads(out_path.read_text(encoding="utf-8"))
    assert saved["backend_boot_ok"] is False
    assert saved["rows"] == []
    assert saved["exit_code"] == 1


def test_cli_reads_journey_report_file_and_writes_dated_report(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    journey_report_path = tmp_path / "report.json"
    journey_report_path.write_text(
        json.dumps({"base": "http://127.0.0.1:18500", "fixtures": "tools/c0_oos_fixtures", "rows": [{"file": "x.pine", "ok": True}]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "nightly_visual_journey_report.py",
            "--journey-report-path", str(journey_report_path),
            "--exit-code", "0",
            "--backend-boot-ok", "true",
            "--frontend-boot-ok", "true",
        ],
    )
    from scripts.nightly_visual_journey_report import _main
    assert _main() == 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    saved = json.loads(Path(f"docs/pine/nightly-journey/{today}.json").read_text(encoding="utf-8"))
    assert saved["rows"] == [{"file": "x.pine", "ok": True}]


def test_cli_handles_missing_journey_report_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "sys.argv",
        [
            "nightly_visual_journey_report.py",
            "--exit-code", "1",
            "--backend-boot-ok", "false",
            "--frontend-boot-ok", "false",
        ],
    )
    from scripts.nightly_visual_journey_report import _main
    assert _main() == 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    saved = json.loads(Path(f"docs/pine/nightly-journey/{today}.json").read_text(encoding="utf-8"))
    assert saved["rows"] == []
    assert saved["backend_boot_ok"] is False
```

Add the needed import at the top of the test file alongside the existing ones:

```python
from datetime import datetime, timezone
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_nightly_visual_journey_report.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.nightly_visual_journey_report'`

- [ ] **Step 3: Write the report writer**

```python
# scripts/nightly_visual_journey_report.py
"""Writes the nightly visual-journey run's dated JSON report.

Kept separate from run_nightly_visual_journey.ps1 (which drives the actual
Playwright journey) so the report SHAPE has its own test, independent of
booting a real backend/frontend.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def write_report(
    *,
    journey_report: dict | None,
    exit_code: int,
    backend_boot_ok: bool,
    frontend_boot_ok: bool,
    date_str: str | None = None,
) -> Path:
    date_str = date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_dir = Path("docs/pine/nightly-journey")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{date_str}.json"

    payload = {
        "date": date_str,
        "base": (journey_report or {}).get("base"),
        "fixtures_dir": (journey_report or {}).get("fixtures"),
        "exit_code": exit_code,
        "backend_boot_ok": backend_boot_ok,
        "frontend_boot_ok": frontend_boot_ok,
        "rows": (journey_report or {}).get("rows", []),
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path


def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--journey-report-path", default=None,
                         help="Path to c0_visual_journey.py's own report.json, or omit if the journey never ran")
    parser.add_argument("--exit-code", type=int, required=True)
    parser.add_argument("--backend-boot-ok", choices=["true", "false"], required=True)
    parser.add_argument("--frontend-boot-ok", choices=["true", "false"], required=True)
    args = parser.parse_args()

    journey_report = None
    if args.journey_report_path and Path(args.journey_report_path).exists():
        journey_report = json.loads(Path(args.journey_report_path).read_text(encoding="utf-8"))

    out_path = write_report(
        journey_report=journey_report,
        exit_code=args.exit_code,
        backend_boot_ok=args.backend_boot_ok == "true",
        frontend_boot_ok=args.frontend_boot_ok == "true",
    )
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_nightly_visual_journey_report.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Write the PowerShell wrapper**

```powershell
# scripts/run_nightly_visual_journey.ps1
# Boots a lightweight local backend+frontend, runs the full c0_visual_journey.py
# corpus pass against it, tears both down, and writes a dated report. Meant to be
# invoked by the "UCT Visual Journey Nightly" Task Scheduler job (Task 2), but is
# runnable by hand for manual verification (Task 3).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$env:ADMIN_EMAILS = "visualjourney@local.dev"
$env:WORKER_ENABLED = "0"
$env:CATALYST_ENGINE_ENABLED = "0"
$env:TWITTERAPI_IO_ENABLED = "0"
$env:BARS_PREWARM_DISABLED = "1"
$env:TICKER_NAMES_PREWARM_DISABLED = "1"
$env:C0_EMAIL = "gj_automation@local.dev"
$env:C0_PASSWORD = "OosTest2026!"

$backendPort = 18501
$frontendPort = 18500
$backendOk = $false
$frontendOk = $false
$exitCode = 1

$backendProc = Start-Process -PassThru -NoNewWindow `
    -FilePath "python" `
    -ArgumentList "-m", "uvicorn", "api.main:app", "--port", "$backendPort"

$frontendProc = Start-Process -PassThru -NoNewWindow `
    -WorkingDirectory "$repoRoot\app" `
    -FilePath "npm" `
    -ArgumentList "run", "dev", "--", "--port", "$frontendPort"

try {
    # Poll each server's own port rather than sleeping a fixed guess (a fixed
    # sleep is exactly the "sampling where a waiter was available" mistake this
    # repo's own CLAUDE.md warns about).
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$backendPort/api/health" -TimeoutSec 2 | Out-Null
            $backendOk = $true
            break
        } catch { Start-Sleep -Seconds 2 }
    }

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort" -TimeoutSec 2 | Out-Null
            $frontendOk = $true
            break
        } catch { Start-Sleep -Seconds 2 }
    }

    $reportPath = $null
    if ($backendOk -and $frontendOk) {
        $outDir = "tools/c0_out/$(Get-Date -Format 'yyyy-MM-dd')"
        python tools/c0_visual_journey.py `
            --base "http://127.0.0.1:$frontendPort" `
            --fixtures "tools/c0_oos_fixtures" `
            --out $outDir
        $exitCode = $LASTEXITCODE
        $reportPath = Join-Path $outDir "report.json"
    }
} finally {
    Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
}

$backendOkStr = if ($backendOk) { "true" } else { "false" }
$frontendOkStr = if ($frontendOk) { "true" } else { "false" }

$reportArgs = @(
    "scripts/nightly_visual_journey_report.py",
    "--exit-code", "$exitCode",
    "--backend-boot-ok", $backendOkStr,
    "--frontend-boot-ok", $frontendOkStr
)
if ($reportPath -and (Test-Path $reportPath)) {
    $reportArgs += @("--journey-report-path", $reportPath)
}
python @reportArgs

exit $exitCode
```

- [ ] **Step 6: Commit**

```bash
git add scripts/run_nightly_visual_journey.ps1 scripts/nightly_visual_journey_report.py tests/test_nightly_visual_journey_report.py
git commit -m "feat: add nightly visual-journey wrapper and dated report writer"
```

---

### Task 2: Register the Task Scheduler job

**Files:**
- Create: `scripts/register_nightly_visual_journey_task.ps1`

**Interfaces:**
- Consumes: `scripts/run_nightly_visual_journey.ps1` from Task 1 (invoked as the
  scheduled action).
- Produces: a registered Windows Scheduled Task named `"UCT Visual Journey Nightly"`,
  matching this repo's confirmed `"UCT <Program> <Verb>"` naming convention.

- [ ] **Step 1: Write the registration script**

```powershell
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
```

- [ ] **Step 2: Run it once to register**

Run: `pwsh -File scripts/register_nightly_visual_journey_task.ps1`
Expected output: `Registered 'UCT Visual Journey Nightly' -> daily 01:00 CT, action: ...`

- [ ] **Step 3: Confirm registration**

Run: `Get-ScheduledTask -TaskName "UCT Visual Journey Nightly" | Select-Object TaskName, State`
Expected: `State` is `Ready`.

- [ ] **Step 4: Commit**

```bash
git add scripts/register_nightly_visual_journey_task.ps1
git commit -m "feat: register nightly visual-journey Task Scheduler job"
```

---

### Task 3: Manual verification run (a scheduled job nobody has seen fire is not a working job)

**Files:**
- None created — this task is a verification checklist, not new code, per the spec's
  §5 testing-strategy requirement that a workflow/job be proven to actually run before
  anything depends on it.

**Interfaces:**
- Consumes: Task 1's wrapper script, Task 2's registered task.
- Produces: one real `docs/pine/nightly-journey/<today>.json` file, proving the whole
  chain works end-to-end — this is the deliverable that closes this plan.

- [ ] **Step 1: Manually trigger the registered task**

Run: `Start-ScheduledTask -TaskName "UCT Visual Journey Nightly"`

- [ ] **Step 2: Wait for completion and check its last run result**

Run: `Get-ScheduledTaskInfo -TaskName "UCT Visual Journey Nightly"`
Expected: `LastTaskResult` is `0` once it finishes (poll every 30s; a full corpus
pass against 18 scripts is expected to take several minutes, not seconds — do not
treat an in-progress run as a failure).

- [ ] **Step 3: Confirm the dated report was actually written, with real rows**

Run: `Get-Content "docs\pine\nightly-journey\$(Get-Date -Format 'yyyy-MM-dd').json" | ConvertFrom-Json | Select-Object exit_code, backend_boot_ok, frontend_boot_ok`
Expected: `exit_code: 0`, both boot flags `True`. Then confirm `rows` is non-empty:
`(Get-Content "docs\pine\nightly-journey\$(Get-Date -Format 'yyyy-MM-dd').json" | ConvertFrom-Json).rows.Count`
Expected: greater than 0 (18, matching `c0_oos_fixtures`' current script count, unless
Plan 1's gap-filling has since added more).

- [ ] **Step 4: Commit the first real report as evidence this plan is done**

```bash
git add "docs/pine/nightly-journey/"
git commit -m "chore: first verified nightly visual-journey run"
```
