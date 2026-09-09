"""Replay harness for the Explain-assistant golden set.

Mirrors compass_eval/runner.py's role (replay through the REAL handler,
never a mock of the handler itself) adapted to ticker_explain.py's
single-shot shape: no generator to drain, no persisted chat thread to
wipe between questions -- each question is independent by construction.

Two modes:
  - OFFLINE (`model_fn` supplied): `_call_model` is replaced with a
    scripted stand-in. No live key needed; this is what runs in ordinary
    CI and is what `tests/test_ticker_explain_eval.py` exercises.
  - LIVE (`model_fn=None`): the real model answers. This is the bounded
    live-validation checkpoint's own harness -- same golden set, same
    mechanical checks, real answers.

`_build_evidence` is ALWAYS patched to the question's own seeded evidence
in both modes -- the golden set's ground truth must never depend on live
FMP data, the same reasoning compass_eval's seeded `_EVAL_TRADES` uses.

Slice 3 (`run_turn`/`run_sequence`) extends this to MULTI-TURN sequences.
`_build_evidence` is patched the same way, PLUS the turn's own seeded
`domains` (bypassing real `_resolve_domains` routing, matching the single-
turn philosophy exactly -- referential-fallback ROUTING is verified by
dedicated unit tests in test_ticker_explain.py, not here). History between
turns is accumulated from each turn's REAL `turn_state` output, never from
the fixture's own expectations -- this is what makes the multi-turn replay
match production's client-round-trip contract exactly, including the
sliding-window trim.
"""
from __future__ import annotations

import contextlib
from types import SimpleNamespace
from typing import Any, Callable, Optional
from unittest import mock

from api.services.ticker_explain_eval import checks as _checks
from api.services.ticker_explain_eval import golden_set as _gs


def _fake_resp(payload: dict, stop_reason: str = "end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=__import__("json").dumps(payload))],
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=0, output_tokens=0,
                              cache_read_input_tokens=0, cache_creation_input_tokens=0,
                              server_tool_use=None),
    )


def scripted_model(payload: dict, stop_reason: str = "end_turn") -> Callable:
    """Build a `_call_model`-shaped stand-in that always returns `payload`,
    regardless of the question -- for a harness self-test, not a per-
    question scripted answer (see test_ticker_explain_eval.py for that)."""
    def _fn(sym, question, evidence, model, extra_note="", history=None):
        return _fake_resp(payload)
    return _fn


def run_question(question: _gs.Question, *, model_fn: Optional[Callable] = None) -> dict:
    """Run one golden-set question through the REAL orchestrator
    (`ticker_explain.explain_recent_activity`), with evidence pinned to the
    question's own seed. `model_fn` (offline mode) replaces `_call_model`
    with a scripted stand-in matching its `(sym, question, evidence, model,
    extra_note="", history=None)` signature; `None` (live mode) calls the
    real model."""
    from api.services import ticker_explain as te

    entity = {"status": "resolved", "entityId": f"eval_{question.sym.lower()}"}
    with contextlib.ExitStack() as stack:
        # Evidence is always the question's own SEED, regardless of what
        # Slice 2's domain router (`_classify_domains`) would have picked
        # for the real question text -- routing is a production-only
        # concern; the golden set's ground truth must never depend on it
        # (same reasoning as never depending on live FMP data).
        stack.enter_context(mock.patch.object(
            te, "_build_evidence",
            lambda sym, q="", prior_domains=None: (entity, list(question.evidence), [])))
        if model_fn is not None:
            stack.enter_context(mock.patch.object(te, "_call_model", model_fn))
            stack.enter_context(mock.patch(
                "api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False))
        return te.explain_recent_activity(question.sym, question.question)


def run_golden_set(*, model_fn: Optional[Callable] = None,
                   questions: Optional[tuple] = None) -> dict[str, Any]:
    """Run every question (or a `questions` subset), score each with the
    mechanical checks, and return a report. Mechanical-only -- the judge-
    only dimensions (source_selection, answer_relevance, terminal_usefulness,
    reference_resolution) are reported as `not_scored` here; `judge.py`
    scores those during the live-validation checkpoint."""
    qs = questions if questions is not None else _gs.QUESTIONS
    results = []
    for q in qs:
        result = run_question(q, model_fn=model_fn)
        checks_out = _checks.run_mechanical_checks(q, result)
        results.append({
            "id": q.id, "dimensions": list(q.dimensions), "sym": q.sym,
            "question": q.question, "result": result, "checks": checks_out,
            "all_passed": all(c["passed"] for c in checks_out.values()),
        })

    by_dimension: dict[str, dict] = {}
    for dim in _gs.DIMENSIONS:
        scored = [r for r in results if dim in r["checks"]]
        if not scored:
            by_dimension[dim] = {"scored": 0, "passed": 0, "not_scored": dim in _checks.JUDGE_ONLY_DIMENSIONS}
            continue
        n_pass = sum(1 for r in scored if r["checks"][dim]["passed"])
        by_dimension[dim] = {"scored": len(scored), "passed": n_pass}

    return {
        "total": len(results),
        "passed": sum(1 for r in results if r["all_passed"]),
        "by_dimension": by_dimension,
        "results": results,
    }


# ── Slice 3: multi-turn sequences ────────────────────────────────────────────

def run_turn(sym: str, turn: _gs.Turn, history: list[dict], *,
            model_fn: Optional[Callable] = None) -> dict:
    """Run ONE turn of a multi-turn sequence through the REAL orchestrator.
    `history` is whatever the sequence has accumulated so far (real prior
    `turn_state`s, already sliding-window-trimmed by the caller) -- passed
    straight through to `explain_recent_activity`, exercising the REAL
    `_clean_history`/`_resolve_domains` referential-fallback machinery
    against it. Only the composer-level fetch is stubbed (to the turn's own
    seeded evidence + domains), matching `run_question`'s philosophy."""
    from api.services import ticker_explain as te

    entity = {"status": "resolved", "entityId": f"eval_{sym.lower()}"}
    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch.object(
            te, "_build_evidence",
            lambda s, q="", prior_domains=None: (entity, list(turn.evidence), list(turn.domains))))
        if model_fn is not None:
            stack.enter_context(mock.patch.object(te, "_call_model", model_fn))
            stack.enter_context(mock.patch(
                "api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False))
        return te.explain_recent_activity(sym, turn.question, history=history)


def run_sequence(sequence: _gs.Sequence, *,
                 model_fn_for_turn: Optional[Callable] = None) -> dict:
    """Run a full multi-turn Sequence, accumulating REAL history (each
    turn's actual `turn_state` output, sliding-window-trimmed to the last 3)
    between turns -- exactly matching production's client-round-trip
    contract, never the fixture's own expectations. `model_fn_for_turn(i,
    turn) -> Callable | None` supplies each turn's scripted model stand-in
    (offline mode); pass `None` to run the real model (live mode) for every
    turn."""
    history: list[dict] = []
    turn_results = []
    for i, turn in enumerate(sequence.turns):
        model_fn = model_fn_for_turn(i, turn) if model_fn_for_turn is not None else None
        result = run_turn(sequence.sym, turn, list(history), model_fn=model_fn)
        turn_results.append(result)
        if result.get("turn_state"):
            history.append(result["turn_state"])
        history = history[-3:]
    return {"id": sequence.id, "dimensions": list(sequence.dimensions),
           "sym": sequence.sym, "turns": turn_results}


def run_sequence_set(*, model_fn_for_turn: Optional[Callable] = None,
                     sequences: Optional[tuple] = None) -> dict[str, Any]:
    """Run every multi-turn sequence (or a `sequences` subset), scoring each
    turn with the SAME mechanical checks single-turn questions use (`Turn`
    duck-types as `Question` for `run_mechanical_checks`'s purposes)."""
    seqs = sequences if sequences is not None else _gs.SEQUENCES
    seq_reports = []
    for seq in seqs:
        run = run_sequence(seq, model_fn_for_turn=model_fn_for_turn)
        turn_checks = []
        for turn, result in zip(seq.turns, run["turns"]):
            checks_out = _checks.run_mechanical_checks(turn, result)
            turn_checks.append({
                "question": turn.question, "result": result, "checks": checks_out,
                "all_passed": all(c["passed"] for c in checks_out.values()),
            })
        seq_reports.append({
            "id": seq.id, "dimensions": list(seq.dimensions), "sym": seq.sym,
            "turns": turn_checks,
            "all_passed": all(t["all_passed"] for t in turn_checks),
        })
    total_turns = sum(len(s["turns"]) for s in seq_reports)
    passed_turns = sum(1 for s in seq_reports for t in s["turns"] if t["all_passed"])
    return {
        "total_sequences": len(seq_reports),
        "passed_sequences": sum(1 for s in seq_reports if s["all_passed"]),
        "total_turns": total_turns,
        "passed_turns": passed_turns,
        "sequences": seq_reports,
    }
