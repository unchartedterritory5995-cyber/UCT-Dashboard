"""Chart IQ nightly pack: every stock's latest-session read computed ahead of time, so a member's read is one lookup.

Why: on the web pod a cold read costs seconds (bars.db answers ~1 s per query; measured 2026-11-02), and caching only helps the
second view. The owner's bar is "instant for every stock, all the time". So after the close, when the day's bars are final, the
pod reads every stock in the universe (api/data/cap_universe.json) plus every ticker members opened recently, ONE AT A TIME with
the exact pipeline the route uses, and stores each read in <DATA_DIR>/chart_iq_pack.db. The route answers a latest-session ask
from the pack; anything else (a past date, a ticker the pack does not have, a pack older than STALE_DAYS) takes the live path.

Safety: refuses to build during the regular session (09:20-17:30 ET) unless forced; one read at a time with a short pause; the
rows-cache memory is capped while it runs; never raises; a status row records day / count / errors / seconds for admins.
Gate: CHART_IQ_PACK_ENABLED=1 (and CHART_IQ_ENABLED). Never imports the engine at boot.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import sqlite3
import threading
import time

STALE_DAYS = 5
PAUSE_S = 0.05
COMMIT_EVERY = 50
BUILD_MEM_MAX = 4000
SKIP_FIELDS = ("bars", "timing")
_LOCK = threading.Lock()
_BUILDING = threading.Event()
_INIT: set = set()
log = logging.getLogger(__name__)


def enabled() -> bool:
    return os.environ.get("CHART_IQ_PACK_ENABLED", "0") == "1" and os.environ.get("CHART_IQ_ENABLED", "0") == "1"


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def _current_marker() -> str:
    return os.path.join(_data_dir(), "chart_iq_pack.current")


def _path() -> str:
    """The active pack file: CHART_IQ_PACK_DB (tests), else the file named by the 'current' marker (a pack installed from R2),
    else the server-built default. A received pack never replaces a live file in place (a WAL database must not be swapped
    under its -wal / -shm): it gets its own name and the marker is switched atomically."""
    if os.environ.get("CHART_IQ_PACK_DB"):
        return os.environ["CHART_IQ_PACK_DB"]
    try:
        name = open(_current_marker(), encoding="utf-8").read().strip()
        if name and os.path.isfile(os.path.join(_data_dir(), name)):
            return os.path.join(_data_dir(), name)
    except OSError:
        pass
    return os.path.join(_data_dir(), "chart_iq_pack.db")


def _conn() -> sqlite3.Connection:
    p = _path()
    c = sqlite3.connect(p, timeout=5)
    c.execute("PRAGMA busy_timeout=5000")
    if p not in _INIT:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("CREATE TABLE IF NOT EXISTS reads (ticker TEXT PRIMARY KEY, asof TEXT NOT NULL, body TEXT NOT NULL, built REAL NOT NULL)")
        c.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
        _INIT.add(p)
    return c


def _et_now() -> datetime.datetime:
    from zoneinfo import ZoneInfo
    return datetime.datetime.now(ZoneInfo("America/New_York"))


def in_session(now: datetime.datetime | None = None) -> bool:
    n = now or _et_now()
    if n.weekday() >= 5:
        return False
    m = n.hour * 60 + n.minute
    return 9 * 60 + 20 <= m < 17 * 60 + 30


def _days_between(a: str, b: str) -> int:
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


_TL = threading.local()


def _reader():
    """A per-thread read connection, reopened when the active pack file changes (a sync installs a new versioned file)."""
    p = _path()
    held = getattr(_TL, "conn", None)
    if held is None or held[0] != p:
        if held is not None:
            try:
                held[1].close()
            except Exception:  # noqa: BLE001
                pass
        _conn().close()   # schema / WAL set up once per file
        held = (p, sqlite3.connect(p, timeout=5, check_same_thread=False))
        _TL.conn = held
    return held[1]


def get(ticker: str, today: str | None = None) -> dict | None:
    """The packed read for this ticker, or None (pack off, no pack, not in it, or older than STALE_DAYS). Never raises."""
    if not enabled():
        return None   # rollback is the flag: an old pack file on disk is never served once it is off
    try:
        r = _reader().execute("SELECT asof, body FROM reads WHERE ticker=?", (str(ticker).upper(),)).fetchone()
        if not r:
            return None
        today = today or _et_now().date().isoformat()
        if _days_between(r[0], today) > STALE_DAYS:
            return None
        return json.loads(r[1])
    except Exception:  # noqa: BLE001
        return None


def status() -> dict:
    try:
        c = _conn()
        try:
            meta = dict(c.execute("SELECT k, v FROM meta").fetchall())
            n = c.execute("SELECT count(*) FROM reads").fetchone()[0]
        finally:
            c.close()
        return {"rows": n, "building": _BUILDING.is_set(), **meta}
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


def universe() -> list[str]:
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, "..", "..", "data", "cap_universe.json")
    out = []
    try:
        for u in json.load(open(p, encoding="utf-8")):
            t = u if isinstance(u, str) else (u.get("ticker") or u.get("symbol"))
            if t:
                out.append(str(t).upper())
    except Exception:  # noqa: BLE001
        pass
    try:
        from api.services.chart_iq import prewarm
        out += [t for t in prewarm.recent_tickers()]
    except Exception:  # noqa: BLE001
        pass
    seen, uniq = set(), []
    for t in out:
        if t not in seen:
            seen.add(t); uniq.append(t)
    return uniq


def build(force: bool = False, tickers: list[str] | None = None, sleep=time.sleep, clock=time.time) -> dict:
    """Read every ticker for the latest session into the pack. Returns a report; never raises."""
    if not enabled() and not force:
        return {"skipped": "disabled"}
    if in_session() and not force:
        return {"skipped": "regular session"}
    if _BUILDING.is_set():
        return {"skipped": "already building"}
    _BUILDING.set()
    started = clock()
    try:
        from api.services.chart_iq import pipeline
        from api.services.chart_iq.engine import _db
        day = pipeline.latest_day()
        if not day:
            return {"skipped": "no daily bars"}
        old_max = _db.MEM_MAX
        _db.MEM_MAX = min(old_max, BUILD_MEM_MAX)
        ok = err = 0
        c = _conn()
        try:
            c.execute("INSERT OR REPLACE INTO meta (k, v) VALUES ('building_for', ?)", (day,))
            c.commit()
            for k, t in enumerate(tickers if tickers is not None else universe()):
                try:
                    res = pipeline.analyze(t, day)
                except Exception:  # noqa: BLE001
                    res = {"error": "exception"}
                if "error" in res:
                    err += 1
                else:
                    body = {kk: v for kk, v in res.items() if kk not in SKIP_FIELDS}
                    c.execute("INSERT OR REPLACE INTO reads (ticker, asof, body, built) VALUES (?,?,?,?)",
                              (t, res.get("asof") or day, json.dumps(body, separators=(",", ":")), clock()))
                    ok += 1
                if k % COMMIT_EVERY == 0:
                    c.commit()
                sleep(PAUSE_S)
            rep = {"day": day, "ok": ok, "errors": err, "seconds": round(clock() - started, 1),
                   "built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
            for kk, v in rep.items():
                c.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", (kk, str(v)))
            c.execute("DELETE FROM meta WHERE k='building_for'")
            c.commit()
        finally:
            c.close()
            _db.MEM_MAX = old_max
        log.info("[chart_iq_pack] %s", rep)
        return rep
    except Exception as e:  # noqa: BLE001
        log.warning("[chart_iq_pack] build failed: %s", e)
        return {"error": type(e).__name__}
    finally:
        _BUILDING.clear()


# ── the efficient path: the lab PC builds the pack (fast local disk: ~10 min for the universe) and uploads ONE file to R2
# (chart_iq/<ts>.db.gz + chart_iq/latest.txt, the same bucket and DATA_SYNC_* credentials as the bars and brain packs).
# The pod pulls it every 15 minutes: download, gunzip to a new versioned file, integrity_check, sanity (rows, day not older
# than the installed pack), switch the 'current' marker atomically, keep the previous file one cycle. The server-side build()
# remains as the fallback when no fresh pack arrives.
MIN_ROWS = 1000
R2_PREFIX = "chart_iq/"


def _installed_ts() -> int:
    try:
        return int(open(os.path.join(_data_dir(), "chart_iq_pack.r2ts"), encoding="utf-8").read().strip())
    except (OSError, ValueError):
        return 0


def sync_from_r2(s3=None) -> dict:
    """Install a newer PC-built pack from R2. Returns a report; never raises."""
    if not enabled():
        return {"skipped": "disabled"}
    import gzip
    import shutil
    import tempfile
    try:
        bucket = os.environ["DATA_SYNC_BUCKET"]
        if s3 is None:
            from api.services.brain_sync import _s3_client
            s3 = _s3_client()
        latest = int(s3.get_object(Bucket=bucket, Key=R2_PREFIX + "latest.txt")["Body"].read().decode().strip())
        if latest <= _installed_ts():
            return {"skipped": "current", "ts": latest}
        blob = s3.get_object(Bucket=bucket, Key=R2_PREFIX + "%d.db.gz" % latest)["Body"].read()
        name = "chart_iq_pack-%d.db" % latest
        target = os.path.join(_data_dir(), name)
        fd, tmp = tempfile.mkstemp(prefix=".chart_iq_pack-", suffix=".db", dir=_data_dir())
        os.close(fd)
        try:
            with open(tmp, "wb") as fh:
                fh.write(gzip.decompress(blob))
            c = sqlite3.connect(tmp)
            try:
                if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("integrity_check failed")
                rows = c.execute("SELECT count(*) FROM reads").fetchone()[0]
                day = dict(c.execute("SELECT k, v FROM meta").fetchall()).get("day")
            finally:
                c.close()
            if rows < MIN_ROWS or not day:
                raise ValueError("pack too small or undated (%s rows, day %s)" % (rows, day))
            cur = status().get("day")
            if cur and day < cur:
                raise ValueError("pack day %s is older than the installed %s" % (day, cur))
            os.replace(tmp, target)
            tmp = None
        finally:
            if tmp and os.path.exists(tmp):
                os.remove(tmp)
        prev = _path()
        with open(_current_marker() + ".tmp", "w", encoding="utf-8") as fh:
            fh.write(name)
        os.replace(_current_marker() + ".tmp", _current_marker())
        with open(os.path.join(_data_dir(), "chart_iq_pack.r2ts"), "w", encoding="utf-8") as fh:
            fh.write(str(latest))
        keep = {name, os.path.basename(prev)}    # the new pack and the one it replaced; older received packs (and their
        for f in os.listdir(_data_dir()):        # -wal / -shm side files) are removed
            if not f.startswith("chart_iq_pack-"):
                continue
            base = f[:f.index(".db") + 3] if ".db" in f else f
            if base not in keep:
                try:
                    os.remove(os.path.join(_data_dir(), f))
                except OSError:
                    pass
        rep = {"installed": latest, "day": day, "rows": rows}
        log.info("[chart_iq_pack] synced %s", rep)
        return rep
    except Exception as e:  # noqa: BLE001
        log.warning("[chart_iq_pack] sync failed: %s", e)
        return {"error": "%s: %s" % (type(e).__name__, e)}


def build_if_behind() -> dict:
    """Morning catch-up: build only when the pack is not already on the latest session."""
    if not enabled():
        return {"skipped": "disabled"}
    try:
        from api.services.chart_iq import pipeline
        day = pipeline.latest_day()
        if status().get("day") == day:
            return {"skipped": "pack current", "day": day}
    except Exception:  # noqa: BLE001
        pass
    return build()
