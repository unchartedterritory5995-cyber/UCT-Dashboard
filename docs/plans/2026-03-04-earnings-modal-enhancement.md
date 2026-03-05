# EarningsModal Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich the EarningsModal with YoY EPS growth, last-4Q beat streak, 3-4 Finnhub news headlines per ticker, and a richer 4-5 sentence AI analysis — all pre-warmed so the modal opens instantly.

**Architecture:** Pre-warm daemon threads fetch Alpha Vantage quarterly history + Finnhub company news in the background when `get_earnings()` rebuilds (30-min TTL). The AI prompt is expanded to 400 tokens and enriched with the new context. Pending AMC tonight entries get a partial pre-warm (no AI call) so when results drop the AI fires immediately.

**Tech Stack:** FastAPI, Python threading, Alpha Vantage EARNINGS endpoint, Finnhub company-news endpoint, Claude Haiku (`claude-haiku-4-5-20251001`), React + CSS Modules

---

## Task 1: Enrich `_generate_earnings_analysis` — AV history + Finnhub news + richer prompt

**Files:**
- Modify: `api/services/engine.py:618-680`

**Step 1: Replace `_generate_earnings_analysis` body (lines 618-680)**

Replace the entire function with the following. Keep the same function signature and cache key:

```python
def _generate_earnings_analysis(sym: str, row: dict | None) -> dict:
    """Generate Claude Haiku earnings analysis + fetch AV history + Finnhub news. Cached 12h."""
    cache_key = f"earnings_analysis_{sym}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    import datetime as _dt
    import requests as _req

    av_key  = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
    fh_key  = os.environ.get("FINNHUB_API_KEY", "")

    # ── Step 1: Alpha Vantage quarterly history ───────────────────────────────
    yoy_eps_growth = None
    beat_streak    = None
    try:
        av_url = (
            f"https://www.alphavantage.co/query"
            f"?function=EARNINGS&symbol={sym}&apikey={av_key}"
        )
        av_resp = _req.get(av_url, timeout=8).json()
        quarters = av_resp.get("quarterlyEarnings", [])
        if len(quarters) >= 5:
            def _to_f(v):
                try: return float(v)
                except (TypeError, ValueError): return None
            q0 = _to_f(quarters[0].get("reportedEPS"))
            q4 = _to_f(quarters[4].get("reportedEPS"))
            if q0 is not None and q4 is not None and q4 != 0:
                pct = (q0 - q4) / abs(q4) * 100
                sign = "+" if pct >= 0 else ""
                yoy_eps_growth = f"{sign}{pct:.1f}%"
        if len(quarters) >= 4:
            beats = sum(
                1 for q in quarters[:4]
                if _to_f(q.get("reportedEPS")) is not None
                and _to_f(q.get("estimatedEPS")) is not None
                and _to_f(q.get("reportedEPS")) >= _to_f(q.get("estimatedEPS"))
            )
            beat_streak = f"Beat {beats} of last 4"
    except Exception:
        pass

    # ── Step 2: Finnhub company news (last 3 days, up to 4 items) ────────────
    news_items = []
    try:
        today_str = _dt.date.today().isoformat()
        from_str  = (_dt.date.today() - _dt.timedelta(days=3)).isoformat()
        fh_url = (
            f"https://finnhub.io/api/v1/company-news"
            f"?symbol={sym}&from={from_str}&to={today_str}&token={fh_key}"
        )
        fh_resp = _req.get(fh_url, timeout=6).json()
        for item in fh_resp[:4]:
            ts = item.get("datetime", 0)
            try:
                dt_str = _dt.datetime.fromtimestamp(ts).strftime("%-I:%M %p") if ts else ""
            except Exception:
                dt_str = ""
            news_items.append({
                "headline": item.get("headline", ""),
                "source":   item.get("source", ""),
                "url":      item.get("url", ""),
                "time":     dt_str,
            })
    except Exception:
        pass

    # ── Step 3: AI analysis (non-Pending only) ────────────────────────────────
    analysis = None
    is_pending = not row or row.get("verdict", "").lower() in ("pending", "")
    if not is_pending:
        try:
            import anthropic

            def _fmt_eps(v):
                if v is None: return "N/A"
                return f"{'-' if v < 0 else ''}${abs(v):.2f}"

            def _fmt_rev(m):
                if m is None: return "N/A"
                return f"${m / 1000:.2f}B" if m >= 1000 else f"${round(m)}M"

            change_pct = row.get("change_pct")
            gap_str = (
                f"{'+' if change_pct >= 0 else ''}{change_pct:.2f}%"
                if change_pct is not None else "N/A"
            )

            context_parts = []
            if yoy_eps_growth:
                context_parts.append(f"YoY EPS growth: {yoy_eps_growth}")
            if beat_streak:
                context_parts.append(f"Beat history: {beat_streak}")
            if news_items:
                context_parts.append(
                    "Recent headlines: "
                    + " / ".join(n["headline"] for n in news_items[:2] if n["headline"])
                )
            context_block = "\n".join(context_parts)

            prompt = (
                f"Analyze this earnings report for {sym} in 4-5 concise sentences.\n"
                f"Be specific about the business — no filler, no trade advice.\n\n"
                f"Verdict: {row.get('verdict')}\n"
                f"EPS: Expected {_fmt_eps(row.get('eps_estimate'))} → "
                f"Reported {_fmt_eps(row.get('reported_eps'))} "
                f"({row.get('surprise_pct', 'N/A')} surprise)\n"
                f"Revenue: Expected {_fmt_rev(row.get('rev_estimate'))} → "
                f"Reported {_fmt_rev(row.get('rev_actual'))} "
                f"({row.get('rev_surprise_pct', 'N/A')} surprise)\n"
                f"Stock reaction: {gap_str}\n"
            )
            if context_block:
                prompt += f"{context_block}\n"
            prompt += (
                "\nCover: what the numbers say about the business, whether this is "
                "consistent with trend, and what the market reaction implies about expectations."
            )

            client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            )
            analysis = msg.content[0].text.strip()
        except Exception:
            analysis = None

    result = {
        "sym":            sym,
        "analysis":       analysis,
        "yoy_eps_growth": yoy_eps_growth,
        "beat_streak":    beat_streak,
        "news":           news_items,  # list of {headline, source, url, time}
    }
    cache.set(cache_key, result, ttl=43200)  # 12 h
    return result
```

**Step 2: Verify the function is syntactically correct**

Run: `python -c "import api.services.engine; print('OK')"` from `C:\Users\Patrick\uct-dashboard\`
Expected: `OK` with no errors

**Step 3: Smoke-test against a live symbol**

Run: `python -c "from api.services.engine import _generate_earnings_analysis; import json; print(json.dumps(_generate_earnings_analysis('AVGO', {'verdict':'beat','reported_eps':1.60,'eps_estimate':1.50,'surprise_pct':'+6.7%','rev_actual':14000,'rev_estimate':13500,'rev_surprise_pct':'+3.7%','change_pct':5.2}), indent=2))"`
Expected: JSON with `analysis` (4-5 sentences), `yoy_eps_growth` (string or null), `beat_streak` (string or null), `news` (list, may be empty if no recent news)

---

## Task 2: Partial pre-warm for Pending AMC tonight

**Files:**
- Modify: `api/services/engine.py:683-700`

**Step 1: Replace `_prewarm_earnings_analysis` body (lines 683-700)**

The key change: for Pending entries in `amc_tonight`, fire a limited pre-warm that fetches AV history + news but skips the AI call. Replace the function body:

```python
def _prewarm_earnings_analysis(data: dict) -> None:
    """Pre-cache AI analysis for reported tickers; pre-fetch context for Pending AMC tonight."""
    import threading
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return

    def _partial_prewarm(sym: str) -> None:
        """For Pending entries: cache news + AV history without AI call."""
        cache_key = f"earnings_analysis_{sym}"
        if cache.get(cache_key):
            return
        # Reuse _generate_earnings_analysis with a None row — it skips AI but still
        # fetches AV history and Finnhub news, then caches the partial result.
        _generate_earnings_analysis(sym, None)

    for bucket in ("bmo", "amc", "amc_tonight"):
        for entry in data.get(bucket, []):
            sym = entry.get("sym", "")
            if not sym:
                continue
            is_pending = entry.get("verdict", "").lower() in ("pending", "")
            if cache.get(f"earnings_analysis_{sym}"):
                continue  # already warmed

            if is_pending and bucket == "amc_tonight":
                # Partial pre-warm: AV history + news, no AI
                t = threading.Thread(
                    target=_partial_prewarm,
                    args=(sym,),
                    daemon=True,
                )
                t.start()
            elif not is_pending:
                # Full pre-warm: AV history + news + AI analysis
                t = threading.Thread(
                    target=_generate_earnings_analysis,
                    args=(sym, dict(entry)),
                    daemon=True,
                )
                t.start()
```

**Step 2: Verify syntax**

Run: `python -c "import api.services.engine; print('OK')"` from project root
Expected: `OK`

---

## Task 3: EarningsModal.jsx — trend row + news list

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`

**Step 1: Update the `hasAiContent` check (line 56)**

Old:
```jsx
const hasAiContent = aiState.data?.analysis || aiState.data?.news
```
New:
```jsx
const hasAiContent = aiState.data?.analysis || aiState.data?.news?.length
```

**Step 2: Add trend row — between the summary block (line 105) and gap block (line 107)**

After the `{summaryText && (...)}` block and before the `{gap != null && (...)}` block, insert:

```jsx
{(aiState.data?.yoy_eps_growth || aiState.data?.beat_streak) && (
  <div className={styles.trend}>
    {aiState.data.yoy_eps_growth && (
      <span className={aiState.data.yoy_eps_growth.startsWith('+') ? styles.pos : styles.neg}>
        YoY EPS {aiState.data.yoy_eps_growth}
      </span>
    )}
    {aiState.data.beat_streak && (
      <span className={styles.muted}>{aiState.data.beat_streak}</span>
    )}
  </div>
)}
```

**Step 3: Replace single news link with news list in the `aiSection` block (lines 125-135)**

Old (lines 125-135):
```jsx
{aiState.data.news && (
  <a
    href={aiState.data.news.url}
    target="_blank"
    rel="noopener noreferrer"
    className={styles.newsLink}
  >
    <span className={styles.newsSource}>{aiState.data.news.source}</span>
    {aiState.data.news.headline} ↗
  </a>
)}
```
New:
```jsx
{aiState.data.news?.length > 0 && (
  <div className={styles.newsList}>
    {aiState.data.news.map((item, i) => (
      <a
        key={i}
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.newsItem}
      >
        <span className={styles.newsItemSource}>{item.source}{item.time ? ` · ${item.time}` : ''}</span>
        <span className={styles.newsItemHeadline}>{item.headline} ↗</span>
      </a>
    ))}
  </div>
)}
```

---

## Task 4: EarningsModal.module.css — widen + new classes

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.module.css`

**Step 1: Widen modal (line 15)**

Old:
```css
  width: 420px;
```
New:
```css
  width: 500px;
```

**Step 2: Add `.muted` class after `.neg` (line 136)**

After `.neg { color: var(--loss); }` add:
```css
.muted { color: var(--text-muted); }
```

**Step 3: Add `.trend` class after `.muted`**

```css
.trend {
  display: flex;
  gap: 16px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
}
```

**Step 4: Replace `.newsLink` + `.newsSource` with new news list classes**

Remove:
```css
.newsLink {
  display: block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: var(--info, #5ba3f5);
  text-decoration: none;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  line-height: 1.45;
}
.newsLink:hover { text-decoration: underline; }

.newsSource {
  display: block;
  font-size: 8px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 3px;
}
```

Add in their place:
```css
.newsList {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.newsItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
}
.newsItem:last-child { border-bottom: none; }
.newsItem:hover .newsItemHeadline { text-decoration: underline; }

.newsItemSource {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 8px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.newsItemHeadline {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: var(--info, #5ba3f5);
  line-height: 1.4;
}
```

---

## Verification

1. Open modal for a reported BMO ticker (e.g. ANF) — should show:
   - Trend row: `YoY EPS +X.X%` (green/red) and `Beat N of last 4` (muted)
   - 4-5 sentence AI analysis (longer than before)
   - Up to 4 news headlines, each with source + time
   - Modal is noticeably wider (500px vs 420px)

2. Open modal for AVGO (Pending until after close) — should show:
   - Trend row with YoY + beat streak (from AV history, pre-warmed)
   - News headlines visible even before results drop
   - AI analysis shows spinner → populates within ~5s after results drop (context already in cache)

3. Open modal for a small-cap with no AV history — trend row hidden, analysis still renders, news shows if available

4. Hit `GET /api/earnings-analysis/AVGO` directly — confirm response shape:
   ```json
   {
     "sym": "AVGO",
     "analysis": "...",
     "yoy_eps_growth": "+22.1%",
     "beat_streak": "Beat 4 of last 4",
     "news": [{"headline": "...", "source": "...", "url": "...", "time": "4:32 PM"}, ...]
   }
   ```
