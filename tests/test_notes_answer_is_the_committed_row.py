"""⛔⛔ A NOTE WRITER ANSWERS WITH THE ROW IT COMMITTED — never a later writer's.

Wave 10, lane 10C (wave-7 review J, M-3; OPEN-ITEMS "update_note reads its
result before commit"). Every note writer in `notes.py` used to commit and THEN
re-read the row. A second writer that commits in that gap -- another request
thread on the single web pod, parked in its busy handler -- was returned as OUR
answer. Every door that settles that answer (the editor's save, the offline
layer's landed-save, the append doors) then records THEIR revision as ours: the
next save's baseline carries their `updated_at`, the compare-and-set passes, and
it overwrites their words. The J9 class, in a microsecond window.

How the rail makes the window real rather than timing it: a connection proxy
whose `commit()` commits and then, once, lets a SECOND connection write the same
row (new body, far-future `updated_at`) and commit. Read after the commit, the
writer returns that second write; read before it (the fix), its own.

⛔ A control proves the interleaving write actually LANDED for every door -- a
proxy whose hook never fired would pass every assertion over an unexercised
window (CLAUDE.md "an empty result is a failed invocation until proven otherwise").

The census half fails on any NEW `conn.commit()` followed by a
`SELECT * FROM j2_notes WHERE id` re-read anywhere under `api/`, with its own
non-vacuity control (the pattern must match a planted example).
"""
from __future__ import annotations

import ast
import json
import re
import sqlite3
from pathlib import Path

import pytest

from api.services.journal_two import notes as svc
from api.services.journal_two.db import ensure_schema

REPO = Path(__file__).resolve().parents[1]
USER = "u-race"
THEIRS_AT = "2099-01-01T00:00:00+00:00"
THEIRS_TEXT = "THEIR WORDS, written in the gap"


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


class InterleavingConn:
    """A sqlite3 connection whose FIRST commit is followed, before anything else
    runs on it, by a second writer's committed write to one note."""

    def __init__(self, real: sqlite3.Connection, path: str, target_id):
        self._real = real
        self._path = path
        self._target_id = target_id  # callable(conn) -> note id, resolved at fire time
        self.fired_on: str | None = None

    def __getattr__(self, name):
        return getattr(self._real, name)

    def commit(self):
        self._real.commit()
        if self.fired_on is None:
            other = sqlite3.connect(self._path, timeout=5)
            try:
                nid = self._target_id(other)
                other.execute(
                    "UPDATE j2_notes SET body_json = ?, body_plain = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(_doc(THEIRS_TEXT)), THEIRS_TEXT, THEIRS_AT, nid))
                other.commit()
                self.fired_on = nid
            finally:
                other.close()


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "race.db")
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.commit()
    c.close()
    return path


def _open(path: str) -> sqlite3.Connection:
    c = sqlite3.connect(path, timeout=5)
    c.row_factory = sqlite3.Row
    return c


def _seed_note(path: str, *, trashed: bool = False) -> str:
    c = _open(path)
    try:
        n = svc.create_note(USER, {"title": "seed", "bodyJson": _doc("seed words")}, conn=c)
        if trashed:
            assert svc.delete_note(USER, n["id"], conn=c)
        return n["id"]
    finally:
        c.close()


def _stored(path: str, note_id: str) -> sqlite3.Row:
    c = _open(path)
    try:
        return c.execute("SELECT * FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    finally:
        c.close()


def _by_id(note_id):
    return lambda other: note_id


def _newest(other):
    return other.execute("SELECT id FROM j2_notes ORDER BY rowid DESC LIMIT 1").fetchone()[0]


# door name -> (needs a trashed seed?, how to call it with the proxy)
DOORS = {
    "update_note": (False, lambda nid, conn: svc.update_note(
        USER, nid, {"bodyJson": _doc("OUR WORDS")}, conn=conn)),
    "append_widget_embed": (False, lambda nid, conn: svc.append_widget_embed(
        USER, nid, {"widgetId": "w-race"}, conn=conn)),
    "append_financial_fact": (False, lambda nid, conn: svc.append_financial_fact(
        USER, nid, "fact-race", conn=conn)),
    "append_document_excerpt": (False, lambda nid, conn: svc.append_document_excerpt(
        USER, nid, "excerpt-race", conn=conn)),
    "restore_note": (True, lambda nid, conn: svc.restore_note(USER, nid, conn=conn)),
    "set_note_archived": (False, lambda nid, conn: svc.set_note_archived(USER, nid, True, conn=conn)),
}


@pytest.mark.parametrize("door", sorted(DOORS))
def test_the_answer_is_the_row_this_call_committed_not_a_later_writers(db, door):
    trashed, call = DOORS[door]
    nid = _seed_note(db, trashed=trashed)
    real = _open(db)
    proxy = InterleavingConn(real, db, _by_id(nid))
    try:
        answer = call(nid, proxy)
    finally:
        real.close()

    # ⛔ CONTROL: the second writer's commit really landed in the gap.
    assert proxy.fired_on == nid, f"{door}: the interleaving write never fired -- the window was not exercised"
    assert _stored(db, nid)["updated_at"] == THEIRS_AT, f"{door}: the second writer's commit is not in the store"

    assert answer is not None, f"{door} answered None"
    assert answer["updatedAt"] != THEIRS_AT, (
        f"⛔ {door} answered with the SECOND writer's revision {THEIRS_AT} -- the row was re-read "
        f"AFTER the commit, so a settle would record their revision as ours")
    assert THEIRS_TEXT not in json.dumps(answer["bodyJson"]), (
        f"⛔ {door} answered with the SECOND writer's body")


def test_create_note_answers_with_its_own_row(db):
    real = _open(db)
    proxy = InterleavingConn(real, db, _newest)
    try:
        answer = svc.create_note(USER, {"title": "fresh", "bodyJson": _doc("OUR NEW NOTE")}, conn=proxy)
    finally:
        real.close()
    assert proxy.fired_on == answer["id"], "the interleaving write did not target the created note"
    assert _stored(db, answer["id"])["updated_at"] == THEIRS_AT
    assert answer["updatedAt"] != THEIRS_AT
    assert "OUR NEW NOTE" in json.dumps(answer["bodyJson"])


# ── the census: no NEW commit-then-re-read under api/ ─────────────────────────────

_REREAD = re.compile(r"SELECT \* FROM j2_notes WHERE id")


def _is_commit_call(stmt) -> bool:
    return (isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call)
            and isinstance(stmt.value.func, ast.Attribute) and stmt.value.func.attr == "commit"
            and not stmt.value.args)


def _rereads(stmt) -> bool:
    return any(isinstance(n, ast.Constant) and isinstance(n.value, str) and _REREAD.search(n.value)
               for n in ast.walk(stmt))


def commit_then_reread_sites(text: str, following: int = 2) -> list[int]:
    """Line numbers of a real `<x>.commit()` CALL STATEMENT followed, within the next
    `following` statements of the same block, by a `SELECT * FROM j2_notes WHERE id`
    string. ⛔ By AST, never by grep: a grep matched this rail's own docstring prose
    on its first run -- the "found 5 call sites, all five of them prose" trap."""
    out = []
    for node in ast.walk(ast.parse(text)):
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if not isinstance(block, list):
                continue
            for i, stmt in enumerate(block):
                if _is_commit_call(stmt) and any(_rereads(s) for s in block[i + 1:i + 1 + following]):
                    out.append(stmt.lineno)
    return sorted(out)


def test_the_census_pattern_can_see_the_old_shape():
    """⛔ Non-vacuity: the pattern must FIND the shape it exists to forbid -- and must
    NOT find it in prose or in the fixed order."""
    planted = (
        "def old(conn, note_id):\n"
        "    conn.commit()\n"
        "    row = conn.execute(\n"
        "        \"SELECT * FROM j2_notes WHERE id = ?\", (note_id,)\n"
        "    ).fetchone()\n"
        "    return row\n"
    )
    assert commit_then_reread_sites(planted) == [2]
    fixed = "def new(conn, note_id):\n    row = _read_own_write(conn, note_id)\n    conn.commit()\n    return row\n"
    assert commit_then_reread_sites(fixed) == []
    prose = 'def doc():\n    """conn.commit() followed by a SELECT * FROM j2_notes WHERE id re-read"""\n'
    assert commit_then_reread_sites(prose) == []


def test_no_note_writer_under_api_re_reads_after_its_commit():
    files = [p for p in (REPO / "api").rglob("*.py") if not p.name.startswith("test_")]
    assert len(files) > 100, "the census walked almost nothing -- a broken glob is not a clean tree"
    assert (REPO / "api" / "services" / "journal_two" / "notes.py") in files
    hits = []
    for p in files:
        for ln in commit_then_reread_sites(p.read_text(encoding="utf-8", errors="replace")):
            hits.append(f"{p.relative_to(REPO)}:{ln}")
    assert hits == [], (
        "⛔ a writer commits and THEN re-reads its note -- read before the commit "
        "(notes._read_own_write): " + ", ".join(hits))
