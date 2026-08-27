"""Live option marks (broker/option_marks.py) — Massive-daily-agg pricing for
open broker strategies, the between-syncs freshness rail for net-liq + Today.

Every dollar expectation is hand-worked and asserted exactly. The multiplier
is DERIVED from the strategy's own stored net_entry — never a second
implementation of the mini-option rule (this repo's most-repeated defect)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import option_marks as om
from api.services.journal_two.broker import option_reconstruct as oro


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    om._reset_cache_for_tests()
    # No network in tests: the snapshot path is OFF unless a test opts in.
    monkeypatch.setattr(om.massive, "get_option_snapshot", lambda u, o: None)
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"j2": acct["id"]}


def _insert_strategy(env, *, ext, qty, entry_price, entry_date,
                     underlying="BA", strike=250.0, expiration="2027-01-15",
                     contract_type="call", side="buy", user="u1"):
    conn = auth_db.get_connection()
    try:
        stype = oro._strategy_type(side, contract_type)
        s = {
            "underlying": underlying, "strike": strike, "expiration": expiration,
            "contractType": contract_type, "side": side, "strategy_type": stype,
            "direction": oro._direction(stype), "qty": qty,
            "entry_price": entry_price, "entry_date": entry_date,
            "entry_fee": 0.0, "exit_price": None, "closed_at": None,
            "status": "open",
        }
        conn.execute("BEGIN")
        oro._insert_strategy(conn, user, env["j2"], s, ext)
        conn.commit()
        return conn.execute(
            "SELECT id FROM j2_option_strategies WHERE user_id = ? AND external_id = ?",
            (user, ext),
        ).fetchone()["id"]
    finally:
        conn.close()


def _bar(iso_date: str, close: float) -> dict:
    ts = datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc)
    return {"t": int(ts.timestamp() * 1000), "c": close}


def test_derived_multiplier_recovers_standard_and_mini():
    # standard: net_entry 3450 = 3 × 11.50 × 100
    assert om._derived_multiplier(3450.0, 3, 11.5) == 100.0
    # mini: net_entry 165 = 3 × 5.50 × 10
    assert om._derived_multiplier(165.0, 3, 5.5) == 10.0
    # short credit (negative net_entry): sign stripped
    assert om._derived_multiplier(-500.0, 1, 5.0) == 100.0
    # degenerate inputs fall back to the standard contract
    assert om._derived_multiplier(None, 3, 11.5) == 100.0
    assert om._derived_multiplier(3450.0, 0, 11.5) == 100.0


def test_marks_are_signed_totals_with_a_prev_close_baseline(env, monkeypatch):
    """Hand-worked: 3 BA calls @ entry 11.50 (net_entry 3450 → mult 100).
    Yesterday closed 7.70, today trades at 7.00:
      currentValue   = +3 × 7.00 × 100 = 2100.00
      prevCloseValue = +3 × 7.70 × 100 = 2310.00
      day move       = −210.00 (the option decay Robinhood counts and the
                       sync-time brokerCurrentValue cannot see)."""
    sid = _insert_strategy(env, ext="bkopt:ba", qty=3, entry_price=11.5,
                           entry_date="2026-08-17T19:01:49Z")
    today = datetime.now(om._ET).date().isoformat()
    yesterday_ord = datetime.now(om._ET).date().toordinal() - 1
    from datetime import date as _date
    yesterday = _date.fromordinal(yesterday_ord).isoformat()
    monkeypatch.setattr(
        om.massive, "get_daily_agg",
        lambda *a, **k: [_bar(yesterday, 7.70), _bar(today, 7.00)],
    )

    marks = om.get_option_marks("u1")

    assert marks[sid]["mark"] == 7.00
    assert marks[sid]["prevClose"] == 7.70
    assert marks[sid]["currentValue"] == 2100.00
    assert marks[sid]["prevCloseValue"] == 2310.00
    assert marks[sid]["entryEstimated"] is False


def test_no_trade_today_reports_zero_day_move_not_a_fabrication(env, monkeypatch):
    sid = _insert_strategy(env, ext="bkopt:ba2", qty=3, entry_price=11.5,
                           entry_date="2026-08-17T19:01:49Z")
    from datetime import date as _date
    stale = _date.fromordinal(datetime.now(om._ET).date().toordinal() - 3).isoformat()
    monkeypatch.setattr(om.massive, "get_daily_agg",
                        lambda *a, **k: [_bar(stale, 7.70)])

    marks = om.get_option_marks("u1")

    assert marks[sid]["currentValue"] == marks[sid]["prevCloseValue"] == 2310.00


def test_short_strategy_values_are_negative(env, monkeypatch):
    sid = _insert_strategy(env, ext="bkopt:short", qty=1, entry_price=5.0,
                           side="sell", entry_date="2026-08-17T19:01:49Z")
    today = datetime.now(om._ET).date().isoformat()
    monkeypatch.setattr(om.massive, "get_daily_agg",
                        lambda *a, **k: [_bar(today, 3.0)])

    marks = om.get_option_marks("u1")

    assert marks[sid]["currentValue"] == -300.00


def test_carried_in_strategies_are_flagged_entry_estimated(env, monkeypatch):
    sid = _insert_strategy(env, ext="bkoptpos:acct:BA:250.0:2027-01-15:call:buy",
                           qty=3, entry_price=11.5,
                           entry_date="2026-08-20T21:07:37Z")
    today = datetime.now(om._ET).date().isoformat()
    monkeypatch.setattr(om.massive, "get_daily_agg",
                        lambda *a, **k: [_bar(today, 7.0)])

    marks = om.get_option_marks("u1")

    assert marks[sid]["entryEstimated"] is True


def test_no_bars_omits_the_strategy_never_zeroes_it(env, monkeypatch):
    _insert_strategy(env, ext="bkopt:dead", qty=3, entry_price=11.5,
                     entry_date="2026-08-17T19:01:49Z")
    monkeypatch.setattr(om.massive, "get_daily_agg", lambda *a, **k: [])

    assert om.get_option_marks("u1") == {}


def test_route_is_mounted():
    """The endpoint exists on the broker router (probe derived from
    router.routes, never a grep)."""
    from api.routers import broker_sync as router_mod
    paths = {r.path for r in router_mod.router.routes}
    assert "/api/j2/broker/option-marks" in paths
    # control: a sibling the probe is not looking for is also visible
    assert "/api/j2/broker/trust" in paths


# ── real-time snapshot path (preferred over daily aggs) ─────────────────────

def _snap(*, bid=0, ask=0, mid=0, day_close=0, prev_close=0, last_trade=0):
    return {
        "last_quote": {"bid": bid, "ask": ask, "midpoint": mid},
        "day": {"close": day_close, "previous_close": prev_close},
        "last_trade": {"price": last_trade},
    }


def test_snapshot_midpoint_is_the_preferred_mark(env, monkeypatch):
    """Live NBBO midpoint = the mark brokers display. 3 contracts × mid 7.10
    × 100 = 2130; day baseline from the session's own previous_close 9.03."""
    sid = _insert_strategy(env, ext="bkopt:snap1", qty=3, entry_price=11.5,
                           entry_date="2026-08-17T19:01:49Z")
    monkeypatch.setattr(om.massive, "get_option_snapshot",
                        lambda u, o: _snap(bid=7.0, ask=7.2, mid=7.10,
                                           day_close=7.0, prev_close=9.03))
    marks = om.get_option_marks("u1")
    assert marks[sid]["mark"] == 7.10
    assert marks[sid]["prevClose"] == 9.03
    assert marks[sid]["currentValue"] == 2130.00
    assert marks[sid]["prevCloseValue"] == 2709.00
    assert marks[sid]["source"] == "snapshot"


def test_zeroed_overnight_book_never_marks_at_zero(env, monkeypatch):
    """Overnight the NBBO is zeroed (bid=ask=mid=0, verified live 8/21) —
    midpoint must be ignored and the session close used instead."""
    sid = _insert_strategy(env, ext="bkopt:snap2", qty=3, entry_price=11.5,
                           entry_date="2026-08-17T19:01:49Z")
    monkeypatch.setattr(om.massive, "get_option_snapshot",
                        lambda u, o: _snap(day_close=7.0, prev_close=9.03))
    marks = om.get_option_marks("u1")
    assert marks[sid]["mark"] == 7.0
    assert marks[sid]["currentValue"] == 2100.00
    assert marks[sid]["prevCloseValue"] == 2709.00


def test_snapshot_failure_falls_back_to_daily_aggs(env, monkeypatch):
    sid = _insert_strategy(env, ext="bkopt:snap3", qty=3, entry_price=11.5,
                           entry_date="2026-08-17T19:01:49Z")
    monkeypatch.setattr(om.massive, "get_option_snapshot", lambda u, o: None)
    today = datetime.now(om._ET).date().isoformat()
    monkeypatch.setattr(om.massive, "get_daily_agg",
                        lambda *a, **k: [_bar(today, 7.0)])
    marks = om.get_option_marks("u1")
    assert marks[sid]["currentValue"] == 2100.00
    assert marks[sid]["source"] == "aggs"


def test_a_multi_leg_strategy_is_omitted_never_last_leg_priced(tmp_path, monkeypatch):
    """The per-leg loop keyed out[id] — a multi-leg strategy's value silently
    became its LAST leg's (a debit spread priced as its long leg with no
    short offset). Multi-leg rows are now skipped wholesale; the frontend
    falls back to the correctly-netted brokerCurrentValue."""
    from api.services import auth_db as _adb
    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.broker import option_marks as om
    monkeypatch.setattr(_adb, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = _adb.get_connection()
    ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying,"
        " strategy_type, direction, net_entry, entry_date, status, source,"
        " external_id, created_at, updated_at)"
        " VALUES ('ml1', 'u1', 'a1', 'AAPL', 'vertical_debit_call', 'bullish',"
        " 300.0, '2026-08-01', 'open', 'broker', 'bkopt:ml', '2026-08-01',"
        " '2026-08-01')")
    for i, (side, strike) in enumerate((("buy", 100.0), ("sell", 105.0))):
        conn.execute(
            "INSERT INTO j2_option_legs (id, strategy_id, leg_index, side,"
            " contract_type, strike, expiration, qty, entry_price)"
            " VALUES (?, 'ml1', ?, ?, 'call', ?, '2026-12-18', 1, 1.5)",
            (f"leg{i}", i, side, strike))
    conn.commit()
    conn.close()
    om._reset_cache_for_tests()
    monkeypatch.setattr(om, "_snapshot_for", lambda u, occ: {"day": {"close": 2.0}})
    out = om.get_option_marks("u1")
    assert out == {}          # omitted entirely — never a one-leg total
