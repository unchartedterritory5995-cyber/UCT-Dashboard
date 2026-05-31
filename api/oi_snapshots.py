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
    _scheduler.add_job(
        daily_snapshot_job,
        CronTrigger(hour=5, minute=30, day_of_week="mon-fri"),
        id="oi_snapshot_daily",
    )
    init_db()  # on startup

Confirmation threshold:
    oi_growth_pct = (oi_t+1 - oi_t) / volume_on_t
    >= 0.50  →  cluster is confirmed positioning
    <  0.50  →  cluster stays ambiguous (likely churn / MM hedging)
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
# Override via env if needed (e.g., for testing against a different port).
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
    """SQLite connection with sensible defaults."""
    c = sqlite3.connect(DB_PATH)
    c.execute("PRAGMA journal_mode=WAL")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db():
    """Create the snapshot table. Idempotent — safe to call on every startup."""
    with _conn() as c:
        c.executescript(SCHEMA)
    logger.info("[oi-snapshot] DB initialized")


# ── Key construction ─────────────────────────────────────────────────────
def make_key(sym: str, cp: str, strike, exp: str) -> str:
    """Build a contract key. Strike is normalized to float string to avoid
    "100" vs "100.0" mismatches."""
    return f"{sym}|{cp}|{float(strike)}|{exp}"


def parse_key(key: str) -> Tuple[str, str, float, str]:
    sym, cp, strike, exp = key.split("|", 3)
    return sym, cp, float(strike), exp


# ── Read ops ─────────────────────────────────────────────────────────────
def get_snapshot(contract_key: str, snap_date: str) -> Optional[Tuple[int, str]]:
    """Return (oi, source) for a contract on a specific date, or None."""
    with _conn() as c:
        cur = c.execute(
            "SELECT oi, source FROM contract_oi_snapshots WHERE contract_key=? AND snap_date=?",
            (contract_key, snap_date),
        )
        row = cur.fetchone()
        return (row[0], row[1]) if row else None


def get_history(contract_key: str, days: int = 30) -> List[Dict]:
    """All snapshots for a contract over the past N days, oldest first."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with _conn() as c:
        cur = c.execute(
            "SELECT snap_date, oi, source FROM contract_oi_snapshots "
            "WHERE contract_key=? AND snap_date>=? ORDER BY snap_date ASC",
            (contract_key, cutoff),
        )
        return [{"date": r[0], "oi": r[1], "source": r[2]} for r in cur.fetchall()]


def get_status(days: int = 7) -> List[Dict]:
    """Counts of snapshots per day, most recent first."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
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
    Upserts: if (contract_key, snap_date) already exists, OI is updated."""
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
    cutoff = (date.today() - timedelta(days=days_keep)).isoformat()
    with _conn() as c:
        cur = c.execute("DELETE FROM contract_oi_snapshots WHERE snap_date<?", (cutoff,))
        return cur.rowcount


# ── Read distinct contracts from trades table ────────────────────────────
def get_distinct_contracts(days_back: int = DAYS_BACK_TO_SNAPSHOT) -> List[Tuple[str, str, float, str]]:
    """Distinct (sym, cp, strike, exp) tuples from trades table in past N days.

    Looks at the 'trades' table that flow_db.py manages. If your column names
    differ, override here. This is the only place we touch the trades schema.
    """
    cutoff = (date.today() - timedelta(days=days_back)).isoformat()
    contracts = []
    with _conn() as c:
        # Discover trades table column names first — flow_db.py defines them.
        # We assume: ticker, callput, strike, expiration, created_date.
        # If your schema differs, adjust the query below.
        try:
            cur = c.execute(
                """SELECT DISTINCT ticker, callput, strike, expiration
                   FROM trades
                   WHERE created_date >= ?
                     AND ticker IS NOT NULL
                     AND callput IS NOT NULL
                     AND strike IS NOT NULL
                     AND expiration IS NOT NULL""",
                (cutoff,),
            )
            contracts = [(r[0], r[1], float(r[2]), r[3]) for r in cur.fetchall()]
        except sqlite3.OperationalError as e:
            logger.error(f"[oi-snapshot] Failed to query trades table: {e}")
            logger.error("[oi-snapshot] Check column names in flow_db.py and adjust get_distinct_contracts() if needed.")
            return []
    return contracts


# ── Schwab fetch (batched HTTP loopback) ─────────────────────────────────
def _exp_to_iso(exp: str) -> str:
    """Convert '6/18/2026' → '2026-06-18'."""
    parts = exp.split("/")
    if len(parts) != 3:
        return exp
    m, d, y = parts
    if len(y) == 2:
        y = "20" + y
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


async def _fetch_oi_batch_async(contracts: List[Tuple[str, str, float, str]]) -> List[Tuple[str, Optional[int]]]:
    """Fetch OI for each contract via the local Schwab endpoint.
    Returns list of (contract_key, oi_or_None) parallel to input."""
    results: List[Tuple[str, Optional[int]]] = []
    async with httpx.AsyncClient(timeout=SCHWAB_TIMEOUT_SEC) as client:
        for i in range(0, len(contracts), SCHWAB_BATCH_SIZE):
            batch = contracts[i : i + SCHWAB_BATCH_SIZE]
            payload = [
                {
                    "symbol": sym,
                    "cp": cp,
                    "strike": float(strike),
                    "expDate": _exp_to_iso(exp),
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
                logger.warning(f"[oi-snapshot] Batch {i//SCHWAB_BATCH_SIZE+1} failed: {e}")
                for orig in batch:
                    sym, cp, strike, exp = orig
                    results.append((make_key(sym, cp, strike, exp), None))
            # Rate-limit pacing
            if i + SCHWAB_BATCH_SIZE < len(contracts):
                await asyncio.sleep(SCHWAB_BATCH_DELAY_SEC)
    return results


def _fetch_oi_batch(contracts: List[Tuple[str, str, float, str]]) -> List[Tuple[str, Optional[int]]]:
    """Synchronous wrapper around the async fetcher (APScheduler expects sync)."""
    return asyncio.run(_fetch_oi_batch_async(contracts))


# ── The daily job ────────────────────────────────────────────────────────
def daily_snapshot_job() -> Dict:
    """Cron entry point. Runs once daily.

    1. Init DB (idempotent)
    2. Get distinct contracts from past 30d of trades
    3. Fetch live OI in batches from Schwab
    4. Insert results into contract_oi_snapshots with today's date
    5. Prune snapshots older than 90 days
    """
    init_db()
    today = date.today().isoformat()
    logger.info(f"[oi-snapshot] Starting daily snapshot for {today}")

    contracts = get_distinct_contracts()
    if not contracts:
        logger.info("[oi-snapshot] No contracts found in past 30 days. Skipping.")
        return {"date": today, "skipped": True, "reason": "no contracts"}

    logger.info(f"[oi-snapshot] Fetching OI for {len(contracts)} contracts...")

    # Fetch all OIs
    fetched = _fetch_oi_batch(contracts)

    # Prepare insert batch (filter out None OIs)
    insert_batch = [(ck, oi, "schwab") for ck, oi in fetched if oi is not None]
    successes = len(insert_batch)
    failures = len(fetched) - successes

    inserted = record_batch(insert_batch, today)

    pruned = prune_old()

    summary = {
        "date": today,
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
    trade_date: str,
    contract_key: str,
    volume: int,
    side: str,
    color: str,
    cp: str,
    next_trading_day: Optional[str] = None,
) -> Optional[str]:
    """Apply retroactive confirmation to a B-side trade.

    Given trade-day info, look up the next trading day's OI and decide if the
    trade was real positioning. If confirmed, return the inferred direction
    ("BULL" / "BEAR"); otherwise return None (trade stays ambiguous).

    Args:
        trade_date: 'YYYY-MM-DD' of the trade
        contract_key: contract identifier from make_key()
        volume: shares traded on this contract that day
        side: 'B' or 'BB' (this function only handles B-side; A-side stays
              directional under existing strict rule)
        color: 'YELLOW' or 'MAGENTA' (must be one of these to even attempt)
        cp: 'C' or 'P' or 'CALL' / 'PUT'
        next_trading_day: optional override; defaults to trade_date + 1 calendar day,
                          which only matches if Schwab snapshotted that day.
                          For weekends/holidays, caller should pass the correct date.

    Returns:
        'BULL' or 'BEAR' if confirmed and a direction can be inferred,
        None if not confirmed (ambiguous flow, or no snapshot yet).
    """
    # Only handle B-side; A-side already has direction from strict rule.
    if side not in ("B", "BB"):
        return None

    # Only handle confirmed colors (YELLOW or MAGENTA).
    if color not in ("YELLOW", "MAGENTA"):
        return None

    # Get OI snapshots for trade day and next day
    if next_trading_day is None:
        # Naive next day. Caller can pass exact next trading day for accuracy.
        try:
            d = datetime.strptime(trade_date, "%Y-%m-%d").date()
            next_trading_day = (d + timedelta(days=1)).isoformat()
        except ValueError:
            return None

    snap_trade = get_snapshot(contract_key, trade_date)
    snap_next = get_snapshot(contract_key, next_trading_day)

    # If we don't have both snapshots, can't confirm yet.
    if snap_trade is None or snap_next is None:
        return None

    oi_trade = snap_trade[0]
    oi_next = snap_next[0]
    oi_growth = oi_next - oi_trade

    # Apply threshold: oi_growth / volume >= CONFIRMATION_THRESHOLD
    if volume <= 0:
        return None
    growth_ratio = oi_growth / volume
    if growth_ratio < CONFIRMATION_THRESHOLD:
        return None  # not confirmed — was churn

    # Confirmed positioning. Apply directional inference per the framework:
    #   MAGENTA call = institutional bullish (BBS marks A-side-like semantics)
    #   YELLOW  call = institutional bearish (call selling)
    #   MAGENTA put  = bearish (put accumulation)
    #   YELLOW  put  = bullish (put selling)
    cp_upper = cp.upper()
    is_call = cp_upper in ("C", "CALL")
    if color == "MAGENTA":
        return "BULL" if is_call else "BEAR"
    else:  # YELLOW
        return "BEAR" if is_call else "BULL"
