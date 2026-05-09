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

from api.services import bar_validation
from api.services import bar_quarantine
from api.services import bar_provenance

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


_DEEP_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars_cache_deep")


def _path(ticker: str, tf: str, bars: int) -> str:
    return os.path.join(_CACHE_DIR, f"{ticker}_{tf}_{bars}.json")


def get_deep(ticker: str, tf: str, bars: int):
    """Return deep cache payload (from S3 minute resampling) or None.

    Deep cache has no TTL — the data is historical and doesn't expire.
    Built by build_intraday_cache.py from S3 minute flat files.
    """
    try:
        p = os.path.join(_DEEP_CACHE_DIR, f"{ticker}_{tf}_{bars}.json")
        with open(p, 'r') as f:
            data = json.load(f)
        if not data.get("bars"):
            return None
        return data
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None


def get(ticker: str, tf: str, bars: int):
    """Return cached payload dict (with quarantined bars filtered out) or None.

    None is returned when the file is missing, expired, empty, or every
    bar in it has been quarantined since write. Filtering quarantined
    bars on read closes the loop with the audit engine: a bad bar that
    slipped through earlier disappears from served data on next access.
    """
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

        # Filter out any bars that have been quarantined since cache write.
        # Non-dict bars (legacy/sentinel passthrough) are kept as-is — they
        # have no `t` to match against the quarantine table.
        try:
            bad_times = bar_quarantine.quarantined_times(ticker, tf)
        except Exception:
            bad_times = set()
        if bad_times:
            data = dict(data)
            data["bars"] = [
                b for b in data["bars"]
                if not isinstance(b, dict) or b.get("t") not in bad_times
            ]

        if not data.get("bars"):
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


def _atomic_write(payload: dict, ticker: str, tf: str, bars: int) -> None:
    """Atomic disk write — tmp file then os.replace. Non-fatal on failure."""
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        p = _path(ticker, tf, bars)
        tmp = p + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(payload, f, separators=(',', ':'))
        os.replace(tmp, p)  # Atomic write
    except Exception:
        pass


def put(ticker: str, tf: str, bars: int, payload: dict):
    """Validate every bar; cache only clean bars; quarantine corrupt ones.

    Non-fatal on any failure. Empty payloads (no bars) and payloads where
    every bar fails validation are NOT cached — they should retry, not
    serve corrupt charts.

    Backward-compat: if NO bar in the payload is a dict (e.g. internal
    test seeds using sentinel ints), the payload is written through
    unchanged without validation. Production payloads from bars_fetch.py
    always contain dict bars.
    """
    raw_bars = payload.get("bars") or []
    if not raw_bars:
        return

    # Backward-compat passthrough: pure-sentinel seeds skip validation.
    if not any(isinstance(b, dict) for b in raw_bars):
        _atomic_write(payload, ticker, tf, bars)
        return

    clean_bars: list[dict] = []
    prior_close = None
    source = payload.get("source") or "unknown"
    for bar in raw_bars:
        # Skip non-dict bars — they can't be validated. In production this
        # never happens; in tests it can be a sentinel value.
        if not isinstance(bar, dict):
            continue
        try:
            ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
        except Exception:
            # Validation must never break the write path
            ok, reasons = False, ["validator raised"]
        if ok:
            clean_bars.append(bar)
            prior_close = bar.get("c")
            # Record provenance for the clean bar — observability sidecar.
            # Must NEVER break the cache write path.
            try:
                bar_provenance.record(ticker, tf, int(bar.get("t") or 0), source)
            except Exception:
                pass
        else:
            try:
                bar_quarantine.add(
                    ticker, tf, int(bar.get("t") or 0),
                    "; ".join(reasons),
                    source=payload.get("source"),
                )
            except Exception:
                # Quarantine table issues must never break the cache write path
                pass

    if not clean_bars:
        return  # don't cache empty

    safe_payload = dict(payload)
    safe_payload["bars"] = clean_bars
    safe_payload["validated_at"] = int(time.time())
    _atomic_write(safe_payload, ticker, tf, bars)


def delete(ticker: str, tf: str | None = None) -> int:
    """Delete every disk-cache entry matching ``ticker`` and (optionally)
    ``tf``. Returns the number of files removed. Non-fatal on any per-file
    error.

    Used by the refresh-bars admin endpoint. Matches the fan-out of
    ``_path(ticker, tf, bars)`` — the filename pattern is
    ``{TICKER}_{tf}_{bars}.json`` (see _path) so we glob to remove all
    bars-counts for that (ticker, tf) pair, or all (ticker, *) if tf
    is omitted."""
    if not os.path.isdir(_CACHE_DIR):
        return 0
    ticker_up = ticker.upper()
    removed = 0
    try:
        for name in os.listdir(_CACHE_DIR):
            if not name.endswith(".json"):
                continue
            base = name[:-5]  # strip .json
            parts = base.split("_")
            if len(parts) < 3:
                continue
            f_ticker, f_tf = parts[0], parts[1]
            if f_ticker != ticker_up:
                continue
            if tf is not None and f_tf != tf:
                continue
            try:
                os.remove(os.path.join(_CACHE_DIR, name))
                removed += 1
            except OSError:
                pass
    except OSError:
        pass
    return removed
