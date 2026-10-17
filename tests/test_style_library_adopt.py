"""P3a Task 5: adopt a community style, notify-me, and the previewed additive update."""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _row, _style, api, conn, lib_on, listed_style  # noqa: F401  (fixtures + helpers)

URL = "/api/j2/template-gallery"


def _doc(*texts):
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": t}]} for t in texts]}


def _blk(block, **settings):
    return {"block": block, "enabled": True, "settings": settings}


def test_adopt_makes_the_members_own_copy_with_its_source(conn, lib_on):
    item = listed_style(conn)
    out = gallery.adopt_style("member", item["id"], notify=True, conn=conn)
    s = out["style"]
    assert s["sourceGalleryId"] == item["id"] and s["sourceVersion"] == 1
    assert s["kindId"] == "weekend_prep" and not s["builtin"]
    assert out["credit"] == f"Based on {item['author']}'s {item['title']}"
    row = conn.execute("SELECT notified_version FROM j2_gallery_watches WHERE gallery_id = ? AND user_id = ?",
                       (item["id"], "member")).fetchone()
    assert row["notified_version"] == 1


def test_adopt_counts_once_per_member_and_is_404_when_not_listed(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?",
                        (item["id"],)).fetchone()[0] == 1
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (item["id"],))
    conn.commit()
    assert gallery.adopt_style("member2", item["id"], notify=False, conn=conn) is None


def test_adopt_needs_the_journal_styles_switch(conn, lib_on, monkeypatch):
    item = listed_style(conn)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    assert str(e.value) == gallery.ADOPT_NEEDS_STYLES_SENTENCE
    assert conn.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = 'member'").fetchone()[0] == 0


def test_adopt_is_none_while_the_library_is_off(conn, lib_on, monkeypatch):
    item = listed_style(conn)
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert gallery.adopt_style("member", item["id"], notify=False, conn=conn) is None
    assert gallery.list_updates("member", conn=conn) == []


def test_an_outline_item_cannot_be_adopted_as_a_style(conn, lib_on):
    # The fixture empties the firm outlines, so insert one: the control is that it IS an outline row.
    gid = _row(conn, item_type="outline", status="approved", user_id="author", title="O")
    assert conn.execute("SELECT item_type FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0] == "outline"
    assert gallery.adopt_style("member", gid, notify=False, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = 'member'").fetchone()[0] == 0


def test_a_pending_or_rejected_style_cannot_be_adopted(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="T", description="", category="journal",
                                 trading_style=None, conn=conn)
    assert gallery.adopt_style("member", item["id"], notify=False, conn=conn) is None        # pending
    gallery.admin_act("admin", item["id"], "reject", note="Needs work", conn=conn)
    assert gallery.adopt_style("member", item["id"], notify=False, conn=conn) is None        # rejected


def _bump(conn, item, **style_patch):
    js.update_style("author", item["sourceStyleId"], style_patch, conn)
    gallery.publish_style("author", item["sourceStyleId"], title=item["title"], description="",
                          category="journal", trading_style=None, conn=conn)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)


def _hold(conn, item, **style_patch):
    """Resubmit WITHOUT approving: the revision is held, the listed version is unchanged."""
    js.update_style("author", item["sourceStyleId"], style_patch, conn)
    gallery.publish_style("author", item["sourceStyleId"], title=item["title"], description="",
                          category="journal", trading_style=None, conn=conn)


def test_list_updates_names_styles_behind_their_item(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    assert gallery.list_updates("member", conn=conn) == []
    _bump(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    ups = gallery.list_updates("member", conn=conn)
    assert [(u["styleId"], u["fromVersion"], u["toVersion"]) for u in ups] == [(mine["id"], 1, 2)]
    # adopted WITHOUT notify, and still listed: the notify choice is about alerts, not about this list
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_watches").fetchone()[0] == 0
    assert set(ups[0]) == {"galleryId", "title", "styleId", "styleName", "fromVersion", "toVersion"}
    # someone else's list is empty
    assert gallery.list_updates("stranger", conn=conn) == []


def test_list_updates_skips_a_deleted_copy_and_a_hidden_item(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    assert len(gallery.list_updates("member", conn=conn)) == 1
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (item["id"],))
    conn.commit()
    assert gallery.list_updates("member", conn=conn) == []
    conn.execute("UPDATE j2_template_gallery SET hidden = 0 WHERE id = ?", (item["id"],))
    conn.commit()
    js.delete_style("member", mine["id"], conn)
    assert gallery.list_updates("member", conn=conn) == []


def test_update_never_removes_or_reverts_member_edits(conn, lib_on):
    # (the brief wrote requireAll as a boolean; the block catalogue's options are the strings "no" / "yes")
    item = listed_style(conn, blocks=[{"block": "preEntryChecklist", "enabled": True,
                                       "settings": {"requireAll": "no"}}])
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    # the member removes the checklist, rewrites the outline
    edited = js.update_style("member", mine["id"], {
        "blocks": [], "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "my own words"}]}]}}, conn)
    _bump(conn, item, blocks=[{"block": "preEntryChecklist", "enabled": True, "settings": {"requireAll": "yes"}},
                              {"block": "myRules", "enabled": True, "settings": {}}])
    plan = gallery.plan_update("member", mine["id"], conn=conn)
    assert plan["addBlocks"] == ["myRules"]                 # the removed checklist is NOT re-added
    out = gallery.apply_update("member", mine["id"], take_outline=False,
                               base_updated_at=edited["updatedAt"], conn=conn)
    assert [b["block"] for b in out["blocks"]] == ["myRules"]
    assert "my own words" in json.dumps(out["outlineBodyJson"])
    assert out["sourceVersion"] == 2


def test_update_never_changes_a_block_the_member_already_has(conn, lib_on):
    item = listed_style(conn, blocks=[_blk("preEntryChecklist", requireAll="no")])
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    kept = js.update_style("member", mine["id"], {
        "blocks": [_blk("preEntryChecklist", requireAll="yes", includeRules="no")]}, conn)
    _bump(conn, item, blocks=[_blk("preEntryChecklist", requireAll="no", includeRules="yes"), _blk("myRules")])
    out = gallery.apply_update("member", mine["id"], take_outline=False,
                               base_updated_at=kept["updatedAt"], conn=conn)
    by_id = {b["block"]: b for b in out["blocks"]}
    assert by_id["preEntryChecklist"]["settings"] == {"requireAll": "yes", "includeRules": "no"}   # the member's own
    assert "myRules" in by_id                                                                      # control: it did add


def test_update_adds_missing_property_defaults_and_never_overwrites_the_members(conn, lib_on):
    item = listed_style(conn, properties={"builtin:confidence": "high"})
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    kept = js.update_style("member", mine["id"], {"properties": {"builtin:confidence": "low"}}, conn)
    _bump(conn, item, properties={"builtin:confidence": "high", "builtin:thesis_status": "active"})
    plan = gallery.plan_update("member", mine["id"], conn=conn)
    assert plan["addProperties"] == ["builtin:thesis_status"]
    out = gallery.apply_update("member", mine["id"], take_outline=False,
                               base_updated_at=kept["updatedAt"], conn=conn)
    assert out["properties"] == {"builtin:confidence": "low", "builtin:thesis_status": "active"}


def test_a_block_added_by_an_update_is_not_added_again_after_the_member_removes_it(conn, lib_on):
    # Every applied update rewrites source_block_ids, so the NEXT update still knows the member was offered it.
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[_blk("myRules")])
    first = gallery.apply_update("member", mine["id"], take_outline=False,
                                 base_updated_at=mine["updatedAt"], conn=conn)
    assert [b["block"] for b in first["blocks"]] == ["myRules"]
    assert json.loads(conn.execute("SELECT source_block_ids FROM j2_journal_styles WHERE id = ?",
                                   (mine["id"],)).fetchone()[0]) == ["myRules"]
    removed = js.update_style("member", mine["id"], {"blocks": []}, conn)
    _bump(conn, item, blocks=[_blk("myRules", which="all"), _blk("prepWire")])
    plan = gallery.plan_update("member", mine["id"], conn=conn)
    assert plan["addBlocks"] == ["prepWire"]                   # myRules was removed on purpose, so it stays removed
    out = gallery.apply_update("member", mine["id"], take_outline=False,
                               base_updated_at=removed["updatedAt"], conn=conn)
    assert [b["block"] for b in out["blocks"]] == ["prepWire"] and out["sourceVersion"] == 3


def test_adopt_records_the_block_ids_it_was_given(conn, lib_on):
    item = listed_style(conn, blocks=[_blk("myRules"), _blk("prepWire")])
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    raw = conn.execute("SELECT source_block_ids FROM j2_journal_styles WHERE id = ?", (mine["id"],)).fetchone()[0]
    assert json.loads(raw) == ["myRules", "prepWire"]


def test_update_takes_the_new_outline_only_when_asked(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, outlineBodyJson={"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "New plan"}]}]})
    out = gallery.apply_update("member", mine["id"], take_outline=True,
                               base_updated_at=mine["updatedAt"], conn=conn)
    assert "New plan" in json.dumps(out["outlineBodyJson"])


def test_update_keeps_the_outline_by_default(conn, lib_on):
    # The other half of the line above: the default (off) leaves the member's outline exactly as it is.
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, outlineBodyJson=_doc("New plan"))
    plan = gallery.plan_update("member", mine["id"], conn=conn)
    assert plan["outlineChanged"] is True and "New plan" in json.dumps(plan["newOutline"])
    out = gallery.apply_update("member", mine["id"], take_outline=False,
                               base_updated_at=mine["updatedAt"], conn=conn)
    assert "New plan" not in json.dumps(out["outlineBodyJson"])
    assert out["outlineBodyJson"] == mine["outlineBodyJson"] and out["sourceVersion"] == 2


def test_a_stale_update_is_refused(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[{"block": "myRules", "enabled": True, "settings": {}}])
    js.update_style("member", mine["id"], {"name": "Renamed"}, conn)
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.apply_update("member", mine["id"], take_outline=False,
                             base_updated_at=mine["updatedAt"], conn=conn)
    assert str(e.value) == gallery.UPDATE_STALE_SENTENCE
    # nothing was written: still version 1, no block added
    now = js.get_style("member", mine["id"], conn)
    assert now["sourceVersion"] == 1 and now["blocks"] == []
    with pytest.raises(gallery.GalleryConflict):          # no base named: nothing is applied unseen
        gallery.apply_update("member", mine["id"], take_outline=False, base_updated_at=None, conn=conn)


def test_there_is_no_plan_for_nothing_newer_or_a_style_that_is_not_an_adopted_copy(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    assert gallery.plan_update("member", mine["id"], conn=conn) is None               # up to date
    assert gallery.apply_update("member", mine["id"], take_outline=False,
                                base_updated_at=mine["updatedAt"], conn=conn) is None
    own = _style(conn, "member", name="Mine")
    assert gallery.plan_update("member", own["id"], conn=conn) is None                # not adopted
    _bump(conn, item, blocks=[_blk("myRules")])
    assert gallery.plan_update("stranger", mine["id"], conn=conn) is None             # not theirs
    assert gallery.plan_update("member", "builtin:weekend_prep", conn=conn) is None
    assert gallery.plan_update("member", mine["id"], conn=conn) is not None           # control: theirs, and newer


# ── Task 4 review warning, binding here: the LISTED version, never the held revision ─────

def test_adopt_reads_the_listed_version_not_a_held_revision(conn, lib_on):
    item = listed_style(conn, blocks=[_blk("myRules")], outlineBodyJson=_doc("Listed outline"))
    _hold(conn, item, blocks=[_blk("prepWire"), _blk("tradeReview")], outlineBodyJson=_doc("Held outline"))
    held = conn.execute("SELECT pending_json, version FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()
    assert held["pending_json"] and "Held outline" in held["pending_json"] and held["version"] == 1   # control: a revision IS held
    out = gallery.adopt_style("member", item["id"], notify=False, conn=conn)
    s = js.get_style("member", out["style"]["id"], conn)
    assert [b["block"] for b in s["blocks"]] == ["myRules"]
    assert "Listed outline" in json.dumps(s["outlineBodyJson"]) and "Held outline" not in json.dumps(s["outlineBodyJson"])
    assert s["sourceVersion"] == 1
    assert json.loads(conn.execute("SELECT source_block_ids FROM j2_journal_styles WHERE id = ?",
                                   (s["id"],)).fetchone()[0]) == ["myRules"]


def test_plan_and_apply_read_the_listed_version_not_a_held_revision(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[_blk("myRules")], outlineBodyJson=_doc("Version two"))           # listed: v2
    _hold(conn, item, blocks=[_blk("myRules"), _blk("prepWire")], outlineBodyJson=_doc("Held three"))
    assert conn.execute("SELECT pending_json FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()[0]
    plan = gallery.plan_update("member", mine["id"], conn=conn)
    assert (plan["toVersion"], plan["addBlocks"]) == (2, ["myRules"])
    assert "Version two" in json.dumps(plan["newOutline"]) and "Held three" not in json.dumps(plan["newOutline"])
    out = gallery.apply_update("member", mine["id"], take_outline=True,
                               base_updated_at=mine["updatedAt"], conn=conn)
    assert [b["block"] for b in out["blocks"]] == ["myRules"] and out["sourceVersion"] == 2
    assert "Version two" in json.dumps(out["outlineBodyJson"]) and "Held three" not in json.dumps(out["outlineBodyJson"])


# ── the schema ───────────────────────────────────────────────────────────────────────────

def _cols(c, table):
    return {r[1] for r in c.execute(f"PRAGMA table_info({table})")}


def test_the_watches_table_has_its_columns_and_key(conn):
    assert _cols(conn, "j2_gallery_watches") == {"gallery_id", "user_id", "style_id", "notified_version", "created_at"}
    pk = {r[1] for r in conn.execute("PRAGMA table_info(j2_gallery_watches)") if r[5]}
    assert pk == {"gallery_id", "user_id"}


def test_a_fresh_database_has_the_source_block_ids_column(conn):
    assert "source_block_ids" in _cols(conn, "j2_journal_styles")


def test_an_existing_styles_table_without_the_column_gains_it():
    # The CREATE TABLE body never reaches a table that already exists in production, so the column rides
    # a separate ALTER in _PHASE_2_ALTERS. A table made BEFORE it (the body as it stood) must gain it.
    from api.services.journal_two import db as jdb
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    try:
        legacy = next(s for s in jdb._PHASE_2_ALTERS if "CREATE TABLE IF NOT EXISTS j2_journal_styles" in s)
        c.execute(legacy)
        c.execute("INSERT INTO j2_journal_styles (id, user_id, name, kind_id, created_at, updated_at)"
                  " VALUES ('old', 'u', 'Old', 'weekend_prep', 'x', 'x')")
        c.commit()
        assert "source_block_ids" not in _cols(c, "j2_journal_styles")            # really a legacy table
        jdb.ensure_schema(c)
        assert "source_block_ids" in _cols(c, "j2_journal_styles")
        assert c.execute("SELECT source_block_ids FROM j2_journal_styles WHERE id = 'old'").fetchone()[0] is None
        jdb.ensure_schema(c)                                                      # and a second pass is a no-op
        assert c.execute("SELECT COUNT(*) FROM j2_journal_styles").fetchone()[0] == 1
    finally:
        c.close()


def test_a_copy_with_no_recorded_block_ids_is_offered_every_block_it_lacks(conn, lib_on):
    # A copy adopted before the column existed has NULL: the plan then offers every block it lacks,
    # which is the only safe reading of "we do not know what they were given".
    item = listed_style(conn, blocks=[_blk("myRules")])
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    conn.execute("UPDATE j2_journal_styles SET source_block_ids = NULL WHERE id = ?", (mine["id"],))
    conn.commit()
    js.update_style("member", mine["id"], {"blocks": []}, conn)
    _bump(conn, item, blocks=[_blk("myRules", which="all")])
    assert gallery.plan_update("member", mine["id"], conn=conn)["addBlocks"] == ["myRules"]


def test_the_author_and_an_admin_read_the_source_style_id_and_a_browsing_member_does_not(conn, lib_on):
    item = listed_style(conn)
    assert item["sourceStyleId"]                                                  # the helper read it as the author
    assert gallery.get_item("admin", item["id"], is_admin=True, conn=conn)["sourceStyleId"] == item["sourceStyleId"]
    assert "sourceStyleId" not in gallery.get_item("viewer", item["id"], conn=conn)
    assert "sourceStyleId" not in next(r for r in gallery.list_gallery("viewer", conn=conn) if r["id"] == item["id"])


def test_unpublishing_takes_the_watches_with_it(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("member", item["id"], notify=True, conn=conn)
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_watches").fetchone()[0] == 1
    assert gallery.unpublish("author", item["id"], conn=conn) is True
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_watches").fetchone()[0] == 0


def test_account_deletion_clears_a_members_watches_and_the_watches_on_a_leaving_authors_styles(conn, lib_on):
    # j2_gallery_watches is member data keyed by user_id, so it is in the account-purge manifest: the
    # leaving member's own watches go, and so do the OTHER members' watches on the leaving author's items
    # (those rows would point at nothing). A member who stays keeps theirs on someone else's item.
    from api.services.journal_two import account_purge as ap
    mine = listed_style(conn)
    other = listed_style(conn)                       # a second item, by the same author
    gallery.adopt_style("leaver", mine["id"], notify=True, conn=conn)
    gallery.adopt_style("stayer", mine["id"], notify=True, conn=conn)
    gallery.adopt_style("stayer", other["id"], notify=True, conn=conn)

    def watches():
        return {(r["gallery_id"], r["user_id"]) for r in conn.execute("SELECT gallery_id, user_id FROM j2_gallery_watches")}

    assert len(watches()) == 3                                                   # non-vacuity
    assert "j2_gallery_watches" in ap._DIRECT_USER_TABLES
    ap.purge_user_rows("leaver", conn)
    assert watches() == {(mine["id"], "stayer"), (other["id"], "stayer")}
    ap.purge_user_rows("author", conn)                                           # the author of both items
    assert watches() == set()


def test_a_repeat_adopt_with_notify_moves_the_watch_to_the_newest_copy(conn, lib_on):
    item = listed_style(conn)
    first = gallery.adopt_style("member", item["id"], notify=True, conn=conn)["style"]
    second = gallery.adopt_style("member", item["id"], notify=True, conn=conn)["style"]
    rows = conn.execute("SELECT style_id FROM j2_gallery_watches").fetchall()
    assert len(rows) == 1 and rows[0]["style_id"] == second["id"] != first["id"]


# ── the routes ───────────────────────────────────────────────────────────────────────────

def _as(api, user_id, plan="pro"):
    from api.middleware import auth_middleware as authmw
    user = {"id": user_id, "role": "member", "plan": plan}
    api.app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _used(user_id="member"):
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    return daily_counters.value(et_today(), "notebook_gallery_adopt", user_id)


def test_the_adopt_constants_are_the_ruled_values():
    from api.routers import notebook_template_gallery as r
    assert (r.ADOPT_RATE, r.SCOPE_ADOPT, r.DAILY_ADOPT_SCOPE) == (
        "30/hour", "notebook-gallery-adopt", "notebook_gallery_adopt")
    assert r.ADOPT_RATE_SENTENCE == "You've adopted a lot of styles today. Try again later."


def test_post_adopt_returns_the_style_notify_and_credit(api, conn, lib_on):
    item = listed_style(conn)
    _as(api, "member")
    r = api.post(f"{URL}/{item['id']}/adopt", json={"notify": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"style", "notify", "credit"} and body["notify"] is True
    assert body["style"]["sourceGalleryId"] == item["id"] and body["credit"].startswith("Based on ")
    # the body is optional: no notify means False
    again = api.post(f"{URL}/{item['id']}/adopt", json={})
    assert again.status_code == 200 and again.json()["notify"] is False


def test_post_adopt_refusals_give_the_daily_charge_back(api, conn, lib_on, monkeypatch):
    # R-P3-11: the durable daily count is charged before the work and handed back when it is refused.
    item = listed_style(conn)
    _as(api, "member")
    before = _used()
    ok = api.post(f"{URL}/{item['id']}/adopt", json={})
    assert ok.status_code == 200 and _used() == before + 1                    # non-vacuity: a success IS charged
    before = _used()
    assert api.post(f"{URL}/nope/adopt", json={}).status_code == 404          # not listed
    assert _used() == before
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (item["id"],))
    conn.commit()
    assert api.post(f"{URL}/{item['id']}/adopt", json={}).status_code == 404  # hidden
    assert _used() == before
    conn.execute("UPDATE j2_template_gallery SET hidden = 0 WHERE id = ?", (item["id"],))
    conn.commit()
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    refused = api.post(f"{URL}/{item['id']}/adopt", json={})
    assert refused.status_code == 409 and refused.json()["detail"] == gallery.ADOPT_NEEDS_STYLES_SENTENCE
    assert _used() == before                                                  # an error gave it back too


def test_post_adopt_with_a_bad_notify_is_refused_and_not_charged(api, conn, lib_on):
    item = listed_style(conn)
    _as(api, "member")
    before = _used()
    r = api.post(f"{URL}/{item['id']}/adopt", json={"notify": "yes"})
    assert r.status_code == 400
    assert _used() == before
    assert conn.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = 'member'").fetchone()[0] == 0


def test_adopt_is_rate_limited_in_process_per_hour(api, conn, lib_on, monkeypatch):
    from api.routers import notebook_template_gallery as router_mod
    monkeypatch.setenv("NOTEBOOK_GALLERY_ADOPT_DAILY_CAP", "1000")
    monkeypatch.setattr(router_mod, "ADOPT_RATE", "2/hour")
    item = listed_style(conn)
    _as(api, "member")
    codes = [api.post(f"{URL}/{item['id']}/adopt", json={}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_adopt_has_a_durable_daily_cap_that_outlives_the_process_limiter(api, conn, lib_on, monkeypatch):
    from api.limiter import limiter
    monkeypatch.setenv("NOTEBOOK_GALLERY_ADOPT_DAILY_CAP", "2")
    item = listed_style(conn)
    _as(api, "member")
    codes, last = [], None
    for _ in range(3):
        limiter.reset()                                                       # a deploy: the process limit is gone
        last = api.post(f"{URL}/{item['id']}/adopt", json={})
        codes.append(last.status_code)
    assert codes == [200, 200, 429]
    assert last.json()["detail"] == "You've adopted a lot of styles today. Try again later."
    assert _used() == 2                                                       # the refused one was never counted
    # the default cap is 50 a day
    monkeypatch.delenv("NOTEBOOK_GALLERY_ADOPT_DAILY_CAP")
    from api.routers import notebook_template_gallery as router_mod
    assert router_mod._cap("NOTEBOOK_GALLERY_ADOPT_DAILY_CAP", 50) == 50


def test_every_style_route_is_the_one_404_for_everyone_while_the_library_is_off(api, conn, lib_on, monkeypatch):
    # R-P3-10: gated by a ROUTE DEPENDENCY ahead of the plan check and the body, so a paid member, an
    # unpaid member and a signed-out caller with a malformed body all get the same 404.
    from api.middleware import auth_middleware as authmw
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[_blk("myRules")])
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    calls = (("GET", f"{URL}/updates"), ("GET", f"{URL}/updates/{mine['id']}"),
             ("POST", f"{URL}/updates/{mine['id']}"), ("POST", f"{URL}/{item['id']}/adopt"))
    for method, url in calls:
        _as(api, "member")
        paid = api.request(method, url, json={"takeOutline": False, "baseUpdatedAt": mine["updatedAt"]})
        _as(api, "member", plan="free")
        unpaid = api.request(method, url, json={})
        api.app.dependency_overrides.pop(authmw.get_current_user, None)
        api.app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)
        signed_out = api.request(method, url, content=b"{bad")
        assert (paid.status_code, unpaid.status_code, signed_out.status_code) == (404, 404, 404), (method, url)
        assert paid.json() == unpaid.json() == signed_out.json(), (method, url)
    assert _used() == 0                                                       # never charged
    assert js.get_style("member", mine["id"], conn)["sourceVersion"] == 1     # and the update did not run


def test_the_style_routes_need_a_paid_plan_while_the_library_is_on(api, conn, lib_on):
    item = listed_style(conn)
    _as(api, "member", plan="free")
    for method, url in (("GET", f"{URL}/updates"), ("GET", f"{URL}/updates/x"),
                        ("POST", f"{URL}/updates/x"), ("POST", f"{URL}/{item['id']}/adopt")):
        assert api.request(method, url, json={}).status_code == 402, (method, url)


def test_get_updates_is_not_answered_by_the_item_route(api, conn, lib_on):
    # `GET /{gallery_id}` exists and would take "/updates" as an id (answering the gallery's 404) if the
    # literal route were declared after it. The literal ones are declared first.
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[_blk("myRules")])
    _as(api, "member")
    r = api.get(f"{URL}/updates")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "template" not in body and [u["styleId"] for u in body["updates"]] == [mine["id"]]
    # non-vacuity: the item route still answers a real id
    assert api.get(f"{URL}/{item['id']}").json()["template"]["id"] == item["id"]
    # the same order guards the other literals: /updates/{id} is the plan, not an item
    assert api.get(f"{URL}/updates/{mine['id']}").status_code == 200


def test_get_updates_style_id_returns_the_plan_or_404(api, conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _as(api, "member")
    assert api.get(f"{URL}/updates/{mine['id']}").status_code == 404          # nothing newer
    _bump(conn, item, blocks=[_blk("myRules")])
    r = api.get(f"{URL}/updates/{mine['id']}")
    assert r.status_code == 200
    plan = r.json()["plan"]
    assert (plan["galleryId"], plan["fromVersion"], plan["toVersion"], plan["addBlocks"]) == (
        item["id"], 1, 2, ["myRules"])
    _as(api, "stranger")
    assert api.get(f"{URL}/updates/{mine['id']}").status_code == 404          # not theirs
    assert api.get(f"{URL}/updates/does-not-exist").status_code == 404


def test_post_updates_style_id_applies_and_a_stale_base_is_409(api, conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[_blk("myRules")])
    _as(api, "member")
    stale = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": "1999-01-01"})
    assert stale.status_code == 409 and stale.json()["detail"] == gallery.UPDATE_STALE_SENTENCE
    missing = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False})
    assert missing.status_code == 409
    ok = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": mine["updatedAt"]})
    assert ok.status_code == 200, ok.text
    style = ok.json()["style"]
    assert [b["block"] for b in style["blocks"]] == ["myRules"] and style["sourceVersion"] == 2
    # nothing newer now: 404
    again = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": style["updatedAt"]})
    assert again.status_code == 404


def test_post_updates_style_id_refuses_a_bad_take_outline(api, conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _bump(conn, item, blocks=[_blk("myRules")])
    _as(api, "member")
    r = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": "yes", "baseUpdatedAt": mine["updatedAt"]})
    assert r.status_code == 400
    assert js.get_style("member", mine["id"], conn)["sourceVersion"] == 1
