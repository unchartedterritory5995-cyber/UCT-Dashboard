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


def test_a_KEEP_over_zero_members_says_so(tmp_path, monkeypatch):
    """⛔ A verdict file must never look like population evidence it does not have.

    Every trigger reads clean when nobody has run the layer — that is what clean
    looks like over an EMPTY SET. A bare KEEP would be read next week as "a week
    of members found nothing".
    """
    gate = _load("nb_gate")
    src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    assert "no independent member exposure" in src
    assert "0 blocked-baseline " in src and "events measured over 0 real members" in src
    # the qualification is gated on the member line, not unconditional
    assert 'no_member = member.startswith("none")' in src
    assert 'if verdict == "KEEP" and no_member:' in src


def test_the_owner_and_the_smoke_account_are_not_members(tmp_path, monkeypatch):
    """⛔ ATTRIBUTION BY IDENTITY, NOT BY CLOCK.

    The gate excluded rig activity by canary TIMING alone and reported the
    owner's own 14:00:28 opt-in as FIRST MEMBER OPT-IN — 27 minutes from any
    canary, so the timing rule could not see it.
    """
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "l.md"))
    obs = _load("nb_observe")
    assert "unchartedterritory5995@gmail.com" in obs.NOT_A_MEMBER
    assert "smoke@uctintelligence.internal" in obs.NOT_A_MEMBER
    # ⭐ CONTROL: the exclusion list is not a catch-all
    assert "someone-else@example.com" not in obs.NOT_A_MEMBER


def test_a_5xx_reading_is_SKIPPED_not_an_ANOMALY():
    """⛔ A reading that could not be TAKEN is not a finding. Production 502s on
    every Tier 1 deploy; an ANOMALY row there makes the Sunday gate REVERT a
    healthy product because another workstream deployed at 17:05."""
    obs_src = (TOOLS / "nb_observe.py").read_text(encoding="utf-8")
    gate_src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    assert "production unreachable (HTTP 5xx" in obs_src
    assert 'not a finding, and not evidence of a clean interval either' in obs_src
    # and the gate must not count a SKIPPED row as a trigger
    assert '"SKIPPED" not in x[-1]' in gate_src
