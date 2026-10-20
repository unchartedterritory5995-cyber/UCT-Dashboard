"""The P3b example-notes walk's own setup and exit rules (tools/notebook_example_notes_walk.py), OI-P3b-28.

The walk is a real-browser tool; these rails need no browser and no sandbox:

  * its environment never inherits the box's OCR switch: step 4 expects an image nobody has read, which holds
    only while OCR is dark, and `J2_OCR_ENABLED` is not a NOTEBOOK_ name, so the flag-set pop never reached it;
  * a run that names no viewport runs no step, so it must refuse instead of exiting 0;
  * the exit code is 0 only when every expected step (7 per viewport) was recorded and passed.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_example_notes_walk as w  # noqa: E402


def test_set_env_pops_the_ocr_switch(monkeypatch):
    env = dict(os.environ)
    env[w.OCR_FLAG] = "1"
    monkeypatch.setattr(os, "environ", env)
    on = w.set_env({"c1": [], "all_names": []})
    assert w.OCR_FLAG not in os.environ
    assert w.OCR_FLAG not in on
    assert os.environ[w.EXAMPLE_FLAG] == "1"     # control: set_env still arms what it should


def test_an_empty_viewport_list_refuses_before_any_boot(tmp_path, capsys):
    data, out = tmp_path / "data", tmp_path / "out"
    rc = w.main(["--data-dir", str(data), "--tip", "x", "--out", str(out), "--viewports", " , "])
    assert rc == 3
    assert "REFUSED" in capsys.readouterr().out
    assert not data.exists() and not out.exists()


def test_the_exit_code_needs_every_expected_step():
    none = {"PASS": 0, "FAIL": 0, "INCONCLUSIVE": 0}
    assert w.exit_code(None, none, 0, 0) == 1                                   # nothing expected, nothing run
    assert w.exit_code(None, {**none, "PASS": 14}, 14, 21) == 1                 # a short walk
    assert w.exit_code(None, {**none, "PASS": 21}, 21, 21) == 0                 # the whole walk passed
    assert w.exit_code(None, {**none, "PASS": 20, "FAIL": 1}, 21, 21) == 1
    assert w.exit_code(None, {**none, "PASS": 20, "INCONCLUSIVE": 1}, 21, 21) == 1
    assert w.exit_code("RuntimeError: x", {**none, "PASS": 21}, 21, 21) == 1
    assert w.STEPS_PER_VIEWPORT == 7
