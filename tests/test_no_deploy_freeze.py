"""Production promotion NEVER holds on a time window (owner ruling, 2026-11-27).

Owner, verbatim: "fuck the deploy freeze i dont ever want to hold anything back from deploying ever".

Until this ruling `tools/deploy_freeze.py` held the `web` + `bars-api` promotion 09:20-16:15 ET on every NYSE trading
day (to close + 15 on a half-day) and inside the Wednesday 09:00-11:00 ET measurement window, and
`.github/workflows/promote-production.yml` waited in-job, recorded the SHA PENDING and resumed it later. These rails
pin the opposite: at every clock the freeze answers NOT FROZEN, there is no freeze end to wait for, and the promote
job's real `run:` blocks (tools/promote_dryrun.py) fast-forward a gated SHA without waiting.

The GATE is unchanged: a SHA whose own checks did not pass still never promotes (tests/test_promote_decision.py).
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
WF = ROOT / ".github" / "workflows" / "promote-production.yml"


@pytest.fixture()
def df():
    spec = importlib.util.spec_from_file_location("_df_no_freeze", ROOT / "tools" / "deploy_freeze.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _et(y, m, d, hh, mm):
    from zoneinfo import ZoneInfo
    return dt.datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("America/New_York")).astimezone(UTC)


#: (label, instant): the clocks the old freeze held. Each must now promote with no wait.
FORMERLY_HELD = [
    ("Tue 09:31 ET, the opening rush", _et(2026, 11, 10, 9, 31)),
    ("Fri 2026-11-27 12:45 ET, a half-day's closing rush", _et(2026, 11, 27, 12, 45)),
    ("Wed 10:00 ET, the measurement window", _et(2026, 10, 14, 10, 0)),
    ("Wed 2026-11-11 09:05 ET, the measurement window (EST)", _et(2026, 11, 11, 9, 5)),
    ("Thu 15:45 ET, the closing rush", _et(2026, 10, 15, 15, 45)),
    ("Tue 11:00 ET, the regular session", _et(2026, 11, 10, 11, 0)),
]


@pytest.mark.parametrize("label,now", FORMERLY_HELD, ids=[x[0] for x in FORMERLY_HELD])
def test_no_hold_at_a_formerly_held_clock(df, label, now):
    code, why = df.decide(now)
    assert code == df.EXIT_OPEN and why.startswith("NOT FROZEN"), (label, why)
    assert df.freeze_ends_at(now) is None, label
    assert df.wait_plan(now)[0] == 0, label


def test_no_hold_at_any_minute_of_a_trading_week_even_with_a_broken_calendar(df, monkeypatch):
    def broken():
        raise RuntimeError("calendar unreadable")
    start = _et(2026, 11, 23, 0, 0)          # Mon 2026-11-23 .. Sun 2026-11-29: regular days, a holiday, a half-day
    for calendar in ("real", "broken"):
        if calendar == "broken":
            monkeypatch.setattr(df, "_calendar_module", broken)
        t = start
        while t < start + dt.timedelta(days=7):
            assert df.decide(t)[0] == df.EXIT_OPEN, (calendar, t)
            assert df.freeze_ends_at(t) is None, (calendar, t)
            assert df.wait_plan(t)[0] == 0, (calendar, t)
            t += dt.timedelta(minutes=5)


def test_injected_window_readers_cannot_bring_the_hold_back(df):
    """A caller that passes 'always inside' readers (the old test seams) still gets NOT FROZEN: nothing is consulted."""
    now = _et(2026, 10, 14, 10, 0)
    always = lambda _n: True  # noqa: E731
    rush = lambda _n: "session"  # noqa: E731
    assert df.decide(now, in_window_fn=always, burst_fn=rush)[0] == df.EXIT_OPEN
    assert df.freeze_ends_at(now, in_window_fn=always, burst_fn=rush) is None
    assert df.wait_plan(now, in_window_fn=always, burst_fn=rush)[0] == 0


@pytest.mark.parametrize("iso", ["2026-11-10T14:31:00Z", "2026-11-27T17:45:00Z", "2026-10-14T14:00:00Z",
                                 "2026-10-15T19:45:00Z"])
def test_the_cli_answers_not_frozen_and_writes_frozen_no(iso, tmp_path):
    out_file = tmp_path / "gh_output"
    p = subprocess.run([sys.executable, "-B", str(ROOT / "tools" / "deploy_freeze.py"), "--now", iso],
                       capture_output=True, text=True, timeout=120,
                       env={**__import__("os").environ, "GITHUB_OUTPUT": str(out_file)})
    assert p.returncode == 0 and "NOT FROZEN" in p.stdout, p.stdout + p.stderr
    assert out_file.read_text().strip() == "frozen=no"
    w = subprocess.run([sys.executable, "-B", str(ROOT / "tools" / "deploy_freeze.py"), "--now", iso, "--wait-plan"],
                       capture_output=True, text=True, timeout=120,
                       env={**__import__("os").environ, "GITHUB_OUTPUT": str(out_file)})
    assert w.returncode == 0 and out_file.read_text().strip().splitlines()[-1] == "wait_s=0", w.stdout


def test_the_self_check_passes(df, capsys):
    assert df.self_check() == 0, capsys.readouterr().out


# -- the promote job itself: a gated SHA promotes at once ----------------------------------------------------------

_HAVE_BASH = shutil.which("bash") is not None and shutil.which("git") is not None


@pytest.mark.skipif(not _HAVE_BASH, reason="the dry run executes the workflow's bash blocks")
@pytest.mark.parametrize("iso", ["2026-11-10T14:31:00Z", "2026-11-27T17:45:00Z", "2026-10-14T14:00:00Z",
                                 "2026-10-15T19:45:00Z"])
def test_the_promote_job_promotes_a_gated_sha_without_waiting(iso):
    p = subprocess.run([sys.executable, str(ROOT / "tools" / "promote_dryrun.py"), "--now", iso],
                       capture_output=True, text=True, timeout=300)
    out = p.stdout + p.stderr
    assert p.returncode == 0, out[-3000:]
    assert "CONTROL (expect promote): action PROMOTE" in out, out[-3000:]
    # nothing was held, recorded pending for a freeze, or slept on
    assert "--- wait: skipped" in out, out[-3000:]
    assert "--- Record the SHA as PENDING (before waiting): skipped" in out, out[-3000:]
    assert "would sleep" not in out


def test_the_pr_dry_run_expects_promotion_at_every_formerly_held_clock():
    import yaml
    dry = yaml.safe_load(WF.read_text(encoding="utf-8"))["jobs"]["dryrun"]
    runs = [str(s.get("run", "")) for s in dry["steps"]]
    dry_runs = [r for r in runs if "tools/promote_dryrun.py" in r]
    assert dry_runs, "the PR dry run must still execute tools/promote_dryrun.py"
    assert not any("--expect hold" in r for r in dry_runs), "no dry-run step may expect a HOLD any more"
    for iso in ("2026-11-10T14:31:00Z", "2026-11-27T17:45:00Z", "2026-10-14T14:00:00Z", "2026-10-15T19:45:00Z"):
        assert any(f"--now {iso}" in r for r in dry_runs), iso


def test_the_workflow_keeps_the_gate():
    """No time hold, but a SHA still promotes only through its gating checks and its own gate."""
    wf = WF.read_text(encoding="utf-8")
    assert "python tools/promotion_gate.py --runs runs.json --workflows wf.json" in wf
    assert "promote_decision.py gate" in wf and "promote_decision.py decide" in wf
    assert "The triggering gate must have succeeded" in wf


# -- the override mechanism is gone, and stays gone ---------------------------------------------------------------------
#: The MECHANISM's identifiers, not the times: they can only exist if somebody rebuilt a way to pass a freeze override.
#: Records (docs/) may still name what was removed; only the live surfaces are scanned.
FORBIDDEN_OVERRIDE = ("freeze_override", "DEPLOY_FREEZE_OVERRIDE", "[freeze-override]", "OVERRIDE_TOKEN")
SCAN_DIRS = ("tools", "scripts", ".github")


def _live_files():
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for f in base.rglob("*"):
            if f.is_file() and f.suffix in (".py", ".sh", ".yml", ".yaml", ".json", ".md", ".txt", ".ps1", ".js", ".mjs"):
                yield f


def test_no_workflow_or_tool_passes_a_freeze_override():
    hits = []
    for f in _live_files():
        text = f.read_text(encoding="utf-8", errors="replace")
        hits += [f"{f.relative_to(ROOT).as_posix()}: {name}" for name in FORBIDDEN_OVERRIDE if name in text]
    assert hits == [], hits


def test_the_override_rail_can_fail(tmp_path):
    """CONTROL: the scan sees a planted override in a workflow-shaped file (else the rail above proves nothing)."""
    planted = "on:\n  workflow_dispatch:\n    inputs:\n      freeze_override:\n        required: false\n"
    assert any(name in planted for name in FORBIDDEN_OVERRIDE)
    wf_text = WF.read_text(encoding="utf-8")
    assert "freeze_override" not in wf_text and "workflow_dispatch:" in wf_text   # the real file has the door, not the input


# -- the promote job is short, and the hourly backup cannot cancel a pending promotion --------------------------------

def test_the_promote_job_is_45_minutes_and_its_wait_step_refuses_any_wait():
    import yaml
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    job = doc["jobs"]["promote"]
    assert job["timeout-minutes"] == 45
    wait = next(s for s in job["steps"] if s.get("id") == "wait")
    assert wait["timeout-minutes"] == 5
    assert '[ "$WAIT_S" -gt 0 ]' in wait["run"] and "exit 1" in wait["run"]


def test_no_cron_in_promote_production_the_backup_is_hourly_and_queue_safe():
    import yaml
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    on = doc.get("on", doc.get(True))
    assert "schedule" not in on, "a cron here joins the promotion queue and can cancel a pending promotion"
    hw = ROOT / ".github" / "workflows" / "promote-resume-hourly.yml"
    text = hw.read_text(encoding="utf-8")
    assert text.startswith("# promotion-gate: no")
    h = yaml.safe_load(text)
    hon = h.get("on", h.get(True))
    assert [c["cron"] for c in hon["schedule"]] == ["17 * * * *"]                     # every hour, every day
    assert h["permissions"] == {"contents": "read", "actions": "write"}
    assert h["concurrency"]["group"] != "promote-production"                      # never the promotion queue itself
    run = h["jobs"]["resume"]["steps"][-1]["run"]
    # dispatch ONLY with a pending SHA and an idle promotion queue, and only as a resume (never a SHA, never the tip)
    i_pending, i_idle, i_go = run.index("pending-promotion.json"), run.index('[ "$ACTIVE" != "0" ]'), run.index("gh workflow run")
    assert i_pending < i_idle < i_go
    assert "gh workflow run promote-production.yml -R \"$GITHUB_REPOSITORY\" --ref master -f resume=yes" in run
    assert run.count("gh workflow run") == 1 and "-f sha=" not in run
    assert "git push" not in run and "gh api --method" not in run

