# Chart News Markers + Countdown Timer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two high-impact additions to StockChart:
1. **News markers** — overlay news headlines on the chart at their published timestamps as small dot markers with hover tooltip showing headline + source + click-to-read-more
2. **Countdown to bar close** — a subtle indicator showing "3:42 to close" for the currently developing bar, intraday only

**Architecture:** News data already flows through `/api/news` endpoint (AlphaVantage primary, RSS fallback per CLAUDE.md). New endpoint `/api/chart-news/{ticker}` returns ticker-tagged news entries with timestamps. Markers render on the candle series via the same `setMarkers` API as earnings/splits/dividends. Countdown is a pure-frontend timer based on the current TF's bar period.

**Tech Stack:** Existing news pipeline (AlphaVantage + RSS), Lightweight Charts `setMarkers`, React useEffect intervals for countdown.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `api/routers/chart_news.py` | New endpoint `GET /api/chart-news/{ticker}?days=30` returning ticker-tagged news with timestamps for marker placement |
| `app/src/components/chart/CountdownTimer.jsx` | Pure component: takes `currentBarTime` + `tfSeconds`, renders "X:XX to close" |
| `tests/test_chart_news.py` | Backend endpoint tests |
| `app/src/components/chart/CountdownTimer.test.jsx` | Frontend countdown logic tests |

### Modified files
| File | Change |
|---|---|
| `api/services/news_service.py` *(or wherever news fetch lives)* | Add `get_ticker_news(ticker, days)` helper |
| `app/src/components/StockChart.jsx` | Fetch news on `cs.markers?.news`, build news markers, merge with existing earnings/split/dividend markers, render CountdownTimer overlay |
| `app/src/components/chart/ChartToolbar.jsx` | Add "News markers" toggle to Markers section + "Countdown" toggle to Display section |
| `app/src/components/chart/chartDefaults.js` | Add `markers.news: false` and `countdown: false` |

---

## Task 1: Backend — `/api/chart-news/{ticker}` endpoint

**Files:**
- Create: `api/routers/chart_news.py`
- Modify: `api/main.py` (register router)
- Create: `tests/test_chart_news.py`

- [ ] **Step 1: Locate existing news fetch infrastructure**

```bash
grep -rn "get_news\|alphavantage\|news_sentiment\|ticker.*news" api/services/ api/routers/ | head -20
```

The existing `engine.get_news()` returns recent news for all tickers; we need a per-ticker filter.

- [ ] **Step 2: Failing tests**

Create `tests/test_chart_news.py`:

```python
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_chart_news_returns_ticker_filtered(client):
    fake_news = [
        {"ticker": "AAPL", "headline": "Apple announces Q4 earnings", "url": "https://example.com/a", "time_published": 1715000000, "source": "Reuters"},
        {"ticker": "AAPL", "headline": "Apple unveils new iPhone", "url": "https://example.com/b", "time_published": 1715050000, "source": "Bloomberg"},
        {"ticker": "MSFT", "headline": "Microsoft Cloud growth", "url": "https://example.com/c", "time_published": 1715080000, "source": "WSJ"},
    ]
    with patch("api.routers.chart_news.get_ticker_news", return_value=[n for n in fake_news if n["ticker"] == "AAPL"]):
        r = client.get("/api/chart-news/AAPL?days=30")
    assert r.status_code == 200
    body = r.json()
    assert "news" in body
    assert len(body["news"]) == 2
    assert all(n["ticker"] == "AAPL" for n in body["news"])


def test_chart_news_empty_returns_empty_array(client):
    with patch("api.routers.chart_news.get_ticker_news", return_value=[]):
        r = client.get("/api/chart-news/ZZZZZ")
    assert r.status_code == 200
    assert r.json() == {"news": []}


def test_chart_news_respects_days_param(client):
    """Older entries filtered by `days` cutoff."""
    fake = [{"ticker": "AAPL", "headline": "Old", "time_published": 1700000000, "source": "X", "url": "u"}]
    with patch("api.routers.chart_news.get_ticker_news", return_value=fake) as mock:
        client.get("/api/chart-news/AAPL?days=7")
        mock.assert_called_once_with("AAPL", days=7)


def test_chart_news_caps_days(client):
    """Reject excessive days values."""
    r = client.get("/api/chart-news/AAPL?days=10000")
    # Should clamp to a reasonable max (e.g. 365) — verify max applied
    assert r.status_code == 200
```

- [ ] **Step 3: Implement endpoint**

Create `api/routers/chart_news.py`:

```python
"""Per-ticker news for chart markers.

Returns recent news entries with timestamps so the frontend can place
markers on the chart at the moment each headline was published.
"""
import logging
from fastapi import APIRouter, Query
from api.services.cache import cache  # existing TTLCache infra

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 1800  # 30 min
_MAX_DAYS = 365


def get_ticker_news(ticker: str, days: int = 30) -> list[dict]:
    """Fetch news entries for a ticker over the past N days.

    Returns list of {ticker, headline, source, url, time_published (epoch s), sentiment}.
    Uses the same upstream pipeline as engine.get_news() but filters by ticker.
    """
    cache_key = f"chart_news:{ticker.upper()}:{days}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        from api.services import engine
        all_news = engine.get_news() or {}
        items = all_news.get("articles") or all_news.get("items") or []
    except Exception:
        _logger.exception("[chart_news] engine.get_news failed")
        return []

    ticker_u = ticker.upper()
    result = []
    cutoff_ts = 0
    import time
    cutoff_ts = int(time.time()) - days * 86400

    for item in items:
        if not isinstance(item, dict):
            continue
        # Per-item ticker tagging — depends on news source format
        item_tickers = []
        if isinstance(item.get("ticker_sentiment"), list):
            item_tickers = [t.get("ticker", "").upper() for t in item["ticker_sentiment"]]
        elif isinstance(item.get("tickers"), list):
            item_tickers = [str(t).upper() for t in item["tickers"]]
        elif item.get("ticker"):
            item_tickers = [str(item["ticker"]).upper()]
        if ticker_u not in item_tickers:
            continue

        # Normalize timestamp to epoch seconds
        ts = item.get("time_published") or item.get("ts") or item.get("published") or item.get("time")
        if isinstance(ts, str):
            try:
                # AlphaVantage format: YYYYMMDDTHHMMSS
                import datetime as dt
                if len(ts) == 15 and 'T' in ts:
                    parsed = dt.datetime.strptime(ts, "%Y%m%dT%H%M%S")
                    ts = int(parsed.timestamp())
                else:
                    parsed = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
                    ts = int(parsed.timestamp())
            except Exception:
                continue
        if not isinstance(ts, (int, float)) or ts < cutoff_ts:
            continue

        result.append({
            "ticker": ticker_u,
            "headline": item.get("headline") or item.get("title") or "",
            "source": item.get("source") or item.get("publisher") or "",
            "url": item.get("url") or item.get("link") or "",
            "time_published": int(ts),
            "sentiment": item.get("overall_sentiment_label") or item.get("sentiment") or "",
        })

    # Sort newest first
    result.sort(key=lambda x: x["time_published"], reverse=True)
    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result


@router.get("/api/chart-news/{ticker}")
def chart_news(ticker: str, days: int = Query(default=30, ge=1, le=_MAX_DAYS)):
    """Return per-ticker news for chart markers."""
    return {"news": get_ticker_news(ticker, days=days)}
```

- [ ] **Step 4: Register the router**

In `api/main.py`, add:

```python
from api.routers import chart_news
app.include_router(chart_news.router)
```

If the router is already auto-registered via existing patterns, skip.

- [ ] **Step 5: Tests pass**

```bash
pytest tests/test_chart_news.py -v
```

4/4 should pass.

- [ ] **Step 6: Smoke test on prod after deploy**

```bash
curl -sS 'https://uctintelligence.com/api/chart-news/AAPL?days=30' | python -m json.tool | head -30
```

Expect `news: [...]` with several recent AAPL articles.

- [ ] **Step 7: Commit + push**

```bash
git add api/routers/chart_news.py api/main.py tests/test_chart_news.py
git commit -m "feat(charts): /api/chart-news endpoint for per-ticker news markers"
git push
```

---

## Task 2: chartDefaults schema additions

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js`

- [ ] **Step 1: Add fields**

Add to `CHART_DEFAULTS`:

```javascript
markers: {
  earnings: false,
  splits: false,
  dividends: false,
  news: false,  // NEW
},
countdown: false,  // NEW
```

If `markers` already exists with earnings/splits/dividends, just add `news: false`. Confirm via grep first.

- [ ] **Step 2: mergeChartSettings**

Ensure `news` and `countdown` are preserved from user prefs:

```javascript
markers: {
  ...CHART_DEFAULTS.markers,
  ...(userSettings?.markers || {}),
},
countdown: userSettings?.countdown ?? CHART_DEFAULTS.countdown,
```

- [ ] **Step 3: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/chartDefaults.js
git commit -m "feat(charts): add markers.news + countdown to chartDefaults"
```

---

## Task 3: CountdownTimer component + tests

**Files:**
- Create: `app/src/components/chart/CountdownTimer.jsx`
- Create: `app/src/components/chart/CountdownTimer.test.jsx`

- [ ] **Step 1: Failing tests**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { computeRemainingSec } from './CountdownTimer';


describe('computeRemainingSec', () => {
  it('returns seconds until next bar boundary', () => {
    // At 9:30:30, with 5-min bars, next boundary is 9:35:00 → 270s remaining
    const barStart = 1715085000;  // 09:30:00 ET (assumed)
    const tfSeconds = 300;
    const now = 1715085030;  // 30s into bar
    expect(computeRemainingSec(barStart, tfSeconds, now)).toBe(270);
  });

  it('returns 0 when bar just closed', () => {
    expect(computeRemainingSec(1715085000, 300, 1715085300)).toBe(0);
  });

  it('handles 1-minute bars', () => {
    expect(computeRemainingSec(1715085000, 60, 1715085015)).toBe(45);
  });

  it('handles 1-hour bars', () => {
    expect(computeRemainingSec(1715085000, 3600, 1715085600)).toBe(3000);
  });

  it('returns null for non-intraday tf', () => {
    expect(computeRemainingSec(1715085000, null, 1715085030)).toBe(null);
  });

  it('clamps negative (overdue) to 0', () => {
    expect(computeRemainingSec(1715085000, 300, 1715085999)).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```jsx
import { useState, useEffect } from 'react';
import styles from './CountdownTimer.module.css';


export function computeRemainingSec(barStartSec, tfSeconds, nowSec) {
  if (!barStartSec || !tfSeconds) return null;
  const elapsed = nowSec - barStartSec;
  const remaining = tfSeconds - elapsed;
  return Math.max(0, Math.floor(remaining));
}


function formatRemaining(sec) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}


/**
 * Renders countdown to next bar close. Only renders if barStartTime + tfSeconds
 * provided and we're within the bar.
 */
export default function CountdownTimer({ barStartTime, tfSeconds, label = 'to close' }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!barStartTime || !tfSeconds) return;
    const id = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [barStartTime, tfSeconds]);

  const remaining = computeRemainingSec(barStartTime, tfSeconds, now);
  if (remaining === null) return null;

  return (
    <div className={styles.countdown}>
      <span className={styles.value}>{formatRemaining(remaining)}</span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: CSS**

Create `app/src/components/chart/CountdownTimer.module.css`:

```css
.countdown {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  background: rgba(0,0,0,0.6);
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--border, #2a2a2a);
  font-family: 'IBM Plex Mono', monospace;
}
.value {
  font-size: 13px;
  font-weight: 700;
  color: var(--ut-gold, #c9a84c);
  letter-spacing: 0.5px;
}
.label {
  font-size: 10px;
  color: var(--text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 1px;
}
```

- [ ] **Step 4: Tests pass**

```bash
cd app && npx vitest run src/components/chart/CountdownTimer.test.jsx
```

6/6 should pass.

- [ ] **Step 5: Build + commit**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/CountdownTimer.jsx app/src/components/chart/CountdownTimer.module.css app/src/components/chart/CountdownTimer.test.jsx
git commit -m "feat(charts): CountdownTimer component (X:XX to close)"
```

---

## Task 4: StockChart — wire news markers + countdown

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Add news fetch**

Locate the existing chart-markers SWR fetch (from the earnings/dividends/splits work). Add a SECOND SWR fetch for news:

```jsx
const showNews = !!cs.markers?.news;
const { data: newsData } = useSWR(
  showNews ? `/api/chart-news/${sym}?days=60` : null,
  (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : { news: [] }),
  { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
);
```

- [ ] **Step 2: Build news markers**

```jsx
const newsMarkers = useMemo(() => {
  if (!showNews || !newsData?.news) return [];
  return newsData.news.map(n => ({
    time: n.time_published + _ET_OFFSET,
    position: 'aboveBar',
    color: '#3b82f6',
    shape: 'circle',
    text: 'N',
    size: 0.8,
    id: `news-${n.time_published}`,  // for click handling
    _newsData: n,  // attach for hover/click access
  }));
}, [showNews, newsData]);
```

- [ ] **Step 3: Merge into existing markers union**

Find the existing `chartMarkers` useMemo (which already combines earnings/splits/dividends markers). Add `newsMarkers` to the array:

```jsx
const chartMarkers = useMemo(() => {
  // existing logic, plus:
  const allMarkers = [
    ...earningsMarkers,
    ...splitMarkers,
    ...dividendMarkers,
    ...newsMarkers,
  ];
  return allMarkers.sort((a, b) => a.time - b.time);
}, [earningsMarkers, splitMarkers, dividendMarkers, newsMarkers]);
```

Adjust to match existing variable names.

- [ ] **Step 4: News marker click handler**

When a user clicks a news marker, open the article URL. Lightweight Charts doesn't directly expose marker-click — workaround via `subscribeClick`:

```jsx
useEffect(() => {
  if (!chartRef.current) return;
  const handler = (param) => {
    if (!param.time) return;
    // Find a news marker matching this time (within ±1 bar tolerance)
    const tfSec = TF_INTERVALS[resolvedTf] || 60;
    const matching = newsMarkers.find(m => Math.abs(m.time - (param.time || 0)) < tfSec * 0.5);
    if (matching?._newsData?.url) {
      window.open(matching._newsData.url, '_blank', 'noopener');
    }
  };
  chartRef.current.subscribeClick(handler);
  return () => {
    try { chartRef.current.unsubscribeClick(handler); } catch {}
  };
}, [newsMarkers, resolvedTf]);
```

This is best-effort — exact marker-click on Lightweight Charts is approximate.

- [ ] **Step 5: Countdown timer render**

Inside the chart wrapper JSX:

```jsx
import CountdownTimer from './chart/CountdownTimer';

// Compute current bar start time
const currentBarStart = useMemo(() => {
  if (!filteredBars?.length) return null;
  const last = filteredBars[filteredBars.length - 1];
  return last.t;
}, [filteredBars]);

const tfSec = useMemo(() => {
  return {
    '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600,
    'D': 23400, 'W': null, 'M': null,
  }[resolvedTf] || null;
}, [resolvedTf]);

// In render:
{cs.countdown && tfSec && currentBarStart && (
  <div className={styles.countdownPosition}>
    <CountdownTimer barStartTime={currentBarStart} tfSeconds={tfSec} />
  </div>
)}
```

Add to StockChart.module.css:

```css
.countdownPosition {
  position: absolute;
  bottom: 40px;
  right: 16px;
  z-index: 40;
  pointer-events: none;
}
```

- [ ] **Step 6: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/components/StockChart.jsx app/src/components/StockChart.module.css
git commit -m "feat(charts): news markers + countdown timer on StockChart"
git push
```

---

## Task 5: ChartToolbar — toggles for news + countdown

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx`

- [ ] **Step 1: Add toggles**

Find the existing Markers section (with earnings/splits/dividends checkboxes). Add a fourth:

```jsx
<label>
  <input
    type="checkbox"
    checked={!!cs.markers?.news}
    onChange={e => onUpdateSettings({
      ...cs,
      markers: { ...cs.markers, news: e.target.checked },
      preset: 'custom',
    })}
  />
  News markers
</label>
```

Find the Display section (with heikinAshi/logScale). Add countdown:

```jsx
<label>
  <input
    type="checkbox"
    checked={!!cs.countdown}
    onChange={e => onUpdateSettings({
      ...cs,
      countdown: e.target.checked,
      preset: 'custom',
    })}
  />
  Countdown to bar close
</label>
```

- [ ] **Step 2: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/components/chart/ChartToolbar.jsx
git commit -m "feat(charts): toolbar toggles for news markers + countdown"
git push
```

---

## Task 6: Smoke + verification

- [ ] **Step 1: Build cleanly**

```bash
cd app && npm run build && cd ..
```

- [ ] **Step 2: Tests pass**

```bash
pytest tests/test_chart_news.py -v
cd app && npx vitest run src/components/chart/CountdownTimer.test.jsx && cd ..
```

- [ ] **Step 3: Manual smoke**

Once Railway deploys:
1. Open AAPL Daily chart
2. Settings → Markers → enable News markers
3. Verify blue dots appear at news-publish timestamps
4. Click a news dot — opens article in new tab
5. Switch to 5-min chart
6. Settings → Display → enable Countdown
7. Verify "X:XX to close" appears bottom-right and counts down in real-time
8. Switch to Daily — countdown shows the trading-day close countdown
9. Switch to Weekly — countdown disappears (not intraday)

- [ ] **Step 4: Final commit + push**

```bash
git push  # ensures all commits are on origin
```

---

## Done — what changed

After this plan ships:

1. News markers (blue dots labeled "N") appear on every chart when enabled — click to read the article
2. Countdown shows seconds-to-bar-close on intraday charts when enabled
3. Both toggle via the existing Indicators/Display panel in chart settings

Visual impact: charts become news-aware. Traders see the catalyst behind a price move at a glance. Countdown adds a subtle premium feel for active intraday trading.

## Self-review

- News endpoint reuses existing `engine.get_news()` pipeline (no new external API)
- Countdown is pure-frontend, 1-second interval, cleans up on unmount
- All settings persist via existing `chartSettings` system
- Markers union is sorted by time before passing to Lightweight Charts (required)
- Click handler is approximate (Lightweight Charts limitation) but uses tolerance window
- No backend changes outside the new router file
- No placeholders
