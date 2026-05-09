"""Disk-backed TTS audio cache, keyed by SHA(text+voice+speed)."""

import os
import time
import tempfile
import pytest
from api.services import voice_audio_cache as vac


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    yield


def test_miss_returns_none():
    assert vac.get_cached("hello", voice="verse", speed=1.0) is None


def test_put_then_get_roundtrips():
    audio_bytes = b"FAKE-MP3-DATA"
    vac.put_cached("hello", "verse", 1.0, audio_bytes)
    got = vac.get_cached("hello", voice="verse", speed=1.0)
    assert got == audio_bytes


def test_different_voice_different_cache():
    vac.put_cached("hello", "verse", 1.0, b"AAA")
    vac.put_cached("hello", "ash", 1.0, b"BBB")
    assert vac.get_cached("hello", voice="verse", speed=1.0) == b"AAA"
    assert vac.get_cached("hello", voice="ash", speed=1.0) == b"BBB"


def test_different_speed_different_cache():
    vac.put_cached("hello", "verse", 1.0, b"AAA")
    vac.put_cached("hello", "verse", 1.5, b"CCC")
    assert vac.get_cached("hello", voice="verse", speed=1.0) == b"AAA"
    assert vac.get_cached("hello", voice="verse", speed=1.5) == b"CCC"


def test_stale_entries_treated_as_miss():
    vac.put_cached("old", "verse", 1.0, b"OLD")
    # Find the cached file and backdate its mtime past the TTL.
    files = [f for f in os.listdir(vac._CACHE_DIR) if f.endswith(".mp3")]
    assert files, "expected a cached mp3 to exist"
    target = os.path.join(vac._CACHE_DIR, files[0])
    old_ts = time.time() - (vac.CACHE_TTL_SECONDS + 60)
    os.utime(target, (old_ts, old_ts))
    assert vac.get_cached("old", voice="verse", speed=1.0) is None


def test_purge_expired_removes_stale_files(monkeypatch):
    vac.put_cached("a", "verse", 1.0, b"A")
    vac.put_cached("b", "verse", 1.0, b"B")
    files = sorted(os.listdir(vac._CACHE_DIR))
    # Backdate one file
    target = os.path.join(vac._CACHE_DIR, files[0])
    old_ts = time.time() - (vac.CACHE_TTL_SECONDS + 60)
    os.utime(target, (old_ts, old_ts))
    removed = vac.purge_expired()
    assert removed == 1
    assert len(os.listdir(vac._CACHE_DIR)) == 1
