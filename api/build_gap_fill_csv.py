"""
Build a BBS-format CSV from raw OPRA flat file for daily gap-fill.

Purpose: backfill rows that the production worker missed due to WebSocket
disconnects during market hours. Massive's T+1 flat file is authoritative
(it's the same OPRA tape the worker subscribes to, just delivered as a
static file after market close).

Workflow:
  1. Run this script offline against the raw OPRA file:
       python build_gap_fill_csv.py /path/to/2026-06-26_csv.gz \
                                     2026-06-26 \
                                     fill-6-26.csv
  2. Commit fill-6-26.csv to api/ in the repo
  3. POST /api/admin/massive/apply-gap-fill?fill_file=fill-6-26.csv&source=stocks
     (then again with source=indexes)
  4. FlowDB.insert_csv dedupes — existing rows preserved, missed rows inserted

Aggregation logic mirrors the production worker's TradeAggregator:
  - 100ms sliding-gap window per (ticker, rounded price)
  - Drop CANCEL_CONDITIONS prints (201, 202, 203, 204, 205, 207)
  - Type classification by OPRA condition codes (ML/, SWEEP, BLOCK)
  - min_volume = 50, min_premium = $10K (production defaults)

What's NOT computed offline (left empty, handled by later admin endpoints):
  - Side classification (use build_patches.py + Phase 2i tick test instead)
  - Color (use /api/admin/massive/rebuild-color after gap-fill)
  - OI (use existing OI snapshot infrastructure)
  - MktCap, Sector, Spot (enriched on subsequent BBS uploads or worker fills)

Output: BBS CSV ready for FlowDB.insert_csv.
"""
import pandas as pd
import numpy as np
import sys
import datetime
from collections import defaultdict
from dataclasses import dataclass
from typing import List

ET = datetime.timezone(datetime.timedelta(hours=-4))

# Match worker defaults exactly
MIN_VOLUME = 50
MIN_PREMIUM = 10_000
WINDOW_NS = 500_000_000  # 500ms (widened 2026-07-03 to match massive_processor.py;
                          # 100ms was splitting cross-exchange sweeps into BLOCKs)

# Match the FIXED CANCEL set (includes 202, 204)
CANCEL_CONDITIONS = {201, 202, 203, 204, 205, 207}

MULTI_LEG_CONDITIONS = set(range(232, 248))
ISO_CONDITION = 219
SINGLE_LEG_CONDITIONS = {227, 228, 229, 230, 231}

# 2026-07-10: exchange-breadth override — a burst spanning >= this many venues
# is a SWEEP even when a stray single-leg (227-231) print is bucketed with it
# (a genuine single-leg trade is one exchange). Runs BEFORE the single-leg BLOCK
# check; conservative 4 leaves real 1-2 venue blocks as BLOCK. Lower to 2 to
# fully match BBS. KEEP IN SYNC with massive_processor.py.
SWEEP_BREADTH_OVERRIDE = 4

# Same INDEX_SYMBOLS list as massive_processor — these route to indexes table
INDEX_SYMBOLS = {
    "SPX", "SPXW", "NDX", "NDXW", "NDXP", "RUT", "RUTW",
    "VIX", "VIXW", "OEX", "DJX", "XSP",
    "MRUT", "MNDX",
}


@dataclass
class Event:
    ticker: str
    root: str
    cp: str  # 'CALL' or 'PUT'
    strike: float
    expiry: datetime.date
    avg_price: float
    total_size: int
    premium: float
    first_ts_ns: int
    last_ts_ns: int
    n_exchanges: int
    conditions_seen: set
    type_: str


def parse_occ(ticker: str):
    """Parse 'O:NVDA260619C00200000' -> (root, exp, cp, strike)."""
    if not ticker.startswith("O:"):
        return None
    s = ticker[2:]
    if len(s) < 16:
        return None
    suffix = s[-15:]
    root = s[:-15]
    try:
        yy = int(suffix[0:2])
        mm = int(suffix[2:4])
        dd = int(suffix[4:6])
        cp_letter = suffix[6]
        strike = int(suffix[7:]) / 1000.0
        expiry = datetime.date(2000 + yy, mm, dd)
        cp = "CALL" if cp_letter == "C" else "PUT"
        return root, expiry, cp, strike
    except (ValueError, IndexError):
        return None


def classify_type(conditions_seen, n_exchanges) -> str:
    """Match massive_processor's type classification.

    2026-07-03: fallback threshold lowered from >= 3 to >= 2 exchanges.
    Matches BBS's treatment of 2-exchange same-price bursts as sweeps.
    See massive_processor.py comment for evidence trace.

    2026-07-10: exchange breadth now wins OVER single-leg conditions. A burst
    spanning >= SWEEP_MIN_EXCHANGES venues is an intermarket sweep even when a
    stray single-leg (227-231) print lands in the same aggregation window.
    Previously that single-leg print short-circuited the whole event to BLOCK
    before the breadth test ran. Evidence: HUBS 195C 12/18 on 7/8 — a 15-
    exchange, condition-209 sweep (BBS: SWEEP, side A, $2.3M) was mislabeled
    BLOCK because two small 227 prints were bucketed with it, which then
    blocked the empty-side ASK rescue (sweep_empty_side_as_ask) and hid it.
    KEEP IN SYNC with massive_processor.py's classifier.
    """
    if conditions_seen & MULTI_LEG_CONDITIONS:
        return "ML/"
    if ISO_CONDITION in conditions_seen:
        return "SWEEP"
    # Breadth beats a stray single-leg print (see docstring / HUBS 7/8).
    if n_exchanges >= SWEEP_BREADTH_OVERRIDE:
        return "SWEEP"
    if conditions_seen & SINGLE_LEG_CONDITIONS:
        return "BLOCK"
    return "SWEEP" if n_exchanges >= 2 else "BLOCK"


def fmt_date(d: datetime.date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def fmt_time(ts_ns: int) -> str:
    dt = datetime.datetime.fromtimestamp(ts_ns / 1e9, tz=ET)
    h12 = dt.hour % 12 or 12
    ampm = "PM" if dt.hour >= 12 else "AM"
    return f"{h12}:{dt.minute:02d}:{dt.second:02d} {ampm}"


def fmt_strike(s: float) -> str:
    if s == int(s):
        return str(int(s))
    return f"{s:.1f}".rstrip("0").rstrip(".")


def fmt_price(p: float) -> str:
    s = f"{p:.4f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def aggregate(prints_df: pd.DataFrame) -> List[Event]:
    """Run the 500ms sliding-gap aggregation per ticker.
    Mirrors TradeAggregator semantics.

    Fix 3 (2026-07-03): bucket keyed by ticker only (was ticker + rounded_price).
    Sweeps that walk prices ($81.80 -> $82.80 in 700ms) now merge into one
    event with weighted-avg price, matching BBS/Bullflow behavior."""
    events = []
    # Sort by timestamp globally so per-bucket logic works
    prints_df = prints_df.sort_values('sip_timestamp').reset_index(drop=True)

    # Group by ticker first (we don't care about cross-ticker order beyond sip_ts)
    for ticker, grp in prints_df.groupby('ticker', sort=False):
        # Single per-ticker bucket now (was per rounded_price)
        bucket = None  # list of (ts, price, size, exch, cond) or None
        # Process in time order
        for r in grp.itertuples():
            cond = int(r.conditions)
            if cond in CANCEL_CONDITIONS:
                continue
            if r.size <= 0 or r.price <= 0:
                continue
            tick = (r.sip_timestamp, r.price, r.size, r.exchange, cond)
            if bucket is not None:
                last_ts = bucket[-1][0]
                gap = r.sip_timestamp - last_ts
                if gap > WINDOW_NS:
                    # close old bucket, start new
                    evt = _build_event(ticker, bucket)
                    if evt is not None:
                        events.append(evt)
                    bucket = [tick]
                else:
                    bucket.append(tick)
            else:
                bucket = [tick]
        # Flush remaining bucket at end of ticker stream
        if bucket:
            evt = _build_event(ticker, bucket)
            if evt is not None:
                events.append(evt)

    return events


def _build_event(ticker, bucket):
    """Build an Event from a bucket. Returns None if below filters."""
    if not bucket:
        return None
    total_size = sum(b[2] for b in bucket)
    if total_size < MIN_VOLUME:
        return None
    avg_price = sum(b[1] * b[2] for b in bucket) / total_size
    premium = sum(b[1] * b[2] for b in bucket) * 100.0
    if premium < MIN_PREMIUM:
        return None
    parsed = parse_occ(ticker)
    if parsed is None:
        return None
    root, expiry, cp, strike = parsed
    conditions = {b[4] for b in bucket}
    exchanges = {b[3] for b in bucket}
    return Event(
        ticker=ticker, root=root, cp=cp, strike=strike, expiry=expiry,
        avg_price=avg_price, total_size=total_size, premium=premium,
        first_ts_ns=bucket[0][0], last_ts_ns=bucket[-1][0],
        n_exchanges=len(exchanges), conditions_seen=conditions,
        type_=classify_type(conditions, len(exchanges)),
    )


# BBS CSV columns (must match FlowDB COLUMNS order)
BBS_COLUMNS = [
    "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume", "Price", "Side",
    "CallPut", "Strike", "Spot", "Premium", "ExpirationDate", "Color",
    "ImpliedVolatility", "Dte", "ER", "StockEtf", "Sector", "Uoa", "Weekly",
    "MktCap", "OI",
]


def event_to_row(evt: Event, target_date_str: str, source: str) -> str:
    """Format event as a BBS CSV row matching the FlowDB schema."""
    stock_etf = "INDEX" if evt.root in INDEX_SYMBOLS else ("ETF" if source == "indexes" else "STOCK")
    dte = (evt.expiry - datetime.date.fromisoformat(target_date_str)).days
    if dte < 0:
        dte = 0
    weekly = "T" if evt.expiry.weekday() != 4 or not (15 <= evt.expiry.day <= 21) else "F"
    row = {
        "CreatedDate": fmt_date(datetime.date.fromisoformat(target_date_str)),
        "CreatedTime": fmt_time(evt.first_ts_ns),
        "Symbol": evt.root,
        "Type": evt.type_,
        "Volume": str(evt.total_size),
        "Price": fmt_price(evt.avg_price),
        # 2026-07-03: Empty-side SWEEP normalization (Option 3 at ingest).
        # Type=SWEEP with unknown side -> presume A (buyer-initiated).
        # Matches generate_patches.py normalization so OptionsFlow's
        # client-side clustering sees consistent ask-side attribution.
        # BLOCKs stay empty -- dealer/hedge/rebalance ambiguity.
        "Side": "A" if evt.type_ == "SWEEP" else "",
        "CallPut": evt.cp,
        "Strike": fmt_strike(evt.strike),
        "Spot": "0",
        "Premium": str(int(evt.premium)),
        "ExpirationDate": fmt_date(evt.expiry),
        "Color": "WHITE",  # rebuilt by /api/admin/massive/rebuild-color later
        "ImpliedVolatility": "0",
        "Dte": str(dte),
        "ER": "F",
        "StockEtf": stock_etf,
        "Sector": "",
        "Uoa": "F",
        "Weekly": weekly,
        "MktCap": "0",
        "OI": "0",
    }
    return ",".join(row.get(c, "") for c in BBS_COLUMNS)


def main(opra_path: str, target_date_iso: str, out_path: str):
    print(f"Reading raw OPRA: {opra_path}")
    print(f"Target date: {target_date_iso}")

    # Stream the file in chunks (multi-GB potential)
    print("\nStreaming OPRA file...")
    all_prints = []
    n_chunks = 0
    for chunk in pd.read_csv(opra_path, compression='gzip',
                             chunksize=1_000_000,
                             dtype={'ticker': str,
                                    'price': np.float64,
                                    'size': np.int64,
                                    'sip_timestamp': np.int64,
                                    'exchange': np.int32}):
        chunk = chunk.dropna(subset=['conditions'])
        chunk['conditions'] = chunk['conditions'].astype(int)
        all_prints.append(chunk[['ticker', 'sip_timestamp', 'price', 'size',
                                  'exchange', 'conditions']].copy())
        n_chunks += 1
        if n_chunks % 5 == 0:
            print(f"  {n_chunks * 1_000_000:,} prints processed...")
    df = pd.concat(all_prints, ignore_index=True)
    print(f"  Total prints: {len(df):,}")

    print("\nAggregating into events (100ms sliding window per ticker-price)...")
    events = aggregate(df)
    print(f"  Events generated: {len(events):,}")

    # Split stocks vs indexes
    stocks = [e for e in events if e.root not in INDEX_SYMBOLS]
    indexes = [e for e in events if e.root in INDEX_SYMBOLS]
    print(f"  Stocks events: {len(stocks):,}")
    print(f"  Indexes events: {len(indexes):,}")

    # Write two CSVs
    base = out_path.rsplit(".", 1)[0]
    stocks_path = f"{base}-stocks.csv"
    indexes_path = f"{base}-indexes.csv"

    for evts, src, path in [(stocks, "stocks", stocks_path),
                             (indexes, "indexes", indexes_path)]:
        with open(path, "w") as f:
            f.write(",".join(BBS_COLUMNS) + "\n")
            for evt in evts:
                f.write(event_to_row(evt, target_date_iso, src) + "\n")
        sz_kb = round(__import__("os").path.getsize(path) / 1024, 1)
        print(f"\nWrote {path} ({sz_kb} KB, {len(evts)} rows)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python build_gap_fill_csv.py <opra.csv.gz> <YYYY-MM-DD> <out.csv>")
        print("Produces two output files: <out>-stocks.csv and <out>-indexes.csv")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
