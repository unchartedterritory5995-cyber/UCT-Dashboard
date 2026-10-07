"""Wave 12, lane 12A -- the community template gallery
(`api/services/journal_two/template_gallery.py`, `api/routers/notebook_template_gallery.py`).

What each section proves:
  * THE GATE: every route answers the one 404 while `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` is
    off, signed out or not -- the gate runs before the session is read.
  * WHAT LEAVES: a fixture that CAN tell the right reducer from a wrong one -- private and
    public things side by side, so "drop everything" fails as surely as "drop nothing".
  * REVIEW BEFORE PUBLISHING: a submission is pending and invisible until approved; an edit
    sends it back; a rejection carries its reason to the author.
  * USE IS A COPY; REPORT + HIDE; HIDE IS NEVER A DELETE; UNPUBLISH; RATE LIMITS (in-process
    AND durable); PLAN; FIRM PICKS; the client's category/reason lists pinned to the server's.
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

ROOT = Path(__file__).resolve().parents[1]
CLIENT_LIB = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "templateGallery.js"
FLAG = "NOTEBOOK_TEMPLATE_GALLERY_ENABLED"

A, B, C, ADMIN = "user-gal-author-a", "user-gal-member-b", "user-gal-member-c", "user-gal-admin"
SECRET_NOTE = "note-SECRET-ID-777"
PRIVATE_WORDS = "XYZZY private thought"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email, name in ((A, "a@example.com", "Alice Trader"), (B, "b@example.com", "bob@example.com"),
                             (C, "c@example.com", ""), (ADMIN, "admin@example.com", "Admin")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, email, "x", name, "admin" if uid == ADMIN else "member"))
    conn.commit()
    conn.close()
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
def gate_on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def svc(db_path):
    from api.services.journal_two import template_gallery
    return template_gallery


@pytest.fixture
def app(db_path):
    from api.routers import notebook_template_gallery
    fa = FastAPI()
    fa.include_router(notebook_template_gallery.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID, role: str = "member") -> None:
    user = {"id": user_id, "role": role, **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def signed_out(app) -> None:
    app.dependency_overrides.pop(authmw.get_current_user, None)
    app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)


def _conn() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    return get_connection()


def t(s: str, *marks: dict) -> dict:
    n = {"type": "text", "text": s}
    if marks:
        n["marks"] = list(marks)
    return n


def p(*inline: dict) -> dict:
    return {"type": "paragraph", "content": list(inline)}


def _distinguishing_body(owner: str) -> dict:
    """Private things beside public ones, so a reducer that drops everything fails as surely
    as one that drops nothing."""
    own_att = f"/api/j2/notes/attachments/{owner}/note-src-1/inline/pic.png"
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [t("Entry checklist")]},          # kept
        p(t("Read the "), t("public guide", {"type": "link", "attrs": {"href": "https://example.com/guide"}})),  # kept
        p(t("see "), {"type": "noteLink", "attrs": {"noteId": SECRET_NOTE}}),                    # -> "linked note"
        p(t("my thesis", {"type": "link", "attrs": {"href": f"/journal/notebook?note={SECRET_NOTE}"}})),  # link goes
        p(t(f"Pasted https://uctintelligence.com/journal/notebook?note={SECRET_NOTE} here")),   # scrubbed
        p(t(f"and http://127.0.0.1:8580/journal/notebook?note={SECRET_NOTE} too")),            # any host
        p(t("Mail trader@example.com or "), t("me", {"type": "link", "attrs": {"href": "mailto:trader@example.com"}})),
        {"type": "image", "attrs": {"src": own_att, "alt": "my chart"}},                        # private image
        {"type": "image", "attrs": {"src": "https://example.com/chart.png", "alt": "web"}},     # any image goes
        {"type": "attachmentChip", "attrs": {"href": own_att, "name": "report.pdf"}},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [p(t("Size the position"))]}]},
        {"type": "askInsert", "attrs": {"question": "what did I write about NVDA?"},
         "content": [p(t(f"From your notes: {PRIVATE_WORDS}"))]},
        {"type": "widgetEmbed", "attrs": {"widgetId": "fundamentals", "fallback": {"url": own_att}}},
    ]}


def _member_template(owner: str, name: str = "My checklist", body: dict | None = None,
                     with_properties: bool = True) -> str:
    """A row in the owner's own j2_note_templates, with property VALUES on it."""
    import uuid
    from api.services.journal_two import note_properties as np
    props = {}
    if with_properties:
        setup = np.create_property_def(owner, "Setup", "select",
                                       [{"label": "Breakout", "color": "green"}, {"label": "Pullback"}])
        private = np.create_property_def(owner, "Private notes", "text")
        rel = np.create_property_def(owner, "Related", "relation")
        props = {"builtin:thesis_status": "active", setup["id"]: setup["options"][0]["id"],
                 private["id"]: PRIVATE_WORDS, rel["id"]: [SECRET_NOTE]}
    tid = uuid.uuid4().hex
    conn = _conn()
    conn.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
                 " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                 (tid, owner, name, name, json.dumps(body or _distinguishing_body(owner)),
                  json.dumps(props) if props else None, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"))
    conn.commit()
    conn.close()
    return tid


def _publish(svc, owner=A, tid=None, **kw):
    tid = tid or _member_template(owner)
    return svc.publish(owner, tid, title=kw.get("title", "Breakout checklist"),
                       description=kw.get("description", "What I check before a breakout."),
                       category=kw.get("category", "trade_plan"))


def _approve(svc, gid):
    """Approve the version that is there now: an approval names the version reviewed
    (security review I-6, tests/test_notebook_fin_sec_gallery_approve.py)."""
    seen = svc.get_item(ADMIN, gid, is_admin=True)
    return svc.admin_act(ADMIN, gid, "approve", reviewed_updated_at=seen["updatedAt"])


def _listed(svc, viewer=B, **kw):
    return [x["id"] for x in svc.list_gallery(viewer, **kw)]


# ── the gate ────────────────────────────────────────────────────────────────────────────

ROUTES = [
    ("GET", "/api/j2/template-gallery"),
    ("GET", "/api/j2/template-gallery/gid"),
    ("POST", "/api/j2/template-gallery"),
    ("DELETE", "/api/j2/template-gallery/gid"),
    ("POST", "/api/j2/template-gallery/gid/use"),
    ("POST", "/api/j2/template-gallery/gid/report"),
    ("GET", "/api/j2/template-gallery/admin/queue"),
    ("PATCH", "/api/j2/template-gallery/admin/items/gid"),
    ("PATCH", "/api/j2/template-gallery/admin/reports/rid"),
]


@pytest.mark.parametrize("method,path", ROUTES)
def test_every_route_is_the_one_404_while_the_flag_is_off_even_signed_out(app, client, monkeypatch, method, path):
    monkeypatch.delenv(FLAG, raising=False)
    signed_out(app)
    r = client.request(method, path, content=b"{not json")
    assert r.status_code == 404, (method, path, r.status_code, r.text)
    assert r.json() == {"detail": "Not found"}


def test_CONTROL_with_the_flag_on_a_signed_out_caller_reaches_the_session_check(app, client, gate_on):
    signed_out(app)
    assert client.get("/api/j2/template-gallery").status_code == 401


def test_the_flag_parse_is_the_one_notebook_parse(monkeypatch, svc):
    for v, want in (("1", True), ("true", True), (" ON ", True), ("0", False), ("flase", False)):
        monkeypatch.setenv(FLAG, v)
        assert svc.enabled() is want, v
    monkeypatch.delenv(FLAG, raising=False)
    assert svc.enabled() is False


# ── what leaves the author's account ────────────────────────────────────────────────────

def _published_bytes(gid: str) -> str:
    conn = _conn()
    row = conn.execute("SELECT * FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()
    conn.close()
    return json.dumps(dict(row))


def test_the_gallery_copy_drops_what_is_private_and_keeps_what_is_not(svc):
    gid = _publish(svc)["id"]
    stored = _published_bytes(gid)
    # gone: the author's other notes, their files, every image, Ask output, property VALUES,
    # emails, the author's id
    for secret in (SECRET_NOTE, "/api/j2/notes/attachments", "chart.png", "report.pdf", PRIVATE_WORDS,
                   "trader@example.com", "mailto:", "active", "what did I write"):
        assert secret not in stored, secret
    assert A not in json.dumps(json.loads(stored)["body_json"])
    # kept: the scaffold itself, an external link, the linked words
    body = json.loads(json.loads(stored)["body_json"])
    flat = json.dumps(body)
    for kept in ("Entry checklist", "https://example.com/guide", "public guide", "my thesis",
                 "Size the position", "linked note", "in-app link", "email address"):
        assert kept in flat, kept
    tasks = [n for n in body["content"] if n["type"] == "taskList"][0]["content"]
    assert all(item["attrs"]["checked"] is False for item in tasks)
    assert not any(n["type"] in ("image", "attachmentChip", "askInsert", "widgetEmbed") for n in body["content"])


def test_property_DEFINITIONS_travel_and_no_value_does(svc):
    gid = _publish(svc)["id"]
    defs = svc.get_item(A, gid)["propertyDefs"]
    by_name = {d["name"]: d for d in defs}
    assert set(by_name) == {"Thesis Status", "Setup", "Private notes", "Related"}
    assert by_name["Thesis Status"] == {"builtinId": "builtin:thesis_status", "name": "Thesis Status", "type": "select"}
    assert [o["label"] for o in by_name["Setup"]["options"]] == ["Breakout", "Pullback"]
    assert "id" not in by_name["Setup"]["options"][0]             # fresh ids are the copier's
    assert by_name["Related"] == {"name": "Related", "type": "relation"}
    assert "value" not in json.dumps(defs)


def test_the_body_goes_through_the_one_reducer_in_gallery_mode(svc, monkeypatch):
    from api.services.journal_two import public_note_payload as pnp
    seen = []
    real = pnp.reduce

    def spy(body, **kw):
        seen.append(kw["mode"])
        return real(body, **kw)

    monkeypatch.setattr(pnp, "reduce", spy)
    _publish(svc)
    assert seen == ["gallery"]


def test_the_title_and_description_get_the_same_text_scrub(svc):
    item = _publish(svc, title="Ping me at x@y.com", description="see /journal/notebook?note=abc please")
    assert item["title"] == "Ping me at email address"
    assert "note=abc" not in item["description"] and "in-app link" in item["description"]


def test_the_author_is_a_display_name_never_an_email_or_id(svc):
    a = _publish(svc, owner=A)
    b = _publish(svc, owner=B)                   # B's display name is an email address
    c = _publish(svc, owner=C)                   # C has none
    for gid in (a["id"], b["id"], c["id"]):
        _approve(svc, gid)
    rows = {x["id"]: x for x in svc.list_gallery(ADMIN)}
    assert rows[a["id"]]["author"] == "Alice Trader"
    assert rows[b["id"]]["author"] == svc.ANONYMOUS_AUTHOR
    assert rows[c["id"]]["author"] == svc.ANONYMOUS_AUTHOR
    payload = json.dumps(svc.list_gallery(B)) + json.dumps(svc.get_item(B, a["id"]))
    for leak in (A, B, C, "a@example.com", "b@example.com"):
        assert leak not in payload, leak


def test_an_oversized_or_foreign_template_is_refused(svc, monkeypatch):
    other = _member_template(B)
    assert svc.publish(A, other, title="x", description="", category="journal") is None  # not A's
    monkeypatch.setattr(svc, "MAX_BODY_BYTES", 50)
    with pytest.raises(svc.GalleryError):
        _publish(svc)
    with pytest.raises(svc.GalleryError):
        svc.publish(A, _member_template(A), title="  ", description="", category="journal")
    with pytest.raises(svc.GalleryError):
        svc.publish(A, _member_template(A), title="ok", description="", category="memes")


# ── reviewed before publishing ──────────────────────────────────────────────────────────

def test_a_submission_is_pending_and_invisible_until_an_admin_approves_it(svc):
    item = _publish(svc)
    gid = item["id"]
    assert item["status"] == "pending"
    assert gid not in _listed(svc, B)
    assert svc.get_item(B, gid) is None                       # a pending one reads as missing
    assert gid in _listed(svc, A, section="mine")              # its author sees it
    assert [x["id"] for x in svc.admin_queue()["pending"]] == [gid]
    _approve(svc, gid)
    assert gid in _listed(svc, B)
    assert svc.get_item(B, gid)["bodyJson"]["type"] == "doc"
    assert svc.admin_queue()["pending"] == []


def test_a_rejection_needs_a_reason_and_the_author_reads_it(svc):
    gid = _publish(svc)["id"]
    with pytest.raises(svc.GalleryError):
        svc.admin_act(ADMIN, gid, "reject", note="")
    svc.admin_act(ADMIN, gid, "reject", note="Too thin -- add your exit rules.")
    mine = svc.list_gallery(A, section="mine")[0]
    assert mine["status"] == "rejected" and mine["reviewNote"] == "Too thin -- add your exit rules."
    assert gid not in _listed(svc, B)


def test_publishing_again_sends_an_approved_template_back_to_review(svc):
    tid = _member_template(A)
    gid = _publish(svc, tid=tid)["id"]
    _approve(svc, gid)
    svc.admin_act(ADMIN, gid, "feature")
    again = _publish(svc, tid=tid, title="Breakout checklist v2")
    assert again["id"] == gid                                   # the same copy, not a second one
    assert again["status"] == "pending" and again["featured"] is False
    assert gid not in _listed(svc, B)
    conn = _conn()
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE user_id = ?", (A,)).fetchone()[0] == 1
    conn.close()


# ── use is a copy ───────────────────────────────────────────────────────────────────────

def test_use_template_copies_into_your_templates_and_later_edits_never_reach_it(svc):
    from api.services.journal_two import note_templates as nt
    tid = _member_template(A)
    gid = _publish(svc, tid=tid)["id"]
    _approve(svc, gid)
    out = svc.use_template(B, gid)
    copy_id = out["template"]["id"]
    copy = nt.get_template(B, copy_id)
    assert copy["name"] == "Breakout checklist"
    assert copy["bodyJson"] == svc.get_item(B, gid)["bodyJson"]
    assert copy["properties"] == {}                                 # definitions, never values
    assert out["properties"]["added"] == ["Setup", "Private notes", "Related"]
    assert out["properties"]["existing"] == ["Thesis Status"]
    # the author edits and resubmits -- B's copy does not move
    conn = _conn()
    conn.execute("UPDATE j2_note_templates SET body_json = ? WHERE id = ?",
                 (json.dumps({"type": "doc", "content": [p(t("totally new"))]}), tid))
    conn.commit()
    conn.close()
    _publish(svc, tid=tid)
    _approve(svc, gid)
    assert "totally new" in json.dumps(svc.get_item(B, gid)["bodyJson"])
    assert "totally new" not in json.dumps(nt.get_template(B, copy_id)["bodyJson"])
    # and an unpublish leaves it too
    svc.unpublish(A, gid)
    assert nt.get_template(B, copy_id) is not None


def test_use_reuses_a_same_named_property_and_skips_a_clash(svc):
    from api.services.journal_two import note_properties as np
    np.create_property_def(B, "setup", "select", [{"label": "Mine"}])      # same name, same type
    np.create_property_def(B, "Private notes", "number")                    # same name, other type
    gid = _publish(svc)["id"]
    _approve(svc, gid)
    out = svc.use_template(B, gid)["properties"]
    assert "Setup" in out["existing"] and "Private notes" in out["skipped"]
    names = [d["name"].lower() for d in np.list_property_defs(B)]
    assert names.count("setup") == 1 and names.count("private notes") == 1


def test_most_used_counts_distinct_members_and_sorts_by_it(svc):
    g1 = _publish(svc, owner=A, title="One")["id"]
    g2 = _publish(svc, owner=C, title="Two")["id"]
    for g in (g1, g2):
        _approve(svc, g)
    svc.use_template(B, g1)
    svc.use_template(B, g1)                                     # same member twice = one use
    svc.use_template(B, g2)
    svc.use_template(A, g2)
    rows = {x["id"]: x for x in svc.list_gallery(B)}
    assert rows[g1]["usedBy"] == 1 and rows[g2]["usedBy"] == 2
    order = [x for x in _listed(svc, B, sort="most_used") if x in (g1, g2)]
    assert order == [g2, g1]


def test_a_pending_or_hidden_template_cannot_be_used(svc):
    gid = _publish(svc)["id"]
    assert svc.use_template(B, gid) is None
    _approve(svc, gid)
    svc.admin_act(ADMIN, gid, "hide")
    assert svc.use_template(B, gid) is None


# ── report, hide, unhide ────────────────────────────────────────────────────────────────

def test_report_then_admin_hide_is_a_visibility_state_never_a_delete(svc):
    gid = _publish(svc)["id"]
    assert svc.report(B, gid, reason="spam") is None               # not listed yet: nothing to report
    _approve(svc, gid)
    assert svc.report(B, gid, reason="personal_info", note="has a phone number") == {"reported": True, "already": False}
    assert svc.report(B, gid, reason="spam") == {"reported": True, "already": True}
    with pytest.raises(svc.GalleryError):
        svc.report(A, gid, reason="spam")                          # never your own
    q = svc.admin_queue()
    assert [x["id"] for x in q["reported"]] == [gid]
    rep = q["reported"][0]["reports"][0]
    assert rep["reason"] == "personal_info" and B not in json.dumps(q)   # the reporter stays unnamed
    before = _published_bytes(gid)
    assert svc.admin_report_act(ADMIN, rep["id"], "hide") is True
    after = json.loads(_published_bytes(gid))
    assert after["hidden"] == 1
    assert after["body_json"] == json.loads(before)["body_json"]   # the content is untouched
    assert gid not in _listed(svc, B) and svc.get_item(B, gid) is None
    mine = svc.list_gallery(A, section="mine")[0]
    assert mine["hidden"] is True                                  # the author is told
    assert svc.admin_queue()["reported"] == []
    assert [x["id"] for x in svc.admin_queue()["hidden"]] == [gid]
    svc.admin_act(ADMIN, gid, "unhide")
    assert gid in _listed(svc, B)


def test_dismiss_closes_one_report_and_leaves_the_template_listed(svc):
    gid = _publish(svc)["id"]
    _approve(svc, gid)
    svc.report(B, gid, reason="broken")
    rid = svc.admin_queue()["reported"][0]["reports"][0]["id"]
    assert svc.admin_report_act(ADMIN, rid, "dismiss") is True
    assert svc.admin_report_act(ADMIN, rid, "dismiss") is False    # no longer open
    assert gid in _listed(svc, B)


def test_no_moderation_path_issues_a_DELETE(svc, monkeypatch):
    """The kill-switch rule, read off the code: the admin doors never DELETE."""
    import inspect
    for fn in (svc.admin_act, svc.admin_report_act, svc.admin_queue):
        assert "DELETE" not in inspect.getsource(fn), fn.__name__


# ── unpublish ───────────────────────────────────────────────────────────────────────────

def test_unpublish_is_the_authors_own_and_always_possible(svc):
    gid = _publish(svc)["id"]
    assert svc.unpublish(B, gid) is False                          # not B's
    _approve(svc, gid)
    svc.report(B, gid, reason="spam")
    svc.admin_act(ADMIN, gid, "hide")
    assert svc.unpublish(A, gid) is True                           # even while hidden
    assert svc.list_gallery(A, section="mine") == []
    conn = _conn()
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_reports WHERE gallery_id = ?",
                        (gid,)).fetchone()[0] == 0
    firm = conn.execute("SELECT id FROM j2_template_gallery WHERE kind = 'firm' LIMIT 1").fetchone()["id"]
    conn.close()
    assert svc.unpublish(ADMIN, firm) is False


# ── firm picks ──────────────────────────────────────────────────────────────────────────

def test_the_firm_picks_are_seeded_once_and_an_admin_choice_survives_a_reboot(svc):
    picks = svc.list_gallery(B, section="picks")
    seeds = svc.load_seed()
    assert 4 <= len(seeds) <= 6
    assert sorted(x["title"] for x in picks) == sorted(s["title"] for s in seeds)
    assert all(x["firm"] and x["author"] == "UCT" for x in picks)
    target = picks[0]["id"]
    svc.admin_act(ADMIN, target, "unfeature")
    conn = _conn()
    svc.ensure_gallery_schema(conn)                                # a reboot
    n = conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE kind = 'firm'").fetchone()[0]
    conn.close()
    assert n == len(seeds)
    assert target not in _listed(svc, B, section="picks")          # not re-featured
    assert target in _listed(svc, B)                               # still listed


def test_every_seed_body_is_already_gallery_safe(svc):
    for s in svc.load_seed():
        assert svc.sanitize_body(s["bodyJson"], "") == s["bodyJson"], s["seedKey"]
        assert s["category"] in svc.CATEGORIES


def test_an_admin_features_a_member_template_into_the_picks(svc):
    gid = _publish(svc)["id"]
    with pytest.raises(svc.GalleryConflict):
        svc.admin_act(ADMIN, gid, "feature")                       # not approved yet
    _approve(svc, gid)
    svc.admin_act(ADMIN, gid, "feature")
    assert gid in _listed(svc, B, section="picks")


# ── browse ──────────────────────────────────────────────────────────────────────────────

def test_search_and_category_filter_the_list(svc):
    g = _publish(svc, title="Gap and go plan", category="trade_plan", description="opening drive")["id"]
    h = _publish(svc, owner=C, title="Sunday review", category="review", description="weekly 100% honest")["id"]
    for x in (g, h):
        _approve(svc, x)
    assert g in _listed(svc, B, q="gap and") and h not in _listed(svc, B, q="gap and")
    assert h in _listed(svc, B, q="100%") and g not in _listed(svc, B, q="100%")   # % is literal
    assert h in _listed(svc, B, category="review") and g not in _listed(svc, B, category="review")
    with pytest.raises(svc.GalleryError):
        svc.list_gallery(B, sort="random")


# ── the routes ──────────────────────────────────────────────────────────────────────────

def test_the_route_walk_publish_approve_browse_use_report_hide(app, client, gate_on, svc):
    tid = _member_template(A)
    as_user(app, A)
    r = client.post("/api/j2/template-gallery", json={"templateId": tid, "title": "Route walk",
                                                      "description": "d", "category": "journal"})
    assert r.status_code == 200, r.text
    gid = r.json()["template"]["id"]
    as_user(app, B)
    assert client.get(f"/api/j2/template-gallery/{gid}").status_code == 404
    assert client.get("/api/j2/template-gallery/admin/queue").status_code == 403
    as_user(app, ADMIN, role="admin")
    assert client.patch(f"/api/j2/template-gallery/admin/items/{gid}", json={
        "action": "approve", "reviewedUpdatedAt": svc.get_item(ADMIN, gid, is_admin=True)["updatedAt"],
    }).status_code == 200
    as_user(app, B)
    listing = client.get("/api/j2/template-gallery", params={"q": "route"}).json()
    assert [x["id"] for x in listing["templates"]] == [gid] and listing["viewer"] == {"admin": False}
    assert client.post(f"/api/j2/template-gallery/{gid}/use").status_code == 200
    assert client.post(f"/api/j2/template-gallery/{gid}/report", json={"reason": "spam"}).json()["already"] is False
    as_user(app, ADMIN, role="admin")
    rid = client.get("/api/j2/template-gallery/admin/queue").json()["reported"][0]["reports"][0]["id"]
    assert client.patch(f"/api/j2/template-gallery/admin/reports/{rid}", json={"action": "hide"}).status_code == 200
    as_user(app, B)
    assert gid not in [x["id"] for x in client.get("/api/j2/template-gallery").json()["templates"]]
    as_user(app, A)
    assert client.delete(f"/api/j2/template-gallery/{gid}").status_code == 200


def test_publishing_needs_a_paid_plan_and_nothing_else_does(app, client, gate_on, svc):
    gid = _publish(svc)["id"]
    _approve(svc, gid)
    as_user(app, B, plan=FREE)
    r = client.post("/api/j2/template-gallery", json={"templateId": _member_template(B), "title": "x",
                                                      "category": "journal"})
    assert r.status_code == 402 and "community gallery" in r.json()["detail"]
    assert client.get("/api/j2/template-gallery").status_code == 200
    assert client.post(f"/api/j2/template-gallery/{gid}/use").status_code == 200
    assert client.post(f"/api/j2/template-gallery/{gid}/report", json={"reason": "spam"}).status_code == 200


def test_publish_is_rate_limited_in_process_per_hour(app, client, gate_on, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP", "1000")
    from api.routers import notebook_template_gallery as router_mod
    monkeypatch.setattr(router_mod, "PUBLISH_RATE", "2/hour")
    as_user(app, A)
    tids = [_member_template(A, name=f"t{i}", with_properties=False) for i in range(3)]
    codes = [client.post("/api/j2/template-gallery", json={"templateId": x, "title": "t", "category": "journal"}).status_code
             for x in tids]
    assert codes == [200, 200, 429]


def test_publish_and_report_have_a_DURABLE_daily_cap_that_outlives_the_process_limiter(app, client, gate_on, monkeypatch, svc):
    from api.limiter import limiter
    from api.services import daily_counters
    daily_counters.clear()
    monkeypatch.setenv("NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP", "2")
    monkeypatch.setenv("NOTEBOOK_GALLERY_REPORT_DAILY_CAP", "1")
    as_user(app, A)
    tids = [_member_template(A, name=f"t{i}", with_properties=False) for i in range(3)]
    codes = []
    for x in tids:
        limiter.reset()                                        # a deploy: the process limit is gone
        codes.append(client.post("/api/j2/template-gallery",
                                 json={"templateId": x, "title": "t", "category": "journal"}).status_code)
    assert codes == [200, 200, 429]
    # a refused publish gives its charge back, so a typo never costs a slot
    daily_counters.clear()
    bad = client.post("/api/j2/template-gallery", json={"templateId": tids[0], "title": "", "category": "journal"})
    assert bad.status_code == 400
    from api.services.journal_two.calendar import et_today
    assert daily_counters.value(et_today(), "notebook_gallery_publish", A) == 0
    g1, g2 = (_publish(svc, owner=C, title=f"r{i}")["id"] for i in range(2))
    for g in (g1, g2):
        _approve(svc, g)
    as_user(app, B)
    assert client.post(f"/api/j2/template-gallery/{g1}/report", json={"reason": "spam"}).status_code == 200
    limiter.reset()
    assert client.post(f"/api/j2/template-gallery/{g2}/report", json={"reason": "spam"}).status_code == 429


def test_a_malformed_body_is_answered_after_the_session_never_before(app, client, gate_on):
    signed_out(app)
    assert client.post("/api/j2/template-gallery", content=b"{bad").status_code == 401
    as_user(app, A)
    assert client.post("/api/j2/template-gallery", content=b"{bad").status_code == 422


# ── one fact, two files ─────────────────────────────────────────────────────────────────

def _client_tuple(name: str) -> tuple[str, ...]:
    text = CLIENT_LIB.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = Object\.freeze\(\[(.*?)\]\)", text, re.S)
    assert m, f"{name} not found in {CLIENT_LIB.name}"
    return tuple(re.findall(r"key:\s*'([a-z_]+)'", m.group(1)))


def test_the_client_categories_and_report_reasons_are_the_servers(svc):
    assert _client_tuple("GALLERY_CATEGORIES") == svc.CATEGORIES
    assert _client_tuple("REPORT_REASONS") == svc.REPORT_REASONS


# ── account deletion ────────────────────────────────────────────────────────────────────

def test_an_authors_account_deletion_takes_their_listings_and_leaves_the_firm_picks(svc):
    from api.services.journal_two import account_purge
    gid = _publish(svc)["id"]
    _approve(svc, gid)
    svc.use_template(B, gid)
    conn = _conn()
    report = account_purge.purge_user_data(A, conn)
    assert report["errors"] == [], report["errors"]
    left = conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE user_id = ?", (A,)).fetchone()[0]
    firm = conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE kind = 'firm'").fetchone()[0]
    b_copies = conn.execute("SELECT COUNT(*) FROM j2_note_templates WHERE user_id = ?", (B,)).fetchone()[0]
    conn.close()
    assert left == 0 and firm == len(svc.load_seed()) and b_copies == 1
