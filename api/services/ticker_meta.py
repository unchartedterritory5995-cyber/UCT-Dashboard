"""Per-ticker company metadata (name/sector/industry).

Source: yfinance .info (all three) with Finnhub profile2 fallback for
name/industry. In-memory TTLCache + disk-persisted JSON under /data,
24h TTL. Never raises — returns all-null on total failure (uncached)."""
import json
import logging
import os
import time

import requests

from api.services.cache import TTLCache

_logger = logging.getLogger(__name__)
_mem = TTLCache()
_TTL = 86400  # 24h
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "ticker_meta_cache")
_FINNHUB_BASE = "https://finnhub.io/api/v1"


def _fh_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "")


def _disk_path(ticker: str) -> str:
    return os.path.join(_CACHE_DIR, f"{ticker}.json")


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
        _logger.warning("ticker_meta disk write failed for %s: %s", ticker, e)


def _from_yfinance(ticker: str):
    import yfinance as yf
    info = yf.Ticker(ticker).info or {}
    name = info.get("longName") or info.get("shortName")
    return {
        "name": name or None,
        "sector": info.get("sector") or None,
        "industry": info.get("industry") or None,
    }


def _from_finnhub(ticker: str):
    key = _fh_key()
    if not key:
        return {"name": None, "sector": None, "industry": None}
    resp = requests.get(
        f"{_FINNHUB_BASE}/stock/profile2",
        params={"symbol": ticker, "token": key},
        timeout=15,
    )
    resp.raise_for_status()
    j = resp.json() or {}
    return {
        "name": (j.get("name") or None),
        "sector": None,  # Finnhub profile2 has no GICS sector
        "industry": (j.get("finnhubIndustry") or None),
    }


def get_ticker_meta(ticker: str) -> dict:
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"name": None, "sector": None, "industry": None}

    key = f"tmeta_{ticker}"
    hit = _mem.get(key)
    if hit is not None:
        return hit

    disk = _disk_get(ticker)
    if disk is not None:
        _mem.set(key, disk, ttl=_TTL)
        return disk

    data = {"name": None, "sector": None, "industry": None}
    try:
        data = _from_yfinance(ticker)
    except Exception as e:
        _logger.info("ticker_meta yfinance failed for %s: %s — trying Finnhub", ticker, e)
        try:
            data = _from_finnhub(ticker)
        except Exception as e2:
            _logger.warning("ticker_meta Finnhub failed for %s: %s", ticker, e2)
            data = {"name": None, "sector": None, "industry": None}

    if any(data.values()):
        _mem.set(key, data, ttl=_TTL)
        _disk_put(ticker, data)
    return data
