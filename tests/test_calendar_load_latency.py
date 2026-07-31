"""The Calendar tab took 6-8s to open. Two independent defects, both pinned here.

Measured on prod 2026-07-31, polling `/api/calendar` every 20s for 13 minutes:

    07:50:02   4.51s   <- cold
    08:00:18   7.97s   <- cold, exactly ~10 min later
    (38 others) 0.12s

1. COLD-CACHE STALL. `_CACHE_TTL = 600` is a HARD clock: `TTLCache.get()` only
   does `move_to_end` for LRU, it never extends `expires_at`. So the entry dies
   600s after it was WRITTEN no matter how much traffic the page has — polling
   every 20s still went cold at 08:00. Whoever clicks next pays the whole
   multi-provider rebuild (EW + Finviz + Finnhub backfill + Finnhub actuals +
   ForexFactory + names) while `Calendar.jsx` shows a skeleton, because the page
   body is gated on `if (!data)`. Raising the TTL only makes the stall rarer and
   the data staler; it cannot remove it. The fix is to never let a USER be the
   one who rebuilds: serve the last good payload and refresh behind them, the
   same shape as `engine.get_news()`.

   The current-week path also had NO single-flight lock (range weeks and past
   reactions both do), so N concurrent cold clicks each fired their own full
   rebuild.

2. `date` SHADOWING -> 500. `get_reactions(date: str | None)` shadows the
   module's `from datetime import date`, so `date.fromisoformat(target)` runs on
   a str and raises `AttributeError: 'str' object has no attribute
   'fromisoformat'`. Live since d9b77556 (2026-07-09): EVERY past-date reactions
   request 500s, so Mon-Wed silently lost their post-print reaction %. Today
   worked, which is why it went unnoticed.
"""
import threading
import time
from datetime import date, timedelta
from unittest import mock

from fastapi.testclient import TestClient

from api.main import app
from api.routers import calendar as cal
from api.services.serve_stale import ServeStale

# raise_server_exceptions=False so an unhandled error surfaces as the 500 a real
# browser would get, instead of blowing up inside the test client.
client = TestClient(app, raise_server_exceptions=False)


def _past_weekday(days_back: int = 7) -> str:
    """A weekday strictly before today ET (weekend dates take other branches)."""
    d = cal._today_et() - timedelta(days=days_back)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _day(*syms):
    return {"bmo": [{"sym": s, "eps_act": 1.0} for s in syms], "amc": [], "tbd": []}


# ── Defect 2: past-date reactions 500 ─────────────────────────────────────────

def test_past_date_reactions_does_not_500():
    """The exact request the Calendar board makes for Mon/Tue/Wed."""
    past = _past_weekday()
    cal.cache.invalidate(f"calendar_reactions_{past}")
    with mock.patch.object(cal, "_days_for_date", return_value=_day("AAPL")), \
         mock.patch.object(cal, "_past_reactions", return_value={"AAPL": 2.5}):
        r = client.get(f"/api/calendar/reactions?date={past}")
    assert r.status_code == 200, f"past-date reactions 500ed: {r.text}"
    assert r.json() == {"AAPL": 2.5}


def test_reactions_still_accepts_the_public_date_param():
    """`?date=` is the published contract (frontend + ics). Renaming the Python
    arg must not rename the query param."""
    today = cal._today_et().isoformat()
    cal.cache.invalidate(f"calendar_reactions_{today}")
    with mock.patch.object(cal, "_days_for_date", return_value={"bmo": [], "amc": [], "tbd": []}):
        r = client.get(f"/api/calendar/reactions?date={today}")
    assert r.status_code == 200


# ── Defect 1: the serve-stale unit ────────────────────────────────────────────

class _Builder:
    """A stand-in for the 4.5-8s multi-provider rebuild."""

    def __init__(self, value="BUILT", block: threading.Event | None = None):
        self.value = value
        self.calls = 0
        self.entered = threading.Event()
        self.block = block

    def __call__(self):
        self.calls += 1
        self.entered.set()
        if self.block is not None:
            self.block.wait(timeout=5)
        return self.value


def _good(v):
    return bool(v)


def test_fresh_cache_never_builds():
    ss = ServeStale("t", max_age_seconds=1800)
    b = _Builder()
    assert ss.serve("k", fresh=lambda: "FRESH", build=b, good=_good) == "FRESH"
    assert b.calls == 0


def test_expired_cache_serves_stale_without_blocking_the_user():
    """THE FIX. The TTL lapsed; this caller must NOT pay the rebuild."""
    ss = ServeStale("t", max_age_seconds=1800)
    ss.remember("k", "LAST_GOOD")

    gate = threading.Event()               # the background build hangs here
    b = _Builder(value="REBUILT", block=gate)

    got = ss.serve("k", fresh=lambda: None, build=b, good=_good)
    assert got == "LAST_GOOD", "user was served the rebuild instead of the stale copy"

    # It refreshed BEHIND us: the build is running but we already returned.
    assert b.entered.wait(timeout=5), "no background refresh was kicked"
    gate.set()


def test_stale_older_than_max_age_is_refused():
    """Bounded: a persistently-failing refresh must not pin users to old data."""
    ss = ServeStale("t", max_age_seconds=60)
    ss.remember("k", "ANCIENT")
    with ss._lock:                          # backdate the slot past the bound
        ss._slots["k"] = ("ANCIENT", time.time() - 3600)

    b = _Builder(value="REBUILT")
    got = ss.serve("k", fresh=lambda: None, build=b, good=_good)
    assert got == "REBUILT"
    assert b.calls == 1


def test_a_bad_payload_never_becomes_the_stale_fallback():
    """An empty/error rebuild must not become what every user sees next window."""
    ss = ServeStale("t", max_age_seconds=1800)
    b = _Builder(value=[])                 # falsy == not good
    assert ss.serve("k", fresh=lambda: None, build=b, good=_good) == []
    assert ss.peek("k") == (None, None), "a bad payload was remembered"


def test_concurrent_cold_callers_collapse_onto_one_build():
    """No single-flight lock = N cold clicks each fan out to every provider."""
    ss = ServeStale("t", max_age_seconds=1800)
    gate = threading.Event()
    b = _Builder(value="REBUILT", block=gate)

    results, threads = [], []
    for _ in range(8):
        t = threading.Thread(
            target=lambda: results.append(
                ss.serve("k", fresh=lambda: None, build=b, good=_good)))
        threads.append(t)
        t.start()

    assert b.entered.wait(timeout=5)
    time.sleep(0.2)                        # let the others pile onto the lock
    gate.set()
    for t in threads:
        t.join(timeout=10)

    assert results == ["REBUILT"] * 8
    assert b.calls == 1, f"herd fired {b.calls} rebuilds instead of 1"


# ── Defect 1, at the endpoint: the actual reported symptom ────────────────────

def _week(sym="AAPL"):
    return {
        "week_start": "2026-07-27", "week_end": "2026-07-31", "source": "live",
        "is_current_week": True,
        "days": {"2026-07-27": {"bmo": [{"sym": sym}], "amc": [], "tbd": [], "econ": []}},
    }


def test_calendar_click_after_ttl_expiry_does_not_wait_for_the_rebuild():
    """THE BUG: /api/calendar's TTL lapses every 10 min on a hard clock and the
    next click pays the whole 4.5-8s provider rebuild behind a skeleton."""
    served = _week("AAPL")
    cal._WEEKLY_STALE.remember("current", served)
    cal.cache.invalidate("calendar_weekly")           # the TTL just lapsed

    gate = threading.Event()                          # stands in for 4.5-8s of providers
    entered = threading.Event()

    def _slow_rebuild():
        entered.set()
        gate.wait(timeout=5)
        return _week("REBUILT")

    try:
        with mock.patch.object(cal, "_build_current_week", side_effect=_slow_rebuild):
            r = client.get("/api/calendar")
            assert r.status_code == 200
            assert r.json() == served, "the user waited for the rebuild instead of being served"
            assert entered.wait(timeout=5), "no background refresh was kicked"
    finally:
        gate.set()


def test_slots_are_bounded_so_arbitrary_dates_cannot_grow_them_forever():
    """The enrichment slot is keyed by the caller-supplied ?date=."""
    ss = ServeStale("t", max_age_seconds=1800, max_keys=8)
    for i in range(200):
        ss.serve(f"k{i}", fresh=lambda: None, build=lambda: "V", good=_good)
    assert len(ss._slots) <= 8, len(ss._slots)
    assert len(ss._build_locks) <= 8, len(ss._build_locks)


def test_pruning_never_drops_a_build_lock_someone_is_holding():
    """Evicting a held lock would let a second thread build the same key,
    silently undoing single-flight."""
    ss = ServeStale("t", max_age_seconds=1800, max_keys=2)
    held = ss._build_lock("hot")
    held.acquire()
    try:
        for i in range(50):
            ss.serve(f"k{i}", fresh=lambda: None, build=lambda: "V", good=_good)
        assert ss._build_locks.get("hot") is held, "a HELD build lock was evicted"
    finally:
        held.release()


def test_enrichment_after_ttl_expiry_does_not_wait_for_the_provider_fanout():
    """Same defect on the overlay: _ENRICH_TTL is 300s on a hard clock over a
    ~24s fan-out, and the week is requested as one batch."""
    ds = "2026-07-30"
    served = {"AAPL": {"expected_move": 4.2, "beat_history": None, "hist_stats": None}}
    cal._ENRICH_STALE.remember(ds, served)
    cal.cache.invalidate(f"calendar_enrichment_{ds}")

    gate, entered = threading.Event(), threading.Event()

    def _slow_fanout(_target):
        entered.set()
        gate.wait(timeout=5)
        return {"REBUILT": {}}

    try:
        with mock.patch.object(cal, "_build_enrichment_for_date", side_effect=_slow_fanout):
            assert cal._compute_enrichment_for_date(ds) == served
            assert entered.wait(timeout=5), "no background refresh was kicked"
    finally:
        gate.set()


def test_an_empty_enrichment_is_never_remembered():
    """Every `{}` the builder returns is a cheap early exit. Remembering one
    would pin a day that genuinely has reporters behind a blank overlay."""
    ds = "2026-07-29"
    cal._ENRICH_STALE.forget(ds)
    cal.cache.invalidate(f"calendar_enrichment_{ds}")
    with mock.patch.object(cal, "_build_enrichment_for_date", return_value={}):
        assert cal._compute_enrichment_for_date(ds) == {}
    assert cal._ENRICH_STALE.peek(ds) == (None, None)


def test_an_empty_week_never_becomes_the_served_fallback():
    """A trading week with zero reporters is always a provider failure, so it
    must not become what every user sees for the next window."""
    empty = {"week_start": "2026-07-27", "week_end": "2026-07-31", "source": "live",
             "is_current_week": True,
             "days": {"2026-07-27": {"bmo": [], "amc": [], "tbd": [], "econ": []}}}
    assert cal._weekly_payload_is_good(empty) is False
    assert cal._weekly_payload_is_good(_week()) is True
    for bad_source in ("empty", "error", "out_of_range"):
        assert cal._weekly_payload_is_good({**_week(), "source": bad_source}) is False
