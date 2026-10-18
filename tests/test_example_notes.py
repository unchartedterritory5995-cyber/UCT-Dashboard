"""P3b Task 3: an author's EXAMPLE NOTE -- the preview, the publish, held revisions and the style link.

The service is `api/services/journal_two/template_gallery.py` (`preview_example`, `publish_example`,
`example_enabled`); the routes are `POST /api/j2/template-gallery/examples/preview` and
`POST /api/j2/template-gallery/examples` in `api/routers/notebook_template_gallery.py`.

⛔ A change entry's `before` is the author's own text. It is handed to the author's preview and is
never stored: test 2 searches EVERY column of the stored row for it.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

import pytest

from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _publish, _style, api, conn, lib_on  # noqa: F401  (fixtures + helpers)
from tests.test_style_library import _client_keys

URL = "/api/j2/template-gallery"
EX = f"{URL}/examples"
SENTENCE = "made $1,240 on NVDA, up 3.2R, at Schwab"
REPLACED = "made your value here on NVDA, up your value here, at your broker"


@pytest.fixture
def ex_on(monkeypatch, lib_on):
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "1")


def _as(api, user_id, role="member", plan="pro"):
    from api.middleware import auth_middleware as authmw
    user = {"id": user_id, "role": role, "plan": plan}
    api.app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _src(user, nid, name):
    return f"/api/j2/notes/attachments/{user}/{nid}/inline/{name}"


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _note(conn, user="author", *, kind="weekend_prep", text=SENTENCE, images=(), title="Weekend plan"):
    """A live note of `kind` holding one paragraph and one image per name in `images` (this note's own
    attachments). Created through the notes service; its kind and body are then set on the row."""
    from api.services.journal_two import notes
    nid = notes.create_note(user, {"title": title}, conn)["id"]
    body = {"type": "doc", "content": [_para(text)] + [
        {"type": "image", "attrs": {"src": _src(user, nid, name), "alt": "chart"}} for name in images]}
    props = json.dumps({"builtin:note_kind": kind}) if kind else None
    conn.execute("UPDATE j2_notes SET body_json = ?, properties_json = ? WHERE id = ?",
                 (json.dumps(body), props, nid))
    conn.commit()
    return nid


def _shared_style(conn, user="author", approve=False):
    s = _style(conn, user)
    item = _publish(conn, s["id"], user, title="Weekend Prep")
    if approve:
        gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    return item["id"]


def _texts(doc):
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text") or "")
            for c in n.get("content") or []:
                walk(c)
    walk(doc)
    return out


def _images(doc):
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "image":
                out.append(n["attrs"]["src"])
            for c in n.get("content") or []:
                walk(c)
    walk(doc)
    return out


def _row(conn, gid):
    return conn.execute("SELECT * FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()


# ── the OCR pipeline, stubbed in the shapes V4 records ──────────────────────────────────────

def _state(with_text, awaiting=0, unavailable=False):
    return {"exists": True, "status": "ready" if with_text else "no_text", "pages_total": 1,
            "pages_with_text": with_text, "pages_from_ocr": with_text, "pages_awaiting_ocr": awaiting,
            "ocr_unavailable": unavailable, "pages_unreadable": max(0, 1 - with_text - awaiting),
            "text_complete": with_text == 1, "ocr_jobs": {"required": awaiting} if awaiting else {}}


@pytest.fixture
def ocr(monkeypatch):
    """Four images: `read.png` has OCR text, `blank.png` was read and holds none, `slow.png` is still being
    read, and `none.png` has no document row at all."""
    from api.services.journal_two import document_extraction as dx
    from api.services.journal_two import document_ocr as docr
    docs = {"read.png": "d_read", "blank.png": "d_blank", "slow.png": "d_slow"}
    states = {"d_read": _state(1), "d_blank": _state(0), "d_slow": _state(0, awaiting=1)}
    texts = {"d_read": "Schwab statement 12345678 shows $25,000"}
    seen = []

    def by_attachment(user_id, note_id, attachment_url, *, conn=None):
        seen.append((user_id, note_id, attachment_url))
        did = docs.get(attachment_url.rsplit("/", 1)[-1])
        return {"id": did, "note_id": note_id, "attachment_url": attachment_url} if did else None

    def text_state(conn, user_id, document_id):
        return states.get(document_id, {"exists": False})

    def transcript(user_id, document_id, page_number, *, conn=None):
        text = texts.get(document_id, "")
        return {"document_id": document_id, "page_number": page_number, "name": "Image", "text_origin": "ocr",
                "text": text, "available": bool(text.strip())}

    monkeypatch.setattr(dx, "get_document_by_attachment", by_attachment)
    monkeypatch.setattr(docr, "document_text_state", text_state)
    monkeypatch.setattr(docr, "page_transcript", transcript)
    return seen


# ── 1. the preview ──────────────────────────────────────────────────────────────────────────

def test_the_preview_returns_the_reduced_body_counts_and_the_images_with_their_ocr_state(api, conn, ex_on, ocr):
    nid = _note(conn, images=("read.png", "blank.png", "slow.png", "none.png"))
    r = api.post(f"{EX}/preview", json={"noteId": nid, "imagesOn": [_src("author", nid, "read.png")]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"bodyJson", "changes", "counts", "images", "title"}
    assert out["title"] == "Weekend plan"                           # the note's own title, scrubbed (M-3)
    assert _texts(out["bodyJson"])[0] == REPLACED
    assert out["counts"] == {"money": 1, "pnl_figure": 1, "broker": 1, "image_off": 3}
    kinds = [c["kind"] for c in out["changes"]]
    assert sorted(kinds) == sorted(["money", "pnl_figure", "broker", "image_off", "image_off", "image_off"])
    befores = {c["kind"]: c["before"] for c in out["changes"] if c["kind"] != "image_off"}
    assert befores == {"money": "$1,240", "pnl_figure": "3.2R", "broker": "Schwab"}
    assert all(set(c) == {"kind", "before", "after", "path"} for c in out["changes"])
    # the switched-on image is in place, at the AUTHOR'S own address (a preview is the author's own view)
    assert _images(out["bodyJson"]) == [_src("author", nid, "read.png")]
    by_name = {i["name"]: i for i in out["images"]}
    assert [i["name"] for i in out["images"]] == ["read.png", "blank.png", "slow.png", "none.png"]
    assert all(set(i) == {"src", "name", "ocr", "warnings"} for i in out["images"])
    assert by_name["read.png"]["src"] == _src("author", nid, "read.png")
    assert (by_name["read.png"]["ocr"], by_name["blank.png"]["ocr"], by_name["slow.png"]["ocr"],
            by_name["none.png"]["ocr"]) == ("ready", "no_text", "processing", "unavailable")
    assert by_name["read.png"]["warnings"] == [
        {"kind": "broker", "match": "Schwab"}, {"kind": "digits", "match": "12345678"},
        {"kind": "money", "match": "$25,000"}]
    assert by_name["blank.png"]["warnings"] == by_name["slow.png"]["warnings"] == by_name["none.png"]["warnings"] == []
    # the OCR state is looked up by (note_id, attachment_url) through the existing document lookup (R8)
    assert ("author", nid, _src("author", nid, "slow.png")) in ocr


def test_the_preview_with_nothing_switched_on_drops_every_image_and_writes_nothing(api, conn, ex_on, ocr):
    nid = _note(conn, images=("read.png",))
    before = conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0]
    out = api.post(f"{EX}/preview", json={"noteId": nid}).json()
    assert _images(out["bodyJson"]) == []
    assert out["counts"]["image_off"] == 1
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == before


def test_the_preview_uses_the_authors_own_institution_names(api, conn, ex_on, ocr):
    conn.execute("INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,"
                 " created_at, updated_at) VALUES ('ba1', 'author', 'acct-1', 'Northwind Securities', 'a1', 'x', 'x')")
    conn.commit()
    nid = _note(conn, text="filled at Northwind Securities this morning")
    out = api.post(f"{EX}/preview", json={"noteId": nid}).json()
    assert _texts(out["bodyJson"])[0] == "filled at your broker this morning"
    assert out["counts"] == {"broker": 1}


def test_an_image_another_note_owns_is_not_offered_and_never_kept(api, conn, ex_on, ocr):
    nid = _note(conn, images=("read.png",))
    other = _src("author", "someothernote", "x.png")
    body = json.loads(conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0])
    body["content"].append({"type": "image", "attrs": {"src": other}})
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(body), nid))
    conn.commit()
    out = api.post(f"{EX}/preview", json={"noteId": nid, "imagesOn": [other]}).json()
    assert [i["name"] for i in out["images"]] == ["read.png"]
    assert other not in json.dumps(out["bodyJson"])


# ── 2. publish ──────────────────────────────────────────────────────────────────────────────

def test_publish_stores_a_pending_example_linked_to_the_style_and_no_before_text(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    nid = _note(conn, images=("read.png", "blank.png"))
    on = [_src("author", nid, "blank.png"), _src("author", nid, "read.png")]
    preview = api.post(f"{EX}/preview", json={"noteId": nid, "imagesOn": on}).json()
    befores = [c["before"] for c in preview["changes"] if c["before"]]
    assert set(befores) >= {"$1,240", "3.2R", "Schwab"}             # non-vacuity: there is text to look for
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": on, "title": "My weekend plan"})
    assert r.status_code == 200, r.text
    item = r.json()["template"]
    assert (item["itemType"], item["status"], item["mine"]) == ("example_note", "pending", True)
    row = _row(conn, item["id"])
    assert (row["item_type"], row["status"], row["user_id"], row["source_note_id"]) == (
        "example_note", "pending", "author", nid)
    payload = json.loads(row["payload_json"])
    assert set(payload) == {"bodyJson", "linkedItemId", "noteKind"}
    assert (payload["linkedItemId"], payload["noteKind"]) == (sid, "weekend_prep")
    assert json.loads(row["body_json"]) == payload["bodyJson"]
    assert _texts(payload["bodyJson"])[0] == REPLACED
    # each switched-on image gets its n on the gallery image route, in BODY order from 0
    assert _images(payload["bodyJson"]) == [f"{URL}/{item['id']}/images/0", f"{URL}/{item['id']}/images/1"]
    assert json.loads(row["preview_json"]) == gallery.preview_lines(payload["bodyJson"])
    # ⛔ nothing of `before` -- and nothing of the author's own attachment addresses -- in ANY column
    for col in row.keys():
        value = "" if row[col] is None else str(row[col])
        for b in befores:
            assert b not in value, f"{col} holds the author's original text {b!r}"
        assert "/api/j2/notes/attachments/" not in value, f"{col} holds an attachment address"


def test_publish_answers_the_author_summary_and_the_title_is_scrubbed_too(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    nid = _note(conn)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Up $5,000 at Schwab"})
    assert r.status_code == 200, r.text
    assert r.json()["template"]["title"] == "Up your value here at your broker"


def test_publish_never_trusts_a_client_body(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    nid = _note(conn)
    planted = {"type": "doc", "content": [_para("I made $9,999 at Schwab")]}
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan", "bodyJson": planted,
                           "payload": {"bodyJson": planted}, "body": planted})
    assert r.status_code == 200, r.text
    row = _row(conn, r.json()["template"]["id"])
    for col in row.keys():
        assert "9,999" not in str(row[col] or ""), f"{col} holds the client's body"
    want = api.post(f"{EX}/preview", json={"noteId": nid}).json()["bodyJson"]
    assert json.loads(row["body_json"]) == want == json.loads(row["payload_json"])["bodyJson"]


def test_a_later_note_edit_never_reaches_the_example(api, conn, ex_on, ocr):
    from api.services.journal_two import notes
    sid = _shared_style(conn)
    nid = _note(conn)
    gid = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).json()["template"]["id"]
    before = dict(_row(conn, gid))
    notes.update_note("author", nid, {"bodyJson": {"type": "doc", "content": [_para("Rewritten: NVDA 140 next week")]}},
                      conn)
    assert "Rewritten" in conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0]
    after = dict(_row(conn, gid))
    assert after == before
    assert "Rewritten" not in json.dumps(gallery.get_item("author", gid, conn=conn))


def test_publishing_again_while_pending_replaces_the_example_in_place(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    nid = _note(conn)
    first = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "One"}).json()["template"]
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?",
                 (json.dumps({"type": "doc", "content": [_para("second version")]}), nid))
    conn.commit()
    again = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Two"}).json()["template"]
    assert again["id"] == first["id"]
    rows = conn.execute("SELECT * FROM j2_template_gallery WHERE item_type = 'example_note'").fetchall()
    assert len(rows) == 1 and rows[0]["title"] == "Two" and rows[0]["status"] == "pending"
    assert _texts(json.loads(rows[0]["body_json"])) == ["second version"]
    assert rows[0]["pending_json"] is None


# ── 5. held revisions ───────────────────────────────────────────────────────────────────────

def test_publishing_again_on_an_approved_example_holds_the_new_version_and_the_listed_one_stays(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    nid = _note(conn)
    item = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Listed"}).json()["template"]
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    listed = dict(_row(conn, item["id"]))
    assert listed["status"] == "approved" and listed["listed_at"]
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?",
                 (json.dumps({"type": "doc", "content": [_para("revised plan, lost $300 on it")]}), nid))
    conn.commit()
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Revised"})
    assert r.status_code == 200, r.text
    held = dict(_row(conn, item["id"]))
    for col in ("status", "listed_at", "title", "body_json", "payload_json", "preview_json", "version"):
        assert held[col] == listed[col], f"the listed {col} moved"
    rev = json.loads(held["pending_json"])
    assert rev["title"] == "Revised"
    assert _texts(rev["payload"]["bodyJson"]) == ["revised plan, lost your value here on it"]
    assert rev["payload"]["linkedItemId"] == sid and rev["payload"]["noteKind"] == "weekend_prep"
    assert held["pending_at"]
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 1
    # approving the revision lists THE EXAMPLE'S body (not an outline's) at the next version
    queued = next(p for p in gallery.admin_queue(conn=conn)["pending"] if p["id"] == item["id"])
    assert queued["itemType"] == "example_note" and queued["revisionTitle"] == "Revised"
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=queued["updatedAt"], conn=conn)
    now = _row(conn, item["id"])
    assert _texts(json.loads(now["body_json"])) == ["revised plan, lost your value here on it"]
    assert json.loads(now["payload_json"]) == rev["payload"]
    assert (now["version"], now["pending_json"], now["title"]) == (2, None, "Revised")


def test_a_reviewer_reads_a_held_example_revision_as_an_example(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    nid = _note(conn)
    item = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Listed"}).json()["template"]
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Revised"})
    rev = gallery.get_item("admin", item["id"], is_admin=True, conn=conn)["pendingRevision"]
    assert (rev["version"], rev["title"]) == (2, "Revised")
    assert set(rev["payload"]) == {"bodyJson", "linkedItemId", "noteKind"}
    assert _texts(rev["payload"]["bodyJson"])[0] == REPLACED
    mine = gallery.get_item("author", item["id"], conn=conn)
    assert "pendingRevision" not in mine                            # the author, as any member, never receives it
    assert mine["payload"]["linkedItemId"] == sid                   # the LISTED snapshot


# ── 6. the refusals ─────────────────────────────────────────────────────────────────────────

def test_a_style_that_is_not_the_authors_is_refused(api, conn, ex_on, ocr):
    theirs = _shared_style(conn, user="other", approve=True)
    nid = _note(conn)
    r = api.post(EX, json={"noteId": nid, "styleItemId": theirs, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, "Pick one of your own shared styles.")
    for bad in (None, "", "nope", 7):
        r = api.post(EX, json={"noteId": nid, "styleItemId": bad, "title": "Plan"})
        assert (r.status_code, r.json()["detail"]) == (400, "Pick one of your own shared styles.")


def test_a_withdrawn_style_is_refused(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    assert gallery.unpublish("author", sid, conn=conn)
    nid = _note(conn)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, "Pick one of your own shared styles.")


def test_a_rejected_style_or_an_outline_is_not_one_to_link(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    gallery.admin_act("admin", sid, "reject", note="no", conn=conn)
    nid = _note(conn)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, "Pick one of your own shared styles.")


@pytest.mark.parametrize("state", ["other_member", "trashed", "archived", "missing"])
def test_a_note_that_is_not_the_authors_or_not_live_is_the_404(api, conn, ex_on, ocr, state):
    sid = _shared_style(conn)
    nid = _note(conn, user="other" if state == "other_member" else "author")
    if state == "trashed":
        conn.execute("UPDATE j2_notes SET deleted_at = '2026-10-17T00:00:00+00:00' WHERE id = ?", (nid,))
    elif state == "archived":
        conn.execute("UPDATE j2_notes SET archived_at = '2026-10-17T00:00:00+00:00' WHERE id = ?", (nid,))
    elif state == "missing":
        nid = "no-such-note"
    conn.commit()
    assert api.post(f"{EX}/preview", json={"noteId": nid}).status_code == 404
    assert api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).status_code == 404
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 0


def test_a_sample_notebook_note_is_never_an_example(api, conn, ex_on, ocr):
    """R11: a note the sample notebook wrote answers the not-live 404, on the preview and on publish."""
    from api.services.journal_two import sample_marker
    sid = _shared_style(conn)
    nid = _note(conn)
    assert api.post(f"{EX}/preview", json={"noteId": nid}).status_code == 200          # control: a real note
    conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, nid))
    conn.commit()
    r = api.post(f"{EX}/preview", json={"noteId": nid})
    assert (r.status_code, r.json()["detail"]) == (404, "Not found")
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (404, "Not found")
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 0


def test_a_note_of_another_kind_is_refused(api, conn, ex_on, ocr):
    sid = _shared_style(conn)                                       # a weekend_prep style
    for kind in ("trade_plan", None):
        nid = _note(conn, kind=kind)
        r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
        assert (r.status_code, r.json()["detail"]) == (400, "This note is a different kind from the style.")


@pytest.mark.parametrize("bad", ["one", [1], [None], {"a": 1}, ["x" * 3000]])
def test_images_on_must_be_a_list_of_addresses(api, conn, ex_on, ocr, bad):
    nid = _note(conn)
    r = api.post(f"{EX}/preview", json={"noteId": nid, "imagesOn": bad})
    assert (r.status_code, r.json()["detail"]) == (400, "imagesOn must be a list of image addresses.")


# ── 7. the switches ─────────────────────────────────────────────────────────────────────────

def test_with_the_example_switch_off_both_routes_404_and_the_list_says_so(api, conn, lib_on, monkeypatch, ocr):
    sid = _shared_style(conn)
    nid = _note(conn)
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "0")
    assert gallery.library_enabled() and not gallery.example_enabled()
    assert gallery.preview_example(conn, "author", nid, []) is None             # the service says so too
    assert gallery.publish_example(conn, "author", nid, sid, [], "Plan") is None
    assert api.post(f"{EX}/preview", json={"noteId": nid}).status_code == 404
    assert api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).status_code == 404
    listed = api.get(URL)
    assert listed.status_code == 200 and listed.json()["capabilities"] == {"exampleNotes": False}
    # control: the same requests with the switch on
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "1")
    assert api.get(URL).json()["capabilities"] == {"exampleNotes": True}
    assert api.post(f"{EX}/preview", json={"noteId": nid}).status_code == 200
    assert api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).status_code == 200


def test_the_example_switch_needs_the_library_switch(api, conn, monkeypatch, ocr):
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    nid = _note(conn)
    assert not gallery.example_enabled()
    assert api.post(f"{EX}/preview", json={"noteId": nid}).status_code == 404
    assert api.post(EX, json={"noteId": nid, "styleItemId": "x", "title": "Plan"}).status_code == 404
    assert api.get(URL).json()["capabilities"] == {"exampleNotes": False}


def test_the_switch_off_404_comes_before_the_plan_check(api, conn, lib_on, monkeypatch, ocr):
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "0")
    _as(api, "author", plan="free")
    assert api.post(f"{EX}/preview", json={}).status_code == 404
    assert api.post(EX, json={}).status_code == 404
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "1")
    assert api.post(f"{EX}/preview", json={}).status_code == 402                     # control: the plan check is there
    assert api.post(EX, json={}).status_code == 402


def test_an_example_row_reads_as_absent_while_its_switch_is_off(api, conn, ex_on, ocr, monkeypatch):
    sid = _shared_style(conn)
    nid = _note(conn)
    gid = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).json()["template"]["id"]
    assert gallery.get_item("author", gid, conn=conn) is not None                    # control
    assert gid in {p["id"] for p in gallery.admin_queue(conn=conn)["pending"]}
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "0")
    assert gallery.get_item("author", gid, conn=conn) is None
    assert gallery.get_item("admin", gid, is_admin=True, conn=conn) is None
    assert gid not in {p["id"] for p in gallery.admin_queue(conn=conn)["pending"]}
    assert gallery.admin_act("admin", gid, "approve", reviewed_updated_at="x", conn=conn) is None
    assert _row(conn, gid) is not None                                                  # stored, never deleted


def test_an_example_is_never_listed_on_its_own(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    nid = _note(conn)
    item = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).json()["template"]
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    gallery.admin_act("admin", item["id"], "feature", conn=conn)
    assert _row(conn, item["id"])["status"] == "approved"
    for section in ("all", "picks", "mine"):
        ids = {t["id"] for t in gallery.list_gallery("author", section=section, conn=conn)}
        assert item["id"] not in ids, section
    assert sid in {t["id"] for t in gallery.list_gallery("author", conn=conn)}          # control: the style is listed
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("author", item_type="example_note", conn=conn)
    handle = gallery.author_handle("author", conn)
    page = gallery.author_page("viewer", handle, conn=conn)
    assert [i["id"] for i in page["items"]] == [sid] and page["author"]["itemCount"] == 1
    gallery.set_follow("viewer", handle, True, conn=conn)
    assert [i["id"] for i in gallery.feed("viewer", conn=conn)] == [sid]
    assert gallery.use_template("viewer", item["id"], conn=conn) is None


# ── 8. the rate limit ───────────────────────────────────────────────────────────────────────

def test_the_eleventh_publish_in_an_hour_is_429_with_the_shared_sentence(api, conn, ex_on, ocr, monkeypatch):
    from api.routers import notebook_template_gallery as router_mod
    monkeypatch.setenv("NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP", "1000")
    assert (router_mod.PUBLISH_RATE, router_mod.SCOPE_PUBLISH) == ("10/hour", "notebook-gallery-publish")
    sid = _shared_style(conn)
    nid = _note(conn)
    codes = [api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).status_code for _ in range(10)]
    assert codes == [200] * 10
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (429, router_mod.PUBLISH_RATE_SENTENCE)
    # the SAME scope as sharing a style: that budget is spent too
    s2 = _style(conn)
    r = api.post(f"{URL}/styles", json={"styleId": s2["id"], "title": "T", "category": "journal"})
    assert (r.status_code, r.json()["detail"]) == (429, router_mod.PUBLISH_RATE_SENTENCE)


def test_a_refused_publish_gives_the_days_charge_back(api, conn, ex_on, ocr):
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    nid = _note(conn)
    before = daily_counters.value(et_today(), "notebook_gallery_publish", "author")
    assert api.post(EX, json={"noteId": nid, "styleItemId": "nope", "title": "Plan"}).status_code == 400
    assert api.post(EX, json={"noteId": "nope", "styleItemId": "nope", "title": "Plan"}).status_code == 404
    assert daily_counters.value(et_today(), "notebook_gallery_publish", "author") == before


# ── 9. one fact in two files ────────────────────────────────────────────────────────────────

def test_the_client_item_types_include_example_note():
    assert "example_note" in gallery.ITEM_TYPES
    assert _client_keys("ITEM_TYPES") == gallery.ITEM_TYPES
    assert "example_note" not in gallery.LISTED_ITEM_TYPES
    assert set(gallery.LISTED_ITEM_TYPES) == set(gallery.ITEM_TYPES) - {"example_note"}


def test_the_source_note_column_is_an_additive_alter(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
    assert "source_note_id" in cols
    gallery.ensure_gallery_schema(conn)                                                 # idempotent


# ── fix round 1 ─────────────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parents[1]
STYLE_LIB = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "styleLibrary.js"


def _big_note(conn, user="author"):
    """A weekend_prep note whose stored body is just over the example ceiling."""
    nid = _note(conn, user)
    para = _para("made $1,240 on NVDA " * 50)
    n = gallery.MAX_BODY_BYTES // len(json.dumps(para)) + 2
    raw = json.dumps({"type": "doc", "content": [para] * n})
    assert len(raw.encode("utf-8")) > gallery.MAX_BODY_BYTES
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (raw, nid))
    conn.commit()
    return nid


@pytest.fixture
def reduce_calls(monkeypatch):
    calls = []
    real = gallery._reduce_example

    def spy(*a, **k):
        calls.append(k.get("item_id"))
        return real(*a, **k)
    monkeypatch.setattr(gallery, "_reduce_example", spy)
    return calls


def test_an_oversized_note_is_refused_before_any_reduction(api, conn, ex_on, ocr, reduce_calls):
    """I-1 / P3b-T3-R1: the note's stored body is measured against the example ceiling before it is reduced."""
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    sid = _shared_style(conn)
    nid = _big_note(conn)
    before = daily_counters.value(et_today(), "notebook_gallery_publish", "author")
    r = api.post(f"{EX}/preview", json={"noteId": nid})
    assert (r.status_code, r.json()["detail"]) == (400, gallery.EXAMPLE_TOO_LONG_SENTENCE)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, gallery.EXAMPLE_TOO_LONG_SENTENCE)
    assert reduce_calls == []
    assert daily_counters.value(et_today(), "notebook_gallery_publish", "author") == before   # the refund rule
    # someone else's oversized note is still the 404: size is never an oracle for a note that is not yours
    theirs = _big_note(conn, user="other")
    assert api.post(f"{EX}/preview", json={"noteId": theirs}).status_code == 404
    # control: an ordinary note is reduced
    small = _note(conn)
    assert api.post(f"{EX}/preview", json={"noteId": small}).status_code == 200 and reduce_calls


def test_the_write_lock_is_not_held_while_the_note_is_reduced(api, conn, ex_on, ocr, monkeypatch):
    """I-1 / P3b-T3-R1: the reduction runs BEFORE `BEGIN IMMEDIATE`. While it runs, a second connection with no
    busy wait can take the write lock -- for a new row and for a held revision alike."""
    sid = _shared_style(conn, approve=True)
    nid = _note(conn)
    seen = []
    real = gallery._reduce_example

    def probe(*a, **k):
        other = sqlite3.connect(os.environ["AUTH_DB_PATH"], timeout=0, isolation_level=None)
        try:
            other.execute("BEGIN IMMEDIATE")
            other.execute("ROLLBACK")
            seen.append("free")
        except sqlite3.OperationalError as e:
            seen.append(f"locked: {e}")
        finally:
            other.close()
        return real(*a, **k)
    monkeypatch.setattr(gallery, "_reduce_example", probe)
    first = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert first.status_code == 200, first.text
    gallery.admin_act("admin", first.json()["template"]["id"], "approve",
                      reviewed_updated_at=first.json()["template"]["updatedAt"], conn=conn)
    assert api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Again"}).status_code == 200
    assert len(seen) >= 2 and all(x == "free" for x in seen), seen


def test_an_existing_rows_images_point_at_that_row_after_the_unlocked_reduction(api, conn, ex_on, ocr):
    """The reduction runs against a fresh id before the lookup; a row found under the lock gets its own id."""
    sid = _shared_style(conn, approve=True)
    nid = _note(conn, images=("read.png",))
    on = [_src("author", nid, "read.png")]
    item = api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": on, "title": "One"}).json()["template"]
    api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": on, "title": "Two"})     # in place (pending)
    row = _row(conn, item["id"])
    assert _images(json.loads(row["body_json"])) == [f"{URL}/{item['id']}/images/0"]
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=row["updated_at"], conn=conn)
    api.post(EX, json={"noteId": nid, "styleItemId": sid, "imagesOn": on, "title": "Three"})   # held
    rev = json.loads(_row(conn, item["id"])["pending_json"])
    assert _images(rev["payload"]["bodyJson"]) == [f"{URL}/{item['id']}/images/0"]


def test_two_publishes_at_once_make_one_example(api, conn, ex_on, ocr, monkeypatch):
    """M-5: the lookup and the write cannot interleave. The step between them is slowed, so without the write
    lock both publishers would look, find nothing, and insert."""
    sid = _shared_style(conn)
    nid = _note(conn)
    real = gallery._bind_images

    def slow(*a, **k):
        time.sleep(0.3)
        return real(*a, **k)
    monkeypatch.setattr(gallery, "_bind_images", slow)
    barrier, out, errors = threading.Barrier(2), [], []

    def go():
        barrier.wait()
        try:
            out.append(gallery.publish_example(None, "author", nid, sid, [], "Plan")["id"])
        except Exception as e:  # noqa: BLE001
            errors.append(e)
    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == [] and len(out) == 2 and out[0] == out[1]
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE item_type = 'example_note'").fetchone()[0] == 1


def test_publish_refuses_a_connection_with_an_open_transaction_and_leaves_it_alone(conn, ex_on, ocr):
    """M-8: a caller's own transaction is never rolled back by a publish."""
    sid = _shared_style(conn)
    nid = _note(conn)
    conn.execute("UPDATE j2_notes SET title = 'caller work' WHERE id = ?", (nid,))
    assert conn.in_transaction
    with pytest.raises(ValueError):
        gallery.publish_example(conn, "author", nid, sid, [], "Plan")
    assert conn.in_transaction
    assert conn.execute("SELECT title FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0] == "caller work"
    conn.rollback()


def test_the_example_switch_parses_exactly_as_flag_on(monkeypatch, lib_on):
    """M-1 / P3b-T3-R2: the server-only read and the one parse agree on every value form."""
    from api.services.notebook_flags import flag_on
    forms = [None, "", "1", "true", "yes", "on", "0", "false", "no", "off", "TRUE", "True", " 1 ", " on ",
             "Yes\n", "\tOFF", "flase", "2", "enabled", " "]
    for raw in forms:
        if raw is None:
            monkeypatch.delenv(gallery.EXAMPLE_FLAG, raising=False)
        else:
            monkeypatch.setenv(gallery.EXAMPLE_FLAG, raw)
        assert gallery.example_enabled() == flag_on(gallery.EXAMPLE_FLAG, False), repr(raw)
    monkeypatch.setenv(gallery.EXAMPLE_FLAG, " 1 ")
    assert gallery.example_enabled() is True                                          # non-vacuity
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert gallery.example_enabled() is False                                         # and it needs the library


def test_a_hidden_style_is_not_one_to_link(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    nid = _note(conn)
    gallery.admin_act("admin", sid, "hide", conn=conn)
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"})
    assert (r.status_code, r.json()["detail"]) == (400, "Pick one of your own shared styles.")
    gallery.admin_act("admin", sid, "unhide", conn=conn)
    assert api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Plan"}).status_code == 200   # control


def test_publishing_again_after_a_rejection_replaces_it_and_goes_back_to_pending(api, conn, ex_on, ocr):
    sid = _shared_style(conn)
    nid = _note(conn)
    item = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "One"}).json()["template"]
    gallery.admin_act("admin", item["id"], "reject", note="Too thin", conn=conn)
    assert _row(conn, item["id"])["status"] == "rejected"
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?",
                 (json.dumps({"type": "doc", "content": [_para("fuller version")]}), nid))
    conn.commit()
    again = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Two"}).json()["template"]
    row = _row(conn, item["id"])
    assert again["id"] == item["id"] and (row["status"], row["review_note"], row["title"]) == ("pending", None, "Two")
    assert _texts(json.loads(row["body_json"])) == ["fuller version"]


def test_rejecting_a_held_example_revision_keeps_the_listed_one(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    nid = _note(conn)
    item = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Listed"}).json()["template"]
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    listed = dict(_row(conn, item["id"]))
    api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "Revised"})
    assert _row(conn, item["id"])["pending_json"]
    gallery.admin_act("admin", item["id"], "reject", note="Keep the old one", conn=conn)
    now = dict(_row(conn, item["id"]))
    assert now["pending_json"] is None and now["pending_at"] is None and now["review_note"] == "Keep the old one"
    for col in ("status", "listed_at", "title", "body_json", "payload_json", "version"):
        assert now[col] == listed[col], col


def test_the_source_note_alter_keeps_an_existing_tables_rows(tmp_path):
    from tests.test_style_library import _LEGACY_DDL
    c = sqlite3.connect(str(tmp_path / "legacy.db"))
    c.row_factory = sqlite3.Row
    try:
        c.execute(_LEGACY_DDL)
        c.execute("CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT)")
        c.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, category, body_json, status,"
                  " created_at, updated_at) VALUES ('old1', 'u1', 'member', 'Old', 'journal', '{}', 'approved',"
                  " '2026-09-01T00:00:00+00:00', '2026-09-01T00:00:00+00:00')")
        c.commit()
        assert "source_note_id" not in {r[1] for r in c.execute("PRAGMA table_info(j2_template_gallery)")}
        gallery.ensure_gallery_schema(c)
        row = c.execute("SELECT title, status, source_note_id FROM j2_template_gallery WHERE id = 'old1'").fetchone()
        assert tuple(row) == ("Old", "approved", None)
    finally:
        c.close()


def test_the_title_is_capped_as_typed_and_its_scrubbed_form_is_previewed(api, conn, ex_on, ocr):
    """M-3: the 80-character cap is on what the author TYPED; a scrubbed title that grows is shortened, and the
    preview shows the scrubbed title other members will see."""
    sid = _shared_style(conn)
    nid = _note(conn)
    typed = "made $1 $2 $3 $4 $5 $6"                                  # 22 typed; over 80 once scrubbed
    pv = api.post(f"{EX}/preview", json={"noteId": nid, "title": typed}).json()
    assert pv["title"].startswith("made your value here your value here")
    assert len(pv["title"]) <= gallery.MAX_TITLE_CHARS and "$" not in pv["title"]
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": typed})
    assert r.status_code == 200, r.text
    assert r.json()["template"]["title"] == pv["title"]
    r = api.post(EX, json={"noteId": nid, "styleItemId": sid, "title": "x" * (gallery.MAX_TITLE_CHARS + 1)})
    assert (r.status_code, r.json()["detail"]) == (400, "The title can be at most 80 characters.")
    assert api.post(f"{EX}/preview", json={"noteId": nid, "title": 7}).status_code == 400


def test_the_preview_reduces_the_note_once(api, conn, ex_on, ocr, monkeypatch):
    """M-2: the images on offer are asked of the reducer over the note's images only, never a second full pass."""
    from api.services.journal_two import public_note_payload as public
    nid = _note(conn, images=("read.png",))
    note_body = json.loads(conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0])
    full = []
    real = public.reduce

    def count(body, **k):
        if body == note_body:
            full.append(1)
        return real(body, **k)
    monkeypatch.setattr(public, "reduce", count)
    out = api.post(f"{EX}/preview", json={"noteId": nid}).json()
    assert full == [1]
    assert [i["name"] for i in out["images"]] == ["read.png"]


def test_the_client_names_the_example_type_once_and_lists_the_rest():
    """M-4: `EXAMPLE_NOTE_TYPE` is the server's `EXAMPLE_ITEM`; the gallery reads `LISTED_ITEM_TYPES`."""
    text = STYLE_LIB.read_text(encoding="utf-8")
    m = re.search(r"export const EXAMPLE_NOTE_TYPE = '([a-z_]+)'", text)
    assert m and m.group(1) == gallery.EXAMPLE_ITEM
    assert "export const LISTED_ITEM_TYPES" in text
    jsx = ROOT / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" / "TemplateGallery.jsx"
    assert "example_note" not in jsx.read_text(encoding="utf-8")


def test_the_ocr_states_read_the_documents_public_names():
    """M-6: the pipeline's status names are public, and the ones the OCR state compares against."""
    from api.services.journal_two import document_extraction as dx
    assert (dx.STATUS_PENDING, dx.STATUS_FAILED) == ("pending", "processing_failed")
    src = (ROOT / "api" / "services" / "journal_two" / "template_gallery.py").read_text(encoding="utf-8")
    assert "dx._STATUS" not in src


def test_every_publish_route_charges_and_refunds_the_same_way(api, conn, ex_on, ocr, monkeypatch):
    """M-7: one charge helper for the outline, style and example publish routes; a failure of any kind, an
    unexpected one included, gives the day's charge back."""
    from api.routers import notebook_template_gallery as router_mod
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today

    def boom(*a, **k):
        raise RuntimeError("unexpected")
    before = daily_counters.value(et_today(), "notebook_gallery_publish", "author")
    for name, path, body in (("publish", URL, {"templateId": "t", "title": "T", "category": "journal"}),
                             ("publish_style", f"{URL}/styles", {"styleId": "s", "title": "T", "category": "journal"}),
                             ("publish_example", EX, {"noteId": "n", "styleItemId": "s", "title": "T"})):
        monkeypatch.setattr(gallery, name, boom)
        with pytest.raises(RuntimeError):
            api.post(path, json=body)
        assert daily_counters.value(et_today(), "notebook_gallery_publish", "author") == before, name
    src = Path(router_mod.__file__).read_text(encoding="utf-8")
    assert src.count("_daily_take(DAILY_PUBLISH_SCOPE") == 1                              # one copy
