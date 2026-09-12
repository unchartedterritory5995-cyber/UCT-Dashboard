"""Rails over the observation sampler and the Sunday gate reading.

⛔ THESE EXIST BECAUSE BOTH TOOLS ALREADY DESTROYED OR MANUFACTURED A FACT:
  · the appender rewrote the log on a header mismatch, erasing five real rows the
    moment the schema was improved;
  · the gate compared the feed against a FIXED constant, so the instrument's own
    canary opt-in would have been reported as the first member datapoint.
Each case below drives the defect, not a restatement of the fix.
"""
from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys

NL = chr(10)
TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_a_header_change_cannot_rewrite_existing_rows(tmp_path, monkeypatch):
    """⛔ THE DEFECT, DRIVEN. Five real rows were lost to exactly this."""
    log = tmp_path / "log.md"
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    obs = _load("nb_observe")

    obs.append("| row-A |\n")
    assert "row-A" in log.read_text(encoding="utf-8")

    # the schema changes underneath it, as it really did
    obs.HEADER = "# a DIFFERENT header" + NL + NL + "| new | columns |" + NL + "|---|---|" + NL
    obs.append("| row-B |\n")

    text = log.read_text(encoding="utf-8")
    assert "row-A" in text, "⛔ the old row was destroyed by a header change"
    assert "row-B" in text
    assert "a DIFFERENT header" in text, "the new schema should be appended, not dropped"


def test_the_header_is_written_into_an_empty_file(tmp_path, monkeypatch):
    """⭐ CONTROL: the append path must still create a usable log from nothing."""
    log = tmp_path / "fresh.md"
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    obs = _load("nb_observe")
    obs.append("| first |\n")
    text = log.read_text(encoding="utf-8")
    assert "observation log" in text and "| first |" in text


def test_a_canary_opt_in_is_never_read_as_a_member(tmp_path, monkeypatch):
    """⛔ THE OTHER DEFECT, DRIVEN. The Saturday canary fired its own opt-in 12s
    after its sentinel; a fixed constant would have called that a member."""
    resume = tmp_path / "resume.md"
    resume.write_text("### saturday-canary-1 - **2026-09-12T13:32:54Z**" + NL, encoding="utf-8")
    monkeypatch.setenv("NB_RESUME_DOC", str(resume))
    gate = _load("nb_gate")

    cans = gate.canary_times()
    assert cans, "the canary time should be derived from the stamped row"
    # 12 seconds after the canary: OURS
    assert gate.is_rig("2026-09-12 13:33:06", cans) is True
    # ⭐ CONTROL: far from any canary, and after the pre-canary baseline: a MEMBER
    assert gate.is_rig("2026-09-12 20:00:00", cans) is False
    # ⭐ CONTROL: before any canary existed, still the rig
    assert gate.is_rig("2026-09-12 05:00:00", cans) is True


def test_an_unparseable_stamp_is_never_claimed_as_a_member(tmp_path, monkeypatch):
    """⛔ A value that could not be READ is not a member who arrived - the same
    distinction _doc_text(None) == '' got wrong twice in this wave."""
    resume = tmp_path / "r.md"
    resume.write_text("nothing stamped here" + NL, encoding="utf-8")
    monkeypatch.setenv("NB_RESUME_DOC", str(resume))
    gate = _load("nb_gate")
    assert gate.is_rig("not-a-timestamp", []) is True
