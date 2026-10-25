"""Built widgets: `/api/j2/widget-definitions` (Notebook widgets phase 2, wave 8, Task 8.11).

The services: `api/services/journal_two/widget_definitions.py` (storage, revisions, If-Match) and
`api/services/journal_two/widget_engine/` (`run`, `drill`, `shelf`, `sources`, `plan`).

  POST /run                      run a saved widget, a shelf example or the note's frozen copy
  POST /preview                  the builder's live preview (superseding)
  POST /examples                 up to 8 shelf examples in one batch
  POST /drill                    the rows behind one cell
  GET  /vocabulary               the static catalog, or (?field=) the member's own values
  GET  /shelf                    the ready-made examples
  GET  ""   POST ""              list / create
  GET  /{id}  PUT /{id}          read / save (If-Match: the widget's etag)
  POST /{id}/archive  /unarchive  /delete  /undelete
  GET  /{id}/used-in  /{id}/revs
  POST /{id}/revs/{rev}/name  /{id}/revs/{rev}/restore (If-Match)

The rules:
  * DARK: every route answers the `public.not_found()` 404 while `notebook_widgets_wave_on(8)` is
    false, read PER REQUEST, before anything else (the router-level dependency runs first).
  * PAID: this router's own `require_paid`, with its own sentence.
  * Ownership: `user_id` is the session member's, only. A `defId` that is not theirs is treated as
    absent: `/run` and `/drill` fall back to the note's frozen `def` with the notice "Running from the
    saved copy in this note." and `def_id=None`; every `/{id}` route answers the same 404.
  * If-Match (ruling R-15) carries the widget's `etag` (`save_seq`), never `rev`.
  * Bodies are at most `MAX_BODY` bytes; over it: 413 `invalid`.
  * Errors are `{"detail": {"code", "message"}}`. Every 200 is `Cache-Control: no-store`.
  * RATES (in-process slowapi storage, ⚠️ PER-PROCESS STATE: a second web process doubles them):
    `/run` and `/drill` share scope `notebook-widgets` at 60/minute per member (the same bucket the
    phase 1 widget reads use); `/preview` and `/examples` use `notebook-widget-preview` at 120/minute.
  * Every route is a sync `def` (the engine's reads block; the threadpool is where they belong). The
    body is read by an async dependency, which is the one place that can await it.
  * WAVE 9 (Task 9.8): routine and tracker history, and the trading-days fields that name a routine
    or a tracker, exist only while `notebook_widgets_wave_on(9)`, read PER REQUEST. Off, the
    vocabulary lists none of them, the shelf hides examples that use them, and `/run`, `/preview`,
    `/examples`, `/drill` and a `POST`/`PUT` of a plan that uses them (`plan.uses_tools`) answer the
    same `public.not_found()` 404 (the client's `unavailable`). Stored widgets stay as they are.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import auth_db
from api.services.journal_two import notebook_widgets as nwidgets
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import widget_definitions as wdefs
from api.services.journal_two.json_depth import _json_depth_exceeds
from api.services.journal_two.widget_engine import drill as wdrill
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine import shelf as wshelf
from api.services.journal_two.widget_engine import sources as wsources
from api.services.journal_two.widget_engine.plan import PlanError, PlanTooNew

WAVE = 8
#: Routines and trackers as builder sources (Task 9.8).
TOOLS_WAVE = 9
MAX_BODY = 32 * 1024
#: A body nesting deeper than this is refused before anything copies or walks it (fix round 1, I-1).
MAX_BODY_DEPTH = 32

RUN_RATE = "60/minute"
SCOPE_RUN = "notebook-widgets"
PREVIEW_RATE = "120/minute"
SCOPE_PREVIEW = "notebook-widget-preview"

#: Ruling R-28: the spec 5.10 sentence, the one the client (lib/builtWidgets.js FAILURE_COPY.rate) shows too.
S_RATE = "Too many refreshes in a minute. Try again shortly."
S_RATE_PREVIEW = "Pausing the preview for a moment; your changes are kept."
S_DAILY_CAP = "You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow."
S_FROZEN = "Running from the saved copy in this note."
S_SUPERSEDED = "A newer preview replaced this one."
S_BODY_TOO_LARGE = "That is too much to send at once."
S_UNREADABLE_BODY = "That request couldn't be read."
#: Ruling R-27: a missing If-Match is a 428 the client treats as a conflict.
S_NEED_IF_MATCH = "Reload to see the newer version."
S_NO_WIDGET = "That widget isn't available."
S_VOCAB_FIELD = "That field isn't available here."

#: `GET /vocabulary?field=` -- the fields whose member values may be listed, and how many at most.
VOCAB_FIELDS = ("setup", "mistake", "emotion", "symbol", "account")
#: Listed only while wave 9 is on: `{id, name}` of the member's routines / trackers.
VOCAB_TOOL_FIELDS = ("routine", "tracker")
VOCAB_MAX = 200

NO_STORE = {"Cache-Control": "no-store"}


def _wave_gate() -> None:
    """Router-level, so it runs before the paid gate and the body: dark is the one 404 for everyone."""
    if not nwidgets.notebook_widgets_wave_on(WAVE):
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/widget-definitions",
    tags=["journal-2-0", "notebook-widgets"],
    dependencies=[Depends(_wave_gate)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Built widgets require a paid plan", headers=dict(NO_STORE))
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

    With no Content-Length (a chunked body) the stream is read only up to `MAX_BODY` + 1 bytes."""
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


def _engine_errors(fn):
    """Run `fn()`; map the engine's and the store's refusals to their states."""
    try:
        return fn()
    except wrun.EngineBusy as e:
        raise _err(503, "busy", e.sentence)
    except wrun.EngineTooLong as e:
        raise _err(503, "too_long", e.sentence)
    except wrun.DailyCapReached:
        raise _err(429, "daily_cap", S_DAILY_CAP)
    except wrun.Superseded:
        raise _err(409, "superseded", S_SUPERSEDED)
    except PlanTooNew as e:
        raise _err(409, "too_new", e.sentence)
    except PlanError as e:
        raise _err(400, "invalid", e.sentence)
    except wdefs.NotFound:
        raise public.not_found()
    except wdefs.Conflict as e:
        raise _err(409, "conflict", e.sentence)
    except wdefs.WidgetError as e:
        if e.sentence == wdefs.S_CAP:
            raise _err(409, "count_cap", e.sentence)
        raise _err(400, "invalid", e.sentence)


def _if_match(request: Request) -> int:
    """The If-Match header as the widget's etag. Missing: 428; not a number: a stale tab (409)."""
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
        raise _err(409, "conflict", wdefs.S_CONFLICT)


def _settings(body: dict) -> Any:
    s = body.get("settings")
    if s is not None and not isinstance(s, dict):
        raise _err(400, "invalid", wplan.S_UNREADABLE)
    return s or {}


def _shelf_allowed():
    """`allowed(plan)` for the shelf, read from the flags NOW: a plan that needs a dark wave is not
    offered (`not (uses_tools and not w9) and not (uses_wave10 and not w10)`)."""
    w9 = nwidgets.notebook_widgets_wave_on(TOOLS_WAVE)
    w10 = nwidgets.notebook_widgets_wave_on(10)
    # `plan.uses_wave10` lands with Task 10.4 (lane F); until then no plan can need wave 10, since a
    # plan format 3 does not validate yet.
    uses_wave10 = getattr(wplan, "uses_wave10", None) or (lambda _p: False)

    def allowed(plan: Any) -> bool:
        return not (wplan.uses_tools(plan) and not w9) and not (uses_wave10(plan) and not w10)
    return allowed


def _shelf_rev(def_rev: Any) -> int:
    """The revision a shelf placement pinned: an int from 1, else 1 (a wave 8 placement, W10-R5)."""
    return def_rev if isinstance(def_rev, int) and not isinstance(def_rev, bool) and def_rev >= 1 else 1


def _resolve(user_id: str, body: dict) -> tuple[dict, str | None, int | None, int | None, list[str]]:
    """`(plan, def_id, def_rev, latest_rev, notices)` for `/run` and `/drill`.

    A `shelf:` id runs exactly the revision the placement pinned (`defRev`, else revision 1), echoing
    `defId`, the revision run and `latestRev` (the newest revision the flags allow) -- a newer
    revision never changes what a pinned placement renders. An unknown revision runs the note's
    frozen `def` with the frozen-copy notice if it has one, else the newest allowed revision. A
    `defId` that `resolve_for_run` finds for THIS member runs its revision. Anything else (a
    foreign, deleted or unknown id, or no id) runs the frozen `def` with the frozen-copy notice and
    `def_id=None` (run's M6 precondition)."""
    def_id = body.get("defId")
    def_rev = body.get("defRev")
    frozen = body.get("def")
    if isinstance(def_id, str) and def_id.startswith(wshelf.ID_PREFIX):
        if wshelf.known(def_id):
            allowed = _shelf_allowed()
            latest = wshelf.latest_rev(def_id, allowed=allowed)
            ex = wshelf.revision(def_id, _shelf_rev(def_rev))
            if ex is None and not isinstance(frozen, dict):
                ex = wshelf.example(def_id, allowed=allowed)
                if ex is None:                       # every revision needs a dark wave
                    raise public.not_found()
            if ex is not None:
                return ex["plan"], def_id, ex["rev"], latest, []
    elif isinstance(def_id, str) and def_id:
        plan, rev, latest = wdefs.resolve_for_run(user_id, def_id, def_rev)
        if plan is not None:
            return plan, def_id, rev, latest, []
    if isinstance(frozen, dict):
        return frozen, None, None, None, [S_FROZEN]
    raise _err(400, "invalid", S_NO_WIDGET)


def _tools_on() -> bool:
    return nwidgets.notebook_widgets_wave_on(TOOLS_WAVE)


def _gate_tools(plan: Any) -> None:
    """A plan that reads routines or trackers is the dark 404 while wave 9 is off."""
    if wplan.uses_tools(plan) and not _tools_on():
        raise public.not_found()


def _with_notices(payload: dict, notices: list[str]) -> dict:
    if notices:
        payload["notice"] = " ".join([*notices, *([payload["notice"]] if payload.get("notice") else [])])
    return payload


# -- runs -----------------------------------------------------------------------------------------

@router.post("/run")
def run_widget(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _rate(RUN_RATE, SCOPE_RUN, uid, "rate", S_RATE)
    settings = _settings(body)
    plan, def_id, def_rev, latest, notices = _resolve(uid, body)
    _gate_tools(plan)
    payload = _engine_errors(lambda: wrun.run_plan(
        uid, plan, settings, lane="run", def_id=def_id, def_rev=def_rev, latest_rev=latest))
    return _ok(_with_notices(payload, notices))


def _wants_sample(user_id: str) -> bool:
    conn = auth_db.get_connection()
    try:
        with wrun.deadline(conn):
            return wrun.wants_sample(conn, user_id)
    finally:
        conn.close()


@router.post("/preview")
def preview_widget(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _rate(PREVIEW_RATE, SCOPE_PREVIEW, uid, "rate_preview", S_RATE_PREVIEW)
    plan = body.get("plan")
    if not isinstance(plan, dict):
        raise _err(400, "invalid", wplan.S_UNREADABLE)
    _gate_tools(plan)
    settings = _settings(body)

    def _go() -> dict:
        sample = _wants_sample(uid)
        payload = wrun.run_plan(uid, plan, settings, lane="preview", sample=sample)
        valid = wplan.validate_plan(json.loads(json.dumps(plan)), wsources.CATALOG)
        payload["defaultName"] = wplan.default_name(valid, wsources.CATALOG)
        return payload

    return _ok(_engine_errors(_go))


@router.post("/examples")
def run_examples(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _rate(PREVIEW_RATE, SCOPE_PREVIEW, uid, "rate_preview", S_RATE_PREVIEW)   # one hit per batch
    ids = body.get("ids")
    if not _tools_on() and isinstance(ids, list):
        for i in ids:
            ex = wshelf.example(i) if isinstance(i, str) else None
            if ex is not None:
                _gate_tools(ex["plan"])
    return _ok(_engine_errors(lambda: wrun.run_examples(uid, ids)))


@router.post("/drill")
def drill_widget(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    _rate(RUN_RATE, SCOPE_RUN, uid, "rate", S_RATE)
    settings = _settings(body)
    plan, _def_id, _def_rev, _latest, notices = _resolve(uid, body)
    _gate_tools(plan)
    snap = body.get("snapshotCount")
    snap = snap if isinstance(snap, int) and not isinstance(snap, bool) else None
    snap_at = body.get("snapshotAt") if isinstance(body.get("snapshotAt"), str) else None
    out = _engine_errors(lambda: wdrill.drill(uid, plan, settings, body.get("cell"),
                                              snapshot_count=snap, snapshot_at=snap_at))
    if notices:
        out["notice"] = " ".join(notices)
    return _ok(out)


# -- the catalog and the shelf --------------------------------------------------------------------

def _field_values(f: Any) -> list[dict] | None:
    """The values a member picks from for a field with a fixed list (its buckets, or yes/no), each
    with the label a group shows. None: the list is the member's own (`?field=`) or typed.
    (The I-8 shape; W9-R23 serves the routine state codes through `choices`.)"""
    choices = getattr(f, "choices", None)
    choices = choices() if callable(choices) else choices
    if choices:
        return [{"value": v, "label": label} for v, label in choices]
    if f.type == "bool":
        vals: tuple = (True, False)
    elif f.bucket:
        vals = tuple(f.bucket() if callable(f.bucket) else f.bucket)
    else:
        return None
    return [{"value": v, "label": f.fmt(v) if f.fmt else str(v)} for v in vals]


def _field_row(f: Any) -> dict:
    row = {"key": f.key, "label": f.label, "type": f.type, "ops": list(f.ops),
           "split": bool(f.split), "filter": bool(getattr(f, "filterable", True)),
           "refKind": getattr(f, "ref_kind", None)}
    values = _field_values(f)
    if values is not None:
        row["values"] = values
    return row


def _static_vocabulary(tools: bool = False) -> dict:
    """The catalog. With `tools` False (wave 9 off) no routine or tracker source, no field that
    names one (`refKind`) and no routine or tracker measure is listed."""
    cat = wsources.CATALOG

    def offered_source(key: str) -> bool:
        return tools or key not in wplan.TOOL_SOURCES

    sources = []
    for s in cat.sources.values():
        if not offered_source(s.key):
            continue
        sources.append({
            "key": s.key, "label": s.label, "description": s.description, "unit": s.unit,
            "fields": [_field_row(f) for f in s.fields.values()
                       if tools or not getattr(f, "ref_kind", None)],
            "measures": sorted(cat.measures_for(s.key)),
        })
    measures = [{"key": m.key, "label": m.label, "theme": m.theme, "meaning": m.meaning,
                 "unit": m.unit, "kind": m.kind, "needs": list(m.needs),
                 "sources": sorted(m.sources)} for m in cat.measures.values()
                if any(offered_source(k) for k in m.sources)]
    return {
        "sources": sources,
        "measures": measures,
        "views": list(cat.views),
        "ranges": [{"token": t, "label": wplan._TOKEN_LABELS.get(t, t)} for t in cat.range_tokens],
        "accents": list(cat.accents),
    }


def _tag_values(conn: sqlite3.Connection, user_id: str, col: str) -> list[str]:
    seen: dict[str, None] = {}
    for (raw,) in conn.execute(
            f"SELECT {col} FROM j2_trades WHERE user_id = ? AND {col} IS NOT NULL", (user_id,)):
        for t in wsources._tags(raw):
            if t.strip():
                seen.setdefault(t, None)
    return list(seen)


def _member_values(user_id: str, field: str) -> list[Any]:
    conn = auth_db.get_connection()
    try:
        with wrun.deadline(conn):
            if field == "routine":
                return [{"id": r[0], "name": r[1]} for r in conn.execute(
                    "SELECT id, name FROM j2_routines WHERE user_id = ? AND deleted_at IS NULL"
                    " ORDER BY name, id", (user_id,)).fetchall()][:VOCAB_MAX]
            if field == "tracker":
                from api.services.journal_two import trackers as j2_trackers
                own = [{"id": r[0], "name": r[1]} for r in conn.execute(
                    "SELECT id, name FROM j2_trackers WHERE user_id = ? AND deleted_at IS NULL"
                    " ORDER BY name, id", (user_id,)).fetchall()]
                built = [{"id": k, "name": v["name"]} for k, v in j2_trackers.BUILTIN.items()]
                return (built + own)[:VOCAB_MAX]
            if field == "account":
                return [{"id": r[0], "name": r[1]} for r in conn.execute(
                    "SELECT id, name FROM j2_accounts WHERE user_id = ? ORDER BY name, id",
                    (user_id,)).fetchall()][:VOCAB_MAX]
            if field == "symbol":
                vals = [r[0] for r in conn.execute(
                    "SELECT symbol FROM j2_trades WHERE user_id = ? AND symbol IS NOT NULL"
                    " UNION SELECT symbol FROM j2_positions WHERE user_id = ? AND symbol IS NOT NULL",
                    (user_id, user_id)).fetchall()]
            elif field == "setup":
                seen: dict[str, None] = {}
                for (raw,) in conn.execute("SELECT setups FROM j2_accounts WHERE user_id = ?",
                                           (user_id,)):
                    for s in wsources._tags(raw):
                        if s.strip():
                            seen.setdefault(s, None)
                for (s,) in conn.execute(
                        "SELECT setup FROM j2_trades WHERE user_id = ? AND setup IS NOT NULL"
                        " UNION SELECT setup FROM j2_positions WHERE user_id = ? AND setup IS NOT NULL",
                        (user_id, user_id)):
                    if isinstance(s, str) and s.strip():
                        seen.setdefault(s, None)
                vals = list(seen)
            else:
                vals = _tag_values(conn, user_id, f"{field}_tags")
    finally:
        conn.close()
    out = sorted({v for v in vals if isinstance(v, str) and v}, key=lambda s: (s.lower(), s))
    return out[:VOCAB_MAX]


@router.get("/vocabulary")
def vocabulary(field: str | None = None, user: dict = Depends(require_paid)) -> Any:
    tools = _tools_on()
    if field is None:
        return _ok(_static_vocabulary(tools))
    if field not in VOCAB_FIELDS + (VOCAB_TOOL_FIELDS if tools else ()):
        raise _err(400, "invalid", S_VOCAB_FIELD)
    values = _engine_errors(lambda: _member_values(_uid(user), field))
    return _ok({"field": field, "values": values})


@router.get("/shelf")
def shelf(user: dict = Depends(require_paid)) -> Any:
    return _ok({"examples": wshelf.examples(allowed=_shelf_allowed())})


# -- the member's widgets -------------------------------------------------------------------------

LIST_VIEWS = ("live", "archived", "deleted")


@router.get("")
def list_widgets(view: str = "live", user: dict = Depends(require_paid)) -> Any:
    if view not in LIST_VIEWS:
        raise _err(400, "invalid", wplan.S_UNREADABLE)
    items = wdefs.list_defs(_uid(user), archived=view == "archived", deleted=view == "deleted")
    return _ok({"widgets": items})


@router.post("")
def create_widget(user: dict = Depends(require_paid), body: dict = Depends(json_body)) -> Any:
    plan = body.get("plan")
    if not isinstance(plan, dict):
        raise _err(400, "invalid", wplan.S_UNREADABLE)
    _gate_tools(plan)
    name = body.get("name")
    return _ok(_engine_errors(lambda: wdefs.create(_uid(user), name, plan)))


def _found(item: Any) -> Any:
    if item is None:
        raise public.not_found()
    return item


@router.get("/{def_id}")
def get_widget(def_id: str, user: dict = Depends(require_paid)) -> Any:
    return _ok(_found(wdefs.get(_uid(user), def_id)))


@router.put("/{def_id}")
def save_widget(def_id: str, request: Request, user: dict = Depends(require_paid),
                body: dict = Depends(json_body)) -> Any:
    uid = _uid(user)
    if wdefs.get(uid, def_id) is None:
        raise public.not_found()
    etag = _if_match(request)
    plan = body.get("plan")
    if plan is not None and not isinstance(plan, dict):
        raise _err(400, "invalid", wplan.S_UNREADABLE)
    _gate_tools(plan)
    origin = body.get("origin") if isinstance(body.get("origin"), str) else None
    return _ok(_engine_errors(lambda: wdefs.update(
        uid, def_id, if_match=etag, name=body.get("name"), plan=plan, apply=body.get("apply"),
        origin=origin)))


@router.post("/{def_id}/archive")
def archive_widget(def_id: str, user: dict = Depends(require_paid)) -> Any:
    return _ok(_engine_errors(lambda: wdefs.archive(_uid(user), def_id)))


@router.post("/{def_id}/unarchive")
def unarchive_widget(def_id: str, user: dict = Depends(require_paid)) -> Any:
    return _ok(_engine_errors(lambda: wdefs.unarchive(_uid(user), def_id)))


@router.post("/{def_id}/delete")
def delete_widget(def_id: str, user: dict = Depends(require_paid),
                  body: dict = Depends(json_body)) -> Any:
    typed = body.get("typedName")
    return _ok(_engine_errors(lambda: wdefs.soft_delete(_uid(user), def_id, typed_name=typed)))


@router.post("/{def_id}/undelete")
def undelete_widget(def_id: str, user: dict = Depends(require_paid)) -> Any:
    return _ok(_engine_errors(lambda: wdefs.undelete(_uid(user), def_id)))


@router.get("/{def_id}/used-in")
def used_in(def_id: str, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    _found(wdefs.get(uid, def_id))
    return _ok({"notes": wdefs.used_in_notes(uid, def_id)})


@router.get("/{def_id}/revs")
def list_revs(def_id: str, user: dict = Depends(require_paid)) -> Any:
    return _ok({"revs": _found(wdefs.revs(_uid(user), def_id))})


@router.post("/{def_id}/revs/{rev}/name")
def name_rev(def_id: str, rev: int, user: dict = Depends(require_paid),
             body: dict = Depends(json_body)) -> Any:
    return _ok(_engine_errors(lambda: wdefs.name_rev(_uid(user), def_id, rev, body.get("name"))))


@router.post("/{def_id}/revs/{rev}/restore")
def restore_rev(def_id: str, rev: int, request: Request, user: dict = Depends(require_paid)) -> Any:
    uid = _uid(user)
    if wdefs.get(uid, def_id) is None:
        raise public.not_found()
    # W9-R16: restoring a revision that reads routines or trackers is the dark 404 while wave 9 is
    # off (a rename-only PUT carries no plan and is allowed).
    if not _tools_on():
        for r in wdefs.revs(uid, def_id) or []:
            if r.get("rev") == rev:
                _gate_tools(r.get("plan"))
    etag = _if_match(request)
    return _ok(_engine_errors(lambda: wdefs.restore_rev(uid, def_id, rev, if_match=etag)))
