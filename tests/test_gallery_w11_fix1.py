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
    AUTHOR, MEMBER, NOW, OTHER, approve, built, counts, db, heading, list_template, list_tool, para, routine,
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


def test_a_template_made_tool_records_no_use_day(db):
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

def test_a_routine_update_keeps_every_unchanged_item_and_its_ticks(db):
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
