"""Task 11.8 (ruling W11-R7): the credit line of a copy, from its snapshot (`j2_gallery_credits`).

"Based on <label>'s <title>": `UCT` for an official or firm item; the author's gallery label while their author row
exists ("a UCT member" for an anonymous one); "Based on a former member's <title>" once it does not. A withdrawn
listing keeps its credit. Never an email. ONE helper words it everywhere (carry c5).
"""
from __future__ import annotations

import json
import pathlib
import re
import uuid

from api.services.journal_two import account_purge as ap
from api.services.journal_two import template_gallery as gallery
from api.services.journal_two import template_preview as tp
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    AUTHOR, MEMBER, approve, db, heading, list_tool, para, routine_edits, routine, tracker, widget,
)


def _adopt_routine(db, edits=None):
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits=edits or {"name": "Morning", "items": ["Coffee"]})
    return gid, gallery.adopt_tool(MEMBER, gid, conn=db)["id"]


def test_credit_based_on_handle_title(db):
    gid, mine = _adopt_routine(db)
    assert gallery.credit_for(MEMBER, "routine", mine, conn=db) == "Based on Sam's Morning"
    # the label follows the author's CURRENT display name (the handle is the snapshot, the label is live)
    db.execute("UPDATE users SET display_name = 'Samantha' WHERE id = ?", (AUTHOR,))
    db.commit()
    assert gallery.credit_for(MEMBER, "routine", mine, conn=db) == "Based on Samantha's Morning"
    # the member's own work carries none, and another member's copy is not theirs to read
    own = routine(db, uid=MEMBER)
    assert gallery.credit_for(MEMBER, "routine", own["id"], conn=db) is None
    assert gallery.credit_for("someone-else", "routine", mine, conn=db) is None
    facts = gallery.library_facts(MEMBER, "routine", [mine, own["id"]], conn=db)
    assert set(facts) == {mine} and facts[mine]["credit"] == "Based on Samantha's Morning"
    assert facts[mine]["sourceGalleryId"] == gid and facts[mine]["updateAvailable"] is False


def test_credit_official_is_uct(db):
    payload = {"kindId": "weekend_prep", "format": 2, "name": "Pre-market prep", "description": "",
               "outlineBodyJson": {"type": "doc", "content": [heading("Prep"), para("Notes")]}, "blocks": [],
               "properties": {}, "definitions": [], "routines": [], "trackers": [], "slots": []}
    gid = uuid.uuid4().hex
    db.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
               " listed_at, created_at, updated_at, preview_json, item_type, payload_json, version)"
               " VALUES (?, NULL, 'official', 'Pre-market prep', '', 'journal', '{}', 'approved', 'x', 'x', 'x', '[]',"
               " 'style', ?, 1)", (gid, json.dumps(payload)))
    db.commit()
    out = gallery.adopt_template(MEMBER, gid, conn=db)
    assert out["credit"] == "Based on UCT's Pre-market prep"
    assert gallery.credit_for(MEMBER, "template", out["style"]["id"], conn=db) == "Based on UCT's Pre-market prep"


def test_credit_former_member_after_author_purge(db):
    gid, mine = _adopt_routine(db)
    ap.purge_user_rows(AUTHOR, db)
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM j2_gallery_authors WHERE user_id = ?", (AUTHOR,)).fetchone()[0] == 0
    assert gallery.credit_for(MEMBER, "routine", mine, conn=db) == "Based on a former member's Morning"


def test_credit_survives_withdrawn_listing(db):
    gid, mine = _adopt_routine(db)
    assert gallery.unpublish(AUTHOR, gid, conn=db) is True
    assert db.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0] == 0
    assert gallery.credit_for(MEMBER, "routine", mine, conn=db) == "Based on Sam's Morning"


def test_credit_never_an_email(db):
    db.execute("UPDATE users SET display_name = 'sam@example.test' WHERE id = ?", (AUTHOR,))
    db.commit()
    gid, mine = _adopt_routine(db)
    line = gallery.credit_for(MEMBER, "routine", mine, conn=db)
    assert line == "Based on a UCT member's Morning" and "@" not in line
    db.execute("UPDATE users SET display_name = '   ' WHERE id = ?", (AUTHOR,))
    db.commit()
    assert gallery.credit_for(MEMBER, "routine", mine, conn=db) == "Based on a UCT member's Morning"
    # the preview with my data words it the same way (one helper)
    row = gallery.gallery_row(db, gid, MEMBER)
    assert tp.credit_line(row, MEMBER) == "Based on a UCT member's Morning"


def test_one_credit_helper_words_every_credit():
    """carry c5: the sentence "Based on <label>'s <title>" is worded in ONE place, `template_gallery.credit_text`.
    No other module under api/ spells it (an f-string or a format template)."""
    root = pathlib.Path(gallery.__file__).resolve().parents[2]
    pattern = re.compile(r"Based on \{")
    found = []
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in pattern.finditer(text):
            found.append((path.name, text[max(0, m.start() - 30):m.end() + 20]))
    assert [f for f, _ in found] == ["template_gallery.py"], found
    assert "former member" in gallery.CREDIT_FORMER_SENTENCE
    assert gallery.credit_text("T", label=gallery.FIRM_AUTHOR) == "Based on UCT's T"
    assert gallery.credit_text("T", label=gallery.ANONYMOUS_AUTHOR) == "Based on a UCT member's T"
    assert gallery.credit_text("T", former=True) == "Based on a former member's T"
    assert gallery.credit_text("  ") is None


def test_public_names_for_the_reads_the_preview_makes():
    """carry 11.9 c1: public names beside the private ones, the SAME objects."""
    assert gallery.gallery_row is gallery._row and gallery.can_see is gallery._can_see
    assert gallery.listed_payload is gallery._listed_payload and gallery.author_label is gallery._author_label
