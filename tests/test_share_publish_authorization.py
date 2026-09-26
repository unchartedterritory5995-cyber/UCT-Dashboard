"""Wave 8 lane 8B, B1 -- the exhaustive authorization rail for every public-note route.

This is the TECHNICAL half of the G-080 authorization ("CONFIGURATION IS NOT
AUTHORIZATION", docs/notebook/competitive-gap-ledger.md): what the code proves about who can
read, mint, revoke, publish and list a share link or a publication. The legal half is the
owner's. `docs/notebook/share-links-authorization-proof.md` is the prose; this file is the
proof.

⛔ THE ROUTE LIST IS DERIVED, NEVER TYPED. It is read off the REAL app (`api.main.app`,
imported under the repo-root conftest's sandbox, exactly as tests/test_main_router_order.py
does), selecting every `/api/j2` path with a `share`, `shared`, `publish` or `published`
segment. `PROOF_MATRIX` then states, per (method, path), who may call it, which gate guards
it, which rate bucket counts it and what plan it takes:

  * a derived route with no row fails BY NAME;
  * a row that names a route which no longer exists fails BY NAME;
  * the derivation must find `GET /api/j2/shared/{token}` (non-vacuity: a derivation that
    found nothing would satisfy both checks above).

The behaviour tests run on a standalone FastAPI app mounting the two routers, with the
`api/limiter.py` Limiter reset around each test (the notebook_personal_api tests' pattern).
Each property is its own test, parametrized over the matrix rows it applies to:

   1 owner-only                    6 rate limits (ruling D-B10)
   2 token entropy                 7 no enumeration oracle
   3 expiry (ruling D-B2)          8 the gate is off -> 404, nothing called, nothing written
   4 revocation is immediate       9 Referrer-Policy: no-referrer on every public response
   5 no data beyond the note      10 plan (ruling D-B3), both directions
"""
from __future__ import annotations

import functools
import importlib
import json
import os
import re
import sqlite3
import tempfile
from typing import Any, Callable

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

G_SHARE = "J2_SHARE_LINKS_ENABLED"
G_PUBLISH = "NOTEBOOK_PUBLISH_ENABLED"

#: The route-selection rule: under /api/j2, any path with one of these SEGMENTS.
SEGMENTS = frozenset({"share", "shared", "publish", "published"})

#: ⛔ The authority on what each public-note route may do. Every derived route has a row;
#: every row names a real route. Columns:
#:   auth    'owner' (a signed-in member acting on their own things) | 'public' (no auth)
#:   gate    the env flag whose OFF answers 404 before anything runs
#:   bucket  the limiter scope that counts it, or None
#:   plan    'paid' (the router's own require_paid) | 'session' (get_current_user only) | None
PROOF_MATRIX: dict[tuple[str, str], dict[str, Any]] = {
    ("GET", "/api/j2/notes/{note_id}/share"):
        {"auth": "owner", "gate": G_SHARE, "bucket": None, "plan": "session"},
    ("POST", "/api/j2/notes/{note_id}/share"):
        {"auth": "owner", "gate": G_SHARE, "bucket": "notebook-share-mint", "plan": "paid"},
    ("DELETE", "/api/j2/notes/{note_id}/share"):
        {"auth": "owner", "gate": G_SHARE, "bucket": None, "plan": "session"},
    ("GET", "/api/j2/shared/{token}"):
        {"auth": "public", "gate": G_SHARE, "bucket": "notebook-share-public", "plan": None},
    ("GET", "/api/j2/shared/{token}/att/{sub}/{filename}"):
        {"auth": "public", "gate": G_SHARE, "bucket": "notebook-share-images", "plan": None},
}

#: Ruling D-B10, verbatim numbers: (requests allowed, per) for each bucket.
BUCKET_LIMITS: dict[str, tuple[int, str]] = {
    "notebook-share-public": (60, "minute"),
    "notebook-share-images": (240, "minute"),
    "notebook-share-mint": (30, "hour"),
}

PUBLIC_HEADERS = {
    "cache-control": "no-store, private",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
}

A, B = "user-alpha-7f3", "user-bravo-9c1"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}


# ── the derivation, from the REAL app ───────────────────────────────────────────────────

@functools.lru_cache(maxsize=1)
def _real_app_routes() -> tuple[tuple[str, str], ...]:
    from api.main import app  # noqa: WPS433 -- late: the repo-root conftest has pinned /data
    out = []
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path.startswith("/api/j2/"):
            if SEGMENTS & set(r.path.split("/")):
                out.extend((m, r.path) for m in sorted(r.methods))
    return tuple(sorted(set(out)))


def select_public_note_routes(pairs) -> set[tuple[str, str]]:
    return {(m, p) for m, p in pairs if p.startswith("/api/j2/") and SEGMENTS & set(p.split("/"))}


def test_the_derivation_finds_the_public_read_route():
    """Non-vacuity: a derivation that returned nothing would pass both matrix checks."""
    derived = set(_real_app_routes())
    assert ("GET", "/api/j2/shared/{token}") in derived, sorted(derived)


def test_the_selection_rule_can_tell_a_share_route_from_a_neighbour():
    """CONTROL for the selection rule itself: it takes the share segment and leaves a path
    that merely CONTAINS the word (`/sharepoint`) or sits outside /api/j2."""
    pairs = [("GET", "/api/j2/shared/{t}"), ("GET", "/api/j2/notes/{n}/sharepoint"),
             ("GET", "/api/charts/layouts/shared/{t}"), ("POST", "/api/j2/publish/notes/{n}")]
    assert select_public_note_routes(pairs) == {
        ("GET", "/api/j2/shared/{t}"), ("POST", "/api/j2/publish/notes/{n}")}


@pytest.mark.parametrize("route", _real_app_routes(), ids=lambda r: f"{r[0]} {r[1]}")
def test_every_derived_route_has_a_row(route):
    assert route in PROOF_MATRIX, (
        f"{route[0]} {route[1]} is served by the real app and has NO row in PROOF_MATRIX -- "
        "declare who may call it, its gate, its rate bucket and its plan before it ships")


@pytest.mark.parametrize("row", sorted(PROOF_MATRIX), ids=lambda r: f"{r[0]} {r[1]}")
def test_every_row_names_a_route_that_exists(row):
    assert row in set(_real_app_routes()), (
        f"PROOF_MATRIX names {row[0]} {row[1]}, which the real app does not serve -- "
        "a stale row reads as coverage for a door that is gone")


def test_the_matrix_columns_are_well_formed():
    for row, spec in PROOF_MATRIX.items():
        assert set(spec) == {"auth", "gate", "bucket", "plan"}, row
        assert spec["auth"] in ("owner", "public"), row
        assert spec["gate"] in (G_SHARE, G_PUBLISH), row
        assert spec["bucket"] is None or spec["bucket"] in BUCKET_LIMITS, row
        assert (spec["plan"] is None) == (spec["auth"] == "public"), row


# ── the dependency tree, read by object identity ───────────────────────────────────────

def _dep_calls(route: APIRoute) -> set:
    seen, stack = set(), list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        if d.call is not None:
            seen.add(d.call)
        stack.extend(d.dependencies)
    return seen


def _router_module_for(path: str):
    name = ("api.routers.notebook_publish" if "/publish" in path
            else "api.routers.notebook_shares")
    return importlib.import_module(name)


def _served_route(method: str, path: str) -> APIRoute:
    from api.main import app  # noqa: WPS433
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path == path and method in r.methods:
            return r
    raise AssertionError(f"{method} {path} is not served")


@pytest.mark.parametrize("row", sorted(PROOF_MATRIX), ids=lambda r: f"{r[0]} {r[1]}")
def test_the_plan_column_is_the_dependency_tree(row):
    """Ruling D-B3, structurally: mint/publish/refresh/patch carry THIS router's require_paid;
    revoke, list and status carry get_current_user and NOT require_paid (a lapsed member
    must always be able to kill a public link); public routes carry neither."""
    method, path = row
    calls = _dep_calls(_served_route(method, path))
    paid = getattr(_router_module_for(path), "require_paid", None)
    plan = PROOF_MATRIX[row]["plan"]
    if plan == "paid":
        assert paid is not None and paid in calls, f"{method} {path} must take require_paid"
    else:
        assert paid not in calls, f"{method} {path} must NOT take require_paid"
    if plan in ("paid", "session"):
        assert authmw.get_current_user in calls, f"{method} {path} must read the session"
    else:
        assert authmw.get_current_user not in calls, f"{method} {path} is public by design"


# ── the behaviour app ───────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def gates_on(monkeypatch):
    monkeypatch.setenv(G_SHARE, "1")
    monkeypatch.setenv(G_PUBLISH, "1")


@pytest.fixture
def gates_off(monkeypatch):
    monkeypatch.delenv(G_SHARE, raising=False)
    monkeypatch.delenv(G_PUBLISH, raising=False)


@pytest.fixture
def att_root(tmp_path, monkeypatch):
    """Both halves of the attachment store on a temp tree (test_note_shares.py's recipe)."""
    from api.services.journal_two import notes as notes_svc
    r = tmp_path / "att"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", r)
    monkeypatch.setattr(notes_svc, "_read_candidates", lambda rel: [r / rel])
    monkeypatch.setattr(notes_svc, "_read_candidates_with_roots", lambda rel: [(r, r / rel)])
    return r


@pytest.fixture
def app(db_path):
    from api.routers import notebook_publish, notebook_shares
    fa = FastAPI()
    fa.include_router(notebook_shares.router)
    fa.include_router(notebook_publish.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_member(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def signed_out(app) -> None:
    app.dependency_overrides.pop(authmw.get_current_user, None)
    app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)


def _conn() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    return get_connection()


def _table_rows(table: str) -> list[tuple]:
    c = _conn()
    try:
        return [tuple(r) for r in c.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()]
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


def snapshot() -> dict[str, list[tuple]]:
    """Every row any public-note door could write. Equal before and after = nothing written."""
    return {t: _table_rows(t) for t in ("j2_note_shares", "j2_note_publications", "j2_notes")}


def _run(sql: str, params: tuple = ()) -> None:
    c = _conn()
    try:
        c.execute(sql, params)
        c.commit()
    finally:
        c.close()


def _note(user_id: str, title: str, **payload) -> dict:
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": title, **payload})


def _png(att_root, user_id: str, note_id: str, sub: str = "inline", name: str = "pic.png") -> str:
    d = att_root / user_id / "notes" / note_id / sub
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(b"\x89PNG\r\n\x1a\nfake")
    return name


@pytest.fixture
def world(db_path, att_root, gates_on):
    """Member A: a shared note with an image on disk. Member B: a note of their own.
    Returned ids are what the row builders below turn into concrete requests."""
    from api.services.journal_two import note_shares
    na = _note(A, "Alpha shared note")
    _png(att_root, A, na["id"])
    tok = note_shares.create_share(A, na["id"])["token"]
    nb = _note(B, "Bravo own note")
    return {"A_note": na["id"], "A_token": tok, "B_note": nb["id"]}


MISSING_NOTE = "note-that-does-not-exist-0000"
MISSING_TOKEN = "tok-that-does-not-exist-0000000000000000000"

#: row -> build(world, target) -> (method, url). `target` is 'A' (member A's real thing),
#: 'missing' (an id that exists nowhere) or 'own' (the caller B's own thing).
RequestBuilder = Callable[[dict, str], tuple[str, str]]


def _note_for(w: dict, target: str) -> str:
    return {"A": w["A_note"], "missing": MISSING_NOTE, "own": w["B_note"]}[target]


def _token_for(w: dict, target: str) -> str:
    return {"A": w["A_token"], "missing": MISSING_TOKEN, "own": w["A_token"]}[target]


BUILDERS: dict[tuple[str, str], RequestBuilder] = {
    ("GET", "/api/j2/notes/{note_id}/share"):
        lambda w, t: ("GET", f"/api/j2/notes/{_note_for(w, t)}/share"),
    ("POST", "/api/j2/notes/{note_id}/share"):
        lambda w, t: ("POST", f"/api/j2/notes/{_note_for(w, t)}/share"),
    ("DELETE", "/api/j2/notes/{note_id}/share"):
        lambda w, t: ("DELETE", f"/api/j2/notes/{_note_for(w, t)}/share"),
    ("GET", "/api/j2/shared/{token}"):
        lambda w, t: ("GET", f"/api/j2/shared/{_token_for(w, t)}"),
    ("GET", "/api/j2/shared/{token}/att/{sub}/{filename}"):
        lambda w, t: ("GET", f"/api/j2/shared/{_token_for(w, t)}/att/inline/pic.png"),
}


def test_every_row_has_a_request_builder():
    missing = sorted(set(PROOF_MATRIX) - set(BUILDERS))
    assert not missing, f"rows the behaviour tests cannot drive: {missing}"


def _call(client, method: str, url: str, **kw):
    return client.request(method, url, **kw)


def _sig(resp) -> tuple:
    """Everything a caller can observe about an answer."""
    return resp.status_code, resp.content, sorted(resp.headers.items())


OWNER_ROWS = sorted(r for r, s in PROOF_MATRIX.items() if s["auth"] == "owner")
PUBLIC_ROWS = sorted(r for r, s in PROOF_MATRIX.items() if s["auth"] == "public")
_ids = lambda r: f"{r[0]} {r[1]}"  # noqa: E731


# ── 1. owner-only ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("row", OWNER_ROWS, ids=_ids)
def test_1_member_B_cannot_touch_A_and_the_answer_equals_a_missing_id(row, app, client, world):
    as_member(app, B)
    before = snapshot()
    method, url_a = BUILDERS[row](world, "A")
    _, url_missing = BUILDERS[row](world, "missing")
    on_a = _call(client, method, url_a)
    on_missing = _call(client, method, url_missing)
    assert _sig(on_a) == _sig(on_missing), (
        f"{row}: B acting on A's thing answered differently from a missing id -- an oracle")
    assert snapshot() == before, f"{row}: B's attempt on A's thing WROTE something"
    # ...and A's link still serves (B's revoke did not reach it).
    signed_out(app)
    assert client.get(f"/api/j2/shared/{world['A_token']}").status_code == 200


def test_1_control_A_can_do_what_B_cannot(app, client, world):
    """CONTROL: the same requests by the OWNER do reach the thing, so the equality above
    is not two identical refusals of everybody."""
    as_member(app, A)
    assert client.get(f"/api/j2/notes/{world['A_note']}/share").json()["share"]["token"] == world["A_token"]
    assert client.delete(f"/api/j2/notes/{world['A_note']}/share").json() == {"revoked": True}


def test_1_the_service_scopes_revoke_by_the_caller(db_path):
    """Service layer, no router: B's revoke of A's note id touches no row."""
    from api.services.journal_two import note_shares
    na = _note(A, "a")
    tok = note_shares.create_share(A, na["id"])["token"]
    assert note_shares.revoke_share(B, na["id"]) is False
    assert note_shares.get_share(A, na["id"])["token"] == tok


# ── 2. token entropy ────────────────────────────────────────────────────────────────────

URLSAFE = re.compile(r"^[A-Za-z0-9_-]+$")
MIN_TOKEN_CHARS = 22   # 16 random bytes (128 bits) -> 22 url-safe characters


def _mint_many_share_tokens(n: int) -> list[str]:
    from api.services.journal_two import note_shares
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    now = "2026-09-25T00:00:00+00:00"
    c.executemany(
        "INSERT INTO j2_notes (id, user_id, title, body_json, created_at, updated_at)"
        " VALUES (?, ?, ?, '{}', ?, ?)",
        [(f"n{i}", A, f"t{i}", now, now) for i in range(n)])
    c.commit()
    try:
        return [note_shares.create_share(A, f"n{i}", conn=c)["token"] for i in range(n)]
    finally:
        c.close()


def test_2_share_tokens_are_at_least_128_bits_and_all_distinct():
    toks = _mint_many_share_tokens(1000)
    assert len(set(toks)) == 1000
    assert all(URLSAFE.match(t) for t in toks)
    assert min(len(t) for t in toks) >= MIN_TOKEN_CHARS, min(len(t) for t in toks)


def test_2_the_token_is_minted_by_the_secrets_module_with_at_least_16_bytes():
    """Structural half: the byte count the code asks for, read from the module constant the
    mint uses (so `token_urlsafe(4)` fails here as well as in the length check above)."""
    from api.services.journal_two import note_shares
    src = open(note_shares.__file__, encoding="utf-8").read()
    assert "secrets.token_urlsafe(TOKEN_BYTES)" in src
    assert note_shares.TOKEN_BYTES >= 16


# ── 3. expiry (ruling D-B2) ─────────────────────────────────────────────────────────────

def _expire_share(token: str) -> None:
    _run("UPDATE j2_note_shares SET expires_at = ? WHERE token = ?",
         ("2000-01-01T00:00:00.000000+00:00", token))


def test_3_an_expired_share_answers_the_unknown_404_on_resolve_and_image(app, client, world):
    signed_out(app)
    live = client.get(f"/api/j2/shared/{world['A_token']}")
    assert live.status_code == 200
    _expire_share(world["A_token"])
    for url in (f"/api/j2/shared/{world['A_token']}",
                f"/api/j2/shared/{world['A_token']}/att/inline/pic.png"):
        expired = client.get(url)
        unknown = client.get(url.replace(world["A_token"], MISSING_TOKEN))
        assert expired.status_code == 404
        assert _sig(expired) == _sig(unknown), url


def test_3_mint_takes_an_expiry_and_refuses_anything_else(app, client, world):
    as_member(app, A)
    _run("UPDATE j2_note_shares SET revoked_at = 'x' WHERE token = ?", (world["A_token"],))
    for bad in (5, "7", 7.0, True, -30, 365, [7]):
        r = client.post(f"/api/j2/notes/{world['A_note']}/share", json={"expiresInDays": bad})
        assert r.status_code == 422, bad
        assert r.json()["detail"] == "Choose when the link stops working: never, or after 7, 30 or 90 days.", bad
    r = client.post(f"/api/j2/notes/{world['A_note']}/share", json={"expiresInDays": 30})
    assert r.status_code == 200 and r.json()["share"]["expiresAt"], r.text
    assert client.post(f"/api/j2/notes/{world['A_note']}/share").status_code == 200  # no body: never


def test_3_a_link_that_expires_in_the_future_serves(app, client, world):
    as_member(app, A)
    _run("UPDATE j2_note_shares SET expires_at = ? WHERE token = ?",
         ("2999-01-01T00:00:00.000000+00:00", world["A_token"]))
    signed_out(app)
    assert client.get(f"/api/j2/shared/{world['A_token']}").status_code == 200


# ── 4. revocation is immediate; nothing public is cacheable ─────────────────────────────

def test_4_after_revoke_resolve_and_image_answer_404_in_the_same_process(app, client, world):
    signed_out(app)
    page = f"/api/j2/shared/{world['A_token']}"
    img = f"{page}/att/inline/pic.png"
    assert client.get(page).status_code == 200
    assert client.get(img).status_code == 200
    as_member(app, A)
    assert client.delete(f"/api/j2/notes/{world['A_note']}/share").json() == {"revoked": True}
    signed_out(app)
    assert client.get(page).status_code == 404
    assert client.get(img).status_code == 404


@pytest.mark.parametrize("row", PUBLIC_ROWS, ids=_ids)
def test_4_every_public_response_carries_no_store_private(row, app, client, world):
    signed_out(app)
    for target in ("A", "missing"):
        method, url = BUILDERS[row](world, target)
        r = _call(client, method, url)
        assert r.headers.get("cache-control") == "no-store, private", (row, target, r.status_code)


def test_4_the_image_file_response_carries_the_public_headers(app, client, world):
    signed_out(app)
    r = client.get(f"/api/j2/shared/{world['A_token']}/att/inline/pic.png")
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")
    for k, v in PUBLIC_HEADERS.items():
        assert r.headers.get(k) == v, k


# ── 5. no data beyond the note ──────────────────────────────────────────────────────────

SECRETS = {
    "other_title": "Zeta Private Title 7731",
    "tag": "secrettagq88",
    "ticker": "ZQTK",
    "property": "2031-07-19",
    "trade_ref": "trade-777-secret",
    "search_text": "search-text-secret-99",
    "fact_id": "fact-secret-id-55",
    "excerpt_id": "excerpt-secret-id-66",
}


def _rich_body(owner: str, note_id: str, other_id: str) -> dict:
    text = lambda s, *marks: ({"type": "text", "text": s, "marks": list(marks)} if marks  # noqa: E731
                             else {"type": "text", "text": s})
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [
            text("See "), {"type": "noteLink", "attrs": {"noteId": other_id}},
            text(" and "),
            text("the other note", {"type": "link", "attrs": {"href": f"/journal/notebook?note={other_id}"}}),
            text(" and "),
            text("the web", {"type": "link", "attrs": {"href": "https://example.com/x"}}),
        ]},
        {"type": "image", "attrs": {"src": f"/api/j2/notes/attachments/{owner}/{note_id}/inline/pic.png"}},
        {"type": "image", "attrs": {"src": f"/api/j2/notes/attachments/{owner}/{other_id}/inline/o.png"}},
        {"type": "attachmentChip", "attrs": {
            "href": f"/api/j2/notes/attachments/{owner}/{note_id}/file/report.pdf", "name": "report.pdf"}},
        {"type": "widgetEmbed", "attrs": {
            "v": 1, "widgetId": "fundamentals", "mode": "snapshot", "capturedAt": "2026-09-01T12:00:00Z",
            "params": {"symbol": "AAPL", "view": "quarterly", "data": {"quarterly": [1]}, "settings": {"x": 1}},
            "fallback": {"url": f"/api/j2/notes/attachments/{owner}/{note_id}/inline/pic.png", "w": 900, "h": 500},
            "tradeRef": SECRETS["trade_ref"], "searchText": SECRETS["search_text"],
            "annotations": [{"id": "d1"}], "embedId": "embed-1", "caption": "my caption"}},
        {"type": "widgetEmbed", "attrs": {
            "v": 1, "widgetId": "chart", "params": {"symbol": "AMD", "tf": "D"},
            "fallback": {"url": f"/api/j2/notes/attachments/{owner}/{note_id}/inline/pic.png"},
            "tradeRef": SECRETS["trade_ref"]}},
        {"type": "financialFact", "attrs": {"factId": SECRETS["fact_id"]}},
        {"type": "documentExcerpt", "attrs": {"excerptId": SECRETS["excerpt_id"]}},
        {"type": "askInsert", "attrs": {"insertedAt": "2026-09-22T12:00:00Z", "scope": "notebook",
                                        "question": "my question"},
         "content": [{"type": "paragraph", "content": [
             text("Answer "),
             {"type": "askCitation", "attrs": {
                 "n": 1, "label": SECRETS["other_title"],
                 "nav": {"kind": "note", "note_id": other_id}, "citation": "exact", "claim": "Answer"}}]}]},
    ]}


@pytest.fixture
def rich(db_path, att_root, gates_on):
    from api.services.journal_two import note_shares, notes
    folder = notes.create_folder(A, "Private folder name")
    other = _note(A, SECRETS["other_title"])
    note = notes.create_note(A, {"title": "Rich note", "subtitle": "sub", "tags": [SECRETS["tag"]],
                                 "ticker": SECRETS["ticker"], "folderId": folder["id"]},
                             properties={"builtin:review_date": SECRETS["property"]})
    notes.update_note(A, note["id"], {"bodyJson": _rich_body(A, note["id"], other["id"])})
    _png(att_root, A, note["id"])
    _png(att_root, A, note["id"], sub="file", name="report.pdf")
    tok = note_shares.create_share(A, note["id"])["token"]
    return {"note": note["id"], "other": other["id"], "folder": folder["id"], "token": tok}


def _strings(node: Any):
    if isinstance(node, dict):
        for k, v in node.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)
    elif node is not None:
        yield str(node)


def test_5_the_public_keys_are_exactly_the_note_keys(app, client, rich):
    signed_out(app)
    body = client.get(f"/api/j2/shared/{rich['token']}").json()
    assert set(body) == {"note"}
    assert set(body["note"]) == {"title", "subtitle", "bodyJson", "heroImageUrl", "updatedAt"}


def test_5_the_body_carries_nothing_of_the_account(app, client, rich):
    signed_out(app)
    payload = client.get(f"/api/j2/shared/{rich['token']}").json()["note"]
    blob = "\n".join(_strings(payload))
    forbidden = {
        "another note's id": rich["other"],
        "another note's title": SECRETS["other_title"],
        "the user id": A,
        "a tag": SECRETS["tag"],
        "the folder id": rich["folder"],
        "the ticker": SECRETS["ticker"],
        "a property value": SECRETS["property"],
        "a tradeRef": SECRETS["trade_ref"],
        "a widget searchText": SECRETS["search_text"],
        "a fact id": SECRETS["fact_id"],
        "an excerpt id": SECRETS["excerpt_id"],
        "the owner-only attachment route": "/api/j2/notes/attachments/",
        "a citation nav": '"nav"',
        "a citation label key": '"label"',
    }
    dumped = json.dumps(payload)
    for what, needle in forbidden.items():
        assert needle not in blob and needle not in dumped, f"the public copy carries {what}: {needle!r}"
    # CONTROL: the note's own words and its own image DID survive -- the scan is not
    # passing over an empty body.
    assert "Answer " in blob and "linked note" in blob and "my question" in blob
    assert f"/api/j2/shared/{rich['token']}/att/inline/pic.png" in blob


@pytest.mark.parametrize("path", [
    "file/report.pdf",          # a 'file' attachment is never served
    "inline/..",                # traversal
    "inline/..%2Fsecret.png",   # encoded separator
    "inline/..%5Csecret.png",   # encoded backslash
    "hero/%2e%2e",              # encoded dots
    "other/pic.png",            # an unknown sub
])
def test_5_the_image_proxy_serves_only_this_notes_images(app, client, rich, path):
    signed_out(app)
    r = client.get(f"/api/j2/shared/{rich['token']}/att/{path}")
    assert r.status_code == 404, (path, r.status_code)


def test_5_control_the_image_proxy_serves_this_notes_inline_image(app, client, rich):
    signed_out(app)
    assert client.get(f"/api/j2/shared/{rich['token']}/att/inline/pic.png").status_code == 200


# ── 6. rate limits (ruling D-B10) ───────────────────────────────────────────────────────

RATE_ROWS = sorted(r for r, s in PROOF_MATRIX.items() if s["bucket"])


@pytest.mark.parametrize("row", RATE_ROWS, ids=_ids)
def test_6_the_bucket_admits_its_limit_then_answers_429_with_a_sentence(row, app, client, world):
    spec = PROOF_MATRIX[row]
    allowed, _per = BUCKET_LIMITS[spec["bucket"]]
    if spec["auth"] == "owner":
        as_member(app, A)
    else:
        signed_out(app)
    method, url = BUILDERS[row](world, "A" if spec["auth"] == "owner" else "missing")
    headers = {"CF-Connecting-IP": "203.0.113.7"}
    for i in range(allowed):
        r = _call(client, method, url, headers=headers)
        assert r.status_code != 429, f"{row}: refused at request {i + 1} of {allowed}"
    over = _call(client, method, url, headers=headers)
    assert over.status_code == 429, (row, over.status_code)
    detail = over.json()["detail"]
    assert isinstance(detail, str) and detail.endswith(".") and " " in detail, detail
    if spec["auth"] == "public":
        for k, v in PUBLIC_HEADERS.items():
            assert over.headers.get(k) == v, (row, k)
        # ...and the bucket is per IP: another address is still served.
        other = _call(client, method, url, headers={"CF-Connecting-IP": "198.51.100.9"})
        assert other.status_code != 429
    else:
        # ...and the bucket is per member: another member is still served.
        as_member(app, B)
        _, url_b = BUILDERS[row](world, "own")
        assert _call(client, method, url_b).status_code != 429


# ── 7. no enumeration oracle ────────────────────────────────────────────────────────────

@pytest.fixture
def states(db_path, att_root, gates_on):
    """One token per state a public read can meet, each with an image on disk."""
    from api.services.journal_two import note_shares, notes
    out = {}
    for name in ("live", "revoked", "expired", "trashed", "archived"):
        n = _note(A, f"state {name}")
        _png(att_root, A, n["id"])
        out[name] = (n["id"], note_shares.create_share(A, n["id"])["token"])
    note_shares.revoke_share(A, out["revoked"][0])
    _expire_share(out["expired"][1])
    notes.delete_note(A, out["trashed"][0])
    notes.set_note_archived(A, out["archived"][0], True)
    return out


@pytest.mark.parametrize("suffix", ["", "/att/inline/pic.png"], ids=["page", "image"])
def test_7_every_dead_token_answers_byte_identically(app, client, states, monkeypatch, suffix):
    signed_out(app)
    answers = {"unknown": client.get(f"/api/j2/shared/{MISSING_TOKEN}{suffix}")}
    for name in ("revoked", "expired", "trashed", "archived"):
        answers[name] = client.get(f"/api/j2/shared/{states[name][1]}{suffix}")
    monkeypatch.setenv(G_SHARE, "0")
    answers["flag-off"] = client.get(f"/api/j2/shared/{states['live'][1]}{suffix}")
    monkeypatch.setenv(G_SHARE, "1")
    base = _sig(answers["unknown"])
    assert base[0] == 404
    for name, r in answers.items():
        assert _sig(r) == base, f"a {name} token answers differently from an unknown one"
    # CONTROL: the live token is served, so the equality is not "everything refuses".
    assert client.get(f"/api/j2/shared/{states['live'][1]}{suffix}").status_code == 200


# ── 8. the gate is off ──────────────────────────────────────────────────────────────────

WRITE_SPIES = {
    "api.services.journal_two.note_shares": (
        "create_share", "revoke_share", "get_share", "resolve_share", "resolve_share_attachment",
        "list_shares"),
}


@pytest.fixture
def spies(monkeypatch):
    calls: list[str] = []
    for mod_name, names in WRITE_SPIES.items():
        mod = importlib.import_module(mod_name)
        for name in names:
            if hasattr(mod, name):
                def _spy(*a, __n=f"{mod_name}.{name}", **k):
                    calls.append(__n)
                    raise AssertionError(f"{__n} was reached with the gate off")
                monkeypatch.setattr(mod, name, _spy)
    return calls


@pytest.mark.parametrize("row", sorted(PROOF_MATRIX), ids=_ids)
@pytest.mark.parametrize("who", ["paid member", "signed out"])
def test_8_with_the_gate_off_every_route_answers_404_and_nothing_runs(
        row, who, app, client, world, gates_off, spies):
    if who == "paid member":
        as_member(app, A)
    else:
        signed_out(app)
    before = snapshot()
    method, url = BUILDERS[row](world, "A")
    r = _call(client, method, url, json={"expiresInDays": None} if method in ("POST", "PATCH") else None)
    assert r.status_code == 404 and r.json() == {"detail": "Not found"}, (row, who, r.status_code, r.text)
    assert spies == [], f"{row}: {spies} ran with the gate off"
    assert snapshot() == before, f"{row}: wrote with the gate off"


def test_8_control_the_spies_can_see_a_call(app, client, world, spies, monkeypatch):
    """CONTROL: with the gate ON the same request reaches a spied function, so the empty
    list above means 'nothing ran', not 'the spies were never installed'."""
    monkeypatch.setenv(G_SHARE, "1")
    signed_out(app)
    with pytest.raises(AssertionError):
        client.get(f"/api/j2/shared/{world['A_token']}")
    assert spies, "the spy saw nothing even with the gate on"


# ── 9. referrer ─────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("row", PUBLIC_ROWS, ids=_ids)
@pytest.mark.parametrize("target", ["A", "missing"])
def test_9_every_public_response_carries_no_referrer_and_noindex(row, target, app, client, world):
    signed_out(app)
    method, url = BUILDERS[row](world, target)
    r = _call(client, method, url)
    assert r.headers.get("referrer-policy") == "no-referrer", (row, target)
    assert r.headers.get("x-robots-tag") == "noindex, nofollow", (row, target)


# ── 10. plan (ruling D-B3), both directions ─────────────────────────────────────────────

def _paid_sentence(path: str) -> str:
    """The serving router's OWN 402 sentence, read by CALLING its require_paid with a free
    member -- never retyped here (tests/test_user_definitions_auth.py keeps each router's
    sentence distinct, so a member can tell which surface locked them out)."""
    from fastapi import HTTPException
    try:
        _router_module_for(path).require_paid({"id": "probe", "role": "member", "plan": "free"})
    except HTTPException as e:
        assert e.status_code == 402 and "paid plan" in str(e.detail), e.detail
        return str(e.detail)
    raise AssertionError(f"require_paid for {path} let a free member through")


@pytest.mark.parametrize("row", OWNER_ROWS, ids=_ids)
def test_10_a_free_member_is_refused_exactly_where_the_plan_is_paid(row, app, client, world):
    as_member(app, A, FREE)
    method, url = BUILDERS[row](world, "A")
    r = _call(client, method, url)
    if PROOF_MATRIX[row]["plan"] == "paid":
        assert r.status_code == 402, (row, r.status_code)
        assert r.json()["detail"] == _paid_sentence(row[1]), (row, r.json())
    else:
        assert r.status_code == 200, (row, r.status_code, r.text)


def test_10_a_lapsed_member_can_still_revoke_their_link(app, client, world):
    as_member(app, A, FREE)
    assert client.delete(f"/api/j2/notes/{world['A_note']}/share").json() == {"revoked": True}
    signed_out(app)
    assert client.get(f"/api/j2/shared/{world['A_token']}").status_code == 404
