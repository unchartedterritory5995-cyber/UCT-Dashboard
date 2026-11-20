"""RAIL: the timeframe-switch probe runs ONLY against a local sandbox.

`tools/pine_coverage/tf_switch_probe.py` signs in with `host_lane_browser_probe.sign_in` (a plain login, signing the
account up if it is not there) and deletes that account's saved scripts before it attaches its own. That is right for
a throwaway `@local.dev` account on a loopback sandbox and wrong anywhere else, so any base that is not loopback is
refused before a browser starts (it has no synthetic-account mode: a production run is another rig).
docs/pine/evidence/2026-11-19-host-lane-learned-route/EVIDENCE.md, section 6.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PROBE = REPO / "tools" / "pine_coverage" / "tf_switch_probe.py"
SCRIPT = "docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine"


class _BrowserStarted(Exception):
    pass


def _load():
    spec = importlib.util.spec_from_file_location("tf_switch_probe_under_test", PROBE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def probe(monkeypatch, tmp_path):
    pw = pytest.importorskip("playwright.sync_api", reason="the fixture patches playwright; CI installs no browser stack")
    mod = _load()

    def no_browser():
        raise _BrowserStarted()
    monkeypatch.setattr(pw, "sync_playwright", no_browser)

    def run(*extra):
        monkeypatch.setattr(sys, "argv", ["probe", "--script", SCRIPT, "--label", "t", "--out", str(tmp_path), *extra])
        return mod.main()
    return run


@pytest.mark.parametrize("base", ["https://uctintelligence.com", "https://web-production-05cb6.up.railway.app",
                                  "http://10.0.0.5:8077"])
def test_a_base_that_is_not_loopback_is_refused_before_a_browser_starts(probe, capsys, base):
    assert probe("--base", base) == 2
    assert "REFUSED" in capsys.readouterr().out


@pytest.mark.parametrize("base", ["http://127.0.0.1:8171", "http://localhost:8171"])
def test_CONTROL_a_sandbox_gets_past_the_refusal(probe, base):
    # it reaches the browser (stubbed here), so the refusal above is the guard, not an answer to everything
    with pytest.raises(_BrowserStarted):
        probe("--base", base)


def test_the_probe_never_posts_a_sign_in_of_its_own():
    # the one plain sign-in is `host_lane_browser_probe.sign_in` (a named local-sandbox exemption,
    # tests/test_synthetic_session_signout.py); this file must not grow a second one
    code = PROBE.read_text(encoding="utf-8")
    assert "/api/auth/login" not in code
    assert "SMOKE_PASSWORD" not in code and "BENCH_PASSWORD" not in code
