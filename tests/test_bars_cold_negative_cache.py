"""A symbol NO provider has stops answering "warming" once every provider has said so.

⛔ MEASURED ON PRODUCTION 2026-10-08/09: `/api/bars/ZZQXV?tf=D` (a made-up ticker)
answered 503 `{"error":"warming"}` on every request, indefinitely. Each request found
SQLite empty, kicked another cold background fetch, and promised "re-poll" again; the
fetch found nothing at any provider, so the promise was never kept. The chart spun
until the frontend gave up, and `discord_render.symbols.resolve` -- whose last
authority is /api/bars' own verdict -- could never call a real typo UNKNOWN.

⭐ EVERY CASE DRIVES THE REAL REQUEST PATH: `serve_bars` -> `_get_bars_inner`'s cold
branch -> `_kick_cold_fetch` -> `_do_cold_fetch` -> the real provider functions, with
only the network edge (`massive._get_client`, `yfinance_pool.fetch_history`) and the
store stubbed. The background pool is replaced by a queue the test drains, so "the
request that kicked the fetch" and "the request after it landed" are separate asks,
exactly as on production.

⚠️ THE NARROWNESS IS THE POINT. A transient provider failure (timeout, 5xx, breaker
open) must NOT be negative-cached -- that would turn an outage into "this ticker has
no data". And a real-but-cold symbol must keep warming and then serve.
"""
from __future__ import annotations

import httpx
import pandas as pd
import pytest

from api.routers import bars
from api.services import bars_fetch, massive, source_circuit_breaker as scb


class _QueuePool:
    """Stands in for `_cold_bg_pool`: holds submitted jobs until the test drains them."""

    def __init__(self):
        self.jobs = []

    def submit(self, fn, *a, **kw):
        self.jobs.append((fn, a, kw))

    def drain(self):
        jobs, self.jobs = self.jobs, []
        for fn, a, kw in jobs:
            fn(*a, **kw)
        return len(jobs)


class _FakeMassiveClient:
    _api_key = "test-key"

    def __init__(self, answer):
        self.answer = answer
        self.calls = 0

    def _get(self, url, timeout=None):
        self.calls += 1
        if isinstance(self.answer, BaseException):
            raise self.answer
        return self.answer


def _http_error(status):
    req = httpx.Request("GET", "https://api.massive.com/v2/aggs/ticker/X")
    return httpx.HTTPStatusError(f"{status}", request=req,
                                 response=httpx.Response(status, request=req))


@pytest.fixture
def env(monkeypatch):
    pool = _QueuePool()
    monkeypatch.setattr(bars_fetch, "_cold_bg_pool", pool)
    monkeypatch.setattr(bars_fetch, "_cold_bg_inflight", set())
    monkeypatch.setattr(bars_fetch, "_cold_negative", {}, raising=False)
    # An empty store: every request reaches the cold branch.
    monkeypatch.setattr(bars_fetch._sqlite, "get_last_ts", lambda t, tf: None)
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda *a, **k: [])
    writes = []
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars",
                        lambda t, tf, rows, date_tf=False: writes.append((t, tf, len(rows))))
    monkeypatch.setattr(bars_fetch.disk_cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_yf_daily_in_backoff", lambda t: False)
    monkeypatch.setattr(scb, "_attempts", {}, raising=False)
    monkeypatch.setattr(scb, "is_ok", lambda s, now=None: True)
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    # The router: ZZQXV is in no list we hold (production state for a typo).
    monkeypatch.setattr(bars, "_CARRIED", frozenset({"AAPL", "XYZ"}))
    from api.services import delisted_registry, ticker_search_index as tsi
    monkeypatch.setattr(tsi, "contains", lambda s: s in env_state["searchable"])
    monkeypatch.setattr(delisted_registry, "resolve", lambda s: None)
    monkeypatch.setattr(massive, "todays_daily_bar", lambda t: None)
    env_state = {"searchable": set()}

    def set_massive(answer):
        client = _FakeMassiveClient(answer)
        monkeypatch.setattr(massive, "_get_client", lambda: client)
        monkeypatch.setattr(bars_fetch, "_get_client", lambda: client)  # intraday imports it by name
        return client

    def set_yf(answer):
        from api.services import yfinance_pool

        def _fetch(*a, **k):
            if isinstance(answer, BaseException):
                raise answer
            return answer
        monkeypatch.setattr(yfinance_pool, "fetch_history", _fetch)

    set_massive({"results": []})
    set_yf(pd.DataFrame())

    class E:
        pass
    e = E()
    e.pool, e.writes, e.set_massive, e.set_yf = pool, writes, set_massive, set_yf
    e.searchable = env_state["searchable"]
    return e


def _neg(ticker, tf):
    # getattr: the pre-fix tree has no negative cache, and these guards must still run there
    return getattr(bars_fetch, "cold_negative", lambda t, f: False)(ticker, tf)


def _get(ticker, tf="D"):
    return bars.serve_bars(ticker, tf=tf, bars=600, since="", to="")


def _body(r):
    import json
    return json.loads(r.body)


def test_a_ticker_NO_PROVIDER_HAS_stops_warming_once_the_fetch_has_landed(env):
    """⛔ THE ZZQXV DEFECT. Without the fix the second and third asks are warming 503s."""
    first = _get("ZZQXV")
    assert first.status_code == 503 and _body(first)["error"] == "warming", (
        "the first ask must still promise a fetch — it has not looked yet")
    assert env.pool.drain() == 1

    second = _get("ZZQXV")
    assert second.status_code == 200, "a fetch that found nothing anywhere re-promised 'warming'"
    body = _body(second)
    assert body["bars"] == [] and body["no_data"] is True
    assert body["reason"] == "no_provider_data", body
    assert second.headers.get("Retry-After") is None
    # …and it stops re-asking the providers on every request.
    assert _get("ZZQXV").status_code == 200
    assert env.pool.jobs == [], "a negative-cached key kicked another provider fetch"


def test_a_SEARCHABLE_symbol_no_provider_has_also_stops_spinning(env):
    """Carried-ness does not matter here: a symbol Search offers but no provider has
    bars for spun just the same. The answer names the cause, not the list."""
    env.searchable.add("ZZQXV")
    assert _get("ZZQXV").status_code == 503
    env.pool.drain()
    r = _get("ZZQXV")
    assert r.status_code == 200 and _body(r)["reason"] == "no_provider_data"


@pytest.mark.parametrize("failure", [
    httpx.ConnectTimeout("timed out"),
    _http_error(500),
    _http_error(429),
], ids=["timeout", "5xx", "rate-limited"])
def test_a_TRANSIENT_massive_failure_is_never_negative_cached(env, failure):
    """⚠️ An outage is not "no data". Massive swallows the error and answers [] —
    the side channel is what keeps this case warming and retrying."""
    env.set_massive(failure)
    assert _get("ZZQXV").status_code == 503
    env.pool.drain()
    r = _get("ZZQXV")
    assert r.status_code == 503 and _body(r)["error"] == "warming", (
        "a transient provider failure was cached as 'no provider has this ticker'")
    assert len(env.pool.jobs) == 1, "the retry fetch was not kicked"
    assert not _neg("ZZQXV", "D")


def test_a_yfinance_TIMEOUT_keeps_the_retry_even_when_massive_was_empty(env):
    from concurrent.futures import TimeoutError as FutTimeout
    env.set_yf(FutTimeout())
    _get("ZZQXV")
    env.pool.drain()
    assert _get("ZZQXV").status_code == 503
    assert not _neg("ZZQXV", "D")


def test_a_massive_404_IS_an_answer(env):
    """Massive answers a bare 404 for a symbol it does not have — that is a "no",
    not a failure, and must not keep the symbol warming forever."""
    env.set_massive(_http_error(404))
    _get("ZZQXV")
    env.pool.drain()
    r = _get("ZZQXV")
    assert r.status_code == 200 and _body(r)["reason"] == "no_provider_data"


def test_an_INTRADAY_fetch_with_the_massive_breaker_open_is_not_an_answer(env, monkeypatch):
    """The breaker skips Massive entirely — it was never asked, so "nothing" proves nothing."""
    monkeypatch.setattr(scb, "is_ok", lambda s, now=None: s != "massive")
    assert _get("ZZQXV", tf="5").status_code == 503
    env.pool.drain()
    assert _get("ZZQXV", tf="5").status_code == 503
    assert not _neg("ZZQXV", "5")


def test_an_INTRADAY_fetch_every_source_answered_empty_is_cached(env):
    assert _get("ZZQXV", tf="5").status_code == 503
    env.pool.drain()
    r = _get("ZZQXV", tf="5")
    assert r.status_code == 200 and _body(r)["reason"] == "no_provider_data"
    # per (ticker, tf): the daily key has not been asked and still warms
    assert _get("ZZQXV", tf="D").status_code == 503


def test_a_REAL_but_cold_symbol_still_warms_and_its_fetch_writes_rows(env):
    """⭐ BFRG / SNGX / GDX: the fetch finds bars, writes them, and the symbol is
    never remembered as empty — the next ask reads the store, not a verdict."""
    env.searchable.add("GDX")
    env.set_massive({"results": [
        {"t": 1_759_708_800_000 + i * 86_400_000, "o": 50.0, "h": 51.0, "l": 49.0,
         "c": 50.5, "v": 1_000_000} for i in range(5)]})
    first = _get("GDX")
    assert first.status_code == 503 and _body(first)["error"] == "warming"
    env.pool.drain()
    assert env.writes and env.writes[0][:2] == ("GDX", "D"), env.writes
    assert not _neg("GDX", "D")
    # the stub store stays empty, so this is a fresh cold ask — still warming, never no_data
    assert _get("GDX").status_code == 503


def test_the_negative_answer_EXPIRES(env, monkeypatch):
    monkeypatch.setattr(bars_fetch, "_COLD_NEGATIVE_TTL_S", -1.0)
    _get("ZZQXV")
    env.pool.drain()
    assert _get("ZZQXV").status_code == 503, "an expired negative still answered no_data"


def test_the_negative_cache_is_BOUNDED(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_cold_negative", {}, raising=False)
    monkeypatch.setattr(bars_fetch, "_COLD_NEGATIVE_MAX", 3)
    for i in range(10):
        bars_fetch._record_cold_negative(f"T{i}", "D")
    assert len(bars_fetch._cold_negative) == 3


# ── the consumer: symbol_presence / discord_render.symbols.resolve ───────────

def test_resolve_calls_the_typo_UNKNOWN_once_bars_has_looked(env):
    """⭐ The point of the fix for `symbol_presence`. Before the fetch lands /api/bars
    honestly cannot say, so resolve is UNANSWERABLE (and marks nothing); after it
    lands, the verdict is `no_data` and resolve answers UNKNOWN."""
    from api.services.discord_render import symbols

    def resolve(s):
        return symbols.resolve(s, checks=(), index_ready=lambda: True,
                               confirm=lambda x: symbols.bars_verdict(x, serve=bars.serve_bars),
                               suggest=False)

    assert resolve("ZZQXV").status == symbols.UNANSWERABLE
    env.pool.drain()
    assert resolve("ZZQXV").status == symbols.UNKNOWN

    from api.services import symbol_presence
    symbol_presence._reset_for_tests()
    try:
        def _r(s):
            res = resolve(s)
            return res.status, res.symbol, res.suggestions, symbols.UNKNOWN
        marker = symbol_presence.unknown_marker("ZZQXV", resolve=_r)
        assert marker.get("not_found") is True, marker
    finally:
        symbol_presence._reset_for_tests()


def test_resolve_stays_UNANSWERABLE_through_a_provider_outage(env):
    from api.services.discord_render import symbols
    env.set_massive(httpx.ConnectTimeout("timed out"))
    confirm = lambda x: symbols.bars_verdict(x, serve=bars.serve_bars)  # noqa: E731
    symbols.resolve("ZZQXV", checks=(), index_ready=lambda: True, confirm=confirm, suggest=False)
    env.pool.drain()
    res = symbols.resolve("ZZQXV", checks=(), index_ready=lambda: True, confirm=confirm,
                          suggest=False)
    assert res.status == symbols.UNANSWERABLE, "an outage told a member their ticker does not exist"
