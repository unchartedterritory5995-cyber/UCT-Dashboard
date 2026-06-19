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
