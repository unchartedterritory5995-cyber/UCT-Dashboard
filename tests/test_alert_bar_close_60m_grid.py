"""The 60-minute grid is not uniform, and `bar_close_epoch` has to know it.

WHAT THIS FILE MEASURES, AND WHY IT EXISTS SEPARATELY FROM THE REPLAY
--------------------------------------------------------------------
`bars_fetch.bucket_60_et_unix_seconds` gives the regular-session open its OWN
bucket, so a 60-minute session runs ``04:00…09:00, 09:30, 10:00…19:00`` and BOTH
the 09:00 and the 09:30 bar span THIRTY minutes. `bar_close_epoch` used to answer
``t + 3600`` for every intraday hourly bar, so it declared those two bars still
open for half an hour after the store had stopped writing to them. Under
``ALERT_EVAL_MODE = "closed"`` that is a user-visible LATENCY: measured on the
frozen `hourly_open_60m` tape, an alert on either bar could not fire until
**exactly 1800 seconds** after the bar became final — in the busiest half hour of
the day, on top of the 60-second poll.

⚠️ `tools/alert_replay.py --repaint` and `--diff` ARE STRUCTURALLY BLIND TO IT.
`make_closed_evaluate` derives `now_epoch` from `bar_close_epoch` itself
(`close_at - 1`), so an error in that function cancels out of every replay
number: 1,378,980 corpus fires all agreed with a clock they inherited from the
subject. Nothing in this file may be built on `--repaint` or `--diff` for that
reason. Every assertion here is against **bar data** — the frozen tape, and the
bucket function the WRITER routes live prints with.

THE TWO DIRECTIONS, AND WHY THEY ARE NOT SYMMETRIC
--------------------------------------------------
A LATE close costs a member thirty minutes. An EARLY close hands the closed lane
a bar that then CHANGES — repaint, reintroduced from a new direction, in the lane
built to remove it. So lateness is measured here (and now removed), while
earliness is guarded by a rail that must never go quiet:
`test_no_bar_is_declared_closed_while_the_writer_still_routes_prints_into_it`
asks `bar_rollup.bucket_start` — the function the WebSocket rollup path uses to
decide which stored bar a live minute belongs to — whether a print one minute
before the claimed close would still land in this bar. That is the operational
definition of "the row can still move", read off the writer rather than off the
function under test.
"""

from __future__ import annotations

import datetime
import pathlib
import sys
import zoneinfo

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar  # noqa: E402
from api.services import bar_rollup  # noqa: E402
from api.services import indicator_alert_evaluator as ev  # noqa: E402
from api.services.bars_fetch import bucket_60_et_unix_seconds  # noqa: E402

_ET = zoneinfo.ZoneInfo("America/New_York")

#: The two starts whose bucket is thirty minutes long, as wall-clock ET.
_OPEN_BUCKET_STARTS = {"09:00", "09:30"}


def _wall(t) -> str:
    return datetime.datetime.fromtimestamp(t, _ET).strftime("%Y-%m-%d %H:%M:%S")


def _hhmm(t) -> str:
    return datetime.datetime.fromtimestamp(t, _ET).strftime("%H:%M")


def _unix(y, m, d, hh=0, mm=0) -> int:
    return int(datetime.datetime(y, m, d, hh, mm, tzinfo=_ET).timestamp())


@pytest.fixture(scope="module")
def hourly():
    """SPY 60-minute tape, 17 sessions, frozen with its own sha256."""
    return ar.load_fixture("hourly_open_60m")["bars"]


def _open_bucket_indices(bars) -> list[int]:
    """Every bar in the tape that starts an irregular (30-minute) bucket.

    Derived from the wall clock of the frozen tape, not from a hand-typed index
    list — a fixture that changed shape must move this set, not silently keep a
    stale one.
    """
    return [i for i in range(len(bars) - 1)
            if _hhmm(bars[i]["t"]) in _OPEN_BUCKET_STARTS]


# ─── THE DEFECT, MEASURED THROUGH THE LANE A MEMBER ACTUALLY WAITS ON ────────

def test_an_hourly_open_bucket_is_judgeable_when_the_tape_says_it_stopped(hourly):
    """🔴 THE 30-MINUTE LATENESS, ON REAL TAPE, THROUGH `closed_bar_index`.

    The tape itself says when a bar stopped being able to change: the NEXT bar
    starts. This walks a real 60-second poll — at each minute the store holds
    exactly the bars whose `t` has arrived — and records the first poll at which
    `closed_bar_index` will name the open-bucket bar at all. An alert on that bar
    cannot fire one second sooner than that, whatever else the lane does.

    On today's `t + 3600` this reads **+1800 s on all 20 bars** (10 sessions × 2
    buckets). The assertion is "within one poll", not "exactly equal", because a
    60-second cycle is the granularity a member is actually offered.
    """
    late: dict[str, int] = {}
    measured = 0
    for i in _open_bucket_indices(hourly):
        became_final = hourly[i + 1]["t"]           # the tape's own answer
        start = int(hourly[i]["t"])
        first = None
        for now in range(start, start + 4 * 3600, 60):
            seen = [b for b in hourly if b["t"] <= now]
            if ev.closed_bar_index(seen, "60", now) == i:
                first = now
                break
        assert first is not None, f"bar {i} ({_wall(start)}) is never judged at all"
        measured += 1
        if first - became_final >= 60:
            late[_wall(start)] = int(first - became_final)

    assert measured >= 20, f"the fixture stopped carrying open buckets ({measured})"
    assert not late, (
        f"{len(late)} of {measured} regular-session-open hourly bars are judged "
        f"LATE — the store stopped writing to them and the closed lane went on "
        f"calling them open. seconds late, by bar: {late}")


def test_a_real_rsi_cross_on_the_0930_bar_fires_when_the_bar_becomes_final(hourly):
    """🔴 THE SAME DEFECT END TO END: a real alert, a real cross, a real clock.

    2026-07-17: RSI(14) on SPY 60m crosses up through 31 exactly on the 09:30
    bar (26.10 → 35.80). The bar became final at 10:00 ET — the 10:00 bar's own
    start, on the frozen tape. This sweeps the 60-second poll and asks
    `_evaluate_one_closed` for the first cycle that fires ABOUT THAT BAR
    (`triggered` **and** `bar_index == target`).

    On today's code the answer is 10:30 ET. That is the sentence a member would
    write in a support ticket: *"my hourly alert is thirty minutes late."*
    """
    target = next(i for i in _open_bucket_indices(hourly)
                  if _wall(hourly[i]["t"]).startswith("2026-07-17 09:30"))
    became_final = hourly[target + 1]["t"]
    assert _wall(became_final).startswith("2026-07-17 10:00"), _wall(became_final)

    alert = {"id": 1, "sym": "SPY", "tf": "60", "indicator": "rsi",
             "condition": "cross_above", "threshold": 31.0,
             "params": '{"period": 14}'}

    first = None
    for now in range(int(hourly[target]["t"]), int(hourly[target]["t"]) + 4 * 3600, 60):
        seen = [b for b in hourly if b["t"] <= now]
        _value, triggered, index = ev._evaluate_one_closed(alert, bars=seen,
                                                           now_epoch=now)
        if triggered and index == target:
            first = now
            break

    assert first is not None, "the cross never fires at any poll — bad fixture pick"
    assert first - became_final < 60, (
        f"the alert on the 09:30 bar fires at {_wall(first)} but the bar became "
        f"final at {_wall(became_final)} — {int(first - became_final)} seconds "
        f"late")


# ─── THE EQUALITY AGAINST THE NEXT BAR'S START (the corpus's oracle) ─────────

def test_bar_close_epoch_equals_the_next_bar_start_on_every_adjacent_pair(hourly):
    """The independent oracle: a calendar computation vs. FROZEN REAL TAPE.

    `bar_close_epoch` answers from the ET calendar; `bars[i+1]["t"]` is what the
    store actually wrote. They are two different sources, so this is a real
    equality and not an identity — it goes red if the evaluator's grid and the
    store's grid ever stop being the same grid, in either direction.

    Pairs separated by a GAP (overnight, holiday) are excluded and COUNTED, so a
    fixture that quietly became all-gaps cannot pass this vacuously.
    """
    adjacent = gaps = 0
    late: list[str] = []
    for i in range(len(hourly) - 1):
        close_at = ev.bar_close_epoch(hourly[i]["t"], "60")
        assert close_at is not None, hourly[i]["t"]
        nxt = hourly[i + 1]["t"]
        if close_at > nxt:
            late.append(f"{_wall(hourly[i]['t'])} closes at {_wall(close_at)} "
                        f"but the next bar starts at {_wall(nxt)}")
        elif close_at == nxt:
            adjacent += 1
        else:
            gaps += 1

    assert not late, (
        f"{len(late)} bars are superseded before `bar_close_epoch` says they "
        f"close: {late[:4]}")
    assert adjacent >= 180, f"too few grid-adjacent pairs to mean anything: {adjacent}"
    assert gaps >= 10, f"the fixture lost its overnight gaps: {gaps}"
    assert adjacent + gaps == len(hourly) - 1


def test_only_the_two_open_buckets_are_shorter_than_an_hour(hourly):
    """LOCALISATION — the irregularity is exactly two wall-clock starts.

    Without this, "the 60-minute close is not always +3600" could be a statement
    about the tape rather than about one bucket rule, and a fix could quietly
    move the wrong bars.
    """
    lengths: dict[str, set] = {}
    for bar in hourly:
        close_at = ev.bar_close_epoch(bar["t"], "60")
        lengths.setdefault(_hhmm(bar["t"]), set()).add(close_at - bar["t"])

    short = {k: sorted(v) for k, v in lengths.items() if v != {3600.0}}
    assert set(short) == _OPEN_BUCKET_STARTS, f"the grid changed shape: {short}"
    for start, seen in short.items():
        assert seen == [1800.0], (start, seen)
    assert len(lengths) >= 10, f"the tape lost its session spread: {sorted(lengths)}"


# ─── THE EARLINESS RAIL — asked of the WRITER, not of the subject ────────────

def test_no_bar_is_declared_closed_while_the_writer_still_routes_prints_into_it(hourly):
    """⛔ THE DIRECTION THAT MUST NEVER BREAK. A wrong-EARLY close is repaint.

    `bar_rollup.bucket_start` is what the WebSocket rollup path calls to decide
    which stored bar a live minute belongs to. So "this row can still change" has
    an operational definition that does not go through `bar_close_epoch` at all:
    a print at instant X still lands in bar `t` iff `bucket_start(X) == t`.

    Two claims per bar, and they bracket the answer from both sides:
      * one minute BEFORE the claimed close, a print still routes into this bar
        (so the close is not EARLY);
      * AT the claimed close, a print routes somewhere else (so it is not LATE).
    """
    checked = 0
    for bar in hourly:
        t = int(bar["t"])
        close_at = ev.bar_close_epoch(t, "60")
        assert close_at is not None
        close_at = int(close_at)
        assert close_at > t
        assert bar_rollup.bucket_start((close_at - 60) * 1000, "60") == t * 1000, (
            f"{_wall(t)}: a print at {_wall(close_at - 60)} still belongs to this "
            f"bar, but bar_close_epoch already called it closed at "
            f"{_wall(close_at)} — that is repaint")
        assert bar_rollup.bucket_start(close_at * 1000, "60") != t * 1000, (
            f"{_wall(t)}: a print at the claimed close {_wall(close_at)} would "
            f"still land in this bar")
        checked += 1
    assert checked == len(hourly) >= 200, checked


def test_the_claimed_close_is_a_bucket_start_the_writer_recognises(hourly):
    """Every close this lane names is itself the start of the NEXT stored bar.

    A boundary that is not a bucket start would mean the evaluator invented a
    grid of its own — the failure the canonical bucketer exists to make
    unrepresentable (`bars_fetch` §"Public + top-level on purpose").
    """
    for bar in hourly:
        close_at = int(ev.bar_close_epoch(bar["t"], "60"))
        assert bucket_60_et_unix_seconds(close_at) == close_at, _wall(close_at)


# ─── CONTROLS: everything else must be exactly as it was ────────────────────

@pytest.mark.parametrize("name,tf,step", [("thin_illiquid_5m", "5", 300),
                                          ("halfday_30m", "30", 1800),
                                          ("gap_open_5m", "5", 300),
                                          ("high_vol_5m", "5", 300)])
def test_the_uniform_intraday_grids_are_untouched(name, tf, step):
    """The control that localises the change to the hourly bucketer.

    5/15/30 are a plain UTC-second floor in `bar_rollup.bucket_start`, so their
    close IS the nominal one and this fix must not have moved it.
    """
    bars = ar.load_fixture(name)["bars"]
    for i in range(len(bars) - 1):
        close_at = ev.bar_close_epoch(bars[i]["t"], tf)
        assert close_at == bars[i]["t"] + step
        assert bars[i + 1]["t"] >= close_at, (
            f"{name}: the bar at {bars[i]['t']} is superseded before "
            f"bar_close_epoch says it closes")


def test_the_calendar_timeframes_are_untouched():
    """D is the next ET MIDNIGHT (not 16:00), W is +7 days, M is a CALENDAR step.

    Restated here because this change is in the same function: extended hours
    still update the stored daily row, so a 16:00 daily boundary would be exactly
    the early-close defect this file guards against, one timeframe over.
    """
    assert ev.bar_close_epoch(20260805, "D") == _unix(2026, 8, 6)
    assert ev.bar_close_epoch("2026-08-05", "D") == _unix(2026, 8, 6)
    assert ev.bar_close_epoch(20260401, "W") == _unix(2026, 4, 8)
    assert ev.bar_close_epoch(20260201, "M") == _unix(2026, 3, 1)
    assert ev.bar_close_epoch(20261201, "M") == _unix(2027, 1, 1)
    # the DST-crossing daily bar is 25 hours, resolved per instant
    assert ev.bar_close_epoch(20261101, "D") - _unix(2026, 11, 1) == 25 * 3600


def test_the_unknowable_still_answers_none():
    """`None` means "cannot claim this bar has closed" — the safe direction."""
    assert ev.bar_close_epoch(20260805, "H") is None
    assert ev.bar_close_epoch("not-a-date", "D") is None
    assert ev.bar_close_epoch(None, "60") is None
    assert ev.bar_close_epoch(True, "60") is None
    assert ev.bar_close_epoch("1784052000", "60") is None


# ─── THE GRID ITSELF, AWAY FROM THE TAPE ────────────────────────────────────

def test_the_two_open_buckets_close_where_the_session_grid_says():
    """The rule, stated on named instants: 09:00→09:30, 09:30→10:00, else +1h."""
    assert ev.bar_close_epoch(_unix(2026, 7, 15, 9, 0), "60") == _unix(2026, 7, 15, 9, 30)
    assert ev.bar_close_epoch(_unix(2026, 7, 15, 9, 30), "60") == _unix(2026, 7, 15, 10, 0)
    assert ev.bar_close_epoch(_unix(2026, 7, 15, 10, 0), "60") == _unix(2026, 7, 15, 11, 0)
    assert ev.bar_close_epoch(_unix(2026, 7, 15, 4, 0), "60") == _unix(2026, 7, 15, 5, 0)
    assert ev.bar_close_epoch(_unix(2026, 7, 15, 15, 0), "60") == _unix(2026, 7, 15, 16, 0)
    # the last bucket of the ET day rolls the DATE, not the hour field
    assert ev.bar_close_epoch(_unix(2026, 7, 15, 23, 0), "60") == _unix(2026, 7, 16, 0, 0)


def test_the_dst_fall_back_hour_is_two_hours_long_and_nominal_would_be_early():
    """⛔ AN EARLY-CLOSE HOLE THE NOMINAL ANSWER ALSO HAD, CLOSED BY THE SAME FIX.

    On the fall-back day 01:00 ET happens twice, so the 01:00 bucket really is
    7,200 seconds long — and `t + 3600` would have declared it closed while the
    second 01:00 hour was still routing prints into it. No stored 60-minute bar
    starts at 01:00 today (pre-market opens at 04:00), which is why nobody was
    bitten; deriving the boundary from the bucketer removes the hole rather than
    relying on that.
    """
    fall_back = _unix(2026, 11, 1, 1)          # 01:00 EDT
    close_at = ev.bar_close_epoch(fall_back, "60")
    assert close_at - fall_back == 7200, close_at
    assert bar_rollup.bucket_start(int(close_at - 60) * 1000, "60") == fall_back * 1000
    # spring forward: 02:00 ET does not exist, so 01:00 EST closes at 03:00 EDT
    spring = _unix(2026, 3, 8, 1)
    assert ev.bar_close_epoch(spring, "60") == _unix(2026, 3, 8, 3)


def test_an_off_grid_60m_timestamp_falls_back_to_the_nominal_close():
    """A `t` the canonical bucketer does not call a bucket start gets `t + 3600`.

    The store can carry off-grid rows (the corpus found MSTR 5m at `12:33:48`),
    and "when does a bar that is not a bucket stop changing" has no answer. The
    fallback is the behaviour that shipped today, and it is LATE-not-early: the
    containing bucket's close is at most an hour past its own start, so it is at
    most an hour past `t` too.
    """
    off_grid = _unix(2026, 7, 15, 9, 0) + 900        # 09:15, inside the 09:00 bucket
    assert bucket_60_et_unix_seconds(off_grid) != off_grid
    assert ev.bar_close_epoch(off_grid, "60") == off_grid + 3600
    # …and the nominal answer is never EARLIER than the containing bucket's close
    assert off_grid + 3600 >= ev.bar_close_epoch(bucket_60_et_unix_seconds(off_grid), "60")
