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
    assert dx.requeue_stale_pending(now=NOW) == {"requeued": 1}
    assert submitted == ["stale"]


def test_the_sweep_is_bounded_per_tick(conn, submitted):
    for i in range(7):
        _doc(conn, f"d{i}", minutes_old=60 + i)
    assert dx.requeue_stale_pending(now=NOW, limit=3) == {"requeued": 3}
    assert submitted == ["d6", "d5", "d4"]  # oldest first


def test_the_sweep_is_idempotent_while_a_row_is_queued(conn, submitted):
    for i in range(4):
        _doc(conn, f"d{i}", minutes_old=60)
    first = dx.requeue_stale_pending(now=NOW, limit=3)
    second = dx.requeue_stale_pending(now=NOW, limit=3)  # the first three are still queued here
    assert (first, second) == ({"requeued": 3}, {"requeued": 1})
    assert sorted(submitted) == ["d0", "d1", "d2", "d3"]
    assert dx.requeue_stale_pending(now=NOW, limit=3) == {"requeued": 0}


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
    assert 'id="j2_doc_pending_sweep"' in src and "requeue_stale_pending" in src
