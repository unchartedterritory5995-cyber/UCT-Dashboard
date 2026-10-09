"""TERM-082 (census rank 4): the `/api/theme-performance` live overlay adopts serve-stale.

The overlay (`_apply_live_returns` over the cached daily compute) lives on a
10 s TTL. A miss fetched two Massive batch-snapshot maps over ~2,050 holdings
(~11 chunks each) plus the taxonomy enrichment, with no single-flight, so N
requests landing on the expiry each fired their own ~22 calls. The route now
serves the last COMPLETE overlay while one refresh runs behind the callers.

What each test pins:
  (a) after the TTL lapses, N concurrent requests get last-good at once, marked
      `stale-swr`, and exactly ONE recompute runs; a cold herd collapses onto
      one build;
  (b) a refresh that raises, or returns a PARTIAL overlay (a live map dropped a
      chunk, lost its client, or came back empty), keeps serving last-good
      marked stale; the partial is served on the live TTL and never becomes
      last-good. A partial live map reused from the cache is still partial;
  (c) a cold start behaves as before: one synchronous build, the built payload
      returned, the "computing" stub never remembered, a raise still a 503;
      the footer's `?refresh=1` still builds NOW;
  plus: callers of `svc.get_theme_performance()` other than the route never see
  a served-stale overlay, and their cache TTL is unchanged.

The real service runs against FAKE live-snapshot providers and an injected
clock, so no network is touched and "the TTL lapsed" is a clock move. The
overlay arithmetic itself is not changed by TERM-082 and is pinned by
`tests/test_theme_from_open.py`; the values asserted here only identify WHICH
build answered.
"""
from __future__ import annotations

import copy
import threading
import time as _real_time

import pytest
from fastapi import HTTPException, Response

import api.services.theme_performance as svc
from api.routers import theme_performance as tp_router
from api.services import cache as cache_mod
from api.services import massive
from api.services import serve_stale as serve_stale_mod
from api.services.cache import cache

USER = {"id": 1, "role": "user", "email": "member@test"}
WAIT = 5.0
SLOT = tp_router._THEME_STALE
KEY = tp_router._THEME_KEY

_BASE = {
    "themes": [{
        "name": "Space", "ticker": "UFO", "etf_name": "Procure Space ETF",
        "holdings": [
            {"sym": sym, "name": sym, "weight_pct": 0.0, "source": "owner",
             "returns": {"1d": 0.5, "1w": 1.0, "1m": 2.0, "3m": 3.0, "1y": 4.0, "ytd": 5.0},
             "ref_prices": {"1d": 100.0, "1w": 90.0, "1m": 80.0, "3m": 70.0,
                            "1y": 60.0, "ytd": 50.0}}
            for sym in ("AAA", "BBB")
        ],
    }],
    "status": "ok",
    "generated_at": "2026-09-29T09:00:00+00:00",
}

_LIVE_KEYS = (svc._OVERLAID_KEY, svc._LIVE_1D_KEY, svc._LIVE_OPEN_KEY,
              svc._LIVE_1D_KEY + svc._LIVE_PARTIAL_SUFFIX,
              svc._LIVE_OPEN_KEY + svc._LIVE_PARTIAL_SUFFIX)


class _Clock:
    def __init__(self, t: float = 3_000_000.0):
        self.t = t

    def time(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class _FakeLive:
    """`massive.get_etf_snapshots` / `get_etf_open_snapshots`. One RECOMPUTE =
    one 1D-map fetch (the first leg of every overlay build)."""

    def __init__(self):
        self.pct = 1.5
        self.recomputes = 0
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self.raise_ = False
        self.drop_chunk = False          # a chunk dropped after its retry
        self.empty = False               # the whole map came back empty
        self._lock = threading.Lock()

    def snaps(self, syms, stale_to_zero=False, failures=None):
        with self._lock:
            self.recomputes += 1
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(WAIT)
        if self.raise_:
            raise RuntimeError("massive down")
        if self.empty:
            return {}
        out = {s: self.pct for s in syms}
        if self.drop_chunk:
            if failures is not None:
                failures.append(200)
            out.pop("BBB", None)
        return out

    def opens(self, syms, failures=None):
        return {s: 0.25 for s in syms}


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(cache_mod, "time", c)
    monkeypatch.setattr(serve_stale_mod, "time", c)
    return c


@pytest.fixture
def live(monkeypatch, clock):
    f = _FakeLive()
    monkeypatch.setattr(massive, "get_etf_snapshots", f.snaps)
    monkeypatch.setattr(massive, "get_etf_open_snapshots", f.opens)
    monkeypatch.setattr(svc.theme_db, "get_all_themes",
                        lambda: {"themes": [], "sectors": []})
    monkeypatch.setattr(svc, "_load_from_disk", lambda: None)
    monkeypatch.setattr("api.routers.bars.warm_bars_async", lambda *a, **k: None)
    cache.set(svc._CACHE_KEY, copy.deepcopy(_BASE), ttl=10 ** 7)
    return f


@pytest.fixture(autouse=True)
def _session_printing(monkeypatch):
    # Perf wave 2: the live windows are 10 s / 30 s only while a US session can print
    # (svc.prices_moving); quiet hours are pinned in tests/test_theme_performance_cold_path.py.
    # These tests pin the in-session behaviour, so they must not depend on the wall clock.
    monkeypatch.setattr(svc, "prices_moving", lambda now=None: True)


@pytest.fixture(autouse=True)
def _isolate_cache():
    prior_base = cache.get(svc._CACHE_KEY)
    for k in _LIVE_KEYS + (svc._CACHE_KEY,):
        cache.invalidate(k)
    yield
    for k in _LIVE_KEYS + (svc._CACHE_KEY,):
        cache.invalidate(k)
    if prior_base is not None:
        cache.set(svc._CACHE_KEY, prior_base, ttl=900)


def _drain(slot=SLOT, timeout: float = WAIT) -> None:
    deadline = _real_time.monotonic() + timeout
    while _real_time.monotonic() < deadline:
        with slot._lock:
            if not slot._refreshing:
                return
        _real_time.sleep(0.01)
    raise AssertionError("background refresh never finished")


def _tier(resp: Response) -> str:
    st = resp.headers.get("Server-Timing", "")
    return st.split('desc="', 1)[1].split('"', 1)[0] if 'desc="' in st else ""


def _stale_age_ms(resp: Response) -> float:
    st = resp.headers.get("Server-Timing", "")
    return float(st.split("stale-age;dur=", 1)[1].split(",", 1)[0])


def _route(refresh: bool = False):
    resp = Response()
    body = tp_router.get_theme_performance(response=resp, refresh=refresh,
                                           set=None, user=USER)
    return body, resp


def _live1d(body, i: int = 0):
    return body["themes"][0]["holdings"][i]["returns"]["1d"]


def _slot_live1d():
    value, _age = SLOT.peek(KEY)
    return None if value is None else _live1d(value[0])


def _run_concurrently(fn, n: int):
    results, errors = [None] * n, []

    def _one(i):
        try:
            results[i] = fn()
        except Exception as e:  # surfaced below
            errors.append(e)

    threads = [threading.Thread(target=_one, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads), \
        "a request blocked on the rebuild instead of being served the stale copy"
    assert not errors, errors
    return results


# ═════════════════════════════ (a) expiry + herds ═════════════════════════════

def test_expired_overlay_serves_last_good_at_once_and_one_refresh_runs(live, clock):
    """(a) N concurrent requests after the 10 s expiry: all get last-good at
    once, marked stale-swr with an age, and exactly ONE recompute runs."""
    body, resp = _route()                                    # cold -> builds
    assert _tier(resp) == "fetch" and live.recomputes == 1
    assert _live1d(body) == 1.5

    clock.advance(svc._LIVE_1D_TTL + 1)                      # the TTL lapsed
    live.pct = 2.5
    live.entered.clear()
    live.gate = threading.Event()                            # the rebuild hangs

    results = _run_concurrently(_route, 8)

    assert all(_live1d(b) == 1.5 for b, _ in results), \
        "a request was served the rebuild instead of the last-good overlay"
    assert all(_tier(r) == "stale-swr" for _, r in results)
    assert all("stale-age;dur=" in r.headers["Server-Timing"] for _, r in results)
    assert live.entered.wait(WAIT), "no background refresh was kicked"
    assert live.recomputes == 2, (
        f"{live.recomputes - 1} recomputes for 8 expired requests - single-flight broke")

    live.gate.set()
    _drain()
    body, resp = _route()                                    # the refresh landed
    assert _live1d(body) == 2.5
    assert _tier(resp) == "mem" and live.recomputes == 2


def test_concurrent_cold_requests_collapse_onto_one_build(live, clock):
    """(a) Single-flight on the cold path: no N-way ~22-call fan-out."""
    live.gate = threading.Event()
    results = []

    def _req():
        results.append(_route())

    threads = [threading.Thread(target=_req) for _ in range(6)]
    for t in threads:
        t.start()
    assert live.entered.wait(WAIT)
    _real_time.sleep(0.2)                  # let the herd queue on the build lock
    live.gate.set()
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads)

    assert live.recomputes == 1, f"{live.recomputes} builds for one cold herd"
    tiers = sorted(_tier(r) for _, r in results)
    assert tiers.count("fetch") == 1
    # The waiters re-check the cache under the build lock and take the
    # winner's write, so they read as a cache hit (or a wait on the slot).
    assert set(tiers) - {"fetch"} <= {"mem", "inflight-wait"}, tiers
    assert all(_live1d(b) == 1.5 for b, _ in results)


# ═════════════════════════ (b) failing / partial refresh ══════════════════════

def test_a_raising_refresh_keeps_last_good_marked_stale(live, clock):
    """(b) A refresh that raises writes nothing: last-good keeps being served,
    still stale-swr, with a growing age."""
    _route()
    clock.advance(svc._LIVE_1D_TTL + 1)
    live.raise_ = True

    body, resp = _route()
    assert _live1d(body) == 1.5 and _tier(resp) == "stale-swr"
    first_age = _stale_age_ms(resp)
    _drain()
    assert cache.get(svc._OVERLAID_KEY) is None, "a failed refresh wrote the cache"
    assert _slot_live1d() == 1.5

    clock.advance(5)
    body, resp = _route()
    assert _live1d(body) == 1.5 and _tier(resp) == "stale-swr"
    assert _stale_age_ms(resp) > first_age
    _drain()


def test_a_partial_refresh_is_served_on_the_live_ttl_and_never_becomes_last_good(live, clock):
    """(b) A live map that dropped a chunk: the partial overlay is served from
    the cache on its TTL, the slot keeps the COMPLETE one, and last-good answers
    again once the partial's TTL lapses."""
    _route()
    clock.advance(svc._LIVE_1D_TTL + 1)
    live.drop_chunk = True
    live.pct = 2.5

    body, resp = _route()                       # stale, kicks the partial refresh
    assert _live1d(body) == 1.5 and _tier(resp) == "stale-swr"
    _drain()

    body, resp = _route()                       # the partial, from the cache
    assert _tier(resp) == "mem"
    assert _live1d(body) == 2.5
    assert _slot_live1d() == 1.5, "a partial overlay became last-good"

    clock.advance(svc._LIVE_1D_TTL + 1)         # the partial's TTL lapsed
    body, resp = _route()
    assert _tier(resp) == "stale-swr" and _live1d(body) == 1.5
    _drain()


def test_the_overlay_completeness_predicate_reads_the_legs(live, clock, monkeypatch):
    """(b) `build_theme_performance` reports complete only when the live 1D map
    was APPLIED and neither live map dropped a chunk or lost its client."""
    out, complete = svc.build_theme_performance()
    assert complete is True and _live1d(out) == 1.5

    for setup in ("drop_chunk", "empty"):
        for k in _LIVE_KEYS:
            cache.invalidate(k)
        live.drop_chunk = setup == "drop_chunk"
        live.empty = setup == "empty"
        _out, complete = svc.build_theme_performance()
        assert complete is False, f"{setup} was reported complete"
    live.drop_chunk = live.empty = False

    # An empty "From Open" map with no failure is the right answer before the
    # open prints: it is NOT a partial.
    for k in _LIVE_KEYS:
        cache.invalidate(k)
    monkeypatch.setattr(massive, "get_etf_open_snapshots",
                        lambda syms, failures=None: {})
    _out, complete = svc.build_theme_performance()
    assert complete is True


def test_a_partial_live_map_reused_from_the_cache_is_still_partial(live, clock):
    """(b) A base recompute invalidates only the overlaid key, so the next
    overlay REUSES the cached live map. If that map dropped a chunk, the reuse
    must not launder it into a complete overlay."""
    live.drop_chunk = True
    _out, complete = svc.build_theme_performance()
    assert complete is False
    calls = live.recomputes

    cache.invalidate(svc._OVERLAID_KEY)          # what _run_computation does
    live.drop_chunk = False
    _out, complete = svc.build_theme_performance()
    assert live.recomputes == calls, "the cached live map was not reused"
    assert complete is False, "a cached partial live map was taken as whole"

    clock.advance(svc._LIVE_1D_TTL + 1)          # the map expires, refetched whole
    _out, complete = svc.build_theme_performance()
    assert complete is True


def test_the_real_batch_snapshot_reports_a_dropped_chunk_and_a_lost_client(monkeypatch):
    """(b) The failures the overlay's completeness reads come from the REAL
    chunked fetch, not only from a fake: a chunk that fails twice is reported
    with its size, the others still answer, and a client failure is reported."""
    client = massive._MassiveRestClient.__new__(massive._MassiveRestClient)
    client._api_key = "k"
    tickers = [f"T{i:03d}" for i in range(450)]          # 3 chunks: 200/200/50

    def _get(url, timeout=None):
        chunk = url.split("tickers=", 1)[1].split("&", 1)[0].split(",")
        if "T250" in chunk:
            raise ConnectionError("chunk down")
        return {"tickers": [{"ticker": t, "day": {"o": 100.0, "c": 101.0},
                             "prevDay": {"c": 100.0}} for t in chunk]}

    monkeypatch.setattr(client, "_get", _get)
    failures: list = []
    out = client.get_batch_snapshots(tickers, failures=failures)
    assert failures == [200]
    assert len(out) == 250 and "T250" not in out and "T000" in out

    failures = []
    out = client.get_batch_open_map(tickers, failures=failures)
    assert failures == [200] and len(out) == 250

    failures = []
    assert client.get_batch_snapshots(tickers[:10], failures=failures) and failures == []

    def _down():
        raise RuntimeError("no key")

    monkeypatch.setattr(massive, "_get_client", _down)
    failures = []
    assert massive.get_etf_snapshots(["AAA"], stale_to_zero=True, failures=failures) == {}
    assert failures == ["client"]
    failures = []
    assert massive.get_etf_open_snapshots(["AAA"], failures=failures) == {}
    assert failures == ["client"]


def test_callers_that_pass_no_failures_list_are_unchanged(monkeypatch):
    """The `failures` kwarg is only forwarded when passed, so a caller (or a
    client double) that predates it sees the exact call it always made."""
    seen = {}

    class _OldClient:
        def get_batch_snapshots(self, tickers, stale_to_zero=False):
            seen["snap"] = (tuple(tickers), stale_to_zero)
            return {"AAA": 1.0}

        def get_batch_open_map(self, tickers):
            seen["open"] = tuple(tickers)
            return {"AAA": 0.5}

    monkeypatch.setattr(massive, "_get_client", lambda: _OldClient())
    assert massive.get_etf_snapshots(["AAA"], stale_to_zero=True) == {"AAA": 1.0}
    assert massive.get_etf_open_snapshots(["AAA"]) == {"AAA": 0.5}
    assert seen == {"snap": (("AAA",), True), "open": ("AAA",)}


# ═════════════════════════════════ (c) cold start ═════════════════════════════

def test_cold_start_builds_once_and_returns_what_it_cached(live, clock):
    """(c) No last-good: one synchronous build, the payload exactly as the
    service cached it, and the complete build becomes last-good."""
    body, resp = _route()
    assert _tier(resp) == "fetch" and live.recomputes == 1
    assert body is cache.get(svc._OVERLAID_KEY)
    assert _slot_live1d() == 1.5
    assert "live_as_of" in body


def test_the_computing_stub_is_never_remembered(live, clock, monkeypatch):
    """(c) A cold base (no memory, no disk) answers the 'computing' stub as
    before, and the stub never enters the slot."""
    cache.invalidate(svc._CACHE_KEY)
    started = []
    monkeypatch.setattr(svc, "_run_computation", lambda: started.append(1))
    monkeypatch.setattr(svc, "_computing", False)

    body, resp = _route()
    assert body["status"] == "computing" and body["themes"] == []
    assert _tier(resp) == "fetch"
    assert SLOT.peek(KEY) == (None, None)
    _real_time.sleep(0.05)
    assert started == [1]


def test_a_cold_raise_is_still_a_503(live, clock):
    """(c) With no last-good, a build that raises surfaces as before."""
    live.raise_ = True
    with pytest.raises(HTTPException) as exc:
        _route()
    assert exc.value.status_code == 503


def test_the_footer_refresh_builds_now_even_with_a_stale_slot(live, clock):
    """(c) `?refresh=1` asks for live prices applied NOW: it bypasses the slot,
    builds synchronously, and a complete result refreshes the slot."""
    _route()
    clock.advance(svc._LIVE_1D_TTL + 1)
    live.pct = 2.5

    body, resp = _route(refresh=True)
    assert _tier(resp) == "fetch"
    assert _live1d(body) == 2.5
    assert _slot_live1d() == 2.5


# ═════════════════════════════ non-route callers ══════════════════════════════

def test_other_callers_never_see_a_stale_overlay(live, clock):
    """Voice tools, theme_index's quotes, rotation signals and the lifespan warm
    call the service directly: a cache hit, else a synchronous build. Never the
    slot's last-good, even while the slot holds one within its bound."""
    _route()                                          # the slot holds 1.5
    clock.advance(svc._LIVE_1D_TTL + 1)
    live.pct = 2.5

    out = svc.get_theme_performance()
    assert _live1d(out) == 2.5, "a non-route caller was served a stale overlay"
    assert live.recomputes == 2
    assert svc.get_theme_performance() is out         # then a plain cache hit
    assert live.recomputes == 2


def test_other_callers_keep_the_live_ttl_on_a_partial(live, clock):
    """cache_policy is applied with `ttl_partial == ttl_ok`, so what a
    non-route caller caches lives exactly the live TTL either way."""
    live.drop_chunk = True
    svc.get_theme_performance()
    _value, expires_at = cache._store[svc._OVERLAID_KEY]
    assert expires_at - clock.t == svc._LIVE_1D_TTL


def test_the_lifespan_warm_calls_the_route_function_without_a_response(live, clock):
    """`main.py`'s dashboard warm calls the ROUTE function bare. With no
    Response object there is no header to set, and the call still answers."""
    body = tp_router.get_theme_performance()
    assert _live1d(body) == 1.5
