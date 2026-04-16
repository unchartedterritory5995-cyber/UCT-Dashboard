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

# Disk TTLs — sized so the background refresh loop (32hr full cycle) can
# complete a full pass before ANY entry expires. Live WebSocket handles
# the current bar in real-time, so cached bars only need yesterday's close.
_DISK_TTL = {
    '5': 7200,      # 2 hours — intraday, refreshes during market hours
    '30': 14400,    # 4 hours
    '60': 28800,    # 8 hours
    'D': 172800,    # 48 hours — daily bars valid (today's bar is live via WebSocket)
    'W': 259200,    # 72 hours — weekly bars rarely change mid-week
}


def _path(ticker: str, tf: str, bars: int) -> str:
    return os.path.join(_CACHE_DIR, f"{ticker}_{tf}_{bars}.json")


def get(ticker: str, tf: str, bars: int):
    """Return cached payload dict or None if missing/expired/empty."""
    try:
        p = _path(ticker, tf, bars)
        age = time.time() - os.path.getmtime(p)
        if age > _DISK_TTL.get(tf, 14400):
            return None
        with open(p, 'r') as f:
            data = json.load(f)
        # Reject empty cached results — they should retry, not serve blank charts
        if not data.get("bars"):
            try:
                os.remove(p)
            except OSError:
                pass
            return None
        return data
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None


def purge_intraday():
    """Remove all cached intraday files so they refetch with updated settings."""
    try:
        if not os.path.isdir(_CACHE_DIR):
            return 0
        removed = 0
        for fname in os.listdir(_CACHE_DIR):
            if not fname.endswith('.json'):
                continue
            # Match intraday: *_5_*, *_30_*, *_60_*
            for tf in ('_5_', '_30_', '_60_'):
                if tf in fname:
                    try:
                        os.remove(os.path.join(_CACHE_DIR, fname))
                        removed += 1
                    except OSError:
                        pass
                    break
        return removed
    except Exception:
        return 0


def purge_empty():
    """Remove all cached files with empty bars arrays (from prior bugs)."""
    try:
        if not os.path.isdir(_CACHE_DIR):
            return 0
        removed = 0
        for fname in os.listdir(_CACHE_DIR):
            if not fname.endswith('.json'):
                continue
            p = os.path.join(_CACHE_DIR, fname)
            try:
                with open(p, 'r') as f:
                    data = json.load(f)
                if not data.get("bars"):
                    os.remove(p)
                    removed += 1
            except Exception:
                pass
        return removed
    except Exception:
        return 0


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
