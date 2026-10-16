"""Archive chart images: private storage, paid-only serving (owner decision 4, 2026-10-16).

The TSDR archive's posts carried chart screenshots. The curated subset (the setup library's
winners, failures and teachings first) is stored here so /trader-archive can show the chart a
trader actually posted. Bytes never live in the public repo or in wisdom.db.

STORAGE (reuses the DATA_SYNC_* R2 client the backups already use, api/flow_backup.py):
  - R2 configured:   the object goes to R2 under ``wisdom_archive_images/<sha>.<ext>`` and a
    copy is kept in the local cache dir, so a read rarely leaves the pod.
  - R2 unconfigured: the local dir IS the store (``storage_key`` starts ``local:``). The dir is
    WISDOM_ARCHIVE_IMAGE_DIR (default /data/wisdom_archive_images, on the Railway volume).
  Cache writes beyond WISDOM_ARCHIVE_IMAGE_CACHE_MB are skipped when R2 holds the object; the
  local-only mode never skips (the cache is the only copy there).

⛔ Validation is by MAGIC BYTES, never by a declared type or file name: PNG, JPEG and WebP
only, at most MAX_BYTES. ⛔ image_id is the sha256 of the bytes, so an upload is idempotent by
content. One row per image: an image posted under two records stays with the first.

Reads and writes ONLY wisdom_archive_images.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Iterable, Optional

log = logging.getLogger(__name__)

MAX_BYTES = 3 * 1024 * 1024
R2_PREFIX = "wisdom_archive_images/"
ROW_KEYS = ("records", "calls", "hits", "best", "worst", "teachings", "winners", "failures")
MAX_PER_RECORD = 8

_IMAGE_ID = re.compile(r"^[0-9a-f]{64}$")
_RECORD_ID = re.compile(r"^t\d{1,7}$")
_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

_cache_lock = threading.Lock()
_cache_bytes: Optional[int] = None      # lazily measured once per process, then tracked


class ImageError(ValueError):
    pass


def image_dir() -> str:
    return os.environ.get("WISDOM_ARCHIVE_IMAGE_DIR", "/data/wisdom_archive_images")


def _cache_cap_bytes() -> int:
    try:
        return int(float(os.environ.get("WISDOM_ARCHIVE_IMAGE_CACHE_MB", "4096")) * 1024 * 1024)
    except ValueError:
        return 4096 * 1024 * 1024


def sniff(data: bytes) -> str:
    """The content type the BYTES say, or ImageError. Never trusts a declared type."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise ImageError("not a PNG, JPEG or WebP image")


def validate(data: bytes) -> tuple[str, str]:
    """(image_id, content_type) or ImageError."""
    if not data:
        raise ImageError("empty image")
    if len(data) > MAX_BYTES:
        raise ImageError(f"image larger than {MAX_BYTES} bytes")
    return hashlib.sha256(data).hexdigest(), sniff(data)


def dimensions(data: bytes) -> tuple[Optional[int], Optional[int]]:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            return int(im.size[0]), int(im.size[1])
    except Exception:  # noqa: BLE001 -- dimensions are informational; bytes already validated
        return None, None


def _r2():
    """(client, bucket) or (None, None). Late-bound so a test patches this one seam."""
    try:
        from api import flow_backup

        if not flow_backup._r2_configured():
            return None, None
        return flow_backup._r2_client(), flow_backup._bucket()
    except Exception:  # noqa: BLE001
        log.exception("[wisdom] archive images: R2 client unavailable")
        return None, None


def _local_path(image_id: str) -> str:
    return os.path.join(image_dir(), image_id)


def _measure_cache() -> int:
    total = 0
    try:
        with os.scandir(image_dir()) as it:
            for e in it:
                if e.is_file() and _IMAGE_ID.match(e.name):
                    total += e.stat().st_size
    except FileNotFoundError:
        pass
    return total


def _write_cache(image_id: str, data: bytes, *, required: bool) -> bool:
    """Atomic write into the local dir. Skipped past the cap unless ``required``."""
    global _cache_bytes
    with _cache_lock:
        if _cache_bytes is None:
            _cache_bytes = _measure_cache()
        path = _local_path(image_id)
        if os.path.exists(path):
            return True
        if not required and _cache_bytes + len(data) > _cache_cap_bytes():
            return False
        os.makedirs(image_dir(), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
        _cache_bytes += len(data)
        return True


def _read_cache(image_id: str) -> Optional[bytes]:
    try:
        with open(_local_path(image_id), "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _table_exists(conn) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name = 'wisdom_archive_images'").fetchone() is not None


def store_image(conn: sqlite3.Connection, record_id: str, ordinal: int, data: bytes) -> dict:
    """Validate, store the bytes, upsert the row. Idempotent by content sha."""
    if not isinstance(record_id, str) or not _RECORD_ID.match(record_id):
        raise ImageError("record_id malformed")
    if not isinstance(ordinal, int) or isinstance(ordinal, bool) or not 0 <= ordinal < 1000:
        raise ImageError("ordinal must be an integer 0..999")
    image_id, ctype = validate(data)
    prior = conn.execute("SELECT record_id FROM wisdom_archive_images WHERE image_id = ?",
                         (image_id,)).fetchone()
    if prior is not None:
        return {"image_id": image_id, "status": "unchanged"}
    client, bucket = _r2()
    if client is not None and bucket:
        key = f"{R2_PREFIX}{image_id}.{_EXT[ctype]}"
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=ctype)
        _write_cache(image_id, data, required=False)
    else:
        key = f"local:{image_id}"
        _write_cache(image_id, data, required=True)
    width, height = dimensions(data)
    conn.execute(
        "INSERT INTO wisdom_archive_images (image_id, record_id, ordinal, storage_key, bytes, width, "
        "height, content_type, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (image_id, record_id, ordinal, key, len(data), width, height, ctype, _now()))
    return {"image_id": image_id, "status": "inserted"}


def missing(conn, image_ids: Iterable[str]) -> list:
    """The ids (of those asked about) not yet stored, so an importer can resume cheaply."""
    ids = [i for i in dict.fromkeys(image_ids) if isinstance(i, str) and _IMAGE_ID.match(i)]
    have: set = set()
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        have |= {r[0] for r in conn.execute(
            f"SELECT image_id FROM wisdom_archive_images WHERE image_id IN ({','.join('?' * len(chunk))})",
            chunk)}
    return [i for i in ids if i not in have]


def load(conn, image_id: str) -> Optional[tuple[bytes, str]]:
    """(bytes, content_type) or None when unknown. Reads the local copy first."""
    if not isinstance(image_id, str) or not _IMAGE_ID.match(image_id):
        return None
    row = conn.execute("SELECT storage_key, content_type FROM wisdom_archive_images WHERE image_id = ?",
                       (image_id,)).fetchone()
    if row is None:
        return None
    key, ctype = row[0], row[1]
    data = _read_cache(image_id)
    if data is not None:
        return data, ctype
    if key.startswith("local:"):
        log.error("[wisdom] archive image %s is local-only and its file is gone", image_id)
        return None
    client, bucket = _r2()
    if client is None or not bucket:
        return None
    obj = client.get_object(Bucket=bucket, Key=key)
    data = obj["Body"].read()
    if hashlib.sha256(data).hexdigest() != image_id:
        log.error("[wisdom] archive image %s failed its sha check on read", image_id)
        return None
    _write_cache(image_id, data, required=False)
    return data, ctype


def images_by_record(conn, record_ids: Iterable[str]) -> dict:
    ids = [r for r in dict.fromkeys(record_ids) if isinstance(r, str)]
    out: dict = {}
    if not ids or not _table_exists(conn):
        return out
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for rid, iid in conn.execute(
                f"SELECT record_id, image_id FROM wisdom_archive_images WHERE record_id IN "
                f"({','.join('?' * len(chunk))}) ORDER BY record_id, ordinal", chunk):
            lst = out.setdefault(rid, [])
            if len(lst) < MAX_PER_RECORD:
                lst.append(iid)
    return out


def attach(payload: dict) -> dict:
    """Adds ``images: [image_id, ...]`` to every row (under ROW_KEYS) whose record has stored
    images. Rows without images are left untouched. Never raises: a failure leaves the payload
    as it was, because the text answer is still correct without its pictures."""
    try:
        rows = [row for key in ROW_KEYS for row in (payload.get(key) or [])
                if isinstance(row, dict) and row.get("record_id")]
        if not rows:
            return payload
        from api.services.wisdom.core import store

        with store.read(for_request=True) as conn:
            found = images_by_record(conn, (r["record_id"] for r in rows))
        for row in rows:
            ids = found.get(row["record_id"])
            if ids:
                row["images"] = list(ids)
    except Exception:  # noqa: BLE001
        log.exception("[wisdom] archive images: attach failed; payload served without images")
    return payload
