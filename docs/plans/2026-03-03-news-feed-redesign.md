# News Feed Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show only ticker-specific Finviz headlines, with a clickable ticker chip and a scrollable 20-item list.

**Architecture:** Backend adds `ticker` field to each news item and filters to stock-specific headlines only (ticker non-empty). Frontend wraps the ticker in the existing `TickerPopup` component and makes the tile scrollable.

**Tech Stack:** FastAPI (Python), React + SWR, TickerPopup (existing), NewsFeed.module.css

---

### Task 1: Backend — expose ticker, filter to stock-specific headlines

**Files:**
- Modify: `api/services/engine.py` — `get_news()` function (~line 411)

**What the Finviz CSV looks like:**
The CSV has a header row. Columns include `Title`, `Source`, `Url`, `Date`, `Category`, and `Ticker`.
The current parser captures all except `Ticker`. We need to:
1. Add `"ticker": row.get("Ticker", "").upper().strip()` to each result dict
2. Only append items where `ticker` is non-empty (filters out general market news)

**Step 1: Update the parser loop in `get_news()`**

Change this block:
```python
        result = []
        for line in lines[1:31]:  # up to 30 items
            vals = [v.strip() for v in line.split(",", len(headers) - 1)]
            row = dict(zip(headers, vals))
            headline = row.get("Title", "")
            if headline:
                result.append({
                    "headline": headline,
                    "source":   row.get("Source", ""),
                    "url":      row.get("Url", ""),
                    "time":     row.get("Date", ""),
                    "category": row.get("Category", ""),
                })
```

To:
```python
        result = []
        for line in lines[1:]:  # scan all rows to fill 20 ticker-specific items
            if len(result) >= 20:
                break
            vals = [v.strip() for v in line.split(",", len(headers) - 1)]
            row = dict(zip(headers, vals))
            headline = row.get("Title", "")
            ticker   = row.get("Ticker", "").upper().strip()
            if headline and ticker:
                result.append({
                    "headline": headline,
                    "source":   row.get("Source", ""),
                    "url":      row.get("Url", ""),
                    "time":     row.get("Date", ""),
                    "category": row.get("Category", ""),
                    "ticker":   ticker,
                })
```

**Step 2: Verify locally**

```bash
curl -s http://localhost:8000/api/news | python -m json.tool | head -40
```

Expected: Each item has a non-empty `"ticker"` field (e.g. `"ticker": "NVDA"`). No items with blank ticker.

**Step 3: Commit**

```bash
git add api/services/engine.py
git commit -m "feat: news feed — add ticker field, filter to stock-specific headlines only"
```

---

### Task 2: Frontend — ticker chip + scrollable list

**Files:**
- Modify: `app/src/components/tiles/NewsFeed.jsx`
- Modify: `app/src/components/tiles/NewsFeed.module.css`

**Step 1: Update NewsFeed.jsx**

Replace the entire file content with:

```jsx
// app/src/components/tiles/NewsFeed.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './NewsFeed.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function fmtTime(raw) {
  if (!raw) return ''
  // Finviz Date field is "YYYY-MM-DD HH:MM:SS" ET
  const dt = new Date(raw.replace(' ', 'T') + '-05:00')
  if (isNaN(dt)) return raw
  const now = Date.now()
  const diff = Math.floor((now - dt.getTime()) / 60000) // minutes ago
  if (diff < 1)   return 'just now'
  if (diff < 60)  return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

export default function NewsFeed({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/news',
    fetcher,
    { refreshInterval: 120000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="News">
      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <div className={styles.feed}>
          {data.slice(0, 20).map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.item}
            >
              <div className={styles.headline}>{item.headline}</div>
              <div className={styles.meta}>
                {item.ticker && (
                  <TickerPopup sym={item.ticker}>
                    <span className={styles.ticker}>${item.ticker}</span>
                  </TickerPopup>
                )}
                <span className={styles.source}>{item.source}</span>
                <span className={styles.time}>{fmtTime(item.time)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </TileCard>
  )
}
```

**Step 2: Update NewsFeed.module.css**

Replace the entire file content with:

```css
.feed {
  display: flex;
  flex-direction: column;
  max-height: 420px;
  overflow-y: auto;
}
.item {
  display: block;
  text-decoration: none;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
.item:last-child {
  border-bottom: none;
}
.item:hover {
  background: var(--bg-hover);
  margin: 0 -14px;
  padding-left: 14px;
  padding-right: 14px;
}
.headline {
  font-size: 12px;
  color: var(--text-bright);
  line-height: 1.5;
  margin-bottom: 4px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ticker {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  font-weight: 700;
  color: var(--ut-gold);
  background: rgba(212, 175, 55, 0.12);
  border: 1px solid rgba(212, 175, 55, 0.25);
  border-radius: 3px;
  padding: 1px 4px;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.ticker:hover {
  background: rgba(212, 175, 55, 0.22);
}
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
.loading { color: var(--text-muted); font-size: 12px; }
```

**Step 3: Verify in browser**

- Start dev: `uvicorn api.main:app --reload --port 8000` + `cd app && npm run dev`
- Open dashboard — News tile should show 20 items, each with a gold `$TICK` chip
- Hover a chip — Finviz chart preview should appear
- Click a chip — 5-tab chart modal opens
- Headline clicks open the article URL

**Step 4: Commit**

```bash
git add app/src/components/tiles/NewsFeed.jsx app/src/components/tiles/NewsFeed.module.css
git commit -m "feat: news feed — ticker chip via TickerPopup, relative time, scrollable 20 items"
```

---

### Task 3: Push to Railway

```bash
git push origin master
```

Verify live at `https://web-production-05cb6.up.railway.app`.
