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
  * BODIES (Task 9.6d, ruling W9-R54): every body is read through the widget routers' one reader,
    `widget_request_body.read_json_object`, over `request_body_cap.read_capped_body`, so the cap is
    counted WHILE the body arrives whatever the Content-Length says. Each route has its OWN cap (the
    `*_BODY_MAX` constants): the larger of `LARGEST[route]`, the largest body whose every field
    the route reads, MEASURED from the stores' limits (`json.dumps`'s default spelling, every
    counted character at its widest JSON spelling, `_WIDE`), and `IGNORED_FIELDS_FLOOR`, the
    definitions router's cap, for the fields a route ignores. Over it: 413 `invalid`; deeper than
    `MAX_BODY_DEPTH` levels, not UTF-8 JSON, or not an object: 400 `invalid`; empty: `{}`.
    Every 200 is `Cache-Control: no-store`.
  * RATES (in-process slowapi storage, ⚠️ PER-PROCESS STATE: a second web process doubles them):
    every write (`POST`/`PUT`) takes `SCOPE_WRITE` at `WRITE_RATE`; `POST /days` and every `GET`
    take `SCOPE_READ` at `READ_RATE`. Both routers share the two scopes. Per member.
  * Every route is a sync `def`; the body is read by the route's own async `*_body` dependency.
  * DUPLICATE IS IDEMPOTENT (Task 9.6b, ruling W9-R48): `POST /{id}/duplicate` reads an
    `Idempotency-Key: <uuid4>` header (`tool_create_keys.duplicate_with_key`, the widget create
    key's design). The same key on the same source answers the copy it already made (200, with
    `replayed: true`); the same key on another source or kind is a 409 `conflict`; a missing or
    malformed key is the plain duplicate. Per member, kept 24 h.
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import date
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers import notebook_widget_definitions as definitions
from api.services import request_body_cap as body_cap
from api.services.journal_two import notebook_widgets as nwidgets
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import routine_days
from api.services.journal_two import routine_insights as rinsights
from api.services.journal_two import routines as rstore
from api.services.journal_two import tool_create_keys as tkeys
from api.services.journal_two import tracker_days
from api.services.journal_two import trackers as tstore
from api.services.journal_two import widget_request_body as wbody
from api.services.journal_two.tool_errors import ToolError

WAVE = 9
MAX_BODY_DEPTH = 16


# -- the body caps (Task 9.6d) ---------------------------------------------------------------------
#
# Each route's cap is the larger of two sizes:
#   * `*_LARGEST`: the largest body whose every field the route reads, measured from the stores'
#     own limits (below), never typed;
#   * `IGNORED_FIELDS_FLOOR`: a route ignores any field it does not name (a test sends `now` to
#     show a body cannot choose its clock), so a legal body has no upper bound of its own. Where the
#     stores give none, the definitions router's `MAX_BODY` is the cap.

#: The widest JSON spelling of ONE character as the stores count characters (`len` of a str counts
#: code points): an astral code point, which `json.dumps` writes as an escaped surrogate pair (two
#: six-byte escapes, 12 bytes). A browser's `JSON.stringify` writes it as 4 raw UTF-8 bytes, and its
#: widest spelling of any one character is a six-byte escape (a C0 control), so a browser's body is
#: never longer than the one measured here.
_WIDE = "\U0001F600"
#: An id as the server issues it (`uuid4`), or a tracker's built-in id, whichever is longer.
_ID = "0" * max([len(str(uuid.UUID(int=0)))] + [len(k) for k in tstore.BUILTIN])
#: A day as the stores read it (`YYYY-MM-DD`; the `"today"` token is shorter).
_DAY = date.max.isoformat()
#: A JSON number at its longest: the negated smallest normal float, 24 characters.
_NUMBER = -sys.float_info.min
#: A route's floor for the fields it ignores: the definitions router's cap (see above).
IGNORED_FIELDS_FLOOR = definitions.MAX_BODY


def _text(n: int) -> str:
    return _WIDE * n


def _largest(body: dict) -> int:
    """The byte length of `body` in `json.dumps`'s default spelling (`", "` and `": "`)."""
    return len(json.dumps(body).encode("utf-8"))


def _longest(choices: Any) -> Any:
    return max(choices, key=lambda v: len(json.dumps(v)))


#: `_clean_items` / `_clean_suggest`: an item's id, text, flag and rule (`n` at most 1000).
_ROUTINE_ITEM = {"id": _ID, "text": _text(rstore.ITEM_MAX), "negative": False,
                 "suggest": {"rule": _text(rstore._RULE_MAX), "n": 1000}}
_ROUTINE_FIELDS = {
    "name": _text(rstore.NAME_MAX),
    "items": [_ROUTINE_ITEM] * rstore.ITEMS_CAP,
    # `_clean_schedule`: the weekdays are 0..4, each counted once.
    "schedule": {"kind": _longest(routine_days.SCHEDULE_KINDS), "days": list(range(5))},
    # `_clean_settings`: a done share, strict, and a reminder at an `HH:MM` time.
    "settings": {"done_share": _longest(routine_days.DONE_SHARES), "strict": False,
                 "reminder": {"on": False, "time_et": "23:55"}},
}
_TRACKER_FIELDS = {
    "name": _text(tstore.NAME_MAX), "kind": _longest(tracker_days.KINDS),
    "unit": _text(tracker_days.UNIT_MAX), "settings": {"days": _longest(tstore.DAYS_CHOICES)},
}

#: The largest body each route reads every field of, by route (the endpoint function's name).
LARGEST = {
    # POST /routines: the fields and the template key.
    "create_routine": _largest({**_ROUTINE_FIELDS,
                                "sourceTemplateKey": _text(rstore._TEMPLATE_KEY_MAX)}),
    # PUT /routines/{rid}: the fields, each item carrying its id.
    "save_routine": _largest(_ROUTINE_FIELDS),
    # POST /routines/days: READ_IDS_MAX ids and READ_DAYS_MAX days.
    "routine_days": _largest({"ids": [_ID] * rstore.READ_IDS_MAX,
                              "days": [_DAY] * rstore.READ_DAYS_MAX}),
    # POST /routines/{rid}/delete: the typed name.
    "delete_routine": _largest({"typedName": _text(rstore.NAME_MAX)}),
    "tick_routine_item": _largest({"ticked": False}),
    "skip_routine_day": _largest({"skipped": False}),
    # POST /trackers: the fields and the template key.
    "create_tracker": _largest({**_TRACKER_FIELDS,
                                "sourceTemplateKey": _text(tstore._TEMPLATE_KEY_MAX)}),
    # PUT /trackers/{tid}: the fields (a sent `kind` is read, then refused by the store).
    "save_tracker": _largest(_TRACKER_FIELDS),
    "tracker_days": _largest({"ids": [_ID] * tstore.READ_IDS_MAX,
                              "days": [_DAY] * tstore.READ_DAYS_MAX}),
    "delete_tracker": _largest({"typedName": _text(tstore.NAME_MAX)}),
    # PUT /trackers/{tid}/days/{day}: a number, a bool or null.
    "log_tracker_day": _largest({"value": _NUMBER}),
}

CREATE_ROUTINE_BODY_MAX = max(LARGEST["create_routine"], IGNORED_FIELDS_FLOOR)
SAVE_ROUTINE_BODY_MAX = max(LARGEST["save_routine"], IGNORED_FIELDS_FLOOR)
ROUTINE_DAYS_BODY_MAX = max(LARGEST["routine_days"], IGNORED_FIELDS_FLOOR)
DELETE_ROUTINE_BODY_MAX = max(LARGEST["delete_routine"], IGNORED_FIELDS_FLOOR)
TICK_BODY_MAX = max(LARGEST["tick_routine_item"], IGNORED_FIELDS_FLOOR)
SKIP_BODY_MAX = max(LARGEST["skip_routine_day"], IGNORED_FIELDS_FLOOR)
CREATE_TRACKER_BODY_MAX = max(LARGEST["create_tracker"], IGNORED_FIELDS_FLOOR)
SAVE_TRACKER_BODY_MAX = max(LARGEST["save_tracker"], IGNORED_FIELDS_FLOOR)
TRACKER_DAYS_BODY_MAX = max(LARGEST["tracker_days"], IGNORED_FIELDS_FLOOR)
DELETE_TRACKER_BODY_MAX = max(LARGEST["delete_tracker"], IGNORED_FIELDS_FLOOR)
TRACKER_VALUE_BODY_MAX = max(LARGEST["log_tracker_day"], IGNORED_FIELDS_FLOOR)
#: The largest of them: a body over this is over every route's cap.
MAX_BODY = max(CREATE_ROUTINE_BODY_MAX, SAVE_ROUTINE_BODY_MAX, ROUTINE_DAYS_BODY_MAX,
               DELETE_ROUTINE_BODY_MAX, TICK_BODY_MAX, SKIP_BODY_MAX, CREATE_TRACKER_BODY_MAX,
               SAVE_TRACKER_BODY_MAX, TRACKER_DAYS_BODY_MAX, DELETE_TRACKER_BODY_MAX,
               TRACKER_VALUE_BODY_MAX)

WRITE_RATE = "120/minute"
SCOPE_WRITE = "notebook-routine-writes"
READ_RATE = "60/minute"
SCOPE_READ = "notebook-routine-reads"

S_RATE = "Too many changes in a minute. Try again shortly."
S_RATE_READ = "Too many reads in a minute. Try again shortly."
S_BODY_TOO_LARGE = wbody.S_BODY_TOO_LARGE
S_UNREADABLE_BODY = wbody.S_UNREADABLE_BODY
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


# Each route's body through the widget routers' one reader (`widget_request_body`), capped at the
# route's own `*_BODY_MAX` while it is read. One function per route so the body census can state
# each cap at its call site. The reader is the only place that catches the body's errors; no store
# is called from here.

async def create_routine_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, CREATE_ROUTINE_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def save_routine_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, SAVE_ROUTINE_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def routine_days_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, ROUTINE_DAYS_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def delete_routine_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, DELETE_ROUTINE_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def tick_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, TICK_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def skip_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, SKIP_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def create_tracker_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, CREATE_TRACKER_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def save_tracker_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, SAVE_TRACKER_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def tracker_days_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, TRACKER_DAYS_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def delete_tracker_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, DELETE_TRACKER_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


async def tracker_value_body(request: Request) -> dict:
    return await wbody.read_json_object(
        lambda: body_cap.read_capped_body(request, TRACKER_VALUE_BODY_MAX, S_BODY_TOO_LARGE),
        MAX_BODY_DEPTH, _err)


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


def with_library_facts(uid: str, kind: str, rows: Any) -> Any:
    """Wave 11 (Task 11.12, carry 8): each of the member's library copies in a My tools list carries
    `template_gallery.library_facts` (`sourceGalleryId`, `credit`, `updateAvailable`), so "Update from the library"
    can be offered; a row that is not a library copy, and every row while the library or wave 11 is off (`{}`), is
    exactly as before. ONE call for the whole list (constant statements however many rows)."""
    if not isinstance(rows, list) or not rows:
        return rows
    from api.services.journal_two import template_gallery
    facts = template_gallery.library_facts(uid, kind, [r.get("id") for r in rows if isinstance(r, dict)])
    if not facts:
        return rows
    return [{**r, **facts[r["id"]]} if isinstance(r, dict) and r.get("id") in facts else r for r in rows]


# -- routines -------------------------------------------------------------------------------------

@routines_router.get("")
def list_routines(filter: str = "active", user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _read_rate(uid)
    return _ok({"routines": with_library_facts(uid, "routine", _store(lambda: rstore.list_routines(uid, filter=filter)))})


@routines_router.post("")
def create_routine(user: dict = Depends(require_paid), body: dict = Depends(create_routine_body)) -> Any:
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
def routine_days(user: dict = Depends(require_paid), body: dict = Depends(routine_days_body)) -> Any:
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
                 body: dict = Depends(save_routine_body)) -> Any:
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
                   body: dict = Depends(delete_routine_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.soft_delete(uid, rid, typed_name=body.get("typedName"))))


@routines_router.post("/{rid}/undelete")
def undelete_routine(rid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.undelete(uid, rid)))


@routines_router.post("/{rid}/duplicate")
def duplicate_routine(rid: str, request: Request, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    key = request.headers.get("idempotency-key")
    return _ok(_store(lambda: tkeys.duplicate_with_key(uid, "routine", rid, key=key)))


@routines_router.put("/{rid}/days/{day}/items/{item_id}")
def tick_routine_item(rid: str, day: str, item_id: str, user: dict = Depends(require_paid),
                      body: dict = Depends(tick_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: rstore.set_tick(uid, rid, day, item_id, body.get("ticked"))))


@routines_router.put("/{rid}/days/{day}")
def skip_routine_day(rid: str, day: str, user: dict = Depends(require_paid),
                     body: dict = Depends(skip_body)) -> Any:
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
    return _ok({"trackers": with_library_facts(uid, "tracker", _store(lambda: tstore.list_trackers(uid, filter=filter)))})


@trackers_router.post("")
def create_tracker(user: dict = Depends(require_paid), body: dict = Depends(create_tracker_body)) -> Any:
    """A new tracker. With a `sourceTemplateKey` that names the member's tracker in Recently
    deleted, that stored tracker is restored as it was and the sent name, kind, unit and settings
    are ignored (W9-R12)."""
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.create(
        uid, name=body.get("name"), kind=body.get("kind"), unit=body.get("unit"),
        settings=body.get("settings"), source_template_key=body.get("sourceTemplateKey"))))


@trackers_router.post("/days")
def tracker_days(user: dict = Depends(require_paid), body: dict = Depends(tracker_days_body)) -> Any:
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
                 body: dict = Depends(save_tracker_body)) -> Any:
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
                   body: dict = Depends(delete_tracker_body)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.soft_delete(uid, tid, typed_name=body.get("typedName"))))


@trackers_router.post("/{tid}/undelete")
def undelete_tracker(tid: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    return _ok(_store(lambda: tstore.undelete(uid, tid)))


@trackers_router.post("/{tid}/duplicate")
def duplicate_tracker(tid: str, request: Request, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _write_rate(uid)
    key = request.headers.get("idempotency-key")
    return _ok(_store(lambda: tkeys.duplicate_with_key(uid, "tracker", tid, key=key)))


@trackers_router.put("/{tid}/days/{day}")
def log_tracker_day(tid: str, day: str, user: dict = Depends(require_paid),
                    body: dict = Depends(tracker_value_body)) -> Any:
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
