"""Task 8.7 -- a widget run on the one-process web pod: admission, deadline, cache, daily counter.

Seeded through `auth_db.init_db` (the Task 8.5 fixtures in `tests.test_widget_sources`) on a temp
sqlite file; nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone

import pytest

from api.services import auth_db, daily_counters
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import run
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    TODAY, UID, add_account, add_trade, add_user, conn, raw_plan,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)   # ET day = TODAY


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    """The pool, the gates, the cache, the single-flight table and the counters are module state."""
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-run-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    yield
    run._reset_state()


def _plan(**kw):
    return raw_plan(range={"token": "last_30d"}, **kw)


def _go(p=None, settings=None, *, uid=UID, lane="run", **kw):
    return run.run_plan(uid, p or _plan(), settings or {}, lane=lane, now=NOW, **kw)


# -- admission ------------------------------------------------------------------------------------

def test_phase1_holds_at_most_6():
    gate = threading.Event()
    futs = [nw._POOL.try_submit(gate.wait, 5) for _ in range(6)]
    try:
        assert all(f is not None for f in futs)
        assert nw._POOL.try_submit(lambda: 1) is None          # phase 1 never takes the reserve
        with run.admit("u", "run"):
            with run.admit("u", "run"):
                pass                                            # the two reserved permits
    finally:
        gate.set()
        for f in futs:
            f.result(2)


def test_builder_max_4_and_preview_max_2():
    from contextlib import ExitStack
    with ExitStack() as st:
        st.enter_context(run.admit("a", "preview"))
        st.enter_context(run.admit("b", "example"))
        with pytest.raises(run.EngineBusy):
            with run.admit("c", "preview"):
                pass
        st.enter_context(run.admit("c", "run"))
        st.enter_context(run.admit("d", "drill"))
        with pytest.raises(run.EngineBusy):
            with run.admit("e", "run"):                         # the fifth builder run
                pass
    with run.admit("e", "run"):                                 # everything came back
        pass


def test_member_max_2():
    with run.admit("m", "run"), run.admit("m", "drill"):
        with pytest.raises(run.EngineBusy) as e:
            with run.admit("m", "run"):
                pass
        assert str(e.value) == run.BUSY
        with run.admit("other", "run"):                         # another member is not held up
            pass


def test_admit_releases_on_error():
    for _ in range(10):
        with pytest.raises(RuntimeError):
            with run.admit("m", "preview"):
                raise RuntimeError("boom")
    with run.admit("m", "preview"), run.admit("m", "preview"):
        pass
    assert run._GATES.member == {}


def test_busy_is_immediate():
    gate = threading.Event()
    futs = [nw._POOL.try_submit(gate.wait, 5) for _ in range(6)]
    try:
        with run.admit("a", "run"), run.admit("b", "run"):
            t0 = time.perf_counter()
            with pytest.raises(run.EngineBusy):
                with run.admit("c", "run"):                     # the pool itself is full
                    pass
            assert time.perf_counter() - t0 < 0.05
    finally:
        gate.set()
        for f in futs:
            f.result(2)


def test_full_gate_in_run_plan_is_busy(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    with run.admit(UID, "run"), run.admit(UID, "run"):
        with pytest.raises(run.EngineBusy):
            _go()


# -- deadline -------------------------------------------------------------------------------------

_SLOW = ("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000)"
         " SELECT COUNT(*) FROM c")


def test_deadline_interrupts_and_maps_to_too_long(tmp_path):
    c = sqlite3.connect(str(tmp_path / "d.db"))
    try:
        t0 = time.perf_counter()
        with pytest.raises(run.EngineTooLong) as e:
            with run.deadline(c, 0.2):
                c.execute(_SLOW).fetchone()
        assert time.perf_counter() - t0 < 2.0
        assert str(e.value) == run.TOO_LONG
        # The handler is cleared: a long query now runs to its end (bounded here to stay quick).
        assert c.execute("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c"
                         " WHERE x < 300000) SELECT COUNT(*) FROM c").fetchone()[0] == 300000
    finally:
        c.close()


def test_deadline_leaves_other_errors_alone(tmp_path):
    c = sqlite3.connect(str(tmp_path / "d.db"))
    try:
        with pytest.raises(sqlite3.OperationalError):
            with run.deadline(c, 5):
                c.execute("SELECT * FROM no_such_table")
    finally:
        c.close()


def test_superseded_preview_interrupts(tmp_path):
    c = sqlite3.connect(str(tmp_path / "d.db"))
    try:
        mine = run.preview_generation("p")
        flag = {"newer": False}

        def newer():
            time.sleep(0.05)
            run.preview_generation("p")                         # a newer preview arrives
            flag["newer"] = True

        threading.Thread(target=newer).start()
        t0 = time.perf_counter()
        with pytest.raises(run.Superseded):
            with run.deadline(c, 30, superseded=lambda: run._preview_gen_now("p") != mine):
                c.execute(_SLOW).fetchone()
        assert flag["newer"] and time.perf_counter() - t0 < 2.0
    finally:
        c.close()


def test_preview_generation_increments_per_member():
    a1 = run.preview_generation("a")
    a2 = run.preview_generation("a")
    assert a2 == a1 + 1 and run.preview_generation("b") == 1


# -- cache ----------------------------------------------------------------------------------------

def _count_scans(monkeypatch):
    seen = {"n": 0}
    real = run.wsources.scan

    def spy(*a, **k):
        seen["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(run.wsources, "scan", spy)
    return seen


def test_cache_hit_same_stamp_and_bust_on_new_trade(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    seen = _count_scans(monkeypatch)
    a = _go()
    b = _go()
    assert seen["n"] == 1 and a == b and a["count"] == 1
    add_trade(conn, UID, day="2026-10-21", pnl=70)
    c = _go()
    assert seen["n"] == 2 and c["count"] == 2


def test_cache_never_shared_across_members_same_plan_hash(conn, monkeypatch):
    other = "u-wrun-other"
    add_user(conn, other)
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    add_trade(conn, other, day="2026-10-20", pnl=-999)
    mine, theirs = _go(), _go(uid=other)
    assert mine["value"]["v1"] == 50 and theirs["value"]["v1"] == -999


def test_cache_bust_on_excluded_toggle_and_setup_change(conn, monkeypatch):
    tid = add_trade(conn, UID, day="2026-10-20", pnl=50)
    seen = _count_scans(monkeypatch)
    _go()
    conn.execute("UPDATE j2_trades SET analytics_excluded = 1 WHERE id = ?", (tid,))
    conn.commit()
    assert _go()["count"] == 0 and seen["n"] == 2
    conn.execute("UPDATE j2_trades SET analytics_excluded = 0, setup = 'Breakout' WHERE id = ?",
                 (tid,))
    conn.commit()
    _go()
    conn.execute("UPDATE j2_trades SET setup = 'Breakout pullback' WHERE id = ?", (tid,))
    conn.commit()
    _go()
    assert seen["n"] == 4


def test_cache_bust_on_stop_added(conn, monkeypatch):
    tid = add_trade(conn, UID, day="2026-10-20", pnl=50, stop=100.0)   # a placeholder stop
    seen = _count_scans(monkeypatch)
    _go()
    conn.execute("UPDATE j2_trades SET original_stop = 95 WHERE id = ?", (tid,))
    conn.commit()
    _go()
    assert seen["n"] == 2


def test_data_stamp_per_source(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    with run._connection() as c:
        closed = run.data_stamp(c, UID, "closed_trades")
        days = run.data_stamp(c, UID, "trading_days")
        pos = run.data_stamp(c, UID, "open_positions")
    assert closed and days.startswith(closed) and pos != closed
    assert run.data_stamp.__doc__ and "same-length relabel" in run.data_stamp.__doc__


def test_settings_change_the_cache_key(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    add_trade(conn, UID, day="2026-08-01", pnl=10)
    seen = _count_scans(monkeypatch)
    a = _go()
    b = _go(settings={"range": {"token": "all"}})
    assert seen["n"] == 2 and (a["count"], b["count"]) == (1, 2)
    assert b["range"] == {"token": "all"}


# -- the daily counter ----------------------------------------------------------------------------

def _spy_take(monkeypatch):
    calls = []
    real = daily_counters.take

    def spy(day, charges):
        charges = list(charges)
        calls.append((day, charges))
        return real(day, charges)

    monkeypatch.setattr(run.daily_counters, "take", spy)
    return calls


def test_daily_counter_flush_at_most_once_a_minute(conn, monkeypatch):
    calls = _spy_take(monkeypatch)
    clock = {"t": 1000.0}
    monkeypatch.setattr(run, "_clock", lambda: clock["t"])
    for i in range(30):
        clock["t"] += 1.0                                        # 30 runs inside a minute
        run.count_run(UID)
    assert len(calls) == 1
    assert calls[0][1][0].scope == run.RUNS_SCOPE and calls[0][1][0].subject == UID
    clock["t"] += 61
    run.count_run(UID)
    assert len(calls) == 2
    day = calls[0][0]
    assert daily_counters.value(day, run.RUNS_SCOPE, UID) == 31


def test_daily_cap_reached_raises(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    day = run._et_day()
    daily_counters.take(day, [daily_counters.Charge(run.RUNS_SCOPE, UID, run.DAILY_RUN_CAP - 1)])
    assert not run.daily_cap_reached(UID)
    _go()                                                        # the 1,000th
    assert run.daily_cap_reached(UID)
    with pytest.raises(run.DailyCapReached):
        _go(settings={"range": {"token": "all"}})                # a new key: not a cache hit
    _go(lane="preview", settings={"range": {"token": "all"}})    # previews are not capped


def test_cache_hit_not_counted(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    _go()
    _go()
    _go()
    assert run._pending(UID) + daily_counters.value(run._et_day(), run.RUNS_SCOPE, UID) == 1


def test_preview_is_not_counted(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    _go(lane="preview")
    assert run._pending(UID) + daily_counters.value(run._et_day(), run.RUNS_SCOPE, UID) == 0


# -- settings -------------------------------------------------------------------------------------

def test_foreign_account_id_is_absent_with_notice(conn):
    other = "u-wrun-acc"
    add_user(conn, other)
    theirs = add_account(conn, other, "Their account")
    mine = add_account(conn, UID, "Mine")
    add_trade(conn, UID, day="2026-10-20", pnl=50, account=mine)
    add_trade(conn, other, day="2026-10-20", pnl=-999, account=theirs)
    out = _go(settings={"accountId": theirs})
    assert out["notice"] == run.S_ACCOUNT_GONE
    assert out["accountId"] is None and out["scopeLabel"] == "All my accounts"
    assert out["value"]["v1"] == 50
    # in the plan itself, the same
    out = _go(_plan(accounts={"id": theirs}))
    assert out["notice"] == run.S_ACCOUNT_GONE and out["value"]["v1"] == 50
    own = _go(settings={"accountId": mine})
    assert own["notice"] is None and own["accountId"] == mine and own["scopeLabel"] == "Mine"


def test_overridable_filter_value_comes_from_settings(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50, setup="Flag")
    add_trade(conn, UID, day="2026-10-20", pnl=30, setup="VCP")
    p = _plan(filters=[{"field": "setup", "op": "in", "values": ["Flag"], "overridable": True}])
    assert _go(p)["value"]["v1"] == 50
    out = _go(p, {"filter": ["VCP"]})
    assert out["value"]["v1"] == 30 and out["filter"] == ["VCP"]
    # without an overridable filter, a filter setting is ignored
    assert _go(_plan(), {"filter": ["VCP"]})["value"]["v1"] == 80


@pytest.mark.parametrize("settings", [
    {"filter": ["x" * 201]},
    {"filter": [str(i) for i in range(51)]},
    {"accountId": "a" * 201},
    {"range": {"token": "nope"}},
    {"filter": "Flag"},
])
def test_settings_are_bounded(conn, settings):
    from api.services.journal_two.widget_engine.plan import PlanError
    p = _plan(filters=[{"field": "setup", "op": "in", "values": ["Flag"], "overridable": True}])
    with pytest.raises(PlanError):
        _go(p, settings)


def test_long_account_name_is_clipped_in_scope_label(conn):
    aid = add_account(conn, UID, "N" * 300)
    add_trade(conn, UID, day="2026-10-20", pnl=50, account=aid)
    out = _go(settings={"accountId": aid})
    assert len(out["scopeLabel"]) <= 200


def test_sample_is_not_implemented_yet(conn):
    with pytest.raises(NotImplementedError):
        _go(sample=True)


def test_compare_previous_runs_the_previous_range(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    add_trade(conn, UID, day="2026-09-10", pnl=7)
    out = _go(_plan(compare={"mode": "previous"}, view={"type": "compare"}))
    assert out["value"]["v1"] == 50 and out["compare"]["v1"] == 7
    assert out["compareLabel"]


def test_def_ids_are_echoed(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    out = _go(def_id="w1", def_rev=2, latest_rev=3)
    assert (out["defId"], out["defRev"], out["latestRev"]) == ("w1", 2, 3)


def test_handler_cleared_after_a_run(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    seen = []
    real = run._connection

    from contextlib import contextmanager

    @contextmanager
    def spy():
        with real() as c:
            seen.append(c)
            yield c

    monkeypatch.setattr(run, "_connection", spy)
    _go()
    # the connection went back with no handler: a long query is not interrupted
    c = auth_db.get_connection()
    try:
        assert c.execute("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c"
                         " WHERE x < 200000) SELECT COUNT(*) FROM c").fetchone()[0] == 200000
    finally:
        c.close()
    assert seen


# -- fix round 1 ----------------------------------------------------------------------------------

def _two_accounts(conn):
    other = "u-wrun-fx"
    add_user(conn, other)
    theirs = add_account(conn, other, "Theirs")
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    return theirs


@pytest.mark.parametrize("foreign_first", [True, False])
def test_i1_foreign_setting_and_all_accounts_never_share_a_cached_notice(conn, foreign_first):
    theirs = _two_accounts(conn)
    runs = [({"accountId": theirs}, run.S_ACCOUNT_GONE), ({}, None)]
    if not foreign_first:
        runs.reverse()
    for settings, notice in runs + runs:                  # twice: the second pass reads the cache
        assert _go(settings=settings)["notice"] == notice


@pytest.mark.parametrize("foreign_first", [True, False])
def test_i1_foreign_plan_account_and_all_accounts_never_share_a_cached_notice(conn, foreign_first):
    theirs = _two_accounts(conn)
    runs = [(_plan(accounts={"id": theirs}), run.S_ACCOUNT_GONE), (_plan(), None)]
    if not foreign_first:
        runs.reverse()
    for p, notice in runs + runs:
        assert _go(p)["notice"] == notice


def _blocking_scan(monkeypatch):
    """`scan` blocks on the returned event when it runs on a thread named `blocker`."""
    gate = threading.Event()
    entered = threading.Event()
    real = run.wsources.scan

    def scan(*a, **k):
        if threading.current_thread().name == "blocker":
            entered.set()
            assert gate.wait(5)
        return real(*a, **k)

    monkeypatch.setattr(run.wsources, "scan", scan)
    return gate, entered


def _in_blocker(fn):
    box = {}

    def body():
        try:
            box["value"] = fn()
        except BaseException as e:  # noqa: BLE001
            box["error"] = e

    t = threading.Thread(target=body, name="blocker")
    t.start()
    return t, box


def test_i2_examples_neither_bump_nor_watch_the_preview_counter(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    gate, entered = _blocking_scan(monkeypatch)
    # a preview in flight, then two example runs: the preview is NOT superseded by them
    t, box = _in_blocker(lambda: _go(lane="preview"))
    assert entered.wait(5)
    a = _go(lane="example", settings={"range": {"token": "all"}})
    b = _go(lane="example", settings={"range": {"token": "last_7d"}})
    gate.set()
    t.join(5)
    assert "error" not in box and box["value"]["count"] == 1
    assert a["count"] == 1 and b["count"] == 1
    # an example in flight is not superseded by a preview
    gate.clear()
    entered.clear()
    t, box = _in_blocker(lambda: _go(lane="example", settings={"range": {"token": "ytd"}}))
    assert entered.wait(5)
    _go(lane="preview", settings={"range": {"token": "this_month"}})
    gate.set()
    t.join(5)
    assert "error" not in box


def test_i2_a_second_preview_still_supersedes_the_first(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    gate, entered = _blocking_scan(monkeypatch)
    t, box = _in_blocker(lambda: _go(lane="preview"))
    assert entered.wait(5)
    second = _go(lane="preview", settings={"range": {"token": "all"}})
    gate.set()
    t.join(5)
    assert isinstance(box.get("error"), run.Superseded) and second["count"] == 1


def test_i3_a_slow_take_never_holds_the_counter_lock(monkeypatch):
    started = threading.Event()

    def slow_take(day, charges):
        if list(charges)[0].subject == "slow":             # only the first member's flush is slow
            started.set()
            time.sleep(1.0)
        return None

    monkeypatch.setattr(run.daily_counters, "take", slow_take)
    t = threading.Thread(target=run.count_run, args=("slow",))
    t.start()
    assert started.wait(5)
    t0 = time.perf_counter()
    assert run._pending("other") == 0
    run.count_run("other-2")                              # another member counts meanwhile
    assert time.perf_counter() - t0 < 0.5                  # not blocked behind the 1 s take
    t.join(5)


def test_i3_a_failed_take_puts_the_count_back(monkeypatch):
    def broken_take(day, charges):
        raise RuntimeError("database gone")

    monkeypatch.setattr(run.daily_counters, "take", broken_take)
    run.count_run("f")
    assert run._pending("f") == 1                          # kept for the next flush


def test_m3_a_date_move_and_a_side_flip_bust_the_cache(conn, monkeypatch):
    tid = add_trade(conn, UID, day="2026-10-20", pnl=50)
    seen = _count_scans(monkeypatch)
    _go()
    conn.execute("UPDATE j2_trades SET exit_date = '2026-10-21T18:00:00Z' WHERE id = ?", (tid,))
    conn.commit()
    _go()
    conn.execute("UPDATE j2_trades SET side = 'Short' WHERE id = ?", (tid,))
    conn.commit()
    _go()
    assert seen["n"] == 3


def test_m5_a_filter_setting_without_an_overridable_filter_is_neither_echoed_nor_keyed(
        conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    seen = _count_scans(monkeypatch)
    a = _go()
    b = _go(settings={"filter": ["VCP"]})
    assert seen["n"] == 1 and b["filter"] is None and a == b


def test_m6_run_plan_states_the_def_id_precondition():
    assert "resolve_for_run" in run.run_plan.__doc__ and "foreign" in run.run_plan.__doc__


def test_m1_the_cap_docstring_states_the_overshoot():
    assert "overshoot" in run.daily_cap_reached.__doc__


# -- spec 5.7: the 50,000-trade budget (opt-in) ----------------------------------------------------

@pytest.mark.skipif(os.environ.get("UCT_WIDGET_50K") != "1",
                    reason="seeding 50,000 trades is slow; set UCT_WIDGET_50K=1 to measure")
def test_run_50k_trades_under_budget(conn, monkeypatch, capsys):
    setups = ["Flag", "VCP", "Breakout", "Pullback", None, "Gap", "EP", "Base"]
    rows = []
    for i in range(50_000):
        day = f"2026-{(i % 9) + 1:02d}-{(i % 28) + 1:02d}"
        rows.append((str(uuid.uuid4()), UID, "manual", "NVDA", "Long", 10, 100.0, f"{day}T14:00:00Z",
                     110.0, f"{day}T18:00:00Z", 95.0, setups[i % len(setups)],
                     float((i % 21) - 10) * 10, 0.01, 1.0, 1, "Win" if i % 2 else "Loss", "{}",
                     "x", day, 10, 0.5, 0))
    conn.executemany(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,
               exit_price, exit_date, original_stop, setup, pnl_dollar, pnl_percent, r_multiple,
               hold_days, result, context_at_entry, created_at, trading_day_et, hour_et, fees,
               analytics_excluded)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    conn.commit()
    p = raw_plan(range={"token": "all"}, measures=("net_pnl", "win_rate", "expectancy_r"),
                 split={"by": "setup"})
    timing = {"sql": 0.0}
    real_scan = run.wsources.scan

    def timed_scan(*a, **k):
        t = time.perf_counter()
        try:
            return real_scan(*a, **k)
        finally:
            timing["sql"] += time.perf_counter() - t

    monkeypatch.setattr(run.wsources, "scan", timed_scan)
    with run._connection() as c:                           # M2: the pre-admission reads
        t1 = time.perf_counter()
        run.data_stamp(c, UID, "closed_trades")
        run.wsources.owned_account_id(c, UID, None)
        run.wsources._account_names(c, UID)
        pre = time.perf_counter() - t1
    t0 = time.perf_counter()
    out = _go(p)
    total = time.perf_counter() - t0
    py = total - timing["sql"]
    with capsys.disabled():
        print(f"\n50k reading: scan (SQL + row shaping) {timing['sql']:.3f}s, rest (Python) "
              f"{py:.3f}s, total {total:.3f}s, capped={out['capped']}, count={out['count']}, "
              f"stamp+ownership {pre:.3f}s")
    assert out["capped"] is True and out["count"] == 5000
    assert timing["sql"] < 1.5 and py < 1.0
