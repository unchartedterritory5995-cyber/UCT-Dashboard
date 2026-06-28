"""
EOD Color rebuild — recompute Color per BBS-style conviction rules.

BBS official rules (from optionskey.pdf):
  - WHITE   : Open Interest has not been exceeded
  - YELLOW  : Open Interest exceeded in a SINGLE trade
  - PURPLE  : Open Interest exceeded in MULTIPLE trades (cumulative, no single trade)

We use the SAME rule but keep our existing color name mapping
(MAGENTA = our existing higher-conviction tier, YELLOW = our lower tier):
  - MAGENTA : MAX(single_trade_volume) for contract > contract_OI
              (Equivalent to BBS's Yellow — one decisive sweep/block exceeded OI)
  - YELLOW  : SUM(all_volume) for contract > contract_OI, but no single trade did
              (Equivalent to BBS's Purple — took multiple trades to exceed OI)
  - WHITE   : Neither condition met. Contract enters MONITORING state — check
              tomorrow's OI for position-building over time.

OI handling:
  - Production writes flow rows in real time; Phase 1 OI lookup may lag the write
    by 20+s. Rows that land with OI=0 don't necessarily mean the contract has no
    OI — it means the lookup hadn't completed yet.
  - We use MAX(OI) across all rows for a contract as the canonical OI for the
    evaluation (the value that was true AT MARKET CLOSE, once Phase 1 backfilled).
  - If MAX(OI) across all rows is 0, we can't evaluate; contract stays WHITE.

Idempotent: only upgrades WHITE -> YELLOW/MAGENTA. Never downgrades. Safe to
re-run any number of times.

Endpoint: POST /api/admin/massive/rebuild-color?target_date=6/26/2026

Returns:
{
  "target_date": "...",
  "rows_scanned": int,
  "contracts_evaluated": int,
  "contracts_already_classified": int,    # had a single trade > OI at write time
  "contracts_single_exceeded": int,        # MAX(single trade) > OI
  "contracts_cum_exceeded": int,           # SUM > OI but no single trade did
  "contracts_no_exceed": int,              # vol <= OI (MONITORING state)
  "contracts_no_oi": int,                  # MAX(OI) = 0, can't evaluate
  "rows_upgraded_to_magenta": int,
  "rows_upgraded_to_yellow": int,
  "rows_unchanged_white": int,
}
"""
import sqlite3
import logging
import os
from collections import defaultdict

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")


def _safe_int(v) -> int:
    """Parse Volume/OI stored as TEXT. Returns 0 on parse failure."""
    if v is None:
        return 0
    try:
        s = str(v).strip()
        if not s:
            return 0
        s = s.replace(",", "")
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def _normalize_strike(s) -> str:
    """Strike stored as TEXT but written variably ('1300', '1300.0', '1300.5').
    Normalize for grouping by contract."""
    try:
        f = float(s)
        if f == int(f):
            return str(int(f))
        return ("%g" % f)
    except (ValueError, TypeError):
        return str(s) if s is not None else ""


def run_color_rebuild(target_date: str) -> dict:
    """Rebuild Color for all rows on target_date using BBS conviction rules."""
    if not target_date:
        raise ValueError("target_date is required (format 'M/D/YYYY')")

    stats = {
        "target_date": target_date,
        "rows_scanned": 0,
        "contracts_evaluated": 0,
        "contracts_already_classified": 0,
        "contracts_single_exceeded": 0,
        "contracts_cum_exceeded": 0,
        "contracts_no_exceed": 0,
        "contracts_no_oi": 0,
        "rows_upgraded_to_magenta": 0,
        "rows_upgraded_to_yellow": 0,
        "rows_unchanged_white": 0,
    }

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        cur = conn.cursor()

        # Pull all rows for target_date
        cur.execute("""
            SELECT id, Symbol, CallPut, Strike, ExpirationDate,
                   Volume, OI, Color
            FROM flow
            WHERE CreatedDate = ?
        """, (target_date,))

        rows = cur.fetchall()
        stats["rows_scanned"] = len(rows)
        logger.info(f"[color_rebuild] scanned {len(rows):,} rows for {target_date}")

        if not rows:
            return stats

        # Build per-contract summaries:
        #   - all_rows[key]: list of (id, vol, color)
        #   - oi_max[key]:   max OI seen across the contract's rows (handles Phase 1 lag)
        #   - vol_max[key]:  max single-trade volume on the contract
        #   - vol_sum[key]:  cumulative volume across all trades
        all_rows = defaultdict(list)
        oi_max = defaultdict(int)
        vol_max = defaultdict(int)
        vol_sum = defaultdict(int)

        for r in rows:
            (rid, sym, cp, strike, exp, vol_s, oi_s, color) = r
            key = (sym, cp, _normalize_strike(strike), exp)
            vol = _safe_int(vol_s)
            oi = _safe_int(oi_s)
            current_color = (color or "WHITE").upper()
            all_rows[key].append({"id": rid, "vol": vol, "color": current_color})
            if oi > oi_max[key]:
                oi_max[key] = oi
            if vol > vol_max[key]:
                vol_max[key] = vol
            vol_sum[key] += vol

        stats["contracts_evaluated"] = len(all_rows)
        logger.info(f"[color_rebuild] {len(all_rows):,} unique contracts evaluated")

        # Decide target color per contract using BBS-aligned rules.
        # OUR mapping (keeps our existing higher-conviction = MAGENTA):
        #   MAGENTA if MAX(single trade volume) > OI  (BBS calls this Yellow)
        #   YELLOW  if SUM(volumes) > OI and not MAGENTA  (BBS calls this Purple)
        #   WHITE   otherwise (contract is in MONITORING state)
        contract_target = {}
        for key in all_rows:
            oi = oi_max[key]
            if oi <= 0:
                contract_target[key] = None
                stats["contracts_no_oi"] += 1
                continue
            if vol_max[key] > oi:
                contract_target[key] = "MAGENTA"
                stats["contracts_single_exceeded"] += 1
            elif vol_sum[key] > oi:
                contract_target[key] = "YELLOW"
                stats["contracts_cum_exceeded"] += 1
            else:
                contract_target[key] = None
                stats["contracts_no_exceed"] += 1

        # Apply: for each contract that should be classified, upgrade its WHITE
        # rows to the target color. Skip rows that already have a color
        # (we only ever upgrade WHITE; never overwrite a prior YELLOW/MAGENTA).
        magenta_ids = []
        yellow_ids = []
        for key, entries in all_rows.items():
            target = contract_target[key]
            if target is None:
                # Contract stays in MONITORING / unevaluable
                for e in entries:
                    if e["color"] == "WHITE":
                        stats["rows_unchanged_white"] += 1
                continue
            # Contract has a known classification.
            contract_has_prior_color = any(e["color"] != "WHITE" for e in entries)
            if contract_has_prior_color:
                stats["contracts_already_classified"] += 1
            for e in entries:
                if e["color"] == "WHITE":
                    if target == "MAGENTA":
                        magenta_ids.append(e["id"])
                    elif target == "YELLOW":
                        yellow_ids.append(e["id"])

        if magenta_ids:
            cur.executemany(
                "UPDATE flow SET Color = 'MAGENTA' WHERE id = ? AND Color = 'WHITE'",
                [(rid,) for rid in magenta_ids]
            )
            stats["rows_upgraded_to_magenta"] = len(magenta_ids)

        if yellow_ids:
            cur.executemany(
                "UPDATE flow SET Color = 'YELLOW' WHERE id = ? AND Color = 'WHITE'",
                [(rid,) for rid in yellow_ids]
            )
            stats["rows_upgraded_to_yellow"] = len(yellow_ids)

        conn.commit()
        logger.info(
            f"[color_rebuild] done: "
            f"upgraded MAGENTA={stats['rows_upgraded_to_magenta']:,}, "
            f"YELLOW={stats['rows_upgraded_to_yellow']:,}, "
            f"unchanged WHITE={stats['rows_unchanged_white']:,}"
        )
        return stats

    except Exception:
        conn.rollback()
        logger.exception("[color_rebuild] failed")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys, json
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if not target:
        print("Usage: python color_rebuild.py 6/26/2026")
        sys.exit(1)
    print(json.dumps(run_color_rebuild(target), indent=2))
