"""The earnings run-up and the past earnings-day moves read OUR OWN daily bars
first, Yahoo when they cannot answer.

`earnings_enrichment.get_pre_earnings_context` and
`earnings_enrichment.get_historical_earnings_moves` used to read daily prices
from Yahoo only. They now ask the house daily-bar reader first and go on to the
same guarded Yahoo read only when our bars cannot answer. These tests pin:

  * the order: our bars answer and Yahoo is never reached;
  * every "cannot answer" rule, on both sides of its boundary;
  * that the arithmetic did not move: the SAME bars through either source give
    the identical payload, slot for slot;
  * the bound on the own-bars read, and the one read an enrichment call shares.

No bar store, no network: `_house_daily_bars` (the seam over the house reader)
and `yfinance.Ticker` are both stand-ins here.
"""
from __future__ import annotations

import datetime as dt
import threading
import time

import pandas as pd
import pytest

from api.services import earnings_enrichment as ee
from api.services import yf_util

SYM = "OWNB"


@pytest.fixture(autouse=True)
def _own_daily_bars_cannot_answer():
    """Overrides the suite default of the same name (tests/conftest.py), which
    switches the own-bars read off. This file drives that read itself."""
    yield


@pytest.fixture(autouse=True)
def _clean_guard_and_counts():
    yf_util.reset_guard_state()
    with ee._BARS_COUNTS_LOCK:
        ee._BARS_SOURCE_COUNTS.clear()
    yield
    yf_util.reset_guard_state()
    with ee._SHARED_LOCK:
        ee._SHARED_READS.clear()


# ── builders ────────────────────────────────────────────────────────────────

def weekdays(end: dt.date, n: int) -> list[dt.date]:
    """`n` weekdays ending at `end`, oldest first."""
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= dt.timedelta(days=1)
    return out[::-1]


def bar(day: dt.date, o: float, c: float) -> dict:
    return {"t": day.isoformat(), "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": 1000}


def flat_bars(days: list[dt.date], closes: list[float] | None = None) -> list[dict]:
    closes = closes or [100.0] * len(days)
    return [bar(d, c, c) for d, c in zip(days, closes)]


def yahoo_frame(bars: list[dict]) -> pd.DataFrame:
    """The same bars in the shape the Yahoo read returns."""
    return pd.DataFrame(
        {"Open": [b["o"] for b in bars], "Close": [b["c"] for b in bars]},
        index=pd.to_datetime([b["t"] for b in bars]),
    )


TAIL = "tail"


class Own:
    """Stand-in for the bar store behind `_house_daily_bars` and
    `_house_last_daily_session`."""

    def __init__(self, monkeypatch):
        self.bars: list[dict] = []
        self.calls: list[tuple[str, str]] = []
        self.meta: dict | None = {"ipo": None, "splits": []}
        self.latest_session: int | None = None
        # The newest daily session the store holds: TAIL = the last of `bars`
        # (a current store), None = no row for the symbol, an int = that day.
        self.stored_last: int | None | str = TAIL
        self.store_error: Exception | None = None
        self.store_checks: list[str] = []
        self.jobs: list[str] = []                    # bounded reads actually started
        self._mp = monkeypatch
        from api.services import bars_fetch, bars_sanitize
        real_job = bars_fetch._bounded_job

        def job(key, fn, deadline, *a, **k):
            self.jobs.append(key)
            return real_job(key, fn, deadline, *a, **k)

        monkeypatch.setattr(bars_fetch, "_bounded_job", job)
        monkeypatch.setattr(ee, "_house_last_daily_session", self._stored)
        monkeypatch.setattr(ee, "_house_daily_bars", self._read)
        monkeypatch.setattr(bars_sanitize, "_meta_cached", lambda ticker: self.meta)
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                            lambda now=None: self._latest())

    def _read(self, sym, since_iso):
        self.calls.append((sym, since_iso))
        return [dict(b) for b in self.bars]

    def _stored(self, sym):
        self.store_checks.append(sym)
        if self.store_error is not None:
            raise self.store_error
        if self.stored_last == TAIL:
            return int(str(self.bars[-1]["t"]).replace("-", "")) if self.bars else self._latest()
        return self.stored_last

    def _latest(self) -> int:
        if self.latest_session is not None:
            return self.latest_session
        return int(str(self.bars[-1]["t"]).replace("-", "")) if self.bars else 20990101


class Yahoo:
    """Stand-in for `yfinance.Ticker`. `frame=None` is a Yahoo that has nothing."""

    def __init__(self, monkeypatch):
        self.frame: pd.DataFrame | None = None
        self.calls: list[dict] = []
        outer = self

        class _FakeTicker:
            def __init__(self, *a, **k):
                pass

            def history(self, *a, **k):
                outer.calls.append(k)
                return outer.frame

        monkeypatch.setattr("yfinance.Ticker", _FakeTicker)


@pytest.fixture
def own(monkeypatch):
    return Own(monkeypatch)


@pytest.fixture(autouse=True)
def yahoo(monkeypatch):
    """Autouse: no test in this file can reach the real Yahoo client, whether
    or not it asks for the stand-in by name."""
    return Yahoo(monkeypatch)


# A small hand-checkable frame: ten sessions, Mon 2026-03-02 .. Fri 2026-03-13.
DAYS = weekdays(dt.date(2026, 3, 13), 10)
OPENS = [100.0, 100.0, 110.0, 108.0, 90.0, 95.0, 100.0, 98.0, 105.0, 104.0]
CLOSES = [100.0, 102.0, 108.0, 120.0, 95.0, 96.0, 98.0, 99.0, 104.0, 106.0]
TEN = [bar(d, o, c) for d, o, c in zip(DAYS, OPENS, CLOSES)]

# Newest first, as `engine._fetch_quarterly_history` hands them over.
QUARTERS = [
    {"reportedDate": "2026-03-13", "reportTime": "post-market"},   # the last bar: not knowable yet
    {"reportedDate": "2026-03-11", "reportTime": ""},              # unknown: the after-close gap is bigger
    {"reportedDate": "2026-03-10", "reportTime": ""},              # unknown: the before-open gap is bigger
    {"reportedDate": None, "fiscalDateEnding": None},              # no date at all
    {"reportedDate": "2026-03-05", "reportTime": "post-market"},   # close 120 -> next open 90
    {"reportedDate": "2026-03-04", "reportTime": "pre-market"},    # prior close 102 -> open 110
]
EXPECTED_MOVES = [None, 6.1, 4.2, None, -25.0, 7.8]
EXPECTED = {"avg_abs_move_pct": 10.8, "moves_pct": EXPECTED_MOVES, "n_quarters": 4}

# Thirty sessions ending on the same day as TEN, whose last ten bars ARE TEN:
# enough for the run-up (22 bars) and the same past-moves answer as TEN.
THIRTY_DAYS = weekdays(dt.date(2026, 3, 13), 30)
THIRTY = [bar(d, 100.0, 100.0) for d in THIRTY_DAYS[:20]] + TEN
THIRTY_RET_5D = round((CLOSES[-1] / CLOSES[-6] - 1) * 100, 1)


# ── 1. the order: our bars answer and Yahoo is never reached ────────────────

def test_past_moves_come_from_our_bars_and_yahoo_is_never_called(own, yahoo):
    own.bars = TEN
    yahoo.frame = yahoo_frame(flat_bars(DAYS))      # a different answer, were it used
    out = ee.get_historical_earnings_moves(SYM, QUARTERS)
    assert out == EXPECTED
    assert yahoo.calls == []
    assert len(own.calls) == 1
    assert ee.bars_source_counts() == {"own_bars": 1}


def test_run_up_comes_from_our_bars_and_yahoo_is_never_called(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 30)
    closes = [100.0 + i for i in range(30)]          # 100 .. 129
    own.bars = flat_bars(days, closes)
    yahoo.frame = yahoo_frame(flat_bars(days))       # flat: would read 0.0 / 0.0
    out = ee.get_pre_earnings_context(SYM)
    # last 129; 6th from the end 124; 22nd from the end 108
    assert out == {"ret_5d_pct": 4.0, "ret_30d_pct": 19.4,
                   "label": "+19.4% / 30d · +4.0% / 5d"}
    assert yahoo.calls == []
    assert ee.bars_source_counts() == {"own_bars": 1}


def test_the_guard_is_not_touched_when_our_bars_answer(own, monkeypatch):
    own.bars = TEN
    reached = []
    monkeypatch.setattr(yf_util, "bounded_call",
                        lambda *a, **k: reached.append(k) or None)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert reached == []


def test_the_own_read_asks_from_the_oldest_report_date_less_the_pad(own, yahoo):
    own.bars = TEN
    ee.get_historical_earnings_moves(SYM, QUARTERS)
    assert own.calls == [(SYM, "2026-02-20")]        # 2026-03-04 less 12 days


# ── 2. the arithmetic did not move: same bars, either source, same payload ──

def test_the_same_bars_give_the_identical_past_moves_payload_from_either_source(own, yahoo):
    own.bars = TEN
    from_ours = ee.get_historical_earnings_moves(SYM, QUARTERS)
    assert yahoo.calls == []

    own.bars = []                                    # our bars cannot answer
    yahoo.frame = yahoo_frame(TEN)
    from_yahoo = ee.get_historical_earnings_moves(SYM, QUARTERS)
    assert len(yahoo.calls) == 1

    assert from_ours == from_yahoo == EXPECTED


def test_the_same_bars_give_the_identical_run_up_payload_from_either_source(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 40)
    closes = [50.0 + (i * 7 % 11) for i in range(40)]
    bars = flat_bars(days, closes)

    own.bars = bars
    from_ours = ee.get_pre_earnings_context(SYM)
    assert yahoo.calls == []

    own.bars = []
    yahoo.frame = yahoo_frame(bars)
    from_yahoo = ee.get_pre_earnings_context(SYM)
    assert len(yahoo.calls) == 1

    assert from_ours is not None and from_ours == from_yahoo


# ── 3. positional alignment and the report-time branches, on our bars ───────

def test_a_quarter_reported_on_the_last_bar_is_a_gap_not_its_neighbours_move(own, yahoo):
    own.bars = TEN
    out = ee.get_historical_earnings_moves(SYM, QUARTERS)
    assert out["moves_pct"][0] is None               # print night
    assert out["moves_pct"][1] == 6.1                # NOT shifted up


@pytest.mark.parametrize("rtime", ["pre-market", ""])
def test_a_quarter_on_the_last_bar_is_a_gap_whatever_its_report_time(own, yahoo, rtime):
    """Today's rule, kept: the last bar is 'not knowable yet' for every report
    time, the before-open one included."""
    own.bars = TEN
    quarters = [{"reportedDate": "2026-03-13", "reportTime": rtime},
                {"reportedDate": "2026-03-04", "reportTime": "pre-market"}]
    out = ee.get_historical_earnings_moves(SYM, quarters)
    assert out["moves_pct"] == [None, 7.8]
    assert yahoo.calls == []


def test_a_quarter_on_the_first_bar_of_the_fallback_frame_is_a_gap(own, yahoo):
    """No prior close to measure from. It must never wrap round to the newest
    close in the frame."""
    own.bars = TEN                                   # starts on 03-02: goes to Yahoo
    yahoo.frame = yahoo_frame(TEN)                   # and Yahoo starts there too
    quarters = [{"reportedDate": "2026-03-04", "reportTime": "pre-market"},
                {"reportedDate": "2026-03-02", "reportTime": "pre-market"}]
    out = ee.get_historical_earnings_moves(SYM, quarters)
    assert len(yahoo.calls) == 1
    assert out["moves_pct"] == [7.8, None]


def test_a_quarter_with_no_date_keeps_its_slot_on_our_bars(own, yahoo):
    own.bars = TEN
    out = ee.get_historical_earnings_moves(SYM, QUARTERS)
    assert out["moves_pct"][3] is None
    assert out["moves_pct"][4] == -25.0 and out["moves_pct"][5] == 7.8
    assert len(out["moves_pct"]) == len(QUARTERS)


def test_pre_market_reads_prior_close_to_report_open(own, yahoo):
    own.bars = TEN
    out = ee.get_historical_earnings_moves(
        SYM, [{"reportedDate": "2026-03-04", "reportTime": "pre-market"}])
    assert out["moves_pct"] == [7.8]                 # (110 - 102) / 102


def test_post_market_reads_report_close_to_next_open(own, yahoo):
    own.bars = TEN
    out = ee.get_historical_earnings_moves(
        SYM, [{"reportedDate": "2026-03-04", "reportTime": "post-market"}])
    assert out["moves_pct"] == [0.0]                 # (108 - 108) / 108


def test_unknown_report_time_takes_the_bigger_of_the_two_gaps(own, yahoo):
    own.bars = TEN
    quarters = [{"reportedDate": "2026-03-11"}, {"reportedDate": "2026-03-10"}]
    out = ee.get_historical_earnings_moves(SYM, quarters)
    # 03-11: before-open (98-98)/98 = 0, after-close (105-99)/99 = 6.06 -> after-close
    # 03-10: before-open (100-96)/96 = 4.17, after-close (98-98)/98 = 0 -> before-open
    assert out["moves_pct"] == [6.1, 4.2]


def test_a_report_date_on_a_weekend_reads_the_session_before_it(own, yahoo):
    own.bars = TEN
    out = ee.get_historical_earnings_moves(
        SYM, [{"reportedDate": "2026-03-07", "reportTime": "pre-market"}])   # a Saturday
    assert out["moves_pct"] == [-25.0]               # Fri 03-06: (90 - 120) / 120


# ── 4. "cannot answer": not far enough back (the past moves) ────────────────

def test_a_frame_whose_second_bar_is_the_oldest_report_date_answers(own, yahoo):
    own.bars = TEN
    yahoo.frame = yahoo_frame(flat_bars(DAYS))
    out = ee.get_historical_earnings_moves(
        SYM, [{"reportedDate": "2026-03-03", "reportTime": "pre-market"}])
    assert out["moves_pct"] == [0.0]                 # (100 - 100) / 100, from OUR bars
    assert yahoo.calls == []


def test_a_frame_that_starts_on_the_oldest_report_date_goes_to_yahoo(own, yahoo):
    """Our frame has no session before 03-02, so it would leave that quarter a
    gap. Yahoo's deeper frame has the session and fills it."""
    own.bars = TEN
    deeper = [bar(dt.date(2026, 2, 27), 80.0, 80.0)] + TEN
    yahoo.frame = yahoo_frame(deeper)
    quarters = [{"reportedDate": "2026-03-04", "reportTime": "pre-market"},
                {"reportedDate": "2026-03-02", "reportTime": "pre-market"}]
    out = ee.get_historical_earnings_moves(SYM, quarters)
    assert len(yahoo.calls) == 1
    assert out["moves_pct"] == [7.8, 25.0]           # 03-02: (100 - 80) / 80
    assert ee.bars_source_counts() == {"yahoo": 1}


def test_a_date_before_both_frames_stays_a_gap_and_nothing_shifts(own, yahoo):
    own.bars = TEN
    yahoo.frame = yahoo_frame(TEN)                   # Yahoo reaches no further
    quarters = [{"reportedDate": "2026-03-04", "reportTime": "pre-market"},
                {"reportedDate": "2025-12-01", "reportTime": "pre-market"}]
    out = ee.get_historical_earnings_moves(SYM, quarters)
    assert len(yahoo.calls) == 1
    assert out["moves_pct"] == [7.8, None]


# ── 5. "cannot answer": too few bars (the run-up) ───────────────────────────

def test_run_up_with_22_of_our_bars_answers(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 22)
    own.bars = flat_bars(days, [100.0] + [110.0] * 21)
    out = ee.get_pre_earnings_context(SYM)
    assert out == {"ret_5d_pct": 0.0, "ret_30d_pct": 10.0,
                   "label": "+10.0% / 30d · +0.0% / 5d"}
    assert yahoo.calls == []


def test_run_up_with_21_of_our_bars_goes_to_yahoo_for_the_30_day_number(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 30)
    full = flat_bars(days, [100.0] * 8 + [80.0] + [120.0] * 21)
    own.bars = full[-21:]                            # ours cannot see the 22nd bar back
    yahoo.frame = yahoo_frame(full)
    out = ee.get_pre_earnings_context(SYM)
    assert len(yahoo.calls) == 1
    assert out["ret_30d_pct"] == 50.0                # 120 against 80: Yahoo's 22nd bar back
    assert out["ret_5d_pct"] == 0.0


def test_run_up_with_fewer_than_6_of_our_bars_goes_to_yahoo(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 10)
    own.bars = flat_bars(days[-5:])
    yahoo.frame = yahoo_frame(flat_bars(days, [100.0] * 4 + [50.0] + [100.0] * 5))
    out = ee.get_pre_earnings_context(SYM)
    assert len(yahoo.calls) == 1
    assert out == {"ret_5d_pct": 100.0, "ret_30d_pct": None, "label": "+100.0% / 5d"}


def test_run_up_is_none_when_neither_source_has_six_bars(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 5)
    own.bars = flat_bars(days)
    yahoo.frame = yahoo_frame(flat_bars(days))
    assert ee.get_pre_earnings_context(SYM) is None
    assert len(yahoo.calls) == 1


# ── 6. "cannot answer": the frame itself is not usable ──────────────────────

@pytest.mark.parametrize("field", ["o", "c"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), 0.0, -5.0, None, "x"])
def test_a_bad_price_in_our_bars_never_produces_a_number(own, yahoo, field, bad):
    bars = [dict(b) for b in TEN]
    bars[3][field] = bad
    own.bars = bars
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) is None   # Yahoo has nothing
    assert len(yahoo.calls) == 1                                     # and it WAS asked

    yahoo.frame = yahoo_frame(TEN)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED


@pytest.mark.parametrize("bad", [float("nan"), 0.0, -1.0, None])
def test_a_bad_close_in_our_bars_never_produces_a_run_up(own, yahoo, bad):
    days = weekdays(dt.date(2026, 3, 13), 30)
    bars = flat_bars(days)
    bars[-6]["c"] = bad
    own.bars = bars
    assert ee.get_pre_earnings_context(SYM) is None
    assert len(yahoo.calls) == 1


def test_bars_out_of_order_or_without_a_date_cannot_answer(own, yahoo):
    own.bars = [TEN[0], TEN[2], TEN[1]] + TEN[3:]
    assert ee._own_frame(SYM, "2026-01-01") is None
    own.bars = [TEN[0], TEN[0]] + TEN[1:]            # the same day twice
    assert ee._own_frame(SYM, "2026-01-01") is None
    own.bars = [dict(TEN[0], t=None)] + TEN[1:]
    assert ee._own_frame(SYM, "2026-01-01") is None
    own.bars = TEN
    assert ee._own_frame(SYM, "2026-01-01") is not None


def test_a_tail_behind_the_latest_session_goes_to_yahoo(own, yahoo):
    own.bars = TEN                                   # ends 2026-03-13
    own.latest_session = 20260316                    # the reader expects Monday's bar
    own.stored_last = 20260316                       # the store has it; the frame served does not
    yahoo.frame = yahoo_frame(flat_bars(DAYS))
    out = ee.get_historical_earnings_moves(
        SYM, [{"reportedDate": "2026-03-04", "reportTime": "pre-market"}])
    assert len(yahoo.calls) == 1
    assert out["moves_pct"] == [0.0]                 # Yahoo's flat frame, not our 7.8

    own.latest_session = 20260313                    # our tail IS the latest session
    out = ee.get_historical_earnings_moves(
        SYM, [{"reportedDate": "2026-03-04", "reportTime": "pre-market"}])
    assert len(yahoo.calls) == 1                     # not asked again
    assert out["moves_pct"] == [7.8]


def test_a_stale_tail_never_feeds_the_run_up(own, yahoo):
    days = weekdays(dt.date(2026, 3, 13), 30)
    own.bars = flat_bars(days, [100.0 + i for i in range(30)])
    own.latest_session = 20260316
    own.stored_last = 20260316                       # the store has it; the frame served does not
    yahoo.frame = yahoo_frame(flat_bars(days))
    out = ee.get_pre_earnings_context(SYM)
    assert len(own.calls) == 1                       # read, then refused by the frame's own tail
    assert len(yahoo.calls) == 1
    assert out["ret_5d_pct"] == 0.0


# ── 6b. the store must ALREADY hold the current session, or nothing is read ──

def _moves(sym=SYM):
    return ee.get_historical_earnings_moves(sym, QUARTERS)


def _store_not_current(own, how):
    """Three ways the store cannot say "current": a row behind the latest
    session, no row at all, and the check itself failing."""
    own.bars = THIRTY                                # our bars WOULD answer both functions
    if how == "stale":
        own.latest_session = 20260316                # the last stored day is 2026-03-13
    elif how == "no row":
        own.stored_last = None
    else:
        own.store_error = RuntimeError("store unavailable")


def test_a_current_store_is_checked_once_and_then_read(own, yahoo):
    own.bars = THIRTY
    assert _moves() == EXPECTED
    assert ee.get_pre_earnings_context(SYM)["ret_5d_pct"] == THIRTY_RET_5D
    assert own.store_checks == [SYM, SYM]            # once per read
    assert len(own.calls) == 2 and len(own.jobs) == 2
    assert yahoo.calls == []
    assert ee.bars_source_counts() == {"own_bars": 2}


@pytest.mark.parametrize("how", ["stale", "no row", "check raises"])
def test_past_moves_never_start_a_read_when_the_store_is_not_current(own, yahoo, how):
    _store_not_current(own, how)
    yahoo.frame = yahoo_frame(TEN)
    assert _moves() == EXPECTED                      # Yahoo's answer
    assert own.store_checks == [SYM]
    assert own.calls == []                           # the reader was never called
    assert own.jobs == []                            # and no job (no thread) was started
    assert len(yahoo.calls) == 1
    assert ee.bars_source_counts() == {"own_bars_not_current": 1, "yahoo": 1}


@pytest.mark.parametrize("how", ["stale", "no row", "check raises"])
def test_the_run_up_never_starts_a_read_when_the_store_is_not_current(own, yahoo, how):
    _store_not_current(own, how)
    yahoo.frame = yahoo_frame(flat_bars(THIRTY_DAYS))
    assert ee.get_pre_earnings_context(SYM)["ret_5d_pct"] == 0.0   # Yahoo's flat frame
    assert own.store_checks == [SYM]
    assert own.calls == [] and own.jobs == []
    assert len(yahoo.calls) == 1
    assert ee.bars_source_counts() == {"own_bars_not_current": 1, "yahoo": 1}


def test_a_store_one_session_behind_is_not_current_and_the_same_day_is(own, yahoo):
    own.bars = THIRTY                                # ends 2026-03-13
    own.latest_session = 20260313
    own.stored_last = 20260312
    assert ee._store_is_current(SYM) is False
    own.stored_last = 20260313
    assert ee._store_is_current(SYM) is True
    own.stored_last = 20260316                       # ahead of the expectation is current too
    assert ee._store_is_current(SYM) is True


def test_the_store_check_is_waited_for_nowhere_and_starts_nothing(own):
    """`_read_own_daily_bars` itself, the one door both the shared and the
    direct read use: not current means [] with no job."""
    own.bars = THIRTY
    own.stored_last = None
    assert ee._read_own_daily_bars(SYM, "2026-01-01") == []
    assert own.calls == [] and own.jobs == []


def test_unknown_split_list_goes_to_yahoo(own, yahoo):
    own.bars = TEN
    own.meta = None                                  # never looked up: we cannot say
    yahoo.frame = yahoo_frame(TEN)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert len(yahoo.calls) == 1
    assert ee.bars_source_counts() == {"yahoo": 1}


def test_a_declared_split_our_rows_have_not_applied_goes_to_yahoo(own, yahoo):
    """A 2-for-1 on 03-09 that the older rows have not caught up with: the
    series halves there. Measured across it, a 'move' is the split."""
    bars = [bar(d, 200.0, 200.0) for d in DAYS[:5]] + [bar(d, 100.0, 100.0) for d in DAYS[5:]]
    own.bars = bars
    own.meta = {"ipo": None, "splits": [("2026-03-09", 2.0)]}
    yahoo.frame = yahoo_frame(flat_bars(DAYS))       # Yahoo's frame is on one basis
    quarters = [{"reportedDate": "2026-03-06", "reportTime": "post-market"}]
    out = ee.get_historical_earnings_moves(SYM, quarters)
    assert len(yahoo.calls) == 1
    assert out["moves_pct"] == [0.0]                 # never the -50.0 our rows would give


def test_a_declared_split_already_applied_does_not_send_us_to_yahoo(own, yahoo):
    own.bars = TEN                                   # continuous through 03-09
    own.meta = {"ipo": None, "splits": [("2026-03-09", 2.0)]}
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert yahoo.calls == []


# ── 7. the read fails, is slow, or both sources fail ────────────────────────

def test_an_empty_own_read_goes_to_yahoo(own, yahoo):
    own.bars = []
    yahoo.frame = yahoo_frame(TEN)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert len(yahoo.calls) == 1


def test_an_own_read_that_raises_goes_to_yahoo(own, yahoo, monkeypatch):
    def boom(sym, since_iso):
        raise RuntimeError("store unavailable")
    monkeypatch.setattr(ee, "_house_daily_bars", boom)
    yahoo.frame = yahoo_frame(TEN)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert len(yahoo.calls) == 1


def test_both_sources_failing_is_none_for_both_functions(own, yahoo):
    own.bars = []
    yahoo.frame = None
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) is None
    assert ee.get_pre_earnings_context(SYM) is None
    assert len(yahoo.calls) == 2
    yahoo.frame = pd.DataFrame({"Open": [], "Close": []})
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) is None
    assert ee.get_pre_earnings_context(SYM) is None


def test_a_slow_own_read_is_abandoned_at_its_deadline_and_yahoo_answers(own, yahoo, monkeypatch):
    release = threading.Event()

    def slow(sym, since_iso):
        release.wait(timeout=5.0)
        return [dict(b) for b in TEN]

    monkeypatch.setattr(ee, "_house_daily_bars", slow)
    monkeypatch.setattr(ee, "_OWN_BARS_DEADLINE", 0.05)
    yahoo.frame = yahoo_frame(flat_bars(DAYS))
    t0 = time.monotonic()
    try:
        out = ee.get_historical_earnings_moves(
            SYM, [{"reportedDate": "2026-03-04", "reportTime": "pre-market"}])
        waited = time.monotonic() - t0
    finally:
        release.set()
    assert waited < 2.0                              # not the reader's 5 s
    assert len(yahoo.calls) == 1
    assert out["moves_pct"] == [0.0]                 # Yahoo's flat frame


def test_the_own_read_is_waited_for_through_the_bars_readers_bounded_helper(own, monkeypatch):
    from api.services import bars_fetch
    seen = []
    real = bars_fetch._bounded_job

    def spy(key, fn, deadline, *a, **k):
        seen.append((key, deadline))
        return real(key, fn, deadline, *a, **k)

    monkeypatch.setattr(bars_fetch, "_bounded_job", spy)
    own.bars = TEN
    assert len(ee._read_own_daily_bars(SYM, "2026-01-01")) == 10
    assert ee._read_own_daily_bars(SYM, "2026-01-01") == TEN
    assert [d for _, d in seen] == [ee._OWN_BARS_DEADLINE] * 2
    assert seen[0][0] != seen[1][0]                  # never deduped onto another read
    assert ee._OWN_BARS_DEADLINE <= 2.5


def test_the_fallback_keeps_the_shared_yahoo_guard(own, yahoo, monkeypatch):
    own.bars = []
    seen = []

    def spy(fn, default, **kw):
        seen.append(kw)
        return default

    monkeypatch.setattr(yf_util, "bounded_call", spy)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) is None
    assert ee.get_pre_earnings_context(SYM) is None
    assert len(seen) == 2
    for kw in seen:
        assert kw["timeout"] == ee._YF_TIMEOUT == 12.0
        assert kw.get("lane") == "earnings"


# ── 8. one read where two were made ─────────────────────────────────────────

def _quiet_other_legs(monkeypatch):
    for name in ("get_estimate_revisions", "get_key_quotes"):
        monkeypatch.setattr(ee, name, lambda *a, **k: None)
    monkeypatch.setattr(ee, "extract_beat_surprises", lambda *a, **k: None)
    monkeypatch.setattr(ee, "_implied_for_report", lambda *a, **k: None)


def test_an_enrichment_call_reads_our_bars_once_for_both_legs(own, yahoo, monkeypatch):
    _quiet_other_legs(monkeypatch)
    days = weekdays(dt.date(2026, 3, 13), 30)
    closes = [100.0 + i for i in range(30)]
    own.bars = [bar(d, c, c) for d, c in zip(days, closes)]
    quarters = [{"reportedDate": "2026-02-10", "reportTime": "pre-market"}]
    monkeypatch.setattr(ee, "_run_up_since", lambda: "2025-12-08")
    out = ee.enrich_earnings_response(SYM, quarters)

    assert len(own.calls) == 1                       # ONE read, not two
    # sized to the older need: the run-up asks from 2025-12-08, the moves from 2026-01-29
    assert own.calls[0] == (SYM, "2025-12-08")
    assert out["pre_earnings"]["ret_5d_pct"] == 4.0
    assert out["hist_moves"]["n_quarters"] == 1
    assert yahoo.calls == []
    assert ee._SHARED_READS == {}                    # handed back when the call ends


@pytest.mark.parametrize("how", ["stale", "no row", "check raises"])
def test_an_enrichment_call_checks_the_store_once_and_reads_nothing_when_it_is_not_current(
        own, yahoo, monkeypatch, how):
    _quiet_other_legs(monkeypatch)
    _store_not_current(own, how)
    yahoo.frame = yahoo_frame(TEN)
    out = ee.enrich_earnings_response(SYM, QUARTERS)

    assert own.store_checks == [SYM]                 # ONE check for both legs
    assert own.calls == [] and own.jobs == []        # no read, no thread
    assert len(yahoo.calls) == 2                     # both legs went to Yahoo
    assert out["hist_moves"] == EXPECTED
    assert out["pre_earnings"] is not None
    assert ee.bars_source_counts() == {"own_bars_not_current": 1, "yahoo": 2}
    assert ee._SHARED_READS == {}


def test_the_shared_read_reaches_back_to_the_older_of_the_two_needs(own, yahoo, monkeypatch):
    _quiet_other_legs(monkeypatch)
    monkeypatch.setattr(ee, "_run_up_since", lambda: "2025-12-08")
    own.bars = TEN
    ee.enrich_earnings_response(SYM, [{"reportedDate": "2024-05-20"}])
    assert own.calls == [(SYM, "2024-05-08")]        # the moves leg is the older need


def test_the_run_up_read_asks_for_about_three_months(own, yahoo):
    own.bars = flat_bars(weekdays(dt.date(2026, 3, 13), 30))
    ee.get_pre_earnings_context(SYM)
    expected = (dt.date.today() - dt.timedelta(days=95)).isoformat()
    assert own.calls == [(SYM, expected)]


def test_outside_an_enrichment_call_each_function_reads_for_itself(own, yahoo):
    own.bars = flat_bars(weekdays(dt.date(2026, 3, 13), 30))
    ee.get_pre_earnings_context(SYM)
    ee.get_historical_earnings_moves(SYM, [{"reportedDate": "2026-03-04"}])
    assert len(own.calls) == 2


def test_a_shared_read_that_does_not_reach_back_far_enough_is_not_used(own):
    own.bars = TEN
    shared = ee._SharedOwnRead(SYM, "2026-03-01")
    with ee._SHARED_LOCK:
        ee._SHARED_READS[SYM] = shared
    ee._own_bars(SYM, "2026-02-01")                  # needs more than the shared read holds
    assert own.calls == [(SYM, "2026-02-01")]
    ee._own_bars(SYM, "2026-03-05")                  # the shared read covers this one
    ee._own_bars(SYM, "2026-03-01")
    assert own.calls == [(SYM, "2026-02-01"), (SYM, "2026-03-01")]


def test_a_second_enrichment_call_for_the_symbol_never_drops_the_firsts_read(own):
    first = ee._share_own_read(SYM, [])
    assert first is not None and ee._SHARED_READS[SYM] is first
    second = ee._share_own_read(SYM, [])
    assert second is None
    ee._unshare_own_read(second)
    assert ee._SHARED_READS[SYM] is first
    ee._unshare_own_read(first)
    assert ee._SHARED_READS == {}


# ── 9. the suite default this file overrides ────────────────────────────────

def test_the_suite_default_switches_the_own_read_off():
    """tests/conftest.py stands in for `earnings_reaction.daily_bars_since` in
    every other test file. Pinned by name here so a rename cannot silently
    re-arm a store read under tests that only stub Yahoo."""
    import inspect
    import tests.conftest as conftest
    from api.services import earnings_reaction as er
    src = inspect.getsource(conftest._own_daily_bars_cannot_answer)
    assert '"daily_bars_since"' in src
    assert '"last_stored_daily_session", lambda sym: None' in src
    assert "api.services.earnings_reaction" in src
    assert callable(er.daily_bars_since)
    assert callable(er.last_stored_daily_session)


def test_the_own_read_goes_through_the_one_name_the_suite_default_stands_in_for(
        yahoo, monkeypatch):
    """The whole read, no stand-in above the reader: with that one name
    answering "no bars" (what the suite default does), nothing below it is
    reached and Yahoo answers."""
    from api.services import bars_fetch, earnings_reaction as er
    seen = []

    def no_bars(sym, since_iso):
        seen.append((sym, since_iso))
        return []

    store_reads = []
    monkeypatch.setattr(er, "last_stored_daily_session", lambda sym: 20260313)
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                        lambda now=None: 20260313)
    monkeypatch.setattr(er, "daily_bars_since", no_bars)
    monkeypatch.setattr(er, "_daily_bars", lambda *a: store_reads.append(a) or [])
    yahoo.frame = yahoo_frame(TEN)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert seen == [(SYM, "2026-02-20")]
    assert store_reads == []
    assert len(yahoo.calls) == 1


def test_the_store_check_goes_through_the_other_name_the_suite_default_stands_in_for(
        yahoo, monkeypatch):
    """The whole path, no stand-in above the two names: with the first one
    answering "the store holds nothing" (what the suite default does), the bar
    store is never opened, the read is never started, and Yahoo answers."""
    from api.services import bars_fetch, bars_sqlite, earnings_reaction as er
    asked, store_reads, reads, jobs = [], [], [], []
    monkeypatch.setattr(er, "last_stored_daily_session", lambda sym: asked.append(sym))
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda *a: store_reads.append(a))
    monkeypatch.setattr(er, "daily_bars_since", lambda *a: reads.append(a) or [])
    monkeypatch.setattr(bars_fetch, "_bounded_job", lambda *a, **k: jobs.append(a) or False)
    yahoo.frame = yahoo_frame(TEN)
    assert ee.get_historical_earnings_moves(SYM, QUARTERS) == EXPECTED
    assert asked == [SYM]
    assert store_reads == [] and reads == [] and jobs == []
    assert len(yahoo.calls) == 1


def test_that_other_name_is_the_bars_readers_own_store_accessor(monkeypatch):
    from api.services import bars_fetch, bars_sqlite, earnings_reaction as er
    assert bars_fetch._sqlite is bars_sqlite         # the accessor `_get_bars_inner` reads last_ts from
    asked = []
    monkeypatch.setattr(bars_sqlite, "get_last_ts",
                        lambda ticker, tf: asked.append((ticker, tf)) or 20260313)
    assert er.last_stored_daily_session("ownb") == 20260313
    assert asked == [("OWNB", "D")]


def test_that_name_is_the_house_reader_itself(monkeypatch):
    from api.services import earnings_reaction as er
    monkeypatch.setattr(er, "_daily_bars", lambda sym, since_iso: [("bars", sym, since_iso)])
    assert er.daily_bars_since("X", "2026-01-01") == [("bars", "X", "2026-01-01")]
