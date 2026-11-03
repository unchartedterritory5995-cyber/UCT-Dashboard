"""Plan F Task 7: the repair never deletes member data, in the database or on disk.

Every `.py` under `api/services/journal_two/import_repair/`, `hotlink_fetch.py` (the shared fetch
the repair calls), plus the CLI (`tools/note_import_repair.py`, once Task 8 creates it), read as
text, contains no SQL DELETE and no file deletion (`os.remove`, `os.unlink`, `Path.unlink`,
`os.rmdir`, `shutil.rmtree`, any `shutil.rm*`, `send2trash`): a cursor reset and a notice
dismissal are UPDATEs, and a stored file is never removed. The controls prove each check can fire.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PACKAGE = REPO / "api" / "services" / "journal_two" / "import_repair"
HOTLINK = REPO / "api" / "services" / "journal_two" / "hotlink_fetch.py"
CLI = REPO / "tools" / "note_import_repair.py"
_DELETE = re.compile(r"\bdelete\b", re.IGNORECASE)
#: Task 7 review M-7: file deletion, in every spelling the standard library offers.
_FILE_DELETE = re.compile(r"\b(?:os\.remove|os\.unlink|os\.rmdir|os\.removedirs|shutil\.rm\w*|rmtree|send2trash)\b"
                          r"|\.unlink\s*\(")


def _offenders(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if _DELETE.search(line) or _FILE_DELETE.search(line)]


def test_the_check_can_fire():
    assert _offenders('conn.execute("DELETE FROM j2_notes WHERE id = ?")')
    assert _offenders("delete from x")
    for line in ("os.remove(path)", "os.unlink(p)", "path.unlink(missing_ok=True)", "shutil.rmtree(d)",
                 "shutil.rmtree", "os.rmdir(d)", "from shutil import rmtree", "send2trash(p)"):
        assert _offenders(line), line
    assert not _offenders("deleted_at IS NULL")  # a word match, not a substring
    assert not _offenders("unlinked = 3")  # not a call


def test_no_repair_module_deletes():
    files = sorted(PACKAGE.glob("*.py")) + [HOTLINK] + ([CLI] if CLI.exists() else [])
    assert len(files) >= 7  # __init__, shapes, links, media, store, runner + hotlink_fetch
    found = {str(p.relative_to(REPO)): _offenders(p.read_text(encoding="utf-8")) for p in files}
    assert {k: v for k, v in found.items() if v} == {}
