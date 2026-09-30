"""Daily backup of econ.db -- the one irreplaceable file.

Backfilled history can always be re-acquired from the agencies, but LIVE vintages
(what an agency published at release time, before later revisions) exist nowhere
else once captured. So the service takes a consistent SQLite online backup once a
day (sqlite3 `Connection.backup`, safe while the writer is live; never a file
copy of a WAL database), verifies it (`PRAGMA integrity_check` + the append-only
triggers still present), and keeps the newest `ECON_BACKUP_KEEP` (default 7).

Where:
  ECON_BACKUP_DIR   local directory on the SAME volume (default <dir of ECON_DB_PATH>/econ-backups)
  ECON_BACKUP_R2=1  additionally upload the gzip to the data_sync bucket under
                    econ/v1/backup/econ-YYYYMMDD.db.gz (off unless set; no other prefix is touched)

Restore = stop the service, replace econ.db with a verified backup, start the
service: boot recovery (leases, pending publishes, calendar/state refresh) and the
scheduler's windows re-acquire anything newer. Backups are never restored over a
database whose schema version is NEWER than the backup's (store.connect refuses a
newer DB; restoring an OLDER one is followed by the forward migrations).
"""
from __future__ import annotations

import gzip
import logging
import os
import sqlite3
import time
from typing import Optional

from . import secrets, timeutil

log = logging.getLogger(__name__)

BACKUP_EVERY_S = 24 * 3600
_TRIGGERS = ("observation_no_update", "observation_no_delete")


def backup_dir(db_path: str) -> str:
    return os.environ.get("ECON_BACKUP_DIR") or os.path.join(os.path.dirname(os.path.abspath(db_path)), "econ-backups")


def keep_count() -> int:
    try:
        return max(1, int(os.environ.get("ECON_BACKUP_KEEP", "7")))
    except ValueError:
        return 7


def _verify(path: str) -> list[str]:
    reasons: list[str] = []
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        ok = c.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            reasons.append(f"integrity_check: {ok}")
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
        missing = [t for t in _TRIGGERS if t not in names]
        # tolerate differently-named triggers as long as UPDATE/DELETE guards exist on observation
        if missing:
            sql = " ".join(r[0] or "" for r in c.execute(
                "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='observation'"))
            if "UPDATE" not in sql.upper() or "DELETE" not in sql.upper():
                reasons.append("append-only triggers missing on observation")
    finally:
        c.close()
    return reasons


def run_backup(db_path: str, now: Optional[int] = None, *, upload=None) -> dict:
    """Take, verify and rotate one backup. Returns a small status dict (no values, no secrets)."""
    now = int(time.time()) if now is None else int(now)
    day = timeutil.et_date(now).strftime("%Y%m%d")
    out_dir = backup_dir(db_path)
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, f"econ-{day}.db")
    tmp = target + ".partial"
    for leftover in (tmp, tmp + "-wal", tmp + "-shm"):
        if os.path.exists(leftover):
            os.remove(leftover)
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)
        # The backup inherits WAL mode; fold it into ONE self-contained file (no -wal/-shm
        # sidecars), so the file that is renamed/uploaded IS the whole database.
        dst.execute("PRAGMA journal_mode=DELETE")
    finally:
        dst.close()
        src.close()
    reasons = _verify(tmp)
    if reasons:
        os.remove(tmp)
        log.error("econ.backup: verification failed, backup discarded: %s", "; ".join(reasons))
        return {"ok": False, "day": day, "reasons": reasons}
    os.replace(tmp, target)
    size = os.path.getsize(target)
    uploaded = None
    if upload is None and os.environ.get("ECON_BACKUP_R2", "0") == "1":
        from api.services import data_sync  # noqa: WPS433 -- only when explicitly armed

        def upload(key, data):
            return data_sync.put_bytes(key, data, "application/gzip")
    if upload is not None:
        with open(target, "rb") as fh:
            gz = gzip.compress(fh.read(), compresslevel=6)
        key = f"econ/v1/backup/econ-{day}.db.gz"
        try:
            uploaded = bool(upload(key, gz))
        except Exception as e:  # noqa: BLE001
            uploaded = False
            log.warning("econ.backup: upload failed: %s", secrets.safe_exc(e))
    kept = sorted(f for f in os.listdir(out_dir) if f.startswith("econ-") and f.endswith(".db"))
    for old in kept[:-keep_count()]:
        try:
            os.remove(os.path.join(out_dir, old))
        except OSError:
            pass
    log.info("econ.backup: %s ok bytes=%d uploaded=%s kept=%d", day, size, uploaded,
             min(len(kept), keep_count()))
    return {"ok": True, "day": day, "bytes": size, "uploaded": uploaded, "path": target}
