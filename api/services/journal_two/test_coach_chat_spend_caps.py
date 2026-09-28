"""Rails for the Compass chat doors that spend a model call OUTSIDE a typed
turn: confirming or cancelling a pending action, starting the onboarding
interview, and redoing it.

Every one of them must pass the SAME admission check a typed turn passes (the
per-member daily chat cap and the global cost circuit-breaker), and every
model stream must be accrued into the cost breaker. Withdrawing consent is the
one exception: a cancel ALWAYS cancels, and only its model acknowledgement is
skipped (and not charged) when the member is over the line.

The model is a scripted fake throughout -- nothing here touches the network.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
import threading
import time

import pytest


class _Usage:
    input_tokens = 1000
    output_tokens = 500
    cache_read_input_tokens = 0
    cache_creation_input_tokens = 0


class _Final:
    usage = _Usage()


class FakeStream:
    def __init__(self, events):
        self.events = list(events)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        yield from self.events

    def get_final_message(self):
        return _Final()


class FakeClient:
    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.calls = 0

    def start_stream(self, **_kw):
        self.calls += 1
        if not self.scripts:
            raise RuntimeError("FakeClient out of scripts")
        return FakeStream(self.scripts.pop(0))


def _ack(text="Done."):
    return [{"type": "text", "text": text}, {"type": "message_stop"}]


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


@pytest.fixture
def cost(monkeypatch):
    """A fresh, ENABLED cost breaker with a cap far above anything a test spends."""
    from api.services.journal_two import compass_cost_guard
    monkeypatch.setenv("COMPASS_COST_CAP_DAILY", "1000")
    compass_cost_guard._reset_for_test()
    yield compass_cost_guard
    compass_cost_guard._reset_for_test()


@pytest.fixture
def small_cap(monkeypatch):
    from api.services.journal_two import coach_chat
    monkeypatch.setattr(coach_chat, "RATE_LIMIT_PER_DAY", 3)
    return 3


def _seed_account(db_conn, user_id="u_cap"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _use_up_cap(db_conn, acc, n, user_id="u_cap"):
    from api.services.journal_two import coach_chat
    for _ in range(n):
        coach_chat.append_message(user_id=user_id, account_id=acc["id"],
                                  role="user", content="x", conn=db_conn)


def _pending_mute(db_conn, acc, tool_call_id="tu_m", user_id="u_cap"):
    from api.services.journal_two import coach_chat
    return coach_chat.append_message(
        user_id=user_id, account_id=acc["id"], role="assistant", content=None,
        tool_calls=[{"id": tool_call_id, "name": "mute_setup",
                     "args": {"setup_name": "Pullback", "until_date": "2099-01-01"},
                     "status": "pending_confirm"}],
        conn=db_conn,
    )


def _status(db_conn, message_id, tool_call_id):
    row = db_conn.execute("SELECT tool_calls FROM j2_chat_messages WHERE id = ?",
                          (message_id,)).fetchone()
    return next(tc["status"] for tc in json.loads(row["tool_calls"])
                if tc["id"] == tool_call_id)


def _muted(db_conn, acc):
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?",
                          (acc["id"],)).fetchone()
    return [m["setup_name"] for m in json.loads(row["muted_setups"] or "[]")]


# ── confirm ─────────────────────────────────────────────────────────────────


def test_confirm_over_the_daily_cap_is_refused_and_the_action_stays_pending(
        db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    _use_up_cap(db_conn, acc, small_cap)
    mid = _pending_mute(db_conn, acc)
    client = FakeClient([_ack()])
    events = list(coach_chat.confirm_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["rate_limited"]
    assert client.calls == 0                      # no model call
    assert "Pullback" not in _muted(db_conn, acc)  # the tool never ran
    assert _status(db_conn, mid, "tu_m") == "pending_confirm"  # still confirmable tomorrow


def test_confirm_is_refused_when_the_cost_breaker_is_tripped(db_conn, cost, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    monkeypatch.setattr(cost, "over_budget", lambda: True)
    client = FakeClient([_ack()])
    events = list(coach_chat.confirm_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["cost_capped"]
    assert client.calls == 0
    assert "Pullback" not in _muted(db_conn, acc)


def test_confirm_under_the_cap_runs_and_its_acknowledgement_is_charged(db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    client = FakeClient([_ack("Muted.")])
    events = list(coach_chat.confirm_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert events[-1]["type"] == "complete"
    assert "Pullback" in _muted(db_conn, acc)
    assert _status(db_conn, mid, "tu_m") == "confirmed"
    assert client.calls == 1
    assert cost.snapshot()["spent_usd"] > 0


def test_a_concurrent_double_confirm_runs_the_tool_exactly_once(db_conn, cost, monkeypatch):
    """Two confirms of ONE pending action racing: the status transition must
    be atomic, so exactly one of them runs the tool and the other is told the
    action is no longer pending."""
    from api.services.journal_two import coach_chat
    from api.services.journal_two import coach_chat_tools as cct
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    ran = []
    lock = threading.Lock()

    def slow_executor(**_kw):
        with lock:
            ran.append(1)
        time.sleep(0.3)     # hold the window open: a non-atomic check lets both in
        return {"ok": True}

    monkeypatch.setitem(cct._TOOLS_UNGATED["mute_setup"], "executor", slow_executor)
    barrier = threading.Barrier(2)
    results = {}

    def run(tag):
        barrier.wait()
        results[tag] = list(coach_chat.confirm_pending_action(
            user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
            client=FakeClient([_ack()]),        # conn=None: each thread its own connection
        ))

    threads = [threading.Thread(target=run, args=(t,)) for t in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert len(ran) == 1
    codes = sorted(next((e.get("code") for e in evs if e.get("type") == "error"), "ok")
                   for evs in results.values())
    assert codes == ["no_pending_action", "ok"]
    assert _status(db_conn, mid, "tu_m") == "confirmed"


def test_the_claim_is_a_compare_and_set_so_a_stale_read_cannot_win(db_conn):
    """Deterministic version of the race: a competing claim lands BETWEEN this
    claim's read and its write. The compare-and-set must refuse the stale
    write, so exactly one of the two claims succeeds."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    path = db_conn.execute("PRAGMA database_list").fetchone()["file"]

    class _Row:
        def __init__(self, row):
            self.row = row

        def fetchone(self):
            return self.row

    class RacingConn:
        fired = False

        def execute(self, sql, params=()):
            cur = db_conn.execute(sql, params)
            if sql.startswith("SELECT tool_calls") and not self.fired:
                self.fired = True
                row = cur.fetchone()
                other = sqlite3.connect(path)
                other.row_factory = sqlite3.Row
                try:   # the competitor claims first, after our read
                    won = coach_chat._claim_pending_tool_call(
                        other, message_id=mid, tool_call_id="tu_m", to_status="confirmed")
                finally:
                    other.close()
                assert won is not None
                return _Row(row)
            return cur

        def commit(self):
            db_conn.commit()

    ours = coach_chat._claim_pending_tool_call(
        RacingConn(), message_id=mid, tool_call_id="tu_m", to_status="cancelled")
    assert ours is None                                   # the stale write lost
    assert _status(db_conn, mid, "tu_m") == "confirmed"   # the winner's state stands


# ── cancel ──────────────────────────────────────────────────────────────────


def test_cancel_over_the_cap_still_cancels_but_skips_and_does_not_charge_the_ack(
        db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    _use_up_cap(db_conn, acc, small_cap)
    mid = _pending_mute(db_conn, acc)
    client = FakeClient([_ack("Not muted.")])
    events = list(coach_chat.cancel_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert _status(db_conn, mid, "tu_m") == "cancelled"   # consent withdrawn, always
    assert "Pullback" not in _muted(db_conn, acc)
    assert not [e for e in events if e.get("type") == "error"]
    assert events[-1]["type"] == "complete"
    assert client.calls == 0                               # no acknowledgement call
    assert cost.snapshot()["spent_usd"] == 0               # and nothing charged
    tool_rows = db_conn.execute(
        "SELECT tool_results FROM j2_chat_messages WHERE role = 'tool' AND parent_id = ?",
        (mid,)).fetchall()
    assert len(tool_rows) == 1 and "user_cancelled" in tool_rows[0]["tool_results"]


def test_cancel_cannot_overwrite_an_action_that_was_already_confirmed(db_conn, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    list(coach_chat.confirm_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=FakeClient([_ack()]), conn=db_conn,
    ))
    client = FakeClient([_ack()])
    events = list(coach_chat.cancel_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["no_pending_action"]
    assert _status(db_conn, mid, "tu_m") == "confirmed"
    assert client.calls == 0


def test_cancel_when_cost_capped_still_cancels(db_conn, cost, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    monkeypatch.setattr(cost, "over_budget", lambda: True)
    client = FakeClient([_ack()])
    list(coach_chat.cancel_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert _status(db_conn, mid, "tu_m") == "cancelled"
    assert client.calls == 0


def test_cancel_under_the_cap_acknowledges_and_is_charged(db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = _pending_mute(db_conn, acc)
    client = FakeClient([_ack("Left it alone.")])
    events = list(coach_chat.cancel_pending_action(
        user_id="u_cap", account_id=acc["id"], message_id=mid, tool_call_id="tu_m",
        client=client, conn=db_conn,
    ))
    assert _status(db_conn, mid, "tu_m") == "cancelled"
    assert client.calls == 1
    assert events[-1]["type"] == "complete"
    assert cost.snapshot()["spent_usd"] > 0


# ── onboarding ──────────────────────────────────────────────────────────────


def test_start_onboarding_over_the_cap_is_refused_before_any_state_changes(
        db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    _use_up_cap(db_conn, acc, small_cap)
    client = FakeClient([_ack("Welcome.")])
    events = list(coach_chat.start_onboarding(
        user_id="u_cap", account_id=acc["id"], client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["rate_limited"]
    assert client.calls == 0
    row = db_conn.execute("SELECT onboarding_mode, onboarding_session_id FROM j2_accounts "
                          "WHERE id = ?", (acc["id"],)).fetchone()
    assert int(row["onboarding_mode"] or 0) == 0 and row["onboarding_session_id"] is None
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_chat_messages WHERE role='user'").fetchone()["n"]
    assert n == small_cap                                  # no sentinel appended


def test_start_onboarding_is_refused_when_the_cost_breaker_is_tripped(db_conn, cost, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    monkeypatch.setattr(cost, "over_budget", lambda: True)
    client = FakeClient([_ack()])
    events = list(coach_chat.start_onboarding(
        user_id="u_cap", account_id=acc["id"], client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["cost_capped"]
    assert client.calls == 0


def test_start_onboarding_under_the_cap_is_charged(db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeClient([_ack("Welcome.")])
    events = list(coach_chat.start_onboarding(
        user_id="u_cap", account_id=acc["id"], client=client, conn=db_conn,
    ))
    assert events[-1]["type"] == "complete"
    assert client.calls == 1
    assert cost.snapshot()["spent_usd"] > 0


def test_redo_onboarding_over_the_cap_is_refused_before_it_resets_anything(
        db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    db_conn.execute("UPDATE j2_accounts SET onboarded = 1, onboarding_session_id = 'old' "
                    "WHERE id = ?", (acc["id"],))
    db_conn.commit()
    _use_up_cap(db_conn, acc, small_cap)
    client = FakeClient([_ack()])
    events = list(coach_chat.redo_onboarding(
        user_id="u_cap", account_id=acc["id"], client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["rate_limited"]
    assert client.calls == 0
    row = db_conn.execute("SELECT onboarded, onboarding_session_id FROM j2_accounts "
                          "WHERE id = ?", (acc["id"],)).fetchone()
    assert int(row["onboarded"]) == 1 and row["onboarding_session_id"] == "old"


def test_repeated_redo_onboarding_is_counted_and_stops_at_the_cap(db_conn, small_cap, cost):
    """Each redo re-enters the interview with a counted sentinel turn, so a
    loop of redos runs out at the daily chat cap instead of forever."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeClient([_ack(f"Round {i}.") for i in range(small_cap + 1)])
    outcomes = []
    for _ in range(small_cap + 1):
        evs = list(coach_chat.redo_onboarding(
            user_id="u_cap", account_id=acc["id"], client=client, conn=db_conn,
        ))
        outcomes.append(next((e.get("code") for e in evs if e.get("type") == "error"), "ok"))
    assert outcomes == ["ok"] * small_cap + ["rate_limited"]
    assert client.calls == small_cap
    rl = coach_chat.get_rate_limit_info(user_id="u_cap", account_id=acc["id"], conn=db_conn)
    assert rl["used"] == small_cap


# ── a typed turn keeps its behaviour (the shared helper did not change it) ───


def test_a_typed_turn_is_still_refused_over_the_cap_and_charged_under_it(db_conn, small_cap, cost):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeClient([_ack("Hi.")])
    events = list(coach_chat.handle_user_turn(
        user_id="u_cap", account_id=acc["id"], user_message="hello",
        client=client, conn=db_conn,
    ))
    assert events[-1]["type"] == "complete"
    assert cost.snapshot()["spent_usd"] > 0
    _use_up_cap(db_conn, acc, small_cap)
    events = list(coach_chat.handle_user_turn(
        user_id="u_cap", account_id=acc["id"], user_message="again",
        client=client, conn=db_conn,
    ))
    assert [e.get("code") for e in events if e.get("type") == "error"] == ["rate_limited"]
