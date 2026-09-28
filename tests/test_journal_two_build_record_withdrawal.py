"""A build record that cannot be WITHDRAWN is not trusted (wave 10 follow-up F2, review N-1).

The map's `note_rowid` and the tag index copy j2_notes' implicit rowid, which a logical
restore renumbers. The boot's drift check withdraws their record (`_unmark_built`) before
it rebuilds -- but that withdrawal is itself a WRITE, and on auth.db a write can lose to
`database is locked`. The re-review reproduced it (its probe P5): the DELETE raised, the
record stood, the readers trusted rowids that now pointed at no note, and search answered
`[]` instead of the four notes it answered before the restore.

Pinned here, with a REAL write lock held by a second connection (not a mocked DELETE):
  * the withdrawal is retried with backoff (`_UNMARK_RETRY_WAITS_S`), and when every
    attempt is refused it says so in a line of its own and raises;
  * the family is WITHHELD in this process from the start of its boot check until the
    check proves it, so the refused withdrawal leaves every read on the fallback -- the
    old, correct answer, never `[]` -- on this connection and on any other connection
    this process opens to the same file;
  * the withholding reaches only that file, and the next boot that proves the structure
    trusts it again;
  * a lock released during the backoff lets the retry withdraw, rebuild and record.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """Production's DATA_DIR holds the v4/v5 flags, so those migrations are no-ops."""
    d = tmp_path / "data"
    d.mkdir()
    for flag in (".notebook_migration_v4", ".notebook_migration_v5"):
        (d / flag).write_bytes(b"1")
    monkeypatch.setenv("DATA_DIR", str(d))
    return d


def _conn(path, timeout=5.0):
    c = sqlite3.connect(str(path), timeout=timeout)
    c.row_factory = sqlite3.Row
    notes_svc.register_note_sql_functions(c)
    return c


def _insert(c, nid, text, tags):
    body = json.dumps({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
              " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
              (nid, U, nid, body, text, json.dumps(tags),
               "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"))


def _answers(c):
    """The search's four reads and the tag filter's two, as sets and totals."""
    listed = sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c))
    ranked = sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", sort="relevance", conn=c))
    rows, total = notes_svc.list_and_count_notes(U, q="breakout", conn=c)
    tagged = sorted(n["id"] for n in notes_svc.list_notes(U, tag="setups", conn=c))
    trows, ttotal = notes_svc.list_and_count_notes(U, tag="setups", conn=c)
    return (listed, ranked, (sorted(n["id"] for n in rows), total),
            tagged, (sorted(n["id"] for n in trows), ttotal))


def _drifted(path, mode):
    """A healthy, recorded database; then its notes renumbered, as a logical restore does.
    Returns the answers it gave before the renumbering."""
    c = _conn(path)
    if mode == "wal":
        c.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(c)
    for i in range(12):
        _insert(c, f"id{i:03d}", "breakout over the pivot" if i % 3 == 0 else "range day",
                ["Setups"] if i % 4 == 0 else ["research/semis"])
    c.commit()
    want = _answers(c)
    assert want[0] == ["id000", "id003", "id006", "id009"] and want[3] == ["id000", "id004", "id008"]
    c.execute("UPDATE j2_notes SET rowid = 100000 - rowid")        # reversed, no collision
    c.commit()
    assert _answers(c) != want            # non-vacuity: the recorded reads now answer wrong
    c.close()
    return want


def _boot_steps(c):
    """The two wave-10 steps exactly as `ensure_schema` wraps them: an exception rolls
    back, is printed, and the boot goes on."""
    outs = []
    for step in (j2db._upgrade_fts_map_note_rowid, j2db._ensure_note_tag_index):
        try:
            outs.append(step(c))
        except Exception as e:  # noqa: BLE001
            c.rollback()
            outs.append(e)
    return outs


def _hold_write_lock(path):
    holder = sqlite3.connect(str(path), isolation_level=None, timeout=0.05, check_same_thread=False)
    holder.execute("BEGIN IMMEDIATE")
    return holder


@pytest.mark.parametrize("mode", ["delete", "wal"])
def test_a_withdrawal_the_lock_refuses_leaves_every_read_on_the_fallback(tmp_path, data_dir, monkeypatch,
                                                                         capsys, mode):
    """The re-review's probe P5, for the map and the tag index, in both journal modes."""
    path = tmp_path / "restored.db"
    want = _drifted(path, mode)
    monkeypatch.setattr(j2db, "_UNMARK_RETRY_WAITS_S", (0.0, 0.0))    # three attempts, no sleeping
    holder = _hold_write_lock(path)
    c = _conn(path, timeout=0.05)
    try:
        fts_out, tag_out = _boot_steps(c)
    finally:
        holder.execute("ROLLBACK")
        holder.close()
    assert isinstance(fts_out, sqlite3.OperationalError) and "locked" in str(fts_out)
    assert isinstance(tag_out, sqlite3.OperationalError) and "locked" in str(tag_out)
    # non-vacuity: the records really STAND -- the lock refused their withdrawal
    assert j2db._recorded(c, j2db._FTS_MAP_BUILD)
    assert j2db._recorded(c, j2db._NOTE_TAG_INDEX_BUILD)
    # ... and this process does not trust them
    assert not notes_svc._fts_map_ready(c) and not notes_svc._tag_index_ready(c)
    assert _answers(c) == want
    # a request opens its own connection: the withholding is the FILE's, not this connection's
    other = _conn(path)
    assert not notes_svc._fts_map_ready(other)
    assert _answers(other) == want
    other.close()
    # the refusal is said in a line of its own, not the step's generic abort
    printed = capsys.readouterr().out
    assert "could NOT withdraw the record of j2_notes_fts_map.note_rowid after 3 attempts" in printed
    assert "could NOT withdraw the record of j2_note_tag_index after 3 attempts" in printed
    # the next boot, with the lock gone, rebuilds, records and trusts again
    fts_out, tag_out = _boot_steps(c)
    assert fts_out["marked"] and fts_out["reason"] == "rebuilt_for_drift"
    assert tag_out["rebuilt_for_drift"]
    assert notes_svc._fts_map_ready(c) and notes_svc._tag_index_ready(c)
    assert _answers(c) == want
    c.close()


def test_a_lock_released_during_the_backoff_lets_the_retry_withdraw(tmp_path, data_dir, monkeypatch):
    path = tmp_path / "restored.db"
    want = _drifted(path, "wal")
    holder = _hold_write_lock(path)
    slept = []

    def sleep(seconds):                   # the other writer commits while we back off
        slept.append(seconds)
        if len(slept) == 1:
            holder.execute("ROLLBACK")
    monkeypatch.setattr(j2db, "_UNMARK_RETRY_WAITS_S", (0.25, 0.5))
    monkeypatch.setattr(j2db.time, "sleep", sleep)
    c = _conn(path, timeout=0.05)
    fts_out, tag_out = _boot_steps(c)
    holder.close()
    assert slept == [0.25]                # one refusal, one wait, then the retry succeeded
    assert fts_out["marked"] and fts_out["reason"] == "rebuilt_for_drift"
    assert tag_out["rebuilt_for_drift"]
    assert notes_svc._fts_map_ready(c) and notes_svc._tag_index_ready(c)
    assert _answers(c) == want
    c.close()


def test_the_withholding_reaches_only_its_own_file(tmp_path, data_dir, monkeypatch):
    """CONTROL: a healthy database in the same process keeps its fast path while another
    file's family is withheld -- so the fallback above is the withholding, not a process
    that stopped trusting everything."""
    healthy = _conn(tmp_path / "healthy.db")
    j2db.ensure_schema(healthy)
    _insert(healthy, "h1", "breakout", ["Setups"])
    healthy.commit()
    path = tmp_path / "restored.db"
    _drifted(path, "delete")
    monkeypatch.setattr(j2db, "_UNMARK_RETRY_WAITS_S", ())
    holder = _hold_write_lock(path)
    c = _conn(path, timeout=0.05)
    try:
        _boot_steps(c)
    finally:
        holder.execute("ROLLBACK")
        holder.close()
    assert not notes_svc._fts_map_ready(c)                          # withheld ...
    assert notes_svc._fts_map_ready(healthy)                        # ... and only there
    assert notes_svc._tag_index_ready(healthy)
    assert sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=healthy)) == ["h1"]
    c.close()
    healthy.close()


def test_a_healthy_boot_withholds_nothing(tmp_path, data_dir):
    c = _conn(tmp_path / "fresh.db")
    j2db.ensure_schema(c)
    key = j2db._db_key(c)
    assert (key, j2db._FTS_MAP_FAMILY) not in j2db._WITHHELD
    assert (key, j2db._NOTE_TAG_INDEX_FAMILY) not in j2db._WITHHELD
    assert notes_svc._fts_map_ready(c) and notes_svc._tag_index_ready(c)
    j2db.ensure_schema(c)                                           # a second boot proves it again
    assert notes_svc._fts_map_ready(c) and notes_svc._tag_index_ready(c)
    c.close()


def test_a_check_that_raises_before_the_withdrawal_also_withholds(tmp_path, data_dir, monkeypatch):
    """Not only the DELETE: a boot check that cannot even RUN (here, the drift query) proves
    nothing, so the record it could not examine is not trusted either."""
    path = tmp_path / "restored.db"
    want = _drifted(path, "delete")
    c = _conn(path)

    def cannot_read(conn):
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(j2db, "_fts_map_in_shape", cannot_read)
    monkeypatch.setattr(j2db, "_tag_index_in_shape", cannot_read)
    fts_out, tag_out = _boot_steps(c)
    assert isinstance(fts_out, sqlite3.OperationalError) and isinstance(tag_out, sqlite3.OperationalError)
    assert j2db._recorded(c, j2db._FTS_MAP_BUILD)                   # never examined, never withdrawn
    assert not notes_svc._fts_map_ready(c) and not notes_svc._tag_index_ready(c)
    assert _answers(c) == want
    c.close()
