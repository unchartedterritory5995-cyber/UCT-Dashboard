"""
oi_snapshots.py — Daily OI snapshot collection + retroactive direction confirmation.

The premise: B-side trades are ambiguous on the day they happen (could be opens,
closes, or hedges). But OI growth measured the NEXT trading day proves whether
those trades were real institutional positioning. We capture daily OI snapshots
so the dashboard can retroactively confirm yesterday's B-side flow as
directional once OI confirms it.

Architecture:
    contract_oi_snapshots table holds (contract, date, oi) tuples.
    oi_snapshot_runs table tracks job runs across multiple uvicorn workers.
    Daily 5:30 AM ET cron fetches OI for every contract that had flow in past 30d.
    Confirmation logic compares trade_day_oi → next_day_oi against volume on the
    trade day. If oi_growth / volume >= 50%, the B-side cluster is confirmed.

Schwab integration:
    Calls api.schwab_router.options_quotes_batch() in-process — same code path
    the frontend uses for "Fetch Live OI", which includes UW fallback. No HTTP
    loopback, no port/auth complexity. The router's batch endpoint groups
    contracts by symbol and uses one chain call per symbol, so several thousand
    contracts resolves to a few hundred Schwab API calls.

Integration in main.py:
    from api.oi_snapshots import init_db, daily_snapshot_job
    # in scheduler block:
    init_db()  # on startup, idempotent
    _scheduler.add_job(
        daily_snapshot_job,
        CronTrigger(hour=5, minute=30, day_of_week="mon-fri"),
        id="oi_snapshot_daily",
    )

Confirmation threshold:
    oi_growth_pct = (oi_t+1 - oi_t) / volume_on_t
    >= 0.50  →  cluster is confirmed positioning
    <  0.50  →  cluster stays ambiguous (likely churn / MM hedging)

Schema notes — matches the existing `flow` table in flow.db (managed by
flow_db.FlowDB). The `flow` table uses BBS-native column names with capitalized
camelcase (Symbol, CallPut, Strike, ExpirationDate, CreatedDate) and stores
dates as `M/D/YYYY` strings. We work in that format internally and only
convert to ISO at the API boundary (snapshot table key).
"""

import sqlite3
import os
import logging
import asyncio
from datetime import date, datetime, timedelta
from typing import List, Optional, Iterable, Tuple, Dict
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# How many days back to consider when computing "active contracts"
DAYS_BACK_TO_SNAPSHOT = 30

# How long to keep snapshots before pruning
DAYS_TO_KEEP_SNAPSHOTS = 90

# Confirmation threshold: oi_growth / volume must be at least this to confirm
CONFIRMATION_THRESHOLD = 0.50

# Source restriction — only snapshot 'stocks' flow. Indexes are SPX/SPY/QQQ etc.,
# OI behaves differently there (settlement, ETF mechanics) and Ravi's flow
# framework targets single-name stocks.
SOURCE = "stocks"


# ── Schema ───────────────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS contract_oi_snapshots (
    contract_key TEXT NOT NULL,
    snap_date    TEXT NOT NULL,
    oi           INTEGER NOT NULL,
    source       TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contract_key, snap_date)
);
CREATE INDEX IF NOT EXISTS idx_oi_snap_date ON contract_oi_snapshots(snap_date);
CREATE INDEX IF NOT EXISTS idx_oi_snap_contract ON contract_oi_snapshots(contract_key);

CREATE TABLE IF NOT EXISTS oi_snapshot_runs (
    run_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TIMESTAMP NOT NULL,
    finished_at  TIMESTAMP,
    status       TEXT NOT NULL,  -- 'running' | 'completed' | 'failed'
    summary_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_oi_run_started ON oi_snapshot_runs(started_at);
"""


# ── Run-state tracking (persisted, multi-worker safe) ────────────────────
def start_run() -> int:
    """Mark a run as started. Returns run_id."""
    import datetime as _dt
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO oi_snapshot_runs (started_at, status) VALUES (?, ?)",
            (_dt.datetime.utcnow().isoformat() + "Z", "running"),
        )
        return cur.lastrowid


def finish_run(run_id: int, status: str, summary: Optional[Dict] = None):
    """Mark a run as completed/failed."""
    import datetime as _dt
    import json
    with _conn() as c:
        c.execute(
            "UPDATE oi_snapshot_runs SET finished_at=?, status=?, summary_json=? WHERE run_id=?",
            (
                _dt.datetime.utcnow().isoformat() + "Z",
                status,
                json.dumps(summary) if summary else None,
                run_id,
            ),
        )


def is_run_active() -> Optional[Dict]:
    """Return info about an active (running) run, or None if no run is active.
    Used to prevent concurrent kicks across multiple workers."""
    with _conn() as c:
        cur = c.execute(
            "SELECT run_id, started_at FROM oi_snapshot_runs "
            "WHERE status='running' ORDER BY run_id DESC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"run_id": row[0], "started_at": row[1]}


def get_last_run() -> Optional[Dict]:
    """Return the most recent run (running or completed)."""
    import json
    with _conn() as c:
        cur = c.execute(
            "SELECT run_id, started_at, finished_at, status, summary_json "
            "FROM oi_snapshot_runs ORDER BY run_id DESC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "run_id": row[0],
            "started_at": row[1],
            "finished_at": row[2],
            "status": row[3],
            "summary": json.loads(row[4]) if row[4] else None,
        }


def cancel_active_runs() -> int:
    """Force-mark any 'running' runs as 'failed'. Use to unstick orphan runs
    after a Railway restart killed an in-flight job. Returns count cancelled."""
    import datetime as _dt
    import json
    with _conn() as c:
        cur = c.execute(
            "UPDATE oi_snapshot_runs SET status='failed', finished_at=?, summary_json=? "
            "WHERE status='running'",
            (
                _dt.datetime.utcnow().isoformat() + "Z",
                json.dumps({"cancelled": True, "reason": "manual cancel"}),
            ),
        )
        return cur.rowcount


@contextmanager
def _conn():
    """SQLite connection with sensible defaults — same pattern as flow_db.FlowDB."""
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def init_db():
    """Create the snapshot table. Idempotent — safe to call on every startup."""
    with _conn() as c:
        c.executescript(SCHEMA)
    logger.info("[oi-snapshot] DB initialized")


# ── Date helpers (BBS format: M/D/YYYY) ──────────────────────────────────
def _parse_mdy(s: str) -> Optional[date]:
    """Parse BBS-format 'M/D/YYYY' to a date object."""
    try:
        parts = s.strip().split("/")
        if len(parts) != 3:
            return None
        m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000
        return date(y, m, d)
    except (ValueError, IndexError):
        return None


def _to_mdy(d: date) -> str:
    """date → 'M/D/YYYY' (no leading zeros, matching BBS format)."""
    return f"{d.month}/{d.day}/{d.year}"


def _to_iso(d: date) -> str:
    return d.isoformat()


# ── Key construction ─────────────────────────────────────────────────────
def make_key(sym: str, cp: str, strike, exp: str) -> str:
    """Build a contract key. Strike normalized to float to avoid '100' vs '100.0'.

    cp is normalized to single letter ('C' / 'P') for stable keys regardless of
    whether caller passes 'CALL' or 'C'.
    exp stays in original M/D/YYYY format (matches flow table).
    """
    cp_norm = "C" if cp.upper() in ("C", "CALL") else "P"
    return f"{sym}|{cp_norm}|{float(strike)}|{exp}"


def parse_key(key: str) -> Tuple[str, str, float, str]:
    sym, cp, strike, exp = key.split("|", 3)
    return sym, cp, float(strike), exp


# ── Read ops ─────────────────────────────────────────────────────────────
def get_snapshot(contract_key: str, snap_date: str) -> Optional[Tuple[int, str]]:
    """Return (oi, source) for a contract on a specific date, or None.
    snap_date is ISO (YYYY-MM-DD)."""
    with _conn() as c:
        cur = c.execute(
            "SELECT oi, source FROM contract_oi_snapshots WHERE contract_key=? AND snap_date=?",
            (contract_key, snap_date),
        )
        row = cur.fetchone()
        return (row[0], row[1]) if row else None


def get_history(contract_key: str, days: int = 30) -> List[Dict]:
    """All snapshots for a contract over the past N days, oldest first."""
    cutoff = _to_iso(date.today() - timedelta(days=days))
    with _conn() as c:
        cur = c.execute(
            "SELECT snap_date, oi, source FROM contract_oi_snapshots "
            "WHERE contract_key=? AND snap_date>=? ORDER BY snap_date ASC",
            (contract_key, cutoff),
        )
        return [{"date": r[0], "oi": r[1], "source": r[2]} for r in cur.fetchall()]


def get_status(days: int = 7) -> List[Dict]:
    """Counts of snapshots per day, most recent first."""
    cutoff = _to_iso(date.today() - timedelta(days=days))
    with _conn() as c:
        cur = c.execute(
            "SELECT snap_date, COUNT(*) AS n, MIN(created_at) AS captured_at "
            "FROM contract_oi_snapshots WHERE snap_date>=? "
            "GROUP BY snap_date ORDER BY snap_date DESC",
            (cutoff,),
        )
        return [{"date": r[0], "count": r[1], "captured_at": r[2]} for r in cur.fetchall()]


# ── Write ops ────────────────────────────────────────────────────────────
def record_batch(snapshots: Iterable[Tuple[str, int, str]], snap_date: str) -> int:
    """Insert a batch of (contract_key, oi, source) tuples for the given date.
    Upserts: if (contract_key, snap_date) already exists, OI is updated.
    snap_date is ISO."""
    rows = [(ck, snap_date, oi, src) for ck, oi, src in snapshots if oi is not None]
    if not rows:
        return 0
    with _conn() as c:
        c.executemany(
            """INSERT INTO contract_oi_snapshots (contract_key, snap_date, oi, source)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(contract_key, snap_date) DO UPDATE SET
                   oi = excluded.oi,
                   source = excluded.source,
                   created_at = CURRENT_TIMESTAMP""",
            rows,
        )
    return len(rows)


def prune_old(days_keep: int = DAYS_TO_KEEP_SNAPSHOTS) -> int:
    """Delete snapshots older than `days_keep`. Returns count removed."""
    cutoff = _to_iso(date.today() - timedelta(days=days_keep))
    with _conn() as c:
        cur = c.execute("DELETE FROM contract_oi_snapshots WHERE snap_date<?", (cutoff,))
        return cur.rowcount


# ── Read distinct contracts from `flow` table ────────────────────────────
def get_distinct_contracts(
    days_back: int = DAYS_BACK_TO_SNAPSHOT,
    min_trade_count: int = 3,
) -> List[Tuple[str, str, float, str]]:
    """Distinct (Symbol, CallPut, Strike, ExpirationDate) from `flow` table
    for trades in the past N calendar days (stocks source only).

    flow table stores CreatedDate as 'M/D/YYYY' strings, so we can't do a
    SQL range comparison directly. We pull distinct dates, parse them in
    Python, and IN-clause the ones in range.

    Filters:
      - Only contracts with ≥ `min_trade_count` trades in the window. Drops
        the long tail of single-trade fluke contracts that aren't part of
        any cluster anyway — cuts contract universe ~70-90% in practice.
      - Excludes adjusted/expired symbols ending in a digit (e.g. GME1,
        TLRY1, SOXS1) — Schwab returns 400 for those, they're just noise.
      - Drops malformed strike/expiration values.
    """
    cutoff = date.today() - timedelta(days=days_back)
    with _conn() as c:
        cur = c.execute(
            "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?",
            (SOURCE,),
        )
        all_date_strs = [r[0] for r in cur.fetchall()]

        in_range = []
        for d_str in all_date_strs:
            d = _parse_mdy(d_str)
            if d and d >= cutoff:
                in_range.append(d_str)

        if not in_range:
            return []

        placeholders = ",".join(["?"] * len(in_range))
        cur = c.execute(
            f"""SELECT Symbol, CallPut, Strike, ExpirationDate, COUNT(*) AS n_trades
                FROM flow
                WHERE source = ? AND CreatedDate IN ({placeholders})
                  AND Symbol IS NOT NULL AND Symbol != ''
                  AND CallPut IS NOT NULL AND CallPut != ''
                  AND Strike IS NOT NULL AND Strike != ''
                  AND ExpirationDate IS NOT NULL AND ExpirationDate != ''
                GROUP BY Symbol, CallPut, Strike, ExpirationDate
                HAVING COUNT(*) >= ?
                ORDER BY Symbol""",
            [SOURCE] + in_range + [min_trade_count],
        )

        contracts = []
        skipped_adjusted = 0
        skipped_malformed = 0
        for sym, cp, strike, exp, n in cur.fetchall():
            # Skip adjusted/when-issued symbols (end in digit). Schwab can't
            # quote them — they always 400.
            if sym and sym[-1].isdigit():
                skipped_adjusted += 1
                continue
            try:
                strike_f = float(strike)
                if _parse_mdy(exp) is None:
                    skipped_malformed += 1
                    continue
                contracts.append((sym, cp, strike_f, exp))
            except (ValueError, TypeError):
                skipped_malformed += 1
                continue

        logger.info(
            f"[oi-snapshot] Filtered {len(contracts)} contracts "
            f"(min_trades={min_trade_count}, skipped {skipped_adjusted} adjusted, "
            f"{skipped_malformed} malformed)"
        )
        return contracts


# ── Schwab fetch (direct in-process call, no HTTP loopback) ──────────────
def _exp_to_iso_for_schwab(exp: str) -> str:
    """Convert flow-table 'M/D/YYYY' → 'YYYY-MM-DD' for Schwab API."""
    parts = exp.split("/")
    if len(parts) != 3:
        return exp  # let Schwab reject it; safer than guessing
    m, d, y = parts
    if len(y) == 2:
        y = "20" + y
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


async def _fetch_oi_all_async(
    contracts: List[Tuple[str, str, float, str]],
) -> List[Tuple[str, Optional[int]]]:
    """Fetch OI for all contracts via direct schwab service call (in-process).
    Returns list of (contract_key, oi_or_None) parallel to input.

    Uses api.schwab_router.options_quotes_batch() so we get UW fallback for
    free. schwab.get_batch_option_quotes internally groups by symbol and
    does one chain call per ticker — way more efficient than per-contract calls.
    """
    # Lazy import — avoid circular deps if main.py imports us at startup
    from api.schwab_router import options_quotes_batch

    # Build the payload in the shape schwab expects
    payload = [
        {
            "symbol": sym,
            "cp": "C" if cp.upper() in ("C", "CALL") else "P",
            "strike": float(strike),
            "expDate": _exp_to_iso_for_schwab(exp),
        }
        for sym, cp, strike, exp in contracts
    ]

    try:
        response = await options_quotes_batch(payload)
    except Exception as e:
        logger.exception(f"[oi-snapshot] Schwab batch call failed: {e}")
        # All-failure fallback
        return [(make_key(s, cp, k, x), None) for s, cp, k, x in contracts]

    # Response shape: {"quotes": [...]}, parallel to input
    quotes = response.get("quotes", []) if isinstance(response, dict) else []

    results: List[Tuple[str, Optional[int]]] = []
    for orig, quote in zip(contracts, quotes):
        sym, cp, strike, exp = orig
        ck = make_key(sym, cp, strike, exp)
        if not isinstance(quote, dict) or quote.get("error") or quote.get("expired"):
            results.append((ck, None))
            continue
        oi = quote.get("openInterest")
        # Schwab returns 0 for "no data" as well as legit 0-OI contracts.
        # Treat 0 as None for snapshot purposes — we want signal, not noise.
        if oi is None or oi == 0:
            results.append((ck, None))
        else:
            try:
                results.append((ck, int(oi)))
            except (ValueError, TypeError):
                results.append((ck, None))
    return results


def _fetch_oi_all(
    contracts: List[Tuple[str, str, float, str]],
) -> List[Tuple[str, Optional[int]]]:
    """Synchronous wrapper (APScheduler expects sync)."""
    return asyncio.run(_fetch_oi_all_async(contracts))


# ── The daily job ────────────────────────────────────────────────────────
# Chunked processing — split contracts into chunks, fetch + commit per chunk.
# Means partial progress is durable: if the job crashes or gets cancelled
# mid-run, snapshots from completed chunks are already in the DB.
CHUNK_SIZE = 500


def daily_snapshot_job() -> Dict:
    """Cron entry point. Runs once daily.

    1. Init DB (idempotent)
    2. Record a 'running' row in oi_snapshot_runs
    3. Get filtered contracts from past 30d of trades (stocks only,
       min 3 trades, no adjusted symbols)
    4. Process in CHUNK_SIZE batches:
         - Fetch OI from Schwab for the chunk
         - Insert that chunk's results
         - Heartbeat the run progress
    5. Prune snapshots older than 90 days
    6. Update the run record to 'completed' or 'failed'

    Cancellation check: if the run's status changes to 'failed' mid-job
    (manual cancel), bail out gracefully after current chunk.
    """
    init_db()
    today_iso = _to_iso(date.today())
    logger.info(f"[oi-snapshot] Starting daily snapshot for {today_iso}")

    run_id = start_run()
    try:
        contracts = get_distinct_contracts()
        if not contracts:
            logger.info("[oi-snapshot] No contracts found in past 30 days. Skipping.")
            summary = {"date": today_iso, "skipped": True, "reason": "no contracts"}
            finish_run(run_id, "completed", summary)
            return summary

        total = len(contracts)
        logger.info(
            f"[oi-snapshot] Fetching OI for {total} contracts in chunks of {CHUNK_SIZE}..."
        )

        total_successes = 0
        total_failures = 0
        total_inserted = 0
        chunks_done = 0

        for chunk_start in range(0, total, CHUNK_SIZE):
            chunk = contracts[chunk_start : chunk_start + CHUNK_SIZE]
            chunk_num = chunk_start // CHUNK_SIZE + 1
            total_chunks = (total + CHUNK_SIZE - 1) // CHUNK_SIZE

            # Cancellation check — if run was manually cancelled, bail out
            if _is_run_cancelled(run_id):
                logger.info(f"[oi-snapshot] Cancelled mid-run after chunk {chunks_done}")
                summary = {
                    "date": today_iso,
                    "cancelled": True,
                    "contracts_queried": chunks_done * CHUNK_SIZE,
                    "successes": total_successes,
                    "inserted": total_inserted,
                }
                # Don't overwrite the cancel state — leave as 'failed'
                return summary

            logger.info(f"[oi-snapshot] Chunk {chunk_num}/{total_chunks} ({len(chunk)} contracts)...")
            fetched = _fetch_oi_all(chunk)

            insert_batch = [(ck, oi, "schwab") for ck, oi in fetched if oi is not None]
            chunk_succ = len(insert_batch)
            chunk_fail = len(fetched) - chunk_succ

            inserted = record_batch(insert_batch, today_iso)
            total_successes += chunk_succ
            total_failures += chunk_fail
            total_inserted += inserted
            chunks_done += 1

            # Heartbeat: update run summary so /run-status shows progress
            _heartbeat_run(run_id, {
                "chunks_done": chunks_done,
                "total_chunks": total_chunks,
                "successes_so_far": total_successes,
                "failures_so_far": total_failures,
                "inserted_so_far": total_inserted,
            })

            logger.info(
                f"[oi-snapshot] Chunk {chunk_num}/{total_chunks} done: "
                f"{chunk_succ} ok, {chunk_fail} failed. "
                f"Running total: {total_successes}/{chunk_start + len(chunk)}"
            )

        pruned = prune_old()

        # ── Dealer positioning attribution ──────────────────────────────
        # Run this AFTER the OI snapshots for today are persisted, so the
        # compute_positioning_for_date call below has the fresh snapshot
        # to attribute against. Wrapped in try/except so a failure here
        # doesn't poison the OI snapshot run — dealer_positioning is
        # downstream/optional, OI snapshots are the primary signal.
        dp_summary = None
        try:
            from api.dealer_positioning import compute_positioning_for_date
            dp_summary = compute_positioning_for_date(today_iso)
            logger.info(f"[oi-snapshot] dealer_positioning updated: {dp_summary}")
        except Exception as e:
            logger.exception("[oi-snapshot] dealer_positioning compute failed (non-fatal)")
            dp_summary = {"error": str(e)}

        summary = {
            "date": today_iso,
            "contracts_queried": total,
            "successes": total_successes,
            "failures": total_failures,
            "inserted": total_inserted,
            "pruned": pruned,
            "dealer_positioning": dp_summary,
        }
        logger.info(f"[oi-snapshot] Done: {summary}")
        finish_run(run_id, "completed", summary)
        return summary
    except Exception as e:
        logger.exception("[oi-snapshot] Job crashed")
        finish_run(run_id, "failed", {"error": str(e)})
        raise


def _is_run_cancelled(run_id: int) -> bool:
    """Check if this specific run has been marked as failed/cancelled externally."""
    with _conn() as c:
        cur = c.execute(
            "SELECT status FROM oi_snapshot_runs WHERE run_id=?",
            (run_id,),
        )
        row = cur.fetchone()
        return row is not None and row[0] != "running"


def _heartbeat_run(run_id: int, progress: Dict):
    """Update summary_json with current progress (but keep status=running)."""
    import json
    with _conn() as c:
        # Only update if still running — don't overwrite a cancel
        c.execute(
            "UPDATE oi_snapshot_runs SET summary_json=? WHERE run_id=? AND status='running'",
            (json.dumps(progress), run_id),
        )


# ── Confirmation logic (Phase 2b — used when serving flow data) ──────────
def confirm_trade_direction(
    trade_date_mdy: str,
    contract_key: str,
    volume: int,
    side: str,
    color: str,
    cp: str,
    next_trading_day_iso: Optional[str] = None,
) -> Optional[str]:
    """Apply retroactive confirmation to a B-side trade.

    Given trade-day info, look up the next trading day's OI and decide if the
    trade was real positioning. If confirmed, return the inferred direction
    ("BULL" / "BEAR"); otherwise return None (trade stays ambiguous).

    Args:
        trade_date_mdy: 'M/D/YYYY' of the trade (BBS format from flow table)
        contract_key: contract identifier from make_key()
        volume: shares traded on this contract that day
        side: 'B' or 'BB' (this function only handles B-side; A-side stays
              directional under existing strict rule)
        color: 'YELLOW' or 'MAGENTA' (must be one of these to even attempt)
        cp: 'C' or 'P' or 'CALL' / 'PUT'
        next_trading_day_iso: optional override (ISO YYYY-MM-DD); defaults to
              trade_date + 1 calendar day, which only finds a snapshot if Schwab
              ran on that date. For weekends/holidays, caller should pass the
              correct next-trading-day.

    Returns:
        'BULL' or 'BEAR' if confirmed and a direction can be inferred,
        None if not confirmed (ambiguous flow, or no snapshot yet).
    """
    if side not in ("B", "BB"):
        return None
    if color not in ("YELLOW", "MAGENTA"):
        return None

    trade_d = _parse_mdy(trade_date_mdy)
    if trade_d is None:
        return None

    trade_iso = _to_iso(trade_d)
    next_iso = next_trading_day_iso or _to_iso(trade_d + timedelta(days=1))

    snap_trade = get_snapshot(contract_key, trade_iso)
    snap_next = get_snapshot(contract_key, next_iso)

    if snap_trade is None or snap_next is None:
        return None

    oi_growth = snap_next[0] - snap_trade[0]
    if volume <= 0:
        return None
    if (oi_growth / volume) < CONFIRMATION_THRESHOLD:
        return None  # not confirmed — was churn

    # Confirmed. Apply directional inference:
    #   MAGENTA call = institutional bullish (BBS A-side-equivalent semantics)
    #   YELLOW  call = institutional bearish (call selling)
    #   MAGENTA put  = bearish (put accumulation)
    #   YELLOW  put  = bullish (put selling)
    is_call = cp.upper() in ("C", "CALL")
    if color == "MAGENTA":
        return "BULL" if is_call else "BEAR"
    else:  # YELLOW
        return "BEAR" if is_call else "BULL"
