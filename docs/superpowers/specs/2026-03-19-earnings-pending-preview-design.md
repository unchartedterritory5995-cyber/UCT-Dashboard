# Earnings Pending Preview — Design Spec
**Date:** 2026-03-19
**Status:** Approved
**Scope:** Add forward-looking AI preview writeup to Pending earnings entries in the EarningsModal

---

## Problem

When a user clicks a Pending (not-yet-reported) earnings entry in the CatalystFlow tile, the modal shows a red "Pending – not yet reported" box with no useful content. The expected EPS/revenue estimates are visible in the table but there is no context, analysis, or trade-prep commentary. The post-earnings modal already has a rich AI analysis section; Pending entries have nothing equivalent.

---

## Goal

Replace the red Pending summary box with an AI-generated pre-earnings preview containing:
1. A short paragraph (1–2 sentences) covering setup context, expectations, and historical pattern
2. A "Things to watch" section with exactly **3** bullet points specific to that company's upcoming report

---

## Architecture

### Backend — New `_generate_earnings_preview()` function

**Location:** `api/services/engine.py`, alongside existing `_generate_earnings_analysis()`

**Signature:** `_generate_earnings_preview(sym: str, row: dict) -> dict`

**Contract:** `row` must be a non-None dict — unlike `_generate_earnings_analysis()`, `None` is not a valid input. The router branch (`if row and ...`) and the pre-warm (`dict(entry)`) both guarantee a non-None row before calling. Add `assert row is not None` at the top of the function to make this explicit and fail loudly rather than silently producing garbage output.

**Cache check (inside the function, same pattern as `_generate_earnings_analysis()`):**
```python
cache_key = f"earnings_preview_{sym}"
cached = cache.get(cache_key)
if cached:
    return cached
```

**Data sources (all already in flight — no new API dependencies):**
- Alpha Vantage `EARNINGS` endpoint → quarterly series (beat streak, YoY EPS trend)
  - YoY EPS growth: same-quarter comparison — `q[0].reportedEPS` vs `q[4].reportedEPS` from the quarterly series, identical to the existing `_generate_earnings_analysis()` calculation
- Finnhub `company-news` → last 3 days of headlines (up to 4)
  - News field shape per item: `{"headline": str, "source": str, "url": str, "time": str}` where `time` is formatted as `"HH:MM am/pm"` from unix timestamp (matching existing news rendering in `EarningsModal.jsx` line 167: `item.source + " · " + item.time`)
- `row` dict → `eps_estimate` (float|None), `rev_estimate` (float|None, in millions), `change_pct` (float|None — added to row entries by `_enrich_earnings_with_gap()` before this function is called)

**AI call:**
- Model: `claude-haiku-4-5-20251001` (matches `_EARNINGS_AI_MODEL` constant — correct as-is)
- Max tokens: 350
- Prompt: forward-looking tone, explicitly requests 1–2 sentence paragraph + **exactly 3** numbered bullet points covering: (1) historical consistency — beat streak + YoY trend, (2) revenue/guidance watch, (3) market positioning — gap % context

**Return shape (success):**
```python
{
  "sym": str,
  "preview_text": str,           # 1–2 sentence forward-looking paragraph
  "preview_bullets": list[str],  # exactly 3 bullet strings
  "beat_history": list[str],     # ["✓", "✗", "✓", "✓"] oldest→newest; [] if AV fails
  "yoy_eps_growth": str,         # e.g. "+22.1%" or "N/A" if AV fails
  "beat_streak": str,            # e.g. "Beat 2 of last 4" or "" if AV fails
  "news": list[dict]             # up to 4 items; [] if Finnhub fails
}
```

**Return shape (AI call failure — graceful degradation):**
All data-fetch fields are still populated when the AI call fails. Only the AI-generated fields are empty:
```python
{
  "sym": str,
  "preview_text": "",            # empty string — frontend shows "Preview unavailable" label
  "preview_bullets": [],
  "beat_history": list[str],     # populated from AV if AV succeeded, else []
  "yoy_eps_growth": str,         # populated from AV if AV succeeded, else "N/A"
  "beat_streak": str,            # populated from AV if AV succeeded, else ""
  "news": list[dict]             # populated from Finnhub if Finnhub succeeded, else []
}
```

**Cache write (inside the function, same TTL logic as existing):**
```python
ttl = _EARNINGS_CACHE_TTL_HIT if preview_text else _EARNINGS_CACHE_TTL_MISS
cache.set(cache_key, result, ttl=ttl)
```
Key: `earnings_preview_{sym}` (underscore separator, matching project convention — e.g. `earnings_analysis_{sym}` at line 724 of engine.py). Separate from `earnings_analysis_{sym}` — prevents stale preview data being served after verdict transitions from Pending to reported.

### Backend — Endpoint routing branch

**Location:** `api/routers/earnings.py`, `earnings_analysis()` handler

**Row lookup:** unchanged — existing handler already scans all three buckets from `get_earnings()`:
```python
row = None
for bucket in ("bmo", "amc", "amc_tonight"):
    for entry in data.get(bucket, []):
        if entry.get("sym") == sym:
            row = entry
            break
    if row:
        break
```

**New routing branch** (replaces the final `return _generate_earnings_analysis(sym, row)` line):
```python
if row and row.get("verdict", "").lower() == "pending":
    return _generate_earnings_preview(sym, row)
else:
    return _generate_earnings_analysis(sym, row)
```
Uses `.lower() == "pending"` for safety — `_build_earnings_entry()` stores `"Pending"` (capital P at line 660 of engine.py) but the comparison is case-insensitive to match the frontend convention (`verdict === 'pending'` lowercase in `EarningsModal.jsx` line 61).

### Backend — Pre-warm update

**Location:** `engine.py`, `_prewarm_earnings_analysis()`

**Current behavior for Pending entries:** `_partial_prewarm(sym)` calls `_generate_earnings_analysis(sym, None)` — passing `None` forces `is_pending=True` inside that function, which skips the AI call but fetches AV history + Finnhub news and caches the partial result under `earnings_analysis_{sym}`.

**New behavior:** Replace the `_partial_prewarm` inner function and its `_prewarm_executor.submit(_partial_prewarm, sym)` call with a direct submit of `_generate_earnings_preview`:
```python
# Before (remove):
def _partial_prewarm(sym: str) -> None:
    cache_key = f"earnings_analysis_{sym}"
    if cache.get(cache_key):
        return
    _generate_earnings_analysis(sym, None)

# In the loop, change (remove bucket restriction — Pending can appear in bmo too):
if is_pending and bucket == "amc_tonight":
    _prewarm_executor.submit(_partial_prewarm, sym)

# After (replace with — fires for any Pending entry across all buckets):
if is_pending:
    if not cache.get(f"earnings_preview_{sym}"):
        _prewarm_executor.submit(_generate_earnings_preview, sym, dict(entry))
```
`_generate_earnings_preview()` internally handles AV history + Finnhub news + AI call — no separate partial fetch needed. The cache key check changes from `earnings_analysis_{sym}` to `earnings_preview_{sym}` for Pending entries.

---

## Frontend — EarningsModal UI

### Key facts from existing code

- `isPending = verdict === 'pending'` (line 61)
- `summaryText` for Pending: `'Pending — not yet reported'` (line 65) — renders as red `styles.summaryMiss` box (line 113)
- `styles.badge` = existing CSS class for `⬛ EARNINGS REPORT` label; **intentionally reused** for `▸ EARNINGS PREVIEW` — same visual style, different text
- `styles.aiLoading` / `styles.aiSpinner` / `styles.aiText` = existing classes, reused as-is
- `styles.newsList` / `styles.newsItem` / `styles.newsItemSource` / `styles.newsItemHeadline` = existing classes, reused as-is
- Line 118–136: trend block (`yoy_eps_growth`, `beat_history`, `beat_streak`) is **outside** the `!isPending` gate — it renders unconditionally from `aiState.data`. Currently shows nothing for Pending because `aiState.data` is null; after this change it will populate automatically from `_generate_earnings_preview()` response fields.
- Line 145: `{!isPending && (` gates the post-earnings AI analysis + news block — this gate is kept; the new preview block is added separately for `isPending`
- `hasAiContent` (line 67) is used only inside the `!isPending` block — it checks `aiState.data?.analysis`. The new preview path is independent and checks `aiState.data?.preview_text` directly; `hasAiContent` is not used or modified.

### Changes

**1. Remove `summaryText` for Pending (line 65)**

Change:
```jsx
: isPending ? 'Pending — not yet reported' : null
```
To:
```jsx
: null
```
The `{summaryText && <div>}` block already returns nothing when `summaryText` is null — no further change needed.

**2. Add preview block after the existing summary block (after line 116)**

```jsx
{isPending && (
  aiState.loading ? (
    <div className={styles.aiLoading}>
      <span className={styles.aiSpinner} />
      Generating preview…
    </div>
  ) : aiState.data?.preview_text ? (
    <div className={styles.previewBox}>
      <span className={styles.badge}>▸ EARNINGS PREVIEW</span>
      <p className={styles.aiText}>{aiState.data.preview_text}</p>
      {aiState.data.preview_bullets?.length > 0 && (
        <>
          <div className={styles.watchLabel}>▸ THINGS TO WATCH</div>
          <ul className={styles.watchList}>
            {aiState.data.preview_bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </>
      )}
      {aiState.data.news?.length > 0 && (
        <div className={styles.newsList}>
          {aiState.data.news.map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.newsItem}
              aria-label={`${item.source}: ${item.headline}`}
            >
              <span className={styles.newsItemSource}>
                {item.source}{item.time ? ` · ${item.time}` : ''}
              </span>
              <span className={styles.newsItemHeadline}>{item.headline} ↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  ) : aiState.data && !aiState.data.preview_text ? (
    <div className={styles.previewUnavailable}>Preview unavailable</div>
  ) : null
)}
```

Note: `aiState.data && !aiState.data.preview_text` distinguishes "fetch completed, AI failed" from "fetch not yet returned" (null) — avoids showing "Preview unavailable" before the fetch completes.

**3. No change to the `{!isPending && (` block (line 145)** — the post-earnings AI analysis + news block is unchanged; it continues to gate on `!isPending`.

### New CSS classes (EarningsModal.module.css)

```css
.previewBox {
  border-left: 2px solid #c9a84c;
  background: rgba(201, 168, 76, 0.06);
  border-radius: 4px;
  padding: 10px 12px;
  margin: 10px 0;
}

.watchLabel {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--text-muted);
  text-transform: uppercase;
  margin: 8px 0 4px;
}

.watchList {
  list-style: disc;
  padding-left: 16px;
  margin: 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.watchList li {
  margin-bottom: 3px;
}

.previewUnavailable {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  margin: 8px 0;
}
```

---

## Data Flow

```
Pre-warm (background, on get_earnings() rebuild):
  Pending entries in amc_tonight
    → cache miss check at earnings_preview_{sym}
    → submit _generate_earnings_preview(sym, entry) to thread pool
    → AV quarterly history + Finnhub news + Claude Haiku
    → cache.set(f"earnings_preview_{sym}", result, ttl=43200)

User clicks Pending row in CatalystFlow:
  EarningsModal mounts
  → fetches /api/snapshot/{sym} (live gap % for display)
  → fetches /api/earnings-analysis/{sym}
      → row.verdict.lower() == "pending"
      → _generate_earnings_preview(sym, row)
          → cache.get("earnings_preview_{sym}")
              → hit: return instantly (pre-warm succeeded)
              → miss: AV + Finnhub + Claude (~3–5s) → spinner shown
  → aiState.data populated with preview_text, preview_bullets, beat_history, news
  → trend block renders yoy_eps_growth + beat_history (no JSX change needed)
  → preview block renders previewBox with text + bullets + news

When results drop (verdict Pending → Beat/Miss/Mixed):
  Next get_earnings() rebuild (30-min TTL) updates the earnings row verdict
  Next /api/earnings-analysis/{sym} call:
    → row.verdict.lower() != "pending"
    → calls _generate_earnings_analysis(sym, row)
    → writes to earnings_analysis_{sym} key
    → earnings_preview_{sym} key naturally expires at 12h — no manual clearing needed
```

---

## Testing

### Unit tests — extend `tests/test_earnings_analysis.py`

- `test_preview_returns_expected_shape` — mock AV + Finnhub + Anthropic; assert all keys present; assert `len(preview_bullets) == 3`
- `test_preview_graceful_av_failure` — AV times out; assert `beat_history == []`, `yoy_eps_growth == "N/A"`, `beat_streak == ""`; assert `preview_text` is still a non-empty string (AI call receives no historical context but still runs)
- `test_preview_graceful_finnhub_failure` — Finnhub fails; assert `news == []`; assert `preview_text` still populated
- `test_preview_graceful_ai_failure` — Claude raises; assert `preview_text == ""`, `preview_bullets == []`; assert `beat_history` and `news` still populated from successful AV/Finnhub calls
- `test_preview_uses_separate_cache_key` — assert cache is set with key `earnings_preview_{sym}`, not `earnings_analysis_{sym}`

### Router tests — extend `tests/api/test_earnings.py`

- `test_pending_verdict_routes_to_preview` — mock row with `verdict="Pending"`; assert `_generate_earnings_preview` called, `_generate_earnings_analysis` not called
- `test_non_pending_verdict_routes_to_analysis` — mock row with `verdict="Beat"`; assert `_generate_earnings_analysis` called, `_generate_earnings_preview` not called

---

## Out of Scope

- Options implied move data (additional API dependency, deferred)
- Inline preview snippet in the CatalystFlow tile row (modal-only for now)
- Separate dedicated Earnings page/tab

---

## Files Changed

| File | Change |
|------|--------|
| `api/services/engine.py` | Add `_generate_earnings_preview()` (new function, ~80 lines); update `_prewarm_earnings_analysis()` — replace `_partial_prewarm` inner function and its submit with direct `_generate_earnings_preview` submit; update Pending cache key check from `earnings_analysis_{sym}` to `earnings_preview_{sym}` |
| `api/routers/earnings.py` | Replace `return _generate_earnings_analysis(sym, row)` with verdict branch (Pending → preview, else → analysis) |
| `app/src/components/tiles/EarningsModal.jsx` | Remove `isPending ? 'Pending — not yet reported'` from `summaryText`; add `isPending` preview block after summary block |
| `app/src/components/tiles/EarningsModal.module.css` | Add `.previewBox`, `.watchLabel`, `.watchList`, `.watchList li`, `.previewUnavailable` |
| `tests/test_earnings_analysis.py` | Add 5 new unit tests for `_generate_earnings_preview()` |
| `tests/api/test_earnings.py` | Add 2 new router branch tests |
