import os, tempfile, pytest
from api.services import desk_session_jobs as q

@pytest.fixture
def db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(q, "_DB_PATH", os.path.join(d, "jobs.db"))
        q._init_db(); yield q

def test_enqueue_then_claim(db):
    assert db.enqueue("uuid1", "topic", "2026-06-24T13:30:00Z", "http://dl", "tok") is True
    job = db.claim_next()
    assert job["meeting_uuid"] == "uuid1" and job["status"] == "processing"
    assert db.claim_next() is None  # nothing else pending

def test_enqueue_is_idempotent(db):
    assert db.enqueue("uuid1", "t", "s", "u", "k") is True
    assert db.enqueue("uuid1", "t", "s", "u", "k") is False
    assert db.count_status("pending") == 1

def test_mark_done(db):
    db.enqueue("u", "t", "s", "u", "k"); db.claim_next()
    db.mark_done("u", "VID")
    assert db.count_status("done") == 1

def test_mark_error_retries_then_fails(db, monkeypatch):
    monkeypatch.setattr(q, "_MAX_ATTEMPTS", 2)
    db.enqueue("u", "t", "s", "u", "k")
    db.claim_next(); db.mark_error("u", "boom1")     # attempts=1 -> back to pending
    assert db.count_status("pending") == 1
    db.claim_next(); db.mark_error("u", "boom2")     # attempts=2 -> error
    assert db.count_status("error") == 1


def test_claim_reclaims_stale_processing(db, monkeypatch):
    monkeypatch.setattr(q, "_STALE_SECS", -1)   # cutoff = now+1 -> every row is stale
    db.enqueue("u", "t", "s", "u", "k")
    j1 = db.claim_next(); assert j1["meeting_uuid"] == "u"
    # still 'processing', but stale -> reclaimable
    j2 = db.claim_next(); assert j2 is not None and j2["meeting_uuid"] == "u"


def test_mark_uploaded_sets_youtube_id(db):
    db.enqueue("u", "t", "s", "u", "k"); db.claim_next()
    db.mark_uploaded("u", "VIDY")
    rows = db.list_recent()
    assert rows[0]["youtube_id"] == "VIDY"


# ── requeue ──────────────────────────────────────────────────────────────────────

def test_requeue_flips_skipped_back_to_pending_and_corrects_topic(db):
    db.enqueue("u", "TEST", "2026-08-19T01:00:09Z", "http://dl", "tok")
    db.claim_next(); db.mark_skipped("u", "test recording: TEST")
    row = db.requeue("u", topic="Evening Update")
    assert row["status"] == "pending" and row["topic"] == "Evening Update"
    assert row["error"] is None and row["attempts"] == 0
    # and the processor can actually claim it again
    job = db.claim_next()
    assert job["meeting_uuid"] == "u" and job["topic"] == "Evening Update"

def test_requeue_without_topic_keeps_stored_topic(db):
    db.enqueue("u", "Evening Update", "s", "http://dl", "tok")
    db.claim_next(); db.mark_error("u", "boom"); db.mark_error("u", "boom"); db.mark_error("u", "boom")
    assert db.count_status("error") == 1
    row = db.requeue("u")
    assert row["status"] == "pending" and row["topic"] == "Evening Update"

def test_requeue_refuses_non_terminal_statuses(db):
    db.enqueue("u", "t", "s", "http://dl", "tok")
    assert db.requeue("u") is None            # pending
    db.claim_next()
    assert db.requeue("u") is None            # processing
    db.mark_done("u", "VID")
    assert db.requeue("u") is None            # done
    assert db.requeue("nope") is None         # missing

def test_get_job_returns_row_or_none(db):
    db.enqueue("u", "t", "s", "http://dl", "tok")
    assert db.get_job("u")["meeting_uuid"] == "u"
    assert db.get_job("nope") is None
