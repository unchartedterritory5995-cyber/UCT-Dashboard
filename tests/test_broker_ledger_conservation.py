"""Cash conserves, or an activity is missing.

5,760 closed broker trades are reconstructed by FIFO over the activity ledger,
and nothing checked the ledger underneath them — SnapTrade reports a cost basis
only for OPEN holdings, so a closed trade has no broker-side referent. I called
that unverifiable; it was too strong. Cash conservation needs no broker-side
data at all.

The formula was MEASURED before it was coded (owner's live account, 2026-08-30:
six of nine windows closed at exactly 0.00, one spanning -$11,177.53, and
`amount - fee` beat `amount` alone on the window that separates them).
"""

from __future__ import annotations

import json

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import ledger_conservation as lc


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    return {"ba": "bk1"}


def _snap(ba, at, cash):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
            "snapshot_date, total_equity, cash, market_value, synced_at) "
            "VALUES (?,?,?,?,?,?,?)", ("u1", ba, at[:10], 0.0, cash, 0.0, at))
        conn.commit()
    finally:
        conn.close()


def _act(ba, at, amount, fee=None, atype="BUY", raw=None):
    conn = auth_db.get_connection()
    try:
        body = raw if raw is not None else json.dumps(
            {"amount": amount, "fee": fee, "type": atype})
        conn.execute(
            "INSERT INTO j2_broker_activities (id, user_id, broker_account_id, "
            "external_id, activity_type, occurred_at, raw_json, created_at) "
            "VALUES (lower(hex(randomblob(8))),?,?,lower(hex(randomblob(8))),?,?,?,?)",
            ("u1", ba, atype, at, body, "2026-01-01"))
        conn.commit()
    finally:
        conn.close()


class TestTheFormula:
    def test_amount_is_signed_by_the_provider_and_fee_is_extra(self):
        # The real shape: a 1-lot option buy at 2.62 with a $0.04 commission.
        # The multiplier is already inside `amount`; the fee is not.
        raw = json.dumps({"amount": -262.0, "fee": 0.04, "price": 2.62, "units": 1})
        assert lc.cash_effect(raw) == pytest.approx(-262.04)

    def test_an_unreadable_row_is_None_not_zero(self):
        # Treating it as 0.0 would quietly CLOSE a residual that should stay open.
        assert lc.cash_effect("not json") is None
        assert lc.cash_effect(json.dumps({"fee": 1.0})) is None   # no amount
        assert lc.cash_effect(None) is None

    def test_a_missing_fee_is_simply_no_fee(self):
        assert lc.cash_effect(json.dumps({"amount": -100.0})) == -100.0
        assert lc.cash_effect(json.dumps({"amount": -100.0, "fee": None})) == -100.0


class TestConservation:
    def test_a_complete_ledger_conserves(self, env):
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        _act(env["ba"], "2026-08-02T15:00:00", -262.0, fee=0.04)
        _snap(env["ba"], "2026-08-03T07:40:00", 737.96)
        out = lc.conservation(env["ba"], "u1")
        assert out["spanResidual"] == 0.0
        assert out["verdict"] == "conserves"
        assert out["cleanWindows"] == 1

    def test_a_MISSING_activity_is_caught(self, env):
        # Cash moved by $500 more than the ledger explains: an entry is absent,
        # and every trade reconstructed across it is built on a hole.
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        _act(env["ba"], "2026-08-02T15:00:00", -100.0)
        _snap(env["ba"], "2026-08-03T07:40:00", 400.0)
        out = lc.conservation(env["ba"], "u1")
        assert out["verdict"] == "gap"
        assert out["spanResidual"] == -500.0
        assert out["worst"]["residual"] == -500.0

    def test_sub_cent_rounding_is_not_a_gap(self, env):
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        _act(env["ba"], "2026-08-02T15:00:00", -100.0)
        _snap(env["ba"], "2026-08-03T07:40:00", 900.40)   # 40c of fee convention
        assert lc.conservation(env["ba"], "u1")["verdict"] == "conserves"

    def test_a_FRESH_window_is_not_graded(self, env):
        # The owner's recurring $40 deposit posted a day behind its buy and
        # showed +40.00. Flagging that would flag every account every day.
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        _act(env["ba"], "2026-08-02T15:00:00", -40.0)
        conn = auth_db.get_connection()
        conn.execute(
            "INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
            "snapshot_date, total_equity, cash, market_value, synced_at) "
            "VALUES (?,?,?,?,?,?, datetime('now'))",
            ("u1", env["ba"], "2026-08-30", 0.0, 1000.0, 0.0))
        conn.commit()
        conn.close()
        out = lc.conservation(env["ba"], "u1")
        assert out["settledWindows"] == 0
        assert out["verdict"] == "insufficient", "not yet gradeable is not clean"

    def test_one_reading_is_not_a_span(self, env):
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        out = lc.conservation(env["ba"], "u1")
        assert out["verdict"] == "insufficient"
        assert out["spanResidual"] is None, "no span is not a residual of zero"

    def test_unreadable_rows_are_counted_and_surfaced(self, env):
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        _act(env["ba"], "2026-08-02T15:00:00", None, raw="{oops")
        _snap(env["ba"], "2026-08-03T07:40:00", 1000.0)
        assert lc.conservation(env["ba"], "u1")["unreadableActivities"] == 1


class TestDateOnlyBrokers:
    def test_per_window_detail_is_marked_untrustworthy(self, env):
        # Schwab stamps at midnight, so a trade lands in the window BEFORE its
        # own. The span still holds; the per-window detail does not.
        _snap(env["ba"], "2026-08-01T07:40:00", 1000.0)
        _act(env["ba"], "2026-08-02T00:00:00", -100.0)
        _act(env["ba"], "2026-08-03T00:00:00", -100.0)
        _snap(env["ba"], "2026-08-05T07:40:00", 800.0)
        out = lc.conservation(env["ba"], "u1")
        assert out["perWindowTrustworthy"] is False
        assert out["spanResidual"] == 0.0, "the span is robust to misattribution"
