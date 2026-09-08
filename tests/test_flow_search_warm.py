"""`warm_only`: a Search cache miss must cost the member nothing.

THE ARITHMETIC THAT FORCES THIS DESIGN, measured on prod 2026-09-08:

    warm hit          178-337 ms   (flat, whatever the ticker's size)
    cold build         10,787 ms   (AMD, 151,267 rows)
    legacy tape path    4,232 ms   (what the client falls back to)

If a miss makes the client wait -- for a build, or for its own deadline -- then a
cold search costs `wait + 4,232 ms`, which is strictly worse than never having
asked. Asking must never be able to lose. So on `warm_only` a miss is answered
IMMEDIATELY with 503, the client starts the tape at once, and the build it would
have waited for runs in the background so the NEXT search is a hit.
"""
import ast
import gzip
import pathlib
import threading
import time

import pytest

from api import flow_router as fr

REPO = pathlib.Path(__file__).resolve().parents[1]
SRC = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")


def _endpoint_ast():
    tree = ast.parse(SRC)
    return next(n for n in ast.walk(tree)
                if isinstance(n, ast.FunctionDef) and n.name == "get_flow_ticker_product")


# ── The ordering IS the feature ───────────────────────────────────────────────

def test_the_warm_only_decline_happens_BEFORE_the_build_lock_is_taken():
    """⛔ THE WHOLE POINT. If the warm_only branch sat after the lock acquire, a
    miss would still queue behind (or start) a derivation and the member would
    pay for it -- the endpoint would look correct and the latency would be
    unchanged. Position, not presence, is what makes this work."""
    fn = _endpoint_ast()
    src = ast.unparse(fn)
    warm = src.index("warm_only")
    lock = src.index("_SEARCH_BUILD_LOCK.acquire")
    assert warm < lock, (
        "the warm_only fast-decline moved below the build lock -- a miss now "
        "costs the member a build again")


def test_the_warm_only_branch_returns_503_and_does_not_build_inline():
    """A miss must return, not fall through into the derivation."""
    fn = _endpoint_ast()
    src = ast.unparse(fn)
    branch = src[src.index("warm_only"):src.index("_SEARCH_BUILD_LOCK.acquire")]
    assert "503" in branch, "the warm_only miss does not answer 503"
    assert "_spawn_search_warm" in branch, "a warm_only miss warms nothing"
    assert "_build_search_product" not in branch, (
        "the warm_only branch builds inline -- that is the latency it exists to "
        "remove")


def test_CONTROL_the_endpoint_still_has_a_synchronous_build_path():
    """Without this, the assertions above would pass on an endpoint that had
    lost its ability to build at all."""
    src = ast.unparse(_endpoint_ast())
    assert "_build_search_product" in src


# ── One implementation, two callers ──────────────────────────────────────────

def test_the_warmer_and_the_request_path_share_one_derivation():
    """⛔ A second copy of the build would be free to drift into producing a
    different product for the same cache key -- the quietest possible
    cache-poisoning bug."""
    tree = ast.parse(SRC)
    callers = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Call) and ast.unparse(inner.func) == "_build_search_product":
                callers.add(node.name)
    assert callers >= {"get_flow_ticker_product"}, "the request path lost the build"
    assert len(callers) >= 2, (
        "only one caller of _build_search_product -- the background warmer is "
        "either gone or has grown its own copy of the derivation")


# ── The background warmer cannot stack ───────────────────────────────────────

@pytest.fixture(autouse=True)
def _clean_warming():
    with fr._SEARCH_WARMING_LOCK:
        fr._SEARCH_WARMING.clear()
    yield
    with fr._SEARCH_WARMING_LOCK:
        fr._SEARCH_WARMING.clear()


def test_a_second_warm_for_the_same_symbol_is_refused(monkeypatch):
    """A member typing into the search box completes several symbols; each must
    not spawn its own derivation thread."""
    started = threading.Event()
    release = threading.Event()

    def slow_build(sym, src, key, version, st):
        started.set()
        release.wait(5)
        return b"gz", None

    monkeypatch.setattr(fr, "_build_search_product", slow_build)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)

    assert fr._spawn_search_warm("AMD", "stocks", ("AMD", "stocks", "1"), "1") is True
    assert started.wait(5), "the first warm never started"
    # Same symbol again while the first is still running.
    assert fr._spawn_search_warm("AMD", "stocks", ("AMD", "stocks", "1"), "1") is False

    release.set()


def test_a_warm_that_raises_does_not_poison_the_in_flight_set(monkeypatch):
    """⛔ If the symbol were never discarded on failure, that ticker could never
    be warmed again for the life of the process -- a permanent silent hole."""
    done = threading.Event()

    def boom(sym, src, key, version, st):
        try:
            raise RuntimeError("node died")
        finally:
            done.set()

    monkeypatch.setattr(fr, "_build_search_product", boom)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)

    assert fr._spawn_search_warm("MU", "stocks", ("MU", "stocks", "1"), "1") is True
    assert done.wait(5)
    for _ in range(50):                       # let the finally-block run
        with fr._SEARCH_WARMING_LOCK:
            if "MU" not in fr._SEARCH_WARMING:
                break
        time.sleep(0.02)
    with fr._SEARCH_WARMING_LOCK:
        assert "MU" not in fr._SEARCH_WARMING, "a failed warm left the symbol wedged"


def test_a_warm_skips_the_build_when_the_entry_arrived_meanwhile(monkeypatch):
    """Another request may have built it between the 503 and this thread running."""
    calls = []
    monkeypatch.setattr(fr, "_build_search_product",
                        lambda *a, **k: calls.append(a) or (b"gz", None))
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: b"already-here")

    assert fr._spawn_search_warm("NVDA", "stocks", ("NVDA", "stocks", "1"), "1") is True
    for _ in range(50):
        with fr._SEARCH_WARMING_LOCK:
            if "NVDA" not in fr._SEARCH_WARMING:
                break
        time.sleep(0.02)
    assert calls == [], "rebuilt a product that was already cached"


# ── The flag parser ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("v,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("yes", True), ("on", True),
    ("0", False), ("false", False), ("", False), (None, False), ("maybe", False),
])
def test_truthy(v, expected):
    assert fr._truthy(v) is expected


# ── The test that would have caught the outage ───────────────────────────────
#
# ⛔⛔ EVERY TEST ABOVE PASSED WHILE THE ENDPOINT RETURNED 500 IN PRODUCTION.
# The `warm_only` branch read `request.query_params`, and this endpoint has no
# `request` parameter -- `NameError: name 'request' is not defined` on EVERY
# call, including ones that never mention warm_only. AST and helper tests are
# structurally blind to that: they proved the branch was in the right place and
# called the right things, and none of them ever executed the function.
#
# Members were shielded only because the client declines any non-OK response and
# falls back to the raw tape. The speedup was silently off, and nothing red.
#
# So: actually CALL it. One real request through the app is worth every
# structural assertion above.

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.flow_admin_auth import require_flow_user


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(fr.flow_router)   # it already has prefix="/api/flow"
    app.dependency_overrides[require_flow_user] = lambda: {"via": "test"}
    return TestClient(app, raise_server_exceptions=False)


def _statuses(client, sym="ALIT"):
    return (client.get(f"/api/flow/ticker-product/{sym}?source=stocks").status_code,
            client.get(f"/api/flow/ticker-product/{sym}?source=stocks&warm_only=1").status_code)


def test_the_endpoint_does_not_500_with_or_without_warm_only(client, monkeypatch):
    """The regression itself. Any 500 here is an unhandled exception in the
    handler -- exactly what shipped to production.

    ⛔ IT MUST REACH THE `warm_only` LINE, AND MY FIRST VERSION DID NOT. It
    stubbed `available()` to False, which returns EARLIER in the handler, so the
    buggy line never ran and the test passed against the outage. The mutation
    check caught that: reintroducing `request.query_params` left it green. The
    stubs below are chosen to land the handler ON that line.

    ⛔ It also asserts the route resolved. An earlier version mounted the router
    under a second "/api/flow" prefix, so every call 404'd and `!= 500` passed on
    all of them."""
    blob = gzip.compress(b'{"ok":true}')
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)
    monkeypatch.setattr(fr, "_spawn_search_warm", lambda *a, **k: True)
    monkeypatch.setattr(fr, "_build_search_product", lambda *a, **k: (blob, None))

    plain, warm = _statuses(client)

    assert plain != 404 and warm != 404, (
        "the endpoint is not mounted where this test calls it -- every "
        "assertion here would pass vacuously")
    assert plain != 500, "the endpoint raises without warm_only"
    assert warm != 500, "the endpoint raises with warm_only"
    # CONTROL: prove we actually traversed the handler rather than exiting early.
    assert (plain, warm) == (200, 503), (
        f"expected a build then a fast decline, got {plain}/{warm} -- the test "
        "is not reaching the code it claims to cover")


def test_warm_only_is_a_declared_parameter_not_read_off_a_request(client, monkeypatch):
    """⛔ The endpoint takes no `request`, so reading query params off one is a
    NameError at call time. Declaring it is what makes the branch reachable."""
    import inspect
    params = inspect.signature(fr.get_flow_ticker_product).parameters
    assert "warm_only" in params, (
        "warm_only is not a declared parameter -- if the handler reads it off a "
        "`request` it does not have, every call 500s")


def test_a_warm_only_miss_declines_fast_and_does_not_build(client, monkeypatch):
    """The behavioural contract, exercised through the app rather than the AST."""
    built = []
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)
    monkeypatch.setattr(fr, "_build_search_product",
                        lambda *a, **k: built.append(a) or (b"gz", None))
    spawned = []
    monkeypatch.setattr(fr, "_spawn_search_warm",
                        lambda *a, **k: spawned.append(a) or True)

    r = client.get("/api/flow/ticker-product/ALIT?source=stocks&warm_only=1")

    assert r.status_code == 503
    assert built == [], "a warm_only miss built inline -- the member paid for it"
    assert spawned, "a warm_only miss warmed nothing, so the next search is cold too"


def test_CONTROL_without_warm_only_the_same_miss_DOES_build(client, monkeypatch):
    """Without this, the test above would pass on an endpoint that never builds."""
    built = []
    # The response declares Content-Encoding: gzip, so the stub has to BE gzip —
    # a placeholder blob makes the client fail to decode and the test fail for a
    # reason that has nothing to do with what it is checking.
    blob = gzip.compress(b'{"ok":true,"sym":"ALIT"}')
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)
    monkeypatch.setattr(fr, "_build_search_product",
                        lambda *a, **k: built.append(a) or (blob, None))

    r = client.get("/api/flow/ticker-product/ALIT?source=stocks")

    assert r.status_code == 200
    assert built, "the synchronous build path is gone"


# ── One un-buildable ticker must not own the single warm lane ────────────────
#
# ⛔ OBSERVED LIVE, 2026-09-08. MU (465,956 rows) exceeds the 60 s derive
# timeout. Every search for it re-spawned a warm, each holding the single build
# lane ~90 s, so no other ticker's warm ever ran -- and the decline path logged
# NOTHING, so "the warmer is broken" and "the warmer never got the lane" looked
# identical for an hour of live debugging.

@pytest.fixture(autouse=True)
def _clean_cooldown():
    with fr._SEARCH_WARMING_LOCK:
        fr._WARM_FAILED_UNTIL.clear()
    yield
    with fr._SEARCH_WARMING_LOCK:
        fr._WARM_FAILED_UNTIL.clear()


def test_a_failed_warm_puts_the_ticker_in_cooldown(monkeypatch):
    done = threading.Event()

    def failing(sym, src, key, version, st):
        try:
            return None, "boom"          # the (gz, err) failure shape
        finally:
            done.set()

    monkeypatch.setattr(fr, "_build_search_product", failing)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)

    assert fr._spawn_search_warm("MU", "stocks", ("MU", "stocks", "1"), "1") is True
    assert done.wait(5)
    for _ in range(50):
        with fr._SEARCH_WARMING_LOCK:
            if "MU" not in fr._SEARCH_WARMING:
                break
        time.sleep(0.02)

    # The retry that used to monopolise the lane is now refused.
    assert fr._spawn_search_warm("MU", "stocks", ("MU", "stocks", "1"), "1") is False
    assert "MU" in fr.search_warm_state()["cooling_off"]


def test_CONTROL_a_SUCCESSFUL_warm_leaves_no_cooldown(monkeypatch):
    """Without this, the test above would pass on a warmer that cooled off every
    ticker it ever touched — which would disable warming entirely."""
    done = threading.Event()

    def ok(sym, src, key, version, st):
        try:
            return b"gz", None
        finally:
            done.set()

    monkeypatch.setattr(fr, "_build_search_product", ok)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)

    assert fr._spawn_search_warm("ALIT", "stocks", ("ALIT", "stocks", "1"), "1") is True
    assert done.wait(5)
    for _ in range(50):
        with fr._SEARCH_WARMING_LOCK:
            if "ALIT" not in fr._SEARCH_WARMING:
                break
        time.sleep(0.02)

    assert "ALIT" not in fr.search_warm_state()["cooling_off"]
    assert fr._spawn_search_warm("ALIT", "stocks", ("ALIT", "stocks", "1"), "1") is True


def test_a_declined_warm_is_counted_rather_than_vanishing(monkeypatch):
    """⛔ A silent decline is indistinguishable from a broken warmer. It must
    leave a trace."""
    fr._WARM_STATS["declined"] = 0
    fr._SEARCH_BUILD_LOCK.acquire()          # hold the lane, as a real build would
    try:
        done = threading.Event()
        monkeypatch.setattr(fr, "_build_search_product",
                            lambda *a, **k: (b"gz", None))
        assert fr._spawn_search_warm("NVDA", "stocks", ("NVDA", "stocks", "1"), "1") is True
        for _ in range(100):
            if fr._WARM_STATS["declined"] > 0:
                done.set()
                break
            time.sleep(0.02)
        assert done.is_set(), "a warm declined on the busy lane and recorded nothing"
    finally:
        fr._SEARCH_BUILD_LOCK.release()
