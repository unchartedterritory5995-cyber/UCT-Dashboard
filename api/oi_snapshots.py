"""
oi_snapshots.py — Daily OI snapshot collection + retroactive direction confirmation.

The premise: B-side trades are ambiguous on the day they happen (could be opens,
closes, or hedges). But OI growth measured the NEXT trading day proves whether
those trades were real institutional positioning. We capture daily OI snapshots
so the dashboard can retroactively confirm yesterday's B-side flow as
directional once OI confirms it.

Architecture:
    contract_oi_snapshots table holds (contract, date, oi) tuples.
    Daily 5:30 AM ET cron fetches OI for every contract that had flow in past 30d.
    Confirmation logic compares trade_day_oi → next_day_oi against volume on the
    trade day. If oi_growth / volume >= 50%, the B-side cluster is confirmed.

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
import httpx
from datetime import date, datetime, timedelta
from typing import List, Optional, Iterable, Tuple, Dict
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# Schwab quotes endpoint — same one frontend uses for "Fetch Live OI"
SCHWAB_QUOTES_URL = os.environ.get(
    "SCHWAB_QUOTES_URL",
    "http://localhost:8000/api/schwab/options-quotes",
)

# How many contracts per Schwab batch (matches frontend pattern)
SCHWAB_BATCH_SIZE = 20
SCHWAB_BATCH_DELAY_SEC = 0.5  # to avoid rate limits
SCHWAB_TIMEOUT_SEC = 30.0

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
"""


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
def get_distinct_contracts(days_back: int = DAYS_BACK_TO_SNAPSHOT) -> List[Tuple[str, str, float, str]]:
    """Distinct (Symbol, CallPut, Strike, ExpirationDate) from `flow` table
    for trades in the past N calendar days (stocks source only).

    flow table stores CreatedDate as 'M/D/YYYY' strings, so we can't do a
    SQL range comparison directly. We pull distinct dates, parse them in
    Python, and IN-clause the ones in range. Cheap because there are at
    most ~30-60 distinct dates.
    """
    cutoff = date.today() - timedelta(days=days_back)
    with _conn() as c:
        # Step 1: enumerate distinct dates in the flow table for stocks
        cur = c.execute(
            "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?",
            (SOURCE,),
        )
        all_date_strs = [r[0] for r in cur.fetchall()]

        # Step 2: keep only the ones within cutoff
        in_range = []
        for d_str in all_date_strs:
            d = _parse_mdy(d_str)
            if d and d >= cutoff:
                in_range.append(d_str)

        if not in_range:
            return []

        # Step 3: pull distinct contracts for those dates
        placeholders = ",".join(["?"] * len(in_range))
        cur = c.execute(
            f"""SELECT DISTINCT Symbol, CallPut, Strike, ExpirationDate
                FROM flow
                WHERE source = ? AND CreatedDate IN ({placeholders})
                  AND Symbol IS NOT NULL AND Symbol != ''
                  AND CallPut IS NOT NULL AND CallPut != ''
                  AND Strike IS NOT NULL AND Strike != ''
                  AND ExpirationDate IS NOT NULL AND ExpirationDate != ''""",
            [SOURCE] + in_range,
        )
        contracts = []
        for sym, cp, strike, exp in cur.fetchall():
            try:
                contracts.append((sym, cp, float(strike), exp))
            except (ValueError, TypeError):
                continue  # malformed row, skip
        return contracts


# ── Schwab fetch (batched HTTP loopback) ─────────────────────────────────
def _exp_to_iso_for_schwab(exp: str) -> str:
    """Convert flow-table 'M/D/YYYY' → 'YYYY-MM-DD' for Schwab API.

    Matches frontend's expToISO() helper so we send Schwab the same format
    the live frontend does."""
    parts = exp.split("/")
    if len(parts) != 3:
        return exp  # let Schwab reject it; safer than guessing
    m, d, y = parts
    if len(y) == 2:
        y = "20" + y
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


async def _fetch_oi_batch_async(
    contracts: List[Tuple[str, str, float, str]],
) -> List[Tuple[str, Optional[int]]]:
    """Fetch OI for each contract via the local Schwab endpoint.
    Returns list of (contract_key, oi_or_None) parallel to input."""
    results: List[Tuple[str, Optional[int]]] = []
    async with httpx.AsyncClient(timeout=SCHWAB_TIMEOUT_SEC) as client:
        for i in range(0, len(contracts), SCHWAB_BATCH_SIZE):
            batch = contracts[i : i + SCHWAB_BATCH_SIZE]
            payload = [
                {
                    "symbol": sym,
                    "cp": "C" if cp.upper() in ("C", "CALL") else "P",
                    "strike": float(strike),
                    "expDate": _exp_to_iso_for_schwab(exp),
                }
                for sym, cp, strike, exp in batch
            ]
            try:
                resp = await client.post(SCHWAB_QUOTES_URL, json=payload)
                resp.raise_for_status()
                data = resp.json()
                quotes = data.get("quotes", [])
                # Quotes come back in same order as input
                for orig, quote in zip(batch, quotes):
                    sym, cp, strike, exp = orig
                    ck = make_key(sym, cp, strike, exp)
                    if quote.get("error") or quote.get("expired"):
                        results.append((ck, None))
                    else:
                        oi = quote.get("openInterest")
                        results.append((ck, int(oi) if oi is not None else None))
            except Exception as e:
                logger.warning(
                    f"[oi-snapshot] Batch {i // SCHWAB_BATCH_SIZE + 1} failed: {e}"
                )
                for orig in batch:
                    sym, cp, strike, exp = orig
                    results.append((make_key(sym, cp, strike, exp), None))
            # Rate-limit pacing
            if i + SCHWAB_BATCH_SIZE < len(contracts):
                await asyncio.sleep(SCHWAB_BATCH_DELAY_SEC)
    return results


def _fetch_oi_batch(
    contracts: List[Tuple[str, str, float, str]],
) -> List[Tuple[str, Optional[int]]]:
    """Synchronous wrapper around the async fetcher (APScheduler expects sync)."""
    return asyncio.run(_fetch_oi_batch_async(contracts))


# ── The daily job ────────────────────────────────────────────────────────
def daily_snapshot_job() -> Dict:
    """Cron entry point. Runs once daily.

    1. Init DB (idempotent)
    2. Get distinct contracts from past 30d of trades (stocks only)
    3. Fetch live OI in batches from Schwab
    4. Insert results into contract_oi_snapshots with today's date (ISO)
    5. Prune snapshots older than 90 days
    """
    init_db()
    today_iso = _to_iso(date.today())
    logger.info(f"[oi-snapshot] Starting daily snapshot for {today_iso}")

    contracts = get_distinct_contracts()
    if not contracts:
        logger.info("[oi-snapshot] No contracts found in past 30 days. Skipping.")
        return {"date": today_iso, "skipped": True, "reason": "no contracts"}

    logger.info(f"[oi-snapshot] Fetching OI for {len(contracts)} contracts...")

    fetched = _fetch_oi_batch(contracts)

    insert_batch = [(ck, oi, "schwab") for ck, oi in fetched if oi is not None]
    successes = len(insert_batch)
    failures = len(fetched) - successes

    inserted = record_batch(insert_batch, today_iso)

    pruned = prune_old()

    summary = {
        "date": today_iso,
        "contracts_queried": len(contracts),
        "successes": successes,
        "failures": failures,
        "inserted": inserted,
        "pruned": pruned,
    }
    logger.info(f"[oi-snapshot] Done: {summary}")
    return summary


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
