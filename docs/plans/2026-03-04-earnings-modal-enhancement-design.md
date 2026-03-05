# EarningsModal Enhancement — Design Doc
_2026-03-04_

## Goal

When a user clicks any earnings row in the Catalyst Flow tile, the modal should immediately surface everything needed to decide whether to prioritize a trade — without requiring them to open another tab. User makes the decision; we aggregate the data.

## Current State

- EPS / Revenue table (Expected / Reported / Surprise %)
- Summary line (Beat/Miss)
- Live gap % from Massive API
- 3-sentence AI analysis (Claude Haiku, 180 tokens, cached 12h)
- Single news link (first match from news cache)
- View Chart + FinViz buttons

## What's Missing

- No YoY EPS growth context (is this beat consistent with trend, or a one-off?)
- No beat/miss history (does this company reliably beat?)
- AI analysis too thin — 3 sentences at 180 tokens can't cover the business story
- Single news link is opportunistic — often misses earnings-specific headlines

## Architecture

### Pre-warm approach (Approach C)

All enrichment happens in background daemon threads during `_prewarm_earnings_analysis`, which fires every time `get_earnings()` rebuilds (30-min TTL). The modal hits a pre-populated cache and opens instantly.

For **Pending AMC tonight** entries: pre-fetch news + quarterly history even before results drop. When the company reports and pre-warm re-fires, AI analysis generates immediately from already-cached context.

### Data sources

| Data | Source | Notes |
|------|--------|-------|
| YoY EPS growth | Alpha Vantage `EARNINGS` endpoint | Free, returns 28 quarters, already tested |
| Last-4Q beat streak | Same AV response | Derived from `reportedEPS` vs `estimatedEPS` |
| Company news (3-4 headlines) | Finnhub `GET /company-news?symbol=SYM` | Last 3 days, most recent 4 items |
| AI analysis | Claude Haiku, 400 tokens | Same model, bigger prompt + more context |

---

## Backend Changes

### `_generate_earnings_analysis(sym, row)` in `api/services/engine.py`

**Step 1 — Fetch AV quarterly history**
```python
GET https://www.alphavantage.co/query?function=EARNINGS&symbol={sym}&apikey={key}
```
- Extract last 5 `quarterlyEarnings` entries (sorted newest-first by AV)
- YoY EPS growth: `(q[0].reportedEPS - q[4].reportedEPS) / abs(q[4].reportedEPS) * 100`
- Beat streak: count how many of last 4 quarters had `reportedEPS >= estimatedEPS`
- Returns: `yoy_eps_growth` (str, e.g. `"+22.1%"`), `beat_streak` (str, e.g. `"Beat 4 of last 4"`)
- Graceful fallback: if AV fails or fewer than 5 quarters available, skip this context

**Step 2 — Fetch Finnhub company news**
```python
GET https://finnhub.io/api/v1/company-news?symbol={sym}&from={3_days_ago}&to={today}&token={key}
```
- Take up to 4 most recent items
- Fields: `headline`, `source`, `url`, `datetime` (unix timestamp → formatted time string)
- Returns: list of `{headline, source, url, time}` dicts

**Step 3 — Build enhanced AI prompt (non-Pending only)**
```
Analyze this earnings report for {sym} in 4-5 concise sentences.
Be specific about the business — no filler, no trade advice.

Verdict: {verdict}
EPS: Expected {est} → Reported {actual} ({surprise}% surprise)
Revenue: Expected {rev_est} → Reported {rev_actual} ({rev_surp}% surprise)
YoY EPS growth: {yoy}
Beat history: {beat_streak}
Stock reaction: {gap}%
Recent headlines: {news[0].headline} / {news[1].headline}

Cover: what the numbers say about the business, whether this is consistent
with trend, and what the market reaction implies about expectations.
```
- max_tokens: 400 (up from 180)
- Model: claude-haiku-4-5-20251001 (unchanged)

**Step 4 — Cache response shape**
```python
{
  "sym": "AVGO",
  "analysis": "4-5 sentence analysis...",
  "yoy_eps_growth": "+22.1%",
  "beat_streak": "Beat 4 of last 4",
  "news": [
    {"headline": "...", "source": "Reuters", "url": "...", "time": "4:32 PM"},
    {"headline": "...", "source": "Benzinga", "url": "...", "time": "3:15 PM"},
    {"headline": "...", "source": "Bloomberg", "url": "...", "time": "2:01 PM"},
    {"headline": "...", "source": "AP", "url": "...", "time": "1:44 PM"},
  ]
}
```
TTL: 12h (unchanged)

### `_prewarm_earnings_analysis(data)` in `api/services/engine.py`

- Add `"amc_tonight"` bucket to pre-warm loop (already done for gap/analysis, but Pending entries currently skipped)
- For **Pending** entries in `amc_tonight`: fire a limited pre-warm thread that fetches news + AV history only (no AI call). Store as `{sym, analysis: null, yoy_eps_growth, beat_streak, news}`. When results drop and pre-warm re-fires, AI call completes quickly with context already in hand.

---

## Frontend Changes

### `EarningsModal.jsx`

**New data consumed from `aiState.data`:**
- `yoy_eps_growth` — string or null
- `beat_streak` — string or null
- `news` — array of `{headline, source, url, time}` (replaces single `news` object)

**Layout additions:**

1. **Trend row** — below the EPS/Rev table, above the gap line:
```jsx
{(yoy || streak) && (
  <div className={styles.trend}>
    {yoy && <span className={yoy.startsWith('+') ? styles.pos : styles.neg}>
      YoY EPS {yoy}
    </span>}
    {streak && <span className={styles.muted}>{streak}</span>}
  </div>
)}
```

2. **AI analysis** — same placement, no structural change (just more text)

3. **News list** — replace single `<a>` with mapped list:
```jsx
{news.map((item, i) => (
  <a key={i} href={item.url} target="_blank" className={styles.newsItem}>
    <span className={styles.newsSource}>{item.source}</span>
    <span className={styles.newsHeadline}>{item.headline} ↗</span>
    <span className={styles.newsTime}>{item.time}</span>
  </a>
))}
```

### `EarningsModal.module.css`

- `.modal` width: 420px → 500px
- `.trend`: flex row, gap 16px, font-size 11px, mono font
- `.newsItem`: block, padding 8px 0, border-top 1px solid border, flex column
- `.newsHeadline`: font-size 11px, color info blue, line-height 1.4
- `.newsTime`: font-size 9px, color muted, margin-top 2px

---

## Files Modified

| File | Change |
|------|--------|
| `api/services/engine.py` | `_generate_earnings_analysis` — AV history + Finnhub news + richer prompt; `_prewarm_earnings_analysis` — partial pre-warm for Pending AMC tonight |
| `app/src/components/tiles/EarningsModal.jsx` | Consume `yoy_eps_growth`, `beat_streak`, news list; render trend row + news list |
| `app/src/components/tiles/EarningsModal.module.css` | Widen modal to 500px; add `.trend`, `.newsItem`, `.newsHeadline`, `.newsTime` |

**Not modified:** `CatalystFlow.jsx`, `earnings.py` router, `earnings-gaps` endpoint

---

## Verification

1. Click any reported BMO earnings row → modal opens instantly (pre-warmed), shows YoY EPS growth, beat streak, 3-4 news headlines, 4-5 sentence analysis
2. Click AVGO (Pending until after close) → opens with news + historical data, analysis populates within 5s after results drop
3. Click a company with no AV history (small cap) → trend row hidden, analysis still renders, news shows if available
4. Click a Pending company with no news → trend row hidden, news section hidden, only the table + pending state shown
