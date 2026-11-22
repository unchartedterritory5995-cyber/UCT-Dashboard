"""Path B Phase 2 — /api/bars hot-path reverse-proxy to the dedicated serving tier.

These pin the canary GATE (dark by default, warm stays local, pct math) and the
async ROUTE behaviour (proxy when gated on, fallback-to-local on tier error, local
when off) WITHOUT any network — `serve_bars` and `_proxy_bars_to_tier` are
monkeypatched, so nothing here depends on a running bars-api.
"""
import json

from starlette.responses import JSONResponse

from api.routers import bars


def _clear(mp):
    for k in ("BARS_PROXY_ENABLED", "BARS_PROXY_PCT", "BARS_ORIGIN_URL"):
        mp.delenv(k, raising=False)


# ── the canary gate ───────────────────────────────────────────────────────────
def test_gate_is_dark_by_default(monkeypatch):
    _clear(monkeypatch)
    assert bars._bars_proxy_should_route("NVDA", 0) is False


def test_gate_off_when_enabled_but_pct_zero(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "0")
    assert bars._bars_proxy_should_route("NVDA", 0) is False


def test_gate_on_at_full_rollout(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route("NVDA", 0) is True


def test_gate_requires_the_enable_flag(monkeypatch):
    """pct=100 but the master switch OFF ⇒ still dark (rollback = flip the flag)."""
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "0")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route("NVDA", 0) is False


def test_warm_requests_never_proxy(monkeypatch):
    """warm=1 background web-db warms stay local even at full rollout."""
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route("NVDA", 1) is False


def test_gate_bad_pct_value_is_dark(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "not-a-number")
    assert bars._bars_proxy_should_route("NVDA", 0) is False


# ── the async route ───────────────────────────────────────────────────────────
async def test_route_serves_local_when_proxy_off(monkeypatch):
    _clear(monkeypatch)  # no origin, no flag ⇒ local
    seen = {}

    def _fake_serve(t, tf, n, since, to, warm):
        seen["local"] = (t, tf, n, since, to, warm)
        return JSONResponse({"src": "local"})

    async def _boom(*a, **k):
        raise AssertionError("proxy must not be called when the gate is off")

    monkeypatch.setattr(bars, "serve_bars", _fake_serve)
    monkeypatch.setattr(bars, "_proxy_bars_to_tier", _boom)
    r = await bars.get_bars("NVDA", tf="D", bars=200, since="", to="", warm=0)
    assert seen["local"] == ("NVDA", "D", 200, "", "", 0)
    assert json.loads(r.body)["src"] == "local"


async def test_route_proxies_when_gate_on(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://bars-api.internal:8080")

    def _no_local(*a, **k):
        raise AssertionError("local serve must not run when the tier answers")

    async def _fake_proxy(t, tf, n, since, to, warm, origin):
        assert origin == "http://bars-api.internal:8080"
        return JSONResponse({"src": "tier"})

    monkeypatch.setattr(bars, "serve_bars", _no_local)
    monkeypatch.setattr(bars, "_proxy_bars_to_tier", _fake_proxy)
    r = await bars.get_bars("NVDA", tf="D", bars=200, since="", to="", warm=0)
    assert json.loads(r.body)["src"] == "tier"


async def test_route_falls_back_to_local_on_tier_error(monkeypatch):
    """A raising/slow tier can never take charts down — the caller serves locally."""
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://bars-api.internal:8080")
    local = {}

    def _fake_serve(t, tf, n, since, to, warm):
        local["hit"] = True
        return JSONResponse({"src": "local-fallback"})

    async def _raise(*a, **k):
        raise RuntimeError("tier down")

    monkeypatch.setattr(bars, "serve_bars", _fake_serve)
    monkeypatch.setattr(bars, "_proxy_bars_to_tier", _raise)
    r = await bars.get_bars("NVDA", tf="D", bars=200, since="", to="", warm=0)
    assert local.get("hit") is True
    assert json.loads(r.body)["src"] == "local-fallback"


async def test_route_stays_local_when_origin_unset_even_if_flag_on(monkeypatch):
    """Belt: flag + pct on but BARS_ORIGIN_URL unset ⇒ still local (no origin to hit)."""
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")  # no BARS_ORIGIN_URL
    seen = {}

    def _fake_serve(t, tf, n, since, to, warm):
        seen["hit"] = True
        return JSONResponse({"src": "local"})

    async def _boom(*a, **k):
        raise AssertionError("no origin ⇒ proxy must not be attempted")

    monkeypatch.setattr(bars, "serve_bars", _fake_serve)
    monkeypatch.setattr(bars, "_proxy_bars_to_tier", _boom)
    r = await bars.get_bars("NVDA", tf="D", bars=200, since="", to="", warm=0)
    assert seen.get("hit") is True


def test_breadth_pseudo_tickers_never_proxy(monkeypatch):
    """Breadth symbols are served from the web pod's breadth_snapshots table, which the
    tier does not have — they must stay local even at full rollout, or the chart is empty."""
    from api.services.breadth_symbols import SYMBOLS
    breadth_sym = next(iter(SYMBOLS))
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route(breadth_sym, 0) is False
    # a normal ticker at the same settings DOES route
    assert bars._bars_proxy_should_route("NVDA", 0) is True


# ── a failed tier proxy never answers a cold-stale intraday tail as current (2026-11-20) ───────────────────────────
# Measured on production 2026-11-20, 16:52:49Z: a bars-api deploy swap left the tier unreachable, so the edge hedged
# a signed-in read to web. Web re-proxied it to the same tier, waited out httpx's 2.0 s connect timeout, then served
# its LOCAL store, which nothing heals while every read is proxied. RDDT 5m came back with a 13:50 ET tail from the
# day before (22 h old) as a 200 that looked current. Now an intraday read whose proxy failed and whose local tail
# is cold-stale answers the warming 503 (Retry-After 2, X-Bars-Shed: tier-unreachable). The client keeps the rows it
# holds and asks again; the tier is back within seconds.
from datetime import datetime as _dt
from zoneinfo import ZoneInfo as _ZI


def _et(y, m, d, hh, mm):
    return int(_dt(y, m, d, hh, mm, tzinfo=_ZI("America/New_York")).timestamp())


def _tier_down(monkeypatch, local_last_ts):
    """Full proxy rollout, a tier that cannot be reached, a local store whose tail is `local_last_ts`,
    and an expected session of 2026-11-20 (so a 2026-11-19 tail is cold-stale)."""
    import httpx
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://bars-api.internal:8080")
    local = {}

    def _fake_serve(t, tf, n, since, to, warm, *a):
        local["hit"] = (t, tf)
        return JSONResponse({"src": "local-fallback"})

    async def _unreachable(*a, **k):
        raise httpx.ConnectTimeout("connect timed out")

    monkeypatch.setattr(bars, "serve_bars", _fake_serve)
    monkeypatch.setattr(bars, "_proxy_bars_to_tier", _unreachable)
    monkeypatch.setattr(bars._bars_fetch._sqlite, "get_last_ts", lambda s, tf: local_last_ts)
    monkeypatch.setattr(bars._bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20261120)
    return local


async def test_tier_unreachable_and_a_cold_stale_local_tail_answers_warming_503(monkeypatch):
    local = _tier_down(monkeypatch, _et(2026, 11, 19, 13, 50))       # the RDDT tail
    r = await bars.get_bars("RDDT", tf="5", bars=4, since="", to="", warm=0)
    assert r.status_code == 503, "a 22 h old intraday tail was answered as a 200 that looks current"
    assert r.headers.get("Retry-After") == "2"
    assert r.headers.get("X-Bars-Shed") == "tier-unreachable"
    body = json.loads(r.body)
    assert body["warming"] is True and body["bars"] == []
    assert "hit" not in local                                         # the stale local store was never served


async def test_CONTROL_tier_unreachable_and_a_current_local_tail_serves_locally(monkeypatch):
    local = _tier_down(monkeypatch, _et(2026, 11, 20, 13, 50))       # today's session: not cold-stale
    r = await bars.get_bars("RDDT", tf="5", bars=4, since="", to="", warm=0)
    assert r.status_code == 200 and local.get("hit") == ("RDDT", "5")


async def test_CONTROL_tier_unreachable_daily_and_index_reads_keep_the_local_fallback(monkeypatch):
    local = _tier_down(monkeypatch, _et(2026, 11, 19, 13, 50))
    r = await bars.get_bars("RDDT", tf="D", bars=4, since="", to="", warm=0)
    assert r.status_code == 200 and local.get("hit") == ("RDDT", "D")  # daily: its own catch-up rules apply
    r = await bars.get_bars("SPX", tf="5", bars=4, since="", to="", warm=0)
    assert r.status_code == 200 and local.get("hit") == ("SPX", "5")   # an index is not in bars.db
