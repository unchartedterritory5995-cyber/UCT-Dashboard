"""AI-Search report-card rails (2026-08-28): the ratchet pin (bars only move
UP, and deliberately), golden-set integrity (every gate names a reachable tool,
every forbidden token can actually fire), gate math, and the capture seam's
member-path-unchanged guarantee."""
import inspect
from pathlib import Path

import pytest

from api.services.ai_search_eval import golden_set as gs

_ROOT = Path(__file__).resolve().parents[1]


def test_pass_bars_pinned_unbaselined():
    """RATCHET DISCIPLINE: these bars are all zero until the first honest run
    is recorded. When you baseline, update SEARCH_RUNG_PASS_BARS,
    BASELINE_LABEL and THIS TEST in the same commit — and never lower a bar
    to green a run (compass_eval's standing rule)."""
    assert gs.SEARCH_RUNG_PASS_BARS == {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    assert "UNBASELINED" in gs.BASELINE_LABEL


def test_golden_set_integrity():
    qs = gs.load_golden_set()
    assert len(qs) == 30
    assert gs.rung_question_counts() == {1: 8, 2: 6, 3: 6, 4: 5, 5: 5}
    ids = [q["id"] for q in qs]
    assert len(set(ids)) == len(ids)
    # every gated tool must be one the agent lane can actually fire
    from api.services.ai_search_agent import _AGENT_ALLOWED
    reachable = set(_AGENT_ALLOWED) | {"web_search"}
    for q in qs:
        assert len(q["question"]) >= 10, q["id"]
        assert q.get("great_answer"), q["id"]
        for group in q.get("must_call_tools") or []:
            for tool in group:
                assert tool in reachable, f"{q['id']} gates unreachable tool {tool}"
    # every armed forbidden token must exist in checks.py — a typo'd token
    # arms nothing and the question silently loses its safety tripwire
    checks_src = (_ROOT / "api" / "services" / "compass_eval" / "checks.py").read_text(
        encoding="utf-8")
    for q in qs:
        for tok in q.get("forbidden") or []:
            assert f'"{tok}"' in checks_src, f"{q['id']} arms unknown token {tok}"


def test_gate_math_and_ungraded_lane():
    # all-zero bars → a run with zero passes is not "failed", just unbaselined
    summary = {1: {"questions": 8, "passed": 0}, 5: {"questions": 5, "passed": 0}}
    out = gs.evaluate_gate(summary, safety_breaks=0)
    assert not out["failed"] and not out["errored"]
    # any safety break fails regardless of bars
    out2 = gs.evaluate_gate(summary, safety_breaks=1)
    assert out2["failed"] and "safety" in out2["reasons"][0]
    # ungraded questions surface as errored, never silently pass/fail
    out3 = gs.evaluate_gate(summary, safety_breaks=0, ungraded=2)
    assert out3["errored"] and not out3["failed"]
    # an UNGRADED judge result must raise, not score 0 (D-22)
    with pytest.raises(ValueError):
        gs.question_passed(1, {"judge_error": "unparseable"}, [], True)


def test_capture_param_leaves_the_member_path_unchanged():
    """The exam's `capture` seam must be invisible to production: default None,
    append gated on it, and the router never passes it."""
    from api.services.ai_search_agent import run_agent
    sig = inspect.signature(run_agent)
    assert sig.parameters["capture"].default is None
    agent_src = (_ROOT / "api" / "services" / "ai_search_agent.py").read_text(
        encoding="utf-8")
    assert "if capture is not None" in agent_src
    router_src = (_ROOT / "api" / "routers" / "ai_search.py").read_text(encoding="utf-8")
    assert "run_agent(" in router_src          # control: the call site exists
    assert "capture=" not in router_src        # …and never opts into capture


def test_report_card_cli_fences_every_live_store():
    """The exam banner promises a sandbox. _grounded_system can reach the
    dossier batch (real spend), the memory index, the member store and the
    capture log — every one must be FORCED off/redirected in the staging
    block, before any api import (2026-08-28 review)."""
    src = (_ROOT / "scripts" / "run_search_report_card.py").read_text(encoding="utf-8")
    staging = src.split("from api.services")[0]    # only the pre-import block counts
    for line in (
        'os.environ["AI_SEARCH_DOSSIER_ENABLED"] = "0"',
        'os.environ["AI_SEARCH_MEMORY_ENABLED"] = "0"',
        'os.environ["AI_SEARCH_PERSONAL_ENABLED"] = "0"',
        'os.environ["AI_SEARCH_LOG_ENABLED"] = "0"',
        'os.environ["AI_SEARCH_MEMBER_DB_PATH"]',
        'os.environ["AI_SEARCH_LOG_DB_PATH"]',
        'os.environ["AI_SEARCH_MEMORY_DB"]',
        'os.environ["COMPASS_EVAL_DB"]',           # forced, never setdefault
        'os.environ["AUTH_DB_PATH"]',
    ):
        assert line in staging, f"staging block lost: {line}"
    assert 'setdefault("COMPASS_EVAL_DB"' not in src
