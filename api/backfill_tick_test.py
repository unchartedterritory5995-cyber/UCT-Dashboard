"""
One-shot backfill script: apply tick-test logic to today's flow rows
that have Side='' (no Side classified at write time).

Reads each contract's flow rows chronologically. For rows with no Side,
applies tick test by comparing Price to the previous row's Price on
the same contract. Updates Side, then re-computes Color based on
cumulative Volume vs OI.

Idempotent: safe to run multiple times. Only updates rows with Side=''.

USAGE: POST /api/admin/massive/backfill-ticktest (or trigger via worker)
Deploy this file alongside the worker fix.
"""
import sqlite3
import logging
from datetime import date
from collections import defaultdict
from api.flow_db import FlowDB

logger = logging.getLogger(__name__)


def run_backfill(target_date: str = None) -> dict:
    """Apply tick-test fix retroactively. Returns stats dict.
    
    target_date: '6/26/2026' format. Defaults to today.
    """
    if target_date is None:
        today = date.today()
        target_date = f"{today.month}/{today.day}/{today.year}"
    
    logger.info(f"[backfill] Starting tick-test backfill for {target_date}")
    
    db = FlowDB()
    stats = {
        "target_date": target_date,
        "rows_scanned": 0,
        "rows_missing_side": 0,
        "rows_updated": 0,
        "tick_classified_A": 0,
        "tick_classified_B": 0,
        "no_signal": 0,
        "color_upgraded": 0,
    }
    
    with sqlite3.connect(db.db_path, timeout=30) as conn:
        # Phase 1: Read all rows for target_date, ordered by contract + time
        cur = conn.execute(
            "SELECT rowid, Symbol, CallPut, Strike, ExpirationDate, "
            "       CreatedTime, Price, Side, Color, Volume, OI "
            "FROM flow "
            "WHERE CreatedDate = ? "
            "ORDER BY Symbol, CallPut, Strike, ExpirationDate, CreatedTime",
            (target_date,)
        )
        rows = cur.fetchall()
        stats["rows_scanned"] = len(rows)
        
        if not rows:
            logger.warning(f"[backfill] No rows found for {target_date}")
            return stats
        
        # Phase 2: Group by contract, apply tick test
        updates_side = []  # (new_side, rowid)
        contract_cache = {}  # (sym,cp,strike,exp) -> (last_price, prev_diff)
        cumulative_vol = defaultdict(int)  # for color recompute
        
        for row in rows:
            rowid, sym, cp, strike, exp, ctime, price_str, side, color, vol_str, oi_str = row
            ckey = (sym, cp, strike, exp)
            
            # Parse numeric values safely
            try:
                price = float(price_str) if price_str else 0
                vol = int(vol_str) if vol_str else 0
                oi = int(oi_str) if oi_str and oi_str != '' else 0
            except (ValueError, TypeError):
                continue
            
            # Apply tick test if Side is empty
            if (not side or side == '') and price > 0:
                stats["rows_missing_side"] += 1
                tick = contract_cache.get(ckey)
                
                if tick is not None:
                    last_price, prev_diff = tick
                    tol = max(0.01, 0.005 * price)
                    new_side = None
                    if price > last_price + tol:
                        new_side = "A"
                    elif price < last_price - tol:
                        new_side = "B"
                    elif prev_diff is not None:
                        if last_price > prev_diff + tol:
                            new_side = "A"
                        elif last_price < prev_diff - tol:
                            new_side = "B"
                    
                    if new_side:
                        updates_side.append((new_side, rowid))
                        if new_side == "A":
                            stats["tick_classified_A"] += 1
                        else:
                            stats["tick_classified_B"] += 1
                    else:
                        stats["no_signal"] += 1
                else:
                    stats["no_signal"] += 1
            
            # Update tick cache for next event on this contract
            prev = contract_cache.get(ckey)
            if prev is None:
                contract_cache[ckey] = (price, None)
            else:
                old_last, old_prev = prev
                new_prev_diff = old_last if abs(price - old_last) > 0.001 else old_prev
                contract_cache[ckey] = (price, new_prev_diff)
            
            # Track cumulative volume for Color recompute
            cumulative_vol[ckey] += vol
        
        # Phase 3: Apply Side updates in batch
        if updates_side:
            conn.executemany(
                "UPDATE flow SET Side = ? WHERE rowid = ?",
                updates_side
            )
            stats["rows_updated"] = len(updates_side)
        
        # Phase 4: Color recompute pass
        # For WHITE rows that NOW have a Side (just upgraded), check if
        # cumulative volume now exceeds OI. If yes, upgrade Color.
        color_updates = []
        cur2 = conn.execute(
            "SELECT rowid, Symbol, CallPut, Strike, ExpirationDate, "
            "       Volume, OI, Color "
            "FROM flow WHERE CreatedDate = ? AND Color = 'WHITE'",
            (target_date,)
        )
        for row in cur2.fetchall():
            rowid, sym, cp, strike, exp, vol_str, oi_str, color = row
            ckey = (sym, cp, strike, exp)
            try:
                oi = int(oi_str) if oi_str and oi_str != '' else 0
            except:
                continue
            if oi <= 0:
                continue
            cum_vol = cumulative_vol.get(ckey, 0)
            new_color = None
            if cum_vol >= int(1.5 * oi):
                new_color = "MAGENTA"
            elif cum_vol > oi:
                new_color = "YELLOW"
            if new_color:
                color_updates.append((new_color, rowid))
        
        if color_updates:
            conn.executemany(
                "UPDATE flow SET Color = ? WHERE rowid = ?",
                color_updates
            )
            stats["color_upgraded"] = len(color_updates)
        
        conn.commit()
    
    logger.info(f"[backfill] Done: {stats}")
    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else None
    result = run_backfill(target)
    import json
    print(json.dumps(result, indent=2))
