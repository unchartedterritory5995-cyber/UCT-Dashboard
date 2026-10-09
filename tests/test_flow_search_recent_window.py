"""Wave 5: a head ticker's member Search gets a labelled RECENT WINDOW instead of "too big".

NVDA / SPY / QQQ always exceed the 48 MB / 20 s materialisation budget, so the Search deep-dive
answered 503 "too big" for them on every ask. A client that can label a partial answer asks with
`recent=1` and, once the full product is known to be over budget, gets the page's derivation over
the newest sessions that fit `_RECENT_ROWS` with `X-Flow-Window: recent`. It never re-reads the
full history on a request, and a caller that did not opt in still gets the refusal.

These go through the real endpoint (the route has been silently taken by a misplaced decorator
before; see tests/test_flow_card_from_page.py).
"""
import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import flow_router as fr
from api.flow_admin_auth import require_flow_user

SESSIONS = [("9/29/2026", 60), ("9/30/2026", 60), ("10/1/2026", 60), ("10/2/2026", 60), ("10/5/2026", 60)]


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(fr.flow_router)
    app.dependency_overrides[require_flow_user] = lambda: {"via": "test"}
    return TestClient(app, raise_server_exceptions=False)


def _clear():
    with fr._SEARCH_WARMING_LOCK:
        fr._SEARCH_WARMING.clear()
        fr._WARM_FAILED_UNTIL.clear()
    with fr._TOO_BIG_LOCK:
        fr._TOO_BIG_UNTIL.clear()
    with fr._BASIS_RECENT_LOCK:
        fr._BASIS_RECENT.clear()
        fr._BASIS_REFRESHING.clear()
    with fr._BASIS_PARTIAL_LOCK:
        fr._BASIS_PARTIAL_UNTIL.clear()


class _FakeDB:
    """Every session is one 'x'*rows chunk; `calls` records which dates each stream asked for."""

    def __init__(self):
        self.calls = []

    def stream_csv_symbol(self, sym, source="stocks", columns=None, dates=None):
        self.calls.append(None if dates is None else list(dates))
        yield "h\n"
        for d, n in SESSIONS:
            if dates is None or d in dates:
                yield ("x" * 9 + "\n") * n


class _Proc:
    returncode = 0
    stderr = b""
    stdout = json.dumps({"product": {"all_directional": [], "TICKER_DB": []}, "rows": 1}).encode()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    _clear()
    cache = {}
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: cache.get(k))
    monkeypatch.setattr(fr, "_search_product_cache_put", lambda k, v: cache.__setitem__(k, v))
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: "1.0")
    monkeypatch.setattr(fr, "_symbol_session_counts", lambda sym: list(SESSIONS))
    monkeypatch.setattr(fr, "_market_dates", lambda src: [d for d, _ in SESSIONS])
    monkeypatch.setattr(fr, "_RECENT_ROWS", 130)          # the newest two sessions fit
    monkeypatch.setattr(fr.subprocess, "run", lambda *a, **k: _Proc())
    fake = _FakeDB()
    monkeypatch.setattr(fr, "db", fake)
    yield fake
    _clear()


def _known_too_big(sym="NVDA", src="stocks"):
    fr._note_too_big(sym, src, (sym, src, "1.0"))


def test_a_known_too_big_head_ticker_gets_the_labelled_recent_window(client, _isolate):
    _known_too_big()
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks&recent=1")
    assert r.status_code == 200, r.text
    assert r.headers["X-Flow-Window"] == "recent"
    body = r.json()
    assert body["ok"] is True and body["sym"] == "NVDA" and body["version"] == r.headers["X-Flow-Version"]
    assert body["window_dates"] == ["10/2/2026", "10/5/2026"]
    assert body["sessions_total"] == 5 and body["basis_complete"] is False and body["basis_cut"] == "rows"
    # Never the whole history: every stream on this request named its sessions.
    assert _isolate.calls and None not in _isolate.calls
    assert sorted(d for c in _isolate.calls for d in c) == ["10/2/2026", "10/5/2026"]


def test_CONTROL_without_recent_the_known_too_big_answer_is_still_the_refusal(client, _isolate):
    _known_too_big()
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks")
    assert r.status_code == 503 and "budget" in r.json()["error"]
    assert "X-Flow-Window" not in r.headers
    assert _isolate.calls == []


def test_CONTROL_a_ticker_not_known_too_big_takes_the_normal_full_build(client, _isolate):
    r = client.get("/api/flow/ticker-product/AMD?source=stocks&recent=1")
    assert r.status_code == 200
    assert "X-Flow-Window" not in r.headers
    assert _isolate.calls == [None], "a normal ticker reads its full history once, as before"


def test_warm_only_never_builds_on_the_request_and_starts_the_window_behind_it(client, monkeypatch, _isolate):
    _known_too_big()
    spawned = []
    monkeypatch.setattr(fr, "_spawn_basis_refresh", lambda *a: spawned.append(a) or True)
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks&warm_only=1&recent=1")
    assert r.status_code == 503 and r.json()["window_pending"] is True
    assert _isolate.calls == [], "warm_only must not read on the request"
    assert spawned == [("NVDA", "stocks", "1.0", 130)]


def test_warm_only_serves_a_built_window_with_its_build_time(client, monkeypatch, _isolate):
    _known_too_big()
    monkeypatch.setattr(fr, "_spawn_basis_refresh", lambda *a: True)
    gz = fr.gzip.compress(json.dumps({"ok": True, "sym": "NVDA", "source": "stocks", "version": "0.9",
                                      "schema": fr._SEARCH_PRODUCT_SCHEMA, "product": {},
                                      "window_dates": ["10/5/2026"], "sessions_total": 5,
                                      "basis_complete": False}).encode())
    fr._basis_recent_put("NVDA", "stocks", 130, gz, "0.9", time.time() - 30)
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks&warm_only=1&recent=1")
    assert r.status_code == 200
    assert r.headers["X-Flow-Window"] == "recent"
    assert r.headers["X-Flow-Version"] == "0.9" == r.json()["version"]
    assert "X-Flow-Basis-As-Of" in r.headers
    assert _isolate.calls == []


def test_a_ticker_whose_warm_is_cooling_off_is_served_the_window_after_the_300s_verdict_lapses(client, monkeypatch, _isolate):
    """The too-big memory (300 s) lapses before the warm cooldown (600 s). In that gap the member
    still gets the window, not a bare "not warm"."""
    fr._note_warm_failure("NVDA")
    monkeypatch.setattr(fr, "_spawn_basis_refresh", lambda *a: True)
    gz = fr.gzip.compress(json.dumps({"ok": True, "sym": "NVDA", "source": "stocks", "version": "1.0",
                                      "schema": fr._SEARCH_PRODUCT_SCHEMA, "product": {}}).encode())
    fr._basis_recent_put("NVDA", "stocks", 130, gz, "1.0", time.time())
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks&warm_only=1&recent=1")
    assert r.status_code == 200 and r.headers["X-Flow-Window"] == "recent"


def test_an_over_budget_warm_asked_with_recent_chains_the_window_build(monkeypatch, _isolate):
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 16)       # the full read overruns at once
    chained = []
    monkeypatch.setattr(fr, "_spawn_basis_refresh", lambda *a: chained.append(a) or True)
    assert fr._spawn_search_warm("NVDA", "stocks", ("NVDA", "stocks", "1.0"), "1.0", then_recent=True)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with fr._SEARCH_WARMING_LOCK:
            if "NVDA" not in fr._SEARCH_WARMING:
                break
        time.sleep(0.01)
    assert chained == [("NVDA", "stocks", "1.0", 130)]
    assert fr._SEARCH_BUILD_LOCK.acquire(blocking=False), "the lane was left held"
    fr._SEARCH_BUILD_LOCK.release()


def test_CONTROL_an_over_budget_warm_without_recent_chains_nothing(monkeypatch, _isolate):
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 16)
    chained = []
    monkeypatch.setattr(fr, "_spawn_basis_refresh", lambda *a: chained.append(a) or True)
    assert fr._spawn_search_warm("SPY", "stocks", ("SPY", "stocks", "1.0"), "1.0")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with fr._SEARCH_WARMING_LOCK:
            if "SPY" not in fr._SEARCH_WARMING:
                break
        time.sleep(0.01)
    assert chained == []
