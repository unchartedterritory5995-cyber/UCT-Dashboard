import os
import tempfile
import importlib


def _fresh_service(tmp_path):
    os.environ["EDUCATION_DB_PATH"] = str(tmp_path / "edu.db")
    import api.services.education_service as es
    importlib.reload(es)
    es._init_db()
    return es


def test_set_audio_persists_key_and_timestamp(tmp_path):
    es = _fresh_service(tmp_path)
    row = es.create_video({"youtube_id": "abc123", "title": "T", "category": "Live Trading Sessions"})
    assert row["audio_url"] is None
    es.set_audio(row["id"], "desk_audio/abc123.m4a")
    got = es.get_video(row["id"])
    assert got["audio_url"] == "desk_audio/abc123.m4a"
    assert isinstance(got["audio_at"], int) and got["audio_at"] > 0
