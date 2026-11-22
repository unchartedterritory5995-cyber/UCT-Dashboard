"""Worker boot repair for a bars.db SQLite cannot open.

Fires on one fault only: SQLite answering "file is not a database". A locked,
busy or merely malformed database holds real data and keeps its existing
handling (`R2_RECOVERY_ENABLED` in bars_sqlite).

The hard edges, each from a recorded incident:

* The bad file is MOVED aside, never deleted. It is the only evidence of what
  damaged it, and an earlier move-aside is what saved a 10 GB file on 2026-08-10.
* A failed restore leaves NO database. An empty one could gather enough rows to
  pass the snapshot floor and replace the fleet's truth in R2. The boot stops
  instead, and the next boot retries.
* The restore runs in a SUBPROCESS while this process answers the health check.
  Railway kills a deploy after 600s without a healthy answer, a restore of this
  size can take longer, and in a thread its GIL-heavy extract starves the health
  endpoint (bars_api_main records that outage).
* Extraction happens on the volume, because /tmp is small and because a move
  across filesystems is a copy rather than an atomic rename.
* Every stage persists under .bars_restore/<ts>. Master can merge faster than a
  restore runs, and each merge redeploys the worker, so a restore that starts
  over at each boot might never finish. A kill costs only the stage in progress.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

from api.services import data_sync

log = logging.getLogger("uvicorn.error")

# Each copy is the size of the whole database, so repeats stop for a person.
_MAX_QUARANTINED = 2
_SNAPSHOT_CANDIDATES = 4
_SIDECARS = ("-wal", "-shm")
_STAGE_ROOT = ".bars_restore"
_CHUNK = 8 * 1024 * 1024
# Consecutive attempts with no new bytes. Progress resets the count.
_DOWNLOAD_ATTEMPTS = 8
_RETRY_SLEEP_S = 5


def db_path() -> str:
    return os.path.join(data_sync._DATA_DIR, "bars.db")


def is_unreadable(path: str) -> bool:
    """True only when SQLite says this file is not a database."""
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return False
    try:
        uri = pathlib.Path(path).resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        finally:
            conn.close()
    except sqlite3.DatabaseError as e:
        return "file is not a database" in str(e)
    return False


def _quarantined() -> list[str]:
    return sorted(
        p for p in glob.glob(glob.escape(db_path()) + ".unreadable.*")
        if not p.endswith(_SIDECARS)
    )


def restore_needed() -> bool:
    path = db_path()
    if os.path.exists(path):
        return is_unreadable(path)
    # The bad file already moved aside and no database replaced it: a restore
    # was interrupted. A fresh volume has neither, and must build normally.
    return bool(_quarantined())


def _log_forensics(path: str) -> None:
    """Record what the damaged file looks like before it moves."""
    try:
        stat = os.stat(path)
        with open(path, "rb") as fh:
            head = fh.read(100)
        usage = shutil.disk_usage(os.path.dirname(path))
        log.error("[bars-restore] unreadable %s: size=%d mtime=%d header=%s free_gb=%.1f",
                  path, stat.st_size, int(stat.st_mtime), head.hex(), usage.free / 1e9)
    except OSError as e:
        log.warning("[bars-restore] forensics failed: %s", e)


def _quarantine() -> bool:
    """Move an unreadable bars.db aside. False if it must be left for a person."""
    path = db_path()
    if not os.path.exists(path):
        return True
    if len(_quarantined()) >= _MAX_QUARANTINED:
        log.error("[bars-restore] %d quarantined copies already exist; refusing to "
                  "move another", _MAX_QUARANTINED)
        return False
    _log_forensics(path)
    dest = f"{path}.unreadable.{int(time.time())}"
    os.replace(path, dest)
    for suffix in _SIDECARS:
        if os.path.exists(path + suffix):
            os.replace(path + suffix, dest + suffix)
    log.warning("[bars-restore] moved unreadable database to %s", dest)
    return True


def _use_volume_tempdir() -> None:
    tmp = os.path.join(data_sync._DATA_DIR, "tmp")
    # A deploy that killed an earlier restore leaves a partial extract behind.
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp, exist_ok=True)
    tempfile.tempdir = tmp


def _stage_root() -> str:
    return os.path.join(data_sync._DATA_DIR, _STAGE_ROOT)


def _download(ts: str, stage: str) -> bool:
    """Fetch the snapshot tarball, resuming any bytes an earlier boot kept."""
    client = data_sync._client()
    bucket = data_sync._bucket()
    if not (client and bucket):
        return False
    key = f"{data_sync._SNAPSHOT_PREFIX}{ts}.tar.gz"
    tar = os.path.join(stage, "snapshot.tar.gz")
    part = tar + ".part"
    total = None
    misses = 0
    while misses < _DOWNLOAD_ATTEMPTS:
        have = os.path.getsize(part) if os.path.exists(part) else 0
        try:
            if total is None:
                total = int(client.head_object(Bucket=bucket, Key=key)["ContentLength"])
            if have > total:
                os.remove(part)
                have = 0
            if have < total:
                request = {"Bucket": bucket, "Key": key}
                if have:
                    request["Range"] = f"bytes={have}-"
                body = client.get_object(**request)["Body"]
                with open(part, "ab") as fh:
                    while True:
                        chunk = body.read(_CHUNK)
                        if not chunk:
                            break
                        fh.write(chunk)
        except Exception as e:  # noqa: BLE001 - a retry is the handling
            log.warning("[bars-restore] download of %s interrupted: %s", ts, e)
        now = os.path.getsize(part) if os.path.exists(part) else 0
        if total is not None and now == total:
            os.replace(part, tar)
            return True
        misses = 0 if now > have else misses + 1
        time.sleep(_RETRY_SLEEP_S)
    return False


def _extract(stage: str) -> bool:
    """Pull bars.db out of the tarball, then free the tarball's space."""
    tar = os.path.join(stage, "snapshot.tar.gz")
    db = os.path.join(stage, "bars.db")
    part = db + ".part"
    try:
        with tarfile.open(tar, mode="r:gz") as archive:
            # The destination is fixed, so a hostile member name cannot escape.
            member = next((m for m in archive
                           if m.isfile() and os.path.normpath(m.name) == "bars.db"), None)
            if member is None:
                log.error("[bars-restore] snapshot has no bars.db")
                return False
            with archive.extractfile(member) as src, open(part, "wb") as dst:
                shutil.copyfileobj(src, dst, _CHUNK)
            # gzip only checks its CRC at the end of the stream, past the member.
            while archive.fileobj.read(_CHUNK):
                pass
    except (tarfile.TarError, OSError, EOFError, zlib.error) as e:
        log.error("[bars-restore] extract failed: %s", e)
        return False
    os.replace(part, db)
    os.remove(tar)
    return True


def _is_complete_database(path: str) -> bool:
    """Fast proof that this file is a whole database holding bars.

    SQLite itself refuses a file shorter than its header declares.

    Deliberately not PRAGMA integrity_check: on the 40 GB file it outlasted every
    gap between redeploys, so a restore could never finish. That scan already
    passed before this snapshot was uploaded, the gzip CRC covers the transfer,
    and the uploader repeats the scan before anything ships to R2 again.
    """
    try:
        conn = sqlite3.connect(path, timeout=10)
        try:
            return conn.execute("SELECT 1 FROM ohlcv LIMIT 1").fetchone() is not None
        finally:
            conn.close()
    except sqlite3.Error as e:
        log.error("[bars-restore] database check failed: %s", e)
        return False


def _install_snapshot(ts: str) -> bool:
    """Advance this snapshot through download, extract, check and install."""
    stage = os.path.join(_stage_root(), ts)
    os.makedirs(stage, exist_ok=True)
    db = os.path.join(stage, "bars.db")
    tar = os.path.join(stage, "snapshot.tar.gz")

    if not os.path.exists(db):
        if not os.path.exists(tar) and not _download(ts, stage):
            return False  # the bytes so far stay for the next attempt
        if not _extract(stage):
            shutil.rmtree(stage, ignore_errors=True)
            return False
    if not _is_complete_database(db):
        log.error("[bars-restore] snapshot %s is not a complete database", ts)
        shutil.rmtree(stage, ignore_errors=True)
        return False
    os.replace(db, db_path())
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, ts)
    shutil.rmtree(_stage_root(), ignore_errors=True)
    return True


def restore() -> bool:
    """Quarantine the bad file and install the newest snapshot that verifies."""
    if not _quarantine():
        return False
    _use_volume_tempdir()

    candidates: list[str] = []
    latest = data_sync.get_latest_snapshot_ts()
    if latest:
        candidates.append(latest)
    candidates += [ts for ts in data_sync._list_snapshot_ts_desc() if ts not in candidates]

    for ts in candidates[:_SNAPSHOT_CANDIDATES]:
        log.info("[bars-restore] installing snapshot %s", ts)
        if _install_snapshot(ts) and not is_unreadable(db_path()):
            log.info("[bars-restore] snapshot %s installed", ts)
            return True
        log.warning("[bars-restore] snapshot %s did not install", ts)
    log.error("[bars-restore] no snapshot could be installed")
    return False


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib handler name
        body = json.dumps({"status": "restoring"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        pass


def _tell(notify: Optional[Callable[[str], None]], message: str) -> None:
    if not notify:
        return
    try:
        notify(message)
    except Exception as e:  # noqa: BLE001 - an alert must never stop a repair
        log.warning("[bars-restore] alert failed: %s", e)


def repair_at_boot(port: int, run: Callable = subprocess.run,
                   notify: Optional[Callable[[str], None]] = None) -> None:
    """Repair bars.db before the worker opens it. Raises if the repair fails."""
    if not restore_needed():
        return

    _tell(notify, "**Worker bars database unreadable.** Moving it aside and restoring "
                  "the newest verified R2 snapshot.")
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True,
                              name="bars-restore-health")
    thread.start()
    try:
        code = run([sys.executable, "-m", "api.services.bars_restore"]).returncode
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    if code != 0:
        _tell(notify, "**Worker bars database restore FAILED.** The worker will not start "
                      "until this is resolved. The damaged file was kept on the volume.")
        raise RuntimeError(f"bars.db restore failed with exit code {code}")
    _tell(notify, "Worker bars database restored from R2. The damaged file was kept on "
                  "the volume as bars.db.unreadable.*.")


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    # ⛔ credentials never reach a log line: filter on the handlers basicConfig just made
    from api.services.log_redaction import install as _install_log_redaction
    _install_log_redaction()
    return 0 if restore() else 1


if __name__ == "__main__":
    sys.exit(main())
