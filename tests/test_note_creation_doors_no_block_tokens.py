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
READS = re.compile(
    r"note_templates\.get_template\("
    # post-walk p-3: the function imported by name (alone, in a parenthesised list, or renamed)
    r"|from\s+[\w.]*note_templates\s+import\s+(?:\([^)]*?|[^\n]*?)\bget_template\b"
    # post-walk p-3: any SELECT whose column list names body_json (or *), across adjacent string literals
    r"|SELECT\s+(?:\w+\.)?\*\s+FROM\s+j2_note_templates\b"
    r"|SELECT\s+(?:(?!\bFROM\b|;)[\s\S]){0,400}?\bbody_json\b(?:(?!\bFROM\b|;)[\s\S]){0,400}?\bFROM\s+j2_note_templates\b",
    re.IGNORECASE,
)
#: post-walk p-3: `import note_templates as nt` then `nt.get_template(` -- the alias is read from the import.
ALIAS = re.compile(r"\bimport\s+note_templates\s+as\s+(\w+)")


def _reads(src: str) -> bool:
    if READS.search(src):
        return True
    return any(re.search(rf"\b{re.escape(a)}\.get_template\(", src) for a in ALIAS.findall(src))

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
        if _reads(p.read_text(encoding="utf-8", errors="ignore")):
            out.add(rel)
    return out


# Post-walk p-3: the shapes a door can read a member template's body in, and two that are NOT a read. The census must
# see every one of the first list, and none of the second, or a new door slips past it by spelling.
SEEN = [
    "from api.services.journal_two import note_templates\nnote_templates.get_template(uid, tid)",
    "from api.services.journal_two.note_templates import get_template\nget_template(uid, tid)",
    "from api.services.journal_two.note_templates import (\n    list_templates,\n    get_template as read_tpl,\n)",
    "from api.services.journal_two import note_templates as nt\nnt.get_template(uid, tid)",
    'conn.execute("SELECT body_json FROM j2_note_templates WHERE id = ?", (tid,))',
    'conn.execute("SELECT id, title, body_json FROM j2_note_templates WHERE id = ?", (tid,))',
    'conn.execute("SELECT t.body_json, t.title"\n             " FROM j2_note_templates t WHERE t.id = ?", (tid,))',
    'conn.execute("select * from j2_note_templates where user_id = ?", (uid,))',
]
NOT_SEEN = [
    'conn.execute("SELECT 1 FROM j2_note_templates WHERE id = ? AND user_id = ?", (tid, uid))',
    'conn.execute("SELECT COUNT(*) AS c FROM j2_note_templates WHERE user_id = ?", (uid,))',
    "from api.services.journal_two.note_templates import list_templates\nlist_templates(uid)",
    'conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,))',
]


def test_the_census_sees_every_shape_of_a_read_and_nothing_else():
    for src in SEEN:
        assert _reads(src), src
    for src in NOT_SEEN:
        assert not _reads(src), src


def test_every_door_that_reads_a_member_template_body_is_named():
    found = _readers()
    assert "api/services/journal_two/note_daily.py" in found                 # non-vacuity: the census sees the door
    assert found <= set(DOORS), f"a new door reads a member template's body: {sorted(found - set(DOORS))}"


def test_every_note_making_door_strips_placeholder_lines():
    for rel, what in DOORS.items():
        if what.startswith("NOTE"):
            assert "without_placeholder_lines(" in (ROOT / rel).read_text(encoding="utf-8"), rel
