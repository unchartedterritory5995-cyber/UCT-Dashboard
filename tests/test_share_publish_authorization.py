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
                                  11 a public read writes nothing (F-READ-WRITES)
                                  12 a malformed body: gate, then member, then body (I-1)

Share links (`notebook_shares.py`) and publish-to-web (`notebook_publish.py`, B4) are both
rows of the one matrix; every property runs over both where it applies.
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
#:   body    'expiry' (reads `{expiresInDays}` through the router's `expiry_body` dependency,
#:           AFTER the gate and the member -- wave-8 final review I-1) | None (reads no body)
PROOF_MATRIX: dict[tuple[str, str], dict[str, Any]] = {
    ("GET", "/api/j2/notes/{note_id}/share"):
        {"auth": "owner", "gate": G_SHARE, "bucket": None, "plan": "session", "body": None},
    ("POST", "/api/j2/notes/{note_id}/share"):
        {"auth": "owner", "gate": G_SHARE, "bucket": "notebook-share-mint", "plan": "paid", "body": "expiry"},
    ("DELETE", "/api/j2/notes/{note_id}/share"):
        {"auth": "owner", "gate": G_SHARE, "bucket": None, "plan": "session", "body": None},
    ("GET", "/api/j2/shared/{token}"):
        {"auth": "public", "gate": G_SHARE, "bucket": "notebook-share-public", "plan": None, "body": None},
    ("GET", "/api/j2/shared/{token}/att/{sub}/{filename}"):
        {"auth": "public", "gate": G_SHARE, "bucket": "notebook-share-images", "plan": None, "body": None},
    ("GET", "/api/j2/share/links"):
        {"auth": "owner", "gate": G_SHARE, "bucket": None, "plan": "session", "body": None},
    # ── publish-to-web (B4) ──
    ("GET", "/api/j2/publish"):
        {"auth": "owner", "gate": G_PUBLISH, "bucket": None, "plan": "session", "body": None},
    ("POST", "/api/j2/publish/notes/{note_id}"):
        {"auth": "owner", "gate": G_PUBLISH, "bucket": "notebook-publish-mint", "plan": "paid", "body": "expiry"},
    ("POST", "/api/j2/publish/folders/{folder_id}"):
        {"auth": "owner", "gate": G_PUBLISH, "bucket": "notebook-publish-mint", "plan": "paid", "body": "expiry"},
    ("POST", "/api/j2/publish/{slug}/refresh"):
        {"auth": "owner", "gate": G_PUBLISH, "bucket": "notebook-publish-mint", "plan": "paid", "body": None},
    ("PATCH", "/api/j2/publish/{slug}"):
        {"auth": "owner", "gate": G_PUBLISH, "bucket": None, "plan": "paid", "body": "expiry"},
    ("DELETE", "/api/j2/publish/{slug}"):
        {"auth": "owner", "gate": G_PUBLISH, "bucket": None, "plan": "session", "body": None},
    ("GET", "/api/j2/published/{slug}"):
        {"auth": "public", "gate": G_PUBLISH, "bucket": "notebook-publish-public", "plan": None, "body": None},
    ("GET", "/api/j2/published/{slug}/n/{pid}"):
        {"auth": "public", "gate": G_PUBLISH, "bucket": "notebook-publish-public", "plan": None, "body": None},
    ("GET", "/api/j2/published/{slug}/att/{sub}/{filename}"):
        {"auth": "public", "gate": G_PUBLISH, "bucket": "notebook-publish-images", "plan": None, "body": None},
    ("GET", "/api/j2/published/{slug}/n/{pid}/att/{sub}/{filename}"):
        {"auth": "public", "gate": G_PUBLISH, "bucket": "notebook-publish-images", "plan": None, "body": None},
}

#: Ruling D-B10, verbatim numbers: (requests allowed, per) for each bucket.
BUCKET_LIMITS: dict[str, tuple[int, str]] = {
    "notebook-share-public": (60, "minute"),
    "notebook-share-images": (240, "minute"),
    "notebook-share-mint": (30, "hour"),
    "notebook-publish-public": (60, "minute"),
    "notebook-publish-images": (240, "minute"),
    "notebook-publish-mint": (30, "hour"),
}

PUBLIC_HEADERS = {
    "cache-control": "no-store, private",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",      # wave-8 final review M-7
}
#: M-7: an image the proxy serves, opened as a document, may load and run nothing.
IMAGE_CSP = "default-src 'none'"

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
    assert ("GET", "/api/j2/published/{slug}") in derived, sorted(derived)


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
        assert set(spec) == {"auth", "gate", "bucket", "plan", "body"}, row
        assert spec["auth"] in ("owner", "public"), row
        assert spec["gate"] in (G_SHARE, G_PUBLISH), row
        assert spec["bucket"] is None or spec["bucket"] in BUCKET_LIMITS, row
        assert (spec["plan"] is None) == (spec["auth"] == "public"), row
        assert spec["body"] in (None, "expiry"), row
        if spec["body"] is not None:
            assert row[0] in ("POST", "PATCH") and spec["plan"] == "paid", row


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


@pytest.mark.parametrize("row", sorted(PROOF_MATRIX), ids=lambda r: f"{r[0]} {r[1]}")
def test_the_body_column_is_the_dependency_tree_and_no_route_declares_a_fastapi_body(row):
    """Wave-8 final review I-1, structurally. FastAPI decodes a DECLARED body (a `Body(...)`
    parameter: `route.body_field`) before it solves a single dependency, so a declared body
    runs ahead of the router's gate and ahead of the session. No public-note route may
    declare one; the rows that take `{expiresInDays}` read it through the router's own
    `expiry_body` dependency, which itself depends on `require_paid`."""
    method, path = row
    route = _served_route(method, path)
    assert route.body_field is None, (
        f"{method} {path} declares a FastAPI body -- it is decoded BEFORE the gate and the "
        "session; read it in a dependency that depends on require_paid (expiry_body)")
    reader = getattr(_router_module_for(path), "expiry_body", None)
    assert reader is not None, f"{path}'s router has no expiry_body dependency"
    reads = reader in _dep_calls(route)
    assert reads == (PROOF_MATRIX[row]["body"] == "expiry"), (
        f"{method} {path}: the matrix says body={PROOF_MATRIX[row]['body']!r}, the route "
        f"{'reads' if reads else 'does not read'} one through expiry_body")
    if reads:
        paid = _router_module_for(path).require_paid
        direct = [d for d in route.dependant.dependencies if d.call is reader]
        assert len(direct) == 1, f"{method} {path}: expiry_body is not a direct dependency of the route"
        assert paid in {d.call for d in direct[0].dependencies}, (
            f"{method} {path}: expiry_body must depend on require_paid, so the member is known "
            "before a byte of the body is read")


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
    """Member A: a shared AND published note with an image on disk, and a published folder
    holding one note with an image. Member B: a note and a published folder of their own.
    Returned ids are what the row builders below turn into concrete requests."""
    from api.services.journal_two import note_publish, note_shares, notes
    na = _note(A, "Alpha shared note")
    _png(att_root, A, na["id"])
    tok = note_shares.create_share(A, na["id"])["token"]
    a_pub = note_publish.publish_note(A, na["id"])["slug"]
    fa = notes.create_folder(A, "Alpha published folder")
    member = _note(A, "Alpha folder member", folderId=fa["id"])
    _png(att_root, A, member["id"])
    a_folder_pub = note_publish.publish_folder(A, fa["id"])["slug"]
    nb = _note(B, "Bravo own note")
    fb = notes.create_folder(B, "Bravo folder")
    _note(B, "Bravo folder member", folderId=fb["id"])
    b_folder_pub = note_publish.publish_folder(B, fb["id"])["slug"]
    return {"A_note": na["id"], "A_token": tok, "B_note": nb["id"],
            "A_pub": a_pub, "A_folder": fa["id"], "A_folder_pub": a_folder_pub,
            "A_member": member["id"], "A_pid": note_publish.pid_for(a_folder_pub, member["id"]),
            "B_folder": fb["id"], "B_folder_pub": b_folder_pub}


MISSING_NOTE = "note-that-does-not-exist-0000"
MISSING_TOKEN = "tok-that-does-not-exist-0000000000000000000"
MISSING_FOLDER = "folder-that-does-not-exist-00"
MISSING_SLUG = "slug-that-does-not-exist-0"
MISSING_PID = "pid-that-does-not-exist-0"

#: row -> build(world, target) -> (method, url). `target` is 'A' (member A's real thing),
#: 'missing' (an id that exists nowhere) or 'own' (the caller B's own thing).
RequestBuilder = Callable[[dict, str], tuple[str, str]]


def _note_for(w: dict, target: str) -> str:
    return {"A": w["A_note"], "missing": MISSING_NOTE, "own": w["B_note"]}[target]


def _token_for(w: dict, target: str) -> str:
    return {"A": w["A_token"], "missing": MISSING_TOKEN, "own": w["A_token"]}[target]


def _folder_for(w: dict, target: str) -> str:
    return {"A": w["A_folder"], "missing": MISSING_FOLDER, "own": w["B_folder"]}[target]


def _note_slug(w: dict, target: str) -> str:
    return {"A": w["A_pub"], "missing": MISSING_SLUG, "own": w["A_pub"]}[target]


def _folder_slug(w: dict, target: str) -> str:
    return {"A": w["A_folder_pub"], "missing": MISSING_SLUG, "own": w["B_folder_pub"]}[target]


def _pid(w: dict, target: str) -> str:
    return {"A": w["A_pid"], "missing": MISSING_PID, "own": w["A_pid"]}[target]


BUILDERS: dict[tuple[str, str], RequestBuilder] = {
    ("GET", "/api/j2/share/links"):
        lambda w, t: ("GET", "/api/j2/share/links"),
    ("GET", "/api/j2/publish"):
        lambda w, t: ("GET", "/api/j2/publish"),
    ("POST", "/api/j2/publish/notes/{note_id}"):
        lambda w, t: ("POST", f"/api/j2/publish/notes/{_note_for(w, t)}"),
    ("POST", "/api/j2/publish/folders/{folder_id}"):
        lambda w, t: ("POST", f"/api/j2/publish/folders/{_folder_for(w, t)}"),
    ("POST", "/api/j2/publish/{slug}/refresh"):
        lambda w, t: ("POST", f"/api/j2/publish/{_folder_slug(w, t)}/refresh"),
    ("PATCH", "/api/j2/publish/{slug}"):
        lambda w, t: ("PATCH", f"/api/j2/publish/{_folder_slug(w, t)}"),
    ("DELETE", "/api/j2/publish/{slug}"):
        lambda w, t: ("DELETE", f"/api/j2/publish/{_note_slug(w, t)}"),
    ("GET", "/api/j2/published/{slug}"):
        lambda w, t: ("GET", f"/api/j2/published/{_note_slug(w, t)}"),
    ("GET", "/api/j2/published/{slug}/n/{pid}"):
        lambda w, t: ("GET", f"/api/j2/published/{_folder_slug(w, t)}/n/{_pid(w, t)}"),
    ("GET", "/api/j2/published/{slug}/att/{sub}/{filename}"):
        lambda w, t: ("GET", f"/api/j2/published/{_note_slug(w, t)}/att/inline/pic.png"),
    ("GET", "/api/j2/published/{slug}/n/{pid}/att/{sub}/{filename}"):
        lambda w, t: ("GET", f"/api/j2/published/{_folder_slug(w, t)}/n/{_pid(w, t)}/att/inline/pic.png"),
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
    # ...and A's link and pages still serve (B's revoke did not reach them).
    signed_out(app)
    assert client.get(f"/api/j2/shared/{world['A_token']}").status_code == 200
    assert client.get(f"/api/j2/published/{world['A_pub']}").status_code == 200
    assert client.get(f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}").status_code == 200


def test_1_control_A_can_do_what_B_cannot(app, client, world):
    """CONTROL: the same requests by the OWNER do reach the thing, so the equality above
    is not two identical refusals of everybody."""
    as_member(app, A)
    assert client.get(f"/api/j2/notes/{world['A_note']}/share").json()["share"]["token"] == world["A_token"]
    assert client.delete(f"/api/j2/notes/{world['A_note']}/share").json() == {"revoked": True}


def test_1_control_A_can_publish_refresh_extend_and_unpublish(app, client, world):
    """CONTROL for the publish rows: the owner's own requests reach the thing."""
    as_member(app, A)
    assert client.post(f"/api/j2/publish/notes/{world['A_note']}").json()["publication"]["slug"] == world["A_pub"]
    assert client.post(f"/api/j2/publish/{world['A_folder_pub']}/refresh").status_code == 200
    r = client.patch(f"/api/j2/publish/{world['A_folder_pub']}", json={"expiresInDays": 7})
    assert r.status_code == 200 and r.json()["publication"]["expiresAt"]
    assert client.delete(f"/api/j2/publish/{world['A_pub']}").json() == {"revoked": True}


def test_1_the_owner_list_holds_only_the_callers_things(app, client, world):
    as_member(app, B)
    mine = client.get("/api/j2/publish").json()
    assert {p["slug"] for p in mine["publications"]} == {world["B_folder_pub"]}
    assert mine["shares"] == []
    assert client.get("/api/j2/share/links").json() == {"shares": []}
    as_member(app, A)
    links = client.get("/api/j2/share/links").json()["shares"]
    assert [s["token"] for s in links] == [world["A_token"]] and links[0]["title"] == "Alpha shared note"
    as_member(app, A)
    mine = client.get("/api/j2/publish").json()
    assert {p["slug"] for p in mine["publications"]} == {world["A_pub"], world["A_folder_pub"]}
    assert [s["token"] for s in mine["shares"]] == [world["A_token"]]
    # The editor's context read: A asking about B's note learns nothing about it.
    ctx = client.get(f"/api/j2/publish?note_id={world['B_note']}").json()["note"]
    assert ctx == {"noteId": world["B_note"], "exists": False, "publishable": False,
                   "folderId": None, "folderName": None}


def test_1_M3_an_archived_note_gets_no_share_link_and_answers_like_a_trashed_one(app, client, world):
    """Wave-8 final review M-3. `note_shares._owned` read only `deleted_at`, so a link could be
    minted for an ARCHIVED note that `_live_share_row` would never serve. Archived now answers
    the mint exactly like trashed and missing (the one not-found), and writes nothing."""
    from api.services.journal_two import note_shares, notes
    archived = _note(A, "Archived, never shared")["id"]
    notes.set_note_archived(A, archived, True)
    trashed = _note(A, "Trashed, never shared")["id"]
    notes.delete_note(A, trashed)
    as_member(app, A)
    before = snapshot()
    on_archived = client.post(f"/api/j2/notes/{archived}/share")
    on_trashed = client.post(f"/api/j2/notes/{trashed}/share")
    on_missing = client.post(f"/api/j2/notes/{MISSING_NOTE}/share")
    assert on_archived.status_code == 404, on_archived.text
    assert _sig(on_archived) == _sig(on_trashed) == _sig(on_missing)
    assert snapshot() == before, "a share row was written for an archived note"
    assert note_shares.create_share(A, archived) is None                      # the service agrees
    # CONTROL: the same note, unarchived, is shareable -- the refusal is the archive, not the note.
    notes.set_note_archived(A, archived, False)
    ok = client.post(f"/api/j2/notes/{archived}/share")
    assert ok.status_code == 200 and ok.json()["share"]["token"], ok.text


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


def test_2_publication_slugs_are_at_least_128_bits_and_all_distinct():
    from api.services.journal_two import note_publish
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    now = "2026-09-25T00:00:00+00:00"
    c.executemany(
        "INSERT INTO j2_notes (id, user_id, title, body_json, created_at, updated_at)"
        " VALUES (?, ?, ?, '{}', ?, ?)",
        [(f"n{i}", A, f"t{i}", now, now) for i in range(1000)])
    c.commit()
    try:
        slugs = [note_publish.publish_note(A, f"n{i}", conn=c)["slug"] for i in range(1000)]
    finally:
        c.close()
    assert len(set(slugs)) == 1000
    assert all(URLSAFE.match(s) for s in slugs)
    assert min(len(s) for s in slugs) >= MIN_TOKEN_CHARS
    src = open(note_publish.__file__, encoding="utf-8").read()
    assert "secrets.token_urlsafe(SLUG_BYTES)" in src and note_publish.SLUG_BYTES >= 16


def test_2_a_pid_is_never_the_note_id_and_is_publication_scoped():
    from api.services.journal_two import note_publish
    pid = note_publish.pid_for("slug-one", "note-abc")
    assert len(pid) == note_publish.PID_CHARS == 22 and URLSAFE.match(pid)
    assert "note-abc" not in pid
    assert pid != note_publish.pid_for("slug-two", "note-abc")      # another publication, another pid
    assert pid == note_publish.pid_for("slug-one", "note-abc")      # stable within one


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


def _expire_publication(slug: str) -> None:
    _run("UPDATE j2_note_publications SET expires_at = ? WHERE slug = ?",
         ("2000-01-01T00:00:00.000000+00:00", slug))


def test_3_an_expired_publication_answers_the_unknown_404_everywhere(app, client, world):
    signed_out(app)
    urls = [f"/api/j2/published/{world['A_pub']}",
            f"/api/j2/published/{world['A_pub']}/att/inline/pic.png",
            f"/api/j2/published/{world['A_folder_pub']}",
            f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}",
            f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}/att/inline/pic.png"]
    for url in urls:
        assert client.get(url).status_code == 200, url
    _expire_publication(world["A_pub"])
    _expire_publication(world["A_folder_pub"])
    for url in urls:
        expired = client.get(url)
        unknown = client.get(url.replace(world["A_pub"], MISSING_SLUG).replace(world["A_folder_pub"], MISSING_SLUG))
        assert expired.status_code == 404, url
        assert _sig(expired) == _sig(unknown), url


def test_3_publish_and_patch_take_an_expiry_and_refuse_anything_else(app, client, world):
    as_member(app, A)
    sentence = "Choose when the link stops working: never, or after 7, 30 or 90 days."
    for bad in (5, "7", 7.0, True, -30, 365, [7]):
        for method, url in (("POST", f"/api/j2/publish/notes/{world['A_note']}"),
                            ("POST", f"/api/j2/publish/folders/{world['A_folder']}"),
                            ("PATCH", f"/api/j2/publish/{world['A_pub']}")):
            r = client.request(method, url, json={"expiresInDays": bad})
            assert r.status_code == 422 and r.json()["detail"] == sentence, (method, url, bad)
    r = client.patch(f"/api/j2/publish/{world['A_pub']}", json={"expiresInDays": 90})
    assert r.status_code == 200 and r.json()["publication"]["expiresAt"]
    r = client.patch(f"/api/j2/publish/{world['A_pub']}", json={"expiresInDays": None})
    assert r.status_code == 200 and r.json()["publication"]["expiresAt"] is None


def test_3_republishing_after_expiry_mints_a_new_page_and_the_old_address_stays_dead(app, client, world):
    as_member(app, A)
    _expire_publication(world["A_pub"])
    fresh = client.post(f"/api/j2/publish/notes/{world['A_note']}").json()["publication"]["slug"]
    assert fresh != world["A_pub"]
    signed_out(app)
    assert client.get(f"/api/j2/published/{fresh}").status_code == 200
    assert client.get(f"/api/j2/published/{world['A_pub']}").status_code == 404


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


def test_4_after_unpublish_every_public_door_answers_404_in_the_same_process(app, client, world):
    signed_out(app)
    note_urls = [f"/api/j2/published/{world['A_pub']}", f"/api/j2/published/{world['A_pub']}/att/inline/pic.png"]
    folder_urls = [f"/api/j2/published/{world['A_folder_pub']}",
                   f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}",
                   f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}/att/inline/pic.png"]
    for url in note_urls + folder_urls:
        assert client.get(url).status_code == 200, url
    as_member(app, A)
    assert client.delete(f"/api/j2/publish/{world['A_pub']}").json() == {"revoked": True}
    assert client.delete(f"/api/j2/publish/{world['A_folder_pub']}").json() == {"revoked": True}
    signed_out(app)
    for url in note_urls + folder_urls:
        assert client.get(url).status_code == 404, url


@pytest.mark.parametrize("row", PUBLIC_ROWS, ids=_ids)
def test_4_every_public_response_carries_no_store_private(row, app, client, world):
    signed_out(app)
    for target in ("A", "missing"):
        method, url = BUILDERS[row](world, target)
        r = _call(client, method, url)
        assert r.headers.get("cache-control") == "no-store, private", (row, target, r.status_code)


def test_4_the_image_file_response_carries_the_public_headers(app, client, world):
    signed_out(app)
    for url in (f"/api/j2/shared/{world['A_token']}/att/inline/pic.png",
                f"/api/j2/published/{world['A_pub']}/att/inline/pic.png",
                f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}/att/inline/pic.png"):
        r = client.get(url)
        assert r.status_code == 200 and r.content.startswith(b"\x89PNG"), url
        for k, v in PUBLIC_HEADERS.items():
            assert r.headers.get(k) == v, (url, k)
        assert r.headers.get("content-security-policy") == IMAGE_CSP, url


IMAGE_ROWS = [r for r in PUBLIC_ROWS if "/att/" in r[1]]


@pytest.mark.parametrize("row", PUBLIC_ROWS, ids=_ids)
@pytest.mark.parametrize("target", ["A", "missing"])
def test_4_every_public_response_says_nosniff_and_every_served_image_forbids_every_source(
        row, target, app, client, world):
    """Wave-8 final review M-7. The proxy hands strangers bytes whose type only the uploader
    declared, so every public answer -- the JSON, the image, and every miss -- carries
    `X-Content-Type-Options: nosniff`; a served image also carries
    `Content-Security-Policy: default-src 'none'`, so the file opened on its own as a
    document loads nothing and runs nothing, whatever its bytes are."""
    signed_out(app)
    method, url = BUILDERS[row](world, target)
    r = _call(client, method, url)
    assert r.headers.get("x-content-type-options") == "nosniff", (row, target, r.status_code)
    if row in IMAGE_ROWS and target == "A":
        assert r.status_code == 200, (row, r.status_code)
        assert r.headers.get("content-security-policy") == IMAGE_CSP, (row, dict(r.headers))


def test_4_the_image_rows_are_found():
    """Non-vacuity: the CSP leg above runs over the image doors, not over nothing -- and the
    path rule agrees with the matrix's own image buckets, so neither selection drifts."""
    by_bucket = sorted(r for r in PUBLIC_ROWS if str(PROOF_MATRIX[r]["bucket"]).endswith("-images"))
    assert sorted(IMAGE_ROWS) == by_bucket, (IMAGE_ROWS, by_bucket)
    assert ("GET", "/api/j2/shared/{token}/att/{sub}/{filename}") in IMAGE_ROWS, IMAGE_ROWS
    assert len(IMAGE_ROWS) == 3, IMAGE_ROWS   # one share door, two publish doors


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


@pytest.fixture
def rich_pub(rich):
    from api.services.journal_two import note_publish
    pub = note_publish.publish_note(A, rich["note"])["slug"]
    folder_pub = note_publish.publish_folder(A, rich["folder"])["slug"]
    return {**rich, "pub": pub, "folder_pub": folder_pub,
            "pid": note_publish.pid_for(folder_pub, rich["note"])}


def _publish_forbidden(r: dict) -> dict[str, str]:
    return {
        "another note's id": r["other"],
        "another note's title": SECRETS["other_title"],
        "the note's own id": r["note"],
        "the user id": A,
        "a tag": SECRETS["tag"],
        "the folder id": r["folder"],
        "the ticker": SECRETS["ticker"],
        "a property value": SECRETS["property"],
        "a tradeRef": SECRETS["trade_ref"],
        "a widget searchText": SECRETS["search_text"],
        "a fact id": SECRETS["fact_id"],
        "an excerpt id": SECRETS["excerpt_id"],
        "the owner-only attachment route": "/api/j2/notes/attachments/",
        "an Ask question": "my question",
        "an Ask answer": "Answer ",
        "an askCitation chip": "askCitation",
        "a file attachment": "report.pdf",
    }


def _scan(payload: Any, forbidden: dict[str, str]) -> None:
    blob, dumped = "\n".join(_strings(payload)), json.dumps(payload)
    for what, needle in forbidden.items():
        assert needle not in blob and needle not in dumped, f"the published copy carries {what}: {needle!r}"


def test_5_a_published_note_carries_the_note_and_nothing_else(app, client, rich_pub):
    signed_out(app)
    body = client.get(f"/api/j2/published/{rich_pub['pub']}").json()
    assert set(body) == {"kind", "note"} and body["kind"] == "note"
    assert set(body["note"]) == {"title", "subtitle", "bodyJson", "heroImageUrl", "updatedAt"}
    _scan(body, {**_publish_forbidden(rich_pub), "the folder's name": "Private folder name"})
    blob = "\n".join(_strings(body))
    assert "linked note" in blob and "Rich note" in blob                       # control
    assert f"/api/j2/published/{rich_pub['pub']}/att/inline/pic.png" in blob   # control


def test_5_a_folder_index_carries_its_name_and_its_notes_by_pid_only(app, client, rich_pub):
    signed_out(app)
    body = client.get(f"/api/j2/published/{rich_pub['folder_pub']}").json()
    assert set(body) == {"kind", "title", "notes"} and body["kind"] == "folder"
    assert body["title"] == "Private folder name"
    assert body["notes"] and all(set(n) == {"pid", "title", "updatedAt"} for n in body["notes"])
    assert [n["pid"] for n in body["notes"]] == [rich_pub["pid"]]
    _scan(body, {k: v for k, v in _publish_forbidden(rich_pub).items() if k != "an Ask answer"})


def test_5_a_folder_member_carries_the_note_and_its_folder_name_only(app, client, rich_pub):
    signed_out(app)
    body = client.get(f"/api/j2/published/{rich_pub['folder_pub']}/n/{rich_pub['pid']}").json()
    assert set(body) == {"kind", "note", "folder"}
    assert set(body["note"]) == {"title", "subtitle", "bodyJson", "heroImageUrl", "updatedAt"}
    assert body["folder"] == {"title": "Private folder name", "path": f"/p/{rich_pub['folder_pub']}"}
    _scan(body, _publish_forbidden(rich_pub))
    blob = "\n".join(_strings(body))
    assert f"/api/j2/published/{rich_pub['folder_pub']}/n/{rich_pub['pid']}/att/inline/pic.png" in blob


@pytest.mark.parametrize("path", [
    "file/report.pdf",
    "inline/..",
    "inline/..%2Fsecret.png",
    "inline/..%5Csecret.png",
    "hero/%2e%2e",
    "other/pic.png",
])
def test_5_the_published_image_proxies_serve_only_their_notes_images(app, client, rich_pub, path):
    signed_out(app)
    for base in (f"/api/j2/published/{rich_pub['pub']}/att",
                 f"/api/j2/published/{rich_pub['folder_pub']}/n/{rich_pub['pid']}/att"):
        r = client.get(f"{base}/{path}")
        assert r.status_code == 404, (base, path, r.status_code)


def test_5_a_note_slug_never_serves_folder_doors_and_a_folder_slug_never_serves_note_doors(app, client, rich_pub):
    signed_out(app)
    assert client.get(f"/api/j2/published/{rich_pub['pub']}/n/{rich_pub['pid']}").status_code == 404
    assert client.get(f"/api/j2/published/{rich_pub['folder_pub']}/att/inline/pic.png").status_code == 404
    # CONTROL: the right door on each serves.
    assert client.get(f"/api/j2/published/{rich_pub['pub']}/att/inline/pic.png").status_code == 200
    assert client.get(f"/api/j2/published/{rich_pub['folder_pub']}/n/{rich_pub['pid']}/att/inline/pic.png").status_code == 200


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


@pytest.fixture
def pub_states(db_path, att_root, gates_on):
    """One note publication per state a public read can meet, each with an image on disk."""
    from api.services.journal_two import note_publish, notes
    out = {}
    for name in ("live", "revoked", "expired", "trashed", "archived"):
        n = _note(A, f"pub state {name}")
        _png(att_root, A, n["id"])
        out[name] = (n["id"], note_publish.publish_note(A, n["id"])["slug"])
    note_publish.revoke(A, out["revoked"][1])
    _expire_publication(out["expired"][1])
    notes.delete_note(A, out["trashed"][0])
    notes.set_note_archived(A, out["archived"][0], True)
    return out


@pytest.mark.parametrize("suffix", ["", "/att/inline/pic.png"], ids=["page", "image"])
def test_7_every_dead_publication_answers_byte_identically(app, client, pub_states, monkeypatch, suffix):
    signed_out(app)
    answers = {"unknown": client.get(f"/api/j2/published/{MISSING_SLUG}{suffix}")}
    for name in ("revoked", "expired", "trashed", "archived"):
        answers[name] = client.get(f"/api/j2/published/{pub_states[name][1]}{suffix}")
    monkeypatch.setenv(G_PUBLISH, "0")
    answers["flag-off"] = client.get(f"/api/j2/published/{pub_states['live'][1]}{suffix}")
    monkeypatch.setenv(G_PUBLISH, "1")
    base = _sig(answers["unknown"])
    assert base[0] == 404
    for name, r in answers.items():
        assert _sig(r) == base, f"a {name} publication answers differently from an unknown one"
    assert client.get(f"/api/j2/published/{pub_states['live'][1]}{suffix}").status_code == 200  # control


@pytest.mark.parametrize("suffix", ["", "/att/inline/pic.png"], ids=["page", "image"])
def test_7_a_folder_note_that_left_the_set_answers_like_an_unknown_pid(app, client, world, suffix):
    """Moved out of the folder, trashed or archived: the pid stops serving at once (D-B6), and
    the answer cannot be told from a pid that never existed."""
    from api.services.journal_two import notes
    signed_out(app)
    live = f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}{suffix}"
    unknown = client.get(f"/api/j2/published/{world['A_folder_pub']}/n/{MISSING_PID}{suffix}")
    assert client.get(live).status_code == 200                                       # control
    notes.set_note_archived(A, world["A_member"], True)
    assert _sig(client.get(live)) == _sig(unknown)
    notes.set_note_archived(A, world["A_member"], False)
    assert client.get(live).status_code == 200
    notes.update_note(A, world["A_member"], {"folderId": None})
    assert _sig(client.get(live)) == _sig(unknown)


# ── 8. the gate is off ──────────────────────────────────────────────────────────────────

WRITE_SPIES = {
    "api.services.journal_two.note_shares": (
        "create_share", "revoke_share", "get_share", "resolve_share", "resolve_share_attachment",
        "list_shares"),
    "api.services.journal_two.note_publish": (
        "publish_note", "publish_folder", "refresh", "set_expiry", "revoke", "list_mine",
        "resolve", "resolve_member", "resolve_attachment"),
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
    monkeypatch.setenv(G_PUBLISH, "1")
    with pytest.raises(AssertionError):
        client.get(f"/api/j2/published/{world['A_pub']}")
    assert "api.services.journal_two.note_publish.resolve" in spies, spies


# ── 8b / 12. a malformed body (wave-8 final review I-1) ─────────────────────────────────
#
# Three cases per POST/PATCH row of the matrix, each with `content=b"{"` -- a body that is not
# JSON at all. ⚰️ The four expiry doors declared the body as a FastAPI PARAMETER, which is
# decoded before any dependency: with the gate off `{` answered 422 `json_invalid` (a dark
# door that answers differently from a missing one), and with it on a signed-out caller got
# 422 instead of 401. `test_8_with_the_gate_off...` only ever sent well-formed JSON, so it
# could not see either (the class wave 7 fixed twice: writing help's and the personal API's M-1).

BODY_ROWS = sorted(r for r in PROOF_MATRIX if r[0] in ("POST", "PATCH"))
MALFORMED = {"content": b"{", "headers": {"Content-Type": "application/json"}}


def test_the_body_rows_are_every_post_and_patch_row():
    """Non-vacuity: the malformed-body rails below run over something, and over exactly the
    matrix's write rows -- the four expiry doors and refresh."""
    assert len(BODY_ROWS) == 5, BODY_ROWS
    assert sum(1 for r in BODY_ROWS if PROOF_MATRIX[r]["body"] == "expiry") == 4


@pytest.mark.parametrize("row", BODY_ROWS, ids=_ids)
@pytest.mark.parametrize("who", ["paid member", "signed out"])
def test_8_with_the_gate_off_a_MALFORMED_body_is_still_404_and_nothing_runs(
        row, who, app, client, world, gates_off, spies):
    if who == "paid member":
        as_member(app, A)
    else:
        signed_out(app)
    before = snapshot()
    method, url = BUILDERS[row](world, "A")
    r = _call(client, method, url, **MALFORMED)
    assert r.status_code == 404 and r.json() == {"detail": "Not found"}, (row, who, r.status_code, r.text)
    assert spies == [], f"{row}: {spies} ran with the gate off"
    assert snapshot() == before, f"{row}: wrote with the gate off"


@pytest.mark.parametrize("row", BODY_ROWS, ids=_ids)
def test_12_signed_out_a_malformed_body_is_401_the_member_is_known_before_the_body(row, app, client, world):
    signed_out(app)
    before = snapshot()
    method, url = BUILDERS[row](world, "A")
    r = _call(client, method, url, **MALFORMED)
    assert r.status_code == 401, (row, r.status_code, r.text)
    assert snapshot() == before


@pytest.mark.parametrize("row", BODY_ROWS, ids=_ids)
def test_12_signed_in_a_malformed_body_is_422_with_the_routes_own_sentence(row, app, client, world):
    """The expiry doors answer anything that is not a JSON object with the ONE expiry
    sentence -- never FastAPI's error list -- and write nothing. Refresh reads no body at
    all, so the bytes it was sent change nothing about its answer."""
    as_member(app, A)
    method, url = BUILDERS[row](world, "A")
    if PROOF_MATRIX[row]["body"] == "expiry":
        for raw in (b"{", b"[1, 2]", b'"text"', b"7"):
            before = snapshot()
            r = _call(client, method, url, content=raw, headers={"Content-Type": "application/json"})
            assert r.status_code == 422, (row, raw, r.status_code, r.text)
            assert r.json() == {"detail": "Choose when the link stops working: never, or after 7, 30 or 90 days."}, (row, raw)
            assert snapshot() == before, (row, raw)
        # CONTROL: the same door with no body, and with JSON null, is the "never" expiry.
        for kw in ({}, {"content": b"null", "headers": {"Content-Type": "application/json"}}):
            ok = _call(client, method, url, **kw)
            assert ok.status_code == 200, (row, kw, ok.text)
    else:
        r = _call(client, method, url, **MALFORMED)
        assert r.status_code == 200, (row, r.status_code, r.text)


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


def test_10_a_lapsed_member_can_still_see_and_take_down_their_pages(app, client, world):
    as_member(app, A, FREE)
    assert {p["slug"] for p in client.get("/api/j2/publish").json()["publications"]} == {
        world["A_pub"], world["A_folder_pub"]}
    assert client.delete(f"/api/j2/publish/{world['A_folder_pub']}").json() == {"revoked": True}
    signed_out(app)
    assert client.get(f"/api/j2/published/{world['A_folder_pub']}").status_code == 404


# ── 11. a public read writes nothing (F-READ-WRITES) ────────────────────────────────────

def test_11_a_public_read_writes_nothing(app, client, world, att_root):
    """`notes.get_note` backfills first_image_url on first read; a public GET must not reach
    it. The fixture makes that backfill due (an image in the body, the column NULL) on every
    note a public door reads, then asserts every row is byte-identical after the reads."""
    img = {"type": "doc", "content": [{"type": "image", "attrs": {
        "src": "/api/j2/notes/attachments/x/y/inline/pic.png"}}]}
    _run("UPDATE j2_notes SET body_json = ?, first_image_url = NULL WHERE user_id = ?", (json.dumps(img), A))
    signed_out(app)
    before = snapshot()
    for url in (f"/api/j2/shared/{world['A_token']}",
                f"/api/j2/published/{world['A_pub']}",
                f"/api/j2/published/{world['A_folder_pub']}",
                f"/api/j2/published/{world['A_folder_pub']}/n/{world['A_pid']}"):
        assert client.get(url).status_code == 200, url
    assert snapshot() == before, "a public read wrote a row"
    # CONTROL: the owner's own read (notes.get_note) DOES write that column, so the equality
    # above is not a snapshot that cannot see the write.
    from api.services.journal_two import notes
    notes.get_note(A, world["A_note"])
    assert snapshot() != before, "the snapshot cannot see a first_image_url backfill"
