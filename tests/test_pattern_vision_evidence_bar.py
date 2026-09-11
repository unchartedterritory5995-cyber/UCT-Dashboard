"""The evidence bar is the last CLOSED bar, identified by DATE not position.

`_evidence_bar` returned `bars[-2]` unconditionally, assuming `bars[-1]` is
always today's developing candle. Today's bar is a PARTIAL intraday candle
written when that ticker's daily series is refreshed -- per-ticker, staggered,
and absent for most of the active set through the early session. Measured on
prod 2026-09-10 at 10:10 ET, one of 84 tickers had its 09-10 bar (GILD, at 6%
of its 20-day average volume); the other 83 still ended at 09-09.

So `bars[-1]` was a fully closed prior session and the judge threw it away,
recording 2026-09-08 evidence on 2026-09-10 for all 43 of the 09:00 slot's paid
calls. Each ticker's hash then changed as its partial arrived, re-judging it --
the "10:00 re-judge wave" was this defect resolving one ticker at a time.

The load-bearing property is the THIRD test: the hash must not move when
today's bar arrives, because that is what stops the duplicate judging.
"""
import datetime

from zoneinfo import ZoneInfo

from api.services.pattern_vision import orchestrator as orch

_ET = ZoneInfo("America/New_York")


def _today_et():
    return datetime.datetime.now(_ET).date()


def _ymd(d):
    return int(d.strftime("%Y%m%d"))


def _bar(d, c=100.0, v=1_000_000):
    """A daily bar tuple shaped like bars_sqlite.get_bars: (ts,o,h,l,c,v)."""
    return (_ymd(d), c, c + 1, c - 1, c, v)


def _series_without_today():
    t = _today_et()
    return [_bar(t - datetime.timedelta(days=n), c=100.0 + n) for n in (4, 3, 1)]


def _series_with_today():
    return _series_without_today() + [_bar(_today_et(), c=999.0, v=50_000)]


def test_no_today_bar_uses_the_last_stored_bar():
    """bars[-1] has already closed, so it IS the evidence bar."""
    bars = _series_without_today()
    yesterday = _today_et() - datetime.timedelta(days=1)
    assert orch._evidence_bar(bars) == bars[-1]
    assert orch._evidence_bar(bars)[0] == _ymd(yesterday)


def test_today_bar_present_falls_back_to_the_prior_bar():
    """bars[-1] is the live developing candle, so bars[-2] is the closed one."""
    bars = _series_with_today()
    yesterday = _today_et() - datetime.timedelta(days=1)
    assert orch._evidence_bar(bars) == bars[-2]
    assert orch._evidence_bar(bars)[0] == _ymd(yesterday)


def test_the_hash_does_not_move_when_todays_bar_arrives():
    """THE LOAD-BEARING ONE. Both states resolve to the same closed bar, so the
    signals hash is identical -- which is what makes a candidate judged once per
    day instead of again the hour its partial lands."""
    before = orch._signals_hash("GILD", "bull_flag", _series_without_today())
    after = orch._signals_hash("GILD", "bull_flag", _series_with_today())
    assert before == after


def test_the_recorded_asof_is_the_closed_bars_date_in_both_states():
    yesterday = (_today_et() - datetime.timedelta(days=1)).isoformat()
    assert orch._evidence_date(_series_without_today()) == yesterday
    assert orch._evidence_date(_series_with_today()) == yesterday


def test_a_single_stored_bar_does_not_crash():
    one = [_bar(_today_et() - datetime.timedelta(days=1))]
    assert orch._evidence_bar(one) == one[0]
    only_today = [_bar(_today_et())]
    assert orch._evidence_bar(only_today) == only_today[0]


def test_no_bars_returns_none():
    assert orch._evidence_bar([]) is None


def test_a_weekend_gap_needs_no_calendar():
    """A Friday close read on a Monday is simply older than today -- the same
    comparison, no trading calendar involved."""
    t = _today_et()
    bars = [_bar(t - datetime.timedelta(days=n)) for n in (10, 7, 5)]
    assert orch._evidence_bar(bars) == bars[-1]


def test_an_intraday_shaped_ts_keeps_the_positional_behaviour():
    """Intraday stores unix seconds, not YYYYMMDD. Rather than guess a format
    this orchestrator never runs on, fall back to bars[-2]."""
    now = int(datetime.datetime.now(tz=datetime.timezone.utc).timestamp())
    bars = [(now - 600, 1, 1, 1, 1, 1), (now - 300, 2, 2, 2, 2, 2), (now, 3, 3, 3, 3, 3)]
    assert orch._evidence_bar(bars) == bars[-2]


def test_today_is_read_in_ET_not_UTC():
    """After 20:00 ET the UTC date is already tomorrow. If `today` came from
    UTC, the live session's own developing bar would read as closed and get
    judged -- wrong for every late slot."""
    et_today = _ymd(_today_et())
    assert orch._today_ymd_et() == et_today
