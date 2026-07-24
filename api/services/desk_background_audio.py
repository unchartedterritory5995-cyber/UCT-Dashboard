"""Extract a compact background-audio track from a session MP4 and host it on R2
so mobile clients can keep playing audio when the screen locks. Best-effort:
every function fails soft (returns None / False) so it can never break the
YouTube publish pipeline. Gated by DESK_BACKGROUND_AUDIO_ENABLED.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile

from api.services import data_sync

log = logging.getLogger(__name__)

_BITRATE = os.environ.get("DESK_BG_AUDIO_BITRATE", "96k")


def is_enabled() -> bool:
    return os.environ.get("DESK_BACKGROUND_AUDIO_ENABLED", "") == "1"


def audio_key(youtube_id: str) -> str:
    return f"desk_audio/{youtube_id}.m4a"


def presigned_url(youtube_id: str, expires: int = 3600) -> str | None:
    return data_sync.presigned_get(audio_key(youtube_id), expires)


def extract_and_store(mp4_path: str, youtube_id: str) -> str | None:
    """ffmpeg-extract 96k AAC from mp4_path, upload to R2, return the key or None."""
    out = None
    try:
        fd, out = tempfile.mkstemp(suffix=".m4a")
        os.close(fd)
        cmd = [
            "ffmpeg", "-y", "-i", mp4_path,
            "-vn", "-c:a", "aac", "-b:a", _BITRATE, "-ac", "2",
            "-movflags", "+faststart", out,
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=600)
        if res.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
            log.warning("bg-audio ffmpeg failed for %s: rc=%s", youtube_id,
                        getattr(res, "returncode", "?"))
            return None
        with open(out, "rb") as f:
            data = f.read()
        if not data_sync.put_bytes(audio_key(youtube_id), data, "audio/mp4"):
            log.warning("bg-audio R2 upload skipped/failed for %s", youtube_id)
            return None
        return audio_key(youtube_id)
    except Exception as e:
        log.warning("bg-audio extract_and_store failed for %s: %s", youtube_id, e)
        return None
    finally:
        if out and os.path.exists(out):
            try:
                os.remove(out)
            except OSError:
                pass
