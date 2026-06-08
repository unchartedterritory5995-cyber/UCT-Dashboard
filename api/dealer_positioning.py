"""
dealer_positioning.py — Trade-aware estimate of dealer net positioning per
contract per day.

Background. Standard GEX math assumes all CALL OI is customer-long (dealer
short) and all PUT OI is customer-long (dealer short) — the "naive
convention". For index ETFs where retail predominantly buys protection,
this is roughly right. For single stocks where covered-call ETFs,
put-selling for income, and dealer hedges are common, it can be
materially wrong (sometimes flipped).

This service builds a flow-attributed estimate by:
  1. Reading today's OI from contract_oi_snapshots
  2. Computing ΔOI = today_OI - yesterday_OI
  3. Reading today's flow (ASK premium vs BID premium) from the flow table
  4. Attributing the ΔOI to BTO/STO based on flow side direction
  5. Updating cumulative est_customer_net per contract
  6. Recording a flow_confidence score per (contract, day)

Cold-start strategy: hybrid blend. On a contract's first appearance, seed
est_customer_net = SEED_RATIO * oi_today (default 0.5 — halfway between
naive assumption (1.0) and zero (0.0)). Subsequent days' flow data
refines the estimate toward truth, and the confidence score grows as
flow accumulates.

Integration touchpoints (handled in later phases):
  - main.py     → init_db() on startup (Phase 1 done)
  - oi_snapshots.daily_snapshot_job → call compute_positioning_for_date()
                  at the end so daily attribution runs immediately after
                  fresh OI lands (Phase 4)
  - gex_router  → accept ?adjusted=true and feed est_dealer_net into the
                  GEX math instead of assuming naive convention (Phase 5)

Schema lives in the same SQLite file as flow.db (/data/flow.db) since
this is purely derived from flow + contract_oi_snapshots.
"""

import sqlite3
import os
import logging
from datetime import date, datetime, timedelta
from typing import Optional, Iterable, Tuple, Dict, List
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# ── Tuning knobs ─────────────────────────────────────────────────────────
# Hybrid blend seed: est_customer_net = SEED_RATIO * oi_today on first
# appearance. 0.5 means halfway between naive assumption (1.0) and the
# clean-slate zero. Refines forward as flow data attributes ΔOI.
SEED_RATIO = 0.5

# Confidence floor — even with no flow today, we have *some* signal from
# the OI itself (naive base). Never report 0 confidence.
MIN_CONFIDENCE = 0.05

# Confidence calibration. Today's flow value relative to OI's notional
# value at which we call attribution "fully corroborated" (confidence
# saturates near 1.0). 0.10 means today's flow $ >= 10% of OI's $.
CONFIDENCE_FULL_THRESHOLD = 0.10

# Source restriction — matches oi_snapshots. Includes both stocks and
# indexes so SPY/QQQ/SPX etc. get the same trade-aware treatment as
# single-name stocks. The flow source field is uploaded per-CSV; SPY
# lives under "indexes", AAPL under "stocks".
SOURCES = ["stocks", "indexes"]


# ── Schema ────────────────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS dealer_positioning (
    contract_key       TEXT NOT NULL,
    snap_date          TEXT NOT NULL,        -- ISO YYYY-MM-DD (matches contract_oi_snapshots)
    symbol             TEXT NOT NULL,
    cp                 TEXT NOT NULL,        -- 'C' or 'P'
    strike             REAL NOT NULL,
    expiration         TEXT NOT NULL,        -- "M/D/YYYY" (matches flow table)
    oi                 INTEGER NOT NULL,
    oi_delta           INTEGER NOT NULL DEFAULT 0,
    ask_premium        REAL    NOT NULL DEFAULT 0,    -- today's ASK-side $ from flow
    bid_premium        REAL    NOT NULL DEFAULT 0,    -- today's BID-side $ from flow
    est_customer_net   REAL    NOT NULL,             -- contracts; +=long, -=short
    est_dealer_net     REAL    NOT NULL,             -- = -est_customer_net
    flow_confidence    REAL    NOT NULL,             -- 0..1
    is_seed            INTEGER NOT NULL DEFAULT 0,   -- 1 if cold-start seed row
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contract_key, snap_date)
);
CREATE INDEX IF NOT EXISTS idx_dp_date         ON dealer_positioning(snap_date);
CREATE INDEX IF NOT EXISTS idx_dp_symbol       ON dealer_positioning(symbol);
CREATE INDEX IF NOT EXISTS idx_dp_sym_date     ON dealer_positioning(symbol, snap_date);
"""


@contextmanager
def _conn():
    c = sqlite3.connect(DB_PATH, timeout=30.0)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db():
    """Create dealer_positioning table (idempotent). Call on app startup."""
    with _conn() as c:
        c.executescript(SCHEMA)
    logger.info("[dealer_positioning] init_db done")


# ── Date format helpers ──────────────────────────────────────────────────
# contract_oi_snapshots.snap_date is ISO (YYYY-MM-DD).
# flow.CreatedDate / flow.ExpirationDate are M/D/YYYY.
# We store snap_date as ISO and exp as M/D/YYYY to match each upstream
# table directly without forcing conversions on read.

def _parse_iso(s: str) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _parse_mdy(s: str) -> Optional[date]:
    if not s:
        return None
    try:
        m, d, y = map(int, s.split("/"))
        if y < 100:
            y += 2000
        return date(y, m, d)
    except (ValueError, AttributeError):
        return None


def _to_iso(d: date) -> str:
    return d.isoformat()


def _to_mdy(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def _previous_business_day(d: date) -> date:
    """Skip Sat/Sun. Doesn't handle holidays — the snapshot lookup will
    just return None for missing days and the algorithm handles that."""
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


# ── Core attribution algorithm ────────────────────────────────────────────
def attribute_delta(
    oi_yesterday: Optional[int],
    oi_today: int,
    ask_premium: float,
    bid_premium: float,
    prior_est_customer_net: Optional[float],
) -> Tuple[float, float, bool]:
    """Apply the per-contract OI delta attribution rule.

    Returns (est_customer_net_today, flow_confidence, is_seed).

    Rules:
      Cold start (no prior estimate):
        Seed est = SEED_RATIO * oi_today. Hybrid blend — halfway between
        naive convention (oi_today) and clean zero. Refines from here.

      ΔOI > 0 (positions opened):
        Direction = 2 * ask_ratio - 1   (range -1 to +1)
        Customer change = ΔOI * direction
          (all ASK → +ΔOI long; all BID → -ΔOI short; mixed → blend)

      ΔOI < 0 (positions closed):
        Reduce estimate proportionally to OI shrink rate. Assumes
        closing pressure is symmetric across the existing book — fair
        when we don't have side info on closes specifically.

      ΔOI = 0 (flat):
        Tiny nudge based on flow direction (1% of today's $K-flow).
        Captures churning where someone buys and someone sells in
        roughly equal volume.

    Confidence:
      Calibrated against today's flow $ vs OI's notional $. Uses a
      rough $100/contract avg — good enough for relative comparison
      across contracts. Floor at MIN_CONFIDENCE.
    """
    total_flow = ask_premium + bid_premium

    # ── Cold start ────────────────────────────────────────────────────
    if prior_est_customer_net is None:
        seed = SEED_RATIO * oi_today
        # Even on seed day, today's flow corroborates or contradicts
        # the seed. Boost confidence proportional to flow size.
        if oi_today > 0:
            flow_ratio = total_flow / (oi_today * 100 * 100)
            conf = MIN_CONFIDENCE + 0.2 * min(1.0, flow_ratio / CONFIDENCE_FULL_THRESHOLD)
        else:
            conf = MIN_CONFIDENCE
        return (seed, conf, True)

    # ── Normal day ────────────────────────────────────────────────────
    oi_delta = oi_today - (oi_yesterday or 0)

    if oi_delta > 0:
        if total_flow > 0:
            ask_ratio = ask_premium / total_flow
            direction = 2 * ask_ratio - 1  # -1..+1
            customer_change = oi_delta * direction
        else:
            # OI grew but no recorded directional flow — happens with
            # exchange-internal hedges, dark prints, or sparse data.
            # Hold position estimate flat; let next day with flow tell us.
            customer_change = 0.0
    elif oi_delta < 0:
        # Proportional shrink. If prior was net long 100 and OI dropped
        # 30%, we estimate 30 of those longs closed → net 70 long.
        if oi_yesterday and oi_yesterday > 0:
            shrink_ratio = oi_delta / oi_yesterday  # negative number
            customer_change = prior_est_customer_net * shrink_ratio
        else:
            customer_change = 0.0
    else:
        # Flat OI but flow happened — tiny directional nudge
        if total_flow > 0:
            ask_ratio = ask_premium / total_flow
            direction = 2 * ask_ratio - 1
            # Scale nudge to ~1% of flow's contract-equivalent count.
            # Assume $100/contract avg → divide by 10000.
            customer_change = direction * (total_flow / 10000) * 0.01
        else:
            customer_change = 0.0

    est_today = prior_est_customer_net + customer_change

    # Confidence
    if oi_today > 0:
        flow_ratio = total_flow / (oi_today * 100 * 100)
        conf = MIN_CONFIDENCE + (1 - MIN_CONFIDENCE) * min(
            1.0, flow_ratio / CONFIDENCE_FULL_THRESHOLD
        )
    else:
        conf = MIN_CONFIDENCE

    return (est_today, conf, False)


# ── Per-date compute pipeline ────────────────────────────────────────────
def compute_positioning_for_date(target_date_iso: str) -> Dict:
    """Run attribution for every contract that had an OI snapshot on
    target_date_iso. Reads from contract_oi_snapshots + flow, writes to
    dealer_positioning.

    Idempotent — re-running the same date overwrites that day's rows
    (via INSERT OR REPLACE).

    Returns summary dict for logging.
    """
    target_d = _parse_iso(target_date_iso)
    if not target_d:
        return {"error": "invalid date", "input": target_date_iso}

    target_mdy = _to_mdy(target_d)

    logger.info(
        f"[dealer_positioning] compute target={target_date_iso}"
    )

    with _conn() as c:
        # 1. Snapshot of all contracts seen today + their OI
        snap_rows = c.execute(
            "SELECT contract_key, oi FROM contract_oi_snapshots "
            "WHERE snap_date = ?",
            (target_date_iso,),
        ).fetchall()

        if not snap_rows:
            return {
                "date": target_date_iso,
                "skipped": True,
                "reason": "no OI snapshots for date",
            }

        today_oi: Dict[str, int] = {r["contract_key"]: r["oi"] for r in snap_rows}

        # 2. Most-recent prior OI per contract (strictly before target).
        # We don't assume prev_business_day because holidays, weekends, or
        # gaps in snapshot history can break that assumption. Find the
        # actual latest snap_date < target per contract.
        keys_today = list(today_oi.keys())
        prev_oi: Dict[str, int] = {}
        CHUNK = 500
        for i in range(0, len(keys_today), CHUNK):
            chunk = keys_today[i : i + CHUNK]
            placeholders = ",".join(["?"] * len(chunk))
            rows = c.execute(
                f"""
                SELECT s.contract_key, s.oi
                FROM contract_oi_snapshots s
                INNER JOIN (
                    SELECT contract_key, MAX(snap_date) AS max_dt
                    FROM contract_oi_snapshots
                    WHERE contract_key IN ({placeholders})
                      AND snap_date < ?
                    GROUP BY contract_key
                ) latest
                  ON s.contract_key = latest.contract_key
                 AND s.snap_date    = latest.max_dt
                """,
                (*chunk, target_date_iso),
            ).fetchall()
            for r in rows:
                prev_oi[r["contract_key"]] = r["oi"]

        # 3. Today's flow aggregated by contract.
        # Group by Symbol|CallPut|Strike|ExpirationDate to build keys
        # compatible with contract_key. We compute ASK premium (Side
        # in A/AA) and BID premium (Side in B/BB) separately. Premium
        # is TEXT in the table — CAST to REAL to sum.
        src_placeholders = ",".join(["?"] * len(SOURCES))
        flow_rows = c.execute(
            f"""
            SELECT
              Symbol,
              CallPut,
              Strike,
              ExpirationDate,
              SUM(CASE WHEN Side IN ('A','AA') THEN CAST(Premium AS REAL) ELSE 0 END) AS ask_prem,
              SUM(CASE WHEN Side IN ('B','BB') THEN CAST(Premium AS REAL) ELSE 0 END) AS bid_prem
            FROM flow
            WHERE source IN ({src_placeholders}) AND CreatedDate = ?
            GROUP BY Symbol, CallPut, Strike, ExpirationDate
            """,
            (*SOURCES, target_mdy),
        ).fetchall()

        # Build keyed flow map. Match the contract_key format from
        # oi_snapshots.make_key — SYM|CP|STRIKE_FLOAT|EXP_MDY.
        flow_by_key: Dict[str, Tuple[float, float]] = {}
        for r in flow_rows:
            sym = (r["Symbol"] or "").upper()
            cp_raw = (r["CallPut"] or "").upper()
            cp = "C" if cp_raw in ("C", "CALL") else "P" if cp_raw in ("P", "PUT") else None
            try:
                strike = float(r["Strike"])
            except (TypeError, ValueError):
                continue
            exp = r["ExpirationDate"] or ""
            if not (sym and cp and exp):
                continue
            key = f"{sym}|{cp}|{strike}|{exp}"
            flow_by_key[key] = (
                float(r["ask_prem"] or 0),
                float(r["bid_prem"] or 0),
            )

        # 4. Prior est_customer_net per contract — most recent row
        # in dealer_positioning for each contract_key with snap_date < target.
        # Same chunked subquery-join pattern we used for prev_oi.
        prior_est: Dict[str, float] = {}
        if keys_today:
            for i in range(0, len(keys_today), CHUNK):
                chunk = keys_today[i : i + CHUNK]
                placeholders = ",".join(["?"] * len(chunk))
                rows = c.execute(
                    f"""
                    SELECT dp.contract_key, dp.est_customer_net
                    FROM dealer_positioning dp
                    INNER JOIN (
                        SELECT contract_key, MAX(snap_date) AS max_dt
                        FROM dealer_positioning
                        WHERE contract_key IN ({placeholders})
                          AND snap_date < ?
                        GROUP BY contract_key
                    ) latest
                      ON dp.contract_key = latest.contract_key
                     AND dp.snap_date = latest.max_dt
                    """,
                    (*chunk, target_date_iso),
                ).fetchall()
                for r in rows:
                    prior_est[r["contract_key"]] = float(r["est_customer_net"])

        # 5. Apply attribution per contract + batch insert
        batch: List[Tuple] = []
        seed_count = 0
        normal_count = 0
        for ck, oi_t in today_oi.items():
            # Parse contract_key back into components
            try:
                sym, cp, strike_str, exp = ck.split("|", 3)
                strike = float(strike_str)
            except (ValueError, AttributeError):
                continue

            oi_y = prev_oi.get(ck)  # may be None
            ask_p, bid_p = flow_by_key.get(ck, (0.0, 0.0))
            prior = prior_est.get(ck)  # may be None (cold start)

            est, conf, is_seed = attribute_delta(
                oi_yesterday=oi_y,
                oi_today=oi_t,
                ask_premium=ask_p,
                bid_premium=bid_p,
                prior_est_customer_net=prior,
            )

            if is_seed:
                seed_count += 1
            else:
                normal_count += 1

            oi_delta = oi_t - (oi_y or 0)
            batch.append(
                (
                    ck,
                    target_date_iso,
                    sym,
                    cp,
                    strike,
                    exp,
                    oi_t,
                    oi_delta,
                    ask_p,
                    bid_p,
                    est,
                    -est,  # est_dealer_net
                    conf,
                    1 if is_seed else 0,
                )
            )

        # Write — INSERT OR REPLACE makes the operation idempotent
        # (re-running for the same date overwrites that day's rows)
        if batch:
            c.executemany(
                """
                INSERT OR REPLACE INTO dealer_positioning
                  (contract_key, snap_date, symbol, cp, strike, expiration,
                   oi, oi_delta, ask_premium, bid_premium,
                   est_customer_net, est_dealer_net, flow_confidence, is_seed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )

    summary = {
        "date": target_date_iso,
        "contracts_processed": len(today_oi),
        "seeded": seed_count,
        "normal_attribution": normal_count,
        "with_flow": sum(1 for k in today_oi if k in flow_by_key),
        "flow_contracts_total": len(flow_by_key),
    }
    logger.info(f"[dealer_positioning] done: {summary}")
    return summary


# ── Backfill ──────────────────────────────────────────────────────────────
def backfill_all(start_iso: Optional[str] = None, end_iso: Optional[str] = None) -> Dict:
    """Process every date with OI snapshots, in chronological order,
    so cumulative est_customer_net builds correctly.

    Caller can restrict the range with start_iso / end_iso (both ISO).
    Defaults to ALL dates present in contract_oi_snapshots.

    Safe to re-run — each per-date compute uses INSERT OR REPLACE.
    Re-running from scratch produces identical output.
    """
    with _conn() as c:
        q = "SELECT DISTINCT snap_date FROM contract_oi_snapshots"
        bounds = []
        clauses = []
        if start_iso:
            clauses.append("snap_date >= ?")
            bounds.append(start_iso)
        if end_iso:
            clauses.append("snap_date <= ?")
            bounds.append(end_iso)
        if clauses:
            q += " WHERE " + " AND ".join(clauses)
        q += " ORDER BY snap_date ASC"
        dates = [r["snap_date"] for r in c.execute(q, bounds).fetchall()]

    if not dates:
        return {"error": "no OI snapshots found", "start": start_iso, "end": end_iso}

    logger.info(
        f"[dealer_positioning] backfill {len(dates)} dates "
        f"({dates[0]} → {dates[-1]})"
    )

    per_day = []
    for d in dates:
        summary = compute_positioning_for_date(d)
        per_day.append(summary)

    return {
        "dates_processed": len(dates),
        "start": dates[0],
        "end": dates[-1],
        "per_day": per_day,
    }


# ── Read API (used by GEX router in Phase 5) ─────────────────────────────
def get_positioning_for_ticker(
    symbol: str, snap_date_iso: Optional[str] = None
) -> List[Dict]:
    """Return the latest known dealer positioning for every contract on
    a ticker, optionally pinned to a specific date. If snap_date_iso is
    None, returns the most recent row per contract.
    """
    symbol = symbol.upper().strip()
    with _conn() as c:
        if snap_date_iso:
            rows = c.execute(
                """
                SELECT * FROM dealer_positioning
                WHERE symbol = ? AND snap_date = ?
                ORDER BY expiration, strike
                """,
                (symbol, snap_date_iso),
            ).fetchall()
        else:
            # Latest row per contract for this symbol
            rows = c.execute(
                """
                SELECT dp.*
                FROM dealer_positioning dp
                INNER JOIN (
                    SELECT contract_key, MAX(snap_date) AS max_dt
                    FROM dealer_positioning
                    WHERE symbol = ?
                    GROUP BY contract_key
                ) latest
                  ON dp.contract_key = latest.contract_key
                 AND dp.snap_date = latest.max_dt
                ORDER BY dp.expiration, dp.strike
                """,
                (symbol,),
            ).fetchall()

    return [dict(r) for r in rows]


def get_attribution_days_for_ticker(symbol: str) -> int:
    """How many distinct dates we have positioning data for this ticker.
    Used in the UI to show 'Using N days of flow attribution' badge.
    """
    symbol = symbol.upper().strip()
    with _conn() as c:
        row = c.execute(
            "SELECT COUNT(DISTINCT snap_date) AS n FROM dealer_positioning WHERE symbol = ?",
            (symbol,),
        ).fetchone()
        return int(row["n"] if row else 0)


def get_avg_confidence_for_ticker(symbol: str, snap_date_iso: Optional[str] = None) -> float:
    """OI-weighted average flow_confidence across all contracts for a
    ticker on a given date. Used for the top-level 'overall confidence'
    indicator in the UI.
    """
    symbol = symbol.upper().strip()
    with _conn() as c:
        if snap_date_iso:
            row = c.execute(
                """
                SELECT
                  SUM(flow_confidence * oi) / NULLIF(SUM(oi), 0) AS avg_conf
                FROM dealer_positioning
                WHERE symbol = ? AND snap_date = ?
                """,
                (symbol, snap_date_iso),
            ).fetchone()
        else:
            # Use the latest snap_date for the symbol
            row = c.execute(
                """
                WITH latest AS (
                  SELECT MAX(snap_date) AS dt FROM dealer_positioning WHERE symbol = ?
                )
                SELECT SUM(flow_confidence * oi) / NULLIF(SUM(oi), 0) AS avg_conf
                FROM dealer_positioning
                WHERE symbol = ? AND snap_date = (SELECT dt FROM latest)
                """,
                (symbol, symbol),
            ).fetchone()
        val = row["avg_conf"] if row else None
        return float(val) if val is not None else 0.0
