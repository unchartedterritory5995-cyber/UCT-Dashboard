"""news_aggregator.py — RSS headline reader.

Provides one public function:
    fetch_rss_news(date_str, limit=40)               -> list[dict]

It returns news items in the standard avNews format:
    {title, url, time_published, display_time, summary,
     tickers, category, sentiment_label, sentiment_score, source}

Accessible RSS feeds (tested 2026-02-19):
    - CNBC Top News          https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664
    - MarketWatch Top Stories https://feeds.marketwatch.com/marketwatch/topstories/
    - PR Newswire Finance    https://www.prnewswire.com/rss/news-releases-list.rss?tagid=4
    - Seeking Alpha          https://seekingalpha.com/feed.xml
    - Yahoo Finance News     https://finance.yahoo.com/news/rssindex
    - Benzinga               https://www.benzinga.com/feed
    - Motley Fool            https://www.fool.com/feeds/index.aspx
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import requests

from api.services import ticker_resolver

# ── Constants ─────────────────────────────────────────────────────────────────

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
_HEADERS = {"User-Agent": _UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"}
_TIMEOUT = 12

# RSS feeds that returned 200 and had parseable items during testing
_RSS_FEEDS = [
    {
        "name": "cnbc",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664",
        "label": "CNBC",
    },
    {
        "name": "marketwatch",
        "url": "https://feeds.marketwatch.com/marketwatch/topstories/",
        "label": "MarketWatch",
    },
    {
        "name": "prnewswire",
        "url": "https://www.prnewswire.com/rss/news-releases-list.rss?tagid=4",
        "label": "PRNewswire",
    },
    {
        "name": "seekingalpha",
        "url": "https://seekingalpha.com/feed.xml",
        "label": "SeekingAlpha",
    },
    {
        "name": "yahoo_rss",
        "url": "https://finance.yahoo.com/news/rssindex",
        "label": "YahooFinance",
    },
    {
        "name": "benzinga",
        "url": "https://www.benzinga.com/feed",
        "label": "Benzinga",
    },
    {
        "name": "motleyfool",
        "url": "https://www.fool.com/feeds/index.aspx",
        "label": "MotleyFool",
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_tag_text(elem, tag):
    """Get text from a child tag, handling namespace-prefixed tags."""
    # Try plain tag first
    child = elem.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    # Try stripping namespace: find any child whose local name matches
    for child in elem:
        local = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if local == tag and child.text:
            return child.text.strip()
    return ""


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode common entities."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_pubdate(pub_date_str: str):
    """Parse an RFC 2822 or ISO pubDate string. Returns datetime or None."""
    if not pub_date_str:
        return None
    try:
        return parsedate_to_datetime(pub_date_str)
    except Exception:
        pass
    # ISO format (e.g. 2026-02-19T08:30:00Z)
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(pub_date_str[:19], fmt[:len(fmt)])
            return dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


def _display_time_from_dt(dt) -> str:
    """Convert datetime to ET display time string like '7:15 AM ET'."""
    if dt is None:
        return ""
    try:
        ET_zone = timezone(timedelta(hours=-5))
        dt_et = dt.astimezone(ET_zone)
        return dt_et.strftime("%-I:%M %p ET").replace("AM", "AM").replace("PM", "PM")
    except Exception:
        try:
            # Windows doesn't support %-I, use %I and strip leading zero
            ET_zone = timezone(timedelta(hours=-5))
            dt_et = dt.astimezone(ET_zone)
            return dt_et.strftime("%I:%M %p ET").lstrip("0")
        except Exception:
            return ""


def _is_today(dt, date_str: str) -> bool:
    """Check if a datetime falls on the date described by date_str (e.g. '2026-02-19' or 'Thursday, February 19, 2026').
    Accept yesterday too so overnight pre-market news isn't missed.
    """
    if dt is None:
        return True  # If we can't parse the date, include it
    try:
        # Parse the date_str — try YYYY-MM-DD first, then human-readable
        try:
            target = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            # Human-readable like "Thursday, February 19, 2026"
            # Remove weekday prefix if present
            parts = date_str.split(", ", 1)
            date_part = parts[-1]
            target = datetime.strptime(date_part, "%B %d, %Y").date()
        # Allow today AND yesterday (overnight/pre-market)
        yesterday = target - timedelta(days=1)
        item_date = dt.astimezone(timezone.utc).date()
        return item_date >= yesterday and item_date <= target
    except Exception:
        return True  # Include if date logic fails


def _extract_tickers(text: str) -> list:
    """Likely tickers in a headline, in mention order, at most five.

    TERM-064: the ONE ticker resolver's HEADLINE context
    (`api/services/ticker_resolver.py`), which holds this pass's stop words
    (moved there verbatim) and the shared precedence: cashtags trusted, bare
    uppercase words only when they are cap-universe symbols. The cap of five is
    this pass's own policy and stays here.
    """
    return ticker_resolver.resolve_tickers(text, ticker_resolver.HEADLINE)[:5]


def _guess_category(title: str) -> str:
    """Guess the news category from the title text."""
    t = title.lower()
    if any(kw in t for kw in ["earn", " eps", "q1 ", "q2 ", "q3 ", "q4 ", "quarter", "fiscal", "revenue", "beat", "miss"]):
        return "earnings"
    if any(kw in t for kw in ["upgrad", "downgrad", "target", "initiates", "reiterate", "maintain", "price target", "overweight", "outperform", "neutral", "hold", "sell rating"]):
        return "analyst"
    if any(kw in t for kw in ["acqui", "merger", "deal", "buyout", "takeover", "agreement", "offer to buy", "purchase agreement"]):
        return "m_and_a"
    if any(kw in t for kw in ["fed ", "federal reserve", "rate hike", "rate cut", "gdp", "cpi", "ppi", "pcep", "jobs", "payroll", "unemployment", "inflation", "fomc", "powell", "monetary policy"]):
        return "economic"
    return "general"


def _guess_sentiment(title: str) -> tuple[str, float]:
    """Guess sentiment label and score from title keywords."""
    t = title.lower()
    bullish_kws = ["beats", "beat", "surges", "surge", "gains", "gain", "raises", "raised", "expands",
                   "upgrade", "upgraded", "record", "record high", "up ", "rises", "rose", "+", "wins",
                   "tops", "exceeds", "strong", "outperforms", "bullish", "buys", "buy rating"]
    bearish_kws = ["misses", "miss", "drops", "drop", "falls", "fell", "cuts", "cut", "lowers", "lowered",
                   "downgrade", "downgraded", "warning", "warn", "concern", "down ", "declines", "slides",
                   "tumbles", "plunges", "loses", "loss", "weak", "disappoints", "sell rating", "bearish",
                   "layoff", "layoffs", "recall", "probe", "investigation", "lawsuit", "fine", "penalty"]
    bull_count = sum(1 for kw in bullish_kws if kw in t)
    bear_count = sum(1 for kw in bearish_kws if kw in t)
    if bull_count > bear_count:
        return "Bullish", 0.6
    if bear_count > bull_count:
        return "Bearish", -0.6
    return "Neutral", 0.0


def _make_item(title, url, dt, summary, tickers, category, sentiment_label,
               sentiment_score, source) -> dict:
    """Build a standard avNews-format item dict."""
    return {
        "title":           title[:200],
        "url":             url or "",
        "time_published":  dt.isoformat() if dt else "",
        "display_time":    _display_time_from_dt(dt),
        "summary":         (_strip_html(summary) or "")[:400],
        "tickers":         tickers,
        "category":        category,
        "sentiment_label": sentiment_label,
        "sentiment_score": sentiment_score,
        "source":          source,
    }


# ── RSS fetcher ────────────────────────────────────────────────────────────────

def fetch_rss_news(date_str: str, limit: int = 40) -> list:
    """Scrape multiple RSS feeds for today's financial news.

    Args:
        date_str: Date in any readable format, e.g. 'Thursday, February 19, 2026'
                  or '2026-02-19'. Used to filter items to today/yesterday.
        limit:    Max total items to return across all feeds.

    Returns:
        List of news dicts in standard avNews format.
    """
    results = []
    feed_stats = []

    for feed in _RSS_FEEDS:
        try:
            r = requests.get(feed["url"], headers=_HEADERS, timeout=_TIMEOUT, allow_redirects=True)
            r.raise_for_status()
            root = ET.fromstring(r.content)  # Use bytes to let ET handle encoding
        except Exception as e:
            feed_stats.append(f"{feed['label']}: ERR({type(e).__name__})")
            continue

        items = root.findall(".//item")
        count = 0
        for item in items:
            title = _get_tag_text(item, "title")
            if not title:
                continue
            title = _strip_html(title).strip()
            if not title:
                continue

            url = _get_tag_text(item, "link") or _get_tag_text(item, "guid") or ""
            pub_date_str = _get_tag_text(item, "pubDate")
            description = _get_tag_text(item, "description") or ""
            summary = _strip_html(description)[:400]

            dt = _parse_pubdate(pub_date_str)

            if not _is_today(dt, date_str):
                continue

            tickers = _extract_tickers(title)
            category = _guess_category(title)
            sentiment_label, sentiment_score = _guess_sentiment(title)

            results.append(_make_item(
                title=title,
                url=url,
                dt=dt,
                summary=summary,
                tickers=tickers,
                category=category,
                sentiment_label=sentiment_label,
                sentiment_score=sentiment_score,
                source=feed["label"],
            ))
            count += 1

        feed_stats.append(f"{feed['label']}: {count}")

    print(f"  RSS feeds: {' | '.join(feed_stats)} = {len(results)} raw items")
    return results[:limit]
