"""Task 10.10: another member's rows never change a member's discipline widgets.

Member A's answers are read, member B is seeded with trades, option strategies, accounts with
limits, open positions and dismissed revenge pairs that would each move A's numbers if they were
read for A, and A's answers are read again: identical. B's account id in A's prop-firm params
reads as all of A's accounts, with the one notice.
"""
from __future__ import annotations

import importlib
from datetime import datetime, timezone

import pytest

from tests.test_shelf_discipline import (
    A, B, account, et, position, strategy, trade,
)

TUE = datetime(2026, 10, 20, 20, 30, tzinfo=timezone.utc)      # Tuesday, 16:30 ET


@pytest.fixture
def S(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import shelf_discipline
    yield shelf_discipline
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def _seed(c, uid, acc, *, loss=-50.0):
    account(c, uid, acc, pct=5.0, size=10000.0, name=f"Main {uid}")
    trade(c, uid, day="2026-10-20", pnl=loss, entry="10:00", exit_="10:10", account=acc)
    trade(c, uid, day="2026-10-20", pnl=20, entry="10:20", exit_="10:40", account=acc)
    trade(c, uid, day="2026-10-19", pnl=300, entry="11:00", exit_="11:30", account=acc)
    strategy(c, uid, pnl=-40, entry_iso=et("2026-10-20", "09:45"),
             closed_iso=et("2026-10-20", "12:00"), day="2026-10-20", account=acc)
    position(c, uid, acc=acc, symbol="AAPL", entry=100.0, stop=95.0, shares=20)
    position(c, uid, acc=acc, symbol="MSFT", entry=200.0, stop=200.0)            # placeholder


def _answers(S, prop_params):
    return {
        "tilt": S.my_tilt_check(A, {}, TUE),
        "revenge": S.my_revenge_clean_days(A, {}, TUE),
        "risk": S.my_risk_left_today(A, {}, TUE),
        "prop": S.my_prop_firm(A, prop_params, TUE),
    }


def test_member_b_never_changes_member_a(S, monkeypatch):
    stored = {}                                       # uid -> dismissed pairs

    def _pairs(conn, uid):
        return frozenset(stored.get(uid, ()))

    monkeypatch.setattr(S, "_dismissed_pairs", _pairs)
    with _conn() as c:
        _seed(c, A, "acc-a")
        c.commit()
    prop = {"since": "2026-10-01", "dailyLoss": 1000, "maxDrawdown": 2000}
    before = _answers(S, prop)
    assert before["revenge"]["flagged"]                       # A has a revenge re-entry
    assert before["risk"]["accounts"][0]["openRisk"] == 100.0
    with _conn() as c:
        # B: a bigger book on the same days, its own limits, positions, strategies, and a
        # dismissal of every pair (a pair key of B's own, and one shaped like A's).
        _seed(c, B, "acc-b", loss=-900.0)
        for d in ("2026-10-13", "2026-10-14", "2026-10-15"):
            trade(c, B, day=d, pnl=-50, entry="10:00", exit_="10:10")
            trade(c, B, day=d, pnl=20, entry="10:20", exit_="10:40")
        strategy(c, B, pnl=-5000, entry_iso=et("2026-10-20", "09:45"), closed_iso=None,
                 status="open", account="acc-b")
        rows = c.execute("SELECT id FROM j2_trades WHERE user_id = ?", (A,)).fetchall()
        c.commit()
    ids = [r[0] for r in rows]
    stored[B] = {f"id:{x}->id:{y}" for x in ids for y in ids}
    after = _answers(S, prop)
    assert after == before


def test_b_account_in_a_params_reads_all_of_a(S):
    with _conn() as c:
        _seed(c, A, "acc-a")
        account(c, A, "acc-a2", name="Second")
        trade(c, A, day="2026-10-19", pnl=-75, entry="12:00", exit_="12:30", account="acc-a2")
        _seed(c, B, "acc-b", loss=-900.0)
        c.commit()
    base = {"since": "2026-10-01", "maxDrawdown": 2000}
    mine = S.my_prop_firm(A, base, TUE)
    got = S.my_prop_firm(A, {**base, "accountId": "acc-b"}, TUE)
    assert got["notices"] == ["That account is no longer in your Journal; showing all accounts."]
    assert got["accountId"] is None
    assert got["trailing"] == mine["trailing"] and got["lines"] == mine["lines"]
    # A's own second account narrows; B's rows are never in it.
    second = S.my_prop_firm(A, {**base, "accountId": "acc-a2"}, TUE)
    assert second["trailing"]["current"] == -75.0 and "notices" not in second
