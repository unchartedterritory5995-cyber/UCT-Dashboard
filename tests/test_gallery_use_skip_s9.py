"""Audit 2026-11-05, spec S9: a Template library Use makes a routine or a tracker ONLY when the member ticks
"Also start this every weekday". Unticked, the client answers each routine and tracker question `{"skip": True}`:

* nothing is made in `j2_routines` / `j2_trackers` (neither at adoption, `_materialize`, nor at the note's create,
  `slot_fill.build_tool_slot`);
* the slot lands in the note as plain content: a routine's items as an unticked checklist, a tracker's name as a line;
* a skip is never remembered on the copy, so a later Use asks again (and a ticked Use then makes the routine).

Each rail has its control: the same Use with `{"create": True}` makes exactly one routine.
"""
from __future__ import annotations

import json

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import slot_fill, template_gallery as gallery
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    MEMBER, built, db, list_template, routine, routine_slot, style, tracker, tracker_slot, widget,
)
from tests.test_gallery_adopt_w11 import _official, _routine_ids_in_notes


def _count(db, table):
    return db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (MEMBER,)).fetchone()[0]


def _note_bodies(db):
    return [json.loads(b) for (b,) in db.execute(
        "SELECT body_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at", (MEMBER,))]


def _nodes(doc, kind):
    """Every `kind` node, in document order."""
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == kind:
                out.append(n)
            for c in n.get("content") or []:
                walk(c)
    walk(doc)
    return out


def _text(node):
    return "".join(t.get("text", "") for t in _nodes(node, "text"))


def test_skip_makes_no_routine_and_leaves_the_steps_as_a_checklist(db):
    gid = _official(db)
    out = gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"skip": True}},
                                       payload={"title": "Pre-market prep · Thu, Nov 5"}, conn=db)
    assert out["note"]["title"] == "Pre-market prep · Thu, Nov 5"
    assert out["created"] == {"widgets": [], "routines": [], "trackers": []}
    assert _count(db, "j2_notes") == 1
    assert _count(db, "j2_routines") == 0
    assert _routine_ids_in_notes(db) == []
    [body] = _note_bodies(db)
    [checklist] = _nodes(body, "taskList")
    items = [_text(i) for i in _nodes(checklist, "taskItem")]
    assert "Read the morning wire" in items and len(items) == 4
    assert all(i["attrs"]["checked"] is False for i in _nodes(checklist, "taskItem"))
    # Never remembered: the copy still asks the question, so a later Use can start the routine.
    copy = js.get_style(MEMBER, out["style"]["id"], db, full=True)
    assert [q["slot"] for q in slot_fill.tool_questions(copy, user_id=MEMBER, conn=db)] == ["routine_a"]


def test_control_create_makes_exactly_one_routine(db):
    gid = _official(db)
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}}, payload={}, conn=db)
    assert _count(db, "j2_routines") == 1
    assert len(_routine_ids_in_notes(db)) == 1


def test_a_skip_then_a_ticked_use_makes_the_routine_then(db):
    gid = _official(db)
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"skip": True}}, payload={}, conn=db)
    assert _count(db, "j2_routines") == 0
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}}, payload={}, conn=db)
    assert _count(db, "j2_routines") == 1
    assert _count(db, "j2_notes") == 2


def test_no_answer_is_still_refused(db):
    """A skip is an ANSWER: no answer at all is refused exactly as before (nothing written)."""
    gid = _official(db)
    before = _count(db, "j2_notes")
    with pytest.raises(Exception):
        gallery.use_library_template(MEMBER, gid, choices={}, payload={}, conn=db)
    assert _count(db, "j2_notes") == before
    assert _count(db, "j2_routines") == 0


def _inline_listing(db):
    r, t = routine(db), tracker(db)
    s = style(db, blocks=[routine_slot("a", r["id"]), tracker_slot("a", t["id"])])
    return list_template(db, s["id"], edits={"blocks": {"routine_a": {"items": ["Coffee", "Mark levels"]}}})


def test_inline_routine_and_tracker_skipped_at_adoption_make_nothing(db):
    """A member's listed template carries INLINE routine and tracker parts, made at adoption (`_materialize`).
    Fix round 1 (review finding 1, CRITICAL): the skip must leave the steps IN the note -- presence, not only the
    absence of a tool. Before the fix the copy kept an inline slot the note's compose could not read (no pools), and
    the note said "This routine is not in your account." with `slot-missing` in `skipped`."""
    gid = _inline_listing(db)
    routines_before, trackers_before = _count(db, "j2_routines"), _count(db, "j2_trackers")
    out = gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"skip": True}, "tracker_a": {"skip": True}},
                                       payload={}, conn=db)
    assert out["created"]["routines"] == [] and out["created"]["trackers"] == []
    assert out["skipped"] == []
    assert _count(db, "j2_routines") == routines_before
    assert _count(db, "j2_trackers") == trackers_before
    [body] = _note_bodies(db)
    assert not [n for n in _nodes(body, "widgetEmbed")
                if (n.get("attrs") or {}).get("widgetId") in ("routine", "tracker")]
    [checklist] = _nodes(body, "taskList")
    assert [_text(i) for i in _nodes(checklist, "taskItem")] == ["Coffee", "Mark levels"]
    text = _text(body)
    assert "not in your account" not in text
    # The tracker lands as a line to fill in, named.
    assert any(_text(p).endswith(": ") or _text(p).endswith(":") for p in _nodes(body, "paragraph"))


def test_inline_skip_then_a_ticked_use_makes_exactly_one_routine(db):
    """The reviewer's probe (scratchpad/ux/rv/test_rv_inline_skip.py), as a rail: the copy is reused (W11-R4), so
    `_materialize` never runs again; the second Use must still be able to start the routine."""
    gid = _inline_listing(db)
    before = _count(db, "j2_routines")
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"skip": True}, "tracker_a": {"skip": True}},
                                 payload={}, conn=db)
    out2 = gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}, "tracker_a": {"create": True}},
                                        payload={}, conn=db)
    assert out2["skipped"] == []
    assert len(out2["created"]["routines"]) == 1
    assert _count(db, "j2_routines") == before + 1
    second = _note_bodies(db)[-1]
    embeds = [n for n in _nodes(second, "widgetEmbed") if (n.get("attrs") or {}).get("widgetId") == "routine"]
    assert len(embeds) == 1
    # A third Use reuses that routine: still exactly one.
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}, "tracker_a": {"create": True}},
                                 payload={}, conn=db)
    assert _count(db, "j2_routines") == before + 1


def test_the_listing_is_read_before_the_style_write_lock(db, monkeypatch):
    """Fix round 2 (re-review R1-2): the listing's definitions are read and cleaned OUTSIDE the create's write lock
    (W11-R53/W11-R31: no reducer or clean runs while it is held). Every read is recorded with whether a transaction
    was open on the connection it ran on."""
    gid = _inline_listing(db)
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"skip": True}, "tracker_a": {"skip": True}},
                                 payload={}, conn=db)               # the copy now holds inline slots
    seen = []
    real = gallery.listing_tool_pools

    def spy(conn, gallery_id):
        seen.append(conn.in_transaction)
        return real(conn, gallery_id)
    monkeypatch.setattr(gallery, "listing_tool_pools", spy)
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}, "tracker_a": {"create": True}},
                                 payload={}, conn=db)
    assert seen, "non-vacuity: the definitions were read for the copy's inline slots"
    assert not any(seen), "the listing was read while the style write lock was held"


def test_inline_control_create_makes_the_member_their_own(db):
    r, t = routine(db), tracker(db)
    s = style(db, blocks=[routine_slot("a", r["id"]), tracker_slot("a", t["id"])])
    gid = list_template(db, s["id"], edits={"blocks": {"routine_a": {"items": ["Coffee", "Mark levels"]}}})
    routines_before = _count(db, "j2_routines")
    gallery.use_library_template(MEMBER, gid, choices={"routine_a": {"create": True}, "tracker_a": {"create": True}},
                                 payload={}, conn=db)
    assert _count(db, "j2_routines") == routines_before + 1


def test_is_skip_choice_reads_only_a_plain_skip():
    assert slot_fill.is_skip_choice({"skip": True})
    assert not slot_fill.is_skip_choice({"skip": True, "create": True})
    assert not slot_fill.is_skip_choice({"skip": True, "use": "r1"})
    assert not slot_fill.is_skip_choice({"skip": "yes"})
    assert not slot_fill.is_skip_choice(None)
