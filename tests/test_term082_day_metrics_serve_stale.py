"""TERM-082 (census rank 6): `/api/calendar/day-metrics-batch` adopts serve-stale.

`/calendar`'s week view polls the batch every 2 minutes against today's 120 s
TTL, and a miss walks the dates serially: one Finviz Elite export (15 s timeout)
per date plus a Massive fallback. Nothing warms it. Each date is now read
through a bounded serve-stale slot (keys vary by date) that serves the last
COMPLETE day while one refresh per date runs behind the caller.

What each test pins:
  (a) after today's TTL lapses, N concurrent batch requests get last-good at
      once, marked `stale-swr`, and exactly ONE Finviz recompute runs; a cold
      herd collapses onto one build; a batch's header names its stalest date;
  (b) a refresh that raises, or returns a PARTIAL (the Finviz leg ran and
      failed, even when Massive filled the gaps), keeps serving last-good
      marked stale; the partial is served on its short TTL and never becomes
      last-good; a past date stops pinning the Massive proxy for 24 h;
  (c) a cold start behaves as before: one synchronous build, the built payload
      returned; an unresolvable date answers {} and is never remembered; the
      slot is bounded;
  plus: callers of `get_day_metrics()` other than the batch route (week poster,
  earnings warm, coverage monitor, week flattening) never see a stale answer.

The real `build_day_metrics` runs against a FAKE Finviz export and a FAKE
Massive client, with an injected clock, so no network is touched.
"""
from __future__ import annotations

import datetime
import threading
import time as _real_time

import pytest
from fastapi import Response

from api.routers import calendar as cal
from api.services import cache as cache_mod
from api.services import serve_stale as serve_stale_mod
from api.services.cache import cache

WAIT = 5.0
SLOT = cal._METRICS_STALE
TODAY = datetime.date(2026, 9, 29)
TODAY_S = TODAY.isoformat()
TOMORROW_S = (TODAY + datetime.timedelta(days=1)).isoformat()
PAST_S = "2026-07-20"


class _Clock:
    def __init__(self, t: float = 4_000_000.0):
        self.t = t

    def time(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class _Resp:
    def __init__(self, text, ok=True):
        self.text = text
        self.ok = ok


def _csv(price: float) -> str:
    return ('"Ticker","Market Cap","Average Volume","Price","Volume"\r\n'
            f'"AAPL","4572794.13","56908.91","{price}","34437191"\r\n'
            f'"MSFT","3700000.00","18108.34","{price + 1}","11250258"\r\n')


class _FakeProviders:
    """Finviz Elite export (`requests.get`) + the Massive rich-snapshot
    fallback. One RECOMPUTE = one Finviz call (one per date built)."""

    def __init__(self):
        self.price = 313.33
        self.recomputes = 0
        self.mode = "ok"                 # ok | raise | notok | empty
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self.massive_calls = 0
        self.massive_empty = False
        self._lock = threading.Lock()

    def finviz_get(self, url, **kw):
        with self._lock:
            self.recomputes += 1
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(WAIT)
        if self.mode == "raise":
            raise ConnectionError("finviz down")
        if self.mode == "notok":
            return _Resp("", ok=False)
        if self.mode == "empty":
            return _Resp("")
        return _Resp(_csv(self.price))

    def get_batch_rich_snapshots(self, syms):
        self.massive_calls += 1
        if self.massive_empty:
            return {}
        return {"AAPL": {"price": 999.0, "vol": 44_000_000},
                "MSFT": {"price": 888.0, "vol": 22_000_000}}


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(cache_mod, "time", c)
    monkeypatch.setattr(serve_stale_mod, "time", c)
    return c


@pytest.fixture
def prov(monkeypatch, clock):
    p = _FakeProviders()
    monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
    monkeypatch.setattr(cal, "_today_et", lambda: TODAY)
    monkeypatch.setattr(cal, "_days_for_date", lambda d: {"fake": "day"})
    monkeypatch.setattr(cal, "_day_entries",
                        lambda day: [{"sym": "AAPL", "mc_b": 3000.0}, {"sym": "MSFT"}])
    monkeypatch.setattr("requests.get", p.finviz_get)
    monkeypatch.setattr("api.services.massive._get_client", lambda: p)
    return p


def _all_keys():
    base = [TODAY_S, TOMORROW_S, PAST_S]
    extra = [(TODAY + datetime.timedelta(days=i)).isoformat() for i in range(2, 25)]
    return [f"calendar_metrics_{d}" for d in base + extra]


@pytest.fixture(autouse=True)
def _isolate_cache():
    for k in _all_keys():
        cache.invalidate(k)
    yield
    for k in _all_keys():
        cache.invalidate(k)


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


def _batch(dates: str = TODAY_S):
    resp = Response()
    body = cal.get_day_metrics_batch(response=resp, dates=dates)
    return body, resp


def _aapl(body, d: str = TODAY_S):
    return body[d]["AAPL"]["price"]


def _slot_aapl(d: str = TODAY_S):
    value, _age = SLOT.peek(f"calendar_metrics_{d}")
    return None if value is None else value[0]["AAPL"]["price"]


def _ttl_remaining(key: str, clock) -> float:
    _value, expires_at = cache._store[key]
    return expires_at - clock.t


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

def test_expired_day_serves_last_good_at_once_and_one_refresh_runs(prov, clock):
    """(a) N concurrent batch requests after today's 120 s TTL: all get
    last-good at once, marked stale-swr with an age, and ONE Finviz recompute."""
    body, resp = _batch()                                    # cold -> builds
    assert _tier(resp) == "fetch" and prov.recomputes == 1
    assert _aapl(body) == 313.33

    clock.advance(cal._METRICS_TTL + 1)                      # the TTL lapsed
    prov.price = 400.0
    prov.entered.clear()
    prov.gate = threading.Event()                            # the rebuild hangs

    results = _run_concurrently(_batch, 8)

    assert all(_aapl(b) == 313.33 for b, _ in results), \
        "a request was served the rebuild instead of the last-good day"
    assert all(_tier(r) == "stale-swr" for _, r in results)
    assert all("stale-age;dur=" in r.headers["Server-Timing"] for _, r in results)
    assert prov.entered.wait(WAIT), "no background refresh was kicked"
    assert prov.recomputes == 2, (
        f"{prov.recomputes - 1} Finviz recomputes for 8 expired requests")

    prov.gate.set()
    _drain()
    body, resp = _batch()                                    # the refresh landed
    assert _aapl(body) == 400.0
    assert _tier(resp) == "mem" and prov.recomputes == 2


def test_concurrent_cold_requests_collapse_onto_one_build(prov, clock):
    """(a) Single-flight on the cold path: one Finviz export, not N."""
    prov.gate = threading.Event()
    results = []

    def _req():
        results.append(_batch())

    threads = [threading.Thread(target=_req) for _ in range(6)]
    for t in threads:
        t.start()
    assert prov.entered.wait(WAIT)
    _real_time.sleep(0.2)
    prov.gate.set()
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads)

    assert prov.recomputes == 1, f"{prov.recomputes} builds for one cold herd"
    tiers = [_tier(r) for _, r in results]
    assert tiers.count("fetch") == 1
    assert set(tiers) - {"fetch"} <= {"mem", "inflight-wait"}, tiers
    assert all(_aapl(b) == 313.33 for b, _ in results)


def test_a_batch_header_names_its_stalest_date(prov, clock):
    """(a) One stale date among fresh ones is not hidden: the batch's
    Server-Timing carries the stalest tier and that date's age."""
    _batch(f"{TODAY_S},{TOMORROW_S}")                        # both built cold
    clock.advance(cal._METRICS_TTL + 1)       # today (120 s) lapsed; tomorrow (1 h) did not

    body, resp = _batch(f"{TODAY_S},{TOMORROW_S}")
    assert _tier(resp) == "stale-swr"
    assert _stale_age_ms(resp) >= (cal._METRICS_TTL + 1) * 1000
    assert set(body) == {TODAY_S, TOMORROW_S}
    _drain()


# ═════════════════════════ (b) failing / partial refresh ══════════════════════

def test_a_finviz_failure_is_partial_even_when_massive_fills_it(prov, clock):
    """(b) The Finviz leg ran and failed; Massive filled price and a prev-day
    volume proxy. That day is served on its short TTL, never remembered, and
    last-good answers again once it lapses."""
    _batch()
    clock.advance(cal._METRICS_TTL + 1)
    prov.mode = "raise"

    body, resp = _batch()                         # stale, kicks the refresh
    assert _aapl(body) == 313.33 and _tier(resp) == "stale-swr"
    _drain()

    body, resp = _batch()                         # the partial, from the cache
    assert _tier(resp) == "mem"
    assert _aapl(body) == 999.0                   # Massive's fill
    assert _slot_aapl() == 313.33, "a Finviz-failed day became last-good"

    clock.advance(cal._METRICS_TTL + 1)           # the partial's TTL lapsed
    body, resp = _batch()
    assert _tier(resp) == "stale-swr" and _aapl(body) == 313.33
    _drain()


def test_a_raising_refresh_keeps_last_good_marked_stale(prov, clock, monkeypatch):
    """(b) A refresh that raises writes nothing: last-good keeps being served,
    still stale-swr, with a growing age."""
    _batch()
    clock.advance(cal._METRICS_TTL + 1)

    def _boom(d):
        raise RuntimeError("week cache unreadable")

    monkeypatch.setattr(cal, "_days_for_date", _boom)

    body, resp = _batch()
    assert _aapl(body) == 313.33 and _tier(resp) == "stale-swr"
    first_age = _stale_age_ms(resp)
    _drain()
    assert cache.get(f"calendar_metrics_{TODAY_S}") is None
    assert _slot_aapl() == 313.33

    clock.advance(60)
    body, resp = _batch()
    assert _aapl(body) == 313.33 and _tier(resp) == "stale-swr"
    assert _stale_age_ms(resp) > first_age
    _drain()


@pytest.mark.parametrize("mode, token, massive_empty, complete", [
    ("ok", True, False, True),
    ("raise", True, False, False),         # Finviz raised
    ("notok", True, False, False),         # Finviz answered non-2xx
    ("empty", True, False, False),         # Finviz answered an empty body
    ("ok", False, False, True),            # no token: the leg never ran
    ("raise", True, True, False),          # a total miss
])
def test_the_completeness_predicate_reads_the_legs(prov, clock, monkeypatch,
                                                  mode, token, massive_empty, complete):
    """(b) `build_day_metrics` reports complete only when price and avg_vol
    are each filled AND a Finviz leg that ran did not fail."""
    prov.mode = mode
    prov.massive_empty = massive_empty
    if not token:
        monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
        monkeypatch.delenv("FINVIZ_TOKEN", raising=False)
    _payload, got = cal.build_day_metrics(TODAY_S)
    assert got is complete


def test_a_past_date_no_longer_pins_a_finviz_failure_for_24h(prov, clock):
    """(b) A past date normally holds 24 h. With the Finviz leg failed, the
    Massive-filled day now holds the short TTL; today's TTL is unchanged."""
    prov.mode = "raise"
    cal.build_day_metrics(PAST_S)
    assert _ttl_remaining(f"calendar_metrics_{PAST_S}", clock) <= cal._METRICS_FAIL_TTL

    cal.build_day_metrics(TODAY_S)
    assert _ttl_remaining(f"calendar_metrics_{TODAY_S}", clock) == cal._METRICS_TTL

    cache.invalidate(f"calendar_metrics_{PAST_S}")
    prov.mode = "ok"                                          # control
    cal.build_day_metrics(PAST_S)
    assert _ttl_remaining(f"calendar_metrics_{PAST_S}", clock) == 24 * 3600


# ═════════════════════════════════ (c) cold start ═════════════════════════════

def test_cold_start_builds_once_and_returns_what_it_cached(prov, clock):
    """(c) No last-good: one synchronous build, the payload exactly as it was
    cached, and the complete day becomes last-good."""
    body, resp = _batch()
    assert _tier(resp) == "fetch" and prov.recomputes == 1
    assert body[TODAY_S] is cache.get(f"calendar_metrics_{TODAY_S}")
    assert _slot_aapl() == 313.33


def test_an_unresolvable_date_answers_empty_and_is_never_remembered(prov, clock, monkeypatch):
    """(c) A paged-out or out-of-range date answers {} as before, and {} never
    enters the slot."""
    monkeypatch.setattr(cal, "_days_for_date", lambda d: None)
    body, resp = _batch()
    assert body == {TODAY_S: {}}
    assert _tier(resp) == "fetch"
    assert SLOT.peek(f"calendar_metrics_{TODAY_S}") == (None, None)


def test_the_slot_is_bounded(prov, clock):
    """(c) Keys vary by the requested dates, so the slot holds at most
    `max_keys` of them; an evicted date just builds synchronously."""
    for i in range(2, 25):
        d = (TODAY + datetime.timedelta(days=i)).isoformat()
        cal.serve_day_metrics(d)
    assert len(SLOT._slots) <= cal.DAY_METRICS_STALE_MAX_KEYS
    assert SLOT.max_keys == cal.DAY_METRICS_STALE_MAX_KEYS


def test_the_batch_still_answers_without_a_response_and_caps_at_seven(prov, clock):
    """(c) A direct call (no Response) still answers, and the 7-date cap holds."""
    dates = ",".join((TODAY + datetime.timedelta(days=i)).isoformat() for i in range(10))
    body = cal.get_day_metrics_batch(dates=dates)
    assert len(body) == 7


# ═════════════════════════════ non-route callers ══════════════════════════════

def test_other_callers_never_see_a_stale_day(prov, clock):
    """The week poster, the earnings warm, the coverage monitor (which calls it
    POSITIONALLY) and the week flattening call `get_day_metrics` directly: a
    cache hit, else a synchronous build. Never the slot's last-good."""
    _batch()                                           # the slot holds 313.33
    clock.advance(cal._METRICS_TTL + 1)
    prov.price = 400.0

    out = cal.get_day_metrics(date_str=TODAY_S)
    assert out["AAPL"]["price"] == 400.0, "a non-route caller was served a stale day"
    assert prov.recomputes == 2
    assert cal.get_day_metrics(TODAY_S) is out         # positional, a plain hit
    assert prov.recomputes == 2
    assert isinstance(out, dict)
