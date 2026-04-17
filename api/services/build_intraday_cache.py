"""Build deep intraday cache by downloading 1-minute flat files from Massive S3
and resampling to 15min/30min/1hr bars.

Usage (run locally):
    python -m api.services.build_intraday_cache --days 160 --tfs 30

This downloads ~160 trading days of 1-minute data from S3, resamples to
the requested timeframes, and saves per-ticker JSON files in the same
format as the bars_cache directory. Upload to Railway's /data/bars_cache/
for instant chart loading.

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

# Load .env from uct-intelligence if available
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


def list_minute_files(client, from_date, to_date):
    """List available minute agg files in the date range."""
    files = []
    current = from_date
    while current <= to_date:
        key = f"us_stocks_sip/minute_aggs_v1/{current.strftime('%Y/%m/%Y-%m-%d')}.csv.gz"
        files.append((current, key))
        current += timedelta(days=1)
    return files


def download_and_parse(client, s3_key):
    """Download a CSV.GZ file from S3 and parse into per-ticker minute bars."""
    try:
        obj = client.get_object(Bucket='flatfiles', Key=s3_key)
        raw = gzip.decompress(obj['Body'].read())
    except Exception as e:
        print(f"  Skip {s3_key}: {e}")
        return {}

    tickers = defaultdict(list)
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8')))
    for row in reader:
        sym = row.get('ticker', '')
        if not sym:
            continue
        try:
            ts_ns = int(row['window_start'])
            ts_s = ts_ns // 1_000_000_000  # nanoseconds to seconds
            tickers[sym].append({
                't': ts_s,
                'o': float(row['open']),
                'h': float(row['high']),
                'l': float(row['low']),
                'c': float(row['close']),
                'v': int(float(row['volume'])),
            })
        except (ValueError, KeyError):
            continue
    return dict(tickers)


def resample_bars(minute_bars, multiplier):
    """Resample 1-minute bars to N-minute bars."""
    if not minute_bars:
        return []
    # Sort by timestamp
    minute_bars.sort(key=lambda b: b['t'])
    period = multiplier * 60  # seconds per bar
    resampled = []
    current = None
    current_key = None

    for bar in minute_bars:
        key = (bar['t'] // period) * period
        if key != current_key:
            if current:
                resampled.append(current)
            current = {
                't': key,
                'o': bar['o'],
                'h': bar['h'],
                'l': bar['l'],
                'c': bar['c'],
                'v': bar['v'],
            }
            current_key = key
        else:
            current['h'] = max(current['h'], bar['h'])
            current['l'] = min(current['l'], bar['l'])
            current['c'] = bar['c']
            current['v'] += bar['v']

    if current:
        resampled.append(current)
    return resampled


def build_cache(days=160, timeframes=None, output_dir=None, tickers_filter=None):
    """Main entry point: download S3 minute data and build resampled cache."""
    if timeframes is None:
        timeframes = [15, 30, 60]
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'bars_cache_deep')

    os.makedirs(output_dir, exist_ok=True)

    # Load cap universe for ticker filtering
    if tickers_filter is None:
        cap_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'cap_universe.json')
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                tickers_filter = set(json.load(f))
            print(f"Filtering to {len(tickers_filter)} cap universe tickers")
        else:
            tickers_filter = None  # No filter, process all

    client = get_s3_client()
    to_date = datetime.utcnow().date()
    from_date = to_date - timedelta(days=days)

    files = list_minute_files(client, from_date, to_date)
    print(f"Processing {len(files)} days from {from_date} to {to_date}")

    # Accumulate all minute bars per ticker across all days
    all_bars = defaultdict(list)
    processed = 0

    for date, key in files:
        # Skip weekends
        if date.weekday() >= 5:
            continue
        print(f"  Downloading {date.strftime('%Y-%m-%d')}...", end=' ', flush=True)
        t0 = time.time()
        day_data = download_and_parse(client, key)
        if not day_data:
            print("no data")
            continue

        for sym, bars in day_data.items():
            if tickers_filter and sym not in tickers_filter:
                continue
            all_bars[sym].extend(bars)

        processed += 1
        elapsed = time.time() - t0
        print(f"{len(day_data)} tickers, {elapsed:.1f}s")

    print(f"\nDownloaded {processed} trading days, {len(all_bars)} tickers")

    # Resample and save
    for tf_mult in timeframes:
        tf_str = str(tf_mult)
        saved = 0
        for sym, bars in all_bars.items():
            resampled = resample_bars(bars, tf_mult)
            if not resampled:
                continue
            # Keep last 5000 bars
            resampled = resampled[-5000:]
            # Round OHLC
            for b in resampled:
                b['o'] = round(b['o'], 2)
                b['h'] = round(b['h'], 2)
                b['l'] = round(b['l'], 2)
                b['c'] = round(b['c'], 2)
            payload = {"ticker": sym, "tf": tf_str, "bars": resampled}
            out_path = os.path.join(output_dir, f"{sym}_{tf_str}_5000.json")
            with open(out_path, 'w') as f:
                json.dump(payload, f, separators=(',', ':'))
            saved += 1

        print(f"  {tf_str}min: saved {saved} ticker files ({len(all_bars)} processed)")

    print(f"\nCache built in {output_dir}")
    print(f"Total files: {sum(len(os.listdir(output_dir)) for _ in [1])}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build deep intraday cache from S3 minute data')
    parser.add_argument('--days', type=int, default=160, help='Number of calendar days to download')
    parser.add_argument('--tfs', type=str, default='15,30,60', help='Comma-separated timeframe multipliers')
    parser.add_argument('--output', type=str, default=None, help='Output directory')
    args = parser.parse_args()

    tfs = [int(x) for x in args.tfs.split(',')]
    build_cache(days=args.days, timeframes=tfs, output_dir=args.output)
