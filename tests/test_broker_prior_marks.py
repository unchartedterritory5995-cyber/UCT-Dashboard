"""The broker's PRIOR-session mark — so a closed-session Today is mark-to-mark.

2026-08-29: valuing rows at the broker's mark while still measuring Today FROM
our own vendor's `prev_close` left the two vendors' disagreement at BOTH ends of
the subtraction — −$43.40 against Robinhood's −$23.29, where a mark-to-mark
computation reproduced −$26.49. Nothing stored the broker's prior mark, so
nothing could compute it.

`_roll_broker_marks` carries the current mark into `broker_price_prev` exactly
once per session turnover, before the sync's new marks overwrite it.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import positions as positions_service
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import balances


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0})
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def _pos(sym, units, price, avg_cost=100.0):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": avg_cost}


def _sync(env, monkeypatch, session, price):
    """One broker sync at `session` marking SNAP at `price` (holdings-as-truth)."""
    monkeypatch.setattr(balances, "_snapshot_session_day", lambda: session)
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("SNAP", 2000, price)], fifo_open_positions=[])


def _marks(sym="SNAP"):
    conn = auth_db.get_connection()
    try:
        r = conn.execute(
            "SELECT broker_price, broker_price_session, broker_price_prev, "
            "broker_price_prev_session FROM j2_positions WHERE symbol=?", (sym,)
        ).fetchone()
    finally:
        conn.close()
    return dict(r) if r else None


class TestRollBrokerMarks:
    def test_the_first_sync_stamps_a_session_but_promotes_no_prior(self, env, monkeypatch):
        # The mark already on the row is of UNKNOWN vintage. A baseline whose
        # session we cannot name is worse than none — the consumer falls back to
        # the feed's prev_close, which is exactly the previous behaviour.
        _sync(env, monkeypatch, "2026-08-27", 5.335)
        m = _marks()
        assert m["broker_price"] == 5.335
        assert m["broker_price_session"] == "2026-08-27"
        assert m["broker_price_prev"] is None
        assert m["broker_price_prev_session"] is None

    def test_the_next_session_promotes_the_prior_mark(self, env, monkeypatch):
        _sync(env, monkeypatch, "2026-08-27", 5.335)   # Thursday's close
        _sync(env, monkeypatch, "2026-08-28", 5.445)   # Friday's close
        m = _marks()
        assert m["broker_price"] == 5.445
        assert m["broker_price_session"] == "2026-08-28"
        assert m["broker_price_prev"] == 5.335
        assert m["broker_price_prev_session"] == "2026-08-27"
        # 2,000 shares × (5.445 − 5.335) = +$220.00, which is what Robinhood's
        # own Today reported for SNAP; our vendor's closes gave +$200.00.
        assert round((m["broker_price"] - m["broker_price_prev"]) * 2000, 2) == 220.00

    def test_a_second_sync_in_the_SAME_session_does_not_re_roll(self, env, monkeypatch):
        # Several syncs land per day. If each rolled, `prev` would collapse onto
        # today's own mark and Today would read ~0.
        _sync(env, monkeypatch, "2026-08-27", 5.335)
        _sync(env, monkeypatch, "2026-08-28", 5.445)
        _sync(env, monkeypatch, "2026-08-28", 5.450)   # same session, later sync
        m = _marks()
        assert m["broker_price"] == 5.450
        assert m["broker_price_prev"] == 5.335, "prev must still be Thursday's"
        assert m["broker_price_prev_session"] == "2026-08-27"

    def test_three_sessions_keep_only_the_immediately_prior_one(self, env, monkeypatch):
        _sync(env, monkeypatch, "2026-08-26", 5.20)
        _sync(env, monkeypatch, "2026-08-27", 5.335)
        _sync(env, monkeypatch, "2026-08-28", 5.445)
        m = _marks()
        assert m["broker_price_prev"] == 5.335
        assert m["broker_price_prev_session"] == "2026-08-27"


class TestServedToTheFrontend:
    def test_the_positions_api_serves_the_prior_mark(self, env, monkeypatch):
        # The 2026-08-20 defect class: a SELECT that drops the column makes
        # _row_to_position default it to None, silently, forever. Every SELECT
        # list must carry these or the whole feature is inert on the page.
        _sync(env, monkeypatch, "2026-08-27", 5.335)
        _sync(env, monkeypatch, "2026-08-28", 5.445)
        rows = positions_service.list_open_positions("u1", account_id=env["acct_id"])
        snap = next(p for p in rows if p["symbol"] == "SNAP")
        assert snap["brokerPrice"] == 5.445
        assert snap["brokerPricePrev"] == 5.335
        assert snap["brokerPriceSession"] == "2026-08-28"
        assert snap["brokerPrevSession"] == "2026-08-27"
