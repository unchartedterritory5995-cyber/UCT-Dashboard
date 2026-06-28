"""
Generate patches-DATE-cancels.json — patches that tag cancel-class events
in FlowDB as Color='ARB'.

Rule (per coaching session 2026-06-28):
  1. Find all contracts that have ANY print with condition code in {202, 204}.
     These are "cancel-contaminated" contracts.
  2. For contaminated contracts: all prints with cond in {202, 204, 231} are
     part of the cancel cascade.
  3. For clean contracts: cond=231 is treated as a legitimate BLOCK (preserved).
  4. Aggregate filtered prints into 100ms events (matches build_patches.py
     pattern, so keys align with FlowDB rows).
  5. Emit patches with Color='ARB'.

Filter scenario B from validation (6/26 data):
  - 160 contracts cancel-contaminated (out of 365,354 total)
  - $621.12M of cancel-class notional caught
  - $695.98M of real cond=231 BLOCKs on clean contracts preserved

Usage:
  python build_cancel_patches.py /path/to/2026-06-26_csv.gz 2026-06-26 \
                                  /path/to/patches-6-26-cancels.json

Then in production, commit patches file and call:
  POST /api/admin/massive/apply-cancel-patches?patches_file=patches-6-26-cancels.json&target_date=6/26/2026
"""
import pandas as pd
import numpy as np
import json
import sys
import datetime
from collections import defaultdict

ET_OFFSET = datetime.timezone(datetime.timedelta(hours=-4))
AGG_WINDOW_NS = 100_000_000  # 100ms — matches existing patches generator
CANCEL_HARD = {202, 204}      # always cancel
LATE_REPORT = {231}            # cancel only on contaminated contracts


def parse_ticker(t: str):
    """OPRA ticker -> (root, exp_date, cp, strike). t format: 'O:AAPL260821C00150000'."""
    s = t[2:] if t.startswith("O:") else t
    suffix = s[-15:]
    root = s[:-15]
    yy, mm, dd = int(suffix[0:2]), int(suffix[2:4]), int(suffix[4:6])
    cp_letter = suffix[6]
    cp = "CALL" if cp_letter == "C" else "PUT"
    strike = int(suffix[7:]) / 1000.0
    return root, datetime.date(2000+yy, mm, dd), cp, strike


def fmt_strike(s: float) -> str:
    """Match patches-generator strike format: integer if no fractional, else float."""
    if s == int(s):
        return str(int(s))
    return ("%g" % s)


def fmt_exp(d: datetime.date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def fmt_time(ts_ns: int) -> str:
    """Convert ns timestamp to 'H:MM:SS AM/PM' format matching FlowDB CreatedTime."""
    dt = datetime.datetime.fromtimestamp(ts_ns / 1e9, tz=ET_OFFSET)
    h12 = dt.hour % 12 or 12
    ampm = "PM" if dt.hour >= 12 else "AM"
    return f"{h12}:{dt.minute:02d}:{dt.second:02d} {ampm}"


def main(opra_path: str, target_date_iso: str, out_path: str):
    print(f"Reading raw OPRA: {opra_path}")
    print(f"Target date: {target_date_iso}")

    # PASS 1: identify cancel-contaminated contracts (any cond in {202, 204})
    print("\nPass 1: identifying cancel-contaminated contracts...")
    contaminated = set()
    for chunk in pd.read_csv(opra_path, compression='gzip',
                             chunksize=1_000_000,
                             dtype={'ticker': str},
                             usecols=['ticker', 'conditions']):
        chunk = chunk.dropna(subset=['conditions'])
        chunk['conditions'] = chunk['conditions'].astype(int)
        mask = chunk['conditions'].isin(CANCEL_HARD)
        if mask.any():
            contaminated.update(chunk[mask]['ticker'].unique().tolist())
    print(f"  Contaminated contracts: {len(contaminated):,}")

    # PASS 2: collect prints to filter
    #   - cond in CANCEL_HARD: always
    #   - cond in LATE_REPORT AND ticker in contaminated: yes
    print("\nPass 2: collecting cancel-class prints...")
    all_filtered = []
    for chunk in pd.read_csv(opra_path, compression='gzip',
                             chunksize=1_000_000,
                             dtype={'ticker': str, 'price': np.float64,
                                    'size': np.int64, 'sip_timestamp': np.int64}):
        chunk = chunk.dropna(subset=['conditions'])
        chunk['conditions'] = chunk['conditions'].astype(int)
        is_hard = chunk['conditions'].isin(CANCEL_HARD)
        is_late_contam = (chunk['conditions'].isin(LATE_REPORT)
                          & chunk['ticker'].isin(contaminated))
        m = is_hard | is_late_contam
        if m.any():
            sub = chunk[m][['ticker', 'sip_timestamp', 'price', 'size', 'conditions']]
            all_filtered.append(sub.copy())

    if not all_filtered:
        print("No cancel prints found. Writing empty patches.")
        with open(out_path, 'w') as f:
            json.dump({}, f)
        return

    df = pd.concat(all_filtered, ignore_index=True)
    print(f"  Cancel-class prints: {len(df):,}")
    print(f"  Total filtered notional: ${(df['price']*df['size']*100).sum()/1e6:.2f}M")

    # PASS 3: aggregate prints into 100ms events per contract
    #         emit patches keyed by Symbol|CP|Strike|Exp|Time
    print("\nPass 3: aggregating into 100ms events and emitting patches...")
    patches = {}
    n_events = 0
    for ticker, grp in df.groupby('ticker', sort=False):
        root, exp_date, cp, strike = parse_ticker(ticker)
        grp = grp.sort_values('sip_timestamp').reset_index(drop=True)
        ts = grp['sip_timestamp'].to_numpy()
        sz = grp['size'].to_numpy()
        n = len(ts)
        i = 0
        while i < n:
            j = i
            while j + 1 < n and ts[j+1] - ts[i] <= AGG_WINDOW_NS:
                j += 1
            # Emit one patch per aggregated event
            event_ts = int(ts[i])  # first print in the cluster
            time_str = fmt_time(event_ts)
            key = f"{root}|{cp}|{fmt_strike(strike)}|{fmt_exp(exp_date)}|{time_str}"
            patches[key] = {"color": "ARB"}
            n_events += 1
            i = j + 1

    print(f"  Events generated: {n_events:,}")
    print(f"  Unique patch keys: {len(patches):,}")

    with open(out_path, 'w') as f:
        json.dump(patches, f, separators=(',', ':'))

    import os
    sz_mb = os.path.getsize(out_path) / 1e6
    print(f"\nWrote {out_path} ({sz_mb:.2f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python build_cancel_patches.py <opra.csv.gz> <YYYY-MM-DD> <out.json>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
