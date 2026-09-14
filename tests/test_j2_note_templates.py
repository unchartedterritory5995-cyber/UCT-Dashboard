"""Rails for Wave S / S-07(a) — user-defined Notebook templates.

Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_properties_router.py.

⛔ EVERY RAIL HERE NAMES THE MUTATION THAT REDDENS IT, in a comment on the
test. A rail whose mutation does not turn it red is not a rail. The one
actually performed and reverted this session is recorded in the session
report; the rest are stated so the next person can run them.

⛔ NON-VACUITY: `test_the_table_exists_and_the_created_row_is_really_in_it`
is the control for the whole file. Almost every assertion below is satisfied
by an empty set or a missing table (a list that is empty contains no foreign
member's template; a 404 is what you get when nothing exists at all), so that
test proves the fixture is real before the others mean anything.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

REPO_ROOT = Path(__file__).resolve().parents[1]
BUILTIN_CATALOG = REPO_ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "notebookTemplates.js"

DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hi"}]}]}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id, **extra):
    """A member with NO plan and NO subscription — the free-tier case. If any
    of these routes ever grew a paid dependency, this override would stop
    applying to it and the request would fail auth outright."""
    app.dependency_overrides[authmw.get_current_user] = lambda: {
        "id": user_id, "role": "member", **extra,
    }


def _create(client, **body):
    payload = {"label": "My template", "bodyJson": DOC}
    payload.update(body)
    return client.post("/api/j2/note-templates", json=payload)


def _created(client, **body):
    r = _create(client, **body)
    assert r.status_code == 200, r.text
    return r.json()["template"]


def _rows(db_path, sql, args=()):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


# ── The non-vacuity control ─────────────────────────────────────────────────

def test_the_table_exists_and_the_created_row_is_really_in_it(app, client, db_path):
    """THE CONTROL for this whole file. Reddened by: removing the
    j2_note_templates CREATE TABLE from db.py's _J2_SCHEMA (every other test
    would then fail loudly too, which is the point — this one says WHY)."""
    tables = {r["name"] for r in _rows(db_path, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "j2_note_templates" in tables
    # ...and the fixture actually writes into it, so no later assertion can
    # pass by iterating over an empty set.
    _login_as(app, "u1")
    t = _created(client, label="Real row")
    stored = _rows(db_path, "SELECT * FROM j2_note_templates")
    assert len(stored) == 1
    assert stored[0]["id"] == t["id"]
    assert stored[0]["label"] == "Real row"


# ── The free door (the owner ruling of 2026-09-14) ──────────────────────────

def test_all_five_routes_answer_a_member_with_no_plan(app, client):
    """FREE-GATED, asserted by what is RETURNED. A member dict with no plan,
    no subscription and role='member' drives create/list/read/update/delete
    end to end.

    Reddened by: any gate that REFUSES a free member — a dependency raising
    402 for `plan not in PAID_PLANS`, or a `if not is_paid_user(user)` branch
    in the handler. The call returns 402 instead of 200.

    ⚠️ MEASURED LIMIT, stated because a rail must not claim more than it
    proves: swapping this route to `Depends(get_current_user_with_plan)` left
    this test GREEN (2026-09-14, mutation performed and reverted) — that
    dependency nests `get_current_user`, so the override still applies and a
    member with no plan still gets 200. A gate can therefore be HALF added
    without this rail noticing. That is precisely why
    `test_no_note_template_route_declares_a_paid_dependency` exists beside it,
    and that test DID go red on the same mutation."""
    _login_as(app, "free-user")
    t = _created(client, label="Free tier")

    r = client.get("/api/j2/note-templates")
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()["templates"]] == [t["id"]]

    r = client.get(f"/api/j2/note-templates/{t['id']}")
    assert r.status_code == 200, r.text

    r = client.put(f"/api/j2/note-templates/{t['id']}", json={"label": "Still free"})
    assert r.status_code == 200, r.text
    assert r.json()["template"]["label"] == "Still free"

    r = client.delete(f"/api/j2/note-templates/{t['id']}")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}


def test_no_note_template_route_declares_a_paid_dependency(app):
    """The structural half of the ruling: read the mounted routes and check
    what they actually depend on, so a paid gate cannot be added quietly.

    Reddened by: adding a `require_paid`/`is_paid_user`/plan dependency to any
    /note-templates route. Non-vacuity: the route set must be non-empty and
    must contain the five this row shipped, or the loop below proves nothing
    by iterating zero times."""
    routes = [r for r in app.routes if getattr(r, "path", "").startswith("/api/j2/note-templates")]
    methods = sorted({m for r in routes for m in r.methods if m != "HEAD"})
    assert methods == ["DELETE", "GET", "POST", "PUT"], methods
    assert len(routes) == 5, [(r.path, sorted(r.methods)) for r in routes]

    for r in routes:
        names = {d.call.__name__ for d in r.dependant.dependencies if d.call is not None}
        assert "get_current_user" in names, (r.path, names)
        forbidden = {n for n in names if "paid" in n or "plan" in n or "admin" in n}
        assert not forbidden, (r.path, forbidden)


# ── Identity: the key namespace ─────────────────────────────────────────────

def test_the_key_is_server_minted_in_the_u_namespace(app, client):
    """Reddened by: minting a key from the label, or shortening/renaming the
    prefix so a member key stops being distinguishable from a built-in."""
    _login_as(app, "u1")
    t = _created(client)
    assert re.fullmatch(r"u_[0-9a-f]{12}", t["key"]), t["key"]


def test_a_client_supplied_key_is_ignored(app, client):
    """A member must not be able to shadow 'daily-prep'.

    Reddened by: reading `key` off the request body in
    create_note_template_endpoint."""
    _login_as(app, "u1")
    t = _created(client, key="daily-prep")
    assert t["key"] != "daily-prep"
    assert re.fullmatch(r"u_[0-9a-f]{12}", t["key"]), t["key"]


def test_no_builtin_template_key_lives_in_the_user_namespace(app, client):
    """Derived from the catalog file itself, never a typed list — so a
    built-in added tomorrow is covered the day it lands.

    Reddened by: adding a built-in whose key starts with 'u_'. Non-vacuity:
    the derivation must find more than one key and must include a key the
    catalog is known to hold ('daily-prep'), or an empty regex match would
    pass this by checking nothing."""
    src = BUILTIN_CATALOG.read_text(encoding="utf-8")
    builtin_keys = re.findall(r"^    key: '([^']+)',$", src, flags=re.MULTILINE)
    assert len(builtin_keys) > 1, builtin_keys
    assert "daily-prep" in builtin_keys

    for k in builtin_keys:
        assert not k.startswith("u_"), k

    # ...and the minted namespace really is disjoint from that set.
    _login_as(app, "u1")
    assert _created(client)["key"] not in set(builtin_keys)


def test_the_key_survives_an_update(app, client):
    """The key is the deep-link identity (/journal/notebook?new=<key>);
    re-minting it on an edit would silently break every bookmark.

    Reddened by: assigning a fresh key in update_note_template."""
    _login_as(app, "u1")
    t = _created(client, label="Before")
    r = client.put(f"/api/j2/note-templates/{t['id']}", json={"label": "After"})
    assert r.status_code == 200, r.text
    assert r.json()["template"]["label"] == "After"
    assert r.json()["template"]["key"] == t["key"]


# ── The round trip ──────────────────────────────────────────────────────────

def test_create_returns_every_field_the_picker_contract_needs(app, client):
    """Reddened by: dropping any of these from _row_to_dict — the picker
    renders tpl.when/.label/.description (TemplatePicker.jsx:28-39) and
    noteCreation.js reads .tags/.bodyJson, so a missing one renders
    'undefined' or creates an empty note."""
    _login_as(app, "u1")
    t = _created(
        client,
        label="Earnings prep",
        description="What I check the night before a print.",
        when="Night before earnings",
        tags=["earnings", "prep"],
        titleText="Earnings — {ticker}",
    )
    assert t["label"] == "Earnings prep"
    assert t["description"] == "What I check the night before a print."
    assert t["when"] == "Night before earnings"
    assert t["family"] == "mine"
    assert t["tags"] == ["earnings", "prep"]
    assert t["titleText"] == "Earnings — {ticker}"
    assert t["bodyJson"] == DOC
    assert t["createdAt"] and t["updatedAt"]


def test_list_is_ordered_and_a_deleted_template_leaves_it(app, client):
    """Reddened by: dropping `deleted_at IS NULL` from list_note_templates —
    a deleted template would keep appearing in the picker."""
    _login_as(app, "u1")
    a = _created(client, label="First")
    b = _created(client, label="Second")
    ids = [x["id"] for x in client.get("/api/j2/note-templates").json()["templates"]]
    assert ids == [a["id"], b["id"]]

    assert client.delete(f"/api/j2/note-templates/{a['id']}").status_code == 200
    ids = [x["id"] for x in client.get("/api/j2/note-templates").json()["templates"]]
    assert ids == [b["id"]]
    assert client.get(f"/api/j2/note-templates/{a['id']}").status_code == 404
    # ...and deleting it twice is a 404, not a second success.
    assert client.delete(f"/api/j2/note-templates/{a['id']}").status_code == 404


def test_the_delete_is_soft_so_an_operator_can_recover_it(app, client, db_path):
    """Reddened by: turning delete_note_template into a DELETE FROM."""
    _login_as(app, "u1")
    t = _created(client, label="Oops")
    client.delete(f"/api/j2/note-templates/{t['id']}")
    rows = _rows(db_path, "SELECT deleted_at, label FROM j2_note_templates WHERE id = ?", (t["id"],))
    assert len(rows) == 1
    assert rows[0]["deleted_at"]
    assert rows[0]["label"] == "Oops"


# ── Tenancy ─────────────────────────────────────────────────────────────────

def test_another_members_template_is_indistinguishable_from_a_missing_one(app, client):
    """Reddened by: dropping `AND user_id = ?` from get/update/delete.
    Non-vacuity: the owner can still read the row afterwards, so these 404s
    are refusals rather than the row never having existed."""
    _login_as(app, "owner")
    t = _created(client, label="Mine")

    _login_as(app, "stranger")
    assert client.get(f"/api/j2/note-templates/{t['id']}").status_code == 404
    assert client.put(f"/api/j2/note-templates/{t['id']}", json={"label": "Theirs"}).status_code == 404
    assert client.delete(f"/api/j2/note-templates/{t['id']}").status_code == 404
    assert client.get("/api/j2/note-templates").json()["templates"] == []

    _login_as(app, "owner")
    r = client.get(f"/api/j2/note-templates/{t['id']}")
    assert r.status_code == 200
    assert r.json()["template"]["label"] == "Mine"


# ── The caps ────────────────────────────────────────────────────────────────

def _doc_of_bytes(target: int) -> dict:
    """A valid TipTap doc whose serialized size is at least `target` bytes."""
    filler = "x" * target
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": filler}]}]}


def test_a_body_over_the_cap_is_refused_and_one_under_it_is_not(app, client):
    """Reddened by: deleting the MAX_TEMPLATE_BODY_BYTES check.
    Non-vacuity: the under-cap case must still succeed, or a store that
    refuses everything passes this."""
    from api.services.journal_two import note_templates
    _login_as(app, "u1")

    over = _doc_of_bytes(note_templates.MAX_TEMPLATE_BODY_BYTES + 1)
    assert len(json.dumps(over).encode()) > note_templates.MAX_TEMPLATE_BODY_BYTES
    r = _create(client, bodyJson=over)
    assert r.status_code == 400, r.text
    assert "too large" in r.json()["detail"]

    under = _doc_of_bytes(note_templates.MAX_TEMPLATE_BODY_BYTES - 1000)
    assert _create(client, bodyJson=under).status_code == 200


def test_the_per_user_count_cap_fires_at_the_limit_not_before(app, client):
    """Reddened by: deleting the MAX_TEMPLATES_PER_USER check.
    Non-vacuity: the Nth create must succeed and only the N+1th fail, so a
    store that refuses everything cannot pass."""
    from api.services.journal_two import note_templates
    _login_as(app, "u1")
    for i in range(note_templates.MAX_TEMPLATES_PER_USER):
        assert _create(client, label=f"T{i}").status_code == 200, i
    r = _create(client, label="one too many")
    assert r.status_code == 400, r.text
    assert "limit" in r.json()["detail"]


def test_deleting_a_template_frees_a_slot(app, client):
    """The cap counts LIVE rows. Reddened by: counting tombstones too — a
    member who deleted 50 templates would be locked out permanently."""
    from api.services.journal_two import note_templates
    _login_as(app, "u1")
    made = [_created(client, label=f"T{i}") for i in range(note_templates.MAX_TEMPLATES_PER_USER)]
    assert _create(client, label="blocked").status_code == 400
    assert client.delete(f"/api/j2/note-templates/{made[0]['id']}").status_code == 200
    assert _create(client, label="now allowed").status_code == 200


# ── Field validation ────────────────────────────────────────────────────────

def test_a_blank_label_is_refused(app, client):
    """Reddened by: dropping the empty check — the picker would render a card
    with no name."""
    _login_as(app, "u1")
    assert _create(client, label="   ").status_code == 400
    assert _create(client, label=None).status_code == 400


def test_a_label_over_sixty_chars_is_refused_and_sixty_is_not(app, client):
    """60 matches watchlistTemplates.js:50's `.slice(0, 60)`. This side
    REFUSES rather than truncating — a server that silently rewrites the label
    a member typed is worse than a 400 that says why.
    Reddened by: removing the cap, or switching it to a silent truncation
    (the 61-char case would then return 200)."""
    from api.services.journal_two import note_templates
    _login_as(app, "u1")
    cap = note_templates.MAX_TEMPLATE_LABEL_CHARS
    assert _create(client, label="a" * (cap + 1)).status_code == 400
    assert _create(client, label="a" * cap).status_code == 200


def test_a_body_that_is_not_a_tiptap_doc_is_refused(app, client):
    """Goes through the same door a NOTE body does
    (notes._validate_body_json), so a template can never store a body the
    editor would refuse to open.
    Reddened by: skipping the validator and json.dumps-ing whatever arrived."""
    _login_as(app, "u1")
    assert _create(client, bodyJson={"type": "paragraph"}).status_code == 400
    assert _create(client, bodyJson="not json at all").status_code == 400
    assert _create(client, bodyJson=None).status_code == 400


def test_a_user_template_cannot_join_a_builtin_family(app, client):
    """N-5: exactly one family is added, 'mine'. A member template filed under
    'rituals' would sit in the picker beside the firm's Daily Game Plan.
    Reddened by: storing body.get('family') unvalidated."""
    _login_as(app, "u1")
    r = _create(client, family="rituals")
    assert r.status_code == 400, r.text
    assert _created(client, family="mine")["family"] == "mine"


def test_an_update_can_clear_a_field_but_omitting_it_leaves_it_alone(app, client):
    """Partial update: None means 'not supplied', '' means 'clear it'.
    Reddened by: treating a missing key as a clear (an edit of the label would
    wipe the description)."""
    _login_as(app, "u1")
    t = _created(client, description="original", when="Fridays", tags=["a"])
    after = client.put(f"/api/j2/note-templates/{t['id']}", json={"label": "New"}).json()["template"]
    assert after["description"] == "original"
    assert after["when"] == "Fridays"
    assert after["tags"] == ["a"]
    cleared = client.put(f"/api/j2/note-templates/{t['id']}", json={"description": ""}).json()["template"]
    assert cleared["description"] == ""
    assert cleared["label"] == "New"


# ── Delete safety (spec §2.5 / non-goal N-10) ───────────────────────────────

def test_deleting_a_template_does_not_touch_a_note_made_from_it(app, client):
    """The requirement S-07 asks for, proved end to end: a note created from a
    template body is byte-identical after the template is deleted.
    Reddened by: adding a template_id FK with ON DELETE CASCADE, or having
    delete_note_template touch j2_notes at all."""
    _login_as(app, "u1")
    t = _created(client, label="Prep", bodyJson=DOC)
    note = client.post("/api/j2/notes", json={"title": "From template", "bodyJson": t["bodyJson"]})
    assert note.status_code == 200, note.text
    note_id = note.json()["note"]["id"]
    before = json.dumps(client.get(f"/api/j2/notes/{note_id}").json()["note"]["bodyJson"], sort_keys=True)

    assert client.delete(f"/api/j2/note-templates/{t['id']}").status_code == 200

    r = client.get(f"/api/j2/notes/{note_id}")
    assert r.status_code == 200, r.text
    after = json.dumps(r.json()["note"]["bodyJson"], sort_keys=True)
    assert after == before


def test_j2_notes_has_no_column_pointing_back_at_a_template(app, client, db_path):
    """N-10, structurally. The template body is COPIED at note creation and
    nothing points back — that is WHY delete-safety above is free. A column
    here would manufacture the coupling the spec rules out.
    Reddened by: adding template_id/template_key to j2_notes.
    Non-vacuity: the pragma must return a real column list (it contains
    body_json), or an empty read would satisfy the 'absent' assertions."""
    cols = {r["name"] for r in _rows(db_path, "PRAGMA table_info(j2_notes)")}
    assert "body_json" in cols, cols
    assert len(cols) > 5, cols
    for forbidden in ("template_id", "template_key", "templateId"):
        assert forbidden not in cols, forbidden
