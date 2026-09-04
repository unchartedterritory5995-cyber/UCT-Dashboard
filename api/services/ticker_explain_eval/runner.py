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
    def _fn(sym, question, evidence, model, extra_note=""):
        return _fake_resp(payload)
    return _fn


def run_question(question: _gs.Question, *, model_fn: Optional[Callable] = None) -> dict:
    """Run one golden-set question through the REAL orchestrator
    (`ticker_explain.explain_recent_activity`), with evidence pinned to the
    question's own seed. `model_fn` (offline mode) replaces `_call_model`
    with a scripted stand-in matching its `(sym, question, evidence, model,
    extra_note="")` signature; `None` (live mode) calls the real model."""
    from api.services import ticker_explain as te

    entity = {"status": "resolved", "entityId": f"eval_{question.sym.lower()}"}
    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch.object(
            te, "_build_evidence", lambda sym: (entity, list(question.evidence))))
        if model_fn is not None:
            stack.enter_context(mock.patch.object(te, "_call_model", model_fn))
            stack.enter_context(mock.patch(
                "api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False))
        return te.explain_recent_activity(question.sym, question.question)


def run_golden_set(*, model_fn: Optional[Callable] = None,
                   questions: Optional[tuple] = None) -> dict[str, Any]:
    """Run every question (or a `questions` subset), score each with the
    mechanical checks, and return a report. Mechanical-only -- the three
    judge-only dimensions (source_selection, answer_relevance,
    terminal_usefulness) are reported as `not_scored` here; `judge.py`
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
