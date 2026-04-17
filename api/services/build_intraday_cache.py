"""Build deep intraday cache by downloading 1-minute flat files from Massive S3
and resampling to 15min/30min/1hr bars.

Usage (run locally):
    python -m api.services.build_intraday_cache --days 160 --tfs 30

Resamples day-by-day to avoid memory issues (each day's minute data is
processed immediately, only resampled bars are accumulated).

Requires: MASSIVE_ACCESS_KEY, MASSIVE_SECRET_KEY in environment or .env
"""
import argparse
import csv
import gzip
import io
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta

# Load .env
for env_path in [
    os.path.join(os.path.dirname(__file__), '..', '..', '.env'),
    r'C:\Users\Patrick\uct-intelligence\.env',
]:
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip())


def get_s3_client():
    import boto3
    return boto3.client(
        's3',
        region_name='us-east-1',
        aws_access_key_id=os.environ['MASSIVE_ACCESS_KEY'],
        aws_secret_access_key=os.environ['MASSIVE_SECRET_KEY'],
        endpoint_url='https://files.massive.com',
    )


def download_and_resample(client, s3_key, timeframes, tickers_filter):
    """Download a day's minute CSV.GZ, resample to target TFs immediately.

    Returns: {tf_mult: {ticker: [resampled_bars]}} — only filtered tickers.
    """
    try:
        obj = client.get_object(Bucket='flatfiles', Key=s3_key)
        raw = gzip.decompress(obj['Body'].read())
    except Exception as e:
        return None

    # Parse minute bars grouped by ticker
    ticker_minutes = defaultdict(list)
    for line in raw.decode('utf-8').strip().split('\n')[1:]:  # skip header
        parts = line.split(',')
        if len(parts) < 7:
            continue
        sym = parts[0]
        if tickers_filter and sym not in tickers_filter:
            continue
        try:
            ts_s = int(parts[6]) // 1_000_000_000
            ticker_minutes[sym].append({
                't': ts_s,
                'o': float(parts[2]),  # open
                'h': float(parts[4]),  # high
                'l': float(parts[5]),  # low
                'c': float(parts[3]),  # close
                'v': int(float(parts[1])),  # volume
            })
        except (ValueError, IndexError):
            continue

    # Resample each ticker's minute bars to each target TF
    result = {tf: {} for tf in timeframes}
    for sym, bars in ticker_minutes.items():
        bars.sort(key=lambda b: b['t'])
        for tf_mult in timeframes:
            period = tf_mult * 60
            resampled = []
            current = None
            current_key = None
            for bar in bars:
                if tf_mult == 60:
                    # TC2000 hourly: 9:30-10:00, then 10-11, 11-12...
                    # Use 30-min boundaries so 9:30 stands alone
                    from datetime import datetime as _dt2
                    from zoneinfo import ZoneInfo as _ZI2
                    _bar_et = _dt2.fromtimestamp(bar['t'], tz=_ZI2("UTC")).astimezone(_ZI2("America/New_York"))
                    _mins = _bar_et.hour * 60 + _bar_et.minute
                    if _mins < 600:  # Before 10:00 → each 30-min bar own bucket
                        key = (bar['t'] // 1800) * 1800
                    else:  # 10:00+ → floor to hour
                        key = (bar['t'] // 3600) * 3600
                else:
                    key = (bar['t'] // period) * period
                if key != current_key:
                    if current:
                        resampled.append(current)
                    current = {'t': key, 'o': bar['o'], 'h': bar['h'],
                               'l': bar['l'], 'c': bar['c'], 'v': bar['v']}
                    current_key = key
                else:
                    current['h'] = max(current['h'], bar['h'])
                    current['l'] = min(current['l'], bar['l'])
                    current['c'] = bar['c']
                    current['v'] += bar['v']
            if current:
                resampled.append(current)
            if resampled:
                result[tf_mult][sym] = resampled

    return result


def build_cache(days=160, timeframes=None, output_dir=None, tickers_filter=None):
    if timeframes is None:
        timeframes = [15, 30, 60]
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'bars_cache_deep')

    os.makedirs(output_dir, exist_ok=True)

    if tickers_filter is None:
        cap_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'cap_universe.json')
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                tickers_filter = set(json.load(f))
            print(f"Filtering to {len(tickers_filter)} cap universe tickers")

    client = get_s3_client()
    to_date = datetime.now().date()
    from_date = to_date - timedelta(days=days)

    # Accumulate RESAMPLED bars per ticker (much smaller than minute data)
    accumulated = {tf: defaultdict(list) for tf in timeframes}
    processed = 0

    current = from_date
    while current <= to_date:
        if current.weekday() >= 5:
            current += timedelta(days=1)
            continue
        key = f"us_stocks_sip/minute_aggs_v1/{current.strftime('%Y/%m/%Y-%m-%d')}.csv.gz"
        print(f"  {current.strftime('%Y-%m-%d')}...", end=' ', flush=True)
        t0 = time.time()

        day_result = download_and_resample(client, key, timeframes, tickers_filter)
        if day_result is None:
            print("skip")
            current += timedelta(days=1)
            continue

        # Merge day's resampled bars into accumulator
        for tf_mult in timeframes:
            for sym, bars in day_result[tf_mult].items():
                accumulated[tf_mult][sym].extend(bars)

        processed += 1
        total_syms = len(day_result[timeframes[0]])
        print(f"{total_syms} tickers, {time.time()-t0:.1f}s")

        # Save incrementally every 10 days so partial progress survives restarts
        if processed % 10 == 0:
            _save_accumulated(accumulated, timeframes, output_dir, final=False)

        current += timedelta(days=1)

    print(f"\nDownloaded {processed} trading days")
    _save_accumulated(accumulated, timeframes, output_dir, final=True)


def _save_accumulated(accumulated, timeframes, output_dir, final=False):
    """Save accumulated bars to per-ticker JSON files."""
    for tf_mult in timeframes:
        tf_str = str(tf_mult)
        saved = 0
        for sym, bars in accumulated[tf_mult].items():
            bars.sort(key=lambda b: b['t'])
            trimmed = bars[-5000:]
            for b in trimmed:
                b['o'] = round(b['o'], 2)
                b['h'] = round(b['h'], 2)
                b['l'] = round(b['l'], 2)
                b['c'] = round(b['c'], 2)
            payload = {"ticker": sym, "tf": tf_str, "bars": trimmed}
            out_path = os.path.join(output_dir, f"{sym}_{tf_str}_5000.json")
            with open(out_path, 'w') as f:
                json.dump(payload, f, separators=(',', ':'))
            saved += 1
        if final:
            print(f"  {tf_str}min: {saved} tickers saved")

    total_files = len([f for f in os.listdir(output_dir) if f.endswith('.json')])
    print(f"\nDone! {total_files} files in {output_dir}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=160)
    parser.add_argument('--tfs', type=str, default='15,30,60')
    parser.add_argument('--output', type=str, default=None)
    args = parser.parse_args()
    build_cache(days=args.days, timeframes=[int(x) for x in args.tfs.split(',')], output_dir=args.output)
