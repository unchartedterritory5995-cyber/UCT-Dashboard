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
    monkeypatch.setattr(bls, "SPIKE_REPAIR_ENABLED", False, raising=False)  # its own rails: tests/test_spike_repair.py
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


# ── #2774 review round (FIX FIRST): M1, M2, the marker, the bucket share, the seal ──────────────────────────────────

def test_m1_a_restart_between_the_5m_write_and_the_rederive_still_corrects_the_15m(env):
    """The 5m was settled, then the process died before the 15m/30m/60m were re-derived. The next pass finds the 5m
    already equal to the vendor's (nothing to replace) and must still re-derive the day from it."""
    sq, vendor = env
    five = _stream_day(sq)                                   # 15/30/60 derived from the STREAM's 5m
    corrected = [dict(b) for b in five]
    k = next(i for i, b in enumerate(corrected) if b["t"] == _ts(15, 45))
    corrected[k]["h"] = corrected[k]["h"] + 2.0
    sq.put_bars("SPY", "5", corrected)                       # the first pass's 5m write landed ...
    vendor["rows"][("SPY", "5")] = corrected                 # ... and the vendor agrees with it now
    counts = bls.settle_pass(_AFTER)                         # the pass after the restart
    assert counts["rows_replaced"] == 0
    top = max(round(r[2], 6) for r in sq.get_bars_since("SPY", "15", _ts(15, 44)) if r[0] < _ts(16, 0))
    assert top == round(corrected[k]["h"], 6), "the 15m still carries the stream's 5m"
    assert counts["derived_rows"] >= 3


def test_m2_only_a_material_difference_replaces_a_row(env):
    """A row is replaced only when O/H/L/C differ at the store's 4 dp grain, or volume differs by more than
    max(2% of the vendor's, 100 shares). Anything less is counted, not written (no nightly history_rev churn)."""
    sq, vendor = env
    five = _stream_day(sq)
    at = {b["t"]: i for i, b in enumerate(five)}
    big = [_ts(10, 0), _ts(10, 5), _ts(10, 10)]
    for t in big:
        five[at[t]]["v"] = 10_000
    sq.put_bars("SPY", "5", five)
    vendor_rows = [dict(b) for b in five]
    vendor_rows[at[_ts(10, 0)]]["v"] = 10_150                # +150 < max(203, 100): immaterial
    vendor_rows[at[_ts(10, 5)]]["v"] = 10_300                # +300 > max(206, 100): material
    vendor_rows[at[_ts(10, 10)]]["h"] += 0.00003             # below the 4 dp grain: immaterial
    vendor_rows[at[_ts(11, 0)]]["v"] += 80                   # +80 shares on a ~100-share bar: under 100, immaterial
    vendor_rows[at[_ts(11, 5)]]["c"] += 0.0001               # one grain step: material
    vendor["rows"][("SPY", "5")] = vendor_rows
    counts = bls.settle_pass(_AFTER)
    assert counts["rows_replaced"] == 2, counts
    assert counts["rows_immaterial"] == 3, counts
    assert int(_row(sq, "SPY", "5", _ts(10, 0))[5]) == 10_000, "an immaterial volume difference is not written"
    assert int(_row(sq, "SPY", "5", _ts(10, 5))[5]) == 10_300


def test_the_done_marker_survives_a_restart(env):
    sq, vendor = env
    _stream_day(sq)
    vendor["rows"][("SPY", "5")] = _rows(5)
    bls.settle_pass(_AFTER)
    bls._reset_for_tests()                                   # what a restart forgets (memory); bars.db keeps the marker
    assert bls._settle["done_ymd"] is None
    bls._load_settle_marker()
    assert bls._settle_due(_AFTER) is False, "a restart after the pass would re-run ~3.7k vendor calls"
    assert bls._settle_due(datetime(2026, 11, 12, 20, 31, tzinfo=_ET)) is True


def test_the_settle_takes_at_most_its_share_of_the_vendor_bucket(env, monkeypatch):
    sq, vendor = env
    from api.services import massive
    assert bls._settle_rate_per_min() == pytest.approx(massive._MASSIVE_RATE_LIMIT_PER_MIN * bls.SETTLE_BUCKET_SHARE)
    assert 0 < bls.SETTLE_BUCKET_SHARE <= 0.5
    order = []
    monkeypatch.setattr(bls, "_settle_take", lambda: order.append("take"))
    real = bls._fetch
    monkeypatch.setattr(bls, "_fetch", lambda *a: (order.append("fetch"), real(*a))[1])
    _stream_day(sq)
    _stream_day(sq, "QQQ")
    vendor["rows"][("SPY", "5")] = _rows(5)
    bls.settle_pass(_AFTER)
    assert order == ["take", "fetch", "take", "fetch"], "every vendor call waits on the settle's own share first"


def test_the_pass_advances_the_seal_check_so_an_older_repair_cannot_overwrite_settled_rows(env):
    sq, vendor = env
    five = _stream_day(sq)
    t_pre = _AFTER.timestamp() - 300                         # a repair that CHECKED before the pass ...
    sq.record_sealed("SPY", "5", float(_ts(20, 0)), float(_ts(4, 0)), t_pre - 600)
    corrected = [dict(b) for b in five]
    k = next(i for i, b in enumerate(corrected) if b["t"] == _ts(15, 45))
    corrected[k]["h"] += 1.0
    vendor["rows"][("SPY", "5")] = corrected
    bls.settle_pass(_AFTER)
    assert sq.series_meta("SPY", "5")["sealed_checked_at"] >= t_pre
    stale = dict(five[k])                                    # ... and WRITES after it, carrying the stream's high
    sq.put_bars("SPY", "5", [stale], checked_at=t_pre)
    assert round(_row(sq, "SPY", "5", _ts(15, 45))[2], 6) == round(corrected[k]["h"], 6)


def test_the_check_time_is_taken_per_ticker_just_before_its_fetch(env, monkeypatch):
    """#2774 round 2 (LOW): an after-hours tail heal that seals a series MID-PASS, after the pass started but before
    this ticker's fetch, must not make the settle's later write of that ticker read as the older check."""
    import time as _real
    from types import SimpleNamespace
    sq, vendor = env
    clock = {"n": 1_800_000_000.0}

    def _now():
        clock["n"] += 10.0
        return clock["n"]
    monkeypatch.setattr(bls, "time", SimpleNamespace(time=_now, monotonic=_real.monotonic, sleep=_real.sleep))
    monkeypatch.setattr(bls, "SETTLE_WORKERS", 1)
    five = _stream_day(sq, "SPY")
    _stream_day(sq, "QQQ")
    corrected = [dict(b) for b in five]
    k = next(i for i, b in enumerate(corrected) if b["t"] == _ts(15, 45))
    corrected[k]["h"] += 1.5
    vendor["rows"][("SPY", "5")] = corrected
    vendor["rows"][("QQQ", "5")] = _rows(5)
    real_fetch = bls._fetch

    def _fetch(sym, mult, frm, to):
        if sym == "QQQ":                       # while QQQ is read, a tail heal seals SPY's 5m with a check NOW
            sq.record_sealed("SPY", "5", float(_ts(20, 0)), float(_ts(4, 0)), clock["n"] + 5.0)
        return real_fetch(sym, mult, frm, to)
    monkeypatch.setattr(bls, "_fetch", _fetch)
    bls.settle_pass(_AFTER)                   # sorted: QQQ first, then SPY
    assert round(_row(sq, "SPY", "5", _ts(15, 45))[2], 6) == round(corrected[k]["h"], 6), (
        "the settle's SPY write carried the pass start's check and was dropped as older than the mid-pass seal")
