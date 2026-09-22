"""WHAT A DEGRADED PROVIDER DOES TO A MEMBER REQUEST.

⛔⛔ THE PRODUCTION INCIDENT THESE RAILS ENCODE (2026-09-22, 15:20-16:00 ET). The
market-data vendor returned 502 Bad Gateway at scale -- 251+ observed in 85
minutes, ZERO 429s and ZERO vendor Retry-After, so genuine upstream degradation
rather than our throttling. Measured from an authenticated browser while daily
and `since=` deltas stayed at ~86-145 ms:

    /api/bars SOXL tf=5 bars=600   full  ->  8,204 ms  (repeat 8,354 ms)
    /api/bars INOD tf=5 bars=600   full  ->  8,521 ms
    /api/bars SOXL tf=5 bars=3000  full  -> 25,446 ms   ~= httpx read=25.0

The client was blameless: a cache stale by hours classifies GAPPED, GAPPED
correctly demands a full authoritative repair, and the repair sat on a dead
socket while paint authority (correctly) refused to draw the stale bars. The
member got a blank chart.

⭐ WHAT THESE TESTS INJECT, AND WHERE. Only the PROVIDER SEAM is faked
(`_delta_intraday` / `_fetch_intraday`). The decision layer under test --
`_get_bars_since_response`, `_get_bars_inner`, the freshness classification, the
deadline wrappers -- is the real thing. Faking the decision layer would be
testing the test.

⚠️ NO TEST SLEEPS FOR 25 SECONDS. The interactive budget is 2.5 s
(`BARS_REQUEST_DEADLINE_SECONDS`), so a stall only has to exceed THAT to prove
the point; `_HANG_S` is sized just over it. A rail that took 25 s to run would
be deleted by the next person in a hurry, and then it would protect nothing.
"""
import json
import threading
import time

import httpx
import pytest

import api.services.bars_fetch as bf


_HANG_S = 4.0          # > _REQUEST_DEADLINE_SECONDS (2.5), far below httpx read=25
_SLOW_UNDER_S = 0.3    # comfortably inside the budget
_ROWS = [(1_700_000_300, 1.0, 2.0, 0.5, 1.5, 100)]


# ── Provider behaviours, injected at the seam ────────────────────────────────

def _fast_success(*a, **k):
    return [{"t": 1_700_000_300, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}]


def _slow_success(delay):
    def _f(*a, **k):
        time.sleep(delay)
        return _fast_success()
    return _f


def _http_502(*a, **k):
    req = httpx.Request("GET", "https://provider.invalid/agg")
    resp = httpx.Response(502, request=req)
    raise httpx.HTTPStatusError("Server error '502 Bad Gateway'", request=req, response=resp)


def _conn_error(*a, **k):
    raise httpx.ConnectError("connection refused")


def _hang(*a, **k):
    time.sleep(_HANG_S)
    return _fast_success()


# ── Shared wiring: a stale local tail with rows available to serve ───────────

def _wire(monkeypatch, *, local_rows=_ROWS):
    """Everything except the provider is local and instant.

    Mirrors tests/test_bars_since_async_heal.py's helper so the two files cannot
    drift into describing different products."""
    monkeypatch.setattr(bf, "_is_yf_only_symbol", lambda s: False)
    monkeypatch.setattr(bf, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bf._sqlite, "get_last_ts", lambda *a, **k: 1_700_000_000)
    monkeypatch.setattr(bf, "_needs_fresh", lambda *a, **k: True)
    monkeypatch.setattr(bf._sqlite, "get_bars_since", lambda *a, **k: list(local_rows))
    monkeypatch.setattr(bf._sqlite, "get_bars", lambda *a, **k: list(local_rows))
    monkeypatch.setattr(bf._sqlite, "put_bars", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_fmt_sqlite_bars",
                        lambda rows, tf, sym: [{"t": r[0], "o": r[1], "h": r[2],
                                                "l": r[3], "c": r[4], "v": r[5]}
                                               for r in rows])
    monkeypatch.setattr(bf.cache, "invalidate", lambda *a, **k: None)


def _timed(fn, *a, **k):
    t0 = time.monotonic()
    out = fn(*a, **k)
    return out, time.monotonic() - t0


# ── 1. THE since= PATH, FLAG OFF: the member waits on the provider ───────────

@pytest.mark.parametrize("behaviour,name", [
    (_hang, "HANG"), (_http_502, "HTTP_502"), (_conn_error, "CONNECTION_ERROR"),
])
def test_since_flag_off_inherits_the_provider_stall(monkeypatch, behaviour, name):
    """⛔ THE REPRODUCTION. With the flag off the highest-QPS endpoint blocks on
    the provider, which is what turns a vendor outage into member latency."""
    _wire(monkeypatch)
    monkeypatch.delenv("BARS_SINCE_ASYNC_HEAL", raising=False)
    monkeypatch.setattr(bf, "_delta_intraday", behaviour)

    resp, dt = _timed(bf._get_bars_since_response, "AAPL", "5", 600, "1700000000")

    assert resp.status_code == 200
    if name == "HANG":
        # ⚠️ MEASURED, AND IT CORRECTED MY OWN CLAIM. I expected this to inherit the
        # whole stall; it does not -- the since= path is already wrapped, so it
        # blocks for the INTERACTIVE BUDGET. That is still the amplification that
        # matters: 2.5 s of pool occupancy on the highest-QPS endpoint, per poll,
        # per open chart, for as long as the vendor is sick.
        budget = bf._REQUEST_DEADLINE_SECONDS
        assert budget * 0.8 <= dt < _HANG_S * 0.9, (
            f"expected to block ~{budget}s (the budget), took {dt:.2f}s")
    else:
        # A fast FAILURE is cheap; it is the STALL that hurts. Recorded so the
        # after-picture is not mistaken for "the fix made errors faster".
        assert dt < 1.0


def test_since_flag_on_never_waits_on_the_provider(monkeypatch):
    """⭐ THE FIX THAT ALREADY EXISTS. Flag on: serve the local delta now, heal in
    the background. The provider can hang for as long as it likes."""
    _wire(monkeypatch)
    monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")
    monkeypatch.setattr(bf, "_delta_intraday", _hang)

    resp, dt = _timed(bf._get_bars_since_response, "AAPL", "5", 600, "1700000000")

    body = json.loads(bytes(resp.body))
    assert body["delta"] is True
    assert len(body["bars"]) == 1          # the local delta was served
    assert dt < 0.5, f"flag ON must not block; took {dt:.2f}s"


# ── 2. RESOURCE OCCUPANCY: does a stalled provider starve unrelated work? ────

def _pool_occupancy(monkeypatch, flag_on, workers=8, pollers=8):
    """Model the shared request pool: `workers` slots, `pollers` stale since=
    polls against a hanging provider, then ONE unrelated request that only needs
    local state. Returns (peak_blocked, unrelated_wait_s).

    ⚠️ THE POOL IS MODELLED, THE BLOCKING IS REAL. FastAPI runs `serve_bars` via
    `run_in_threadpool`, so a synchronous provider wait occupies a pool slot;
    this reproduces that shape with a bounded executor rather than asserting it
    from a docstring."""
    _wire(monkeypatch)
    if flag_on:
        monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")
    else:
        monkeypatch.delenv("BARS_SINCE_ASYNC_HEAL", raising=False)
    monkeypatch.setattr(bf, "_delta_intraday", _hang)

    sem = threading.BoundedSemaphore(workers)
    inflight = {"n": 0, "peak": 0}
    lock = threading.Lock()

    def _slot(fn):
        with sem:
            with lock:
                inflight["n"] += 1
                inflight["peak"] = max(inflight["peak"], inflight["n"])
            try:
                return fn()
            finally:
                with lock:
                    inflight["n"] -= 1

    threads = [threading.Thread(
        target=_slot,
        args=(lambda: bf._get_bars_since_response("AAPL", "5", 600, "1700000000"),),
        daemon=True) for _ in range(pollers)]
    for t in threads:
        t.start()
    time.sleep(0.4)                      # let the pollers take their slots

    # The unrelated request needs nothing but local state.
    t0 = time.monotonic()
    _slot(lambda: None)
    unrelated = time.monotonic() - t0

    for t in threads:
        t.join(timeout=_HANG_S + 3)
    return inflight["peak"], unrelated


def test_a_stalled_provider_does_NOT_starve_unrelated_requests(monkeypatch):
    """⛔⛔ THE SATURATION HYPOTHESIS, FALSIFIED. `BARS_SINCE_ASYNC_HEAL`'s own
    docstring calls the synchronous since= poll "the congestion that drags WARM
    charts to multi-second loads under load", and I carried that claim into an
    incident report. It does not survive measurement: `_bounded_delta` takes
    `_bg_delta_sem` NON-BLOCKING, so at most BARS_BG_DELTA_MAX (6) requests can
    ever be waiting on the vendor at once. Everything past that is shed instantly
    and serves local state. With FastAPI's default 40-thread limiter that leaves
    34 slots free, so a vendor outage CANNOT starve the pool through this path --
    and here an unrelated request went through in 0.00 s while the vendor hung.

    The flag is still worth enabling (2.5 s -> ~0 s per poll, and it frees the six
    bg slots for real repairs), but it is NOT an explanation for the 8-25 s
    production latency. That remains unexplained by this mechanism."""
    peak, unrelated = _pool_occupancy(monkeypatch, flag_on=False, workers=8, pollers=8)
    # ⭐⭐ A BULKHEAD ALREADY EXISTS, AND THE HARNESS FOUND IT. `_bounded_delta`
    # takes `_bg_delta_sem` NON-BLOCKING, so once BARS_BG_DELTA_MAX (6) requests
    # are waiting on the vendor the rest are shed instantly and serve local state.
    # A vendor outage therefore CANNOT starve the whole request pool through this
    # path -- which is materially weaker than "the congestion that drags WARM
    # charts to multi-second loads", and is the opposite of what I expected to
    # measure. Pin the cap so a future edit cannot remove it silently.
    assert peak <= bf._BG_DELTA_MAX + 1, (
        f"more than BARS_BG_DELTA_MAX ({bf._BG_DELTA_MAX}) requests blocked on the "
        f"vendor at once (peak={peak}) -- the bulkhead is gone")
    assert unrelated < 0.5, (
        f"unrelated request waited {unrelated:.2f}s -- if this ever fails, the "
        "bulkhead has been removed and provider stalls CAN starve the pool")


def test_flag_on_keeps_the_pool_free(monkeypatch):
    """⭐ The same workload, flag on: the polls return immediately, so an
    unrelated request never queues behind the provider."""
    peak, unrelated = _pool_occupancy(monkeypatch, flag_on=True, workers=8, pollers=8)
    assert unrelated < 0.5, f"unrelated request waited {unrelated:.2f}s with flag ON"


# ── 3. THE RESIDUAL INTERACTIVE CALL (cold-stale first paint) ────────────────

def _cold_stale_full(monkeypatch, behaviour):
    """Drive the cold-stale, non-deblockable first-paint branch -- the one that
    called `_delta_intraday` with no application deadline."""
    _wire(monkeypatch)
    monkeypatch.setattr(bf, "_is_cold_stale_intraday", lambda *a, **k: True)
    monkeypatch.setattr(bf, "_intraday_deblockable", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_cold_stale_daily", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_deep_request", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_delta_intraday", behaviour)
    monkeypatch.setattr(bf.cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(bf.cache, "set", lambda *a, **k: None)
    bf._inflight.clear()
    return _timed(bf._get_bars_inner, "AAPL", "5", 600)


def test_cold_stale_first_paint_is_bounded_under_a_provider_stall(monkeypatch):
    """The COLD-STALE branch was ALREADY bounded before this change (it routes
    through `_bounded_delta`), and this rail pins that so a later edit cannot
    quietly un-bound it. The seam that was NOT bounded is the same-session one
    below -- a distinction I got wrong until the harness measured it."""
    resp, dt = _cold_stale_full(monkeypatch, _hang)
    assert resp.status_code == 200
    budget = bf._REQUEST_DEADLINE_SECONDS
    assert dt < budget + 1.5, (
        f"interactive first paint took {dt:.2f}s against a {_HANG_S}s provider "
        f"stall; budget is {budget}s")
    body = json.loads(bytes(resp.body))
    assert body["bars"], "local history must still be served after a shed repair"


@pytest.mark.parametrize("behaviour", [_http_502, _conn_error])
def test_cold_stale_first_paint_survives_provider_errors(monkeypatch, behaviour):
    """A provider error must degrade to the local store, not to an exception."""
    resp, dt = _cold_stale_full(monkeypatch, behaviour)
    assert resp.status_code == 200
    assert json.loads(bytes(resp.body))["bars"]
    assert dt < 2.0


def test_cold_stale_first_paint_still_uses_a_healthy_provider(monkeypatch):
    """⭐ THE REGRESSION THAT MATTERS MOST. Bounding the call must not stop us
    repairing when the provider is HEALTHY -- otherwise this 'fix' trades a slow
    correct chart for a fast stale one, which is the opposite of the goal."""
    seen = {"n": 0}

    def _counted(*a, **k):
        seen["n"] += 1
        return _fast_success()

    resp, dt = _cold_stale_full(monkeypatch, _counted)
    assert resp.status_code == 200
    assert seen["n"] == 1, "the provider repair must still be attempted"
    assert dt < 2.0


def test_slow_but_inside_budget_still_repairs(monkeypatch):
    """A provider that answers just inside the budget is used, not shed."""
    seen = {"n": 0}

    def _slow(*a, **k):
        seen["n"] += 1
        time.sleep(_SLOW_UNDER_S)
        return _fast_success()

    resp, dt = _cold_stale_full(monkeypatch, _slow)
    assert seen["n"] == 1
    assert dt >= _SLOW_UNDER_S * 0.8
    assert dt < bf._REQUEST_DEADLINE_SECONDS + 1.0


# ── 4. TIMEOUT BOUNDARY HYGIENE ──────────────────────────────────────────────

def test_a_shed_repair_leaves_no_late_mutation_or_double_response(monkeypatch):
    """⛔ A SHED FETCH IS NOT A CANCELLED ONE. `_bounded_delta` deliberately lets
    the job finish so the next poll finds the rows -- but it must not mutate the
    response that already went out, and it must release its slot."""
    _wire(monkeypatch)
    puts = []
    monkeypatch.setattr(bf._sqlite, "put_bars", lambda *a, **k: puts.append(a[:2]))
    monkeypatch.setattr(bf, "_is_cold_stale_intraday", lambda *a, **k: True)
    monkeypatch.setattr(bf, "_intraday_deblockable", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_cold_stale_daily", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_deep_request", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_intraday_stale", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_delta_intraday", _hang)
    monkeypatch.setattr(bf.cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(bf.cache, "set", lambda *a, **k: None)
    bf._inflight.clear()

    # ⛔ WAIT FOR QUIESCENCE FIRST. The first cut snapshotted the semaphore while a
    # PREVIOUS test's shed job still held a slot, then reported "bg slot leaked" when
    # that job released it. The leak was in the measurement.
    for _ in range(60):
        if bf._bg_delta_sem._value == bf._BG_DELTA_MAX:
            break
        time.sleep(0.2)
    before = bf._bg_delta_sem._value
    resp, dt = _timed(bf._get_bars_inner, "AAPL", "5", 600)
    assert resp.status_code == 200
    body_at_return = json.loads(bytes(resp.body))

    time.sleep(_HANG_S + 0.7)                 # let the shed job finish
    assert json.loads(bytes(resp.body)) == body_at_return, "response mutated late"
    assert puts, "the shed repair must still persist for the next poll"
    assert bf._bg_delta_sem._value == before, "bg slot leaked"


# ── 5. THE SEAM THIS PASS ACTUALLY FIXED ─────────────────────────────────────

def _same_session_stale(monkeypatch, behaviour, rows=700):
    """The SAME-SESSION-STALE intraday FIRST PAINT: no `since`, cache a few bars
    behind rather than a session behind, enough rows to be non-partial.

    ⛔ THIS IS THE PATH THAT HAD NO DEADLINE. Its sibling branches all route
    through `_bounded_delta` / `_bounded_fetch_intraday`; this one called
    `_delta_intraday` bare, so it inherited the provider client's read=25.0.
    Measured before the fix: 4.00 s against a 4 s stall, with NO wrapper invoked.
    """
    local = [(1_700_000_000 - (rows - i) * 300, 1.0, 2.0, 0.5, 1.5, 100)
             for i in range(rows)]
    _wire(monkeypatch, local_rows=local)
    monkeypatch.setattr(bf, "_is_cold_stale_intraday", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_intraday_deblockable", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_cold_stale_daily", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_is_deep_request", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_delta_intraday", behaviour)
    monkeypatch.setattr(bf.cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(bf.cache, "set", lambda *a, **k: None)
    bf._inflight.clear()
    return _timed(bf._get_bars_inner, "AAPL", "5", 600)


def test_same_session_first_paint_no_longer_inherits_the_provider_stall(monkeypatch):
    """⛔⛔ THE REGRESSION RAIL FOR THIS PASS. A stalled vendor must not hold an
    interactive first paint past the interactive budget, and the member must
    still receive the local history rather than a blank chart."""
    resp, dt = _same_session_stale(monkeypatch, _hang)
    budget = bf._REQUEST_DEADLINE_SECONDS
    assert resp.status_code == 200
    assert dt < budget + 1.0, (
        f"first paint took {dt:.2f}s against a {_HANG_S}s stall; budget {budget}s")
    assert dt < _HANG_S * 0.9, "still inheriting the full provider stall"
    assert json.loads(bytes(resp.body))["bars"], "local history must still be served"


def test_same_session_first_paint_still_repairs_on_a_healthy_provider(monkeypatch):
    """⭐ The fix must not trade a slow correct chart for a fast stale one."""
    seen = {"n": 0}

    def _counted(*a, **k):
        seen["n"] += 1
        return _fast_success()

    resp, dt = _same_session_stale(monkeypatch, _counted)
    assert resp.status_code == 200
    assert seen["n"] == 1, "the provider repair must still be attempted"
    assert dt < 1.0


@pytest.mark.parametrize("behaviour", [_http_502, _conn_error])
def test_same_session_first_paint_degrades_to_local_on_provider_errors(monkeypatch, behaviour):
    resp, dt = _same_session_stale(monkeypatch, behaviour)
    assert resp.status_code == 200
    assert json.loads(bytes(resp.body))["bars"]
    assert dt < 2.0
