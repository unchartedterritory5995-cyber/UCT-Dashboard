"""Plan F Task 7: the repair never DELETEs member data.

Every `.py` under `api/services/journal_two/import_repair/`, plus the CLI
(`tools/note_import_repair.py`, once Task 8 creates it), read as text, contains no DELETE: a
cursor reset and a notice dismissal are UPDATEs. The control proves the check can fire.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PACKAGE = REPO / "api" / "services" / "journal_two" / "import_repair"
CLI = REPO / "tools" / "note_import_repair.py"
_DELETE = re.compile(r"\bdelete\b", re.IGNORECASE)


def _offenders(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if _DELETE.search(line)]


def test_the_check_can_fire():
    assert _offenders('conn.execute("DELETE FROM j2_notes WHERE id = ?")')
    assert _offenders("delete from x")
    assert not _offenders("deleted_at IS NULL")  # a word match, not a substring


def test_no_repair_module_deletes():
    files = sorted(PACKAGE.glob("*.py")) + ([CLI] if CLI.exists() else [])
    assert len(files) >= 6  # __init__, shapes, links, media, store, runner
    found = {str(p.relative_to(REPO)): _offenders(p.read_text(encoding="utf-8")) for p in files}
    assert {k: v for k, v in found.items() if v} == {}
