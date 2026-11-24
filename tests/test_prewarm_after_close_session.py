"""From the settle hour after the close, "the last completed session" is TODAY, and the after-close daily
sweep is not done until the store says so.

⚰️ PRODUCTION, Monday 2026-11-23. The worker's after-close DAILY sweep ran at 17:00 ET, printed
"refreshed 712 of 13279 dailies", marked the session done, and nothing looked again. The device-store
seed for that session was then refused four times ("tf D: 0 symbols, floor 1500") and the store stayed
dark for every desktop member until the next morning's refresh.

Two defects, one on top of the other:

  1. `bars_prewarm._last_completed_session()` asked the session calendar "as of 08:00 ET today", at
     every hour. Its own docstring said "yesterday during RTH, today after close". At 17:00 ET Monday it
     answered FRIDAY. Inside the data window (weekdays 04:00 to 20:00 ET) `_boot_can_skip` compares a
     daily's newest row with it, so every daily already holding Friday's bar was skipped as "has the
     last completed session". Only the 712 older than Friday were fetched.
  2. The sweep then marked the session done whatever its pass had achieved.

It did not happen every night: when the steady loop reached the sweep after 20:00 ET, outside the
window, the skip compared with the expected session (today) and the sweep worked.

Every clock here is a fixed ET instant. No network, no store file: a dict stands for the store and a
recording function for the provider, behind the real `_warm_job`, `_boot_can_skip` and
`_last_completed_session`.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

import api.services.bars_prewarm as bp
from api.services import data_sync
from api.services.bars_fetch import _expected_latest_session_yyyymmdd, _session_close_minutes

ET = ZoneInfo("America/New_York")
# Thu 11-19, Fri 11-20, [weekend], Mon 11-23, Tue 11-24, Wed 11-25, Thu 11-26 = Thanksgiving (closed),
# Fri 11-27 = early close (13:00 ET).
THU, FRI, MON, TUE, WED, THANKSGIVING, HALF_DAY = (20261119, 20261120, 20261123, 20261124, 20261125,
                                                   20261126, 20261127)


def _et(ymd: int, hh: int, mm: int = 0) -> datetime:
    return datetime(ymd // 10000, ymd // 100 % 100, ymd % 100, hh, mm, tzinfo=ET)


# ── 1. the calendar answer ───────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _the_settle_hour_is_the_default(monkeypatch):
    """17:00 ET unless a test sets it: the worker's own `PERMANENT_FRESHNESS_HOUR_ET` is not this file's."""
    monkeypatch.delenv("PERMANENT_FRESHNESS_HOUR_ET", raising=False)


# ⛔ TODAY BECOMES "COMPLETED" AT THE SETTLE HOUR, NOT AT THE CLOSE. A daily fetched once is dated today and
# is then treated as settled for the rest of the day (`_boot_can_skip` answers before `_needs_fresh` is
# asked), so whatever the vendor says at the first fetch ships in that night's seed. At 16:05 ET the vendor
# may not have published the closing daily bar yet. `PERMANENT_FRESHNESS_HOUR_ET` (default 17) is the hour
# the after-close sweep already waits for, and it is the one knob for both.
@pytest.mark.parametrize("now, want, why", [
    (_et(MON, 17, 0), MON, "17:00 ET on a trading day, the settle hour and the sweep's own: today"),
    (_et(MON, 19, 59), MON, "post-market, still inside the data window"),
    (_et(MON, 23, 30), MON, "late evening"),
    (_et(MON, 16, 59), FRI, "one minute before the settle hour"),
    (_et(MON, 16, 30), FRI, "half an hour after the close: the vendor's daily is not settled yet"),
    (_et(MON, 16, 0), FRI, "the close itself: not yet"),
    (_et(MON, 15, 59), FRI, "one minute before the close: Friday -> Monday"),
    (_et(MON, 10, 0), FRI, "mid-session: Friday -> Monday"),
    (_et(MON, 8, 0), FRI, "pre-open"),
    (_et(MON, 0, 30), FRI, "after midnight, before any session"),
    (_et(FRI, 17, 0), FRI, "Friday evening"),
    (_et(20261121, 12, 0), FRI, "Saturday"),
    (_et(20261122, 18, 0), FRI, "Sunday evening"),
    (_et(TUE, 11, 0), MON, "the next morning"),
    (_et(THANKSGIVING, 10, 0), WED, "a holiday morning"),
    (_et(THANKSGIVING, 17, 0), WED, "a holiday evening: no session closed today"),
    (_et(HALF_DAY, 12, 59), WED, "half day, one minute before its 13:00 close (Thursday was closed)"),
    (_et(HALF_DAY, 13, 0), WED, "half day, at its 13:00 close: not yet"),
    (_et(HALF_DAY, 15, 0), WED, "half day, the afternoon: closed two hours ago, still before the settle hour"),
    (_et(HALF_DAY, 16, 59), WED, "half day, one minute before the settle hour"),
    (_et(HALF_DAY, 17, 0), HALF_DAY, "half day, the settle hour"),
])
def test_the_last_completed_session_at(now, want, why):
    assert bp._last_completed_session(now) == want, why


@pytest.mark.parametrize("hour_et, now, want, why", [
    ("20", _et(MON, 17, 0), FRI, "settle hour 20: 17:00 is too early"),
    ("20", _et(MON, 19, 59), FRI, "settle hour 20: one minute before"),
    ("20", _et(MON, 20, 0), MON, "settle hour 20: at it"),
    ("18", _et(MON, 17, 30), FRI, "settle hour 18: before"),
    ("18", _et(MON, 18, 0), MON, "settle hour 18: at it"),
    ("15", _et(MON, 15, 30), FRI, "a settle hour BEFORE the close never beats the close: mid-session"),
    ("15", _et(MON, 16, 0), MON, "a settle hour before the close: today from the close"),
    ("12", _et(HALF_DAY, 12, 30), WED, "half day, settle hour 12: still before its 13:00 close"),
    ("12", _et(HALF_DAY, 13, 0), HALF_DAY, "half day, settle hour 12: today from the 13:00 close"),
])
def test_the_settle_hour_is_the_sweeps_own_knob(monkeypatch, hour_et, now, want, why):
    monkeypatch.setenv("PERMANENT_FRESHNESS_HOUR_ET", hour_et)
    assert bp._last_completed_session(now) == want, why


def _every_half_hour(first_ymd: int, days: int):
    t = _et(first_ymd, 0, 0)
    for _ in range(days * 48):
        yield t
        t += timedelta(minutes=30)


def _settled(now: datetime) -> bool:
    """Has today's session closed AND the settle hour (17:00 ET) passed? Derived from the calendar."""
    today = int(now.strftime("%Y%m%d"))
    session_today = _expected_latest_session_yyyymmdd(now.replace(hour=12, minute=0)) == today
    return session_today and now.hour * 60 + now.minute >= max(_session_close_minutes(today), 17 * 60)


def test_before_the_settle_hour_the_answer_is_the_one_the_boot_pass_always_had():
    """Unchanged where it was right: until the settle hour of a session day (and all day on a day with no
    session) the answer is the calendar's "as of 08:00 ET today", the rule the mid-session boot skip was
    built on."""
    checked = 0
    for now in _every_half_hour(THU, 11):                    # Thu 11-19 .. Sun 11-29, every half hour
        if not _settled(now):
            assert bp._last_completed_session(now) == _expected_latest_session_yyyymmdd(
                now.replace(hour=8, minute=0)), now
            checked += 1
    assert checked > 300


def test_it_is_never_ahead_of_the_expected_session_and_is_today_exactly_from_the_settle_hour():
    todays = 0
    for now in _every_half_hour(THU, 11):
        today = int(now.strftime("%Y%m%d"))
        got = bp._last_completed_session(now)
        assert got <= _expected_latest_session_yyyymmdd(now) or now.hour * 100 + now.minute < 935, now
        assert got <= today, now
        assert (got == today) is _settled(now), now
        todays += _settled(now)
    # 6 sessions in the range (Thu, Fri, Mon, Tue, Wed and the half day): 17:00 .. 23:30 = 14 half hours each.
    assert todays == 6 * 14


# ── 2. the skip, inside the data window ──────────────────────────────────────────────────────────

@pytest.fixture
def clock(monkeypatch):
    """Hold the prewarm's ET clock at an instant and answer its two calendar questions for it."""
    monkeypatch.setenv("PREWARM_BOOT_SKIP_SETTLED", "1")

    def _set(now: datetime):
        monkeypatch.setattr(bp, "_now_et", lambda: now)
        monkeypatch.setattr(bp, "_in_active_data_window", lambda: data_sync.in_active_data_window(now))
        monkeypatch.setattr(bp, "_expected_session", lambda: _expected_latest_session_yyyymmdd(now))
        return now
    return _set


def test_from_the_settle_hour_a_daily_holding_the_previous_session_is_NOT_skipped(clock):
    now = clock(_et(MON, 17, 0))
    assert data_sync.in_active_data_window(now), "17:00 ET on a weekday is inside the data window"
    assert bp._boot_can_skip(FRI, "D") is False, "Friday's bar at 17:00 Monday is a session behind"
    assert bp._boot_can_skip(THU, "D") is False
    assert bp._boot_can_skip(MON, "D") is True, "today's bar after the close: nothing to fetch"


def test_before_the_close_the_boot_pass_still_skips_a_daily_holding_the_previous_session(clock):
    """The 2026-09-01 rule, untouched: a mid-session restart must not re-fetch the whole warm universe."""
    clock(_et(MON, 11, 0))
    assert bp._boot_can_skip(FRI, "D") is True
    assert bp._boot_can_skip(MON, "D") is True
    assert bp._boot_can_skip(THU, "D") is False, "missing a completed session: still fetched"


def test_between_the_close_and_the_settle_hour_a_daily_holding_the_previous_session_is_STILL_skipped(clock):
    """16:30 ET Monday: the session is over and the vendor's daily may not be. Nothing is fetched yet."""
    for hh, mm in ((16, 0), (16, 5), (16, 30), (16, 59)):
        clock(_et(MON, hh, mm))
        assert bp._boot_can_skip(FRI, "D") is True, (hh, mm)
    clock(_et(MON, 17, 0))
    assert bp._boot_can_skip(FRI, "D") is False


def test_on_a_half_day_the_skip_holds_through_the_early_close_until_the_settle_hour(clock):
    for hh, mm in ((12, 30), (13, 0), (13, 30), (15, 0), (16, 59)):
        clock(_et(HALF_DAY, hh, mm))
        assert bp._boot_can_skip(WED, "D") is True, (hh, mm)
    clock(_et(HALF_DAY, 17, 0))
    assert bp._boot_can_skip(WED, "D") is False
    assert bp._boot_can_skip(HALF_DAY, "D") is True


def test_with_the_settle_hour_at_20_nothing_turns_inside_the_data_window(clock, monkeypatch):
    """`PERMANENT_FRESHNESS_HOUR_ET=20`: the flip and the window's end coincide, so inside the window a daily
    holding the previous session is skipped all evening, and from 20:00 the outside rule (today) fetches it."""
    monkeypatch.setenv("PERMANENT_FRESHNESS_HOUR_ET", "20")
    for hh, mm in ((17, 0), (18, 30), (19, 59)):
        clock(_et(MON, hh, mm))
        assert bp._boot_can_skip(FRI, "D") is True, (hh, mm)
    clock(_et(MON, 20, 0))
    assert bp._boot_can_skip(FRI, "D") is False and bp._boot_can_skip(MON, "D") is True


def test_outside_the_window_the_skip_is_as_it_was(clock):
    clock(_et(MON, 21, 0))                                   # after 20:00 ET: graded against today
    assert bp._boot_can_skip(FRI, "D") is False and bp._boot_can_skip(MON, "D") is True
    clock(_et(20261121, 12, 0))                              # Saturday: Friday's bar is settled
    assert bp._boot_can_skip(FRI, "D") is True and bp._boot_can_skip(THU, "D") is False


# ── 3. the sweep ─────────────────────────────────────────────────────────────────────────────────

class _Store:
    """A dict for the daily store and a provider that records who it was asked for. `dead` symbols get
    no bar for the session however often they are asked (delisted, halted, the provider has nothing)."""

    def __init__(self, rows: dict, sess: int, dead=()):
        self.rows, self.sess, self.dead, self.asked = dict(rows), sess, set(dead), []

    def last_ts(self, sym, tf):
        return self.rows.get(sym)

    def fetch(self, sym, tf, bar_count):
        self.asked.append(sym)
        if sym not in self.dead:
            self.rows[sym] = self.sess

    def warm_one(self, args):
        return bp._warm_job(args, get_last_ts=self.last_ts, needs_fresh=lambda ts, tf: True,
                            fetch=self.fetch, _set_background_caller=lambda on: None)

    def tick(self, state):
        bp._daily_freshness_tick(state, full_daily=[(s, "D", 5000) for s in sorted(self.rows)],
                                 warm_one=self.warm_one, needs_fresh=lambda ts, tf: True,
                                 last_ts=self.last_ts, workers=2)


@pytest.fixture
def sweep_on(monkeypatch):
    monkeypatch.setenv("PERMANENT_DAILY_FRESHNESS_ENABLED", "1")
    monkeypatch.delenv("PERMANENT_FRESHNESS_HOUR_ET", raising=False)
    monkeypatch.delenv("PERMANENT_FRESHNESS_MAX_PASSES", raising=False)
    bp._reset_prewarm_state()
    yield
    bp._reset_prewarm_state()


def test_at_1700_ET_the_sweep_refreshes_EVERY_daily_behind_the_session(clock, sweep_on):
    """Monday 2026-11-23, 17:00 ET, as it was: most dailies hold Friday's bar."""
    clock(_et(MON, 17, 0))
    store = _Store({"FRI1": FRI, "FRI2": FRI, "FRI3": FRI, "OLD": THU, "COLD": None, "DONE": MON}, MON)
    state = {"swept": 0}
    store.tick(state)
    assert sorted(store.asked) == ["COLD", "FRI1", "FRI2", "FRI3", "OLD"]
    assert all(ts == MON for ts in store.rows.values())
    assert state["swept"] == MON


def test_the_session_is_NOT_done_while_a_daily_is_still_behind_and_the_next_loop_retries_it(clock, sweep_on,
                                                                                        monkeypatch, capsys):
    monkeypatch.setenv("PERMANENT_FRESHNESS_MAX_PASSES", "3")
    clock(_et(MON, 17, 0))
    store = _Store({"FRI1": FRI, "FRI2": FRI, "DEAD": FRI, "DONE": MON}, MON, dead={"DEAD"})
    state = {"swept": 0}
    store.tick(state)
    assert sorted(store.asked) == ["DEAD", "FRI1", "FRI2"]
    assert state["swept"] == 0, "DEAD is still a session behind: the sweep is not done"
    store.asked.clear()
    store.dead.clear()                                       # the provider has the bar on the next loop
    store.tick(state)
    assert store.asked == ["DEAD"], "the retry asks only for what is still behind"
    assert state["swept"] == MON
    store.asked.clear()
    store.tick(state)
    assert store.asked == [], "done: not due again this session"
    assert "GAVE UP" not in capsys.readouterr().out


def test_a_daily_the_provider_never_has_stops_the_retries_at_the_bound_and_says_so(clock, sweep_on,
                                                                                 monkeypatch, capsys):
    monkeypatch.setenv("PERMANENT_FRESHNESS_MAX_PASSES", "3")
    clock(_et(MON, 17, 0))
    store = _Store({"FRI1": FRI, "DEAD1": FRI, "DEAD2": THU}, MON, dead={"DEAD1", "DEAD2"})
    state = {"swept": 0}
    swept_after = []
    for _ in range(3):
        store.tick(state)
        swept_after.append(state["swept"])
    assert swept_after == [0, 0, MON], "two retries, then the session is closed by the bound"
    assert store.asked.count("DEAD1") == 3 and store.asked.count("FRI1") == 1
    out = capsys.readouterr().out
    assert "GAVE UP" in out and "2 of 3 dailies still behind session 20261123 after 3 passes" in out
    store.asked.clear()
    store.tick(state)
    assert store.asked == [], "bounded: no fourth pass"


def test_a_pass_that_fetched_NOTHING_is_not_a_finished_sweep(clock, sweep_on, monkeypatch):
    """The 2026-11-23 shape, whatever the next skip rule is: every job vetoed, the store unchanged."""
    clock(_et(MON, 17, 0))
    monkeypatch.setattr(bp, "_boot_can_skip", lambda last_ts, tf: True)
    store = _Store({"FRI1": FRI, "FRI2": FRI}, MON)
    state = {"swept": 0}
    store.tick(state)
    assert store.asked == [] and state["swept"] == 0


def test_a_store_already_at_the_session_is_done_at_once_without_a_fetch(clock, sweep_on):
    clock(_et(MON, 17, 0))
    store = _Store({"A": MON, "B": MON}, MON)
    state = {"swept": 0}
    store.tick(state)
    assert store.asked == [] and state["swept"] == MON


def test_a_new_session_starts_its_own_count_of_passes(clock, sweep_on, monkeypatch):
    monkeypatch.setenv("PERMANENT_FRESHNESS_MAX_PASSES", "2")
    clock(_et(MON, 17, 0))
    store = _Store({"DEAD": FRI}, MON, dead={"DEAD"})
    state = {"swept": 0}
    store.tick(state)
    store.tick(state)
    assert state["swept"] == MON, "closed by the bound on Monday"
    clock(_et(TUE, 17, 0))
    store.sess, store.dead = TUE, set()
    store.asked.clear()
    store.tick(state)
    assert store.asked == ["DEAD"] and state["swept"] == TUE


def test_before_the_buffer_hour_the_sweep_does_not_run(clock, sweep_on):
    clock(_et(MON, 16, 30))
    store = _Store({"FRI1": FRI}, MON)
    state = {"swept": 0}
    store.tick(state)
    assert store.asked == [] and state == {"swept": 0}


@pytest.mark.parametrize("day, prev, times", [
    (MON, FRI, ((16, 0), (16, 5), (16, 30), (16, 59))),
    (HALF_DAY, WED, ((13, 0), (13, 5), (15, 0), (16, 59))),
])
def test_NO_daily_is_fetched_between_the_close_and_the_settle_hour(clock, sweep_on, day, prev, times):
    """⛔ A daily fetched once is dated today and never asked for again that day, so the first fetch is the
    one the night's seed ships. The steady refresh (every job through `_warm_job`) and the sweep must both
    leave a daily holding the previous session alone until the settle hour, then fetch it."""
    store = _Store({"A": prev, "B": prev, "C": prev}, day)
    jobs = [(s, "D", 5000) for s in sorted(store.rows)]
    state = {"swept": 0}
    for hh, mm in times:
        clock(_et(day, hh, mm))
        assert [store.warm_one(j)[0] for j in jobs] == ["skipped"] * 3, (hh, mm)   # the steady refresh's job
        store.tick(state)                                                          # the sweep
        assert store.asked == [] and state == {"swept": 0}, (hh, mm)
        assert set(store.rows.values()) == {prev}
    clock(_et(day, 17, 0))
    assert [store.warm_one(j)[0] for j in jobs] == ["warmed"] * 3
    assert sorted(store.asked) == ["A", "B", "C"] and set(store.rows.values()) == {day}


def test_with_the_settle_hour_at_20_the_sweep_and_the_refresh_wait_for_it(clock, sweep_on, monkeypatch):
    monkeypatch.setenv("PERMANENT_FRESHNESS_HOUR_ET", "20")
    store = _Store({"A": FRI, "B": FRI}, MON)
    jobs = [(s, "D", 5000) for s in sorted(store.rows)]
    state = {"swept": 0}
    for hh, mm in ((17, 0), (19, 59)):
        clock(_et(MON, hh, mm))
        assert [store.warm_one(j)[0] for j in jobs] == ["skipped"] * 2, (hh, mm)
        store.tick(state)
        assert store.asked == [] and state == {"swept": 0}, (hh, mm)
    clock(_et(MON, 20, 0))
    store.tick(state)
    assert sorted(store.asked) == ["A", "B"] and state["swept"] == MON


def test_on_a_half_day_the_1700_sweep_refreshes_the_dailies_behind_it(clock, sweep_on):
    clock(_et(HALF_DAY, 17, 0))
    store = _Store({"WED1": WED, "WED2": WED, "DONE": HALF_DAY}, HALF_DAY)
    state = {"swept": 0}
    store.tick(state)
    assert sorted(store.asked) == ["WED1", "WED2"] and state["swept"] == HALF_DAY


def test_on_a_holiday_there_is_no_sweep(clock, sweep_on):
    clock(_et(THANKSGIVING, 17, 0))
    store = _Store({"WED1": WED, "OLD": TUE}, WED)
    state = {"swept": 0}
    store.tick(state)
    assert store.asked == [] and state == {"swept": 0}


def test_the_steady_loop_runs_the_sweep_through_the_tick_and_the_real_warm_job():
    """The sweep above is the production one only while `run_prewarmer_forever` calls it with its own
    `_warm_one`, and `_warm_one` is `_warm_job`."""
    import inspect
    src = inspect.getsource(bp.run_prewarmer_forever)
    assert src.count("_daily_freshness_tick(") == 1
    assert "warm_one=_warm_one" in src and "return _warm_job(args," in src
    assert "_last_full_daily_session" not in inspect.getsource(bp)
