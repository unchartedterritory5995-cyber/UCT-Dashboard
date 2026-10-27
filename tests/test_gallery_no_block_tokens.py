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
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    AUTHOR, MEMBER, approve, db, heading, para, style,
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
