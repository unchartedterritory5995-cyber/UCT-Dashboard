"""Notebook widgets: the server payload builder (shared shell + the two market kinds).

Every consumed function is monkeypatched: no network, no live data, no C:\data.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw

NOW = datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc)


def _patch_sets(monkeypatch, watchlist=(), flagged=()):
    import api.services.calendar_personalization as cp
    monkeypatch.setattr(
        cp, "get_user_ticker_sets",
        lambda user_id: {"watchlist": set(watchlist), "flagged": set(flagged)},
    )


def _patch_prices(monkeypatch, rows):
    import api.routers.live_prices as lp
    calls = []

    def fake(tickers=""):
        calls.append(tickers)
        return rows

    monkeypatch.setattr(lp, "get_live_prices", fake)
    return calls


def _patch_reporting(monkeypatch, items, partial=False):
    import api.services.journal_two.earnings_prep as ep
    monkeypatch.setattr(
        ep, "reporting_soon",
        lambda user_id, today=None: {"items": items, "partial": partial},
    )


def test_unknown_kind_raises():
    with pytest.raises(nw.WidgetRequestError):
        nw.build("noSuchKind", "u1", {}, now=NOW)


def test_kind_without_a_builder_yet_raises():
    with pytest.raises(nw.WidgetRequestError):
        nw.build("tickerCard", "u1", {}, now=NOW)


def test_kind_tables_are_complete():
    assert len(nw.KIND_WAVE) == 15
    assert nw.KIND_WAVE["myRulesCheck"] == 2 and nw.KIND_WAVE["tradeRecap"] == 6
    assert nw.ACCOUNT_KINDS == frozenset({
        "myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes",
        "tradeRecap", "myPnlCalendar", "mySetupEdge"})
    assert nw.ACCOUNT_KINDS <= set(nw.KIND_WAVE)
    assert nw.PAYLOAD_CAP_BYTES == 16384 and nw.ROW_CAP == 40


def test_wave_flag_is_read_per_call(monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W2_ENABLED", raising=False)
    assert nw.notebook_widgets_wave_on(2) is False
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W2_ENABLED", "1")
    assert nw.notebook_widgets_wave_on(2) is True
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W2_ENABLED", "0")
    assert nw.notebook_widgets_wave_on(2) is False


def test_watchlist_rows_sorted_and_capped(monkeypatch):
    syms = [f"S{n:02d}" for n in range(45)]
    _patch_sets(monkeypatch, watchlist=reversed(syms))
    calls = _patch_prices(monkeypatch, {s: {"price": 10.0, "change_pct": 1.5} for s in syms})
    _patch_reporting(monkeypatch, [])
    out = nw.build("myWatchlistToday", "u1", {}, now=NOW)
    assert len(out["rows"]) == 40
    assert out["truncated"] == 5
    assert [r["symbol"] for r in out["rows"]] == sorted(syms)[:40]
    assert len(calls) == 1  # one batched call
    assert out["listLabel"] == "Watchlist"


def test_watchlist_price_missing_is_null_not_zero(monkeypatch):
    _patch_sets(monkeypatch, watchlist=["AMD", "NVDA"])
    _patch_prices(monkeypatch, {"NVDA": {"price": 120.5, "change_pct": -0.4}})
    _patch_reporting(monkeypatch, [])
    out = nw.build("myWatchlistToday", "u1", {}, now=NOW)
    rows = {r["symbol"]: r for r in out["rows"]}
    assert rows["AMD"]["price"] is None and rows["AMD"]["changePct"] is None
    assert rows["NVDA"]["price"] == 120.5 and rows["NVDA"]["changePct"] == -0.4
    assert rows["NVDA"]["earningsDay"] is None


def test_watchlist_defaults_to_flagged_when_watchlist_empty(monkeypatch):
    _patch_sets(monkeypatch, watchlist=[], flagged=["TSLA"])
    _patch_prices(monkeypatch, {"TSLA": {"price": 200.0, "change_pct": 2.0}})
    _patch_reporting(monkeypatch, [])
    out = nw.build("myWatchlistToday", "u1", {}, now=NOW)
    assert out["listLabel"] == "Flagged"
    assert [r["symbol"] for r in out["rows"]] == ["TSLA"]


def test_watchlist_param_list_picks_flagged_and_earnings_day(monkeypatch):
    _patch_sets(monkeypatch, watchlist=["AAPL"], flagged=["TSLA"])
    _patch_prices(monkeypatch, {"TSLA": {"price": 200.0, "change_pct": 2.0}})
    _patch_reporting(monkeypatch, [{"symbol": "TSLA", "date": "2026-10-21", "daysAway": 1,
                                    "timing": "amc", "sources": ["flagged"]}])
    out = nw.build("myWatchlistToday", "u1", {"list": "flagged"}, now=NOW)
    assert out["listLabel"] == "Flagged"
    assert out["rows"][0]["earningsDay"] == "2026-10-21"


def test_watchlist_bad_list_param_raises(monkeypatch):
    _patch_sets(monkeypatch, watchlist=["AAPL"])
    with pytest.raises(nw.WidgetRequestError):
        nw.build("myWatchlistToday", "u1", {"list": "bogus"}, now=NOW)


def test_reporting_rows_carry_implied_move_or_null(monkeypatch):
    items = [
        {"symbol": "NVDA", "date": "2026-10-21", "daysAway": 1, "timing": "amc",
         "sources": ["watchlist"], "prepNote": None},
        {"symbol": "AMD", "date": "2026-10-22", "daysAway": 2, "timing": None,
         "sources": ["positions", "flagged"], "prepNote": None},
    ]
    _patch_reporting(monkeypatch, items, partial=True)
    import api.services.earnings_enrichment as ee

    def fake_move(sym, earnings_date=None, timing=None):
        return {"pct": 6.4} if sym == "NVDA" else None

    monkeypatch.setattr(ee, "get_implied_move", fake_move)
    out = nw.build("myNamesReporting", "u1", {}, now=NOW)
    assert out["partial"] is True
    r = {x["symbol"]: x for x in out["rows"]}
    assert r["NVDA"]["impliedMovePct"] == 6.4 and r["NVDA"]["day"] == "2026-10-21"
    assert r["NVDA"]["timing"] == "amc" and r["NVDA"]["daysAway"] == 1
    assert r["AMD"]["impliedMovePct"] is None
    assert r["AMD"]["sources"] == ["positions", "flagged"]


def test_reporting_implied_move_error_is_null(monkeypatch):
    _patch_reporting(monkeypatch, [{"symbol": "NVDA", "date": "2026-10-21", "daysAway": 1,
                                    "timing": "bmo", "sources": ["watchlist"]}])
    import api.services.earnings_enrichment as ee

    def boom(*a, **k):
        raise RuntimeError("vendor down")

    monkeypatch.setattr(ee, "get_implied_move", boom)
    out = nw.build("myNamesReporting", "u1", {}, now=NOW)
    assert out["rows"][0]["impliedMovePct"] is None


def test_cap_payload_under_16384_bytes():
    rows = [{"symbol": f"S{i}", "blob": "x" * 1000} for i in range(30)]
    p = {"asOf": "2026-10-20T15:00:00Z", "source": "market", "rows": rows}
    out = nw.cap_payload(p)
    assert len(json.dumps(out, separators=(",", ":"))) <= nw.PAYLOAD_CAP_BYTES
    assert out["truncated"] > 0
    assert len(out["rows"]) + out["truncated"] == 30


def test_cap_payload_leaves_small_payload_untouched():
    p = {"asOf": "x", "source": "market", "rows": [{"a": 1}]}
    assert nw.cap_payload(dict(p)) == p


def test_every_payload_has_asOf_and_source(monkeypatch):
    _patch_sets(monkeypatch, watchlist=["AAPL"])
    _patch_prices(monkeypatch, {})
    _patch_reporting(monkeypatch, [])
    for kind in ("myWatchlistToday", "myNamesReporting"):
        out = nw.build(kind, "u1", {}, now=NOW)
        assert out["asOf"] == "2026-10-20T15:00:00Z"
        assert out["source"] == "market"
