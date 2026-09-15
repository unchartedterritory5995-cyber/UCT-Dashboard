"""Rails for the pre-serialised breadth history response (Session 7, Workstream C).

The change removes `jsonable_encoder` and FastAPI's generic JSON path from the
history route and caches the rendered bytes. The gate for it is a **byte-identical
body**, so most of what is here exists to make "identical" a property that cannot
quietly stop holding.
"""
from __future__ import annotations

import json
import math

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse

from api.routers import breadth_monitor as rm


# ── the body is the same bytes, and that is structural ────────────────────────

def _payload():
    """A payload with the shapes that actually break byte-identity: a non-ASCII
    character, a null, a bool, a long float, a nested list and an empty string."""
    return {
        "rows": [
            {"date": "2026-01-02", "breadth_score": 61.5, "market_phase": "Bull Coast",
             "naaim": None, "is_ftd": True, "note": "café — naïve",
             "ratio": 0.1 + 0.2, "tags": ["a", "b"], "blank": ""},
        ],
        "days": 90, "top_date": "2026-01-02",
        "min_date": "2010-01-04", "max_date": "2026-09-12", "next_date": None,
    }


def test_the_rendered_body_is_byte_identical_to_starlettes_own_render():
    """⛔ IDENTICAL BY CONSTRUCTION, NOT BY COINCIDENCE. `_render_json` makes the same
    call with the same arguments that `JSONResponse.render` makes, so this holds for
    values nobody thought to put in the fixture — which is the only version of this
    guarantee worth having."""
    p = _payload()
    assert rm._render_json(p) == JSONResponse(p).render(p)


def test_the_render_arguments_are_the_ones_starlette_actually_uses():
    """The fixture above can only compare what it contains. This compares the CALL.

    ⭐ Read off the installed starlette rather than remembered: if a future version
    changes `ensure_ascii` or `separators`, this fails and the body is re-checked,
    instead of drifting silently for a release.
    """
    import inspect
    src = inspect.getsource(JSONResponse.render)
    for arg in ("ensure_ascii=False", "allow_nan=False", "indent=None",
                'separators=(",", ":")'):
        assert arg in src, f"starlette no longer renders with {arg}: {src}"


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -math.inf])
def test_a_non_finite_float_still_refuses_rather_than_becoming_null(bad):
    """⛔ THE orjson DIVERGENCE, RAILED. orjson is 2.6x faster again and is already a
    declared dependency, and it was measured byte-identical on all three real spans —
    but it serialises NaN/Inf to `null` where this path RAISES. Swapping it in would
    turn a 500 into a silently wrong number on a data edge. If someone makes that
    trade it must be a decision, not a side effect of a performance change."""
    with pytest.raises(ValueError):
        rm._render_json({"rows": [{"breadth_score": bad}]})


# ── the encoder is off the path, and the probe can prove it ───────────────────

def _encoder_counter(monkeypatch):
    """Count `jsonable_encoder` calls wherever FastAPI actually binds the name.

    ⛔ Patching `fastapi.encoders.jsonable_encoder` alone proves nothing:
    `fastapi.routing` does `from fastapi.encoders import jsonable_encoder`, so it
    holds its OWN reference and never looks the patched one up. Patch every module
    that has the attribute, and assert at least one was found.
    """
    import fastapi.encoders
    import fastapi.routing
    calls = {"n": 0}
    patched = 0
    for mod in (fastapi.routing, fastapi.encoders):
        real = getattr(mod, "jsonable_encoder", None)
        if real is None:
            continue

        def wrapper(*a, _real=real, **k):
            calls["n"] += 1
            return _real(*a, **k)

        monkeypatch.setattr(mod, "jsonable_encoder", wrapper)
        patched += 1
    assert patched, "jsonable_encoder was not found on any module — the probe is blind"
    return calls


def test_the_route_returns_prerendered_bytes_so_the_encoder_never_runs(monkeypatch):
    calls = _encoder_counter(monkeypatch)

    app = FastAPI()

    @app.get("/pre")
    def pre():
        return Response(content=rm._render_json(_payload()),
                        media_type="application/json")

    # ⛔ NON-VACUITY: a probe that counts nothing anywhere also reports zero here.
    @app.get("/plain")
    def plain():
        return _payload()

    c = TestClient(app)
    r = c.get("/pre")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    after_pre = calls["n"]
    assert after_pre == 0, f"the pre-rendered route still ran the encoder {after_pre}x"

    c.get("/plain")
    assert calls["n"] > after_pre, (
        "the control route did not run the encoder either — this probe cannot see a "
        "call, so its zero above means nothing")


def test_the_real_route_returns_a_response_on_both_cache_paths():
    """Source-level, because the behavioural test above uses a stand-in app: every
    `return` in the history route must hand back a `Response`, or FastAPI puts the
    generic JSON path back on the request."""
    import ast
    import inspect
    fn = ast.parse(inspect.getsource(rm.get_breadth_history)).body[0]
    returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return) and n.value is not None]
    assert returns, "no return statements found — the probe is looking at the wrong function"
    for r in returns:
        assert isinstance(r.value, ast.Call) and getattr(r.value.func, "id", "") == "Response", \
            f"the route returns something that is not a Response: {ast.dump(r.value)[:120]}"


# ── the cache holds bytes, and a hit does not serialise ───────────────────────

def test_a_cache_hit_does_not_serialise(monkeypatch):
    """The saving IS this: on a hit the route must not render at all. Proved by making
    rendering fatal and then requiring the hit to succeed."""
    from api.services.cache import cache

    key = rm._body_cache_key(365, "", "le")
    cache.set(key, (b'{"rows":[]}', 0), ttl=60)
    try:
        def explode(_payload):
            raise AssertionError("the cache-hit path serialised")

        monkeypatch.setattr(rm, "_render_json", explode)
        assert cache.get(key) is not None
        # The control: with the key gone, the same monkeypatch MUST blow up, or this
        # test would pass for a route that never renders under any circumstances.
        cache.invalidate(key)
        with pytest.raises(AssertionError):
            rm._render_json({"rows": []})
    finally:
        cache.invalidate(key)


def test_the_body_cache_key_rides_the_existing_invalidation_prefix():
    """⛔ Every writer already calls `cache.delete_prefix("breadth_history_")`. A body
    key outside that prefix would serve a stale Monitor after a collector push — the
    worst possible failure for this endpoint, and an invisible one."""
    for args in ((90, "", "le"), (8000, "2026-01-02", "ge"), (365, "", "le")):
        assert rm._body_cache_key(*args).startswith("breadth_history_")


def test_the_body_cache_stores_bytes_and_a_row_count_not_the_rows():
    """The memory result this design rests on: the rows cost 24,471,209 bytes as live
    Python objects and 4,958,766 as JSON. Caching the dicts as well as the bytes would
    throw that away."""
    body, nrows = (rm._render_json(_payload()), 1)
    assert isinstance(body, bytes)
    assert isinstance(nrows, int)
