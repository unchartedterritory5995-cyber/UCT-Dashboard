# api/services/edgar.py
"""SEC EDGAR 8-K RSS fetcher — free primary source for earnings + M&A filings."""

import re
from datetime import datetime, timezone, timedelta

try:
    import requests as _requests
except ImportError:
    _requests = None

_cik_map_cache: dict[str, str] = {}
_cik_map_fetched_date: str = ""


def _fetch_cik_ticker_map() -> dict[str, str]:
    """Return {cik_str: ticker} mapping from SEC's public JSON. Cached daily."""
    global _cik_map_cache, _cik_map_fetched_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _cik_map_fetched_date == today and _cik_map_cache:
        return _cik_map_cache
    try:
        r = _requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "UCTDashboard contact@unchartedterritory.com"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        _cik_map_cache = {str(v["cik_str"]): v["ticker"] for v in data.values()}
        _cik_map_fetched_date = today
    except Exception:
        pass
    return _cik_map_cache


def _parse_cik(url: str) -> str | None:
    """Extract CIK digits from an EDGAR URL. Returns None if not found."""
    m = re.search(r"CIK=0*(\d+)", url, re.IGNORECASE)
    return m.group(1) if m else None


def _classify_8k(summary: str) -> str:
    """Map 8-K item numbers in summary text to a category badge."""
    s = summary.lower()
    if "2.02" in s or "results of operations" in s:
        return "EARN"
    if "1.01" in s or "1.02" in s or "material definitive" in s or "termination of material" in s:
        return "M&A"
    return "GENERAL"


def fetch_edgar_news(hours: int = 24) -> list[dict]:
    """Fetch recent 8-K filings from SEC EDGAR Atom feed."""
    if _requests is None:
        return []

    cik_map = _fetch_cik_ticker_map()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    try:
        r = _requests.get(
            "https://www.sec.gov/cgi-bin/browse-edgar"
            "?action=getcurrent&type=8-K&dateb=&owner=include&count=40&output=atom",
            headers={"User-Agent": "UCTDashboard contact@unchartedterritory.com"},
            timeout=10,
        )
        r.raise_for_status()
        text = r.text
    except Exception:
        return []

    results = []
    entries = re.findall(r"<entry>(.*?)</entry>", text, re.DOTALL)
    for entry in entries:
        updated = re.search(r"<updated>(.*?)</updated>", entry)
        if not updated:
            continue
        try:
            ts_str = updated.group(1).strip()
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if dt < cutoff:
                continue
            try:
                from zoneinfo import ZoneInfo
                _et = ZoneInfo("America/New_York")
            except ImportError:
                _et = timezone(timedelta(hours=-5))
            time_str = dt.astimezone(_et).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            continue

        link = re.search(r'<link[^>]+href="([^"]+)"', entry)
        if not link:
            continue
        cik = _parse_cik(link.group(1))
        if not cik:
            continue
        ticker = cik_map.get(cik, "")
        if not ticker or not (1 <= len(ticker) <= 4) or not ticker.isalpha():
            continue

        summary_m = re.search(r"<summary[^>]*>(.*?)</summary>", entry, re.DOTALL)
        summary = summary_m.group(1) if summary_m else ""
        category = _classify_8k(summary)

        title_m = re.search(r"<title[^>]*>(.*?)</title>", entry, re.DOTALL)
        raw_title = title_m.group(1) if title_m else ""
        company = raw_title.replace("&amp;", "&").split(" - ")[0].strip()
        item_desc = re.search(r"(Item \d+\.\d+[^<]*)", summary)
        item_label = item_desc.group(1).strip() if item_desc else "8-K Filing"
        headline = f"{company} — {item_label}"

        results.append({
            "headline":  headline,
            "source":    "SEC EDGAR",
            "url":       link.group(1),
            "time":      time_str,
            "category":  category,
            "sentiment": "neutral",
            "tickers":   [ticker],
        })

    return results
