"""Notebook widgets: the server payload builder (shared shell + the two market kinds).

Every consumed function is monkeypatched: no network, no live data, no C:\data.
"""
from __future__ import annotations

import json
import time
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
        nw.build("myRulesCheck", "u1", {}, now=NOW)


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


def test_slow_implied_move_is_bounded_by_total_budget(monkeypatch):
    monkeypatch.setattr(nw, "IMPLIED_MOVE_BUDGET_S", 0.3)
    items = [{"symbol": s, "date": "2026-10-21", "daysAway": 1, "timing": "bmo",
              "sources": ["watchlist"]} for s in ("AAA", "SLOW", "CCC")]
    _patch_reporting(monkeypatch, items)
    import api.services.earnings_enrichment as ee

    def fake(sym, earnings_date=None, timing=None):
        if sym == "SLOW":
            time.sleep(2.0)
        return {"pct": 5.0}

    monkeypatch.setattr(ee, "get_implied_move", fake)
    t0 = time.monotonic()
    out = nw.build("myNamesReporting", "u1", {}, now=NOW)
    assert time.monotonic() - t0 < 0.3 + 1.0
    r = {x["symbol"]: x for x in out["rows"]}
    assert r["SLOW"]["impliedMovePct"] is None
    assert r["AAA"]["impliedMovePct"] == 5.0 and r["CCC"]["impliedMovePct"] == 5.0
    assert out["partial"] is True


def test_reporting_soon_gets_today_in_et_from_now(monkeypatch):
    import api.services.journal_two.earnings_prep as ep
    seen = []

    def fake(user_id, today=None):
        seen.append(today)
        return {"items": [], "partial": False}

    monkeypatch.setattr(ep, "reporting_soon", fake)
    _patch_sets(monkeypatch, watchlist=["AAPL"])
    _patch_prices(monkeypatch, {})
    late_utc = datetime(2026, 10, 21, 2, 30, tzinfo=timezone.utc)  # still Oct 20 in ET
    nw.build("myNamesReporting", "u1", {}, now=late_utc)
    nw.build("myWatchlistToday", "u1", {}, now=late_utc)
    from datetime import date
    assert seen == [date(2026, 10, 20), date(2026, 10, 20)]


def test_cap_payload_adds_builder_truncated_to_trimmed_rows():
    rows = [{"symbol": f"S{i}", "blob": "x" * 1000} for i in range(30)]
    out = nw.cap_payload({"asOf": "x", "source": "market", "rows": rows, "truncated": 7})
    assert out["truncated"] == 7 + (30 - len(out["rows"]))
    assert len(json.dumps(out, separators=(",", ":"))) <= nw.PAYLOAD_CAP_BYTES


def test_non_dict_params_raises():
    with pytest.raises(nw.WidgetRequestError):
        nw.build("myNamesReporting", "u1", ["x"], now=NOW)


# -- Task 3: account kinds + ticker card ---------------------------------------------

def _analytics(trade_count=3, days=None, win_rate=0.5, expectancy=0.4, curve=None):
    days = days if days is not None else [{"date": "2026-10-19", "pnl": 100.0},
                                           {"date": "2026-10-20", "pnl": -40.5}]
    return {
        "tradeCount": trade_count,
        "equity": {"curve": curve if curve is not None else []},
        "performance": {"byDay": days},
        "edgeScore": {"components": {"winRate": win_rate}},
        "risk": {"expectancyR": expectancy},
    }


def _patch_pnl(monkeypatch, analytics, trades):
    import api.services.journal_two.analytics as an
    import api.services.journal_two.trades as tr
    seen = {}

    def fake_an(user_id, **kw):
        seen["analytics"] = kw
        return analytics

    def fake_tr(user_id, **kw):
        seen["trades"] = kw
        return list(trades), len(trades)

    monkeypatch.setattr(an, "get_analytics", fake_an)
    monkeypatch.setattr(tr, "list_trades_for_user", fake_tr)
    return seen


def test_pnl_empty_range_says_so(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(trade_count=0, days=[]), [])
    out = nw.build("myPnlStats", "u1", {}, now=NOW)
    assert out["empty"] == "No closed trades in this range yet."
    assert out["netPnl"] is None and out["winRate"] is None and out["avgR"] is None
    assert out["tradeCount"] == 0 and out["equity"] == []


def test_pnl_default_range_is_monday_of_et_week_to_today(monkeypatch):
    seen = _patch_pnl(monkeypatch, _analytics(), [{"source": "manual"}])
    out = nw.build("myPnlStats", "u1", {}, now=NOW)  # Tue 2026-10-20
    assert out["range"] == {"from": "2026-10-19", "to": "2026-10-20"}
    spec = seen["analytics"]["spec"]
    assert (spec.date_from, spec.date_to) == ("2026-10-19", "2026-10-20")
    tspec = seen["trades"]["spec"]
    assert (tspec.date_from, tspec.date_to) == ("2026-10-19", "2026-10-20")


def test_pnl_params_range_and_bad_day(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(), [{"source": "manual"}])
    out = nw.build("myPnlStats", "u1", {"from": "2026-10-01", "to": "2026-10-10"}, now=NOW)
    assert out["range"] == {"from": "2026-10-01", "to": "2026-10-10"}
    with pytest.raises(nw.WidgetRequestError):
        nw.build("myPnlStats", "u1", {"from": "yesterday"}, now=NOW)


def test_pnl_figures_come_from_the_analytics_sections(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(win_rate=0.6667, expectancy=0.412), [{"source": "manual"}] * 3)
    out = nw.build("myPnlStats", "u1", {}, now=NOW)
    assert out["netPnl"] == 59.5
    assert out["winRate"] == 0.6667 and out["avgR"] == 0.412 and out["tradeCount"] == 3


def test_pnl_unknown_figure_is_null_not_zero(monkeypatch):
    a = _analytics()
    a["risk"] = {"expectancyR": None}
    a["edgeScore"] = {"components": None}
    _patch_pnl(monkeypatch, a, [{"source": "manual"}])
    out = nw.build("myPnlStats", "u1", {}, now=NOW)
    assert out["winRate"] is None and out["avgR"] is None and out["netPnl"] == 59.5


def test_pnl_equity_downsampled_to_60(monkeypatch):
    curve = [{"date": f"d{i:03d}", "equity": 1000.0 + i, "drawdown": 0.0} for i in range(250)]
    _patch_pnl(monkeypatch, _analytics(curve=curve), [{"source": "manual"}])
    out = nw.build("myPnlStats", "u1", {}, now=NOW)
    assert len(out["equity"]) <= 60
    assert out["equity"][0] == ["d000", 1000.0]
    assert out["equity"][-1] == ["d249", 1249.0]


def test_pnl_short_equity_is_kept_whole(monkeypatch):
    curve = [{"date": "a", "equity": 1.0}, {"date": "b", "equity": 2.0}]
    _patch_pnl(monkeypatch, _analytics(curve=curve), [{"source": "manual"}])
    out = nw.build("myPnlStats", "u1", {}, now=NOW)
    assert out["equity"] == [["a", 1.0], ["b", 2.0]]


def test_pnl_source_mixed_when_broker_and_manual(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(), [{"source": "broker"}, {"source": None}])
    assert nw.build("myPnlStats", "u1", {}, now=NOW)["source"] == "mixed"


def test_pnl_source_broker_and_manual(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(), [{"source": "broker"}, {"source": "broker"}])
    assert nw.build("myPnlStats", "u1", {}, now=NOW)["source"] == "broker"
    _patch_pnl(monkeypatch, _analytics(), [{"source": None}, {"source": "csv"}])
    assert nw.build("myPnlStats", "u1", {}, now=NOW)["source"] == "manual"


def _pos(sym="NVDA", side="Long", shares=10, entry=100.0, stop=95.0, pid="p1", source=None):
    return {"id": pid, "symbol": sym, "side": side, "shares": shares,
            "entryPrice": entry, "stopPrice": stop, "source": source}


def _heat_row(sym="NVDA", side="Long", entry=100.0, stop=95.0, shares=10):
    placeholder = stop == entry
    return {"symbol": sym, "side": side,
            "dist_to_stop_pct": round(abs(entry - stop) / entry * 100, 2),
            "risk_pct": None if placeholder else 0.2,
            "stop_price": None if placeholder else stop,
            "risk_dollars": None if placeholder else round(shares * abs(entry - stop), 2),
            "placeholder_stop": placeholder}


def _patch_positions(monkeypatch, positions, heat_rows, account=50000.0, default=False):
    import api.services.journal_two.positions as ps
    import api.services.portfolio_heat as ph
    monkeypatch.setattr(ps, "list_open_positions", lambda user_id, *a, **k: positions)
    monkeypatch.setattr(ph, "portfolio_heat", lambda user_id, *a, **k: {
        "ok": True, "per_position": heat_rows, "account_size_is_default": default})
    monkeypatch.setattr(nw, "_account_size", lambda user_id: account)


def test_positions_none_open_says_so(monkeypatch):
    _patch_positions(monkeypatch, [], [])
    _patch_prices(monkeypatch, {})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert out["empty"] == "No open positions." and out["rows"] == []


def test_positions_placeholder_stop_is_no_stop(monkeypatch):
    _patch_positions(monkeypatch, [_pos(entry=100.0, stop=100.0)],
                     [_heat_row(entry=100.0, stop=100.0)])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    row = nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"][0]
    assert row["noStop"] is True
    assert row["distToStopPct"] is None and row["stopPrice"] is None


def test_positions_real_stop_row(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    row = out["rows"][0]
    assert row["positionId"] == "p1" and row["noStop"] is False
    assert row["stopPrice"] == 95.0 and row["distToStopPct"] == 5.0
    assert row["openPnl"] == 100.0 and row["sizePct"] == 2.2
    assert out["accountSize"] == 50000.0


def test_positions_size_pct_null_without_account_size(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()], account=None, default=True)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert out["accountSize"] is None and out["rows"][0]["sizePct"] is None


def test_positions_default_account_size_is_not_shown_as_real(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()], account=25000.0, default=True)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert out["accountSize"] is None and out["rows"][0]["sizePct"] is None


def test_positions_price_missing_is_null(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()])
    _patch_prices(monkeypatch, {})
    row = nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"][0]
    assert row["openPnl"] is None and row["sizePct"] is None


def test_positions_open_pnl_short_sign(monkeypatch):
    _patch_positions(monkeypatch, [_pos(side="Short", entry=100.0, stop=105.0)],
                     [_heat_row(side="Short", entry=100.0, stop=105.0)])
    _patch_prices(monkeypatch, {"NVDA": {"price": 90.0}})
    row = nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"][0]
    assert row["openPnl"] == 100.0
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    row = nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"][0]
    assert row["openPnl"] == -100.0


def test_positions_join_is_symbol_plus_side(monkeypatch):
    positions = [_pos(sym="AMD", side="Long", stop=95.0, pid="a"),
                 _pos(sym="AMD", side="Short", entry=100.0, stop=100.0, pid="b")]
    heat = [_heat_row(sym="AMD", side="Long"),
            _heat_row(sym="AMD", side="Short", entry=100.0, stop=100.0)]
    _patch_positions(monkeypatch, positions, heat)
    _patch_prices(monkeypatch, {"AMD": {"price": 100.0}})
    rows = {r["positionId"]: r for r in nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"]}
    assert rows["a"]["noStop"] is False and rows["a"]["stopPrice"] == 95.0
    assert rows["b"]["noStop"] is True and rows["b"]["stopPrice"] is None


def test_positions_unjoined_row_is_unknown_never_a_fake_distance(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    row = nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"][0]
    assert row["noStop"] is None and row["distToStopPct"] is None and row["stopPrice"] is None


def test_positions_source(monkeypatch):
    _patch_positions(monkeypatch, [_pos(source="broker", pid="a"), _pos(sym="AMD", pid="b")],
                     [_heat_row(), _heat_row(sym="AMD")])
    _patch_prices(monkeypatch, {})
    assert nw.build("myPositionsRisk", "u1", {}, now=NOW)["source"] == "mixed"


def test_ticker_card_bad_symbol_raises():
    for bad in ("nvda!", "", None, "1ABC", "TOOLONGSYMBOLX"):
        with pytest.raises(nw.WidgetRequestError):
            nw.build("tickerCard", "u1", {"symbol": bad}, now=NOW)
    with pytest.raises(nw.WidgetRequestError):
        nw.build("tickerCard", "u1", {}, now=NOW)


def _patch_card(monkeypatch, closes=(), window=None, move=None, trades=None, analytics=None):
    import api.services.bars_sqlite as bs
    import api.services.journal_two.earnings_prep as ep
    import api.services.earnings_enrichment as ee
    bars_seen = []

    def fake_bars(ticker, tf, max_bars):
        bars_seen.append((ticker, tf, max_bars))
        return [(20260000 + i, 1, 1, 1, c, 1) for i, c in enumerate(closes)]

    monkeypatch.setattr(bs, "get_bars", fake_bars)
    monkeypatch.setattr(ep, "_window", lambda today: (window or {}, {"NVDA": "amc"}, False, "x"))
    monkeypatch.setattr(ee, "get_implied_move",
                        lambda sym, d=None, t=None: {"pct": move} if move is not None else None)
    _patch_pnl(monkeypatch, analytics or _analytics(), trades or [])
    return bars_seen


def test_ticker_card_history_none_without_trades(monkeypatch):
    _patch_card(monkeypatch, analytics=_analytics(trade_count=0, days=[]))
    _patch_prices(monkeypatch, {"NVDA": {"price": 120.0, "change_pct": 1.2}})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["history"] is None
    assert out["source"] == "mixed" and out["symbol"] == "NVDA"
    assert out["price"] == 120.0 and out["changePct"] == 1.2


def test_ticker_card_history_from_the_members_trades(monkeypatch):
    _patch_card(monkeypatch, analytics=_analytics(trade_count=4, win_rate=0.75))
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["history"] == {"trades": 4, "winRate": 0.75, "netPnl": 59.5}


def test_ticker_card_moving_averages(monkeypatch):
    closes = list(range(1, 61))  # 60 bars, 1..60
    seen = _patch_card(monkeypatch, closes=closes)
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["ma10"] == sum(range(51, 61)) / 10
    assert out["ma50"] == sum(range(11, 61)) / 50
    assert seen == [("NVDA", "D", 50)]


def test_ticker_card_short_history_has_no_ma50(monkeypatch):
    _patch_card(monkeypatch, closes=[10.0] * 20)
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["ma10"] == 10.0 and out["ma50"] is None
    _patch_card(monkeypatch, closes=[10.0] * 5)
    assert nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)["ma10"] is None


def test_ticker_card_bars_error_is_null(monkeypatch):
    import api.services.bars_sqlite as bs
    _patch_card(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("no db")

    monkeypatch.setattr(bs, "get_bars", boom)
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["ma10"] is None and out["ma50"] is None


def test_ticker_card_earnings_day_and_implied_move(monkeypatch):
    _patch_card(monkeypatch, window={"NVDA": "2026-10-21"}, move=6.4)
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["earningsDay"] == "2026-10-21" and out["impliedMovePct"] == 6.4
    _patch_card(monkeypatch, window={})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["earningsDay"] is None and out["impliedMovePct"] is None


def test_ticker_card_price_missing_is_null(monkeypatch):
    _patch_card(monkeypatch)
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "BRK.B"}, now=NOW)
    assert out["price"] is None and out["changePct"] is None


@pytest.fixture(autouse=True)
def _fresh_history_cache():
    nw._HISTORY_CACHE.clear()
    yield
    nw._HISTORY_CACHE.clear()


def test_ticker_card_history_read_is_symbol_scoped_and_cached(monkeypatch):
    _patch_card(monkeypatch, analytics=_analytics(trade_count=2))
    _patch_prices(monkeypatch, {})
    import api.services.journal_two.analytics as an
    calls = []
    real = an.get_analytics

    def counting(user_id, **kw):
        calls.append(kw)
        return real(user_id, **kw)

    monkeypatch.setattr(an, "get_analytics", counting)
    first = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    second = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert len(calls) == 1
    assert calls[0]["spec"].symbol == "NVDA"
    assert calls[0]["spec"].symbol_exact is True
    assert first["history"] == second["history"] == {"trades": 2, "winRate": 0.5, "netPnl": 59.5}
    nw.build("tickerCard", "u1", {"symbol": "AMD"}, now=NOW)
    nw.build("tickerCard", "u2", {"symbol": "NVDA"}, now=NOW)
    assert [c["spec"].symbol for c in calls] == ["NVDA", "AMD", "NVDA"]


def test_positions_two_lots_same_symbol_and_side_keep_their_own_stops(monkeypatch):
    positions = [_pos(pid="a", stop=95.0), _pos(pid="b", entry=110.0, stop=104.5)]
    heat = [_heat_row(stop=95.0), _heat_row(entry=110.0, stop=104.5)]
    _patch_positions(monkeypatch, positions, heat)
    _patch_prices(monkeypatch, {"NVDA": {"price": 120.0}})
    rows = {r["positionId"]: r for r in nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"]}
    assert rows["a"]["stopPrice"] == 95.0 and rows["a"]["distToStopPct"] == 5.0
    assert rows["b"]["stopPrice"] == 104.5 and rows["b"]["distToStopPct"] == 5.0


def _temp_auth_db(monkeypatch, tmp_path):
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_t3.db"))
    auth_db.init_db()
    return auth_db


def _count(auth_db, table):
    c = auth_db.get_connection()
    try:
        return c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        c.close()


def test_account_size_read_never_writes_for_a_member_without_an_account(monkeypatch, tmp_path):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    before = (_count(auth_db, "j2_accounts"), _count(auth_db, "j2_positions"))
    assert nw._account_size("nobody") is None
    assert (_count(auth_db, "j2_accounts"), _count(auth_db, "j2_positions")) == before


def test_account_size_reads_the_members_default_account(monkeypatch, tmp_path):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    # Control: the migrating helper really does insert a row, so the no-write test above can fail.
    accounts.get_or_migrate_default_account("u9")
    assert _count(auth_db, "j2_accounts") == 1
    c = auth_db.get_connection()
    try:
        c.execute("UPDATE j2_accounts SET account_size = 73000 WHERE user_id = 'u9'")
        c.commit()
    finally:
        c.close()
    assert nw._account_size("u9") == 73000.0
    assert _count(auth_db, "j2_accounts") == 1
