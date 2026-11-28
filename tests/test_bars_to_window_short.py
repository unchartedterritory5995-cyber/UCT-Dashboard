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

from api.services import bars_fetch, bars_sqlite, massive, provider_fault_scope
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
    # the provider's DAILY: by default the series traded long before every window here (a listing rail says otherwise)
    monkeypatch.setattr(massive, "get_agg_bars", lambda *a, **k: [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    bars_fetch.start_request_budget()
    yield
    for p in ("towin_", "towinfail_", "replayto"):
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
    # (review of #3011, F3) never cached: a cached copy would answer the 3 s re-ask from the browser's HTTP cache
    assert r.headers.get("cache-control") == "no-store", r.headers.get("cache-control")


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
    # control: the provider answered and has nothing older across the listing threshold (a listing's start; review of
    # #3011, F2: the rounds sized for the 38 missing rows span only days, so the threshold is set below them)
    days = _sessions(END, 37)
    _put("LIST", days)
    monkeypatch.setattr(bars_fetch, "_TO_LISTING_EMPTY_DAYS", 1)
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
    # proven empty: the provider answered nothing across the listing threshold (review of #3011, F2)
    monkeypatch.setattr(bars_fetch, "_TO_LISTING_EMPTY_DAYS", 30)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    r = bars_fetch._get_bars_to_response("NOTHING", "15", ASK, TO)
    body = _body(r)
    assert r.status_code == 200 and body.get("no_data") is True and body["bars"] == []


def test_an_empty_window_whose_empty_rounds_span_less_than_the_threshold_is_warming(store, monkeypatch):
    # (review of #3011, F2) two small empty rounds are a vendor gap, not proof the window is empty
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    r = bars_fetch._get_bars_to_response("NOTHING2", "15", ASK, TO)
    assert r.status_code == 503 and r.headers.get("x-bars-shed") == "warming" and not _body(r).get("no_data")


def _later_rows(tf):
    """A series that starts AFTER the cutoff (listed 2017): the provider answers, nothing is before the cutoff."""
    if tf == "D":
        days = [d for d in _sessions(_dt.date(2017, 3, 31), 40)]
        return [{"t": d.isoformat(), "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1} for d in days]
    if tf == "W":
        return [{"t": f"2017-03-{d:02d}", "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1} for d in (3, 10, 17, 24, 31)]
    return [{"t": f"2017-{m:02d}-01", "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1} for m in (1, 2, 3)]


@pytest.mark.parametrize("tf", ["D", "W", "M"])
def test_a_daily_window_with_nothing_before_the_cutoff_is_no_data(store, monkeypatch, tf):
    for name in ("_fetch_daily", "_fetch_weekly", "_fetch_monthly"):
        monkeypatch.setattr(bars_fetch, name, lambda *a, **k: _later_rows(tf))
    r = bars_fetch._get_bars_to_response("NODAILY", tf, 300, TO)
    body = _body(r)
    assert r.status_code == 200 and body.get("no_data") is True and body["bars"] == []


# ── review of #3011, F1: D/W/M "proven" only when the deep fetch ANSWERED (rows returned and stored) ─────────────────

def _boom(*a, **k):
    raise RuntimeError("provider 500")


@pytest.mark.parametrize("tf", ["D", "W", "M"])
@pytest.mark.parametrize("how", ["fetch_raises", "fetch_empty", "write_fails"])
def test_a_daily_window_whose_deep_fetch_did_not_answer_is_warming_never_no_data(store, monkeypatch, tf, how):
    for name in ("_fetch_daily", "_fetch_weekly", "_fetch_monthly"):
        monkeypatch.setattr(bars_fetch, name, _boom if how == "fetch_raises"
                            else (lambda *a, **k: []) if how == "fetch_empty" else (lambda *a, **k: _later_rows(tf)))
    if how == "write_fails":
        monkeypatch.setattr(bars_fetch._sqlite, "put_bars", _boom)
    r = bars_fetch._get_bars_to_response("DFAIL", tf, 300, TO)
    assert r.status_code == 503 and r.headers.get("x-bars-shed") == "warming", (r.status_code, _body(r))
    assert not _body(r).get("no_data")


def test_a_daily_deep_fetch_that_just_failed_is_not_rerun_per_repoll(store, monkeypatch):
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_daily", lambda *a, **k: calls.append(1) or [])
    for _ in range(3):
        assert bars_fetch._get_bars_to_response("DLOAD", "D", 300, TO).status_code == 503
    assert len(calls) == 1, calls


# ── review of #3011, F2: the window marker proves the window only for a final stop or a held count ──────────────────

def test_two_small_empty_rounds_are_a_gap_not_a_listing_start(store, monkeypatch):
    # 20 sessions stored, the provider has nothing in the next ~3 months before them (a vendor gap): not final
    _put("GAP", _sessions(END, 20))
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda t, tf, f, to, raise_errors=False: calls.append((f, to)) or [])
    r = bars_fetch._get_bars_to_response("GAP", "15", ASK, TO)
    assert len(calls) == 2, calls
    _assert_flagged_short(r, 520)
    assert not bars_fetch._to_window_proven(cache.get(f"towin_GAP_15_{TO}_{bars_fetch._depth_tier(ASK)}"), ASK)


def test_two_empty_rounds_spanning_the_listing_threshold_prove_the_start(store, monkeypatch):
    _put("LISTED", _sessions(END, 20))
    monkeypatch.setattr(bars_fetch, "_TO_LISTING_EMPTY_DAYS", 30)      # the two empty rounds here span more than this
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    r = bars_fetch._get_bars_to_response("LISTED", "15", ASK, TO)
    body = _body(r)
    assert not body.get("filling") and not body.get("short") and len(body["bars"]) == 520
    assert r.headers.get("cache-control") == "public, max-age=3600"


def test_the_providers_floor_proves_the_window(store, monkeypatch):
    days = _sessions(END, 20)
    _put("FLOOR", days)
    monkeypatch.setattr(bars_fetch, "_INTRADAY_FLOOR_YMD", (days[0] - _dt.timedelta(days=3)).isoformat())
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    body = _body(bars_fetch._get_bars_to_response("FLOOR", "15", ASK, TO))
    assert not body.get("filling") and len(body["bars"]) == 520


def test_rounds_used_up_while_short_prove_nothing(store, monkeypatch):
    # every round answers ONE far-off bar (never empty, never reaching the ask): the rounds run out
    _put("ROUNDS", _sessions(END, 20))
    calls = []

    def one_bar(t, tf, f, to, raise_errors=False):
        calls.append((f, to))
        d = _dt.date.fromisoformat(f)
        return [{"t": _et(d, 10, 0), "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1}]
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", one_bar)
    r = bars_fetch._get_bars_to_response("ROUNDS", "15", ASK, TO)
    assert len(calls) == bars_fetch._TO_FILL_MAX_ROUNDS, calls
    _assert_flagged_short(r, 520 + len(calls))      # the proven spans keep each round's one bar in the run


def test_a_window_proven_for_a_smaller_ask_does_not_prove_a_larger_one_in_the_same_tier(store, monkeypatch):
    days = _sessions(END, 80)
    _put("TIER", days[-40:])                                    # 1,040 rows: holds an ask of 1,000
    calls = []

    def provider(t, tf, f, to, raise_errors=False):
        calls.append((f, to))
        return [b for d in days if f <= d.isoformat() <= to for b in _rth(d)]
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", provider)
    cache.set(f"towin_TIER_15_{TO}_{bars_fetch._depth_tier(1100)}", {"n": 1000, "final": False}, ttl=600)
    r = bars_fetch._get_bars_to_response("TIER", "15", 1100, TO)   # same depth tier (1,200)
    body = _body(r)
    assert calls, "a marker proven for 1,000 rows was read as proof for 1,100"
    assert len(body["bars"]) == 1100 and not body.get("filling")


# ── review of #3011, LOAD: a window fetch that just failed is not re-run per re-poll ────────────────────────────────

def test_re_polls_inside_the_failure_window_answer_from_the_store_without_a_fetch(store, monkeypatch):
    _put("RELOAD", _sessions(END, 20))
    calls = []

    def boom(*a, **k):
        calls.append(1)
        raise RuntimeError("provider 500")
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", boom)
    for _ in range(3):
        _assert_flagged_short(bars_fetch._get_bars_to_response("RELOAD", "15", ASK, TO), 520)
    assert len(calls) == 1, calls


# ── review of #3011, F2 round 2: a RECENT listing is proven by its DAILY series' first bar ────────────────────────────
# ⛔⛔ The empty rounds grow only x2 from density, so a recent listing's two empty rounds span ~60 days, never 400:
# without the daily fact the window answered `filling` forever (the client re-asks every 3 s, the symbol handoff waits
# its 4 s hang on every switch, and the provider is asked again every 20 s), and a scroll-back past the listing's
# start answered the warming 503 forever.
def test_a_30_session_listing_at_a_date_ends_proven(store, monkeypatch):
    days = _sessions(END, 30)
    _put("IPO30", days)                                      # 780 of 1,000: the series starts 30 sessions back
    calls = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda t, tf, f, to, raise_errors=False: calls.append(f) or [])
    # the provider's daily holds the listing's own sessions and nothing before them
    monkeypatch.setattr(massive, "get_agg_bars", lambda t, frm, to: [
        {"t": _et(d, 0, 0) * 1000, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1}
        for d in days if frm <= d.isoformat() <= to])
    r = bars_fetch._get_bars_to_response("IPO30", "15", ASK, TO)
    body = _body(r)
    assert not body.get("filling") and not body.get("short") and len(body["bars"]) == 780, body.get("filling")
    assert r.headers.get("cache-control") == "public, max-age=3600"
    n = len(calls)
    assert not _body(bars_fetch._get_bars_to_response("IPO30", "15", ASK, TO)).get("filling")
    assert len(calls) == n, "a proven listing asked the provider again"


def test_a_scroll_back_before_the_listing_answers_no_data(store, monkeypatch):
    # the series lists AFTER the cutoff: nothing intraday at or before it, and no daily bar either
    bars_sqlite.put_bars("IPOB", "15", [b for d in _sessions(_dt.date(2016, 8, 31), 20) for b in _rth(d)])
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    monkeypatch.setattr(massive, "get_agg_bars", lambda *a, **k: [])
    r = bars_fetch._get_bars_to_response("IPOB", "15", ASK, TO)
    body = _body(r)
    assert r.status_code == 200 and body.get("no_data") is True and body["bars"] == [], (r.status_code, body)


def test_a_daily_that_traded_before_the_window_keeps_it_unproven(store, monkeypatch):
    # control: the stored DAILY holds a session before the intraday run, so the empty rounds are a gap
    days = _sessions(END, 20)
    _put("DTRADED", days)
    bars_sqlite.put_bars("DTRADED", "D", [{"t": (days[0] - _dt.timedelta(days=30)).isoformat(),
                                           "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1}], date_tf=True)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])
    monkeypatch.setattr(massive, "get_agg_bars", lambda *a, **k: [])
    _assert_flagged_short(bars_fetch._get_bars_to_response("DTRADED", "15", ASK, TO), 520)


def test_a_provider_fault_on_the_daily_proves_nothing(store, monkeypatch):
    _put("DFAULT", _sessions(END, 20))
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", lambda *a, **k: [])

    def faulted(*a, **k):
        provider_fault_scope.note(RuntimeError("daily agg 503"))
        return []
    monkeypatch.setattr(massive, "get_agg_bars", faulted)
    _assert_flagged_short(bars_fetch._get_bars_to_response("DFAULT", "15", ASK, TO), 520)
