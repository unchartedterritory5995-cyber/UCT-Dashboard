"""Seam S8-2 (wave 8) -- the share routes live in ONE router, and the real app serves each ONCE.

The five note-share routes moved out of `api/routers/journal_two.py` into
`api/routers/notebook_shares.py` so lane 8B can work on sharing without a pathspec
commit to `journal_two.py` carrying another lane's hunks. A MOVE, not a change: same
paths, same handlers, same flag checks. What can go wrong with a move is exactly what
this file asks the REAL app about (imported under the repo-root conftest's sandbox, so
it is safe here and NOT safe bare):

  * a route left behind as well as copied -- two handlers for one path, and FastAPI
    answers on first match, so which one serves depends on mount order;
  * a route that did not come along -- a 404 where a member's link used to work;
  * a route shadowed by an earlier, broader one -- the new router is mounted BEFORE
    journal_two, so the question is whether anything mounted earlier still is.

⛔ THE ROUTE LIST IS DERIVED from `notebook_shares.router.routes`, never typed: a route
lane 8B adds tomorrow is held to the same three properties the day it lands. The five
the seam promises are named once, as the non-vacuity anchor (`SEAM_FIVE`) -- a router
that lost them would otherwise pass every derived check over whatever was left.

Each derivation has a control that proves it can fail (rule 14): a duplicate mounted on
purpose, and a broader route mounted in front on purpose.
"""
from __future__ import annotations

from collections import Counter

from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.routing import Match

SEAM_FIVE = {
    ("GET", "/api/j2/notes/{note_id}/share"),
    ("POST", "/api/j2/notes/{note_id}/share"),
    ("DELETE", "/api/j2/notes/{note_id}/share"),
    ("GET", "/api/j2/shared/{token}"),
    ("GET", "/api/j2/shared/{token}/att/{sub}/{filename}"),
}

# Concrete values for a path's parameters, so a route can be asked "who answers this?".
SAMPLE = {"note_id": "n-probe", "token": "tok-probe", "sub": "inline", "filename": "a.png"}


def _share_router():
    import importlib
    return importlib.import_module("api.routers.notebook_shares").router


def _pairs(routes) -> list[tuple[str, str]]:
    out = []
    for r in routes:
        if isinstance(r, APIRoute):
            out.extend((m, r.path) for m in sorted(r.methods))
    return out


def _concrete(path: str) -> str:
    for k, v in SAMPLE.items():
        path = path.replace("{" + k + "}", v)
    assert "{" not in path, f"no sample value for a parameter in {path}"
    return path


def _first_match(app, method: str, path: str):
    """The route the app would dispatch (method, path) to -- first FULL match, in order."""
    scope = {"type": "http", "method": method, "path": path, "root_path": "",
             "query_string": b"", "headers": []}
    for r in app.router.routes:
        match, _ = r.matches(scope)
        if match == Match.FULL:
            return r
    return None


def _real_app():
    # Under pytest the repo-root conftest has already pinned every /data path to a
    # sandbox and armed the tripwire (tests/test_main_router_order.py does the same).
    from api.main import app  # noqa: WPS433 -- deliberate late import
    return app


# ── the router itself ───────────────────────────────────────────────────────

def test_the_share_router_holds_the_five_routes_the_seam_promises():
    pairs = set(_pairs(_share_router().routes))
    missing = SEAM_FIVE - pairs
    assert not missing, f"the share router lost {sorted(missing)}; it holds {sorted(pairs)}"


def test_no_share_route_is_left_behind_in_journal_two():
    """A move, not a copy: a second handler for one path is the defect FastAPI's
    first-match rule hides until mount order changes."""
    from api.routers import journal_two
    j2 = set(_pairs(journal_two.router.routes))
    assert len(j2) > 100, "non-vacuity: journal_two's route table came back nearly empty"
    left = j2 & set(_pairs(_share_router().routes))
    assert not left, f"journal_two still declares {sorted(left)}"


# ── the REAL app ────────────────────────────────────────────────────────────

def test_each_share_route_appears_EXACTLY_ONCE_in_the_real_app():
    app = _real_app()
    counts = Counter(_pairs(app.router.routes))
    # ⭐ NON-VACUITY: the table is the real one, and the counter sees a known route.
    assert len(counts) > 300, f"the real app's route table collapsed to {len(counts)} pairs"
    assert counts[("GET", "/api/j2/notes/{note_id}")] == 1, "the counter no longer sees journal_two"
    for pair in _pairs(_share_router().routes):
        assert counts[pair] == 1, f"{pair} is served {counts[pair]} times by the real app (want 1)"


def test_each_share_request_is_answered_FIRST_by_the_share_router():
    """For every share route, a concrete request resolves to THIS router's handler --
    nothing mounted earlier (or broader) answers it first."""
    app = _real_app()
    for route in _share_router().routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods):
            got = _first_match(app, method, _concrete(route.path))
            assert got is not None, f"{method} {route.path}: nothing in the real app answers it"
            assert got.endpoint is route.endpoint, (
                f"{method} {route.path} is answered first by {getattr(got, 'path', got)} "
                f"({getattr(got.endpoint, '__module__', '?')}.{getattr(got.endpoint, '__name__', '?')})")


# ── controls: each check above can fail ─────────────────────────────────────

def test_CONTROL_the_counter_sees_a_route_mounted_twice():
    fa = FastAPI()
    fa.include_router(_share_router())
    fa.include_router(_share_router())
    counts = Counter(_pairs(fa.router.routes))
    assert {counts[p] for p in SEAM_FIVE} == {2}, counts


def test_CONTROL_the_resolver_sees_a_broader_route_mounted_in_front():
    fa = FastAPI()

    @fa.get("/api/j2/notes/{note_id}/{anything}")
    def shadow(note_id: str, anything: str):  # pragma: no cover -- never called
        return {}

    fa.include_router(_share_router())
    share_get = next(r for r in _share_router().routes
                     if isinstance(r, APIRoute) and r.path.endswith("/share") and "GET" in r.methods)
    got = _first_match(fa, "GET", _concrete(share_get.path))
    assert got is not None and got.endpoint is shadow, "the resolver did not report the shadow"
    # …and the same resolver, with nothing in front, finds the share handler.
    clean = FastAPI()
    clean.include_router(_share_router())
    assert _first_match(clean, "GET", _concrete(share_get.path)).endpoint is share_get.endpoint
