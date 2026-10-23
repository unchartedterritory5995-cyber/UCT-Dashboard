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


@pytest.fixture(autouse=True)
def _fresh_widget_pool(monkeypatch):
    """Final review I-4: the builders share ONE module-level bounded pool, and a test's deliberate straggler
    (a fake vendor that sleeps past the budget) keeps its permit until it ends. A fresh pool per test keeps
    one test's stragglers from saturating the next test's reads."""
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-test"))
    # Fix F1 (C-1): the calendar walks' single-flight table and the window cache are module state too.
    monkeypatch.setattr(nw, "_WALKS", nw.SingleFlight(nw.WALK_WAITERS))
    from api.services.cache import cache
    cache.delete_prefix("notebook_earnings_prep_window::")
    yield
    cache.delete_prefix("notebook_earnings_prep_window::")


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
        lambda user_id, today=None, window_read=None: {"items": items, "partial": partial},
    )
    # The builders read the window first, under their own budget (fix F1, C-1): never the real walk.
    monkeypatch.setattr(ep, "_window", lambda today: ({}, {}, partial, "x"))


def test_unknown_kind_raises():
    with pytest.raises(nw.WidgetRequestError):
        nw.build("noSuchKind", "u1", {}, now=NOW)


def test_kind_without_a_builder_yet_raises(monkeypatch):
    builders = dict(nw._BUILDERS)
    builders.pop("tradeRecap")
    monkeypatch.setattr(nw, "_BUILDERS", builders)
    with pytest.raises(nw.WidgetRequestError, match="not available yet"):
        nw.build("tradeRecap", "u1", {"tradeId": "t1"}, now=NOW)


def test_every_kind_has_a_builder():
    assert set(nw._BUILDERS) == set(nw.KIND_WAVE)


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

    def fake(user_id, today=None, window_read=None):
        seen.append(today)
        return {"items": [], "partial": False}

    monkeypatch.setattr(ep, "reporting_soon", fake)
    monkeypatch.setattr(ep, "_window", lambda today: ({}, {}, False, "x"))
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


def _patch_positions(monkeypatch, positions, heat_rows, account=50000.0, default=False, strategies=()):
    import api.services.journal_two.positions as ps
    import api.services.journal_two.options as op
    import api.services.portfolio_heat as ph
    monkeypatch.setattr(ps, "list_open_positions", lambda user_id, *a, **k: positions)
    monkeypatch.setattr(op, "list_strategies",
                        lambda user_id, status=None, **k: list(strategies) if status == "open" else [])
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
    assert out["accountSize"] == 50000.0 and out["accountSizeSource"] == "member"


def test_positions_no_account_row_is_labelled_default_and_still_sized(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()], account=None, default=True)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert out["accountSize"] == 100000.0 and out["accountSizeSource"] == "default"
    assert out["rows"][0]["sizePct"] == 1.1                    # 10 x $110 on the 100,000 heat used


def test_positions_heat_default_flag_is_labelled_default(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()], account=100000.0, default=True)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert out["accountSize"] == 100000.0 and out["accountSizeSource"] == "default"


def test_positions_default_label_survives_the_migrated_row_on_the_second_call(monkeypatch, tmp_path):
    # Real DB, real migration. portfolio_heat's first call inserts the Default row; a second build must
    # still read "default" (a bare "a row exists" signal would call it the member's own).
    _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    _patch_prices(monkeypatch, {})
    first = nw.build("myPositionsRisk", "u-new", {}, now=NOW)
    accounts.get_or_migrate_default_account("u-new")  # the row heat's migration leaves behind
    # control: a row exists now, holding the placeholder; the widget reads it as the member's
    # own size only through the one predicate, so it is None (Round B: _account_size returns
    # the member-set size, not the raw column)
    assert accounts.get_account_settings("u-new")["accountSize"] == 100000.0
    assert nw._account_size("u-new") is None
    second = nw.build("myPositionsRisk", "u-new", {}, now=NOW)
    assert first["accountSizeSource"] == second["accountSizeSource"] == "default"
    assert second["accountSize"] == 100000.0               # the figure heat was computed on (the default)
    # and a size the member really set is theirs
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_accounts SET account_size = 73000 WHERE user_id = 'u-new'")
        conn.commit()
    finally:
        conn.close()
    third = nw.build("myPositionsRisk", "u-new", {}, now=NOW)
    assert third["accountSize"] == 73000.0 and third["accountSizeSource"] == "member"


def test_positions_widget_read_on_a_fresh_member_writes_nothing(monkeypatch, tmp_path):
    """The widget GET is a read. `portfolio_heat`'s own account-size fallback is
    `get_or_migrate_default_account`, which INSERTS a Default account and reassigns the member's
    rows on first call; the widget passes its read-only size so that branch never runs."""
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    _patch_prices(monkeypatch, {})
    tables = ("j2_accounts", "j2_positions", "j2_trades")
    before = tuple(_count(auth_db, t) for t in tables)
    out = nw.build("myPositionsRisk", "u-fresh", {}, now=NOW)
    assert tuple(_count(auth_db, t) for t in tables) == before
    assert out["accountSizeSource"] == "default"
    # Control: /portfolio-heat's own call (no size) still runs the one-shot migration, so the
    # count above is able to move.
    from api.services import portfolio_heat
    portfolio_heat.portfolio_heat("u-fresh", regime_fn=lambda: {})
    assert _count(auth_db, "j2_accounts") == before[0] + 1


def test_a_members_set_size_reaches_heat_sizing_and_the_widget(monkeypatch, tmp_path):
    """I-3: heat's default size reader is voice_position_sizing._get_account_settings, which read
    `acc["settings"]`, a key `accounts._row_to_account` never returns, so every member was sized at
    the 25,000 fallback. The member's own size (and risk %) must arrive in all three views."""
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    from api.services import portfolio_heat, voice_position_sizing as vps
    accounts.get_or_migrate_default_account("u7")               # setup only: this helper writes
    _sql(auth_db, "UPDATE j2_accounts SET account_size = 73000, max_risk_per_trade_pct = 2.0"
                  " WHERE user_id = 'u7'")
    s = vps._get_account_settings("u7", None)
    assert s["account_size"] == 73000.0 and s["max_risk_pct"] == 2.0
    assert s["account_size_is_default"] is False
    pos = _pos()                                                # 10 x (100 - 95) = $50 at risk
    heat = portfolio_heat.portfolio_heat("u7", positions_fn=lambda u, a: [pos], regime_fn=lambda: {})
    assert heat["risk_heat_pct"] == round(50 / 73000 * 100, 2)   # 0.07, never 50/100,000 = 0.05 (the default)
    assert heat["account_size_is_default"] is False
    import api.services.journal_two.positions as ps
    import api.services.journal_two.options as op
    monkeypatch.setattr(ps, "list_open_positions", lambda user_id, *a, **k: [pos])
    monkeypatch.setattr(op, "list_strategies", lambda user_id, status=None, **k: [])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u7", {}, now=NOW)
    assert out["accountSize"] == 73000.0 and out["accountSizeSource"] == "member"


def test_a_migrated_default_size_is_unset_in_heat_sizing_and_the_widget(monkeypatch, tmp_path):
    """Fix round 2: the migrated Default row's size (accounts._DEFAULT_ACCOUNT_SIZE) is a placeholder
    the member never chose. Every reader asks ONE predicate (accounts.member_set_account_size) and
    treats it as unset: heat and sizing at the default (UNSET_ACCOUNT_SIZE, 100,000 since Round B fix 1)
    flagged default, the widget labelled default."""
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    from api.services import portfolio_heat, voice_position_sizing as vps
    accounts.get_or_migrate_default_account("u8")               # the migration: 100,000 placeholder
    # control: a row and a size exist (the placeholder), and the widget reads it as unset
    assert accounts.get_account_settings("u8")["accountSize"] == accounts._DEFAULT_ACCOUNT_SIZE
    assert nw._account_size("u8") is None
    s = vps._get_account_settings("u8", None)
    assert s["account_size"] == 100000.0 and s["account_size_is_default"] is True
    pos = _pos()
    heat = portfolio_heat.portfolio_heat("u8", positions_fn=lambda u, a: [pos], regime_fn=lambda: {})
    assert heat["account_size_is_default"] is True
    assert heat["risk_heat_pct"] == round(50 / 100000 * 100, 2)
    import api.services.journal_two.positions as ps
    import api.services.journal_two.options as op
    monkeypatch.setattr(ps, "list_open_positions", lambda user_id, *a, **k: [pos])
    monkeypatch.setattr(op, "list_strategies", lambda user_id, status=None, **k: [])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u8", {}, now=NOW)
    assert out["accountSizeSource"] == "default" and out["accountSize"] == 100000.0
    # and the predicate is the one home: a member-set size passes, the placeholder and nothing do not
    assert accounts.member_set_account_size(73000) == 73000.0
    assert accounts.member_set_account_size(accounts._DEFAULT_ACCOUNT_SIZE) is None
    assert accounts.member_set_account_size(None) is None and accounts.member_set_account_size(0) is None


def test_sizing_falls_back_to_the_old_default_only_without_an_account(monkeypatch):
    from api.services import voice_position_sizing as vps
    from api.services.journal_two import accounts

    def boom(*a, **k):
        raise RuntimeError("no account")
    monkeypatch.setattr(accounts, "get_or_migrate_default_account", boom)
    s = vps._get_account_settings("nobody", None)
    assert s["account_size"] == 100000.0 and s["max_risk_pct"] == vps.DEFAULT_RISK_PCT


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


#: The open-position and note counts the card reads (F4 O2), stood in where a test is about something else.
_NO_FOOTPRINT = {"openPositions": 0, "notes": 0, "notesMore": False}


def _patch_card(monkeypatch, closes=(), window=None, move=None, trades=None, analytics=None, footprint=None):
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(nw, "_symbol_footprint", lambda u, s: dict(footprint or _NO_FOOTPRINT))
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
    assert out["history"] == {"trades": 4, "winRate": 0.75, "netPnl": 59.5, **_NO_FOOTPRINT}


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
    assert first["history"] == second["history"] == {"trades": 2, "winRate": 0.5, "netPnl": 59.5, **_NO_FOOTPRINT}
    nw.build("tickerCard", "u1", {"symbol": "AMD"}, now=NOW)
    nw.build("tickerCard", "u2", {"symbol": "NVDA"}, now=NOW)
    assert [c["spec"].symbol for c in calls] == ["NVDA", "AMD", "NVDA"]


def test_f4_o2_ticker_card_history_carries_open_positions_and_notes(monkeypatch):
    # Fix F4 (O2, walk 2026-10-21): an open NVDA position and a note on NVDA, no closed trade -- the card said
    # "No trades in NVDA yet." The history row now carries all three counts and is not null.
    _patch_card(monkeypatch, analytics=_analytics(trade_count=0, days=[]),
                footprint={"openPositions": 1, "notes": 1, "notesMore": False})
    _patch_prices(monkeypatch, {})
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["history"]["trades"] == 0
    assert (out["history"]["openPositions"], out["history"]["notes"]) == (1, 1)


def test_f4_o2_an_unread_count_keeps_the_row_as_unknown_never_zero(monkeypatch):
    _patch_card(monkeypatch, analytics=_analytics(trade_count=0, days=[]),
                footprint={"openPositions": None, "notes": None, "notesMore": False})
    _patch_prices(monkeypatch, {})
    h = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)["history"]
    assert h is not None and h["openPositions"] is None and h["notes"] is None


def _seed_footprint(auth_db):
    c = auth_db.get_connection()
    try:
        def pos(pid, user, sym, closed=None):
            c.execute(
                "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
                " entry_price, stop_price, context_at_entry, created_at, updated_at, closed_at)"
                " VALUES (?, ?, ?, 'Long', '2026-10-13T00:00:00Z', 10, 10, 120, 110, '{}', 'x', 'x', ?)",
                (pid, user, sym, closed))

        def note(nid, user, ticker=None, deleted=None):
            c.execute("INSERT INTO j2_notes (id, user_id, title, ticker, created_at, updated_at, deleted_at)"
                      " VALUES (?, ?, 't', ?, 'x', 'x', ?)", (nid, user, ticker, deleted))

        pos("p-open", "owner", "NVDA")
        pos("p-closed", "owner", "NVDA", closed="2026-10-15T00:00:00Z")
        pos("p-prefix", "owner", "NVD")                       # a prefix of the symbol is another symbol
        pos("p-other", "intruder", "NVDA")                    # another member's row
        note("n-ticker", "owner", ticker="NVDA")              # the note's own ticker field
        note("n-mention", "owner")                            # a $NVDA cashtag mention
        c.execute("INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at) VALUES"
                  " ('n-mention', 'owner', 'NVDA', 'x')")
        note("n-embed", "owner")                              # a chart embed of NVDA
        c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol) VALUES"
                  " ('n-embed', 'owner', 0, 'chart', 'NVDA')")
        note("n-trash", "owner", ticker="NVDA", deleted="2026-10-16")
        note("n-prefix", "owner", ticker="NVD")
        note("n-other", "intruder", ticker="NVDA")
        c.commit()
    finally:
        c.close()


def test_f4_o2_footprint_real_read_is_own_scoped_exact_symbol_and_open_only(monkeypatch, tmp_path):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    _seed_footprint(auth_db)
    assert nw._symbol_footprint("owner", "NVDA") == {"openPositions": 1, "notes": 3, "notesMore": False}
    assert nw._symbol_footprint("owner", "NVD") == {"openPositions": 1, "notes": 1, "notesMore": False}
    assert nw._symbol_footprint("intruder", "NVDA") == {"openPositions": 1, "notes": 1, "notesMore": False}
    assert nw._symbol_footprint("nobody", "NVDA") == {"openPositions": 0, "notes": 0, "notesMore": False}


def test_f4_o2_footprint_notes_are_capped(monkeypatch, tmp_path):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    c = auth_db.get_connection()
    try:
        for i in range(nw.HISTORY_NOTES_CAP + 5):
            c.execute("INSERT INTO j2_notes (id, user_id, title, ticker, created_at, updated_at)"
                      " VALUES (?, 'owner', 't', 'AMD', 'x', 'x')", (f"n{i}",))
        c.commit()
    finally:
        c.close()
    got = nw._symbol_footprint("owner", "AMD")
    assert got["notes"] == nw.HISTORY_NOTES_CAP and got["notesMore"] is True


def test_f4_o2_ticker_card_end_to_end_with_an_open_position_and_a_note(monkeypatch, tmp_path):
    # The walk's scenario through the real footprint read: no closed trade, one open position, notes.
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    _seed_footprint(auth_db)
    import api.services.journal_two.analytics as an
    monkeypatch.setattr(an, "get_analytics", lambda user_id, **kw: _analytics(trade_count=0, days=[]))
    _patch_prices(monkeypatch, {})
    import api.services.bars_sqlite as bs
    import api.services.journal_two.earnings_prep as ep
    monkeypatch.setattr(bs, "get_bars", lambda *a, **k: [])
    monkeypatch.setattr(ep, "_window", lambda today: ({}, {}, False, "x"))
    h = nw.build("tickerCard", "owner", {"symbol": "NVDA"}, now=NOW)["history"]
    assert (h["trades"], h["openPositions"], h["notes"]) == (0, 1, 3)


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


# -- Task 12: rules check + recurring mistakes (wave 2) -----------------------------

def _trade(i, setup="Flag", source="manual", account="a1", position=None):
    return {"id": f"t{i}", "tradeRef": f"id:t{i}", "positionId": position or f"p{i}",
            "setup": setup, "accountId": account, "source": source, "mistakeTags": []}


def _patch_rules(monkeypatch, trades, adherence, setup_rules=None, journal=None):
    import api.services.journal_two.adherence_store as ad
    import api.services.journal_two.trades as tr
    seen = {}

    def fake_tr(user_id, **kw):
        seen["trades"] = kw
        return list(trades), len(trades)

    monkeypatch.setattr(tr, "list_trades_for_user", fake_tr)
    monkeypatch.setattr(ad, "list_adherence_for_user", lambda user_id, *a, **k: adherence)
    monkeypatch.setattr(nw, "_member_rules", lambda user_id: {
        "setup": setup_rules if setup_rules is not None else {},
        "journal": journal if journal is not None else []})
    return seen


def _adh(ref, checked, total, setup="Flag"):
    return {ref: {"tradeRef": ref, "setup": setup, "checkedRuleIds": checked,
                  "totalRules": total, "adherencePct": 0.0}}


def test_rules_check_counts_over_range(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"},
                                   {"id": "r-stop", "label": "Stop set before entry"}]}}
    journal = [{"id": "j1", "label": "No trades after 2 pm", "status": "active",
                "beforeEntry": True, "accountId": None}]
    adh = {}
    adh.update(_adh("id:t1", ["r-vol", "r-stop", "rule:j1"], 3))
    adh.update(_adh("id:t2", ["r-vol"], 3))
    adh.update(_adh("id:t3", [], 3))
    seen = _patch_rules(monkeypatch, [_trade(1), _trade(2), _trade(3), _trade(4)], adh,
                        setup_rules, journal)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    by = {r["rule"]: r for r in out["rules"]}
    assert by["Volume dried up"] == {"rule": "Volume dried up", "kept": 2, "total": 3}
    assert by["Stop set before entry"] == {"rule": "Stop set before entry", "kept": 1, "total": 3}
    assert by["No trades after 2 pm"] == {"rule": "No trades after 2 pm", "kept": 1, "total": 3}
    assert "empty" not in out and out["source"] == "manual"
    assert out["range"] == {"from": "2026-10-19", "to": "2026-10-20"}     # Monday of the ET week .. today
    assert seen["trades"]["spec"].date_from == "2026-10-19"
    assert "r-vol" not in json.dumps(out) and "rule:j1" not in json.dumps(out)   # never a raw id


def test_rules_check_ignores_trades_outside_the_range_and_unchecked_ones(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"}]}}
    adh = _adh("id:t1", ["r-vol"], 1)
    adh.update(_adh("id:elsewhere", ["r-vol"], 1))      # a trade the range read did not return
    _patch_rules(monkeypatch, [_trade(1), _trade(2)], adh, setup_rules)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["rules"] == [{"rule": "Volume dried up", "kept": 1, "total": 1}]


def test_rules_check_pre_entry_ticks_join_through_the_position(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"}]}}
    adh = _adh("pos:p1", ["r-vol"], 1)               # ticked in Log Trade before any outcome
    _patch_rules(monkeypatch, [_trade(1, position="p1")], adh, setup_rules)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["rules"] == [{"rule": "Volume dried up", "kept": 1, "total": 1}]


def test_rules_check_source_comes_from_the_checked_trades_origin(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"}]}}
    adh = {**_adh("id:t1", ["r-vol"], 1), **_adh("id:t2", [], 1)}
    _patch_rules(monkeypatch, [_trade(1, source="broker"), _trade(2, source="manual")], adh, setup_rules)
    assert nw.build("myRulesCheck", "u1", {}, now=NOW)["source"] == "mixed"


def test_rules_empty_without_rules(monkeypatch):
    _patch_rules(monkeypatch, [_trade(1)], {}, {}, [])
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["empty"] == "No rules set yet."
    assert out["rules"] == []


def test_rules_empty_when_nothing_was_checked_in_range(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"}]}}
    _patch_rules(monkeypatch, [_trade(1)], {}, setup_rules)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["empty"] == "No trades checked against your rules in this range."
    assert out["rules"] == []


def test_rules_check_params_range_and_bad_day(monkeypatch):
    seen = _patch_rules(monkeypatch, [], {}, {})
    nw.build("myRulesCheck", "u1", {"from": "2026-10-01", "to": "2026-10-10"}, now=NOW)
    assert seen["trades"]["spec"].date_to == "2026-10-10"
    with pytest.raises(nw.WidgetRequestError):
        nw.build("myRulesCheck", "u1", {"from": "nope"}, now=NOW)
    with pytest.raises(nw.WidgetRequestError):
        nw.build("myRulesCheck", "u1", {"from": "2026-10-11", "to": "2026-10-10"}, now=NOW)


@pytest.fixture(autouse=True)
def _fresh_mistakes_cache():
    nw._MISTAKES_CACHE.clear()
    yield
    nw._MISTAKES_CACHE.clear()


def _psy(by_mistake):
    return {"psychology": {"costOfMistakes": {"total": sum(m["total"] for m in by_mistake),
                                              "byMistake": by_mistake}}}


def _patch_mistakes(monkeypatch, now_rows, prior_rows, trades=None):
    import api.services.journal_two.analytics as an
    import api.services.journal_two.trades as tr
    calls = []

    def fake_an(user_id, **kw):
        calls.append(kw)
        # the window ending today is this one; the other is the 30 days before it
        return _psy(now_rows if kw["date_to"] == "2026-10-20" else prior_rows)

    monkeypatch.setattr(an, "get_analytics", fake_an)
    monkeypatch.setattr(tr, "list_trades_for_user",
                        lambda user_id, **kw: (list(trades or []), len(trades or [])))
    return calls


def test_mistakes_trend_more_less_same(monkeypatch):
    now_rows = [{"mistake": "fomo", "total": -300.0, "count": 4},
                {"mistake": "early_exit", "total": -80.0, "count": 1},
                {"mistake": "oversized", "total": -120.0, "count": 2}]
    prior_rows = [{"mistake": "fomo", "total": -100.0, "count": 2},
                  {"mistake": "early_exit", "total": -200.0, "count": 3},
                  {"mistake": "oversized", "total": -90.0, "count": 2},
                  {"mistake": "revenge", "total": -50.0, "count": 1}]
    calls = _patch_mistakes(monkeypatch, now_rows, prior_rows)
    out = nw.build("myMistakes", "u1", {}, now=NOW)
    by = {r["mistake"]: r for r in out["rows"]}
    assert by["fomo"] == {"mistake": "fomo", "cost30d": -300.0, "countNow": 4, "countPrior": 2, "trend": "more"}
    assert by["early_exit"]["trend"] == "less" and by["early_exit"]["countPrior"] == 3
    assert by["oversized"]["trend"] == "same"
    # a mistake only the prior window had is still a row: nothing this window, and it is "less"
    assert by["revenge"] == {"mistake": "revenge", "cost30d": None, "countNow": 0, "countPrior": 1, "trend": "less"}
    # biggest bleed first; a row with no figure this window sorts last
    assert [r["mistake"] for r in out["rows"]] == ["fomo", "oversized", "early_exit", "revenge"]
    assert "empty" not in out
    # two windows of 30 days, the older one ending the day before the newer starts
    ranges = sorted((c["date_from"], c["date_to"]) for c in calls)
    assert ranges == [("2026-08-22", "2026-09-20"), ("2026-09-21", "2026-10-20")]


def test_mistakes_a_new_mistake_is_more(monkeypatch):
    _patch_mistakes(monkeypatch, [{"mistake": "fomo", "total": -10.0, "count": 1}], [])
    out = nw.build("myMistakes", "u1", {}, now=NOW)
    assert out["rows"] == [{"mistake": "fomo", "cost30d": -10.0, "countNow": 1, "countPrior": 0, "trend": "more"}]


def test_mistakes_empty(monkeypatch):
    _patch_mistakes(monkeypatch, [], [])
    out = nw.build("myMistakes", "u1", {}, now=NOW)
    assert out["empty"] == "No mistakes tagged in the last 60 days."
    assert out["rows"] == []


def test_mistakes_source_comes_from_the_tagged_trades_origin(monkeypatch):
    tagged = [{**_trade(1, source="broker"), "mistakeTags": ["fomo"]},
              {**_trade(2, source="manual"), "mistakeTags": ["fomo"]},
              _trade(3, source="broker")]                      # untagged: not part of the answer
    _patch_mistakes(monkeypatch, [{"mistake": "fomo", "total": -1.0, "count": 2}], [], trades=tagged)
    assert nw.build("myMistakes", "u1", {}, now=NOW)["source"] == "mixed"


def test_mistakes_read_is_member_scoped_and_cached(monkeypatch):
    calls = _patch_mistakes(monkeypatch, [{"mistake": "fomo", "total": -1.0, "count": 1}], [])
    first = nw.build("myMistakes", "u1", {}, now=NOW)
    second = nw.build("myMistakes", "u1", {}, now=NOW)
    assert len(calls) == 2 and first["rows"] == second["rows"]      # two windows, read once
    nw.build("myMistakes", "u2", {}, now=NOW)
    assert len(calls) == 4


def test_rules_headline_is_the_sum_of_the_stored_counts(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"},
                                   {"id": "r-stop", "label": "Stop set before entry"}]}}
    adh = {}
    adh.update(_adh("id:t1", ["r-vol", "r-stop"], 2))
    adh.update(_adh("id:t2", ["r-vol"], 2))
    _patch_rules(monkeypatch, [_trade(1), _trade(2), _trade(3)], adh, setup_rules)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert (out["kept"], out["total"]) == (3, 4)
    assert sum(r["kept"] for r in out["rules"]) == out["kept"]
    assert sum(r["total"] for r in out["rules"]) == out["total"]
    assert all(r["total"] <= 2 for r in out["rules"])           # never more than the checked trades


def test_rules_headline_is_null_when_nothing_was_checked(monkeypatch):
    _patch_rules(monkeypatch, [_trade(1)], {}, {"a1": {"Flag": [{"id": "r", "label": "L"}]}})
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["kept"] is None and out["total"] is None


def test_rules_a_rule_created_after_the_trade_does_not_count(monkeypatch):
    journal = [{"id": "late", "label": "Journal every trade", "status": "active", "beforeEntry": True,
                "accountId": None, "createdAt": "2026-10-20T09:00:00+00:00"}]
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"}]}}
    rec = {"tradeRef": "id:t1", "setup": "Flag", "checkedRuleIds": ["r-vol"], "totalRules": 1,
           "adherencePct": 1.0, "updatedAt": "2026-10-19T15:00:00+00:00"}
    _patch_rules(monkeypatch, [_trade(1)], {"id:t1": rec}, setup_rules, journal)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["rules"] == [{"rule": "Volume dried up", "kept": 1, "total": 1}]
    assert (out["kept"], out["total"]) == (1, 1)
    # control: the same rule created BEFORE the record is on the list (stored count 2 proves it)
    journal[0]["createdAt"] = "2026-10-18T09:00:00+00:00"
    rec["totalRules"] = 2
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert {"rule": "Journal every trade", "kept": 0, "total": 1} in out["rules"]


def test_rules_unticked_setup_rule_needs_the_stored_count_to_prove_the_list(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"},
                                   {"id": "r-stop", "label": "Stop set before entry"}]}}
    # stored count 5 does not match today's 2-rule checklist: only the tick counts, never an overstated total
    adh = _adh("id:t1", ["r-vol"], 5)
    _patch_rules(monkeypatch, [_trade(1)], adh, setup_rules)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["rules"] == [{"rule": "Volume dried up", "kept": 1, "total": 1}]


def test_rules_empty_only_when_there_are_no_output_rules(monkeypatch):
    journal = [{"id": "gone", "label": "Old rule", "status": "dismissed", "beforeEntry": True, "accountId": None}]
    _patch_rules(monkeypatch, [_trade(1)], _adh("id:t1", ["rule:gone"], 1), {}, journal)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    assert out["rules"] == [{"rule": "Old rule", "kept": 1, "total": 1}]
    assert "empty" not in out


def test_rules_a_tick_on_a_deleted_rule_is_dropped_and_no_id_leaks(monkeypatch):
    setup_rules = {"a1": {"Flag": [{"id": "r-vol", "label": "Volume dried up"}]}}
    adh = _adh("id:t1", ["r-vol", "r-deleted-9f3", "rule:deleted-77c"], 3)
    _patch_rules(monkeypatch, [_trade(1)], adh, setup_rules)
    out = nw.build("myRulesCheck", "u1", {}, now=NOW)
    blob = json.dumps(out)
    assert out["rules"] == [{"rule": "Volume dried up", "kept": 1, "total": 1}]
    assert "r-deleted-9f3" not in blob and "deleted-77c" not in blob and "r-vol" not in blob


def test_member_rules_real_read_never_writes(monkeypatch, tmp_path):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    tables = ("j2_accounts", "j2_positions", "j2_journal_rules")
    before = tuple(_count(auth_db, t) for t in tables)
    assert nw._member_rules("nobody") == {"setup": {}, "journal": []}        # no account: still no row made
    assert tuple(_count(auth_db, t) for t in tables) == before
    accounts.get_or_migrate_default_account("u9")                            # control: this helper DOES write
    assert _count(auth_db, "j2_accounts") == before[0] + 1
    after = tuple(_count(auth_db, t) for t in tables)
    out = nw._member_rules("u9")
    assert set(out) == {"setup", "journal"} and tuple(_count(auth_db, t) for t in tables) == after


# -- wave 3: marketOnMyNames ---------------------------------------------------------

def _patch_names(monkeypatch, sets):
    import api.services.journal_two.earnings_prep as ep
    monkeypatch.setattr(ep, "_member_sets", lambda user_id: dict(sets))


def _patch_daily(monkeypatch, closes_by_sym):
    """Daily bars from close lists (oldest first); a symbol not given has no bars."""
    import api.services.bars_sqlite as bars
    calls = []

    def fake(sym, tf, n):
        calls.append((sym, tf, n))
        closes = closes_by_sym.get(sym) or []
        return [(20261001 + i, 0, 0, 0, c, 0) for i, c in enumerate(closes[-n:])]

    monkeypatch.setattr(bars, "get_bars", fake)
    return calls


def _patch_sector(monkeypatch, sector_by_sym):
    import api.services.groups as groups
    monkeypatch.setattr(
        groups, "resolve_primary_theme",
        lambda sym: ({"theme_name": "t", "sector_name": sector_by_sym[sym]}
                     if sector_by_sym.get(sym) else None),
    )


def _no_network(monkeypatch):
    """The market kinds must read caches only: a live-price or RS compute call fails the test."""
    import api.routers.live_prices as lp
    import api.services.rs_ranking as rs

    def boom(*a, **k):
        raise AssertionError("network or compute call from a cache-only builder")

    monkeypatch.setattr(lp, "get_live_prices", boom)
    monkeypatch.setattr(rs, "compute_rs_scores", boom)


def test_market_on_my_names_ret5d_vs_sector_from_your_names(monkeypatch):
    _no_network(monkeypatch)
    _patch_names(monkeypatch, {"NVDA": ["positions"], "AMD": ["watchlist"], "XOM": ["flagged"]})
    calls = _patch_daily(monkeypatch, {
        "NVDA": [100, 101, 102, 103, 104, 110],   # +10.0
        "AMD": [50, 50, 50, 50, 50, 51],          # +2.0
        "XOM": [80, 80, 80, 80, 80, 76],          # -5.0
    })
    _patch_sector(monkeypatch, {"NVDA": "Technology", "AMD": "Technology", "XOM": "Traditional Energy"})
    out = nw.build("marketOnMyNames", "u1", {}, now=NOW)
    assert out["asOf"] == "2026-10-20T15:00:00Z" and out["source"] == "market"
    assert out["sectorBasis"] == "your names"
    by = {r["symbol"]: r for r in out["rows"]}
    assert set(by) == {"NVDA", "AMD", "XOM"}
    assert by["NVDA"]["ret5d"] == pytest.approx(10.0)
    assert by["AMD"]["ret5d"] == pytest.approx(2.0)
    assert by["NVDA"]["sector"] == "Technology"
    assert by["NVDA"]["sectorRet5d"] == pytest.approx(6.0)
    assert by["NVDA"]["vsSector"] == pytest.approx(4.0)
    assert by["AMD"]["vsSector"] == pytest.approx(-4.0)
    # a sector holding only one of your names has no group figure to compare with: null, never 0
    assert by["XOM"]["sectorRet5d"] is None and by["XOM"]["vsSector"] is None
    assert all(c[1:] == ("D", 6) for c in calls)


def test_market_on_my_names_short_history_is_null(monkeypatch):
    _no_network(monkeypatch)
    _patch_names(monkeypatch, {"NEW": ["watchlist"], "OLD": ["watchlist"], "OLD2": ["watchlist"]})
    _patch_daily(monkeypatch, {"NEW": [10, 11, 12, 13, 14], "OLD": [10] * 5 + [11], "OLD2": [10] * 5 + [12]})
    _patch_sector(monkeypatch, {"NEW": "Technology", "OLD": "Technology", "OLD2": "Technology"})
    out = nw.build("marketOnMyNames", "u1", {}, now=NOW)
    by = {r["symbol"]: r for r in out["rows"]}
    assert by["NEW"]["ret5d"] is None and by["NEW"]["vsSector"] is None
    # the null name is left out of the sector figure, not counted as 0
    assert by["OLD"]["sectorRet5d"] == pytest.approx(15.0)
    assert by["NEW"]["sectorRet5d"] == pytest.approx(15.0)


def test_market_on_my_names_no_sector_and_errors_are_null(monkeypatch):
    _no_network(monkeypatch)
    _patch_names(monkeypatch, {"AAA": ["watchlist"], "BBB": ["watchlist"]})
    import api.services.bars_sqlite as bars

    def bars_fail(sym, tf, n):
        if sym == "BBB":
            raise RuntimeError("db locked")
        return [(i, 0, 0, 0, 10.0 + i, 0) for i in range(6)]

    monkeypatch.setattr(bars, "get_bars", bars_fail)
    import api.services.groups as groups

    def theme_fail(sym):
        raise RuntimeError("taxonomy unavailable")

    monkeypatch.setattr(groups, "resolve_primary_theme", theme_fail)
    out = nw.build("marketOnMyNames", "u1", {}, now=NOW)
    by = {r["symbol"]: r for r in out["rows"]}
    assert by["AAA"]["ret5d"] == pytest.approx(50.0)
    assert by["AAA"]["sector"] is None and by["AAA"]["sectorRet5d"] is None
    assert by["BBB"]["ret5d"] is None


def test_market_on_my_names_capped_and_empty(monkeypatch):
    _no_network(monkeypatch)
    _patch_names(monkeypatch, {f"S{n:02d}": ["watchlist"] for n in range(45)})
    _patch_daily(monkeypatch, {})
    _patch_sector(monkeypatch, {})
    out = nw.build("marketOnMyNames", "u1", {}, now=NOW)
    assert len(out["rows"]) == nw.ROW_CAP and out["truncated"] == 5
    assert [r["symbol"] for r in out["rows"]] == sorted(r["symbol"] for r in out["rows"])
    _patch_names(monkeypatch, {})
    empty = nw.build("marketOnMyNames", "u1", {}, now=NOW)
    assert empty["rows"] == [] and empty["empty"] == "No names in your positions, watchlist or flagged list."


# -- wave 3: tickerFlow --------------------------------------------------------------

def _flow_payload(contracts, served="1", widened=None, net=True):
    window = {"days_requested": served, "start": "10/20/2026", "end": "10/20/2026"}
    if widened:
        window["widened_from"] = widened
    out = {"ok": True, "symbol": "NVDA", "source": "stocks",
           "window": window, "contract_count": len(contracts), "contracts": contracts}
    if net:
        out["net"] = {"bull": 900000, "bear": 125000, "unclassified": 0, "dir": "BULL"}
    return out


def _contract(i, cp="C"):
    return {"ticker": "NVDA", "cp": cp, "strike": 200.0 + i, "exp": "11/20/2026", "dte": 31,
            "premium": 100000 - i, "volume": 500, "oi": 1000, "direction": "Bull",
            "bull_premium": 100000 - i, "bear_premium": 0}


def _patch_flow(monkeypatch, result, source="stocks", sleep_s=0.0):
    import api.services.flow_card_from_page as page
    import api.services.discord_render.symbols as symbols
    calls = []

    def fake(ticker, days, src, timeout_s=20.0, **kw):
        calls.append({"ticker": ticker, "days": days, "source": src, "timeout_s": timeout_s, **kw})
        if sleep_s:
            time.sleep(sleep_s)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(page, "page_derived_payload", fake)
    monkeypatch.setattr(symbols, "flow_source", lambda sym: source)
    return calls


def test_ticker_flow_calls_the_page_reader_once_bounded(monkeypatch):
    calls = _patch_flow(monkeypatch, _flow_payload([_contract(i) for i in range(12)]), source="etfs")
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert len(calls) == 1
    assert calls[0]["ticker"] == "NVDA" and calls[0]["days"] == "1" and calls[0]["source"] == "etfs"
    assert calls[0]["timeout_s"] == nw.TICKER_FLOW_TIMEOUT_S == 8.0
    assert out["asOf"] == "2026-10-20T15:00:00Z" and out["source"] == "market" and out["symbol"] == "NVDA"
    assert len(out["topPrints"]) == 10
    first = out["topPrints"][0]
    assert first == {"cp": "C", "strike": 200.0, "exp": "11/20/2026", "dte": 31,
                     "premium": 100000, "volume": 500, "direction": "Bull"}
    assert out["window"] == "Today"
    assert "empty" not in out


def test_ticker_flow_net_figures_are_the_payloads_own(monkeypatch):
    # The contracts would sum to 199,999; the payload's own net says 900,000 / 125,000 and wins.
    _patch_flow(monkeypatch, _flow_payload([_contract(0, "C"), _contract(1, "P")]))
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["bullPremium"] == 900000 and out["bearPremium"] == 125000
    for gone in ("callPremium", "putPremium", "ratio"):
        assert gone not in out


def test_ticker_flow_net_absent_is_null(monkeypatch):
    _patch_flow(monkeypatch, _flow_payload([_contract(0)], net=False))
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["bullPremium"] is None and out["bearPremium"] is None
    assert len(out["topPrints"]) == 1


@pytest.mark.parametrize("served,label", [("5", "Last 5 sessions"), ("20", "Last 20 sessions"),
                                          ("all", "All sessions on record")])
def test_ticker_flow_widened_window_is_named_not_called_empty(monkeypatch, served, label):
    _patch_flow(monkeypatch, _flow_payload([_contract(0)], served=served, widened="1"))
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["window"] == label
    assert "empty" not in out and len(out["topPrints"]) == 1
    assert out["bullPremium"] == 900000


def test_ticker_flow_nothing_on_any_rung_is_an_empty_payload(monkeypatch):
    _patch_flow(monkeypatch, _flow_payload([]))
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["empty"] == "No options flow on record for NVDA today." and "failed" not in out
    assert out["bullPremium"] is None and out["bearPremium"] is None and out["window"] is None
    assert out["topPrints"] == []
    assert out["asOf"] and out["source"] == "market"


@pytest.mark.parametrize("result", [None, TimeoutError("read timed out")])
def test_ticker_flow_a_failed_read_is_failed_never_no_flow(monkeypatch, result):
    """UX audit I-5 (R58): no product (None) or a raised read is a failure, distinct from a true empty."""
    _patch_flow(monkeypatch, result)
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["failed"] is True and out["empty"] == "Couldn't load options flow right now."
    assert out["bullPremium"] is None and out["window"] is None and out["topPrints"] == []


def test_ticker_flow_a_reader_past_the_budget_is_abandoned(monkeypatch):
    monkeypatch.setattr(nw, "TICKER_FLOW_TIMEOUT_S", 0.2)
    _patch_flow(monkeypatch, _flow_payload([_contract(0)]), sleep_s=2.0)
    t0 = time.monotonic()
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert time.monotonic() - t0 < 1.0
    assert out["failed"] is True and out["empty"] == nw.FLOW_FAILED_SENTENCE and out["topPrints"] == []


def test_ticker_flow_bad_symbol_raises(monkeypatch):
    calls = _patch_flow(monkeypatch, None)
    for bad in (None, "", "nvda", "TOO-LONG-SYMBOL", 7):
        with pytest.raises(nw.WidgetRequestError):
            nw.build("tickerFlow", "u1", {"symbol": bad}, now=NOW)
    assert calls == []


# -- wave 6: tradeRecap ----------------------------------------------------------------

def _recap_trade(**over):
    t = {"id": "t-1", "symbol": "NVDA", "side": "Long", "entryDate": "2026-09-01", "exitDate": "2026-09-10",
         "entryPrice": 100.0, "exitPrice": 110.0, "rMultiple": 2.0, "pnlDollarNet": 995.0, "setup": "Flag",
         "holdDays": 9, "mistakeTags": ["fomo"], "source": "broker", "positionId": "pos-secret"}
    t.update(over)
    return t


def _patch_trade(monkeypatch, owned=None, excursion=None):
    """`get_trade_detail` OWN-SCOPED the way the real one is: only `owned` (user_id, trade_id) answers."""
    import api.services.journal_two.trades as tr
    calls = []

    def fake(user_id, trade_id, conn=None):
        calls.append((user_id, trade_id))
        if owned and (user_id, trade_id) == owned[0]:
            return {"trade": owned[1], "tradeRef": "id:" + trade_id, "brokerActivities": [], "excursion": excursion}
        return None

    monkeypatch.setattr(tr, "get_trade_detail", fake)
    return calls


def _patch_bars_before(monkeypatch, bars):
    import api.services.bars_sqlite as bs
    calls = []

    def fake(sym, tf, n, to_key):
        calls.append((sym, tf, n, to_key))
        return [b for b in bars if b[0] <= to_key][-n:]

    monkeypatch.setattr(bs, "get_bars_before", fake)
    return calls


def _sessions(start_ymd, count):
    """`count` weekday daily bars from `start_ymd` on, as (ymd, o, h, l, c, v)."""
    from datetime import date, timedelta
    d = date(start_ymd // 10000, start_ymd // 100 % 100, start_ymd % 100)
    out = []
    while len(out) < count:
        if d.weekday() < 5:
            ymd = int(d.strftime("%Y%m%d"))
            out.append((ymd, 1.0, 2.0, 0.5, 1.5 + len(out), 100))
        d += timedelta(days=1)
    return out


def test_trade_recap_payload_and_bars_window(monkeypatch):
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade()))
    _patch_bars_before(monkeypatch, _sessions(20260601, 120))
    out = nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)
    assert out["source"] == "broker" and out["asOf"] == "2026-10-20T15:00:00Z"
    assert (out["symbol"], out["side"], out["setup"], out["holdDays"]) == ("NVDA", "Long", "Flag", 9)
    assert (out["entryDate"], out["exitDate"]) == ("2026-09-01", "2026-09-10")
    assert (out["entryPrice"], out["exitPrice"], out["pnl"]) == (100.0, 110.0, 995.0)
    assert out["r"] == 2.0 and out["mistakes"] == ["fomo"]
    days = [b["t"] for b in out["bars"]]
    entry_i, exit_i = days.index("2026-09-01"), days.index("2026-09-10")
    assert entry_i == 20 and len(days) - 1 - exit_i == 20        # 20 sessions either side
    assert len(out["bars"]) <= nw.RECAP_BARS_MAX
    assert "positionId" not in json.dumps(out) and "pos-secret" not in json.dumps(out)
    assert "tradeId" not in out


def test_trade_recap_r_is_the_trades_own_stored_r_then_true_r_never_recomputed(monkeypatch):
    _patch_bars_before(monkeypatch, [])
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(rMultiple=None)), excursion={"trueR": 1.25})
    assert nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)["r"] == 1.25
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(rMultiple=-0.5)), excursion={"trueR": 1.25})
    assert nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)["r"] == -0.5
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(rMultiple=None)), excursion=None)
    out = nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)
    assert out["r"] is None and out["bars"] == []


def test_trade_recap_long_hold_is_capped_at_120_bars_keeping_entry_and_exit(monkeypatch):
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(entryDate="2025-06-02", exitDate="2026-06-01")))
    _patch_bars_before(monkeypatch, _sessions(20250101, 420))
    out = nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)
    assert len(out["bars"]) == nw.RECAP_BARS_MAX
    assert out["bars"][0]["t"] < "2025-06-02" and out["bars"][-1]["t"] > "2026-06-01"


def test_f4_d3_trade_recap_reads_a_date_only_manual_trade_on_the_day_typed(monkeypatch):
    # Fix F4 (D3, walk 2026-10-21): a manual trade entered 2026-10-13 and exited 2026-10-15 is stored at UTC
    # midnight, which is 8 pm ET the evening before. The recap said "Oct 12" / "Oct 14". A date-only value is a
    # calendar date (timeutil.compute_trading_day_et), never shifted; the bars window follows the same days.
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(
        entryDate="2026-10-13T00:00:00Z", exitDate="2026-10-15T00:00:00+00:00")))
    _patch_bars_before(monkeypatch, _sessions(20260801, 80))
    out = nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)
    assert (out["entryDate"], out["exitDate"]) == ("2026-10-13", "2026-10-15")
    days = [b["t"] for b in out["bars"]]
    assert "2026-10-13" in days and "2026-10-15" in days


def test_f4_d3_trade_recap_still_reads_a_real_timestamp_on_the_et_calendar(monkeypatch):
    # The control: a timed fill at 01:30 UTC on the 16th happened at 9:30 pm ET on the 15th.
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(
        entryDate="2026-10-13T14:31:00Z", exitDate="2026-10-16T01:30:00Z")))
    _patch_bars_before(monkeypatch, [])
    out = nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)
    assert (out["entryDate"], out["exitDate"]) == ("2026-10-13", "2026-10-15")


def test_f4_d3_trade_recap_real_read_of_a_utc_midnight_manual_trade(monkeypatch, tmp_path):
    # End to end through the real own-scoped read: the row stored the way a manual date-only entry is stored.
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    _patch_bars_before(monkeypatch, [])
    c = auth_db.get_connection()
    try:
        c.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
            " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,"
            " hold_days, result, context_at_entry, created_at, mistake_tags, emotion_tags, fees)"
            " VALUES ('t-msft', 'owner', 'p1', 'MSFT', 'Long', 10, 500, '2026-10-13T00:00:00Z', 490,"
            " '2026-10-15T00:00:00Z', 480, '', '', -100, -0.02, -0.5, 2, 'Loss', '{}', '2026-10-15', '[]', '[]', 0)")
        c.commit()
    finally:
        c.close()
    out = nw.build("tradeRecap", "owner", {"tradeId": "t-msft"}, now=NOW)
    assert (out["entryDate"], out["exitDate"]) == ("2026-10-13", "2026-10-15")


def test_trade_recap_other_users_trade_refused(monkeypatch):
    calls = _patch_trade(monkeypatch, owned=(("owner", "t-1"), _recap_trade()))
    _patch_bars_before(monkeypatch, _sessions(20260601, 120))
    messages = []
    for user, tid in (("intruder", "t-1"), ("owner", "t-missing"), ("owner", "bad id!"), ("owner", "x" * 80)):
        with pytest.raises(nw.WidgetRequestError) as e:
            nw.build("tradeRecap", user, {"tradeId": tid}, now=NOW)
        messages.append(str(e.value))
    assert set(messages) == {"Trade not found"}                  # one sentence: ids cannot be probed
    assert ("intruder", "t-1") in calls                           # the read itself was own-scoped
    assert ("owner", "bad id!") not in calls                      # a malformed id is never read
    with pytest.raises(nw.WidgetRequestError, match="tradeId is required"):
        nw.build("tradeRecap", "owner", {}, now=NOW)


def test_trade_recap_real_read_is_own_scoped(monkeypatch, tmp_path):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    _patch_bars_before(monkeypatch, [])
    c = auth_db.get_connection()
    try:
        c.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
            " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,"
            " hold_days, result, context_at_entry, created_at, mistake_tags, emotion_tags, fees)"
            " VALUES ('t-real', 'owner', 'p1', 'AMD', 'Long', 10, 50, '2026-09-01', 55, '2026-09-05', 48,"
            " 'Flag', '', 50, 0.1, 2.5, 4, 'Win', '{}', '2026-09-05', ?, '[]', 0)", (json.dumps(["chased"]),))
        c.commit()
    finally:
        c.close()
    out = nw.build("tradeRecap", "owner", {"tradeId": "t-real"}, now=NOW)
    assert out["symbol"] == "AMD" and out["r"] == 2.5 and out["mistakes"] == ["chased"]
    with pytest.raises(nw.WidgetRequestError, match="^Trade not found$"):
        nw.build("tradeRecap", "intruder", {"tradeId": "t-real"}, now=NOW)


# -- wave 6: myPnlCalendar ---------------------------------------------------------------

@pytest.fixture(autouse=True)
def _fresh_pnl_calendar_cache():
    nw._PNL_CALENDAR_CACHE.clear()
    yield
    nw._PNL_CALENDAR_CACHE.clear()


def _patch_calendar(monkeypatch, by_day, trades=(), trade_count=None):
    import api.services.journal_two.analytics as an
    import api.services.journal_two.trades as tr
    calls = []

    def fake_an(user_id, *a, **k):
        calls.append((user_id, k.get("date_from"), k.get("date_to")))
        return {"tradeCount": len(by_day) if trade_count is None else trade_count,
                "performance": {"byDay": list(by_day)}}

    monkeypatch.setattr(an, "get_analytics", fake_an)
    monkeypatch.setattr(tr, "list_trades_for_user", lambda user_id, *a, **k: (list(trades), len(trades)))
    return calls


def test_pnl_calendar_days_best_worst_from_by_day(monkeypatch):
    calls = _patch_calendar(monkeypatch, [
        {"date": "2026-10-01", "pnl": 120.0}, {"date": "2026-10-02", "pnl": -80.5},
        {"date": "2026-10-05", "pnl": 300.25, "tradeCount": 3}],
        trades=[{"source": "broker"}, {"source": None}])
    out = nw.build("myPnlCalendar", "u1", {"month": "2026-10"}, now=NOW)
    assert calls == [("u1", "2026-10-01", "2026-10-31")]
    assert out["month"] == "2026-10" and out["source"] == "mixed"
    assert out["days"] == [{"day": "2026-10-01", "pnl": 120.0}, {"day": "2026-10-02", "pnl": -80.5},
                           {"day": "2026-10-05", "pnl": 300.25}]
    assert all("trades" not in d for d in out["days"])        # R51: no per-day count is invented
    assert out["best"] == {"day": "2026-10-05", "pnl": 300.25}
    assert out["worst"] == {"day": "2026-10-02", "pnl": -80.5}
    assert "empty" not in out


def test_pnl_calendar_default_month_is_the_current_et_month(monkeypatch):
    calls = _patch_calendar(monkeypatch, [])
    late = datetime(2026, 11, 1, 2, 0, tzinfo=timezone.utc)       # still October 31 in New York
    assert nw.build("myPnlCalendar", "u1", {}, now=late)["month"] == "2026-10"
    assert calls[-1] == ("u1", "2026-10-01", "2026-10-31")


def test_pnl_calendar_empty_month_sentence(monkeypatch):
    _patch_calendar(monkeypatch, [], trade_count=0)
    out = nw.build("myPnlCalendar", "u1", {"month": "2026-02"}, now=NOW)
    assert out["empty"] == "No closed trades this month yet."
    assert out["days"] == [] and out["best"] is None and out["worst"] is None


def test_pnl_calendar_bad_month_raises(monkeypatch):
    _patch_calendar(monkeypatch, [])
    for bad in ("2026-13", "26-10", "2026/10", "october", "2026-1"):
        with pytest.raises(nw.WidgetRequestError, match="month"):
            nw.build("myPnlCalendar", "u1", {"month": bad}, now=NOW)


def test_pnl_calendar_is_cached_per_member_and_month(monkeypatch):
    calls = _patch_calendar(monkeypatch, [{"date": "2026-10-01", "pnl": 1.0}])
    nw.build("myPnlCalendar", "u1", {"month": "2026-10"}, now=NOW)
    nw.build("myPnlCalendar", "u1", {"month": "2026-10"}, now=NOW)
    nw.build("myPnlCalendar", "u2", {"month": "2026-10"}, now=NOW)
    nw.build("myPnlCalendar", "u1", {"month": "2026-09"}, now=NOW)
    assert [c[0] for c in calls] == ["u1", "u2", "u1"]


# -- wave 6: mySetupEdge -------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _fresh_setup_edge_cache():
    nw._SETUP_EDGE_CACHE.clear()
    yield
    nw._SETUP_EDGE_CACHE.clear()


def _patch_edge(monkeypatch, edge, trades=({"setup": "Flag", "source": "manual", "result": "Win", "r_multiple": 1.0,
                                         "pnl_dollar": 10.0, "pnl_percent": 0.01},)):
    import api.services.personal_edge as pe
    seen = []

    def fake(user_id, account_id=None, *, setup_perf_fn=None, firm_fn=None):
        seen.append((user_id, account_id, setup_perf_fn(user_id, account_id) if setup_perf_fn else None))
        return edge

    monkeypatch.setattr(pe, "edge_for_setups", fake)
    monkeypatch.setattr(nw, "_scoped_closed_trades", lambda user_id: [dict(t) for t in trades])
    return seen


def test_setup_edge_rows_from_edge_for_setups(monkeypatch):
    seen = _patch_edge(monkeypatch, {
        "Flag": {"n": 30, "avg_r": 0.42, "total_r": 12.6, "win_rate": 0.55, "verdict": "edge", "muted": False,
                 "note": "x"},
        "VCP": {"n": 4, "avg_r": -0.1, "total_r": -0.4, "win_rate": None, "verdict": "thin", "muted": False,
                "note": "y"}})
    out = nw.build("mySetupEdge", "u1", {}, now=NOW)
    assert out["source"] == "manual"
    assert out["rows"] == [
        {"setup": "Flag", "n": 30, "expectancyR": 0.42, "winRate": 0.55, "thin": False},
        {"setup": "VCP", "n": 4, "expectancyR": -0.1, "winRate": None, "thin": True}]
    user, account, perf = seen[0]
    assert (user, account) == ("u1", "_all_")
    assert [r["key"] for r in perf] == ["Flag"]                # the seam aggregates the SAME trades


def test_setup_edge_is_cached_per_member(monkeypatch):
    seen = _patch_edge(monkeypatch, {})
    nw.build("mySetupEdge", "u1", {}, now=NOW)
    nw.build("mySetupEdge", "u1", {}, now=NOW)
    nw.build("mySetupEdge", "u2", {}, now=NOW)
    assert [x[0] for x in seen] == ["u1", "u2"]


def test_setup_edge_thin_below_25(monkeypatch):
    import api.services.personal_edge as pe
    assert pe._MUTE_MIN_N == 25
    _patch_edge(monkeypatch, {f"S{n}": {"n": n, "avg_r": 0.1, "win_rate": 0.5} for n in (1, 24, 25, 26)})
    rows = {r["setup"]: r["thin"] for r in nw.build("mySetupEdge", "u1", {}, now=NOW)["rows"]}
    assert rows == {"S1": True, "S24": True, "S25": False, "S26": False}
    monkeypatch.setattr(pe, "_MUTE_MIN_N", 10)                 # the constant is READ, never retyped
    rows = {r["setup"]: r["thin"] for r in nw.build("mySetupEdge", "u1", {}, now=NOW)["rows"]}
    assert rows == {"S1": True, "S24": False, "S25": False, "S26": False}


def test_setup_edge_empty(monkeypatch):
    _patch_edge(monkeypatch, {})
    out = nw.build("mySetupEdge", "u1", {}, now=NOW)
    assert out["rows"] == [] and out["empty"] == nw.SETUP_EDGE_EMPTY_SENTENCE


def _insert_trade(auth_db, user_id, account_id, setup, r, exit_date):
    c = auth_db.get_connection()
    try:
        c.execute(
            "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
            " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,"
            " hold_days, result, context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)"
            " VALUES (?, ?, 'p', 'AMD', 'Long', 10, 50, ?, 55, ?, 48, ?, '', 50, 0.1, ?, 4, 'Win', '{}', ?,"
            " ?, '[]', '[]', 0)",
            (f"t-{setup}-{exit_date}", user_id, exit_date, exit_date, setup, r, exit_date, account_id))
        c.commit()
    finally:
        c.close()


def test_setup_edge_real_read_covers_every_account_and_all_time_and_never_writes(monkeypatch, tmp_path):
    from datetime import timedelta
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services import personal_edge as pe
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u9")        # setup only: this helper writes
    acc_id = acc["id"] if isinstance(acc, dict) else acc
    old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    _insert_trade(auth_db, "u9", acc_id, "Flag", 2.0, old)
    # Control, measured: the bare call (the default seam) keeps its 7-day lookback (ruling I-1), so
    # a 60-day-old trade is outside it; the widget's own seam reads the bounded all-time history.
    assert pe.edge_for_setups("u9") == {}
    tables = ("j2_accounts", "j2_trades", "j2_positions")
    before = tuple(_count(auth_db, t) for t in tables)
    out = nw.build("mySetupEdge", "u9", {}, now=NOW)
    assert tuple(_count(auth_db, t) for t in tables) == before
    assert [(r["setup"], r["n"], r["expectancyR"]) for r in out["rows"]] == [("Flag", 1, 2.0)]
    assert out["source"] == "manual"


def _add_account(auth_db, user_id, acc_id, compass_enabled):
    c = auth_db.get_connection()
    try:
        src = c.execute("SELECT * FROM j2_accounts WHERE user_id = ? LIMIT 1", (user_id,)).fetchone()
        cols = list(src.keys())
        vals = [acc_id if k == "id" else (f"acct {acc_id}" if k == "name" else
                (compass_enabled if k == "compass_enabled" else src[k])) for k in cols]
        c.execute(f"INSERT INTO j2_accounts ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
        c.commit()
    finally:
        c.close()


def _sql(auth_db, stmt):
    c = auth_db.get_connection()
    try:
        c.execute(stmt)
        c.commit()
    finally:
        c.close()


def test_setup_edge_source_and_figures_share_one_scope(monkeypatch, tmp_path):
    """An account opted out of Compass is outside the edge figures, so its broker trades must not turn
    the label "mixed" either: `source` comes from the SAME trades the edge aggregates."""
    from datetime import timedelta
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u9")
    acc_id = acc["id"] if isinstance(acc, dict) else acc
    _add_account(auth_db, "u9", "acct-optout", 0)
    when = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    _insert_trade(auth_db, "u9", acc_id, "Flag", 1.0, when)
    _insert_trade(auth_db, "u9", "acct-optout", "VCP", 3.0, when)
    _sql(auth_db, "UPDATE j2_trades SET source = 'broker' WHERE account_id = 'acct-optout'")
    out = nw.build("mySetupEdge", "u9", {}, now=NOW)
    assert [r["setup"] for r in out["rows"]] == ["Flag"]
    assert out["source"] == "manual"
    # Control: with that account opted in, both its setup and its broker source arrive.
    _sql(auth_db, "UPDATE j2_accounts SET compass_enabled = 1 WHERE id = 'acct-optout'")
    nw._SETUP_EDGE_CACHE.clear()
    out = nw.build("mySetupEdge", "u9", {}, now=NOW)
    assert sorted(r["setup"] for r in out["rows"]) == ["Flag", "VCP"] and out["source"] == "mixed"


def test_setup_edge_reads_at_most_the_most_recent_bound(monkeypatch, tmp_path):
    from datetime import timedelta
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account("u9")
    acc_id = acc["id"] if isinstance(acc, dict) else acc
    base = datetime.now(timezone.utc)
    # "Old" exits two hours before the 2nd most recent trade, on the SAME day: the SQL window
    # (inclusive of the boundary day) still holds it, so only the exact slice can drop it.
    for setup, ago in (("Old", timedelta(days=20, hours=2)), ("Flag", timedelta(days=20)),
                       ("Flag", timedelta(days=10))):
        _insert_trade(auth_db, "u9", acc_id, setup, 1.0, (base - ago).isoformat())
    monkeypatch.setattr(nw, "SETUP_EDGE_TRADES_MAX", 2)
    assert [t["setup"] for t in nw._scoped_closed_trades("u9")] == ["Flag", "Flag"]
    out = nw.build("mySetupEdge", "u9", {}, now=NOW)
    assert [(r["setup"], r["n"]) for r in out["rows"]] == [("Flag", 2)]


# -- wave 6: myScreenToday -----------------------------------------------------------------

_DEF = {"meta": {"name": "My breakout screen"}, "compute": {"kind": "ast", "fn": "sha256:abc"}}


def _patch_screen(monkeypatch, *, owned=("owner", "u_0123456789ab"), receipt=None, latest=20261019,
                  tickers=("AAA", "BBB"), truncated=False, prices=None, def_hash="sha256:abc"):
    import api.services.user_definitions as ud
    import api.services.scan_definition as sd
    import api.services.screener.scan_store as ss
    import api.routers.scan_results as sr
    seen = {"get": [], "coverage": [], "hits": []}

    def fake_get(user_id, def_id, version=None):
        seen["get"].append((user_id, def_id))
        if not ud.DEF_ID_RE.match(def_id):
            raise ValueError("not a def id")
        return {"def_id": def_id, "definition": _DEF} if (user_id, def_id) == owned else None

    def fake_cov(h, tf, as_of):
        seen["coverage"].append((h, tf, as_of))
        return receipt

    def fake_hits(h, tf, as_of, limit):
        seen["hits"].append((h, tf, as_of, limit))
        return list(tickers)[:limit], truncated

    monkeypatch.setattr(ud, "get", fake_get)
    monkeypatch.setattr(sd, "def_hash", lambda d: def_hash)
    monkeypatch.setattr(ss, "latest_covered_as_of", lambda h, tf: latest)
    monkeypatch.setattr(ss, "coverage", fake_cov)
    monkeypatch.setattr(sr, "_hit_tickers", fake_hits)
    _patch_prices(monkeypatch, prices if prices is not None else
                  {"AAA": {"price": 10.0, "change_pct": 1.5}, "BBB": {"price": None}})
    return seen


_RECEIPT = {"as_of": 20261019, "evaluated": 100, "answered": 60, "dropped": 30, "not_computable": 10,
            "dropped_symbols": ["X"]}


def test_screen_today_hits_and_coverage(monkeypatch):
    seen = _patch_screen(monkeypatch, receipt=dict(_RECEIPT))
    out = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)
    assert out["source"] == "market" and out["name"] == "My breakout screen"
    assert out["hits"] == [{"symbol": "AAA", "price": 10.0, "changePct": 1.5},
                           {"symbol": "BBB", "price": None, "changePct": None}]
    assert out["coverage"] == {"evaluated": 100, "answered": 60, "dropped": 30, "notComputable": 10, "withheld": 0}
    assert seen["coverage"] == [("sha256:abc", "D", 20261019)]
    assert seen["hits"] == [("sha256:abc", "D", 20261019, nw.ROW_CAP)]


def test_screen_coverage_counts_close(monkeypatch):
    broken = dict(_RECEIPT, answered=61)                        # 61 + 30 + 10 != 100
    _patch_screen(monkeypatch, receipt=broken)
    out = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)
    assert out["empty"] == "This screen's results are not ready yet."
    assert out["hits"] == [] and out["coverage"] is None
    # Never swept (no receipt, or no session at all): the same sentence, no invented counts.
    for kw in ({"receipt": None}, {"receipt": dict(_RECEIPT), "latest": None}):
        _patch_screen(monkeypatch, **kw)
        out = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)
        assert out["empty"] == "This screen's results are not ready yet." and out["coverage"] is None


def test_screen_withheld_comes_from_the_receipt_and_is_never_folded_in(monkeypatch):
    _patch_screen(monkeypatch, receipt=dict(_RECEIPT, withheld=7))
    cov = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)["coverage"]
    assert cov["withheld"] == 7 and cov["evaluated"] == 100


def test_screen_truncated_hits_say_so(monkeypatch):
    many = [f"S{i:02d}" for i in range(nw.ROW_CAP)]
    _patch_screen(monkeypatch, receipt=dict(_RECEIPT), tickers=many, truncated=True, prices={})
    out = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)
    assert len(out["hits"]) == nw.ROW_CAP and out["truncated"] is True     # the route's boolean, no count
    _patch_screen(monkeypatch, receipt=dict(_RECEIPT), tickers=many, truncated=False, prices={})
    assert "truncated" not in nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)


@pytest.fixture
def narrow_toolkit(monkeypatch):
    """A second toolkit through the module's own seam (a test fixture; TOOLKITS ships one entry)."""
    import dataclasses
    from types import MappingProxyType
    import api.services.entitlements as ent
    narrow = dataclasses.replace(ent.TOOLKITS[ent.DEFAULT_TOOLKIT], toolkit="narrow", max_symbols=1)
    monkeypatch.setattr(ent, "TOOLKITS", MappingProxyType(
        {ent.DEFAULT_TOOLKIT: ent.TOOLKITS[ent.DEFAULT_TOOLKIT], "narrow": narrow}))
    return narrow


def test_screen_rows_are_capped_by_the_members_real_toolkit(monkeypatch, tmp_path, narrow_toolkit):
    auth_db = _temp_auth_db(monkeypatch, tmp_path)
    c = auth_db.get_connection()
    try:
        c.execute("INSERT INTO users (id, email, password_hash) VALUES ('owner', 'owner@t.test', 'x')")
        c.execute("UPDATE users SET toolkit = 'narrow' WHERE id = 'owner'")
        c.commit()
    finally:
        c.close()
    _patch_screen(monkeypatch, receipt=dict(_RECEIPT))
    out = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)
    assert [h["symbol"] for h in out["hits"]] == ["AAA"]
    assert out["coverage"]["withheld"] == 1 and out["coverage"]["evaluated"] == 100
    assert nw._toolkit_user("owner") == {"id": "owner", "toolkit": "narrow"}
    # Control: the same member with no toolkit set gets the default (ungated) toolkit and both rows.
    c = auth_db.get_connection()
    try:
        c.execute("UPDATE users SET toolkit = NULL WHERE id = 'owner'")
        c.commit()
    finally:
        c.close()
    out = nw.build("myScreenToday", "owner", {"definitionId": "u_0123456789ab"}, now=NOW)
    assert [h["symbol"] for h in out["hits"]] == ["AAA", "BBB"] and out["coverage"]["withheld"] == 0
    assert nw._toolkit_user("owner") == {"id": "owner"}


def test_screen_not_yours_or_missing_is_refused_with_one_sentence(monkeypatch):
    seen = _patch_screen(monkeypatch, receipt=dict(_RECEIPT))
    messages = []
    for user, did in (("intruder", "u_0123456789ab"), ("owner", "u_ffffffffffff"), ("owner", "bad id")):
        with pytest.raises(nw.WidgetRequestError) as e:
            nw.build("myScreenToday", user, {"definitionId": did}, now=NOW)
        messages.append(str(e.value))
    assert set(messages) == {"Screen not found"}
    assert ("intruder", "u_0123456789ab") in seen["get"] and seen["coverage"] == []
    with pytest.raises(nw.WidgetRequestError, match="definitionId is required"):
        nw.build("myScreenToday", "owner", {}, now=NOW)


# -- wave 6: roomBuzzOnMyNames -------------------------------------------------------------

def _patch_buzz(monkeypatch, board_rows, names=("NVDA", "AMD", "TSLA"), channels="111,222"):
    import api.services.buzz_store as bst
    calls = []

    def fake_board(start_ts, end_ts, chans, limit=10):
        calls.append((start_ts, end_ts, list(chans), limit))
        return [dict(r) for r in board_rows]

    monkeypatch.setattr(bst, "board", fake_board)
    _patch_names(monkeypatch, {s: ["watchlist"] for s in names})
    if channels is None:
        monkeypatch.delenv("BUZZ_CHANNELS", raising=False)
    else:
        monkeypatch.setenv("BUZZ_CHANNELS", channels)
    return calls


_BOARD = [{"ticker": "SPY", "people": 9, "mentions": 40}, {"ticker": "NVDA", "people": 5, "mentions": 12},
          {"ticker": "AMD", "people": 2, "mentions": 3}]


def test_buzz_rows_are_the_board_intersected_with_my_names(monkeypatch):
    calls = _patch_buzz(monkeypatch, _BOARD)
    out = nw.build("roomBuzzOnMyNames", "u1", {}, now=NOW)       # Tue 11:00 ET: since today's open
    assert out["source"] == "market"
    assert out["rows"] == [{"symbol": "NVDA", "mentions": 12, "people": 5},
                           {"symbol": "AMD", "mentions": 3, "people": 2}]
    start, end, chans, _limit = calls[0]
    assert chans == ["111", "222"]
    open_et = datetime(2026, 10, 20, 13, 30, tzinfo=timezone.utc)  # 09:30 EDT
    assert start == int(open_et.timestamp()) and end == int(NOW.timestamp())


def test_buzz_before_the_open_reads_the_previous_session(monkeypatch):
    calls = _patch_buzz(monkeypatch, _BOARD)
    early_monday = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)   # Mon 08:00 EDT
    nw.build("roomBuzzOnMyNames", "u1", {}, now=early_monday)
    start, end, _c, _l = calls[0]
    assert start == int(datetime(2026, 10, 16, 13, 30, tzinfo=timezone.utc).timestamp())   # Fri 09:30
    assert end == int(datetime(2026, 10, 16, 20, 0, tzinfo=timezone.utc).timestamp())     # Fri 16:00


def test_buzz_never_returns_text(monkeypatch):
    rows = [dict(r, text="secret words", content="more", message="msg", message_id="9", author="a")
            for r in _BOARD]
    _patch_buzz(monkeypatch, rows)
    out = nw.build("roomBuzzOnMyNames", "u1", {}, now=NOW)

    def keys(v):
        if isinstance(v, dict):
            for k, x in v.items():
                yield k
                yield from keys(x)
        elif isinstance(v, list):
            for x in v:
                yield from keys(x)

    assert not {"text", "content", "message"} & set(keys(out))
    assert all(set(r) == {"symbol", "mentions", "people"} for r in out["rows"])
    assert "secret words" not in json.dumps(out)


def test_buzz_empty_and_not_set_up(monkeypatch):
    _patch_buzz(monkeypatch, [{"ticker": "SPY", "people": 1, "mentions": 1}])
    assert nw.build("roomBuzzOnMyNames", "u1", {}, now=NOW)["empty"] == "The room hasn't mentioned your names today."
    calls = _patch_buzz(monkeypatch, _BOARD, channels=None)
    out = nw.build("roomBuzzOnMyNames", "u1", {}, now=NOW)
    assert out["empty"] == "Room buzz isn't set up yet." and out["rows"] == [] and calls == []


# -- wave 6: myEarningsReactions -----------------------------------------------------------

@pytest.fixture(autouse=True)
def _fresh_reported_window_cache():
    from api.services.cache import cache
    cache.delete_prefix("notebook_widgets_reported_window::")
    yield
    cache.delete_prefix("notebook_widgets_reported_window::")


def _patch_reactions(monkeypatch, window, years=None, timing=None, closes=None, sleep_s=0.0):
    import api.services.calendar_alerts as ca
    import api.services.earnings_estimates as ee
    import api.services.journal_two.earnings_prep as ep
    import api.services.bars_sqlite as bs
    seen = {"window": [], "year": []}

    def fake_window(today, days):
        seen["window"].append((today, days))
        return dict(window), False

    def fake_year(ticker, year, data_symbol=None, fresh=False):
        seen["year"].append((ticker, year))
        if sleep_s:
            time.sleep(sleep_s)
        return list((years or {}).get((ticker, year)) or [])

    def fake_bars(sym, tf, n):
        return [b for b in (closes or {}).get(sym, [])][-n:]

    monkeypatch.setattr(ca, "collect_earnings_window", fake_window)
    monkeypatch.setattr(ee, "get_year_earnings", fake_year)
    monkeypatch.setattr(ep, "_timing_from_calendar_cache", lambda sym, day: (timing or {}).get(sym))
    monkeypatch.setattr(bs, "get_bars", fake_bars)
    return seen


def _q(date, quarter, eps=1.1, eps_e=1.0, rev=5e9, rev_e=4.8e9):
    return {"date": date, "quarter": quarter, "year": 2026, "eps_actual": eps, "eps_estimate": eps_e,
            "revenue_actual": rev, "revenue_estimate": rev_e}


def test_earnings_reactions_rows(monkeypatch):
    _patch_names(monkeypatch, {"NVDA": ["watchlist"], "AMD": ["flagged"], "TSLA": ["positions"]})
    seen = _patch_reactions(
        monkeypatch,
        window={"NVDA": "2026-10-15", "AMD": "2026-10-14", "TSLA": "2026-10-27", "SPY": "2026-10-15"},
        years={("NVDA", 2026): [_q("2026-07-20", 2), _q("2026-10-15", 3)],
               ("AMD", 2026): [_q("2026-10-14", 3, eps=None, eps_e=0.9)]},
        timing={"NVDA": "amc", "AMD": "bmo"},
        closes={"NVDA": [(20261014, 0, 0, 0, 100.0, 0), (20261015, 0, 0, 0, 100.0, 0),
                         (20261016, 0, 0, 0, 108.0, 0)],
                "AMD": [(20261013, 0, 0, 0, 50.0, 0), (20261014, 0, 0, 0, 45.0, 0)]})
    out = nw.build("myEarningsReactions", "u1", {}, now=NOW)
    from datetime import date
    assert seen["window"] == [(date(2026, 10, 13), 7)]
    assert out["source"] == "market"
    assert out["rows"] == [
        {"symbol": "NVDA", "day": "2026-10-15", "epsActual": 1.1, "epsEst": 1.0, "revActual": 5e9,
         "revEst": 4.8e9, "nextDayPct": 8.0},
        {"symbol": "AMD", "day": "2026-10-14", "epsActual": None, "epsEst": 0.9, "revActual": 5e9,
         "revEst": 4.8e9, "nextDayPct": -10.0}]


def test_earnings_reactions_null_next_day_before_session(monkeypatch):
    _patch_names(monkeypatch, {"NVDA": ["watchlist"], "AMD": ["watchlist"]})
    _patch_reactions(
        monkeypatch, window={"NVDA": "2026-10-19", "AMD": "2026-10-20"},
        years={}, timing={"NVDA": "amc", "AMD": "bmo"},
        # NVDA reported Monday after the close; today's (Tuesday's) bar is still forming at 11:00 ET.
        closes={"NVDA": [(20261016, 0, 0, 0, 100.0, 0), (20261019, 0, 0, 0, 101.0, 0),
                         (20261020, 0, 0, 0, 107.0, 0)],
                "AMD": [(20261019, 0, 0, 0, 50.0, 0), (20261020, 0, 0, 0, 55.0, 0)]})
    rows = {r["symbol"]: r for r in nw.build("myEarningsReactions", "u1", {}, now=NOW)["rows"]}
    assert rows["NVDA"]["nextDayPct"] is None and rows["AMD"]["nextDayPct"] is None
    assert rows["NVDA"]["epsActual"] is None                     # no quarter found: null, never 0
    after_close = datetime(2026, 10, 20, 20, 30, tzinfo=timezone.utc)   # 16:30 EDT
    rows = {r["symbol"]: r for r in nw.build("myEarningsReactions", "u1", {}, now=after_close)["rows"]}
    assert rows["NVDA"]["nextDayPct"] == round((107.0 / 101.0 - 1) * 100, 2)
    assert rows["AMD"]["nextDayPct"] == 10.0


def test_earnings_reactions_cold_calls_are_bounded(monkeypatch):
    names = {f"N{i:02d}": ["watchlist"] for i in range(15)}
    _patch_names(monkeypatch, names)
    monkeypatch.setattr(nw, "REACTIONS_BUDGET_S", 0.3)
    _patch_reactions(monkeypatch, window={s: "2026-10-15" for s in names}, sleep_s=2.0)
    t0 = time.monotonic()
    out = nw.build("myEarningsReactions", "u1", {}, now=NOW)
    assert time.monotonic() - t0 < 1.5                          # one budget for the whole request
    assert len(out["rows"]) == 15 and out["partial"] is True
    assert all(r["epsActual"] is None for r in out["rows"])


def test_earnings_reactions_window_is_cached_and_empty_says_so(monkeypatch):
    _patch_names(monkeypatch, {"NVDA": ["watchlist"]})
    seen = _patch_reactions(monkeypatch, window={"SPY": "2026-10-15"})
    out = nw.build("myEarningsReactions", "u1", {}, now=NOW)
    nw.build("myEarningsReactions", "u2", {}, now=NOW)
    assert out["rows"] == [] and out["empty"] == nw.REACTIONS_EMPTY_SENTENCE
    assert len(seen["window"]) == 1


# -- final review I-4: one bounded pool; a saturated pool answers partial AT ONCE ------------------

def _saturate(monkeypatch):
    """A one-permit pool whose permit is held: every try_submit answers None."""
    pool = nw.BoundedPool(1, "nb-widget-full")
    assert pool._slots.acquire(blocking=False)
    monkeypatch.setattr(nw, "_POOL", pool)
    return pool


def test_no_builder_makes_a_pool_of_its_own():
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(nw))
    made = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call)
            and getattr(n.func, "id", getattr(n.func, "attr", None)) == "ThreadPoolExecutor"]
    assert len(made) == 1, made                                  # BoundedPool's, the one module-level pool
    assert isinstance(nw._POOL, nw.BoundedPool) and nw.WIDGET_POOL_WORKERS == 8


def test_bounded_pool_admits_up_to_its_workers_and_releases_on_done_and_on_cancel():
    import threading
    pool = nw.BoundedPool(2, "nb-widget-t")
    gate = threading.Event()
    a = pool.try_submit(gate.wait, 5)
    b = pool.try_submit(gate.wait, 5)
    assert a is not None and b is not None
    assert pool.try_submit(lambda: 1) is None                    # saturated: answered at once, never queued
    gate.set()
    a.result(2), b.result(2)
    time.sleep(0.05)
    c = pool.try_submit(lambda: 7)
    assert c is not None and c.result(2) == 7                    # permits come back when the work is done


def test_saturated_pool_names_reporting_answers_partial_at_once(monkeypatch):
    _saturate(monkeypatch)
    items = [{"symbol": s, "date": "2026-10-21", "daysAway": 1, "timing": "bmo", "sources": ["watchlist"]}
             for s in ("AAA", "BBB")]
    _patch_reporting(monkeypatch, items)
    # The window is cached (a cache hit needs no pool), so this exercises the implied-move reads; a
    # saturated pool on a window MISS is test_c1_a_saturated_pool_answers_the_card_at_once.
    from datetime import date
    import api.services.journal_two.earnings_prep as ep
    from api.services.cache import cache
    cache.set(ep.cache_key_for_window(date(2026, 10, 20)), {"window": {}, "partial": False, "asOf": "x"}, ttl=60)
    import api.services.earnings_enrichment as ee
    calls = []
    monkeypatch.setattr(ee, "get_implied_move", lambda *a, **k: calls.append(a) or {"pct": 5.0})
    t0 = time.monotonic()
    out = nw.build("myNamesReporting", "u1", {}, now=NOW)
    assert time.monotonic() - t0 < 0.5
    assert out["partial"] is True and calls == []
    assert [r["impliedMovePct"] for r in out["rows"]] == [None, None]


def test_saturated_pool_ticker_flow_answers_empty_at_once(monkeypatch):
    _saturate(monkeypatch)
    calls = []
    monkeypatch.setattr(nw, "_flow_read", lambda sym: calls.append(sym) or {"contracts": [1]})
    t0 = time.monotonic()
    out = nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)
    assert time.monotonic() - t0 < 0.5
    assert calls == [] and out["topPrints"] == []
    assert out["failed"] is True and out["empty"] == "Couldn't load options flow right now."


def test_saturated_pool_earnings_reactions_answer_partial_at_once(monkeypatch):
    _patch_names(monkeypatch, {"NVDA": ["watchlist"]})
    seen = _patch_reactions(monkeypatch, window={"NVDA": "2026-10-15"})
    _saturate(monkeypatch)
    t0 = time.monotonic()
    out = nw.build("myEarningsReactions", "u1", {}, now=NOW)
    assert time.monotonic() - t0 < 0.5
    assert out["partial"] is True and seen["window"] == []       # the calendar walk never ran


def test_saturated_pool_reaction_figures_are_null_and_partial(monkeypatch):
    _saturate(monkeypatch)
    figures, late = nw._reaction_figures([("NVDA", "2026-10-15")])
    assert late is True and figures == {"NVDA": dict(nw._NO_FIGURES)}


def test_a_request_with_more_names_than_its_share_still_gets_every_answer(monkeypatch):
    """The fan-out rolls: more names than `per_request` are answered as earlier ones finish, so a long list
    is NOT partial on an idle pool (the old per-request pool's behaviour)."""
    items = [{"symbol": f"S{i:02d}", "date": "2026-10-21", "daysAway": 1, "timing": "bmo",
              "sources": ["watchlist"]} for i in range(12)]
    _patch_reporting(monkeypatch, items)
    import api.services.earnings_enrichment as ee
    monkeypatch.setattr(ee, "get_implied_move", lambda *a, **k: {"pct": 2.0})
    out = nw.build("myNamesReporting", "u1", {}, now=NOW)
    assert out["partial"] is False and all(r["impliedMovePct"] == 2.0 for r in out["rows"])



# -- fix F1, C-1: the earnings-calendar walk is bounded, single-flighted and cached from the pool --------

def _patch_slow_walk(monkeypatch, *, walk_s, window=None):
    """The REAL earnings_prep._window over a slow calendar walk (it caches its own answer), with a count."""
    import threading
    import api.services.calendar_alerts as ca
    import api.services.journal_two.earnings_prep as ep
    seen = {"walks": 0}
    lock = threading.Lock()

    def fake_walk(start, days):
        with lock:
            seen["walks"] += 1
        time.sleep(walk_s)
        return dict(window or {"NVDA": "2026-10-22"}), False

    monkeypatch.setattr(ca, "collect_earnings_window", fake_walk)
    monkeypatch.setattr(ep, "_timing_from_calendar_cache", lambda sym, day: "amc")
    return seen


def _wait_walks_done(timeout=5.0):
    t0 = time.monotonic()
    while nw._WALKS.inflight() and time.monotonic() - t0 < timeout:
        time.sleep(0.02)
    assert nw._WALKS.inflight() == 0


def _card_seams(monkeypatch):
    import api.services.bars_sqlite as bs
    import api.services.earnings_enrichment as ee
    monkeypatch.setattr(bs, "get_bars", lambda ticker, tf, n: [])
    monkeypatch.setattr(ee, "get_implied_move", lambda sym, d=None, t=None: {"pct": 4.0})
    _patch_pnl(monkeypatch, _analytics(trade_count=0, days=[]), [])
    _patch_prices(monkeypatch, {})


def test_c1_concurrent_cold_cards_share_one_walk(monkeypatch):
    import threading
    _card_seams(monkeypatch)
    seen = _patch_slow_walk(monkeypatch, walk_s=0.4)
    outs, errs = [], []

    def one():
        try:
            outs.append(nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW))
        except Exception as e:  # noqa: BLE001
            errs.append(e)

    ts = [threading.Thread(target=one) for _ in range(24)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(10)
    _wait_walks_done()
    assert errs == [] and len(outs) == 24
    assert seen["walks"] == 1                                 # one shared walk, never one per request
    known = [o for o in outs if o["earningsDay"] == "2026-10-22"]
    unknown = [o for o in outs if o["earningsDay"] is None]
    assert known and len(known) + len(unknown) == 24
    assert len(known) <= nw.WALK_WAITERS                      # at most WALK_WAITERS requests waited
    assert all(o["earningsUnknown"] is True and o["partial"] is True for o in unknown)
    assert all(o["earningsUnknown"] is False and "partial" not in o for o in known)
    t0 = time.monotonic()
    after = nw.build("tickerCard", "u2", {"symbol": "NVDA"}, now=NOW)
    assert time.monotonic() - t0 < 0.2 and after["earningsDay"] == "2026-10-22" and seen["walks"] == 1


def test_c1_a_walk_past_its_budget_answers_partial_and_still_fills_the_cache(monkeypatch):
    _card_seams(monkeypatch)
    monkeypatch.setattr(nw, "EARNINGS_WINDOW_BUDGET_S", 0.1)
    seen = _patch_slow_walk(monkeypatch, walk_s=0.5)
    t0 = time.monotonic()
    first = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert time.monotonic() - t0 < 0.4                       # the request never waits for the straggler
    assert first["earningsDay"] is None and first["earningsUnknown"] is True and first["partial"] is True
    _wait_walks_done()
    second = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert second["earningsDay"] == "2026-10-22" and second["earningsUnknown"] is False
    assert seen["walks"] == 1                                 # the straggler's own answer was cached


def test_c1_names_reporting_and_watchlist_answer_partial_when_the_window_is_late(monkeypatch):
    _patch_sets(monkeypatch, watchlist=["NVDA", "AMD"])
    _patch_prices(monkeypatch, {"NVDA": {"price": 1.0, "change_pct": 0.5}})
    monkeypatch.setattr(nw, "EARNINGS_WINDOW_BUDGET_S", 0.05)
    _patch_slow_walk(monkeypatch, walk_s=0.4)
    names = nw.build("myNamesReporting", "u1", {}, now=NOW)
    assert names["rows"] == [] and names["partial"] is True and names["earningsUnknown"] is True
    assert "empty" not in names                               # never "none of your names report"
    watch = nw.build("myWatchlistToday", "u1", {}, now=NOW)
    assert [r["earningsDay"] for r in watch["rows"]] == [None, None]
    assert watch["earningsUnknown"] is True and watch["partial"] is True
    assert watch["rows"][1]["price"] == 1.0                  # the rest of the widget still answers
    _wait_walks_done()
    watch = nw.build("myWatchlistToday", "u1", {}, now=NOW)  # warmed by the late walk
    assert watch["earningsUnknown"] is False and "partial" not in watch
    assert {r["symbol"]: r["earningsDay"] for r in watch["rows"]} == {"AMD": None, "NVDA": "2026-10-22"}


def test_c1_a_saturated_pool_answers_the_card_at_once(monkeypatch):
    _card_seams(monkeypatch)
    seen = _patch_slow_walk(monkeypatch, walk_s=5.0)
    _saturate(monkeypatch)
    t0 = time.monotonic()
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert time.monotonic() - t0 < 0.3 and seen["walks"] == 0
    assert out["earningsUnknown"] is True and out["partial"] is True and out["price"] is None


def test_c1_the_builders_never_walk_on_the_request_thread(monkeypatch):
    """Each wave-1 builder that needs the window reads it through _earnings_window (bounded), never by
    calling earnings_prep._window or reporting_soon without the window it already read."""
    import ast
    import inspect
    src = inspect.getsource(nw)
    tree = ast.parse(src)
    for fn in ("_ticker_card", "_my_watchlist_today", "_my_names_reporting"):
        node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == fn)
        calls = [c for c in ast.walk(node) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)]
        assert not [c for c in calls if c.func.attr == "_window"], fn
        for c in calls:
            if c.func.attr == "reporting_soon":
                assert "window_read" in {k.arg for k in c.keywords}, fn
        assert any(isinstance(c, ast.Call) and getattr(c.func, "id", None) == "_earnings_window"
                   for c in ast.walk(node)), fn


# -- fix F1, I-1: a reactions walk past its budget is still cached ------------------------------------

def test_i1_a_slow_reactions_walk_is_cached_for_the_next_request(monkeypatch):
    _patch_names(monkeypatch, {"NVDA": ["watchlist"]})
    monkeypatch.setattr(nw, "REACTIONS_WINDOW_BUDGET_S", 0.1)
    seen = _patch_reactions(monkeypatch, window={"NVDA": "2026-10-15"})
    import api.services.calendar_alerts as ca
    fast = ca.collect_earnings_window

    def slow(today, days):
        time.sleep(0.5)
        return fast(today, days)

    monkeypatch.setattr(ca, "collect_earnings_window", slow)
    t0 = time.monotonic()
    first = nw.build("myEarningsReactions", "u1", {}, now=NOW)
    assert time.monotonic() - t0 < 0.4
    assert first["rows"] == [] and first["partial"] is True
    _wait_walks_done()
    t0 = time.monotonic()
    second = nw.build("myEarningsReactions", "u2", {}, now=NOW)
    assert time.monotonic() - t0 < 0.3                        # a cache hit, not another 0.5 s walk
    assert [r["symbol"] for r in second["rows"]] == ["NVDA"] and second["partial"] is False
    assert len(seen["window"]) == 1                           # the straggler's answer was kept


def test_i1_concurrent_reactions_misses_share_one_walk(monkeypatch):
    import threading
    _patch_names(monkeypatch, {"NVDA": ["watchlist"]})
    seen = _patch_reactions(monkeypatch, window={"NVDA": "2026-10-15"})
    import api.services.calendar_alerts as ca
    fast = ca.collect_earnings_window
    monkeypatch.setattr(ca, "collect_earnings_window", lambda t, d: (time.sleep(0.3), fast(t, d))[1])
    ts = [threading.Thread(target=nw.build, args=("myEarningsReactions", f"u{i}", {}), kwargs={"now": NOW})
          for i in range(12)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(10)
    _wait_walks_done()
    assert len(seen["window"]) == 1


# -- fix F1, I-2: the 16,384 B cap holds across EVERY field (the audit's oversized fixtures) ----------

def _bytes(p):
    return len(json.dumps(p, separators=(",", ":")).encode("utf-8"))


def test_i2_every_kind_but_the_card_names_its_trimmable_list():
    assert set(nw.LIST_KEY) | {"tickerCard"} == set(nw.KIND_WAVE)


def test_i2_rules_check_with_long_labels_fits_and_labels_are_clipped(monkeypatch):
    long = "x" * 1500
    setup_rules = {"acc": {"Breakout": [{"id": f"r{i}", "label": f"{long}{i}"} for i in range(25)],
                           "Pullback": [{"id": f"q{i}", "label": f"{long}q{i}"} for i in range(25)]}}
    trades = [{"tradeRef": f"t{i}", "positionId": None, "accountId": "acc",
               "setup": "Breakout" if i % 2 else "Pullback", "source": "manual", "exitDate": "2026-10-19"}
              for i in range(5000)]
    adh = {f"t{i}": {"checkedRuleIds": [f"r{j}" for j in range(10)], "totalRules": 25,
                     "setup": trades[i]["setup"]} for i in range(5000)}
    _patch_rules(monkeypatch, trades, adh, setup_rules=setup_rules)
    import api.services.journal_two.trader_blocks as tbk
    monkeypatch.setattr(tbk, "adherence_of_trade", lambda get, ref, pid: get(ref))
    p = nw.build("myRulesCheck", "big", {}, now=NOW)
    assert _bytes(p) <= nw.PAYLOAD_CAP_BYTES                 # the audit measured 38,555 B
    assert p["rules"] and all(len(r["rule"]) <= nw.RULE_LABEL_MAX for r in p["rules"])
    assert p["rules"][0]["rule"].endswith("…")


def test_i2_trade_recap_with_400_long_mistakes_fits(monkeypatch):
    from datetime import date, timedelta
    tags = [f"mistake-{i}-" + "m" * 60 for i in range(400)]
    _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade(
        entryDate="2026-01-02", exitDate="2026-09-30", mistakeTags=tags)))
    bars = [(int((date(2025, 11, 1) + timedelta(days=i)).strftime("%Y%m%d")), 1.123456, 2.123456, 0.123456,
             1.523456) for i in range(400)]
    _patch_bars_before(monkeypatch, bars)
    p = nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)
    assert _bytes(p) <= nw.PAYLOAD_CAP_BYTES                 # the audit measured 38,644 B
    assert len(p["mistakes"]) == nw.MISTAKES_MAX and p["mistakesTruncated"] == 400 - nw.MISTAKES_MAX
    assert all(len(m) <= nw.MISTAKE_TAG_MAX for m in p["mistakes"])
    assert p["bars"] and "tooLarge" not in p


def test_i2_a_non_row_field_over_the_cap_gives_the_too_large_form_never_silently_empty():
    big = {"asOf": "x", "source": "market", "listLabel": "y" * 20000, "rows": [{"a": 1}] * 5}
    out = nw.cap_payload(big, "myWatchlistToday")
    assert _bytes(out) <= nw.PAYLOAD_CAP_BYTES               # the audit measured 20,069 B with no sentence
    assert out["tooLarge"] is True and out["empty"] == nw.TOO_LARGE_SENTENCE
    assert out["empty"] == "This widget's data was too large to save. Narrow it and try again."
    assert "rows" not in out and "listLabel" not in out and out["asOf"] == "x" and out["source"] == "market"
    # and without the kind, the same answer
    assert nw.cap_payload(big)["tooLarge"] is True


def test_i2_a_list_under_another_key_is_trimmed_and_counted():
    out = nw.cap_payload({"asOf": "x", "source": "market", "rules": [{"rule": "z" * 1000}] * 400})
    assert _bytes(out) <= nw.PAYLOAD_CAP_BYTES               # the audit measured 40,520 B
    assert out["rules"] and len(out["rules"]) + out["truncated"] == 400 and "tooLarge" not in out
    flow = {"asOf": "x", "source": "market", "topPrints": [{"cp": "C" * 3000}] * 10}
    out = nw.cap_payload(flow, "tickerFlow")
    assert _bytes(out) <= nw.PAYLOAD_CAP_BYTES and len(out["topPrints"]) + out["truncated"] == 10


def test_i2_one_item_too_big_alone_is_the_too_large_form():
    out = nw.cap_payload({"asOf": "x", "source": "market", "rows": [{"blob": "q" * 20000}]}, "myMistakes")
    assert out["tooLarge"] is True and _bytes(out) <= nw.PAYLOAD_CAP_BYTES


def test_i2_a_boolean_truncated_stays_true():
    hits = [{"symbol": "S" * 5, "pad": "p" * 1000} for _ in range(40)]
    out = nw.cap_payload({"asOf": "x", "source": "market", "hits": hits, "truncated": True}, "myScreenToday")
    assert out["truncated"] is True and _bytes(out) <= nw.PAYLOAD_CAP_BYTES and len(out["hits"]) < 40


def test_i2_the_card_over_the_cap_is_the_too_large_form():
    out = nw.cap_payload({"asOf": "x", "source": "mixed", "symbol": "NVDA", "pad": "p" * 20000}, "tickerCard")
    assert out == {"asOf": "x", "source": "mixed", "symbol": "NVDA", "tooLarge": True,
                   "empty": nw.TOO_LARGE_SENTENCE}


# -- fix F1, I-3: an unknown report time is never read as after the close ---------------------------

def test_i3_unknown_timing_shows_no_reaction_and_says_why(monkeypatch):
    _patch_names(monkeypatch, {"BMO": ["watchlist"], "KNOWN": ["watchlist"]})
    # BMO reported Thursday before the open (+10.0% that day) and drifted +0.91% Friday. With the time
    # unknown the old code read Friday's 0.91 as the reaction.
    bars = [(20261014, 0, 0, 0, 100.0, 0), (20261015, 0, 0, 0, 110.0, 0), (20261016, 0, 0, 0, 111.0, 0)]
    _patch_reactions(monkeypatch, window={"BMO": "2026-10-15", "KNOWN": "2026-10-15"},
                     timing={"KNOWN": "bmo"}, closes={"BMO": bars, "KNOWN": bars})
    rows = {r["symbol"]: r for r in nw.build("myEarningsReactions", "u1", {}, now=NOW)["rows"]}
    assert rows["BMO"]["nextDayPct"] is None and rows["BMO"]["timingUnknown"] is True
    assert rows["BMO"]["nextDayNote"] == "Report time unknown, so the reaction isn't shown."
    assert rows["KNOWN"]["nextDayPct"] == 10.0
    assert "timingUnknown" not in rows["KNOWN"] and "nextDayNote" not in rows["KNOWN"]
    assert nw._next_day_pct("BMO", "2026-10-15", None, NOW) is None


# -- fix F1, I-5: open option strategies are rows; never "No open positions." while one is open ------

def _strategy(**over):
    s = {"id": "st-1", "underlying": "CRWV", "strategyType": "long_call", "netEntry": 1200.0,
         "brokerCurrentValue": 1500.0, "source": "broker", "status": "open",
         "legs": [{"side": "buy", "contractType": "call", "strike": 110.0, "expiration": "2026-10-16",
                   "qty": 2, "entryPrice": 6.0}]}
    s.update(over)
    return s


def test_i5_an_open_option_alone_is_a_row_and_never_no_open_positions(monkeypatch):
    _patch_positions(monkeypatch, [], [], strategies=[_strategy()])
    _patch_prices(monkeypatch, {})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert "empty" not in out
    assert out["rows"] == [{"positionId": None, "symbol": "CRWV Oct 16 $110C", "side": "Long Call",
                            "kind": "option", "sizePct": 3.0, "openPnl": 300.0, "stopPrice": None,
                            "distToStopPct": None, "noStop": None}]
    assert out["source"] == "broker"


def test_i5_stock_and_option_rows_together_and_labels_match_the_table(monkeypatch):
    vertical = _strategy(id="st-2", underlying="NVDA", strategyType="vertical_credit_call", netEntry=-300.0,
                         brokerCurrentValue=-120.0, source="manual",
                         legs=[{"side": "sell", "contractType": "call", "strike": 550.0, "expiration": "2026-06-20",
                                "qty": 1, "entryPrice": 5.0},
                               {"side": "buy", "contractType": "call", "strike": 560.5, "expiration": "2026-06-20",
                                "qty": 1, "entryPrice": 2.0}])
    short_put = _strategy(id="st-3", strategyType="short_put", netEntry=-400.0, brokerCurrentValue=None,
                          legs=[{"side": "sell", "contractType": "put", "strike": 95.5, "expiration": "2026-11-06",
                                 "qty": 1, "entryPrice": 4.0}])
    _patch_positions(monkeypatch, [_pos()], [_heat_row()], strategies=[vertical, short_put])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    rows = nw.build("myPositionsRisk", "u1", {}, now=NOW)["rows"]
    assert [r["kind"] for r in rows] == ["stock", "option", "option"]
    assert (rows[1]["symbol"], rows[1]["side"]) == ("NVDA 550/560.5 Call Credit Spread Jun 20", "Short")
    assert rows[1]["openPnl"] == 180.0 and rows[1]["sizePct"] == 0.24
    assert (rows[2]["symbol"], rows[2]["side"]) == ("CRWV Nov 6 $95.5P", "Short Put")
    assert rows[2]["openPnl"] is None and rows[2]["sizePct"] is None   # no stored mark: unknown, never 0


def test_i5_options_share_the_row_cap(monkeypatch):
    positions = [_pos(sym=f"S{i:02d}", pid=f"p{i}") for i in range(38)]
    strategies = [_strategy(id=f"st{i}") for i in range(5)]
    _patch_positions(monkeypatch, positions, [], strategies=strategies)
    _patch_prices(monkeypatch, {})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert len(out["rows"]) == nw.ROW_CAP and out["truncated"] == 3
    assert [r["kind"] for r in out["rows"]].count("option") == 2


# -- fix F1, I-6: after the close a broker position is valued at the broker's mark; priceBasis says so --

SUNDAY = datetime(2026, 10, 18, 15, 0, tzinfo=timezone.utc)          # closed; last closed session Fri 10-16
SYNCED_AFTER_FRIDAY_CLOSE = "2026-10-16T21:05:00Z"                   # 17:05 ET, after that close


def _patch_accounts(monkeypatch, synced_at=SYNCED_AFTER_FRIDAY_CLOSE):
    import api.services.journal_two.accounts as ac
    monkeypatch.setattr(ac, "list_accounts", lambda user_id, *a, **k: [
        {"id": "a1", "brokerBalanceSyncedAt": synced_at}])


def _broker_pos(**over):
    p = {**_pos(source="broker"), "accountId": "a1", "brokerPrice": 108.0}
    p.update(over)
    return p


def test_i6_after_the_close_the_broker_mark_wins(monkeypatch):
    _patch_positions(monkeypatch, [_broker_pos()], [_heat_row()])
    _patch_accounts(monkeypatch)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=SUNDAY)
    assert out["rows"][0]["openPnl"] == 80.0 and out["rows"][0]["sizePct"] == 2.16
    assert out["priceBasis"] == "broker"


def test_i6_before_the_close_the_live_price_wins(monkeypatch):
    _patch_positions(monkeypatch, [_broker_pos()], [_heat_row()])
    _patch_accounts(monkeypatch)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)                  # Tuesday 11:00 ET
    assert out["rows"][0]["openPnl"] == 100.0 and out["priceBasis"] == "live"


def test_i6_a_stale_sync_keeps_live_prices_even_after_the_close(monkeypatch):
    """prefer_broker_marks' second condition: marks synced BEFORE the last close are a day stale."""
    _patch_positions(monkeypatch, [_broker_pos()], [_heat_row()])
    _patch_accounts(monkeypatch, synced_at="2026-10-16T07:40:00Z")      # 03:40 ET Friday, pre-close
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    out = nw.build("myPositionsRisk", "u1", {}, now=SUNDAY)
    assert out["rows"][0]["openPnl"] == 100.0 and out["priceBasis"] == "live"


def test_i6_no_live_price_falls_back_to_the_broker_mark_and_mixed_is_named(monkeypatch):
    _patch_positions(monkeypatch, [_broker_pos(), _pos(sym="AMD", pid="p2")],
                     [_heat_row(), _heat_row(sym="AMD")])
    _patch_accounts(monkeypatch)
    _patch_prices(monkeypatch, {"AMD": {"price": 101.0}})               # no live NVDA quote intraday
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    rows = {r["symbol"]: r for r in out["rows"]}
    assert rows["NVDA"]["openPnl"] == 80.0 and rows["AMD"]["openPnl"] == 10.0
    assert out["priceBasis"] == "mixed"


def test_i6_nothing_priced_has_no_basis_and_options_count_as_broker(monkeypatch):
    _patch_positions(monkeypatch, [_pos()], [_heat_row()])
    _patch_prices(monkeypatch, {})
    assert nw.build("myPositionsRisk", "u1", {}, now=NOW)["priceBasis"] is None
    _patch_positions(monkeypatch, [_pos()], [_heat_row()], strategies=[_strategy()])
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    assert nw.build("myPositionsRisk", "u1", {}, now=NOW)["priceBasis"] == "mixed"


# -- ruling R60: every request regex is a fullmatch (no trailing newline) -----------------------------

def test_r60_a_trailing_newline_is_refused_by_every_request_regex(monkeypatch):
    _card_seams(monkeypatch)
    _patch_flow(monkeypatch, None)
    calls = _patch_trade(monkeypatch, owned=(("u1", "t-1"), _recap_trade()))
    for kind, params in (("tickerCard", {"symbol": "AAPL\n"}), ("tickerFlow", {"symbol": "AAPL\n"}),
                         ("myPnlCalendar", {"month": "2026-10\n"}), ("tradeRecap", {"tradeId": "t-1\n"}),
                         ("myScreenToday", {"definitionId": "u_0123456789ab\n"})):
        with pytest.raises(nw.WidgetRequestError):
            nw.build(kind, "u1", params, now=NOW)
    assert calls == []                                       # the malformed id never reached the read
    # control: the same values without the newline are accepted
    assert nw.build("tickerCard", "u1", {"symbol": "AAPL"}, now=NOW)["symbol"] == "AAPL"
    assert nw.build("tradeRecap", "u1", {"tradeId": "t-1"}, now=NOW)["symbol"] == "NVDA"


def test_r60_no_request_regex_is_used_with_match():
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(nw))
    bad = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
           and n.func.attr in ("match", "search") and getattr(n.func.value, "id", "").endswith("_RE")]
    assert bad == []


# -- ruling R60: a date outside 1990-01-01 .. today + 1 year is a 400 sentence, never a 500 ----------

def test_r60_out_of_range_dates_are_a_request_error(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(), [])
    _patch_rules(monkeypatch, [], {})
    for kind in ("myPnlStats", "myRulesCheck"):
        for key in ("from", "to"):
            for bad in ("0001-01-01", "9999-12-31", "1989-12-31", "2027-10-21"):
                params = {"from": "2026-10-01", "to": "2026-10-20", key: bad}
                with pytest.raises(nw.WidgetRequestError, match="between 1990-01-01 and 2027-10-20"):
                    nw.build(kind, "u1", params, now=NOW)
        # control: the bounds themselves are inside
        nw.build(kind, "u1", {"from": "1990-01-01", "to": "2027-10-20"}, now=NOW)
    for bad in ("0001-01", "9999-12", "1989-12", "2027-11"):
        with pytest.raises(nw.WidgetRequestError, match="month must be between 1990-01 and 2027-10"):
            nw.build("myPnlCalendar", "u1", {"month": bad}, now=NOW)


def test_r60_out_of_range_dates_answer_400_through_the_route(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import api.routers.notebook_widgets as nwr
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.limiter import limiter
    limiter.reset()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W1_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W6_ENABLED", "1")
    app = FastAPI()
    app.include_router(nwr.router)
    user = {"id": "u1", "email": "u1@x.test", "role": "member", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    client = TestClient(app, raise_server_exceptions=False)
    for url in ("myPnlStats?from=0001-01-01", "myPnlStats?to=9999-12-31", "myPnlStats?to=0001-01-01",
                "myPnlCalendar?month=9999-12"):
        r = client.get("/api/j2/notebook-widgets/" + url)
        assert r.status_code == 400, (url, r.status_code, r.text)
        assert "between" in r.json()["detail"]
    limiter.reset()


# -- UX audit I-4 (R58): "none this week" and "could not be read" are two different payloads --------

def test_ux_i4_none_this_week_versus_unknown(monkeypatch):
    _card_seams(monkeypatch)
    import api.services.journal_two.earnings_prep as ep
    monkeypatch.setattr(ep, "_window", lambda today: ({"AMD": "2026-10-22"}, {}, False, "x"))
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["earningsDay"] is None and out["earningsUnknown"] is False         # read: none this week
    monkeypatch.setattr(nw, "_WALKS", nw.SingleFlight(nw.WALK_WAITERS))
    from api.services.cache import cache
    cache.delete_prefix("notebook_earnings_prep_window::")
    monkeypatch.setattr(ep, "_window", lambda today: (_ for _ in ()).throw(RuntimeError("calendar down")))
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["earningsDay"] is None and out["earningsUnknown"] is True          # not read: unknown
    # a PARTIAL walk (a day it could not read) with no date for the name is unknown too
    monkeypatch.setattr(ep, "_window", lambda today: ({"AMD": "2026-10-22"}, {}, True, "x"))
    out = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert out["earningsUnknown"] is True


def test_m1_partial_follows_earnings_unknown_on_the_card_and_the_watchlist(monkeypatch):
    """Fix F1b (review M-1): ONE rule. A window with a day it could not read and no date for the name sets
    `partial` on tickerCard exactly as it does on myWatchlistToday; a full window sets it on neither."""
    _card_seams(monkeypatch)
    _patch_sets(monkeypatch, watchlist=["NVDA"])
    import api.services.journal_two.earnings_prep as ep
    from api.services.cache import cache
    for window_partial in (True, False):
        monkeypatch.setattr(nw, "_WALKS", nw.SingleFlight(nw.WALK_WAITERS))
        cache.delete_prefix("notebook_earnings_prep_window::")
        monkeypatch.setattr(ep, "_window", lambda today, p=window_partial: ({"AMD": "2026-10-22"}, {}, p, "x"))
        card = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
        watch = nw.build("myWatchlistToday", "u1", {}, now=NOW)
        assert card["earningsUnknown"] is watch["earningsUnknown"] is window_partial
        assert ("partial" in card) is ("partial" in watch) is window_partial, (window_partial, card, watch)
        assert card.get("partial") is watch.get("partial")
    # a date the partial walk DID read is known, so the card is not partial (a different name's day failed)
    monkeypatch.setattr(ep, "_window", lambda today: ({"NVDA": "2026-10-22"}, {}, True, "x"))
    cache.delete_prefix("notebook_earnings_prep_window::")
    card = nw.build("tickerCard", "u1", {"symbol": "NVDA"}, now=NOW)
    assert card["earningsUnknown"] is False and "partial" not in card


# -- UX audit I-6 / I-7 (R58): every payload says where its data came from --------------------------

def test_ux_i6_every_kind_has_a_plain_source_sentence():
    for kind in nw.KIND_WAVE:
        for src in ("broker", "manual", "mixed", "market"):
            got = nw.source_detail(kind, {"source": src, "priceBasis": "live"})
            assert isinstance(got, str) and got.endswith(".") and got.strip() == got, (kind, src)
            assert "  " not in got and "\n" not in got, (kind, src)


def test_ux_i6_positions_source_names_the_broker_and_the_price_it_used(monkeypatch):
    _patch_positions(monkeypatch, [_broker_pos()], [_heat_row()])
    _patch_accounts(monkeypatch)
    _patch_prices(monkeypatch, {"NVDA": {"price": 110.0}})
    intraday = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert intraday["sourceDetail"] == ("Positions: your linked broker. "
                                        "Open P&L and size: live market data, delayed.")
    closed = nw.build("myPositionsRisk", "u1", {}, now=SUNDAY)
    assert closed["sourceDetail"] == "Positions: your linked broker. Open P&L and size: your broker's marks."
    _patch_positions(monkeypatch, [_pos()], [_heat_row()])
    _patch_prices(monkeypatch, {})
    unpriced = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert unpriced["sourceDetail"] == "Positions: your manual entries."   # nothing priced: no price claim


def test_m9_an_empty_positions_widget_names_no_source(monkeypatch):
    """Fix F1b (review M-9): nothing open means no sourceDetail at all (null), never "Positions: your manual
    entries." for a list that holds nothing. An open option strategy alone is not empty and keeps its line."""
    _patch_positions(monkeypatch, [], [])
    _patch_prices(monkeypatch, {})
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert out["empty"] == "No open positions." and out["sourceDetail"] is None
    _patch_positions(monkeypatch, [], [], strategies=[_strategy()])
    out = nw.build("myPositionsRisk", "u1", {}, now=NOW)
    assert "empty" not in out
    assert out["sourceDetail"] == "Positions: your linked broker. Open P&L and size: your broker's marks."


def test_ux_i6_pnl_stats_names_where_the_fills_came_from(monkeypatch):
    _patch_pnl(monkeypatch, _analytics(), [{"source": "broker"}, {"source": None}])
    out = nw.build("myPnlStats", "u1", {}, now=NOW)
    assert out["source"] == "mixed"
    assert out["sourceDetail"] == "Your trades in the Journal. Fills: your linked broker and your manual entries."


def test_ux_i6_ticker_flow_names_the_tape(monkeypatch):
    _patch_flow(monkeypatch, _flow_payload([]))
    assert nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)["sourceDetail"] == "Options flow: UCT options tape."
    _patch_flow(monkeypatch, None)                                       # failed reads still say the source
    assert nw.build("tickerFlow", "u1", {"symbol": "NVDA"}, now=NOW)["sourceDetail"] == "Options flow: UCT options tape."
