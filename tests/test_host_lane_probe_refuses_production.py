"""RAIL: the host-lane browser probe signs in with a plain login ONLY on a local sandbox.

`tools/pine_coverage/host_lane_browser_probe.py` POSTs `/api/auth/login` itself for its sandbox account (and signs it
up and deletes its saved scripts first: a clean slate). `tests/test_synthetic_session_signout.py` exempts it for
that reason alone, so the reason is held here: any base that is not loopback is refused before a browser starts,
unless `--synthetic`, which signs in through `tools/synthetic_session.py` (the one sign-in that always signs out).
docs/pine/evidence/2026-11-18-host-lane-worker-followups/EVIDENCE.md, section 4.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PROBE = REPO / "tools" / "pine_coverage" / "host_lane_browser_probe.py"
SCRIPT = "corpus/committed/atr-bands__ad60b125e6.pine"


class _BrowserStarted(Exception):
    pass


def _load():
    spec = importlib.util.spec_from_file_location("host_lane_browser_probe_under_test", PROBE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def probe(monkeypatch, tmp_path):
    mod = _load()
    # ⛔ SKIPPED by name when playwright is absent (the suite's importorskip convention, 2026-11-18): the
    # fixture patches the real module's `sync_playwright`, so without the package there is nothing to patch.
    pw = pytest.importorskip("playwright.sync_api", reason="the probe's fixture patches playwright; " + 'CI installs no browser stack (remote runs 44307082879, 44308065971: every test here errored on the import)')

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


@pytest.mark.parametrize("args", [("--base", "http://127.0.0.1:8161"),
                                  ("--base", "http://localhost:8161"),
                                  ("--base", "https://uctintelligence.com", "--synthetic", "smoke")])
def test_CONTROL_a_sandbox_or_a_synthetic_sign_in_gets_past_the_refusal(probe, args):
    # it reaches the browser (stubbed here), so the refusal above is the guard, not an answer to everything
    with pytest.raises(_BrowserStarted):
        probe(*args)
