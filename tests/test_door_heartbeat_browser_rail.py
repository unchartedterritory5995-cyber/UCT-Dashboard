"""e96 -- the door heartbeat's browser rail (`tools/door_heartbeat_browser_rail.py`) can FAIL, and reads only VITE_* lines.

The rail itself needs a production build and Playwright's Chromium (run by hand, under the machine lock); its verdict is
a pure function of the timed messages, so here: every made-up run that must fail or be inconclusive is, the one that must
pass does, and the env file it reads refuses anything but a VITE_* line (no other variable is ever read through it).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "door_heartbeat_browser_rail.py"


def _tool():
    spec = importlib.util.spec_from_file_location("door_heartbeat_browser_rail", TOOL)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_self_check_passes():
    assert _tool().self_check() == 0


def test_the_verdict_fails_without_a_step_beat():
    t = _tool()
    fast = {"why": "answered", "ms": 900, "seen": [{"t": 400, "beat": {"id": 1, "ms": 0}},
                                                   {"t": 900, "reply": {"id": 1, "ok": True, "drawn": True, "workerMs": 480}}]}
    slow = {"why": "answered", "ms": 19000, "seen": [{"t": 400, "beat": {"id": 2, "ms": 0}},
                                                     {"t": 19000, "reply": {"id": 2, "ok": True, "drawn": True, "workerMs": 18500}}]}
    code, lines, _ = t.verdict(fast, slow)
    assert code == t.FAIL
    assert any("no beat from its steps" in line for line in lines)


def test_the_env_file_reads_vite_lines_only(tmp_path):
    t = _tool()
    good = tmp_path / "ok.env"
    good.write_text("VITE_PINE_MEMBER_PANE_ENABLED=1\n# a comment\n\nVITE_PINE_EDITOR_STATUS=1\n", encoding="utf-8")
    assert t.read_env_file(good) == {"VITE_PINE_MEMBER_PANE_ENABLED": "1", "VITE_PINE_EDITOR_STATUS": "1"}
    bad = tmp_path / "bad.env"
    bad.write_text("VITE_PINE_EDITOR_STATUS=1\nDATABASE_URL=x\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        t.read_env_file(bad)


def test_the_slow_chain_is_the_door_deadline_rails_chain():
    """The same synthetic text `doorDeadline.test.js::chain` builds (one line per depth, each doubling the tree)."""
    text = _tool().chain(3)
    assert text.split("\n") == ['//@version=5', 'indicator("door deadline rail")', 'a0 = close',
                                'a1 = a0 + a0[1]', 'a2 = a1 + a1[1]', 'a3 = a2 + a2[1]', 'plot(a3)']
    js = (REPO / "app/src/components/chart/builder/memberPane/doorDeadline.test.js").read_text(encoding="utf-8")
    assert "lines.push(`a${i} = a${i - 1} + a${i - 1}[1]`)" in js
