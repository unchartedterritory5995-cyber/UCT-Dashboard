"""Security review finding I-3: the two catch-up loops must never hold the auth.db write lock
while they parse, and a read with nothing stale must not write at all.

auth.db is the session database. Its connections wait three seconds for a lock
(`auth_db.get_connection`), and one process serves every member, so a write transaction that
stays open while note bodies are parsed fails other members' saves with "database is locked".

  * `note_levels.catch_up_all`  (the awareness scan, every 20 minutes): every note and every
    stored version is parsed with NO write transaction open, and each note is committed on its
    own, so the lock is held for one note's DELETE and INSERT only.
  * `chart_blocks.catch_up`     (every fingerprint and visual-playbook read): a call with
    nothing stale performs ZERO writes and succeeds while another connection holds the write
    lock; a stale note is parsed before the first write and committed on its own.
  * Neither runs on the event loop: the scan is a scheduler-thread job and every route that
    calls the chart catch-up is a plain `def` (FastAPI runs those on the thread pool).

The proof is a second connection, not an inspection of the first: while the code under test is
parsing, another connection asks for the write lock (`BEGIN IMMEDIATE`) with a short wait.
"""
from __future__ import annotations

import inspect
import os
import sqlite3
import tempfile

import pytest

from api.services.journal_two import chart_blocks, note_levels, notes
from api.services.journal_two.db import ensure_schema

TO_0930 = 1759255200 + 365 * 86400


def _chart(embed_id="e-1", symbol="NVDA"):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": TO_0930},
        "capturedAt": "2026-09-30T18:00:00Z", "embedId": embed_id, "mode": "snapshot",
        "annotations": []}}


def _doc(*nodes):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Stop: 100"}]}, *nodes]}


def _stub_compute(symbol, as_of):
    return {"v": 1, "symbol": symbol, "as_of": as_of, "mode": "bars",
            "fields": {"adr_pct": {"value": 1.0, "source": "bars", "missing": None}}}


@pytest.fixture
def db_file():
    d = tempfile.mkdtemp(prefix="finsec-catchup-")
    path = os.path.join(d, "auth.db")
    c = _open(path)
    ensure_schema(c)
    chart_blocks.ensure_schema(c)
    note_levels.ensure_schema(c)
    c.commit()
    c.close()
    yield path


def _open(path, timeout=0.2):
    c = sqlite3.connect(path, timeout=timeout)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _write_lock_is_free(path) -> bool:
    """Can ANOTHER connection take the write lock right now?"""
    other = sqlite3.connect(path, timeout=0.05)
    try:
        other.execute("BEGIN IMMEDIATE")
        other.execute("ROLLBACK")
        return True
    except sqlite3.OperationalError:
        return False
    finally:
        other.close()


def _seed(path, user, *bodies, ticker="NVDA"):
    c = _open(path)
    try:
        out = [notes.create_note(user, {"title": f"n{i}", "ticker": ticker, "bodyJson": b}, conn=c)
               for i, b in enumerate(bodies)]
        c.commit()
        return out
    finally:
        c.close()


# ── the control: the probe can see a held lock ───────────────────────────────

def test_the_probe_reports_a_held_write_lock(db_file):
    holder = _open(db_file)
    try:
        assert _write_lock_is_free(db_file) is True
        holder.execute("BEGIN IMMEDIATE")
        assert _write_lock_is_free(db_file) is False, "the probe cannot see a held lock"
        holder.execute("ROLLBACK")
    finally:
        holder.close()


# ── note_levels.catch_up_all ─────────────────────────────────────────────────

def test_the_level_scan_parses_with_no_write_lock_held_and_commits_each_note(db_file, monkeypatch):
    a, b, c3 = _seed(db_file, "u1", _doc(), _doc(), _doc())
    # one saved version each, so the version scan (the long part) runs too
    c = _open(db_file)
    try:
        for n in (a, b, c3):
            notes.update_note("u1", n["id"], {"bodyJson": _doc({"type": "paragraph", "content": [
                {"type": "text", "text": "Target: 140"}]})}, conn=c)
        c.commit()
    finally:
        c.close()

    real = note_levels.read_note_rows
    seen = []                      # (lock free?, notes already visible to another connection)

    def probing(*args, **kwargs):
        other = _open(db_file)
        try:
            done = other.execute("SELECT COUNT(DISTINCT note_id) FROM j2_note_levels").fetchone()[0]
        finally:
            other.close()
        seen.append((_write_lock_is_free(db_file), done))
        return real(*args, **kwargs)

    monkeypatch.setattr(note_levels, "read_note_rows", probing)
    conn = _open(db_file)
    try:
        out = note_levels.catch_up_all(conn)
    finally:
        conn.close()

    assert out["notes_projected"] == 3
    assert len(seen) >= 3, "the probe never ran, so this test measured nothing"
    held = [i for i, (free, _done) in enumerate(seen) if not free]
    assert not held, (
        f"the auth.db write lock was held during {len(held)} of {len(seen)} note parses: "
        "another member's save would wait on it, and fail after three seconds")
    assert max(done for _free, done in seen) >= 2, (
        "no earlier note was committed before a later one was parsed: the scan is still one "
        "transaction across every note")


def test_the_level_scan_still_removes_trashed_notes_and_keeps_the_last_side(db_file):
    (n,) = _seed(db_file, "u1", _doc())
    conn = _open(db_file)
    try:
        note_levels.catch_up_all(conn)
        conn.execute("UPDATE j2_note_levels SET last_side = 'above' WHERE role = 'stop'")
        conn.commit()
        notes.update_note("u1", n["id"], {"title": "renamed"}, conn=conn)       # same level, new watermark
        conn.commit()
        assert note_levels.catch_up_all(conn)["notes_projected"] == 1
        assert conn.execute("SELECT last_side FROM j2_note_levels WHERE role = 'stop'").fetchone()[0] == "above"
        assert conn.in_transaction is False
        notes.delete_note("u1", n["id"], conn=conn)
        conn.commit()
        assert note_levels.catch_up_all(conn)["notes_removed"] == 1
        assert conn.in_transaction is False
        assert _write_lock_is_free(db_file)
    finally:
        conn.close()


# ── chart_blocks.catch_up ────────────────────────────────────────────────────

_WRITE_WORDS = ("INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER", "BEGIN")


def test_a_chart_read_with_nothing_stale_performs_zero_writes(db_file):
    _seed(db_file, "u1", _doc(_chart("a")), _doc(_chart("b", "AMD")))
    conn = _open(db_file)
    holder = _open(db_file)
    try:
        first = chart_blocks.catch_up("u1", conn=conn, compute=_stub_compute)
        assert first["notes_projected"] == 2 and first["frozen"] == 2 and first["pending"] == 0

        statements = []
        conn.set_trace_callback(statements.append)
        changes_before = conn.total_changes
        holder.execute("BEGIN IMMEDIATE")           # somebody else is writing right now
        try:
            again = chart_blocks.catch_up("u1", conn=conn, compute=_stub_compute)
            listed = chart_blocks.list_blocks("u1", conn)
            one = chart_blocks.get_block("u1", listed[0]["noteId"], listed[0]["embedKey"], conn)
        finally:
            holder.execute("ROLLBACK")
        conn.set_trace_callback(None)
        changes_after, in_tx = conn.total_changes, conn.in_transaction
    finally:
        holder.close()
        conn.close()

    assert again == {"notes_projected": 0, "notes_removed": 0, "rows_written": 0,
                     "frozen": 0, "pending": 0}
    assert len(listed) == 2 and one is not None
    assert len(statements) >= 4, "the trace saw no statements, so this test measured nothing"
    writes = [s for s in statements if s.lstrip().upper().startswith(_WRITE_WORDS)
              and "IF NOT EXISTS" not in s.upper()]
    assert writes == [], f"a read with nothing stale wrote to auth.db: {writes}"
    assert changes_after == changes_before
    assert in_tx is False


def test_the_trace_would_have_seen_a_write(db_file):
    """Control for the test above: the same trace over a call that DOES have work to do."""
    _seed(db_file, "u1", _doc(_chart("a")))
    conn = _open(db_file)
    try:
        statements = []
        conn.set_trace_callback(statements.append)
        chart_blocks.catch_up("u1", conn=conn, compute=_stub_compute)
        conn.set_trace_callback(None)
    finally:
        conn.close()
    assert any(s.lstrip().upper().startswith(("INSERT", "DELETE")) for s in statements)


def test_the_chart_catch_up_parses_before_it_writes_and_commits_each_note(db_file, monkeypatch):
    _seed(db_file, "u1", _doc(_chart("a")), _doc(_chart("b", "AMD")), _doc(_chart("c", "TSLA")))
    real = chart_blocks.extract_blocks
    seen = []

    def probing(body):
        other = _open(db_file)
        try:
            done = other.execute("SELECT COUNT(DISTINCT note_id) FROM j2_chart_blocks").fetchone()[0]
        finally:
            other.close()
        seen.append((_write_lock_is_free(db_file), done))
        return real(body)

    monkeypatch.setattr(chart_blocks, "extract_blocks", probing)
    conn = _open(db_file)
    try:
        out = chart_blocks.catch_up("u1", conn=conn, compute=_stub_compute)
    finally:
        conn.close()
    assert out["notes_projected"] == 3
    assert len(seen) == 3
    assert all(free for free, _done in seen), (
        "the write lock was held while a note body was parsed: " + repr(seen))
    assert max(done for _free, done in seen) >= 2, "the notes were not committed one at a time"


def test_a_hard_deleted_notes_frozen_rows_still_leave(db_file):
    """The ledger cleanup became conditional; it must still happen when there is something
    to clean."""
    (n,) = _seed(db_file, "u1", _doc(_chart("a")))
    conn = _open(db_file)
    try:
        chart_blocks.catch_up("u1", conn=conn, compute=_stub_compute)
        assert conn.execute("SELECT COUNT(*) FROM j2_chart_fingerprints").fetchone()[0] == 1
        conn.execute("DELETE FROM j2_notes WHERE id = ?", (n["id"],))
        conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (n["id"],))
        conn.commit()
        chart_blocks.catch_up("u1", conn=conn, compute=_stub_compute)
        assert conn.execute("SELECT COUNT(*) FROM j2_chart_fingerprints").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM j2_chart_blocks").fetchone()[0] == 0
    finally:
        conn.close()


# ── never on the event loop ──────────────────────────────────────────────────

def test_no_caller_of_either_catch_up_is_a_coroutine():
    """FastAPI runs a plain `def` route on the thread pool and an `async def` one on the event
    loop. Every route that reaches a catch-up must be the first kind, and so must the scan."""
    from api.routers import notebook_fingerprint, notebook_visual_playbook
    from api.services.awareness import engine

    checked = 0
    for module in (notebook_fingerprint, notebook_visual_playbook):
        for route in module.router.routes:
            assert not inspect.iscoroutinefunction(route.endpoint), (
                f"{route.path} is async: its database work would run on the event loop")
            checked += 1
    assert checked >= 7
    for fn in (engine.run_awareness_scan, engine._run_resurface_pass,
               note_levels.catch_up_all, chart_blocks.catch_up):
        assert not inspect.iscoroutinefunction(fn)
