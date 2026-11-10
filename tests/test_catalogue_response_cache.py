"""The two chart-mount catalogues answer from a short shared server cache.

`/api/market-indicators` and `/api/breadth-symbols` were rebuilt on every chart mount: a median
1.6-1.7 s of server wait. Both answers are the same for every member, since neither handler reads
who is asking, so the build can be shared.

Both routes are paid. The cache therefore sits INSIDE the handler, after the auth dependency has run.
An edge `s-maxage` would let Cloudflare replay a paid catalogue to an anonymous caller.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import breadth_monitor as bm_router
from api.routers import market_indicators as mi_router
from api.services import breadth_symbols as bs
from api.services.cache import cache
from api.services.market_indicators import discovery as disc
from api.services.market_indicators import registry as reg


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.delete_prefix("chart_catalogue_")
    yield
    cache.delete_prefix("chart_catalogue_")


@pytest.fixture
def indicators(monkeypatch):
    calls = []

    def fake_catalogue():
        calls.append(1)
        return {"rows": [{"id": "A", "n": len(calls)}]}

    monkeypatch.setattr(disc, "catalogue", fake_catalogue)
    monkeypatch.setattr(reg, "dormant_rows", lambda: [])
    return calls


@pytest.fixture
def breadth(monkeypatch):
    calls = []

    def fake_catalog():
        calls.append(1)
        return {"rows": [], "n": len(calls)}

    monkeypatch.setattr(bs, "library_catalog", fake_catalog)
    monkeypatch.setattr(bs, "list_breadth_symbols", lambda: [{"symbol": "UCTA50"}])
    monkeypatch.setattr(bs, "display_symbols", lambda: {"UCTA50": "UCT:A50"})
    return calls


def _expire(monkeypatch):
    import api.services.cache as cache_module
    real = cache_module.time.time
    monkeypatch.setattr(cache_module.time, "time", lambda: real() + 3600)


# ── market-indicators ────────────────────────────────────────────────────────

def test_catalogue_is_built_once_for_repeat_requests(indicators):
    first = mi_router.get_catalogue(_user={"id": "a"})
    second = mi_router.get_catalogue(_user={"id": "a"})
    assert len(indicators) == 1
    assert first == second


def test_catalogue_is_shared_between_different_members(indicators):
    """The handler reads nothing about the caller, which is what makes sharing it correct."""
    first = mi_router.get_catalogue(_user={"id": "a", "plan": "pro"})
    second = mi_router.get_catalogue(_user={"id": "b", "plan": "premium"})
    assert len(indicators) == 1
    assert first == second


def test_catalogue_cached_payload_keeps_the_dormant_array(indicators):
    assert "dormant" in mi_router.get_catalogue(_user={})
    assert "dormant" in mi_router.get_catalogue(_user={})


def test_catalogue_cache_expires(indicators, monkeypatch):
    mi_router.get_catalogue(_user={})
    _expire(monkeypatch)
    mi_router.get_catalogue(_user={})
    assert len(indicators) == 2


def test_catalogue_failure_is_not_cached(monkeypatch):
    def boom():
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(disc, "catalogue", boom)
    with pytest.raises(RuntimeError):
        mi_router.get_catalogue(_user={})
    assert cache.get(mi_router._CATALOGUE_CACHE_KEY) is None


# ── breadth-symbols ──────────────────────────────────────────────────────────

def test_breadth_symbols_is_built_once_for_repeat_requests(breadth):
    first = bm_router.get_breadth_symbols(_access={"via": "push_secret"})
    second = bm_router.get_breadth_symbols(_access={"id": "member"})
    assert len(breadth) == 1
    assert first == second


def test_breadth_symbols_cache_expires(breadth, monkeypatch):
    bm_router.get_breadth_symbols(_access={})
    _expire(monkeypatch)
    bm_router.get_breadth_symbols(_access={})
    assert len(breadth) == 2


def test_breadth_symbols_failure_is_not_cached(monkeypatch):
    monkeypatch.setattr(bs, "list_breadth_symbols", lambda: [])
    monkeypatch.setattr(bs, "display_symbols", lambda: {})

    def boom():
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(bs, "library_catalog", boom)
    with pytest.raises(RuntimeError):
        bm_router.get_breadth_symbols(_access={})
    assert cache.get(bm_router._BREADTH_SYMBOLS_CACHE_KEY) is None


# ── the gate stays in front of the cache ─────────────────────────────────────

def _client(router):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_a_warm_indicator_cache_is_not_served_to_an_anonymous_caller(indicators):
    assert mi_router.get_catalogue(_user={"id": "paid"})["rows"]
    assert cache.get(mi_router._CATALOGUE_CACHE_KEY) is not None
    assert _client(mi_router.router).get("/api/market-indicators").status_code == 401


def test_a_warm_breadth_cache_is_not_served_to_an_anonymous_caller(breadth):
    bm_router.get_breadth_symbols(_access={"id": "paid"})
    assert cache.get(bm_router._BREADTH_SYMBOLS_CACHE_KEY) is not None
    assert _client(bm_router.router).get("/api/breadth-symbols").status_code == 401


def _assert_not_publicly_cacheable(response):
    assert response.status_code == 200
    header = (response.headers.get("cache-control") or "").lower()
    assert "public" not in header and "s-maxage" not in header, header


def _member_client(router, gate):
    """A real HTTP round trip for a paid member, so the assertion reads the response itself."""
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[gate] = lambda: {"id": "paid"}
    return TestClient(app)


def test_indicator_response_is_not_publicly_cacheable_cold_or_warm(indicators):
    """A public cache header on a paid route is the leak this design exists to avoid."""
    client = _member_client(mi_router.router, mi_router.require_paid)
    _assert_not_publicly_cacheable(client.get("/api/market-indicators"))
    _assert_not_publicly_cacheable(client.get("/api/market-indicators"))
    assert len(indicators) == 1


def test_breadth_response_is_not_publicly_cacheable_cold_or_warm(breadth):
    client = _member_client(bm_router.router, bm_router.require_bars_access)
    _assert_not_publicly_cacheable(client.get("/api/breadth-symbols"))
    _assert_not_publicly_cacheable(client.get("/api/breadth-symbols"))
    assert len(breadth) == 1
