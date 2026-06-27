"""
Memory-efficient streaming version: process one contract at a time.

The Massive flat file is already contract-grouped + time-sorted within each
contract (verified). So we can stream-read in chunks, maintain a "pending
contract" buffer, and emit events as soon as the contract changes.

Peak memory: only the largest single contract's prints + the events list.
"""
import pandas as pd
import numpy as np
import datetime
import json
import os
import time
import gc
from collections import defaultdict

RAW_PATH = '/mnt/user-data/uploads/2026-06-26_csv.gz'
BBS_PATH = '/mnt/user-data/uploads/flow-data-6-26.csv'
OUT_PATH = '/mnt/user-data/outputs/patches-6-26.json'

CANCEL = {201, 203, 205, 207}
MULTI_LEG = set(range(232, 248))
SWEEP_CODES = {219}
BLOCK_CODES = {227, 228, 229, 230, 231}

AGG_WINDOW_NS = 100_000_000
MIN_PREMIUM = 10_000
ET_OFFSET = datetime.timezone(datetime.timedelta(hours=-4))

t0 = time.time()
def log(msg): print(f"[{time.time()-t0:6.1f}s] {msg}", flush=True)


def parse_opra_ticker(ticker):
    """O:AAPL260717C00200000 -> (root, date, cp, strike)"""
    s = ticker[2:] if ticker.startswith('O:') else ticker
    if len(s) < 15:
        return None
    suffix = s[-15:]
    root = s[:-15]
    try:
        yy = int(suffix[0:2])
        mm = int(suffix[2:4])
        dd = int(suffix[4:6])
        cp = 'CALL' if suffix[6] == 'C' else 'PUT'
        strike_int = int(suffix[7:])
        return root, datetime.date(2000 + yy, mm, dd), cp, strike_int / 1000.0
    except Exception:
        return None


def process_contract(ticker, ts_arr, px_arr, sz_arr, cd_arr, events_out, stats):
    """Process one contract's prints (already time-sorted). Append events.

    Phase 2i tick test: for each event, look at last raw print BEFORE event start.
    """
    parsed = parse_opra_ticker(ticker)
    if parsed is None:
        return
    root, exp, cp, strike = parsed

    nseg = len(ts_arr)
    if nseg == 0:
        return

    k = 0
    while k < nseg:
        m = k
        first_ts = ts_arr[k]
        while m + 1 < nseg and ts_arr[m + 1] - first_ts <= AGG_WINDOW_NS:
            m += 1
        sizes = sz_arr[k:m+1]
        prices = px_arr[k:m+1]
        codes = cd_arr[k:m+1]
        total_size = int(sizes.sum())
        if total_size <= 0:
            k = m + 1
            continue
        avg_price = float((prices * sizes).sum() / total_size)
        premium = avg_price * total_size * 100
        if premium < MIN_PREMIUM:
            k = m + 1
            continue
        # Type
        code_set = set(int(c) for c in codes)
        if code_set & MULTI_LEG:
            typ = 'ML/'
        elif code_set & SWEEP_CODES:
            typ = 'SWEEP'
        elif code_set & BLOCK_CODES:
            typ = 'BLOCK'
        else:
            typ = ''
        # Phase 2i tick test
        side = ''
        if k > 0:
            last_px = float(px_arr[k - 1])
            if last_px > 0:
                diff_pct = (avg_price - last_px) / last_px * 100
                if diff_pct > 5: side = 'AA'
                elif diff_pct > 0.5: side = 'A'
                elif diff_pct < -5: side = 'BB'
                elif diff_pct < -0.5: side = 'B'
                else:
                    for bi in range(k - 2, max(k - 22, -1), -1):
                        prev = float(px_arr[bi])
                        if abs(prev - last_px) > 0.001:
                            side = 'A' if last_px > prev else 'B'
                            break
        if side:
            stats['sided'] += 1
            stats[side] = stats.get(side, 0) + 1
        else:
            stats['blank'] += 1

        events_out.append((root, cp, strike, exp, int(first_ts),
                           total_size, avg_price, premium, typ, side))
        k = m + 1


# ============ Streaming read ============
log("Streaming raw OPRA file in chunks...")
events = []
stats = {'sided': 0, 'blank': 0}

# Buffer for current contract
cur_ticker = None
buf_ts, buf_px, buf_sz, buf_cd = [], [], [], []

n_chunks = 0
n_rows = 0
n_contracts = 0

CHUNK_SIZE = 500_000

for chunk in pd.read_csv(RAW_PATH, compression='gzip', chunksize=CHUNK_SIZE,
                          dtype={'ticker': str, 'price': np.float64,
                                 'sip_timestamp': np.int64, 'size': np.int64}):
    n_chunks += 1
    n_rows += len(chunk)
    # Drop rows with NA conditions and CANCEL rows
    chunk = chunk.dropna(subset=['conditions'])
    chunk['conditions'] = chunk['conditions'].astype(np.int32)
    chunk = chunk[~chunk['conditions'].isin(CANCEL)]
    if len(chunk) == 0:
        continue

    # Extract arrays once
    chunk_tickers = chunk['ticker'].to_numpy()
    chunk_ts = chunk['sip_timestamp'].to_numpy()
    chunk_px = chunk['price'].to_numpy()
    chunk_sz = chunk['size'].to_numpy()
    chunk_cd = chunk['conditions'].to_numpy()

    # Walk through chunk, splitting at ticker boundaries
    n = len(chunk_tickers)
    i = 0
    while i < n:
        t = chunk_tickers[i]
        # find run end within this chunk
        j = i
        while j + 1 < n and chunk_tickers[j + 1] == t:
            j += 1
        # is this the same as cur_ticker (continuation from previous chunk)?
        if cur_ticker is None:
            cur_ticker = t
        if t == cur_ticker:
            # Append to buffer
            buf_ts.extend(chunk_ts[i:j+1].tolist())
            buf_px.extend(chunk_px[i:j+1].tolist())
            buf_sz.extend(chunk_sz[i:j+1].tolist())
            buf_cd.extend(chunk_cd[i:j+1].tolist())
        else:
            # cur_ticker is done; flush it
            process_contract(cur_ticker,
                             np.array(buf_ts, dtype=np.int64),
                             np.array(buf_px, dtype=np.float64),
                             np.array(buf_sz, dtype=np.int64),
                             np.array(buf_cd, dtype=np.int32),
                             events, stats)
            n_contracts += 1
            buf_ts, buf_px, buf_sz, buf_cd = [], [], [], []
            cur_ticker = t
            buf_ts.extend(chunk_ts[i:j+1].tolist())
            buf_px.extend(chunk_px[i:j+1].tolist())
            buf_sz.extend(chunk_sz[i:j+1].tolist())
            buf_cd.extend(chunk_cd[i:j+1].tolist())
        i = j + 1

    if n_chunks % 5 == 0:
        log(f"  chunk {n_chunks}: rows={n_rows:,}, contracts done={n_contracts:,}, events={len(events):,}")

# Flush last contract
if cur_ticker and buf_ts:
    process_contract(cur_ticker,
                     np.array(buf_ts, dtype=np.int64),
                     np.array(buf_px, dtype=np.float64),
                     np.array(buf_sz, dtype=np.int64),
                     np.array(buf_cd, dtype=np.int32),
                     events, stats)
    n_contracts += 1

log(f"Streaming complete: {n_rows:,} rows, {n_contracts:,} contracts, {len(events):,} events")
total_sided = stats['sided']
log(f"Side: {total_sided:,}/{len(events):,} = {total_sided/max(len(events),1)*100:.1f}%")
for s in ('AA', 'A', 'B', 'BB'):
    log(f"  {s}={stats.get(s,0):,}")

# ============ Build patches ============
log("Building patches dict...")

def fmt_time(ts_ns):
    dt = datetime.datetime.fromtimestamp(ts_ns / 1e9, tz=ET_OFFSET)
    s = dt.strftime('%I:%M:%S %p')
    if s.startswith('0'):
        s = s[1:]
    return s

def fmt_strike(s):
    if s == int(s):
        return str(int(s))
    return ('%g' % s)

def fmt_exp(d):
    return f"{d.month}/{d.day}/{d.year}"

patches = {}
n_ml = 0
n_no_side = 0
for (root, cp, strike, exp, fts, tsz, ap, prem, typ, side) in events:
    if typ == 'ML/':
        n_ml += 1
        continue
    if not side:
        n_no_side += 1
        continue
    key = f"{root}|{cp}|{fmt_strike(strike)}|{fmt_exp(exp)}|{fmt_time(fts)}"
    patches[key] = {'side': side, 'color': 'WHITE', 'oi': 0}

log(f"Patches emitted: {len(patches):,}")
log(f"  ML/ skipped: {n_ml:,}")
log(f"  No side (skipped): {n_no_side:,}")

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, 'w') as f:
    json.dump(patches, f)
sz_mb = os.path.getsize(OUT_PATH) / (1024 * 1024)
log(f"Wrote {OUT_PATH} ({sz_mb:.1f} MB)")

print("\nSample patches:")
for k in list(patches.keys())[:8]:
    print(f"  {k}  ->  {patches[k]}")

# ============ BBS comparison ============
log("Loading BBS for comparison...")
bbs = pd.read_csv(BBS_PATH, dtype={'Premium': float, 'Strike': float, 'OI': 'Int64', 'Volume': 'Int64'})
bbs_count = len(bbs)
bbs_tickers = bbs['Symbol'].nunique()

def bbs_dir(row):
    s = str(row['Side']); cp = row['CallPut']
    if cp == 'CALL' and s in ('A','AA'): return 'BULL'
    if cp == 'PUT' and s in ('B','BB'): return 'BULL'
    if cp == 'PUT' and s in ('A','AA'): return 'BEAR'
    if cp == 'CALL' and s in ('B','BB'): return 'BEAR'
    return ''

bbs['_dir'] = bbs.apply(bbs_dir, axis=1)
bbs_bull = bbs[bbs['_dir'] == 'BULL']['Premium'].sum()
bbs_bear = bbs[bbs['_dir'] == 'BEAR']['Premium'].sum()

print(f"\n=== BBS 6/26 ===")
print(f"  Rows: {bbs_count:,}")
print(f"  Unique tickers: {bbs_tickers:,}")
print(f"  Bull premium: ${bbs_bull/1e6:.1f}M")
print(f"  Bear premium: ${bbs_bear/1e6:.1f}M")

massive_evts = [e for e in events if e[8] != 'ML/']
massive_tickers = len(set(e[0] for e in massive_evts))
mb = mbe = 0.0
for (root, cp, strike, exp, fts, tsz, ap, prem, typ, side) in massive_evts:
    if cp == 'CALL' and side in ('A','AA'): mb += prem
    elif cp == 'PUT' and side in ('B','BB'): mb += prem
    elif cp == 'PUT' and side in ('A','AA'): mbe += prem
    elif cp == 'CALL' and side in ('B','BB'): mbe += prem

print(f"\n=== Massive Phase 2i offline (non-ML/, >=${MIN_PREMIUM:,}) ===")
print(f"  Events: {len(massive_evts):,}")
print(f"  Unique tickers: {massive_tickers:,}")
print(f"  Bull premium: ${mb/1e6:.1f}M")
print(f"  Bear premium: ${mbe/1e6:.1f}M")

print(f"\n=== Massive offline / BBS ===")
print(f"  Events:  {len(massive_evts)/bbs_count*100:.0f}%")
print(f"  Tickers: {massive_tickers/bbs_tickers*100:.0f}%")
print(f"  Bull $:  {mb/bbs_bull*100:.0f}%")
print(f"  Bear $:  {mbe/bbs_bear*100:.0f}%")

log("DONE")
