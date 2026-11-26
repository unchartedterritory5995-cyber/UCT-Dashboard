"""After the close, the vendor's historical aggregates win over the AM stream (2026-11-26, candle-accuracy audit class 2).

Every live 1m/5m row is the vendor's AM bar, emitted at the minute's end. A trade corrected, cancelled or reported late
after that reaches the vendor's historical aggregates but never the AM, and every repair kept the stream's minute, so the
store kept the AM's version forever (SPY 2026-11-19 15:45: a high $13.77 above TradingView's). `bars_live_store
.settle_pass` re-reads each covered ticker's day from the vendor once the extended session has closed, replaces the rows
that differ, re-derives that day's 15m/30m/60m from the corrected 5m, and never erases a stored row.

A real bars.db in a temp dir, a stubbed vendor (`bars_live_store._fetch`) that records every call. No real market data.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch
from api.services import bars_live_store as bls

_ET = ZoneInfo("America/New_York")
_DAY = (2026, 11, 11)                    # a Wednesday, a full NYSE session (extended close 20:00 ET)
_AFTER = datetime(2026, 11, 11, 20, 31, tzinfo=_ET)


def _ts(h, mi, day=_DAY) -> int:
    return int(datetime(*day, h, mi, tzinfo=_ET).timestamp())


def _rows(step_min, start=(4, 0), end=(20, 0), seed=0):
    out, t, stop, i = [], _ts(*start), _ts(*end), 0
    while t < stop:
        p = 10.0 + ((i * 7 + seed) % 11) * 0.01
        out.append({"t": t, "o": p, "h": p + 0.05 + (i % 3) * 0.01, "l": p - 0.05, "c": p + 0.01, "v": 100 + i + seed})
        t += step_min * 60
        i += 1
    return out


@pytest.fixture
def env(tmp_path, monkeypatch):
    from api.services import bars_sqlite as sq
    monkeypatch.setattr(sq, "_DB_PATH", str(tmp_path / "bars.db"))
    sq.bump_db_epoch()
    sq.init_db()
    bls._reset_for_tests()
    monkeypatch.setattr(bls, "enabled", lambda: True)
    monkeypatch.setattr(bls, "SETTLE_ENABLED", True)
    vendor = {"rows": {}, "calls": [], "fail": set()}

    def _fetch(sym, mult, frm, to):
        vendor["calls"].append((sym, mult, frm, to))
        if (sym, str(mult)) in vendor["fail"]:
            raise RuntimeError("provider 503")
        return [dict(b) for b in vendor["rows"].get((sym, str(mult)), [])]
    monkeypatch.setattr(bls, "_fetch", _fetch)
    yield sq, vendor
    bls._reset_for_tests()
    sq.bump_db_epoch()


def _stream_day(sq, sym="SPY"):
    """The day as the AM stream left it: 5m, and the 15m/30m/60m derived from it."""
    five = _rows(5)
    sq.put_bars(sym, "5", five)
    fifteen = bars_fetch._resample_derived("15", five)
    sq.put_bars(sym, "15", fifteen)
    for tf in ("30", "60"):
        sq.put_bars(sym, tf, bars_fetch._resample_derived(tf, fifteen))
    with bls._lock:
        bls._covered5.add(sym)
    return five


def _row(sq, sym, tf, t):
    return next((r for r in sq.get_bars_since(sym, tf, t - 1) if int(r[0]) == t), None)


def test_settle_replaces_the_stream_row_the_vendor_corrected(env):
    sq, vendor = env
    five = _stream_day(sq)
    corrected = [dict(b) for b in five]
    k = next(i for i, b in enumerate(corrected) if b["t"] == _ts(15, 45))
    corrected[k]["h"] = corrected[k]["h"] - 0.04       # the AM's high came from a print the vendor later corrected
    corrected[k]["v"] = corrected[k]["v"] + 37         # and a late-reported trade joined the bar
    vendor["rows"][("SPY", "5")] = corrected
    counts = bls.settle_pass(_AFTER)
    r = _row(sq, "SPY", "5", _ts(15, 45))
    assert (round(r[2], 6), int(r[5])) == (round(corrected[k]["h"], 6), corrected[k]["v"])
    assert counts["rows_replaced"] == 1, "only the differing row is written"
    assert counts["changed_tickers"] == 1 and counts["failed"] == 0
    assert vendor["calls"] == [("SPY", 5, _ts(4, 0) * 1000, _ts(20, 0) * 1000 - 1)], "one call for the day"


def test_settle_rederives_the_day_s_15m_30m_60m_from_the_corrected_5m(env):
    sq, vendor = env
    five = _stream_day(sq)
    corrected = [dict(b) for b in five]
    k = next(i for i, b in enumerate(corrected) if b["t"] == _ts(15, 45))
    corrected[k]["h"] = corrected[k]["h"] + 2.0
    vendor["rows"][("SPY", "5")] = corrected
    bls.settle_pass(_AFTER)
    for tf, base in (("15", "5"), ("30", "15"), ("60", "15")):
        stored = [dict(t=r[0], o=r[1], h=r[2], l=r[3], c=r[4], v=r[5])
                  for r in sq.get_bars_since("SPY", tf, _ts(4, 0) - 1) if r[0] < _ts(20, 0)]
        src = [dict(t=r[0], o=r[1], h=r[2], l=r[3], c=r[4], v=r[5])
               for r in sq.get_bars_since("SPY", base, _ts(4, 0) - 1) if r[0] < _ts(20, 0)]
        want = [b for b in bars_fetch._resample_derived(tf, src) if b["t"] < _ts(20, 0)]
        assert [(b["t"], round(b["h"], 6)) for b in stored] == [(b["t"], round(b["h"], 6)) for b in want], tf
    assert max(round(r[2], 6) for r in sq.get_bars_since("SPY", "15", _ts(15, 44))
               if r[0] < _ts(16, 0)) == round(corrected[k]["h"], 6)


def test_settle_never_erases_and_survives_a_failed_or_empty_answer(env):
    sq, vendor = env
    five = _stream_day(sq)
    _stream_day(sq, "QQQ")
    vendor["rows"][("SPY", "5")] = []                  # the vendor answered nothing
    vendor["fail"].add(("QQQ", "5"))                   # the vendor failed
    before = {s: sq.get_bars_since(s, "5", _ts(4, 0) - 1) for s in ("SPY", "QQQ")}
    counts = bls.settle_pass(_AFTER)
    assert {s: sq.get_bars_since(s, "5", _ts(4, 0) - 1) for s in ("SPY", "QQQ")} == before
    assert counts["failed"] == 1 and counts["rows_replaced"] == 0
    lacking = [dict(b) for b in five if b["t"] != _ts(12, 0)]     # the vendor lacks one bar the stream has
    vendor["rows"][("SPY", "5")] = lacking
    vendor["fail"].clear()
    bls._settle["done_ymd"] = None
    counts = bls.settle_pass(_AFTER)
    assert _row(sq, "SPY", "5", _ts(12, 0)) is not None, "a row the vendor lacks is left (and counted)"
    assert counts["rows_vendor_lacks"] == 1


def test_settle_covers_1m_for_the_1m_covered_tickers(env):
    sq, vendor = env
    ones = _rows(1, start=(9, 30), end=(9, 40))
    sq.put_bars("SPY", "1", ones)
    with bls._lock:
        bls._covered1.add("SPY")
    corrected = [dict(b) for b in ones]
    corrected[3]["l"] = corrected[3]["l"] + 0.02
    vendor["rows"][("SPY", "1")] = corrected
    counts = bls.settle_pass(_AFTER)
    assert round(_row(sq, "SPY", "1", corrected[3]["t"])[3], 6) == round(corrected[3]["l"], 6)
    assert counts["rows_replaced"] == 1


@pytest.mark.parametrize("when,due", [
    (datetime(2026, 11, 11, 10, 0, tzinfo=_ET), False),     # the regular session
    (datetime(2026, 11, 11, 16, 30, tzinfo=_ET), False),    # after the close, the extended session still running
    (datetime(2026, 11, 11, 20, 29, tzinfo=_ET), False),    # 29 minutes after the extended close
    (datetime(2026, 11, 11, 20, 30, tzinfo=_ET), True),
    (datetime(2026, 11, 14, 21, 0, tzinfo=_ET), False),     # a Saturday
    (datetime(2026, 11, 26, 21, 0, tzinfo=_ET), False),     # Thanksgiving
    (datetime(2026, 11, 27, 17, 30, tzinfo=_ET), True),     # the half day: the extended session closes at 17:00
    (datetime(2026, 11, 27, 17, 29, tzinfo=_ET), False),
])
def test_settle_is_due_only_after_the_extended_close_of_a_trading_day(env, when, due):
    assert bls._settle_due(when) is due


def test_settle_runs_once_per_day_and_honours_the_kill_switch(env, monkeypatch):
    sq, vendor = env
    _stream_day(sq)
    vendor["rows"][("SPY", "5")] = _rows(5)
    assert bls._settle_due(_AFTER) is True
    bls.settle_pass(_AFTER)
    assert bls._settle_due(_AFTER) is False, "done for the day"
    assert bls._settle_due(datetime(2026, 11, 12, 20, 31, tzinfo=_ET)) is True, "the next trading day is due again"
    monkeypatch.setattr(bls, "SETTLE_ENABLED", False)
    assert bls._settle_due(datetime(2026, 11, 12, 20, 31, tzinfo=_ET)) is False
    assert "settle" in bls.status()
