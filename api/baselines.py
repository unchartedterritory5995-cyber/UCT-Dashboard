"""
baselines.py — Per-ticker premium percentile baselines from FlowDB.

Purpose: replace static dollar thresholds (e.g. "B grade requires $2M") with
ticker-specific thresholds (e.g. "B grade requires premium >= NOK's P90 of $905K
or MU's P90 of $2.76M"). Different tickers have wildly different "normal" flow
sizes — TSLA P95 is $1.99M while NOK P95 is $1.13M — so a single static cutoff
either misses real signals on quiet names or floods Discord on liquid names.

How it works:
1. refresh_baselines() reads from FlowDB (the OptionsFlow data store), filters
   to trades >= $250K premium (matching Bullflow's floor), groups by ticker,
   computes P50/P75/P90/P95/P99 per ticker, writes to ticker_baselines table.
2. Worker loads baselines into memory at startup.
3. Worker gate checks call get_premium_floor(ticker, grade) — returns the
   dollar amount required for that ticker at that grade tier.

Design notes:
- Premium is stored as TEXT in FlowDB; we CAST AS REAL at query time.
- Falls back to static thresholds when a ticker has <30 samples (low
  confidence) so we don't gate aggressively on thin data.
- Refresh is fast: ~250K rows scanned, ~30s on Railway.
- Safe to call refresh while worker is running — uses transactions.

Usage:
    from baselines import refresh_baselines, load_baselines, get_premium_floor

    # Compute and store baselines (admin trigger or scheduled job)
    result = refresh_baselines(db_path="/data/flow.db", days_back=30)
    print(result)  # {"tickers_computed": 924, "sample_count": 246169, ...}

    # In worker startup
    load_baselines(db_path="/data/flow.db")

    # In gate check
    floor = get_premium_floor("NOK", "B")  # returns NOK's P95
    if premium >= floor:
        # passes gate
"""

import sqlite3
import logging
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Optional

log = logging.getLogger(__name__)

# In-memory cache. Populated by load_baselines() at worker startup, and
# refreshed by refresh_baselines() on demand. Reads are lock-free since
# Python dict reads are atomic at the GIL level.
_baselines_cache: dict[str, dict] = {}
_baselines_last_loaded: Optional[datetime] = None

# Static fallback when a ticker has insufficient samples (<MIN_SAMPLES) or
# isn't in the baselines table at all. Matches the previous static
# TIER_PREMIUM_REQUIREMENTS to preserve existing behavior on cold-start
# or ticker-without-history paths.
FALLBACK_FLOORS = {
    "A+": 500_000,
    "A":  600_000,
    "B":  2_000_000,
    "C":  None,    # blocked (except via tier overrides like Unusual Weeklies)
    "D":  None,
}

# Minimum sample count for a baseline to be considered reliable. Below this,
# fall back to static thresholds. Tuned conservatively — 30 samples gives
# decent percentile estimates without being so strict that microcaps never
# qualify. For 14-day data this gates out ~75% of long-tail tickers, but
# at 30-day data window it captures most active names.
MIN_SAMPLES = 30

# Premium floor for inclusion in baseline computation. Matches Bullflow's
# Min Premium setting. Trades below this would never reach the worker
# anyway, so including them would skew the percentiles downward.
MIN_PREMIUM_FOR_BASELINE = 250_000


@contextmanager
def _conn(db_path: str):
    """SQLite connection with sane defaults. Same shape as FlowDB._conn()."""
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str = "/data/flow.db"):
    """Create the ticker_baselines table if it doesn't exist. Idempotent.

    Lives in the same SQLite file as the source flow data — keeps related
    data colocated, avoids cross-db join complications.
    """
    with _conn(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ticker_baselines (
                ticker TEXT PRIMARY KEY,
                sample_count INTEGER NOT NULL,
                days_back INTEGER NOT NULL,
                p50_premium REAL,
                p75_premium REAL,
                p90_premium REAL,
                p95_premium REAL,
                p99_premium REAL,
                min_premium REAL,
                max_premium REAL,
                mean_premium REAL,
                last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_baselines_refreshed "
            "ON ticker_baselines(last_refreshed)"
        )


def _percentile(sorted_data: list, p: float) -> float:
    """Linear interpolation percentile. p in [0, 100]. sorted_data ascending.

    Standard inclusive method — matches NumPy's default with kind='linear'.
    """
    if not sorted_data:
        return 0.0
    if len(sorted_data) == 1:
        return float(sorted_data[0])
    k = (len(sorted_data) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(sorted_data) - 1)
    if f == c:
        return float(sorted_data[f])
    return float(sorted_data[f] + (sorted_data[c] - sorted_data[f]) * (k - f))


def _date_filter_clause(days_back: int) -> tuple[str, list]:
    """Build a SQL clause matching CreatedDate strings to the last N days.

    FlowDB stores CreatedDate as TEXT in M/D/YYYY format (no zero-padding),
    so we can't use SQLite's date() function directly. Instead we generate
    the explicit list of qualifying date strings and use IN. For 30 days
    that's ~22 trading days = 22 string params, trivial.
    """
    today = datetime.utcnow()
    candidates = []
    for i in range(days_back + 5):  # +5 buffer for weekends
        d = today - timedelta(days=i)
        # FlowDB stores as M/D/YYYY without leading zeros
        candidates.append(f"{d.month}/{d.day}/{d.year}")
    placeholders = ",".join(["?"] * len(candidates))
    return f"CreatedDate IN ({placeholders})", candidates


def refresh_baselines(
    db_path: str = "/data/flow.db",
    days_back: int = 180,
    source: str = "stocks",
    min_premium: float = MIN_PREMIUM_FOR_BASELINE,
) -> dict:
    """
    Recompute ticker baselines from FlowDB and persist to ticker_baselines.

    Reads the last `days_back` days of `source` flow, filters to trades with
    Premium >= `min_premium`, groups by Symbol, computes percentiles, and
    UPSERTs into ticker_baselines.

    Default days_back=180 (6 months) — uses everything you have. Per-ticker
    premium distributions are stable over months, so wide windows give
    better percentile estimates without inflating compute. The query
    completes in <1s for ~1M rows.

    Returns a summary dict including the actual date_range hit, so you can
    tell if you have less than 6 months of data (the response shows the
    real earliest/latest dates rather than just echoing the config).

    Safe to run while the worker is active — single transaction at the end.
    Existing baseline rows for tickers not in the new dataset are KEPT
    (stale but better than nothing). Use admin to clear if you want to purge.
    """
    start_ts = time.time()
    init_db(db_path)

    date_clause, date_params = _date_filter_clause(days_back)

    # Pull all (ticker, premium) pairs in scope. CAST since FlowDB stores
    # Premium as TEXT. The CAST is cheap relative to the I/O.
    with _conn(db_path) as conn:
        cursor = conn.execute(
            f"""
            SELECT Symbol, CAST(Premium AS REAL) as prem
            FROM flow
            WHERE source = ?
              AND {date_clause}
              AND CAST(Premium AS REAL) >= ?
              AND Symbol IS NOT NULL
              AND Symbol != ''
            """,
            [source] + date_params + [min_premium],
        )
        rows = cursor.fetchall()

        # Also query the actual date range hit — tells the admin whether
        # the configured `days_back` is larger than the available data
        # (e.g. you asked for 180 days but only have 90). Cheap query
        # since CreatedDate is indexed.
        cursor2 = conn.execute(
            f"""
            SELECT MIN(CreatedDate), MAX(CreatedDate), COUNT(DISTINCT CreatedDate)
            FROM flow
            WHERE source = ?
              AND {date_clause}
            """,
            [source] + date_params,
        )
        date_min, date_max, distinct_dates = cursor2.fetchone()

    log.info("[baselines] loaded %d qualifying rows for percentile computation", len(rows))

    # Group by ticker, sort each list once, compute percentiles
    by_ticker: dict[str, list] = {}
    for symbol, prem in rows:
        if symbol and prem and prem > 0:
            by_ticker.setdefault(symbol.upper(), []).append(prem)

    computed = []
    for ticker, prems in by_ticker.items():
        prems.sort()
        n = len(prems)
        computed.append({
            "ticker": ticker,
            "sample_count": n,
            "days_back": days_back,
            "p50_premium": _percentile(prems, 50),
            "p75_premium": _percentile(prems, 75),
            "p90_premium": _percentile(prems, 90),
            "p95_premium": _percentile(prems, 95),
            "p99_premium": _percentile(prems, 99),
            "min_premium": prems[0],
            "max_premium": prems[-1],
            "mean_premium": sum(prems) / n,
        })

    # Bulk upsert. Single transaction = fast and atomic.
    upserted = 0
    with _conn(db_path) as conn:
        for b in computed:
            conn.execute(
                """
                INSERT INTO ticker_baselines
                    (ticker, sample_count, days_back, p50_premium, p75_premium,
                     p90_premium, p95_premium, p99_premium, min_premium,
                     max_premium, mean_premium, last_refreshed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(ticker) DO UPDATE SET
                    sample_count = excluded.sample_count,
                    days_back = excluded.days_back,
                    p50_premium = excluded.p50_premium,
                    p75_premium = excluded.p75_premium,
                    p90_premium = excluded.p90_premium,
                    p95_premium = excluded.p95_premium,
                    p99_premium = excluded.p99_premium,
                    min_premium = excluded.min_premium,
                    max_premium = excluded.max_premium,
                    mean_premium = excluded.mean_premium,
                    last_refreshed = CURRENT_TIMESTAMP
                """,
                (
                    b["ticker"], b["sample_count"], b["days_back"],
                    b["p50_premium"], b["p75_premium"], b["p90_premium"],
                    b["p95_premium"], b["p99_premium"], b["min_premium"],
                    b["max_premium"], b["mean_premium"],
                ),
            )
            upserted += 1

    # Refresh the in-memory cache so changes take effect immediately
    # without requiring a worker restart.
    load_baselines(db_path)

    elapsed = time.time() - start_ts

    # Stats on data quality — how many tickers have enough samples for
    # baselines to be considered reliable vs which fall back to static.
    reliable = sum(1 for b in computed if b["sample_count"] >= MIN_SAMPLES)
    workable = sum(1 for b in computed if 10 <= b["sample_count"] < MIN_SAMPLES)
    thin = sum(1 for b in computed if b["sample_count"] < 10)

    return {
        "ok": True,
        "tickers_computed": len(computed),
        "rows_scanned": len(rows),
        "upserted": upserted,
        "date_range": {
            "earliest": date_min,
            "latest": date_max,
            "distinct_trading_days": distinct_dates,
        },
        "data_quality": {
            "reliable_30plus": reliable,
            "workable_10to29": workable,
            "thin_under10": thin,
        },
        "config": {
            "days_back": days_back,
            "source": source,
            "min_premium_for_baseline": min_premium,
        },
        "elapsed_sec": round(elapsed, 2),
    }


def load_baselines(db_path: str = "/data/flow.db") -> int:
    """
    Load ticker_baselines from disk into the in-memory _baselines_cache.

    Called at worker startup and after refresh_baselines(). Returns the
    number of tickers loaded.

    The cache is a plain dict — Python's GIL guarantees atomic dict reads
    so we don't need locking. Writes happen during refresh which fully
    replaces the dict atomically via reassignment.
    """
    global _baselines_cache, _baselines_last_loaded

    init_db(db_path)
    new_cache: dict[str, dict] = {}
    with _conn(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT ticker, sample_count, days_back, p50_premium, p75_premium,
                   p90_premium, p95_premium, p99_premium, min_premium,
                   max_premium, mean_premium, last_refreshed
            FROM ticker_baselines
            """
        )
        for row in cursor.fetchall():
            new_cache[row[0]] = {
                "ticker": row[0],
                "sample_count": row[1],
                "days_back": row[2],
                "p50_premium": row[3],
                "p75_premium": row[4],
                "p90_premium": row[5],
                "p95_premium": row[6],
                "p99_premium": row[7],
                "min_premium": row[8],
                "max_premium": row[9],
                "mean_premium": row[10],
                "last_refreshed": row[11],
            }

    _baselines_cache = new_cache
    _baselines_last_loaded = datetime.utcnow()
    log.info("[baselines] loaded %d ticker baselines into memory", len(new_cache))
    return len(new_cache)


def get_baseline(ticker: str) -> Optional[dict]:
    """Return the full baseline dict for `ticker` or None if missing.

    Lookup is uppercase-normalized.
    """
    if not ticker:
        return None
    return _baselines_cache.get(ticker.upper())


def get_premium_floor(ticker: str, grade: str) -> Optional[float]:
    """
    Return the premium floor for a (ticker, grade) pair, in dollars.

    Three-tier system based on flow frequency (trades per day in the
    baseline data). The same percentile means different things for a
    liquid name (NVDA, 76 trades/day) vs a sparse name (CDNS, 0.43/day).

    ┌─────────────────────────────────────────────────────────────────┐
    │ TIER 1: SPARSE   (<1 trade/day)                                 │
    │   For names like CDNS, SNPS — the FACT that institutional flow │
    │   appeared is the signal. Use permissive flat floors to let it │
    │   through, since Bullflow's $250K min + UCT alert match are    │
    │   already meaningful filters.                                   │
    │     A+ = $250K (essentially pass-through)                       │
    │     A  = $500K                                                  │
    │     B  = $1M                                                    │
    │                                                                 │
    │ TIER 2: MID      (1-5 trades/day)                               │
    │   Moderate flow. Use lower percentiles (P50/P75/P90) with       │
    │   sanity caps so outlier days don't distort. CBRS, ARM,        │
    │   smaller mid-caps land here.                                   │
    │     A+ = min(P50, $2M)                                          │
    │     A  = min(P75, $3M)                                          │
    │     B  = min(P90, $5M)                                          │
    │                                                                 │
    │ TIER 3: LIQUID   (≥5 trades/day)                                │
    │   Constant flow. Full percentile filtering with caps. NVDA,    │
    │   MU, TSLA, the active names.                                   │
    │     A+ = min(P75, $3M)                                          │
    │     A  = min(midpoint P75-P90, $5M)                             │
    │     B  = min(P95, $10M)                                         │
    │                                                                 │
    │ FALLBACK: no baseline or sample_count < MIN_SAMPLES (30)        │
    │   Static FALLBACK_FLOORS                                        │
    └─────────────────────────────────────────────────────────────────┘

    The hard caps (e.g. B never exceeds $10M) prevent outlier-distorted
    baselines (CDNS jumping to P95=$33M because of 50 samples skewed by
    recent massive blocks) from making the gate impossibly tight.

    Returns the dollar floor, or None for grades that are blocked entirely
    (C, D — except when a per-alert override allows them, e.g. Unusual
    Weeklies has min_grade=D in ALERT_CONVICTION_GATES).

    Strips emoji from grade ("A+ 🚀" → "A+") so callers don't need to.
    """
    # Normalize grade — "A+ 🚀" → "A+"
    g = (grade or "D").strip().split()[0] if grade else "D"

    # C and D blocked at this gate (Unusual Weeklies tier override
    # handled separately in worker via per-alert min_grade).
    if g in ("C", "D"):
        return None

    b = get_baseline(ticker)
    if not b or (b.get("sample_count") or 0) < MIN_SAMPLES:
        # Thin or missing baseline — use static fallback. Better to
        # err permissive on tickers we know little about than to block
        # legitimate flow based on insufficient data.
        return FALLBACK_FLOORS.get(g)

    # Categorize ticker by flow frequency
    n = b["sample_count"]
    days = max(b.get("days_back") or 1, 1)
    trades_per_day = n / days

    p50 = b["p50_premium"] or 0
    p75 = b["p75_premium"] or 0
    p90 = b["p90_premium"] or 0
    p95 = b["p95_premium"] or 0

    # TIER 1: Sparse — rare flow IS the signal
    if trades_per_day < 1.0:
        if g == "A+": return 250_000
        if g == "A":  return 500_000
        if g == "B":  return 1_000_000

    # TIER 2: Mid — moderate flow, light percentile filter
    if trades_per_day < 5.0:
        if g == "A+": return min(p50, 2_000_000) if p50 else 500_000
        if g == "A":  return min(p75, 3_000_000) if p75 else 600_000
        if g == "B":  return min(p90, 5_000_000) if p90 else 1_500_000

    # TIER 3: Liquid — full percentile filter with sanity caps
    if g == "A+":
        return min(p75, 3_000_000) if p75 else 600_000
    if g == "A":
        midpoint = (p75 + p90) / 2 if (p75 and p90) else (p75 or p90 or 1_000_000)
        return min(midpoint, 5_000_000)
    if g == "B":
        return min(p95, 10_000_000) if p95 else 2_000_000

    return None  # unreachable, but explicit


def get_percentile(ticker: str, premium: float) -> Optional[float]:
    """
    Return what percentile this premium represents for this ticker.

    Returns a float in [0, 100], or None if no baseline exists for this
    ticker (thin samples included — percentile estimate is meaningful even
    at lower confidence, just be cautious downstream).

    Used by the grade scorer to weight premium contribution by how unusual
    the size is for this specific ticker.
    """
    if not ticker or premium is None:
        return None
    b = _baselines_cache.get(ticker.upper())
    if not b:
        return None

    # Interpolate between known percentile anchors
    p50 = b["p50_premium"] or 0
    p75 = b["p75_premium"] or 0
    p90 = b["p90_premium"] or 0
    p95 = b["p95_premium"] or 0
    p99 = b["p99_premium"] or 0
    pmax = b["max_premium"] or 0

    if premium <= 0:
        return 0
    if premium >= pmax and pmax > 0:
        return 99.9
    if premium >= p99:
        return 99
    if premium >= p95:
        # Linear interp between P95 and P99
        return 95 + (premium - p95) / max(p99 - p95, 1) * 4
    if premium >= p90:
        return 90 + (premium - p90) / max(p95 - p90, 1) * 5
    if premium >= p75:
        return 75 + (premium - p75) / max(p90 - p75, 1) * 15
    if premium >= p50:
        return 50 + (premium - p50) / max(p75 - p50, 1) * 25
    # Below median — estimate against min
    pmin = b["min_premium"] or 0
    if premium >= pmin and p50 > pmin:
        return (premium - pmin) / (p50 - pmin) * 50
    return 0


def baseline_summary() -> dict:
    """Quick stats on the loaded baseline cache. Useful for /admin endpoints."""
    if not _baselines_cache:
        return {"loaded": False, "tickers": 0}

    by_quality = {"reliable": 0, "workable": 0, "thin": 0}
    for b in _baselines_cache.values():
        n = b.get("sample_count") or 0
        if n >= MIN_SAMPLES:
            by_quality["reliable"] += 1
        elif n >= 10:
            by_quality["workable"] += 1
        else:
            by_quality["thin"] += 1

    return {
        "loaded": True,
        "tickers": len(_baselines_cache),
        "last_loaded": _baselines_last_loaded.isoformat() if _baselines_last_loaded else None,
        "data_quality": by_quality,
        "min_samples_for_reliable": MIN_SAMPLES,
        "static_fallback_floors": FALLBACK_FLOORS,
    }
