"""A past-date window (`/api/bars?to=`) is never served SHORT as if it were complete (2026-11-28).

Members saw short charts at past dates (738-1,086 of 1,152 bars on cold windows):
  (a) a window counted short only below 0.9 x the ask, so 1,086 of 1,152 was served unflagged with
      `max-age=3600` (cached short for an hour, edge included);
  (b) a cold fetch that got no slot (`_replay_cold_sem`) or whose thread failed re-read with no fetch running and
      served the short rows unflagged: `filling` was set only while a fetch was running;
  (c) a window with NO stored rows fell to `_get_bars_inner` (the RECENT bars), which the client's cutoff turns into
      an EMPTY window.
A window answer with fewer rows than asked is final only when the store is PROVEN to hold all there is (the window
marker `towin_*`, set after a fetch answered and its rows were stored; D/W/M: the deep job ran). Otherwise it is
`filling` + `short` + Retry-After with a 5 s cache, and an empty one is the warming 503, never the recent bars.
Synthetic store and fake providers only; every price is an invented number.
"""
from __future__ import annotations

import datetime as _dt
import threading
import time
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bars_fetch, bars_sqlite
from api.services.cache import cache

ET = ZoneInfo("America/New_York")
ASK = 1000


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    monkeypatch.setattr(bars_fetch, "_get_bars_inner",
                        lambda *a, **k: pytest.fail("a past-date window fell to the RECENT bars"))
    bars_fetch.start_request_budget()
    yield
    for p in ("towin_", "replayto"):
        cache.delete_prefix(p)
    bars_sqlite.bump_db_epoch()


def _et(d, hh, mm):
    return int(_dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).timestamp())


def _rth(d):
    return [{"t": _et(d, 9, 30) + k * 900, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1} for k in range(26)]


def _sessions(end, n):
    out, d = [], end
    while len(out) < n:
        if bars_fetch._is_trading_day_ymd(d):
            out.append(d)
        d -= _dt.timedelta(days=1)
    return out[::-1]


END = _dt.date(2016, 6, 30)
TO = END.isoformat()


def _put(sym, days):
    bars_sqlite.put_bars(sym, "15", [b for d in days for b in _rth(d)])


def _body(r):
    return orjson.loads(r.body)


def _assert_flagged_short(r, n):
    body = _body(r)
    assert r.status_code == 200, r.status_code
    assert body.get("filling") is True and body.get("short") is True, {k: body.get(k) for k in ("filling", "short")}
    assert len(body["bars"]) == n
    assert r.headers.get("retry-after") == "3"
    assert r.headers.get("cache-control") == "public, max-age=5", r.headers.get("cache-control")


def _saturate(sem):
    n = 0
    while sem.acquire(blocking=False):
        n += 1
    return n


# ── (a) short = fewer than asked, not fewer than 0.9 x ───────────────────────────────────────────────────────────────

def test_a_window_at_96_percent_of_the_ask_is_fetched_and_served_flagged_while_it_lands(store, monkeypatch):
    days = _sessions(END, 37)                                   # 37 x 26 = 962 of 1,000: above the old 0.9 line
    _put("PCT96", days)
    gate, calls = threading.Event(), []

    def slow(t, tf, f, to, raise_errors=False):
        calls.append((f, to))
        gate.wait(5)
        return []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", slow)
    monkeypatch.setattr(bars_fetch, "_TO_SHORT_WAIT_SECONDS", 0.1)
    try:
        r = bars_fetch._get_bars_to_response("PCT96", "15", ASK, TO)
        assert calls, "a window at 96% of the ask never asked the provider for the rest"
        _assert_flagged_short(r, 962)
    finally:
        gate.set()


def test_a_short_window_proven_by_a_finished_fetch_is_final(store, monkeypatch):
    # control: the provider answered and has nothing older (a listing's start) -> the short window is final
    days = _sessions(END, 37)
    _put("LIST", days)
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda t, tf, f, to, raise_errors=False: calls.append(f) or [])
    r = bars_fetch._get_bars_to_response("LIST", "15", ASK, TO)
    body = _body(r)
    assert calls and not body.get("filling") and not body.get("short") and len(body["bars"]) == 962
    assert r.headers.get("cache-control") == "public, max-age=3600"
    n = len(calls)
    bars_fetch._get_bars_to_response("LIST", "15", ASK, TO)
    assert len(calls) == n, "a proven window asked the provider again"


def test_a_full_window_is_served_complete_without_a_fetch(store, monkeypatch):
    _put("FULLW", _sessions(END, 40))
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: pytest.fail("a full window fetched"))
    r = bars_fetch._get_bars_to_response("FULLW", "15", ASK, TO)
    body = _body(r)
    assert len(body["bars"]) == ASK and not body.get("filling") and not body.get("short")
    assert r.headers.get("cache-control") == "public, max-age=3600"


# ── (b) a cold fetch that got no slot, or failed, is filling, not complete ───────────────────────────────────────────

def test_a_short_window_whose_fetch_got_no_slot_is_flagged(store, monkeypatch):
    _put("NOSLOT", _sessions(END, 20))                          # 520 of 1,000
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: pytest.fail("fetched without a slot"))
    n = _saturate(bars_fetch._replay_cold_sem)
    try:
        r = bars_fetch._get_bars_to_response("NOSLOT", "15", ASK, TO)
    finally:
        for _ in range(n):
            bars_fetch._replay_cold_sem.release()
    _assert_flagged_short(r, 520)


def test_a_short_window_whose_fetch_failed_is_flagged(store, monkeypatch):
    _put("FAILF", _sessions(END, 20))

    def boom(*a, **k):
        raise RuntimeError("provider 500")
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", boom)
    r = bars_fetch._get_bars_to_response("FAILF", "15", ASK, TO)
    _assert_flagged_short(r, 520)


# ── (c) a window with no stored rows: warming or no_data, never the recent bars ──────────────────────────────────────

@pytest.mark.parametrize("warm", [False, True])
def test_an_empty_window_whose_fetch_failed_is_warming_never_the_recent_bars(store, monkeypatch, warm):
    def boom(*a, **k):
        raise RuntimeError("provider 500")
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", boom)
    r = bars_fetch._get_bars_to_response("EMPTYF", "15", ASK, TO, warm=warm)
    assert r.status_code == 503 and r.headers.get("x-bars-shed") == "warming" and r.headers.get("retry-after") == "3"


def test_an_empty_window_whose_fetch_got_no_slot_is_warming(store, monkeypatch):
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: pytest.fail("fetched without a slot"))
    n = _saturate(bars_fetch._replay_cold_sem)
    try:
        r = bars_fetch._get_bars_to_response("EMPTYS", "15", ASK, TO)
    finally:
        for _ in range(n):
            bars_fetch._replay_cold_sem.release()
    assert r.status_code == 503 and r.headers.get("x-bars-shed") == "warming"


def test_an_empty_window_the_provider_answered_empty_is_no_data(store, monkeypatch):
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    r = bars_fetch._get_bars_to_response("NOTHING", "15", ASK, TO)
    body = _body(r)
    assert r.status_code == 200 and body.get("no_data") is True and body["bars"] == []


@pytest.mark.parametrize("tf", ["D", "W", "M"])
def test_a_daily_window_with_nothing_before_the_cutoff_is_no_data(store, monkeypatch, tf):
    for name in ("_fetch_daily", "_fetch_weekly", "_fetch_monthly"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: [])
    r = bars_fetch._get_bars_to_response("NODAILY", tf, 300, TO)
    body = _body(r)
    assert r.status_code == 200 and body.get("no_data") is True and body["bars"] == []
