"""Wave-2 audit 2026-10-08: an unknown ticker answered 200 with nulls on four per-ticker
reads, and a panel drew that as a real company with nothing on file. Each read now adds
the additive `not_found` marker when its answer is EMPTY and the symbol is a DEFINITE miss
(api/services/symbol_presence.py). A real ticker -- empty or not -- never carries it, and a
lookup that cannot answer adds nothing."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import symbol_presence as sp

_MOD = SimpleNamespace(UNKNOWN="unknown")


def _verdict(status, suggestions=()):
    calls = []

    def fake(sym):
        calls.append(sym)
        return _MOD, SimpleNamespace(status=status, symbol=sym, suggestions=tuple(suggestions))
    return fake, calls


@pytest.fixture(autouse=True)
def _clean():
    sp._reset_for_tests()
    yield
    sp._reset_for_tests()


# ── the helper ──────────────────────────────────────────────────────────────

def test_a_definite_miss_carries_the_marker_and_the_sentence(monkeypatch):
    fake, _ = _verdict("unknown", ["ZQXV"])
    monkeypatch.setattr(sp, "_resolve", fake)
    m = sp.unknown_marker("zzqxv")
    assert m == {"not_found": True, "message": "No data for ZZQXV — check the ticker",
                 "suggestions": ["ZQXV"]}


def test_a_known_or_unanswerable_symbol_adds_nothing(monkeypatch):
    fake, _ = _verdict("known")
    monkeypatch.setattr(sp, "_resolve", fake)
    assert sp.unknown_marker("NVDA") == {}
    fake, calls = _verdict("unanswerable")
    monkeypatch.setattr(sp, "_resolve", fake)
    assert sp.unknown_marker("NEWCO") == {}
    assert sp.unknown_marker("NEWCO") == {}
    assert calls == ["NEWCO", "NEWCO"], "an unanswerable verdict must never be memoised"


def test_a_resolver_that_raises_is_not_a_no(monkeypatch):
    monkeypatch.setattr(sp, "_resolve", lambda s: (_ for _ in ()).throw(RuntimeError("db")))
    assert sp.unknown_marker("ZZQXV") == {}


def test_the_verdict_is_memoised_and_the_cached_payload_never_mutated(monkeypatch):
    fake, calls = _verdict("unknown")
    monkeypatch.setattr(sp, "_resolve", fake)
    payload = {"name": None}
    out = sp.mark_if_empty(payload, "ZZQXV", True)
    sp.mark_if_empty(payload, "ZZQXV", True)
    assert out["not_found"] is True and payload == {"name": None}
    assert calls == ["ZZQXV"]


def test_a_non_empty_answer_never_pays_for_the_lookup(monkeypatch):
    fake, calls = _verdict("unknown")
    monkeypatch.setattr(sp, "_resolve", fake)
    assert sp.mark_if_empty({"name": "Nvidia"}, "NVDA", False) == {"name": "Nvidia"}
    assert calls == []


# ── through the four routes ─────────────────────────────────────────────────

def _client(router, overrides=None):
    app = FastAPI()
    app.include_router(router)
    for dep, fn in (overrides or {}).items():
        app.dependency_overrides[dep] = fn
    return TestClient(app)


def test_ticker_meta_marks_an_unknown_symbol_and_keeps_its_shape(monkeypatch):
    from api.routers import ticker_meta as tm
    monkeypatch.setattr(tm, "get_ticker_meta",
                        lambda t: {"name": None, "sector": None, "industry": None,
                                   "exchange": None, "theme": None})
    fake, _ = _verdict("unknown")
    monkeypatch.setattr(sp, "_resolve", fake)
    body = _client(tm.router).get("/api/ticker-meta/ZZQXV").json()
    assert body["not_found"] is True and body["name"] is None and "sector" in body

    fake, _ = _verdict("known")
    monkeypatch.setattr(sp, "_resolve", fake)
    sp._reset_for_tests()
    body = _client(tm.router).get("/api/ticker-meta/QUIET").json()
    assert "not_found" not in body


def test_ticker_snapshot_marks_an_unknown_symbol(monkeypatch):
    from api.routers import snapshot as snap
    from api.middleware.auth_middleware import get_current_user
    monkeypatch.setattr(snap, "get_ticker_snapshot", lambda t: None)
    fake, _ = _verdict("unknown")
    monkeypatch.setattr(sp, "_resolve", fake)
    c = _client(snap.router, {get_current_user: lambda: {"id": "u1"}})
    assert c.get("/api/snapshot/ZZQXV").json()["not_found"] is True
    monkeypatch.setattr(snap, "get_ticker_snapshot", lambda t: {"price": 1.0})
    assert c.get("/api/snapshot/NVDA").json() == {"price": 1.0}


def test_fundamentals_marks_only_an_EMPTY_answer_for_an_unknown_symbol(monkeypatch):
    from api.routers import fundamentals as fr
    fake, calls = _verdict("unknown")
    monkeypatch.setattr(sp, "_resolve", fake)
    c = _client(fr.router)
    monkeypatch.setattr(fr, "_fundamentals_payload",
                        lambda s: {"market_cap": None, "status": "empty"})
    body = c.get("/api/fundamentals/ZZQXV").json()
    assert body["not_found"] is True and body["status"] == "empty"
    # "unavailable" is a provider failure -- never "it does not exist".
    monkeypatch.setattr(fr, "_fundamentals_payload",
                        lambda s: {"market_cap": None, "status": "unavailable"})
    assert "not_found" not in c.get("/api/fundamentals/OTHER").json()
    assert calls == ["ZZQXV"]


def test_research_snapshot_marks_an_unknown_symbol(monkeypatch):
    from api.routers import research as rr
    fake, _ = _verdict("unknown")
    monkeypatch.setattr(sp, "_resolve", fake)
    monkeypatch.setattr(rr, "get_snapshot", lambda s: {
        "sym": s, "name": s, "sector": None, "industry": None, "composite": None,
        "components": {}, "checkup": [], "method": None,
        "metrics": {"market_cap": None, "beta": None}})
    body = _client(rr.router).get("/api/research/snapshot/ZZQXV").json()
    assert body["not_found"] is True and body["metrics"] == {"market_cap": None, "beta": None}

    monkeypatch.setattr(rr, "get_snapshot", lambda s: {
        "sym": s, "name": "Nvidia", "sector": "Tech", "composite": 90, "metrics": {"beta": 1.2}})
    assert "not_found" not in _client(rr.router).get("/api/research/snapshot/NVDA").json()


def test_the_verdict_words_match_the_one_authority():
    """symbol_presence compares against the resolver's own constants; pin them."""
    from api.services.discord_render import symbols
    assert (symbols.KNOWN, symbols.UNKNOWN) == ("known", "unknown")
    assert {"status", "symbol", "suggestions"} <= set(symbols.Resolution.__dataclass_fields__)
