"""
Offline patches generator for backfilling a single date from raw Massive OPRA.

Reads a Massive trades flat file (2026-MM-DD_csv.gz), feeds it through
massive_processor.batch_process to get aggregated events with Type/Color
already classified, then applies tick-test Side classification per contract
(same logic as backfill_tick_test.py applied offline against the full day's
raw T-print history rather than the limited live deque).

Emits patches-DATE.json in the format backfill_from_patches.py expects:
  {
    "Symbol|CP|Strike|Exp|HH:MM:SS AM/PM": {
      "side": "A"/"B"/"",
      "color": "WHITE"/"YELLOW"/"MAGENTA",
      "oi": 0   # offline can't fetch OI; backfill script only updates OI
                # if patch.oi > 0, so this is a safe placeholder
    },
    ...
  }

Usage:
    python generate_patches.py <input.csv.gz> <output_patches.json>

Notes on Side classification:
- Without the quotes file, NBBO comparison isn't possible. Tick-test only.
- This matches Phase 2i quality (raw T-print tick test against full-day
  history), which Ravi's previous 6/25 backfill validated at 96% Side
  accuracy against BBS+Bullflow when run offline.
- Phase 1 improvements baked in: no AA/BB from tick test, mid-market
  trades stay neutral. Direction (A vs B) only.
"""
import gzip
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd

# Import the existing aggregator/classifier
sys.path.insert(0, str(Path(__file__).parent))
from massive_processor import batch_process, parse_occ, compute_color


ET = timezone(timedelta(hours=-4))


def _ns_to_et_string(ns: int) -> str:
    """Convert UTC nanosecond timestamp to '1:31:03 PM' ET format.

    Format matches what BBS / live worker write into FlowDB's CreatedTime,
    so backfill_from_patches.py can match by time-since-midnight comparison.
    """
    dt = datetime.fromtimestamp(ns / 1e9, tz=timezone.utc).astimezone(ET)
    # Strip leading zero from hour (e.g. "1:31:03 PM" not "01:31:03 PM")
    return dt.strftime('%I:%M:%S %p').lstrip('0')


def _tick_test_side(prev_price: float, this_price: float,
                    prev_diff: float | None) -> str:
    """Lee-Ready tick test with zero-tick fallback.

    Same logic as backfill_tick_test.py and the live worker's Phase 1
    classifier. Returns 'A', 'B', or ''.
    """
    if prev_price is None or prev_price <= 0:
        return ""
    tol = max(0.01, 0.005 * this_price)
    if this_price > prev_price + tol:
        return "A"
    if this_price < prev_price - tol:
        return "B"
    # Zero-tick: fall back to direction of last differing price
    if prev_diff is not None and prev_diff > 0:
        if prev_price > prev_diff + tol:
            return "A"
        if prev_price < prev_diff - tol:
            return "B"
    return ""


def generate_patches(input_path: str, output_path: str,
                     min_premium: float = 10_000,
                     min_volume: int = 50) -> dict:
    """Process raw OPRA trades file and emit patches.json.

    Returns stats dict.
    """
    print(f"[gen-patches] Loading {input_path}")

    # Load the gzipped CSV into a DataFrame
    df = pd.read_csv(input_path, compression='gzip')

    # Sanity-check column schema
    expected_cols = {'ticker', 'conditions', 'exchange', 'price',
                     'sip_timestamp', 'size'}
    missing = expected_cols - set(df.columns)
    if missing:
        raise ValueError(f"Input missing columns: {missing}")

    # Ensure sorted by sip_timestamp (should be already from Massive)
    df = df.sort_values('sip_timestamp').reset_index(drop=True)

    print(f"[gen-patches] Loaded {len(df):,} trades, "
          f"running batch_process (min_premium=${min_premium:,}, "
          f"min_volume={min_volume})...")

    events, proc_stats = batch_process(
        df,
        min_premium=min_premium,
        min_volume=min_volume,
    )
    print(f"[gen-patches] Aggregated to {len(events):,} events. "
          f"Aggregator stats: {proc_stats}")

    # Group events by contract for chronological tick-test classification.
    # Contract key matches what FlowDB stores.
    by_contract = defaultdict(list)
    skipped_parse = 0
    for evt in events:
        parsed = parse_occ(evt.ticker)
        if not parsed:
            skipped_parse += 1
            continue
        # Format strike to match FlowDB convention:
        # integer strikes as "300", fractional as "377.5"
        strike = parsed['strike']
        if strike == int(strike):
            strike_str = str(int(strike))
        else:
            strike_str = f"{strike:g}"
        # FlowDB's CallPut column stores "CALL"/"PUT" (long form), not C/P.
        # backfill_from_patches.py groups production rows by raw CallPut value,
        # so patches must use the long form to match.
        cp_long = parsed['cp']   # 'CALL' or 'PUT'
        exp_str = parsed['expiry'].strftime('%-m/%-d/%Y')  # "8/21/2026"
        contract_key = f"{parsed['root']}|{cp_long}|{strike_str}|{exp_str}"
        by_contract[contract_key].append(evt)

    if skipped_parse:
        print(f"[gen-patches] Skipped {skipped_parse:,} events with "
              f"unparseable OCC ticker")

    # Apply tick-test Side classification per contract
    patches = {}
    side_counts = defaultdict(int)
    color_counts = defaultdict(int)

    for contract_key, contract_events in by_contract.items():
        # Sort by first_ts_ns chronologically
        contract_events.sort(key=lambda e: e.first_ts_ns)

        prev_price = None
        prev_diff = None

        for evt in contract_events:
            # Compute Side via tick test
            side = _tick_test_side(prev_price, evt.avg_price, prev_diff)
            side_counts[side or 'empty'] += 1

            # Update prev_price tracking for next event
            if prev_price is not None and abs(evt.avg_price - prev_price) > 0.001:
                prev_diff = prev_price
            prev_price = evt.avg_price

            # Compute Color from premium + type
            color = compute_color(evt.premium, evt.type_,
                                  volume=evt.total_size, oi=0)
            color_counts[color] += 1

            # Build patch key (Symbol|CP|Strike|Exp|HH:MM:SS AM/PM)
            time_str = _ns_to_et_string(evt.first_ts_ns)
            patch_key = f"{contract_key}|{time_str}"

            patches[patch_key] = {
                "side": side,
                "color": color,
                "oi": 0,  # offline can't fetch OI; backfill skips OI when 0
            }

    # Write patches.json
    print(f"[gen-patches] Writing {len(patches):,} patches to {output_path}")
    with open(output_path, 'w') as f:
        json.dump(patches, f, separators=(',', ':'))

    out_stats = {
        "input_file": input_path,
        "output_file": output_path,
        "trades_loaded": len(df),
        "events_aggregated": len(events),
        "patches_written": len(patches),
        "skipped_parse": skipped_parse,
        "side_distribution": dict(side_counts),
        "color_distribution": dict(color_counts),
        "aggregator_stats": proc_stats,
    }
    print(f"[gen-patches] Done. Stats: {json.dumps(out_stats, indent=2, default=str)}")
    return out_stats


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python generate_patches.py <input.csv.gz> <output.json>")
        sys.exit(1)
    generate_patches(sys.argv[1], sys.argv[2])
