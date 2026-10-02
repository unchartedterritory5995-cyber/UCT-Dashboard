"""2026-10-02: the terminal-next-monitor's SCHEDULED path was unreachable in production.

`railway.json`'s monitor branch started
    exec python -m api.terminal_next_monitor_main --once "${MONITOR_JOB:-ticking}"
and MONITOR_JOB is NOT set on that service, so EVERY cron firing (16 a day) ran
`--once ticking`: `main()` returned from `run_job("ticking")` before `due_jobs()`
was ever consulted. options-log (16:30 ET), gate-check, cadence, catalyst and weekly
never ran from the cron, and `ticking` posted on every firing instead of at 09:12.

The fix: with MONITOR_JOB unset the branch passes NO `--once`, so `main()` takes the
`due_jobs()` path; a set MONITOR_JOB still runs exactly that one job.

These rails EXECUTE the real start command in a POSIX shell (a fake `python` on PATH
prints the argv it was given) and hand that argv to the real `main()`. They also pin
every OTHER branch byte-for-byte: this file is shared by web, worker, flow-worker,
bars-api and the breadth producer.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import shutil
import subprocess
from zoneinfo import ZoneInfo

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent
ET = ZoneInfo("America/New_York")

#: Every branch EXCEPT the monitor's, exactly as it stands. A change to any of them
#: is a change to another service's boot and does not belong in a monitor fix.
OTHER_BRANCHES = {
    "BREADTH_V2_PRODUCER_ENABLED": "exec python -m api.breadth_v2_producer_main",
    "BARS_API_ENABLED": "exec python -m api.bars_api_main",
    "FLOW_WORKER_ENABLED": "exec python -m api.flow_worker_main",
    "WORKER_ENABLED": "exec python -m api.worker_main",
    None: ("exec uvicorn api.main:app --host 0.0.0.0 --port $PORT --proxy-headers "
           "--forwarded-allow-ips='*' --timeout-graceful-shutdown 5"),
}
BRANCH_ORDER = ["BREADTH_V2_PRODUCER_ENABLED", "TERMINAL_NEXT_MONITOR_ENABLED",
                "BARS_API_ENABLED", "FLOW_WORKER_ENABLED", "WORKER_ENABLED", None]


def _start_command() -> str:
    return json.loads((REPO / "railway.json").read_text(encoding="utf-8"))["deploy"]["startCommand"]


def _branches(sc: str) -> dict:
    out = {}
    for flag, cmd in re.findall(r'(?:if|elif) \[ "\$\{(\w+):-0\}" = "1" \]; then (.*?);(?= elif| else)', sc):
        out[flag] = cmd
    m = re.search(r"; else (.*); fi$", sc)
    out[None] = m.group(1) if m else None
    return out


def test_every_other_services_branch_is_byte_identical():
    br = _branches(_start_command())
    assert list(br) == BRANCH_ORDER
    for flag, cmd in OTHER_BRANCHES.items():
        assert br[flag] == cmd, f"the {flag or 'web (else)'} branch changed: {br[flag]!r}"


def _argv_from_shell(tmp_path, env_extra: dict) -> list:
    """Run the REAL start command in sh; a fake `python` echoes its argv."""
    sh = shutil.which("sh")
    assert sh, "no POSIX sh on PATH -- this rail must RUN the start command, not skip"
    fake = tmp_path / "bin"
    fake.mkdir()
    script = fake / "python"
    script.write_bytes(b'#!/bin/sh\nfor a in "$@"; do printf "ARG<%s>\\n" "$a"; done\n')
    script.chmod(0o755)
    env = {k: v for k, v in os.environ.items()
           if not k.endswith("_ENABLED") and k != "MONITOR_JOB"}
    env["PATH"] = str(fake) + os.pathsep + env.get("PATH", "")
    env["PORT"] = "8080"
    env.update(env_extra)
    r = subprocess.run([sh, "-c", _start_command()], env=env, capture_output=True,
                       text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return re.findall(r"ARG<(.*?)>", r.stdout)


def test_with_MONITOR_JOB_UNSET_the_monitor_branch_passes_no_once(tmp_path):
    argv = _argv_from_shell(tmp_path, {"TERMINAL_NEXT_MONITOR_ENABLED": "1"})
    assert argv == ["-m", "api.terminal_next_monitor_main"], argv


def test_with_MONITOR_JOB_EMPTY_it_is_the_same_as_unset(tmp_path):
    argv = _argv_from_shell(tmp_path, {"TERMINAL_NEXT_MONITOR_ENABLED": "1", "MONITOR_JOB": ""})
    assert argv == ["-m", "api.terminal_next_monitor_main"], argv


def test_with_MONITOR_JOB_SET_it_still_runs_exactly_that_job(tmp_path):
    argv = _argv_from_shell(tmp_path, {"TERMINAL_NEXT_MONITOR_ENABLED": "1",
                                       "MONITOR_JOB": "options-log"})
    assert argv == ["-m", "api.terminal_next_monitor_main", "--once", "options-log"], argv


def test_the_unset_argv_REACHES_due_jobs_and_runs_options_log_at_1630(tmp_path, monkeypatch):
    """End to end: the argv the shell produced, given to the real main() at a
    weekday 16:30 ET, runs the scheduled jobs -- and NOT ticking."""
    from api import terminal_next_monitor_main as mon
    argv = _argv_from_shell(tmp_path, {"TERMINAL_NEXT_MONITOR_ENABLED": "1"})[2:]
    monkeypatch.setenv(mon.FLAG, "1")
    ran = []
    monkeypatch.setattr(mon, "run_job", lambda name: ran.append(name) or 0)
    assert mon.main(argv, now=dt.datetime(2026, 10, 2, 16, 30, tzinfo=ET)) == 0
    assert ran == ["gate-check", "options-log"], ran
    # CONTROL: a firing with nothing due runs nothing -- no ticking on every firing.
    ran.clear()
    assert mon.main(argv, now=dt.datetime(2026, 10, 2, 16, 12, tzinfo=ET)) == 0
    assert ran == [], ran
