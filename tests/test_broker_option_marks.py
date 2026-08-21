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
