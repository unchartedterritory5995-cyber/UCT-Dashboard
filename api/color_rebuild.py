"""
EOD Color rebuild — recomputes Color for flow rows whose Color was incorrectly
WHITE because OI was 0 at write time (Phase 1 OI backfill hadn't populated yet).

Production Color rules (from massive_ws_worker.py / patches generator):
  cum_volume_to_date >= 1.5 * OI  -> MAGENTA
  cum_volume_to_date  >    OI     -> YELLOW
  otherwise                        -> WHITE (no change)

This pass is needed because:
  - Production worker writes rows in real time; OI for many contracts is
    fetched on-demand by oi_fetch_manager which may lag the write by 20+ s.
  - Rows that landed in FlowDB with OI=0 stay Color=WHITE forever, even if
    by EOD their OI has been backfilled AND cumulative volume on the
    contract has long since exceeded OI.

The rebuild walks every row on target_date with Color='WHITE' and OI>0, sorts
its contract's rows by time, and re-evaluates Color using running cumulative
volume up to and including that row.

Rules:
  - IDEMPOTENT: only upgrades (WHITE -> YELLOW/MAGENTA). Never downgrades.
  - Considers all rows on target_date regardless of source ('stocks'/'indexes').
  - Skips rows where OI <= 0 (no information to evaluate against).

Endpoint: POST /api/admin/massive/rebuild-color?target_date=6/26/2026

Returns:
{
  "target_date": "6/26/2026",
  "rows_scanned": <int>,
  "rows_white_oi_pos": <int>,        # candidates: WHITE color + OI > 0
  "contracts_evaluated": <int>,
  "yellow_upgraded": <int>,           # WHITE -> YELLOW
  "magenta_upgraded": <int>,          # WHITE -> MAGENTA
  "no_change": <int>                  # candidates that stayed WHITE
}
"""
import sqlite3
import logging
import os
from collections import defaultdict

logger = logging.getLogger(__name__)

# Default DB path matches the rest of the project; main.py mounts /data
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# Color upgrade thresholds (production rules)
MAGENTA_MULTIPLIER = 1.5  # cum >= 1.5 * OI -> MAGENTA
# YELLOW threshold is implicitly cum > OI (anything between OI and 1.5*OI)


def _safe_int(v) -> int:
    """Parse Volume/OI which are stored as TEXT. Returns 0 on parse failure."""
    if v is None:
        return 0
    try:
        s = str(v).strip()
        if not s:
            return 0
        # Strip commas / decimal point handling
        s = s.replace(",", "")
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def _normalize_strike(s) -> str:
    """Strike is stored as TEXT but written variably ('1300', '1300.0', '1300.5').
    Normalize to canonical form for grouping by contract."""
    try:
        f = float(s)
        if f == int(f):
            return str(int(f))
        # Truncate trailing zeros
        return ("%g" % f)
    except (ValueError, TypeError):
        return str(s) if s is not None else ""


def run_color_rebuild(target_date: str) -> dict:
    """Rebuild Color for all candidate rows on target_date.

    target_date: 'M/D/YYYY' format (e.g. '6/26/2026'), matches the
                 CreatedDate TEXT column format produced by ingestion.
    """
    if not target_date:
        raise ValueError("target_date is required (format 'M/D/YYYY')")

    stats = {
        "target_date": target_date,
        "rows_scanned": 0,
        "rows_white_oi_pos": 0,
        "contracts_evaluated": 0,
        "yellow_upgraded": 0,
        "magenta_upgraded": 0,
        "no_change": 0,
    }

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        cur = conn.cursor()

        # Pull ALL rows for target_date (we need full contract series for cum vol).
        # Order so we walk contracts contiguously, time-sorted within contract.
        cur.execute("""
            SELECT id, Symbol, CallPut, Strike, ExpirationDate,
                   CreatedTime, Volume, OI, Color
            FROM flow
            WHERE CreatedDate = ?
        """, (target_date,))

        rows = cur.fetchall()
        stats["rows_scanned"] = len(rows)
        logger.info(f"[color_rebuild] scanned {len(rows):,} rows for {target_date}")

        if not rows:
            return stats

        # Group by contract: (Symbol, CallPut, normalized Strike, ExpirationDate)
        # For each contract, sort by CreatedTime ascending and compute running cum.
        by_contract = defaultdict(list)
        for r in rows:
            (rid, sym, cp, strike, exp, t, vol_s, oi_s, color) = r
            key = (sym, cp, _normalize_strike(strike), exp)
            by_contract[key].append({
                "id": rid,
                "time": t or "",
                "volume": _safe_int(vol_s),
                "oi": _safe_int(oi_s),
                "color": (color or "WHITE").upper(),
            })

        stats["contracts_evaluated"] = len(by_contract)
        logger.info(f"[color_rebuild] {len(by_contract):,} unique contracts")

        # Compute upgrades — collect (id, new_color) tuples
        yellow_updates = []   # list of row ids -> YELLOW
        magenta_updates = []  # list of row ids -> MAGENTA

        for contract_key, entries in by_contract.items():
            # Sort by CreatedTime — TEXT format like "3:47:22 PM" needs proper parse
            entries.sort(key=lambda e: _time_key(e["time"]))

            cum = 0
            for e in entries:
                cum += max(0, e["volume"])
                # Only consider upgrading rows that are currently WHITE
                if e["color"] != "WHITE":
                    continue
                if e["oi"] <= 0:
                    continue
                stats["rows_white_oi_pos"] += 1

                if cum >= MAGENTA_MULTIPLIER * e["oi"]:
                    magenta_updates.append(e["id"])
                elif cum > e["oi"]:
                    yellow_updates.append(e["id"])
                else:
                    stats["no_change"] += 1

        # Apply updates in batches
        if yellow_updates:
            cur.executemany(
                "UPDATE flow SET Color = 'YELLOW' WHERE id = ? AND Color = 'WHITE'",
                [(rid,) for rid in yellow_updates]
            )
            stats["yellow_upgraded"] = cur.rowcount if cur.rowcount >= 0 else len(yellow_updates)

        if magenta_updates:
            cur.executemany(
                "UPDATE flow SET Color = 'MAGENTA' WHERE id = ? AND Color = 'WHITE'",
                [(rid,) for rid in magenta_updates]
            )
            stats["magenta_upgraded"] = cur.rowcount if cur.rowcount >= 0 else len(magenta_updates)

        conn.commit()
        # Re-query for accurate counts (executemany rowcount can be -1 on some sqlite builds)
        stats["yellow_upgraded"] = len(yellow_updates)
        stats["magenta_upgraded"] = len(magenta_updates)

        logger.info(
            f"[color_rebuild] done: WHITE candidates={stats['rows_white_oi_pos']:,} "
            f"-> YELLOW={stats['yellow_upgraded']:,}, MAGENTA={stats['magenta_upgraded']:,}, "
            f"unchanged={stats['no_change']:,}"
        )
        return stats

    except Exception as e:
        conn.rollback()
        logger.exception("[color_rebuild] failed")
        raise
    finally:
        conn.close()


def _time_key(t: str):
    """Convert '3:47:22 PM' to a sortable tuple. Robust to empty / malformed."""
    t = (t or "").strip().upper()
    if not t:
        return (0, 0, 0)
    try:
        # Format: 'H:MM:SS AM/PM' or 'HH:MM:SS AM/PM'
        is_pm = t.endswith("PM")
        is_am = t.endswith("AM")
        if is_pm or is_am:
            t = t[:-2].strip()
        parts = t.split(":")
        if len(parts) < 3:
            return (0, 0, 0)
        h = int(parts[0])
        m = int(parts[1])
        s = int(parts[2])
        if is_pm and h != 12:
            h += 12
        elif is_am and h == 12:
            h = 0
        return (h, m, s)
    except (ValueError, IndexError):
        return (0, 0, 0)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys
    import json
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if not target:
        print("Usage: python color_rebuild.py 6/26/2026")
        sys.exit(1)
    result = run_color_rebuild(target)
    print(json.dumps(result, indent=2))
