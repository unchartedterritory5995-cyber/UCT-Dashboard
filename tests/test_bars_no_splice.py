"""No intraday answer is spliced across a hole nobody fetched (2026-11-27).

Synthetic stores and fake providers only; every price is an invented number. The two
fixtures at the top reproduce the shapes MEASURED on production:

  MSFT 15m `to=2016-06-30` bars=1000 answered 999 rows "spanning" 2008-05-13 -> 2016-06-30:
      998 dense June-2016 rows plus ONE row from an older island an earlier replay stored.
  AAPL 60m bars=20000 (the newest-N read) stitched 2008 / 2012 / 2016 / 2020 islands into
      one series with 3-4-year jumps.

Contracts guarded here:
  N1  A `to=` window and a newest-N read are cut at the first gap longer than
      `_SPLICE_GAP_S` (the newest side kept), on every path that serves, warms or caches.
  N2  A gap the provider was asked about (a proven span) is the provider's: a halt is
      served through, never cut. Only a MASSIVE answer proves; a fallback's holes do not.
  N3  A `to=` window is sized from the rows the series really prints per session and is
      filled (window doubling) until it holds the ask: MSFT 15m reaches 1000, not 998.
  N4  A provider fault anywhere in the fill leaves the window un-marked (retried).
  N5  Every chart read of a newest-N window goes through `read_newest` (source rail).
"""
from __future__ import annotations

import ast
import datetime as _dt
import inspect
import pathlib
import textwrap
import threading
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bars_fetch, bars_sqlite
from api.services.cache import cache

ET = ZoneInfo("America/New_York")
ROOT = pathlib.Path(__file__).resolve().parents[1]
GAP = 7 * 86400          # `_SPLICE_GAP_S` default (restated: the red-first run predates it)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    _proofs = getattr(bars_fetch, "_proven_cache", None)
    if _proofs is not None:
        _proofs.clear()
    yield
    if _proofs is not None:
        _proofs.clear()
    bars_sqlite.bump_db_epoch()


def _et(d: _dt.date, hh: int, mm: int) -> int:
    return int(_dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).timestamp())


def _days(start: _dt.date, end: _dt.date):
    out, d = [], start
    while d <= end:
        if bars_fetch._is_trading_day_ymd(d):
            out.append(d)
        d += _dt.timedelta(days=1)
    return out


def _bar(t, px=10.0):
    return {"t": t, "o": px, "h": px, "l": px, "c": px, "v": 100}


# 15m extended-hours day as a stock prints it: every regular slot (26) plus 21 of the 38
# extended slots — 47 of 64, the "~31-47 of 64" the sizing comment names.
_EXT_SLOTS = [(4, 0), (4, 30), (5, 0), (5, 30), (6, 0), (6, 30), (7, 0), (7, 30), (8, 0), (8, 30),
              (9, 0), (16, 0), (16, 30), (17, 0), (17, 30), (18, 0), (18, 30), (19, 0), (19, 15),
              (19, 30), (19, 45)]


def _ext15_day(d: _dt.date, px=10.0):
    rth = [_et(d, 9, 30) + k * 900 for k in range(26)]
    ext = [_et(d, h, m) for h, m in _EXT_SLOTS]
    return [_bar(t, px) for t in sorted(rth + ext)]


def _h60_day(d: _dt.date, px=10.0):
    """The stored 60m session grid: 09:30, 10:30 ... 15:30."""
    return [_bar(_et(d, 9, 30) + k * 3600, px) for k in range(7)]


def _body(resp):
    return orjson.loads(resp.body)


def _max_gap(bars) -> int:
    ts = [b["t"] for b in bars]
    return max((b - a for a, b in zip(ts, ts[1:])), default=0)


# ── N1: the two production shapes ─────────────────────────────────────────────

def _msft_store():
    june = _days(_dt.date(2016, 6, 1), _dt.date(2016, 6, 30))
    dense = [b for d in june for b in _ext15_day(d, 51.0)]
    dense = dense[-998:]                                   # 998 dense June-2016 rows
    island = [_bar(_et(_dt.date(2008, 5, 13), 10, 0), 29.0)]   # ONE row from 2008
    bars_sqlite.put_bars("MSFT", "15", island + dense)
    return dense, island


def test_msft_15m_to_window_never_carries_the_2008_island_row(store, monkeypatch):
    dense, island = _msft_store()
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda *a, **k: pytest.fail("a 998-of-1000 window is covered: no fetch"))
    cache.delete_prefix("towin_MSFT_")
    body = _body(bars_fetch._get_bars_to_response("MSFT", "15", 1000, "2016-06-30"))
    got = body["bars"]
    assert island[0]["t"] not in {b["t"] for b in got}, "the 2008 island row was spliced in"
    assert got[0]["t"] == dense[0]["t"] and got[-1]["t"] == dense[-1]["t"]
    assert _max_gap(got) <= GAP
    cache.delete_prefix("towin_MSFT_")


def _aapl_islands():
    islands = []
    for y in (2008, 2012, 2016, 2020):
        days = _days(_dt.date(y, 1, 2), _dt.date(y + 2, 12, 31))[:500]
        islands.append([b for d in days for b in _h60_day(d, float(y - 2000))])
    recent_days = _days(_dt.date(2024, 4, 1), _dt.date(2026, 11, 25))[-600:]
    recent = [b for d in recent_days for b in _h60_day(d, 200.0)]
    return islands, recent


@pytest.fixture
def warm_serve(monkeypatch):
    """`_get_bars_inner` with the store fresh and no provider: only the read decides."""
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bars_fetch, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda *a, **k: False)
    deep_asks = []

    def _no_fetch(t, tf, bars):
        deep_asks.append((t, tf, bars))
        ev = threading.Event()
        ev.set()
        return ev
    monkeypatch.setattr(bars_fetch, "_start_bounded_fetch_intraday", _no_fetch)
    return deep_asks


def test_aapl_60m_newest_n_read_is_not_stitched_from_islands(store, warm_serve):
    islands, recent = _aapl_islands()
    bars_sqlite.put_bars("AAPL", "60", [b for isl in islands for b in isl] + recent)
    assert len(bars_sqlite.get_bars("AAPL", "60", 20000)) >= 18000   # the old "covered" read
    cache.delete_prefix("bars_AAPL_60_")
    got = _body(bars_fetch._get_bars_inner("AAPL", "60", 20000))["bars"]
    cache.delete_prefix("bars_AAPL_60_")
    assert _max_gap(got) <= GAP, "islands stitched into one series"
    assert got[0]["t"] == recent[0]["t"] and got[-1]["t"] == recent[-1]["t"]
    # ⛔ a cut is not missing depth (review #2951 M3): the store HELD the depth, so no
    # newest-window refetch; the hole is the scroll-back's (`to=`) and deepfill's to fill
    assert warm_serve == []


def test_the_warm_prefetch_never_seeds_a_stitched_series(store, monkeypatch):
    islands, recent = _aapl_islands()
    bars_sqlite.put_bars("AAPL", "60", [b for isl in islands for b in isl] + recent)
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    cache.delete_prefix("bars_AAPL_60_")
    # the store holds the depth (18200 of 20000): the warm seeds the CUT series, never the stitch
    r = bars_fetch.serve_warm_from_cache("AAPL", "60", 20000)
    assert r is not None and _max_gap(_body(r)["bars"]) <= GAP
    assert _body(r)["bars"][0]["t"] == recent[0]["t"]
    r = bars_fetch.serve_warm_from_cache("AAPL", "60", 4000)
    assert r is not None and _max_gap(_body(r)["bars"]) <= GAP
    cache.delete_prefix("bars_AAPL_60_")


def _illiquid_with_gap(ticker):
    """A name that has not printed for 10 days, with a 30-day interior hole: 60 sessions
    after the hole, 700 before it. 60m: bars=600 and bars=5000 both read across the hole and
    the store HOLDS both depths (a store shorter than its ask is partial on master too)."""
    end = _dt.date.today() - _dt.timedelta(days=10)
    newer = [d for d in _days(end - _dt.timedelta(days=120), end)][-60:]
    older = [d for d in _days(newer[0] - _dt.timedelta(days=1200), newer[0] - _dt.timedelta(days=30))][-700:]
    bars_sqlite.put_bars(ticker, "60", [b for d in older + newer for b in _h60_day(d)])
    return older, newer


@pytest.mark.parametrize("bars", [600, 5000])
def test_a_stale_illiquid_cut_read_is_not_refetched_on_every_poll(store, monkeypatch, bars):
    """review #2951 M3: the full fetch of a name with no recent print comes back STALE, so it
    persists nothing and proves nothing; if the cut counted as missing depth the read was
    partial forever and every poll refetched. At most ONE vendor fetch across many polls."""
    import time as _t
    older, newer = _illiquid_with_gap("ILLQ")
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)   # tail verified
    monkeypatch.setattr(bars_fetch, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda *a, **k: False)
    fetches = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday", lambda t, tf, n: fetches.append(n) or [])
    monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda *a, **k: fetches.append("delta") or [])
    stored_n = len(bars_sqlite.get_bars("ILLQ", "60", bars))
    for _ in range(12):
        cache.delete_prefix("bars_ILLQ_60_")                # each poll past the memory TTL
        got = _body(bars_fetch._get_bars_inner("ILLQ", "60", bars))["bars"]
        assert _max_gap(got) <= GAP
        for _w in range(100):                               # let any background job land
            if not any("ILLQ" in str(k) for k in bars_fetch._inflight):
                break
            _t.sleep(0.01)
    assert len(fetches) <= 1, f"{len(fetches)} vendor fetches over 12 polls (store held {stored_n} rows)"


def test_a_contiguous_read_passes_through_whole(store):
    recent = _aapl_islands()[1]
    bars_sqlite.put_bars("FULL", "60", recent)
    assert len(bars_fetch.read_newest("FULL", "60", 20000)) == len(recent)


def test_daily_reads_are_never_cut():
    rows = [(20080513, 1, 1, 1, 1, 1), (20160601, 1, 1, 1, 1, 1)]
    assert bars_fetch._contiguous_tail("X", "D", rows) is rows


# ── N2: proven spans ──────────────────────────────────────────────────────────

def _halted(ticker):
    old = [b for d in _days(_dt.date(2025, 1, 2), _dt.date(2025, 2, 28)) for b in _h60_day(d, 5.0)]
    new = [b for d in _days(_dt.date(2025, 5, 1), _dt.date(2025, 6, 30)) for b in _h60_day(d, 6.0)]
    bars_sqlite.put_bars(ticker, "60", old + new)
    return old, new


def test_an_unproven_halt_is_cut_and_a_proven_one_is_served_through(store):
    old, new = _halted("HALT")
    assert len(bars_fetch.read_newest("HALT", "60", 5000)) == len(new)
    bars_fetch.note_provider_span("HALT", "60", old[0]["t"], new[-1]["t"])
    assert len(bars_fetch.read_newest("HALT", "60", 5000)) == len(old) + len(new)


def test_a_span_that_does_not_reach_across_the_gap_proves_nothing(store):
    old, new = _halted("HALF")
    bars_fetch.note_provider_span("HALF", "60", old[-1]["t"] + 1, new[-1]["t"])   # starts after the old side
    assert len(bars_fetch.read_newest("HALF", "60", 5000)) == len(new)


def test_touching_day_windows_merge_into_one_proof(store):
    old, new = _halted("JOIN")
    mid = _et(_dt.date(2025, 4, 1), 0, 0)
    bars_fetch.note_provider_span("JOIN", "60", old[0]["t"], mid - 1)
    bars_fetch.note_provider_span("JOIN", "60", mid, new[-1]["t"])
    assert bars_fetch.proven_spans("JOIN", "60") == [(old[0]["t"], new[-1]["t"])]
    assert len(bars_fetch.read_newest("JOIN", "60", 5000)) == len(old) + len(new)


def test_a_massive_full_fetch_proves_its_span_and_a_fallback_does_not(store, monkeypatch):
    old, new = _halted("SRC")
    fetched = old + new
    bars_fetch._set_intraday_source("yfinance")
    bars_fetch._record_full_cover("SRC", "60", fetched, new[-1]["t"] + 60)
    assert bars_fetch.proven_spans("SRC", "60") == []
    assert len(bars_fetch.read_newest("SRC", "60", 5000)) == len(new)
    bars_fetch._set_intraday_source("massive")
    bars_fetch._record_full_cover("SRC", "60", fetched, new[-1]["t"] + 60)
    bars_fetch._set_intraday_source(None)
    assert len(bars_fetch.read_newest("SRC", "60", 5000)) == len(fetched)


def test_a_deepfill_that_found_nothing_missing_still_proves_its_span(store, monkeypatch):
    old, new = _halted("DFILL")
    monkeypatch.setattr(bars_fetch, "_fetch_intraday", lambda t, tf, n: list(old + new))
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    bars_fetch._set_intraday_source("massive")
    try:
        assert bars_fetch._deepfill_once("DFILL", "60", 5000) == 0
    finally:
        bars_fetch._set_intraday_source(None)
    assert len(bars_fetch.read_newest("DFILL", "60", 5000)) == len(old) + len(new)


def test_a_deepfill_that_proves_a_span_busts_the_payloads_cut_without_it(store, monkeypatch):
    """review #2951 L1: the startup prewarm caches answers with NO proofs (a cut halt); a
    no-op deepfill that proves the span must drop those payloads, as the filling one does."""
    old, new = _halted("BUST")
    cache.set("bars_BUST_60_5000", {"bars": "cut"}, ttl=600)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday", lambda t, tf, n: list(old + new))
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    bars_fetch._set_intraday_source("massive")
    try:
        assert bars_fetch._deepfill_once("BUST", "60", 5000) == 0
    finally:
        bars_fetch._set_intraday_source(None)
    assert cache.get("bars_BUST_60_5000") is None


# ── N3: sizing and filling a to= window ───────────────────────────────────────

def _provider(days_by_iso, maker, calls, fail_on=None):
    def fake_range(t, tf, f, to, raise_errors=False):
        calls.append((f, to))
        if fail_on is not None and len(calls) == fail_on:
            raise RuntimeError("vendor 500")
        return [b for iso, d in days_by_iso.items() if f <= iso <= to for b in maker(d)]
    return fake_range


def test_msft_15m_cold_to_window_reaches_the_full_ask(store, monkeypatch):
    """The old `16*60/tf` sizing assumed all 64 extended slots print; a stock prints 47, so
    the one window it fetched came back short of 1000 rows."""
    days = {d.isoformat(): d for d in _days(_dt.date(2015, 1, 2), _dt.date(2016, 6, 30))}
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, _ext15_day, calls))
    cache.delete_prefix("towin_MSFT_")
    body = _body(bars_fetch._get_bars_to_response("MSFT", "15", 1000, "2016-06-30"))
    cache.delete_prefix("towin_MSFT_")
    assert len(body["bars"]) == 1000, f"{len(body['bars'])} of 1000"
    assert body["bars"][-1]["t"] == _ext15_day(_dt.date(2016, 6, 30))[-1]["t"]
    assert _max_gap(body["bars"]) <= GAP


def test_a_thin_name_window_is_filled_to_the_ask_not_to_ninety_percent(store, monkeypatch):
    """22 rows a session (a thin name): the first window lands between 90% and 100% of the
    ask. The serve gate's `0.9 * bars` is not the fill target; the fill reaches 1000."""
    thin = lambda d: [_bar(_et(d, 9, 30) + k * 900) for k in range(22)]   # noqa: E731
    days = {d.isoformat(): d for d in _days(_dt.date(2015, 1, 2), _dt.date(2016, 6, 30))}
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, thin, calls))
    cache.delete_prefix("towin_THIN_")
    body = _body(bars_fetch._get_bars_to_response("THIN", "15", 1000, "2016-06-30"))
    cache.delete_prefix("towin_THIN_")
    first = [d for iso, d in days.items() if calls[0][0] <= iso <= calls[0][1]]
    assert 900 <= len(first) * 22 < 1000, "fixture: the first window must land in [90%, 100%)"
    assert len(body["bars"]) == 1000 and len(calls) == 2


def test_a_fill_reaches_back_across_a_halt_and_proves_it(store, monkeypatch):
    """10 sessions before the cutoff, a 90-day halt, then deep history: one window gets only
    the 10 sessions; the fill keeps going, crosses the halt, and serves through it."""
    rth = lambda d: [_bar(_et(d, 9, 30) + k * 900) for k in range(26)]   # noqa: E731
    before = _days(_dt.date(2023, 1, 3), _dt.date(2023, 3, 31))
    after = _days(_dt.date(2023, 7, 1), _dt.date(2023, 7, 31))[:10]
    days = {d.isoformat(): d for d in before + after}
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, rth, calls))
    to = after[-1].isoformat()
    cache.delete_prefix("towin_HLT_")
    body = _body(bars_fetch._get_bars_to_response("HLT", "15", 1000, to))
    assert len(calls) >= 2
    assert len(body["bars"]) == 1000 and _max_gap(body["bars"]) > GAP   # served THROUGH the halt
    assert cache.get(f"towin_HLT_15_{to}_{bars_fetch._depth_tier(1000)}") == 1
    cache.delete_prefix("towin_HLT_")


def test_a_short_to_window_beside_an_old_island_fills_instead_of_splicing(store, monkeypatch):
    """The MSFT shape with only 3 sessions stored: the cut run is short, so the stretch
    before it is fetched and the answer is the ask, contiguous, with no 2008 row."""
    june = _days(_dt.date(2016, 6, 1), _dt.date(2016, 6, 30))
    bars_sqlite.put_bars("MSFT", "15", [_bar(_et(_dt.date(2008, 5, 13), 10, 0))]
                         + [b for d in june[-3:] for b in _ext15_day(d)])
    days = {d.isoformat(): d for d in _days(_dt.date(2015, 6, 1), _dt.date(2016, 6, 30))}
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, _ext15_day, calls))
    cache.delete_prefix("towin_MSFT_")
    body = _body(bars_fetch._get_bars_to_response("MSFT", "15", 1000, "2016-06-30"))
    cache.delete_prefix("towin_MSFT_")
    assert len(body["bars"]) == 1000 and _max_gap(body["bars"]) <= GAP
    assert calls[0][1] == june[-3].isoformat()          # before the CUT run's oldest row


def test_a_missing_window_is_sized_for_the_whole_ask_not_minus_another_eras_rows(store, monkeypatch):
    """900 rows of a 2012 island sit below a 2016 cutoff: they are another era, so they count
    for density only. Sized as if they were in the window, the first fetch asks for ~100 rows
    and the fill needs extra rounds; sized right, one window holds the ask."""
    rth = lambda d: [_bar(_et(d, 9, 30) + k * 900) for k in range(26)]   # noqa: E731
    island = _days(_dt.date(2012, 3, 1), _dt.date(2012, 12, 31))[:35]
    bars_sqlite.put_bars("ERA", "15", [b for d in island for b in rth(d)][-900:])
    days = {d.isoformat(): d for d in _days(_dt.date(2015, 6, 1), _dt.date(2016, 6, 30))}
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, _ext15_day, calls))
    cache.delete_prefix("towin_ERA_")
    body = _body(bars_fetch._get_bars_to_response("ERA", "15", 1000, "2016-06-30"))
    cache.delete_prefix("towin_ERA_")
    assert len(body["bars"]) == 1000 and _max_gap(body["bars"]) <= GAP
    assert len(calls) == 1, calls


def test_two_empty_windows_end_the_fill(store, monkeypatch):
    """A listing's start (or a cutoff before it): the provider has nothing. One empty
    window does not stop the fill (a halt can outlast one); two in a row do."""
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider({}, _ext15_day, calls))
    cache.delete_prefix("towin_NEW_")
    bars_fetch._get_bars_to_response("NEW", "15", 1000, "2016-06-30")
    cache.delete_prefix("towin_NEW_")
    assert len(calls) == 2, calls


def test_no_fill_round_asks_for_more_than_its_rows_need(store, monkeypatch):
    """review #2951 L2: a thin 1m name (5 rows a session) short of a 4000-row window. Blind
    doubling took the rounds to 800 / 1600 / 3200 days; every round is now sized from the
    observed density for the rows still missing, never past `_TO_FILL_ROUND_MAX_DAYS`."""
    thin = lambda d: [_bar(_et(d, 10, 0) + k * 3600) for k in range(5)]   # noqa: E731
    days = {d.isoformat(): d for d in _days(_dt.date(2004, 1, 2), _dt.date(2016, 6, 30))}
    bars_sqlite.put_bars("THIN1", "1", [b for d in list(days.values())[-3:] for b in thin(d)])
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, thin, calls))
    cache.delete_prefix("towin_THIN1_")
    bars_fetch._get_bars_to_response("THIN1", "1", 4000, "2016-06-30")
    cache.delete_prefix("towin_THIN1_")
    span = lambda c: (_dt.date.fromisoformat(c[1]) - _dt.date.fromisoformat(c[0])).days   # noqa: E731
    assert len(calls) >= 2
    assert max(span(c) for c in calls) <= bars_fetch._TO_FILL_ROUND_MAX_DAYS, [span(c) for c in calls]


def test_a_round_after_an_empty_window_grows_but_never_past_the_cap(store, monkeypatch):
    """review #2951 L2, the empty-window branch: a thin 1m name's first window is already the
    400-day cap and comes back EMPTY (a halt). The next round may grow, never past the cap."""
    thin = lambda d: [_bar(_et(d, 10, 0) + k * 3600) for k in range(5)]   # noqa: E731
    stored = _days(_dt.date(2016, 6, 27), _dt.date(2016, 6, 30))[-3:]
    bars_sqlite.put_bars("HALT1", "1", [b for d in stored for b in thin(d)])
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider({}, thin, calls))
    cache.delete_prefix("towin_HALT1_")
    bars_fetch._get_bars_to_response("HALT1", "1", 4000, "2016-06-30")
    cache.delete_prefix("towin_HALT1_")
    span = lambda c: (_dt.date.fromisoformat(c[1]) - _dt.date.fromisoformat(c[0])).days   # noqa: E731
    assert len(calls) == 2, calls
    assert span(calls[0]) == bars_fetch._TO_FILL_ROUND_MAX_DAYS            # fixture: round 1 at the cap
    assert span(calls[1]) <= bars_fetch._TO_FILL_ROUND_MAX_DAYS, [span(c) for c in calls]


def test_lookback_is_sized_from_observed_density():
    d = _dt.date(2016, 6, 1)
    two = [(b["t"],) for b in _ext15_day(d)] + [(b["t"],) for b in _ext15_day(d + _dt.timedelta(days=1))]
    thin = bars_fetch._to_window_lookback_days("15", 1000, [], density_rows=two)          # 47/session
    blind = bars_fetch._to_window_lookback_days("15", 1000, [])                           # 26/session
    assert blind > thin >= int(1000 / 47 * 1.5)


# ── N4: faults leave the window un-marked ─────────────────────────────────────

def test_a_fault_in_a_later_round_leaves_the_window_unmarked(store, monkeypatch):
    rth = lambda d: [_bar(_et(d, 9, 30) + k * 900) for k in range(26)]   # noqa: E731
    days = {d.isoformat(): d for d in _days(_dt.date(2023, 7, 1), _dt.date(2023, 7, 31))}
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", _provider(days, rth, calls, fail_on=2))
    to = "2023-07-31"
    cache.delete_prefix("towin_FLT_")
    bars_fetch._get_bars_to_response("FLT", "15", 1000, to)
    assert len(calls) == 2
    assert cache.get(f"towin_FLT_15_{to}_{bars_fetch._depth_tier(1000)}") is None
    cache.delete_prefix("towin_FLT_")


# ── N5: every chart read of a newest-N window goes through `read_newest` ──────

def _calls_get_bars(fn_node) -> list[int]:
    out = []
    for n in ast.walk(fn_node):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr in ("get_bars", "get_bars_before")):
            out.append(n.lineno)
    return out


def _fn(tree, name):
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name:
            return n
    raise AssertionError(f"{name} not found")


@pytest.mark.parametrize("path,fn,allowed", [
    ("api/services/bars_fetch.py", "_get_bars_inner", 0),
    ("api/services/bars_fetch.py", "serve_warm_from_cache", 0),
    ("api/services/bars_fetch.py", "_get_bars_since_response", 0),
    ("api/services/ffseed.py", "store_read", 0),
    ("api/main.py", "_warm_sym_into_memory", 0),
])
def test_serving_reads_never_call_get_bars_directly(path, fn, allowed):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    hits = _calls_get_bars(_fn(tree, fn))
    assert len(hits) == allowed, f"{path}:{fn} reads get_bars directly at lines {hits}"


def test_the_to_window_reads_are_all_cut():
    """Every intraday `get_bars_before` read in the `to=` path is wrapped in `_contiguous_tail`."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(bars_fetch._get_bars_to_response)))
    wrapped, bare = 0, []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_contiguous_tail":
            wrapped += sum(1 for a in n.args if isinstance(a, ast.Call)
                           and isinstance(a.func, ast.Attribute) and a.func.attr == "get_bars_before")
    total = len(_calls_get_bars(tree))
    # the one bare read is the D/W/M deep branch (`date_tf` only: nothing to cut)
    assert total - wrapped == 1, f"{total - wrapped} uncut get_bars_before reads"


def test_bars_history_reads_through_read_newest():
    src = (ROOT / "api/routers/bars.py").read_text(encoding="utf-8")
    assert "_bars_fetch._sqlite.get_bars(" not in src
    assert "_bars_fetch.read_newest(sym, tfu, bars)" in src
