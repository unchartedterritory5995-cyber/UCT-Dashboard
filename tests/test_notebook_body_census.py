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

import json
import os

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.services import request_body_cap as body_cap
from tests.support import body_census as bc

REPO = __import__('pathlib').Path(__file__).resolve().parents[1]

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
            fh.write("<!-- OUTSIDE -->\n")
            fh.write(outside_markdown())


def outside_markdown() -> str:
    """Routers outside the family that read a body: a count per router and kind.
    Listed in the doc as out of scope; nothing here is a check."""
    from collections import Counter
    from api.main import app
    counts: Counter = Counter()
    kinds = {"fastapi-param": "declared body parameter", "raw": "raw read, no bound",
             "capped": "request_body_cap", "stream-loop": "streaming loop with a running total"}
    for row in bc.census(app, lambda route: not in_family(route)):
        for x in row.reads:
            counts[(row.module.replace("api.routers.", "").replace("api.", ""), kinds[x.how])] += 1
    lines = ["| router | how the body is read | routes |", "|---|---|---|"]
    for (module, kind), n in sorted(counts.items()):
        lines.append(f"| `{module}` | {kind} | {n} |")
    return "\n".join(lines) + "\n"


# ── the note import: a small server cap, and a client that sends in pieces ───

NOTE_IMPORT_CAP = 32 * 1024 * 1024
BATCHES_JS = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "importer" / "confirmBatches.js"

_PLAN_DRIVER = r"""
// argv: <confirmBatches.js> <input.json>  -> the request bodies the client would send
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
const [modPath, inputPath] = process.argv.slice(2)
const mod = await import(pathToFileURL(modPath).href)
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const plan = mod.planConfirmBatches(input.notes, (n) => n, input.limits || {})
process.stdout.write(JSON.stringify({
  maxNotes: mod.CONFIRM_BATCH_MAX_NOTES, maxBytes: mod.CONFIRM_BATCH_MAX_BYTES,
  bodies: plan.batches.map((b) => mod.confirmBody({ source: 'file', destFolderId: null }, b.parts)),
  tooLarge: plan.tooLarge.map((t) => ({ key: t.item.importKey, bytes: t.bytes, sentence: mod.noteTooLargeSentence(t.bytes) })),
}))
"""


def _client_plan(tmp_path, notes: list, limits: dict | None = None) -> dict:
    import shutil
    import subprocess
    node = shutil.which("node")
    assert node, "node is not on PATH -- this test runs the client's own batch planner"
    driver = tmp_path / "plan.mjs"
    driver.write_text(_PLAN_DRIVER, encoding="utf-8")
    payload = tmp_path / "input.json"
    payload.write_text(json.dumps({"notes": notes, "limits": limits or {}}), encoding="utf-8")
    r = subprocess.run([node, str(driver), str(BATCHES_JS), str(payload)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert r.returncode == 0, f"node could not run the batch planner: {r.stderr[:2000]}"
    return json.loads(r.stdout)


def test_the_note_import_door_is_capped_at_32_MiB_by_name():
    """Owner ruling, round 3: one process serves every member, so a request this
    door will buffer is held to 32 MiB. The client sends a large import in pieces."""
    from api.routers import journal_two
    assert journal_two.NOTE_IMPORT_JSON_MAX_BYTES == NOTE_IMPORT_CAP
    assert journal_two._note_import_json_max() == NOTE_IMPORT_CAP
    sentence = journal_two._note_import_too_large()
    assert "32 MB" in sentence and "smaller batches" in sentence and sentence.endswith(".")


def test_the_clients_batch_limits_sit_under_the_servers(tmp_path):
    """One fact in two files, read from both: the client's numbers come from
    running its own module, the server's from the router and the service."""
    from api.routers import journal_two
    from api.services.journal_two import notes
    plan = _client_plan(tmp_path, [])
    assert plan["maxBytes"] <= journal_two.NOTE_IMPORT_JSON_MAX_BYTES - 4 * 1024 * 1024, plan
    assert plan["maxNotes"] <= notes.IMPORT_CONFIRM_MAX_NOTES, plan
    # and every legal note fits a request on its own, so none is ever "too large to send"
    assert plan["maxBytes"] >= 4 * notes.MAX_BODY_JSON_BYTES


def _note_at_the_body_limit(key: str) -> dict:
    """A note whose body the service measures at exactly MAX_BODY_JSON_BYTES."""
    from api.services.journal_two import notes

    def doc(n):
        return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x" * n}]}]}

    n = notes.MAX_BODY_JSON_BYTES - len(json.dumps(doc(0)))
    body = doc(n)
    assert len(json.dumps(body).encode("utf-8")) == notes.MAX_BODY_JSON_BYTES
    return {"importKey": key, "title": "T" * notes.MAX_TITLE_CHARS, "bodyJson": body,
            "tags": ["t" * notes.MAX_TAG_LENGTH] * notes.MAX_TAGS, "folderPath": []}


@pytest.fixture
def import_door(monkeypatch):
    import importlib
    import tempfile
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware import auth_middleware as authmw

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.routers import journal_two
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                     " VALUES ('imp-cap', 'imp-cap@test.local', 'x', 'T', 'member')")
        conn.commit()
    finally:
        conn.close()
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "imp-cap", "role": "member"}

    def count() -> int:
        c = auth_db.get_connection()
        try:
            return c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = 'imp-cap'").fetchone()[0]
        finally:
            c.close()

    return TestClient(app), count


def _post(client, body: str):
    return client.post("/api/j2/notes/import/confirm", content=body.encode("utf-8"),
                       headers={"Content-Type": "application/json"})


def test_the_largest_legal_import_completes_through_the_clients_own_batches(import_door, tmp_path, monkeypatch):
    """END TO END, the client's planner against the real door. The largest import
    the service allows is its maximum number of notes, each at the per-note
    limit. Simulated small: the batch limit moved to 5 notes and the door's cap
    to 2.5 MB, the client's byte limit scaled the same way (its real default is
    24 of the door's 32). Five 1 MB notes must arrive one to a request, every
    one accepted, five notes created; sent again, five skipped and none added."""
    from api.routers import journal_two
    from api.services.journal_two import notes
    client, count = import_door
    monkeypatch.setattr(notes, "IMPORT_CONFIRM_MAX_NOTES", 5)
    monkeypatch.setattr(journal_two, "NOTE_IMPORT_JSON_MAX_BYTES", 2_500_000)
    batch = [_note_at_the_body_limit(f"file:{i}.md") for i in range(5)]

    whole = json.dumps({"source": "file", "destFolderId": None, "notes": batch})
    refused = _post(client, whole)
    assert refused.status_code == 413 and "smaller batches" in refused.json()["detail"], refused.text[:200]
    assert count() == 0, "a refused request must not have stored anything"

    plan = _client_plan(tmp_path, batch, {"maxBytes": 2_500_000 * 24 // 32})
    assert plan["tooLarge"] == [] and len(plan["bodies"]) == 5, [len(b) for b in plan["bodies"]]
    created = skipped = 0
    for body in plan["bodies"]:
        assert len(body.encode("utf-8")) <= 2_500_000
        r = _post(client, body)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["failed"] == []
        created += len(r.json()["created"])
    assert created == 5 and count() == 5

    # the same import again, as a retry would send it: nothing is created twice
    for body in plan["bodies"]:
        r = _post(client, body)
        assert r.status_code == 200
        created += len(r.json()["created"])
        skipped += len(r.json()["skipped"])
    assert (created, skipped, count()) == (5, 5, 5)


def test_notes_regrouped_into_different_batches_on_a_second_run_still_do_not_duplicate(import_door, tmp_path):
    """A retry need not send the same batches. Small notes, planned two ways."""
    client, count = import_door
    small = [{"importKey": f"file:s{i}.md", "title": f"s{i}", "tags": [], "folderPath": [],
              "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hello"}]}]}}
             for i in range(7)]
    first = _client_plan(tmp_path, small, {"maxNotes": 3})
    second = _client_plan(tmp_path, small, {"maxNotes": 2})
    assert [len(json.loads(b)["notes"]) for b in first["bodies"]] == [3, 3, 1]
    assert [len(json.loads(b)["notes"]) for b in second["bodies"]] == [2, 2, 2, 1]
    for body in first["bodies"]:
        assert _post(client, body).status_code == 200
    assert count() == 7
    skipped = sum(len(_post(client, body).json()["skipped"]) for body in second["bodies"])
    assert skipped == 7 and count() == 7


def test_a_single_oversized_note_is_refused_with_its_own_sentence(import_door, tmp_path):
    """Two different notes, two different sentences. One the service finds too
    long (it comes back named, its neighbours are stored). One too large for any
    request (the client never sends it, and says so)."""
    from api.services.journal_two import notes
    client, count = import_door
    ok = {"importKey": "file:ok.md", "title": "fine", "tags": [], "folderPath": [],
          "bodyJson": {"type": "doc", "content": []}}
    too_long = _note_at_the_body_limit("file:long.md")
    too_long["bodyJson"]["content"][0]["content"][0]["text"] += "x"          # one byte over
    plan = _client_plan(tmp_path, [ok, too_long])
    assert plan["tooLarge"] == [] and len(plan["bodies"]) == 1
    r = _post(client, plan["bodies"][0])
    assert r.status_code == 200
    assert [c["importKey"] for c in r.json()["created"]] == ["file:ok.md"]
    assert r.json()["failed"] == [{"importKey": "file:long.md", "error": (
        "This note is too long to save as one page. Split it into two or more notes and try again.")}]
    assert count() == 1

    huge = dict(ok, importKey="file:huge.md", bodyJson={"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "x" * 200_000}]}]})
    plan = _client_plan(tmp_path, [ok, huge], {"maxBytes": 100_000})
    assert [json.loads(b)["notes"][0]["importKey"] for b in plan["bodies"]] == ["file:ok.md"]
    assert plan["tooLarge"][0]["key"] == "file:huge.md"
    assert plan["tooLarge"][0]["sentence"] == (
        "This note is too large to import (0.2 MB). Split it into smaller notes and import again.")
    assert notes.MAX_BODY_JSON_BYTES < 24 * 1024 * 1024       # so no LEGAL note is ever in that list
