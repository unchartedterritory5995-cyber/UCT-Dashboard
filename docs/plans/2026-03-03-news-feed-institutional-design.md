# News Feed — Institutional Grade Design

**Date:** 2026-03-03
**Status:** Approved

---

## Goal

Upgrade the News tile from a basic headline list into an institutional-grade swing-trader feed — comparable in signal quality to Benzinga Pro or a Bloomberg news terminal, built entirely on existing APIs and infrastructure.

## Audience

Active swing traders using the dashboard primarily for **premarket prep** (4:00–9:30 AM ET). Secondary use: intraday monitoring and eventual post-market review.

---

## Data Sources

Four sources, each contributing something the others can't:

| Source | Speed | Cost | Primary Value |
|--------|-------|------|---------------|
| SEC EDGAR 8-K RSS | Fastest | Free | Earnings releases, M&A, material events — direct from companies before wire services pick it up |
| Finviz Elite news CSV | Very fast | Already paying | Curated trader headlines, fast and clean |
| FDA.gov RSS | Instant | Free | Direct biotech/drug approval and rejection announcements |
| Alpha Vantage NEWS_SENTIMENT | 10–30 min lag | Already paying | Sentiment scoring + topic classification — the other sources don't provide this |

AV stays in the stack specifically for its `overall_sentiment_label` and `topics` array. It is NOT the primary source for freshness — SEC EDGAR and Finviz are.

---

## Category Classification

Every article is assigned exactly one category badge. Categories are determined by:
1. AV `topics` array (if article came from AV or can be enriched by AV)
2. Headline text pattern matching (for upgrade/downgrade detection and EDGAR 8-K type)
3. Source routing (FDA.gov RSS → always `BIO`)

| Badge | Source signal | Color |
|-------|--------------|-------|
| `EARN` | AV topic "Earnings" OR EDGAR 8-K item 2.02 | Amber |
| `M&A` | AV topic "Mergers & Acquisitions" OR EDGAR 8-K item 1.01 | Purple |
| `UPGRADE` | Headline contains: "upgrades to", "raises to", "initiates", "outperform", "overweight", "price target raised" | Green |
| `DOWNGRADE` | Headline contains: "downgrades to", "cuts to", "underperform", "underweight", "price target cut/lowered" | Red |
| `BIO` | AV topic "Life Sciences" OR source = FDA.gov RSS | Teal |
| `IPO` | AV topic "IPO" | Blue |
| `MACRO` | AV topic "Economy - Monetary" | Gray |
| `GENERAL` | Insider purchases, partnerships, contracts, product launches, PR statements — anything not matched above | Muted gray |

---

## Sentiment Signal

Source: AV `overall_sentiment_label` per article.

Mapped to a `sentiment` field: `"bullish"`, `"bearish"`, or `"neutral"`.

- `"Bullish"` / `"Somewhat-Bullish"` → `"bullish"`
- `"Bearish"` / `"Somewhat-Bearish"` → `"bearish"`
- `"Neutral"` / missing → `"neutral"`

Articles from EDGAR and FDA RSS (no AV sentiment available) default to `"neutral"` unless the headline matches a clear positive/negative pattern.

---

## Priority Sort

Backend sorts the final 20-item list by category priority first, then by recency within each tier.

**Standard hours (9:30 AM – 4:00 PM ET):**
```
1. EARN
2. M&A
3. UPGRADE / DOWNGRADE
4. BIO
5. IPO
6. MACRO
7. GENERAL
→ within each tier: newest first
```

**Premarket mode (4:00–9:30 AM ET) — gap-driver priority:**
```
Pinned to top (newest first): EARN, M&A, BIO
Then: UPGRADE, DOWNGRADE, IPO, MACRO, GENERAL
```

This is purely server-side sort logic based on server time. No UI change.

---

## Story Deduplication

Multiple outlets covering the same event for the same ticker within a 2-hour window are collapsed into one item. The surviving item:
- Uses the highest-credibility source's headline (Reuters > AP > Benzinga > others)
- Shows `Reuters · Benzinga +1` in the source field when 3+ sources cover it
- Counts toward one of the 20 slots, not multiple

Deduplication key: `(primary_ticker, category, floor(timestamp / 7200))` — same ticker + same category within a 2-hour bucket = same story.

---

## Multiple Tickers

Up to 3 ticker chips per article. Selected by AV `relevance_score` descending. Primary ticker (highest relevance) drives category sort and sentiment. Tickers 2 and 3 are display-only chips.

For EDGAR/FDA articles without AV ticker sentiment, extract ticker from the filing company name or URL using a lookup against known symbols.

---

## Inline Live Price Change

For each article's primary ticker, fetch the current % change from Massive API (already integrated, zero new dependencies). Display inline next to the ticker chip:

```
$NVDA +8.4%   $AMD +2.1%   Benzinga  ·  4m ago
```

Color: green for positive, red for negative, muted for flat (±0.1%).

Massive call is batched: collect all primary tickers from the 20 articles, make one batch snapshot call, decorate results. Adds ~100ms to first load, cached with the feed at 5-min TTL.

---

## "NEW" Pulse Indicator

Articles published within the last 15 minutes get a small animated green dot in the meta row. No text label — just the dot. Disappears after 15 minutes automatically (frontend computes age from `item.time`).

---

## Frontend Layout

Each item:

```
│← 2px sentiment border
│
│  [EARN]  NVDA beats Q4 estimates by 18%, raises FY guidance
│          $NVDA +8.4%  $AMD +2.1%   Benzinga · AP +1   • 4m ago
│
```

- **Left border**: 2px, green=bullish, red=bearish, none=neutral
- **Category badge**: monospace pill, uppercase, above meta row
- **Headline**: 12px, `var(--text-bright)`, unchanged
- **Meta row**: ticker chips (with live %) → source → NEW dot (if fresh) → time (right-aligned)
- **Hover**: existing bg-hover behavior, unchanged

---

## Files to Modify

| File | Change |
|------|--------|
| `api/services/engine.py` | `get_news()` — multi-source fetch, category classification, deduplication, priority sort, batch Massive price fetch, sentiment pass-through |
| `app/src/components/tiles/NewsFeed.jsx` | Render category badge, sentiment border, up to 3 ticker chips with inline %, NEW dot |
| `app/src/components/tiles/NewsFeed.module.css` | Badge styles per category, sentiment border, NEW dot animation, inline price styles |

**Not modified:** `massive.py` (existing batch snapshot endpoint is sufficient), `TickerPopup.jsx` (unchanged)

---

## Constraints

- No new paid APIs
- No AI inference per-article (latency constraint) — classification is rule-based
- All enrichment (price %, sentiment) cached at 5-min TTL with the feed
- Graceful degradation: if any source fails, the others fill the feed. If Massive price fetch fails, chips render without the % figure.
