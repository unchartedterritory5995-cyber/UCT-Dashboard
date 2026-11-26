"""A half day's 13:01-15:59 ET, rebuilt from the vendor's trades (2026-11-26, `api/services/halfday_gap.py`).

On every NYSE half day the store held no intraday row between 13:01 and 15:59 ET: the vendor prices a Form T trade only
before 09:30 and after 16:00 by the clock, so those minutes have no aggregate. Here: a half day whose stored rows lack
13:01-15:59 gets them from trades (folded like the live fold), a vendor row is never overwritten, a normal day is
untouched, and the per-day marker survives a restart. A real bars.db in a temp dir; the vendor's trades are stubbed.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, halfday_gap as hg
from api.services import bars_live_store as bls

_ET = ZoneInfo("America/New_York")
HALF = date(2025, 11, 28)                  # the day after Thanksgiving: the regular session closes at 13:00
FULL = date(2025, 11, 25)


def _ts(d, h, mi, s=0) -> int:
    return int(datetime(d.year, d.month, d.day, h, mi, s, tzinfo=_ET).timestamp())


def _vendor_day(d, step, closes=(13, 0)):
    """The vendor's rows of a half day: 04:00-13:00 (the 13:00 bar is the closing auction), then 16:00-16:59."""
    out, i = [], 0
    for lo, hi in (((4, 0), closes), ((16, 0), (17, 0))):
        t, stop = _ts(d, *lo), _ts(d, *hi)
        if hi == closes:
            stop += 60 if step == 1 else step * 60
        while t < stop:
            p = 600.0 + (i % 7) * 0.01
            out.append({"t": t, "o": p, "h": p + 0.05, "l": p - 0.05, "c": p + 0.01, "v": 1000 + i})
            t += step * 60
            i += 1
    return out


def _trade(d, h, mi, s, price, size=100, cond=(12,)):
    return {"sip_timestamp": _ts(d, h, mi, s) * 1_000_000_000, "price": price, "size": size, "conditions": list(cond)}


@pytest.fixture
def env(tmp_path, monkeypatch):
    from api.services import bars_sqlite as sq
    monkeypatch.setattr(sq, "_DB_PATH", str(tmp_path / "bars.db"))
    sq.bump_db_epoch()
    sq.init_db()
    bls._reset_for_tests()
    monkeypatch.setattr(bls, "SPIKE_REPAIR_ENABLED", False, raising=False)  # its own rails: tests/test_spike_repair.py
    calls = []
    trades = {"rows": []}

    def _trade_pages(sym, lo, hi, take):
        take()
        calls.append((sym, lo, hi))
        yield [t for t in trades["rows"] if lo * 10**9 <= t["sip_timestamp"] < hi * 10**9]
    monkeypatch.setattr(hg, "trade_pages", _trade_pages)
    yield sq, calls, trades
    bls._reset_for_tests()
    sq.bump_db_epoch()


def _store_half_day(sq, sym="SPY", d=HALF):
    sq.put_bars(sym, "1", _vendor_day(d, 1))
    five = _vendor_day(d, 5)
    sq.put_bars(sym, "5", five)
    fifteen = bars_fetch._resample_derived("15", five)
    sq.put_bars(sym, "15", fifteen)
    for tf in ("30", "60"):
        sq.put_bars(sym, tf, bars_fetch._resample_derived(tf, fifteen))


def _row(sq, sym, tf, t):
    return next((r for r in sq.get_bars_since(sym, tf, t - 1) if int(r[0]) == t), None)


def test_the_gap_window_of_a_half_day_and_none_on_a_normal_day():
    assert hg.gap_window(HALF) == (_ts(HALF, 13, 1), _ts(HALF, 16, 0))
    assert hg.gap_window(date(2026, 11, 27)) == (_ts(date(2026, 11, 27), 13, 1), _ts(date(2026, 11, 27), 16, 0))
    assert hg.gap_window(FULL) is None


def test_the_fold_matches_the_live_fold_form_t_prices_an_odd_lot_only_counts():
    rows = hg.fold_minutes([
        _trade(HALF, 14, 0, 5, 601.00), _trade(HALF, 14, 0, 30, 603.50), _trade(HALF, 14, 0, 50, 602.25),
        _trade(HALF, 14, 0, 55, 650.00, size=7, cond=(12, 37)),       # an odd lot: volume, never a price
        _trade(HALF, 14, 1, 10, 700.00, size=3, cond=(37,)),          # a minute of odd lots only: no bar
    ])
    assert rows == [{"t": _ts(HALF, 14, 0), "o": 601.00, "h": 603.50, "l": 601.00, "c": 602.25, "v": 307}]


def test_a_half_day_without_13_01_to_15_59_gets_them_from_trades(env):
    sq, calls, trades = env
    _store_half_day(sq)
    for tf in ("1", "5", "15", "60"):                                  # the store has moved on: the half day is HISTORY
        sq.put_bars("SPY", tf, [{"t": _ts(date(2025, 12, 1), 10, 0), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    trades["rows"] = [_trade(HALF, 13, 0, 30, 999.0)]                  # inside the vendor's 13:00 minute: not ours
    trades["rows"] += [_trade(HALF, h, m, 20, 610.0 + m * 0.01) for h in (13, 14, 15) for m in range(60)
                       if (h, m) >= (13, 1)]
    before = {tf: sq.series_meta("SPY", tf)["history_rev"] for tf in ("1", "5", "15", "60")}
    got = hg.rebuild("SPY", HALF, lambda: None, rederive=bls._settle_rederive)
    assert got["minutes"] == 179
    assert calls == [("SPY", _ts(HALF, 13, 1), _ts(HALF, 16, 0))], "one window per ticker"
    one = [int(r[0]) for r in sq.get_bars_since("SPY", "1", _ts(HALF, 12, 58)) if int(r[0]) < _ts(HALF, 16, 2)]
    assert one == [_ts(HALF, 12, 59), _ts(HALF, 13, 0)] + list(range(_ts(HALF, 13, 1), _ts(HALF, 16, 0), 60)) + \
        [_ts(HALF, 16, 0), _ts(HALF, 16, 1)]
    five = [int(r[0]) for r in sq.get_bars_since("SPY", "5", _ts(HALF, 13, 0) - 1) if int(r[0]) < _ts(HALF, 16, 0)]
    assert five == list(range(_ts(HALF, 13, 0), _ts(HALF, 16, 0), 300))
    assert _row(sq, "SPY", "15", _ts(HALF, 14, 0)) is not None
    assert max(float(r[2]) for r in sq.get_bars_since("SPY", "60", _ts(HALF, 13, 0) - 1)
               if int(r[0]) < _ts(HALF, 16, 0)) >= 610.0, "the 60m afternoon carries the rebuilt minutes"
    after = {tf: sq.series_meta("SPY", tf)["history_rev"] for tf in ("1", "5", "15", "60")}
    assert all(after[tf] != before[tf] for tf in after), ("a past half day's new rows are a held-history change: "
                                                          "clients re-read once", before, after)


def test_a_vendor_row_is_never_overwritten(env):
    sq, calls, trades = env
    _store_half_day(sq)
    held = {"t": _ts(HALF, 14, 0), "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 42}
    sq.put_bars("SPY", "1", [held])                                    # a vendor 14:00 minute already stored
    vendor_13 = _row(sq, "SPY", "1", _ts(HALF, 13, 0))
    trades["rows"] = [_trade(HALF, 14, 0, 10, 777.0), _trade(HALF, 14, 5, 10, 778.0)]
    hg.rebuild("SPY", HALF, lambda: None)
    assert tuple(_row(sq, "SPY", "1", _ts(HALF, 14, 0)))[1:] == (1.0, 2.0, 0.5, 1.5, 42)
    assert _row(sq, "SPY", "1", _ts(HALF, 14, 5)) is not None
    assert _row(sq, "SPY", "1", _ts(HALF, 13, 0)) == vendor_13


def test_a_normal_day_is_untouched(env):
    sq, calls, trades = env
    trades["rows"] = [_trade(FULL, 14, 0, 10, 600.0)]
    assert hg.rebuild("SPY", FULL, lambda: None) == {}
    assert calls == []


def test_the_day_marker_survives_a_restart_and_the_backfill_goes_newest_first(env, monkeypatch):
    sq, calls, trades = env
    _store_half_day(sq, d=HALF)
    _store_half_day(sq, d=date(2025, 7, 3))
    monkeypatch.setattr(bls, "enabled", lambda: True)
    with bls._lock:
        bls._covered5.add("SPY")
    trades["rows"] = [_trade(HALF, 14, 0, 10, 610.0)]
    today = date(2025, 12, 1)
    assert hg.pending_days(today, days=200) == [HALF, date(2025, 7, 3)]
    bls.halfday_backfill_step(datetime(2025, 12, 1, 21, 0, tzinfo=_ET))
    assert hg.pending_days(today, days=200) == [date(2025, 7, 3)], "the newest went first"
    bls._reset_for_tests()                                             # a restart: memory gone, bars.db kept
    assert 20251128 in hg.done_days()
    assert hg.pending_days(today, days=200) == [date(2025, 7, 3)]
    n = len(calls)
    bls.halfday_backfill_step(datetime(2025, 12, 1, 21, 0, tzinfo=_ET))   # covered set is empty after the reset
    assert len(calls) == n


def test_the_settle_on_a_half_day_rebuilds_its_gap_once(env, monkeypatch):
    sq, calls, trades = env
    monkeypatch.setattr(bls, "enabled", lambda: True)
    monkeypatch.setattr(bls, "SETTLE_ENABLED", True)
    monkeypatch.setattr(bls, "_fetch", lambda *a: [])                   # the settle's own re-read answers nothing
    _store_half_day(sq)
    with bls._lock:
        bls._covered5.add("SPY")
    trades["rows"] = [_trade(HALF, 14, 0, 10, 610.0)]
    when = datetime(2025, 11, 28, 17, 31, tzinfo=_ET)
    counts = bls.settle_pass(when)
    assert counts["halfday"]["rows"] > 0 and _row(sq, "SPY", "1", _ts(HALF, 14, 0)) is not None
    n = len(calls)
    bls._settle["done_ymd"] = None
    bls.settle_pass(when)
    assert len(calls) == n, "a half day's gap is rebuilt once"


# ── review of #2798 ──────────────────────────────────────────────────────────────────────────────────────────────

class _Page(list):
    """A page of trades that can be watched (a plain list cannot carry a weak reference)."""
    __slots__ = ("__weakref__",)


def test_the_fold_holds_one_page_at_a_time_and_a_failed_page_writes_nothing(env, monkeypatch):
    import gc
    import weakref
    sq, calls, trades = env
    _store_half_day(sq)
    held = []

    def _pages(sym, lo, hi, take):
        prev = None
        for k in range(4):
            if prev is not None:
                gc.collect()
                held.append(prev() is not None)       # is the previous page still referenced by the fold?
            page = _Page(_trade(HALF, 13 + k % 3, 5 + k, 10, 610.0 + k) for _ in range(500))
            prev = weakref.ref(page)
            yield page
            page = None
    monkeypatch.setattr(hg, "trade_pages", _pages)
    got = hg.rebuild("SPY", HALF, lambda: None)
    assert got["minutes"] == 4
    assert held == [False, False, False], "the fold kept earlier pages alive: the trades are being collected"

    def _fails(sym, lo, hi, take):
        yield [_trade(HALF, 14, 30, 10, 611.0)]
        raise RuntimeError("provider 503 on page 2")
    monkeypatch.setattr(hg, "trade_pages", _fails)
    with pytest.raises(RuntimeError):
        hg.rebuild("SPY", HALF, lambda: None)
    assert _row(sq, "SPY", "1", _ts(HALF, 14, 30)) is None, "a ticker whose pages did not all succeed writes nothing"


def test_the_real_page_reader_has_released_the_previous_page_during_the_next_read(monkeypatch):
    """Review of #2798 (delta): `trade_pages` itself must not hold the page it yielded while it reads the next one
    (the peak would be two pages). Checked inside the next `_get`, against the real generator."""
    import gc
    import weakref
    from api.services import massive
    refs, alive_during_get = [], []

    class _Client:
        _api_key = "k"

        def _get(self, url):
            if refs:
                gc.collect()
                alive_during_get.append(refs[-1]() is not None)
            k = len(refs)
            page = _Page(_trade(HALF, 14, k, 10, 610.0 + k) for _ in range(200))
            refs.append(weakref.ref(page))
            return {"results": page, "next_url": (f"https://x/v3/trades/SPY?cursor={k}" if k < 3 else None)}
    monkeypatch.setattr(massive, "_get_client", lambda: _Client())
    mins = hg.fold_pages(hg.trade_pages("SPY", hg.gap_window(HALF)[0], hg.gap_window(HALF)[1], lambda: None))
    assert len(mins) == 4
    assert alive_during_get == [False, False, False], "the reader held the previous page during the next read"


def test_the_half_day_60m_keys_are_the_afternoon_clock_hours_and_the_morning_is_untouched(env):
    sq, calls, trades = env
    _store_half_day(sq)
    morning = {int(r[0]): tuple(r) for r in sq.get_bars_since("SPY", "60", 0) if int(r[0]) < _ts(HALF, 13, 0)}
    trades["rows"] = [_trade(HALF, h, m, 20, 610.0 + h) for h in (13, 14, 15) for m in range(0, 60, 5) if (h, m) >= (13, 5)]
    hg.rebuild("SPY", HALF, lambda: None, rederive=bls._settle_rederive)
    keys = [int(r[0]) for r in sq.get_bars_since("SPY", "60", _ts(HALF, 12, 59)) if int(r[0]) < _ts(HALF, 16, 0)]
    assert keys == [_ts(HALF, 13, 0), _ts(HALF, 14, 0), _ts(HALF, 15, 0)], keys
    after = {int(r[0]): tuple(r) for r in sq.get_bars_since("SPY", "60", 0) if int(r[0]) < _ts(HALF, 13, 0)}
    assert after == morning, "nothing of the afternoon folds into a morning 60m bar"
