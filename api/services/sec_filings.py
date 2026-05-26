"""SEC EDGAR filings lookup for voice Compass.

Free, no API key required (SEC mandates a User-Agent header identifying
the requester). Surfaces recent 10-K / 10-Q / 8-K / S-1 / DEF 14A filings
for a ticker, with optional full-text search of recent filings via the
SEC's EFTS endpoint.
"""

import logging
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_UA = "UCT Intelligence Dashboard contact@uctintelligence.com"
_TIMEOUT = 12

_CIK_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
_FULL_TEXT_URL = "https://efts.sec.gov/LATEST/search-index"

_CACHE = TTLCache()
_CIK_MAP_TTL = 24 * 3600   # 1 day
_FILINGS_TTL = 1800        # 30 min
_FULL_TEXT_TTL = 600       # 10 min


def _cik_map() -> dict[str, str]:
    """Lazy-load + cache the SEC ticker→CIK map (zero-padded 10-digit CIK).
    The file is small (~3MB) and updated by SEC daily."""
    cached = _CACHE.get("sec::cik_map")
    if cached:
        return cached
    try:
        r = requests.get(_CIK_MAP_URL, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
        r.raise_for_status()
        data = r.json()  # {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}
    except Exception as e:
        _log.warning("SEC CIK map fetch failed: %s", e)
        return {}
    m: dict[str, str] = {}
    for v in data.values():
        t = str(v.get("ticker") or "").upper()
        cik = str(v.get("cik_str") or "")
        if t and cik:
            m[t] = cik.zfill(10)
    _CACHE.set("sec::cik_map", m, _CIK_MAP_TTL)
    return m


def _ticker_to_cik(ticker: str) -> str | None:
    t = (ticker or "").upper().strip()
    if not t:
        return None
    return _cik_map().get(t)


def recent_filings(ticker: str, form_type: str = "", count: int = 10) -> dict[str, Any]:
    """Recent SEC filings for a ticker, optionally filtered by form type
    (10-K, 10-Q, 8-K, S-1, DEF 14A, 13F-HR, etc.). Returns up to `count`
    most recent filings newest-first."""
    cik = _ticker_to_cik(ticker)
    if not cik:
        return {"error": f"ticker {ticker!r} not found in SEC CIK map"}

    cache_key = f"sec::filings::{cik}"
    cached = _CACHE.get(cache_key)
    if cached is None:
        try:
            r = requests.get(
                _SUBMISSIONS_URL.format(cik=cik),
                headers={"User-Agent": _UA},
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            _log.warning("SEC submissions fetch failed for %s: %s", cik, e)
            return {"error": f"SEC fetch failed: {e}"}
        _CACHE.set(cache_key, data, _FILINGS_TTL)
        cached = data

    company = cached.get("name", "") or ticker.upper()
    recent = cached.get("filings", {}).get("recent", {}) or {}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accession = recent.get("accessionNumber") or []
    primary_doc = recent.get("primaryDocument") or []
    period = recent.get("reportDate") or []

    form_norm = (form_type or "").upper().strip().replace(" ", "")
    out: list[dict] = []
    count = max(1, min(50, int(count or 10)))
    for i in range(min(len(forms), 200)):
        f = (forms[i] or "").upper().replace(" ", "")
        if form_norm and form_norm not in f:
            continue
        acc_raw = accession[i] if i < len(accession) else ""
        acc_no_dash = acc_raw.replace("-", "")
        doc = primary_doc[i] if i < len(primary_doc) else ""
        url = (f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_no_dash}/{doc}"
               if acc_no_dash and doc else "")
        out.append({
            "form": forms[i],
            "filed": dates[i] if i < len(dates) else "",
            "period": period[i] if i < len(period) else "",
            "accession": acc_raw,
            "url": url,
        })
        if len(out) >= count:
            break

    return {
        "ticker": ticker.upper(),
        "company": company,
        "cik": cik,
        "form_filter": form_type.upper() if form_type else "ANY",
        "count": len(out),
        "filings": out,
    }


def search_filings_full_text(query: str, ticker: str | None = None,
                             form_type: str | None = None,
                             count: int = 10) -> dict[str, Any]:
    """Full-text search across SEC EDGAR filings. `ticker` and `form_type`
    are optional filters. Returns up to `count` hits newest-first."""
    q = (query or "").strip()
    if not q:
        return {"error": "no query"}

    cik_param = None
    if ticker:
        cik = _ticker_to_cik(ticker)
        if not cik:
            return {"error": f"ticker {ticker!r} not found in SEC CIK map"}
        cik_param = str(int(cik))  # EFTS wants un-padded

    cache_key = f"sec::efts::{q.lower()[:100]}::{cik_param or '*'}::{form_type or '*'}::{count}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    params: dict[str, Any] = {"q": q}
    if form_type:
        params["forms"] = form_type
    if cik_param:
        params["ciks"] = cik_param

    try:
        t0 = time.time()
        r = requests.get(_FULL_TEXT_URL, params=params,
                         headers={"User-Agent": _UA, "Accept": "application/json"},
                         timeout=_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        elapsed_ms = int((time.time() - t0) * 1000)
    except Exception as e:
        _log.warning("SEC EFTS search failed for %r: %s", q, e)
        return {"error": f"SEC search failed: {e}"}

    hits_raw = (data.get("hits") or {}).get("hits") or []
    count = max(1, min(25, int(count or 10)))
    hits = []
    for h in hits_raw[:count]:
        src = h.get("_source") or {}
        adsh = (h.get("_id") or "").split(":")[0]
        adsh_clean = adsh.replace("-", "")
        cik_of_hit = (src.get("ciks") or [""])[0]
        primary = (src.get("display_names") or [""])[0]
        forms_field = src.get("forms") or []
        form_label = ", ".join(forms_field) if isinstance(forms_field, list) else str(forms_field)
        filed = src.get("file_date") or ""
        url = (f"https://www.sec.gov/Archives/edgar/data/{int(cik_of_hit)}/{adsh_clean}/"
               if cik_of_hit and adsh_clean else "")
        hits.append({
            "company": primary,
            "form": form_label,
            "filed": filed,
            "accession": adsh,
            "url": url,
            "summary": (src.get("display_names_full") or "")[:200],
        })

    result = {
        "query": q,
        "ticker": ticker.upper() if ticker else None,
        "form_filter": form_type,
        "count": len(hits),
        "hits": hits,
        "elapsed_ms": elapsed_ms,
    }
    _CACHE.set(cache_key, dict(result), _FULL_TEXT_TTL)
    return result
