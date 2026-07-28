"""The CSV payload must describe its OWN data version (X-Flow-Version).

WHY THIS EXISTS — the 2026-07-27 "Friday's tape on Monday night" bug.

`/api/flow/data?days=N` is a version-STABLE url so Cloudflare can cache it. That
means the bytes a client receives may have been built minutes — or hours — ago
and replayed from an edge object or the browser disk cache. Measured on prod at
15:41 ET: the edge served `Age: 21238` (5h54m) whose newest print was 9:48 AM,
while the origin held 111,046 rows through 3:24 PM.

The client could not TELL. It inferred the version from its own clock, stamped a
stale body "current", and never refetched. The cure is to make the payload
self-describing: whatever version these bytes were built from travels with them.

The asymmetry that shapes every test here: reporting a version that is too NEW
is silently catastrophic (the client believes stale data is current and stops
refreshing — the exact prod bug), while reporting one that is too OLD merely
costs one extra refetch. So the version must always describe the BYTES, never
the moment of the request.
"""
import pytest

from api import flow_router


@pytest.fixture(autouse=True)
def _isolate_cache():
    """Never let one test's cached payload leak into another."""
    flow_router._RESPONSE_CACHE.clear()
    yield
    flow_router._RESPONSE_CACHE.clear()


class _Req:
    """Minimal stand-in for starlette Request (only headers are read)."""
    def __init__(self, gzip=True):
        self.headers = {"accept-encoding": "gzip"} if gzip else {}


def _pin_version(monkeypatch, value):
    monkeypatch.setattr(flow_router, "_current_version", lambda: value)


def _pin_build(monkeypatch, payload=b"CreatedDate,Symbol\n7/27/2026,NVDA\n"):
    """Build returns a marker payload so we can prove WHICH bytes came back."""
    monkeypatch.setattr(flow_router, "_build_gzipped_csv",
                        lambda source, days, dates=None: payload)
    return payload


# ── the header exists and is honest ────────────────────────────────────────

def test_serve_csv_stamps_the_version_it_built_from(monkeypatch):
    _pin_version(monkeypatch, 12345)
    _pin_build(monkeypatch)
    resp = flow_router._serve_csv("stocks", 1, _Req())
    assert resp.headers["X-Flow-Version"] == "12345"


def test_header_present_on_the_non_gzip_path_too(monkeypatch):
    # The rare no-gzip branch is a separate Response construction — it regressed
    # independently once before, so it gets its own assertion.
    _pin_version(monkeypatch, 777)
    import gzip as _gz
    _pin_build(monkeypatch, _gz.compress(b"CreatedDate\n7/27/2026\n"))
    resp = flow_router._serve_csv("stocks", 1, _Req(gzip=False))
    assert resp.headers["X-Flow-Version"] == "777"


# ── THE ONE THAT MATTERS — stale-serve must not lie ────────────────────────

def test_stale_serve_reports_the_STALE_payload_version_not_the_current_one(monkeypatch):
    """_get_cached_or_build serves a stale payload when a build is in flight.

    If that path reported `_current_version()`, the server would reproduce the
    exact client bug on the origin side: stale bytes labelled current, so no
    client could ever detect them. This is the assertion that pins it.
    """
    _pin_build(monkeypatch)
    # Round 1 at v100 populates the cache.
    _pin_version(monkeypatch, 100)
    v1, old_bytes = flow_router._get_cached_or_build("stocks", 1)
    assert v1 == 100

    # Version moves on; a build is already in flight so the lock is held.
    _pin_version(monkeypatch, 200)
    flow_router._BUILD_LOCK.acquire()
    try:
        version, payload = flow_router._get_cached_or_build("stocks", 1)
    finally:
        flow_router._BUILD_LOCK.release()

    assert payload == old_bytes, "precondition: the STALE payload was served"
    assert version == 100, "stale bytes must report v100, NOT the current v200"


def test_fresh_build_reports_the_current_version(monkeypatch):
    _pin_build(monkeypatch)
    _pin_version(monkeypatch, 100)
    flow_router._get_cached_or_build("stocks", 1)
    _pin_version(monkeypatch, 200)
    version, _ = flow_router._get_cached_or_build("stocks", 1)
    assert version == 200, "a rebuild at v200 must report v200"


def test_cache_hit_reports_the_matching_version(monkeypatch):
    _pin_build(monkeypatch)
    _pin_version(monkeypatch, 555)
    flow_router._get_cached_or_build("stocks", 1)

    calls = []
    real_build = flow_router._build_gzipped_csv

    def _count(*a, **k):
        calls.append(1)
        return real_build(*a, **k)

    monkeypatch.setattr(flow_router, "_build_gzipped_csv", _count)
    version, _ = flow_router._get_cached_or_build("stocks", 1)
    assert version == 555
    assert not calls, "a same-version hit must not rebuild"


# ── cache headers must not license a day-old tape ──────────────────────────

def test_cache_control_does_not_allow_a_stale_day_long_replay():
    cc = flow_router._FLOW_CACHE_HEADERS["Cache-Control"]
    # `stale-while-revalidate=86400` let ANY cache serve a 24h-old options tape
    # instantly. For an intraday tape, freshness is the product.
    assert "stale-while-revalidate=86400" not in cc
    # A long browser max-age is what pinned a stale body in the disk cache for
    # hours on prod (CF was rewriting this to 14400).
    assert "max-age=0" in cc
    assert "must-revalidate" in cc


def test_cache_control_still_lets_the_edge_absorb_the_herd():
    # Killing edge caching would put the ~2s origin build back on every user and
    # re-open the 524 overload class. s-maxage keeps CF in front of it.
    cc = flow_router._FLOW_CACHE_HEADERS["Cache-Control"]
    assert "s-maxage=60" in cc


def test_the_version_header_survives_the_worker_proxy():
    """flow_router runs on the FLOW-WORKER; web proxies /api/flow to it.

    So `X-Flow-Version` only reaches the browser if flow_proxy forwards it. The
    proxy strips hop-by-hop headers and passes everything else, which is why
    this works today — but adding this header to _HOP (or switching that filter
    to an allowlist) would make the whole fix silently inert: the client would
    see no header, fall back to the old inference, and the stale-tape bug would
    return with every test still green.
    """
    from api import flow_proxy
    assert "x-flow-version" not in flow_proxy._HOP
