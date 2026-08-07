"""The alert lane must own its own bars.

⭐ WHAT THIS FILE IS ABOUT, MEASURED ON PRODUCTION 2026-08-07 09:56 ET, 26
minutes after the open, with the market open and 31 alerts armed:

    GROUP SPY/5  alerts=31  newest_bar_ET=2026-08-07 09:15  stale=41.1 min

Thirty-one alerts deciding against a PRE-MARKET bar. `_fetch_bars_for_alert`
reads `bars_sqlite` directly and therefore inherits none of `/api/bars`'
freshness logic, and with the site in COMING SOON mode nobody was opening the
charts that used to freshen it by accident.

So the first test here does not test the fix. It reproduces the DEFECT against
the real staleness instrument, on a real SQLite store, at the real clock offset,
and asserts the store is 41 minutes behind. A file that only asserted the new
behaviour would prove nothing about the thing that was wrong.
[[lesson_gate_that_cannot_fail]]

Every test below runs against a REAL `bars.db` in tmp_path — `put_bars` and
`get_bars` are the actual functions, not doubles. Only the network edge
(`bars_fetch._delta_*`) is substituted, because that is the only part that
cannot be exercised offline.
"""

from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import alert_bars_freshness as abf

_ET = ZoneInfo("America/New_York")

# The production defect's own clock. 2026-08-07 was a Friday; 09:15 ET is a
# pre-market 5-minute bucket, 09:56 ET is 26 minutes into the session.
_STALE_BAR_ET = datetime(2026, 8, 7, 9, 15, tzinfo=_ET)
_NOW_ET = datetime(2026, 8, 7, 9, 56, tzinfo=_ET)
_STALE_BAR_TS = int(_STALE_BAR_ET.timestamp())
_NOW_TS = _NOW_ET.timestamp()


# ─── a real store, in a temp dir ─────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    """A REAL bars.db at a temp path, plus the module state reset.

    `bars_sqlite` caches one connection per THREAD and keys the cache on
    `_db_epoch`; the refresher fetches on its own worker threads, so pointing
    `_DB_PATH` somewhere new is only half the job — without `bump_db_epoch()`
    a thread that already touched the module would keep reading the old file.
    [[lesson_teardown_must_undo_what_setup_created]]
    """
    from api.services import bars_sqlite as sq
    monkeypatch.setattr(sq, "_DB_PATH", str(tmp_path / "bars.db"))
    sq.bump_db_epoch()
    sq.init_db()
    abf.reset_state()
    yield sq
    sq.bump_db_epoch()
    abf.reset_state()


def _five_min_bars(start_ts: int, n: int, close: float = 500.0) -> list[dict]:
    """n consecutive 5-minute bars ending at `start_ts` inclusive."""
    return [
        {"t": start_ts - (n - 1 - i) * 300,
         "o": close, "h": close + 1, "l": close - 1, "c": close + i * 0.01,
         "v": 1000 + i}
        for i in range(n)
    ]


def _seed_stale_spy(sq) -> list[int]:
    """The production shape: SPY/5 populated only up to the 09:15 pre-market bar."""
    bars = _five_min_bars(_STALE_BAR_TS, 60)
    sq.put_bars("SPY", "5", bars, date_tf=False)
    return [b["t"] for b in bars]


def _ts_set(sq, sym: str, tf: str) -> set[int]:
    """The stored bar timestamps, BY IDENTITY.

    ⚠️ A count is not enough. `put_bars` is INSERT OR REPLACE, so a refresh that
    re-wrote the same 60 bars it already had would leave the count identical to a
    refresh that added new ones — and identical to one that did nothing. The set
    of `ts` values is the only thing that distinguishes "gained bars" from
    "rewrote bars".
    """
    return {int(r[0]) for r in sq.get_bars(sym, tf, 100000)}


def _fake_active(monkeypatch, groups):
    """Make `indicator_alert_service.list_active()` return alerts on `groups`."""
    from api.services import indicator_alert_service as ias
    rows = [{"id": i, "sym": s, "tf": t} for i, (s, t) in enumerate(groups, 1)]
    monkeypatch.setattr(ias, "list_active", lambda: rows)


class _Recorder:
    """Stands in for `bars_fetch._delta_intraday`, and remembers everything."""

    def __init__(self, produce=None, raises=None, delay=0.0):
        self.calls: list[tuple[str, str, int]] = []
        self.starts: list[float] = []
        self._produce = produce
        self._raises = raises
        self._delay = delay
        self._lock = threading.Lock()
        self.inflight = 0
        self.max_inflight = 0

    def __call__(self, sym, tf, last_ts):
        with self._lock:
            self.calls.append((sym, tf, int(last_ts)))
            self.starts.append(time.monotonic())
            self.inflight += 1
            self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            if self._delay:
                time.sleep(self._delay)
            if self._raises is not None:
                raise self._raises
            return list(self._produce(sym, tf, last_ts)) if callable(self._produce) \
                else list(self._produce or [])
        finally:
            with self._lock:
                self.inflight -= 1

    @property
    def groups(self) -> set[tuple[str, str]]:
        return {(c[0], c[1]) for c in self.calls}


def _patch_delta(monkeypatch, rec: _Recorder):
    from api.services import bars_fetch as bf
    monkeypatch.setattr(bf, "_delta_intraday", rec)
    return rec


def _always_stale(monkeypatch):
    """Freeze `_needs_fresh` True so a test drives the refresh, not the clock.

    Used ONLY by tests whose subject is the bounding/failure behaviour. The
    tests about staleness itself call the real `_needs_fresh`.
    """
    from api.services import bars_fetch as bf
    monkeypatch.setattr(bf, "_needs_fresh", lambda last_ts, tf: True)


# ═══ 1. THE DEFECT, MEASURED ═════════════════════════════════════════════════

def test_the_defect_armed_group_is_41_minutes_stale(store, monkeypatch):
    """The production reading, reproduced against the instrument.

    If `measure_staleness` is broken, THIS is the test that fails — before any
    test of the fix gets a chance to pass for the wrong reason.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])

    assert abf.armed_groups() == [("SPY", "5")]

    (rec,) = abf.measure_staleness(now=_NOW_TS)
    assert rec["sym"] == "SPY" and rec["tf"] == "5"
    assert rec["has_rows"] is True
    assert rec["last_bar_et"] == "2026-08-07 09:15"
    # 41.0 minutes, matching the pod probe's 41.1 to the second it was taken.
    assert rec["stale_seconds"] == pytest.approx(41 * 60, abs=1)
    # And the store itself says so: the newest bar predates the 09:30 open.
    assert _STALE_BAR_TS < int(datetime(2026, 8, 7, 9, 30, tzinfo=_ET).timestamp())


def test_the_defect_is_visible_to_the_freshness_predicate_the_chart_lane_uses(store):
    """`/api/bars` would have called this stale. The alert lane never asked.

    This is the whole root cause in one assertion: the predicate that would have
    caught it existed the entire time, in `bars_fetch`, unconsulted.
    """
    from api.services import bars_fetch as bf
    _seed_stale_spy(store)
    assert bf._needs_fresh(_STALE_BAR_TS, "5") is True


# ═══ 2. THE FIX, AND ITS NON-VACUITY ═════════════════════════════════════════

def test_refresh_adds_new_bars_by_identity_and_the_staleness_is_gone(store, monkeypatch):
    """Before → after, on a real store, proven by the SET of timestamps.

    ⛔ NOT by a row count. A no-op and a re-write of the same 60 bars both leave
    the count at 60. Only new `ts` values prove the store gained bars.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])

    before_ts = _ts_set(store, "SPY", "5")
    before = abf.measure_staleness(now=_NOW_TS)
    assert before[0]["stale_seconds"] == pytest.approx(41 * 60, abs=1)

    # The bars that were missing: 09:20 through 09:55, the session so far.
    fresh = _five_min_bars(_STALE_BAR_TS + 8 * 300, 8, close=505.0)
    fresh_ts = {b["t"] for b in fresh}
    rec = _patch_delta(monkeypatch, _Recorder(produce=lambda *a: fresh))

    out = abf.refresh_armed_groups(min_gap=0.0)

    assert out["status"] == "ok"
    assert out["refreshed"] == 1
    assert out["rows_written"] == 8
    assert out["empty"] == 0 and out["errors"] == 0

    after_ts = _ts_set(store, "SPY", "5")
    gained = after_ts - before_ts
    assert gained == fresh_ts, "the store must gain the exact new bars, by identity"
    assert before_ts <= after_ts, "a refresh may never lose a stored bar"

    # And the staleness the defect was measured by is gone.
    after = abf.measure_staleness(now=_NOW_TS)
    assert after[0]["last_bar_et"] == "2026-08-07 09:55"
    assert after[0]["stale_seconds"] == pytest.approx(60, abs=1)
    assert after[0]["stale_seconds"] < before[0]["stale_seconds"]

    # The summary carries its own receipt, so a caller never has to take the
    # claim on trust.
    assert out["before"][0]["stale_seconds"] > out["after"][0]["stale_seconds"]
    assert rec.calls == [("SPY", "5", _STALE_BAR_TS)]


def test_a_refresh_that_writes_nothing_is_never_reported_as_success(store, monkeypatch):
    """⛔ MUTATION TARGET: a refresh that silently no-ops must FAIL.

    Counting a group as `refreshed` on the strength of having been *attempted*
    is the failure this asserts against — an empty sweep that says it worked is
    exactly the shape of the 739-symbol sweep that 429'd on its first call and
    reported success.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    before_ts = _ts_set(store, "SPY", "5")
    _patch_delta(monkeypatch, _Recorder(produce=[]))

    out = abf.refresh_armed_groups(min_gap=0.0, attempts=1)

    assert out["refreshed"] == 0, "an empty fetch is not a refresh"
    assert out["rows_written"] == 0
    assert out["empty"] == 1
    assert _ts_set(store, "SPY", "5") == before_ts, "nothing may be written"
    # And the staleness is honestly still there — not papered over.
    assert out["after"][0]["last_ts"] == _STALE_BAR_TS


def test_an_empty_fetch_is_not_cached_as_a_value_and_the_group_is_retried(
        store, monkeypatch):
    """Retry THROUGH a cooldown, not past it.

    An empty read during an upstream cooldown is indistinguishable from "no
    data". If an empty result stamped the success clock, the group would be
    skipped for the whole interval — the sweep would have converted a cooldown
    into "up to date". So: empty must NOT stamp, and the very next sweep must
    ask again. Then a real answer lands and IS written.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])

    cooldown = _Recorder(produce=[])
    _patch_delta(monkeypatch, cooldown)
    first = abf.refresh_armed_groups(min_gap=0.0, attempts=1)
    assert first["empty"] == 1
    assert abf._seconds_since_ok(("SPY", "5")) is None, "empty must not stamp"

    # Immediately again — inside MIN_REFRESH_INTERVAL. A stamped group would be
    # skipped here; an unstamped one asks again.
    second = abf.refresh_armed_groups(min_gap=0.0, attempts=1)
    assert second["skipped_recent"] == 0
    assert len(cooldown.calls) == 2, "the cooldown must be retried, not skipped"

    # The cooldown lifts.
    fresh = _five_min_bars(_STALE_BAR_TS + 300, 4, close=505.0)
    recovered = _patch_delta(monkeypatch, _Recorder(produce=fresh))
    third = abf.refresh_armed_groups(min_gap=0.0, attempts=1)
    assert third["refreshed"] == 1 and third["rows_written"] == 4
    assert len(recovered.calls) == 1
    assert abf._seconds_since_ok(("SPY", "5")) is not None, "a WRITE stamps"


def test_a_successful_refresh_suppresses_a_second_call_inside_the_interval(
        store, monkeypatch):
    """The two call sites (scheduler job + evaluator) must not double the budget.

    Both derive the same armed set from the same function. Without this gate the
    pod would issue two upstream calls per group per minute for one group's worth
    of value.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    fresh = _five_min_bars(_STALE_BAR_TS + 300, 4, close=505.0)
    rec = _patch_delta(monkeypatch, _Recorder(produce=fresh))

    first = abf.refresh_armed_groups(min_gap=0.0)
    assert first["refreshed"] == 1
    second = abf.refresh_armed_groups(min_gap=0.0)
    assert second["skipped_recent"] == 1
    assert second["refreshed"] == 0
    assert len(rec.calls) == 1, "the second caller must not reach the network"


def test_two_simultaneous_callers_make_exactly_one_upstream_call(store, monkeypatch):
    """The success gate is SEQUENTIAL — this covers what it cannot.

    `test_a_successful_refresh_suppresses_a_second_call_inside_the_interval`
    proves the SECOND caller is suppressed once the first has FINISHED. Two
    callers that arrive at the same instant both pass that gate, and with the
    scheduler job and the evaluator thread deriving the same armed set on the
    same 60-second cadence, simultaneous is a coin-flip away rather than a
    theoretical. Without the in-flight guard this fetches SPY/5 twice.

    ⚠️ THE OVERLAP IS CONSTRUCTED, NOT HOPED FOR. Two threads released from a
    barrier would only *usually* overlap; under a loaded box the second can be
    descheduled past the first's completion, find the success clock stamped, and
    report `skipped-recent` — which looks identical to a pass and would let a
    mutation that deletes the guard survive. So the second caller is not started
    until the first has provably entered the fetch and is sitting inside it.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    _always_stale(monkeypatch)

    calls: list[tuple[str, str]] = []
    call_lock = threading.Lock()
    inside_fetch = threading.Event()

    def _slow_fetch(sym, tf, last_ts):
        with call_lock:
            calls.append((sym, tf))
        inside_fetch.set()
        time.sleep(1.5)  # the window the second caller provably arrives inside
        return _five_min_bars(_STALE_BAR_TS + 600, 2)

    from api.services import bars_fetch as bf
    monkeypatch.setattr(bf, "_delta_intraday", _slow_fetch)

    first: list[dict] = []
    second: list[dict] = []

    def _sweep(bucket):
        bucket.append(abf.refresh_armed_groups(min_gap=0.0))

    t1 = threading.Thread(target=_sweep, args=(first,))
    t1.start()
    assert inside_fetch.wait(timeout=15), "the first caller never reached the fetch"
    t2 = threading.Thread(target=_sweep, args=(second,))
    t2.start()
    t1.join(timeout=30)
    t2.join(timeout=30)

    assert len(first) == 1 and len(second) == 1
    assert len(calls) == 1, (
        f"two simultaneous callers made {len(calls)} upstream calls for one group")
    assert first[0]["refreshed"] == 1
    assert second[0]["skipped_inflight"] == 1
    assert second[0]["refreshed"] == 0
    # The loser cost the store nothing, and the bars still landed — once.
    assert _ts_set(store, "SPY", "5") >= {_STALE_BAR_TS + 300, _STALE_BAR_TS + 600}
    # The guard released itself — a leaked marker would stall every later sweep.
    assert abf._INFLIGHT == {}


def test_the_inflight_marker_is_released_even_when_the_fetch_raises(store, monkeypatch):
    """A guard that leaks its marker converts one bad fetch into a permanently
    silent group — strictly worse than the staleness this module exists to fix."""
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    _always_stale(monkeypatch)
    _patch_delta(monkeypatch, _Recorder(raises=RuntimeError("boom")))

    out = abf.refresh_armed_groups(min_gap=0.0, attempts=1)
    assert out["errors"] == 1
    assert abf._INFLIGHT == {}, "the in-flight marker must not survive a failure"

    # And the group is immediately refreshable again.
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 600, 2)))
    again = abf.refresh_armed_groups(min_gap=0.0)
    assert again["refreshed"] == 1 and len(rec.calls) == 1


def test_an_already_fresh_group_costs_no_network_call(store, monkeypatch):
    """The gate is `bars_fetch._needs_fresh` — the chart lane's own predicate.

    Inheriting it rather than inventing a second staleness rule here is the
    point: after this fix the alert lane and the chart lane disagree about
    freshness in exactly zero cases.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    rec = _patch_delta(monkeypatch, _Recorder(produce=[{"t": 1, "o": 1, "h": 1,
                                                        "l": 1, "c": 1, "v": 1}]))
    from api.services import bars_fetch as bf
    monkeypatch.setattr(bf, "_needs_fresh", lambda last_ts, tf: False)

    out = abf.refresh_armed_groups(min_gap=0.0)
    assert out["already_fresh"] == 1
    assert out["refreshed"] == 0
    assert rec.calls == [], "a fresh group must not be fetched"


# ═══ 3. BOUNDED — THE SHARED BUDGET ══════════════════════════════════════════

def test_refresh_never_reaches_beyond_the_armed_set(store, monkeypatch):
    """⛔ MUTATION TARGET: a sweep over the whole universe must FAIL.

    The store here holds 40 (ticker, tf) pairs. ONE is armed. If the refresher
    ever sourced its work from the store, the hot list, or the cap universe
    instead of `list_active()`, this fails on the very first assertion.
    """
    for i in range(40):
        store.put_bars(f"SYM{i:02d}", "5",
                       _five_min_bars(_STALE_BAR_TS, 3), date_tf=False)
    _seed_stale_spy(store)
    assert len(store.get_all_tickers()) >= 41

    _fake_active(monkeypatch, [("SPY", "5")])
    _always_stale(monkeypatch)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 2)))

    out = abf.refresh_armed_groups(min_gap=0.0)

    assert rec.groups == {("SPY", "5")}, "only the ARMED group may be fetched"
    assert len(rec.calls) == 1
    assert out["groups_armed"] == 1


def test_max_groups_caps_the_sweep_and_serves_the_stalest_first(store, monkeypatch):
    """The second bound: even a large armed set cannot become a large sweep."""
    groups = [(f"AA{i:02d}", "5") for i in range(30)]
    # Staggered staleness: AA00 is the stalest, AA29 the freshest.
    for i, (sym, tf) in enumerate(groups):
        store.put_bars(sym, tf,
                       _five_min_bars(_STALE_BAR_TS + i * 300, 3), date_tf=False)
    _fake_active(monkeypatch, groups)
    _always_stale(monkeypatch)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(int(l) + 300, 1)))

    out = abf.refresh_armed_groups(max_groups=5, min_gap=0.0)

    assert out["groups_armed"] == 30
    assert out["groups_selected"] == 5
    assert out["groups_capped"] == 25
    assert len(rec.calls) == 5, "the cap is on FETCHES, not just on bookkeeping"
    assert rec.groups == {("AA00", "5"), ("AA01", "5"), ("AA02", "5"),
                          ("AA03", "5"), ("AA04", "5")}, "stalest first"


def test_concurrency_is_capped(store, monkeypatch):
    """At most `max_workers` fetches in flight — the pod has one event loop and
    a 64-slot anyio pool it shares with every user."""
    groups = [(f"BB{i:02d}", "5") for i in range(8)]
    for sym, tf in groups:
        store.put_bars(sym, tf, _five_min_bars(_STALE_BAR_TS, 3), date_tf=False)
    _fake_active(monkeypatch, groups)
    _always_stale(monkeypatch)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 1),
        delay=0.05))

    abf.refresh_armed_groups(max_workers=2, min_gap=0.0, deadline_seconds=30)

    assert rec.max_inflight <= 2, f"in-flight peaked at {rec.max_inflight}"
    assert len(rec.calls) == 8


def test_fetch_starts_are_paced_apart(store, monkeypatch):
    """A sweep is a trickle, not a burst.

    An unpaced sweep once 429'd on its FIRST call and engaged a 20-second shared
    cooldown for the whole pod. Pacing the STARTS is what keeps this job a
    minority of the shared budget rather than the thing that empties it.
    """
    groups = [(f"CC{i:02d}", "5") for i in range(4)]
    for sym, tf in groups:
        store.put_bars(sym, tf, _five_min_bars(_STALE_BAR_TS, 3), date_tf=False)
    _fake_active(monkeypatch, groups)
    _always_stale(monkeypatch)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 1)))

    gap = 0.15
    abf.refresh_armed_groups(max_workers=4, min_gap=gap, deadline_seconds=30)

    assert len(rec.starts) == 4
    starts = sorted(rec.starts)
    # 4 starts at >= `gap` apart cannot fit in less than 3 gaps.
    assert (starts[-1] - starts[0]) >= gap * 3 * 0.9, (
        f"starts spanned only {starts[-1] - starts[0]:.3f}s for gap={gap}")


def test_the_deadline_stops_a_slow_sweep(store, monkeypatch):
    """Wall clock is a bound too. Whatever does not fit waits for the next sweep
    instead of running long inside a 60-second cycle."""
    groups = [(f"DD{i:02d}", "5") for i in range(6)]
    for sym, tf in groups:
        store.put_bars(sym, tf, _five_min_bars(_STALE_BAR_TS, 3), date_tf=False)
    _fake_active(monkeypatch, groups)
    _always_stale(monkeypatch)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 1),
        delay=0.20))

    t0 = time.monotonic()
    out = abf.refresh_armed_groups(max_workers=1, min_gap=0.0,
                                   deadline_seconds=0.45)
    elapsed = time.monotonic() - t0

    assert out["deadline_hit"] >= 1, "some groups must be deferred"
    assert len(rec.calls) < 6, "the deadline must stop the sweep short"
    assert elapsed < 3.0, f"sweep ran {elapsed:.2f}s past a 0.45s deadline"


def test_refuses_to_run_on_the_event_loop(store, monkeypatch):
    """⛔ NEVER INLINE ON THE REQUEST PATH.

    The web pod is ONE uvicorn process; the 2026-07-01 outage was threadpool
    exhaustion. A blocking sweep invoked from an async handler would be that
    again. Refuse, and cost nothing but a log line.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    _always_stale(monkeypatch)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 2)))

    async def _from_a_handler():
        return abf.refresh_armed_groups(min_gap=0.0)

    out = asyncio.run(_from_a_handler())

    assert out["status"] == "refused-event-loop"
    assert out["refreshed"] == 0
    assert rec.calls == [], "a refused sweep must do NO work"


def test_the_kill_switch_stops_the_sweep(store, monkeypatch):
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    rec = _patch_delta(monkeypatch, _Recorder(produce=[{"t": 1}]))
    monkeypatch.setenv("ALERT_BARS_REFRESH_ENABLED", "0")

    out = abf.refresh_armed_groups(min_gap=0.0)
    assert out["status"] == "disabled"
    assert rec.calls == []


def test_no_armed_alerts_is_a_no_op(store, monkeypatch):
    """Production ran with zero armed alerts for most of Phase C. A sweep over
    nothing must cost nothing and must not read the bar store at all."""
    _fake_active(monkeypatch, [])
    rec = _patch_delta(monkeypatch, _Recorder(produce=[{"t": 1}]))
    out = abf.refresh_armed_groups(min_gap=0.0)
    assert out["status"] == "no-armed-groups"
    assert out["groups_armed"] == 0
    assert rec.calls == []


# ═══ 4. THE FAILURE DIRECTION ════════════════════════════════════════════════

def test_upstream_down_leaves_the_store_intact_and_alerts_still_evaluate(
        store, monkeypatch):
    """⛔ THE FAILURE DIRECTION. Upstream down must mean "keep evaluating on the
    stale bars we have" — not a crash, and above all not an empty series.

    Asserted through the REAL `indicator_alert_evaluator._fetch_bars_for_alert`,
    because that is the function whose answer the alert lane actually acts on.
    A test that asserted only on this module's return value would not have
    covered the thing that matters.
    """
    from api.services import indicator_alert_evaluator as ev

    seeded_ts = _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    _always_stale(monkeypatch)

    before_ts = _ts_set(store, "SPY", "5")
    before_bars = ev._fetch_bars_for_alert("SPY", "5", 200)
    assert len(before_bars) == 60

    boom = _Recorder(raises=RuntimeError("massive: connection reset"))
    _patch_delta(monkeypatch, boom)

    out = abf.refresh_armed_groups(min_gap=0.0, attempts=2, backoff=0.0)

    # 1. It did not crash the caller.
    assert out["status"] == "ok"
    assert out["errors"] == 1 and out["refreshed"] == 0
    # 2. It retried within the sweep rather than giving up on the first blip.
    assert len(boom.calls) == 2
    # 3. The store is byte-for-byte the set it was.
    assert _ts_set(store, "SPY", "5") == before_ts == set(seeded_ts)
    # 4. And the alert lane still has its series — stale, but present.
    after_bars = ev._fetch_bars_for_alert("SPY", "5", 200)
    assert after_bars == before_bars
    assert len(after_bars) == 60, "the alert lane must NOT be handed an empty series"


def test_a_broken_group_does_not_stop_the_others(store, monkeypatch):
    """One bad symbol may not cost the rest of the armed set its data."""
    store.put_bars("SPY", "5", _five_min_bars(_STALE_BAR_TS, 5), date_tf=False)
    store.put_bars("QQQ", "5", _five_min_bars(_STALE_BAR_TS, 5), date_tf=False)
    _fake_active(monkeypatch, [("SPY", "5"), ("QQQ", "5")])
    _always_stale(monkeypatch)

    seeded = {b["t"] for b in _five_min_bars(_STALE_BAR_TS, 5)}

    def _produce(sym, tf, last_ts):
        if sym == "SPY":
            raise RuntimeError("upstream 500")
        return _five_min_bars(_STALE_BAR_TS + 600, 2, close=400.0)

    _patch_delta(monkeypatch, _Recorder(produce=_produce))
    out = abf.refresh_armed_groups(min_gap=0.0, attempts=1)

    assert out["errors"] == 1 and out["refreshed"] == 1
    # QQQ gained both new bars by identity; SPY is untouched, not emptied.
    assert _ts_set(store, "QQQ", "5") == seeded | {_STALE_BAR_TS + 300,
                                                  _STALE_BAR_TS + 600}
    assert _ts_set(store, "SPY", "5") == seeded


def test_a_group_with_no_rows_at_all_sorts_first_and_is_populated(store, monkeypatch):
    """An alert on a symbol the store has NEVER seen is evaluating on an empty
    series right now. That is the most starved group there is, not the freshest."""
    store.put_bars("SPY", "5", _five_min_bars(_STALE_BAR_TS, 5), date_tf=False)
    _fake_active(monkeypatch, [("SPY", "5"), ("TSLA", "5")])
    _always_stale(monkeypatch)

    measured = abf.measure_staleness([("SPY", "5"), ("TSLA", "5")], now=_NOW_TS)
    tsla = [m for m in measured if m["sym"] == "TSLA"][0]
    assert tsla["has_rows"] is False and tsla["last_ts"] is None
    assert tsla["stale_seconds"] is None
    assert abf._sort_priority(tsla) == float("inf")

    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 3)))
    out = abf.refresh_armed_groups(max_groups=1, min_gap=0.0)

    assert rec.groups == {("TSLA", "5")}, "the group with no rows goes first"
    assert out["refreshed"] == 1
    assert len(_ts_set(store, "TSLA", "5")) == 3


# ═══ 5. THE WRITE CONTRACT ═══════════════════════════════════════════════════

def test_the_write_is_put_bars_newest_wins_and_never_deletes(store, monkeypatch):
    """⛔ NEWEST BAR WINS PER (ticker, tf, ts), ON EVERY PATH.

    The refresher issues no SQL of its own: it hands `bars_fetch`'s delta output
    to `bars_sqlite.put_bars`, which is the subsystem's one upsert. A re-fetched
    bar with the same `ts` UPDATES in place — the developing bar heals — and the
    row count never falls.
    """
    _seed_stale_spy(store)
    _fake_active(monkeypatch, [("SPY", "5")])
    _always_stale(monkeypatch)

    before_ts = _ts_set(store, "SPY", "5")
    before_rows = store.get_bars("SPY", "5", 100000)
    old_close = [r for r in before_rows if r[0] == _STALE_BAR_TS][0][4]

    # The heal window re-emits the newest STORED bar with corrected values, plus
    # one genuinely new bar — exactly what `_delta_intraday` returns.
    healed = [
        {"t": _STALE_BAR_TS, "o": 500, "h": 512, "l": 499, "c": 511.5, "v": 99999},
        {"t": _STALE_BAR_TS + 300, "o": 511, "h": 513, "l": 510, "c": 512.0, "v": 1},
    ]
    _patch_delta(monkeypatch, _Recorder(produce=healed))
    abf.refresh_armed_groups(min_gap=0.0)

    after_rows = store.get_bars("SPY", "5", 100000)
    after_ts = _ts_set(store, "SPY", "5")
    new_close = [r for r in after_rows if r[0] == _STALE_BAR_TS][0][4]

    assert new_close == 511.5 and new_close != old_close, "newest fetch wins in place"
    assert after_ts == before_ts | {_STALE_BAR_TS + 300}
    assert len(after_rows) == len(before_rows) + 1, "one new bar, none replaced away"


def test_daily_alerts_write_through_the_date_keyed_path(store, monkeypatch):
    """`bars_sqlite` keys D/W/M rows with a YYYYMMDD int, intraday with unix
    seconds — its own module docstring is the contract. A daily alert that wrote
    an instant into a date-keyed row would corrupt the series silently."""
    from api.services import bars_fetch as bf
    store.put_bars("SPY", "D", [{"t": "2026-08-05", "o": 1, "h": 2, "l": 1,
                                 "c": 2, "v": 10}], date_tf=True)
    _fake_active(monkeypatch, [("SPY", "D")])
    monkeypatch.setattr(bf, "_needs_fresh", lambda last_ts, tf: True)

    calls = []

    def _daily(sym, last_ts):
        calls.append((sym, last_ts))
        return [{"t": "2026-08-06", "o": 2, "h": 3, "l": 2, "c": 3, "v": 20},
                {"t": "2026-08-07", "o": 3, "h": 4, "l": 3, "c": 4, "v": 30}]

    monkeypatch.setattr(bf, "_delta_daily", _daily)
    out = abf.refresh_armed_groups(min_gap=0.0)

    assert calls == [("SPY", 20260805)]
    assert out["refreshed"] == 1
    assert _ts_set(store, "SPY", "D") == {20260805, 20260806, 20260807}
    assert store.get_last_ts("SPY", "D") == 20260807


def test_the_delta_dispatch_reuses_bars_fetch_for_every_timeframe(monkeypatch):
    """⛔ NOT A SECOND FETCHER. Every timeframe must land on `bars_fetch`'s own
    delta function — Massive→yfinance fallback, ET bucketing and the 60-minute
    15-minute resample all come from there, or they do not come at all."""
    from api.services import bars_fetch as bf
    seen = {}
    monkeypatch.setattr(bf, "_delta_intraday",
                        lambda s, t, l: seen.setdefault(("intraday", t), True) and [])
    monkeypatch.setattr(bf, "_delta_daily",
                        lambda s, l: seen.setdefault("daily", True) and [])
    monkeypatch.setattr(bf, "_delta_weekly",
                        lambda s, l: seen.setdefault("weekly", True) and [])
    monkeypatch.setattr(bf, "_delta_monthly",
                        lambda s, l: seen.setdefault("monthly", True) and [])

    for tf in abf.INTRADAY_TFS:
        abf._delta_for("SPY", tf, 0)
        assert ("intraday", tf) in seen
    abf._delta_for("SPY", "D", 0)
    abf._delta_for("SPY", "W", 0)
    abf._delta_for("SPY", "M", 0)
    assert {"daily", "weekly", "monthly"} <= set(seen)

    with pytest.raises(ValueError):
        abf._delta_for("SPY", "4H", 0)


def test_an_unsupported_timeframe_is_an_error_not_a_silent_skip(store, monkeypatch):
    """A timeframe nobody wrote a delta for must be visible as an error, not
    swallowed into "already fresh"."""
    store.put_bars("SPY", "5", _five_min_bars(_STALE_BAR_TS, 3), date_tf=False)
    _fake_active(monkeypatch, [("SPY", "4H")])
    _always_stale(monkeypatch)
    out = abf.refresh_armed_groups(min_gap=0.0, attempts=1)
    assert out["errors"] == 1
    assert out["refreshed"] == 0


# ═══ 6. THE ARMED SET ITSELF ═════════════════════════════════════════════════

def test_armed_groups_dedupes_31_alerts_into_one_group(store, monkeypatch):
    """The production shape: 31 alerts, ONE (SPY, 5) group, ONE upstream call.

    This is why the fix is affordable at all — and why it must be sourced from
    `list_active()` and deduped, not iterated per alert.
    """
    from api.services import indicator_alert_service as ias
    monkeypatch.setattr(ias, "list_active",
                        lambda: [{"id": i, "sym": "spy", "tf": "5"}
                                 for i in range(31)])
    assert abf.armed_groups() == [("SPY", "5")]

    _seed_stale_spy(store)
    rec = _patch_delta(monkeypatch, _Recorder(
        produce=lambda s, t, l: _five_min_bars(_STALE_BAR_TS + 300, 2)))
    _always_stale(monkeypatch)
    abf.refresh_armed_groups(min_gap=0.0)
    assert len(rec.calls) == 1, "31 alerts, one fetch"


def test_a_broken_alert_service_is_survivable(monkeypatch):
    """If `list_active()` raises, the sweep is empty — it does not take the
    scheduler thread down with it."""
    from api.services import indicator_alert_service as ias

    def _boom():
        raise RuntimeError("auth.db locked")

    monkeypatch.setattr(ias, "list_active", _boom)
    assert abf.armed_groups() == []
    assert abf.refresh_armed_groups(min_gap=0.0)["status"] == "no-armed-groups"


def test_run_scheduled_sweep_never_raises(store, monkeypatch):
    """The APScheduler entry point. A raising job spams the log and, on a
    misconfigured pool, can wedge the slot."""
    from api.services import indicator_alert_service as ias
    monkeypatch.setattr(ias, "list_active",
                        lambda: (_ for _ in ()).throw(RuntimeError("nope")))
    assert abf.run_scheduled_sweep()["status"] in ("no-armed-groups", "error")


# ═══ 7. THE WIRING ═══════════════════════════════════════════════════════════

def test_the_sweep_is_registered_on_the_background_scheduler():
    """A structural read of `api/main.py`'s registration.

    ⚠️ STRUCTURAL, and named as such. It cannot prove the job RUNS — importing
    `api.main` would build the whole lifespan and start real jobs against the
    real /data. What it does prove is the three properties that make this job
    safe to have at all, and it fails if any of them is quietly edited away:

      · the target is `run_scheduled_sweep`, the never-raising entry point;
      · `max_instances=1`, so a slow sweep queues behind itself rather than
        fanning out across APScheduler's ten shared worker slots;
      · it is added to `_scheduler` — the BackgroundScheduler, which has its own
        thread pool and spends ZERO of the 64 anyio slots the pod serves
        requests on.
    """
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py") \
        .read_bytes().decode("utf-8")
    tree = ast.parse(src)

    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        kw = {k.arg: k.value for k in node.keywords}
        job_id = kw.get("id")
        if not (isinstance(job_id, ast.Constant)
                and job_id.value == "alert_bars_freshness"):
            continue
        found.append((node, kw))

    assert len(found) == 1, "exactly one alert_bars_freshness job registration"
    node, kw = found[0]

    # .add_job on `_scheduler` (the BackgroundScheduler), not anywhere else.
    assert isinstance(node.func, ast.Attribute) and node.func.attr == "add_job"
    assert isinstance(node.func.value, ast.Name) and node.func.value.id == "_scheduler"

    target = node.args[0]
    assert isinstance(target, ast.Attribute)
    assert target.attr == "run_scheduled_sweep"

    assert isinstance(kw.get("max_instances"), ast.Constant)
    assert kw["max_instances"].value == 1
    assert isinstance(kw.get("coalesce"), ast.Constant) and kw["coalesce"].value is True
