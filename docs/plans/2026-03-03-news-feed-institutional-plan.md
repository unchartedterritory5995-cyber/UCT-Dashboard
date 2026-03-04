# Institutional News Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the News tile into an institutional-grade swing-trader feed with multi-source data (AV + SEC EDGAR), category badges, sentiment borders, live price %, story deduplication, premarket-mode sort, and a NEW pulse dot.

**Architecture:** Backend `get_news()` fetches AV and EDGAR 8-K in parallel, merges + deduplicates by event, classifies each article into a category, sorts by actionability (premarket-aware), enriches with Massive batch price data, then returns 20 items. Frontend renders category badge, 2px sentiment left border, up to 3 ticker chips with inline %, and a NEW dot for items < 15 min old.

**Tech Stack:** FastAPI (Python), `feedparser` (RSS/Atom), `requests`, `concurrent.futures`, `yfinance`, Massive REST API (existing), React + SWR, CSS variables (existing design system)

---

### Task 1: Backend — SEC EDGAR 8-K fetcher

**Files:**
- Create: `api/services/edgar.py`
- Test: `tests/test_edgar.py`

**Context:**
SEC publishes a free Atom feed of all current 8-K filings:
`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&output=atom`

Each entry has a `<filing-href>` that contains the CIK. Example URL:
`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&...`
CIK is the 10-digit zero-padded number after `CIK=`.

SEC also publishes a free JSON file mapping CIK → ticker:
`https://www.sec.gov/files/company_tickers.json`
Format: `{"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}`

8-K item numbers that matter for traders:
- `2.02` → Results of Operations → `EARN`
- `1.01` → Material Definitive Agreement → `M&A`
- `1.02` → Termination of Material Agreement → `M&A`
- `8.01` → Other Events → `GENERAL`
- Everything else → `GENERAL`

**Step 1: Write failing tests**

```python
# tests/test_edgar.py
import pytest
from unittest.mock import patch, MagicMock

def test_parse_cik_from_url():
    from api.services.edgar import _parse_cik
    url = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=8-K"
    assert _parse_cik(url) == "1045810"

def test_parse_cik_missing():
    from api.services.edgar import _parse_cik
    assert _parse_cik("https://example.com/no-cik") is None

def test_classify_8k_item():
    from api.services.edgar import _classify_8k
    assert _classify_8k("Item 2.02: Results of Operations and Financial Condition") == "EARN"
    assert _classify_8k("Item 1.01: Entry into a Material Definitive Agreement") == "M&A"
    assert _classify_8k("Item 8.01: Other Events") == "GENERAL"
    assert _classify_8k("Item 5.02: Departure of Directors") == "GENERAL"

def test_fetch_edgar_news_returns_list(monkeypatch):
    from api.services import edgar
    monkeypatch.setattr(edgar, "_fetch_cik_ticker_map", lambda: {"1045810": "AAPL"})
    sample_atom = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Apple Inc. - 8-K</title>
        <link href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001045810&amp;type=8-K"/>
        <updated>2026-03-03T07:30:00-05:00</updated>
        <summary>Item 2.02: Results of Operations and Financial Condition</summary>
      </entry>
    </feed>"""
    monkeypatch.setattr(edgar._requests, "get", lambda *a, **kw: MagicMock(
        status_code=200, text=sample_atom, raise_for_status=lambda: None
    ))
    results = edgar.fetch_edgar_news()
    assert len(results) == 1
    assert results[0]["ticker"] == "AAPL"
    assert results[0]["category"] == "EARN"
    assert results[0]["source"] == "SEC EDGAR"
```

**Step 2: Run tests to verify they fail**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_edgar.py -v
```

Expected: 4 FAILs with `ModuleNotFoundError` or `ImportError`

**Step 3: Implement `api/services/edgar.py`**

```python
# api/services/edgar.py
"""SEC EDGAR 8-K RSS fetcher — free primary source for earnings + M&A filings."""

import re
import json
from datetime import datetime, timezone, timedelta

try:
    import requests as _requests
except ImportError:
    _requests = None

# CIK→ticker map is fetched once per day and cached in memory
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
        # {index: {cik_str, ticker, title}} → {str(cik): ticker}
        _cik_map_cache = {str(v["cik_str"]): v["ticker"] for v in data.values()}
        _cik_map_fetched_date = today
    except Exception:
        pass  # keep stale map if fetch fails
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
    """
    Fetch recent 8-K filings from SEC EDGAR Atom feed.
    Returns list of news dicts compatible with get_news() output shape.
    """
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

    # Parse Atom XML without feedparser dependency — minimal regex approach
    results = []
    entries = re.findall(r"<entry>(.*?)</entry>", text, re.DOTALL)
    for entry in entries:
        # Timestamp
        updated = re.search(r"<updated>(.*?)</updated>", entry)
        if not updated:
            continue
        try:
            ts_str = updated.group(1).strip()
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if dt < cutoff:
                continue
            time_str = dt.astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            continue

        # URL → CIK → ticker
        link = re.search(r'<link[^>]+href="([^"]+)"', entry)
        if not link:
            continue
        cik = _parse_cik(link.group(1))
        if not cik:
            continue
        ticker = cik_map.get(cik, "")
        # Filter: must have a ticker, 1–4 chars, alpha only
        if not ticker or not (1 <= len(ticker) <= 4) or not ticker.isalpha():
            continue

        # Category from summary
        summary_m = re.search(r"<summary[^>]*>(.*?)</summary>", entry, re.DOTALL)
        summary = summary_m.group(1) if summary_m else ""
        category = _classify_8k(summary)

        # Headline from title
        title_m = re.search(r"<title[^>]*>(.*?)</title>", entry, re.DOTALL)
        raw_title = title_m.group(1) if title_m else ""
        # EDGAR titles are "Company Name - 8-K", make more readable
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
```

**Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_edgar.py -v
```

Expected: 4 PASSes

**Step 5: Commit**

```bash
git add api/services/edgar.py tests/test_edgar.py
git commit -m "feat: SEC EDGAR 8-K fetcher with CIK→ticker mapping"
```

---

### Task 2: Backend — category classifier + sentiment mapper

**Files:**
- Modify: `api/services/engine.py` — add `_classify_category()` and `_map_sentiment()` helpers before `get_news()`
- Test: `tests/test_news_classify.py`

**Context:**
AV response shape per article:
```json
{
  "title": "...",
  "overall_sentiment_label": "Bullish",
  "topics": [{"topic": "Earnings", "relevance_score": "0.9"}, ...],
  "ticker_sentiment": [{"ticker": "NVDA", "relevance_score": "0.8", ...}]
}
```

AV topic strings to badge mapping:
- `"Earnings"` → `"EARN"`
- `"Mergers & Acquisitions"` → `"M&A"`
- `"IPO"` → `"IPO"`
- `"Life Sciences"` → `"BIO"`
- `"Economy - Monetary"` → `"MACRO"`

Upgrade/downgrade detection from headline (case-insensitive):
- Upgrade words: `"upgrades to"`, `"raises to"`, `"initiates"`, `"outperform"`, `"overweight"`, `"price target raised"`, `"raises price target"`, `"pt raised"`
- Downgrade words: `"downgrades to"`, `"cuts to"`, `"underperform"`, `"underweight"`, `"price target cut"`, `"price target lowered"`, `"pt cut"`, `"pt lowered"`

Anything unmatched → `"GENERAL"`

**Step 1: Write failing tests**

```python
# tests/test_news_classify.py
import pytest

def test_classify_earnings():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Earnings", "relevance_score": "0.9"}]}
    assert _classify_category(item, "NVDA beats Q4 estimates") == "EARN"

def test_classify_ma():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Mergers & Acquisitions", "relevance_score": "0.8"}]}
    assert _classify_category(item, "Firm acquires rival for $2B") == "M&A"

def test_classify_upgrade_from_headline():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Finance", "relevance_score": "0.5"}]}
    assert _classify_category(item, "Goldman upgrades to Buy, raises price target to $500") == "UPGRADE"

def test_classify_downgrade_from_headline():
    from api.services.engine import _classify_category
    item = {"topics": []}
    assert _classify_category(item, "JPMorgan downgrades to Sell on margin concerns") == "DOWNGRADE"

def test_classify_bio():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Life Sciences", "relevance_score": "0.7"}]}
    assert _classify_category(item, "Phase 3 trial results announced") == "BIO"

def test_classify_general_fallback():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Technology", "relevance_score": "0.6"}]}
    assert _classify_category(item, "Company announces new office lease") == "GENERAL"

def test_map_sentiment_bullish():
    from api.services.engine import _map_sentiment
    assert _map_sentiment("Bullish") == "bullish"
    assert _map_sentiment("Somewhat-Bullish") == "bullish"

def test_map_sentiment_bearish():
    from api.services.engine import _map_sentiment
    assert _map_sentiment("Bearish") == "bearish"
    assert _map_sentiment("Somewhat-Bearish") == "bearish"

def test_map_sentiment_neutral():
    from api.services.engine import _map_sentiment
    assert _map_sentiment("Neutral") == "neutral"
    assert _map_sentiment("") == "neutral"
    assert _map_sentiment(None) == "neutral"
```

**Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_news_classify.py -v
```

Expected: 9 FAILs with `ImportError`

**Step 3: Add helpers to `api/services/engine.py`**

Add these two functions immediately before the `get_news()` function (around line 409):

```python
# ─── News helpers ─────────────────────────────────────────────────────────────

_AV_TOPIC_MAP = {
    "Earnings":                "EARN",
    "Mergers & Acquisitions":  "M&A",
    "IPO":                     "IPO",
    "Life Sciences":           "BIO",
    "Economy - Monetary":      "MACRO",
}

_UPGRADE_PATTERNS = (
    "upgrades to", "raises to", "initiates", "outperform",
    "overweight", "price target raised", "raises price target",
    "pt raised", "price target increase",
)
_DOWNGRADE_PATTERNS = (
    "downgrades to", "cuts to", "underperform", "underweight",
    "price target cut", "price target lowered", "pt cut", "pt lowered",
    "price target decrease",
)


def _classify_category(item: dict, headline: str) -> str:
    """Classify an AV article dict into a category badge string."""
    hl = headline.lower()
    # Check headline for analyst call patterns first (most specific)
    if any(p in hl for p in _UPGRADE_PATTERNS):
        return "UPGRADE"
    if any(p in hl for p in _DOWNGRADE_PATTERNS):
        return "DOWNGRADE"
    # Then check AV topics (sorted by relevance, take highest-priority match)
    topics = sorted(
        item.get("topics", []),
        key=lambda t: float(t.get("relevance_score", 0)),
        reverse=True,
    )
    for t in topics:
        badge = _AV_TOPIC_MAP.get(t.get("topic", ""))
        if badge:
            return badge
    return "GENERAL"


def _map_sentiment(label: str | None) -> str:
    """Map AV overall_sentiment_label to 'bullish' | 'bearish' | 'neutral'."""
    if not label:
        return "neutral"
    l = label.lower()
    if "bullish" in l:
        return "bullish"
    if "bearish" in l:
        return "bearish"
    return "neutral"
```

**Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_news_classify.py -v
```

Expected: 9 PASSes

**Step 5: Commit**

```bash
git add api/services/engine.py tests/test_news_classify.py
git commit -m "feat: news category classifier + sentiment mapper helpers"
```

---

### Task 3: Backend — story deduplicator + priority sort

**Files:**
- Modify: `api/services/engine.py` — add `_deduplicate_news()` and `_sort_news()` helpers
- Test: `tests/test_news_dedup.py`

**Context:**

Dedup key: `(primary_ticker, category, 2h_bucket)` where `2h_bucket = unix_timestamp // 7200`

When multiple items share the same key, keep the one with the most credible source. Source tier:
- Tier 1 (keep): `"reuters"`, `"associated press"`, `"ap"`, `"dow jones"`, `"bloomberg"`
- Tier 2: `"benzinga"`, `"business wire"`, `"pr newswire"`, `"globenewswire"`, `"sec edgar"`
- Tier 3: everything else

Surviving item gets `sources` field listing all sources that covered the story, e.g. `"Reuters · Benzinga +1"`.

Priority sort order — two modes based on server time (ET):
- **Premarket** (04:00–09:29 ET): EARN, M&A, BIO pinned first (newest first within); then UPGRADE, DOWNGRADE, IPO, MACRO, GENERAL (newest first within)
- **Standard** (all other times): EARN, M&A, UPGRADE, DOWNGRADE, BIO, IPO, MACRO, GENERAL — newest first within each tier

```python
_CATEGORY_PRIORITY = {
    "EARN":      0,
    "M&A":       1,
    "UPGRADE":   2,
    "DOWNGRADE": 2,
    "BIO":       3,
    "IPO":       4,
    "MACRO":     5,
    "GENERAL":   6,
}
_PREMARKET_PINNED = {"EARN", "M&A", "BIO"}  # these go first during premarket
```

**Step 1: Write failing tests**

```python
# tests/test_news_dedup.py
import pytest
from datetime import datetime, timezone

def _make_item(ticker, category, time_str, source="Benzinga", headline="Test"):
    return {
        "headline": headline, "source": source, "url": f"http://x.com/{ticker}",
        "time": time_str, "category": category, "sentiment": "neutral",
        "tickers": [ticker],
    }

def test_dedup_collapses_same_event():
    from api.services.engine import _deduplicate_news
    items = [
        _make_item("NVDA", "EARN", "2026-03-03 07:00:00", "Reuters"),
        _make_item("NVDA", "EARN", "2026-03-03 07:05:00", "Benzinga"),
        _make_item("NVDA", "EARN", "2026-03-03 07:10:00", "AP"),
    ]
    result = _deduplicate_news(items)
    assert len(result) == 1
    assert "Reuters" in result[0]["source"]

def test_dedup_keeps_different_categories():
    from api.services.engine import _deduplicate_news
    items = [
        _make_item("NVDA", "EARN", "2026-03-03 07:00:00"),
        _make_item("NVDA", "UPGRADE", "2026-03-03 07:30:00"),
    ]
    result = _deduplicate_news(items)
    assert len(result) == 2

def test_dedup_keeps_different_tickers():
    from api.services.engine import _deduplicate_news
    items = [
        _make_item("NVDA", "EARN", "2026-03-03 07:00:00"),
        _make_item("TSLA", "EARN", "2026-03-03 07:00:00"),
    ]
    result = _deduplicate_news(items)
    assert len(result) == 2

def test_sort_earn_first_standard():
    from api.services.engine import _sort_news
    items = [
        _make_item("X", "GENERAL",  "2026-03-03 10:00:00"),
        _make_item("Y", "EARN",     "2026-03-03 09:00:00"),
        _make_item("Z", "UPGRADE",  "2026-03-03 10:00:00"),
    ]
    result = _sort_news(items, is_premarket=False)
    assert result[0]["category"] == "EARN"
    assert result[1]["category"] == "UPGRADE"

def test_sort_premarket_pins_earn_ma_bio():
    from api.services.engine import _sort_news
    items = [
        _make_item("A", "GENERAL", "2026-03-03 07:00:00"),
        _make_item("B", "UPGRADE", "2026-03-03 07:01:00"),
        _make_item("C", "EARN",    "2026-03-03 06:00:00"),  # older but pinned
        _make_item("D", "BIO",     "2026-03-03 06:30:00"),
    ]
    result = _sort_news(items, is_premarket=True)
    top_cats = {r["category"] for r in result[:2]}
    assert top_cats == {"EARN", "BIO"}
```

**Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_news_dedup.py -v
```

Expected: 5 FAILs

**Step 3: Add helpers to `api/services/engine.py`** (after the Task 2 helpers)

```python
_SOURCE_TIER = {
    "reuters": 1, "associated press": 1, "ap": 1, "dow jones": 1, "bloomberg": 1,
    "benzinga": 2, "business wire": 2, "pr newswire": 2, "globenewswire": 2, "sec edgar": 2,
}

_CATEGORY_PRIORITY = {
    "EARN": 0, "M&A": 1, "UPGRADE": 2, "DOWNGRADE": 2,
    "BIO": 3, "IPO": 4, "MACRO": 5, "GENERAL": 6,
}
_PREMARKET_PINNED = {"EARN", "M&A", "BIO"}


def _deduplicate_news(items: list[dict]) -> list[dict]:
    """Collapse same-event articles (same ticker + category within 2h) into one item."""
    from datetime import datetime
    buckets: dict[tuple, list[dict]] = {}
    for item in items:
        ticker = (item.get("tickers") or [""])[0]
        category = item.get("category", "GENERAL")
        try:
            ts = datetime.strptime(item["time"], "%Y-%m-%d %H:%M:%S").timestamp()
            bucket = int(ts) // 7200
        except Exception:
            bucket = 0
        key = (ticker, category, bucket)
        buckets.setdefault(key, []).append(item)

    result = []
    for group in buckets.values():
        # Pick best source by tier (lower = better), then earliest time
        def _tier(it):
            return _SOURCE_TIER.get(it.get("source", "").lower(), 3)
        best = min(group, key=lambda it: (_tier(it), it.get("time", "")))
        if len(group) > 1:
            other_sources = [g["source"] for g in group if g is not best]
            unique_others = list(dict.fromkeys(other_sources))  # preserve order, dedup
            if unique_others:
                extra = f" +{len(unique_others) - 1}" if len(unique_others) > 1 else ""
                best = dict(best)
                best["source"] = f"{best['source']} · {unique_others[0]}{extra}"
        result.append(best)
    return result


def _sort_news(items: list[dict], is_premarket: bool) -> list[dict]:
    """Sort by category priority (premarket-aware) then recency."""
    def _key(item):
        cat = item.get("category", "GENERAL")
        pri = _CATEGORY_PRIORITY.get(cat, 6)
        if is_premarket and cat in _PREMARKET_PINNED:
            pri = -1  # pin to absolute top
        # Negate time string so newest sorts first within same priority
        return (pri, item.get("time", "") and -1 * int(
            __import__("datetime").datetime.strptime(
                item["time"], "%Y-%m-%d %H:%M:%S"
            ).timestamp()
        ))
    return sorted(items, key=_key)
```

**Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_news_dedup.py -v
```

Expected: 5 PASSes

**Step 5: Commit**

```bash
git add api/services/engine.py tests/test_news_dedup.py
git commit -m "feat: news story deduplication + premarket-aware priority sort"
```

---

### Task 4: Backend — rewrite `get_news()` to wire everything together

**Files:**
- Modify: `api/services/engine.py` — replace `get_news()` body entirely

**Context:**
The new `get_news()` flow:
1. Check cache (unchanged)
2. Determine if premarket (`04:00 <= ET_hour < 09:30`)
3. Fetch AV (200 articles, 24h window) and EDGAR 8-K in parallel via `ThreadPoolExecutor`
4. From AV: run existing ETF/volume filter (yfinance fast_info), extract up to 3 tickers per article, classify category, map sentiment
5. Merge AV + EDGAR results
6. Deduplicate → sort → take top 40 candidates
7. Batch Massive price fetch for all primary tickers
8. Build final 20-item list with `change_pct` field
9. Cache + return

Each item in the returned list has these fields:
```python
{
    "headline":    str,
    "source":      str,         # "Reuters · Benzinga +1" after dedup
    "url":         str,
    "time":        str,         # "YYYY-MM-DD HH:MM:SS" ET
    "category":    str,         # "EARN" | "M&A" | "UPGRADE" | "DOWNGRADE" | "BIO" | "IPO" | "MACRO" | "GENERAL"
    "sentiment":   str,         # "bullish" | "bearish" | "neutral"
    "tickers":     list[str],   # up to 3 ticker symbols
    "change_pct":  float | None # live price % change from Massive, None if unavailable
}
```

**Step 1: Replace `get_news()` in `api/services/engine.py`**

Find and replace the entire `get_news()` function (from `def get_news()` through the last `return result`) with:

```python
def get_news() -> list:
    cached = cache.get("news")
    if cached:
        return cached

    av_key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not av_key:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None,
                   "error": "ALPHAVANTAGE_API_KEY not set"}]
        cache.set("news", result, ttl=120)
        return result

    try:
        import requests as _requests
        from datetime import datetime, timezone, timedelta
        from concurrent.futures import ThreadPoolExecutor, as_completed as _ac

        now_et = datetime.now(timezone(timedelta(hours=-5)))
        is_premarket = 4 <= now_et.hour < 9 or (now_et.hour == 9 and now_et.minute < 30)
        time_from = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y%m%dT%H%M")

        # ── Fetch AV + EDGAR in parallel ──────────────────────────────────────
        def _fetch_av():
            r = _requests.get(
                "https://www.alphavantage.co/query",
                params={"function": "NEWS_SENTIMENT", "sort": "LATEST",
                        "limit": "200", "time_from": time_from, "apikey": av_key},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=15,
            )
            r.raise_for_status()
            return r.json().get("feed", [])

        def _fetch_edgar():
            try:
                from api.services.edgar import fetch_edgar_news
                return fetch_edgar_news(hours=24)
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=2) as ex:
            av_future = ex.submit(_fetch_av)
            edgar_future = ex.submit(_fetch_edgar)
            try:
                av_feed = av_future.result(timeout=20)
            except Exception:
                av_feed = []
            try:
                edgar_items = edgar_future.result(timeout=15)
            except Exception:
                edgar_items = []

        # ── Noise filters ──────────────────────────────────────────────────────
        _BAD_SOURCES = {"stock titan", "intellectia ai"}
        _BAD_HEADLINE = ("sec filings", "stock news today", "stock price and chart",
                         "latest stock news", "annual report")

        # ── Process AV feed → candidate items ─────────────────────────────────
        av_candidates = []
        for item in av_feed:
            if item.get("source", "").lower() in _BAD_SOURCES:
                continue
            headline = item.get("title", "")
            if any(p in headline.lower() for p in _BAD_HEADLINE):
                continue
            # Up to 3 tickers by relevance score
            ticker_sentiment = sorted(
                item.get("ticker_sentiment", []),
                key=lambda t: float(t.get("relevance_score", 0) or 0),
                reverse=True,
            )
            tickers = []
            for t in ticker_sentiment:
                try:
                    rel = float(t.get("relevance_score", 0))
                except (TypeError, ValueError):
                    rel = 0
                sym = (t.get("ticker") or "").strip().upper()
                if rel >= 0.5 and sym and 1 <= len(sym) <= 4 and sym.isalpha():
                    tickers.append(sym)
                if len(tickers) == 3:
                    break
            if not tickers:
                continue

            ts = item.get("time_published", "")
            try:
                dt_utc = datetime.strptime(ts[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                time_str = dt_utc.astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                time_str = ""

            av_candidates.append({
                "headline":  headline,
                "source":    item.get("source", ""),
                "url":       item.get("url", ""),
                "time":      time_str,
                "category":  _classify_category(item, headline),
                "sentiment": _map_sentiment(item.get("overall_sentiment_label")),
                "tickers":   tickers,
            })

        # ── ETF + volume filter on AV candidates ──────────────────────────────
        unique_syms = list({sym for it in av_candidates for sym in it["tickers"]})

        def _check_sym(sym: str) -> tuple[str, bool]:
            try:
                import yfinance as yf
                fi = yf.Ticker(sym).fast_info
                qt = getattr(fi, "quote_type", "EQUITY") or "EQUITY"
                if qt.upper() not in ("EQUITY", ""):
                    return sym, False
                price   = getattr(fi, "last_price", 0) or 0
                avg_vol = getattr(fi, "three_month_average_volume", 0) or 0
                return sym, (price * avg_vol) >= 5_000_000
            except Exception:
                return sym, True

        with ThreadPoolExecutor(max_workers=min(len(unique_syms), 12)) as ex:
            allowed = {s for s, ok in (f.result() for f in _ac(
                ex.submit(_check_sym, s) for s in unique_syms
            )) if ok}

        av_filtered = [
            it for it in av_candidates
            if any(t in allowed for t in it["tickers"])
        ]
        # Keep only allowed tickers in each item's tickers list
        for it in av_filtered:
            it["tickers"] = [t for t in it["tickers"] if t in allowed]

        # ── Merge AV + EDGAR, dedup, sort, take top 40 ────────────────────────
        merged = av_filtered + edgar_items
        deduped = _deduplicate_news(merged)
        sorted_items = _sort_news(deduped, is_premarket=is_premarket)
        top40 = sorted_items[:40]

        # ── Batch Massive price fetch ──────────────────────────────────────────
        primary_tickers = [(it.get("tickers") or [""])[0] for it in top40 if it.get("tickers")]
        price_map: dict[str, float] = {}
        try:
            from api.services.massive import _get_client
            client = _get_client()
            price_map = client.get_batch_snapshots(list(set(primary_tickers)))
        except Exception:
            pass

        # ── Build final 20-item list ───────────────────────────────────────────
        result = []
        for it in top40:
            if len(result) >= 20:
                break
            primary = (it.get("tickers") or [""])[0]
            result.append({
                "headline":   it["headline"],
                "source":     it.get("source", ""),
                "url":        it.get("url", ""),
                "time":       it.get("time", ""),
                "category":   it.get("category", "GENERAL"),
                "sentiment":  it.get("sentiment", "neutral"),
                "tickers":    it.get("tickers", []),
                "change_pct": price_map.get(primary),
            })

    except Exception as e:
        result = [{"headline": "News unavailable", "source": "", "url": "",
                   "time": "", "category": "GENERAL", "sentiment": "neutral",
                   "tickers": [], "change_pct": None, "error": str(e)}]

    cache.set("news", result, ttl=300)
    return result
```

**Step 2: Verify locally**

```bash
cd C:\Users\Patrick\uct-dashboard
uvicorn api.main:app --reload --port 8000
# In another terminal:
curl -s http://localhost:8000/api/news | python -m json.tool | head -80
```

Expected: Array of 20 items, each with `category`, `sentiment`, `tickers` (array), `change_pct` fields.
Check that: at least some items have non-"GENERAL" categories, sentiments vary, tickers is a list.

**Step 3: Run all existing tests**

```bash
python -m pytest tests/ -v
```

Expected: All pass (new helpers don't break existing tests)

**Step 4: Commit**

```bash
git add api/services/engine.py
git commit -m "feat: news — multi-source AV+EDGAR, categories, sentiment, multi-ticker, live price%"
```

---

### Task 5: Frontend — category badge + sentiment border

**Files:**
- Modify: `app/src/components/tiles/NewsFeed.jsx`
- Modify: `app/src/components/tiles/NewsFeed.module.css`

**Context:**
Backend now returns `category`, `sentiment`, `tickers` (array), `change_pct` per item.

Category badge: small monospace uppercase pill displayed on the left of the meta row.
Sentiment border: 2px left border on each `.item`. Green=bullish, red=bearish, none=neutral.

Color tokens for badges (add as CSS custom properties using hex, not var() — these are new colors):
- EARN: `#d4af37` (amber/gold — matches UT gold theme)
- M&A: `#9b59b6` (purple)
- UPGRADE: `#27ae60` (green)
- DOWNGRADE: `#e74c3c` (red)
- BIO: `#1abc9c` (teal)
- IPO: `#3498db` (blue)
- MACRO: `#7f8c8d` (gray)
- GENERAL: `#555e6b` (muted gray)

**Step 1: Update `NewsFeed.module.css`**

Replace entire file content with:

```css
.feed {
  display: flex;
  flex-direction: column;
  max-height: 420px;
  overflow-y: auto;
  overflow-x: hidden;
}
.item {
  display: block;
  text-decoration: none;
  padding: 8px 0 8px 10px;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  transition: background 0.1s, border-left-color 0.1s;
}
.item:last-child { border-bottom: none; }
.item:hover {
  background: var(--bg-hover);
  margin: 0 -14px;
  padding-left: 12px;
  padding-right: 14px;
}
/* Sentiment borders */
.sentimentBullish { border-left-color: #27ae60; }
.sentimentBearish  { border-left-color: #e74c3c; }

.headline {
  font-size: 12px;
  color: var(--text-bright);
  line-height: 1.5;
  margin-bottom: 4px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Category badge */
.badge {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.6px;
  padding: 1px 4px;
  border-radius: 2px;
  text-transform: uppercase;
  flex-shrink: 0;
}
.badgeEARN     { color: #d4af37; background: rgba(212,175,55,0.12);  border: 1px solid rgba(212,175,55,0.3); }
.badgeMA       { color: #9b59b6; background: rgba(155,89,182,0.12);  border: 1px solid rgba(155,89,182,0.3); }
.badgeUPGRADE  { color: #27ae60; background: rgba(39,174,96,0.12);   border: 1px solid rgba(39,174,96,0.3);  }
.badgeDOWNGRADE{ color: #e74c3c; background: rgba(231,76,60,0.12);   border: 1px solid rgba(231,76,60,0.3);  }
.badgeBIO      { color: #1abc9c; background: rgba(26,188,156,0.12);  border: 1px solid rgba(26,188,156,0.3); }
.badgeIPO      { color: #3498db; background: rgba(52,152,219,0.12);  border: 1px solid rgba(52,152,219,0.3); }
.badgeMACRO    { color: #7f8c8d; background: rgba(127,140,141,0.10); border: 1px solid rgba(127,140,141,0.25);}
.badgeGENERAL  { color: #555e6b; background: rgba(85,94,107,0.10);   border: 1px solid rgba(85,94,107,0.2);  }

/* Ticker chip */
.ticker {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  font-weight: 700;
  color: var(--ut-gold);
  background: rgba(212,175,55,0.12);
  border: 1px solid rgba(212,175,55,0.25);
  border-radius: 3px;
  padding: 1px 4px;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.ticker:hover { background: rgba(212,175,55,0.22); }

/* Inline price change */
.chgPos { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: #27ae60; }
.chgNeg { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: #e74c3c; }
.chgFlat{ font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: var(--text-muted); }

.source {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 0.3px;
}
.time {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  color: var(--text-muted);
  margin-left: auto;
}

/* NEW pulse dot */
.newDot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #27ae60;
  flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

.loading { color: var(--text-muted); font-size: 12px; }
.empty   { color: var(--text-muted); font-size: 12px; }
```

**Step 2: Update `NewsFeed.jsx`**

Replace entire file content with:

```jsx
// app/src/components/tiles/NewsFeed.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './NewsFeed.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function getETOffset(date) {
  const y = date.getFullYear()
  const marchSecondSun = new Date(y, 2, 8)
  marchSecondSun.setDate(8 + (7 - marchSecondSun.getDay()) % 7)
  const novFirstSun = new Date(y, 10, 1)
  novFirstSun.setDate(1 + (7 - novFirstSun.getDay()) % 7)
  return date >= marchSecondSun && date < novFirstSun ? '-04:00' : '-05:00'
}

function fmtTime(raw) {
  if (!raw) return ''
  const now = new Date()
  const dt = new Date(raw.replace(' ', 'T') + getETOffset(now))
  if (isNaN(dt)) return raw
  const diff = Math.floor((now - dt) / 60000)
  if (diff < 1)    return 'just now'
  if (diff < 60)   return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

function isNew(raw) {
  if (!raw) return false
  const now = new Date()
  const dt = new Date(raw.replace(' ', 'T') + getETOffset(now))
  return !isNaN(dt) && (now - dt) < 15 * 60 * 1000
}

const BADGE_CLASS = {
  EARN:      styles.badgeEARN,
  'M&A':     styles.badgeMA,
  UPGRADE:   styles.badgeUPGRADE,
  DOWNGRADE: styles.badgeDOWNGRADE,
  BIO:       styles.badgeBIO,
  IPO:       styles.badgeIPO,
  MACRO:     styles.badgeMACRO,
  GENERAL:   styles.badgeGENERAL,
}

function fmtChg(pct) {
  if (pct == null) return null
  const sign = pct >= 0 ? '+' : ''
  const cls = Math.abs(pct) < 0.1 ? styles.chgFlat : pct > 0 ? styles.chgPos : styles.chgNeg
  return <span className={cls}>{sign}{pct.toFixed(2)}%</span>
}

export default function NewsFeed({ data: propData }) {
  const { data: fetched, error } = useSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 300000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="News">
      {error ? (
        <p className={styles.empty}>News unavailable</p>
      ) : !data ? (
        <p className={styles.loading}>Loading…</p>
      ) : data.length === 0 ? (
        <p className={styles.empty}>No stock news at this time</p>
      ) : (
        <div className={styles.feed}>
          {data.slice(0, 20).map((item, i) => {
            const tickers = Array.isArray(item.tickers) ? item.tickers
              : item.ticker ? [item.ticker] : []
            const sentimentClass = item.sentiment === 'bullish' ? styles.sentimentBullish
              : item.sentiment === 'bearish' ? styles.sentimentBearish : ''
            const badgeClass = BADGE_CLASS[item.category] || styles.badgeGENERAL
            const category = item.category || 'GENERAL'
            return (
              <a
                key={item.url || i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.item} ${sentimentClass}`}
              >
                <div className={styles.headline}>{item.headline}</div>
                <div className={styles.meta}>
                  <span className={`${styles.badge} ${badgeClass}`}>{category}</span>
                  {tickers.map(sym => (
                    <span key={sym} onClick={e => e.stopPropagation()}>
                      <TickerPopup sym={sym}>
                        <span className={styles.ticker}>${sym}</span>
                      </TickerPopup>
                    </span>
                  ))}
                  {fmtChg(item.change_pct)}
                  <span className={styles.source}>{item.source}</span>
                  {isNew(item.time) && <span className={styles.newDot} title="New" />}
                  <span className={styles.time}>{fmtTime(item.time)}</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </TileCard>
  )
}
```

**Step 3: Verify in browser**

```bash
# Terminal 1
uvicorn api.main:app --reload --port 8000
# Terminal 2
cd app && npm run dev
```

Open `http://localhost:5173` and check the News tile:
- Each item has a colored category badge (EARN amber, UPGRADE green, etc.)
- Bullish items have a green left border, bearish items have a red left border
- Up to 3 gold ticker chips per item
- Price % change shows next to primary ticker (green/red)
- Items under 15 min old show a pulsing green dot
- Hover still highlights the row correctly

**Step 4: Commit**

```bash
git add app/src/components/tiles/NewsFeed.jsx app/src/components/tiles/NewsFeed.module.css
git commit -m "feat: news UI — category badges, sentiment border, multi-ticker, live price%, NEW dot"
```

---

### Task 6: Push to Railway + verify live

**Step 1: Push**

```bash
git push origin master
```

**Step 2: Add SEC EDGAR User-Agent note**

SEC requires a `User-Agent` header with contact info for their API. It's already set in `edgar.py` as `"UCTDashboard contact@unchartedterritory.com"`. No Railway env var needed.

**Step 3: Verify live API**

```bash
curl -s https://web-production-05cb6.up.railway.app/api/news | python -m json.tool | head -60
```

Expected: 20 items with `category`, `sentiment`, `tickers` array, `change_pct` fields.
At least 1–2 items should have `"source": "SEC EDGAR"` if any 8-Ks filed in last 24h.

**Step 4: Verify live dashboard**

Open `https://web-production-05cb6.up.railway.app` — News tile should show the full institutional feed.
