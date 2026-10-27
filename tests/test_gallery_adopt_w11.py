"""Task 11.8: adopting and using widgets, routines, trackers and templates; taking a library update; use-days.

* `adopt_tool`: a listed widget becomes a revision-1 definition with its source (its plan resolved with the
  member's answers); a routine and a tracker become the member's own, made from the listed structure.
* Every choice answered, every answered row the member's own, else nothing is written.
* A template's adoption rewrites every inline ref in ONE transaction with the copy, the credits, the use and the
  watch; a count cap rolls it all back with the store's own sentence (409 `count_cap`).
* `use_library_template` reuses the member's newest copy (W11-R4) and asks only for what the copy does not yet
  remember; two Uses at once make one copy, one routine and two notes (Review Focus 2).
* `update_tool` takes the LISTED version (never `pending_json`) as a new revision; placements keep their pin.
* W11-R11 use-days: one row per ET day, never for the author's own item.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import journal_styles as js
from api.services.journal_two import routines, slot_fill, template_gallery as gallery, trackers
from api.services.journal_two import widget_definitions as wd
from api.services.journal_two.widget_engine import run, share
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    AUTHOR, MEMBER, NOW, OTHER, SETUP_PLAN, approve, built, counts, db, heading, list_template, list_tool, para,
    pin_clock, routine, routine_edits, routine_slot, style, tracker, tracker_slot, widget,
)
from tests.test_widget_sources import add_account

ACCOUNT_PLAN = {"v": 1, "source": "closed_trades", "accounts": {"id": "acc-author"},
                "filters": [{"field": "setup", "op": "in", "values": ["Flag"]}],
                "measures": [{"key": "trades"}], "range": {"token": "all"}}


def _plan_of(def_id, uid=MEMBER):
    return wd.get(uid, def_id)


# ── tools ──────────────────────────────────────────────────────────────────────────────────────────

def test_adopt_widget_creates_rev_one_copy_with_source(db):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    out = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, notify=True, conn=db)
    assert set(out) == {"kind", "id", "credit"} and out["kind"] == "widget"
    title = db.execute("SELECT title FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0]
    assert out["credit"] == f"Based on Sam's {title}"
    copy = wd.get(MEMBER, out["id"], conn=db)
    assert copy["rev"] == 1 and copy["placedRev"] == 1
    assert copy["sourceGalleryId"] == gid and copy["sourceVersion"] == 1
    assert copy["plan"]["filters"][0]["values"] == ["Flag"]               # the member's own answer, never the author's
    assert db.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?", (gid,)).fetchone()[0] == 1
    watch = db.execute("SELECT style_id, notified_version FROM j2_gallery_watches WHERE gallery_id = ? AND"
                       " user_id = ?", (gid, MEMBER)).fetchone()
    assert (watch["style_id"], watch["notified_version"]) == (out["id"], 1)
    credit = db.execute("SELECT tool_kind, gallery_id, title, source_version FROM j2_gallery_credits"
                        " WHERE user_id = ? AND tool_id = ?", (MEMBER, out["id"])).fetchone()
    assert tuple(credit) == ("widget", gid, title, 1)


def test_adopt_routine_and_tracker_copies(db):
    r, t = routine(db), tracker(db, kind="number", unit="hrs")
    gr = list_tool(db, "routine", r["id"], edits={"name": "Morning", "items": ["Coffee", "Read the plan"]})
    gt = list_tool(db, "tracker", t["id"], edits={"name": "Sleep", "unit": "hours"})
    ro = gallery.adopt_tool(MEMBER, gr, conn=db)
    to = gallery.adopt_tool(MEMBER, gt, conn=db)
    mine_r = routines.get(MEMBER, ro["id"], conn=db)
    mine_t = trackers.get(MEMBER, to["id"], conn=db)
    assert mine_r["name"] == "Morning" and [i["text"] for i in mine_r["items"]] == ["Coffee", "Read the plan"]
    assert mine_r["schedule"] == {"kind": "every"}
    assert (mine_t["name"], mine_t["kind"], mine_t["unit"]) == ("Sleep", "number", "hours")
    for table, tid, gid in (("j2_routines", ro["id"], gr), ("j2_trackers", to["id"], gt)):
        assert db.execute(f"SELECT source_gallery_id FROM {table} WHERE id = ?", (tid,)).fetchone()[0] == gid
    assert ro["credit"] == "Based on Sam's Morning" and to["credit"] == "Based on Sam's Sleep"
    # a pending or hidden listing cannot be adopted; nor can a style be through this door
    db.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (gr,))
    db.commit()
    assert gallery.adopt_tool(OTHER, gr, conn=db) is None


def test_unresolved_refused_and_nothing_written(db):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    before = counts(db)
    with pytest.raises(share.ShareError) as e:
        gallery.adopt_tool(MEMBER, gid, answers={}, conn=db)
    assert e.value.code == "unresolved" and getattr(e.value, "slot", None) == "p1"
    assert counts(db) == before


def test_foreign_answer_refused_and_nothing_written(db):
    acc = add_account(db, AUTHOR, "Author IRA")
    w = widget(db, plan={**ACCOUNT_PLAN, "accounts": {"id": acc}})
    gid = list_tool(db, "widget", w["id"])
    foreign = add_account(db, OTHER, "Other's")
    mine = add_account(db, MEMBER, "Mine")
    slots = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                  (gid,)).fetchone()[0])["slots"]
    acc_slot = next(s["id"] for s in slots if s["type"] == "account")
    other = next(s["id"] for s in slots if s["type"] != "account")
    before = counts(db)
    with pytest.raises(share.ShareError) as e:
        gallery.adopt_tool(MEMBER, gid, answers={acc_slot: foreign, other: "Flag"}, conn=db)
    assert (e.value.code, e.value.sentence, e.value.slot) == ("not_yours", gallery.S_CHOICE_NOT_YOURS, acc_slot)
    assert counts(db) == before
    # control: the member's own account is taken
    out = gallery.adopt_tool(MEMBER, gid, answers={acc_slot: mine, other: "Flag"}, conn=db)
    assert wd.get(MEMBER, out["id"], conn=db)["plan"]["accounts"] == {"id": mine}


# ── templates ──────────────────────────────────────────────────────────────────────────────────────

def _template_listing(db):
    w1, w2 = widget(db), widget(db, name="Second")
    r, t = routine(db), tracker(db)
    s = style(db, blocks=[built("a", w1["id"]), built("b", w2["id"]), routine_slot("a", r["id"]),
                          tracker_slot("a", t["id"])])
    return list_template(db, s["id"], edits={"blocks": {"routine_a": {"items": ["Coffee", "Mark levels"]}}})


def test_template_adopt_rewrites_every_inline_ref_in_one_transaction(db, monkeypatch):
    gid = _template_listing(db)
    before = counts(db)
    # a failure injected after the SECOND definition is written rolls everything back
    real = wd.create
    made = []

    def failing(*a, **kw):
        out = real(*a, **kw)
        made.append(out["id"])
        if len(made) == 2:
            raise RuntimeError("boom after the second definition")
        return out
    monkeypatch.setattr(wd, "create", failing)
    with pytest.raises(RuntimeError):
        gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, notify=True,
                            choices={"routine_a": {"create": True}, "tracker_a": {"create": True}}, conn=db)
    assert len(made) == 2 and counts(db) == before
    # ... and one at the very end (after the copy, the credits and the use): the same
    monkeypatch.setattr(wd, "create", real)
    real_watch_use = gallery._record_use

    def failing_use(*a, **kw):
        real_watch_use(*a, **kw)
        raise RuntimeError("boom after the use")
    monkeypatch.setattr(gallery, "_record_use", failing_use)
    with pytest.raises(RuntimeError):
        gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, notify=True, conn=db)
    assert counts(db) == before
    monkeypatch.setattr(gallery, "_record_use", real_watch_use)
    # the real one: every inline ref is the member's own row now
    out = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, notify=True,
                              choices={"routine_a": {"create": True}}, conn=db)
    raw = json.loads(db.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ?",
                                (out["style"]["id"],)).fetchone()[0])
    refs = {b["block"]: b["settings"] for b in raw}
    assert refs["built_a"]["ref"].startswith("def:") and refs["built_a"]["defRev"] == 1
    assert refs["built_b"]["ref"].startswith("def:") and refs["built_b"]["ref"] != refs["built_a"]["ref"]
    assert refs["routine_a"]["ref"].startswith("routine:") and refs["tracker_a"]["ref"].startswith("tracker:")
    assert "inline" not in json.dumps(raw)
    assert {k: len(v) for k, v in out["created"].items()} == {"widgets": 2, "routines": 1, "trackers": 1}
    for d in out["created"]["widgets"]:
        assert wd.get(MEMBER, d["id"], conn=db)["sourceGalleryId"] == gid
    rid = refs["routine_a"]["ref"][len("routine:"):]
    assert routines.get(MEMBER, rid, conn=db)["settings"]["fromTemplate"] == "Setup study"
    kinds = sorted(r_[0] for r_ in db.execute("SELECT tool_kind FROM j2_gallery_credits WHERE user_id = ?",
                                              (MEMBER,)))
    assert kinds == ["routine", "template", "tracker", "widget", "widget"]
    assert db.execute("SELECT COUNT(*) FROM j2_gallery_watches WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    assert "slotNames" in out["style"]                       # served with the member context (11.5 carry)


def test_use_your_own_routine_is_checked_as_yours(db):
    gid = _template_listing(db)
    foreign = routine(db, uid=OTHER)["id"]
    before = counts(db)
    with pytest.raises(share.ShareError) as e:
        gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices={"routine_a": {"use": foreign}}, conn=db)
    assert (e.value.code, e.value.slot) == ("not_yours", "routine_a")
    assert counts(db) == before
    own = routine(db, uid=MEMBER, name="My morning")["id"]
    out = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices={"routine_a": {"use": own}}, conn=db)
    raw = json.loads(db.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ?",
                                (out["style"]["id"],)).fetchone()[0])
    assert {b["block"]: b["settings"] for b in raw}["routine_a"]["ref"] == f"routine:{own}"
    assert out["created"]["routines"] == []


def test_an_invalid_legacy_family_block_is_filtered_never_refused(db):
    """11.3 c3: a stored listing holding a family block the grammar refuses is adopted without it."""
    gid = _template_listing(db)
    payload = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                    (gid,)).fetchone()[0])
    payload["blocks"].append({"block": "built_z", "enabled": True, "settings": {"ref": "nope"}})
    payload["blocks"].append({"block": "routine_z", "enabled": True,
                              "settings": {"ref": f"routine:{uuid.uuid4()}"}})          # a member id: never shared
    db.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(payload), gid))
    db.commit()
    out = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, conn=db)
    ids = [b["block"] for b in json.loads(db.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ?",
                                                     (out["style"]["id"],)).fetchone()[0])]
    assert "built_z" not in ids and "routine_z" not in ids and "built_a" in ids


def test_count_cap_rolls_back_with_store_sentence(db, monkeypatch):
    gid = _template_listing(db)
    monkeypatch.setattr(wd, "COUNT_CAP", 1)          # the first inline widget fits, the second does not
    before = counts(db)
    with pytest.raises(gallery.CountCapError) as e:
        gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices={"routine_a": {"create": True}}, conn=db)
    assert (e.value.status, e.value.code, e.value.sentence) == (409, "count_cap", wd.S_CAP)
    assert counts(db) == before
    monkeypatch.setattr(wd, "COUNT_CAP", 100)
    monkeypatch.setattr(routines, "COUNT_CAP", 0)    # the routine store's own cap, its own sentence
    with pytest.raises(gallery.CountCapError) as e:
        gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, choices={"routine_a": {"create": True}}, conn=db)
    assert e.value.sentence == routines.S_CAP and counts(db) == before


def test_adopt_while_w11_off_unsupported(db, monkeypatch):
    gid = _template_listing(db)
    w = widget(db)
    gw = list_tool(db, "widget", w["id"])
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "0")
    before = counts(db)
    with pytest.raises(gallery.GalleryError) as e:
        gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, conn=db)
    assert str(e.value) == gallery.ADOPT_UNSUPPORTED_SENTENCE
    assert gallery.adopt_tool(MEMBER, gw, answers={"p1": "Flag"}, conn=db) is None
    assert gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, payload={}, conn=db) is None
    assert counts(db) == before
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "1")
    assert gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, conn=db) is not None      # control


# ── use (a note) ───────────────────────────────────────────────────────────────────────────────────

def _official(db, *, title="Pre-market prep"):
    payload = {"kindId": "weekend_prep", "format": 2, "name": title, "description": "",
               "outlineBodyJson": {"type": "doc", "content": [heading("Prep"), para("{{block:routine_a}}")]},
               "blocks": [{"block": "routine_a", "enabled": True,
                           "settings": {"template": "morning_routine", "bind": "note-day", "display": "items"}}],
               "properties": {}, "definitions": [], "routines": [], "trackers": [], "slots": []}
    gid = uuid.uuid4().hex
    db.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
               " listed_at, created_at, updated_at, preview_json, item_type, payload_json, version)"
               " VALUES (?, NULL, 'official', ?, '', 'journal', '{}', 'approved', 'x', 'x', 'x', '[]', 'style', ?, 1)",
               (gid, title, json.dumps(payload)))
    db.commit()
    return gid


def _routine_ids_in_notes(db):
    out = []
    for (body,) in db.execute("SELECT body_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL", (MEMBER,)):
        stack = [json.loads(body)]
        while stack:
            n = stack.pop()
            if isinstance(n, dict):
                attrs = n.get("attrs") or {}
                if n.get("type") == "widgetEmbed" and attrs.get("widgetId") == "routine":
                    out.append((attrs.get("params") or {}).get("routineId"))
                stack.extend(n.get("content") or [])
    return out


def test_use_reuses_the_copy_and_asks_only_unremembered(db):
    gid = _official(db)
    first = gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}},
                                         payload={"title": "Monday prep"}, conn=db)
    assert set(first) == {"note", "skipped", "style", "credit", "created", "reused"}   # fix round 3 (M-3)
    assert first["credit"] == "Based on UCT's Pre-market prep"
    assert len(first["created"]["routines"]) == 1
    copy = js.get_style(MEMBER, first["style"]["id"], db, full=True)
    assert copy["sourceGalleryId"] == gid
    assert slot_fill.tool_questions(copy, user_id=MEMBER, conn=db) == []      # remembered: nothing left to ask
    second = gallery.use_library_template(MEMBER, gid, choices={}, payload={}, conn=db)
    assert second["style"]["id"] == first["style"]["id"]                       # the copy is reused (W11-R4)
    assert second["created"] == {"widgets": [], "routines": [], "trackers": []}
    assert db.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ?",
                      (MEMBER, gid)).fetchone()[0] == 1
    ids = _routine_ids_in_notes(db)
    assert len(ids) == 2 and len(set(ids)) == 1                                # two notes, one routine


def test_adopt_template_is_a_copy_and_use_is_a_note(db):
    """W11-R25b: Adopt makes a copy and no note; Use makes a note (from that copy)."""
    gid = _official(db)
    gallery.adopt_template(MEMBER, gid, conn=db)
    assert db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 0
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}}, payload={}, conn=db)
    assert db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ?",
                      (MEMBER, gid)).fetchone()[0] == 1           # the Use reused the adopted copy


def test_two_uses_at_once_one_copy_one_routine_two_notes(db):
    """Review Focus 2, with REAL concurrency: two threads, each its own connection, press Use together."""
    gid = _official(db)
    barrier = threading.Barrier(2)
    results, errors = [], []

    def press():
        c = auth_db.get_connection()
        try:
            barrier.wait()
            results.append(gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}},
                                                        payload={}, conn=c))
        except Exception as e:  # noqa: BLE001 -- the assertion below names it
            errors.append(e)
        finally:
            c.close()
    threads = [threading.Thread(target=press) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert errors == [] and len(results) == 2
    assert db.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ?",
                      (MEMBER, gid)).fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    ids = _routine_ids_in_notes(db)
    assert len(ids) == 2 and len(set(ids)) == 1 and ids[0]


# ── updates ────────────────────────────────────────────────────────────────────────────────────────

def _rerange(db, def_id, token):
    cur = wd.get(AUTHOR, def_id, conn=db)
    wd.update(AUTHOR, def_id, if_match=cur["etag"], plan={**cur["plan"], "range": {"token": token}},
              apply="update_all", conn=db)


def test_update_tool_new_revision_placements_unchanged(db):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    mine = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, conn=db)["id"]
    assert gallery.update_tool(MEMBER, "widget", mine, answers={"p1": "Flag"}, conn=db) is None   # nothing newer
    _rerange(db, w["id"], "last_90d")
    gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)
    approve(db, gid)                                                               # v2 listed
    facts = gallery.library_facts(MEMBER, "widget", [mine], conn=db)[mine]
    assert facts["updateAvailable"] is True and facts["sourceGalleryId"] == gid
    out = gallery.update_tool(MEMBER, "widget", mine, answers={"p1": "Flag"}, conn=db)
    assert out["version"] == 2
    got = wd.get(MEMBER, mine, conn=db)
    assert got["rev"] == 2 and got["placedRev"] == 1                               # placements keep their pin
    assert got["plan"]["range"] == {"token": "last_90d"}
    assert gallery.library_facts(MEMBER, "widget", [mine], conn=db)[mine]["updateAvailable"] is False
    assert gallery.update_tool(MEMBER, "widget", mine, answers={"p1": "Flag"}, conn=db) is None


def test_update_reads_listed_never_pending(db):
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    mine = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, notify=True, conn=db)["id"]
    _rerange(db, w["id"], "last_90d")
    gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)
    approve(db, gid)                                                               # v2: last_90d, listed
    _rerange(db, w["id"], "ytd")
    gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)                       # v3: ytd, HELD (unreviewed)
    assert db.execute("SELECT pending_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0]
    gallery.update_tool(MEMBER, "widget", mine, answers={"p1": "Flag"}, conn=db)
    assert wd.get(MEMBER, mine, conn=db)["plan"]["range"] == {"token": "last_90d"}
    assert db.execute("SELECT notified_version FROM j2_gallery_watches WHERE user_id = ?",
                      (MEMBER,)).fetchone()[0] == 2


def test_update_routine_and_tracker_copies(db):
    r, t = routine(db), tracker(db, kind="number")
    gr = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee", "Mark levels"))
    gt = list_tool(db, "tracker", t["id"], edits={"name": "Sleep", "unit": "hrs"})
    mr = gallery.adopt_tool(MEMBER, gr, conn=db)["id"]
    mt = gallery.adopt_tool(MEMBER, gt, conn=db)["id"]
    gallery.publish_tool(AUTHOR, "routine", r["id"], edits=routine_edits("Coffee", "Read the news"), conn=db)
    approve(db, gr)
    gallery.publish_tool(AUTHOR, "tracker", t["id"], edits={"name": "Sleep hours", "unit": "h"}, conn=db)
    approve(db, gt)
    assert gallery.library_facts(MEMBER, "routine", [mr], conn=db)[mr]["updateAvailable"] is True
    gallery.update_tool(MEMBER, "routine", mr, conn=db)
    gallery.update_tool(MEMBER, "tracker", mt, conn=db)
    assert [i["text"] for i in routines.get(MEMBER, mr, conn=db)["items"]] == ["Coffee", "Read the news"]
    got = trackers.get(MEMBER, mt, conn=db)
    assert (got["name"], got["unit"]) == ("Sleep hours", "h")
    # a kind change refuses with the tracker store's own sentence, and changes nothing
    payload = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?", (gt,)).fetchone()[0])
    db.execute("UPDATE j2_template_gallery SET payload_json = ?, version = 3 WHERE id = ?",
               (json.dumps({**payload, "kind": "yesno"}), gt))
    db.commit()
    with pytest.raises(trackers.TrackerError) as e:
        gallery.update_tool(MEMBER, "tracker", mt, conn=db)
    assert e.value.sentence == trackers.S_KIND_FIXED
    assert trackers.get(MEMBER, mt, conn=db)["kind"] == "number"


def test_a_template_update_never_adds_a_shared_slot_to_the_members_style(db):
    """W11-R2: the P3a additive update ("Update my copy") adds a newer version's NON-slot blocks only; an `inline:`
    slot of a shared payload never lands in a member's own style."""
    gid = _template_listing(db)
    mine = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, conn=db)["style"]["id"]
    payload = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                    (gid,)).fetchone()[0])
    payload["blocks"] += [{"block": "built_x", "enabled": True, "settings": {"ref": "inline:d1"}},
                          {"block": "chart", "enabled": True, "settings": {"tf": "W"}}]
    db.execute("UPDATE j2_template_gallery SET payload_json = ?, version = 2 WHERE id = ?", (json.dumps(payload), gid))
    db.commit()
    plan = gallery.plan_update(MEMBER, mine, conn=db)
    assert plan["addBlocks"] == ["chart"]


def test_an_update_rings_a_tool_watcher_with_a_my_tools_link(db, monkeypatch):
    rung = []
    monkeypatch.setattr(gallery, "_ring", lambda uid, title, msg, data: rung.append((uid, data)) or True)
    w = widget(db)
    gid = list_tool(db, "widget", w["id"])
    mine = gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"}, notify=True, conn=db)["id"]
    gallery.adopt_tool(OTHER, gid, answers={"p1": "Flag"}, notify=False, conn=db)
    _rerange(db, w["id"], "last_90d")
    gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)
    approve(db, gid)
    assert rung == [(MEMBER, {"research_url": f"/journal/notebook?tools=widget&libraryUpdate={mine}",
                              "galleryId": gid, "version": 2, "copyId": mine})]


# ── use-days (W11-R11) ─────────────────────────────────────────────────────────────────────────────

def _days(db, uid=MEMBER):
    return sorted(r_[0] for r_ in db.execute("SELECT day FROM j2_gallery_use_days WHERE user_id = ?", (uid,)))


def test_use_day_recorded_once_per_et_day_and_never_for_author(db, monkeypatch):
    pin_clock(monkeypatch)                     # W11-R74: the copy's items are valid from NOW's ET day
    r = routine(db)
    gr = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee"))
    mine = gallery.adopt_tool(MEMBER, gr, conn=db)["id"]
    item = routines.get(MEMBER, mine, conn=db)["items"][0]["id"]
    late = datetime(2026, 10, 27, 3, 30, tzinfo=timezone.utc)                # Mon 23:30 ET
    routines.set_tick(MEMBER, mine, "2026-10-26", item, True, now=late, conn=db)
    routines.set_tick(MEMBER, mine, "2026-10-26", item, False, now=late, conn=db)   # the same day again: one row
    early = datetime(2026, 10, 27, 4, 30, tzinfo=timezone.utc)               # Tue 00:30 ET
    routines.set_skipped(MEMBER, mine, "2026-10-27", True, now=early, conn=db)
    assert _days(db) == ["2026-10-26", "2026-10-27"]
    # the author's own routine (not a copy) records nothing, ticked any day
    routines.set_tick(AUTHOR, r["id"], "2026-10-26", routines.get(AUTHOR, r["id"], conn=db)["items"][0]["id"], True,
                      now=late, conn=db)
    assert _days(db, AUTHOR) == []
    # the author adopting their OWN listing: still never a use day for them
    own_copy = gallery.adopt_tool(AUTHOR, gr, conn=db)["id"]
    routines.set_tick(AUTHOR, own_copy, "2026-10-26", routines.get(AUTHOR, own_copy, conn=db)["items"][0]["id"],
                      True, now=late, conn=db)
    assert _days(db, AUTHOR) == []


def test_tracker_logs_and_widget_runs_record_use_days(db):
    t = tracker(db, kind="number")
    gt = list_tool(db, "tracker", t["id"])
    mt = gallery.adopt_tool(MEMBER, gt, conn=db)["id"]
    trackers.set_value(MEMBER, mt, "2026-10-26", 7, now=NOW, conn=db)
    assert db.execute("SELECT item_id, day FROM j2_gallery_use_days WHERE user_id = ?", (MEMBER,)).fetchall()[0][:] \
        == (gt, "2026-10-26")
    w = widget(db)
    gw = list_tool(db, "widget", w["id"])
    mw = gallery.adopt_tool(MEMBER, gw, answers={"p1": "Flag"}, conn=db)["id"]
    plan = wd.get(MEMBER, mw, conn=db)["plan"]
    run.run_plan(MEMBER, plan, {}, lane="preview", def_id=mw, now=NOW)          # a preview is never a use
    assert db.execute("SELECT COUNT(*) FROM j2_gallery_use_days WHERE item_id = ?", (gw,)).fetchone()[0] == 0
    run.run_plan(MEMBER, plan, {}, lane="run", def_id=mw, def_rev=1, now=NOW)
    assert db.execute("SELECT day FROM j2_gallery_use_days WHERE item_id = ?", (gw,)).fetchall()[0][0] == "2026-10-26"
