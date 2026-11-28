"""W and M stay as current as the live daily (2026-11-25 wide sweep, the paint builder's findings).

On 23 of 30 W/M presses the answer came from the stored W/M table, DAYS behind (Server-Timing `bars(stale-swr)`; in the
sweep's W2 board every one of the 69 W/M answers served from the store was `stale-swr`, the rest from the memory cache),
with an old close (-6..-10%). The stale-while-revalidate refresh re-asks the provider for recent dailies in the
background, and under load it did not land. The daily itself is kept current by the live store's whole-market snapshot
(`bars_live_store.covered(t, "D")`: alive, seen, CONTIGUOUS), so a W/M series is derived from the STORED daily on read:
the periods from the one holding the stored W/M tail are rebuilt from the daily rows and written when they differ, and
`_needs_fresh` reads a W/M tail that holds exactly that derivation as fresh. No provider call. All data synthetic.
"""
import json
import threading
import time
from datetime import date, timedelta

import pytest

from api.services import bars_fetch, bars_live_store as bls, bars_sqlite


def _sessions(n):
    """The last `n` weekdays through the most recent NYSE session (the store's own clock), oldest first."""
    last = bars_fetch._last_weekday_yyyymmdd()
    d = date(last // 10000, last // 100 % 100, last % 100)
    out = []
    while len(out) < n:
        if d.weekday() < 5 and bars_fetch._is_trading_day_ymd(d):
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


def _assert_delta_pools_free(timeout=10.0):
    """Both bounded-delta pools hold every permit: no thread from an earlier test (here or in another file) still owns a
    slot. Waits up to `timeout` for a straggler to finish, then FAILS naming the pool (a leak elsewhere, never this test)."""
    for name, size in (("_date_delta_sem", bars_fetch._DATE_DELTA_MAX), ("_date_delta_warm_sem", bars_fetch._DATE_DELTA_WARM_MAX)):
        sem, got, deadline = getattr(bars_fetch, name), 0, time.monotonic() + timeout
        while got < size and sem.acquire(timeout=max(0.0, deadline - time.monotonic())):
            got += 1
        for _ in range(got):
            sem.release()
        assert got == size, f"bars_fetch.{name}: {size - got} of {size} slots still held by an earlier test's thread"


@pytest.fixture
def store(monkeypatch, tmp_path):
    # ⛔ ISOLATION (2026-11-28: the merge queue's bars rails, ONE process of ~2,290 tests on a slower runner, went red
    # here only in company). The request budget is THREAD-local, so a file that starts one and never ends it hands this
    # test an EXPIRED budget and the bounded W/M delta gives up at once ('delta-deadline'); and a slot another test's
    # thread still holds does the same. Every rail here starts with no budget and both delta pools free.
    bars_fetch.end_request_budget()
    _assert_delta_pools_free()
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite._drop_local_conn()
    bars_sqlite.init_db()
    bls._reset_for_tests()

    def _no_provider(*a, **k):
        raise AssertionError("a W/M read on a live daily must not reach a provider")
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_fetch_daily_full"):
        if hasattr(bars_fetch, name):
            monkeypatch.setattr(bars_fetch, name, _no_provider)
    for _p in ("bars_AAA_", "dhole_", "towin_", "towinfail_"):   # no marker leaks into, or out of, a test
        bars_fetch.cache.delete_prefix(_p)
    yield
    bars_fetch.end_request_budget()
    bars_sqlite._drop_local_conn()
    bls._reset_for_tests()


def _seed(tf, stale=False, live=True, monkeypatch=None, sym="AAA", daily_ends_back=0):
    """The live daily, and the W/M table built from it. `stale`: the CURRENT period as a days-old table holds it, a VALID
    bar with old values (close at the period's low, a smaller volume): one the impossible-bar gate takes, so the store
    really holds a present-but-stale row (review of #2742: a close outside the bar's own range was refused by the gate,
    and the rails then tested an ABSENT period instead)."""
    days = _sessions(130 + daily_ends_back)
    if daily_ends_back:
        days = days[:-daily_ends_back]   # the stored daily ends `daily_ends_back` sessions before the latest one
    daily = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
             for i, d in enumerate(days)]
    bars_sqlite.put_bars(sym, "D", daily, date_tf=True)
    periods = (bars_fetch._resample_weekly_iso(daily) if tf == "W" else bars_fetch._resample_monthly_iso(daily))
    stored = [dict(p) for p in periods]
    if stale:
        stored[-1]["c"] = stored[-1]["l"]
        stored[-1]["v"] = int(stored[-1]["v"]) - 1
    bars_sqlite.put_bars(sym, tf, stored, date_tf=True)
    # the seed itself round-trips: the store holds exactly the row this test means (present, and stale if asked)
    held = bars_sqlite.get_bars(sym, tf, 2)
    assert int(held[-1][0]) == int(periods[-1]["t"].replace("-", "")), "the seed's current period is not in the store"
    if stale:
        assert float(held[-1][4]) == float(stored[-1]["c"]) != float(daily[-1]["c"]), "the stale row did not land"
    monkeypatch.setattr(bls, "covered", lambda t, k: live and k == "D")
    return daily, periods


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_stale_current_period_on_a_live_daily_is_served_current_from_the_store(store, monkeypatch, tf):
    daily, periods = _seed(tf, stale=True, monkeypatch=monkeypatch)
    n = len(periods)
    resp = bars_fetch._get_bars_inner("AAA", tf, n)
    body = json.loads(resp.body)
    assert body["bars"][-1]["c"] == daily[-1]["c"], "the current period kept its days-old close"
    assert bars_fetch.get_serve_layer() == "sqlite", bars_fetch.get_serve_layer()


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_period_holding_the_derivation_is_fresh(store, monkeypatch, tf):
    daily, periods = _seed(tf, monkeypatch=monkeypatch)
    last = int(periods[-1]["t"].replace("-", ""))
    assert bars_fetch._needs_fresh(last, tf, "AAA") is False


# ⛔⛔ (2026-11-28, the cold-coverage sweep; production: 16 of 19 rarely viewed names) OFF-HOURS, OR A NAME OUTSIDE THE
# SNAPSHOT: the live store does not cover the daily (its snapshot is not flowing), yet the STORED daily runs into the
# present. The first W/M answer served the days-old W/M table (a developing month two weeks behind its own daily).
@pytest.mark.parametrize("tf", ["W", "M"])
def test_off_hours_a_stored_daily_that_runs_into_the_present_derives_the_first_answer(store, monkeypatch, clock, tf):
    clock(2026, 11, 21, 12, 0)     # Saturday: off-hours by construction, never the CI runner's wall clock
    daily, periods = _seed(tf, stale=True, live=False, monkeypatch=monkeypatch)
    resp = bars_fetch._get_bars_inner("AAA", tf, len(periods))
    body = json.loads(resp.body)
    assert body["bars"][-1]["c"] == daily[-1]["c"], "the first answer kept the stored table's old close"


@pytest.mark.parametrize("tf", ["W", "M"])
def test_off_hours_a_period_holding_the_derivation_is_fresh(store, monkeypatch, clock, tf):
    clock(2026, 11, 21, 12, 0)
    daily, periods = _seed(tf, live=False, monkeypatch=monkeypatch)
    last = int(periods[-1]["t"].replace("-", ""))
    assert bars_fetch._needs_fresh(last, tf, "AAA") is False


def test_control_without_a_live_daily_and_a_stored_daily_behind_nothing_changes(store, monkeypatch):
    # the stored daily ends a week before the latest session: it is stale itself, so nothing is derived from it
    daily, periods = _seed("W", stale=True, live=False, monkeypatch=monkeypatch, daily_ends_back=5)
    last = int(periods[-1]["t"].replace("-", ""))
    assert bars_fetch._wm_stored_daily_current("AAA") is False
    assert bars_fetch._needs_fresh(last, "W", "AAA") is True
    assert bars_fetch._needs_fresh(last, "W") is True            # no ticker: the old rule, unchanged


def test_the_stored_daily_is_current_through_the_previous_session(store, monkeypatch, clock):
    # the boundary, before the open (review of #3001: from the open on a session day it is today's bar, rails below):
    # newest daily bar = the previous session is current; one more back is not
    clock(2026, 11, 18, 8, 0)
    prev = 20261117
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda t, tf: prev)
    assert bars_fetch._wm_stored_daily_current("AAA") is True
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda t, tf: prev - 1 if prev % 100 > 1 else prev - 100)
    assert bars_fetch._wm_stored_daily_current("AAA") is False


# ⛔ (review of #2742, MEDIUM-1) THE ANSWER NEVER WAITS FOR THE WRITE. In session the developing daily moves every few
# seconds, so nearly every cache-miss read has a W/M period to rewrite; a read that waited for that write (0.75 s at most)
# and then, on a missed deadline, fell back to the days-old table or a provider fetch is what this must not do. The answer
# carries the derived periods whatever the write's fate (background, deduped, never awaited), and Server-Timing shows the
# derive's cost (`wm_drv`).
def _slow_wm_writes(monkeypatch, gate):
    real = bars_sqlite.put_bars

    def put(ticker, tf, bars, *a, **k):
        if tf in ("W", "M"):
            gate.wait(30)
        return real(ticker, tf, bars, *a, **k)
    monkeypatch.setattr(bars_sqlite, "put_bars", put)


@pytest.mark.parametrize("tf", ["W", "M"])
def test_the_answer_never_waits_for_the_write(store, monkeypatch, tf):
    daily, periods = _seed(tf, stale=True, monkeypatch=monkeypatch)
    gate = threading.Event()
    _slow_wm_writes(monkeypatch, gate)
    try:
        t0 = time.monotonic()
        resp = bars_fetch._get_bars_inner("AAA", tf, len(periods))
        took = time.monotonic() - t0
        body = json.loads(resp.body)
        assert took < 5.0, f"the read waited {took:.2f} s for the W/M write (it blocks 30 s)"
        assert body["bars"][-1]["c"] == daily[-1]["c"]
        assert bars_fetch.get_serve_layer() == "sqlite"
        assert "wm_drv" in [m[0] for m in bars_fetch.get_serve_marks()], "the derive cost is not on Server-Timing"
    finally:
        gate.set()


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_refused_write_still_answers_the_derived_period(store, monkeypatch, tf):
    daily, periods = _seed(tf, stale=True, monkeypatch=monkeypatch)
    real = bars_sqlite.put_bars
    monkeypatch.setattr(bars_sqlite, "put_bars",
                        lambda ticker, k, bars, *a, **kw: 0 if k in ("W", "M") else real(ticker, k, bars, *a, **kw))
    body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(periods)).body)
    assert body["bars"][-1]["c"] == daily[-1]["c"]
    assert bars_fetch.get_serve_layer() == "sqlite"


@pytest.mark.parametrize("tf", ["W", "M"])
def test_the_background_write_round_trips_through_the_real_store_to_fresh(store, monkeypatch, tf):
    """(review of #2742, LOW) The fix must not be silently inert: what the read derives and writes in the background,
    read back from the REAL store, equals the derivation (rounding, the gate), so the next read needs no write."""
    daily, periods = _seed(tf, stale=True, monkeypatch=monkeypatch)
    last = int(periods[-1]["t"].replace("-", ""))
    assert bars_fetch._needs_fresh(last, tf, "AAA") is True          # the stale row: not fresh
    bars_fetch._get_bars_inner("AAA", tf, len(periods))
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and bars_fetch._needs_fresh(last, tf, "AAA"):
        time.sleep(0.05)
    assert bars_fetch._needs_fresh(last, tf, "AAA") is False, "the store never came to equal the derivation"
    stored = bars_sqlite.get_bars("AAA", tf, 3)
    assert float(stored[-1][4]) == float(daily[-1]["c"])


# ⛔ (review of #2742, round 2) THE BACKGROUND WRITES ARE CAPPED. A W/M warm over 500 names started a write thread per
# name (~1000), all fighting for the SQLite write lock the live store's 1m/5m/D pushes use (the late pushes #2738 is
# about). A write that finds no slot is SKIPPED: the answer still carries the derived bars, and a later read writes.
def test_many_concurrent_reads_start_at_most_the_capped_writes_and_every_answer_carries_the_derivation(store, monkeypatch):
    syms = [f"S{i:02d}" for i in range(12)]
    want = {}
    for sym in syms:
        daily, periods = _seed("W", stale=True, monkeypatch=monkeypatch, sym=sym)
        want[sym] = (daily[-1]["c"], len(periods))
        bars_fetch.cache.delete_prefix(f"bars_{sym}_")
    gate, lock, live = threading.Event(), threading.Lock(), {"now": 0, "max": 0, "calls": 0}
    real = bars_sqlite.put_bars

    def put(ticker, tf, bars, *a, **k):
        if tf not in ("W", "M"):
            return real(ticker, tf, bars, *a, **k)
        with lock:
            live["now"] += 1
            live["calls"] += 1
            live["max"] = max(live["max"], live["now"])
        try:
            gate.wait(5)
            return real(ticker, tf, bars, *a, **k)
        finally:
            with lock:
                live["now"] -= 1
    monkeypatch.setattr(bars_sqlite, "put_bars", put)
    out, errs = {}, []

    def read(sym):
        try:
            out[sym] = json.loads(bars_fetch._get_bars_inner(sym, "W", want[sym][1]).body)["bars"][-1]["c"]
        except Exception as e:  # noqa: BLE001
            errs.append(repr(e))
    threads = [threading.Thread(target=read, args=(sym,)) for sym in syms]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    time.sleep(0.2)
    started = live["max"]
    gate.set()
    assert errs == []
    assert all(out.get(sym) == want[sym][0] for sym in syms), "an answer lacked the derived bar"
    assert started <= bars_fetch.WM_WRITE_SLOTS, f"{started} W/M writes ran at once"
    assert bars_fetch.WM_WRITE_SLOTS <= 2


# ── review of #3001, F1: THE BAR THE STORED DAILY MUST REACH ──────────────────────────────────────────────────────────
# ⛔⛔ On a SESSION DAY once the open has passed (half days included), a stored daily that ends YESTERDAY is not current:
# today's session is missing from it. Deriving W/M from it served a period WITHOUT today, turned revalidation off
# (`_fresh_needed = False`), and its background write put that older close OVER a stored W/M row `_delta_weekly`/
# `_delta_monthly` had already brought through today (they write W/M, never D, so the W/M row can be ahead of the D).
# The bar it must reach is today's ET date then, the previous session otherwise (pre-market, overnight, weekend,
# holiday). ET, never `_last_weekday_yyyymmdd` (utcnow runs a day ahead after 19:00/20:00 ET). All clocks pinned.
from datetime import datetime as _real_dt, timezone as _tz
from zoneinfo import ZoneInfo as _ZoneInfo

_ET = _ZoneInfo("America/New_York")


@pytest.fixture
def clock(monkeypatch):
    """Pin bars_fetch's clock (ET `now`, and `utcnow` for the old D/W/M rule) to one ET wall time."""
    def pin(y, m, d, hh, mm=0):
        at = _real_dt(y, m, d, hh, mm, tzinfo=_ET)

        class _Frozen(_real_dt):
            @classmethod
            def now(cls, tz=None):
                return at.astimezone(tz) if tz is not None else at.replace(tzinfo=None)

            @classmethod
            def utcnow(cls):
                return at.astimezone(_tz.utc).replace(tzinfo=None)
        monkeypatch.setattr(bars_fetch, "datetime", _Frozen)
        # the daily poll succeeded at this instant (after the latest session's close whenever `at` is off-hours);
        # the residual's rails override it (review of #3001)
        monkeypatch.setitem(bls._state, "daily_last_ok_wall", at.timestamp())
        return at
    return pin


def _sessions_through(last, n=130):
    out, d = [], last
    while len(out) < n:
        if bars_fetch._is_trading_day_ymd(d):
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


def _seed_through(tf, last, monkeypatch, stored_extra=None, sym="AAA"):
    """A stored daily ending `last` (uncovered: the live store does not cover it) and a STALE stored W/M tail (close at
    the low, a smaller volume). `stored_extra`: one more daily bar the W/M table holds and the D does not (the W/M row
    `_delta_weekly`/`_delta_monthly` brought further than the stored D)."""
    daily = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
             for i, d in enumerate(_sessions_through(last))]
    bars_sqlite.put_bars(sym, "D", daily, date_tf=True)
    rs = bars_fetch._resample_weekly_iso if tf == "W" else bars_fetch._resample_monthly_iso
    if stored_extra is not None:
        stored = [dict(p) for p in rs(daily + [stored_extra])]
    else:
        stored = [dict(p) for p in rs(daily)]
        stored[-1]["c"] = stored[-1]["l"]
        stored[-1]["v"] = int(stored[-1]["v"]) - 1
    bars_sqlite.put_bars(sym, tf, stored, date_tf=True)
    monkeypatch.setattr(bls, "covered", lambda t, k: False)
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_delta_daily"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: [])   # the old path's revalidation: quiet, no provider
    return daily, rs(daily), stored


def _overlay(tf, sym="AAA"):
    return bars_fetch._wm_overlay(sym, tf, bars_sqlite.get_bars(sym, tf, 400), 400)


WED, TUE = date(2026, 11, 18), date(2026, 11, 17)


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("hh,mm", [(16, 30), (21, 0)])   # after the RTH close; 21:00 ET is already Thursday in UTC
def test_after_the_close_a_stored_daily_ending_yesterday_derives_nothing(store, monkeypatch, clock, tf, hh, mm):
    clock(2026, 11, 18, hh, mm)
    _seed_through(tf, TUE, monkeypatch)
    assert bars_fetch._wm_live_daily("AAA") is False, "a stored daily missing today's session read as current"
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("hh,mm", [(9, 30), (11, 0), (15, 59)])
def test_in_rth_an_uncovered_stored_daily_ending_yesterday_derives_nothing(store, monkeypatch, clock, tf, hh, mm):
    clock(2026, 11, 18, hh, mm)
    _seed_through(tf, TUE, monkeypatch)
    assert bars_fetch._wm_live_daily("AAA") is False
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("hh,mm", [(20, 0), (21, 0), (23, 59)])   # after the live daily window (until 20:00 ET)
def test_after_the_close_a_stored_daily_holding_today_derives(store, monkeypatch, clock, tf, hh, mm):
    clock(2026, 11, 18, hh, mm)
    daily, periods, _ = _seed_through(tf, WED, monkeypatch)
    body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(periods)).body)
    assert body["bars"][-1]["c"] == daily[-1]["c"], "a stored daily holding today's session derived nothing"


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("at,last", [
    ((2026, 11, 18, 8, 0), TUE),                   # pre-market: the previous session is the newest there is
    ((2026, 11, 18, 2, 0), TUE),                   # overnight
    ((2026, 11, 18, 9, 29), TUE),                  # one minute before the open
    ((2026, 11, 21, 12, 0), date(2026, 11, 20)),   # Saturday
    ((2026, 11, 22, 20, 0), date(2026, 11, 20)),   # Sunday evening (Monday in UTC)
    ((2026, 11, 26, 12, 0), date(2026, 11, 25)),   # Thanksgiving: not a session, the open never comes
])
def test_off_hours_a_stored_daily_through_the_previous_session_still_derives(store, monkeypatch, clock, tf, at, last):
    clock(*at)
    daily, periods, _ = _seed_through(tf, last, monkeypatch)
    assert bars_fetch._wm_live_daily("AAA") is True
    body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(periods)).body)
    assert body["bars"][-1]["c"] == daily[-1]["c"]


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("hh", [10, 14])   # the half day after Thanksgiving: in its short session, and after its 13:00 close
def test_a_half_day_is_a_session_once_open(store, monkeypatch, clock, tf, hh):
    clock(2026, 11, 27, hh)
    _seed_through(tf, date(2026, 11, 25), monkeypatch)
    assert bars_fetch._wm_live_daily("AAA") is False
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_stored_wm_row_ahead_of_the_stored_daily_is_never_overwritten(store, monkeypatch, clock, tf):
    # the stored W/M row already holds Wednesday (written by `_delta_weekly`/`_delta_monthly`), the stored D ends Tuesday
    clock(2026, 11, 18, 8, 0)   # a clock at which a daily ending Tuesday passes the gate: only the ahead-guard can stop it
    extra = {"t": WED.isoformat(), "o": 300.0, "h": 320.0, "l": 290.0, "c": 310.0, "v": 9999}
    daily, periods, stored = _seed_through(tf, TUE, monkeypatch, stored_extra=extra)
    key = int(stored[-1]["t"].replace("-", ""))
    assert int(periods[-1]["t"].replace("-", "")) == key, "the seed's stored tail is not the D tail's period"
    writes = []
    real = bars_sqlite.put_bars

    def spy(t, k, b, *a, **kw):
        if k in ("W", "M"):
            writes.append(k)
        return real(t, k, b, *a, **kw)
    monkeypatch.setattr(bars_sqlite, "put_bars", spy)
    assert _overlay(tf) is None, "the overlay derived over a stored W/M row newer than its daily"
    body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(periods)).body)
    assert body["bars"][-1]["c"] == 310.0, "the answer served the older D-derived close"
    time.sleep(0.3)
    held = {int(r[0]): r for r in bars_sqlite.get_bars("AAA", tf, 3)}
    assert float(held[key][4]) == 310.0 and int(held[key][5]) == int(stored[-1]["v"]), "the newer row was overwritten"
    assert writes == [], writes


# ── review of #3001, LOW: off-hours W/M keep the normal TTL; one stored-daily read per request ──────────────────────
@pytest.mark.parametrize("tf", ["W", "M"])
def test_an_uncovered_derived_answer_keeps_the_normal_ttl(store, monkeypatch, clock, tf):
    clock(2026, 11, 21, 12, 0)   # Saturday: nothing moves, 500 members must not re-derive every 10 s
    daily, periods, _ = _seed_through(tf, date(2026, 11, 20), monkeypatch)
    ttls = []
    real_set = bars_fetch.cache.set

    def spy(k, v, ttl=None, **kw):
        ttls.append(ttl)
        return real_set(k, v, ttl=ttl, **kw)
    monkeypatch.setattr(bars_fetch.cache, "set", spy)
    resp = bars_fetch._get_bars_inner("AAA", tf, len(periods))
    assert json.loads(resp.body)["bars"][-1]["c"] == daily[-1]["c"]
    assert ttls and min(ttls) > bls.covered_cache_ttl(tf, 0), ttls
    assert f"max-age={bars_fetch._CACHE_TTL[tf]}" in resp.headers["cache-control"], resp.headers["cache-control"]


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_covered_derived_answer_keeps_the_short_ttl(store, monkeypatch, tf):
    daily, periods = _seed(tf, stale=True, monkeypatch=monkeypatch)
    resp = bars_fetch._get_bars_inner("AAA", tf, len(periods))
    assert f"max-age={bls.covered_cache_ttl(tf, 0)}" in resp.headers["cache-control"], resp.headers["cache-control"]


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_derived_answer_reads_the_stored_daily_tail_once(store, monkeypatch, clock, tf):
    clock(2026, 11, 21, 12, 0)
    daily, periods, _ = _seed_through(tf, date(2026, 11, 20), monkeypatch)
    calls = []
    real = bars_sqlite.get_last_ts

    def spy(t, k):
        calls.append(k)
        return real(t, k)
    monkeypatch.setattr(bars_sqlite, "get_last_ts", spy)
    body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(periods)).body)
    assert body["bars"][-1]["c"] == daily[-1]["c"]
    assert calls.count("D") == 1, calls


# ── delta review of #3001, (d): IN THE LIVE WINDOW ONLY A LIVE DAILY DERIVES; NEVER FROM A DAILY WITH A HOLE ─────────
# ⛔⛔ A stored daily can hold TODAY's bar in session while `covered(t, "D")` is False: a snapshot name whose D has a
# hole (the poll writes today's row for every snapshot ticker; `covered` also needs `_daily_contiguous`), a dead daily
# poll, a name outside the snapshot whose D a D read refreshed. Deriving from it set `_fresh_needed = False` and pinned
# W/M for 900 s with no revalidation, and an EARLIER completed period was rewritten from the holed daily.
def _seed_holed(tf, last, hole, monkeypatch, drop_tail=0, sym="AAA"):
    """A stored D missing the session `hole`, and a stored W/M table that is correct: with `drop_tail`, built from the
    FULL daily with the last periods absent (the stored tail is an earlier, COMPLETED period); otherwise built from the
    sessions before the hole (an older, smaller developing tail)."""
    full = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
            for i, d in enumerate(_sessions_through(last))]
    holed = [b for b in full if b["t"] != hole.isoformat()]
    assert len(holed) == len(full) - 1, "the hole is not a session of the seed"
    bars_sqlite.put_bars(sym, "D", holed, date_tf=True)
    rs = bars_fetch._resample_weekly_iso if tf == "W" else bars_fetch._resample_monthly_iso
    if drop_tail:
        stored = [dict(p) for p in rs(full)][:-drop_tail]
    else:
        # an OLDER stored tail: built from the sessions before the hole, so it has LESS volume than the holed derive and
        # the ahead guard (`_wm_ahead_of_daily`) cannot be what stops the derive; only the contiguity check can
        stored = [dict(p) for p in rs([b for b in full if b["t"] < hole.isoformat()])]
    bars_sqlite.put_bars(sym, tf, stored, date_tf=True)
    monkeypatch.setattr(bls, "covered", lambda t, k: False)
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_delta_daily"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: [])
    return full, holed, stored


def _spy_wm_writes(monkeypatch):
    writes = []
    real = bars_sqlite.put_bars

    def spy(t, k, b, *a, **kw):
        if k in ("W", "M"):
            writes.append((k, [x["t"] for x in b]))
        return real(t, k, b, *a, **kw)
    monkeypatch.setattr(bars_sqlite, "put_bars", spy)
    return writes


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("hh,mm", [(9, 30), (11, 0), (16, 30), (19, 59)])
def test_in_the_live_window_an_uncovered_stored_daily_holding_today_derives_nothing(store, monkeypatch, clock, tf, hh, mm):
    clock(2026, 11, 18, hh, mm)
    _seed_through(tf, WED, monkeypatch)            # the stored D already holds today's bar; the live store does not cover it
    assert bars_fetch._wm_live_daily("AAA") is False, "an uncovered stored daily derived inside the live window"
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf", ["W", "M"])
def test_on_a_half_day_the_live_window_still_runs_until_the_poll_stops(store, monkeypatch, clock, tf):
    clock(2026, 11, 27, 14, 0)                     # after the 13:00 half-day close, the daily poll still runs
    _seed_through(tf, date(2026, 11, 27), monkeypatch)
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf,hole", [("W", date(2026, 11, 18)), ("M", date(2026, 11, 10))])
def test_a_daily_with_a_hole_inside_the_derived_span_derives_nothing(store, monkeypatch, clock, tf, hole):
    clock(2026, 11, 21, 12, 0)                     # Saturday: outside the window, the D through Friday passes the gate
    full, holed, stored = _seed_holed(tf, date(2026, 11, 20), hole, monkeypatch)
    writes = _spy_wm_writes(monkeypatch)
    assert _overlay(tf) is None, "W/M were derived from a daily with a hole"
    bars_fetch._get_bars_inner("AAA", tf, len(stored))
    time.sleep(0.3)
    assert writes == [], writes


@pytest.mark.parametrize("tf,hole", [("W", date(2026, 11, 11)), ("M", date(2026, 10, 14))])
@pytest.mark.parametrize("covered", [False, True])
def test_an_earlier_completed_period_is_never_rewritten_from_a_daily_with_a_hole(store, monkeypatch, clock, tf, hole, covered):
    # the stored tail is the COMPLETED week of 11-13 / month of October, correct; the stored D lacks one of its sessions
    clock(2026, 11, 21, 12, 0)
    full, holed, stored = _seed_holed(tf, date(2026, 11, 20), hole, monkeypatch, drop_tail=1)
    if covered:
        monkeypatch.setattr(bls, "covered", lambda t, k: k == "D")
    key = int(stored[-1]["t"].replace("-", ""))
    before = tuple(bars_sqlite.get_bars("AAA", tf, 400)[-1])
    assert int(before[0]) == key
    writes = _spy_wm_writes(monkeypatch)
    assert _overlay(tf) is None, "an earlier completed period was re-derived from a daily with a hole"
    assert bars_fetch._needs_fresh(key, tf, "AAA") is True     # the old path revalidates it (no derive reads it fresh)
    time.sleep(0.3)
    held = {int(r[0]): tuple(r) for r in bars_sqlite.get_bars("AAA", tf, 400)}
    assert held[key] == before, "the completed period was overwritten"
    assert writes == [], writes


def test_the_contiguity_check_reads_sessions_not_weekdays():
    # a holiday is not a hole; a row on a non-session day is not a session
    rows = [(d, 0, 0, 0, 0, 0) for d in (20261123, 20261124, 20261125, 20261127)]   # 11-26 is Thanksgiving
    assert bars_fetch._wm_daily_contiguous(rows, 20261123) is True
    assert bars_fetch._wm_daily_contiguous(rows[:2] + rows[3:], 20261123) is False   # 11-25 missing
    assert bars_fetch._wm_daily_contiguous(rows + [(20261128, 0, 0, 0, 0, 0)], 20261123) is False   # a Saturday row


# ── review of #3001, (b): IN RTH AN UNCOVERED NAME'S FIRST M ANSWER IS THE CURRENT DEVELOPING MONTH ─────────────────
# ⛔⛔ the stored M row can be WEEKS old (ACIW M 61.26 against its 52.24 daily); uncovered = outside the snapshot, any
# name that did not print the previous session, every name after a day the poll was down. (1) the serve chokepoint
# rebuilds the developing month (as it did the week) from a daily holding every session of it; (2) a daily with a
# hole cannot, so a stored W/M behind it goes to the bounded synchronous provider delta before the first answer.
def _seed_old_tail(tf, last, monkeypatch, hole=None, sym="AAA", old_sessions=10):
    """A stored D through `last` (missing `hole` if given) and a stored W/M table built from the daily as it stood
    `old_sessions` sessions earlier: its current-period row is weeks old (smaller volume, an older close)."""
    full = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
            for i, d in enumerate(_sessions_through(last))]
    stored_d = [b for b in full if hole is None or b["t"] != hole.isoformat()]
    bars_sqlite.put_bars(sym, "D", stored_d, date_tf=True)
    rs = bars_fetch._resample_weekly_iso if tf == "W" else bars_fetch._resample_monthly_iso
    stored = [dict(p) for p in rs(full[:-old_sessions])]
    bars_sqlite.put_bars(sym, tf, stored, date_tf=True)
    monkeypatch.setattr(bls, "covered", lambda t, k: False)
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_delta_daily"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: [])
    return full, stored


def test_in_rth_an_uncovered_name_with_a_weeks_old_month_answers_the_current_month_first(store, monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    full, stored = _seed_old_tail("M", WED, monkeypatch)
    assert stored[-1]["t"] == "2026-11-01" and stored[-1]["c"] != full[-1]["c"]
    body = json.loads(bars_fetch._get_bars_inner("AAA", "M", len(stored)).body)
    tail = body["bars"][-1]
    assert tail["t"] == "2026-11-01" and tail["c"] == full[-1]["c"], "the first M answer kept a weeks-old close"
    assert tail["v"] == sum(b["v"] for b in full if b["t"] >= "2026-11-01")


def test_the_developing_week_is_never_rebuilt_from_a_daily_with_a_hole(store, monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    full, stored = _seed_old_tail("W", WED, monkeypatch, hole=TUE, old_sessions=2)   # stored W: Monday only
    rows = bars_sqlite.get_bars("AAA", "W", 400)
    out = bars_fetch._fmt_sqlite_bars(rows, "W", "AAA")
    assert out[-1]["c"] == stored[-1]["c"], "the week was rebuilt from a daily missing Tuesday"


def test_the_developing_month_is_never_rebuilt_from_a_daily_with_a_hole(store, monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    full, stored = _seed_old_tail("M", WED, monkeypatch, hole=date(2026, 11, 10))
    out = bars_fetch._fmt_sqlite_bars(bars_sqlite.get_bars("AAA", "M", 400), "M", "AAA")
    assert out[-1]["c"] == stored[-1]["c"]


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_stored_wm_behind_a_holed_daily_is_answered_from_the_provider_first(store, monkeypatch, clock, tf):
    clock(2026, 11, 18, 11, 0)
    hole = TUE if tf == "W" else date(2026, 11, 10)
    full, stored = _seed_old_tail(tf, WED, monkeypatch, hole=hole, old_sessions=2 if tf == "W" else 10)
    rs = bars_fetch._resample_weekly_iso if tf == "W" else bars_fetch._resample_monthly_iso
    provider = dict(rs(full)[-1])                                   # the provider's own developing period, with a
    provider["c"] = provider["h"]                                   # close no stored daily row carries (tells the paths apart)
    calls = []
    monkeypatch.setattr(bars_fetch, "_delta_weekly" if tf == "W" else "_delta_monthly",
                        lambda t, last: calls.append(last) or [provider])
    # DETERMINISTIC on any runner: the synchronous delta's slot wait and ceilings are pinned well past what an instant
    # stub needs, so only a wrong PATH (stale-while-revalidate) can fail this rail, never a slow machine
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_SLOT_WAIT_S", 10.0)
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_INPROC_CEILING_S", 30.0)
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_DEADLINE_SECONDS", 30.0)
    body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(stored)).body)
    assert calls, "a stored W/M behind a holed daily was served stale-while-revalidate"
    assert bars_fetch.get_serve_layer() == "fetch", bars_fetch.get_serve_layer()
    assert body["bars"][-1]["c"] == provider["c"]


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_slow_provider_answers_the_store_at_the_deadline(store, monkeypatch, clock, tf):
    clock(2026, 11, 18, 11, 0)
    hole = TUE if tf == "W" else date(2026, 11, 10)
    full, stored = _seed_old_tail(tf, WED, monkeypatch, hole=hole, old_sessions=2 if tf == "W" else 10)
    gate = threading.Event()
    monkeypatch.setattr(bars_fetch, "_delta_weekly" if tf == "W" else "_delta_monthly",
                        lambda t, last: gate.wait(30) and [])
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_INPROC_CEILING_S", 0.3)
    try:
        t0 = time.monotonic()
        body = json.loads(bars_fetch._get_bars_inner("AAA", tf, len(stored)).body)
        took = time.monotonic() - t0
        assert took < 10.0, f"the first answer waited {took:.2f} s for the provider (it blocks 30 s)"
        assert body["bars"][-1]["c"] == stored[-1]["c"]
        assert bars_fetch.get_serve_layer() == "delta-deadline", bars_fetch.get_serve_layer()
    finally:
        gate.set()


# ── review of #3001, residual: OFF-HOURS, THE STORED PATH NEEDS PROOF THE DAILY POLL RAN AFTER THE CLOSE ───────────
@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_poll_that_died_mid_session_derives_nothing_after_hours(store, monkeypatch, clock, tf):
    at = clock(2026, 11, 18, 21, 0)
    _seed_through(tf, WED, monkeypatch)                            # the stored D's tail is today's (partial) row
    monkeypatch.setitem(bls._state, "daily_last_ok_wall", at.replace(hour=11).timestamp())   # last success 11:00
    assert bars_fetch._wm_live_daily("AAA") is False, "W/M derived from a daily the poll last wrote mid-session"
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf", ["W", "M"])
def test_after_a_restart_with_no_poll_yet_the_stored_path_derives_nothing(store, monkeypatch, clock, tf):
    clock(2026, 11, 21, 12, 0)                                     # Saturday
    _seed_through(tf, date(2026, 11, 20), monkeypatch)
    monkeypatch.setitem(bls._state, "daily_last_ok_wall", None)
    assert bars_fetch._wm_live_daily("AAA") is False
    assert _overlay(tf) is None


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_poll_that_succeeded_after_the_close_lets_the_stored_path_derive(store, monkeypatch, clock, tf):
    at = clock(2026, 11, 18, 21, 0)
    daily, periods, _ = _seed_through(tf, WED, monkeypatch)
    monkeypatch.setitem(bls._state, "daily_last_ok_wall", at.replace(hour=16, minute=1).timestamp())
    assert bars_fetch._wm_live_daily("AAA") is True
    assert _overlay(tf) is not None


# ── follow-up to #3001: the interior daily hole is repaired; "more volume = newer" needs the same close and basis ────
from api.services import massive as _massive


def _agg_raw(b):
    """A provider daily aggregate (`t` = the session's 00:00 ET in unix ms) for one stored-daily dict."""
    d = date.fromisoformat(b["t"])
    return {"t": int(_real_dt(d.year, d.month, d.day, tzinfo=_ET).timestamp() * 1000),
            "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]}


def test_an_interior_daily_hole_is_repaired_once_so_the_next_read_derives(store, monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    hole = date(2026, 11, 10)
    full, stored = _seed_old_tail("M", WED, monkeypatch, hole=hole)
    provider = dict(bars_fetch._resample_monthly_iso(full)[-1])
    provider["c"] = provider["h"]
    deltas, aggs = [], []
    monkeypatch.setattr(bars_fetch, "_delta_monthly", lambda t, last: deltas.append(last) or [provider])
    missing = [b for b in full if b["t"] == hole.isoformat()]
    monkeypatch.setattr(_massive, "get_agg_bars", lambda t, f, to: aggs.append((f, to)) or [_agg_raw(b) for b in missing])
    bars_fetch._get_bars_inner("AAA", "M", len(stored))
    assert len(deltas) == 1 and bars_fetch.get_serve_layer() == "fetch", "the first answer did not take the provider path"
    def _hole_filled():
        r = bars_sqlite.get_bars_before("AAA", "D", 1, 20261110)
        return bool(r) and int(r[-1][0]) == 20261110
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and not _hole_filled():
        time.sleep(0.05)
    assert _hole_filled(), "the interior hole was never repaired"
    assert aggs == [("2026-11-10", "2026-11-10")], aggs
    # after the repair the reads answer from the store (the background revalidation may still call the provider's
    # delta; what must not happen again is the SYNCHRONOUS provider path before the first answer)
    for _ in range(2):
        bars_fetch.cache.delete_prefix("bars_AAA_")
        bars_fetch._get_bars_inner("AAA", "M", len(stored))
        assert bars_fetch.get_serve_layer() not in ("fetch", "delta-deadline"), bars_fetch.get_serve_layer()
    assert len(aggs) == 1, "the repair ran more than once"


def test_a_vendor_correction_with_less_volume_is_kept(store, monkeypatch):
    # the stored week is the provider's CORRECTED bar: the same OHLC, less volume than the uncorrected daily sums to
    days = _sessions_through(date(2026, 11, 20))
    daily = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
             for i, d in enumerate(days)]
    bars_sqlite.put_bars("AAA", "D", daily, date_tf=True)
    weeks = [dict(w) for w in bars_fetch._resample_weekly_iso(daily)]
    weeks[-1]["v"] = int(weeks[-1]["v"]) - 500
    bars_sqlite.put_bars("AAA", "W", weeks, date_tf=True)
    out = bars_fetch._fmt_sqlite_bars(bars_sqlite.get_bars("AAA", "W", 400), "W", "AAA")
    assert out[-1]["v"] == weeks[-1]["v"], "a corrected bar was replaced by the uncorrected daily (more volume)"


def _seed_split(tf, last, drop, factor=10):
    """An UNADJUSTED stored daily through `last`, and a W/M table on the ADJUSTED basis of a 1:`factor` reverse split
    (prices x factor, volume / factor), built from the daily without its last `drop` sessions."""
    days = _sessions_through(last)
    daily = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 10000 + i}
             for i, d in enumerate(days)]
    bars_sqlite.put_bars("AAA", "D", daily, date_tf=True)
    rs = bars_fetch._resample_weekly_iso if tf == "W" else bars_fetch._resample_monthly_iso
    adj = [{**p, "o": p["o"] * factor, "h": p["h"] * factor, "l": p["l"] * factor, "c": p["c"] * factor,
            "v": int(p["v"]) // factor} for p in rs(daily[:-drop] if drop else daily)]
    bars_sqlite.put_bars("AAA", tf, adj, date_tf=True)
    return daily, adj


def _no_scale_jump(out):
    return all(0.5 <= float(b["o"]) / float(a["c"]) <= 2.0 for a, b in zip(out, out[1:]))


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_reverse_split_never_replaces_the_adjusted_tail_with_the_unadjusted_daily(store, monkeypatch, tf):
    daily, adj = _seed_split(tf, date(2026, 11, 18), drop=2)        # the tail lacks Mon/Tue's later sessions
    out = bars_fetch._fmt_sqlite_bars(bars_sqlite.get_bars("AAA", tf, 400), tf, "AAA")
    assert out[-1]["o"] == adj[-1]["o"] and _no_scale_jump(out), "the unadjusted daily replaced the adjusted tail"


def test_a_reverse_split_never_appends_an_unadjusted_next_week(store, monkeypatch):
    daily, adj = _seed_split("W", date(2026, 11, 16), drop=1)       # the table ends last week; the daily runs into Monday
    out = bars_fetch._fmt_sqlite_bars(bars_sqlite.get_bars("AAA", "W", 400), "W", "AAA")
    assert len(out) == len(adj) and _no_scale_jump(out), "an unadjusted week was appended to the adjusted table"


@pytest.mark.parametrize("tf", ["W", "M"])
def test_the_overlay_never_derives_over_a_table_on_another_basis(store, monkeypatch, clock, tf):
    # the LIVE path (a covered daily): on the stored path the ahead guard already refuses a split table (the adjusted
    # side has a higher high, or more volume), so only the basis check stands between a live daily and a scale jump
    clock(2026, 11, 18, 11, 0)
    _seed_split(tf, date(2026, 11, 18), drop=2)
    monkeypatch.setattr(bls, "covered", lambda t, k: k == "D")
    assert _overlay(tf) is None, "W/M were derived from a daily on another price basis"


def test_control_an_ordinary_further_along_daily_still_wins(store, monkeypatch):
    # the same basis, a later session in the daily (another close, more volume): the reconcile still rebuilds it
    days = _sessions_through(date(2026, 11, 18))
    daily = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
             for i, d in enumerate(days)]
    bars_sqlite.put_bars("AAA", "D", daily, date_tf=True)
    weeks = bars_fetch._resample_weekly_iso(daily[:-1])
    bars_sqlite.put_bars("AAA", "W", weeks, date_tf=True)
    out = bars_fetch._fmt_sqlite_bars(bars_sqlite.get_bars("AAA", "W", 400), "W", "AAA")
    assert out[-1]["c"] == daily[-1]["c"]


def _holed_month_with_provider(monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    full, stored = _seed_old_tail("M", WED, monkeypatch, hole=date(2026, 11, 10))
    provider = dict(bars_fetch._resample_monthly_iso(full)[-1])
    provider["c"] = provider["h"]
    monkeypatch.setattr(bars_fetch, "_delta_monthly", lambda t, last: [provider])
    return stored


def _wait_jobs(prefix="dhole::"):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(k.startswith(prefix) for k in list(bars_fetch._inflight)):
        time.sleep(0.05)


def test_a_hole_the_provider_cleanly_has_no_bar_for_is_asked_once(store, monkeypatch, clock):
    # a genuine halt: the provider ANSWERS, with nothing for the session; the hole stays, and is not re-asked per read
    stored = _holed_month_with_provider(monkeypatch, clock)
    aggs = []
    monkeypatch.setattr(_massive, "get_agg_bars", lambda t, f, to: aggs.append((f, to)) or [])
    for _ in range(3):
        bars_fetch.cache.delete_prefix("bars_AAA_")
        bars_fetch._get_bars_inner("AAA", "M", len(stored))
        _wait_jobs()
    assert aggs == [("2026-11-10", "2026-11-10")], aggs


def test_a_hole_repair_the_provider_faulted_on_is_asked_again(store, monkeypatch, clock):
    stored = _holed_month_with_provider(monkeypatch, clock)
    aggs = []

    def faulted(t, f, to):
        aggs.append((f, to))
        from api.services import provider_fault_scope
        provider_fault_scope.note(RuntimeError("daily agg 503"))
        return []
    monkeypatch.setattr(_massive, "get_agg_bars", faulted)
    for _ in range(2):
        bars_fetch.cache.delete_prefix("bars_AAA_")
        bars_fetch._get_bars_inner("AAA", "M", len(stored))
        _wait_jobs()
    assert len(aggs) == 2, "a faulted repair was marked done and never retried"


# ── review of #3023: a tail written from a PARTIAL period is replaced; a listing's first month; the warm share ───────
def _seed_partial_week_tail(monkeypatch, sym="AAA"):
    """A stored daily whose last week (Mon 11-16 .. Fri 11-20) moves +12%, and a stored W tail that is FRIDAY'S BAR
    ALONE (the "held one early-week session" class: TSLA W 2026-09-18 = o 369.00, v 51.9M, exactly Friday's daily):
    the same close as the full week, a later session's open, less volume."""
    days = _sessions_through(date(2026, 11, 13), 60)
    daily = [{"t": d.isoformat(), "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.0, "v": 1000} for d in days]
    week = [("2026-11-16", 100.0), ("2026-11-17", 103.0), ("2026-11-18", 106.0), ("2026-11-19", 109.0),
            ("2026-11-20", 112.0)]
    daily += [{"t": t, "o": o, "h": o + 2.0, "l": o - 1.0, "c": o + 1.0, "v": 1000} for t, o in week]
    bars_sqlite.put_bars(sym, "D", daily, date_tf=True)
    weeks = [dict(w) for w in bars_fetch._resample_weekly_iso(daily)]
    fri = daily[-1]
    weeks[-1] = {"t": "2026-11-20", "o": fri["o"], "h": fri["h"], "l": fri["l"], "c": fri["c"], "v": fri["v"]}
    bars_sqlite.put_bars(sym, "W", weeks, date_tf=True)
    monkeypatch.setattr(bls, "covered", lambda t, k: False)
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_delta_daily"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: [])
    return daily, weeks


def test_a_stored_week_written_from_a_partial_period_is_replaced_by_the_full_daily_week(store, monkeypatch):
    daily, weeks = _seed_partial_week_tail(monkeypatch)
    out = bars_fetch._fmt_sqlite_bars(bars_sqlite.get_bars("AAA", "W", 400), "W", "AAA")
    assert out[-1]["o"] == 100.0 and out[-1]["h"] == 114.0 and out[-1]["v"] == 5000, out[-1]


def test_the_overlay_replaces_a_partial_period_tail_too(store, monkeypatch, clock):
    clock(2026, 11, 21, 12, 0)                     # Saturday: the stored path derives
    daily, weeks = _seed_partial_week_tail(monkeypatch)
    ov = _overlay("W")
    assert ov is not None, "the overlay refused a corrupt partial-period tail"
    assert float(ov[0][-1][1]) == 100.0


def _seed_listing_month(monkeypatch, old_months=False, sym="AAA"):
    """A series LISTED Tue 2026-11-10: the stored daily starts there and runs through Wed 11-18; the stored M table's
    current row is from 11-13. `old_months`: the M table also holds older months (a shallow daily beside a deeper
    table: NOT a listing)."""
    days = [d for d in _sessions_through(WED, 40) if d >= date(2026, 11, 10)]
    daily = [{"t": d.isoformat(), "o": 50 + i, "h": 51 + i, "l": 49 + i, "c": 50.5 + i, "v": 2000 + i}
             for i, d in enumerate(days)]
    bars_sqlite.put_bars(sym, "D", daily, date_tf=True)
    months = [dict(m) for m in bars_fetch._resample_monthly_iso([b for b in daily if b["t"] <= "2026-11-13"])]
    if old_months:
        months = [{"t": "2026-09-01", "o": 40.0, "h": 45.0, "l": 39.0, "c": 44.0, "v": 9000},
                  {"t": "2026-10-01", "o": 44.0, "h": 50.0, "l": 43.0, "c": 49.0, "v": 9000}] + months
    bars_sqlite.put_bars(sym, "M", months, date_tf=True)
    monkeypatch.setattr(bls, "covered", lambda t, k: False)
    return daily, months


def test_a_listings_first_month_is_derived_from_its_daily_without_the_provider(store, monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    daily, months = _seed_listing_month(monkeypatch)
    calls = []
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_delta_daily"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: calls.append(1) or [])
    monkeypatch.setattr(_massive, "get_agg_bars", lambda *a, **k: calls.append("agg") or [])
    body = json.loads(bars_fetch._get_bars_inner("AAA", "M", len(months)).body)
    assert bars_fetch.get_serve_layer() not in ("fetch", "delta-deadline"), "a listing's first month took the provider path"
    assert body["bars"][-1]["c"] == daily[-1]["c"] and body["bars"][-1]["v"] == sum(b["v"] for b in daily)
    _wait_jobs()
    assert "agg" not in calls, "the pre-listing sessions were read as a hole and 'repaired'"


def test_control_a_shallow_daily_beside_a_deeper_table_is_not_a_listing(store, monkeypatch, clock):
    clock(2026, 11, 18, 11, 0)
    daily, months = _seed_listing_month(monkeypatch, old_months=True)
    rows = bars_sqlite.get_bars("AAA", "M", 400)
    out = bars_fetch._fmt_sqlite_bars(rows, "M", "AAA")
    assert out[-1]["c"] == months[-1]["c"], "a month was rebuilt from a daily missing its first sessions"


def test_the_hole_repair_runs_while_the_interactive_delta_pool_is_full(store, monkeypatch, clock):
    stored = _holed_month_with_provider(monkeypatch, clock)
    aggs = []
    monkeypatch.setattr(_massive, "get_agg_bars", lambda t, f, to: aggs.append((f, to)) or [])
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_SLOT_WAIT_S", 0.05)
    held = 0
    while bars_fetch._date_delta_sem.acquire(blocking=False):
        held += 1
    try:
        bars_fetch._get_bars_inner("AAA", "M", len(stored))
        _wait_jobs()
    finally:
        for _ in range(held):
            bars_fetch._date_delta_sem.release()
    assert aggs == [("2026-11-10", "2026-11-10")], "the repair took (and lacked) a slot of the interactive pool"
