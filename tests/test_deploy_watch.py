"""Rails for the deploy watcher, including ONE that runs the real probe.

⛔ RULE 10. The 2026-09-10 defect was invisible to every injected-seam test that could have been
written: a fake `run` returns whatever you tell it to, and `FileNotFoundError` only happens when a
real exec meets a real PATH. The `test_the_real_boundary_*` case below therefore resolves `railway`
with the real `shutil.which` and runs the real `railway status --json`. If that cannot run on this
machine it FAILS rather than skips — a rail whose important half is opt-in is how the blind watcher
shipped in the first place (`lesson_a_rails_important_half_can_be_opt_in`).
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))

from deploy_watch import (  # noqa: E402
    ProbeFailed, RailwayNotFound, WatchAbandoned,
    arm, parse_status, probe, resolve_railway, watch,
)

OK = json.dumps({"environments": {"edges": [{"node": {"name": "production", "serviceInstances": {
    "edges": [{"node": {"serviceName": "web", "latestDeployment": {
        "status": "SUCCESS", "createdAt": "t", "meta": {"commitHash": "febe8ee67aaa"}}}}]}}}]}})


def test_a_missing_shim_raises_instead_of_polling_blind():
    """⛔ THE DEFECT. shutil.which returning None must stop the watch, not start it."""
    with pytest.raises(RailwayNotFound):
        resolve_railway(which=lambda _n: None)


def test_the_resolved_path_is_what_gets_executed_and_no_shell_is_used():
    """The fix is exec'ing the RESOLVED path. A shell would paper over it and add an injection seam."""
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        return subprocess.CompletedProcess(argv, 0, OK, "")

    probe(r"C:\tools\railway.exe", run=fake_run)
    assert seen["argv"][0] == r"C:\tools\railway.exe", "must exec the resolved path, not the bare name"
    assert seen["kw"].get("shell") is not True, "shell=True is not the fix"
    assert seen["kw"].get("encoding") == "utf-8", "an unset encoding is its own outage class here"


def test_empty_or_unparseable_output_is_a_failure_not_an_empty_result():
    for bad in ("", "   ", "not json", json.dumps({"environments": {"edges": []}})):
        with pytest.raises(ProbeFailed):
            parse_status(bad)


def test_armed_is_only_returned_after_a_probe_returns_parseable_data():
    """⛔ 'armed' was announced before anything had been measured. It is now a return value."""
    with pytest.raises(ProbeFailed):
        arm("x", probe_fn=lambda _e: (_ for _ in ()).throw(ProbeFailed("nope")))
    _exe, reading = arm("x", probe_fn=lambda _e: parse_status(OK))
    assert reading["web"]["status"] == "SUCCESS"


def test_consecutive_probe_errors_escalate_instead_of_running_to_a_clean_exit():
    """⛔ THE ONE THAT MATTERS. The old loop logged 40 errors and exited 0."""
    calls = {"n": 0}

    def flaky(_exe):
        calls["n"] += 1
        if calls["n"] == 1:
            return parse_status(OK.replace("SUCCESS", "BUILDING"))
        raise ProbeFailed("FileNotFoundError: railway")

    with pytest.raises(WatchAbandoned) as e:
        watch("web", ["febe8ee6"], exe="x", probe_fn=flaky, sleep=lambda _s: None, log=lambda *_a: None)
    assert "consecutive probe failures" in str(e.value)


def test_a_failed_deployment_raises_rather_than_polling_to_the_horizon():
    bad = parse_status(OK.replace("SUCCESS", "FAILED"))
    with pytest.raises(WatchAbandoned):
        watch("web", ["febe8ee6"], exe="x", probe_fn=lambda _e: bad,
              sleep=lambda _s: None, log=lambda *_a: None)


def test_success_on_the_expected_commit_returns_the_reading():
    good = parse_status(OK)
    out = watch("web", ["febe8ee6"], exe="x", probe_fn=lambda _e: good,
                sleep=lambda _s: None, log=lambda *_a: None)
    assert out["web"]["commit"].startswith("febe8ee6")


def test_success_on_the_WRONG_commit_is_not_accepted():
    """A SUCCESS from the PREVIOUS deploy is the stale-pass trap this repo keeps re-finding."""
    stale = parse_status(OK.replace("febe8ee67aaa", "7ed6b2ce5bbb"))
    with pytest.raises(WatchAbandoned):
        watch("web", ["febe8ee6"], exe="x", probe_fn=lambda _e: stale,
              sleep=lambda _s: None, max_polls=2, log=lambda *_a: None)


def test_the_real_boundary_resolve_and_run_railway_status_json_for_real():
    """⛔ RULE 10: the fake-`run` cases above CANNOT see a PATH-resolution defect. This one can."""
    exe = resolve_railway()                     # real shutil.which — raises if absent
    assert pathlib.Path(exe).exists(), exe
    reading = probe(exe)                        # real subprocess, real CLI, real JSON
    assert reading, "the real probe returned no production services"
    assert "web" in reading, f"expected a 'web' service; got {sorted(reading)}"
    assert reading["web"]["status"], "a service row with no status is not parseable data"
