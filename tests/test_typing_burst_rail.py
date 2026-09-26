"""⛔⛔ THE TYPING-BURST RAIL (wave 10, lane 10C) -- it must be able to FAIL.

`tools/t12_smoke_runner.py::burst_verdict` judges T-12 step 3 from the NETWORK
TRACE: PASS only when the typed words survive a reload (no LOSS), no "(conflicted
copy)" exists (no FORK), and every 409 on the note's PUT is followed by a landed
PUT. `tools/notebook_burst_probe.py::judge` extends it to several fragments and to
tags. Both are pure, so each clause is pinned here with a planted failure -- an
instrument that cannot fail is not a rail (CLAUDE.md).

The sandbox runs that USE them are raw evidence in
docs/notebook/evidence/wave10-10c/ (12/12 probe runs PASS, 15 409s all settled).
Also pinned: both tools refuse production for the sandbox identity, before any
browser starts.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, REPO / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def t12():
    return _load("t12_under_test", "tools/t12_smoke_runner.py")


@pytest.fixture(scope="module")
def probe():
    return _load("burst_probe_under_test", "tools/notebook_burst_probe.py")


NID = "n1"
PATH = f"/api/j2/notes/{NID}"
OK = {"m": "PUT", "u": PATH, "status": 200}
C409 = {"m": "PUT", "u": PATH, "status": 409, "body": '{"detail":"note changed"}'}
GET = {"m": "GET", "u": PATH, "status": 200}


def test_clean_burst_passes(t12):
    v = t12.burst_verdict([OK, OK], NID, ["T-12 smoke"], True)
    assert v["verdict"] == "PASS" and v["conflicts_409"] == 0


def test_a_settled_409_passes_and_is_COUNTED_never_hidden(t12):
    v = t12.burst_verdict([OK, C409, GET, OK], NID, ["T-12 smoke"], True)
    assert v["verdict"] == "PASS"
    assert v["conflicts_409"] == 1 and v["unsettled_409"] == 0
    assert [p["status"] for p in v["put_sequence"]] == [200, 409, 200]


def test_an_unsettled_409_fails(t12):
    v = t12.burst_verdict([OK, C409], NID, ["T-12 smoke"], True)
    assert v["verdict"] == "FAIL" and v["unsettled_409"] == 1


def test_a_conflicted_copy_fails_as_a_FORK(t12):
    v = t12.burst_verdict([OK], NID, ["T-12 smoke", "T-12 smoke (conflicted copy)"], True)
    assert v["verdict"] == "FAIL" and any(p.startswith("FORK") for p in v["problems"])


def test_missing_words_after_reload_fail_as_a_LOSS(t12):
    v = t12.burst_verdict([OK], NID, ["T-12 smoke"], False)
    assert v["verdict"] == "FAIL" and any(p.startswith("LOSS") for p in v["problems"])


def test_no_put_at_all_is_not_a_pass(t12):
    assert t12.burst_verdict([], NID, ["T-12 smoke"], True)["verdict"] == "FAIL"


def test_another_notes_409_is_not_this_notes(t12):
    other = {**C409, "u": "/api/j2/notes/other"}
    assert t12.burst_verdict([OK, other], NID, ["x"], True)["verdict"] == "PASS"


def test_the_runner_self_check_passes(t12, capsys):
    assert t12.self_check() == 0
    assert "self-check: PASS" in capsys.readouterr().out


def test_probe_judge_fails_on_a_lost_fragment_a_fork_a_lost_tag_and_an_unsettled_409(t12, probe):
    good = probe.judge(t12, [OK, C409, OK], NID, ["x"], "alpha beta", ["alpha", "beta"], ["a"], ["a"], False)
    assert good["verdict"] == "PASS"
    assert probe.judge(t12, [OK], NID, ["x"], "alpha", ["alpha", "beta"], [], [], False)["verdict"] == "FAIL"
    assert probe.judge(t12, [OK], NID, ["x (conflicted copy)"], "alpha", ["alpha"], [], [], False)["verdict"] == "FAIL"
    assert probe.judge(t12, [OK], NID, ["x"], "alpha", ["alpha"], [], ["a"], False)["verdict"] == "FAIL"
    assert probe.judge(t12, [OK, C409], NID, ["x"], "alpha", ["alpha"], [], [], False)["verdict"] == "FAIL"


def test_the_probe_self_check_passes(probe, capsys):
    assert probe.self_check() == 0


def test_the_sandbox_identity_is_refused_against_production_before_any_browser(t12, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["t12", "--identity", "sandbox-member"])
    assert t12.main() == 2
    assert "REFUSED" in capsys.readouterr().out


def test_a_sandbox_base_needs_the_integrity_log_nonce(t12, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["t12", "--identity", "sandbox-member", "--base", "http://127.0.0.1:65530"])
    assert t12.main() == 2
    assert "--integrity-log" in capsys.readouterr().out


def test_the_probe_refuses_production(probe, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["probe", "--base", "https://uctintelligence.com", "--out", "x"])
    assert probe.main() == 2
    assert "REFUSED" in capsys.readouterr().out
