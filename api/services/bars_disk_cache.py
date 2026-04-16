"""Persistent disk cache for OHLCV bar data.

Stores bar responses on Railway's /data/ persistent volume so they survive
redeploys and memory cache eviction.  3-layer cache hierarchy:

    1. In-memory TTLCache (fastest, ~0.001s, evicts after 5-15 min)
    2. Disk cache here  (fast, ~0.01s, persists 4-8 hours)
    3. Massive API       (slow, ~4-8s from Railway)
"""
import json
import os
import time

# Railway persistent volume mount, falls back to local ./data
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache")

# Disk TTLs — long enough that background pre-warm keeps them fresh.
# Intraday is shorter (market hours only), daily/weekly last most of the day.
_DISK_TTL = {
    '5': 900,       # 15 min — 5-min bars refresh reasonably often
    '30': 1800,     # 30 min
    '60': 3600,     # 1 hour
    'D': 14400,     # 4 hours — daily bars only change after market close
    'W': 28800,     # 8 hours — weekly bars only change end of week
}


def _path(ticker: str, tf: str, bars: int) -> str:
    return os.path.join(_CACHE_DIR, f"{ticker}_{tf}_{bars}.json")


def get(ticker: str, tf: str, bars: int):
    """Return cached payload dict or None if missing/expired."""
    try:
        p = _path(ticker, tf, bars)
        age = time.time() - os.path.getmtime(p)
        if age > _DISK_TTL.get(tf, 14400):
            return None
        with open(p, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None


def put(ticker: str, tf: str, bars: int, payload: dict):
    """Write payload to disk cache. Non-fatal on any failure."""
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        p = _path(ticker, tf, bars)
        tmp = p + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(payload, f, separators=(',', ':'))
        os.replace(tmp, p)  # Atomic write
    except Exception:
        pass
