"""
Backfill production FlowDB using patches generated offline from raw OPRA.

For 6/25 (and any other date with raw OPRA available offline), the patches
JSON contains the optimal Side and Color classifications computed via the
raw T-print tick test (Phase 2i). This script matches patches to production
rows by (Symbol, CallPut, Strike, ExpirationDate) and applies updates within
a time window to handle slight aggregation timing differences.

Matching strategy:
  1. Group patches by contract (Symbol + CP + Strike + Exp)
  2. Group production rows by same contract
  3. Within each contract, sort both by time
  4. Match patches to rows in order (chronological alignment)
  5. UPDATE Side if row has Side='' and patch has Side
  6. UPDATE Color if patch has stronger color (W < Y < M)
  7. UPDATE OI if patch has OI and row has 0

Idempotent: only updates fields that need updating.
"""
import json
import sqlite3
import logging
import os
from collections import defaultdict
from datetime import date as date_cls
from api.flow_db import FlowDB

logger = logging.getLogger(__name__)

# Color rank for upgrade comparisons (only upgrade WHITE -> Y/M, never downgrade)
_COLOR_RANK = {"WHITE": 0, "YELLOW": 1, "MAGENTA": 2, "ORANGE": 3, "#FF0000": 4}


def run_patches_backfill(patches_path: str, target_date: str) -> dict:
    """Apply offline-computed patches to production FlowDB rows.

    patches_path: path to JSON file with patches dict
    target_date: 'M/D/YYYY' format (e.g. '6/25/2026')

    Returns stats dict.
    """
    stats = {
        "target_date": target_date,
        "patches_file": patches_path,
        "patches_loaded": 0,
        "production_rows": 0,
        "side_updated": 0,
        "color_updated": 0,
        "oi_updated": 0,
        "unmatched_patches": 0,
        "unmatched_production_rows": 0,
    }

    if not os.path.exists(patches_path):
        return {**stats, "error": f"patches file not found: {patches_path}"}

    logger.info(f"[backfill] Loading patches from {patches_path}")
    with open(patches_path) as f:
        patches = json.load(f)
    stats["patches_loaded"] = len(patches)
    logger.info(f"[backfill] Loaded {len(patches):,} patches")

    # Group patches by contract (Symbol|CP|Strike|Exp)
    patches_by_contract = defaultdict(list)
    for key, patch in patches.items():
        parts = key.rsplit("|", 1)  # split off time
        if len(parts) != 2:
            continue
        contract_key, time_str = parts
        patches_by_contract[contract_key].append((time_str, patch))

    # Sort patches within each contract by time string (lexicographic
    # ordering of "H:MM:SS AM/PM" approximates chronological; not perfect
    # but good enough since within a contract trades are rare enough)
    db = FlowDB()
    with sqlite3.connect(db.db_path, timeout=30) as conn:
        # Load all production rows for target_date, grouped by contract
        cur = conn.execute(
            "SELECT rowid, Symbol, CallPut, Strike, ExpirationDate, "
            "       CreatedTime, Side, Color, OI "
            "FROM flow WHERE CreatedDate = ?",
            (target_date,)
        )
        rows = cur.fetchall()
        stats["production_rows"] = len(rows)
        logger.info(f"[backfill] {len(rows):,} production rows for {target_date}")

        # Group production rows by contract
        prod_by_contract = defaultdict(list)
        for r in rows:
            rowid, sym, cp, strike, exp, ctime, side, color, oi_str = r
            # Build matching key - try multiple strike formats
            strike_keys = []
            try:
                strike_f = float(strike)
                if strike_f == int(strike_f):
                    strike_keys.append(f"{sym}|{cp}|{int(strike_f)}|{exp}")
                strike_keys.append(f"{sym}|{cp}|{strike}|{exp}")
                strike_keys.append(f"{sym}|{cp}|{strike_f}|{exp}")
            except:
                strike_keys.append(f"{sym}|{cp}|{strike}|{exp}")
            for sk in set(strike_keys):
                prod_by_contract[sk].append(
                    (ctime, rowid, side, color, oi_str)
                )

        side_updates = []
        color_updates = []
        oi_updates = []

        # Match patches to production rows per contract
        for contract_key, contract_patches in patches_by_contract.items():
            prod_rows = prod_by_contract.get(contract_key, [])
            if not prod_rows:
                stats["unmatched_patches"] += len(contract_patches)
                continue

            # Sort both by time (chronologically — "H:MM:SS AM/PM" comparison
            # is tricky; convert to seconds-since-midnight)
            def time_key(t_str):
                try:
                    # Format: "H:MM:SS AM/PM" or "HH:MM:SS AM/PM"
                    t, ampm = t_str.strip().rsplit(" ", 1)
                    h, m, s = t.split(":")
                    secs = int(h) * 3600 + int(m) * 60 + int(s)
                    if ampm.upper() == "PM" and int(h) != 12:
                        secs += 12 * 3600
                    elif ampm.upper() == "AM" and int(h) == 12:
                        secs -= 12 * 3600
                    return secs
                except:
                    return 0

            sorted_patches = sorted(contract_patches, key=lambda x: time_key(x[0]))
            sorted_prod = sorted(prod_rows, key=lambda x: time_key(x[0]))

            # Match patches to production rows by time (within 60-sec window)
            # Greedy nearest-time matching
            used_prod = set()
            for pt_time, patch in sorted_patches:
                pt_secs = time_key(pt_time)
                best_match = None
                best_diff = 61  # 60s + 1 cutoff
                for i, (rt, rowid, side, color, oi_str) in enumerate(sorted_prod):
                    if i in used_prod:
                        continue
                    rt_secs = time_key(rt)
                    diff = abs(rt_secs - pt_secs)
                    if diff < best_diff:
                        best_diff = diff
                        best_match = i

                if best_match is None:
                    stats["unmatched_patches"] += 1
                    continue

                used_prod.add(best_match)
                rt, rowid, prod_side, prod_color, prod_oi_str = sorted_prod[best_match]

                # Apply updates only where production needs them
                patch_side = patch.get("side", "")
                patch_color = patch.get("color", "WHITE")
                patch_oi = patch.get("oi", 0)

                if patch_side and (not prod_side or prod_side == ""):
                    side_updates.append((patch_side, rowid))

                # Only upgrade Color (never downgrade)
                if _COLOR_RANK.get(patch_color, 0) > _COLOR_RANK.get(prod_color or "WHITE", 0):
                    color_updates.append((patch_color, rowid))

                # Update OI if production has 0 but patch has value
                if patch_oi > 0:
                    try:
                        prod_oi = int(prod_oi_str) if prod_oi_str and prod_oi_str != "" else 0
                    except:
                        prod_oi = 0
                    if prod_oi == 0:
                        oi_updates.append((str(patch_oi), rowid))

            stats["unmatched_production_rows"] += len(sorted_prod) - len(used_prod)

        # Apply updates in batch
        if side_updates:
            conn.executemany("UPDATE flow SET Side = ? WHERE rowid = ?", side_updates)
            stats["side_updated"] = len(side_updates)

        if color_updates:
            conn.executemany("UPDATE flow SET Color = ? WHERE rowid = ?", color_updates)
            stats["color_updated"] = len(color_updates)

        if oi_updates:
            conn.executemany("UPDATE flow SET OI = ? WHERE rowid = ?", oi_updates)
            stats["oi_updated"] = len(oi_updates)

        conn.commit()

    logger.info(f"[backfill] Done: {stats}")
    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys
    if len(sys.argv) < 3:
        print("Usage: python backfill_from_patches.py <patches.json> <date>")
        sys.exit(1)
    result = run_patches_backfill(sys.argv[1], sys.argv[2])
    print(json.dumps(result, indent=2))
