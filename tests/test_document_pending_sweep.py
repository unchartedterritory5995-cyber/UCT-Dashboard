"""Plan F Task 7 re-review I-5: the web pod's sweep for documents left `pending`.

A document row is created `pending` and extracted by the web process's bounded pool. Nothing
re-queued a row whose extraction never ran: a crash or a redeploy mid-queue, or the import repair
(a separate, short-lived process that now creates the rows ONLY and never starts extraction
threads). `document_extraction.requeue_stale_pending` re-queues pending rows older than
`STALE_PENDING_S`, at most `limit` per tick, through the same bounded pool, and never one this
process already has queued. Registered in `api/main.py` as `j2_doc_pending_sweep`.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import document_extraction as dx
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    c = auth_db.get_connection()
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def submitted(monkeypatch):
    """The pool records what is submitted and runs nothing."""
    calls = []
    monkeypatch.setattr(dx._EXTRACTION_POOL, "submit", lambda fn, *args: calls.append(args[0]))
    monkeypatch.setattr(dx, "_QUEUED", set())
    return calls


NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def _doc(c, doc_id, *, minutes_old, status="pending"):
    c.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name, status,"
              " extraction_version, created_at) VALUES (?, 'u1', ?, ?, 'x', ?, 1, ?)",
              (doc_id, f"n-{doc_id}", f"/a/{doc_id}.pdf", status,
               (NOW - timedelta(minutes=minutes_old)).isoformat()))
    c.commit()


def test_only_stale_pending_rows_are_requeued(conn, submitted):
    _doc(conn, "fresh", minutes_old=2)
    _doc(conn, "stale", minutes_old=30)
    _doc(conn, "done", minutes_old=30, status="ready")
    _doc(conn, "broken", minutes_old=30, status="processing_failed")
    assert dx.requeue_stale_pending(now=NOW) == {"requeued": 1, "failed": 0}
    assert submitted == ["stale"]


def test_the_sweep_is_bounded_per_tick(conn, submitted):
    for i in range(7):
        _doc(conn, f"d{i}", minutes_old=60 + i)
    assert dx.requeue_stale_pending(now=NOW, limit=3) == {"requeued": 3, "failed": 0}
    assert submitted == ["d6", "d5", "d4"]  # oldest first


def test_the_sweep_is_idempotent_while_a_row_is_queued(conn, submitted):
    for i in range(4):
        _doc(conn, f"d{i}", minutes_old=60)
    first = dx.requeue_stale_pending(now=NOW, limit=3)
    second = dx.requeue_stale_pending(now=NOW, limit=3)  # the first three are still queued here
    assert (first["requeued"], second["requeued"]) == (3, 1)
    assert sorted(submitted) == ["d0", "d1", "d2", "d3"]
    assert dx.requeue_stale_pending(now=NOW, limit=3)["requeued"] == 0


def _status(c, doc_id):
    return tuple(c.execute("SELECT status, sweep_attempts, failure_reason FROM j2_note_documents WHERE id = ?",
                           (doc_id,)).fetchone())


def test_a_poison_row_is_failed_after_its_retries_and_stops_taking_slots(conn, submitted, monkeypatch):
    """Round 2 S-1: a row whose extraction never writes a status (it raises first) would be
    re-queued forever, oldest first, starving newer rows. Each re-queue is counted on the row;
    after `MAX_SWEEP_ATTEMPTS` the row is marked `processing_failed` with a reason (the member
    sees the normal failed state, never "Processing..." forever) and takes no slot again."""
    _doc(conn, "poison", minutes_old=120)
    _doc(conn, "newer", minutes_old=20)
    for tick in range(dx.MAX_SWEEP_ATTEMPTS):
        monkeypatch.setattr(dx, "_QUEUED", set())  # the attempt ran and died without a status
        out = dx.requeue_stale_pending(now=NOW, limit=1)
        assert out == {"requeued": 1, "failed": 0}
        assert submitted[-1] == "poison"
        assert _status(conn, "poison")[:2] == ("pending", tick + 1)
    monkeypatch.setattr(dx, "_QUEUED", set())
    out = dx.requeue_stale_pending(now=NOW, limit=1)
    assert out == {"requeued": 1, "failed": 1}
    assert submitted[-1] == "newer"  # the slot goes to the newer row now
    status, attempts, reason = _status(conn, "poison")
    assert (status, attempts) == ("processing_failed", dx.MAX_SWEEP_ATTEMPTS) and reason
    monkeypatch.setattr(dx, "_QUEUED", set())
    assert dx.requeue_stale_pending(now=NOW, limit=1)["requeued"] == 1
    assert "poison" not in submitted[-1:]


def test_a_document_waiting_for_ocr_is_never_reextracted_or_failed(conn, submitted):
    """Final review I-1: `pending` is ALSO OCR's derived status for a document whose extraction
    already finished and whose pages wait for OCR (`document_ocr.derive_document_status`,
    written by `refresh_document_status` together with `processed_at`). The sweep heals only rows
    that were never extracted (`processed_at IS NULL`). An extracted twin, however old and however
    many attempts it carries, is neither re-queued nor marked failed; the never-extracted one is."""
    _doc(conn, "in_ocr", minutes_old=60)
    _doc(conn, "in_ocr_max", minutes_old=60)
    _doc(conn, "never_extracted", minutes_old=60)
    conn.execute("UPDATE j2_note_documents SET processed_at = ? WHERE id IN ('in_ocr', 'in_ocr_max')",
                 ((NOW - timedelta(minutes=55)).isoformat(),))
    conn.execute("UPDATE j2_note_documents SET sweep_attempts = ? WHERE id = 'in_ocr_max'",
                 (dx.MAX_SWEEP_ATTEMPTS,))
    conn.commit()
    for _ in range(dx.MAX_SWEEP_ATTEMPTS + 1):
        dx.requeue_stale_pending(now=NOW, conn=conn)
        dx._QUEUED.clear()  # as if each queued extraction finished without writing a status
    assert "in_ocr" not in submitted and "in_ocr_max" not in submitted
    assert submitted.count("never_extracted") == dx.MAX_SWEEP_ATTEMPTS
    rows = dict(conn.execute("SELECT id, status FROM j2_note_documents").fetchall())
    assert rows["in_ocr"] == "pending" and rows["in_ocr_max"] == "pending"
    assert rows["never_extracted"] == "processing_failed"
    attempts = dict(conn.execute("SELECT id, sweep_attempts FROM j2_note_documents").fetchall())
    assert attempts["in_ocr"] == 0


def test_queue_extraction_marks_and_the_worker_unmarks(conn, monkeypatch):
    ran = []
    monkeypatch.setattr(dx, "_QUEUED", set())
    monkeypatch.setattr(dx._EXTRACTION_POOL, "submit", lambda fn, *args: fn(*args))  # run inline
    monkeypatch.setattr(dx, "_process_document_bounded", lambda doc_id: ran.append(doc_id))
    dx.queue_extraction("x1")
    assert ran == ["x1"] and dx._QUEUED == set()


def test_the_sweep_is_registered_on_the_web_scheduler():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert 'id="j2_doc_pending_sweep"' in src and "pending_sweep_tick" in src


@pytest.mark.parametrize("value,stopped", [("1", True), ("true", True), ("0", False), ("", False)])
def test_the_kill_switch_stops_the_sweep_per_tick(conn, submitted, monkeypatch, value, stopped):
    """Round 2 S-3: with `NOTEBOOK_DOC_PENDING_SWEEP_DISABLED=1` in the process environment the
    sweep does nothing, so a misbehaving sweep is stopped without a code revert. On Railway the
    value reaches the process only on a new boot (final review I-2): set it, then redeploy web."""
    _doc(conn, "stale", minutes_old=60)
    monkeypatch.setenv(dx.SWEEP_DISABLED_ENV, value)
    out = dx.pending_sweep_tick(started_monotonic=0.0, now_monotonic=10_000.0, now=NOW)
    if stopped:
        assert out == {"skipped": "disabled"} and submitted == []
    else:
        assert out["requeued"] == 1


def test_the_first_sweep_waits_out_a_startup_grace(conn, submitted):
    """Round 2 S-2: right after a boot (a deploy) the web pod has enough to do; the sweep's
    first pass runs no sooner than `SWEEP_STARTUP_GRACE_S` (10 min) after it."""
    _doc(conn, "stale", minutes_old=60)
    assert dx.SWEEP_STARTUP_GRACE_S >= 600
    assert dx.pending_sweep_tick(started_monotonic=1000.0, now_monotonic=1000.0 + 599, now=NOW) == {
        "skipped": "startup_grace"}
    assert submitted == []
    out = dx.pending_sweep_tick(started_monotonic=1000.0, now_monotonic=1000.0 + 600, now=NOW)
    assert out["requeued"] == 1 and submitted == ["stale"]
