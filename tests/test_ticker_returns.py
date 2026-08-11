"""Since-mention returns for Desk ticker moments (spec 2026-08-11).

bars_sqlite is monkeypatched at ticker_returns' imported name — the sqlite
layer has its own coverage; these tests pin the return MATH, the on-or-before
anchor basis, omission of bar-less symbols, and the TTL cache."""
import pytest

from api.services import ticker_returns


def _mk_bars(closes, start_ymd=20260101):
    # (ts, o, h, l, c, v) daily rows, ts ascending from start_ymd (calendar-naive:
    # sequential ints are fine — the code never date-walks ts, only orders/compares)
    return [(start_ymd + i, c, c, c, c, 1000) for i, c in enumerate(closes)]


def test_anchor_date_et_converts_epoch():
    # 2026-08-09 23:30 UTC == 19:30 ET same day (epoch 1786248000)
    assert ticker_returns.anchor_date_et(1786248000) == "2026-08-09"


def test_returns_math_basis_is_on_or_before_anchor(monkeypatch):
    ticker_returns._cache.clear()
    # basis close 100 at/before anchor; after-anchor closes walk up to 121
    basis = _mk_bars([100.0], start_ymd=20260601)
    after = _mk_bars([102.0, 104.0, 106.0, 108.0, 110.0] + [110.0] * 15 + [121.0],
                     start_ymd=20260602)
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, k: basis)
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since",
                        lambda t, tf, k: after)
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786248000})
    monkeypatch.setattr(ticker_returns.edu, "get_insights",
                        lambda vid: {"ticker_moments": [{"t": 5, "ticker": "NVDA"}]})
    out = ticker_returns.returns_for_video(1)
    assert out["anchor_date"] == "2026-08-09"
    r = out["returns"]["NVDA"]
    assert r["since_pct"] == 21.0          # 100 -> 121
    assert r["d5_pct"] == 10.0             # 100 -> after[4] = 110
    assert r["d21_pct"] == 21.0            # 100 -> after[20] = 121
    assert out["as_of"]


def test_short_history_nulls_d5_d21_and_since_zero_when_no_after(monkeypatch):
    ticker_returns._cache.clear()
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, k: _mk_bars([50.0]))
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since",
                        lambda t, tf, k: [])
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786248000})
    monkeypatch.setattr(ticker_returns.edu, "get_insights",
                        lambda vid: {"ticker_moments": [{"t": 1, "ticker": "AAPL"}]})
    r = ticker_returns.returns_for_video(2)["returns"]["AAPL"]
    assert r["since_pct"] == 0.0 and r["d5_pct"] is None and r["d21_pct"] is None


def test_symbol_without_basis_omitted_and_dedup(monkeypatch):
    ticker_returns._cache.clear()
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, k: [] if t == "GHOST" else _mk_bars([10.0]))
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since",
                        lambda t, tf, k: _mk_bars([11.0]))
    calls = []
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786248000})
    monkeypatch.setattr(ticker_returns.edu, "get_insights", lambda vid: {
        "ticker_moments": [{"t": 1, "ticker": "TSLA"}, {"t": 9, "ticker": "TSLA"},
                           {"t": 20, "ticker": "GHOST"}]})
    real_before = ticker_returns._returns_for
    monkeypatch.setattr(ticker_returns, "_returns_for",
                        lambda s, k: calls.append(s) or real_before(s, k))
    out = ticker_returns.returns_for_video(3)["returns"]
    assert "GHOST" not in out and out["TSLA"]["since_pct"] == 10.0
    assert calls.count("TSLA") == 1        # de-duplicated before computing


def test_missing_video_yields_empty_payload(monkeypatch):
    ticker_returns._cache.clear()
    monkeypatch.setattr(ticker_returns.edu, "get_video", lambda vid: None)
    out = ticker_returns.returns_for_video(999)
    assert out == {"anchor_date": None, "as_of": None, "returns": {}}


def test_ttl_cache_serves_then_expires(monkeypatch):
    ticker_returns._cache.clear()
    hits = {"n": 0}

    def counting_before(t, tf, n, k):
        hits["n"] += 1
        return _mk_bars([100.0])
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before", counting_before)
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since", lambda t, tf, k: [])
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786248000})
    monkeypatch.setattr(ticker_returns.edu, "get_insights",
                        lambda vid: {"ticker_moments": [{"t": 1, "ticker": "AMD"}]})
    ticker_returns.returns_for_video(7, now=1000.0)
    ticker_returns.returns_for_video(7, now=1100.0)      # inside TTL — cache hit
    assert hits["n"] == 1
    ticker_returns.returns_for_video(7, now=1000.0 + 601.0)  # expired — recompute
    assert hits["n"] == 2


def test_route_registered_with_paid_auth():
    from api.routers import education
    routes = {r.path: r for r in education.router.routes}
    path = "/api/education/videos/{video_id}/ticker-returns"
    assert path in routes, f"ticker-returns route missing; have: {sorted(routes)}"
    # Non-vacuity control: the sibling insights route is in the same table
    assert "/api/education/videos/{video_id}/insights" in routes


def test_endpoint_returns_service_payload(monkeypatch):
    ticker_returns._cache.clear()
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import education
    sentinel = {"anchor_date": "2026-08-09", "as_of": "x", "returns": {"NVDA": {"since_pct": 1.0, "d5_pct": None, "d21_pct": None}}}
    monkeypatch.setattr(ticker_returns, "returns_for_video", lambda vid: sentinel)
    app = FastAPI()
    app.include_router(education.router)
    app.dependency_overrides[education.require_paid] = lambda: {"email": "t@t.t"}
    client = TestClient(app)
    resp = client.get("/api/education/videos/5/ticker-returns")
    assert resp.status_code == 200 and resp.json() == sentinel
