"""Every Notebook / Journal route that reads a request body: is the read bounded,
and does it come after the dark-flag gate and the session check?

THE TWO CLASSES THIS FILE HOLDS SHUT

1. An unbounded read. `await request.body()` / `.json()` / `.form()`, or a
   FastAPI body parameter, buffers whatever is sent before any size is measured.
2. A read in the wrong order. FastAPI reads the body for a declared body
   parameter (`body: Model`, `payload: dict`, `File(...)`) BEFORE it solves any
   dependency. So such a route buffers an anonymous body of any size, and a
   route behind a dark flag answers 422 to malformed JSON where every other
   request to it answers 404 (security review I-5, 2026-10-06).

The order the family holds to: flag gate, then session, then a bounded read.
The helper that makes that possible for a JSON body, and what a dark route
answers, are tested in `tests/test_notebook_body_order.py`.

The census is `tests/support/body_census.py`: it reads the real app's route
objects for the solve order, and each function's parse tree for the reads. A
comment or a docstring is not a call, so prose cannot satisfy this rail; the
controls below prove that, and prove the rail sees a real unbounded route.

Regenerate the table in `docs/notebook/fin-voice.md` with:

    FIN_VOICE_CENSUS_OUT=<file> python -m pytest tests/test_notebook_body_census.py -q -k writes_the_census_table
"""
from __future__ import annotations

import os

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.services import request_body_cap as body_cap
from tests.support import body_census as bc

in_family = bc.in_family


# A read this lane found unbounded and did not change, with the reason. EMPTY is
# the goal; a route may only be added here on purpose, by name.
DECLARED_UNCAPPED: dict[tuple[str, str], str] = {}

# A call the reader cannot follow. Each is read by hand and named here.
DECLARED_UNRESOLVED = {
    # slowapi's key function: it reads the client address from the request's
    # headers and scope. It never touches the body.
    "client_key passes the request to limiter._key_func",
}

# Routes that read a body and have no session dependency, with what stands in
# its place. A new one fails by name: "no session" must be a decision.
NO_SESSION_BY_DESIGN = {
    ("POST", "/api/j2/inbound-email"): "provider signature over the raw body",
    ("POST", "/api/j2/personal/notes"): "personal API bearer token",
    ("POST", "/api/j2/personal/notes/{note_id}/append"): "personal API bearer token",
    ("POST", "/api/j2/personal/daily/append"): "personal API bearer token",
    ("POST", "/api/j2/notes/connectors/obsidian/ingest"): "Obsidian plugin bearer token",
    ("POST", "/api/j2/notes/connectors/obsidian/redeem"): "one-time pairing code in the body",
    ("POST", "/api/j2/capture/token"): "one-time authorisation code in the body",
    ("POST", "/api/j2/capture"): "capture token or session (its own dependency)",
    ("POST", "/api/j2/broker/webhook"): "SnapTrade signature over the body",
}


@pytest.fixture(scope="module")
def real_app():
    from api.main import app
    return app


@pytest.fixture(scope="module")
def rows(real_app) -> list[bc.Row]:
    return bc.census(real_app, in_family)


def _key(row: bc.Row) -> tuple[str, str]:
    return (row.method, row.path)


def _named(row: bc.Row) -> str:
    return f"{row.method} {row.path}  ({row.module.rsplit('.', 1)[-1]}.{row.endpoint})"


# ── the rails ────────────────────────────────────────────────────────────────

def test_the_census_is_not_vacuous(rows):
    reading = [r for r in rows if r.reads_body]
    assert len(rows) > 300 and len(reading) > 100, (len(rows), len(reading))
    kinds = {read.how for r in reading for read in r.reads}
    assert {"capped", "stream-loop"} <= kinds, kinds
    by_key = {_key(r): r for r in rows}
    # one of each kind of bounded door, found where it is known to be
    upload = by_key[("POST", "/api/j2/notes/{note_id}/images")]
    assert upload.reads[0].how == "capped" and upload.reads[0].limit_bytes == 5 * 1024 * 1024
    email = by_key[("POST", "/api/j2/inbound-email")]
    assert email.reads[0].how == "stream-loop" and email.reads[0].limit_bytes == 36 * 1024 * 1024
    gallery = by_key[("POST", "/api/j2/template-gallery")]
    assert gallery.reads[0].call == "read_capped_body" and gallery.gate_position == 0
    assert gallery.session_position is not None and gallery.reads[0].position > gallery.session_position


def test_every_route_under_the_journal_prefix_is_in_the_family(real_app):
    """The family is named by module, so a new router under `/api/j2` that this
    file has never heard of would be outside the rail. It fails here instead."""
    strays = sorted({f"{r.path}  ({r.endpoint.__module__})" for r in real_app.routes
                     if isinstance(r, APIRoute) and r.path.startswith("/api/j2") and not in_family(r)})
    assert not strays, "routes under /api/j2 outside the body census:\n  " + "\n  ".join(strays)


def test_no_family_route_reads_an_unbounded_body(rows):
    """THE RAIL. Fails by route name when a new unbounded read appears."""
    found = {_key(r): r for r in rows if r.uncapped}
    new = [f"{_named(r)}: " + "; ".join(f"{x.call} in {x.where}" for x in r.uncapped)
           for k, r in sorted(found.items()) if k not in DECLARED_UNCAPPED]
    assert not new, (
        "these routes read a request body with no bound. Read it through "
        "`request_body_cap` (capped_json / read_capped_body / capped_multipart), "
        "declared after the route's session dependency:\n  " + "\n  ".join(new))
    stale = sorted(set(DECLARED_UNCAPPED) - set(found))
    assert not stale, f"declared as unbounded but no longer is -- delete the entry: {stale}"


def test_every_family_route_reads_its_body_after_the_gate_and_the_session(rows):
    """THE ORDER RAIL: flag gate, then session, then the body."""
    wrong = [f"{_named(r)}: " + "; ".join(r.order_problems()) for r in rows if r.order_problems()]
    assert not wrong, "body read out of order:\n  " + "\n  ".join(wrong)


def test_a_body_read_with_no_session_is_a_named_decision(rows):
    found = {_key(r) for r in rows if r.reads_body and r.session_position is None}
    assert found == set(NO_SESSION_BY_DESIGN), {
        "new, undeclared": sorted(found - set(NO_SESSION_BY_DESIGN)),
        "declared, gone": sorted(set(NO_SESSION_BY_DESIGN) - found)}


def test_every_bounded_read_has_a_limit_the_census_can_state(rows):
    """A cap nobody can read the size of is not a census row. The one exception
    is a limit passed in as an argument, which is stated at its call site."""
    unknown = sorted({f"{_named(r)}: {x.call} limit `{x.limit}`" for r in rows for x in r.reads
                      if x.how in ("capped", "stream-loop") and x.limit_bytes is None})
    allowed = {
        # _read_bounded_body(request, _MAX_OBSIDIAN_INGEST_BYTES): 2,000,000 bytes at the call site
        "POST /api/j2/notes/connectors/obsidian/ingest  (note_sync.obsidian_ingest): request.stream() limit `limit`",
        # read_capped_form(request, limit + FRAMING_SLACK, ...): limit is vn.MAX_UPLOAD_BYTES (90 MiB)
        "POST /api/j2/voice-notes/jobs  (notebook_voice_notes.create_job): read_capped_form limit `limit + body_cap.FRAMING_SLACK`",
    }
    assert set(unknown) == allowed, sorted(set(unknown) ^ allowed)


def test_the_calls_the_reader_could_not_follow_are_the_named_ones(rows):
    seen = {u for r in rows for u in r.unresolved}
    assert seen == DECLARED_UNRESOLVED, sorted(seen ^ DECLARED_UNRESOLVED)


# ── controls: the rail can see what it must, and prose cannot fool it ────────

def _gate() -> None:
    raise HTTPException(status_code=404, detail="Not found")
_gate.__qualname__ = "_require_enabled"
_gate.__name__ = "_require_enabled"


def get_current_user() -> dict:      # the name is what the census keys on
    return {"id": "u"}


async def _helper_that_reads(req: Request) -> bytes:
    return await req.body()


_CAPPED = body_cap.capped_json(dict, lambda: 1024, lambda: "too large", after=get_current_user)


def _control_rows() -> dict[str, bc.Row]:
    router = APIRouter(prefix="/ctl", dependencies=[Depends(_gate)])

    @router.post("/raw-json")
    async def raw_json(request: Request, user: dict = Depends(get_current_user)):
        return await request.json()

    @router.post("/declared")
    def declared(payload: dict, user: dict = Depends(get_current_user)):
        return payload

    @router.post("/prose")
    async def prose(request: Request, user: dict = Depends(get_current_user)):
        """This docstring says `await request.body()` and reads nothing."""
        # await request.json()   <- a comment is not a call either
        note = "request.form() inside a string"
        return {"note": note}

    @router.post("/via-helper")
    async def via_helper(request: Request, user: dict = Depends(get_current_user)):
        return {"n": len(await _helper_that_reads(request))}

    @router.post("/capped")
    def capped(payload: dict = Depends(_CAPPED), user: dict = Depends(get_current_user)):
        return payload

    @router.post("/unbounded-loop")
    async def unbounded_loop(request: Request, user: dict = Depends(get_current_user)):
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
        return {"n": total}

    @router.post("/bounded-loop")
    async def bounded_loop(request: Request, user: dict = Depends(get_current_user)):
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > 4096:
                raise HTTPException(status_code=413, detail="too large")
        return {"n": total}

    late = APIRouter(prefix="/late")

    @late.post("/session-first", dependencies=[Depends(get_current_user), Depends(_gate)])
    async def session_first(request: Request):
        return await body_cap.read_capped_body(request, 10, "too large")

    app = FastAPI()
    app.include_router(router)
    app.include_router(late)
    return {r.path: r for r in bc.census(app, lambda route: True)}


def test_CONTROL_the_rail_sees_a_real_unbounded_route():
    rows = _control_rows()
    raw = rows["/ctl/raw-json"]
    assert [x.how for x in raw.uncapped] == ["raw"] and raw.uncapped[0].call == "request.json()"
    loop = rows["/ctl/unbounded-loop"]
    assert [x.call for x in loop.uncapped] == ["request.stream()"]
    helper = rows["/ctl/via-helper"]
    assert [(x.how, x.where) for x in helper.uncapped] == [("raw", "_helper_that_reads")]


def test_CONTROL_a_declared_body_parameter_is_unbounded_and_out_of_order():
    row = _control_rows()["/ctl/declared"]
    assert [x.how for x in row.uncapped] == ["fastapi-param"] and row.uncapped[0].position == -1
    assert row.order_problems() == ["the body is read before the dark-flag gate",
                                    "the body is read before the session check"]


def test_CONTROL_prose_cannot_satisfy_or_fail_the_rail():
    """A docstring, a comment and a string that each name a body read: not a read."""
    row = _control_rows()["/ctl/prose"]
    assert row.reads == [] and not row.reads_body


def test_CONTROL_a_bounded_read_after_the_session_is_clean():
    rows = _control_rows()
    capped = rows["/ctl/capped"]
    assert capped.uncapped == [] and capped.order_problems() == []
    assert capped.reads[0].how == "capped" and capped.reads[0].limit_bytes == 1024
    assert capped.gate_position < capped.session_position < capped.reads[0].position
    bounded = rows["/ctl/bounded-loop"]
    assert [x.how for x in bounded.reads] == ["stream-loop"] and bounded.reads[0].limit_bytes == 4096


def test_CONTROL_a_session_checked_before_the_gate_is_caught():
    row = _control_rows()["/late/session-first"]
    assert row.order_problems() == ["the session is checked before the dark-flag gate"]


# ── the table for the doc ────────────────────────────────────────────────────

def census_markdown(rows: list[bc.Row]) -> str:
    lines = ["| method | path | router | body read | bounded by | size | gate | session | order |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if not r.reads_body:
            continue
        for x in r.reads:
            if x.how == "capped":
                by = f"`request_body_cap` ({x.call})"
            elif x.how == "stream-loop":
                by = f"running total in `{x.where}`"
            else:
                by = "**nothing**"
            size = bc.fmt_bytes(x.limit_bytes) if x.how != "raw" and x.how != "fastapi-param" else "none"
            if x.limit_bytes is None and x.how in ("capped", "stream-loop"):
                size = f"`{x.limit}`"
            session = r.session_by or NO_SESSION_BY_DESIGN.get(_key(r), "none")
            order = "; ".join(r.order_problems()) or "gate, session, body" if r.gate_position is not None else (
                "; ".join(r.order_problems()) or "session, body")
            if r.session_position is None:
                order = "; ".join(r.order_problems()) or ("gate, body" if r.gate_position is not None else "body")
            lines.append(f"| {r.method} | `{r.path}` | {r.module.rsplit('.', 1)[-1]} | {x.call} | {by} | {size} | "
                         f"{'yes' if r.gate_position is not None else 'no'} | {session} | {order} |")
    return "\n".join(lines) + "\n"


def test_writes_the_census_table(rows):
    """Not a check: writes the table when asked to (see the module docstring)."""
    out = os.environ.get("FIN_VOICE_CENSUS_OUT")
    text = census_markdown(rows)
    assert text.count("\n") > 100
    if out:
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            reading = [r for r in rows if r.reads_body]
            fh.write(f"<!-- {len(rows)} family routes, {len(reading)} read a body -->\n")
            fh.write(text)
