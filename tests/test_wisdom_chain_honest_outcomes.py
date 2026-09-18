"""R66 — a chain step that did nothing must never be recorded as `ok`.

⚰️ THE DEFECT, MEASURED IN PRODUCTION 2026-09-16. `chain._normalize` inspected only the TOP
LEVEL of a step's result dict. The `sources` step returned

    {"discord": {"skipped": "…"}, "transcripts": {"skipped": "…"}}

— both sub-streams declined, nothing was ingested — and because neither `status` nor `skipped`
sat at the top level, the chain result AND the observation log both recorded `ok`. `evals` does
the same thing one level down, so the same night produced two honest-looking `ok`s for two steps
that had done no work at all. An outcome that lies is how the next surprise happens.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a NESTED skip read as `ok` (the defect itself) — `test_a_nested_skip_with_no_work_reports_
   skipped_and_names_every_sub_stream` is the mutation target: flatten the walk back to the top
   level and it goes red BY NAME.
2. the inner reasons not reaching the recorded reason — a reader must see WHICH sub-stream
   declined and why, not just that something did.
3. a MIXED step (part skipped, part worked) reported as fully skipped, or reported as a bare
   `ok` with nothing saying half of it declined.
4. the walk inventing a skip for a step that genuinely worked (the control — a rail that cannot
   report `ok` proves nothing when it reports `skipped`).
5. the legacy top-level reason sentences drifting, which would rewrite the meaning of every
   `skipped` row already in wisdom_chain_steps.
6. the partial disappearing from the observation log, which is the artifact a human reads.
"""
from __future__ import annotations

import importlib.machinery
import sys
import types
from datetime import datetime

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import chain

ET = timeutil.ET
NOW = datetime(2026, 9, 16, 18, 47, tzinfo=ET)

# ⛔ THE REAL PAYLOADS, copied from a live rehearsal run of the daily chain (tools/wisdom/
# gating_rehearsal.py, 2026-09-17), not shapes invented to suit the walk. A fixture that does
# not match what the step actually returns cannot prove anything about the step.
SOURCES_BOTH_OFF = {"discord": {"skipped": "WISDOM_DISCORD_LISTENER_ENABLED is off"},
                    "transcripts": {"skipped": "WISDOM_SOURCES_INGEST_ENABLED is off"}}
EVALS_ALL_OFF = {"dry_run": False, "force": False,
                 "context": {"skipped": "kill switch off"},
                 "outcomes": {"skipped": "kill switch off"},
                 "replay": {"skipped": "kill switch off"},
                 "metrics": {"skipped": "kill switch off"}}
ADAPTERS_MIXED = {"steps": {
    "retrieval": {"status": "ok", "skipped": "WISDOM_RETRIEVAL_INDEX_ENABLED is off"},
    "brainkb": {"status": "ok", "flag_on": False, "rows": 3, "inserted": 3, "updated": 0,
                "superseded": 0, "unchanged": 0, "voice_principles": 36, "voice_drafts_new": 36},
    "desk_markers": {"status": "ok", "flag_on": False, "tickers": 1, "rows": 6},
    "level_alerts": {"status": "ok", "session": "2026-09-16", "open_calls": 0, "crosses": 0,
                     "delivered": 0, "written": 0}}, "failed": []}
#: A step that genuinely worked and declares nothing: the control's control.
LEVEL_ALERTS_QUIET = {"session": "2026-09-16", "open_calls": 0, "levels_scored": 0,
                      "crosses": 0, "delivered": 0, "written": 0}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


def _ctx(run_id="r66-1", due_key="2026-09-16", dry_run=False):
    return registry.JobContext(job_id="wisdom_daily_chain", now_et=NOW, due_key=due_key,
                               force=True, dry_run=dry_run, run_id=run_id)


def _fake_module(monkeypatch, name, **attrs):
    mod = types.ModuleType(name)
    mod.__spec__ = importlib.machinery.ModuleSpec(name, None)
    for key, value in attrs.items():
        setattr(mod, key, value)
    monkeypatch.setitem(sys.modules, name, mod)
    return mod


# ── 1-2. the nested-skip case: the defect itself ─────────────────────────────

def test_a_nested_skip_with_no_work_reports_skipped_and_names_every_sub_stream():
    """⛔ THE MUTATION TARGET. Flatten `_normalize` back to the top level and this goes red."""
    status, reason, payload = chain._normalize(SOURCES_BOTH_OFF)
    assert status == "skipped", f"a step whose every sub-stream declined reported {status!r}"
    # the reader must be able to see WHICH sub-stream skipped, and why — both halves
    assert "discord" in reason and "transcripts" in reason, reason
    assert "WISDOM_DISCORD_LISTENER_ENABLED is off" in reason, reason
    assert "WISDOM_SOURCES_INGEST_ENABLED is off" in reason, reason
    outcome = payload["_outcome"]
    assert outcome["decision"] == "skipped" and outcome["work"] == []
    assert [row["path"] for row in outcome["skipped"]] == ["discord", "transcripts"]


def test_the_second_real_instance_evals_with_every_sub_step_off_is_not_ok():
    """⭐ `sources` was the one that was noticed; `evals` was doing it on the same night."""
    status, reason, payload = chain._normalize(EVALS_ALL_OFF)
    assert status == "skipped", status
    assert [row["path"] for row in payload["_outcome"]["skipped"]] == [
        "context", "outcomes", "replay", "metrics"]
    assert "kill switch off" in reason


def test_a_skip_two_levels_down_is_still_found():
    """The walk is a walk, not a peek one level deeper than the last bug."""
    status, reason, _ = chain._normalize({"a": {"b": {"c": {"skipped": "three deep"}}}})
    assert (status, "a.b.c" in reason, "three deep" in reason) == ("skipped", True, True)


def test_a_skip_inside_a_list_is_named_by_what_it_is_not_by_its_index():
    out = {"datasets": [{"dataset": "wire", "status": "skipped_holiday"},
                        {"dataset": "tweets", "status": "unreachable"}]}
    status, reason, _ = chain._normalize(out)
    assert status == "skipped" and "datasets.wire" in reason, reason


# ── 3. the mixed case ────────────────────────────────────────────────────────

def test_a_mixed_step_reports_ok_and_the_reason_says_what_declined():
    """⭐ THE RULE, and it is a decision: MIXED IS `ok`, WITH A MANDATORY REASON.

    `ok` is the only status `_prior_ok_steps` treats as done, so a step that wrote rows must
    record `ok` or a catch-up re-does the half that worked. What keeps it honest is that
    `reason` is null for every ORDINARY ok step, so a non-null reason on an ok row means
    exactly "this ran partially" — and it names both halves.
    """
    status, reason, payload = chain._normalize(ADAPTERS_MIXED)
    assert status == "ok", status
    assert reason, "a partial outcome with a null reason is indistinguishable from a clean ok"
    assert reason.startswith("partial:"), reason
    assert "steps.retrieval" in reason and "WISDOM_RETRIEVAL_INDEX_ENABLED is off" in reason
    assert "inserted=3" in reason or "rows=3" in reason, reason
    assert payload["_outcome"]["decision"] == "partial"
    assert [row["path"] for row in payload["_outcome"]["skipped"]] == ["steps.retrieval"]
    assert payload["_outcome"]["work"], "the mixed verdict must name the work it found"


def test_a_mixed_step_is_never_recorded_as_fully_skipped():
    """The other half of the rule: work anywhere outvotes a skip for the STATUS."""
    status, _, _ = chain._normalize({"discord": {"skipped": "off"}, "transcripts": {"written": 4}})
    assert status == "ok"


def test_one_work_counter_is_what_separates_skipped_from_partial():
    """⛔ THE DISCRIMINATOR. The same payload, one write counter apart, must not give one answer
    — a fixture that cannot distinguish is not a rail."""
    both_off = chain._normalize(SOURCES_BOTH_OFF)[0]
    one_worked = chain._normalize({**SOURCES_BOTH_OFF, "transcripts": {"written": 2}})[0]
    assert (both_off, one_worked) == ("skipped", "ok")


# ── 4. the did-work case and the control ─────────────────────────────────────

def test_a_step_that_did_work_still_reports_a_plain_ok():
    for did in ({"written": 3}, {"rows": 3}, {"records_updated": 1}, {"did_work": True}):
        assert chain._normalize(did)[:2] == ("ok", None), did


def test_the_control_the_walker_can_still_see_a_genuine_ok():
    """⭐ THE CONTROL. A walk that answered `skipped` to everything would pass every test above
    and be worthless. A real, deeply nested, working payload must come back as a bare `ok` with
    NO `_outcome` attached — proof the walk is reading, not asserting.
    """
    status, reason, payload = chain._normalize(ADAPTERS_MIXED["steps"]["brainkb"])
    assert (status, reason) == ("ok", None)
    assert "_outcome" not in payload
    quiet = chain._normalize(LEVEL_ALERTS_QUIET)
    assert quiet[:2] == ("ok", None), "a step that declared nothing must not be given a skip"


def test_thresholds_and_inputs_are_not_counted_as_work():
    """⛔ `floor: 0.8`, `candidates: 5` and `lookback_days: 10` are configuration and INPUTS.
    Counting any positive number would let them outvote a step's own skip markers, which is the
    defect this file exists for, re-committed one level down."""
    out = {"skipped": "nothing to score", "floor": 0.8, "candidates": 5, "lookback_days": 10,
           "open_calls": 3, "docs": 412}
    assert chain._normalize(out)[0] == "skipped"
    # control: the same payload with a real write counter flips it
    assert chain._normalize({**out, "enqueued": 1})[0] == "ok"


def test_a_zero_or_false_counter_is_not_work():
    for value in (0, False, -1):
        assert chain._normalize({"skipped": "off", "written": value})[0] == "skipped", value
    assert chain._normalize({"skipped": "off", "written": 1})[0] == "ok"


# ── 5. the legacy sentences, and failure precedence ──────────────────────────

def test_the_top_level_skip_sentences_are_byte_for_byte_what_they_were():
    """Every `skipped` row already in wisdom_chain_steps was written by the old code. A walk
    that rephrased them would rewrite history in place."""
    assert chain._normalize({"status": "skipped", "reason": "WISDOM_EXTRACT_ENABLED is off"})[:2] == (
        "skipped", "WISDOM_EXTRACT_ENABLED is off")
    assert chain._normalize({"skipped": "holiday"})[:2] == ("skipped", "holiday")
    assert chain._normalize({"status": "failed", "error": "budget cap reached"})[:2] == (
        "failed", "budget cap reached")
    assert chain._normalize("not a dict")[:2] == ("ok", None)


def test_a_reason_and_a_skip_marker_that_disagree_are_both_printed():
    """⚰️ `evals.null_review` returns {"reason": "RQ-v11-001", "skipped": "no gate run
    recorded"}. The old code took `reason` first and recorded the TICKET NUMBER as the
    explanation for why nothing happened."""
    _, reason, _ = chain._normalize({"reason": "RQ-v11-001", "emitted": 0, "created": 0,
                                     "skipped": "no gate run recorded"})
    assert "no gate run recorded" in reason and "RQ-v11-001" in reason, reason


def test_a_declared_failure_beats_a_nested_skip():
    status, reason, _ = chain._normalize({"status": "failed", "error": "boom",
                                          "part": {"skipped": "off"}})
    assert (status, reason) == ("failed", "boom")


def test_the_walk_never_raises_and_is_bounded():
    deep = cur = {}
    for i in range(40):
        cur["child"] = {"skipped": f"level {i}"}
        cur = cur["child"]
    status, _, payload = chain._normalize(deep)
    assert status == "skipped" and payload["_outcome"]["truncated"] is True
    wide = {"rows": [{"skipped": str(i)} for i in range(chain._WALK_MAX_NODES + 50)]}
    assert chain._normalize(wide)[0] == "skipped"


# ── 6. end to end, through the real chain and the observation log ────────────

def test_the_recorded_row_and_the_observation_line_both_carry_the_partial(db, monkeypatch):
    """⛔ THE ARTIFACTS, not the function. The production lie was in TWO places — the chain
    result and the observation log — and the log used to print a reason only for non-ok rows,
    so a partial would have been invisible exactly where a human reads it."""
    _fake_module(monkeypatch, "wisdom_r66_mod",
                 sources=lambda ctx: dict(SOURCES_BOTH_OFF),
                 adapters=lambda ctx: dict(ADAPTERS_MIXED),
                 capture=lambda ctx: {"rows": 3})
    steps = (chain.Step("capture", "capture", (("wisdom_r66_mod", "capture"),)),
             chain.Step("sources", "sources", (("wisdom_r66_mod", "sources"),)),
             chain.Step("adapters", "publish", (("wisdom_r66_mod", "adapters"),)))
    out = chain.run_chain("daily", _ctx(), steps)
    assert [(s["step"], s["status"]) for s in out["steps"]] == [
        ("capture", "ok"), ("sources", "skipped"), ("adapters", "ok")]
    assert out["summary"] == {"ok": 2, "failed": 0, "not_available": 0, "skipped": 1}

    with store.read() as conn:
        rows = {r["step"]: (r["status"], r["reason"], r["result_json"]) for r in conn.execute(
            "SELECT step, status, reason, result_json FROM wisdom_chain_steps WHERE chain_run_id = 'r66-1'")}
    assert rows["sources"][0] == "skipped" and "discord" in rows["sources"][1]
    assert '"decision": "skipped"' in rows["sources"][2]
    assert rows["adapters"][0] == "ok" and rows["adapters"][1].startswith("partial:")
    assert rows["capture"][1] is None, "an ordinary ok step must keep a null reason"

    lines = {e["stream"]: e["line"] for e in out["observation_log"]}
    assert lines["capture"] == "capture=ok rows=3"          # unchanged for an ordinary ok
    assert lines["sources"].startswith("sources=skipped (") and "discord" in lines["sources"]
    assert lines["publish"].startswith("adapters=ok") and "partial:" in lines["publish"]


def test_a_skipped_step_is_re_run_by_a_catch_up_and_a_partial_is_not(db, monkeypatch):
    """⭐ WHY MIXED IS `ok`: the status IS the resume contract. `_prior_ok_steps` reads `ok`
    only, so recording a partial as `skipped` would re-do the half that already wrote rows."""
    calls: list = []
    _fake_module(monkeypatch, "wisdom_r66_resume",
                 sources=lambda ctx: calls.append("sources") or dict(SOURCES_BOTH_OFF),
                 adapters=lambda ctx: calls.append("adapters") or dict(ADAPTERS_MIXED))
    steps = (chain.Step("sources", "sources", (("wisdom_r66_resume", "sources"),)),
             chain.Step("adapters", "publish", (("wisdom_r66_resume", "adapters"),)))
    chain.run_chain("daily", _ctx(run_id="first"), steps)
    calls.clear()
    again = chain.run_chain("daily", _ctx(run_id="second"), steps)
    assert calls == ["sources"], "the skipped step re-runs; the partial one does not"
    statuses = {s["step"]: s["status"] for s in again["steps"]}
    assert statuses == {"sources": "skipped", "adapters": "skipped"}
    assert "already ok" in next(s for s in again["steps"] if s["step"] == "adapters")["reason"]


# ── the vocabulary is derived from the steps, not invented ───────────────────

def test_every_skip_status_this_walk_knows_is_one_a_real_step_can_return():
    """⛔ A marker nothing emits is a guard that can never fire, and it reads as coverage.
    Each of these is grepped back to the module that returns it."""
    import pathlib
    import re

    repo = pathlib.Path(__file__).resolve().parents[1]
    sources = {p: p.read_text(encoding="utf-8") for p in (repo / "api" / "services" / "wisdom").rglob("*.py")}
    # ⛔ code, never prose: comments and docstrings are stripped before the search, and the
    # control below proves the stripped text can still see a real occurrence.
    stripped = {}
    for path, text in sources.items():
        body = re.sub(r'"""(?:.|\n)*?"""', "", text)
        body = re.sub(r"'''(?:.|\n)*?'''", "", body)
        stripped[path] = "\n".join(line.split("#", 1)[0] for line in body.splitlines())
    haystack = "\n".join(v for k, v in stripped.items() if k.name != "chain.py")
    for status in chain.SKIP_STATUSES:
        if status == "not_available":      # this module's own vocabulary for an unbuilt target
            assert "not_available" in stripped[repo / "api" / "services" / "wisdom" / "publish" / "chain.py"]
            continue
        assert f'"{status}"' in haystack or f"'{status}'" in haystack, status
    # control: the stripped corpus can still see a string that is only ever real code
    assert '"blocked_by_gate"' in haystack
    assert '"a_status_no_step_returns"' not in haystack
