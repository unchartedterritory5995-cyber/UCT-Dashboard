import subprocess
import api.services.desk_background_audio as dba

def test_audio_key():
    assert dba.audio_key("abc123") == "desk_audio/abc123.m4a"

def test_extract_and_store_happy_path(tmp_path, monkeypatch):
    # Pretend ffmpeg writes an m4a
    def fake_run(cmd, **kw):
        out = cmd[cmd.index("-movflags") + 2] if "-movflags" in cmd else cmd[-1]
        with open(out, "wb") as f:
            f.write(b"FAKE-AAC-BYTES")
        class R: returncode = 0; stderr = b""
        return R()
    monkeypatch.setattr(subprocess, "run", fake_run)
    puts = {}
    monkeypatch.setattr(dba.data_sync, "put_bytes",
                        lambda key, data, content_type: puts.update(key=key, data=data, ct=content_type) or True)
    key = dba.extract_and_store(str(tmp_path / "src.mp4"), "abc123")
    assert key == "desk_audio/abc123.m4a"
    assert puts["key"] == "desk_audio/abc123.m4a"
    assert puts["data"] == b"FAKE-AAC-BYTES"
    assert puts["ct"] == "audio/mp4"

def test_extract_and_store_returns_none_on_ffmpeg_failure(tmp_path, monkeypatch):
    def boom(cmd, **kw):
        class R: returncode = 1; stderr = b"ffmpeg exploded"
        return R()
    monkeypatch.setattr(subprocess, "run", boom)
    assert dba.extract_and_store(str(tmp_path / "src.mp4"), "abc123") is None

def test_extract_and_store_returns_none_when_r2_unconfigured(tmp_path, monkeypatch):
    def fake_run(cmd, **kw):
        out = cmd[-1]
        open(out, "wb").write(b"x")
        class R: returncode = 0; stderr = b""
        return R()
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(dba.data_sync, "put_bytes", lambda *a, **k: False)
    assert dba.extract_and_store(str(tmp_path / "src.mp4"), "abc123") is None
