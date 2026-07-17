"""
massive_flatfiles_worker.py -- Daily Massive Flat Files ingester.

Pulls the daily OPRA options trades CSV from Massive's S3-compatible
bucket (T+1, published ~11 AM ET), runs it through the validated
massive_processor aggregator, and writes events to FlowDB. OptionsFlow.jsx
picks them up via the same /api/flow/data path it always used.

Architecture:
- APScheduler cron at 11:30 AM ET, 12:00 PM, 12:30 PM (three retries -- Massive
  sometimes publishes late). Each run checks if yesterday is already ingested
  and no-ops if so, so multi-fire is safe.
- Single function process_date(date) is the unit of work. Reusable from cron,
  from an admin endpoint for backfill, or from a one-off script.
- Idempotent end-to-end: FlowDB's dedup_key UNIQUE constraint silently skips
  duplicate rows, so re-running the same date is harmless (just wastes CPU).
- No WebSocket dependency. Uses MASSIVE_S3_* keys, which are separate from
  the API key and have no per-account connection limit.

Why this exists alongside the WebSocket worker:
- WS gives real-time but is rate-limited and account-locked-out-able
- Flat Files give T+1 but are bulletproof reliable and historical-backfill-able
- They write to the same FlowDB table; dedup handles overlap; the page
  shows both seamlessly

V1 notes (matches the WS worker):
- Side classification stubbed (Quotes file integration is V2)
- Spot/IV/OI/MktCap/Sector/ER stubbed (wired to existing helpers in V2)
- Filters: $10K min premium, 50 contracts min volume (env-tunable)
"""

import os
import io
import gzip
import time
import logging
import threading
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")


# -- Configuration --------------------------------------------------

S3_ENDPOINT = os.environ.get("MASSIVE_S3_ENDPOINT", "https://files.massive.com").strip()
S3_BUCKET = os.environ.get("MASSIVE_S3_BUCKET", "flatfiles").strip()
S3_ACCESS_KEY = os.environ.get("MASSIVE_S3_ACCESS_KEY", "").strip()
S3_SECRET = os.environ.get("MASSIVE_S3_SECRET", "").strip()

# S3 key template. Per Massive docs:
# us_options_opra/trades_v1/YYYY/MM/YYYY-MM-DD.csv.gz
S3_KEY_TEMPLATE = "us_options_opra/trades_v1/{yyyy}/{mm}/{yyyy}-{mm}-{dd}.csv.gz"

# Master kill switch and dry-run
ENABLED = os.environ.get("MASSIVE_FLATFILES_ENABLED", "1").lower() in ("1", "true", "yes")
DRY_RUN = os.environ.get("MASSIVE_FLATFILES_DRY_RUN", "0").lower() in ("1", "true", "yes")

# Filters -- match the WS worker for consistency
MIN_PREMIUM = float(os.environ.get("MASSIVE_MIN_PREMIUM", "10000"))
MIN_VOLUME = int(os.environ.get("MASSIVE_MIN_VOLUME", "50"))

# How many trading days back to attempt if today's target isn't there yet
# (covers a long holiday weekend e.g. Thanksgiving)
LOOKBACK_DAYS = int(os.environ.get("MASSIVE_FLATFILES_LOOKBACK", "5"))


# -- Module state (read via get_status) -----------------------------

_state = {
    "last_run_at": None,
    "last_run_date": None,
    "last_run_status": None,    # "ok" | "skipped" | "error" | "no_file"
    "last_run_message": None,
    "last_run_inserted_stocks": 0,
    "last_run_inserted_indexes": 0,
    "last_run_skipped_dupes": 0,
    "last_run_duration_sec": None,
    "runs_total": 0,
    "runs_ok": 0,
    "runs_error": 0,
}
_state_lock = threading.Lock()


def get_status() -> dict:
    with _state_lock:
        s = dict(_state)
    s["enabled"] = ENABLED
    s["dry_run"] = DRY_RUN
    s["min_premium"] = MIN_PREMIUM
    s["min_volume"] = MIN_VOLUME
    s["s3_endpoint"] = S3_ENDPOINT
    s["s3_bucket"] = S3_BUCKET
    s["credentials_set"] = bool(S3_ACCESS_KEY and S3_SECRET)
    return s


# -- Core -----------------------------------------------------------

def _build_s3_key(d: date) -> str:
    return S3_KEY_TEMPLATE.format(
        yyyy=f"{d.year:04d}", mm=f"{d.month:02d}", dd=f"{d.day:02d}"
    )


def _load_oi_for_events(db_path: str, events: list, snap_date_iso: str) -> dict:
    """
    Look up OI for each event from contract_oi_snapshots for the given
    snap_date. Used by the Flat Files worker (which processes a specific
    historical day, not "today").

    Returns: {event_index: oi} for events where we found a snapshot.
    Events without a snapshot get OI=0 downstream (color stays WHITE).
    """
    if not events:
        return {}
    import sqlite3

    # Build (contract_key, event_idx) tuples. Contract key format must
    # match oi_snapshots.make_key exactly: "SYM|C|150.0|M/D/YYYY"
    keys_and_idx = []
    for i, e in enumerate(events):
        cp_letter = 'C' if e.cp == 'CALL' else 'P'
        exp_str = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
        key = f"{e.root}|{cp_letter}|{float(e.strike)}|{exp_str}"
        keys_and_idx.append((key, i))

    if not keys_and_idx:
        return {}

    keys = [k for k, _ in keys_and_idx]
    idx_by_key = {k: i for k, i in keys_and_idx}
    placeholders = ",".join("?" for _ in keys)

    out = {}
    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            try:
                from api.oi_snapshots import attach_oi_snapshots
                attach_oi_snapshots(conn)
            except Exception:
                pass
            sql = f"""
                SELECT contract_key, oi
                FROM contract_oi_snapshots
                WHERE snap_date = ?
                  AND contract_key IN ({placeholders})
            """
            for key, oi in conn.execute(sql, (snap_date_iso, *keys)):
                idx = idx_by_key.get(key)
                if idx is not None and oi is not None and oi > 0:
                    out[idx] = int(oi)
    except Exception as e:
        logger.warning("[massive-ff] OI batch lookup failed: %s", e)

    return out


def _bbs_date_str(d: date) -> str:
    """Match BBS CSV date format: 'M/D/YYYY' (no zero-pad)."""
    return f"{d.month}/{d.day}/{d.year}"


def _load_ticker_metadata(db_path: str, symbols: list) -> dict:
    """
    Look up MktCap + Sector for each symbol from the most recent non-blank
    FlowDB row that has those values. Same pattern as the WS worker -- any
    ticker that's been in FlowDB before has its metadata cached and we can
    read it for free without hitting Schwab.

    Returns: {"AAPL": {"mktcap": 3100000000000, "sector": "Technology"}, ...}
    Symbols never seen before are simply omitted.
    """
    if not symbols:
        return {}
    import sqlite3
    clean = sorted({s.strip().upper() for s in symbols if s and s.strip()})
    if not clean:
        return {}

    out: dict = {}
    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            placeholders = ",".join("?" for _ in clean)
            mc_sql = f"""
                SELECT f.Symbol, f.MktCap
                FROM flow f
                INNER JOIN (
                    SELECT Symbol, MAX(id) AS max_id
                    FROM flow
                    WHERE Symbol IN ({placeholders})
                      AND MktCap IS NOT NULL AND MktCap != '' AND MktCap != '0'
                    GROUP BY Symbol
                ) latest ON f.id = latest.max_id
            """
            for sym, mc_raw in conn.execute(mc_sql, clean):
                if not sym:
                    continue
                sym = sym.strip().upper()
                try:
                    mc = int(float((mc_raw or "0").strip()))
                except (ValueError, TypeError):
                    mc = 0
                if mc > 0:
                    out.setdefault(sym, {})["mktcap"] = mc

            sec_sql = f"""
                SELECT f.Symbol, f.Sector
                FROM flow f
                INNER JOIN (
                    SELECT Symbol, MAX(id) AS max_id
                    FROM flow
                    WHERE Symbol IN ({placeholders})
                      AND Sector IS NOT NULL AND Sector != ''
                    GROUP BY Symbol
                ) latest ON f.id = latest.max_id
            """
            for sym, sec_raw in conn.execute(sec_sql, clean):
                if not sym:
                    continue
                sym = sym.strip().upper()
                sec = (sec_raw or "").strip()
                if sec:
                    out.setdefault(sym, {})["sector"] = sec
    except Exception as e:
        logger.warning("[massive-ff] _load_ticker_metadata failed: %s", e)

    return out


def _already_ingested(d: date) -> bool:
    """Check FlowDB to see if this date already has rows. Idempotency guard."""
    try:
        import sqlite3
        from api.flow_db import FlowDB
        # Use the same DB path the FlowDB class would
        db = FlowDB()
        bbs_date = _bbs_date_str(d)
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            cur = conn.execute(
                "SELECT COUNT(*) FROM flow WHERE CreatedDate = ? LIMIT 1",
                (bbs_date,),
            )
            count = cur.fetchone()[0]
        return count > 0
    except Exception as e:
        logger.warning("[massive-ff] idempotency check failed (%s) -- proceeding", e)
        return False


def _download(d: date) -> Optional[bytes]:
    """Download the .csv.gz for date d. Returns None if the file doesn't exist
    (which is normal for weekends, holidays, or before Massive publishes)."""
    import boto3
    from botocore.exceptions import ClientError
    from botocore.config import Config

    if not S3_ACCESS_KEY or not S3_SECRET:
        raise RuntimeError("MASSIVE_S3_ACCESS_KEY / MASSIVE_S3_SECRET not set")

    key = _build_s3_key(d)
    logger.info("[massive-ff] downloading s3://%s/%s", S3_BUCKET, key)

    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET,
        config=Config(retries={"max_attempts": 3, "mode": "standard"}),
    )
    try:
        resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
        body = resp["Body"].read()
        size_mb = len(body) / 1e6
        logger.info("[massive-ff] downloaded %.1f MB compressed", size_mb)
        return body
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404"):
            logger.info("[massive-ff] no file at %s (not yet published?)", key)
            return None
        if code in ("403", "AccessDenied", "Forbidden"):
            # Massive returns 403 (not 404) for not-yet-published dates — the
            # evening gap-fill runs hit this every day and used to surface as
            # a red "failed" instead of a calm "no_file". A GENUINE credential
            # problem also lands here; the warning keeps it diagnosable.
            logger.warning(
                "[massive-ff] 403 at %s — treating as not-yet-published "
                "(if this persists past T+1 midday, check MASSIVE_S3_* creds)",
                key)
            return None
        raise


def _process_bytes(gz_bytes: bytes, source_date: date) -> dict:
    """Decompress, parse, aggregate, and write to FlowDB.
    Returns stats dict."""
    import pandas as pd
    # Lazy-import to keep module-import cost low
    from api.massive_processor import (
        batch_process, event_to_bbs_row, is_index_source,
    )
    from api.flow_db import FlowDB, COLUMNS

    # Decompress + parse CSV
    logger.info("[massive-ff] decompressing + parsing...")
    t0 = time.time()
    csv_bytes = gzip.decompress(gz_bytes)
    df = pd.read_csv(io.BytesIO(csv_bytes))
    logger.info(
        "[massive-ff] loaded %d rows in %.1fs", len(df), time.time() - t0
    )

    # Sort by sip_timestamp (flat file is contract-grouped, not time-sorted)
    logger.info("[massive-ff] sorting by timestamp...")
    df = df.sort_values("sip_timestamp", kind="stable").reset_index(drop=True)

    # Aggregate
    logger.info(
        "[massive-ff] aggregating (min_premium=$%.0f, min_volume=%d)...",
        MIN_PREMIUM, MIN_VOLUME,
    )
    t0 = time.time()
    events, agg_stats = batch_process(
        df, min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME
    )
    logger.info(
        "[massive-ff] aggregated %d events in %.1fs (stats: %s)",
        len(events), time.time() - t0, agg_stats,
    )
    # Free memory before the next big alloc
    del df, csv_bytes, gz_bytes

    # Split stocks / indexes
    stocks_events = [e for e in events if not is_index_source(e.root)]
    indexes_events = [e for e in events if is_index_source(e.root)]
    logger.info(
        "[massive-ff] %d stocks events + %d indexes events",
        len(stocks_events), len(indexes_events),
    )

    if DRY_RUN:
        logger.info("[massive-ff] DRY_RUN: skipping FlowDB writes")
        return {
            "events_stocks": len(stocks_events),
            "events_indexes": len(indexes_events),
            "inserted_stocks": 0,
            "inserted_indexes": 0,
            "skipped_dupes": 0,
            "dry_run": True,
        }

    # Build BBS-format CSVs and write to FlowDB
    db = FlowDB()
    header = ",".join(COLUMNS) + "\n"

    # Enrich with MktCap + Sector from FlowDB (free, instant cache). Same
    # pattern as the WS worker -- see massive_ws_worker._load_ticker_metadata.
    all_syms = list({e.root for e in events})
    ticker_meta = _load_ticker_metadata(db.db_path, all_syms)
    if ticker_meta:
        logger.info(
            "[massive-ff] enriched %d/%d tickers with FlowDB metadata",
            len(ticker_meta), len(all_syms),
        )

    # OI enrichment from contract_oi_snapshots. Unlike the WS worker we use
    # the file's source_date (the trade day) as snap_date, not today's date.
    # Cron at 5:30 AM ET on day T+1 captures EOD-T OI as snap_date=T+1, so
    # for trades on day T, the relevant snapshot is the one taken the morning
    # AFTER -- snap_date = source_date + 1. But for backfill of historical
    # files, we look up snap_date = source_date (since snapshots taken on a
    # given day capture flow that DAY's starting OI, mapped to that ISO date).
    # Per oi_snapshots.daily_snapshot_job: snap_date is today's ISO date.
    # So for a trade on day T, we want the snapshot from day T -- that's the
    # OI at the start of day T's session.
    snap_date_iso = source_date.isoformat()
    oi_stocks = _load_oi_for_events(db.db_path, stocks_events, snap_date_iso)
    oi_indexes = _load_oi_for_events(db.db_path, indexes_events, snap_date_iso)
    logger.info(
        "[massive-ff] OI snapshots resolved: %d/%d stocks, %d/%d indexes",
        len(oi_stocks), len(stocks_events),
        len(oi_indexes), len(indexes_events),
    )

    # ER copy-forward (review A2): full-day ingests used to hardcode ER='F',
    # poisoning newest-row ER readers. Bounded, cohort-aware lookup.
    try:
        from api.massive_ws_worker import _load_er_flags
        er_map = _load_er_flags(all_syms)
    except Exception as e:
        logger.warning("[massive-ff] ER copy-forward unavailable (%s)", e)
        er_map = {}

    def _to_csv(evts, source, oi_map):
        buf = io.StringIO()
        buf.write(header)
        for i, ev in enumerate(evts):
            meta = ticker_meta.get(ev.root, {})
            row = event_to_bbs_row(
                ev, source=source,
                mktcap=meta.get("mktcap", 0),
                sector=meta.get("sector", ""),
                oi=oi_map.get(i, 0),
                er_flag=er_map.get(ev.root, 'F'),
            )
            buf.write(",".join(str(row.get(c, "")) for c in COLUMNS) + "\n")
        return buf.getvalue()

    inserted_stocks = 0
    inserted_indexes = 0
    skipped = 0

    if stocks_events:
        csv_str = _to_csv(stocks_events, "stocks", oi_stocks)
        result = db.insert_csv(csv_str, source="stocks")
        inserted_stocks = result.get("inserted", 0)
        skipped += result.get("skipped", 0)
        logger.info(
            "[massive-ff] stocks: %d inserted, %d skipped (dupes)",
            inserted_stocks, result.get("skipped", 0),
        )

    if indexes_events:
        csv_str = _to_csv(indexes_events, "indexes", oi_indexes)
        result = db.insert_csv(csv_str, source="indexes")
        inserted_indexes = result.get("inserted", 0)
        skipped += result.get("skipped", 0)
        logger.info(
            "[massive-ff] indexes: %d inserted, %d skipped (dupes)",
            inserted_indexes, result.get("skipped", 0),
        )

    return {
        "events_stocks": len(stocks_events),
        "events_indexes": len(indexes_events),
        "inserted_stocks": inserted_stocks,
        "inserted_indexes": inserted_indexes,
        "skipped_dupes": skipped,
        "dry_run": False,
    }


def process_date(target_date: date, *, force: bool = False) -> dict:
    """
    Process the Massive Flat File for a specific date.

    Returns a result dict. Always returns -- never raises (errors get
    captured in the returned dict and logged).

    force=True: ingest even if FlowDB already has rows for this date.
    Useful for re-runs after a partial failure.
    """
    t0 = time.time()
    date_str = target_date.isoformat()
    result = {
        "date": date_str,
        "status": None,
        "message": None,
        "inserted_stocks": 0,
        "inserted_indexes": 0,
        "skipped_dupes": 0,
        "duration_sec": None,
    }

    try:
        if not force and _already_ingested(target_date):
            msg = f"already ingested ({date_str}) -- skipping"
            logger.info("[massive-ff] %s", msg)
            result["status"] = "skipped"
            result["message"] = msg
        else:
            gz_bytes = _download(target_date)
            if gz_bytes is None:
                msg = f"no file for {date_str} (not yet published or non-trading day)"
                result["status"] = "no_file"
                result["message"] = msg
            else:
                stats = _process_bytes(gz_bytes, target_date)
                result["status"] = "ok"
                result["message"] = (
                    f"ingested {date_str}: "
                    f"{stats['inserted_stocks']} stocks + "
                    f"{stats['inserted_indexes']} indexes "
                    f"({stats['skipped_dupes']} dupes skipped)"
                )
                result["inserted_stocks"] = stats["inserted_stocks"]
                result["inserted_indexes"] = stats["inserted_indexes"]
                result["skipped_dupes"] = stats["skipped_dupes"]
                logger.info("[massive-ff] %s", result["message"])
                # Full-day ingests land with the same classification gaps as
                # gap-fill windows (side='', OI only from snapshots) — run the
                # enrichment pipeline so the day isn't inert for curated tiers.
                if (stats["inserted_stocks"] + stats["inserted_indexes"]) > 0:
                    try:
                        from api import flow_heal_enrich
                        result["enrich"] = flow_heal_enrich.enrich_day(target_date)
                    except Exception as e:
                        logger.exception("[massive-ff] enrichment failed (ingest stands)")
                        result["enrich"] = {"status": "failed", "error": str(e)[:300]}
    except Exception as e:
        logger.exception("[massive-ff] process_date(%s) failed: %s", date_str, e)
        result["status"] = "error"
        result["message"] = str(e)

    result["duration_sec"] = round(time.time() - t0, 1)

    # Update module state
    with _state_lock:
        _state["last_run_at"] = time.time()
        _state["last_run_date"] = date_str
        _state["last_run_status"] = result["status"]
        _state["last_run_message"] = result["message"]
        _state["last_run_inserted_stocks"] = result["inserted_stocks"]
        _state["last_run_inserted_indexes"] = result["inserted_indexes"]
        _state["last_run_skipped_dupes"] = result["skipped_dupes"]
        _state["last_run_duration_sec"] = result["duration_sec"]
        _state["runs_total"] += 1
        if result["status"] == "ok":
            _state["runs_ok"] += 1
        elif result["status"] == "error":
            _state["runs_error"] += 1

    return result


def daily_job() -> dict:
    """
    APScheduler entry point.

    Walks backwards from yesterday's ET date, processing the first
    not-yet-ingested date with a published file. Stops after one
    successful ingest or after LOOKBACK_DAYS attempts.

    Multiple cron runs per day are safe: the second run will find the
    first run's data and skip via _already_ingested.
    """
    if not ENABLED:
        return {"status": "disabled", "message": "MASSIVE_FLATFILES_ENABLED=0"}

    today_et = datetime.now(ET).date()
    last_result = None
    for back in range(1, LOOKBACK_DAYS + 1):
        target = today_et - timedelta(days=back)
        # Skip Sat/Sun without burning an S3 call -- Massive doesn't publish
        # for non-trading days anyway
        if target.weekday() >= 5:
            continue
        result = process_date(target)
        last_result = result
        if result["status"] == "ok":
            return result
        if result["status"] == "skipped":
            # Already have this date -- try the day before it in case we have
            # a gap further back. Continue walking.
            continue
        if result["status"] == "no_file":
            # Day not yet published or genuine non-trading day. Keep walking.
            continue
        if result["status"] == "error":
            # Stop on error; let the next cron retry
            return result

    return last_result or {
        "status": "nothing_to_do",
        "message": f"walked back {LOOKBACK_DAYS} days, all already ingested or non-trading",
    }


def backfill_range(start_date: date, end_date: date, *, force: bool = False) -> dict:
    """
    Ingest every trading day in [start_date, end_date] inclusive.

    Use for initial baselines population or filling gaps. Skips weekends.
    Runs synchronously -- call from a background thread if needed.

    Returns a summary dict with per-date results.
    """
    if start_date > end_date:
        return {"error": "start_date must be <= end_date"}

    results = []
    d = start_date
    while d <= end_date:
        if d.weekday() < 5:  # Mon-Fri only
            results.append(process_date(d, force=force))
        d += timedelta(days=1)

    summary = {
        "dates_attempted": len(results),
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "no_file": sum(1 for r in results if r["status"] == "no_file"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "total_inserted_stocks": sum(r["inserted_stocks"] for r in results),
        "total_inserted_indexes": sum(r["inserted_indexes"] for r in results),
        "results": results,
    }
    return summary


# -- APScheduler registration ---------------------------------------

def register_jobs(scheduler) -> bool:
    """
    Register the daily ingestion cron with the given scheduler.

    Call from inside the if acquire_scheduler_lock(): block in main.py,
    AFTER scheduler is created but BEFORE scheduler.start().

    Three runs per day (11:30 / 12:00 / 12:30 PM ET) -- Massive's stated
    publish time is "approximately 11:00 AM ET" but can be late.
    Idempotency means redundant runs are harmless no-ops.
    """
    if not ENABLED:
        logger.info("[massive-ff] disabled -- not registering scheduler jobs")
        return False
    if not (S3_ACCESS_KEY and S3_SECRET):
        logger.warning(
            "[massive-ff] MASSIVE_S3_ACCESS_KEY/SECRET not set -- "
            "not registering scheduler jobs"
        )
        return False

    from apscheduler.triggers.cron import CronTrigger

    def _wrapped():
        try:
            daily_job()
        except Exception as e:
            logger.exception("[massive-ff] scheduled run crashed: %s", e)

    # Three retries -- each is a no-op if previous already succeeded.
    # timezone is EXPLICIT (2026-07-16): the flow-worker scheduler runs UTC,
    # so without it these "ET" times fired at 7:30/8:00/8:30 AM ET.
    for hh, mm in [(11, 30), (12, 0), (12, 30)]:
        scheduler.add_job(
            _wrapped,
            trigger=CronTrigger(
                day_of_week="mon-fri", hour=hh, minute=mm, timezone=ET,
            ),
            id=f"massive_flatfiles_daily_{hh:02d}{mm:02d}",
            max_instances=1,
            replace_existing=True,
        )

    logger.info(
        "[massive-ff] scheduler jobs registered: 11:30, 12:00, 12:30 PM ET "
        "Mon-Fri (idempotent retries)"
    )
    return True
