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
