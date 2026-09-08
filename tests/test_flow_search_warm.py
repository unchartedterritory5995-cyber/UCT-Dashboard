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
