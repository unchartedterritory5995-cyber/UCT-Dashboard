"""Notebook widgets wave 11, Task 11.7: the three tool item types, the official-row rule, the tool source key and
the template library's three member tables (storage only).

* The tool types (`widget_definition`, `routine`, `tracker`) read as ABSENT from every gallery read while the library
  switch or wave 11 is off -- the list (and a type filter naming one), `GET /{id}` for anyone (author and admin
  included), Helpful, report and the author page -- and are back, unchanged, when wave 11 is armed again.
* Official rows (`kind = 'official'`, W11-R4) and firm rows read as `"UCT"` (`FIRM_AUTHOR`). The visibility half of the
  official rule is the equality rail in tests/test_firm_style_seed.py (`test_official_rows_one_rule_two_renderings`).
* One live listing per (author, tool type, tool): the partial unique index on `source_tool_id`.
* `j2_gallery_use_days`, `j2_gallery_credits` and `j2_gallery_helpful_prompts` are created by `db.ensure_schema`,
  carry `user_id`, are purged with the account (the schema-derived rail names them) and replay from a tombstone.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import account_purge as ap
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _row, _style, conn, lib_on  # noqa: F401  (fixtures + helpers)
from tests.test_account_tombstones import GONE, KEPT, authdb  # noqa: F401  (fixture + ids)
from tests import test_account_deletion_manifest as manifest_rail

W11 = "NOTEBOOK_WIDGETS_W11_ENABLED"
NEW_TABLES = ("j2_gallery_use_days", "j2_gallery_credits", "j2_gallery_helpful_prompts")


def test_the_tool_types_are_the_ruled_three_in_order():
    assert gallery.TOOL_ITEM_TYPES == ("widget_definition", "routine", "tracker")
    assert gallery.ITEM_TYPES == ("outline", "style", gallery.EXAMPLE_ITEM, gallery.LAYOUT_ITEM, *gallery.TOOL_ITEM_TYPES)
    assert set(gallery.TOOL_ITEM_TYPES) <= set(gallery.LISTED_ITEM_TYPES)       # listable once wave 11 is on


# ── the tool types are absent while wave 11 is off ─────────────────────────────────────────────────

def _reads(conn, gid: str, item_type: str, handle: str, report_id: str, title: str) -> dict[str, bool]:
    """Every door a tool row can be reached through, each answering "present?": the viewer's list, type filter,
    search and feed; the author's own "mine"; every single read (a hidden type is absent for its author and an admin
    too); Helpful and report; the author page's items AND its count; the admin queue, an admin act and an admin
    report act. `/use` is not here: it refuses a tool row in every state (`test_use_refuses_every_tool_type`).
    Evaluated in this order, so the queue is read before the report act closes the report."""
    def _filtered() -> bool:
        try:
            return gid in {x["id"] for x in gallery.list_gallery("viewer", item_type=item_type, conn=conn)}
        except gallery.GalleryError as e:
            assert str(e) == "Unknown item type."
            return False
    page = gallery.author_page("viewer", handle, conn=conn)
    queue = gallery.admin_queue(conn=conn)
    return {
        "list": gid in {x["id"] for x in gallery.list_gallery("viewer", conn=conn)},
        "list_by_type": _filtered(),
        "search": gid in {x["id"] for x in gallery.list_gallery("viewer", q=title, conn=conn)},
        "mine": gid in {x["id"] for x in gallery.list_gallery("author", section="mine", conn=conn)},
        "feed": gid in {x["id"] for x in gallery.feed("viewer", conn=conn)},
        "get": gallery.get_item("viewer", gid, conn=conn) is not None,
        "get_author": gallery.get_item("author", gid, conn=conn) is not None,
        "get_admin": gallery.get_item("admin", gid, is_admin=True, conn=conn) is not None,
        "helpful": gallery.set_helpful("viewer", gid, True, conn=conn) is not None,
        "report": gallery.report("viewer", gid, reason="broken", conn=conn) is not None,
        "author_page": page is not None and gid in {x["id"] for x in page["items"]},
        "author_page_count": page is not None and page["author"]["itemCount"] == 1,
        "admin_queue": gid in {x["id"] for x in queue["reported"]},
        "admin_act": gallery.admin_act("admin", gid, "feature", conn=conn) is not None,
        "admin_report_act": gallery.admin_report_act("admin", report_id, "dismiss", conn=conn),
    }


def _open_report(conn, gid: str) -> str:
    """An open report on `gid` from a third member, written directly (a probe), for the admin doors."""
    rid = f"rep-{gid}"
    conn.execute("INSERT INTO j2_template_gallery_reports (id, gallery_id, user_id, reason, note, status, created_at)"
                 " VALUES (?, ?, 'reporter', 'broken', '', 'open', 'x')", (rid, gid))
    conn.commit()
    return rid


@pytest.mark.parametrize("item_type", gallery.TOOL_ITEM_TYPES)
def test_tool_types_hidden_while_w11_off_and_listed_when_on(conn, lib_on, monkeypatch, item_type):
    title = f"My {item_type}"
    gid = _row(conn, item_type=item_type, user_id="author", title=title)
    handle = gallery.author_handle("author", conn)
    assert gallery.set_follow("viewer", handle, True, conn=conn) == {"following": True}
    rid = _open_report(conn, gid)
    monkeypatch.setenv(W11, "0")
    assert item_type in gallery._hidden_item_types()
    off = _reads(conn, gid, item_type, handle, rid, title)
    assert off == {k: False for k in off}, off
    # stored, never deleted: the row is exactly where it was
    assert conn.execute("SELECT item_type, status FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[:] \
        == (item_type, "approved")
    monkeypatch.setenv(W11, "1")
    assert item_type not in gallery._hidden_item_types()
    on = _reads(conn, gid, item_type, handle, rid, title)
    assert on == {k: True for k in on}, on


@pytest.mark.parametrize("wave11", ["0", "1"])
@pytest.mark.parametrize("item_type", gallery.TOOL_ITEM_TYPES)
def test_use_refuses_every_tool_type(conn, lib_on, monkeypatch, item_type, wave11):
    """Review M1: `/use` copies a listed OUTLINE into the member's templates. A shared widget, routine or tracker is
    not one (its body is `{}`; adopting it is its own door), so `/use` answers the same refusal as for an example
    note or a layout, in either wave 11 state, and no use is counted and no template is written."""
    monkeypatch.setenv(W11, wave11)
    gid = _row(conn, item_type=item_type, user_id="author")
    assert gallery.use_template("viewer", gid, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?", (gid,)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM j2_note_templates WHERE user_id = 'viewer'").fetchone()[0] == 0
    # control: the same viewer can use an outline, so the refusal is the type's, not the viewer's
    outline = _row(conn, item_type="outline", user_id="author")
    assert gallery.use_template("viewer", outline, conn=conn) is not None


@pytest.mark.parametrize("item_type", gallery.TOOL_ITEM_TYPES)
def test_library_off_hides_the_tool_types_even_with_wave_11_on(conn, monkeypatch, item_type):
    gid = _row(conn, item_type=item_type, user_id="author")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    monkeypatch.setenv(W11, "1")
    assert item_type in gallery._hidden_item_types()
    assert gid not in {x["id"] for x in gallery.list_gallery("viewer", conn=conn)}
    assert gallery.get_item("admin", gid, is_admin=True, conn=conn) is None


# ── official rows read as UCT ─────────────────────────────────────────────────────────────────────

def _kind_row(conn, kind: str, user_id: str | None) -> str:
    gid = _row(conn, item_type="style", user_id=user_id or "probe", title=f"{kind} row")
    conn.execute("UPDATE j2_template_gallery SET kind = ?, user_id = ? WHERE id = ?", (kind, user_id, gid))
    conn.commit()
    return gid


def test_official_author_label_is_uct(conn, lib_on, monkeypatch):
    monkeypatch.setenv(W11, "1")
    monkeypatch.setenv("NOTEBOOK_STARTER_PACKS_ENABLED", "1")
    conn.execute("INSERT INTO users (id, email, password_hash, display_name) VALUES ('author', 'a@x.test', 'x', 'Pat')")
    conn.commit()
    ids = {"official": _kind_row(conn, "official", None), "firm": _kind_row(conn, "firm", None),
           "member": _kind_row(conn, "member", "author")}
    gallery.author_handle("author", conn)                                # the member author's opaque handle exists
    items = {k: gallery.get_item("viewer", gid, conn=conn) for k, gid in ids.items()}
    assert {k: v["author"] for k, v in items.items()} == {"official": gallery.FIRM_AUTHOR, "firm": gallery.FIRM_AUTHOR,
                                                          "member": "Pat"}
    # review M2: the summary's `firm` badge and its handle branch read the same UCT_KINDS as the label
    assert {k: v["firm"] for k, v in items.items()} == {"official": True, "firm": True, "member": False}
    assert items["official"]["authorHandle"] is None and items["firm"]["authorHandle"] is None
    assert items["member"]["authorHandle"] is not None                   # control: a member's handle travels
    assert gallery.FIRM_AUTHOR == "UCT"


# ── one live listing per (author, tool type, tool) ────────────────────────────────────────────────

def _insert_tool(conn, user_id, item_type, tool_id):
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, category, body_json, status, created_at,"
        " updated_at, item_type, source_tool_id) VALUES (lower(hex(randomblob(16))), ?, 'member', 'T', 'review',"
        " '{}', 'pending', 'x', 'x', ?, ?)", (user_id, item_type, tool_id))


def test_tool_source_unique_per_author_and_type(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
    assert {"source_tool_id", "template_group"} <= cols
    _insert_tool(conn, "author", "routine", "r1")
    with pytest.raises(sqlite3.IntegrityError):
        _insert_tool(conn, "author", "routine", "r1")               # the same tool twice: one listing
    _insert_tool(conn, "author", "tracker", "r1")                   # another type: another listing
    _insert_tool(conn, "other", "routine", "r1")                    # another author: theirs
    _insert_tool(conn, None, "routine", "r1")                       # no author (a seed): not keyed
    _insert_tool(conn, None, "routine", "r1")
    _insert_tool(conn, "author", "routine", None)                   # no tool: not keyed
    _insert_tool(conn, "author", "routine", None)
    conn.commit()


def test_the_held_write_is_keyed_on_the_tool_source(conn):
    """`source_tool_id` is in the closed set the held / replaced write interpolates, and the second share of the same
    tool replaces the first in place (the same item id), exactly as a style's does."""
    assert "source_tool_id" in gallery._HELD_KEY_COLUMNS
    kw = dict(user_id="author", key_column="source_tool_id", key="w1", item_type="widget_definition",
              title="W", description="", category="review", trading_style=None, body={}, preview=[])
    first = gallery._write_held_or_replaced(conn, payload={"v": 1}, **kw)
    second = gallery._write_held_or_replaced(conn, payload={"v": 2}, **kw)
    conn.commit()
    assert first == second
    rows = conn.execute("SELECT payload_json, body_json, status FROM j2_template_gallery WHERE source_tool_id = 'w1'"
                        ).fetchall()
    assert [tuple(r) for r in rows] == [('{"v": 2}', "{}", "pending")]
    with pytest.raises(ValueError):
        gallery._write_held_or_replaced(conn, payload={}, **{**kw, "key_column": "source_tool"})


# ── the three member tables: schema, purge, tombstone replay ──────────────────────────────────────

def _schema_member_tables() -> set[str]:
    """The `j2_*` tables `ensure_schema` creates with a `user_id` column. Only which tables EXIST is read here;
    whether each is purged or trigger-emptied is the real rail's question, asked of the real rail below (review M4)."""
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    try:
        ensure_schema(c)
        tables = [r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'j2\\_%' ESCAPE '\\'")]
        return {t for t in tables if any(col[1] == "user_id" for col in c.execute(f'PRAGMA table_info("{t}")'))}
    finally:
        c.close()


def test_purge_rail_derives_the_new_tables_from_the_schema(monkeypatch):
    assert set(NEW_TABLES) <= _schema_member_tables(), "ensure_schema did not create the three tables with user_id"
    assert set(NEW_TABLES) <= manifest_rail._runtime_purged()
    # The real schema-derived rail passes over the real purge list ...
    manifest_rail.test_every_member_table_the_schema_creates_is_purged_or_emptied_by_a_trigger()
    # ... and a misspelled purge entry leaves the real table behind, which that rail names.
    misspelled = tuple("j2_gallery_credit" if t == "j2_gallery_credits" else t for t in ap._DIRECT_USER_TABLES)
    monkeypatch.setattr(ap, "_DIRECT_USER_TABLES", misspelled)
    with pytest.raises(AssertionError, match="j2_gallery_credits"):
        manifest_rail.test_every_member_table_the_schema_creates_is_purged_or_emptied_by_a_trigger()


def test_tombstone_replay_for_each_new_table(authdb, tmp_path):
    from api.services import account_tombstones as at
    c = authdb.get_connection()
    try:
        for uid in (GONE, KEPT):
            c.execute("INSERT INTO j2_gallery_use_days VALUES (?, 'g1', '2026-10-26')", (uid,))
            c.execute("INSERT INTO j2_gallery_credits VALUES (?, 'routine', ?, 'g1', 'h-1', 'Pre-market prep', 'x')",
                      (uid, f"r-{uid}"))
            c.execute("INSERT INTO j2_gallery_helpful_prompts VALUES (?, 'g1', 'yes', 'x')", (uid,))
        c.commit()
    finally:
        c.close()
    raw = tmp_path / "restored.db"
    src = sqlite3.connect(authdb._DB_PATH)
    dst = sqlite3.connect(str(raw))
    src.backup(dst)
    src.close()
    try:
        at.replay_on_db(dst, [GONE])
        for t in NEW_TABLES:
            assert {r[0] for r in dst.execute(f"SELECT user_id FROM {t}")} == {KEPT}, t
    finally:
        dst.close()


# ── W11-R19: publishing a style never carries a template slot (until Task 11.8's reducer) ──────────────

CANARY = "zzq-canary-7f3a"
DEF_ID, ROUTINE_ID, TRACKER_ID = ("0f8b6c1e-2a4d-4b7e-9c3a-5d6e7f8a9b0c", "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
                                  "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e")


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _store(conn, style_id, blocks, outline):
    """The stored rows written directly, as a style already on disk holds them (a canary key included, which the
    save path's reducer would drop): the strip must hold whatever is stored."""
    conn.execute("UPDATE j2_journal_styles SET blocks_json = ?, outline_body_json = ? WHERE id = ?",
                 (json.dumps(blocks), json.dumps(outline), style_id))
    conn.commit()


FAMILY = [
    {"block": "built_a", "settings": {"ref": f"def:{DEF_ID}", "defRev": 3, "note": CANARY}},
    {"block": "routine_a", "settings": {"ref": f"routine:{ROUTINE_ID}", "bind": "note-day", "x": CANARY}},
    {"block": "tracker_b", "settings": {"ref": f"tracker:{TRACKER_ID}", "display": "chart", "x": CANARY}},
]
SLOT_BLOCKS = [{"block": "chart", "settings": {"tf": "D"}}, *FAMILY]
SLOT_OUTLINE = {"type": "doc", "content": [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]},
    _para("{{block:built_a}}"), _para("{{block:chart}}"),
    {"type": "bulletList", "content": [{"type": "listItem", "content": [_para("{{block:routine_a}}")]}]},
    _para("{{block:tracker_b}}"), _para("Keep it simple."),
]}
LEAKS = (CANARY, DEF_ID, ROUTINE_ID, TRACKER_ID, "def:", "routine:", "tracker:", "built_a", "routine_a", "tracker_b")


def _assert_no_slot(obj, *, outline=True):
    """Nothing of a template slot in `obj`, and the ordinary chart block (and, when `outline`, the rest of the outline)
    still there, so the check cannot pass by everything being empty."""
    text = json.dumps(obj)
    for leaked in LEAKS:
        assert leaked not in text, leaked
    assert '"chart"' in text
    if outline:
        assert "{{block:chart}}" in text and "Keep it simple." in text


def _published_payload(conn, gid, column="payload_json"):
    raw = conn.execute(f"SELECT {column} FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0]
    return json.loads(raw)


@pytest.mark.parametrize("wave11", ["0", "1"])
def test_publish_strips_every_template_slot_and_its_placeholder(conn, lib_on, monkeypatch, wave11):
    """W11-R19, in BOTH wave 11 states: a dark slot is still a member's id (re-review M2)."""
    monkeypatch.setenv(W11, wave11)
    s = _style(conn)
    _store(conn, s["id"], SLOT_BLOCKS, SLOT_OUTLINE)
    item = gallery.publish_style("author", s["id"], title="Slots", description="", category="journal",
                                 trading_style=None, conn=conn)
    payload = _published_payload(conn, item["id"])
    _assert_no_slot(payload)
    assert [b["block"] for b in payload["blocks"]] == ["chart"]


@pytest.mark.parametrize("wave11", ["0", "1"])
def test_publish_strips_slots_from_a_linked_template_outline(conn, lib_on, monkeypatch, wave11):
    """The outline's other source: a style whose outline is a linked note template (`outline_template_id`)."""
    monkeypatch.setenv(W11, wave11)
    s = _style(conn)
    conn.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json, created_at,"
                 " updated_at) VALUES ('tpl-slots', 'author', 'T', 'T', ?, NULL, 'x', 'x')", (json.dumps(SLOT_OUTLINE),))
    conn.execute("UPDATE j2_journal_styles SET blocks_json = ?, outline_body_json = NULL, outline_template_id ="
                 " 'tpl-slots' WHERE id = ?", (json.dumps(SLOT_BLOCKS), s["id"]))
    conn.commit()
    item = gallery.publish_style("author", s["id"], title="Linked", description="", category="journal",
                                 trading_style=None, conn=conn)
    _assert_no_slot(_published_payload(conn, item["id"]))


@pytest.mark.parametrize("wave11", ["0", "1"])
def test_a_held_revision_carries_no_slot(conn, lib_on, monkeypatch, wave11):
    """The held-revision path (R-P3-3): an approved listing published again holds the new version in `pending_json`.
    Neither the stored revision nor the reviewer's view of it carries a slot."""
    monkeypatch.setenv(W11, wave11)
    s = _style(conn)
    first = gallery.publish_style("author", s["id"], title="Held", description="", category="journal",
                                  trading_style=None, conn=conn)
    gallery.admin_act("admin", first["id"], "approve", reviewed_updated_at=first["updatedAt"], conn=conn)
    _store(conn, s["id"], SLOT_BLOCKS, SLOT_OUTLINE)
    gallery.publish_style("author", s["id"], title="Held", description="", category="journal",
                          trading_style=None, conn=conn)
    held = _published_payload(conn, first["id"], "pending_json")
    _assert_no_slot(held["payload"])
    rev = gallery.get_item("admin", first["id"], is_admin=True, conn=conn)["pendingRevision"]
    _assert_no_slot(rev["payload"])


def _slotted_listing(conn, version=1):
    """An APPROVED member style listing whose stored payload holds every slot family with canary settings, written
    by hand (a row edited outside `publish_style`, or written before the strip): the read-side case."""
    gid = _row(conn, item_type="style", user_id="author", title="Hand-made")
    payload = {"kindId": "weekend_prep", "outlineBodyJson": SLOT_OUTLINE, "blocks": SLOT_BLOCKS, "properties": {}}
    conn.execute("UPDATE j2_template_gallery SET payload_json = ?, body_json = ?, version = ? WHERE id = ?",
                 (json.dumps(payload), json.dumps(SLOT_OUTLINE), version, gid))
    conn.commit()
    return gid


@pytest.mark.parametrize("wave11", ["0", "1"])
def test_a_stored_slot_is_never_served_adopted_or_offered(conn, lib_on, monkeypatch, wave11):
    """Re-review M1: `_safe_listed`, the read-side backstop, drops what the write side drops -- through GET, adopt and
    the update plan."""
    monkeypatch.setenv(W11, wave11)
    gid = _slotted_listing(conn)
    _assert_no_slot(gallery.get_item("viewer", gid, conn=conn)["payload"])
    adopted = gallery.adopt_style("viewer", gid, conn=conn)
    stored = conn.execute("SELECT blocks_json, outline_body_json FROM j2_journal_styles WHERE id = ? AND user_id = ?",
                          (adopted["style"]["id"], "viewer")).fetchone()
    _assert_no_slot({"blocks": json.loads(stored[0]), "outline": json.loads(stored[1] or "null")})
    # The update plan: the listed version moves past the copy's, so a plan is offered from the slotted payload.
    conn.execute("UPDATE j2_template_gallery SET version = 2 WHERE id = ?", (gid,))
    conn.execute("UPDATE j2_journal_styles SET source_version = 1 WHERE id = ?", (adopted["style"]["id"],))
    conn.commit()
    plan = gallery.plan_update("viewer", adopted["style"]["id"], conn=conn)
    assert plan is not None
    text = json.dumps(plan)
    for leaked in LEAKS:
        assert leaked not in text, leaked


def test_publish_of_a_style_without_slots_is_unchanged(conn, lib_on):
    """Control: a style holding no template slot publishes exactly what it did before W11-R19."""
    s = _style(conn)
    outline = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]},
        _para("{{block:chart}}"), {"type": "bulletList", "content": [{"type": "listItem", "content": [_para("a")]}]},
    ]}
    blocks = [{"block": "chart", "settings": {"tf": "W"}}, {"block": "myPnlStats", "settings": {"range": "1w"}}]
    _store(conn, s["id"], blocks, outline)
    payload = gallery.style_payload("author", s["id"], conn)
    assert payload["blocks"] == [blocks[0], {"block": "myPnlStats", "settings": {}}]   # R50's snapshot rule only
    assert payload["outlineBodyJson"] == gallery.sanitize_body(outline, "author")
    assert gallery._without_slot_placeholders(outline) == outline
