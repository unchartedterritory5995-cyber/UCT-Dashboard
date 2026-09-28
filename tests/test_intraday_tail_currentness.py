"""Intraday tail CURRENTNESS — the server half of the 2026-09-28 stale-success fix.

⛔⛔ THE DEFECT. Monday 2026-09-28 11:35 ET: bars-api KNEW AVGO 5m was a whole session
stale (`_needs_fresh` and `_is_cold_stale_intraday` both True), shed the repair
because every `_bg_delta_sem` slot was held by list pre-warm + D/W/M top-ups, and
answered with Friday's rows as an ordinary 200. Nothing on the wire said "I did not
check", so the chart settled on Friday under a green LIVE badge.

These rails pin four things, each with a control:
  1. the server's expected frontier and its one-bucket tolerance;
  2. `verified_through` comes ONLY from a provider answer that reached SQLite;
  3. every intraday 200 states its currentness, and a shed repair says UNVERIFIED;
  4. an interactive request has capacity background work cannot take, a warm
     prefetch cannot publish unchecked rows into the chart's cache entry, and the
     `_sd_do` repair is bounded.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bars_fetch
from api.routers import bars as bars_router

_ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm, ss=0) -> int:
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=_ET).timestamp())


# The production clock: Monday 2026-09-28 11:33 ET. Friday = 2026-09-25.
MON_1133 = et(2026, 9, 28, 11, 33)
FRI_1955 = et(2026, 9, 25, 19, 55)
FRI_1555 = et(2026, 9, 25, 15, 55)


@pytest.fixture(autouse=True)
def _clean_registry(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_tail_verified", {})
    bars_fetch.set_request_interactive(False)
    yield
    bars_fetch.set_request_interactive(False)


# ── 1. The frontier ──────────────────────────────────────────────────────────

class TestExpectedCompletedBucket:
    def test_avgo_clock_5m_is_the_1125_bucket(self):
        assert bars_fetch.expected_completed_bucket("5", MON_1133) == et(2026, 9, 28, 11, 25)

    @pytest.mark.parametrize("tf,expected", [
        ("1", (11, 32)), ("5", (11, 25)), ("15", (11, 15)), ("30", (11, 0)), ("60", (10, 0)),
    ])
    def test_every_intraday_tf(self, tf, expected):
        assert bars_fetch.expected_completed_bucket(tf, MON_1133) == et(2026, 9, 28, *expected)

    def test_60m_uses_the_irregular_0930_opening_bucket(self):
        # At 10:05 the 09:30-10:00 bar has closed, even though a full hour has not elapsed.
        assert bars_fetch.expected_completed_bucket("60", et(2026, 9, 28, 10, 5)) == et(2026, 9, 28, 9, 30)

    def test_no_expectation_before_the_first_bucket_closes(self):
        assert bars_fetch.expected_completed_bucket("5", et(2026, 9, 28, 9, 32)) is None
        assert bars_fetch.expected_completed_bucket("5", et(2026, 9, 28, 8, 0)) is None   # premarket

    def test_first_bucket_after_it_closes(self):
        assert bars_fetch.expected_completed_bucket("5", et(2026, 9, 28, 9, 35)) == et(2026, 9, 28, 9, 30)

    def test_weekend_and_holiday_have_no_expectation(self):
        assert bars_fetch.expected_completed_bucket("5", et(2026, 9, 27, 12, 0)) is None   # Sunday
        assert bars_fetch.expected_completed_bucket("5", et(2026, 11, 26, 12, 0)) is None  # Thanksgiving

    def test_after_close_is_the_final_bucket(self):
        assert bars_fetch.expected_completed_bucket("5", et(2026, 9, 28, 17, 0)) == et(2026, 9, 28, 15, 55)

    def test_early_close_day_ends_at_1300(self):
        assert bars_fetch.expected_completed_bucket("5", et(2026, 11, 27, 14, 0)) == et(2026, 11, 27, 12, 55)

    def test_daily_is_out_of_scope(self):
        assert bars_fetch.expected_completed_bucket("D", MON_1133) is None


# ── 2/3. Tail status ─────────────────────────────────────────────────────────

class TestTailStatus:
    def test_AVGO_friday_tail_on_monday_is_UNVERIFIED(self):
        st = bars_fetch.intraday_tail_status("AVGO", "5", FRI_1955, now=MON_1133)
        assert st == {"tail_status": "unverified", "verified_through": None}

    @pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60"])
    def test_any_prior_session_tail_mid_session_is_not_current(self, tf):
        for tail in (FRI_1955, FRI_1555):
            assert bars_fetch.intraday_tail_status("AVGO", tf, tail, now=MON_1133)["tail_status"] == "unverified"

    def test_one_bucket_tolerance_is_current(self):
        assert bars_fetch.intraday_tail_status("X", "5", et(2026, 9, 28, 11, 25), now=MON_1133)["tail_status"] == "current"
        assert bars_fetch.intraday_tail_status("X", "5", et(2026, 9, 28, 11, 20), now=MON_1133)["tail_status"] == "current"

    def test_two_buckets_behind_is_not(self):
        assert bars_fetch.intraday_tail_status("X", "5", et(2026, 9, 28, 11, 15), now=MON_1133)["tail_status"] == "unverified"

    def test_provider_verification_after_the_frontier_closed_makes_it_verified(self):
        bars_fetch._mark_tail_verified("THIN", "5", et(2026, 9, 28, 11, 31))
        st = bars_fetch.intraday_tail_status("THIN", "5", et(2026, 9, 28, 10, 0), now=MON_1133)
        assert st["tail_status"] == "verified"
        assert st["verified_through"] == et(2026, 9, 28, 11, 31)

    def test_CONTROL_verification_before_the_frontier_closed_proves_nothing(self):
        # Checked at 11:29 — the 11:25 bucket had not closed yet, so its absence is unproven.
        bars_fetch._mark_tail_verified("THIN", "5", et(2026, 9, 28, 11, 29))
        assert bars_fetch.intraday_tail_status("THIN", "5", et(2026, 9, 28, 10, 0), now=MON_1133)["tail_status"] == "unverified"

    def test_verification_expires_when_the_next_bucket_closes(self):
        bars_fetch._mark_tail_verified("THIN", "5", et(2026, 9, 28, 11, 31))
        later = et(2026, 9, 28, 11, 41)   # frontier is now 11:35 — the 11:31 check predates its close
        assert bars_fetch.intraday_tail_status("THIN", "5", et(2026, 9, 28, 10, 0), now=later)["tail_status"] == "unverified"

    def test_weekend_complete_friday_is_current(self, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260925)
        sun = et(2026, 9, 27, 12, 0)
        assert bars_fetch.intraday_tail_status("X", "5", FRI_1555, now=sun)["tail_status"] == "current"

    def test_weekend_thursday_tail_is_not(self, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260925)
        sun = et(2026, 9, 27, 12, 0)
        thu = et(2026, 9, 24, 15, 55)
        assert bars_fetch.intraday_tail_status("X", "5", thu, now=sun)["tail_status"] == "unverified"


class TestVerificationIsEarnedNotInferred:
    def _ok_delta(self, rows):
        def _fn(ticker, tf, last_ts, status=None):
            if status is not None:
                status["ok"] = True
            return rows
        return _fn

    def test_a_provider_answer_that_persists_verifies(self, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", self._ok_delta([]))
        t0 = time.time()
        bars_fetch._heal_intraday_tail("AVGO", "5", FRI_1955)
        vt = bars_fetch.tail_verified_through("AVGO", "5")
        assert vt is not None and vt >= t0 - 1

    def test_a_failed_provider_verifies_nothing(self, monkeypatch):
        # The real `_delta_intraday` swallows provider errors into [] — identical to
        # "nothing newer". Only the explicit status flag separates them.
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: [])
        bars_fetch._heal_intraday_tail("AVGO", "5", FRI_1955)
        assert bars_fetch.tail_verified_through("AVGO", "5") is None

    def test_a_locked_database_verifies_nothing(self, monkeypatch):
        recent = int(time.time()) - 60
        monkeypatch.setattr(bars_fetch, "_delta_intraday",
                            self._ok_delta([{"t": recent, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]))

        def _locked(*a, **k):
            raise RuntimeError("database is locked")
        monkeypatch.setattr(bars_fetch._sqlite, "put_bars", _locked)
        with pytest.raises(RuntimeError):
            bars_fetch._heal_intraday_tail("AVGO", "5", recent - 300)
        assert bars_fetch.tail_verified_through("AVGO", "5") is None

    def test_the_real_delta_sets_ok_only_on_a_provider_answer(self, monkeypatch):
        class _C:
            _api_key = "k"
        monkeypatch.setattr(bars_fetch, "_get_client", lambda: _C())
        monkeypatch.setattr(bars_fetch, "_paginate_massive_aggs", lambda c, u: [])
        st = {}
        bars_fetch._delta_intraday("AVGO", "5", FRI_1955, status=st)
        assert st.get("ok") is True

        def _boom(c, u):
            raise RuntimeError("429")
        monkeypatch.setattr(bars_fetch, "_paginate_massive_aggs", _boom)
        st2 = {}
        assert bars_fetch._delta_intraday("AVGO", "5", FRI_1955, status=st2) == []
        assert "ok" not in st2


# ── The serve path, end to end through the router ────────────────────────────

class _Store:
    """A tiny in-memory stand-in for bars_sqlite with a mutable tail."""

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


@pytest.fixture
def avgo(monkeypatch):
    """AVGO 5m exactly as bars-api held it at 11:35 ET: Friday rows, needing repair."""
    rows = [(FRI_1955 - 300 * i, 353.0, 353.5, 352.9, 353.4, 1000) for i in range(30)][::-1]
    store = _Store(rows)
    mem = {}
    for name in ("get_last_ts", "get_bars", "get_bars_since", "put_bars"):
        monkeypatch.setattr(bars_fetch._sqlite, name, getattr(store, name))
    monkeypatch.setattr(bars_fetch.cache, "get", lambda k: mem.get(k))
    monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: mem.__setitem__(k, v))
    monkeypatch.setattr(bars_fetch.cache, "invalidate", lambda k: mem.pop(k, None))
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", _fmt)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.5)
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260928)
    monkeypatch.delenv("BARS_INTRADAY_ASYNC_HEAL", raising=False)
    # Freeze the router's view of "now" at the production clock.
    real_status = bars_fetch.intraday_tail_status
    monkeypatch.setattr(bars_fetch, "intraday_tail_status",
                        lambda t, tf, tail, now=None: real_status(t, tf, tail, now=MON_1133))
    # Keep the router's unrelated decorations out of the way.
    monkeypatch.setattr(bars_router, "_is_carried", lambda t: True)
    return {"store": store, "mem": mem}


def _monday_delta(status=None):
    """A healthy provider: Monday 09:30 → 11:30 5m."""
    if status is not None:
        status["ok"] = True
    return [{"t": et(2026, 9, 28, 9, 30) + 300 * i, "o": 350.0, "h": 350.5, "l": 349.5,
             "c": 350.2, "v": 5000} for i in range(25)]


def _saturate(sem):
    taken = 0
    while sem.acquire(blocking=False):
        taken += 1
    return taken


def _release(sem, n):
    for _ in range(n):
        sem.release()


def _body(resp):
    return orjson.loads(resp.body)


class TestServeContract:
    def test_AVGO_REGRESSION_shed_repair_is_UNVERIFIED_not_silent(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: _monday_delta(status))
        n_bg = _saturate(bars_fetch._bg_delta_sem)
        n_ia = _saturate(bars_fetch._interactive_heal_sem)
        try:
            resp = bars_router.serve_bars("AVGO", "5", 50)
        finally:
            _release(bars_fetch._bg_delta_sem, n_bg)
            _release(bars_fetch._interactive_heal_sem, n_ia)
        body = _body(resp)
        assert resp.status_code == 200, "usable history stays a 200"
        assert body["bars"][-1]["t"] == FRI_1955, "the history is still served"
        assert body["tail_status"] == "unverified"
        assert body["verified_through"] is None
        assert resp.headers.get("Retry-After") == "3"

    def test_since_path_shed_is_also_UNVERIFIED(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: _monday_delta(status))
        n_bg = _saturate(bars_fetch._bg_delta_sem)
        n_ia = _saturate(bars_fetch._interactive_heal_sem)
        try:
            resp = bars_router.serve_bars("AVGO", "5", 1152, since=str(FRI_1955 - 1))
        finally:
            _release(bars_fetch._bg_delta_sem, n_bg)
            _release(bars_fetch._interactive_heal_sem, n_ia)
        body = _body(resp)
        assert body["delta"] is True
        assert body["tail_status"] == "unverified"
        assert resp.headers.get("Retry-After") == "3"

    def test_INTERACTIVE_RESERVE_repairs_while_background_holds_every_shared_slot(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: _monday_delta(status))
        n_bg = _saturate(bars_fetch._bg_delta_sem)
        try:
            resp = bars_router.serve_bars("AVGO", "5", 50)          # warm=0 → interactive
        finally:
            _release(bars_fetch._bg_delta_sem, n_bg)
        body = _body(resp)
        assert body["bars"][-1]["t"] == et(2026, 9, 28, 11, 30)
        assert body["tail_status"] == "current"
        assert "Retry-After" not in resp.headers
        assert body["verified_through"] is not None

    def test_CONTROL_a_warm_request_cannot_take_the_reserve(self, avgo, monkeypatch):
        called = {"n": 0}

        def _d(t, tf, lt, status=None):
            called["n"] += 1
            return _monday_delta(status)
        monkeypatch.setattr(bars_fetch, "_delta_intraday", _d)
        n_bg = _saturate(bars_fetch._bg_delta_sem)
        try:
            resp = bars_router.serve_bars("AVGO", "5", 50, warm=1)
        finally:
            _release(bars_fetch._bg_delta_sem, n_bg)
        assert called["n"] == 0, "a warm prefetch must never spend the interactive reserve"
        if resp.status_code == 200:
            assert _body(resp)["tail_status"] == "unverified"

    def test_the_interactive_mark_never_leaks_to_the_next_request_on_the_thread(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: _monday_delta(status))
        bars_router.serve_bars("AVGO", "5", 50)
        assert bars_fetch._request_is_interactive() is False

    def test_a_healthy_repair_reads_current(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: _monday_delta(status))
        body = _body(bars_router.serve_bars("AVGO", "5", 50))
        assert body["tail_status"] == "current"

    def test_a_failed_provider_stays_unverified(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: [])
        resp = bars_router.serve_bars("AVGO", "5", 50)
        assert _body(resp)["tail_status"] == "unverified"
        assert resp.headers.get("Retry-After") == "3"


class TestWarmCacheAuthority:
    def test_a_stale_warm_cannot_poison_the_interactive_cache_entry(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf, ticker=None: True)
        resp = bars_fetch.serve_warm_from_cache("AVGO", "5", 50)
        assert resp is not None, "the warm still gets its history"
        assert "bars_AVGO_5_50" not in avgo["mem"], "…but must not publish it as the chart's entry"

    def test_CONTROL_a_fresh_store_may_still_be_cached(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf, ticker=None: False)
        bars_fetch.serve_warm_from_cache("AVGO", "5", 50)
        assert "bars_AVGO_5_50" in avgo["mem"]

    def test_after_a_stale_warm_the_click_still_repairs(self, avgo, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_delta_intraday", lambda t, tf, lt, status=None: _monday_delta(status))
        bars_fetch.serve_warm_from_cache("AVGO", "5", 50)
        body = _body(bars_router.serve_bars("AVGO", "5", 50))
        assert body["bars"][-1]["t"] == et(2026, 9, 28, 11, 30)
        assert body["tail_status"] == "current"


class TestSdDoBounded:
    def test_same_session_repair_returns_at_the_deadline(self, monkeypatch):
        """The `_sd_do` branch (same-session stale, not cold-stale) used to run a bare
        `_delta_intraday` + `put_bars` on the request thread."""
        today_tail = int(time.time()) - 1800
        store = _Store([(today_tail - 300 * i, 1.0, 1.0, 1.0, 1.0, 1) for i in range(40)][::-1])
        for name in ("get_last_ts", "get_bars", "put_bars"):
            monkeypatch.setattr(bars_fetch._sqlite, name, getattr(store, name))
        monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
        monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
        monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", _fmt)
        monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)
        monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda ts, tf, ticker=None: True)
        monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda tf, ts, now=None: False)
        monkeypatch.setattr(bars_fetch, "_inflight", {})
        monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)

        def _slow(t, tf, lt, status=None):
            time.sleep(2.0)
            return []
        monkeypatch.setattr(bars_fetch, "_delta_intraday", _slow)
        t0 = time.perf_counter()
        resp = bars_fetch._get_bars_inner("AVGO", "5", 20)
        assert time.perf_counter() - t0 < 1.0, "the request thread must not wait on the provider"
        assert resp.status_code == 200
        assert bars_fetch.get_serve_layer() == "sd-deadline"


class TestScope:
    def test_problem_B_cold_warming_503_is_untouched(self, monkeypatch):
        monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
        monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: None)
        monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: [])
        monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_kick_cold_fetch", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch.disk_cache, "get", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_inflight", {})
        monkeypatch.setattr(bars_router, "_is_carried", lambda t: True)
        resp = bars_router.serve_bars("NEWCO", "5", 50)
        body = _body(resp)
        assert resp.status_code == 503 and body.get("error") == "warming"
        assert "tail_status" not in body

    def test_daily_responses_carry_no_intraday_tail_status(self, monkeypatch):
        payload = {"ticker": "AVGO", "tf": "D", "bars": [{"t": "2026-09-28", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}
        monkeypatch.setattr(bars_router, "_get_bars_inner",
                            lambda t, tf, n: bars_router.JSONResponse(content=payload))
        monkeypatch.setattr(bars_router, "_augment_daily_with_today", lambda r, t: r)
        body = _body(bars_router.serve_bars("AVGO", "D", 5))
        assert "tail_status" not in body

    def test_no_data_terminal_answer_is_left_alone(self):
        r = bars_router.JSONResponse(content={"ticker": "TWTR", "tf": "5", "bars": [], "no_data": True})
        out = bars_router._augment_with_tail_status(r, "TWTR", "5")
        assert "tail_status" not in _body(out)


def test_60m_opening_bucket_is_verifiable_at_1000_not_1030():
    """The 09:30 hourly bucket ends at 10:00. A check at 10:01 proves it."""
    bars_fetch._tail_verified.clear()
    bars_fetch._mark_tail_verified("THIN", "60", et(2026, 9, 28, 10, 1))
    st = bars_fetch.intraday_tail_status("THIN", "60", FRI_1555, now=et(2026, 9, 28, 10, 20))
    assert st["tail_status"] == "verified"


# ── Weekly: the current week's forming candle (the verified intended contract) ──

class TestWeeklyCurrentWeek:
    def test_monday_mid_session_last_weeks_key_is_cold_stale(self, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260928)
        assert bars_fetch._is_cold_stale_weekly("W", 20260925) is True

    def test_current_week_key_is_not(self, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260928)
        assert bars_fetch._is_cold_stale_weekly("W", 20261002) is False

    def test_weekend_or_preopen_is_not(self, monkeypatch):
        # Before Monday's first session is expected, the latest session is Friday.
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260925)
        assert bars_fetch._is_cold_stale_weekly("W", 20260925) is False

    def test_other_timeframes_untouched(self, monkeypatch):
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260928)
        assert bars_fetch._is_cold_stale_weekly("D", 20260925) is False
        assert bars_fetch._is_cold_stale_weekly("M", 20260925) is False

    def test_monday_weekly_request_repairs_synchronously_instead_of_serving_last_week(self, monkeypatch):
        rows = [(20260911, 1, 1, 1, 1, 1), (20260918, 1, 1, 1, 1, 1), (20260925, 1, 1, 1, 1, 1)]
        store = {"rows": list(rows)}
        monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda s, tf: store["rows"][-1][0])
        monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda s, tf, n: store["rows"][-n:])

        def _put(s, tf, new, date_tf=False):
            for b in new:
                store["rows"].append((int(b["t"].replace("-", "")), 1, 1, 1, 1, 1))
        monkeypatch.setattr(bars_fetch._sqlite, "put_bars", _put)
        monkeypatch.setattr(bars_fetch.cache, "get", lambda k: None)
        monkeypatch.setattr(bars_fetch.cache, "set", lambda k, v, ttl=None: None)
        monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars",
                            lambda r, tf, t=None: [{"t": f"{str(x[0])[:4]}-{str(x[0])[4:6]}-{str(x[0])[6:]}"} for x in r])
        monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch, "_history_complete", lambda s, tf: True)
        monkeypatch.setattr(bars_fetch, "_inflight", {})
        monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260928)
        monkeypatch.setattr(bars_fetch, "_delta_weekly",
                            lambda t, lt: [{"t": "2026-10-02", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
        resp = bars_fetch._get_bars_inner("AVGO", "W", 3)
        assert bars_fetch.get_serve_layer() != "stale-swr"
        assert orjson.loads(resp.body)["bars"][-1]["t"] == "2026-10-02"
