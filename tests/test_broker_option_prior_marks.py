"""The broker's PRIOR-session OPTION mark — evidence, not a guess.

2026-08-29 left one number undecided. Our option feed said the owner's SNAP
Jan-2028 $7 LEAP fell **675 -> 665** on Friday (−$10); the broker's own marks
said it ROSE **655 -> 665** (+$10). A $20 swing on one wide-spread contract, and
the bulk of what still separates a closed-session Today from Robinhood's figure.

Which prior mark is right is NOT decidable from a single Saturday, so nothing
here consumes it yet. This stores the broker's prior mark beside the one our
feed already reports, so a few sessions of both settles it with data.

⛔ DELIBERATELY NOT WIRED INTO Today. The option's CURRENT value under broker
marks is still our LIVE mark — a prior measured ruling (option_marks.py exists
because the sync-time value lags, and on 2026-08-29 the broker itself re-marked
to our 665). Taking the broker's PRIOR mark while keeping our CURRENT one would
put two vendors on opposite ends of the subtraction — the exact defect the
equity fix removed. Decide with the data, then wire one end or the other.

The current mark's session is DERIVED from `broker_mark_synced_at`, which every
write site already stamps — no second time authority is introduced.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import option_reconstruct


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0})
    return {"acct_id": acct["id"]}


def _strategy(env, *, bcv, synced_at, sid="s1"):
    """An open broker option strategy carrying a mark stamped at `synced_at`."""
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, "
            "strategy_type, direction, net_entry, status, entry_date, source, "
            "external_id, broker_current_value, broker_mark_synced_at, "
            "created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, "u1", env["acct_id"], "SNAP", "long_call", "bullish", 610.0, "open",
             "2026-07-01", "broker", f"bkopt:{sid}", bcv, synced_at,
             "2026-07-01", "2026-07-01"))
        conn.commit()
    finally:
        conn.close()


def _row(sid="s1"):
    conn = auth_db.get_connection()
    try:
        r = conn.execute(
            "SELECT broker_current_value, broker_mark_synced_at, "
            "broker_current_value_prev, broker_current_value_prev_session "
            "FROM j2_option_strategies WHERE id=?", (sid,)).fetchone()
    finally:
        conn.close()
    return dict(r) if r else None


class TestRollOptionMarks:
    def test_promotes_the_prior_mark_when_the_session_turns_over(self, env):
        # Mark stamped Thursday 23:04 ET; we are now reconciling on Friday.
        _strategy(env, bcv=655.0, synced_at="2026-08-28T03:04:27+00:00")
        conn = auth_db.get_connection()
        try:
            option_reconstruct._roll_option_marks(conn, env["acct_id"], "2026-08-28")
            conn.commit()
        finally:
            conn.close()
        r = _row()
        assert r["broker_current_value_prev"] == 655.0
        assert r["broker_current_value_prev_session"] == "2026-08-27"

    def test_does_not_roll_inside_the_same_session(self, env):
        # Several syncs land per day; each must NOT collapse prev onto today.
        _strategy(env, bcv=655.0, synced_at="2026-08-28T22:48:00+00:00")  # Fri 18:48 ET
        conn = auth_db.get_connection()
        try:
            option_reconstruct._roll_option_marks(conn, env["acct_id"], "2026-08-28")
            conn.commit()
        finally:
            conn.close()
        assert _row()["broker_current_value_prev"] is None

    def test_a_mark_with_no_timestamp_is_skipped_not_guessed(self, env):
        _strategy(env, bcv=655.0, synced_at=None)
        conn = auth_db.get_connection()
        try:
            option_reconstruct._roll_option_marks(conn, env["acct_id"], "2026-08-28")
            conn.commit()
        finally:
            conn.close()
        r = _row()
        assert r["broker_current_value_prev"] is None
        assert r["broker_current_value_prev_session"] is None

    def test_captures_the_disputed_leap_pair(self, env):
        # Thursday's broker mark 655 preserved while Friday's 665 becomes current
        # — the two numbers that decide the $20 question, side by side.
        _strategy(env, bcv=655.0, synced_at="2026-08-28T03:04:27+00:00")
        conn = auth_db.get_connection()
        try:
            option_reconstruct._roll_option_marks(conn, env["acct_id"], "2026-08-28")
            conn.execute(
                "UPDATE j2_option_strategies SET broker_current_value = 665.0, "
                "broker_mark_synced_at = '2026-08-29T23:56:09+00:00' WHERE id='s1'")
            conn.commit()
        finally:
            conn.close()
        r = _row()
        # Broker's own Friday move: 655 -> 665 = +$10. Our feed said -$10.
        assert r["broker_current_value"] - r["broker_current_value_prev"] == 10.0
        assert r["broker_current_value_prev_session"] == "2026-08-27"


class TestServedToTheFrontend:
    def test_the_strategies_api_serves_the_prior_mark(self, env):
        from api.services.journal_two import options as options_service
        _strategy(env, bcv=655.0, synced_at="2026-08-28T03:04:27+00:00")
        conn = auth_db.get_connection()
        try:
            option_reconstruct._roll_option_marks(conn, env["acct_id"], "2026-08-28")
            conn.commit()
        finally:
            conn.close()
        rows = options_service.list_strategies("u1", account_id=env["acct_id"])
        s = next(x for x in rows if x["id"] == "s1")
        assert s["brokerCurrentValuePrev"] == 655.0
        assert s["brokerCurrentValuePrevSession"] == "2026-08-27"


class TestComparisonInstrument:
    def test_reports_the_disagreement_the_decision_is_worth(self, env, monkeypatch):
        from api.services.journal_two.broker import option_marks
        _strategy(env, bcv=655.0, synced_at="2026-08-28T03:04:27+00:00")
        conn = auth_db.get_connection()
        try:
            option_reconstruct._roll_option_marks(conn, env["acct_id"], "2026-08-28")
            conn.execute("UPDATE j2_option_strategies SET broker_current_value = 665.0 "
                         "WHERE id='s1'")
            conn.commit()
        finally:
            conn.close()
        # Our feed's view of the same contract: 675 -> 665.
        monkeypatch.setattr(option_marks, "get_option_marks",
                            lambda uid, *a, **k: {"s1": {"currentValue": 665.0,
                                                         "prevCloseValue": 675.0}})
        out = option_marks.compare_prior_marks()
        row = out["rows"][0]
        assert row["feedDay"] == -10.0      # our feed says the LEAP FELL
        assert row["brokerDay"] == 10.0     # the broker says it ROSE
        assert row["disagreement"] == -20.0  # the $20 the choice is worth
        assert out["comparable"] == 1 and out["awaiting_broker_prior"] == 0

    def test_a_strategy_with_no_broker_prior_is_reported_not_dropped(self, env, monkeypatch):
        from api.services.journal_two.broker import option_marks
        _strategy(env, bcv=655.0, synced_at="2026-08-28T03:04:27+00:00")
        monkeypatch.setattr(option_marks, "get_option_marks", lambda uid, *a, **k: {})
        out = option_marks.compare_prior_marks()
        assert out["strategies"] == 1 and out["comparable"] == 0
        assert out["awaiting_broker_prior"] == 1
        assert out["rows"][0]["disagreement"] is None

    def test_a_failing_feed_never_raises_out_of_a_diagnostic(self, env, monkeypatch):
        from api.services.journal_two.broker import option_marks
        _strategy(env, bcv=655.0, synced_at="2026-08-28T03:04:27+00:00")

        def _boom(*a, **k):
            raise RuntimeError("massive down")
        monkeypatch.setattr(option_marks, "get_option_marks", _boom)
        out = option_marks.compare_prior_marks()
        assert out["strategies"] == 1 and out["rows"][0]["feedDay"] is None
