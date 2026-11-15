"""flow.db self-repair: restore the newest verified backup when the live file dies, and keep one
verified backup every night so there always is one.

⚰️ WHY (2026-11-13). flow.db broke at 07:35 ET with no deploy and no second writer: page 1 was
overwritten ("file is not a database"). The canary saw it at 07:46 but only LOGGED it, and the
live options tape stayed dead until a person restored the 01:44 UTC backup by hand at 09:30:40
ET, 187 s of copying. Seven damages in five days; the cause is still open (storage is the
suspect). This module turns that two-hour outage into minutes, without a person:

  * `on_canary_result` counts consecutive FATAL canary failures (unreadable file, malformed
    image, I/O error). At `FATAL_TICKS` in a row, and only if a fresh direct check of the live
    file ALSO fails, it calls `restore()`.
  * `restore()` copies the newest backup that reads cleanly next to the live file (the backup
    itself stays untouched), moves the damaged file aside (KEPT, never deleted: owner rule
    2026-11-12 "leave the files"), and swaps the copy in. FlowDB opens a connection per call,
    so writes resume on the restored file without a restart (proved by hand twice).
  * `nightly_backup()` writes a new backup to a temp name, verifies the COPY (quick_check runs
    on the copy, never on the live file), and only then replaces the old one. It refuses when
    the live file does not read cleanly, so a damaged file can never displace a good backup.

Rows written after the backup are not in the restored file; the T+1/walkback gap-fill heals whole
sessions from flat files and the REST heal covers recent minutes. A restore posts what it did and
which days to re-fill.

Guards: kill switch `FLOW_AUTO_RESTORE_ENABLED=0`; at most one restore per `COOLDOWN_S`
(marker on the volume, survives restarts); refuses without disk room for the copy; never
deletes anything. Never raises to the caller."""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import threading
import time

log = logging.getLogger(__name__)

ENABLED = os.environ.get("FLOW_AUTO_RESTORE_ENABLED", "1") != "0"
FATAL_TICKS = int(os.environ.get("FLOW_AUTO_RESTORE_FATAL_TICKS", "2"))
COOLDOWN_S = int(float(os.environ.get("FLOW_AUTO_RESTORE_COOLDOWN_H", "6")) * 3600)
ROOM_MARGIN_BYTES = 2 << 30
_MAGIC = b"SQLite format 3\x00"
_FATAL = ("not a database", "malformed", "disk i/o error", "database corrupt", "file is encrypted")

_state = {"fatal_ticks": 0, "last_result": None}


def _paths():
    from api import flow_gap_autofill as gf
    return gf.DB_PATH, gf.BACKUP_DIR


def _marker(db_path: str) -> str:
    return os.path.join(os.path.dirname(db_path) or "/data", ".flow_autorestore_last")


def _shout(msg: str) -> None:
    log.error(msg)
    try:
        from api import flow_backup
        flow_backup._post_discord(msg)
    except Exception:  # noqa: BLE001
        pass


def is_fatal(detail: str) -> bool:
    d = (detail or "").lower()
    return any(s in d for s in _FATAL)


def reads_cleanly(path: str, window: int = 2000):
    """(ok, max_id, detail): SQLite header, MAX(id), and a full-row read of the newest `window`
    rows (the canary's bounded write-head shape). Read-only; never raises."""
    # ⛔ Through SQLite ONLY, never a plain open(): closing any plain descriptor on the live file
    # drops every POSIX lock this process holds on it (flow_db_guard). A damaged page 1 surfaces
    # as "file is not a database" from the connection below.
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=20)
        try:
            mx = conn.execute("SELECT MAX(id) FROM flow").fetchone()[0]
            if mx is not None:
                for _ in conn.execute("SELECT * FROM flow WHERE id >= ? AND id < ?",
                                      (max(1, int(mx) - window + 1), int(mx) + 1)):
                    pass
            return True, mx, "ok"
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        return False, None, "%s: %s" % (type(e).__name__, e)


def _backups(backup_dir: str) -> list:
    """Backup files (flow-pre-*.db, the gap-fill + nightly family), newest first."""
    out = []
    try:
        for f in os.listdir(backup_dir):
            if f.startswith("flow-pre-") and f.endswith(".db"):
                p = os.path.join(backup_dir, f)
                out.append((os.path.getmtime(p), p))
    except OSError:
        return []
    return [p for _, p in sorted(out, reverse=True)]


def newest_good_backup(backup_dir: str):
    """(path, max_id) of the newest backup that reads cleanly, or (None, None)."""
    for p in _backups(backup_dir):
        ok, mx, _ = reads_cleanly(p)
        if ok and mx is not None:
            return p, mx
    return None, None


def _cooling_down(db_path: str, now: float) -> bool:
    try:
        with open(_marker(db_path)) as f:
            return now - float(f.read().strip() or 0) < COOLDOWN_S
    except Exception:  # noqa: BLE001
        return False


def restore(reason: str = "", now: float | None = None) -> dict:
    """Swap the newest good backup in for a dead live file. Returns a status dict; never raises."""
    now = time.time() if now is None else now
    db, bdir = _paths()
    out = {"status": None, "reason": reason}
    try:
        if not ENABLED:
            out["status"] = "disabled"
            return out
        if _cooling_down(db, now):
            out["status"] = "cooldown"
            return out
        ok, _, detail = reads_cleanly(db)
        if ok:
            out["status"] = "live_ok"            # recovered on its own: nothing to do
            return out
        out["live_detail"] = detail
        src, bk_max = newest_good_backup(bdir)
        if not src:
            out["status"] = "no_backup"
            _shout("[flow-autorestore] ⛔ flow.db is unreadable (%s) and NO readable backup exists in "
                   "%s. Manual recovery: docs/runbooks/flow-worker-deploys-and-flow-db.md" % (detail, bdir))
            return out
        size = os.path.getsize(src)
        free = shutil.disk_usage(os.path.dirname(db) or "/").free
        if free < size + ROOM_MARGIN_BYTES:
            out["status"] = "no_room"
            _shout("[flow-autorestore] ⛔ flow.db is unreadable (%s); backup %s is good but only %.1f GB "
                   "is free for its %.1f GB copy. Free space, then restore (runbook)."
                   % (detail, src, free / 1e9, size / 1e9))
            return out
        with open(_marker(db), "w") as f:       # claim the cooldown BEFORE the copy
            f.write(str(now))
        tmp = db + ".autorestore"
        for p in (tmp, tmp + "-wal", tmp + "-shm"):
            if os.path.exists(p):
                os.remove(p)
        t0 = time.time()
        shutil.copyfile(src, tmp)
        with open(tmp, "r+b") as fh:             # read-write handle: fsync works on every OS
            os.fsync(fh.fileno())
        ok, tmp_max, tdetail = reads_cleanly(tmp)
        if not ok:
            out["status"] = "copy_bad"
            _shout("[flow-autorestore] ⛔ the copy of %s does not read cleanly (%s); nothing swapped."
                   % (src, tdetail))
            return out
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(now))
        kept = "%s.corrupt-auto-%s" % (db, stamp)
        for suf in ("-wal", "-shm"):
            if os.path.exists(db + suf):
                os.rename(db + suf, kept + suf)
        if os.path.exists(db):
            os.rename(db, kept)
        os.rename(tmp, db)
        out.update(status="restored", backup=src, backup_max_id=bk_max, kept=kept,
                   copy_s=round(time.time() - t0, 1))
        # Restart cleanly: long-lived connections still point at the swapped-out file and its log.
        try:
            from api import flow_db_guard
            threading.Timer(3.0, flow_db_guard.request_restart,
                            args=("restored backup %s" % os.path.basename(src),)).start()
        except Exception:  # noqa: BLE001
            pass
        _shout("[flow-autorestore] ✅ flow.db was unreadable (%s). Restored backup %s (max id %s, "
               "copied in %.0fs); live writes resume on it now. Damaged file KEPT at %s. Rows written "
               "after the backup are missing: run the gap-fill for each day since the backup was taken."
               % (detail, os.path.basename(src), bk_max, out["copy_s"], kept))
        return out
    except Exception as e:  # noqa: BLE001
        out.update(status="error", error="%s: %s" % (type(e).__name__, e))
        _shout("[flow-autorestore] ⛔ restore attempt failed: %s" % out["error"])
        return out
    finally:
        _state["last_result"] = out


def on_canary_result(result: dict) -> dict | None:
    """Called by the canary every tick. Restores after FATAL_TICKS consecutive fatal failures."""
    try:
        if result.get("ok"):
            _state["fatal_ticks"] = 0
            return None
        if not is_fatal(result.get("detail", "")):
            return None
        _state["fatal_ticks"] += 1
        if _state["fatal_ticks"] < FATAL_TICKS:
            return None
        _state["fatal_ticks"] = 0
        return restore(reason=result.get("detail", ""))
    except Exception:  # noqa: BLE001
        return None


def nightly_backup(now: float | None = None) -> dict:
    """One verified backup per night. New copy first (temp name), verified on the COPY, then it
    replaces the old one. Refuses when the live file does not read cleanly. Never raises."""
    from api import flow_gap_autofill as gf
    db, bdir = _paths()
    out = {"status": None}
    try:
        ok, mx, detail = reads_cleanly(db)
        if not ok:
            out.update(status="live_unreadable", detail=detail)
            _shout("[flow-backup] ⛔ nightly backup SKIPPED: live flow.db does not read cleanly (%s). "
                   "The existing backup is kept." % detail)
            return out
        os.makedirs(bdir, exist_ok=True)
        size = sum(os.path.getsize(p) for p in (db, db + "-wal") if os.path.exists(p))
        free = shutil.disk_usage(bdir).free
        if free < size + gf.BACKUP_FREE_FLOOR_BYTES:
            out.update(status="no_room", free_gb=round(free / 1e9, 1), need_gb=round((size + gf.BACKUP_FREE_FLOOR_BYTES) / 1e9, 1))
            _shout("[flow-backup] ⛔ nightly backup SKIPPED: %.1f GB free, need %.1f GB beside the "
                   "existing backup. The existing backup is kept." % (out["free_gb"], out["need_gb"]))
            return out
        stamp = time.strftime("%Y-%m-%d", time.gmtime(time.time() if now is None else now))
        final = os.path.join(bdir, "flow-pre-nightly-%s.db" % stamp)
        tmp = os.path.join(bdir, "nightly-partial-%s.db" % stamp)   # NOT flow-pre-*: the prune must never count it
        if os.path.exists(tmp):
            os.remove(tmp)
        t0 = time.time()
        src = sqlite3.connect(db, timeout=30)
        try:
            dst = sqlite3.connect(tmp)
            try:
                src.backup(dst)
                # A standalone file: the copy inherits WAL mode, and a WAL-mode backup grows
                # -wal/-shm sidecars the moment anything opens it (including the check below).
                dst.execute("PRAGMA journal_mode=DELETE")
            finally:
                dst.close()
        finally:
            src.close()
        conn = sqlite3.connect("file:%s?mode=ro" % tmp, uri=True)
        try:
            qc = conn.execute("PRAGMA quick_check").fetchone()[0]
        finally:
            conn.close()
        if qc != "ok":
            os.remove(tmp)
            out.update(status="copy_bad", detail=qc)
            _shout("[flow-backup] ⛔ nightly backup copy FAILED quick_check (%s); removed it, the "
                   "existing backup is kept." % qc)
            return out
        for suf in ("-wal", "-shm"):
            if os.path.exists(tmp + suf):
                os.remove(tmp + suf)
        os.replace(tmp, final)
        gf._prune_backups(keep=1)               # the new verified copy is the newest: keep it only
        out.update(status="ok", path=final, max_id=mx, seconds=round(time.time() - t0, 1))
        log.info("[flow-backup] nightly backup ok: %s (max id %s) in %.0fs", final, mx, out["seconds"])
        return out
    except Exception as e:  # noqa: BLE001
        out.update(status="error", error="%s: %s" % (type(e).__name__, e))
        _shout("[flow-backup] ⛔ nightly backup failed: %s" % out["error"])
        return out


def status() -> dict:
    db, bdir = _paths()
    return {"enabled": ENABLED, "fatal_ticks": _state["fatal_ticks"], "fatal_ticks_to_restore": FATAL_TICKS,
            "last_result": _state["last_result"], "backups": _backups(bdir)[:3],
            "cooling_down": _cooling_down(db, time.time())}
