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
import threading
import time

import pytest

from api import flow_router

# (source, days, dates, max_mktcap) — the cache key `_get_cached_or_build`
# writes. `max_mktcap` joined it when the uncapped small-cap payload arrived:
# the capped and uncapped bodies for the same (source, days) are different
# bytes and must never share an entry.
_KEY = ("stocks", 1, None, None)


@pytest.fixture(autouse=True)
def _isolate_cache():
    """Never let one test's cached payload — or a leaked lock — reach another."""
    flow_router._RESPONSE_CACHE.clear()
    yield
    flow_router._RESPONSE_CACHE.clear()
    # A lock left held would silently send every later test down the
    # serve-stale branch and make them pass for the wrong reason.
    if flow_router._BUILD_LOCK.locked():
        try:
            flow_router._BUILD_LOCK.release()
        except RuntimeError:
            pass


def _wait_until(pred, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(0.02)
    return False


class _Req:
    """Minimal stand-in for starlette Request (only headers are read)."""
    def __init__(self, gzip=True):
        self.headers = {"accept-encoding": "gzip"} if gzip else {}


def _pin_version(monkeypatch, value):
    monkeypatch.setattr(flow_router, "_current_version", lambda: value)


def _pin_build(monkeypatch, payload=b"CreatedDate,Symbol\n7/27/2026,NVDA\n"):
    """Build returns a marker payload so we can prove WHICH bytes came back."""
    # Signature-AGNOSTIC on purpose: this stub exists to pin WHICH BYTES come
    # back, not the builder's parameter list. A typed signature here turned one
    # added argument (`max_mktcap`) into eight red tests whose messages said
    # nothing about freshness — including two that failed as a bare missing
    # header, because `_serve_csv` turns any build error into a plain 500.
    monkeypatch.setattr(flow_router, "_build_gzipped_csv",
                        lambda *a, **kw: payload)
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


def test_a_rebuild_eventually_reports_the_new_version(monkeypatch):
    """A version bump must reach callers — just not on the asking request.

    This asserted `version == 200` on the very next call, which encoded the OLD
    synchronous contract. Refreshing off the request path deliberately changed
    that: the asking caller gets the stale v100 INSTANTLY (honestly labelled, so
    the client can correct itself) and v200 lands behind it. Kept, rewritten to
    the real contract — the bump must still arrive, or the cache would be frozen.
    """
    _pin_build(monkeypatch, b"V100")
    _pin_version(monkeypatch, 100)
    assert flow_router._get_cached_or_build("stocks", 1) == (100, b"V100")

    _pin_build(monkeypatch, b"V200")
    _pin_version(monkeypatch, 200)

    # The asking caller is answered from the stale entry, not the rebuild.
    assert flow_router._get_cached_or_build("stocks", 1) == (100, b"V100")

    # ...but the refresh lands, and the NEXT caller sees v200.
    assert _wait_until(lambda: flow_router._RESPONSE_CACHE.get(_KEY) == (200, b"V200")), \
        "the version bump must reach the cache"
    assert flow_router._get_cached_or_build("stocks", 1) == (200, b"V200")


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
    # `stale-while-revalidate=86400` let ANY cache serve a 24h-old options tape.
    assert "stale-while-revalidate=86400" not in cc
    # A long browser max-age is what pinned a stale body in the disk cache for
    # hours on prod (CF was rewriting this to 14400).
    assert "max-age=0" in cc


def test_cache_control_still_lets_the_edge_absorb_the_herd():
    # Killing edge caching would put the ~2s origin build back on every user and
    # re-open the 524 overload class. s-maxage keeps CF in front of it.
    cc = flow_router._FLOW_CACHE_HEADERS["Cache-Control"]
    assert "s-maxage=60" in cc


def test_stale_serving_stays_enabled_because_it_is_the_availability_valve():
    """Regression guard for an over-correction I actually shipped.

    Deleting stale-while-revalidate outright (rather than bounding it) made
    every 60s edge expiry block a real user on a full origin rebuild: measured
    `cf-cache-status: MISS`, TTFB 25.5s, and the page showed "Failed to load
    flow data — Server returned 502". Serving stale is what keeps the 12MB
    build off the request path.

    Bounded staleness is safe now only because X-Flow-Version lets the client
    detect and correct it — so this asserts BOTH halves: stale serving is on,
    and it is bounded well under the old 24h.
    """
    cc = flow_router._FLOW_CACHE_HEADERS["Cache-Control"]
    assert "stale-while-revalidate=" in cc, "removing this re-opens the 502 class"

    swr = int(cc.split("stale-while-revalidate=")[1].split(",")[0].strip())
    assert 0 < swr <= 3600, f"stale window must be bounded, got {swr}s"

    # `must-revalidate` forbids serving stale, which would silently cancel the
    # directive above and reintroduce the 25s cold build.
    assert "must-revalidate" not in cc


# ── the rebuild must not happen ON the request path ────────────────────────

def test_stale_payload_is_served_instantly_and_refreshed_in_the_background(monkeypatch):
    """The user asking for a stale file must NOT pay for rebuilding it.

    Before: whoever won the build lock ate the full rebuild — measured 25.5s,
    10s and 4.9s TTFB on prod against a 2.7GB SQLite, and Cloudflare could not
    mask it because a Cache Rule overrides the edge directives.

    Safe only because X-Flow-Version makes the stale copy VISIBLE to the client.
    """
    _pin_version(monkeypatch, 100)
    _pin_build(monkeypatch, b"OLD")
    assert flow_router._get_cached_or_build("stocks", 1) == (100, b"OLD")

    started, release = threading.Event(), threading.Event()

    def _slow_build(*_a, **_kw):          # signature-agnostic; see _pin_build
        started.set()
        release.wait(5)          # hold the rebuild open
        return b"NEW"

    monkeypatch.setattr(flow_router, "_build_gzipped_csv", _slow_build)
    _pin_version(monkeypatch, 200)

    t0 = time.monotonic()
    version, payload = flow_router._get_cached_or_build("stocks", 1)
    elapsed = time.monotonic() - t0

    assert (version, payload) == (100, b"OLD"), "must serve the stale payload as-is"
    assert elapsed < 1.0, f"must not block on the rebuild — took {elapsed:.2f}s"
    assert started.wait(2), "the background refresh must actually run"

    release.set()
    assert _wait_until(lambda: flow_router._RESPONSE_CACHE.get(_KEY) == (200, b"NEW")), \
        "the background refresh must land in the cache"
    assert _wait_until(lambda: not flow_router._BUILD_LOCK.locked()), \
        "the background thread must release the build lock"


def test_a_cold_key_still_builds_synchronously(monkeypatch):
    # Nothing cached means there is nothing to serve stale. Returning empty
    # would be worse than waiting, so this path must still block.
    _pin_version(monkeypatch, 100)
    _pin_build(monkeypatch, b"FRESH")
    assert flow_router._get_cached_or_build("stocks", 1) == (100, b"FRESH")


def test_a_failed_background_refresh_keeps_the_last_good_payload_and_frees_the_lock(monkeypatch):
    # A refresh that throws must not poison the cache or wedge the lock — that
    # would turn one bad build into a permanent outage for this key.
    _pin_version(monkeypatch, 100)
    _pin_build(monkeypatch, b"GOOD")
    flow_router._get_cached_or_build("stocks", 1)

    exploded = threading.Event()

    def _explode(*_a, **_kw):             # signature-agnostic; see _pin_build
        exploded.set()
        raise RuntimeError("build failed")

    monkeypatch.setattr(flow_router, "_build_gzipped_csv", _explode)
    _pin_version(monkeypatch, 200)

    assert flow_router._get_cached_or_build("stocks", 1) == (100, b"GOOD")
    assert exploded.wait(2)
    assert _wait_until(lambda: not flow_router._BUILD_LOCK.locked()), \
        "a failed refresh must still release the lock"
    assert flow_router._RESPONSE_CACHE[_KEY] == (100, b"GOOD"), \
        "the last good payload must survive a failed refresh"


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
