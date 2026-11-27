# -*- coding: utf-8 -*-
"""e98: a bounded-window grade (VENDOR_HARNESS_WINDOW) is never a committed snapshot.

regenerate_snapshots.py drives the corpus harness that writes docs/pine/vendor-harness/<lane>/verdicts.json; the
environment it hands the run must not carry the window, whatever the shell that started it holds.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "vendor_harness"))

import regenerate_snapshots as RS  # noqa: E402


def test_the_window_never_reaches_a_snapshot_run(monkeypatch, tmp_path):
    monkeypatch.setenv("VENDOR_HARNESS_WINDOW", "1500")
    _cmd, env = RS.lane_command("production", str(tmp_path))
    assert "VENDOR_HARNESS_WINDOW" not in env


def test_control_other_variables_still_pass_through(monkeypatch, tmp_path):
    monkeypatch.setenv("E98_WINDOW_CONTROL", "kept")
    _cmd, env = RS.lane_command("runtime-on", str(tmp_path))
    assert env.get("E98_WINDOW_CONTROL") == "kept"
