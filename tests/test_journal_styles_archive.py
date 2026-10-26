"""Task 11.13 (ruling W11-R10): My tools' Templates tab on the server -- archive, duplicate, used in, credit.

An archived template is hidden from TemplatePicker, the kind section and the default choice (archiving the default
clears `is_default`), stays readable by `get_style` (notes keep their style stamp and Update layout), and comes back
from the Archived filter. "Delete permanently" is only from Archived, needs the name typed, and is the existing SOFT
`delete_style`: Recently deleted lists 30 days, then restore refuses; rows are never hard-deleted.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import notes
from api.services.journal_two import template_gallery as gallery
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    AUTHOR, MEMBER, OTHER, db, heading, list_template, para, routine, routine_slot, style,
)

OUTLINE = {"type": "doc", "content": [heading("Thesis"), para("prompt")]}


def _mine(c, name="Mine", kind="thesis", uid=MEMBER, blocks=()):
    return js.create_style(uid, {"name": name, "kindId": kind, "blocks": list(blocks), "outlineBodyJson": OUTLINE}, c)


def _note_from(c, uid, style_id, title="styled"):
    s = js.get_style(uid, style_id, c)
    composed = js.compose(uid, s, ticker="NVDA", conn=c)
    return notes.create_note(uid, {"title": title, "ticker": "NVDA", "bodyJson": composed["bodyJson"]},
                             properties=composed["properties"],
                             style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))


def _ids(rows):
    return [r["id"] for r in rows]


def test_picker_view_hides_archived_and_is_default_for_every_caller(db):
    keep, gone = _mine(db, "Keep"), _mine(db, "Gone")
    assert js.archive_style(MEMBER, gone["id"], conn=db)["archivedAt"]
    picker = js.list_styles(MEMBER, db)                                  # every existing caller passes no view
    assert picker == js.list_styles(MEMBER, db, view="picker")
    assert keep["id"] in _ids(picker) and gone["id"] not in _ids(picker)
    assert any(s["builtin"] for s in picker)                             # the picker still carries the built-ins
    live = js.list_styles(MEMBER, db, view="live")
    assert _ids(live) == [keep["id"]]                                    # the member's own rows only
    archived = js.list_styles(MEMBER, db, view="archived")
    assert _ids(archived) == [gone["id"]] and archived[0]["archivedAt"]
    # archived stays readable (a note's stamp) and comes back to the picker
    assert js.get_style(MEMBER, gone["id"], db)["name"] == "Gone"
    back = js.unarchive_style(MEMBER, gone["id"], conn=db)
    assert back["archivedAt"] is None and gone["id"] in _ids(js.list_styles(MEMBER, db))
    with pytest.raises(js.StyleValidationError):
        js.list_styles(MEMBER, db, view="everything")
    with pytest.raises(js.StyleValidationError, match="^Built-in templates can't be archived.$"):
        js.archive_style(MEMBER, js.builtin_style_id("thesis"), conn=db)
    assert js.archive_style(OTHER, keep["id"], conn=db) is None          # never another member's
    assert js.get_style(MEMBER, keep["id"], db)["archivedAt"] is None


def test_archive_clears_default_and_kind_falls_back(db):
    s = _mine(db)
    js.set_default(MEMBER, s["id"], db)
    assert js.default_style_for_kind(MEMBER, "thesis", db)["id"] == s["id"]
    out = js.archive_style(MEMBER, s["id"], conn=db)
    assert out["isDefault"] is False
    assert js.default_style_for_kind(MEMBER, "thesis", db)["id"] == js.builtin_style_id("thesis")
    builtin = next(x for x in js.list_styles(MEMBER, db) if x["id"] == js.builtin_style_id("thesis"))
    assert builtin["isDefault"] is True
    # an archived template is not offered as the default choice, and unarchiving does not make it the default again
    with pytest.raises(js.StyleValidationError, match="^Unarchive this template before making it the default.$"):
        js.set_default(MEMBER, s["id"], db)
    assert js.unarchive_style(MEMBER, s["id"], conn=db)["isDefault"] is False
    assert js.set_default(MEMBER, s["id"], db)["isDefault"] is True      # control: a live one can be chosen


def test_used_in_counts_live_notes_only_and_never_another_members(db):
    s, other_style = _mine(db), _mine(db, "Theirs", uid=OTHER)
    a = _note_from(db, MEMBER, s["id"], "A")
    b = _note_from(db, MEMBER, s["id"], "B")
    trashed = _note_from(db, MEMBER, s["id"], "Trashed")
    sample = _note_from(db, MEMBER, s["id"], "Sample")
    _note_from(db, OTHER, other_style["id"], "Other's")
    db.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?", (datetime.now(timezone.utc).isoformat(), trashed["id"]))
    db.execute("UPDATE j2_notes SET import_source = 'sample' WHERE id = ?", (sample["id"],))
    # another member's note stamped with MY style id is still not a use of mine
    db.execute("UPDATE j2_notes SET style_id = ? WHERE user_id = ?", (s["id"], OTHER))
    db.execute("UPDATE j2_notes SET updated_at = '2026-01-01T00:00:00+00:00' WHERE id = ?", (a["id"],))
    db.commit()
    live = {x["id"]: x for x in js.list_styles(MEMBER, db, view="live")}
    assert live[s["id"]]["usedIn"] == 2
    used = js.style_used_in(MEMBER, s["id"], conn=db)
    assert [n["id"] for n in used] == [b["id"], a["id"]]                 # newest edit first
    assert set(used[0]) == {"id", "title", "updatedAt"} and used[0]["title"] == "B"
    assert js.style_used_in(OTHER, s["id"], conn=db) is None              # not theirs
    assert js.style_used_in(MEMBER, js.builtin_style_id("thesis"), conn=db) is None
    # archived and recently deleted rows keep their count and list
    js.archive_style(MEMBER, s["id"], conn=db)
    assert js.list_styles(MEMBER, db, view="archived")[0]["usedIn"] == 2
    js.delete_style_typed(MEMBER, s["id"], "Mine", conn=db)
    assert js.list_styles(MEMBER, db, view="deleted")[0]["usedIn"] == 2
    assert len(js.style_used_in(MEMBER, s["id"], conn=db)) == 2


def test_used_in_is_capped_at_100(db, monkeypatch):
    s = _mine(db)
    for i in range(3):
        _note_from(db, MEMBER, s["id"], f"n{i}")
    monkeypatch.setattr(js, "USED_IN_LIMIT", 2)
    assert len(js.style_used_in(MEMBER, s["id"], conn=db)) == 2
    assert js.list_styles(MEMBER, db, view="live")[0]["usedIn"] == 3      # the count is not the list's cap


def test_credit_on_adopted_copy(db):
    src = style(db, name="Setup study")
    gid = list_template(db, src["id"], title="Setup study")
    copy = gallery.adopt_template(MEMBER, gid, conn=db)["style"]
    own = _mine(db, "Plain")
    rows = {x["id"]: x for x in js.list_styles(MEMBER, db, view="live")}
    assert rows[copy["id"]]["credit"] == "Based on Sam's Setup study"
    assert rows[copy["id"]]["fromLibrary"] is True and rows[copy["id"]]["sourceGalleryId"] == gid
    assert rows[own["id"]]["credit"] is None and rows[own["id"]]["fromLibrary"] is False
    assert rows[own["id"]]["updateAvailable"] is False
    # a copy adopted before wave 11 wrote snapshots: the credit is read from the gallery row it came from
    db.execute("DELETE FROM j2_gallery_credits WHERE user_id = ? AND tool_id = ?", (MEMBER, copy["id"]))
    db.commit()
    rows = {x["id"]: x for x in js.list_styles(MEMBER, db, view="live")}
    assert rows[copy["id"]]["credit"] == "Based on Sam's Setup study"
    # the author's own listed style is never credited to themselves
    mine = {x["id"]: x for x in js.list_styles(AUTHOR, db, view="live")}
    assert all(x["credit"] is None and x["fromLibrary"] is False for x in mine.values())


def test_credit_none_while_the_library_is_off(db, monkeypatch):
    src = style(db)
    gid = list_template(db, src["id"])
    copy = gallery.adopt_template(MEMBER, gid, conn=db)["style"]
    db.execute("DELETE FROM j2_gallery_credits WHERE user_id = ?", (MEMBER,))
    db.commit()
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    row = next(x for x in js.list_styles(MEMBER, db, view="live") if x["id"] == copy["id"])
    assert row["credit"] is None and row["fromLibrary"] is True


def test_duplicate_copies_slots_without_provenance(db):
    r = routine(db, uid=MEMBER)
    blocks = [routine_slot("a", r["id"])]
    src = style(db, uid=MEMBER, blocks=blocks, name="Plan")
    db.execute("UPDATE j2_journal_styles SET source_gallery_id = 'g-1', source_version = 3, source_block_ids = '[]',"
               " source_outline_hash = 'h', version = 4 WHERE id = ?", (src["id"],))
    db.commit()
    js.set_default(MEMBER, src["id"], db)
    stored = db.execute("SELECT * FROM j2_journal_styles WHERE id = ?", (src["id"],)).fetchone()
    dup = js.duplicate_style(MEMBER, src["id"], conn=db)
    row = db.execute("SELECT * FROM j2_journal_styles WHERE id = ?", (dup["id"],)).fetchone()
    assert row["name"] == "Plan copy" and row["kind_id"] == stored["kind_id"]
    assert row["blocks_json"] == stored["blocks_json"]                    # the family slot's ref, as it is
    assert f"routine:{r['id']}" in row["blocks_json"]
    assert (row["outline_body_json"], row["properties_json"]) == (stored["outline_body_json"],
                                                                  stored["properties_json"])
    assert (row["source_gallery_id"], row["source_version"], row["source_block_ids"],
            row["source_outline_hash"]) == (None, None, None, None)      # no provenance
    assert (row["is_default"], row["version"], row["archived_at"], row["deleted_at"]) == (0, 1, None, None)
    # the name fits 80; an archived source can be duplicated; a built-in too; never another member's
    js.update_style(MEMBER, src["id"], {"name": "x" * 80})
    long = js.duplicate_style(MEMBER, src["id"], conn=db)
    assert len(long["name"]) == 80 and long["name"].endswith(" copy")
    js.archive_style(MEMBER, src["id"], conn=db)
    assert js.duplicate_style(MEMBER, src["id"], conn=db)["archivedAt"] is None
    b = js.duplicate_style(MEMBER, js.builtin_style_id("thesis"), conn=db)
    assert b["builtin"] is False and b["name"].endswith(" copy") and b["kindId"] == "thesis"
    assert js.duplicate_style(OTHER, src["id"], conn=db) is None


def test_duplicate_refused_at_the_cap(db, monkeypatch):
    s = _mine(db)
    monkeypatch.setattr(js, "MAX_STYLES_PER_MEMBER", 1)
    with pytest.raises(js.StyleValidationError, match="^You can keep up to 200 styles. Delete one first.$"):
        js.duplicate_style(MEMBER, s["id"], conn=db)
    assert db.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    assert not db.in_transaction                                          # the short lock was given back


def test_delete_needs_archived_and_typed_name(db):
    s = _mine(db, "My Plan")
    with pytest.raises(js.StyleValidationError, match="^Archive this template before deleting it.$"):
        js.delete_style_typed(MEMBER, s["id"], "My Plan", conn=db)
    js.archive_style(MEMBER, s["id"], conn=db)
    for wrong in ("my plan", "My Plan ", "", None, 3):
        with pytest.raises(js.StyleValidationError, match="^Type the template's name exactly to delete it.$"):
            js.delete_style_typed(MEMBER, s["id"], wrong, conn=db)
    assert js.get_style(MEMBER, s["id"], db)["deletedAt"] is None
    out = js.delete_style_typed(MEMBER, s["id"], "My Plan", conn=db)
    assert out["deletedAt"] and out["archivedAt"]
    # soft: the row is still there, readable for notes' stamps, and listed in Recently deleted
    assert db.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE id = ?", (s["id"],)).fetchone()[0] == 1
    assert js.get_style(MEMBER, s["id"], db, include_deleted=True)["name"] == "My Plan"
    assert _ids(js.list_styles(MEMBER, db, view="deleted")) == [s["id"]]
    assert _ids(js.list_styles(MEMBER, db, view="archived")) == []
    assert js.delete_style_typed(OTHER, s["id"], "My Plan", conn=db) is None
    # restoring lands it back in Archived (it keeps archived_at), never as a default
    back = js.restore_style(MEMBER, s["id"], db)
    assert back["deletedAt"] is None and back["archivedAt"] and back["isDefault"] is False
    assert _ids(js.list_styles(MEMBER, db, view="archived")) == [s["id"]]


def test_restore_refused_after_30_days(db):
    old, recent = _mine(db, "Old"), _mine(db, "Recent")
    now = datetime.now(timezone.utc)
    for sid, days in ((old["id"], 31), (recent["id"], 29)):
        db.execute("UPDATE j2_journal_styles SET deleted_at = ? WHERE id = ?",
                   ((now - timedelta(days=days)).isoformat(), sid))
    db.commit()
    assert _ids(js.list_styles(MEMBER, db, view="deleted")) == [recent["id"]]
    with pytest.raises(js.StyleValidationError, match="^This template was deleted more than 30 days ago.$"):
        js.restore_style(MEMBER, old["id"], db)
    assert not db.in_transaction
    assert js.get_style(MEMBER, old["id"], db, include_deleted=True)["deletedAt"]   # never hard-deleted
    assert js.restore_style(MEMBER, recent["id"], db)["deletedAt"] is None
    assert js.RECENTLY_DELETED_DAYS == 30


def test_archived_style_still_composes_update_layout(db):
    s = _mine(db)
    n = _note_from(db, MEMBER, s["id"])
    js.update_style(MEMBER, s["id"], {"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]})
    js.archive_style(MEMBER, s["id"], conn=db)
    plan = js.plan_style_update(MEMBER, n["id"])
    assert (plan["styleId"], plan["fromVersion"], plan["toVersion"]) == (s["id"], 1, 2)
    assert plan["add"] == [{"block": "chart", "label": None}]
    assert notes.get_note(MEMBER, n["id"])["styleId"] == s["id"]          # the stamp is kept


def test_a_restored_archived_style_never_comes_back_as_the_default(db):
    """Defensive: an archived row that somehow remembers a default (written before this rule) is restored into
    Archived as a non-default, and the kind keeps its built-in default."""
    s = _mine(db)
    js.archive_style(MEMBER, s["id"], conn=db)
    js.delete_style_typed(MEMBER, s["id"], "Mine", conn=db)
    db.execute("UPDATE j2_journal_styles SET default_before_delete = 1 WHERE id = ?", (s["id"],))
    db.commit()
    back = js.restore_style(MEMBER, s["id"], db)
    assert back["archivedAt"] and back["isDefault"] is False
    assert js.default_style_for_kind(MEMBER, "thesis", db)["id"] == js.builtin_style_id("thesis")
