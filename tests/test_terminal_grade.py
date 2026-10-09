"""UCT Terminal GRADE -- the read-only route over grade_ticker (api/routers/terminal_grade.py).

Rails, each failing for its own reason:
  * BRAIN_TOOLS_ENABLED off -> `available: false` and grade_ticker is NEVER called (no fake verdict);
  * the Brain Pack missing -> `available: false` with its own reason, grade_ticker never called;
  * the switch is read PER REQUEST (a module-level capture would need a redeploy to flip);
  * on: grade_ticker's verdict fields pass through untouched;
  * grade_ticker's own `{ok: False}` (no regime gate) is answered as unavailable-for-now, not a verdict;
  * the real grade_ticker, with its default (empty) pattern source, answers SKIP / no_setup;
  * a free account is 402; a malformed symbol is 400; a repeat read inside the TTL is cached.

NO NETWORK: the regime, quote and brain readers are monkeypatched.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import terminal_grade as tgr  # noqa: E402
from api.services import rollout_gate as rg  # noqa: E402

PAID = {"id": "grade-a", "email": "a@example.test", "role": "admin"}
FREE = {"id": "grade-free", "email": "f@example.test", "role": "member"}

VERDICT = {
    "ok": True, "symbol": "NVDA", "verdict": "GO", "regime": "GREEN", "regime_note": "Regime GREEN.",
    "setup": "VCP", "grade": "A", "entry": 100.0, "stop": 95.0, "stop_pct": 5.0, "size_pct": 20.0,
    "account_risk_pct": 1.0, "first_target": 110.0, "basis": "VCP on NVDA, graded A.",
    "hard_flags": [], "sources": ["regime classifier (GREEN)", "pattern engine: VCP (conf 85)"],
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    tgr._reset_cache_for_tests()
    monkeypatch.delenv("BRAIN_TOOLS_ENABLED", raising=False)
    yield
    tgr._reset_cache_for_tests()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(tgr.router)
    state = {"user": PAID}
    app.dependency_overrides[get_current_user_with_plan] = lambda: state["user"]
    app.dependency_overrides[rg.require_terminal_next] = lambda: state["user"]
    return TestClient(app), state


def _never(*_a, **_k):
    raise AssertionError("grade_ticker must not run while grading is not available")


def test_switch_off_answers_not_available_and_never_grades(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(tgr, "_grade", _never)
    monkeypatch.setattr(tgr, "_brain_available", lambda: True)
    r = c.get("/api/terminal/grade/NVDA")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert "verdict" not in body
    assert "BRAIN_TOOLS_ENABLED" in body["reason"]


def test_switch_on_but_no_brain_pack_answers_not_available(client, monkeypatch):
    c, _ = client
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    monkeypatch.setattr(tgr, "_grade", _never)
    monkeypatch.setattr(tgr, "_brain_available", lambda: False)
    body = c.get("/api/terminal/grade/NVDA").json()
    assert body == {"available": False, "symbol": "NVDA", "reason": tgr.NO_PACK_REASON}


def test_the_switch_is_read_per_request(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(tgr, "_brain_available", lambda: True)
    monkeypatch.setattr(tgr, "_grade", lambda s: dict(VERDICT))
    assert c.get("/api/terminal/grade/NVDA").json()["available"] is False
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    assert c.get("/api/terminal/grade/NVDA").json()["available"] is True


def test_on_the_verdict_passes_through_untouched(client, monkeypatch):
    c, _ = client
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    monkeypatch.setattr(tgr, "_brain_available", lambda: True)
    monkeypatch.setattr(tgr, "_grade", lambda s: dict(VERDICT))
    body = c.get("/api/terminal/grade/nvda").json()
    assert body["available"] is True
    for k, v in VERDICT.items():
        assert body[k] == v, k
    assert isinstance(body["as_of"], float)


def test_no_regime_gate_is_not_a_verdict(client, monkeypatch):
    c, _ = client
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    monkeypatch.setattr(tgr, "_brain_available", lambda: True)
    monkeypatch.setattr(tgr, "_grade", lambda s: {"ok": False, "reason": "regime unavailable"})
    body = c.get("/api/terminal/grade/NVDA").json()
    assert body["available"] is True and body["ok"] is False
    assert body["reason"] == "regime unavailable"
    assert "verdict" not in body


def test_the_real_grade_ticker_with_no_pattern_source_says_skip_no_setup(client, monkeypatch):
    """End to end over the REAL grade_ticker: its default pattern source returns no detections
    (Seam 28), so the honest answer is SKIP / no_setup -- and the terminal serves exactly that."""
    from api.services import grade_ticker as gt
    c, _ = client
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    monkeypatch.setenv("GRADE_TICKER_CONFIRMED_SOURCE_ENABLED", "0")
    monkeypatch.setattr(tgr, "_brain_available", lambda: True)
    monkeypatch.setattr(gt, "_default_regime_fn", lambda: {"regime": "bull_trend", "narration": "Tape is fine."})
    monkeypatch.setattr(gt, "_default_quote_fn", lambda s: {"last": 100.0})
    body = c.get("/api/terminal/grade/NVDA").json()
    assert body["available"] is True and body["ok"] is True
    assert body["verdict"] == "SKIP"
    assert body["hard_flags"] == ["no_setup"]
    assert body["entry"] is None and body["stop"] is None and body["size_pct"] is None


def test_a_repeat_read_inside_the_ttl_is_cached(client, monkeypatch):
    c, _ = client
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    monkeypatch.setattr(tgr, "_brain_available", lambda: True)
    calls = []
    monkeypatch.setattr(tgr, "_grade", lambda s: calls.append(s) or dict(VERDICT))
    c.get("/api/terminal/grade/NVDA")
    c.get("/api/terminal/grade/NVDA")
    assert calls == ["NVDA"]


def test_a_free_account_is_402(client, monkeypatch):
    c, state = client
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    state["user"] = FREE
    assert c.get("/api/terminal/grade/NVDA").status_code == 402


@pytest.mark.parametrize("sym", ["1NVDA", "NV$DA", "-X"])
def test_a_malformed_symbol_is_400(client, sym):
    c, _ = client
    assert c.get(f"/api/terminal/grade/{sym}").status_code == 400


def test_the_route_carries_both_terminal_gates():
    deps = {getattr(d.dependency, "__name__", "") for d in tgr.router.dependencies}
    assert "_require_paid" in deps
    assert rg.require_terminal_next in {d.dependency for d in tgr.router.dependencies}
