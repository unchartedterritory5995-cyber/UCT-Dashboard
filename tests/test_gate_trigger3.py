"""Trigger 3 reads the canary's own stamp instead of printing `n/a` beside it.

⚰️ **2026-09-13.** The Sunday canary ran GREEN at 20:00:01Z — it queued real work
offline, reconnected, and reported `outbox 0` — and the gate's verdict, written
two hours later, still said *"3 · outbox stuck >5 min | n/a - canary or member
report only"*. The evidence existed and the reader said it did not.

⛔⛔ **WHAT A CANARY CAN AND CANNOT EVIDENCE, so nobody overclaims.** A canary run
lasts minutes, so it cannot observe an item stuck for more than five minutes.
What it *can* observe is the condition whose absence that trigger watches for:
whether the queue **settles**. `outbox 0` at the settle step is positive evidence
that the drain does not strand work — and the verdict line says exactly that,
rather than letting a PASS imply a five-minute observation nobody took.
"""
from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
NL = chr(10)
DASH = chr(8212)


def _load(name, **env):
    import os
    for k, v in env.items():
        os.environ[k] = v
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _resume(path, stamp, outbox, steps="11/11", label="sunday-canary", extra=""):
    """A canary section shaped like the one `window_check.py` really writes."""
    path.write_text(NL.join([
        "# Wave Q1 " + DASH + " RESUME HERE",
        "",
        "### " + label + " " + DASH + " **" + stamp + "**",
        "",
        "| | reading |",
        "|---|---|",
        "| rig | PID **1** " + DASH + " persistent profile |",
        "| four durable stores | `conflicts` 0 · `meta` 34 · `notes` 22 · `outbox` 0 |",
        "| **mini-canary** | OK **" + steps + "** steps green |",
        "|  ↳ 2 type online " + DASH + " one CAS PUT | **1** PUT(s) |",
        "|  ↳ 4 reconnect " + DASH + " the queue settled (this step says NOTHING about the body) "
        "| `dirty` **0** · outbox **" + str(outbox) + "** · baseline `x` |",
        "|  ↳ 5 opted back out | `'0'` |",
        extra,
        "",
    ]) + NL, encoding="utf-8")
    return path


def test_a_green_canary_makes_trigger_3_PASS_from_evidence(tmp_path):
    """⛔ THE ONE THAT WAS BROKEN."""
    doc = _resume(tmp_path / "r.md", "2026-09-13T20:00:01Z", 0)
    gate = _load("nb_gate", NB_RESUME_DOC=str(doc))
    ev, why = gate.canary_queue_evidence(datetime.datetime(2026, 9, 13, 22, 0, 0))
    assert why is None, why
    assert ev["outbox"] == 0 and ev["steps"] == "11/11"
    assert ev["label"] == "sunday-canary" and ev["stamp"] == "2026-09-13T20:00:01Z"


def test_a_canary_that_left_work_queued_is_a_FAIL(tmp_path):
    """⭐ THE PAIR. A reader that can only say PASS measures nothing."""
    doc = _resume(tmp_path / "r.md", "2026-09-13T20:00:01Z", 3)
    gate = _load("nb_gate", NB_RESUME_DOC=str(doc))
    ev, why = gate.canary_queue_evidence(datetime.datetime(2026, 9, 13, 22, 0, 0))
    assert why is None and ev["outbox"] == 3


def test_a_STALE_canary_is_not_evidence_for_this_window(tmp_path):
    """⛔ An old green is the most flattering thing a stale artifact can say.
    Last Sunday's canary says nothing about this window."""
    doc = _resume(tmp_path / "r.md", "2026-09-06T20:00:01Z", 0)
    gate = _load("nb_gate", NB_RESUME_DOC=str(doc))
    ev, why = gate.canary_queue_evidence(datetime.datetime(2026, 9, 13, 22, 0, 0))
    assert ev is None
    assert "older than" in why and "2026-09-06T20:00:01Z" in why


def test_a_canary_that_never_reached_the_settle_step_is_not_a_PASS(tmp_path):
    """⛔ A run that died before the queue step proves nothing about the queue —
    and 'no step' must never read as 'the step was fine'."""
    doc = tmp_path / "r.md"
    doc.write_text(NL.join([
        "### sunday-canary " + DASH + " **2026-09-13T20:00:01Z**",
        "",
        "| | reading |",
        "|---|---|",
        "| rig | PID **1** |",
        "",
    ]) + NL, encoding="utf-8")
    gate = _load("nb_gate", NB_RESUME_DOC=str(doc))
    ev, why = gate.canary_queue_evidence(datetime.datetime(2026, 9, 13, 22, 0, 0))
    assert ev is None and "no queue-settled step" in why


def test_the_newest_canary_wins_by_STAMP_not_by_position(tmp_path):
    """The doc is prepend-ordered today; that is a layout choice, not a
    guarantee. Ordering by stamp survives the layout changing."""
    doc = tmp_path / "r.md"
    doc.write_text(NL.join([
        "### sunday-canary " + DASH + " **2026-09-06T20:00:01Z**",
        "|  ↳ 4 reconnect " + DASH + " the queue settled | `dirty` **0** · outbox **9** · x |",
        "",
        "### sunday-canary " + DASH + " **2026-09-13T20:00:01Z**",
        "|  ↳ 4 reconnect " + DASH + " the queue settled | `dirty` **0** · outbox **0** · x |",
        "",
    ]) + NL, encoding="utf-8")
    gate = _load("nb_gate", NB_RESUME_DOC=str(doc))
    ev, _ = gate.canary_queue_evidence(datetime.datetime(2026, 9, 13, 22, 0, 0))
    assert ev["stamp"] == "2026-09-13T20:00:01Z" and ev["outbox"] == 0


def test_no_canary_at_all_still_says_n_a_and_never_PASS(tmp_path):
    doc = tmp_path / "r.md"
    doc.write_text("# nothing stamped here" + NL, encoding="utf-8")
    gate = _load("nb_gate", NB_RESUME_DOC=str(doc))
    ev, why = gate.canary_queue_evidence()
    assert ev is None and "no canary section" in why


def test_the_verdict_line_refuses_to_overclaim(tmp_path, monkeypatch):
    """⛔ A PASS must not imply a five-minute observation nobody took."""
    src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    assert "it is not a" in src and "five-minute observation" in src
    assert "queued real work" in src


def test_a_stuck_queue_turns_the_whole_verdict(tmp_path, monkeypatch):
    """⛔ A trigger that fires but cannot change the verdict is decoration."""
    NLx = chr(10)
    log = tmp_path / "obs.md"
    log.write_text(NLx.join([
        "| at (ET) | opt-ins by population (UTC) | opt-in (windowed) | config-served (members) "
        "| blocked-baseline | sync-conflict notes | outbox | console errors | flag |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-09-13 19:00 ET | x · organic 0 · synthetic 1 · rig/owner 1 | 25 | 0/0 | 0 | 3 | 0 | 0 | OK |",
        "",
    ]) + NLx, encoding="utf-8")
    doc = _resume(tmp_path / "r.md", datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), 4)
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    monkeypatch.setenv("NB_GATE_VERDICT", str(tmp_path / "v.md"))
    monkeypatch.setenv("NB_RESUME_DOC", str(doc))
    monkeypatch.setenv("NB_GATE_REPO", str(tmp_path))
    gate = _load("nb_gate")
    gate.main()
    out = (tmp_path / "v.md").read_text(encoding="utf-8")
    assert "VERDICT: **REVERT**" in out, out
    assert "the queue did NOT" in out
    assert "trigger 3: the canary's queue did not settle" in out
