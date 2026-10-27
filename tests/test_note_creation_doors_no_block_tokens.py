"""W11-R77 (review n-1): the server's doors that read a member template's BODY, each named with what it does with
it, so a new door that makes a note from a template is caught by name.

No member note holds raw `{{block:...}}` text: a door that makes a NOTE from a member template without composing it
passes the body through `journal_styles.without_placeholder_lines` (the daily note); a style's Use composes it
(placeholders become blocks); the gallery's card lines and previews have their own rule (W11-R76). Derived from the
source tree each run: every `api/` module outside `note_templates.py` that calls `note_templates.get_template(` or
selects a member template's `body_json` must be listed here."""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
READS = re.compile(r"note_templates\.get_template\(|SELECT\s+(?:\*|body_json)\s+FROM\s+j2_note_templates")

#: module -> what it does with the body. "NOTE" marks a door that MAKES A NOTE from it.
DOORS = {
    "api/routers/journal_two.py": "GET /note-templates/{id}: serves the template itself (the preview names its blocks)",
    "api/services/journal_two/note_daily.py": "NOTE: the daily note from the member's daily template",
    "api/services/journal_two/journal_styles.py": "a style's linked outline: compose places every placeholder",
    "api/services/journal_two/template_gallery.py": "publish to the gallery: card lines by W11-R76, previews named",
}


def _readers() -> set[str]:
    out = set()
    for p in (ROOT / "api").rglob("*.py"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.endswith("journal_two/note_templates.py"):
            continue
        if READS.search(p.read_text(encoding="utf-8", errors="ignore")):
            out.add(rel)
    return out


def test_every_door_that_reads_a_member_template_body_is_named():
    found = _readers()
    assert "api/services/journal_two/note_daily.py" in found                 # non-vacuity: the census sees the door
    assert found <= set(DOORS), f"a new door reads a member template's body: {sorted(found - set(DOORS))}"


def test_every_note_making_door_strips_placeholder_lines():
    for rel, what in DOORS.items():
        if what.startswith("NOTE"):
            assert "without_placeholder_lines(" in (ROOT / rel).read_text(encoding="utf-8"), rel
