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


def _base_meta(ticker: str) -> dict:
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
        data = {"name": None, "sector": None, "industry": None}

    # Fall back to Finnhub whenever the NAME is still missing — NOT only when the
    # whole payload is empty. yfinance's .info is flaky and often returns a PARTIAL
    # response (GICS sector/industry present but longName/shortName absent); the
    # old `not any(data.values())` gate saw the sector/industry and skipped the
    # fallback, permanently caching name=None. That was the "some tickers show no
    # company name in the header/watermark" bug (424 of ~4,060 tickers — every one
    # of them had sector+industry but a null name). Merge field-by-field so
    # yfinance's accurate GICS sector/industry are KEPT and only the missing name
    # (and industry, if blank) are taken from Finnhub.
    if not data.get("name"):
        try:
            fh = _from_finnhub(ticker)
            data = {
                "name": data.get("name") or fh.get("name"),
                "sector": data.get("sector") or fh.get("sector"),
                "industry": data.get("industry") or fh.get("industry"),
            }
        except Exception as e2:
            _logger.warning("ticker_meta Finnhub failed for %s: %s", ticker, e2)

    if any(data.values()):
        _mem.set(key, data, ttl=_TTL)
        _disk_put(ticker, data)
    return data


# Tier priority: a ticker's "core" theme beats "relevant" beats "peripheral".
_TIER_RANK = {"core": 0, "relevant": 1, "peripheral": 2}


def _primary_theme(ticker: str):
    """The single most-relevant UCT theme NAME for a ticker, or None.

    Delegates to groups.resolve_primary_theme so the theme shown here and the
    peers the /charts Groups mode fills always agree (tier-first, factor
    buckets excluded). Lazy import avoids a module-load cycle. Never raises."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None
    try:
        from api.services.groups import resolve_primary_theme
        row = resolve_primary_theme(ticker)
        return (row or {}).get("theme_name") or None
    except Exception as e:
        _logger.info("ticker_meta theme lookup failed for %s: %s", ticker, e)
        return None


def get_ticker_meta(ticker: str) -> dict:
    """{name, sector, industry, theme}. name/sector/industry are 24h-cached
    (yfinance → Finnhub); theme is the live UCT-taxonomy primary theme."""
    base = _base_meta(ticker)
    return {**base, "theme": _primary_theme(ticker)}


_HEAL_FLAG = os.path.join(os.environ.get("DATA_DIR", "/data"), ".ticker_meta_name_heal_v1")


def heal_nameless_names() -> None:
    """One-shot: backfill the company NAME for disk-cached entries poisoned by the
    old partial-yfinance bug (sector/industry present but name=None). The 24h disk
    cache means those entries keep serving name=None until they expire, so the
    _base_meta fix alone wouldn't fix them promptly — this rewrites them now.

    Fetches JUST the name from Finnhub (cheap), keeps the existing GICS
    sector/industry, and rewrites in place. Rate-limited to ~55/min (under the
    Finnhub free-tier 60/min), best-effort per ticker, runs in a background
    daemon, flag-gated so it runs once. Safe no-op without a Finnhub key."""
    import glob
    import threading

    if os.path.exists(_HEAL_FLAG):
        return
    if not _fh_key():
        return

    def _run():
        healed = 0
        scanned = 0
        try:
            files = glob.glob(os.path.join(_CACHE_DIR, "*.json"))
        except Exception:
            files = []
        for p in files:
            try:
                with open(p, "r", encoding="utf-8") as fh:
                    j = json.load(fh)
            except Exception:
                continue
            if j.get("name"):
                continue  # already has a name — nothing to heal
            ticker = os.path.basename(p)[:-5]
            scanned += 1
            try:
                fhd = _from_finnhub(ticker)
            except Exception:
                time.sleep(1.2)
                continue
            nm = fhd.get("name")
            if nm:
                merged = {
                    "name": nm,
                    "sector": j.get("sector") or fhd.get("sector"),
                    "industry": j.get("industry") or fhd.get("industry"),
                }
                _disk_put(ticker, merged)
                _mem.set(f"tmeta_{ticker}", merged, ttl=_TTL)
                healed += 1
            time.sleep(1.1)
        try:
            with open(_HEAL_FLAG, "w", encoding="utf-8") as fh:
                fh.write(str(int(time.time())))
        except Exception:
            pass
        _logger.info("ticker_meta name-heal complete: scanned=%d healed=%d", scanned, healed)

    threading.Thread(target=_run, name="ticker-meta-name-heal", daemon=True).start()
