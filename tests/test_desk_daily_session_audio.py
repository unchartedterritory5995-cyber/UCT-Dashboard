"""Task 4: background-audio extraction wired into the publish pipeline.

Focused unit test of the `_maybe_extract_audio` seam — the full
`process_pending_jobs` orchestrator is covered elsewhere
(tests/test_desk_daily_session.py); this only verifies the extraction helper
is non-fatal and correctly gated by desk_background_audio.is_enabled().
"""
import api.services.desk_daily_session as dds


def test_audio_extraction_called_with_tmp_and_youtube_id(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr(dds.desk_background_audio, "is_enabled", lambda: True)
    monkeypatch.setattr(
        dds.desk_background_audio,
        "extract_and_store",
        lambda mp4, yid: seen.update(mp4=mp4, yid=yid) or "desk_audio/vid123.m4a",
    )
    key = dds._maybe_extract_audio("/tmp/x.mp4", "vid123")
    assert key == "desk_audio/vid123.m4a"
    assert seen == {"mp4": "/tmp/x.mp4", "yid": "vid123"}


def test_audio_extraction_skipped_when_disabled(monkeypatch):
    monkeypatch.setattr(dds.desk_background_audio, "is_enabled", lambda: False)
    assert dds._maybe_extract_audio("/tmp/x.mp4", "vid123") is None


def test_audio_extraction_never_raises_on_extract_failure(monkeypatch):
    monkeypatch.setattr(dds.desk_background_audio, "is_enabled", lambda: True)

    def _boom(mp4, yid):
        raise RuntimeError("ffmpeg exploded")

    monkeypatch.setattr(dds.desk_background_audio, "extract_and_store", _boom)
    assert dds._maybe_extract_audio("/tmp/x.mp4", "vid123") is None
