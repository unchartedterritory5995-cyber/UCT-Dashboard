"""TERM-047: backend coverage receipts for the three no-counts surfaces
(period-change sort, the six preset scans, the live volume scan) and plain
/api/screener/scan. Dark: COVERAGE_RECEIPTS_SCANS_ENABLED.

Every receipt CLOSES (evaluated == answered + dropped + not_computable) and a
surface's result set is unchanged by being counted."""
from __future__ import annotations

import pytest

from api.services import coverage_receipt as cr


# ── the shared shape ────────────────────────────────────────────────────────

def test_a_tally_closes_and_caps_its_list_but_never_its_counts():
    t = cr.Tally(cap=2)
    t.answer(5)
    for s in ("A", "B", "C"):
        t.cannot(s, "no close")
    t.drop("D", "recycled")
    r = t.receipt()
    assert (r["evaluated"], r["answered"], r["dropped"], r["not_computable"]) == (9, 5, 1, 3)
    assert len(r["dropped_symbols"]) == 2
    assert r["dropped_symbols"][0] == {"ticker": "A", "reason": "not-computable", "detail": "no close"}


@pytest.mark.parametrize("bad", [
    {"evaluated": 5, "answered": 3, "dropped": 0, "not_computable": 1},
    {"evaluated": 1, "answered": 1, "dropped": 0, "not_computable": 0,
     "dropped_symbols": [{"ticker": "X", "reason": "dropped"}]},
    {"evaluated": 1, "answered": 0, "dropped": 1, "not_computable": 0,
     "dropped_symbols": [{"ticker": "X"}]},
])
def test_a_receipt_that_does_not_close_is_refused(bad):
    with pytest.raises(ValueError):
        cr.close(bad)


def test_publish_strips_the_receipt_while_dark_and_keeps_it_armed(monkeypatch):
    out = {"status": "ok", "results": [], "coverage": {"evaluated": 0}}
    monkeypatch.delenv(cr.FLAG, raising=False)
    assert "coverage" not in cr.publish(out)
    assert "coverage" in out                       # the cached dict is never mutated
    monkeypatch.setenv(cr.FLAG, "1")
    assert cr.publish(out)["coverage"] == {"evaluated": 0}


# ── period-change ───────────────────────────────────────────────────────────

@pytest.fixture
def period(monkeypatch):
    from api.services import scan_period as sp
    from api.services import bars_sqlite
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA", "BBB", "CCC", "DDD", "EEE", "SPY"})
    monkeypatch.setattr(sp, "_etf_symbols", lambda: {"SPY"})
    monkeypatch.setattr(sp, "_sector_industry_map", lambda: {})
    monkeypatch.setattr(bars_sqlite, "daily_bydate_index_ready", lambda: False)

    class _C:
        def get_full_market_snapshot(self):
            return {"AAA": {"last_price": 11}, "BBB": {"last_price": 9}, "SPY": {"last_price": 1}}
    monkeypatch.setattr(sp.massive, "_get_client", lambda: _C())
    return sp


def test_period_change_counts_every_common_stock_once(period):
    from datetime import date
    start = {"AAA": 10.0, "BBB": 10.0, "CCC": 10.0, "EEE": 10.0, "SPY": 400.0, "ZZZ": 5.0}
    end = {"AAA": 11.0, "BBB": 9.0, "CCC": 12.0, "SPY": 410.0, "ZZZ": 6.0}
    out = period._assemble(start, end, date(2026, 1, 2), date(2026, 3, 2), False, 20260102)
    assert [r["sym"] for r in out["results"]] == ["AAA", "BBB"]
    cov = out["coverage"]
    # universe = AAA BBB CCC DDD EEE (SPY is an ETF, ZZZ is not common stock)
    assert cov["evaluated"] == 5 and cov["answered"] == 2
    assert cov["not_computable"] == 2                  # DDD no start close, EEE no end close
    assert cov["dropped"] == 1                         # CCC not trading now
    why = {d["ticker"]: d["detail"] for d in cov["dropped_symbols"]}
    assert why == {"CCC": "not trading now", "DDD": "no close on the start date",
                   "EEE": "no close on the end date"}


def test_period_change_partial_path_counts_a_recycled_ticker_as_dropped(period, monkeypatch):
    from datetime import date
    monkeypatch.setattr(period, "_reuse_map", lambda: {"BBB": 20260201})
    out = period._assemble({"AAA": 10.0, "BBB": 10.0}, {"AAA": 11.0, "BBB": 30.0},
                           date(2026, 1, 2), date(2026, 3, 2), True, 20260102)
    assert [r["sym"] for r in out["results"]] == ["AAA"]
    bbb = [d for d in out["coverage"]["dropped_symbols"] if d["ticker"] == "BBB"][0]
    assert bbb["reason"] == "dropped" and "reused" in bbb["detail"]


# ── preset scans ────────────────────────────────────────────────────────────

def test_highest_volume_scan_receipt(monkeypatch):
    from api.services import scan_volume as sv
    monkeypatch.setattr(sv.cache, "get", lambda k: None)
    monkeypatch.setattr(sv.cache, "set", lambda *a, **k: None)
    monkeypatch.setattr(sv, "_ensure_reference", lambda sid, d: {"AAA": 100, "BBB": 100, "CCC": 0, "DDD": 50})
    monkeypatch.setattr(sv, "full_market_snapshot", lambda: {
        "AAA": {"today_vol": 500, "last_price": 5, "prev_close": 4},
        "BBB": {"today_vol": 50, "last_price": 5, "prev_close": 4}})
    monkeypatch.setattr(sv, "_avg_dollar_volume", lambda: {})
    monkeypatch.setattr(sv, "_tradable", lambda s, snap, adv: True)
    out = sv._run_scan("1y", 252)
    assert [r["sym"] for r in out["results"]] == ["AAA"]
    c = out["coverage"]
    assert (c["evaluated"], c["answered"], c["not_computable"]) == (4, 2, 2)


def test_top_gainers_receipt_names_the_sanity_ceiling_as_dropped(monkeypatch):
    from api.services import scan_gainers as sg
    monkeypatch.setattr(sg.cache, "get", lambda k: None)
    monkeypatch.setattr(sg.cache, "set", lambda *a, **k: None)
    monkeypatch.setattr(sg, "_ensure_reference", lambda pid, n: {"AAA": 10.0, "BBB": 10.0, "CCC": 1.0})
    monkeypatch.setattr(sg, "full_market_snapshot", lambda: {
        "AAA": {"last_price": 12.0}, "CCC": {"last_price": 100000.0}})
    out = sg._run_gainers("30d", 30)
    c = out["coverage"]
    assert (c["evaluated"], c["answered"], c["dropped"], c["not_computable"]) == (3, 1, 1, 1)


def test_ipo_scan_receipt(monkeypatch):
    from api.services import scan_ipo as si
    monkeypatch.setattr(si.cache, "get", lambda k: None)
    monkeypatch.setattr(si.cache, "set", lambda *a, **k: None)
    monkeypatch.setattr(si, "_ensure_ipo_set", lambda: {"NEW1": 20260301, "NEW2": 20260302, "ETF1": 20260303})
    monkeypatch.setattr(si, "full_market_snapshot", lambda: {"NEW1": {"last_price": 5, "prev_close": 4}})
    monkeypatch.setattr(si, "_etf_symbols", lambda: {"ETF1"})
    monkeypatch.setattr(si, "_avg_dollar_volume", lambda: {})
    monkeypatch.setattr(si, "_tradable", lambda s, snap, adv: True)
    out = si.get_ipo_last_1y()
    assert [r["sym"] for r in out["results"]] == ["NEW1"]
    c = out["coverage"]
    assert (c["evaluated"], c["answered"], c["dropped"]) == (2, 1, 1)


def test_live_volume_scan_counts_a_members_unknown_ticker(monkeypatch):
    from api.services import volume_live as vl
    with vl._lock:
        saved = dict(vl._state)
    try:
        with vl._lock:
            vl._state["syms"] = {"AAA": {"m": None}}
        out = vl.get_live(syms=["AAA", "ZZZZ"])
        c = out["coverage"]
        assert (c["evaluated"], c["not_computable"]) == (2, 2)
        assert {d["ticker"] for d in c["dropped_symbols"]} == {"AAA", "ZZZZ"}
    finally:
        with vl._lock:
            vl._state.clear()
            vl._state.update(saved)


# ── /api/screener/scan ──────────────────────────────────────────────────────

ROWS = [
    {"ticker": "AAA", "price": 100.0, "gross_margin": 60.0, "snapshot_date": "2026-10-01"},
    {"ticker": "BBB", "price": 50.0, "gross_margin": 20.0, "snapshot_date": "2026-10-01"},
    {"ticker": "CCC", "price": 10.0, "gross_margin": None, "snapshot_date": "2026-10-01"},
    {"ticker": "DDD", "price": None, "gross_margin": None, "snapshot_date": "2026-10-01"},
]


@pytest.fixture
def snap(tmp_path, monkeypatch):
    from api.services.screener import snapshot_db as db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    db.upsert_rows([dict(r) for r in ROWS])


def test_screen_coverage_names_the_rows_a_criterion_could_not_read(snap):
    from api.services.screener import query as Q
    spec = {"filters": [{"key": "gross_margin", "op": "gte", "min": 30}], "page_size": 50}
    assert [r["ticker"] for r in Q.run_scan(spec)["rows"]] == ["AAA"]
    c = Q.coverage_for(spec)
    assert (c["evaluated"], c["answered"], c["not_computable"], c["dropped"]) == (4, 2, 2, 0)
    assert {d["ticker"] for d in c["dropped_symbols"]} == {"CCC", "DDD"}
    assert c["dropped_symbols"][0]["detail"] == "no value for Gross Margin"


def test_screen_coverage_with_no_criteria_answers_everything(snap):
    from api.services.screener import query as Q
    c = Q.coverage_for({"filters": []})
    assert (c["evaluated"], c["answered"], c["not_computable"]) == (4, 4, 0)


def test_the_screener_route_attaches_the_receipt_only_when_armed(snap, monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.routers import screener as R
    app.dependency_overrides[R.require_paid] = lambda: {"id": "u1"}
    try:
        c = TestClient(app)
        body = {"filters": [{"key": "gross_margin", "op": "gte", "min": 30}]}
        monkeypatch.delenv(cr.FLAG, raising=False)
        assert "coverage" not in c.post("/api/screener/scan", json=body).json()
        monkeypatch.setenv(cr.FLAG, "1")
        assert c.post("/api/screener/scan", json=body).json()["coverage"]["not_computable"] == 2
    finally:
        app.dependency_overrides.clear()
