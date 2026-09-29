"""TERM-082 (FB-D4-01): `/api/snapshot` and `/api/movers` adopt serve-stale.

Both routes sat on a plain TTL cache that expires on a hard clock, so the
member whose poll landed just after expiry paid the whole provider rebuild:
four sequential Massive snapshots plus two yfinance quotes for the snapshot,
two Finviz exports plus a Massive batch for movers. They now serve the last
COMPLETE payload while one refresh runs behind the caller (`ServeStale`, the
same class calendar/wire/signature use).

What each test pins, per route:
  (a) a request after the TTL lapsed returns at once with the last-good
      payload, and N concurrent such requests start exactly ONE recompute;
  (b) a failed recompute (a raise, or a partial the cache_policy rule marks
      incomplete) keeps serving last-good, marked `stale-swr`;
  (c) a cold start with no last-good behaves as before: one synchronous build,
      the built payload returned, a raise still a 503.

Everything runs against the real services (`massive.get_snapshot`,
`massive.build_movers`) with the PROVIDERS faked, and against an injected
clock, so no network is touched and "the TTL lapsed" is a clock move rather
than a sleep.
"""
from __future__ import annotations

import threading
import time as _real_time

import pytest
from fastapi import HTTPException, Response

from api.routers import movers as movers_router
from api.routers import snapshot as snapshot_router
from api.services import cache as cache_mod
from api.services import massive
from api.services import serve_stale as serve_stale_mod
from api.services.cache import cache

USER = {"id": 1, "role": "user", "email": "member@test"}
WAIT = 5.0  # seconds; a blocked request would sit on the gate far longer


class _Clock:
    """Injected wall clock for the TTL cache and the serve-stale slots."""

    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def time(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(cache_mod, "time", c)
    monkeypatch.setattr(serve_stale_mod, "time", c)
    return c


@pytest.fixture(autouse=True)
def _isolate_cache():
    keys = ("snapshot", "movers", "movers_discovery")
    prior_wire = cache.get("wire_data")
    for k in keys + ("wire_data",):
        cache.invalidate(k)
    yield
    for k in keys:
        cache.invalidate(k)
    if prior_wire is not None:
        cache.set("wire_data", prior_wire, ttl=3600)


def _drain(slot, timeout: float = WAIT) -> None:
    """Wait for any background refresh the slot kicked to finish."""
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


# ═════════════════════════════ /api/snapshot ═════════════════════════════════

class _FakeSnapshotProviders:
    """Massive + yfinance for `massive.get_snapshot`. One RECOMPUTE = one
    QQQ call (the first leg of every build)."""

    def __init__(self, price: float = 500.0):
        self.price = price
        self.recomputes = 0
        self.gate: threading.Event | None = None     # set => builds block on it
        self.entered = threading.Event()
        self.fail = False                              # raise from the client
        self.partial = False                           # SPY leg comes back empty
        self._lock = threading.Lock()

    def get_single_ticker_snapshot(self, ticker: str) -> dict:
        if ticker == "QQQ":
            with self._lock:
                self.recomputes += 1
            self.entered.set()
            if self.gate is not None:
                self.gate.wait(WAIT)
        if ticker == "SPY" and self.partial:
            return {}
        return {"close": self.price, "change_pct": 0.5}

    def client(self):
        if self.fail:
            raise RuntimeError("massive client down")
        return self

    def yf(self, _ticker: str) -> dict:
        return {"close": 20.0, "change_pct": -1.0}


@pytest.fixture
def snap(monkeypatch, clock):
    p = _FakeSnapshotProviders()
    monkeypatch.setattr(massive, "_get_client", p.client)
    monkeypatch.setattr(massive, "_yfinance_snapshot", p.yf)
    return p


def _get_snapshot_route():
    resp = Response()
    body = snapshot_router.snapshot(response=resp, user=USER)
    return body, resp


def _qqq(body) -> str:
    return body["etfs"]["QQQ"]["price"]


def test_snapshot_expired_ttl_serves_last_good_at_once_and_one_refresh_runs(snap, clock):
    """(a) N concurrent requests after expiry: all get last-good immediately,
    marked stale-swr, and exactly ONE recompute starts behind them."""
    body, resp = _get_snapshot_route()                       # cold -> builds
    assert _tier(resp) == "fetch" and snap.recomputes == 1
    last_good = _qqq(body)

    clock.advance(massive.SNAPSHOT_TTL + 5)                  # the TTL lapsed
    snap.price = 501.0
    snap.entered.clear()
    snap.gate = threading.Event()                            # the rebuild hangs

    results = _run_concurrently(_get_snapshot_route, 8)

    assert all(_qqq(b) == last_good for b, _ in results), \
        "a request was served the rebuild instead of the last-good payload"
    assert all(_tier(r) == "stale-swr" for _, r in results)
    assert all("stale-age;dur=" in r.headers["Server-Timing"] for _, r in results)
    assert snap.entered.wait(WAIT), "no background refresh was kicked"
    assert snap.recomputes == 2, (
        f"{snap.recomputes - 1} recomputes for 8 expired requests - single-flight broke")

    snap.gate.set()
    _drain(snapshot_router._SNAPSHOT_STALE)
    body, resp = _get_snapshot_route()                       # the refresh landed
    assert _qqq(body) == massive._fmt_price(501.0)
    assert _tier(resp) == "mem" and snap.recomputes == 2


def test_snapshot_concurrent_cold_requests_collapse_onto_one_build(snap, clock):
    """Single-flight on the cold path too: no N-way provider fan-out."""
    snap.gate = threading.Event()
    threads_done = []

    def _req():
        out = _get_snapshot_route()
        threads_done.append(out)
        return out

    ts = [threading.Thread(target=_req) for _ in range(6)]
    for t in ts:
        t.start()
    assert snap.entered.wait(WAIT)
    snap.gate.set()
    for t in ts:
        t.join(WAIT)
    assert len(threads_done) == 6
    assert snap.recomputes == 1
    tiers = sorted(_tier(r) for _, r in threads_done)
    assert tiers.count("fetch") == 1 and set(tiers) <= {"fetch", "inflight-wait", "mem"}


def test_snapshot_failed_recompute_keeps_serving_last_good_marked_stale(snap, clock):
    """(b) A refresh that RAISES writes nothing, and the next request still
    gets last-good, still marked stale-swr, with a growing age."""
    body, _ = _get_snapshot_route()
    last_good = _qqq(body)

    clock.advance(massive.SNAPSHOT_TTL + 5)
    snap.fail = True
    body, resp = _get_snapshot_route()
    assert _qqq(body) == last_good and _tier(resp) == "stale-swr"
    _drain(snapshot_router._SNAPSHOT_STALE)                 # the refresh raised
    assert cache.get("snapshot") is None

    clock.advance(10)
    body, resp = _get_snapshot_route()
    assert _qqq(body) == last_good and _tier(resp) == "stale-swr"
    age_ms = float(resp.headers["Server-Timing"].split("stale-age;dur=")[1])
    assert age_ms >= (massive.SNAPSHOT_TTL + 15) * 1000
    _drain(snapshot_router._SNAPSHOT_STALE)


def test_snapshot_partial_recompute_is_never_remembered_as_last_good(snap, clock):
    """(b) cache_policy's rule: a partial (a leg priced "—") is served on the
    short TTL, never becomes the fallback, and once it lapses last-good is
    served again, marked stale."""
    body, _ = _get_snapshot_route()
    last_good = _qqq(body)
    assert massive.snapshot_complete(body)

    clock.advance(massive.SNAPSHOT_TTL + 1)
    snap.partial = True
    snap.price = 502.0
    _body, resp = _get_snapshot_route()                     # stale; kicks refresh
    assert _tier(resp) == "stale-swr"
    _drain(snapshot_router._SNAPSHOT_STALE)

    slot_value, _age = snapshot_router._SNAPSHOT_STALE.peek("snapshot")
    assert _qqq(slot_value) == last_good, "a partial rebuild became the fallback"

    body, resp = _get_snapshot_route()                      # the partial, served
    assert _tier(resp) == "mem" and body["etfs"]["SPY"]["price"] == "—"

    clock.advance(massive.SNAPSHOT_TTL_PARTIAL + 1)         # short TTL lapsed
    body, resp = _get_snapshot_route()
    assert _qqq(body) == last_good and _tier(resp) == "stale-swr"
    _drain(snapshot_router._SNAPSHOT_STALE)


def test_snapshot_cold_start_behaves_as_before(snap, clock):
    """(c) No last-good: one synchronous build, the built payload returned
    byte-for-byte as `get_snapshot()` shapes it; a raise is still a 503."""
    body, resp = _get_snapshot_route()
    assert _tier(resp) == "fetch" and snap.recomputes == 1
    assert set(body) == {"futures", "etfs"}
    assert body == cache.get("snapshot")

    cache.invalidate("snapshot")
    snapshot_router._SNAPSHOT_STALE.forget("snapshot")
    snap.fail = True
    with pytest.raises(HTTPException) as exc:
        _get_snapshot_route()
    assert exc.value.status_code == 503


def test_snapshot_completeness_predicate_reads_the_legs_not_truthiness():
    ok = {"etfs": {"QQQ": {"price": "1"}}, "futures": {"BTC": {"price": "2"}}}
    assert massive.snapshot_complete(ok)
    dash = {"etfs": {"QQQ": {"price": "—"}}, "futures": {"BTC": {"price": "2"}}}
    assert not massive.snapshot_complete(dash)
    assert not massive.snapshot_complete({"etfs": {}, "futures": {}})
    assert not massive.snapshot_complete(None)


# ═════════════════════════════ /api/movers ═══════════════════════════════════

class _FakeMoversProviders:
    """Finviz (discovery) + Massive batch (price layer) for `build_movers`.
    One RECOMPUTE = one Massive batch call (every build makes exactly one)."""

    def __init__(self):
        self.pct = 8.0
        self.recomputes = 0
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self.finviz_ok = True
        self.overlay_fails = False
        self.finviz_raises = False
        self._lock = threading.Lock()

    def finviz(self):
        if self.finviz_raises:
            raise RuntimeError("finviz down")
        return ([{"sym": "AAA", "pct": "+9.00%"}],
                [{"sym": "ZZZ", "pct": "-7.00%"}],
                self.finviz_ok)

    def get_batch_snapshots(self, syms):
        with self._lock:
            self.recomputes += 1
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(WAIT)
        if self.overlay_fails:
            raise RuntimeError("massive batch down")
        return {"AAA": self.pct, "ZZZ": -self.pct}

    def client(self):
        return self


@pytest.fixture
def mov(monkeypatch, clock):
    p = _FakeMoversProviders()
    monkeypatch.setattr(massive, "_fetch_finviz_movers_checked", p.finviz)
    monkeypatch.setattr(massive, "_get_client", p.client)
    # warm_bars_async is a side effect of the route; keep it off the network.
    import api.routers.bars as bars_router
    monkeypatch.setattr(bars_router, "warm_bars_async", lambda *a, **k: None)
    return p


def _get_movers_route():
    resp = Response()
    body = movers_router.movers(response=resp, user=USER)
    return body, resp


def _aaa(body) -> str:
    return body["ripping"][0]["pct"]


def test_movers_expired_ttl_serves_last_good_at_once_and_one_refresh_runs(mov, clock):
    """(a) for /api/movers."""
    body, resp = _get_movers_route()
    assert _tier(resp) == "fetch" and mov.recomputes == 1
    last_good = _aaa(body)

    clock.advance(massive.MOVERS_TTL + 5)
    mov.pct = 11.0
    mov.entered.clear()
    mov.gate = threading.Event()

    results = _run_concurrently(_get_movers_route, 8)
    assert all(_aaa(b) == last_good for b, _ in results)
    assert all(_tier(r) == "stale-swr" for _, r in results)
    assert mov.entered.wait(WAIT)
    assert mov.recomputes == 2, (
        f"{mov.recomputes - 1} recomputes for 8 expired requests - single-flight broke")

    mov.gate.set()
    _drain(movers_router._MOVERS_STALE)
    body, resp = _get_movers_route()
    assert _aaa(body) == "+11.00%" and _tier(resp) == "mem"


def test_movers_failed_recompute_keeps_serving_last_good_marked_stale(mov, clock):
    """(b) A refresh that RAISES (Finviz blew up past its own guard) keeps
    last-good, marked stale-swr."""
    body, _ = _get_movers_route()
    last_good = _aaa(body)

    clock.advance(massive.MOVERS_DISCOVERY_TTL + 5)         # discovery lapsed too
    mov.finviz_raises = True
    body, resp = _get_movers_route()
    assert _aaa(body) == last_good and _tier(resp) == "stale-swr"
    _drain(movers_router._MOVERS_STALE)
    assert cache.get("movers") is None

    body, resp = _get_movers_route()
    assert _aaa(body) == last_good and _tier(resp) == "stale-swr"
    _drain(movers_router._MOVERS_STALE)


@pytest.mark.parametrize("failure", ["finviz_export", "massive_overlay"])
def test_movers_partial_recompute_is_never_remembered_as_last_good(mov, clock, failure):
    """(b) cache_policy's rule on both legs: a Finviz export that failed (it
    swallows its error and parses to []) or a Massive overlay that failed
    marks the rebuild partial — served on the short TTL, never the fallback."""
    body, _ = _get_movers_route()
    last_good = _aaa(body)

    clock.advance(massive.MOVERS_DISCOVERY_TTL + 5)
    mov.pct = 12.0
    if failure == "finviz_export":
        mov.finviz_ok = False
    else:
        mov.overlay_fails = True
    _body, resp = _get_movers_route()
    assert _tier(resp) == "stale-swr"
    _drain(movers_router._MOVERS_STALE)

    slot_value, _age = movers_router._MOVERS_STALE.peek("movers")
    assert _aaa(slot_value[0]) == last_good, "a partial rebuild became the fallback"
    assert slot_value[1] is True

    _body, resp = _get_movers_route()                        # the partial, served
    assert _tier(resp) == "mem"

    clock.advance(massive.MOVERS_TTL_PARTIAL + 1)
    body, resp = _get_movers_route()
    assert _aaa(body) == last_good and _tier(resp) == "stale-swr"
    _drain(movers_router._MOVERS_STALE)


def test_movers_cold_start_behaves_as_before(mov, clock):
    """(c) No last-good: one synchronous build returning exactly what
    `get_movers()` returns; a raise is still a 503."""
    body, resp = _get_movers_route()
    assert _tier(resp) == "fetch" and mov.recomputes == 1
    assert body == {"ripping": [{"sym": "AAA", "pct": "+8.00%"}],
                    "drilling": [{"sym": "ZZZ", "pct": "-8.00%"}]}
    assert body == massive.get_movers()                      # the cached value

    cache.invalidate("movers")
    cache.invalidate("movers_discovery")
    movers_router._MOVERS_STALE.forget("movers")
    mov.finviz_raises = True
    with pytest.raises(HTTPException) as exc:
        _get_movers_route()
    assert exc.value.status_code == 503


def test_get_movers_other_callers_never_see_a_stale_list(mov, clock):
    """The serve-stale slot is ROUTER-level: `massive.get_movers()` (which the
    catalyst engine writes catalyst rows from) still rebuilds on expiry."""
    _get_movers_route()
    clock.advance(massive.MOVERS_DISCOVERY_TTL + 5)
    mov.pct = 13.0
    assert _aaa(massive.get_movers()) == "+13.00%"
    assert mov.recomputes == 2


def test_server_timing_matches_the_bars_shape():
    st = serve_stale_mod.server_timing("snapshot", "stale-swr", 1.5, 20.0)
    assert st == 'snapshot;desc="stale-swr";dur=1.5, stale-age;dur=20000'
    assert serve_stale_mod.server_timing("movers", "mem", 0.5) == 'movers;desc="mem";dur=0.5'
