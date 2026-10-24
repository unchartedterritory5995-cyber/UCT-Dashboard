"""Routines and trackers: `/api/j2/routines` and `/api/j2/trackers` (Notebook widgets phase 2,
wave 9, Task 9.6).

The stores: `api/services/journal_two/routines.py` and `trackers.py`. This module is HTTP only:
it reads the body, checks the paid plan and the rate, and maps the stores' refusals.

Routines (declared in this order, so the literal paths win over `/{rid}`):

  GET  ""                       ?filter=active|archived|deleted
  POST ""                       {name, items, schedule, settings?, sourceTemplateKey?}
  GET  /starters                the ready-made routines
  GET  /import-day-rules        the labels of the newest day note's rules list
  POST /days                    {ids, days}: the batched day read
  GET  /{rid}   PUT /{rid}      read / edit (If-Match: the routine's etag) {name?, items?, schedule?, settings?}
  POST /{rid}/archive  /unarchive  /delete {typedName}  /undelete  /duplicate
  PUT  /{rid}/days/{day}/items/{item_id}   {ticked: bool}  -> the merged DayEntry
  PUT  /{rid}/days/{day}                   {skipped: bool} -> the merged DayEntry
  GET  /{rid}/used-in           the member's notes that place the routine (Task 9.10)
  GET  /{rid}/vs-pnl            day P&L on done days vs other days (Task 9.7)

Trackers: the same shape without starters, import, ticks and skips, plus
  PUT  /{tid}/days/{day}        {value: number | bool | null} -> the TrackerDay
  GET  /{tid}/vs-pnl            day P&L by the tracker's value range (Task 9.7)
The `{tid}` path accepts the built-ins `checkin:mood` and `checkin:focus` (read-only; the store
refuses every write to them with `read_only`).

The rules:
  * DARK: every route answers the `public.not_found()` 404 while `notebook_widgets_wave_on(9)` is
    false, read PER REQUEST, before anything else (the router-level dependency runs first).
  * PAID: this module's own `require_paid`, with its own sentence.
  * Ownership: `user_id` is the session member's, only. A foreign, unknown or deleted id answers
    the `public.not_found()` 404 on every `/{id}` route, and is absent from `POST /days`.
  * Errors: the stores' refusals are `tool_errors.ToolError`s carrying `status`, `code` and
    `sentence` (ruling W9-R10), and the router answers them from those attributes, the store
    being the one authority (ruling W9-R14; so `read_only` and `count_cap` are 409, each store's
    own `CountCap`). `NotFound` is the public 404. The router adds no mapping of its own. Store
    calls never sit
    inside a `try` that catches `ValueError` (a `ToolError` IS a `ValueError`): the body is read
    by its own dependency, before any store is called.
  * If-Match on `PUT /{id}` carries the `etag` (`save_seq`, R-15). Missing: 428 `conflict`
    "Reload to see the newer version." (R-27); stale: 409 `conflict`. Anything that is not a
    number is a stale tab too: `If-Match: *` (and `W/"x"`, `abc`) answers the same 409 `conflict`,
    never "any version". A foreign or deleted id answers the 404 before If-Match is read, so a
    missing header never reveals that someone else's id exists. Ticks, skips and logs take no
    If-Match (they merge per item).
  * Every refusal carries no-store too: the 402 below, `_err`'s 400/409/413/428/429, and the
    public 404 (`no-store, private`).
  * The stores take an optional `now=`; it is a test seam only and this router NEVER passes it
    (a request cannot choose its own day window).
  * A create with a `sourceTemplateKey` that finds the member's soft-deleted row (within the 30
    days) RESTORES THAT STORED ROW AS IT WAS: the name, items, kind, schedule and settings sent in
    the request are ignored. That is intended (ruling W9-R12).
  * Bodies are at most `MAX_BODY` bytes (413 `invalid`) and `MAX_BODY_DEPTH` levels (400 `invalid`).
    Every 200 is `Cache-Control: no-store`.
  * RATES (in-process slowapi storage, ⚠️ PER-PROCESS STATE: a second web process doubles them):
    every write (`POST`/`PUT`) takes `SCOPE_WRITE` at `WRITE_RATE`; `POST /days` and every `GET`
    take `SCOPE_READ` at `READ_RATE`. Both routers share the two scopes. Per member.
  * Every route is a sync `def`; the body is read by the async dependency `json_body`.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import notebook_widgets as nwidgets
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import routine_insights as rinsights
from api.services.journal_two import routines as rstore
from api.services.journal_two import trackers as tstore
from api.services.journal_two.json_depth import _json_depth_exceeds
from api.services.journal_two.tool_errors import ToolError

WAVE = 9
MAX_BODY = 8 * 1024
MAX_BODY_DEPTH = 16

WRITE_RATE = "120/minute"
SCOPE_WRITE = "notebook-routine-writes"
READ_RATE = "60/minute"
SCOPE_READ = "notebook-routine-reads"

S_RATE = "Too many changes in a minute. Try again shortly."
S_RATE_READ = "Too many reads in a minute. Try again shortly."
S_BODY_TOO_LARGE = "That is too much to send at once."
S_UNREADABLE_BODY = "That request couldn't be read."
#: Ruling R-27: a missing If-Match is a 428 the client treats as a conflict.
S_NEED_IF_MATCH = "Reload to see the newer version."

NO_STORE = {"Cache-Control": "no-store"}

_NOT_FOUND = (rstore.NotFound, tstore.NotFound)


def _wave_gate() -> None:
    """Router-level, so it runs before the paid gate and the body: dark is the one 404 for everyone."""
    if not nwidgets.notebook_widgets_wave_on(WAVE):
        raise public.not_found()


routines_router = APIRouter(
    prefix="/api/j2/routines",
    tags=["journal-2-0", "notebook-routines"],
    dependencies=[Depends(_wave_gate)],
)
trackers_router = APIRouter(
    prefix="/api/j2/trackers",
    tags=["journal-2-0", "notebook-trackers"],
    dependencies=[Depends(_wave_gate)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router module, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Routines and trackers require a paid plan",
                            headers=dict(NO_STORE))
    return user


# -- small helpers --------------------------------------------------------------------------------

def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message},
                         headers=dict(NO_STORE))


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=dict(NO_STORE))


def _uid(user: dict) -> str:
    return str(user["id"])


async def json_body(request: Request) -> dict:
    """The request body as a JSON object: at most `MAX_BODY` bytes (413 `invalid` over it) and at
    most `MAX_BODY_DEPTH` levels of nesting (400 `invalid`, as is a body the parser recurses out on).

    With no Content-Length (a chunked body) the stream is read only up to `MAX_BODY` + 1 bytes.
    This is the only place that catches `ValueError`; no store is called from here."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            too_big = int(declared) > MAX_BODY
        except ValueError:
            raise _err(400, "invalid", S_UNREADABLE_BODY)
        if too_big:
            raise _err(413, "invalid", S_BODY_TOO_LARGE)
        raw = await request.body()
    else:
        buf = bytearray()
        async for chunk in request.stream():
            buf.extend(chunk)
            if len(buf) > MAX_BODY:
                break
        raw = bytes(buf)
    if len(raw) > MAX_BODY:
        raise _err(413, "invalid", S_BODY_TOO_LARGE)
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise _err(400, "invalid", S_UNREADABLE_BODY)
    if not isinstance(body, dict) or _json_depth_exceeds(body, MAX_BODY_DEPTH):
        raise _err(400, "invalid", S_UNREADABLE_BODY)
    return body


def _rate(limit: str, scope: str, user_id: str, code: str, sentence: str) -> None:
    """One slowapi hit per request, keyed on the member (the `public.enforce_rate` shape, with this
    router's error body)."""
    from api.limiter import limiter
    if not limiter.enabled:
        return
    from limits import parse
    if not limiter.limiter.hit(parse(limit), scope, f"member:{user_id}"):
        raise _err(429, code, sentence)


def _write_rate(uid: str) -> None:
    _rate(WRITE_RATE, SCOPE_WRITE, uid, "rate", S_RATE)


def _read_rate(uid: str) -> None:
    _rate(READ_RATE, SCOPE_READ, uid, "rate", S_RATE_READ)


def _store(fn: Callable[[], Any]) -> Any:
    """Run one store call; answer its refusal from the error's own status, code and sentence."""
    try:
        return fn()
    except _NOT_FOUND:
        raise public.not_found()
    except ToolError as e:
        raise _err(e.status, e.code, e.sentence)


def _found(item: Any) -> Any:
    if item is None:
        raise public.not_found()
    return item


def _if_match(request: Request, stale_sentence: str) -> int:
    """The If-Match header as the item's etag. Missing: 428; not a number (`*` included): a stale
    tab (409)."""
    raw = request.headers.get("if-match")
    if raw is None or not raw.strip():
        raise _err(428, "conflict", S_NEED_IF_MATCH)
    v = raw.strip()
    if v.startswith("W/"):
        v = v[2:]
    v = v.strip().strip('"')
    try:
        return int(v)
    except ValueError:
        raise _err(409, "conflict", stale_sentence)


# -- routines -------------------------------------------------------------------------------------

@routines_router.get("")
def list_routines(filter: str = "active", user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok({"routines": _store(lambda: rstore.list_routines(uid, filter=filter))})


@routines_router.post("")
def create_routine(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    """A new routine. With a `sourceTemplateKey` that names the member's routine in Recently
    deleted, that stored routine is restored as it was and the sent fields are ignored (W9-R12)."""
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.create(
        uid, name=body.get("name"), items=body.get("items"), schedule=body.get("schedule"),
        settings=body.get("settings"), source_template_key=body.get("sourceTemplateKey"))))


@routines_router.get("/starters")
def routine_starters(user: dict = Depends(require_paid)) -> Any:
    _read_rate(_uid(user))
    return _ok({"starters": rstore.starters()})


@routines_router.get("/import-day-rules")
def routine_import_day_rules(user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok({"labels": _store(lambda: rstore.import_day_rules(uid))})


@routines_router.post("/days")
def routine_days(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok(_store(lambda: rstore.read_days(uid, body.get("ids"), body.get("days"))))


@routines_router.get("/{rid}")
def get_routine(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok(_found(rstore.get(uid, rid)))


@routines_router.put("/{rid}")
def save_routine(rid: str, request: Request, user: dict = Depends(require_paid),
                 body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    _found(rstore.get(uid, rid))
    etag = _if_match(request, rstore.S_CONFLICT)
    return _ok(_store(lambda: rstore.update(
        uid, rid, if_match=etag, name=body.get("name"), items=body.get("items"),
        schedule=body.get("schedule"), settings=body.get("settings"))))


@routines_router.post("/{rid}/archive")
def archive_routine(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.archive(uid, rid)))


@routines_router.post("/{rid}/unarchive")
def unarchive_routine(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.unarchive(uid, rid)))


@routines_router.post("/{rid}/delete")
def delete_routine(rid: str, user: dict = Depends(require_paid),
                   body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.soft_delete(uid, rid, typed_name=body.get("typedName"))))


@routines_router.post("/{rid}/undelete")
def undelete_routine(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.undelete(uid, rid)))


@routines_router.post("/{rid}/duplicate")
def duplicate_routine(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.duplicate(uid, rid)))


@routines_router.put("/{rid}/days/{day}/items/{item_id}")
def tick_routine_item(rid: str, day: str, item_id: str, user: dict = Depends(require_paid),
                      body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.set_tick(uid, rid, day, item_id, body.get("ticked"))))


@routines_router.put("/{rid}/days/{day}")
def skip_routine_day(rid: str, day: str, user: dict = Depends(require_paid),
                     body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.set_skipped(uid, rid, day, body.get("skipped"))))


@routines_router.get("/{rid}/used-in")
def routine_used_in(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    _found(rstore.get(uid, rid))
    return _ok({"notes": _store(lambda: rstore.used_in_notes(uid, rid))})


@routines_router.get("/{rid}/vs-pnl")
def routine_vs_pnl(rid: str, user: dict = Depends(require_paid)) -> Any:
    """`{done, other, winRate: {done, other}, sentence}`; a foreign, unknown or deleted id is the
    public 404."""
    uid = _uid(user)
    _read_rate(uid)
    return _ok(_found(_store(lambda: rinsights.routine_vs_pnl(uid, rid))))


# -- trackers -------------------------------------------------------------------------------------

@trackers_router.get("")
def list_trackers(filter: str = "active", user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok({"trackers": _store(lambda: tstore.list_trackers(uid, filter=filter))})


@trackers_router.post("")
def create_tracker(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    """A new tracker. With a `sourceTemplateKey` that names the member's tracker in Recently
    deleted, that stored tracker is restored as it was and the sent name, kind, unit and settings
    are ignored (W9-R12)."""
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.create(
        uid, name=body.get("name"), kind=body.get("kind"), unit=body.get("unit"),
        settings=body.get("settings"), source_template_key=body.get("sourceTemplateKey"))))


@trackers_router.post("/days")
def tracker_days(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok(_store(lambda: tstore.read_days(uid, body.get("ids"), body.get("days"))))


@trackers_router.get("/{tid}")
def get_tracker(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok(_found(tstore.get(uid, tid)))


@trackers_router.put("/{tid}")
def save_tracker(tid: str, request: Request, user: dict = Depends(require_paid),
                 body: dict = Depends(json_body)) -> Any:
    """`unit` absent keeps the unit and `null` clears it; a sent `kind` is refused by the store."""
    uid = _uid(user)
    _write_rate(uid)
    if tstore.is_builtin(tid):          # the store answers `read_only` before any If-Match
        return _ok(_store(lambda: tstore.update(uid, tid, if_match=0)))
    _found(tstore.get(uid, tid))
    etag = _if_match(request, tstore.S_CONFLICT)
    name, settings = body.get("name"), body.get("settings")
    # Explicit keywords only (never `**body`): `kind` present is refused by the store; `unit`
    # present (even null) is passed, absent keeps the stored unit.
    if "kind" in body:
        return _ok(_store(lambda: tstore.update(uid, tid, if_match=etag, kind=body["kind"])))
    if "unit" in body:
        return _ok(_store(lambda: tstore.update(uid, tid, if_match=etag, name=name,
                                                unit=body["unit"], settings=settings)))
    return _ok(_store(lambda: tstore.update(uid, tid, if_match=etag, name=name,
                                            settings=settings)))


@trackers_router.post("/{tid}/archive")
def archive_tracker(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.archive(uid, tid)))


@trackers_router.post("/{tid}/unarchive")
def unarchive_tracker(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.unarchive(uid, tid)))


@trackers_router.post("/{tid}/delete")
def delete_tracker(tid: str, user: dict = Depends(require_paid),
                   body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.soft_delete(uid, tid, typed_name=body.get("typedName"))))


@trackers_router.post("/{tid}/undelete")
def undelete_tracker(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.undelete(uid, tid)))


@trackers_router.post("/{tid}/duplicate")
def duplicate_tracker(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.duplicate(uid, tid)))


@trackers_router.put("/{tid}/days/{day}")
def log_tracker_day(tid: str, day: str, user: dict = Depends(require_paid),
                    body: dict = Depends(json_body)) -> Any:
    """`{value}`: a number, a bool (yes/no) or null (clears the day). The key is required, so an
    empty body is never read as a clear. A built-in is asked first: it answers `read_only`
    whatever the body."""
    uid = _uid(user)
    _write_rate(uid)
    if not tstore.is_builtin(tid) and "value" not in body:
        raise _err(400, "invalid", S_UNREADABLE_BODY)
    value = body.get("value")
    return _ok(_store(lambda: tstore.set_value(uid, tid, day, value)))


@trackers_router.get("/{tid}/used-in")
def tracker_used_in(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    _found(tstore.get(uid, tid))
    return _ok({"notes": _store(lambda: tstore.used_in_notes(uid, tid))})


@trackers_router.get("/{tid}/vs-pnl")
def tracker_vs_pnl(tid: str, user: dict = Depends(require_paid)) -> Any:
    """`{buckets, sentence}`; a foreign, unknown or deleted id is the public 404."""
    uid = _uid(user)
    _read_rate(uid)
    return _ok(_found(_store(lambda: rinsights.tracker_vs_pnl(uid, tid))))
