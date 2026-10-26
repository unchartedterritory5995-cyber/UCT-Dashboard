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

import sqlite3

import pytest

from api.services.journal_two import account_purge as ap
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _row, conn, lib_on  # noqa: F401  (fixtures + helpers)
from tests.test_account_tombstones import GONE, KEPT, authdb  # noqa: F401  (fixture + ids)
from tests import test_account_deletion_manifest as manifest_rail

W11 = "NOTEBOOK_WIDGETS_W11_ENABLED"
NEW_TABLES = ("j2_gallery_use_days", "j2_gallery_credits", "j2_gallery_helpful_prompts")


def test_the_tool_types_are_the_ruled_three_in_order():
    assert gallery.TOOL_ITEM_TYPES == ("widget_definition", "routine", "tracker")
    assert gallery.ITEM_TYPES == ("outline", "style", gallery.EXAMPLE_ITEM, gallery.LAYOUT_ITEM, *gallery.TOOL_ITEM_TYPES)
    assert set(gallery.TOOL_ITEM_TYPES) <= set(gallery.LISTED_ITEM_TYPES)       # listable once wave 11 is on


# ── the tool types are absent while wave 11 is off ─────────────────────────────────────────────────

def _reads(conn, gid: str, item_type: str, handle: str) -> dict[str, bool]:
    """Every door a tool row can be reached through, each answering "present?" for a viewer who is not the author
    (plus the author's and an admin's single read: a hidden type is absent for them too)."""
    def _filtered() -> bool:
        try:
            return gid in {x["id"] for x in gallery.list_gallery("viewer", item_type=item_type, conn=conn)}
        except gallery.GalleryError as e:
            assert str(e) == "Unknown item type."
            return False
    page = gallery.author_page("viewer", handle, conn=conn)
    return {
        "list": gid in {x["id"] for x in gallery.list_gallery("viewer", conn=conn)},
        "list_by_type": _filtered(),
        "get": gallery.get_item("viewer", gid, conn=conn) is not None,
        "get_author": gallery.get_item("author", gid, conn=conn) is not None,
        "get_admin": gallery.get_item("admin", gid, is_admin=True, conn=conn) is not None,
        "helpful": gallery.set_helpful("viewer", gid, True, conn=conn) is not None,
        "report": gallery.report("viewer", gid, reason="broken", conn=conn) is not None,
        "author_page": page is not None and gid in {x["id"] for x in page["items"]},
    }


@pytest.mark.parametrize("item_type", gallery.TOOL_ITEM_TYPES)
def test_tool_types_hidden_while_w11_off_and_listed_when_on(conn, lib_on, monkeypatch, item_type):
    gid = _row(conn, item_type=item_type, user_id="author", title=f"My {item_type}")
    handle = gallery.author_handle("author", conn)
    monkeypatch.setenv(W11, "0")
    assert item_type in gallery._hidden_item_types()
    off = _reads(conn, gid, item_type, handle)
    assert off == {k: False for k in off}, off
    # stored, never deleted: the row is exactly where it was
    assert conn.execute("SELECT item_type, status FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[:] \
        == (item_type, "approved")
    monkeypatch.setenv(W11, "1")
    assert item_type not in gallery._hidden_item_types()
    on = _reads(conn, gid, item_type, handle)
    assert on == {k: True for k in on}, on


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
    labels = {k: gallery.get_item("viewer", gid, conn=conn)["author"] for k, gid in ids.items()}
    assert labels == {"official": gallery.FIRM_AUTHOR, "firm": gallery.FIRM_AUTHOR, "member": "Pat"}
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

def _member_tables_and_left(purged: set[str]) -> tuple[list[str], list[str]]:
    """The schema-derived rail's own computation (tests/test_account_deletion_manifest.py): every `j2_*` table
    `ensure_schema` creates with a `user_id` column, and those neither purged nor trigger-emptied."""
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    try:
        ensure_schema(c)
        tables = [r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'j2\\_%' ESCAPE '\\'")]
        member = sorted(t for t in tables if any(col[1] == "user_id" for col in c.execute(f'PRAGMA table_info("{t}")')))
        triggers = c.execute("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger'").fetchall()
    finally:
        c.close()
    import re
    emptied = set()
    for base, sql in triggers:
        if base in purged and re.search(r"\bAFTER\s+DELETE\b", sql or "", re.IGNORECASE):
            emptied.update(re.findall(r"DELETE\s+FROM\s+(\w+)", sql, re.IGNORECASE))
    return member, [t for t in member if t not in purged and t not in emptied]


def test_purge_rail_derives_the_new_tables_from_the_schema(monkeypatch):
    purged = manifest_rail._runtime_purged()
    member, left = _member_tables_and_left(purged)
    assert set(NEW_TABLES) <= set(member), "ensure_schema did not create the three tables with user_id"
    assert set(NEW_TABLES) <= purged
    assert left == []
    # A misspelled purge entry leaves the real table behind, and the rail names it.
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
