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


def _assert_map_and_fts_are_consistent(c, live_ids, deleted_id):
    """The invariant the v4/v5 desync bug breaks: every live note has EXACTLY
    one map row, that row's fts_rowid names an fts row that ACTUALLY belongs
    to that same note (not a different note's row, and not nothing), and the
    deleted note has no trace in either table.

    A weaker check (just "map row count == fts row count") passes even when
    rows are pairwise swapped -- this walks each note by id and asks the fts
    table itself who rowid X belongs to, which is the only way to catch
    "note A's map row points at note B's fts row."
    """
    map_rows = dict(c.execute("SELECT note_id, fts_rowid FROM j2_notes_fts_map"))
    fts_owner = dict(c.execute("SELECT rowid, note_id FROM j2_notes_fts"))

    assert set(map_rows) == set(live_ids), (
        f"map ids {set(map_rows)} != live ids {set(live_ids)}")
    assert set(fts_owner.values()) == set(live_ids), (
        f"fts ids {set(fts_owner.values())} != live ids {set(live_ids)}")

    for nid in live_ids:
        rowid = map_rows[nid]
        owner = fts_owner.get(rowid)
        assert owner == nid, (
            f"note {nid}'s map row points at fts rowid {rowid}, which "
            f"belongs to {owner!r} instead (dangling if None)")

    assert deleted_id not in map_rows, f"deleted note {deleted_id} still has a map row"
    assert deleted_id not in fts_owner.values(), (
        f"deleted note {deleted_id} is still searchable in j2_notes_fts")


def _seed_ten_and_delete_one(c, dbmod):
    """Shared setup for the three flag-loss scenarios below: 10 notes via the
    CURRENT (already-fixed) triggers, then one deleted the normal way -- both
    operations that, on their own, leave the map and fts correctly paired.
    The desync this reproduces comes only from what happens to a SEPARATE,
    OUT-OF-BAND rebuild (run_notebook_migration_v4) after that point.

    `ensure_schema` is called again at the end, on a DB that now has real
    (non-zero) notes -- `_conn()`'s own initial call ran against an EMPTY
    j2_notes, and v4 defers writing its flag until note_count > 0 (by
    design: a not-yet-arrived batch of legacy notes must still get backfilled
    later). Without this second call neither migration flag has actually
    been written yet, and "delete the flag to force a rerun" is testing
    nothing -- this mirrors production, where 76 real notes have already
    made both migrations complete for real."""
    ids = [f"n{i}" for i in range(10)]
    for i, nid in enumerate(ids):
        _insert_note(c, nid, body_plain=f"content unique{i}")
    c.execute("DELETE FROM j2_notes WHERE id=?", (ids[5],))
    c.commit()
    dbmod.ensure_schema(c)
    return ids[5], [i for i in ids if i != ids[5]]


def test_losing_only_the_v4_flag_after_v5_already_ran(tmp_path, monkeypatch):
    """Reproduces the reviewer's scenario verbatim: an operator (or a future
    flag-write failure) deletes ONLY `.notebook_migration_v4` to force a
    reindex, on a DB where v5 already completed. v4's rebuild reassigns
    j2_notes_fts's rowids via raw DML that fires no trigger -- if nothing
    re-syncs j2_notes_fts_map to match, existing map rows go stale/wrong."""
    from api.services.journal_two import db as dbmod
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    c = _conn()
    deleted_id, live_ids = _seed_ten_and_delete_one(c, dbmod)

    (tmp_path / ".notebook_migration_v4").unlink()
    dbmod.ensure_schema(c)  # v4 reruns alone; v5's flag is untouched

    _assert_map_and_fts_are_consistent(c, live_ids, deleted_id)
    # And the fix must still actually find things by content, not just by id.
    assert _fts_ids(c, "unique3") == {"n3"}


def test_losing_only_the_v5_flag(tmp_path, monkeypatch):
    """Same shape, but the LOST flag is v5's. v5 must be safe to run on its
    own (before, after, or without v4 having rerun) and must never leave a
    stale map row behind via a partial patch like INSERT OR IGNORE."""
    from api.services.journal_two import db as dbmod
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    c = _conn()
    deleted_id, live_ids = _seed_ten_and_delete_one(c, dbmod)

    (tmp_path / ".notebook_migration_v5").unlink()
    dbmod.ensure_schema(c)  # v5 reruns alone; v4's flag is untouched

    _assert_map_and_fts_are_consistent(c, live_ids, deleted_id)
    assert _fts_ids(c, "unique3") == {"n3"}


def test_losing_both_flags(tmp_path, monkeypatch):
    """Both migrations rerun (v4 then v5, per ensure_schema's call order) --
    must still converge on a correct pairing."""
    from api.services.journal_two import db as dbmod
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    c = _conn()
    deleted_id, live_ids = _seed_ten_and_delete_one(c, dbmod)

    (tmp_path / ".notebook_migration_v4").unlink()
    (tmp_path / ".notebook_migration_v5").unlink()
    dbmod.ensure_schema(c)

    _assert_map_and_fts_are_consistent(c, live_ids, deleted_id)
    assert _fts_ids(c, "unique3") == {"n3"}


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
