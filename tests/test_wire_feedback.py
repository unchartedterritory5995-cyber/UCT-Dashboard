import os, tempfile, importlib, time


def _fresh_store():
    os.environ["WIRE_FEEDBACK_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "wf.db")
    import api.services.wire_feedback_store as s
    importlib.reload(s)
    s._init_db()
    return s


def test_record_and_read_admin_votes():
    s = _fresh_store()
    s.record_vote(user_id="u1", market_date="2026-06-18", segment_key="tape",
                  verdict="up", segment_text="Futures firm.", is_admin=1)
    s.record_vote(user_id="u2", market_date="2026-06-18", segment_key="tape",
                  verdict="down", segment_text="Futures firm.", is_admin=0)
    rows = s.recent_admin_votes(days=30, now=time.time())
    assert len(rows) == 1
    assert rows[0]["segment_key"] == "tape" and rows[0]["verdict"] == "up"


def test_upsert_flips_verdict():
    s = _fresh_store()
    s.record_vote(user_id="u1", market_date="2026-06-18", segment_key="close",
                  verdict="up", segment_text="x", is_admin=1)
    s.record_vote(user_id="u1", market_date="2026-06-18", segment_key="close",
                  verdict="down", segment_text="x", is_admin=1)
    rows = s.recent_admin_votes(days=30, now=time.time())
    assert len(rows) == 1 and rows[0]["verdict"] == "down"


def test_note_without_vote():
    s = _fresh_store()
    s.record_feedback(user_id="u1", market_date="2026-06-26", segment_key="earn",
                      note="Micron framed as last night — it was 2 sessions ago.",
                      is_admin=1)
    rows = s.recent_admin_votes(days=30, now=time.time())
    assert len(rows) == 1
    assert rows[0]["verdict"] == "" and "Micron" in rows[0]["note"]


def test_partial_merge_note_then_vote_and_vice_versa():
    s = _fresh_store()
    # note first, then a thumb — thumb must NOT wipe the note
    s.record_feedback(user_id="u1", market_date="2026-06-26", segment_key="tape",
                      note="tighten the macro", is_admin=1)
    s.record_feedback(user_id="u1", market_date="2026-06-26", segment_key="tape",
                      verdict="up", is_admin=1)
    fb = s.get_user_feedback("u1", "2026-06-26")
    assert fb["tape"]["verdict"] == "up" and fb["tape"]["note"] == "tighten the macro"
    # now a thumb-only segment, then add a note — note must not wipe the thumb
    s.record_feedback(user_id="u1", market_date="2026-06-26", segment_key="close",
                      verdict="down", is_admin=1)
    s.record_feedback(user_id="u1", market_date="2026-06-26", segment_key="close",
                      note="end on a clearer directive", is_admin=1)
    fb = s.get_user_feedback("u1", "2026-06-26")
    assert fb["close"]["verdict"] == "down" and fb["close"]["note"] == "end on a clearer directive"


def test_note_capped_at_2000():
    s = _fresh_store()
    s.record_feedback(user_id="u1", market_date="2026-06-26", segment_key="overall",
                      note="x" * 5000, is_admin=1)
    fb = s.get_user_feedback("u1", "2026-06-26")
    assert len(fb["overall"]["note"]) == 2000


os.environ.setdefault("PUSH_SECRET", "test-secret-123")
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_internal_requires_bearer():
    assert client.get("/api/wire-feedback/recent-internal").status_code == 401
    assert client.get("/api/wire-feedback/recent-internal",
                      headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_internal_valid_bearer_returns_votes_list():
    r = client.get("/api/wire-feedback/recent-internal",
                   headers={"Authorization": "Bearer test-secret-123"})
    assert r.status_code == 200
    assert isinstance(r.json().get("votes"), list)


def test_vote_requires_auth():
    r = client.post("/api/wire-feedback",
                    json={"market_date": "2026-06-18", "segment_key": "tape", "verdict": "up"})
    assert r.status_code == 401
