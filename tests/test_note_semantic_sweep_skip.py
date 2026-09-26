"""Wave 7 whole-branch fix round — backend review M-4: the armed semantic sweep
skips a member who has nothing to index, in ONE query.

⚰️ THE DEFECT. `run_sweep` listed every member with a live note and called
`index_member` for each, and the budget shrank only by EMBEDS -- so with
nothing pending, every run (every 15 minutes) visited every member: a
`fetchall` of each member's whole library INCLUDING `body_json`, then a DELETE
and a commit per member. A full j2_notes body scan plus N small auth.db writes
four times an hour, to learn that nothing changed.

THE RULE. One statement decides which members have work: a live note whose
revision marker is missing or differs (an edit, a new note, a provider
switch), or a stored vector whose note is no longer live (trashed, archived,
deleted -- or a member whose notes are gone altogether). Only those members
are visited, oldest-indexed first as before.

⛔ WHY NOT "newest note vs newest indexed block" (the review's first sketch):
a member whose OLDER notes were deferred past a run's budget has an indexed
newest note, so that comparison would skip them forever; so would a trash that
does not move `updated_at`, and a provider switch. Railed below, each.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile

import pytest

from api.services.journal_two import note_semantic as ns

GATE = ns.SEMANTIC_GATE
A, B = "u-sweep-a", "u-sweep-b"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    monkeypatch.setenv(GATE, "1")
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_PROVIDER", "noop")
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def P(t):
    return {"type": "paragraph", "content": [{"type": "text", "text": t}]}


def _note(user_id, title, *paras):
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": title, "bodyJson": {
        "type": "doc", "content": [P(t) for t in paras]}})


def _visits(monkeypatch):
    seen: list[str] = []
    real = ns.index_member

    def spy(uid, **kw):
        seen.append(uid)
        return real(uid, **kw)

    monkeypatch.setattr(ns, "index_member", spy)
    return seen


def _vectors(user_id):
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT COUNT(*) FROM j2_note_embeddings WHERE user_id = ?",
                         (user_id,)).fetchone()[0]
    finally:
        c.close()


class Recorder:
    def __init__(self, conn):
        self._conn = conn
        self.statements: list[str] = []

    def execute(self, sql, params=()):
        self.statements.append(sql)
        return self._conn.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _library():
    _note(A, "Plan A", "Alpha words here.", "More alpha words.")
    _note(A, "Plan A2", "Second note for A.")
    _note(B, "Plan B", "Bravo words here.")
    first = ns.run_sweep()
    assert first["members"] == 2 and first["embedded"] > 0, "non-vacuity: the first sweep indexed nothing"


def test_with_NOTHING_pending_the_sweep_visits_no_member_in_one_read(db_path, monkeypatch):
    _library()
    seen = _visits(monkeypatch)
    from api.services.auth_db import get_connection
    rec = Recorder(get_connection())
    try:
        r = ns.run_sweep(conn=rec)
    finally:
        rec.close()
    assert seen == [], f"members visited with nothing to index: {seen}"
    assert r["members"] == 0 and r["embedded"] == 0
    assert len(rec.statements) == 1, rec.statements          # ONE query decides it
    assert "body_json" not in rec.statements[0], "the decision read note bodies"
    assert not any(s.lstrip().upper().startswith(("DELETE", "INSERT", "UPDATE"))
                   for s in rec.statements), "an idle sweep wrote"


def test_the_decision_reads_j2_notes_from_a_COVERING_INDEX_only(db_path):
    """No note ROW is read to decide: a row's deleted_at/archived_at sit past a
    ~2 KB body, so a per-note row read is an overflow walk per note (the read
    plans' own measurement, docs/notebook/perf-budgets.md). Plans come from the
    schema, not the row count, so this small database answers for a large one."""
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        ns.ensure_semantic_schema(c)
        plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + ns._MEMBERS_WITH_WORK_SQL, ("p",))]
    finally:
        c.close()
    touching = [s for s in plan if "j2_notes " in s + " " and "j2_note_embeddings" not in s]
    assert touching, f"non-vacuity: the plan never touched j2_notes: {plan}"
    assert all("COVERING INDEX" in s for s in touching), touching


def test_an_EDITED_note_brings_back_its_member_and_only_its_member(db_path, monkeypatch):
    from api.services.journal_two import notes
    _library()
    n = next(x for x in notes.list_notes(B) if x["title"] == "Plan B")
    notes.update_note(B, n["id"], {"bodyJson": {"type": "doc", "content": [P("Bravo, edited.")]}})
    seen = _visits(monkeypatch)
    r = ns.run_sweep()
    assert seen == [B] and r["embedded"] >= 1


def test_a_member_whose_OLDER_notes_were_DEFERRED_is_still_visited(db_path, monkeypatch):
    """The newest note is indexed, older ones are owed: newest-vs-newest would
    skip this member forever."""
    for i in range(6):
        _note(A, f"Note {i}", f"First paragraph {i}.", f"Second paragraph {i}.")
    r1 = ns.run_sweep(max_embeds=3)                         # one 3-block note fits
    assert r1["embedded"] == 3 and r1["deferred"] == 5
    seen = _visits(monkeypatch)
    r2 = ns.run_sweep()
    assert seen == [A], "the deferred notes were stranded"
    assert r2["embedded"] == 15 and r2["deferred"] == 0


def test_a_TRASHED_note_still_leaves_the_index(db_path, monkeypatch):
    from api.services.journal_two import notes
    _library()
    gone = next(x for x in notes.list_notes(A) if x["title"] == "Plan A2")
    before = _vectors(A)
    notes.delete_note(A, gone["id"])
    seen = _visits(monkeypatch)
    ns.run_sweep()
    assert seen == [A]
    assert _vectors(A) < before, "the trashed note's vectors stayed"


def test_an_ARCHIVED_note_leaves_the_index_too(db_path, monkeypatch):
    from api.services.auth_db import get_connection
    from api.services.journal_two import notes
    _library()
    n = next(x for x in notes.list_notes(B) if x["title"] == "Plan B")
    c = get_connection()
    try:
        c.execute("UPDATE j2_notes SET archived_at = '2026-09-25T00:00:00Z' WHERE id = ?", (n["id"],))
        c.commit()
    finally:
        c.close()
    seen = _visits(monkeypatch)
    ns.run_sweep()
    assert seen == [B] and _vectors(B) == 0


def test_a_member_whose_notes_are_GONE_has_their_vectors_dropped(db_path, monkeypatch):
    """A member whose note rows no longer exist (an account purged while its
    vectors were being written -- review M-5) is visited by the stored-vector
    half of the query, and the visit drops them."""
    from api.services.auth_db import get_connection
    _library()
    assert _vectors(B) > 0
    c = get_connection()
    try:
        c.execute("DELETE FROM j2_notes WHERE user_id = ?", (B,))
        c.commit()
    finally:
        c.close()
    seen = _visits(monkeypatch)
    ns.run_sweep()
    assert seen == [B] and _vectors(B) == 0


def test_a_PROVIDER_switch_revisits_every_member(db_path, monkeypatch):
    _library()

    class Other(ns.NoOpEmbeddingProvider):
        name = "noop:other"

    seen = _visits(monkeypatch)
    ns.run_sweep(provider=Other())
    assert sorted(seen) == [A, B]


def test_the_members_with_work_are_taken_OLDEST_INDEXED_first(db_path, monkeypatch):
    """The order the budget is spent in is unchanged: the member indexed
    longest ago goes first."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import notes
    _library()
    c = get_connection()
    try:
        c.execute("UPDATE j2_note_embeddings SET updated_at = '2020-01-01|' || updated_at WHERE user_id = ?", (B,))
        c.commit()
    finally:
        c.close()
    for uid in (A, B):
        n = notes.list_notes(uid)[0]
        notes.update_note(uid, n["id"], {"title": n["title"] + " (edited)"})
    seen = _visits(monkeypatch)
    ns.run_sweep()
    assert seen[:2] == [B, A]


# ── backend re-review N1: a note with NOTHING to embed ───────────────────────

E, F = "u-empty", "u-full"
IMAGE = {"type": "image", "attrs": {"src": "https://example.test/chart.png"}}


def _bare(user_id, *content):
    """A note with no embeddable block: no title, and a body the splitter keeps
    nothing of (empty, or an image only)."""
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": "", "bodyJson": {"type": "doc", "content": list(content)}})


def _rows_of(note_id):
    """(block_id, vector bytes) for every stored row of one note."""
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT block_id, length(vector) FROM j2_note_embeddings WHERE note_id = ?",
                         (note_id,)).fetchall()
    finally:
        c.close()


def test_a_note_with_NOTHING_to_embed_retires_its_member_after_one_visit(db_path, monkeypatch):
    """The re-reviewer's probe. ⚰️ A note whose `note_blocks` is [] never got a
    row in j2_note_embeddings, so the work predicate read its revision as
    missing on EVERY run: its member was visited every 15 minutes, forever -- a
    full-library read, a DELETE and commit and an empty UPDATE and commit, the
    exact cost M-4 set out to remove. An abandoned "Untitled" was enough."""
    _bare(E)                                  # an empty "Untitled"
    _bare(E, IMAGE)                           # an image and nothing else
    _note(F, "Plan F", "Full words here.")
    # non-vacuity: these notes really have nothing to embed
    assert ns.note_blocks("", {"type": "doc", "content": []}) == []
    assert ns.note_blocks("", {"type": "doc", "content": [IMAGE]}) == []
    seen = _visits(monkeypatch)
    first = ns.run_sweep()
    assert sorted(seen) == [E, F] and first["embedded"] > 0
    for sweep in (2, 3):
        seen.clear()
        r = ns.run_sweep()
        assert seen == [], f"sweep {sweep} visited {seen}: a note with nothing to embed kept its member"
        assert r["members"] == 0


def test_an_empty_note_that_GAINS_words_is_indexed_and_one_that_stays_empty_retires_again(
        db_path, monkeypatch):
    from api.services.journal_two import notes
    blank = _bare(E)
    image = _bare(E, IMAGE)
    ns.run_sweep()
    notes.update_note(E, blank["id"], {"bodyJson": {"type": "doc", "content": [P("Now it has words.")]}})
    notes.update_note(E, image["id"], {"bodyJson": {"type": "doc", "content": [IMAGE, IMAGE]}})
    seen = _visits(monkeypatch)
    ns.run_sweep()
    assert seen == [E], "an edit to a note with nothing to embed is work"
    rows = _rows_of(blank["id"])
    assert rows and all(size > 0 for _bid, size in rows), (
        f"the note that gained words must hold only real vectors: {rows}")
    seen.clear()
    ns.run_sweep()
    assert seen == [], f"the note that stayed empty kept its member in the work set: {seen}"


def test_a_member_whose_NEWEST_note_is_empty_still_gets_meaning_hits(db_path):
    """The empty note's record is the member's FIRST candidate row (newest
    first), and the candidate read takes the matrix width from the first row
    it reads: read as a vector, a record of nothing would make the width zero
    and skip every real vector -- no meaning hits at all for a member with a
    blank newest note."""
    from api.services.auth_db import get_connection
    plan = _note(F, "Plan F", "Semis rotation and breadth thrust.")
    blank = _bare(F)
    c = get_connection()
    try:                                       # pin the blank as the newest note
        c.execute("UPDATE j2_notes SET updated_at = '2099-01-01T00:00:00Z' WHERE id = ?", (blank["id"],))
        c.commit()
    finally:
        c.close()
    ns.run_sweep()
    c = get_connection()
    try:                                       # non-vacuity: the blank's record comes FIRST
        first = c.execute(ns._CANDIDATES_SQL, (F, "[]", 10)).fetchone()
    finally:
        c.close()
    assert first is not None and first[0] == blank["id"], (tuple(first) if first else first)
    ns.clear_query_cache()
    hits = ns.search(F, "semis rotation breadth")
    assert [h["note_id"] for h in hits] == [plan["id"]], hits
