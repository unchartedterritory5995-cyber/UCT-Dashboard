"""Per-ticker IPO / first-listing date.

Source: Massive/Polygon `v3/reference/tickers` `list_date` (via
`massive.get_ticker_details`) — the SAME provider the chart's bars come from, so
the listing date the chart compares its first bar against is consistent with the
tape. `list_date` is the official first-listing day and never changes, so this is
cached aggressively (in-memory TTLCache + disk JSON under DATA_DIR, 30-day TTL).

Never raises — returns {"list_date": None} on any failure (and does NOT cache a
null, so a transient provider miss self-heals on the next view)."""
import json
import logging
import os
import re
import time

from api.services.cache import TTLCache

_logger = logging.getLogger(__name__)
_mem = TTLCache()
_TTL = 86400 * 30  # 30d — list_date is immutable; long cache is safe
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "ticker_ipo_cache")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _disk_path(ticker: str) -> str:
    return os.path.join(_CACHE_DIR, os.path.basename(f"{ticker}.json"))


def _disk_get(ticker: str):
    try:
        p = _disk_path(ticker)
        if time.time() - os.path.getmtime(p) > _TTL:
            return None
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _disk_put(ticker: str, data: dict) -> None:
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        tmp = _disk_path(ticker) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, _disk_path(ticker))
    except Exception as e:
        _logger.warning("ticker_ipo disk write failed for %s: %s", ticker, e)


def get_ipo_date(ticker: str) -> dict:
    """{"symbol", "list_date"} for a ticker — the official first-listing day
    (YYYY-MM-DD) or None. Cached mem+disk. Only a REAL date is cached; a miss
    returns None uncached so it re-attempts on the next view."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"symbol": sym, "list_date": None}
    ck = f"ticker_ipo_{sym}"
    hit = _mem.get(ck)
    if hit is not None:
        return hit
    d = _disk_get(sym)
    if d is not None:
        _mem.set(ck, d, ttl=_TTL)
        return d

    list_date = None
    try:
        from api.services import massive
        res = massive.get_ticker_details(sym) or {}
        ld = res.get("list_date")
        if isinstance(ld, str) and _ISO.match(ld.strip()):
            list_date = ld.strip()
    except Exception:
        list_date = None

    out = {"symbol": sym, "list_date": list_date}
    # Only persist a genuine date — a null (provider miss / no coverage) stays
    # uncached so a later view can still resolve it.
    if list_date:
        _mem.set(ck, out, ttl=_TTL)
        _disk_put(sym, out)
    return out
