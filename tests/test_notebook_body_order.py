"""A JSON body is read after the dark-flag gate and after the session check, and capped.

SECURITY REVIEW I-5 (2026-10-06). Four Notebook routes declared a FastAPI body
parameter: `POST /api/j2/thesis-chips`, `POST /api/j2/research-capture/transcripts/save`,
`POST /api/j2/research-capture/passed-setups`, `PUT /api/j2/onboarding/tours/{tour_id}`.
FastAPI reads the body for a declared parameter BEFORE it solves any dependency, so:

  * with the flag off, malformed JSON answered 422 where every other request to
    the route answered 404 -- an outsider could tell the dark feature is in the
    build; and
  * an anonymous caller could make the process buffer a body of any size.

The fix is `request_body_cap.capped_json`: a dependency that stands in for the
declared parameter, reads the body CAPPED, and only after the session dependency
it is given. This file tests that helper against the parameter it replaces, and
holds every gated route in the family to: gate, then session, then the body.

The whole-family census (every router, gated or not) is
`tests/test_notebook_body_census.py`.
"""
from __future__ import annotations

from typing import Iterator

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

from api.services import request_body_cap as body_cap
from tests.support import body_census as bc
from tests.test_notebook_upload_cap import Drive, db_path  # noqa: F401  (fixture by import)

in_family = bc.in_family


@pytest.fixture(scope="module")
def real_app():
    from api.main import app
    return app


# ── the two shapes the app boots in ──────────────────────────────────────────
#
# `api/main.py` mounts the page catch-all (`/{full_path:path}`, GET and HEAD) only when a built
# bundle (`app/dist`) exists. That changes what an UNKNOWN write path answers: 404 with no
# bundle, 405 with one (the catch-all matches the path and refuses the method). Three tests
# below compare a dark route with an unknown one, and they used to pass in CI (no bundle) and
# fail on a developer's box after `npm run build`. A test must not depend on that. So each
# shape is BUILT here from the real app, whatever this checkout happens to have on disk, and
# both facts are asserted by name in every environment.
SPA_CATCH_ALL = "/{full_path:path}"


def _shape(app, *, bundle: bool):
    """The real app with the page catch-all present (`bundle=True`) or absent. Same routes,
    same order, same middleware; only that one route differs. The app itself is not touched."""
    import copy
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route
    routes = [r for r in app.router.routes if getattr(r, "path", None) != SPA_CATCH_ALL]
    if bundle:
        mounted = [r for r in app.router.routes if getattr(r, "path", None) == SPA_CATCH_ALL]
        routes = list(app.router.routes) if mounted else routes + [
            Route(SPA_CATCH_ALL, lambda request: PlainTextResponse("page"), methods=["GET", "HEAD"])]
    shaped = copy.copy(app)
    shaped.router = copy.copy(app.router)
    shaped.router.routes = routes
    # Both layers cache a bound callable of the ORIGINAL object; without these two lines the
    # copy would quietly dispatch through the real app's route table and the shapes would be
    # one shape (the test below is what caught that).
    if hasattr(shaped.router, "middleware_stack"):
        assert not getattr(app.router, "middleware", None), "the router carries middleware: rebuild it here"
        shaped.router.middleware_stack = shaped.router.app
    shaped.middleware_stack = None        # rebuilt on first call, around THIS router
    return shaped


@pytest.fixture(scope="module")
def no_bundle_app(real_app):
    return _shape(real_app, bundle=False)


@pytest.fixture(scope="module")
def bundle_app(real_app):
    return _shape(real_app, bundle=True)


def test_the_two_shapes_differ_by_the_page_catch_all_and_nothing_else(real_app, no_bundle_app, bundle_app):
    paths = lambda a: [getattr(r, "path", None) for r in a.router.routes]
    assert SPA_CATCH_ALL not in paths(no_bundle_app)
    assert paths(bundle_app).count(SPA_CATCH_ALL) == 1
    assert [x for x in paths(bundle_app) if x != SPA_CATCH_ALL] == paths(no_bundle_app)
    assert len(paths(no_bundle_app)) > 500                       # the real route table, not a stub
    # and the shapes behave as named: an unknown READ is a page with a bundle, a 404 without
    assert TestClient(bundle_app).get("/no-such-page-9f3a").status_code == 200
    assert TestClient(no_bundle_app).get("/no-such-page-9f3a").status_code == 404


# ── every GATED route: gate, then session, then a bounded body ───────────────

def _gated_rows(real_app) -> list[bc.Row]:
    return [r for r in bc.census(real_app, in_family) if r.gate_position is not None]


def test_no_gated_route_declares_a_body_parameter_or_reads_one_unbounded(real_app):
    rows = _gated_rows(real_app)
    reading = sum(r.reads_body for r in rows)
    assert len(rows) > 60 and reading > 25, (len(rows), reading)
    wrong = [f"{r.method} {r.path}: " + "; ".join(f"{x.call} in {x.where}" for x in r.uncapped)
             for r in rows if r.uncapped]
    assert not wrong, "a route behind a flag gate reads a body with no bound:\n  " + "\n  ".join(wrong)


def test_every_gated_route_reads_its_body_after_the_gate_and_the_session(real_app):
    wrong = [f"{r.method} {r.path}: " + "; ".join(r.order_problems())
             for r in _gated_rows(real_app) if r.order_problems()]
    assert not wrong, "body read out of order on a gated route:\n  " + "\n  ".join(wrong)


def test_the_order_check_can_fail():
    """Control: a gated route that declares its body is reported, both ways."""
    def _require_enabled() -> None:
        raise HTTPException(status_code=404, detail="Not found")
    _require_enabled.__qualname__ = "_require_enabled"     # the name every router's gate carries

    def get_current_user() -> dict:
        return {"id": "u"}

    app = FastAPI(dependencies=[Depends(_require_enabled)])

    @app.post("/declared")
    def declared(payload: dict, user: dict = Depends(get_current_user)):
        return payload

    @app.post("/capped")
    def capped(payload: dict = Depends(body_cap.capped_json(dict, lambda: 64, lambda: "x", after=get_current_user)),
               user: dict = Depends(get_current_user)):
        return payload

    rows = {r.path: r for r in bc.census(app, lambda route: True)}
    assert rows["/declared"].order_problems() == ["the body is read before the dark-flag gate",
                                                  "the body is read before the session check"]
    assert [x.how for x in rows["/declared"].uncapped] == ["fastapi-param"]
    assert rows["/capped"].order_problems() == [] and rows["/capped"].uncapped == []


# ── the helper the family reads JSON through ─────────────────────────────────

class _Thing(BaseModel):
    name: str
    count: int = 0


@pytest.fixture
def helper_app():
    """Two doors on the new helper, and beside each the same door declared the
    FastAPI way, so every answer can be compared with the one it replaces."""
    seen = {"auth": 0}

    def who(request: Request) -> dict:
        seen["auth"] += 1
        if request.headers.get("x-user") != "ok":
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {"id": "u"}

    limit = 2048
    app = FastAPI()

    @app.post("/new/dict")
    def new_dict(payload: dict = Depends(body_cap.capped_json(dict, lambda: limit, lambda: "Too big", after=who)),
                 user: dict = Depends(who)):
        return {"got": payload}

    @app.post("/old/dict")
    def old_dict(payload: dict, user: dict = Depends(who)):
        return {"got": payload}

    @app.post("/new/optional")
    def new_optional(payload: dict | None = Depends(
            body_cap.capped_json(dict | None, lambda: limit, lambda: "Too big", after=who)),
                     user: dict = Depends(who)):
        return {"got": payload}

    @app.post("/old/optional")
    def old_optional(payload: dict | None = None, user: dict = Depends(who)):
        return {"got": payload}

    @app.post("/new/model")
    def new_model(body: _Thing = Depends(body_cap.capped_json(_Thing, lambda: limit, lambda: "Too big", after=who)),
                  user: dict = Depends(who)):
        return {"name": body.name, "count": body.count, "type": type(body).__name__}

    @app.post("/old/model")
    def old_model(body: _Thing, user: dict = Depends(who)):
        return {"name": body.name, "count": body.count, "type": type(body).__name__}

    return app, limit, seen


OK = {"x-user": "ok"}
_SAME_AS_FASTAPI = [
    ("dict", b'{"a": 1}', "application/json"),
    ("dict", b"", "application/json"),
    ("dict", b"[1, 2]", "application/json"),
    ("dict", b"null", "application/json"),
    ("dict", b'"text"', "application/json"),
    ("dict", b'{"a": 1}', "text/plain"),
    ("dict", b'{"a": 1}', "application/vnd.api+json"),
    ("dict", b'{"a": 1}', None),
    ("optional", b"", "application/json"),
    ("optional", b"null", "application/json"),
    ("optional", b'{"a": 1}', "application/json"),
    ("optional", b"[1]", "application/json"),
    ("model", b'{"name": "n", "count": 3}', "application/json"),
    ("model", b'{"name": "n"}', "application/json"),
    ("model", b'{"count": 3}', "application/json"),
    ("model", b'{"name": "n", "count": "many"}', "application/json"),
    ("model", b"", "application/json"),
    ("model", b'{"name": "n", "extra": 1}', "application/json"),
    # found by the old-versus-new differential (docs/notebook/evidence/fin-voice/differential):
    # FastAPI validates a model body with `from_attributes`, so a non-object is
    # `model_attributes_type`, not the `model_type` a bare TypeAdapter gives.
    ("model", b"[1, 2]", "application/json"),
    ("model", b'"text"', "application/json"),
    ("model", b"42", "application/json"),
    ("model", b"null", "application/json"),
    ("model", b'{"name": "n"}', "text/plain"),
    ("model", b'{"name": "n"}', "application/x-www-form-urlencoded"),
]


@pytest.mark.parametrize("door, body, ctype", _SAME_AS_FASTAPI,
                         ids=[f"{d}-{b[:18]!r}-{c}" for d, b, c in _SAME_AS_FASTAPI])
def test_capped_json_answers_what_a_declared_body_parameter_answered(helper_app, door, body, ctype):
    """Status, and the accepted value, are the ones FastAPI gave for the same
    request. For a refusal the error TYPE and LOCATION are the same too."""
    app, _limit, _seen = helper_app
    client = TestClient(app)
    headers = dict(OK)
    if ctype:
        headers["content-type"] = ctype
    new = client.post(f"/new/{door}", content=body, headers=headers)
    old = client.post(f"/old/{door}", content=body, headers=headers)
    assert new.status_code == old.status_code, (new.status_code, new.text, old.status_code, old.text)
    if old.status_code == 200:
        assert new.json() == old.json()
    else:
        shape = lambda r: [(e["type"], e["loc"], e["msg"]) for e in r.json()["detail"]]  # noqa: E731
        assert shape(new) == shape(old), (new.text, old.text)


def test_capped_json_refuses_broken_json_as_fastapi_did(helper_app):
    app, _limit, _seen = helper_app
    client = TestClient(app)
    headers = {**OK, "content-type": "application/json"}
    new = client.post("/new/dict", content=b'{"a": ', headers=headers)
    old = client.post("/old/dict", content=b'{"a": ', headers=headers)
    assert new.status_code == old.status_code == 422
    assert new.json()["detail"][0]["type"] == old.json()["detail"][0]["type"] == "json_invalid"
    assert new.json()["detail"][0]["loc"][0] == "body"


def _chunks(total: int, chunk: int = 512) -> Iterator[bytes]:
    yield b'{"a": "'
    left = total - 9
    while left > 0:
        n = min(chunk, left)
        yield b"x" * n
        left -= n
    yield b'"}'


def _drive(app, path, body, *, declared=None, headers=None, method="POST") -> Drive:
    h = {"content-type": "application/json", **(headers or {})}
    if declared is not None:
        h["content-length"] = str(declared)
    else:
        h["transfer-encoding"] = "chunked"
    return Drive(app, path, body, headers=h, method=method).run()


def test_capped_json_at_the_cap_is_accepted_and_one_byte_over_is_413(helper_app):
    app, limit, _seen = helper_app
    at = _drive(app, "/new/dict", _chunks(limit), headers=OK)
    assert at.status == 200 and at.pulled == limit
    over = _drive(app, "/new/dict", _chunks(limit + 1), headers=OK)
    assert over.status == 413 and over.json() == {"detail": "Too big"}


def test_capped_json_stops_reading_at_the_cap(helper_app):
    app, limit, _seen = helper_app
    far = _drive(app, "/new/dict", _chunks(limit * 200), headers=OK)
    assert far.status == 413 and far.pulled <= limit + 512, far.pulled
    lying = _drive(app, "/new/dict", _chunks(limit * 200), declared=10, headers=OK)
    assert lying.status == 413 and lying.pulled <= limit + 512
    declared = _drive(app, "/new/dict", _chunks(limit * 200), declared=limit * 200, headers=OK)
    assert declared.status == 413 and declared.pulled == 0


def test_capped_json_reads_nothing_until_the_session_check_has_passed(helper_app):
    """THE ORDER, measured: an anonymous caller is refused with 0 body bytes
    pulled, where the declared parameter beside it pulls the whole body first."""
    app, limit, seen = helper_app
    new = _drive(app, "/new/dict", _chunks(limit * 50))
    assert new.status == 401 and new.pulled == 0
    old = _drive(app, "/old/dict", _chunks(limit * 50))
    assert old.status == 401 and old.pulled == limit * 50, "the control no longer shows the defect"
    # and malformed JSON from an anonymous caller is the session's answer, not a 422
    assert _drive(app, "/new/dict", iter([b"{"])).status == 401
    assert _drive(app, "/old/dict", iter([b"{"])).status == 422


def test_capped_json_runs_the_session_check_once_per_request(helper_app):
    app, _limit, seen = helper_app
    r = TestClient(app).post("/new/dict", json={"a": 1}, headers=OK)
    assert r.status_code == 200 and seen["auth"] == 1


def test_capped_json_without_a_session_dependency_still_caps(helper_app):
    app = FastAPI()

    @app.post("/open")
    def open_door(payload: dict = Depends(body_cap.capped_json(dict, lambda: 64, lambda: "Too big"))):
        return payload

    assert TestClient(app).post("/open", json={"a": 1}).json() == {"a": 1}
    assert _drive(app, "/open", _chunks(4096)).status == 413


# ── a dark route answers one thing, whatever it is sent ──────────────────────

def _dark_body_routes(real_app) -> list[tuple[str, str]]:
    """Every family route that takes a body and whose flag gate refuses right now."""
    out = []
    for route in real_app.routes:
        if not isinstance(route, APIRoute) or not in_family(route):
            continue
        gate = next((fn for fn in bc.solve_order(route) if bc._name(fn) == bc.GATE_QUALNAME), None)
        if gate is None:
            continue
        try:
            gate()
        except HTTPException as e:
            if e.status_code != 404:
                continue
        else:
            continue        # the gate is open in this environment: not dark
        for method in sorted(route.methods & bc.BODY_METHODS):
            out.append((method, route.path))
    return sorted(set(out))


def _concrete(path: str) -> str:
    """The path with every parameter filled in."""
    import re
    return re.sub(r"\{[^}]+\}", "x1", path)


def _unknown_sibling(path: str) -> str:
    """A path below this one that no route serves. Two segments deeper, because
    one segment beside it can land on a neighbour's `/{id}` pattern for another
    method (405), which is a known route answering, not an unknown one."""
    return path + "/no-such-door-9f3a/zz"


def test_the_four_routes_the_review_named_are_dark_here_and_take_a_body(real_app):
    """Non-vacuity for the dark-route tests below: I-5's four are among them."""
    dark = set(_dark_body_routes(real_app))
    named = {("POST", "/api/j2/thesis-chips"),
             ("POST", "/api/j2/research-capture/transcripts/save"),
             ("POST", "/api/j2/research-capture/passed-setups")}
    assert named <= dark, sorted(named - dark)
    assert len(dark) >= 10, sorted(dark)


def test_an_anonymous_request_to_a_dark_route_answers_one_thing_whatever_its_body(real_app):
    """Empty, well formed, malformed and oversized: the same status, the same
    bytes, and no body byte read. Before the fix a malformed body answered 422
    on the routes that declared a body parameter."""
    different = []
    for method, path in _dark_body_routes(real_app):
        url = _concrete(path)
        ref = _drive(real_app, url, iter([b"{}"]), method=method)
        bodies = {
            "empty": iter([]),
            "malformed": iter([b"{"]),
            "not an object": iter([b"[1, 2, 3]"]),
            "oversized": _chunks(8 * 1024 * 1024, chunk=256 * 1024),
        }
        for label, body in bodies.items():
            got = _drive(real_app, url, body, method=method)
            if (got.status, got.payload) != (ref.status, ref.payload) or got.pulled != 0:
                different.append(f"{method} {path} [{label}]: {got.status} {got.payload[:80]!r} "
                                 f"pulled={got.pulled} (well formed: {ref.status} {ref.payload[:80]!r})")
        if ref.status != 404 or ref.pulled != 0:
            different.append(f"{method} {path} [well formed]: {ref.status} pulled={ref.pulled}")
    assert not different, "a dark route can be told apart by what it is sent:\n  " + "\n  ".join(different)


def test_a_dark_route_answers_the_status_an_unknown_route_answers(real_app, no_bundle_app):
    """With NO bundle mounted: an unknown path under the same prefix, sent the same malformed
    and oversized bodies. The status is the same and neither reads the body."""
    different = []
    for method, path in _dark_body_routes(real_app):
        url, unknown = _concrete(path), _unknown_sibling(_concrete(path))
        for label, make in (("malformed", lambda: iter([b"{"])),
                            ("oversized", lambda: _chunks(8 * 1024 * 1024, chunk=256 * 1024))):
            dark = _drive(no_bundle_app, url, make(), method=method)
            miss = _drive(no_bundle_app, unknown, make(), method=method)
            if dark.status != miss.status or dark.pulled != 0 or miss.pulled != 0:
                different.append(f"{method} {path} [{label}]: dark {dark.status} pulled={dark.pulled}; "
                                 f"unknown {miss.status} pulled={miss.pulled}")
    assert not different, "\n  ".join(different)


def test_KNOWN_LIMITATION_with_a_bundle_mounted_an_unknown_write_path_is_405_and_a_dark_route_404(
        real_app, bundle_app):
    """ACCEPTED AND RECORDED, NOT A PASS: docs/notebook/LANDING-12-15.md section 10, "A finding".
    With a built bundle the page catch-all (GET and HEAD only) matches every unknown path, so an
    unknown POST, PUT, PATCH or DELETE answers 405 while a dark route answers 404. On a
    production-shaped app a dark write route can therefore be told from a path that does not
    exist. The catch-all is master's and predates the landing; the controller accepted it as a
    known limitation on 2026-10-07. This pins the ACTUAL behaviour, so the day somebody closes
    the difference this test fails and the comparison above can cover both shapes.
    What still holds with a bundle, and is asserted: neither answer reads a body byte."""
    rows = _dark_body_routes(real_app)
    assert len(rows) >= 10
    wrong = []
    for method, path in rows:
        url, unknown = _concrete(path), _unknown_sibling(_concrete(path))
        dark = _drive(bundle_app, url, iter([b"{"]), method=method)
        miss = _drive(bundle_app, unknown, iter([b"{"]), method=method)
        if (dark.status, miss.status) != (404, 405) or dark.pulled != 0 or miss.pulled != 0:
            wrong.append(f"{method} {path}: dark {dark.status} pulled={dark.pulled}; "
                         f"unknown {miss.status} pulled={miss.pulled}")
    assert not wrong, "the recorded limitation no longer describes the app:\n  " + "\n  ".join(wrong)


def test_with_its_flag_on_the_onboarding_tour_door_still_refuses_before_reading(real_app, monkeypatch):
    """The tours door sits behind a gate that may be on. Whatever the flag says,
    an anonymous caller is answered before one body byte is read."""
    from api.routers import notebook_onboarding
    for on in (False, True):
        monkeypatch.setattr(notebook_onboarding, "onboarding_enabled", lambda on=on: on)
        for label, body in (("malformed", iter([b"{"])), ("oversized", _chunks(4 * 1024 * 1024, chunk=256 * 1024))):
            got = _drive(real_app, "/api/j2/onboarding/tours/first-note", body, method="PUT")
            assert got.status == (401 if on else 404), (on, label, got.status, got.payload[:120])
            assert got.pulled == 0, (on, label, got.pulled)


# ── the dark 404's BYTES, against an unknown route's ─────────────────────────

def _gate_of(route):
    return next(fn for fn in bc.solve_order(route) if bc._name(fn) == bc.GATE_QUALNAME)


def test_the_onboarding_gates_404_is_byte_identical_to_an_unknown_routes(no_bundle_app, bundle_app, monkeypatch):
    """`notebook_onboarding.py` words its own gate 404 (`NOT_FOUND`). With the gate
    off, a malformed and an oversized anonymous request to the tours door answer
    the exact bytes an unknown path under the same prefix answers. That comparison is made
    with NO bundle mounted; with one, the unknown path is the catch-all's 405 (the known
    limitation above) and the door's own bytes are asserted alone."""
    real_app = no_bundle_app
    from api.routers import notebook_onboarding
    monkeypatch.setattr(notebook_onboarding, "onboarding_enabled", lambda: False)
    door = "/api/j2/onboarding/tours/first-note"
    for make in (lambda: iter([b"{"]), lambda: _chunks(4 * 1024 * 1024, chunk=256 * 1024)):
        dark = _drive(real_app, door, make(), method="PUT")
        miss = _drive(real_app, _unknown_sibling(door), make(), method="PUT")
        assert (dark.status, dark.payload) == (miss.status, miss.payload) == (404, b'{"detail":"Not Found"}')
        assert dark.pulled == 0
        with_bundle = _drive(bundle_app, door, make(), method="PUT")
        assert (with_bundle.status, with_bundle.payload, with_bundle.pulled) == (404, b'{"detail":"Not Found"}', 0)


def test_every_dark_404_that_differs_from_an_unknown_routes_comes_from_the_shared_public_helper(real_app, no_bundle_app):
    """Compared with NO bundle mounted, where an unknown path is FastAPI's own 404 (with a
    bundle it is the catch-all's 405: the known limitation above).
    KNOWN, AND NOT THIS FILE'S TO CHANGE. Most Notebook gates raise
    `public_note_payload.not_found()`, whose body is `{"detail":"Not found"}`:
    one letter's case away from FastAPI's `{"detail":"Not Found"}`. This pins
    WHERE the difference comes from, so a router that words its own different
    404 fails by name, and it stops passing the day the shared helper is made
    byte-identical (delete this test then, and widen the one above)."""
    from api.services.journal_two import public_note_payload as public
    shared, own_and_different, identical = set(), [], set()
    by_key = {(m, r.path): r for r in real_app.routes if isinstance(r, APIRoute) for m in r.methods}
    for method, path in _dark_body_routes(real_app):
        url = _concrete(path)
        dark = _drive(no_bundle_app, url, iter([b"{"]), method=method)
        miss = _drive(no_bundle_app, _unknown_sibling(url), iter([b"{"]), method=method)
        assert miss.status == 404, (method, path, miss.status)
        module = by_key[(method, path)].endpoint.__module__.rsplit(".", 1)[-1]
        if dark.payload == miss.payload:
            identical.add(module)
            continue
        try:
            _gate_of(by_key[(method, path)])()
        except HTTPException as e:
            if e.detail == public.NOT_FOUND_DETAIL:
                shared.add(module)
                continue
        own_and_different.append(f"{method} {path} ({module}): {dark.payload!r}")
    assert not own_and_different, "a router words its own dark 404 differently:\n  " + "\n  ".join(own_and_different)
    assert {"notebook_thesis_chips", "notebook_research_capture"} <= shared, sorted(shared)


# ── the admin API docs still describe these routes' bodies ───────────────────

def _capped_json_routes(real_app):
    """(method, route, dependency) for every route that takes its body through capped_json."""
    out = []
    for route in real_app.routes:
        if not isinstance(route, APIRoute):
            continue
        dep = next((d for d in route.dependant.dependencies
                    if bc._name(d.call) == bc.CAPPED_JSON_QUALNAME), None)
        if dep is not None:
            out.extend((m, route, dep) for m in sorted(route.methods - {"HEAD", "OPTIONS"}))
    return out


def test_every_converted_route_has_a_request_body_schema_in_the_api_docs(real_app):
    """A dependency does not appear in OpenAPI as a body, so the conversion took
    the request body out of the admin docs for every converted route.
    `request_body_cap.document_json_bodies` puts it back, from the annotation.
    The route list is derived, never typed: a route converted tomorrow is held
    to this the day it lands."""
    import typing
    from pydantic import BaseModel
    routes = _capped_json_routes(real_app)
    assert len(routes) >= 90, len(routes)
    paths = real_app.openapi()["paths"]
    missing, wrong = [], []
    for method, route, dep in routes:
        entry = paths.get(route.path, {}).get(method.lower(), {})
        schema = entry.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
        if not schema:
            missing.append(f"{method} {route.path}")
            continue
        annotation = dep.call.annotation
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        optional = type(None) in typing.get_args(annotation)
        inner = args[0] if optional and args else annotation
        if entry["requestBody"]["required"] is optional:
            wrong.append(f"{method} {route.path}: required={entry['requestBody']['required']} for {annotation}")
        if isinstance(inner, type) and issubclass(inner, BaseModel):
            want = {(f.alias or n) for n, f in inner.model_fields.items()}
            if set(schema.get("properties", {})) != want:
                wrong.append(f"{method} {route.path}: properties {sorted(schema.get('properties', {}))} != {sorted(want)}")
            need = {(f.alias or n) for n, f in inner.model_fields.items() if f.is_required()}
            if set(schema.get("required", [])) != need:
                wrong.append(f"{method} {route.path}: required {schema.get('required')} != {sorted(need)}")
        if "$defs" in json_dumps(schema):
            wrong.append(f"{method} {route.path}: the schema carries $defs, which OpenAPI cannot resolve here")
    assert not missing, f"{len(missing)} converted routes have no request body in the API docs:\n  " + "\n  ".join(missing)
    assert not wrong, "\n  ".join(wrong)


def json_dumps(value) -> str:
    import json
    return json.dumps(value)


def test_documenting_the_bodies_changes_nothing_about_how_a_request_is_handled(real_app):
    """It only writes each route's `openapi_extra`, and only when the docs are
    asked for. The dependency list a request is solved against is untouched."""
    before = {(r.path, tuple(sorted(r.methods))): [bc._name(c) for c in bc.solve_order(r)]
              for r in real_app.routes if isinstance(r, APIRoute)}
    real_app.openapi_schema = None
    real_app.openapi()
    after = {(r.path, tuple(sorted(r.methods))): [bc._name(c) for c in bc.solve_order(r)]
             for r in real_app.routes if isinstance(r, APIRoute)}
    assert before == after
    assert all(r.body_field is None for _m, r, _d in _capped_json_routes(real_app))
