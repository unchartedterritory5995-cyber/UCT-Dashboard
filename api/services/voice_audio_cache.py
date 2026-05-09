"""
Disk-backed TTS audio cache. Keyed by SHA(text + voice + speed); 7-day TTL.
Cached audio bypasses OpenAI billing and Mode A usage tracking on hit.

Cache directory:
  - Railway: /data/voice_audio_cache/  (persistent volume)
  - Local:   ./data/voice_audio_cache/
"""

import os
import hashlib
import time
import logging

_log = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days

_RAILWAY_CACHE = "/data/voice_audio_cache"
if os.path.isdir("/data"):
    _CACHE_DIR = _RAILWAY_CACHE
else:
    _CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "voice_audio_cache")

os.makedirs(_CACHE_DIR, exist_ok=True)


def _key(text: str, voice: str, speed: float) -> str:
    h = hashlib.sha256()
    h.update(text.encode("utf-8"))
    h.update(b"\x00")
    h.update(voice.encode("utf-8"))
    h.update(b"\x00")
    h.update(f"{speed:.4f}".encode("utf-8"))
    return h.hexdigest()


def _path_for(text: str, voice: str, speed: float) -> str:
    return os.path.join(_CACHE_DIR, _key(text, voice, speed) + ".mp3")


def get_cached(text: str, *, voice: str, speed: float) -> bytes | None:
    """Return cached MP3 bytes, or None if missing/expired."""
    p = _path_for(text, voice, speed)
    if not os.path.exists(p):
        return None
    age = time.time() - os.path.getmtime(p)
    if age > CACHE_TTL_SECONDS:
        return None
    try:
        with open(p, "rb") as f:
            return f.read()
    except OSError as e:
        _log.warning("voice cache read failed for %s: %s", p, e)
        return None


def put_cached(text: str, voice: str, speed: float, audio_bytes: bytes) -> None:
    """Atomically write audio_bytes to the cache."""
    p = _path_for(text, voice, speed)
    tmp = p + ".tmp"
    try:
        with open(tmp, "wb") as f:
            f.write(audio_bytes)
        os.replace(tmp, p)
    except OSError as e:
        _log.warning("voice cache write failed for %s: %s", p, e)
        try:
            os.remove(tmp)
        except OSError:
            pass


def purge_expired() -> int:
    """Remove cache files older than CACHE_TTL_SECONDS. Returns count removed."""
    removed = 0
    now = time.time()
    for name in os.listdir(_CACHE_DIR):
        if not name.endswith(".mp3"):
            continue
        full = os.path.join(_CACHE_DIR, name)
        try:
            if now - os.path.getmtime(full) > CACHE_TTL_SECONDS:
                os.remove(full)
                removed += 1
        except OSError:
            continue
    if removed:
        _log.info("voice cache purged %d expired file(s)", removed)
    return removed
