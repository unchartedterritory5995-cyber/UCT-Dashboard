"""Tests for live_cash — effective broker cash between balance syncs.

The 2026-08-26 incident: the owner bought 2000 SNAP (~$10,990) at 14:54Z; the
fills rail surfaced the position within minutes, but `broker_cash` refreshes
only at the daily pre-market sync — so the hero (stale cash + live market
value) read $21,763 on a ~$10,772 account, inflated by exactly the purchase
cost. The fix: derive cash forward from the fill activities that occurred
after the last balance write. The ledger is the one authority — cash is
derived, never separately restated.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import activities_store, live_cash


USER = "u1"
BACCT = "ba1"


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    return {}


def _store(acts):
    return activities_store.store_activities(USER, BACCT, acts)


def _equity(act_id, typ, sym, units, price, trade_date, fee=0):
    return {"id": act_id, "type": typ, "units": units, "price": price,
            "fee": fee, "symbol": {"symbol": sym}, "trade_date": trade_date,
            "currency": "USD"}


def _option(act_id, typ, under, units, price, trade_date, *, mini=False, fee=0):
    return {"id": act_id, "type": typ, "units": units, "price": price,
            "fee": fee, "symbol": {"symbol": under},
            "option_symbol": {"ticker": f"{under} 2028-01-21 7C",
                              "strike_price": 7.0,
                              "expiration_date": "2028-01-21",
                              "option_type": "CALL",
                              "underlying_symbol": {"symbol": under},
                              "is_mini_option": mini},
            "trade_date": trade_date, "currency": "USD"}


# CLOCK-RELATIVE anchor: effective_cash disables itself when the balance
# write is older than 7 days, so a wall-clock-pinned SYNCED rots the whole
# suite into passthroughs within a week of being written.
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

_NOW = _dt.now(_tz.utc)
SYNCED = (_NOW - _td(hours=4)).isoformat()


def _after_sync(minutes):
    return (_NOW - _td(hours=4) + _td(minutes=minutes)).isoformat()


def _before_sync(minutes):
    return (_NOW - _td(hours=4) - _td(minutes=minutes)).isoformat()


# ── fill_cash_effect ─────────────────────────────────────────────────────────

def test_equity_buy_is_negative_cost_plus_fee():
    act = _equity("a1", "BUY", "SNAP", 2000, 5.495, _after_sync(30), fee=1.0)
    assert live_cash.fill_cash_effect(act) == pytest.approx(-10991.0)


def test_equity_sell_is_positive_proceeds_minus_fee():
    act = _equity("a2", "SELL", "NEXA", 750, 15.58, _after_sync(35), fee=0.5)
    assert live_cash.fill_cash_effect(act) == pytest.approx(11684.5)


def test_option_buy_applies_the_contract_multiplier():
    # Ledger convention: option activity price is PER-SHARE premium.
    act = _option("a3", "BUY", "SNAP", 5, 1.22, _after_sync(20))
    assert live_cash.fill_cash_effect(act) == pytest.approx(-610.0)


def test_mini_option_uses_ten():
    act = _option("a4", "SELL", "XSP", 2, 1.50, _after_sync(35), mini=True)
    assert live_cash.fill_cash_effect(act) == pytest.approx(30.0)


def test_sell_with_negative_units_still_credits_proceeds():
    # Unit sign is untrusted — every adapter lane abs()'s units and takes
    # direction from the type. A broker reporting a sell as units=-750 must
    # credit, not vanish.
    act = _equity("a-neg", "SELL", "NEXA", -750, 15.58, _after_sync(35))
    assert live_cash.fill_cash_effect(act) == pytest.approx(11685.0)


def test_option_shaped_row_without_option_symbol_is_excluded():
    # adapter.classify treats type BUY + option_type as an option trade even
    # without option_symbol — and the reconstruction lane SKIPS those rows
    # (no contract to build). Cash must only move where the book moved.
    act = _equity("a-opt", "BUY", "SNAP", 5, 1.22, _after_sync(35))
    act["option_type"] = "BUY_TO_OPEN"
    assert live_cash.fill_cash_effect(act) is None


def test_lowercase_activity_type_rows_are_still_counted(env):
    # activity_type is stored VERBATIM from the broker payload; the SQL
    # prefilter must normalize case the way every adapter read does.
    _store([_equity("intraday:lc", "buy", "SNAP", 100.0, 5.0,
                    _after_sync(35))])
    out = live_cash.effective_cash(USER, BACCT, 0.0, SYNCED)
    assert out["fills"] == 1
    assert out["cash"] == pytest.approx(-500.0)


def test_non_trade_and_malformed_rows_are_none():
    assert live_cash.fill_cash_effect({"type": "CONTRIBUTION", "amount": 40.0}) is None
    assert live_cash.fill_cash_effect(
        _equity("a5", "BUY", "SNAP", 0, 5.495, _after_sync(30))) is None
    assert live_cash.fill_cash_effect(
        _equity("a6", "BUY", "SNAP", 100, 0, _after_sync(30))) is None
    assert live_cash.fill_cash_effect(
        _equity("a7", "BUY", "SNAP", "x", 5.0, _after_sync(30))) is None


# ── effective_cash ───────────────────────────────────────────────────────────

def test_incident_regression_snap_buy_moves_cash_to_broker_truth(env):
    """The exact 8/26 shape: stored cash −18,760.66 + the 2000×5.495 SNAP fill
    after the balance sync ⇒ effective cash −29,750.66 (what the overnight
    sync later confirmed to the penny)."""
    _store([_equity("intraday:snap", "BUY", "SNAP", 2000.0, 5.495,
                    _after_sync(30))])
    out = live_cash.effective_cash(USER, BACCT, -18760.66, SYNCED)
    assert out["cash"] == pytest.approx(-29750.66)
    assert out["adjustment"] == pytest.approx(-10990.0)
    assert out["fills"] == 1


def test_fills_before_the_balance_sync_are_already_in_cash(env):
    # The broker's cash at sync time is real-time — it already includes every
    # fill that OCCURRED before the sync, even ones whose ledger row was
    # T+1-delivered later. Only post-sync fills adjust.
    _store([
        _equity("old-sell", "SELL", "BABA", 1, 515.0, _before_sync(60)),
        _equity("intraday:new", "BUY", "SNAP", 2000.0, 5.495,
                _after_sync(30)),
    ])
    out = live_cash.effective_cash(USER, BACCT, -18760.66, SYNCED)
    assert out["fills"] == 1
    assert out["adjustment"] == pytest.approx(-10990.0)


def test_sell_credits_proceeds(env):
    _store([_equity("intraday:s", "SELL", "ORCL", 100.0, 148.87,
                    _after_sync(40))])
    out = live_cash.effective_cash(USER, BACCT, -18760.66, SYNCED)
    assert out["cash"] == pytest.approx(-18760.66 + 14887.0)


def test_option_fill_adjusts_with_multiplier(env):
    _store([_option("intraday:o", "BUY", "SNAP", 5, 1.22,
                    _after_sync(45))])
    out = live_cash.effective_cash(USER, BACCT, -1000.0, SYNCED)
    assert out["cash"] == pytest.approx(-1610.0)


def test_no_activities_is_passthrough(env):
    out = live_cash.effective_cash(USER, BACCT, -18760.66, SYNCED)
    assert out["cash"] == pytest.approx(-18760.66)
    assert out["adjustment"] == 0.0
    assert out["fills"] == 0


def test_missing_inputs_are_passthrough(env):
    assert live_cash.effective_cash(USER, BACCT, None, SYNCED)["cash"] is None
    out = live_cash.effective_cash(USER, BACCT, -100.0, None)
    assert out["cash"] == pytest.approx(-100.0)
    assert out["fills"] == 0
    out = live_cash.effective_cash(USER, BACCT, -100.0, "not-a-date")
    assert out["cash"] == pytest.approx(-100.0)


def test_stale_balance_sync_disables_the_derivation(env):
    # A balance write older than the window means the ledger between then and
    # now also carries dividends/deposits we deliberately don't model — the
    # honest answer is the stored cash, unadjusted.
    _store([_equity("intraday:x", "BUY", "SNAP", 100.0, 5.0,
                    _after_sync(30))])
    out = live_cash.effective_cash(USER, BACCT, -100.0, "2026-08-10T07:40:00+00:00",
                                   now_iso="2026-08-26T22:00:00+00:00")
    assert out["cash"] == pytest.approx(-100.0)
    assert out["fills"] == 0


def test_z_suffix_and_offset_timestamps_compare_correctly(env):
    # occurred_at is stored "…Z" while broker_balance_synced_at is "+00:00" —
    # a naive string compare would misorder same-second edges; the derivation
    # must parse both.
    _store([_equity("intraday:edge", "BUY", "AAA", 10.0, 1.0,
                    (_NOW - _td(hours=4) + _td(milliseconds=45)).isoformat())])  # 45ms AFTER the sync
    out = live_cash.effective_cash(USER, BACCT, 0.0, SYNCED)
    assert out["fills"] == 1
    assert out["cash"] == pytest.approx(-10.0)


# ── annotate_accounts ────────────────────────────────────────────────────────

def _seed_broker_account(j2_account_id):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id,"
            " j2_account_id, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')",
            (BACCT, USER, "snap-1", j2_account_id),
        )
        conn.commit()
    finally:
        conn.close()


def test_annotate_accounts_stamps_live_cash_on_broker_accounts(env):
    _seed_broker_account("j2a")
    _store([_equity("intraday:snap", "BUY", "SNAP", 2000.0, 5.495,
                    _after_sync(30))])
    accounts = [
        {"id": "j2a", "balanceSource": "broker", "brokerCash": -18760.66,
         "brokerBalanceSyncedAt": SYNCED},
        {"id": "manual", "balanceSource": "manual"},
    ]
    out = live_cash.annotate_accounts(USER, accounts)
    assert out[0]["brokerCashLive"] == pytest.approx(-29750.66)
    assert out[0]["brokerCashLiveFills"] == 1
    assert "brokerCashLive" not in out[1]


def test_annotate_accounts_without_fills_matches_stored_cash(env):
    _seed_broker_account("j2a")
    accounts = [{"id": "j2a", "balanceSource": "broker", "brokerCash": -5.0,
                 "brokerBalanceSyncedAt": SYNCED}]
    out = live_cash.annotate_accounts(USER, accounts)
    assert out[0]["brokerCashLive"] == pytest.approx(-5.0)
    assert out[0]["brokerCashLiveFills"] == 0


def test_annotate_accounts_unmapped_broker_account_left_untouched(env):
    accounts = [{"id": "j2-unknown", "balanceSource": "broker",
                 "brokerCash": -5.0, "brokerBalanceSyncedAt": SYNCED}]
    out = live_cash.annotate_accounts(USER, accounts)
    assert "brokerCashLive" not in out[0]


# ── coverage detection ───────────────────────────────────────────────────────

def test_coverage_full_for_real_timestamps(env):
    _store([_equity(f"t{i}", "BUY", "SNAP", 10, 5.0,
                    f"2026-08-26T14:{i:02d}:24.358000Z") for i in range(5)])
    assert live_cash.coverage(USER, BACCT) == "full"


def test_coverage_date_only_for_midnight_stamped_brokers(env):
    _store([_equity(f"t{i}", "BUY", "SNAP", 10, 5.0,
                    f"2026-08-{20 + i}T00:00:00Z") for i in range(5)])
    assert live_cash.coverage(USER, BACCT) == "date_only"


def test_coverage_unknown_with_no_trades(env):
    assert live_cash.coverage(USER, BACCT) == "unknown"
