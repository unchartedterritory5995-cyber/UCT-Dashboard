"""TERM-082 (census rank 3): `/api/earnings` + `/api/earnings-gaps` adopt serve-stale.

Both routes read `engine.get_earnings()`'s list, which sat on a 30-minute TTL
with a miss that runs EarningsWhispers + Finnhub + FMP + Massive sequentially
(worst ~60 s). CatalystFlow polls `/api/earnings-gaps` every 30 s, so the member
whose poll landed after the cliff paid the rebuild, and every `/api/push`
invalidated the list so the first reader after the morning wire paid it too.
They now serve the last COMPLETE list while one refresh runs behind the caller.

What each test pins:
  (a) after the TTL lapses, N concurrent requests (both routes) get last-good
      at once, marked `stale-swr`, and exactly ONE recompute runs; a cold herd
      collapses onto one build;
  (b) a refresh that raises, or returns a PARTIAL (a provider leg failed),
      keeps serving last-good marked stale; the partial is served on its short
      TTL and never becomes last-good;
  (c) a cold start behaves as before: one synchronous build, the built payload
      returned, a raise still a 503 on /api/earnings and still propagates on
      /api/earnings-gaps;
  (d) a wire push kicks one refresh immediately, readers get the pre-push list
      marked stale until it lands, and a build that straddled the push is never
      remembered;
  plus: callers of `engine.get_earnings()` other than the routes never see a
  served-stale list.

The real `engine.build_earnings` runs against FAKE providers and an injected
clock, so no network is touched and "the TTL lapsed" is a clock move.
"""
from __future__ import annotations

import datetime
import threading
import time as _real_time

import pytest
from fastapi import HTTPException, Response

from api.routers import earnings as earnings_router
from api.routers import push as push_router
from api.services import cache as cache_mod
from api.services import engine
from api.services import massive
from api.services import serve_stale as serve_stale_mod
from api.services.cache import cache

WAIT = 5.0
SLOT = earnings_router._EARNINGS_STALE


class _Clock:
    def __init__(self, t: float = 2_000_000.0):
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
    keys = ("earnings", "earnings_gaps_live")
    prior_wire = cache.get("wire_data")
    for k in keys + ("wire_data",):
        cache.invalidate(k)
    yield
    for k in keys:
        cache.invalidate(k)
    cache.invalidate("wire_data")
    if prior_wire is not None:
        cache.set("wire_data", prior_wire, ttl=3600)


class _FakeEarningsProviders:
    """EarningsWhispers, Finnhub, FMP, Massive and the wire for
    `engine.build_earnings`. One RECOMPUTE = one EW call for TODAY (the first
    provider call of every build). The BMO actual is read at build START, so a
    build carries the value that was current when it began."""

    def __init__(self):
        self.eps = 1.10
        self.recomputes = 0
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self.ew_fails = False
        self.fh_fails = False
        self.fmp_ok = True
        self.overlay_fails = False
        self.wire_raises = False
        self.fh_calls = 0
        self._lock = threading.Lock()

    @staticmethod
    def _today() -> str:
        return datetime.date.today().isoformat()

    def ew(self, date_str: str) -> list:
        if date_str == self._today():
            eps = self.eps
            with self._lock:
                self.recomputes += 1
            self.entered.set()
            if self.gate is not None:
                self.gate.wait(WAIT)
            if self.ew_fails:
                raise RuntimeError("earningswhispers blocked")
            return [
                {"symbol": "AAA", "hour": "bmo", "eps_actual": eps, "eps_estimate": 1.0,
                 "rev_actual": None, "rev_estimate": None, "ew_total": 10},
                {"symbol": "TTT", "hour": "amc", "eps_actual": None, "eps_estimate": 0.5,
                 "rev_actual": None, "rev_estimate": None, "ew_total": 5},
            ]
        if self.ew_fails:
            raise RuntimeError("earningswhispers blocked")
        return [{"symbol": "YYY", "hour": "amc", "eps_actual": 2.0, "eps_estimate": 1.5,
                 "rev_actual": None, "rev_estimate": None, "ew_total": 7}]

    def fh_get(self, path, params, timeout=None, **_kw):
        with self._lock:
            self.fh_calls += 1
        if self.fh_fails:
            return None                       # fh_get's failure answer
        return {"earningsCalendar": []}

    def fmp(self, day_iso):
        return {}, self.fmp_ok

    def wire(self):
        if self.wire_raises:
            raise RuntimeError("wire unreadable")
        return cache.get("wire_data")

    def get_batch_snapshots(self, syms):
        if self.overlay_fails:
            raise RuntimeError("massive batch down")
        return {s: 3.0 for s in syms}

    def client(self):
        return self


@pytest.fixture
def earn(monkeypatch, clock):
    p = _FakeEarningsProviders()
    monkeypatch.setattr(engine, "_fetch_ew_live", p.ew)
    monkeypatch.setattr(engine, "_load_wire_data", p.wire)
    monkeypatch.setattr(engine, "_fmp_calendar_actuals_for_day_checked", p.fmp)
    monkeypatch.setattr(engine, "_prewarm_earnings_analysis", lambda data: None)
    monkeypatch.setattr(massive, "_get_client", p.client)
    import api.services.finnhub_client as fh_client
    monkeypatch.setattr(fh_client, "fh_get", p.fh_get)
    monkeypatch.setenv("FINNHUB_API_KEY", "fake-finnhub")
    import api.routers.bars as bars_router
    monkeypatch.setattr(bars_router, "warm_bars_async", lambda *a, **k: None)
    return p


def _drain(timeout: float = WAIT) -> None:
    deadline = _real_time.monotonic() + timeout
    while _real_time.monotonic() < deadline:
        with SLOT._lock:
            if not SLOT._refreshing:
                return
        _real_time.sleep(0.01)
    raise AssertionError("background refresh never finished")


def _tier(resp: Response) -> str:
    st = resp.headers.get("Server-Timing", "")
    return st.split('desc="', 1)[1].split('"', 1)[0] if 'desc="' in st else ""


def _get_earnings_route():
    resp = Response()
    return earnings_router.earnings(response=resp), resp


def _get_gaps_route():
    resp = Response()
    return earnings_router.earnings_gaps(response=resp), resp


def _aaa(body) -> float:
    return body["bmo"][0]["reported_eps"]


def _run_concurrently(fns):
    results, errors = [None] * len(fns), []

    def _one(i):
        try:
            results[i] = fns[i]()
        except Exception as e:           # surfaced below
            errors.append(e)

    threads = [threading.Thread(target=_one, args=(i,)) for i in range(len(fns))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads), \
        "a request blocked on the rebuild instead of being served the stale copy"
    assert not errors, errors
    return results


# ══════════════════════════════════ (a) ═════════════════════════════════════

def test_expired_ttl_serves_last_good_at_once_and_one_refresh_runs(earn, clock):
    """(a) 8 concurrent requests across BOTH routes after the 30-minute cliff:
    all get last-good immediately, marked stale-swr, and exactly ONE recompute
    starts behind them."""
    body, resp = _get_earnings_route()                       # cold -> builds
    assert _tier(resp) == "fetch" and earn.recomputes == 1
    last_good = _aaa(body)

    clock.advance(engine.EARNINGS_TTL + 5)                   # the TTL lapsed
    cache.invalidate("earnings_gaps_live")
    earn.eps = 1.25
    earn.entered.clear()
    earn.gate = threading.Event()                            # the rebuild hangs

    results = _run_concurrently([_get_earnings_route] * 5 + [_get_gaps_route] * 3)
    earnings_results, gaps_results = results[:5], results[5:]

    assert all(_aaa(b) == last_good for b, _ in earnings_results), \
        "a request was served the rebuild instead of the last-good list"
    assert all(_tier(r) == "stale-swr" for _, r in earnings_results)
    assert all("stale-age;dur=" in r.headers["Server-Timing"] for _, r in earnings_results)
    # Gaps: the first to finish writes its own 30 s cache, so a later racer may
    # answer from it ("mem"); the ones that read the list read it stale.
    gaps_tiers = [_tier(r) for _, r in gaps_results]
    assert "stale-swr" in gaps_tiers and set(gaps_tiers) <= {"stale-swr", "mem"}
    assert all(set(b) == {"AAA", "YYY"} for b, _ in gaps_results)
    assert earn.entered.wait(WAIT), "no background refresh was kicked"
    assert earn.recomputes == 2, (
        f"{earn.recomputes - 1} recomputes for 8 expired requests - single-flight broke")

    earn.gate.set()
    _drain()
    body, resp = _get_earnings_route()                       # the refresh landed
    assert _aaa(body) == 1.25
    assert _tier(resp) == "mem" and earn.recomputes == 2


def test_concurrent_cold_requests_collapse_onto_one_build(earn, clock):
    """(a) Single-flight on the cold path: six cold requests, one build."""
    earn.gate = threading.Event()
    done = []

    def _req():
        done.append(_get_earnings_route())

    ts = [threading.Thread(target=_req) for _ in range(6)]
    for t in ts:
        t.start()
    assert earn.entered.wait(WAIT)
    earn.gate.set()
    for t in ts:
        t.join(WAIT)
    assert len(done) == 6
    assert earn.recomputes == 1
    tiers = sorted(_tier(r) for _, r in done)
    assert tiers.count("fetch") == 1 and set(tiers) <= {"fetch", "inflight-wait", "mem"}


# ══════════════════════════════════ (b) ═════════════════════════════════════

def test_failed_refresh_keeps_serving_last_good_marked_stale(earn, clock):
    """(b) A refresh that RAISES writes nothing; the next request still gets
    last-good, still stale-swr, with a growing age."""
    body, _ = _get_earnings_route()
    last_good = _aaa(body)

    clock.advance(engine.EARNINGS_TTL + 5)
    earn.wire_raises = True
    body, resp = _get_earnings_route()
    assert _aaa(body) == last_good and _tier(resp) == "stale-swr"
    _drain()
    assert cache.get("earnings") is None

    clock.advance(60)
    body, resp = _get_earnings_route()
    assert _aaa(body) == last_good and _tier(resp) == "stale-swr"
    age_ms = float(resp.headers["Server-Timing"].split("stale-age;dur=")[1])
    assert age_ms >= (engine.EARNINGS_TTL + 65) * 1000
    _drain()


@pytest.mark.parametrize("attr,value", [
    ("ew_fails", True),          # EarningsWhispers down -> wire_data fallback
    ("fh_fails", True),          # Finnhub calendar call returned no body
    ("fmp_ok", False),           # FMP breadth fallback degraded
    ("overlay_fails", True),     # Massive change_pct overlay raised
])
def test_partial_refresh_is_never_remembered_as_last_good(earn, clock, attr, value):
    """(b) cache_policy's rule, per provider leg: a partial rebuild is served
    on the SHORT TTL, never becomes the fallback, and once that TTL lapses
    last-good is served again, marked stale."""
    body, _ = _get_earnings_route()
    last_good = _aaa(body)
    assert SLOT.peek(earnings_router._slot_key())[0][1] is True

    clock.advance(engine.EARNINGS_TTL + 5)
    earn.eps = 1.40
    setattr(earn, attr, value)
    _body, resp = _get_earnings_route()                      # stale; kicks refresh
    assert _tier(resp) == "stale-swr"
    _drain()

    slot_value, _age = SLOT.peek(earnings_router._slot_key())
    assert _aaa(slot_value[0]) == last_good, "a partial rebuild became the fallback"
    assert slot_value[1] is True

    _body, resp = _get_earnings_route()                      # the partial, served
    assert _tier(resp) == "mem"

    clock.advance(engine.EARNINGS_TTL_PARTIAL + 1)           # short TTL lapsed
    body, resp = _get_earnings_route()
    assert _aaa(body) == last_good and _tier(resp) == "stale-swr"
    _drain()


def test_completeness_is_read_from_the_legs_not_the_payload(earn, clock, monkeypatch):
    """What "complete" means, from the real build: every provider leg that RAN
    answered. A leg that did not need to run is not a failure: no Finnhub key
    configured and nothing pending are answers, and "Pending" verdicts are the
    correct value before a company reports."""
    _data, complete = engine.build_earnings()
    assert complete is True and earn.fh_calls == 1          # today-AMC leg ran

    earn.fh_fails = True
    assert engine.build_earnings()[1] is False

    earn.fh_fails = False
    earn.fmp_ok = False
    assert engine.build_earnings()[1] is False

    earn.fmp_ok = True
    earn.overlay_fails = True
    assert engine.build_earnings()[1] is False

    earn.overlay_fails = False
    earn.ew_fails = True                                     # wire_data fallback
    data, complete = engine.build_earnings()
    assert complete is False and data["bmo"] == []

    earn.ew_fails = False
    monkeypatch.delenv("FINNHUB_API_KEY")                    # not configured
    calls = earn.fh_calls
    assert engine.build_earnings()[1] is True
    assert earn.fh_calls == calls                            # the leg never ran


def test_fmp_leg_reports_a_failure_distinctly_from_an_empty_day(monkeypatch):
    """The FMP breadth fallback swallowed every failure to {}, the same value
    as a quiet calendar day, so without the checked form an FMP outage would be
    cached and remembered as a complete list."""
    from api.services import fmp_client

    class _Result:
        def __init__(self, value, degraded=None):
            self.value, self.degraded = value, degraded

    answers = {"ok": _Result([{"symbol": "AAA", "epsActual": 1.0}]),
               "degraded": _Result(None, degraded="rate_limited"),
               "not_list": _Result({"error": "x"})}
    mode = {"m": "ok"}

    def _cal(frm, to, **_kw):
        if mode["m"] == "raise":
            raise RuntimeError("fmp 503")
        if mode["m"] == "unconfigured":
            raise fmp_client.FMPNotConfigured("no key", vendor="fmp")
        if mode["m"] == "not_found":
            raise fmp_client.FMPNotFound("empty day", vendor="fmp")
        return answers[mode["m"]]

    monkeypatch.setattr(fmp_client, "get_earnings_calendar", _cal)
    expect = {"ok": True, "unconfigured": True, "not_found": True,
              "degraded": False, "not_list": False, "raise": False}
    for m, ok in expect.items():
        mode["m"] = m
        day_map, day_ok = engine._fmp_calendar_actuals_for_day_checked("2026-09-28")
        assert day_ok is ok, m
        assert engine._fmp_calendar_actuals_for_day("2026-09-28") == day_map
    mode["m"] = "ok"
    assert "AAA" in engine._fmp_calendar_actuals_for_day("2026-09-28")


# ══════════════════════════════════ (c) ═════════════════════════════════════

def test_cold_start_behaves_as_before(earn, clock):
    """(c) No last-good: one synchronous build, the built payload returned
    exactly as `get_earnings()` caches it; a raise is still a 503 on
    /api/earnings and still propagates out of /api/earnings-gaps."""
    body, resp = _get_earnings_route()
    assert _tier(resp) == "fetch" and earn.recomputes == 1
    assert set(body) == {"bmo", "amc", "amc_tonight"}
    assert body == cache.get("earnings")
    assert body == engine.get_earnings()                     # the cached value

    cache.invalidate("earnings")
    SLOT.forget(earnings_router._slot_key())
    earn.wire_raises = True
    with pytest.raises(HTTPException) as exc:
        _get_earnings_route()
    assert exc.value.status_code == 503
    with pytest.raises(RuntimeError, match="wire unreadable"):
        _get_gaps_route()


def test_a_new_day_never_serves_yesterdays_list(earn, clock, monkeypatch):
    """The slot is keyed by date: after midnight the first reader past the TTL
    builds, it is never handed yesterday's BMO/AMC as a stale serve."""
    _get_earnings_route()
    monkeypatch.setattr(earnings_router, "_today", lambda: "2099-01-02")
    clock.advance(engine.EARNINGS_TTL + 5)
    _body, resp = _get_earnings_route()
    assert _tier(resp) == "fetch" and earn.recomputes == 2


# ══════════════════════════════════ (d) ═════════════════════════════════════

@pytest.fixture
def push(monkeypatch, tmp_path):
    """Call the real push route, with its side effects kept off disk/network."""
    monkeypatch.setenv("PUSH_SECRET", "term082-secret")
    monkeypatch.setattr(push_router, "PERSISTENT_WIRE_DATA_FILE",
                        str(tmp_path / "wire_data.json"))
    from api.services import theme_performance, wire_archive
    monkeypatch.setattr(theme_performance, "trigger_recompute", lambda *a, **k: None)
    monkeypatch.setattr(wire_archive, "record", lambda *a, **k: None)

    def _push(payload):
        return push_router.push_wire_data(payload=payload,
                                          authorization="Bearer term082-secret")
    return _push


def test_push_kicks_one_refresh_now_and_serves_pre_push_list_marked_stale(earn, clock, push):
    """(d) A push invalidates the list because the new wire changes it (here:
    its cap_universe drops tonight's TTT). The refresh starts AT THE PUSH, not
    when a reader notices; readers during it get the pre-push list marked
    stale-swr; once it lands they get the post-push list, fresh."""
    body, _ = _get_earnings_route()
    assert [e["sym"] for e in body["amc_tonight"]] == ["TTT"]
    pre_push = _aaa(body)

    earn.entered.clear()
    earn.gate = threading.Event()
    earn.eps = 1.30
    push({"date": "2026-09-28", "cap_universe": ["AAA", "YYY"]})

    assert earn.entered.wait(WAIT), "the push did not kick a refresh"
    assert earn.recomputes == 2                              # no reader yet

    body, resp = _get_earnings_route()
    assert _aaa(body) == pre_push and _tier(resp) == "stale-swr"
    assert earn.recomputes == 2, "a reader started a second rebuild"

    earn.gate.set()
    _drain()
    body, resp = _get_earnings_route()
    assert _tier(resp) == "mem"
    assert _aaa(body) == 1.30
    assert body["amc_tonight"] == [], "the refresh did not read the pushed wire"


def test_a_build_that_straddles_a_push_is_rebuilt_and_never_remembered(earn, clock, push):
    """(d) A refresh already in flight when the push lands read the OLD wire.
    The push's own kick is a no-op while it runs, so without a guard that
    stale build would become both the cached list (for 30 minutes) and
    last-good. It must be discarded and rebuilt."""
    _get_earnings_route()                                    # last-good, eps 1.10
    clock.advance(engine.EARNINGS_TTL + 5)
    earn.entered.clear()
    earn.gate = threading.Event()
    _get_earnings_route()                                    # kicks refresh (eps 1.10)
    assert earn.entered.wait(WAIT)

    earn.eps = 1.55
    push({"date": "2026-09-28"})                            # lands mid-build
    earn.gate.set()
    _drain()

    assert earn.recomputes == 3, "the straddling build was not re-run"
    slot_value, _age = SLOT.peek(earnings_router._slot_key())
    assert _aaa(slot_value[0]) == 1.55, "a pre-push build became last-good"
    assert _aaa(cache.get("earnings")) == 1.55, "a pre-push build became the cached list"


def test_push_with_no_last_good_kicks_nothing_and_first_reader_builds(earn, clock, push):
    """(d) Nothing in the slot (nobody read the route since boot): the push
    starts no background build, and the first reader builds synchronously,
    exactly as before."""
    assert earnings_router.on_wire_push() is False
    push({"date": "2026-09-28"})
    with SLOT._lock:
        assert not SLOT._refreshing
    assert earn.recomputes == 0
    _body, resp = _get_earnings_route()
    assert _tier(resp) == "fetch" and earn.recomputes == 1


# ═══════════════════════════ non-route callers ══════════════════════════════

def test_get_earnings_other_callers_never_see_a_stale_list(earn, clock):
    """The slot is ROUTER-level: `engine.get_earnings()` (which the catalyst
    engine writes catalyst rows from, and voice/Compass tools read) returns the
    cache on a hit and otherwise rebuilds synchronously, even while the route
    holds a last-good list it would serve stale."""
    _get_earnings_route()
    assert engine.get_earnings() == cache.get("earnings") and earn.recomputes == 1

    clock.advance(engine.EARNINGS_TTL + 5)
    earn.eps = 1.60
    assert _aaa(engine.get_earnings()) == 1.60
    assert earn.recomputes == 2
    with SLOT._lock:
        assert not SLOT._refreshing, "a non-route read kicked the route's refresh"
