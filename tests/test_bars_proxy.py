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
    assert bars._bars_proxy_should_route(0) is False


def test_gate_off_when_enabled_but_pct_zero(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "0")
    assert bars._bars_proxy_should_route(0) is False


def test_gate_on_at_full_rollout(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route(0) is True


def test_gate_requires_the_enable_flag(monkeypatch):
    """pct=100 but the master switch OFF ⇒ still dark (rollback = flip the flag)."""
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "0")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route(0) is False


def test_warm_requests_never_proxy(monkeypatch):
    """warm=1 background web-db warms stay local even at full rollout."""
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    assert bars._bars_proxy_should_route(1) is False


def test_gate_bad_pct_value_is_dark(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "not-a-number")
    assert bars._bars_proxy_should_route(0) is False


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
