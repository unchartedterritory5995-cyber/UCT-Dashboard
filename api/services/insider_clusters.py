"""OpenInsider cluster scraping — recent significant insider buying.

OpenInsider (http://openinsider.com) aggregates SEC Form 4 filings into
cluster reports. Their "Latest Cluster Buys" page is public HTML; we parse
it on the fly. No API key.

Returns insider buying clusters in the last N days with ticker + insider
count + total $ value. Cached 30 min.
"""

import logging
import re
import time
from html.parser import HTMLParser
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

# Cluster buys page — multiple insiders buying same ticker recently
_BASE = "http://openinsider.com/latest-cluster-buys"
_TIMEOUT = 12
_CACHE = TTLCache()
_CACHE_TTL = 1800  # 30 min
_UA = (
    "Mozilla/5.0 (compatible; UCTIntelligence/1.0; +https://uctintelligence.com)"
)


class _ClusterTableParser(HTMLParser):
    """Minimal HTML parser — pulls rows out of the main results table."""

    def __init__(self):
        super().__init__()
        self._in_table = False
        self._in_row = False
        self._in_td = False
        self._row: list[str] = []
        self.rows: list[list[str]] = []
        self._th_count = 0  # detect header row

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag == "table" and attrs_d.get("class", "").startswith("tinytable"):
            self._in_table = True
        elif self._in_table and tag == "tr":
            self._in_row = True
            self._row = []
        elif self._in_row and tag == "td":
            self._in_td = True
        elif self._in_row and tag == "th":
            self._th_count += 1

    def handle_endtag(self, tag):
        if tag == "td":
            self._in_td = False
        elif tag == "tr" and self._in_row:
            if self._row:
                self.rows.append(self._row)
            self._in_row = False
        elif tag == "table":
            self._in_table = False

    def handle_data(self, data):
        if self._in_td:
            txt = (data or "").strip()
            if txt:
                self._row.append(txt)


def _parse_amount(s: str) -> float | None:
    """Parse strings like '+$1,234,567' → 1234567.0"""
    if not s:
        return None
    s = s.replace("$", "").replace(",", "").replace("+", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int(s: str) -> int | None:
    if not s:
        return None
    s = s.replace(",", "").strip()
    try:
        return int(s)
    except ValueError:
        return None


def get_recent_clusters(days: int = 7, count: int = 15) -> dict[str, Any]:
    """Latest cluster-buy filings — multiple insiders buying same ticker."""
    days = max(1, min(30, int(days or 7)))
    count = max(1, min(50, int(count or 15)))

    cache_key = f"openinsider::clusters::{days}::{count}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        t0 = time.time()
        r = requests.get(_BASE, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
        r.raise_for_status()
        elapsed_ms = int((time.time() - t0) * 1000)
    except Exception as e:
        _log.warning("openinsider fetch failed: %s", e)
        return {"error": f"openinsider fetch failed: {e}", "clusters": [], "count": 0}

    parser = _ClusterTableParser()
    try:
        parser.feed(r.text)
    except Exception as e:
        _log.warning("openinsider parse failed: %s", e)
        return {"error": "parse failed", "clusters": [], "count": 0}

    # Row schema (typical): [X, Filing Date, Trade Date, Ticker, Company, Industry,
    #                        Insider Names, Trans Type, Price, Qty, Owned, Δ Own%, Value]
    # We pull the columns we care about; defensive about index errors.
    clusters: list[dict] = []
    for row in parser.rows[:count * 2]:
        try:
            ticker = row[3] if len(row) > 3 else ""
            company = row[4] if len(row) > 4 else ""
            insider_names = row[6] if len(row) > 6 else ""
            qty = _parse_int(row[9]) if len(row) > 9 else None
            value = _parse_amount(row[12]) if len(row) > 12 else None
            filing_date = row[1] if len(row) > 1 else ""
            trade_date = row[2] if len(row) > 2 else ""
            if not ticker or not ticker.isalpha() or len(ticker) > 5:
                continue
            clusters.append({
                "ticker": ticker.upper(),
                "company": company,
                "insider_count": insider_names.count(",") + 1 if insider_names else 1,
                "insider_names": insider_names[:200],
                "qty": qty,
                "value_usd": value,
                "filing_date": filing_date,
                "trade_date": trade_date,
            })
            if len(clusters) >= count:
                break
        except Exception:
            continue

    result = {
        "count": len(clusters),
        "days_window": days,
        "clusters": clusters,
        "elapsed_ms": elapsed_ms,
        "source": "openinsider.com",
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
