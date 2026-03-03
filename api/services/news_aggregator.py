"""news_aggregator.py — Multi-source breaking news aggregator for Morning Wire.

Provides four public functions:
    fetch_rss_news(date_str, limit=40)               -> list[dict]
    fetch_yahoo_ticker_news(symbols, limit_per=3)    -> list[dict]
    fetch_finviz_news(finviz_token, limit=20)        -> list[dict]
    aggregate_news(pplx, rss, yahoo, fv, limit=30)  -> list[dict]

All functions return news items in the standard avNews format:
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
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import requests

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

# Words that look like tickers but aren't — filtered from regex extraction
_TICKER_BLACKLIST = {
    "A", "I", "AM", "AN", "ARE", "AS", "AT", "BE", "BY", "DO", "ET", "FM",
    "FOR", "GET", "GO", "HE", "IN", "IS", "IT", "ME", "MY", "NO", "OF",
    "ON", "OR", "SO", "THE", "TO", "UP", "US", "WE",
    # Financial jargon that looks like tickers
    "IPO", "ETF", "CEO", "CFO", "COO", "CTO", "ESG", "GDP", "CPI", "PCE",
    "PPI", "PMI", "AUM", "EPS", "FCF", "M&A", "YOY", "QOQ", "FY", "Q1",
    "Q2", "Q3", "Q4", "AM", "PM", "ET", "EST", "UTC", "NYSE", "NASDAQ",
    "SEC", "FED", "FOMC", "ECB", "BOJ", "IMF", "WTO", "NATO", "AI", "ML",
    "EV", "AR", "VR", "HR", "IT", "PR", "IR", "IF", "OF", "OR", "AND",
    "WITH", "FROM", "INTO", "OVER", "THAN", "THAT", "THIS", "THEY", "THEM",
    "WILL", "HAVE", "BEEN", "WERE", "SAID", "SAYS", "SAID", "MORE", "LESS",
    "ALSO", "EVEN", "JUST", "ONLY", "THAN", "THEN", "WHEN", "WHERE", "WHAT",
    "WHICH", "WHILE", "ABOUT", "AFTER", "AGAIN", "AHEAD", "AMONG", "AWAY",
    "BACK", "BEFORE", "BELOW", "BETWEEN", "BEYOND", "BOTH", "BRINGS",
    "BROAD", "BUYS", "CALL", "CALLS", "CAME", "COME", "CORP", "CUTS",
    "DEAL", "DOES", "DOWN", "EACH", "EARN", "EAST", "EDGE", "ELSE",
    "ENDS", "EVER", "EXEC", "FALL", "FAST", "FELL", "FILE", "FIND",
    "FIRM", "FIVE", "FLAT", "FOUR", "FREE", "FULL", "FUND", "GAIN",
    "GIVE", "GOES", "GOLD", "GOOD", "GREW", "GROW", "HALF", "HARD",
    "HEAD", "HEAR", "HELD", "HELP", "HERE", "HIGH", "HITS", "HOLD",
    "HOME", "HOW", "HURT", "IMPACT", "INTO", "KEEP", "KNEW", "KNOW",
    "LAST", "LATE", "LEAD", "LEAN", "LEFT", "LIKE", "LONG", "LOOK",
    "LOSS", "LOST", "MADE", "MAIN", "MAKE", "MANY", "MARK", "MEET",
    "MISS", "MOST", "MOVE", "MUCH", "MUST", "NEAR", "NEED", "NEXT",
    "NONE", "NOTE", "ONCE", "OPEN", "PART", "PAST", "PLAN", "PLAY",
    "POST", "PUSH", "PUTS", "REAL", "RISE", "RISK", "ROAD", "ROLE",
    "ROSE", "RULE", "RUNS", "SAME", "SAYS", "SEES", "SELL", "SENT",
    "SETS", "SHOT", "SHOW", "SIGN", "SITE", "SIZE", "SLOW", "SOME",
    "SOON", "STAY", "STEP", "STOP", "SUCH", "SURE", "TAKE", "TALK",
    "TELL", "TEST", "TIME", "TOOK", "TOPS", "TRIM", "TRUE", "TURN",
    "TWO", "TYPE", "UNIT", "USED", "VERY", "VIEW", "WAYS", "WEEK",
    "WELL", "WENT", "WEST", "WIDE", "WINS", "YEAR", "BEAT", "BEATS",
    "MISS", "MISSES", "BREAKING", "NEWS", "NEW", "SAYS", "TOPS",
    "STOCK", "MARKET", "SHARES", "PRICE", "TARGET", "GROWTH", "THIRD",
    "FOURTH", "FIRST", "SECOND", "REPORT", "REPORTS", "EARNINGS",
    "REVENUE", "GUIDANCE", "RAISES", "CUTS", "UPDATE", "MAJOR",
    "GLOBAL", "CHINA", "TRADE", "RATE", "RATES", "BOND", "BONDS",
    "CASH", "CASH", "DEBT", "LOAN", "BANK", "BANKS", "JOBS", "HIRE",
    "HIRES", "FIRE", "FIRES", "CLOSE", "CLOSES", "OPEN", "OPENS",
    "QUARTER", "ANNUAL", "FISCAL", "TECH", "ENERGY", "HEALTH", "CARE",
    "REAL", "ESTATE", "RETAIL", "DATA", "CLOUD", "CHIP", "CHIPS",
    "SAYS", "SAID", "CITING", "CITING", "SINCE", "UNTIL", "UNLESS",
    "DURING", "WITHIN", "OUTSIDE", "INSIDE", "ACROSS", "AROUND",
}

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
    """Extract likely stock ticker symbols from text using regex + blacklist filter."""
    if not text:
        return []
    # Match 2-5 uppercase letters, word-bounded
    candidates = re.findall(r"\b([A-Z]{2,5})\b", text)
    tickers = []
    seen = set()
    for c in candidates:
        if c not in _TICKER_BLACKLIST and c not in seen:
            # Additional heuristics: skip if it's all vowels or very common words
            # Tickers usually have at least one consonant and aren't common English
            tickers.append(c)
            seen.add(c)
    return tickers[:5]


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


# ── Yahoo Finance ticker news ──────────────────────────────────────────────────

def fetch_yahoo_ticker_news(symbols: list, limit_per_ticker: int = 3) -> list:
    """Fetch news for specific ticker symbols from Yahoo Finance search API.

    Uses the free Yahoo Finance search endpoint — no API key required.
    Falls back to yfinance library if available.

    Args:
        symbols:          List of ticker symbols e.g. ['AAPL', 'NVDA']
        limit_per_ticker: Max items per ticker.

    Returns:
        List of news dicts in standard avNews format.
    """
    if not symbols:
        return []

    results = []
    seen_uuids = set()

    for sym in symbols[:20]:  # Cap at 20 symbols to avoid rate limits
        try:
            raw_news = []

            # ── Try yfinance library first ────────────────────────────────────
            # yfinance >= 0.2.x returns items with nested 'content' dict
            try:
                import yfinance as yf
                ticker = yf.Ticker(sym)
                yf_raw = ticker.get_news() or []
                for n in yf_raw:
                    # New yfinance format: item has a 'content' sub-dict
                    content = n.get("content") if isinstance(n, dict) else None
                    if content and isinstance(content, dict):
                        title = str(content.get("title") or "").strip()
                        url = ""
                        # Prefer clickThroughUrl, fall back to canonicalUrl
                        for url_key in ("clickThroughUrl", "canonicalUrl"):
                            url_obj = content.get(url_key)
                            if url_obj and isinstance(url_obj, dict):
                                url = url_obj.get("url") or ""
                                if url:
                                    break
                        pub_date_str = content.get("pubDate") or ""
                        dt = _parse_pubdate(pub_date_str) if pub_date_str else None
                        item_id = n.get("id") or content.get("id") or ""
                        raw_news.append({"_id": item_id, "title": title, "url": url, "dt": dt, "summary": ""})
                    elif isinstance(n, dict) and n.get("title"):
                        # Old yfinance format: flat dict with title, link, providerPublishTime
                        title = str(n.get("title") or "").strip()
                        url = n.get("link") or ""
                        pub_ts = n.get("providerPublishTime")
                        dt = None
                        if pub_ts:
                            try:
                                dt = datetime.fromtimestamp(int(pub_ts), tz=timezone.utc)
                            except Exception:
                                pass
                        item_id = n.get("uuid") or ""
                        raw_news.append({"_id": item_id, "title": title, "url": url, "dt": dt, "summary": ""})
            except ImportError:
                pass
            except Exception:
                pass  # yfinance failed, fall through to REST API

            # ── Fall back to Yahoo Finance REST search API ─────────────────────
            if not raw_news:
                try:
                    r = requests.get(
                        f"https://query1.finance.yahoo.com/v1/finance/search"
                        f"?q={sym}&newsCount={limit_per_ticker + 2}&enableFuzzyQuery=false",
                        headers=_HEADERS,
                        timeout=_TIMEOUT,
                    )
                    if r.status_code == 200:
                        for n in r.json().get("news", []):
                            title = str(n.get("title") or "").strip()
                            url = n.get("link") or ""
                            pub_ts = n.get("providerPublishTime")
                            dt = None
                            if pub_ts:
                                try:
                                    dt = datetime.fromtimestamp(int(pub_ts), tz=timezone.utc)
                                except Exception:
                                    pass
                            raw_news.append({"_id": n.get("uuid", ""), "title": title, "url": url, "dt": dt, "summary": ""})
                except Exception:
                    pass

            # ── Emit normalised items ─────────────────────────────────────────
            count = 0
            for n in raw_news:
                if count >= limit_per_ticker:
                    break
                item_id = n.get("_id", "")
                if item_id and item_id in seen_uuids:
                    continue
                if item_id:
                    seen_uuids.add(item_id)

                title = n.get("title", "").strip()
                if not title:
                    continue

                url = n.get("url") or n.get("link") or ""
                dt = n.get("dt")
                summary = n.get("summary") or ""

                category = _guess_category(title)
                sentiment_label, sentiment_score = _guess_sentiment(title)
                # Use the queried symbol as the primary ticker, add any extracted ones
                tickers = [sym] + [t for t in _extract_tickers(title) if t != sym]

                results.append(_make_item(
                    title=title,
                    url=url,
                    dt=dt,
                    summary=summary,
                    tickers=tickers[:5],
                    category=category,
                    sentiment_label=sentiment_label,
                    sentiment_score=sentiment_score,
                    source="yahoo",
                ))
                count += 1

            time.sleep(0.1)  # Light throttle between ticker requests

        except Exception as e:
            print(f"  [Yahoo] {sym}: {type(e).__name__}: {e}")
            continue

    print(f"  Yahoo ticker news: {len(results)} items for {len(symbols)} symbols")
    return results


# ── Finviz Elite news ─────────────────────────────────────────────────────────

def fetch_finviz_news(finviz_token: str, limit: int = 20) -> list:
    """Fetch market news from Finviz Elite news export endpoint.

    Uses the same auth pattern as morning_wire_engine.py.

    Args:
        finviz_token: Finviz Elite authentication token.
        limit:        Max items to return.

    Returns:
        List of news dicts in standard avNews format.
    """
    if not finviz_token:
        return []

    results = []
    try:
        r = requests.get(
            f"https://elite.finviz.com/news_export.ashx?auth={finviz_token}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
            allow_redirects=True,
        )
        r.raise_for_status()

        lines = [ln.replace('"', '') for ln in r.text.strip().splitlines() if ln.strip()]
        if len(lines) < 2:
            print("  Finviz news: no data returned")
            return []

        # Parse CSV-like format: Date,Time,Headline,Source,Link,Ticker
        for line in lines[1:]:  # Skip header
            parts = line.split(",", 5)
            if len(parts) < 3:
                continue
            date_part = parts[0].strip() if len(parts) > 0 else ""
            time_part = parts[1].strip() if len(parts) > 1 else ""
            title = parts[2].strip() if len(parts) > 2 else ""
            source_name = parts[3].strip() if len(parts) > 3 else "finviz"
            url = parts[4].strip() if len(parts) > 4 else ""
            ticker = parts[5].strip() if len(parts) > 5 else ""

            if not title:
                continue

            # Parse datetime
            dt = None
            if date_part and time_part:
                try:
                    dt = datetime.strptime(f"{date_part} {time_part}", "%Y-%m-%d %H:%M:%S")
                    dt = dt.replace(tzinfo=timezone(timedelta(hours=-5)))  # ET
                except Exception:
                    pass

            tickers = [ticker.upper()] if ticker and ticker.upper() not in _TICKER_BLACKLIST else []
            tickers += [t for t in _extract_tickers(title) if t not in tickers]

            category = _guess_category(title)
            sentiment_label, sentiment_score = _guess_sentiment(title)

            results.append(_make_item(
                title=title,
                url=url,
                dt=dt,
                summary="",
                tickers=tickers[:5],
                category=category,
                sentiment_label=sentiment_label,
                sentiment_score=sentiment_score,
                source=f"finviz/{source_name}" if source_name else "finviz",
            ))

        print(f"  Finviz Elite news: {len(results)} items parsed")

    except Exception as e:
        print(f"  Finviz news fetch error: {type(e).__name__}: {e}")

    return results[:limit]


# ── Aggregator ────────────────────────────────────────────────────────────────

def _title_words(title: str) -> set:
    """Extract meaningful words from a title for fuzzy dedup."""
    words = re.findall(r"\b[a-z]{4,}\b", title.lower())
    # Remove very common stop words
    stops = {"that", "this", "with", "from", "have", "been", "will", "their",
              "says", "said", "after", "over", "about", "into", "when", "more",
              "some", "than", "then", "just", "also", "even", "back", "down"}
    return set(words) - stops


def _is_duplicate(title_a: str, title_b: str, threshold: int = 4) -> bool:
    """Return True if two titles share >= threshold meaningful words (fuzzy dedup)."""
    words_a = _title_words(title_a)
    words_b = _title_words(title_b)
    shared = words_a & words_b
    return len(shared) >= threshold


def _sort_key(item: dict) -> tuple:
    """Sort key: earnings/analyst first, has_ticker first, then by recency."""
    cat_priority = {"earnings": 0, "analyst": 1, "m_and_a": 2, "economic": 3, "general": 4, "syndicate": 5}
    cat_score = cat_priority.get(item.get("category", "general"), 4)
    has_ticker = 0 if item.get("tickers") else 1
    # Parse time for recency — use epoch seconds, descending (negate)
    ts = item.get("time_published", "")
    epoch = 0
    if ts:
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            epoch = dt.timestamp()
        except Exception:
            pass
    return (cat_score, has_ticker, -epoch)


def aggregate_news(
    perplexity_news: list,
    rss_news: list,
    yahoo_news: list,
    finviz_news: list,
    limit: int = 30,
) -> list:
    """Combine all news sources, deduplicate, sort, and return top `limit` items.

    Priority order for deduplication: Perplexity > Finviz > Yahoo > RSS
    (Perplexity has the richest summaries and is always preferred.)

    Dedup strategy:
        1. Exact title normalization (strip non-alphanumeric, lowercase, first 60 chars)
        2. Fuzzy title match: if two titles share 4+ meaningful words, keep the earlier one

    Sort order:
        1. Category: earnings > analyst > m_and_a > economic > general
        2. Has ticker: items with tickers ranked higher
        3. Recency: newest first

    Args:
        perplexity_news: Items from perplexity_research.fetch_breaking_news()
        rss_news:        Items from fetch_rss_news()
        yahoo_news:      Items from fetch_yahoo_ticker_news()
        finviz_news:     Items from fetch_finviz_news()
        limit:           Max items to return.

    Returns:
        Top `limit` deduplicated, sorted news items.
    """
    # Priority order: Perplexity (richest) → Finviz (curated financial) → Yahoo (ticker-specific) → RSS
    all_items = perplexity_news + finviz_news + yahoo_news + rss_news

    # ── Pass 1: exact dedup by normalized title prefix ────────────────────────
    seen_exact = set()
    pass1 = []
    for item in all_items:
        norm = re.sub(r"[^a-z0-9]", "", (item.get("title") or "").lower())[:60]
        if norm and norm not in seen_exact:
            seen_exact.add(norm)
            pass1.append(item)

    # ── Pass 2: fuzzy dedup — drop if title shares 4+ words with an earlier item ─
    pass2 = []
    kept_titles = []
    for item in pass1:
        title = item.get("title", "")
        is_dup = any(_is_duplicate(title, kept) for kept in kept_titles)
        if not is_dup:
            pass2.append(item)
            kept_titles.append(title)

    # ── Sort: category priority → has ticker → recency ───────────────────────
    pass2.sort(key=_sort_key)

    total_in = (len(perplexity_news) + len(rss_news) + len(yahoo_news) + len(finviz_news))
    print(f"  News aggregation: {total_in} raw -> {len(pass1)} unique -> {len(pass2)} after fuzzy dedup -> returning {min(len(pass2), limit)}")

    return pass2[:limit]
