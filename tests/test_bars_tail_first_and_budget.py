"""Intraday first answers reach the live bucket, fast, and never outlive the edge.

2026-11-10 RTH, measured on production:
  * SOFI 1m first answer carried NO bars from today (`delta-deadline`, 2.5 s);
  * ONON 15m first answer was 4 h stale (`stale-swr`);
  * liquid 1m opens sat ~2.7 s in `sd-deadline` while the data was current;
  * UPST 60m bars=2000 served a tail 4 h behind while bars=600 was current.

Root causes these rails pin:
  1. the request-path repair fetched the FULL gap-fill window (2d of 1m, 5d of 5m,
     14d of 15/30/60) instead of only the missing tail  -> TAIL-FIRST window;
  2. a PARTIAL-depth key skipped the tail repair (stale-swr) and the deep branch ran
     only the deep fetch                               -> tail repair runs for both;
  3. waiters (8 s / 12 s / 30 s) and D/W/M / replay fetches had no ceiling under the
     edge's 8 s abort                                   -> one per-request budget.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bars_fetch
from api.routers import bars as bars_router

_ET = ZoneInfo("America/New_York")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_tail_verified", {})
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    monkeypatch.setattr(bars_fetch, "_tail_gapfill_at", {}, raising=False)
    bars_fetch.set_request_interactive(False)
    getattr(bars_fetch, "end_request_budget", lambda: None)()
    yield
    bars_fetch.set_request_interactive(False)
    getattr(bars_fetch, "end_request_budget", lambda: None)()


# ── 1. tail-first window ─────────────────────────────────────────────────────

class _Client:
    _api_key = "FAKE"


def _capture_urls(monkeypatch):
    urls = []
    monkeypatch.setattr(bars_fetch, "_get_client", lambda: _Client())
    monkeypatch.setattr(bars_fetch, "_paginate_massive_aggs",
                        lambda client, url: urls.append(url) or [])
    reads = []
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_since",
                        lambda s, tf, since: reads.append(since) or [])
    return urls, reads


def _from_date(url: str) -> str:
    # .../range/{m}/minute/{from}/{to}?...
    return url.split("/minute/")[1].split("/")[0]


@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60"])
def test_tail_only_window_starts_at_the_stored_tails_session(monkeypatch, tf):
    urls, reads = _capture_urls(monkeypatch)
    last_ts = int(time.time()) - 3600
    st = {}
    bars_fetch._delta_intraday("SOFI", tf, last_ts, status=st, tail_only=True)
    want = datetime.fromtimestamp(last_ts, _ET).strftime("%Y-%m-%d")
    assert _from_date(urls[0]) == want, "tail-only must fetch just the missing tail"
    assert reads == [], "tail-only must not scan for interior holes on the request path"
    assert st.get("ok") is True


@pytest.mark.parametrize("tf,min_days", [("1", 2), ("5", 5), ("15", 14)])
def test_CONTROL_the_full_window_reaches_back_the_gapfill_span(monkeypatch, tf, min_days):
    urls, _ = _capture_urls(monkeypatch)
    last_ts = int(time.time()) - 3600
    bars_fetch._delta_intraday("SOFI", tf, last_ts)
    span = (datetime.utcnow().date() - datetime.strptime(_from_date(urls[0]), "%Y-%m-%d").date()).days
    assert span >= min_days


def test_tail_only_still_covers_a_whole_missing_session(monkeypatch):
    urls, _ = _capture_urls(monkeypatch)
    last_ts = int(time.time()) - 3 * 86400
    bars_fetch._delta_intraday("SOFI", "1", last_ts, tail_only=True)
    want = datetime.fromtimestamp(last_ts, _ET).strftime("%Y-%m-%d")
    assert _from_date(urls[0]) == want, "the gap between the tail and now must be fetched"


def test_bounded_delta_runs_tail_only_then_kicks_the_background_gapfill(monkeypatch):
    seen = {}
    kicked = threading.Event()
    monkeypatch.setattr(bars_fetch, "_delta_intraday",
                        lambda t, tf, lt, status=None, tail_only=False: seen.update(tail_only=tail_only) or [])
    monkeypatch.setattr(bars_fetch, "_kick_tail_gapfill", lambda t, tf: kicked.set())
    assert bars_fetch._bounded_delta("SOFI", "1", int(time.time()) - 120, False) is True
    assert seen["tail_only"] is True
    assert kicked.wait(1.0), "the interior gap-fill must follow in the background"


def _gapfill_free_slots() -> int:
    got = 0
    while bars_fetch._tail_gapfill_sem.acquire(blocking=False):
        got += 1
    for _ in range(got):
        bars_fetch._tail_gapfill_sem.release()
    return got


def _until(pred, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False


@pytest.fixture
def gapfill(monkeypatch):
    # the kick is a pytest no-op; opt in for these tests only
    monkeypatch.setattr(bars_fetch, "_gapfill_disabled_in_tests", lambda: False)
    monkeypatch.setattr(bars_fetch, "_tail_gapfill_pending", {})
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: int(time.time()) - 60)
    calls = []

    def _heal(t, tf, lt, tail_only=False):
        calls.append((t, tail_only))
        if _heal.ok:                       # the provider answered -> verified
            bars_fetch._mark_tail_verified(t, tf, time.time() + 1)
        return []
    _heal.ok = True
    monkeypatch.setattr(bars_fetch, "_heal_intraday_tail", _heal)
    yield _heal, calls
    assert _until(lambda: _gapfill_free_slots() == bars_fetch._TAIL_GAPFILL_MAX)


def test_gapfill_runs_the_full_window_and_a_success_earns_the_cooldown(gapfill):
    heal, calls = gapfill
    assert bars_fetch._kick_tail_gapfill("SOFI", "1") is True
    assert _until(lambda: _gapfill_free_slots() == bars_fetch._TAIL_GAPFILL_MAX)
    assert calls == [("SOFI", False)], "the background pass is the FULL (gap-fill) window"
    assert bars_fetch._kick_tail_gapfill("SOFI", "1") is False, "once per cooldown after success"


def test_a_FAILED_gapfill_is_not_locked_out_for_the_full_cooldown(gapfill, monkeypatch):
    heal, calls = gapfill
    heal.ok = False                                    # provider did not answer
    monkeypatch.setattr(bars_fetch, "_TAIL_GAPFILL_RETRY_S", 0.0)
    assert bars_fetch._kick_tail_gapfill("SOFI", "1") is True
    assert _until(lambda: _gapfill_free_slots() == bars_fetch._TAIL_GAPFILL_MAX)
    assert bars_fetch._kick_tail_gapfill("SOFI", "1") is True, "a failure may retry soon"


def test_gapfill_has_its_own_pool_and_never_takes_a_bg_delta_slot(gapfill):
    n = _saturate(bars_fetch._bg_delta_sem)
    try:
        assert bars_fetch._kick_tail_gapfill("SOFI", "5") is True, \
            "a busy depth/SWR pool must not block (or be drained by) the gap-fill"
        assert _until(lambda: _gapfill_free_slots() == bars_fetch._TAIL_GAPFILL_MAX)
    finally:
        _release(bars_fetch._bg_delta_sem, n)


def test_a_key_that_finds_the_pool_full_is_queued_and_healed_not_dropped(gapfill):
    heal, calls = gapfill
    held = _saturate(bars_fetch._tail_gapfill_sem)
    try:
        assert bars_fetch._kick_tail_gapfill("HOLE", "15") is False
        assert ("HOLE", "15") in bars_fetch._tail_gapfill_pending
        bars_fetch._tail_gapfill_sem.release()          # one slot frees
        held -= 1
        assert bars_fetch._kick_tail_gapfill("OTHER", "15") is True
        assert _until(lambda: ("HOLE", False) in calls), \
            "the queued key (yesterday's holes) must be healed by the next runner"
    finally:
        _release(bars_fetch._tail_gapfill_sem, held)


# ── 2. partial / deep keys still get their tail ──────────────────────────────

class _Store:
    def __init__(self, rows):
        self.rows = list(rows)

    def get_last_ts(self, s, tf):
        return self.rows[-1][0] if self.rows else None

    def get_bars(self, s, tf, n):
        return self.rows[-n:]

    def get_bars_since(self, s, tf, since):
        return [r for r in self.rows if r[0] > since]

    def put_bars(self, s, tf, new, date_tf=False):
        have = {r[0] for r in self.rows}
        for b in new:
            if b["t"] not in have:
                self.rows.append((b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]))
        self.rows.sort()


def _fmt(rows, tf, ticker=None):
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


STEP = 900
OLD_TAIL = (int(time.time()) // STEP) * STEP - 4 * 3600          # 4 h behind
NEW_TAIL = (int(time.time()) // STEP) * STEP - STEP


@pytest.fixture
def onon(monkeypatch):
    """ONON 15m: a SHORT store (partial depth vs the ask), tail 4 h behind."""
    store = _Store([(OLD_TAIL - STEP * i, 1.0, 1.0, 1.0, 1.0, 1) for i in range(40)][::-1])
    mem, ttls = {}, {}
    for name in ("get_last_ts", "get_bars", "get_bars_since", "put_bars"):
        monkeypatch.setattr(bars_fetch._sqlite, name, getattr(store, name))
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: mem.get(k))
    monkeypatch.setattr(bars_fetch.cache, "set",
                        lambda k, v, ttl=None: (mem.__setitem__(k, v), ttls.__setitem__(k, ttl)))
    monkeypatch.setattr(bars_fetch.cache, "invalidate", lambda k: mem.pop(k, None))
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", _fmt)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf, *_a: False)
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf, ticker=None: True)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda tf, ts, now=None: False)
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    monkeypatch.setattr(bars_fetch, "_kick_tail_gapfill", lambda *a, **k: False, raising=False)
    monkeypatch.delenv("BARS_INTRADAY_ASYNC_HEAL", raising=False)
    monkeypatch.setattr(bars_router, "_is_carried", lambda t: True)

    def _tail_delta(t, tf, lt, status=None, tail_only=False):
        if status is not None:
            status["ok"] = True
        return [{"t": lt + STEP * (i + 1), "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}
                for i in range((NEW_TAIL - lt) // STEP)]
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _tail_delta)
    return {"store": store, "mem": mem, "ttls": ttls}


def _saturate(sem):
    n = 0
    while sem.acquire(blocking=False):
        n += 1
    return n


def _release(sem, n):
    for _ in range(n):
        sem.release()


def test_ONON_partial_key_first_answer_reaches_the_live_bucket(onon):
    # Background pool full: the depth fetch cannot start, the interactive reserve
    # still repairs the tail.
    n = _saturate(bars_fetch._bg_delta_sem)
    try:
        bars_fetch.set_request_interactive(True)
        resp = bars_fetch._get_bars_inner("ONON", "15", 600)   # 40 stored < 0.9*600 -> partial
    finally:
        _release(bars_fetch._bg_delta_sem, n)
    body = orjson.loads(resp.body)
    assert body["bars"][-1]["t"] == NEW_TAIL, "partial depth must not leave the tail 4 h behind"
    assert bars_fetch.get_serve_layer() == "sd-partial"


def test_deep_partial_key_repairs_the_tail_even_when_the_deep_fetch_is_shed(onon, monkeypatch):
    monkeypatch.setattr(bars_fetch, "_start_bounded_fetch_intraday", lambda *a, **k: None)
    bars_fetch.set_request_interactive(True)
    resp = bars_fetch._get_bars_inner("UPST", "15", 2000)        # deep + partial
    body = orjson.loads(resp.body)
    assert body["bars"][-1]["t"] == NEW_TAIL
    assert onon["ttls"]["bars_UPST_15_2000"] == 5, "a shed deep fetch must not pin for a full TTL"
    assert bars_fetch.get_serve_layer() == "deep-deadline"


# ── 3. the request budget ────────────────────────────────────────────────────

def test_budget_can_never_be_configured_past_the_edge_abort(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_REQUEST_BUDGET_SECONDS", 30.0)
    bars_fetch.start_request_budget()
    assert bars_fetch._budget_cap() <= bars_fetch._EDGE_ABORT_SECONDS - 1.0
    assert bars_fetch._bounded_wait(30) <= 7.0


def test_budget_is_shared_across_waits(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_REQUEST_BUDGET_SECONDS", 0.4)
    bars_fetch.start_request_budget()
    time.sleep(0.25)
    assert bars_fetch._bounded_wait(5.0) <= 0.16
    time.sleep(0.2)
    assert bars_fetch._bounded_wait(5.0) == 0.0


def _slow_store_rows(monkeypatch, tf="5"):
    tail = int(time.time()) - 1800
    store = _Store([(tail - 300 * i, 1.0, 1.0, 1.0, 1.0, 1) for i in range(40)][::-1])
    for name in ("get_last_ts", "get_bars", "put_bars", "get_bars_since"):
        monkeypatch.setattr(bars_fetch._sqlite, name, getattr(store, name))
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", _fmt)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf, ticker=None: True)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda tf, ts, now=None: False)
    monkeypatch.delenv("BARS_INTRADAY_ASYNC_HEAL", raising=False)


def test_same_session_WAITER_is_bounded_not_8s(monkeypatch):
    _slow_store_rows(monkeypatch)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf, *_a: True)
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)
    bars_fetch._inflight["bars_AVGO_5_20"] = threading.Event()        # a peer that never lands
    bars_fetch.start_request_budget()
    t0 = time.perf_counter()
    resp = bars_fetch._get_bars_inner("AVGO", "5", 20)
    assert time.perf_counter() - t0 < 1.5
    assert resp.status_code == 200


def test_deep_WAITER_is_bounded_not_12s(monkeypatch):
    _slow_store_rows(monkeypatch)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf, *_a: False)
    monkeypatch.setattr(bars_fetch, "_DEEP_DEADLINE_SECONDS", 0.3)
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)
    monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda *a, **k: [])
    monkeypatch.setattr(bars_fetch, "_kick_tail_gapfill", lambda *a, **k: False, raising=False)
    bars_fetch._inflight["bars_AVGO_5_2000"] = threading.Event()
    n = _saturate(bars_fetch._bg_delta_sem)                             # no bg depth thread
    bars_fetch.start_request_budget()
    try:
        t0 = time.perf_counter()
        resp = bars_fetch._get_bars_inner("AVGO", "5", 2000)
        elapsed = time.perf_counter() - t0
    finally:
        _release(bars_fetch._bg_delta_sem, n)
    assert elapsed < 2.0, f"deep waiter held the request {elapsed:.2f}s"
    assert resp.status_code == 200


def test_request_budget_caps_a_tail_repair_below_its_own_deadline(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_REQUEST_BUDGET_SECONDS", 0.2)
    monkeypatch.setattr(bars_fetch, "_delta_intraday",
                        lambda *a, **k: time.sleep(2.0) or [])
    monkeypatch.setattr(bars_fetch, "_kick_tail_gapfill", lambda *a, **k: False, raising=False)
    bars_fetch.start_request_budget()
    t0 = time.perf_counter()
    assert bars_fetch._bounded_delta("AVGO", "5", int(time.time()) - 600, False, deadline=5.0) is False
    assert time.perf_counter() - t0 < 0.6


def test_daily_delta_has_a_ceiling_and_still_persists(monkeypatch):
    landed = threading.Event()
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_DEADLINE_SECONDS", 0.2)
    monkeypatch.setattr(bars_fetch, "_delta_daily",
                        lambda t, lt: time.sleep(0.6) or [{"t": "2026-11-10"}])
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: landed.set())
    bars_fetch.start_request_budget()
    t0 = time.perf_counter()
    assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is False
    assert time.perf_counter() - t0 < 0.5
    assert landed.wait(2.0), "a shed daily delta still lands for the next poll"


def test_CONTROL_a_fast_daily_delta_completes(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda t, lt: [])
    assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is True


def test_replay_cold_intraday_fetch_is_bounded_and_sheds_as_warming(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_DEEP_DEADLINE_SECONDS", 0.3)
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_before", lambda *a, **k: [])
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_replay_effective_symbol", lambda t, d: t)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda *a, **k: time.sleep(1.5) or [])
    bars_fetch.start_request_budget()
    t0 = time.perf_counter()
    resp = bars_fetch._get_bars_to_response("ZZRP", "5", 500, "2026-10-01")
    elapsed = time.perf_counter() - t0
    assert elapsed < 1.2, f"replay held the request {elapsed:.2f}s"
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "3"
    assert resp.headers.get("X-Bars-Shed") == "warming"
    time.sleep(1.4)   # let the background job finish and release its slot


def test_router_starts_and_clears_the_budget(monkeypatch):
    seen = {}

    def _impl(*a, **k):
        seen["t0"] = getattr(bars_fetch._req_ctx, "budget_t0", None)
        return bars_router.JSONResponse(content={})
    monkeypatch.setattr(bars_router, "_serve_bars_impl", _impl)
    bars_router.serve_bars_http("AAPL", "5", 10)
    assert seen["t0"] is not None
    assert getattr(bars_fetch._req_ctx, "budget_t0", None) is None


# ── review fixes F1/F3/F4/F5/F6 ──────────────────────────────────────────────

def _era_rows():
    old = int(datetime(2012, 6, 1, 15, 0, tzinfo=_ET).timestamp())
    return [(old - 300 * i, 1.0, 1.0, 1.0, 1.0, 1) for i in range(50)][::-1]


def _replay_env(monkeypatch, rows, fetch):
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars_before", lambda *a, **k: rows)
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_replay_effective_symbol", lambda t, d: t)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", _fmt)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", fetch)


def test_F1_replay_older_era_in_store_sheds_while_the_window_is_landing(monkeypatch):
    """Store holds 2012 bars; replay asks for a 2015 cutoff; the window fetch overruns
    the budget -> must NOT serve the 2012 rows as a 1 h answer."""
    monkeypatch.setattr(bars_fetch, "_DEEP_DEADLINE_SECONDS", 0.3)
    _replay_env(monkeypatch, _era_rows(), lambda *a, **k: time.sleep(1.0) or [])
    bars_fetch.start_request_budget()
    resp = bars_fetch._get_bars_to_response("ZZERA", "5", 500, "2015-03-02")
    assert resp.status_code == 503
    assert resp.headers.get("X-Bars-Shed") == "warming"
    assert _until(lambda: not any(k.startswith("replayto::ZZERA") for k in bars_fetch._inflight))


def test_F1_CONTROL_a_finished_fetch_that_never_reached_the_window_is_not_pinned(monkeypatch):
    _replay_env(monkeypatch, _era_rows(), lambda *a, **k: [])
    resp = bars_fetch._get_bars_to_response("ZZERA2", "5", 500, "2015-03-02")
    assert resp.status_code == 200
    assert resp.headers.get("Cache-Control") == "public, max-age=30"


def test_F3_interactive_daily_waits_briefly_for_a_slot_instead_of_shedding(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda t, lt: [])
    n = _saturate(bars_fetch._date_delta_sem)
    bars_fetch.set_request_interactive(True)
    bars_fetch.start_request_budget()
    threading.Timer(0.2, bars_fetch._date_delta_sem.release).start()
    try:
        assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is True
    finally:
        _release(bars_fetch._date_delta_sem, n - 1)


def test_F3_warm_daily_cannot_take_the_interactive_share(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda t, lt: [])
    assert bars_fetch._DATE_DELTA_WARM_MAX <= bars_fetch._DATE_DELTA_MAX - 2
    n = _saturate(bars_fetch._date_delta_warm_sem)
    bars_fetch.start_request_budget()
    try:
        bars_fetch.set_request_interactive(False)
        assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is False, \
            "warm traffic past its share must shed, leaving slots for clicks"
        bars_fetch.set_request_interactive(True)
        assert bars_fetch._bounded_date_delta("AAPL", "D", 20261109) is True
    finally:
        _release(bars_fetch._date_delta_warm_sem, n)


def test_F3_in_process_callers_do_not_get_the_edge_budget(monkeypatch):
    """seasonality / cot_prewarm / data_exports call serve_bars in-process: the D/W/M
    delta stays blocking for them (no 6 s give-up)."""
    monkeypatch.setattr(bars_fetch, "_DATE_DELTA_DEADLINE_SECONDS", 0.1)
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda t, lt: time.sleep(0.4) or [])
    seen = {}

    def _impl(*a, **k):
        seen["active"] = bars_fetch._budget_active()
        seen["done"] = bars_fetch._bounded_date_delta("AAPL", "D", 20261109)
        return bars_router.JSONResponse(content={})
    monkeypatch.setattr(bars_router, "_serve_bars_impl", _impl)
    bars_router.serve_bars("AAPL", "D", 10)                 # in-process: no edge_budget
    assert seen == {"active": False, "done": True}


def test_F3_http_routes_start_the_edge_budget():
    import inspect
    from api import bars_api_main
    assert "serve_bars_http(ticker" in inspect.getsource(bars_api_main)
    assert "run_in_threadpool(serve_bars_http," in inspect.getsource(bars_router.get_bars)


def test_F4_replay_deep_DWM_pulls_share_the_replay_concurrency_cap():
    ran = []
    n = _saturate(bars_fetch._replay_cold_sem)
    bars_fetch.start_request_budget()
    try:
        ok = bars_fetch._bounded_job("replayto-deep::X::D", lambda: ran.append(1), 0.2,
                                     sem=bars_fetch._replay_cold_sem)
    finally:
        _release(bars_fetch._replay_cold_sem, n)
    assert ok is False and ran == [], "no slot -> no extra unbounded daemon pull"
    assert "replayto-deep::X::D" not in bars_fetch._inflight


def test_F5_deep_branch_runs_tail_and_depth_in_parallel(onon, monkeypatch):
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 1.5)
    monkeypatch.setattr(bars_fetch, "_DEEP_DEADLINE_SECONDS", 1.5)
    real_tail = bars_fetch._delta_intraday

    def _slow_tail(*a, **k):
        time.sleep(0.6)
        return real_tail(*a, **k)
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _slow_tail)

    def _start_deep(t, tf, bars):
        ev = threading.Event()
        threading.Timer(0.6, ev.set).start()
        return ev
    monkeypatch.setattr(bars_fetch, "_start_bounded_fetch_intraday", _start_deep)
    bars_fetch.set_request_interactive(True)
    t0 = time.perf_counter()
    resp = bars_fetch._get_bars_inner("PAR", "15", 2000)
    elapsed = time.perf_counter() - t0
    assert elapsed < 1.0, f"tail + depth ran serially ({elapsed:.2f}s)"
    assert orjson.loads(resp.body)["bars"][-1]["t"] == NEW_TAIL


def test_F6_tier_proxy_forwards_retry_after_and_shed_tag(monkeypatch):
    import asyncio
    import httpx

    class _C:
        async def get(self, url, **k):
            return httpx.Response(503, content=b'{"bars":[],"error":"warming"}',
                                  headers={"content-type": "application/json",
                                           "retry-after": "3", "x-bars-shed": "warming"})
    monkeypatch.setattr(bars_router, "_bars_proxy_client", _C())
    monkeypatch.setattr(bars_router, "bars_service_headers", lambda: {})
    resp = asyncio.run(bars_router._proxy_bars_to_tier("SOFI", "1", 600, "", "", 0, "http://tier"))
    assert resp.status_code == 503
    assert resp.headers.get("retry-after") == "3"
    assert resp.headers.get("x-bars-shed") == "warming"
