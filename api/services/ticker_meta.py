"""Per-ticker company metadata (name/sector/industry).

Source: yfinance .info (all three) with FMP `stable/profile` then Finnhub
`profile2` fallback for name/industry (2026-08-05 migration — FMP is the new
PRIMARY of the two paid/free fallback legs; Finnhub stays as an explicit,
never-removed fallback since it costs nothing once FMP succeeds first).
In-memory TTLCache + disk-persisted JSON under /data, 24h TTL. Never raises
— returns all-null on total failure (uncached)."""
import json
import logging
import os
import time

from api.services import yf_util
from api.services.cache import TTLCache
from api.services.finnhub_client import fh_get

_logger = logging.getLogger(__name__)
_mem = TTLCache()
_TTL = 86400  # 24h
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "ticker_meta_cache")


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


# yfinance reports the exchange as a MIC-ish CODE (SPY → "PCX"); map the common
# ones to the friendly names a trader recognizes (FMP mislabels SPY as "AMEX").
_YF_EXCHANGE = {
    "PCX": "NYSE Arca", "NYQ": "NYSE", "ASE": "NYSE American",
    "NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NIM": "NASDAQ",
    "BTS": "Cboe BZX", "BATS": "Cboe BZX", "PNK": "OTC", "OTC": "OTC",
}


def _from_yfinance(ticker: str):
    import yfinance as yf
    info = yf_util.bounded_call(lambda: yf.Ticker(ticker).info, None) or {}
    name = info.get("longName") or info.get("shortName")
    exch = info.get("exchange") or None
    return {
        "name": name or None,
        "sector": info.get("sector") or None,
        "industry": info.get("industry") or None,
        "exchange": _YF_EXCHANGE.get(exch, exch),
    }


def _from_finnhub(ticker: str):
    # Routed through the shared finnhub_client.fh_get (2026-08-05) so this
    # call shares the process-wide token bucket / 429 cooldown with every
    # other Finnhub caller instead of spending the same account budget
    # uncoordinated. This is now the FALLBACK leg — see _from_fmp above it
    # in _base_meta's call order (2026-08-05 profile2→FMP migration).
    j = fh_get("/stock/profile2", {"symbol": ticker}, timeout=15)
    if not isinstance(j, dict):
        return {"name": None, "sector": None, "industry": None}
    return {
        "name": (j.get("name") or None),
        "sector": None,  # Finnhub profile2 has no GICS sector
        "industry": (j.get("finnhubIndustry") or None),
    }


_FMP_PROFILE_TIMEOUT = 8  # own bounded budget — NEVER routed through Finnhub's
                          # shared token bucket (finnhub_client.py); see
                          # docs/superpowers/plans/2026-08-05-data-dependability-migration.md Task 8.


def _fmp_row(data):
    """FMP `stable/*` endpoints return either a list-of-one dict or (some
    endpoints) a bare dict. Normalize to the single row dict or None."""
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None


def _fmp_market_cap_musd(row: dict):
    """Convert FMP `stable/profile`'s `marketCap` (raw USD UNITS) to millions,
    matching the millions-of-local-currency convention the retired Finnhub
    `marketCapitalization` field used, so a future consumer comparing the two
    across a migration boundary can never repeat the known 10^6-unit mismatch
    (`lesson_market_cap_cache_poison_and_finnhub_currency`). NOTE: unlike
    Finnhub, FMP's marketCap is USD-denominated, not local currency — that FX
    difference is a separate axis this helper does not attempt to correct.
    None in (missing/non-numeric) -> None out; never fabricates a value."""
    if not isinstance(row, dict):
        return None
    raw = row.get("marketCap")
    if raw is None:
        return None
    try:
        return float(raw) / 1_000_000.0
    except (TypeError, ValueError):
        return None


def _from_fmp(ticker: str):
    """FMP `stable/profile` — the new PRIMARY leg ahead of the Finnhub
    profile2 fallback (2026-08-05 migration, plan Task 8). Field mapping
    (probed live): name<-companyName, sector<-sector (FMP splits sector
    from industry; Finnhub profile2 has no sector at all), industry<-industry
    (finer-grained than Finnhub's coarse finnhubIndustry). Any field FMP
    doesn't supply stays None — never fabricated, never defaulted to 0/"".
    `market_cap_musd` is carried on this dict (already unit-converted, see
    _fmp_market_cap_musd) for any future caller; _base_meta's merge below
    only reads name/sector/industry from it today. Never raises — mirrors
    _from_finnhub's all-None-on-failure contract exactly so the merge in
    _base_meta can treat both legs identically."""
    from api.services import earnings_estimates as ee

    data = ee._fmp_get("/stable/profile", {"symbol": ticker}, timeout=_FMP_PROFILE_TIMEOUT)
    row = _fmp_row(data)
    if not row:
        return {"name": None, "sector": None, "industry": None, "market_cap_musd": None}
    return {
        "name": (row.get("companyName") or None),
        "sector": (row.get("sector") or None),
        "industry": (row.get("industry") or None),
        # FMP's friendly exchange name ("NYSE Arca", "NASDAQ Global Select") — the
        # compare-symbols legend shows it; prefer it over yfinance's code ("PCX").
        "exchange": (row.get("exchange") or row.get("exchangeShortName") or None),
        "market_cap_musd": _fmp_market_cap_musd(row),
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
    # A cached entry from before the `exchange` field existed is treated as STALE
    # so the exchange fills in on next request rather than only after 24h expiry.
    if disk is not None and "exchange" in disk:
        _mem.set(key, disk, ttl=_TTL)
        return disk

    data = {"name": None, "sector": None, "industry": None, "exchange": None}
    try:
        data = _from_yfinance(ticker)
    except Exception as e:
        _logger.info("ticker_meta yfinance failed for %s: %s — trying Finnhub", ticker, e)
        data = {"name": None, "sector": None, "industry": None, "exchange": None}

    # Fall back to FMP, then Finnhub, whenever the NAME is still missing — NOT
    # only when the whole payload is empty. yfinance's .info is flaky and often
    # returns a PARTIAL response (GICS sector/industry present but longName/
    # shortName absent); the old `not any(data.values())` gate saw the
    # sector/industry and skipped the fallback, permanently caching name=None.
    # That was the "some tickers show no company name in the header/watermark"
    # bug (424 of ~4,060 tickers — every one of them had sector+industry but a
    # null name). Merge field-by-field so yfinance's accurate GICS sector/
    # industry are KEPT and only the missing name (and industry, if blank) are
    # taken from the fallback legs.
    #
    # FMP `stable/profile` is tried FIRST (2026-08-05 profile2->FMP migration,
    # plan Task 8) — it's the paid/stronger source. Finnhub profile2 is kept
    # as an explicit, never-removed fallback for whatever FMP still can't
    # fill; it costs nothing once FMP already succeeded.
    # Run FMP when the NAME is missing OR the exchange is (yfinance gives ugly
    # codes like "PCX"; FMP's "NYSE Arca" is the friendly name the legend wants).
    if not data.get("name") or not data.get("exchange"):
        try:
            fmp = _from_fmp(ticker)
            data = {
                "name": data.get("name") or fmp.get("name"),
                "sector": data.get("sector") or fmp.get("sector"),
                "industry": data.get("industry") or fmp.get("industry"),
                # Prefer yfinance's (mapped) exchange — FMP mislabels some ETFs
                # (SPY → "AMEX"); FMP only fills the gap when yfinance had none.
                "exchange": data.get("exchange") or fmp.get("exchange"),
            }
        except Exception as e_fmp:
            _logger.info("ticker_meta FMP failed for %s: %s — trying Finnhub", ticker, e_fmp)

    if not data.get("name"):
        try:
            fh = _from_finnhub(ticker)
            data = {
                "name": data.get("name") or fh.get("name"),
                "sector": data.get("sector") or fh.get("sector"),
                "industry": data.get("industry") or fh.get("industry"),
                "exchange": data.get("exchange"),
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
    """{name, sector, industry, exchange, theme}. The first four are 24h-cached
    (yfinance → FMP → Finnhub); theme is the live UCT-taxonomy primary theme."""
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
    if not os.environ.get("FINNHUB_API_KEY", ""):
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
