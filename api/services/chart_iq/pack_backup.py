"""Chart IQ pack BACKUP BUILDER on the worker service (never the web pod).

The lab PC builds the nightly pack and uploads it to R2 (lab chart_iq/site_port/build_pack.py); the web pod only installs it
(pack.sync_from_r2). If the PC misses a night (off, asleep, a failed step) members read an old session. The web pod must not
build it itself: on 2026-11-02 the in-process build took the web pod down (CHART_IQ_PACK_FALLBACK_ENABLED, off).

This runs on the WORKER (api/worker_main.py), a separate container that holds its own bars.db and never serves members:
  - twice a night (BACKUP_WINDOWS_ET) it compares the newest published pack's session (R2 chart_iq/latest_day.txt, written by
    every builder) with the worker's own latest session (SPY's last daily bar);
  - only if the pack is behind, it builds a pack in a CHILD PROCESS (os.nice, its own memory; a crash there cannot take the
    worker's prewarmer down with it) into a temp file, checks it exactly as the web's installer will (integrity_check, >= MIN_ROWS
    reads, dated the expected session), and publishes it with the PC's protocol: chart_iq/<ts>.db.gz, then latest_day.txt, then
    latest.txt LAST (the web never sees half a pack).
Gate: CHART_IQ_PACK_WORKER_ENABLED=1 on the worker service (default OFF). Arm only after one supervised run (see
docs/feature_flags.json). Never raises into the worker.
"""
from __future__ import annotations

import datetime
import gzip
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time

log = logging.getLogger(__name__)

R2_PREFIX = "chart_iq/"
MIN_ROWS = 1000
CHILD_TIMEOUT_S = 3 * 3600
# (weekdays, start, end) in ET, after the PC's nightly window (22:30 CT build + upload) and after its 06:00 CT retry
BACKUP_WINDOWS_ET = (({1, 2, 3, 4, 5}, datetime.time(0, 40), datetime.time(2, 30)),     # Tue-Sat early morning: Mon-Fri sessions
                     ({0, 1, 2, 3, 4}, datetime.time(6, 45), datetime.time(8, 0)))      # Mon-Fri before the open
CHECK_EVERY_S = 600


def dry_run() -> bool:
    """CHART_IQ_PACK_WORKER_DRYRUN=1: the SUPERVISED TEST. Build even when the pack is current and at any hour, and publish
    under chart_iq_test/ (the web pod never reads it), logging the child's peak memory. Members are never affected."""
    return os.environ.get("CHART_IQ_PACK_WORKER_DRYRUN", "0") == "1"


def enabled() -> bool:
    return os.environ.get("CHART_IQ_PACK_WORKER_ENABLED", "0") == "1"


def _now_et() -> datetime.datetime:
    from zoneinfo import ZoneInfo
    return datetime.datetime.now(ZoneInfo("America/New_York"))


def in_window(now: datetime.datetime | None = None) -> bool:
    now = now or _now_et()
    return any(now.weekday() in days and start <= now.time() <= end for days, start, end in BACKUP_WINDOWS_ET)


def _s3():
    from api.services.brain_sync import _s3_client
    return _s3_client()


def published_day(s3, bucket: str) -> str | None:
    try:
        return s3.get_object(Bucket=bucket, Key=R2_PREFIX + "latest_day.txt")["Body"].read().decode().strip() or None
    except Exception:  # noqa: BLE001  (no sidecar yet: read the pack's own meta)
        pass
    try:
        ts = int(s3.get_object(Bucket=bucket, Key=R2_PREFIX + "latest.txt")["Body"].read().decode().strip())
        raw = gzip.decompress(s3.get_object(Bucket=bucket, Key=R2_PREFIX + "%d.db.gz" % ts)["Body"].read())
        fd, tmp = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            with open(tmp, "wb") as fh:
                fh.write(raw)
            c = sqlite3.connect(tmp)
            try:
                return dict(c.execute("SELECT k, v FROM meta").fetchall()).get("day")
            finally:
                c.close()
        finally:
            os.remove(tmp)
    except Exception:  # noqa: BLE001
        return None


def market_day() -> str | None:
    from api.services.chart_iq import pipeline
    return pipeline.latest_day()


def check_pack(path: str, day: str) -> dict:
    """The installer's own acceptance test, run BEFORE publishing."""
    c = sqlite3.connect(path)
    try:
        if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("integrity_check failed")
        rows = c.execute("SELECT count(*) FROM reads").fetchone()[0]
        meta = dict(c.execute("SELECT k, v FROM meta").fetchall())
    finally:
        c.close()
    if rows < MIN_ROWS:
        raise ValueError("only %d reads" % rows)
    if meta.get("day") != day:
        raise ValueError("pack day %s, expected %s" % (meta.get("day"), day))
    return {"rows": rows, **meta}


def _child(path: str) -> int:
    """In the child process: build every read into `path` with the site's own pack.build (low priority)."""
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    os.environ.update(CHART_IQ_PACK_DB=path, CHART_IQ_ENABLED="1", CHART_IQ_PACK_ENABLED="1",
                      CHART_IQ_PACK_FALLBACK_ENABLED="1")   # the build gate, opened only inside this child, on the worker
    from api.services.chart_iq import pack
    rep = pack.build(force=True)
    c = sqlite3.connect(path)
    c.execute("INSERT OR REPLACE INTO meta (k, v) VALUES ('source', 'worker')")
    c.commit()
    c.close()
    print(rep, flush=True)
    return 0 if rep.get("ok") else 1


def publish(s3, bucket: str, path: str, day: str, clock=time.time, prefix: str = R2_PREFIX) -> str:
    ts = int(clock())
    with open(path, "rb") as fh:
        blob = gzip.compress(fh.read(), 6)
    s3.put_object(Bucket=bucket, Key=prefix + "%d.db.gz" % ts, Body=blob)
    s3.put_object(Bucket=bucket, Key=prefix + "latest_day.txt", Body=day.encode())
    s3.put_object(Bucket=bucket, Key=prefix + "latest.txt", Body=str(ts).encode())   # the pointer moves LAST
    return "%d.db.gz" % ts


def run_once(s3=None, run_child=None, now=None) -> dict:
    """One check: build + publish only when enabled, in a window, and the published pack is behind. Never raises."""
    if not enabled():
        return {"skipped": "disabled"}
    test = dry_run()
    if not test and not in_window(now):
        return {"skipped": "outside window"}
    try:
        bucket = os.environ["DATA_SYNC_BUCKET"]
        s3 = s3 or _s3()
        want, have = market_day(), published_day(s3, bucket)
        if not want or (have and have >= want and not test):
            return {"skipped": "current", "published": have, "market": want}
        fd, path = tempfile.mkstemp(prefix="chart_iq_backup-", suffix=".db", dir=os.environ.get("DATA_DIR") or None)
        os.close(fd)
        os.remove(path)
        try:
            t0 = time.time()
            if run_child is None:
                rc = subprocess.run([sys.executable, "-m", "api.services.chart_iq.pack_backup", "--child", path],
                                    timeout=CHILD_TIMEOUT_S).returncode
            else:
                rc = run_child(path)
            if rc != 0:
                raise RuntimeError("child build exit %s" % rc)
            meta = check_pack(path, want)
            key = publish(s3, bucket, path, want, prefix="chart_iq_test/" if test else R2_PREFIX)
            rep = {"published": key, "day": want, "rows": meta["rows"], "seconds": round(time.time() - t0, 1), "was": have,
                   "test": test, "child_peak_mb": _child_peak_mb()}
            log.warning("[chart_iq_backup] the PC's pack was behind (%s < %s): published %s", have, want, rep)
            return rep
        finally:
            for f in (path, path + "-wal", path + "-shm"):
                if os.path.exists(f):
                    os.remove(f)
    except Exception as e:  # noqa: BLE001
        log.warning("[chart_iq_backup] failed: %s", e)
        return {"error": "%s: %s" % (type(e).__name__, str(e)[:200])}


def _child_peak_mb():
    try:
        import resource
        return round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024, 1)   # Linux: KB
    except Exception:  # noqa: BLE001  (Windows)
        return None


def start_loop() -> bool:
    """Worker daemon: one check every CHECK_EVERY_S (cheap outside the windows: a clock compare). Returns True if started."""
    if not enabled():
        return False

    def _loop():
        while True:
            try:
                rep = run_once()
                if "published" in rep or "error" in rep:
                    log.warning("[chart_iq_backup] %s", rep)
                if dry_run() and "published" in rep:
                    log.warning("[chart_iq_backup] TEST DONE; unset CHART_IQ_PACK_WORKER_DRYRUN. Idle until then.")
                    while dry_run():   # one test build per boot; the env var is fixed for the process, so this idles
                        time.sleep(3600)
            except Exception as e:  # noqa: BLE001
                log.warning("[chart_iq_backup] loop error: %s", e)
            time.sleep(CHECK_EVERY_S)

    threading.Thread(target=_loop, daemon=True, name="chart-iq-pack-backup").start()
    log.info("[chart_iq_backup] started (windows ET %s)", BACKUP_WINDOWS_ET)
    return True


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "--child":
    sys.exit(_child(sys.argv[2]))
