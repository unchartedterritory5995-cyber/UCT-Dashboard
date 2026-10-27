"""Task 11.8 fix round 1: the review's four Important findings, rulings W11-R33/R34/R34b, c4 and the six Minors.

* I-1: a tool a template made follows its OWN lineage (the template's part, by key): "Update from the library" is
  offered only when that part changed, and taking it applies (never None/404).
* I-2: applying a template's update moves the credit's version: no update is offered after it.
* I-3 (W11-R34b): a routine update keeps every unchanged item (same id, its ticks attached).
* I-4 (W11-R34): Adopt and Use take an Idempotency-Key: the same key twice (even at once) is one copy / one note.
* W11-R33: an external link in a shared outline keeps its text, never its href. c4: withdrawal reaches tool adopters.
* Minors: wave 11 gates; a missing author row is "a UCT member's"; no credit on one's own item; no tool made in a dark
  wave; a caller's open transaction is never committed.
"""
from __future__ import annotations

import json
import threading
import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import journal_styles as js
from api.services.journal_two import routines, template_gallery as gallery, trackers
from api.services.journal_two import widget_definitions as wd
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    AUTHOR, MEMBER, NOW, OTHER, approve, built, counts, db, heading, list_template, list_tool, para, pin_clock, routine,
    routine_edits, routine_slot, style, tracker, tracker_slot, waves, widget,
)
from tests.test_widget_share_canary import CANARY

CHOICES = {"routine_a": {"create": True}, "tracker_a": {"create": True}}
ROUTINE_EDITS = {"blocks": {"routine_a": {"items": ["Coffee", "Mark levels"]}}}


def _template(db):
    w, r, t = widget(db), routine(db), tracker(db)
    s = style(db, blocks=[built("a", w["id"]), routine_slot("a", r["id"]), tracker_slot("a", t["id"])])
    return list_template(db, s["id"], edits=ROUTINE_EDITS), s, w


def _republish(db, s, gid, edits=ROUTINE_EDITS):
    gallery.publish_style(AUTHOR, s["id"], title="Setup study", description="", category="journal",
                          trading_style=None, edits=edits, conn=db)
    approve(db, gid)


def _rerange(db, def_id, token):
    cur = wd.get(AUTHOR, def_id, conn=db)
    wd.update(AUTHOR, def_id, if_match=cur["etag"], plan={**cur["plan"], "range": {"token": token}},
              apply="update_all", conn=db)


def _avail(db, kind, cid):
    return gallery.library_facts(MEMBER, kind, [cid], conn=db)[cid]["updateAvailable"]


# ── I-1 ────────────────────────────────────────────────────────────────────────────────────────────

def test_a_template_made_tool_is_offered_only_its_own_update_and_it_applies(db):
    gid, s, w = _template(db)
    out = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, conn=db)
    wid, rid = out["created"]["widgets"][0]["id"], out["created"]["routines"][0]["id"]
    tid = out["created"]["trackers"][0]["id"]
    # a version 2 that changes nothing in the parts: no tool is offered an update, and none applies
    _republish(db, s, gid)
    assert (_avail(db, "widget", wid), _avail(db, "routine", rid), _avail(db, "tracker", tid)) == (False,) * 3
    assert gallery.update_tool(MEMBER, "widget", wid, answers={"p1": "Flag"}, conn=db) is None
    # version 3 changes the widget and the routine: exactly those two are offered, and each applies
    _rerange(db, w["id"], "last_90d")
    _republish(db, s, gid, {"blocks": {"routine_a": {"items": ["Coffee", "Read the news"]}}})
    assert (_avail(db, "widget", wid), _avail(db, "routine", rid), _avail(db, "tracker", tid)) == (True, True, False)
    up_w = gallery.update_tool(MEMBER, "widget", wid, answers={"p1": "Flag"}, conn=db)
    up_r = gallery.update_tool(MEMBER, "routine", rid, conn=db)
    assert up_w is not None and up_w["version"] == 3 and up_r is not None
    assert wd.get(MEMBER, wid, conn=db)["plan"]["range"] == {"token": "last_90d"}
    assert [i["text"] for i in routines.get(MEMBER, rid, conn=db)["items"]] == ["Coffee", "Read the news"]
    assert (_avail(db, "widget", wid), _avail(db, "routine", rid)) == (False, False)
    assert gallery.update_tool(MEMBER, "tracker", tid, conn=db) is None


def test_a_template_made_tool_records_no_use_day(db, monkeypatch):
    pin_clock(monkeypatch)                     # W11-R74: the copy's items are valid from NOW's ET day
    gid, s, w = _template(db)
    out = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, conn=db)
    rid = out["created"]["routines"][0]["id"]
    item = routines.get(MEMBER, rid, conn=db)["items"][0]["id"]
    routines.set_tick(MEMBER, rid, "2026-10-26", item, True, now=NOW, conn=db)
    assert db.execute("SELECT COUNT(*) FROM j2_gallery_use_days").fetchone()[0] == 0


# ── I-2 ────────────────────────────────────────────────────────────────────────────────────────────

def test_an_applied_template_update_is_no_longer_offered(db):
    s = style(db, outline={"type": "doc", "content": [heading("Plan")]})
    gid = list_template(db, s["id"])
    mine = gallery.adopt_style(MEMBER, gid, conn=db)["style"]["id"]
    js.update_style(AUTHOR, s["id"], {"outlineBodyJson": {"type": "doc", "content": [heading("Plan v2")]}}, db)
    _republish(db, s, gid, None)
    assert _avail(db, "template", mine) is True
    copy = js.get_style(MEMBER, mine, db, full=True)
    gallery.apply_update(MEMBER, mine, take_outline=True, base_updated_at=copy["updatedAt"], conn=db)
    assert gallery.plan_update(MEMBER, mine, conn=db) is None
    assert _avail(db, "template", mine) is False


# ── I-3 (W11-R34b) ─────────────────────────────────────────────────────────────────────────────────

def test_a_routine_update_keeps_every_unchanged_item_and_its_ticks(db, monkeypatch):
    pin_clock(monkeypatch)                     # W11-R74: the copy's items are valid from NOW's ET day
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee", "Read"))
    mine = gallery.adopt_tool(MEMBER, gid, conn=db)["id"]
    items = {i["text"]: i["id"] for i in routines.get(MEMBER, mine, conn=db)["items"]}
    routines.set_tick(MEMBER, mine, "2026-10-26", items["Coffee"], True, now=NOW, conn=db)
    # the same list again: no id changes at all
    gallery.publish_tool(AUTHOR, "routine", r["id"], edits=routine_edits("Coffee", "Read"), conn=db)
    approve(db, gid)
    gallery.update_tool(MEMBER, "routine", mine, conn=db)
    raw = json.loads(db.execute("SELECT items_json FROM j2_routines WHERE id = ?", (mine,)).fetchone()[0])
    assert len(raw) == 2 and {i["id"] for i in raw} == set(items.values()) and all(i["to"] is None for i in raw)
    # an edited text is an end plus a create; the unchanged item keeps its id and its tick
    gallery.publish_tool(AUTHOR, "routine", r["id"], edits=routine_edits("Coffee", "Read the news"), conn=db)
    approve(db, gid)
    gallery.update_tool(MEMBER, "routine", mine, conn=db)
    live = {i["text"]: i["id"] for i in routines.get(MEMBER, mine, conn=db)["items"]}
    assert live["Coffee"] == items["Coffee"] and live["Read the news"] != items["Read"]
    assert db.execute("SELECT ticked FROM j2_routine_ticks WHERE routine_id = ? AND item_id = ?",
                      (mine, items["Coffee"])).fetchone()[0] == 1


# ── I-4 (W11-R34) ──────────────────────────────────────────────────────────────────────────────────

def _together(n, fn):
    barrier, outs, errs = threading.Barrier(n), [], []

    def go(i):
        c = auth_db.get_connection()
        try:
            barrier.wait()
            outs.append(fn(c, i))
        except Exception as e:  # noqa: BLE001 -- asserted below
            errs.append(e)
        finally:
            c.close()
    ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(60)
    return outs, errs


def _n(db, table, gid):
    return db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ? AND source_gallery_id = ?",
                      (MEMBER, gid)).fetchone()[0]


def test_the_same_key_at_once_makes_one_tool_copy_and_new_keys_make_more(db):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    key = str(uuid.uuid4())
    outs, errs = _together(2, lambda c, i: gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, key=key, conn=c))
    assert errs == [] and _n(db, "j2_widget_definitions", gid) == 1
    assert {o["id"] for o in outs} == {outs[0]["id"]} and any(o.get("replayed") for o in outs)
    again = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, key=key, conn=db)
    assert again["id"] == outs[0]["id"] and again["replayed"] is True
    outs, errs = _together(2, lambda c, i: gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"},
                                                              key=str(uuid.uuid4()), conn=c))
    assert errs == [] and _n(db, "j2_widget_definitions", gid) == 3          # P3a's deliberate re-adopt
    with pytest.raises(gallery.KeyReused):                                  # one key never lands on another item
        gallery.adopt_tool(MEMBER, list_tool(db, "widget", widget(db, name="Other")["id"]), answers={"p1": "F"},
                           key=key, conn=db)


def test_the_same_key_at_once_makes_one_template_copy(db):
    gid, _s, _w = _template(db)
    key = str(uuid.uuid4())
    outs, errs = _together(2, lambda c, i: gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES,
                                                               key=key, conn=c))
    assert errs == [] and len(outs) == 2
    assert _n(db, "j2_journal_styles", gid) == 1 and _n(db, "j2_widget_definitions", gid) == 1
    gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=str(uuid.uuid4()), conn=db)
    assert _n(db, "j2_journal_styles", gid) == 2


def test_the_same_key_twice_makes_one_note(db):
    gid, _s, _w = _template(db)
    key = str(uuid.uuid4())
    outs, errs = _together(2, lambda c, i: gallery.use_library_template(
        MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, key=key, conn=c))
    assert errs == [] and len(outs) == 2 and outs[0]["note"]["id"] == outs[1]["note"]["id"]
    assert db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    gallery.use_library_template(MEMBER, gid, payload={}, key=str(uuid.uuid4()), conn=db)
    assert db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 2


# ── W11-R33 and c4 ─────────────────────────────────────────────────────────────────────────────────

def test_an_outline_link_keeps_its_text_never_its_href(db):
    w = widget(db)
    outline = {"type": "doc", "content": [heading("Plan"), para("{{block:built_a}}"),
                                          {"type": "paragraph", "content": [{
                                              "type": "text", "text": "my broker",
                                              "marks": [{"type": "link", "attrs": {"href": f"https://{CANARY}.com"}},
                                                        {"type": "bold"}]}]}]}
    s = style(db, blocks=[built("a", w["id"])], outline=outline)
    out = gallery.publish_style(AUTHOR, s["id"], title="T", description="", category="journal", trading_style=None,
                                conn=db)
    stored = db.execute("SELECT payload_json, body_json FROM j2_template_gallery WHERE id = ?",
                        (out["id"],)).fetchone()
    for col in stored:
        assert CANARY not in col.lower() and '"link"' not in col
    assert "my broker" in stored[0] and '"bold"' in stored[0]                 # the text and other marks travel
    assert CANARY not in json.dumps(gallery.share_preview(AUTHOR, "template", s["id"], conn=db)["travels"])


def test_a_withdrawal_reaches_tool_adopters(db, monkeypatch):
    rung = []
    monkeypatch.setattr(gallery, "_ring", lambda uid, title, msg, data: rung.append((uid, msg)) or True)
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee"))
    gallery.adopt_tool(MEMBER, gid, notify=True, conn=db)
    gallery.adopt_tool(OTHER, gid, notify=False, conn=db)
    assert gallery.unpublish(AUTHOR, gid, conn=db) is True
    assert [u for u, _m in rung] == [MEMBER] and "taken down" in rung[0][1]


# ── the Minors ─────────────────────────────────────────────────────────────────────────────────────

def test_wave_11_off_side_paths_are_dark(db, monkeypatch):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    mine = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, conn=db)["id"]
    waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 9, 10)
    assert gallery.library_facts(MEMBER, "widget", [mine], conn=db) == {}
    assert gallery.credit_for(MEMBER, "widget", mine, conn=db) is None
    gallery.record_tool_use_day(MEMBER, "widget", mine, now=NOW, conn=db)
    gallery.record_use_day(MEMBER, gid, now=NOW, conn=db)
    assert db.execute("SELECT COUNT(*) FROM j2_gallery_use_days").fetchone()[0] == 0
    waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11)
    assert gallery.library_facts(MEMBER, "widget", [mine], conn=db)                 # control: back on re-arm


def test_a_missing_author_row_credits_a_uct_member_never_uct(db):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    db.execute("DELETE FROM j2_gallery_authors WHERE user_id = ?", (AUTHOR,))
    db.commit()
    mine = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, conn=db)["id"]
    line = gallery.credit_for(MEMBER, "widget", mine, conn=db)
    assert line.startswith("Based on a UCT member's ") and "UCT's" not in line


def test_the_authors_own_item_carries_no_credit(db):
    gid, _s, _w = _template(db)
    out = gallery.use_library_template(AUTHOR, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    assert out["credit"] is None


def test_no_tool_is_made_in_a_dark_wave(db, monkeypatch):
    r = routine(db)
    gr = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee"))
    gid, _s, _w = _template(db)
    waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 10, 11)                        # wave 9 off
    before = counts(db)
    for door in (lambda: gallery.adopt_tool(MEMBER, gr, conn=db),
                 lambda: gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, conn=db)):
        with pytest.raises(gallery.GalleryError) as e:
            door()
        assert str(e.value) == gallery.NOT_AVAILABLE_SENTENCE
    assert counts(db) == before
    waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11)
    assert gallery.adopt_tool(MEMBER, gr, conn=db) is not None                  # control


def test_a_callers_open_transaction_is_never_committed(db):
    gid, _s, _w = _template(db)
    db.execute("INSERT INTO j2_gallery_use_days (user_id, item_id, day) VALUES ('probe', 'x', 'd')")
    assert db.in_transaction
    with pytest.raises(ValueError):
        gallery.use_library_template(MEMBER, gid, payload={}, conn=db)
    # update_tool joins the caller's transaction: the caller's rollback undoes both
    db.rollback()
    r = routine(db)
    g = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee"))
    mine = gallery.adopt_tool(MEMBER, g, conn=db)["id"]
    gallery.publish_tool(AUTHOR, "routine", r["id"], edits=routine_edits("Coffee", "Tea"), conn=db)
    approve(db, g)
    db.execute("INSERT INTO j2_gallery_use_days (user_id, item_id, day) VALUES ('probe', 'x', 'd')")
    assert gallery.update_tool(MEMBER, "routine", mine, conn=db) is not None
    db.rollback()
    assert db.execute("SELECT COUNT(*) FROM j2_gallery_use_days WHERE user_id = 'probe'").fetchone()[0] == 0
    assert [i["text"] for i in routines.get(MEMBER, mine, conn=db)["items"]] == ["Coffee"]


# ── 11.10 list rows: `group` (the client's TemplateLibrarySection reads `row.group`) ─────────────────

def test_a_list_row_carries_its_template_group(db):
    gid, _s, _w = _template(db)
    db.execute("UPDATE j2_template_gallery SET template_group = 'before_open' WHERE id = ?", (gid,))
    db.commit()
    rows = {r["id"]: r for r in gallery.list_gallery(MEMBER, conn=db)}
    assert rows[gid]["group"] == "before_open"
    grouped = gallery.list_gallery(MEMBER, group="before_open", conn=db)
    assert [r["id"] for r in grouped] == [gid] and grouped[0]["group"] == "before_open"
    db.execute("UPDATE j2_template_gallery SET template_group = NULL WHERE id = ?", (gid,))
    db.commit()
    assert {r["id"]: r for r in gallery.list_gallery(MEMBER, conn=db)}[gid]["group"] is None


# ── fix round 2 ────────────────────────────────────────────────────────────────────────────────────

def test_use_never_reuses_an_archived_copy(db):
    """W11-R10: an archived copy is not live. A Use makes a fresh live copy and the archived one stays archived."""
    gid, _s, _w = _template(db)
    first = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    old = first["style"]["id"]
    assert js.archive_style(MEMBER, old, conn=db) is not None
    again = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    assert again["style"]["id"] != old
    rows = dict(db.execute("SELECT id, archived_at FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ?"
                           " AND deleted_at IS NULL", (MEMBER, gid)).fetchall())
    assert rows[old] is not None and rows[again["style"]["id"]] is None
    # a third Use reuses the LIVE copy, never the archived one
    third = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    assert third["style"]["id"] == again["style"]["id"]


def _statements(db, fn):
    seen = []
    db.set_trace_callback(seen.append)
    try:
        fn()
    finally:
        db.set_trace_callback(None)
    return len(seen)


def test_library_facts_is_a_constant_number_of_statements(db):
    """11.13's Templates tab asks for every copy at once: N ids cost the same statements as one."""
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    ids = [gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, conn=db)["id"] for _ in range(8)]
    one = _statements(db, lambda: gallery.library_facts(MEMBER, "widget", ids[:1], conn=db))
    many = _statements(db, lambda: gallery.library_facts(MEMBER, "widget", ids, conn=db))
    assert one == many and many <= 6, (one, many)
    facts = gallery.library_facts(MEMBER, "widget", ids, conn=db)
    assert set(facts) == set(ids) and all(f["sourceGalleryId"] == gid and f["credit"] for f in facts.values())
    tg, _s, _w = _template(db)
    tids = [gallery.adopt_style(MEMBER, tg, answers={"p1": "Flag"}, choices=CHOICES, conn=db)["style"]["id"]
            for _ in range(5)]
    assert (_statements(db, lambda: gallery.library_facts(MEMBER, "template", tids[:1], conn=db))
            == _statements(db, lambda: gallery.library_facts(MEMBER, "template", tids, conn=db)))


# ── fix round 3 ────────────────────────────────────────────────────────────────────────────────────

def test_a_link_card_and_a_web_embed_never_travel_in_a_shared_outline(db):
    """I-A (W11-R33 completed): `linkPreview` and `webEmbed` carry the address as `attrs.url`; they go whole, by
    the example notes' own rule (EXAMPLE_OVERRIDES), and the canary in either url never reaches the listing or a copy."""
    from api.services.journal_two import public_note_payload as pnp
    assert {"linkPreview", "webEmbed"} <= gallery._address_nodes() == {
        k for k, v in pnp.EXAMPLE_OVERRIDES.items() if v == "drop" and k != "link"}
    w = widget(db)
    outline = {"type": "doc", "content": [
        heading("Plan"), para("{{block:built_a}}"), para("stays"),
        {"type": "linkPreview", "attrs": {"url": f"https://{CANARY}.example.com/acct/123", "title": "my broker"}},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [
            {"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "dQw4w9WgXcQ",
                                           "url": f"https://www.youtube.com/watch?v=dQw4w9WgXcQ&{CANARY}"}}]}]}]}
    s = style(db, blocks=[built("a", w["id"])], outline=outline)
    own = json.dumps(js.get_style(AUTHOR, s["id"], db, full=True).get("outlineBodyJson"))
    assert CANARY in own and "linkPreview" in own and "webEmbed" in own      # control: the author's own style keeps them
    out = gallery.publish_style(AUTHOR, s["id"], title="T", description="", category="journal", trading_style=None,
                                conn=db)
    stored = db.execute("SELECT payload_json, body_json FROM j2_template_gallery WHERE id = ?",
                        (out["id"],)).fetchone()
    for col in stored:
        assert col and CANARY not in col.lower() and "linkPreview" not in col and "webEmbed" not in col
    assert "stays" in stored[0]
    approve(db, out["id"])
    adopted = gallery.adopt_style(MEMBER, out["id"], answers={"p1": "Flag"}, key=str(uuid.uuid4()), conn=db)
    copy = js.get_style(MEMBER, adopted["style"]["id"], db, full=True)
    assert CANARY not in json.dumps(adopted).lower() and CANARY not in json.dumps(copy).lower()


def test_a_dead_use_reservation_expires_and_the_key_creates(db, monkeypatch):
    """M-1: a blank reservation older than USE_RESERVATION_STALE_SECS (by its own stamp) is abandoned; a fresh one
    still answers that the first request is on its way."""
    from datetime import datetime, timedelta, timezone
    gid, _s, _w = _template(db)
    monkeypatch.setattr(gallery, "_wait_for_key", lambda uid, key, timeout_s=15.0: None)
    fresh, dead = str(uuid.uuid4()), str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    for k, at in ((fresh, now), (dead, now - timedelta(seconds=gallery.USE_RESERVATION_STALE_SECS + 5))):
        db.execute("INSERT INTO j2_tool_create_keys (user_id, key, kind, source_id, new_id, created_at)"
                   " VALUES (?, ?, 'gallery_use_template', ?, ?, ?)", (MEMBER, k, gid, "", at.isoformat()))
    db.commit()
    with pytest.raises(gallery.GalleryConflict):
        gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, key=fresh,
                                     conn=db)
    made = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, key=dead,
                                        conn=db)
    assert made["note"]["id"] and not made.get("replayed")
    again = gallery.use_library_template(MEMBER, gid, payload={}, key=dead, conn=db)
    assert again["replayed"] and again["note"]["id"] == made["note"]["id"]


def test_a_replay_whose_note_was_trashed_creates_a_new_note(db):
    """M-1: a first note trashed (or gone) frees the key, as on the other doors."""
    from api.services.journal_two import notes as notes_service
    gid, _s, _w = _template(db)
    for gone in ("trash", "delete"):
        k = str(uuid.uuid4())
        first = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, key=k,
                                             conn=db)
        if gone == "trash":
            notes_service.delete_note(MEMBER, first["note"]["id"], db)
        else:
            db.execute("DELETE FROM j2_notes WHERE id = ?", (first["note"]["id"],))
            db.commit()
        second = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
        assert not second.get("replayed") and second["note"]["id"] != first["note"]["id"], gone
        third = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
        assert third["replayed"] and third["note"]["id"] == second["note"]["id"], gone


def test_a_replayed_template_adopt_answers_the_first_result_exactly(db):
    """M-2: the replay carries the first answer's `created` and `reused`, the same ids."""
    gid, _s, _w = _template(db)
    k = str(uuid.uuid4())
    first = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=k, conn=db)
    again = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=k, conn=db)
    assert again["replayed"] is True
    assert {k_: v for k_, v in again.items() if k_ != "replayed"} == first
    assert len(first["created"]["widgets"]) == 1 and len(first["created"]["routines"]) == 1


def test_created_names_only_what_this_call_made(db):
    """M-3: a re-adopt (a new key) and a Use whose only copy is archived meet the member's existing template
    routine and tracker: they are `reused`, never `created`; the widget is new each time and is `created`."""
    gid, _s, _w = _template(db)
    a1 = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=str(uuid.uuid4()), conn=db)
    assert len(a1["created"]["routines"]) == 1 and len(a1["created"]["trackers"]) == 1
    assert a1["reused"] == {"routines": [], "trackers": []}
    a2 = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=str(uuid.uuid4()), conn=db)
    assert a2["created"]["routines"] == [] and a2["created"]["trackers"] == [] and len(a2["created"]["widgets"]) == 1
    assert [x["id"] for x in a2["reused"]["routines"]] == [x["id"] for x in a1["created"]["routines"]]
    assert [x["id"] for x in a2["reused"]["trackers"]] == [x["id"] for x in a1["created"]["trackers"]]
    for s_id in (a1["style"]["id"], a2["style"]["id"]):
        js.archive_style(MEMBER, s_id, conn=db)
    u = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    assert u["created"]["routines"] == [] and u["created"]["trackers"] == []
    assert len(u["reused"]["routines"]) == 1 and len(u["reused"]["trackers"]) == 1
    n = lambda t: db.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (MEMBER,)).fetchone()[0]  # noqa: E731
    assert (n("j2_routines"), n("j2_trackers")) == (1, 1)


def test_from_library_many_and_copy_credit_are_the_one_authority(db):
    """The 11.13 carry: `from_library_many` is `_from_library` for many ids in ONE statement, and `copy_credit`
    copies a credit snapshot whole under a new id."""
    gid, _s, _w = _template(db)
    own_gid = list_template(db, style(db, uid=MEMBER, name="Mine")["id"], uid=MEMBER, title="Mine")
    ids = [gid, f"gal:{gid}:r1", "missing-id", own_gid, 7]
    seen = []
    db.set_trace_callback(seen.append)
    try:
        got = gallery.from_library_many(MEMBER, ids, conn=db)
    finally:
        db.set_trace_callback(None)
    assert len(seen) == 1
    for i in (gid, f"gal:{gid}:r1", "missing-id", own_gid):
        assert got[i] == gallery._from_library(db, MEMBER, None if i.startswith("gal:") else i, i), i
    assert (got[gid], got["missing-id"], got[own_gid]) == (True, True, False) and 7 not in got
    a = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, conn=db)["style"]["id"]
    gallery.copy_credit(db, a, "dup-1", user_id=MEMBER)
    db.commit()
    assert gallery.credit_for(MEMBER, "template", "dup-1", conn=db) == gallery.credit_for(MEMBER, "template", a,
                                                                                            conn=db)
    gallery.copy_credit(db, "no-such", "dup-2", user_id=MEMBER)
    assert gallery.credit_for(MEMBER, "template", "dup-2", conn=db) is None



def test_a_use_whose_note_finds_an_existing_template_tool_reports_it_reused(db):
    """M-3 on the Use door's note path: a `template` routine slot gets its tool when the note is made
    (`slot_fill._create_from_template`). A second Use whose only copy is archived meets the routine the first Use
    made, under the same key: it is `reused`, never `created`, and the member still has one routine."""
    w = widget(db)
    slot = {"block": "routine_a", "enabled": True,
            "settings": {"template": "premarket_routine", "bind": "note-day", "display": "items"}}
    gid = list_template(db, style(db, blocks=[built("a", w["id"]), slot])["id"])
    pick = {"routine_a": {"create": True}}
    u1 = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=pick, payload={}, conn=db)
    assert len(u1["created"]["routines"]) == 1 and u1["reused"]["routines"] == []
    rid = u1["created"]["routines"][0]["id"]
    js.archive_style(MEMBER, u1["style"]["id"], conn=db)
    u2 = gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=pick, payload={}, conn=db)
    assert u2["style"]["id"] != u1["style"]["id"]
    assert u2["created"]["routines"] == [] and [x["id"] for x in u2["reused"]["routines"]] == [rid]
    assert db.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1


# ── fix round 4 ────────────────────────────────────────────────────────────────────────────────────

def _link(text, href, *more):
    return {"type": "text", "text": text, "marks": [{"type": "link", "attrs": {"href": href}}, *more]}


def _stored(db, gid):
    return db.execute("SELECT payload_json, body_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()


def test_a_no_slot_template_takes_the_same_address_path(db):
    """I-B: a template holding no tool slot is shared by the ONE path too (`_shared_outline`): link cards, web
    embeds and link hrefs carrying the canary reach neither the listing nor the adopter's copy; the words stay."""
    outline = {"type": "doc", "content": [
        heading("Plan"), {"type": "paragraph", "content": [_link("my broker", f"https://{CANARY}.x.com/a")]},
        para("stays"),
        {"type": "linkPreview", "attrs": {"url": f"https://{CANARY}.example.com/acct/123", "title": "card"}},
        {"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "dQw4w9WgXcQ",
                                       "url": f"https://www.youtube.com/watch?v=dQw4w9WgXcQ&{CANARY}"}}]}
    s = style(db, blocks=[], outline=outline)
    assert CANARY in json.dumps(js.get_style(AUTHOR, s["id"], db, full=True)["outlineBodyJson"])   # control
    gid = list_template(db, s["id"])
    for col in _stored(db, gid):
        assert col and CANARY not in col.lower() and "linkPreview" not in col and "webEmbed" not in col
    assert "my broker" in _stored(db, gid)[0] and "stays" in _stored(db, gid)[0]
    out = gallery.adopt_style(MEMBER, gid, conn=db)
    copy = js.get_style(MEMBER, out["style"]["id"], db, full=True)
    assert CANARY not in json.dumps(out).lower() and CANARY not in json.dumps(copy).lower()
    assert "my broker" in json.dumps(copy)


def test_a_link_whose_text_is_its_address_goes_whole(db):
    """I-C (ruling W11-R40, W11-R47): an autolinked URL -- linked text that IS its address (its skeleton is in its own
    href's) -- is dropped, text included. Other link text travels; a URL written in
    plain prose with no link mark is the author's visible text and travels unchanged."""
    w = widget(db)
    gone = [_link(f"https://{CANARY}.example.com/acct/123", f"https://{CANARY}.example.com/acct/123"),
            _link(f"WWW.{CANARY}.example.com/", f"http://{CANARY}.example.com"),
            _link(f"{CANARY}.example.com", f"https://www.{CANARY}.example.com/acct"),
            _link(f"me@{CANARY}.com", f"mailto:me@{CANARY}.com")]
    outline = {"type": "doc", "content": [
        heading("Plan"), para("{{block:built_a}}"),
        *[{"type": "paragraph", "content": [n, {"type": "text", "text": f" kept{i}"}]} for i, n in enumerate(gone)],
        {"type": "paragraph", "content": [_link("my broker", f"https://{CANARY}.x.com")]},
        para("see https://prose.example.com/plain for more")]}
    for blocks in ([built("a", w["id"])], []):
        s = style(db, blocks=blocks, outline=outline if blocks else
                  {**outline, "content": [c for c in outline["content"] if "{{block:" not in json.dumps(c)]})
        gid = list_template(db, s["id"], title=f"T{len(blocks)}")
        payload = _stored(db, gid)[0]
        assert CANARY not in payload.lower()
        assert all(f" kept{i}" in payload for i in range(len(gone)))       # only the address text went
        assert "my broker" in payload and "https://prose.example.com/plain" in payload
    # W11-R47 / W11-R48: ONE authority. Text in its own href, text that is itself an address (a scheme, a dotted
    # host with a letter TLD) whatever its href, or text holding its href's host goes; words do not.
    for text, hrefs, want in (("Example.com/", ["https://www.example.com"], True), ("my broker", ["https://a.b"], False),
                              ("https://a.b/c", [], True), ("read this", [], False), ("x@y.io", [], True),
                              ("x@y.io", ["mailto:x@y.io"], True)):
        assert gallery._link_text_is_an_address(text, hrefs) is want, text


def test_a_stored_outline_is_cleaned_again_on_adopt(db):
    """m4: a listing written by hand (or before the fix) with a link card is cleaned on its way into the copy."""
    s = style(db, blocks=[], outline={"type": "doc", "content": [heading("Plan"), para("stays")]})
    gid = list_template(db, s["id"])
    p = json.loads(_stored(db, gid)[0])
    p["outlineBodyJson"]["content"].append(
        {"type": "linkPreview", "attrs": {"url": f"https://{CANARY}.example.com", "title": "card"}})
    db.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(p), gid))
    db.commit()
    out = gallery.adopt_style(MEMBER, gid, conn=db)
    copy = js.get_style(MEMBER, out["style"]["id"], db, full=True)
    assert CANARY not in json.dumps(copy).lower() and "stays" in json.dumps(copy)


def test_the_address_rule_reads_nodes_and_marks_from_the_schema(db, monkeypatch):
    """m5: nodes and marks are told apart by NODE_POLICY, never by a name: a new "drop" MARK row is stripped as a
    mark (its words stay) and a new "drop" node row goes whole."""
    from api.services.journal_two import public_note_payload as pnp
    nodes, marks = gallery._address_rules()
    assert {"linkPreview", "webEmbed"} <= nodes and "link" in marks and not (nodes & marks)
    monkeypatch.setitem(pnp.NODE_POLICY, "secretMark", {"share": "mark", "publish": "mark", "gallery": "mark"})
    monkeypatch.setitem(pnp.EXAMPLE_OVERRIDES, "secretMark", "drop")
    nodes, marks = gallery._address_rules()
    assert "secretMark" in marks and "secretMark" not in nodes
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "words", "marks": [{"type": "secretMark", "attrs": {"v": CANARY}}]}]}]}
    out = gallery._without_links(doc)
    assert CANARY not in json.dumps(out) and "words" in json.dumps(out)


def test_a_purged_template_tool_that_is_made_again_is_created(db):
    """m1: a template routine deleted more than 30 days ago is PURGED and made anew by the store: `created`."""
    from datetime import datetime, timedelta, timezone
    gid, _s, _w = _template(db)
    a1 = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=str(uuid.uuid4()), conn=db)
    rid = a1["created"]["routines"][0]["id"]
    db.execute("UPDATE j2_routines SET deleted_at = ? WHERE id = ?",
               ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(), rid))
    db.commit()
    a2 = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, key=str(uuid.uuid4()), conn=db)
    assert a2["reused"]["routines"] == [] and len(a2["created"]["routines"]) == 1
    assert a2["created"]["routines"][0]["id"] != rid


def _live_notes(db):
    return db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL", (MEMBER,)).fetchone()[0]


def _all_notes(db):
    """Every note the member has, TRASHED INCLUDED (fix round 5, ruling W11-R41: a loser never inserts at all)."""
    return db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0]


def test_a_live_holder_taken_over_at_the_edge_never_makes_two_notes(db, monkeypatch):
    """m2, real threads: request A is inside its compose when its reservation is aged past the 60 s edge; request B
    (same key, its own connection) takes the key over and finishes. A's guard (under the write lock, before its
    INSERT) finds the key no longer its own: A inserts NOTHING, not even a trashed note (W11-R41), and answers B's
    note. One note in all, one answer. Control: aged to just under the edge, B does not
    take over (it is told the first request is on its way) and A's note is the key's."""
    from datetime import datetime, timedelta, timezone
    gid, _s, _w = _template(db)
    gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    monkeypatch.setattr(gallery, "_wait_for_key", lambda uid, key, timeout_s=15.0: None)
    real = js.create_styled_note
    for age, takeover in ((gallery.USE_RESERVATION_STALE_SECS + 1, True), (gallery.USE_RESERVATION_STALE_SECS - 5, False)):
        base, base_all = _live_notes(db), _all_notes(db)
        k = str(uuid.uuid4())
        inside, go = threading.Event(), threading.Event()

        def slow(user_id, payload, conn=None, _first=[], **kw):  # noqa: B006 -- one flag per round
            if threading.current_thread().name == "A" and not _first:
                _first.append(1)
                inside.set()
                go.wait(30)
            return real(user_id, payload, conn, **kw)
        monkeypatch.setattr(js, "create_styled_note", slow)
        out = {}

        def run(name):
            c = auth_db.get_connection()
            try:
                out[name] = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=c)
            except Exception as e:  # noqa: BLE001 -- asserted below
                out[name] = e
            finally:
                c.close()
        a = threading.Thread(target=run, args=("A",), name="A")
        a.start()
        assert inside.wait(30)
        db.execute("UPDATE j2_tool_create_keys SET created_at = ? WHERE user_id = ? AND key = ?",
                   ((datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat(), MEMBER, k))
        db.commit()
        b = threading.Thread(target=run, args=("B",), name="B")
        b.start()
        b.join(60)
        go.set()
        a.join(60)
        key_note = db.execute("SELECT new_id FROM j2_tool_create_keys WHERE user_id = ? AND key = ?",
                              (MEMBER, k)).fetchone()[0]
        assert _live_notes(db) - base == 1, (age, out)
        assert _all_notes(db) - base_all == 1, (age, out)            # W11-R41: the trash counts too
        assert not isinstance(out["A"], Exception), out["A"]
        if takeover:
            assert not isinstance(out["B"], Exception), out["B"]
            assert out["A"]["note"]["id"] == out["B"]["note"]["id"] == key_note and out["A"]["replayed"]
        else:
            assert isinstance(out["B"], gallery.GalleryConflict)
            assert out["A"]["note"]["id"] == key_note and not out["A"].get("replayed")
