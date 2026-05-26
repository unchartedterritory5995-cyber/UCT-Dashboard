"""News search via Google News RSS — fresh news beyond the cached
AlphaVantage / RSS aggregate that powers `get_news`.

No API key required. Free. Hits Google News RSS search endpoint, which
aggregates many sources and supports arbitrary queries (ticker + topic
combinations, sector themes, "Fed rate decision", etc).

Complement to:
  - `get_news` (cached AlphaVantage + curated RSS, 30min cache)
  - `web_search` (Perplexity synthesized answer with citations)
  - `tweets_for_ticker` / `tweet_tape` (curated trader feed)

This adds a 4th angle: ad-hoc Google News query, fresh, structured rows.
"""

import logging
import time
import urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
)
_BASE = "https://news.google.com/rss/search"
_TIMEOUT = 10
_CACHE = TTLCache()
_CACHE_TTL = 600  # 10 min


def _parse_pubdate(s: str) -> tuple[str, int]:
    """Return (iso_str, unix_ts) — empty string + 0 on failure."""
    if not s:
        return "", 0
    try:
        dt = parsedate_to_datetime(s)
        return dt.isoformat(), int(dt.timestamp())
    except Exception:
        return s, 0


def _time_ago(ts: int) -> str:
    if not ts:
        return ""
    delta = max(0, int(time.time()) - ts)
    if delta < 3600: return f"{delta // 60}m ago"
    if delta < 86400: return f"{delta // 3600}h ago"
    return f"{delta // 86400}d ago"


def search_news(query: str, count: int = 5) -> dict[str, Any]:
    """Fresh news search via Google News RSS. Returns up to `count` results
    newest-first with title, source, published, time-ago, url."""
    q = (query or "").strip()
    if not q:
        return {"error": "no query"}
    count = max(1, min(20, int(count or 5)))

    cache_key = f"news_search::{q.lower()[:200]}::{count}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    url = f"{_BASE}?q={urllib.parse.quote(q)}&hl=en-US&gl=US&ceid=US:en"
    try:
        t0 = time.time()
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
        r.raise_for_status()
        elapsed_ms = int((time.time() - t0) * 1000)
    except Exception as e:
        _log.warning("news_search request failed for %r: %s", q, e)
        return {"error": f"news search failed: {e}"}

    try:
        root = ET.fromstring(r.text)
    except ET.ParseError as e:
        _log.warning("news_search parse failed: %s", e)
        return {"error": "could not parse news feed"}

    items = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        source = ""
        src_el = item.find("source")
        if src_el is not None:
            source = (src_el.text or "").strip()
        iso, ts = _parse_pubdate(pub)
        items.append({
            "title": title,
            "source": source,
            "published": iso,
            "time_ago": _time_ago(ts),
            "url": link,
            "_ts": ts,
        })
        if len(items) >= count * 2:
            break  # over-fetch slightly for ordering

    # Newest first by parsed timestamp
    items.sort(key=lambda x: x["_ts"], reverse=True)
    items = items[:count]
    for it in items:
        it.pop("_ts", None)

    result = {
        "query": q,
        "count": len(items),
        "elapsed_ms": elapsed_ms,
        "headlines": items,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
