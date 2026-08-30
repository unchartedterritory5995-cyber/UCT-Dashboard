"""The onboarding readout: how is each brokerage actually being handled?

Robinhood is 1 of 11 live accounts and produced every defect found this month.
Schwab is 7. The risk with more brokers arriving is not missing support — it is
that a new one is handled by whatever the generic path infers and nobody looks
at what it inferred.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import broker_coverage


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    return {}


def _acct(name, ba_id, *, user="u1", status="active", sync_status="ok"):
    # Account names are unique per user; the brokerage name is what groups.
    a = accounts_service.create_account(user, {"name": f"{name} {ba_id}", "color": "blue",
                                               "startingBalance": 1.0})
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
            "brokerage_name, account_number_masked, j2_account_id, status, "
            "last_sync_at, last_sync_status, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (ba_id, user, f"snap-{ba_id}", name, "..1", a["id"], status,
             "2026-08-29T07:40:00+00:00", sync_status,
             "2026-08-01", "2026-08-01"))
        conn.commit()
    finally:
        conn.close()
    return a["id"]


def _position(j2_id, sym, *, session=None, user="u1"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, "
            "shares, original_shares, entry_price, stop_price, raise_to_breakeven, "
            "context_at_entry, entry_estimated, account_id, source, broker_price, "
            "broker_price_session, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"p-{sym}-{j2_id}", user, sym, "Long", "2026-08-01", 10, 10, 5.0, 5.0,
             0, "{}", 0, j2_id, "broker", 5.5, session, "2026-08-01", "2026-08-01"))
        conn.commit()
    finally:
        conn.close()


class TestReport:
    def test_groups_by_brokerage_and_ranks_by_exposure(self, env):
        for i in range(3):
            _acct("Schwab", f"sch{i}")
        _acct("Robinhood", "rh0")
        out = broker_coverage.report()
        names = [b["brokerage"] for b in out["brokerages"]]
        assert names == ["Schwab", "Robinhood"], "most accounts first — that is where risk is"
        assert out["total"] == 4

    def test_reports_how_many_marks_are_dated(self, env):
        j2 = _acct("Webull", "wb0")
        _position(j2, "AAA", session="2026-08-28")
        _position(j2, "BBB", session=None)
        b = broker_coverage.report()["brokerages"][0]
        assert b["positions"] == 2 and b["markSessions"] == 1
        assert b["markSessionsPct"] == 50, (
            "0% on a broker that has synced for days is a fault, and only "
            "visible if the number is reported")

    def test_an_unknown_brokerage_is_described_not_skipped(self, env):
        # The whole point: a brokerage nobody special-cased still gets a readout.
        j2 = _acct("SomeNewBroker", "new0")
        _position(j2, "ZZZ", session="2026-08-28")
        b = broker_coverage.report()["brokerages"][0]
        assert b["brokerage"] == "SomeNewBroker"
        assert b["timestampCoverage"], "coverage is INFERRED, not looked up in a table"
        assert b["positions"] == 1

    def test_absent_measurements_report_unknown_rather_than_zero(self, env):
        _acct("Schwab", "sch9")
        b = broker_coverage.report()["brokerages"][0]
        assert b["driftMean"] is None, "no samples is not a drift of zero"
        assert b["markSessionsPct"] is None, "no positions is not 0% dated"

    def test_a_failing_sync_is_counted_against_its_brokerage(self, env):
        _acct("Schwab", "sch1", sync_status="error")
        _acct("Schwab", "sch2", sync_status="ok")
        b = broker_coverage.report()["brokerages"][0]
        assert b["accounts"] == 2 and b["syncFailures"] == 1

    def test_an_empty_fleet_does_not_raise(self, env):
        assert broker_coverage.report() == {"brokerages": [], "total": 0}
