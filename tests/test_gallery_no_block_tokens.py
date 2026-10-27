"""W11-R76 (review I-3): no `{{block:<id>}}` text reaches a member through a gallery CARD line.

The card's three lines are `template_gallery.preview_lines`, stored when an item is written (publish, publish_style,
a held revision, the seeds) and filtered when a row is read (`_summary`). ONE rule for both: a paragraph or a list
item whose text is exactly one placeholder (`journal_styles.PLACEHOLDER_RE`, ANY block id, not only a slot family)
is not a line. A member's style outline is normally "a heading, then a built-in block", so before this its card
showed the token on its second line.
"""
from __future__ import annotations

import json

from api.services.journal_two import template_gallery as gallery
import pytest

from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    ALL_WAVES, AUTHOR, MEMBER, approve, built, db, heading, list_template, para, routine, routine_slot, style, waves,
    widget,
)

TOKEN = "{{block:"


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def test_preview_lines_skip_every_placeholder_line():
    body = _doc(heading("Market"), para("{{block:prepWire}}"), para("{{block:routine_a}}"),
                {"type": "bulletList", "content": [{"type": "listItem", "content": [para("{{block:chart}}")]}]},
                para("What would change the plan?"))
    lines = gallery.preview_lines(body)
    assert [ln["text"] for ln in lines] == ["Market", "What would change the plan?"]
    # CONTROL: words AROUND a placeholder, or a placeholder in a heading, are the author's text and stay.
    kept = gallery.preview_lines(_doc(heading("{{block:chart}}"), para("see {{block:chart}} here")))
    assert [ln["text"] for ln in kept] == ["{{block:chart}}", "see {{block:chart}} here"]


def test_a_shared_style_card_shows_no_token(db):
    outline = _doc(heading("Market"), para("{{block:prepWire}}"), para("Plan the open."))
    s = style(db, blocks=[{"block": "prepWire", "enabled": True, "settings": {}}], outline=outline)
    out = gallery.publish_style(AUTHOR, s["id"], title="Prep", description="", category="journal",
                                trading_style=None, conn=db)
    approve(db, out["id"])
    stored = db.execute("SELECT preview_json FROM j2_template_gallery WHERE id = ?", (out["id"],)).fetchone()[0]
    assert TOKEN not in stored and "Plan the open." in stored
    cards = gallery.list_gallery(MEMBER, conn=db)
    card = next(c for c in cards if c["id"] == out["id"])
    assert TOKEN not in json.dumps(card["preview"])


def test_a_row_stored_before_this_rule_is_read_without_its_token(db):
    # A row written before the rule (production rows on master): its stored lines still hold a built-in's token.
    outline = _doc(heading("Market"), para("Plan the open."))
    s = style(db, blocks=[], outline=outline)
    out = gallery.publish_style(AUTHOR, s["id"], title="Old", description="", category="journal",
                                trading_style=None, conn=db)
    approve(db, out["id"])
    db.execute("UPDATE j2_template_gallery SET preview_json = ? WHERE id = ?",
               (json.dumps([{"kind": "heading", "text": "Market"}, {"kind": "text", "text": "{{block:prepWire}}"},
                            {"kind": "text", "text": "Plan the open."}]), out["id"]))
    db.commit()
    card = next(c for c in gallery.list_gallery(MEMBER, conn=db) if c["id"] == out["id"])
    assert [ln["text"] for ln in card["preview"]] == ["Market", "Plan the open."]


NOTES_PLAN = {"v": 1, "source": "notes", "measures": [{"key": "notes"}], "range": {"token": "all"}}   # wave 10's


def _slot_template(db):
    """A shared template: a widget whose plan needs wave 10 (built_a), a plain widget (built_b), a routine
    (routine_a), each with its outline placeholder."""
    w10 = widget(db, plan=NOTES_PLAN, name="Notes count")
    plain = widget(db)
    r = routine(db)
    blocks = [built("a", w10["id"]), built("b", plain["id"]), routine_slot("a", r["id"])]
    outline = _doc(heading("Plan"), para("{{block:built_a}}"), para("{{block:built_b}}"), para("{{block:routine_a}}"))
    return list_template(db, style(db, blocks=blocks, outline=outline)["id"], title="Slots",
                         edits={"blocks": {"routine_a": {"items": ["Coffee", "Mark levels"]}}})


def _shown(item):
    ids = [b["block"] for b in item["payload"]["blocks"]]
    body = json.dumps(item["bodyJson"])
    return ids, [k for k in ("built_a", "built_b", "routine_a") if "{{block:%s}}" % k in body]


@pytest.mark.parametrize("off, gone", [
    ((), set()),                                   # CONTROL: every wave on, every slot served
    ((9,), {"routine_a"}),                         # wave 9 off ALONE: the routine slot
    ((10,), {"built_a"}),                          # wave 10 off ALONE: the widget whose PLAN needs wave 10
])
def test_a_listed_style_serves_no_dark_wave_slot(db, monkeypatch, off, gone):
    # Review n-3: a slot whose wave is off is not in a note made from the template (journal_styles._served strips
    # it, `_slot_wave_off`), so the listed item the previews read serves neither its block nor its placeholder.
    gid = _slot_template(db)
    waves(monkeypatch, *[w for w in ALL_WAVES if w not in off])
    item = gallery.get_item(MEMBER, gid, conn=db)
    ids, placed = _shown(item)
    want = [k for k in ("built_a", "built_b", "routine_a") if k not in gone]
    assert sorted(ids) == sorted(want) and sorted(placed) == sorted(want)


@pytest.mark.parametrize("off, gone", [((9,), {"routine_a"}), ((10,), {"built_a"})])
def test_the_reviewer_and_the_author_read_every_slot_a_member_read_is_stripped(db, monkeypatch, off, gone):
    """Post-walk p-2: the dark-slot strip (review n-3) is what a MEMBER's preview must see, because a member's note
    would not have those slots. The admin review panel and the item's author read the listed template itself: a
    reviewer approving it, or its author, must see every slot members will get once the wave is on."""
    gid = _slot_template(db)
    waves(monkeypatch, *[w for w in ALL_WAVES if w not in off])
    every = ["built_a", "built_b", "routine_a"]
    for reader, admin in ((AUTHOR, False), ("an-admin", True)):
        ids, placed = _shown(gallery.get_item(reader, gid, is_admin=admin, conn=db))
        assert sorted(ids) == every and sorted(placed) == every, (reader, admin)
    # CONTROL: a member's read is still stripped.
    ids, placed = _shown(gallery.get_item(MEMBER, gid, conn=db))
    want = [k for k in every if k not in gone]
    assert sorted(ids) == want and sorted(placed) == want
