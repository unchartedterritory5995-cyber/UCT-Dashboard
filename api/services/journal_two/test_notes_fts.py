"""FTS5 index maintenance for the Notebook.

The index is maintained by SQLite TRIGGERS, not by calls in each writer.
There are 11 production write statements against j2_notes across notes.py,
note_connectors/engine.py and db.py; a hand-wired index would go stale on
whichever one a future change forgets. These tests exercise the index
through RAW SQL writes precisely BECAUSE that is what the importer and the
sync engine do -- if the triggers only worked via the service functions,
every imported note would be invisible to search.
"""
import sqlite3

from api.services.journal_two.db import ensure_schema


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _insert_note(c, note_id, user_id="u1", title="", body_plain=""):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (note_id, user_id, title, '{"type":"doc","content":[]}', body_plain,
         "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()


def _fts_ids(c, expr):
    return {r["note_id"] for r in c.execute(
        "SELECT note_id FROM j2_notes_fts WHERE j2_notes_fts MATCH ?", (expr,))}


def test_raw_insert_is_indexed_by_trigger():
    c = _conn()
    _insert_note(c, "n1", title="Breakout thesis", body_plain="NVDA cup and handle")
    assert _fts_ids(c, "cup") == {"n1"}


def test_raw_update_reindexes_and_drops_stale_terms():
    c = _conn()
    _insert_note(c, "n1", title="Old", body_plain="obsolete wording")
    c.execute("UPDATE j2_notes SET title=?, body_plain=? WHERE id=?",
              ("New", "fresh wording", "n1"))
    c.commit()
    assert _fts_ids(c, "fresh") == {"n1"}
    assert _fts_ids(c, "obsolete") == set()


def test_raw_delete_removes_from_index():
    c = _conn()
    _insert_note(c, "n1", body_plain="ephemeral")
    c.execute("DELETE FROM j2_notes WHERE id=?", ("n1",))
    c.commit()
    assert _fts_ids(c, "ephemeral") == set()


def _fts_rowid(c, note_id):
    row = c.execute(
        "SELECT rowid FROM j2_notes_fts WHERE note_id = ?", (note_id,)).fetchone()
    return row["rowid"] if row else None


def test_bookkeeping_update_does_not_touch_the_index():
    """The sync engine writes tags/import_hash via raw SQL that deliberately
    preserves updated_at. Those columns are not indexed, so the trigger must
    not fire for them -- re-indexing every bookkeeping write would make a
    nightly full pass rewrite the entire index.

    Content alone can't prove the trigger skipped firing: a delete+reinsert of
    UNCHANGED title/body_plain is indistinguishable from a no-op by content --
    an over-broad bare `AFTER UPDATE` (no column filter) would also leave "n1"
    findable under "stable". A standalone FTS5 table assigns a NEW rowid on
    reinsert, so the rowid is the observable discriminator content can't give
    us. n2 is inserted afterward so n1 is never the table's max rowid --
    otherwise a delete-then-reinsert of the LAST row can coincidentally be
    handed back its own rowid (verified empirically), which would make this
    assertion pass even under the bare trigger it's meant to catch."""
    c = _conn()
    _insert_note(c, "n1", body_plain="stable text")
    _insert_note(c, "n2", body_plain="a later note, so n1 is never the max rowid")
    rowid_before = _fts_rowid(c, "n1")
    c.execute("UPDATE j2_notes SET tags=? WHERE id=?", ('["a"]', "n1"))
    c.commit()
    assert _fts_ids(c, "stable") == {"n1"}
    assert _fts_rowid(c, "n1") == rowid_before, (
        "fts rowid changed on a tags-only write -- the trigger fired "
        "(delete+reinsert) when it must not have")


def test_migration_v4_backfills_rows_that_predate_the_index(tmp_path, monkeypatch):
    """A pre-existing DB has notes but no index. The migration must backfill,
    and must be safe to run twice (no duplicate hits)."""
    from api.services.journal_two import db as dbmod
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    c = _conn()
    _insert_note(c, "n1", body_plain="legacy content")
    c.execute("DELETE FROM j2_notes_fts")  # simulate an un-indexed legacy DB
    c.commit()
    assert _fts_ids(c, "legacy") == set()

    dbmod.run_notebook_migration_v4(c)
    assert _fts_ids(c, "legacy") == {"n1"}

    (tmp_path / ".notebook_migration_v4").unlink()
    dbmod.run_notebook_migration_v4(c)
    rows = list(c.execute(
        "SELECT note_id FROM j2_notes_fts WHERE j2_notes_fts MATCH ?", ("legacy",)))
    assert len(rows) == 1, "re-running the migration duplicated index rows"


from api.services.journal_two.notes_search import fts_match_expr


def test_fts_match_expr_quotes_terms_and_prefixes_the_last():
    assert fts_match_expr("cup handle") == '"cup" "handle"*'


def test_fts_match_expr_neutralises_fts_operators():
    """A user typing a quote or a NEAR/OR operator must not crash the query
    or silently change its meaning -- FTS5 raises on malformed MATCH text."""
    assert fts_match_expr('nvda "breakout') == '"nvda" "breakout"*'
    assert fts_match_expr("cup OR handle") == '"cup" "OR" "handle"*'


def test_fts_match_expr_returns_none_when_nothing_is_searchable():
    assert fts_match_expr("   ") is None
    assert fts_match_expr('"""') is None


def test_search_finds_a_note_written_by_raw_sql():
    """The importer and sync engine both write via raw SQL. If search only
    saw service-function writes, every migrated note would be unfindable --
    which is the entire failure this wave exists to prevent."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", title="Migrated", body_plain="anchored volume shelf")
    rows = list_notes("u1", q="anchored", conn=c)
    assert [r["id"] for r in rows] == ["n1"]


def test_search_agrees_with_the_like_fallback():
    """Pins the two search paths together, the way
    test_backlinks_and_the_list_filter_agree pins the backlink reader to the
    list filter. If FTS and LIKE ever disagree on membership for a plain
    single-word, TOKEN-BOUNDARY query, this goes red rather than quietly
    returning a different set of notes than the code it replaced.

    This is NOT a claim that FTS and LIKE agree in general -- they don't.
    FTS5 MATCH (with the trailing `*`) matches whole tokens / token PREFIXES;
    LIKE matches arbitrary substrings anywhere, including mid-word. Every
    fixture term below is a complete word that starts at a token boundary in
    the note it's meant to match, which is the only regime this rail claims
    to cover. See test_search_deliberately_no_longer_matches_mid_word_substrings
    for the documented, intentional divergence outside that regime.
    """
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", title="Cup and handle", body_plain="NVDA base")
    _insert_note(c, "n2", title="Unrelated", body_plain="gold miners")
    for term in ("cup", "nvda", "gold", "handle"):
        fts = {r["id"] for r in list_notes("u1", q=term, conn=c)}
        like = {r["id"] for r in c.execute(
            "SELECT id FROM j2_notes WHERE user_id='u1' AND"
            " (lower(title) LIKE ? OR lower(body_plain) LIKE ?)",
            (f"%{term}%", f"%{term}%"))}
        assert fts == like, f"FTS and LIKE disagree on {term!r}: {fts} vs {like}"


def test_search_deliberately_no_longer_matches_mid_word_substrings():
    """DELIBERATE, REVIEWED BEHAVIOUR CHANGE -- not a bug, and not something
    to "fix" by loosening the FTS query back toward substring matching.

    The old LIKE-based search matched ANY substring anywhere in the text, so
    typing "andle" found a note containing "handle". FTS5 MATCH with a
    prefix (`*`) only matches whole tokens or a token's PREFIX -- "andle" is
    neither "handle" nor a prefix of it, so it now returns nothing through
    list_notes(q=...), even though the raw LIKE query below still matches.

    This means members who type a partial word starting mid-token (not at
    the start of a word) get different -- and in this case worse -- results
    than before. That is a known, accepted cost of moving search onto FTS5
    for ranking + operator support (quoting, prefix-as-you-type), reviewed
    and signed off rather than discovered later by a member filing a "search
    is broken" ticket.
    """
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", title="Cup and handle", body_plain="NVDA base")

    fts = {r["id"] for r in list_notes("u1", q="andle", conn=c)}
    like = {r["id"] for r in c.execute(
        "SELECT id FROM j2_notes WHERE user_id='u1' AND"
        " (lower(title) LIKE ? OR lower(body_plain) LIKE ?)",
        ("%andle%", "%andle%"))}

    assert fts == set(), f"expected no FTS matches for a mid-word substring, got {fts}"
    assert like == {"n1"}, "LIKE should still match the substring -- this pins the divergence, not a LIKE regression"
