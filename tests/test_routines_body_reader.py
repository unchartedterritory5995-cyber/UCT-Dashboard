"""Task 9.6d (ruling W9-R54): the routine and tracker routes read their bodies through the widget
routers' one reader (`widget_request_body.read_json_object` over `request_body_cap.read_capped_body`),
each with its own cap, and every refusal they gave before stays byte-identical.

THE DIFFERENTIAL RAIL. `_parent_json_body` below is the reader these routes used at the parent
commit (76b36f768f, `api/routers/notebook_routines.py::json_body`), copied verbatim with its own
8 KiB cap and 16-level depth. Each route is served twice, once as shipped and once with that reader
put back, and the same table of bodies goes through both. The stores are replaced by an echo, so
what is compared is the HTTP layer alone: status, body bytes and Cache-Control.

The stores' own refusals are covered by `test_routines_router.py` against the real stores.
"""
from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import api.routers.notebook_routines as nr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import notebook_widget_definitions as definitions
from api.services.journal_two import routines as rstore
from api.services.journal_two import trackers as tstore
from api.services.journal_two import widget_request_body as wbody
from api.services.journal_two.json_depth import _json_depth_exceeds

PAID = {"id": "u-body", "email": "paid@example.test", "role": "member", "plan": "pro"}
DAY = "2026-11-04"

# -- the parent's reader, verbatim (76b36f768f) ---------------------------------------------------

PARENT_MAX_BODY = 8 * 1024
PARENT_MAX_BODY_DEPTH = 16
_P_TOO_LARGE = "That is too much to send at once."
_P_UNREADABLE = "That request couldn't be read."


def _p_err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message},
                         headers={"Cache-Control": "no-store"})


async def _parent_json_body(request: Request) -> dict:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            too_big = int(declared) > PARENT_MAX_BODY
        except ValueError:
            raise _p_err(400, "invalid", _P_UNREADABLE)
        if too_big:
            raise _p_err(413, "invalid", _P_TOO_LARGE)
        raw = await request.body()
    else:
        buf = bytearray()
        async for chunk in request.stream():
            buf.extend(chunk)
            if len(buf) > PARENT_MAX_BODY:
                break
        raw = bytes(buf)
    if len(raw) > PARENT_MAX_BODY:
        raise _p_err(413, "invalid", _P_TOO_LARGE)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise _p_err(400, "invalid", _P_UNREADABLE)
    if not isinstance(body, dict) or _json_depth_exceeds(body, PARENT_MAX_BODY_DEPTH):
        raise _p_err(400, "invalid", _P_UNREADABLE)
    return body


# -- the routes -----------------------------------------------------------------------------------

#: (endpoint, method, path, the route's reader, its cap constant, a valid body, headers)
ROUTES = [
    ("create_routine", "POST", "/api/j2/routines", "create_routine_body", "CREATE_ROUTINE_BODY_MAX",
     {"name": "Morning", "items": [{"text": "Read the wire"}], "schedule": {"kind": "every"}}, {}),
    ("save_routine", "PUT", "/api/j2/routines/r1", "save_routine_body", "SAVE_ROUTINE_BODY_MAX",
     {"name": "Morning"}, {"If-Match": "1"}),
    ("routine_days", "POST", "/api/j2/routines/days", "routine_days_body", "ROUTINE_DAYS_BODY_MAX",
     {"ids": ["r1"], "days": ["today"]}, {}),
    ("delete_routine", "POST", "/api/j2/routines/r1/delete", "delete_routine_body",
     "DELETE_ROUTINE_BODY_MAX", {"typedName": "Morning"}, {}),
    ("tick_routine_item", "PUT", f"/api/j2/routines/r1/days/{DAY}/items/i1", "tick_body",
     "TICK_BODY_MAX", {"ticked": True}, {}),
    ("skip_routine_day", "PUT", f"/api/j2/routines/r1/days/{DAY}", "skip_body", "SKIP_BODY_MAX",
     {"skipped": True}, {}),
    ("create_tracker", "POST", "/api/j2/trackers", "create_tracker_body", "CREATE_TRACKER_BODY_MAX",
     {"name": "Sleep", "kind": "number"}, {}),
    ("save_tracker", "PUT", "/api/j2/trackers/t1", "save_tracker_body", "SAVE_TRACKER_BODY_MAX",
     {"name": "Sleep", "unit": "h"}, {"If-Match": "1"}),
    ("tracker_days", "POST", "/api/j2/trackers/days", "tracker_days_body", "TRACKER_DAYS_BODY_MAX",
     {"ids": ["t1"], "days": ["today"]}, {}),
    ("delete_tracker", "POST", "/api/j2/trackers/t1/delete", "delete_tracker_body",
     "DELETE_TRACKER_BODY_MAX", {"typedName": "Sleep"}, {}),
    ("log_tracker_day", "PUT", f"/api/j2/trackers/t1/days/{DAY}", "tracker_value_body",
     "TRACKER_VALUE_BODY_MAX", {"value": 7.5}, {}),
]
IDS = [r[0] for r in ROUTES]

_ECHOED = {
    rstore: ("create", "update", "read_days", "soft_delete", "set_tick", "set_skipped"),
    tstore: ("create", "update", "read_days", "soft_delete", "set_value"),
}


def _echo(name: str):
    def fn(*a: Any, **kw: Any) -> dict:
        return {"fn": name, "a": list(a), "kw": kw}
    return fn


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    from api.limiter import limiter
    monkeypatch.setattr(limiter, "enabled", False)
    for store, names in _ECHOED.items():
        for name in names:
            monkeypatch.setattr(store, name, _echo(f"{store.__name__.rsplit('.', 1)[-1]}.{name}"))
    monkeypatch.setattr(rstore, "get", lambda uid, rid, **kw: {"id": rid, "etag": 1})
    monkeypatch.setattr(tstore, "get", lambda uid, tid, **kw: {"id": tid, "etag": 1})
    monkeypatch.setattr(tstore, "is_builtin", lambda tid: False)


def _client(parent: bool) -> TestClient:
    app = FastAPI()
    app.include_router(nr.routines_router)
    app.include_router(nr.trackers_router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    if parent:
        for row in ROUTES:
            app.dependency_overrides[getattr(nr, row[3])] = _parent_json_body
    return TestClient(app)


def _send(c: TestClient, row, **kw):
    _, method, path, _, _, _, headers = row
    hdrs = dict(headers)
    hdrs.update(kw.pop("headers", {}))
    return c.request(method, path, headers=hdrs, **kw)


def _shape(r) -> tuple:
    return r.status_code, r.content, r.headers.get("cache-control")


def _deep(levels: int) -> dict:
    out: dict = {}
    cur = out
    for _ in range(levels):
        cur["a"] = {}
        cur = cur["a"]
    return out


JSON = {"Content-Type": "application/json"}


def _table(valid: dict) -> dict[str, dict]:
    """The bodies both readers must answer identically (each a `c.request` keyword set)."""
    big = json.dumps({**valid, "pad": "x" * (nr.MAX_BODY + 10)}).encode()
    return {
        "valid": dict(content=json.dumps(valid).encode(), headers=JSON),
        "valid, no content-type": dict(content=json.dumps(valid).encode()),
        "empty": dict(content=b"", headers=JSON),
        "whitespace": dict(content=b" \r\n\t ", headers=JSON),
        "non-object: list": dict(content=b"[1, 2]", headers=JSON),
        "non-object: string": dict(content=b'"Morning"', headers=JSON),
        "non-object: number": dict(content=b"3", headers=JSON),
        "non-object: null": dict(content=b"null", headers=JSON),
        "non-object: true": dict(content=b"true", headers=JSON),
        "too deep": dict(content=json.dumps({**valid, "settings": _deep(nr.MAX_BODY_DEPTH + 2)})
                         .encode(), headers=JSON),
        "at the depth limit": dict(content=json.dumps({"x": _deep(nr.MAX_BODY_DEPTH - 1)}).encode(),
                                   headers=JSON),
        "malformed": dict(content=b"{not json", headers=JSON),
        "not utf-8": dict(content=b'{"name": "\xff"}', headers=JSON),
        "wrong content-type: text/plain": dict(content=json.dumps(valid).encode(),
                                               headers={"Content-Type": "text/plain"}),
        "wrong content-type: form": dict(content=b"name=Morning",
                                         headers={"Content-Type": "application/x-www-form-urlencoded"}),
        "malformed content-length": dict(content=b"{}", headers={**JSON, "Content-Length": "abc"}),
        "oversize, declared": dict(content=big, headers=JSON),
        "oversize, declared length only": dict(content=b"{}",
                                               headers={**JSON, "Content-Length": str(nr.MAX_BODY + 1)}),
    }


def _chunked_oversize():
    return iter([b'{"pad": "', b"x" * (nr.MAX_BODY + 10), b'"}'])


@pytest.mark.parametrize("row", ROUTES, ids=IDS)
def test_every_body_answers_as_the_parent_did(row):
    """THE DIFFERENTIAL RAIL: every case, byte-identical to the parent's reader."""
    new, old = _client(parent=False), _client(parent=True)
    table = _table(row[5])
    assert len(table) == 18
    statuses = set()
    for label, kw in table.items():
        a, b = _shape(_send(new, row, **kw)), _shape(_send(old, row, **kw))
        assert a == b, (row[0], label, a, b)
        statuses.add(a[0])
    a = _shape(_send(new, row, content=_chunked_oversize(), headers=JSON))
    b = _shape(_send(old, row, content=_chunked_oversize(), headers=JSON))
    assert a == b and a[0] == 413, (row[0], "oversize, chunked", a, b)
    # non-vacuity: the table reached the store (200), the reader's 400 and its 413
    assert {200, 400, 413} <= statuses, (row[0], statuses)


def test_the_oversize_refusal_is_the_widget_routers_shape():
    """The new 413 is the same response the widget definitions router gives, header included."""
    from fastapi import Depends
    big = json.dumps({"pad": "x" * (nr.MAX_BODY + 10)}).encode()
    widget_app = FastAPI()

    @widget_app.post("/w")
    def w(body: dict = Depends(definitions.json_body)) -> dict:
        return body

    theirs = _shape(TestClient(widget_app).post("/w", content=big, headers=JSON))
    assert theirs[0] == 413 and json.loads(theirs[1]) == {
        "detail": {"code": "invalid", "message": wbody.S_BODY_TOO_LARGE}}
    c = _client(parent=False)
    for row in ROUTES:
        for kw in (dict(content=big, headers=JSON),
                   dict(content=iter([big[:10], big[10:]]), headers=JSON)):
            assert _shape(_send(c, row, **kw)) == theirs, row[0]
    assert (nr.S_BODY_TOO_LARGE, nr.S_UNREADABLE_BODY) == (wbody.S_BODY_TOO_LARGE,
                                                           wbody.S_UNREADABLE_BODY)


def test_a_negative_content_length_is_the_one_answer_that_moved():
    """Stated, not hidden: the shared reader refuses a negative Content-Length (400 `invalid`);
    the parent's read it as "not too big" and read the body. A real server (h11) refuses such a
    request before the app sees it, so no member can send one."""
    row = ROUTES[0]
    kw = dict(content=json.dumps(row[5]).encode(), headers={**JSON, "Content-Length": "-1"})
    r = _send(_client(parent=False), row, **kw)
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid",
                                                           "message": wbody.S_UNREADABLE_BODY}
    assert _send(_client(parent=True), row, **kw).status_code == 200


# -- each route's own cap -------------------------------------------------------------------------

def _body_of_size(row, n: int) -> bytes:
    """A body of exactly `n` bytes: the route's valid body plus an ignored `pad` field."""
    base = {**row[5], "pad": ""}
    room = n - len(json.dumps(base).encode())
    assert room >= 0, (row[0], n)
    out = json.dumps({**row[5], "pad": "x" * room}).encode()
    assert len(out) == n
    return out


@pytest.mark.parametrize("row", ROUTES, ids=IDS)
def test_each_route_reads_up_to_its_own_cap_and_refuses_one_byte_more(row):
    cap = getattr(nr, row[4])
    c = _client(parent=False)
    for chunked in (False, True):
        at = _body_of_size(row, cap)
        over = _body_of_size(row, cap + 1)
        kw_at = dict(content=iter([at[:10], at[10:]]) if chunked else at, headers=JSON)
        kw_over = dict(content=iter([over[:10], over[10:]]) if chunked else over, headers=JSON)
        r = _send(c, row, **kw_at)
        assert r.status_code == 200 and r.json()["fn"], (row[0], chunked, r.status_code, r.text[:200])
        r = _send(c, row, **kw_over)
        assert r.status_code == 413, (row[0], chunked, r.status_code)


def test_the_caps_are_derived_and_none_is_below_the_floor():
    """Each cap is max(the largest body whose every field the route reads, the floor), and the
    floor is the definitions router's cap, read from it rather than restated."""
    assert nr.IGNORED_FIELDS_FLOOR == definitions.MAX_BODY
    assert set(nr.LARGEST) == set(IDS)
    for endpoint, *_rest in ROUTES:
        cap = getattr(nr, _rest[3])
        assert cap == max(nr.LARGEST[endpoint], nr.IGNORED_FIELDS_FLOOR), endpoint
    assert nr.MAX_BODY == max(getattr(nr, r[4]) for r in ROUTES)
    # the routine edit is the one the stores make larger than the floor
    assert nr.SAVE_ROUTINE_BODY_MAX == nr.LARGEST["save_routine"] > nr.IGNORED_FIELDS_FLOOR


def test_the_table_is_every_route_that_reads_a_body():
    """Derived from the routers, so a new body route without a row here fails by name."""
    readers = {getattr(nr, r[3]) for r in ROUTES}
    found = {}
    for router in (nr.routines_router, nr.trackers_router):
        for route in router.routes:
            deps = {d.call for d in route.dependant.dependencies}
            hit = deps & readers
            if hit:
                found[route.endpoint.__name__] = next(iter(hit)).__name__
    assert found == {r[0]: r[3] for r in ROUTES}
    assert len(set(found.values())) == len(ROUTES), "each route has its own reader"
