"""
flow_gap_autofill.py — T+1 self-healing gap-fill for flow.db (deploy-survival P2).

Massive OPRA does not replay: any minute the live WS worker missed is gone
until the T+1 flat file. This module detects market-hours write gaps for a
completed day and heals them from the flat file — deterministically,
reversibly, and visibly.

Design (hardened spec: docs/superpowers/specs/liveflow-deploy-survival/
p2-gapfill-spec.md — read it before changing anything here):

- Schedule: 16:45 ET primary / 21:00 retry / 08:00 final (post-close only —
  NEVER during market hours: live-writer contention + backup restarts).
- Detection is OWN code (ZoneInfo, data-driven calendar via liveflow_monitor's
  session helpers) — no dependency on live_massive_router's UTC-4 sites.
- Fill = DELETE-WINDOW-THEN-FILL (±60s margin), NOT blind re-ingest:
  a burst partially captured at a gap edge has different Volume/Premium →
  different dedup_key → blind force-insert double-counts every edge.
  Invariant: every second of a filled window is single-source.
- Reversible: full copies of deleted rows archived in the SAME transaction;
  POST /api/flow-gap-fill/rollback/{run_id} restores them (≤7 days).
- CACHE-VERSION: flow_router's version is row-count based — a delete-N/
  insert-N fill is INVISIBLE without bump_data_version() (and a boot re-bump,
  because the offset is process-local). Both are mandatory here.
- Backfilled rows are CLASSIFIED post-fill by api/flow_heal_enrich.py
  (OI from dated snapshots → color rebuild → Side tick-test patches → parity
  check vs the live-captured baseline). Rows-only heals looked green to every
  health check while being invisible to side/V-OI gated tiers (7/14/2026:
  0% sided, 89% OI=0 — spec: autoheal_classification_spec.md). Remaining
  accepted degradation: Spot='0' / IV='0'.

Gates: FLOW_GAP_AUTOFILL_ENABLED (default 0 — ships dark),
FLOW_GAP_AUTOFILL_DRY_RUN (default 1 for week one),
FLOW_GAP_AUTOFILL_SKIP_BACKUP (default 0).
"""
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

ENABLED = os.environ.get("FLOW_GAP_AUTOFILL_ENABLED", "0").lower() in ("1", "true", "yes")
DRY_RUN = os.environ.get("FLOW_GAP_AUTOFILL_DRY_RUN", "1").lower() in ("1", "true", "yes")
SKIP_BACKUP = os.environ.get("FLOW_GAP_AUTOFILL_SKIP_BACKUP", "0").lower() in ("1", "true", "yes")
MIN_GAP_MINUTES = int(os.environ.get("FLOW_FILL_MIN_GAP_MINUTES", "2"))
WALKBACK_TRADING_DAYS = int(os.environ.get("FLOW_FILL_WALKBACK_DAYS", "5"))
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
BACKUP_DIR = os.environ.get(
    "FLOW_FILL_BACKUP_DIR",
    os.path.join(os.path.dirname(DB_PATH) or "/data", "flow_backups"))
EDGE_MARGIN_SEC = 60          # ±60s covers any burst straddling a gap edge
ARCHIVE_PRUNE_DAYS = 30
ROLLBACK_MAX_AGE_DAYS = 7     # prune_expired interplay — never resurrect older
STALE_RUN_MINUTES = 30        # 'running' with heartbeat older than this = dead

_RUN_LOCK = threading.Lock()  # non-blocking guard against overlapping runs

router = APIRouter(prefix="/api/flow-gap-fill", tags=["flow-gap-fill"])


# --- Manifest schema ---------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS flow_fill_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'windows',
  started_at TEXT NOT NULL, finished_at TEXT, heartbeat_at TEXT,
  backup_path TEXT, min_premium REAL, min_volume INTEGER,
  windows_found INTEGER DEFAULT 0, rows_deleted INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0, rows_skipped_dupe INTEGER DEFAULT 0,
  version_before INTEGER, version_after INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS flow_fill_windows (
  window_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  gap_start_min INTEGER, gap_end_min INTEGER,
  start_sec INTEGER NOT NULL, end_sec INTEGER NOT NULL,
  status TEXT NOT NULL,
  deleted_count INTEGER DEFAULT 0, inserted_count INTEGER DEFAULT 0,
  skipped_dupe_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS flow_fill_inserted (
  run_id INTEGER NOT NULL, window_id INTEGER NOT NULL, flow_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, flow_id)
);
CREATE TABLE IF NOT EXISTS flow_fill_archive (
  archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL, window_id INTEGER NOT NULL, orig_id INTEGER NOT NULL,
  source TEXT, row_json TEXT NOT NULL, dedup_key TEXT, orig_created_at TEXT,
  archived_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


def _conn():
    # isolation_level=None = autocommit: transaction boundaries are OWNED by
    # this module's explicit BEGIN IMMEDIATE / COMMIT / ROLLBACK (per-window
    # atomicity), not by the sqlite3 module's implicit-begin machinery.
    c = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.row_factory = sqlite3.Row
    return c


def _init_schema():
    with _conn() as c:
        c.executescript(_SCHEMA)


# --- Time / calendar helpers -------------------------------------------------

def _sec_of_day(created_time: str):
    """'H:MM:SS AM/PM' -> seconds since midnight ET, or None if unparseable."""
    try:
        t = created_time.strip().upper()
        clock, ampm = t.rsplit(" ", 1)
        h, m, s = (int(x) for x in clock.split(":"))
        if ampm == "AM":
            h = 0 if h == 12 else h
        else:
            h = h if h == 12 else h + 12
        return h * 3600 + m * 60 + s
    except Exception:
        return None


def _mdy(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def _session_end_min(d: date) -> int:
    """Minutes-of-day session end: 13:00 on early closes, else 16:00."""
    from api.services.liveflow_monitor import _NYSE_EARLY_CLOSES_YYYYMMDD
    ymd = d.year * 10000 + d.month * 100 + d.day
    return 13 * 60 if ymd in _NYSE_EARLY_CLOSES_YYYYMMDD else 16 * 60


def _is_trading_day(d: date) -> bool:
    from api.services.liveflow_monitor import _full_closures
    ymd = d.year * 10000 + d.month * 100 + d.day
    return d.weekday() < 5 and ymd not in _full_closures()


def _prev_trading_day(d: date) -> date:
    d = d - timedelta(days=1)
    while not _is_trading_day(d):
        d = d - timedelta(days=1)
    return d


def _latest_completed_trading_day(now_et: datetime) -> date:
    """The latest trading day whose session is fully over. Today only counts
    once its session has been closed ~45min; otherwise the prior trading day.
    Shared by run_fill's default target AND the walkback anchor."""
    target = now_et.date()
    if not _is_trading_day(target) or now_et.hour * 60 + now_et.minute < _session_end_min(target) + 45:
        target = _prev_trading_day(target)
    return target


# --- Detection (pure, unit-tested) --------------------------------------------

SESSION_START_MIN = 9 * 60 + 30  # 09:30 ET


def windows_from_minutes(minutes_with_rows: set, session_end_min: int,
                         min_gap: int = MIN_GAP_MINUTES):
    """Given the set of minutes-of-day that HAVE stocks rows, return gap
    windows [(start_min, end_min_exclusive), ...] of >= min_gap consecutive
    empty session minutes. Full-session and >50%-empty days collapse to one
    full_session window (mode returned separately)."""
    session = list(range(SESSION_START_MIN, session_end_min))
    empty = [m for m in session if m not in minutes_with_rows]
    if not empty:
        return [], "windows"
    if len(empty) > len(session) * 0.5:
        return [(SESSION_START_MIN, session_end_min)], "full_session"
    windows = []
    run_start = None
    prev = None
    for m in empty:
        if run_start is None:
            run_start = m
        elif m != prev + 1:
            if prev - run_start + 1 >= min_gap:
                windows.append((run_start, prev + 1))
            run_start = m
        prev = m
    if run_start is not None and prev - run_start + 1 >= min_gap:
        windows.append((run_start, prev + 1))
    return windows, "windows"


def detect_windows(target: date):
    """Detect gap windows for a completed trading day from flow.db stocks rows."""
    mdy = _mdy(target)
    minutes = set()
    with _conn() as c:
        for row in c.execute(
                "SELECT CreatedTime FROM flow WHERE CreatedDate=? AND source='stocks'",
                (mdy,)):
            sec = _sec_of_day(row["CreatedTime"] or "")
            if sec is not None:
                minutes.add(sec // 60)
    return windows_from_minutes(minutes, _session_end_min(target))


# --- Flat-file row building (mirrors massive_flatfiles_worker._process_bytes) --

def _build_fill_rows(target: date):
    """Download + process the flat file for `target`; return
    {'stocks': [(sec_of_day, row_dict), ...], 'indexes': [...]} or None if the
    file isn't published yet. Reuses the exact live pipeline primitives so
    filled rows are format-identical to daily-ingest rows."""
    import io
    import gzip
    import pandas as pd
    from api.massive_flatfiles_worker import (
        _download, _load_oi_for_events, _load_ticker_metadata,
        MIN_PREMIUM, MIN_VOLUME,
    )
    from api.massive_processor import batch_process, event_to_bbs_row, is_index_source

    gz = _download(target)
    if gz is None:
        return None, {}

    # Persist the raw tape so the post-fill classification enrichment
    # (flow_heal_enrich side-patches step) can stream it without a second
    # S3 download. run_fill deletes it when done.
    tape_path = None
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        tape_path = os.path.join(BACKUP_DIR, f"tape-{target.isoformat()}.csv.gz")
        with open(tape_path, "wb") as f:
            f.write(gz)
    except OSError as e:
        logger.warning("[gap-fill] tape persist failed (enrich will re-download): %s", e)
        tape_path = None

    df = pd.read_csv(io.BytesIO(gzip.decompress(gz)))
    df = df.sort_values("sip_timestamp", kind="stable").reset_index(drop=True)
    events, agg_stats = batch_process(df, min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME)
    del df, gz

    stocks = [e for e in events if not is_index_source(e.root)]
    indexes = [e for e in events if is_index_source(e.root)]
    ticker_meta = _load_ticker_metadata(DB_PATH, list({e.root for e in events}))
    snap_iso = target.isoformat()
    oi_stocks = _load_oi_for_events(DB_PATH, stocks, snap_iso)
    oi_indexes = _load_oi_for_events(DB_PATH, indexes, snap_iso)

    out = {"stocks": [], "indexes": []}
    for evts, source, oi_map in ((stocks, "stocks", oi_stocks),
                                 (indexes, "indexes", oi_indexes)):
        for i, ev in enumerate(evts):
            meta = ticker_meta.get(ev.root, {})
            row = event_to_bbs_row(
                ev, source=source,
                mktcap=meta.get("mktcap", 0), sector=meta.get("sector", ""),
                oi=oi_map.get(i, 0))
            sec = _sec_of_day(row["CreatedTime"])
            if sec is not None:
                out[source].append((sec, row))
    stats = {"events_stocks": len(stocks), "events_indexes": len(indexes),
             "min_premium": MIN_PREMIUM, "min_volume": MIN_VOLUME,
             "agg": agg_stats, "tape_path": tape_path}
    return out, stats


# --- Backup -------------------------------------------------------------------

def _backup_db(run_id: int, target: date):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    path = os.path.join(BACKUP_DIR, f"flow-pre-{run_id}-{target.isoformat()}.db")
    src = sqlite3.connect(DB_PATH, timeout=30)
    try:
        dst = sqlite3.connect(path)
        try:
            src.backup(dst)   # single-pass consistent WAL snapshot
        finally:
            dst.close()
    finally:
        src.close()
    # prune: keep 3 newest, delete anything older than 14 days
    entries = sorted(
        (os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR)
         if f.startswith("flow-pre-")),
        key=os.path.getmtime, reverse=True)
    cutoff = time.time() - 14 * 86400
    for p in entries[3:]:
        if os.path.getmtime(p) < cutoff:
            try:
                os.remove(p)
            except OSError:
                pass
    return path


# --- Version bump + Discord -----------------------------------------------------

def _bump_version():
    """flow_router.bump_data_version via getattr (dangling-import playbook)."""
    try:
        from api import flow_router
        bump = getattr(flow_router, "bump_data_version", None)
        if callable(bump):
            return bump()
    except Exception as e:
        logger.warning("[gap-fill] version bump failed: %s", e)
    return None


def _current_version():
    try:
        from api import flow_router
        fn = getattr(flow_router, "_current_version", None)
        return fn() if callable(fn) else None
    except Exception:
        return None


def _post_discord(content: str):
    webhook = (os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
    if not webhook:
        return False
    try:
        import urllib.request
        data = json.dumps({"content": content[:1900]}).encode()
        req = urllib.request.Request(webhook, data=data,
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "uct-flow-gap-fill/1"})
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read(64)
        return True
    except Exception as e:
        logger.warning("[gap-fill] Discord post failed: %s", e)
        return False


# --- Core fill ------------------------------------------------------------------

def _flow_row_ids_in_window(c, mdy: str, lo_sec: int, hi_sec: int):
    """CreatedTime is TEXT 'H:MM:SS AM/PM' — not SQL-comparable. Resolve ids
    python-side (the worker-history pattern)."""
    ids = []
    for row in c.execute(
            "SELECT id, CreatedTime FROM flow WHERE CreatedDate=? "
            "AND source IN ('stocks','indexes')", (mdy,)):
        sec = _sec_of_day(row["CreatedTime"] or "")
        if sec is not None and lo_sec <= sec < hi_sec:
            ids.append(row["id"])
    return ids


def _fill_window(c, run_id: int, mdy: str, gap, fill_rows):
    """One window, ONE transaction: archive + delete + insert + manifest."""
    from api.flow_db import FlowDB, COLUMNS
    gap_start_min, gap_end_min = gap
    lo = gap_start_min * 60 - EDGE_MARGIN_SEC
    hi = gap_end_min * 60 + EDGE_MARGIN_SEC

    c.execute("BEGIN IMMEDIATE")
    try:
        cur = c.execute(
            "INSERT INTO flow_fill_windows (run_id, gap_start_min, gap_end_min, "
            "start_sec, end_sec, status) VALUES (?,?,?,?,?,'pending')",
            (run_id, gap_start_min, gap_end_min, lo, hi))
        window_id = cur.lastrowid

        victim_ids = _flow_row_ids_in_window(c, mdy, lo, hi)
        deleted = 0
        for i in range(0, len(victim_ids), 500):
            chunk = victim_ids[i:i + 500]
            ph = ",".join("?" * len(chunk))
            for vrow in c.execute(f"SELECT * FROM flow WHERE id IN ({ph})", chunk):
                d = dict(vrow)
                c.execute(
                    "INSERT INTO flow_fill_archive (run_id, window_id, orig_id, "
                    "source, row_json, dedup_key, orig_created_at) VALUES (?,?,?,?,?,?,?)",
                    (run_id, window_id, d["id"], d.get("source"),
                     json.dumps({k: d.get(k) for k in COLUMNS}),
                     d.get("dedup_key"), str(d.get("created_at"))))
            c.execute(f"DELETE FROM flow WHERE id IN ({ph})", chunk)
            deleted += len(chunk)

        inserted = skipped = 0
        for source in ("stocks", "indexes"):
            for sec, row in fill_rows.get(source, []):
                if not (lo <= sec < hi):
                    continue
                dedup = FlowDB._make_dedup_key(row, source)
                try:
                    cur = c.execute(
                        """INSERT INTO flow (
                            source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                            Price, Side, CallPut, Strike, Spot, Premium,
                            ExpirationDate, Color, ImpliedVolatility, Dte, ER,
                            StockEtf, Sector, Uoa, Weekly, MktCap, OI, dedup_key
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (source, *(str(row.get(col, "")) for col in COLUMNS), dedup))
                    c.execute(
                        "INSERT INTO flow_fill_inserted (run_id, window_id, flow_id) "
                        "VALUES (?,?,?)", (run_id, window_id, cur.lastrowid))
                    inserted += 1
                except sqlite3.IntegrityError:
                    skipped += 1

        c.execute(
            "UPDATE flow_fill_windows SET status='filled', deleted_count=?, "
            "inserted_count=?, skipped_dupe_count=? WHERE window_id=?",
            (deleted, inserted, skipped, window_id))
        c.execute("COMMIT")
        return deleted, inserted, skipped
    except Exception:
        c.execute("ROLLBACK")
        raise


def _post_fill_assertions(target: date):
    """Both must hold after a mutating run; violation pages, run still completes."""
    problems = []
    residual, _ = detect_windows(target)
    if residual:
        problems.append(f"residual gaps remain: {residual}")
    with _conn() as c:
        row = c.execute(
            "SELECT COUNT(*) AS n, COUNT(DISTINCT dedup_key) AS d FROM flow "
            "WHERE CreatedDate=?", (_mdy(target),)).fetchone()
        if row["n"] != row["d"]:
            problems.append(f"dedup violation: {row['n']} rows vs {row['d']} distinct keys")
    return problems


def run_fill(target: date = None, *, force: bool = False, dry_run: bool = None) -> dict:
    """Main entry. Detect gaps for `target` (default: latest completed trading
    day) and heal them from the flat file. Never raises."""
    if dry_run is None:
        dry_run = DRY_RUN
    if not _RUN_LOCK.acquire(blocking=False):
        return {"status": "already_running"}
    try:
        _init_schema()
        now_et = datetime.now(ET)
        if target is None:
            # Today only counts once its session is over; otherwise T-1.
            target = _latest_completed_trading_day(now_et)
        mdy = _mdy(target)

        with _conn() as c:
            # mark stale 'running' rows failed (crash / deploy-kill recovery)
            c.execute(
                "UPDATE flow_fill_runs SET status='failed', error='stale heartbeat' "
                "WHERE status='running' AND heartbeat_at < datetime('now', ?)",
                (f"-{STALE_RUN_MINUTES} minutes",))
            if not force:
                recent = c.execute(
                    "SELECT run_id FROM flow_fill_runs WHERE target_date=? AND "
                    "status IN ('completed','no_gaps') AND "
                    "started_at > datetime('now','-24 hours')", (mdy,)).fetchone()
                if recent:
                    return {"status": "skipped_recent", "target_date": mdy}
            cur = c.execute(
                "INSERT INTO flow_fill_runs (target_date, status, mode, started_at, "
                "heartbeat_at, min_premium, min_volume) "
                "VALUES (?, 'running', 'windows', datetime('now'), datetime('now'), 0, 0)",
                (mdy,))
            run_id = cur.lastrowid
            c.commit()

        result = {"status": None, "run_id": run_id, "target_date": mdy,
                  "windows": [], "dry_run": dry_run}
        tape_to_cleanup = None

        def _cleanup_tape():
            if tape_to_cleanup:
                try:
                    os.remove(tape_to_cleanup)
                except OSError:
                    pass
        try:
            windows, mode = detect_windows(target)
            with _conn() as c:
                c.execute("UPDATE flow_fill_runs SET mode=?, windows_found=?, "
                          "heartbeat_at=datetime('now') WHERE run_id=?",
                          (mode if windows else "windows", len(windows), run_id))
                c.commit()

            if not windows:
                _finish(run_id, "no_gaps")
                result["status"] = "no_gaps"
                return result
            result["windows"] = windows

            if dry_run:
                _finish(run_id, "completed", mode="dry_run")
                result["status"] = "dry_run"
                _post_discord(
                    f"\U0001F9EA FLOW GAP-FILL (dry run) {mdy}: {len(windows)} window(s) "
                    f"detected {windows} — no writes (FLOW_GAP_AUTOFILL_DRY_RUN=1)")
                return result

            version_before = _current_version()
            backup_path = None
            if not SKIP_BACKUP:
                try:
                    backup_path = _backup_db(run_id, target)
                except Exception as e:
                    _finish(run_id, "failed", error=f"backup failed: {e}")
                    _post_discord(f"\U0001F534 FLOW GAP-FILL {mdy}: backup failed "
                                  f"({e}) — run aborted, nothing written")
                    result["status"] = "failed"
                    return result

            fill_rows, ff_stats = _build_fill_rows(target)
            tape_to_cleanup = (ff_stats or {}).get("tape_path")
            if fill_rows is None:
                _finish(run_id, "no_file")
                result["status"] = "no_file"
                _post_discord(f"\U0001F7E1 FLOW GAP-FILL {mdy}: {len(windows)} gap "
                              f"window(s) but flat file not published yet — will retry")
                return result

            totals = {"deleted": 0, "inserted": 0, "skipped": 0}
            c = _conn()
            try:
                c.execute("UPDATE flow_fill_runs SET backup_path=?, min_premium=?, "
                          "min_volume=?, heartbeat_at=datetime('now') WHERE run_id=?",
                          (backup_path, ff_stats.get("min_premium"),
                           ff_stats.get("min_volume"), run_id))
                c.commit()
                for gap in windows:
                    d, i, s = _fill_window(c, run_id, mdy, gap, fill_rows)
                    totals["deleted"] += d
                    totals["inserted"] += i
                    totals["skipped"] += s
                    c.execute("UPDATE flow_fill_runs SET rows_deleted=?, rows_inserted=?, "
                              "rows_skipped_dupe=?, heartbeat_at=datetime('now') "
                              "WHERE run_id=?",
                              (totals["deleted"], totals["inserted"],
                               totals["skipped"], run_id))
                    c.commit()
            finally:
                c.close()

            problems = _post_fill_assertions(target)

            # Classification enrichment (OI → color → Side, then a parity
            # check) — rows-only heals look perfect to every row-count health
            # check while being invisible to side/V-OI gated tiers. Runs
            # BEFORE the version bump so clients pick up classified rows.
            enrich_result = None
            if totals["inserted"] > 0:
                with _conn() as c2:
                    c2.execute("UPDATE flow_fill_runs SET heartbeat_at=datetime('now') "
                               "WHERE run_id=?", (run_id,))
                    c2.commit()
                try:
                    from api import flow_heal_enrich
                    enrich_result = flow_heal_enrich.enrich_day(
                        target, gz_path=ff_stats.get("tape_path"))
                    result["enrich"] = enrich_result
                except Exception as e:
                    logger.exception("[gap-fill] enrichment failed (fill stands): %s", e)
                    result["enrich"] = {"status": "failed", "error": str(e)[:300]}

            version_after = _bump_version()
            _finish(run_id, "completed", version_before=version_before,
                    version_after=version_after)
            result.update(status="completed", **totals, problems=problems)

            wtxt = " · ".join(
                f"{s//60:02d}:{s%60:02d}→{e//60:02d}:{e%60:02d}" for s, e in windows)
            msg = (f"\U0001F527 FLOW GAP-FILL {mdy}: {len(windows)} window(s) [{wtxt}] — "
                   f"deleted {totals['deleted']} (archived), inserted {totals['inserted']}, "
                   f"dupes {totals['skipped']} · version {version_before}→{version_after} · "
                   f"backup {os.path.basename(backup_path) if backup_path else 'SKIPPED'}")
            if enrich_result is not None:
                try:
                    from api import flow_heal_enrich as _fhe
                    msg += "\n" + _fhe.summary_line(enrich_result)
                    if enrich_result.get("status") == "incomplete":
                        msg += ("\n\U0001F6A8 heal INCOMPLETE: backfilled rows diverge "
                                "from live classification baseline — day is partially "
                                "inert for curated tiers")
                except Exception:
                    pass
            if problems:
                msg += (f"\n\U0001F6A8 @here POST-FILL ASSERTION FAILED: {problems} — "
                        f"consider POST /api/flow-gap-fill/rollback/{run_id}")
            _post_discord(msg)
            return result
        except Exception as e:
            logger.exception("[gap-fill] run failed: %s", e)
            _finish(run_id, "failed", error=str(e)[:500])
            _post_discord(f"\U0001F534 FLOW GAP-FILL {mdy} failed: {str(e)[:300]} "
                          f"(per-window atomicity: nothing half-applied)")
            return {"status": "failed", "run_id": run_id, "error": str(e)[:300]}
        finally:
            _cleanup_tape()
    finally:
        _RUN_LOCK.release()


def _finish(run_id: int, status: str, *, error: str = None, mode: str = None,
            version_before=None, version_after=None):
    with _conn() as c:
        sets, vals = ["status=?", "finished_at=datetime('now')"], [status]
        if error is not None:
            sets.append("error=?")
            vals.append(error)
        if mode is not None:
            sets.append("mode=?")
            vals.append(mode)
        if version_before is not None:
            sets.append("version_before=?")
            vals.append(version_before)
        if version_after is not None:
            sets.append("version_after=?")
            vals.append(version_after)
        vals.append(run_id)
        c.execute(f"UPDATE flow_fill_runs SET {', '.join(sets)} WHERE run_id=?", vals)
        c.commit()


# --- Walkback sweep ----------------------------------------------------------

def run_fill_walkback(max_days: int = None, *, end_date: date = None,
                      dry_run: bool = None) -> dict:
    """Morning catch-up: walk back the last WALKBACK_TRADING_DAYS *trading*
    days and run the existing single-day fill on each.

    Rationale (audit finding B2): run_fill only ever heals ONE target day
    (T-1 or an explicit date). If a whole session is missed — worker down all
    day, or a scheduled fire that failed — nothing walked back to heal it. This
    sweeps the window that WALKBACK_TRADING_DAYS was always meant to cover.

    A thin loop over run_fill(target=...): the 24h manifest skip guard makes
    already-healed days cheap no-ops ('skipped_recent' / 'no_gaps'), and DRY_RUN
    is honored per day (dry-run just reports each day's windows, no writes).
    Checks EVERY day in the window — a *middle* day can hold a gap even when the
    newer days are clean, so we never stop early. Never raises.

    max_days overrides WALKBACK_TRADING_DAYS; end_date overrides the anchor
    (defaults to the latest completed trading day)."""
    if dry_run is None:
        dry_run = DRY_RUN
    n = WALKBACK_TRADING_DAYS if max_days is None else int(max_days)
    n = max(0, min(n, 30))          # sane ceiling; never a runaway backfill

    anchor = end_date or _latest_completed_trading_day(datetime.now(ET))
    if not _is_trading_day(anchor):
        anchor = _prev_trading_day(anchor)

    # anchor, then the (n-1) prior *trading* days (non-trading days skipped).
    days = []
    d = anchor
    for _ in range(n):
        days.append(d)
        d = _prev_trading_day(d)

    results, by_status, healed = [], {}, []
    for day in days:
        try:
            res = run_fill(target=day, dry_run=dry_run)
        except Exception as e:      # run_fill is meant to never raise; be safe
            logger.exception("[gap-fill] walkback day %s failed: %s", day, e)
            res = {"status": "error", "target_date": _mdy(day),
                   "error": str(e)[:300]}
        results.append(res)
        st = res.get("status")
        by_status[st] = by_status.get(st, 0) + 1
        if res.get("windows"):      # gap detected (dry-run reported OR filled)
            healed.append(res.get("target_date"))

    logger.info("[gap-fill] walkback swept %d trading day(s) (dry_run=%s): %s",
                len(days), dry_run, by_status)
    return {"status": "walkback_complete", "dry_run": dry_run,
            "days_checked": len(days),
            "days": [d.isoformat() for d in days],
            "by_status": by_status, "healed": healed, "results": results}


# --- Rollback --------------------------------------------------------------------

def rollback_run(run_id: int) -> dict:
    """Restore a fill: delete inserted rows, re-insert archived deleted rows."""
    _init_schema()
    with _conn() as c:
        run = c.execute("SELECT * FROM flow_fill_runs WHERE run_id=?", (run_id,)).fetchone()
        if run is None:
            return {"status": "not_found"}
        if run["status"] not in ("completed",):
            return {"status": "not_rollbackable", "run_status": run["status"]}
        age = c.execute(
            "SELECT started_at < datetime('now', ?) AS too_old FROM flow_fill_runs "
            "WHERE run_id=?", (f"-{ROLLBACK_MAX_AGE_DAYS} days", run_id)).fetchone()
        if age["too_old"]:
            return {"status": "too_old", "max_age_days": ROLLBACK_MAX_AGE_DAYS}

        from api.flow_db import COLUMNS
        removed = restored = 0
        c.execute("BEGIN IMMEDIATE")
        try:
            ids = [r["flow_id"] for r in c.execute(
                "SELECT flow_id FROM flow_fill_inserted WHERE run_id=?", (run_id,))]
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                ph = ",".join("?" * len(chunk))
                c.execute(f"DELETE FROM flow WHERE id IN ({ph})", chunk)
                removed += len(chunk)
            for arow in c.execute(
                    "SELECT * FROM flow_fill_archive WHERE run_id=?", (run_id,)):
                row = json.loads(arow["row_json"])
                try:
                    c.execute(
                        """INSERT INTO flow (
                            source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                            Price, Side, CallPut, Strike, Spot, Premium,
                            ExpirationDate, Color, ImpliedVolatility, Dte, ER,
                            StockEtf, Sector, Uoa, Weekly, MktCap, OI, dedup_key
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (arow["source"], *(str(row.get(col, "")) for col in COLUMNS),
                         arow["dedup_key"]))
                    restored += 1
                except sqlite3.IntegrityError:
                    pass  # already present (e.g. partial prior rollback)
            c.execute("UPDATE flow_fill_runs SET status='rolled_back', "
                      "finished_at=datetime('now') WHERE run_id=?", (run_id,))
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
    version = _bump_version()
    _post_discord(f"⏪ FLOW GAP-FILL ROLLBACK run {run_id}: removed {removed} "
                  f"filled rows, restored {restored} archived rows, version→{version}")
    return {"status": "rolled_back", "removed": removed, "restored": restored}


# --- Boot re-bump + archive prune --------------------------------------------------

def startup_check():
    """The version offset is process-local: any deploy resets it, and a
    pre-fill CSV can sit in Cloudflare's 24h stale-while-revalidate window.
    If any fill completed in the last 24h, bump once on boot."""
    try:
        _init_schema()
        with _conn() as c:
            recent = c.execute(
                "SELECT run_id FROM flow_fill_runs WHERE status IN "
                "('completed','rolled_back') AND rows_inserted + rows_deleted > 0 "
                "AND finished_at > datetime('now','-24 hours')").fetchone()
            c.execute("DELETE FROM flow_fill_archive WHERE archived_at < "
                      "datetime('now', ?)", (f"-{ARCHIVE_PRUNE_DAYS} days",))
            c.commit()
        if recent:
            v = _bump_version()
            logger.info("[gap-fill] boot re-bump after recent fill (version=%s)", v)
    except Exception as e:
        logger.warning("[gap-fill] startup_check failed (non-fatal): %s", e)


# --- Scheduler + router --------------------------------------------------------------

def register_jobs(scheduler) -> bool:
    if not ENABLED:
        logger.info("[gap-fill] disabled (FLOW_GAP_AUTOFILL_ENABLED != 1)")
        return False
    from apscheduler.triggers.cron import CronTrigger
    # 16:35 is the T-1 SAFETY RETRY: at that minute _latest_completed_trading_day
    # still resolves to YESTERDAY (today only counts from 16:45), so if the
    # morning 08:00/08:15 runs hit no_file (Massive's stated publish is ~11 AM
    # ET; often earlier in practice), yesterday's gaps — including a tail-of-day
    # death like 7/15's 2:47 PM→close — heal the same afternoon instead of
    # stranding until the NEXT morning's walkback. Post-close, so it honors the
    # never-during-market-hours rule; the 24h manifest guard makes it a no-op
    # when the morning run succeeded.
    for hh, mm in ((16, 35), (16, 45), (21, 0), (8, 0)):
        scheduler.add_job(
            run_fill, CronTrigger(day_of_week="mon-fri", hour=hh, minute=mm),
            id=f"flow_gap_autofill_{hh:02d}{mm:02d}",
            max_instances=1, replace_existing=True)
    # 4th job: the morning is the right place to sweep the whole window and
    # catch a fully-missed session the single-day T-1 jobs never healed
    # (worker down all session / a failed fire). Runs 15min after the 08:00
    # T-1 job so already-healed days are cheap manifest no-ops.
    scheduler.add_job(
        run_fill_walkback, CronTrigger(day_of_week="mon-fri", hour=8, minute=15),
        id="flow_gap_autofill_walkback",
        max_instances=1, replace_existing=True)
    logger.info("[gap-fill] scheduled 16:35 T-1 retry / 16:45 / 21:00 / 08:00 T-1 "
                "+ 08:15 walkback (%d trading days) ET Mon-Fri (dry_run=%s)",
                WALKBACK_TRADING_DAYS, DRY_RUN)
    return True


def _require_push_secret(authorization: str):
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/status")
def status():
    _init_schema()
    with _conn() as c:
        runs = [dict(r) for r in c.execute(
            "SELECT * FROM flow_fill_runs ORDER BY run_id DESC LIMIT 10")]
        for r in runs:
            r["windows"] = [dict(w) for w in c.execute(
                "SELECT * FROM flow_fill_windows WHERE run_id=?", (r["run_id"],))]
    last_enrich = None
    try:
        from api import flow_heal_enrich
        last_enrich = flow_heal_enrich.last_result()
    except Exception:
        pass
    return JSONResponse({"enabled": ENABLED, "dry_run": DRY_RUN,
                         "min_gap_minutes": MIN_GAP_MINUTES,
                         "last_enrich": last_enrich, "runs": runs})


@router.post("/run")
def trigger_run(target_date: str = None, force: bool = False, dry_run: bool = None,
                authorization: str = Header(default="")):
    """Manual trigger. NEVER inline — spawns a daemon thread and returns.
    target_date: 'YYYY-MM-DD' (default: latest completed trading day)."""
    _require_push_secret(authorization)
    target = None
    if target_date:
        try:
            target = date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="target_date must be YYYY-MM-DD")
    threading.Thread(
        target=run_fill, kwargs={"target": target, "force": force, "dry_run": dry_run},
        daemon=True, name="flow-gap-fill-manual").start()
    return JSONResponse({"status": "started", "check": "/api/flow-gap-fill/status"})


@router.post("/enrich")
def trigger_enrich(target_date: str, authorization: str = Header(default="")):
    """Manually run classification enrichment (OI → color → Side → parity)
    for an already-healed date — e.g. re-heal 7/14 whose rows landed
    unclassified. NEVER inline — daemon thread; result lands in
    /status.last_enrich and Discord. target_date: 'YYYY-MM-DD'."""
    _require_push_secret(authorization)
    try:
        target = date.fromisoformat(target_date)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="target_date must be YYYY-MM-DD")

    def _do():
        try:
            from api import flow_heal_enrich
            res = flow_heal_enrich.enrich_day(target, force=True)
            _bump_version()
            _post_discord(flow_heal_enrich.summary_line(res))
        except Exception as e:
            logger.exception("[gap-fill] manual enrich failed: %s", e)
            _post_discord(f"\U0001F534 ENRICH {target_date} failed: {str(e)[:200]}")

    threading.Thread(target=_do, daemon=True, name="flow-heal-enrich-manual").start()
    return JSONResponse({"status": "started",
                         "check": "/api/flow-gap-fill/status (last_enrich)"})


@router.post("/rollback/{run_id}")
def trigger_rollback(run_id: int, authorization: str = Header(default="")):
    _require_push_secret(authorization)
    out = {}

    def _do():
        out.update(rollback_run(run_id))
    t = threading.Thread(target=_do, daemon=True, name="flow-gap-fill-rollback")
    t.start()
    t.join(timeout=60)  # rollbacks are small; give a synchronous answer when quick
    if t.is_alive():
        return JSONResponse({"status": "running", "check": "/api/flow-gap-fill/status"})
    return JSONResponse(out)
