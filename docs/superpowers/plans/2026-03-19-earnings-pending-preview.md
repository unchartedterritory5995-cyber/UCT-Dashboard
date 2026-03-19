# Earnings Pending Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the red "Pending – not yet reported" box in EarningsModal with an AI-generated forward-looking preview (1–2 sentence paragraph + 3 "things to watch" bullets) for unreported earnings entries.

**Architecture:** Add `_generate_earnings_preview()` in `engine.py` alongside the existing `_generate_earnings_analysis()`, reusing the same AV/Finnhub fetch patterns but with a forward-looking JSON-structured prompt. The router branches on `verdict == "Pending"` to call the new function. The pre-warm fires for all Pending entries (not just `amc_tonight`). Frontend adds an amber-styled preview block that renders when `isPending`.

**Tech Stack:** Python (FastAPI, Anthropic SDK), React 19 + CSS Modules, pytest + unittest.mock

**Spec:** `docs/superpowers/specs/2026-03-19-earnings-pending-preview-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `api/services/engine.py` | Modify | Add `_generate_earnings_preview()` (~80 lines); update `_prewarm_earnings_analysis()` |
| `api/routers/earnings.py` | Modify | Import new function; add verdict routing branch |
| `app/src/components/tiles/EarningsModal.jsx` | Modify | Remove pending summary text; add preview block |
| `app/src/components/tiles/EarningsModal.module.css` | Modify | Add 5 new CSS classes |
| `tests/test_earnings_analysis.py` | Modify | Add 5 unit tests for preview function |
| `tests/api/test_earnings.py` | Modify | Add 2 router branch tests |

---

## Task 1: Write Failing Unit Tests for `_generate_earnings_preview()`

**Files:**
- Modify: `tests/test_earnings_analysis.py`

These tests are written first and will fail until Task 2 implements the function.

- [ ] **Step 1.1: Add the 5 new test cases at the bottom of `tests/test_earnings_analysis.py`**

```python
# ── _generate_earnings_preview ────────────────────────────────────────────────

def _mock_preview_response(preview="Solid setup heading into tonight.", bullets=None):
    """Mock Anthropic response returning valid JSON for preview."""
    import json
    if bullets is None:
        bullets = ["Beat 3 of last 4 quarters; YoY EPS +12%.", "Watch revenue guide vs $78M est.", "Stock up +5.6% — bar is elevated."]
    payload = json.dumps({"preview": preview, "bullets": bullets})
    msg = MagicMock()
    msg.content = [MagicMock(text=payload)]
    return msg


class TestGenerateEarningsPreview:
    PENDING_ROW = {
        "sym": "PL",
        "verdict": "Pending",
        "eps_estimate": -0.04,
        "rev_estimate": 78.0,
        "change_pct": 5.64,
    }

    def setup_method(self):
        cache.invalidate("earnings_preview_PL")

    def _run(self, av_quarters=None, fh_news=None, ai_response=None, row=None):
        if av_quarters is None:
            av_quarters = _make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
            ])
        av_data = _mock_av_response(av_quarters)
        ai_msg = ai_response if ai_response is not None else _mock_preview_response()
        fh_items = fh_news if fh_news is not None else []
        if row is None:
            row = self.PENDING_ROW

        with patch.object(engine, "_av_get", return_value=av_data), \
             patch.object(engine, "_with_retry", return_value=fh_items), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = ai_msg
            result = engine._generate_earnings_preview("PL", row)
        return result

    def test_preview_returns_expected_shape(self):
        """Success path: all keys present, exactly 3 bullets."""
        result = self._run()
        assert result["sym"] == "PL"
        assert isinstance(result["preview_text"], str)
        assert len(result["preview_text"]) > 0
        assert isinstance(result["preview_bullets"], list)
        assert len(result["preview_bullets"]) == 3
        assert isinstance(result["beat_history"], list)
        assert isinstance(result["yoy_eps_growth"], str)
        assert isinstance(result["beat_streak"], str)
        assert isinstance(result["news"], list)

    def test_preview_graceful_av_failure(self):
        """AV timeout: beat fields are empty strings/lists; AI call still runs."""
        with patch.object(engine, "_av_get", side_effect=Exception("timeout")), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_preview_response()
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["beat_history"] == []
        assert result["yoy_eps_growth"] == "N/A"
        assert result["beat_streak"] == ""
        # AI still ran — verify client was called and text was returned
        mock_ac.return_value.messages.create.assert_called_once()
        assert len(result["preview_text"]) > 0

    def test_preview_graceful_finnhub_failure(self):
        """Finnhub failure: news is empty list; preview still generated."""
        with patch.object(engine, "_av_get", return_value=_mock_av_response(_make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
             ]))), \
             patch.object(engine, "_with_retry", side_effect=Exception("finnhub down")), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.return_value = _mock_preview_response()
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["news"] == []
        assert len(result["preview_text"]) > 0

    def test_preview_graceful_ai_failure(self):
        """Claude failure: preview_text and bullets are empty; data fields still populated."""
        with patch.object(engine, "_av_get", return_value=_mock_av_response(_make_quarters([
                (0.10, 0.08), (0.08, 0.09), (0.06, 0.07), (0.05, 0.06), (0.04, 0.05)
             ]))), \
             patch.object(engine, "_with_retry", return_value=[]), \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_ac.return_value.messages.create.side_effect = Exception("api error")
            result = engine._generate_earnings_preview("PL", self.PENDING_ROW)
        assert result["preview_text"] == ""
        assert result["preview_bullets"] == []
        # Data fields still populated — AV succeeded so yoy_eps_growth is a real value, not "N/A"
        assert isinstance(result["beat_history"], list)
        assert result["yoy_eps_growth"] not in ("", "N/A")

    def test_preview_uses_separate_cache_key(self):
        """Cache must be written to earnings_preview_SYM, not earnings_analysis_SYM."""
        self._run()
        assert cache.get("earnings_preview_PL") is not None
        assert cache.get("earnings_analysis_PL") is None
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd C:/Users/Patrick/uct-dashboard
pytest tests/test_earnings_analysis.py::TestGenerateEarningsPreview -v
```

Expected: 5 failures — `AttributeError: module 'api.services.engine' has no attribute '_generate_earnings_preview'`

---

## Task 2: Implement `_generate_earnings_preview()` in engine.py

**Files:**
- Modify: `api/services/engine.py` (after line 878, before `_prewarm_earnings_analysis`)

- [ ] **Step 2.1: Add the function to `engine.py` after `_generate_earnings_analysis()`**

Insert the following block between line 878 (`return result`) and line 881 (`def _prewarm_earnings_analysis`):

```python
def _generate_earnings_preview(sym: str, row: dict) -> dict:
    """Generate forward-looking AI preview for Pending earnings entries. Cached 12h."""
    assert row is not None, "_generate_earnings_preview requires a non-None row"
    cache_key = f"earnings_preview_{sym}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    import datetime as _dt
    import requests as _req
    import json as _json

    av_key = os.environ.get("ALPHAVANTAGE_API_KEY", "")
    fh_key = os.environ.get("FINNHUB_API_KEY", "")

    # ── Step 1: Alpha Vantage quarterly history ────────────────────────────────
    yoy_eps_growth = "N/A"
    beat_streak    = ""
    beat_history   = []
    try:
        av_url = (
            f"https://www.alphavantage.co/query"
            f"?function=EARNINGS&symbol={sym}&apikey={av_key}"
        )
        av_resp  = _av_get(_req, av_url, timeout=_AV_TIMEOUT_SECS)
        quarters = av_resp.get("quarterlyEarnings", [])

        def _to_f(v):
            try: return float(v)
            except (TypeError, ValueError): return None

        if len(quarters) >= 5:
            q0 = _to_f(quarters[0].get("reportedEPS"))
            q4 = _to_f(quarters[4].get("reportedEPS"))
            if q0 is not None and q4 is not None and q4 != 0:
                pct  = (q0 - q4) / abs(q4) * 100
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
            for _q in reversed(quarters[:4]):
                _r = _to_f(_q.get("reportedEPS"))
                _e = _to_f(_q.get("estimatedEPS"))
                if _r is not None and _e is not None:
                    beat_history.append("✓" if _r >= _e else "✗")
                else:
                    beat_history.append("—")
    except Exception as _e:
        _logger.warning("AV history fetch failed for %s (preview): %s", sym, _e)

    # ── Step 2: Finnhub company news (last 3 days, up to 4 items) ─────────────
    news_items = []
    try:
        today_str = _dt.date.today().isoformat()
        from_str  = (_dt.date.today() - _dt.timedelta(days=3)).isoformat()
        fh_url = (
            f"https://finnhub.io/api/v1/company-news"
            f"?symbol={sym}&from={from_str}&to={today_str}&token={fh_key}"
        )
        fh_resp = _with_retry(lambda: _req.get(fh_url, timeout=_FH_TIMEOUT_SECS).json())
        if not isinstance(fh_resp, list):
            raise ValueError(f"Finnhub returned unexpected shape: {type(fh_resp)}")
        for item in fh_resp[:_EARNINGS_NEWS_MAX_ITEMS]:
            ts = item.get("datetime", 0)
            try:
                _d    = _dt.datetime.fromtimestamp(ts)
                dt_str = _d.strftime("%I:%M %p").lstrip("0") if ts else ""
            except Exception:
                dt_str = ""
            news_items.append({
                "headline": item.get("headline", ""),
                "source":   item.get("source", ""),
                "url":      item.get("url", ""),
                "time":     dt_str,
            })
    except Exception as _e:
        _logger.warning("Finnhub news fetch failed for %s (preview): %s", sym, _e)

    # ── Step 3: AI preview (forward-looking, JSON-structured) ─────────────────
    preview_text    = ""
    preview_bullets = []
    try:
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
        if beat_streak:
            context_parts.append(f"Beat history: {beat_streak} | YoY EPS: {yoy_eps_growth}")
        if news_items:
            context_parts.append(
                "Recent headlines: "
                + " / ".join(n["headline"] for n in news_items[:2] if n["headline"])
            )
        context_block = "\n".join(context_parts)

        prompt = (
            f"Write a pre-earnings preview for {sym} reporting tonight.\n"
            f"Return JSON only — no markdown, no explanation.\n\n"
            f"Consensus: EPS {_fmt_eps(row.get('eps_estimate'))}, "
            f"Revenue {_fmt_rev(row.get('rev_estimate'))}\n"
            f"Stock pre-report: {gap_str}\n"
        )
        if context_block:
            prompt += f"{context_block}\n"
        prompt += (
            "\nJSON format (exactly):\n"
            '{"preview": "<1-2 sentence setup — what to expect and why it matters>", '
            '"bullets": ['
            '"<historical consistency: beat streak + YoY trend>", '
            '"<revenue/guidance: specific metric or line to watch>", '
            '"<market positioning: what the current gap implies about the bar>"'
            "]}\n\n"
            "Be specific to this company. No trade advice."
        )

        client = _get_anthropic_client()
        msg = client.messages.create(
            model=_EARNINGS_AI_MODEL,
            max_tokens=350,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        # Strip markdown code fences if the model wraps in ```json
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        parsed = _json.loads(raw)
        preview_text    = str(parsed.get("preview", "")).strip()
        preview_bullets = [str(b).strip() for b in parsed.get("bullets", [])[:3]]
    except Exception as _e:
        _logger.warning("AI preview failed for %s: %s", sym, _e, exc_info=True)
        preview_text    = ""
        preview_bullets = []

    result = {
        "sym":             sym,
        "preview_text":    preview_text,
        "preview_bullets": preview_bullets,
        "beat_history":    beat_history,
        "yoy_eps_growth":  yoy_eps_growth,
        "beat_streak":     beat_streak,
        "news":            news_items,
    }
    ttl = _EARNINGS_CACHE_TTL_HIT if preview_text else _EARNINGS_CACHE_TTL_MISS
    cache.set(cache_key, result, ttl=ttl)
    return result
```

- [ ] **Step 2.2: Run the unit tests — confirm all 5 pass**

```bash
cd C:/Users/Patrick/uct-dashboard
pytest tests/test_earnings_analysis.py::TestGenerateEarningsPreview -v
```

Expected: 5 PASSED

- [ ] **Step 2.3: Run the full existing test suite — confirm no regressions**

```bash
pytest tests/test_earnings_analysis.py -v
```

Expected: all existing tests still PASSED

- [ ] **Step 2.4: Commit**

```bash
git add api/services/engine.py tests/test_earnings_analysis.py
git commit -m "feat: add _generate_earnings_preview() for pending earnings entries"
```

---

## Task 3: Router Branch + Router Tests

**Files:**
- Modify: `api/routers/earnings.py`
- Modify: `tests/api/test_earnings.py`

- [ ] **Step 3.1: Write failing router tests first**

Add to the bottom of `tests/api/test_earnings.py`:

```python
MOCK_PENDING_ROW = {
    "sym": "PL",
    "verdict": "Pending",
    "eps_estimate": -0.04,
    "rev_estimate": 78.0,
    "change_pct": 5.64,
}

MOCK_PREVIEW = {
    "sym": "PL",
    "preview_text": "Palantir reports tonight with elevated expectations.",
    "preview_bullets": ["Beat 2 of last 4.", "Watch $78M revenue target.", "Gap +5.6% raises the bar."],
    "beat_history": ["✗", "✓", "✗", "✓"],
    "yoy_eps_growth": "-12.3%",
    "beat_streak": "Beat 2 of last 4",
    "news": [],
}

MOCK_EARNINGS_WITH_PENDING = {
    "bmo": [],
    "amc": [],
    "amc_tonight": [MOCK_PENDING_ROW],
}


@pytest.mark.asyncio
async def test_pending_verdict_routes_to_preview():
    """Pending verdict → _generate_earnings_preview called, not _generate_earnings_analysis."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS_WITH_PENDING), \
         patch("api.routers.earnings._generate_earnings_preview", return_value=MOCK_PREVIEW) as mock_prev, \
         patch("api.routers.earnings._generate_earnings_analysis") as mock_anal:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/PL")
    assert r.status_code == 200
    mock_prev.assert_called_once()
    mock_anal.assert_not_called()
    call_args = mock_prev.call_args
    assert call_args[0][0] == "PL"
    assert call_args[0][1]["verdict"] == "Pending"


@pytest.mark.asyncio
async def test_non_pending_verdict_routes_to_analysis():
    """Non-pending verdict → _generate_earnings_analysis called, not _generate_earnings_preview."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._generate_earnings_analysis", return_value=MOCK_ANALYSIS) as mock_anal, \
         patch("api.routers.earnings._generate_earnings_preview") as mock_prev:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    mock_anal.assert_called_once()
    mock_prev.assert_not_called()
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
pytest tests/api/test_earnings.py::test_pending_verdict_routes_to_preview tests/api/test_earnings.py::test_non_pending_verdict_routes_to_analysis -v
```

Expected: `ERROR collecting tests/api/test_earnings.py` — `ImportError: cannot import name '_generate_earnings_preview'` (collection-time error, not a test failure — this is expected)

- [ ] **Step 3.3: Update `api/routers/earnings.py`**

Change line 3 (the import) from:
```python
from api.services.engine import get_earnings, _generate_earnings_analysis
```
To:
```python
from api.services.engine import get_earnings, _generate_earnings_analysis, _generate_earnings_preview
```

Change the final line of `earnings_analysis()` (currently `return _generate_earnings_analysis(sym, row)`) to:
```python
    if row and row.get("verdict", "").lower() == "pending":
        return _generate_earnings_preview(sym, row)
    return _generate_earnings_analysis(sym, row)
```

- [ ] **Step 3.4: Run router tests — confirm all 4 pass**

```bash
pytest tests/api/test_earnings.py -v
```

Expected: 4 PASSED (2 existing + 2 new)

- [ ] **Step 3.5: Commit**

```bash
git add api/routers/earnings.py tests/api/test_earnings.py
git commit -m "feat: route pending earnings verdict to preview function"
```

---

## Task 4: Update `_prewarm_earnings_analysis()`

**Files:**
- Modify: `api/services/engine.py` (lines 881–911)

No new tests needed — the pre-warm fires background threads; its correctness is validated by the integration of the two functions already tested. The change is mechanical.

- [ ] **Step 4.1: Replace `_prewarm_earnings_analysis()` body**

Find the function at line 881. Replace its entire body with:

```python
def _prewarm_earnings_analysis(data: dict) -> None:
    """Pre-cache AI analysis for reported tickers; AI preview for Pending entries."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return
    _logger.info("prewarm: starting for buckets bmo/amc/amc_tonight")

    for bucket in ("bmo", "amc", "amc_tonight"):
        for entry in data.get(bucket, []):
            sym = entry.get("sym", "")
            if not sym:
                continue
            is_pending = entry.get("verdict", "").lower() in ("pending", "")  # "" = no verdict yet (edge case)

            if is_pending:
                # Full AI preview (AV history + news + Claude)
                if not cache.get(f"earnings_preview_{sym}"):
                    _prewarm_executor.submit(_generate_earnings_preview, sym, dict(entry))
            else:
                # Full post-earnings analysis (AV history + news + Claude)
                if not cache.get(f"earnings_analysis_{sym}"):
                    _prewarm_executor.submit(_generate_earnings_analysis, sym, dict(entry))
```

Key changes from original:
- Removed `_partial_prewarm` inner function (no longer needed)
- Removed `bucket == "amc_tonight"` restriction — Pending can appear in bmo too
- Split cache key check per path: `earnings_preview_{sym}` for Pending, `earnings_analysis_{sym}` for reported
- Moved the `continue` check inside each branch (after determining which key to check)

- [ ] **Step 4.2: Run full test suite to confirm no regressions**

```bash
pytest tests/ -v
```

Expected: all tests PASSED

- [ ] **Step 4.3: Commit**

```bash
git add api/services/engine.py
git commit -m "feat: prewarm earnings preview for all pending entries across buckets"
```

---

## Task 5: Add CSS Classes to EarningsModal.module.css

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.module.css`

- [ ] **Step 5.1: Append new classes to the bottom of `EarningsModal.module.css`**

```css
/* ── Earnings Preview (Pending entries) ────────────────────────────────────── */

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

- [ ] **Step 5.2: Verify the dev server compiles without error**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run dev
```

Expected: Vite compiles cleanly — no CSS errors.

- [ ] **Step 5.3: Commit**

```bash
git add app/src/components/tiles/EarningsModal.module.css
git commit -m "style: add earnings preview CSS classes (previewBox, watchList, watchLabel)"
```

---

## Task 6: Update EarningsModal.jsx

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`

- [ ] **Step 6.1: Remove the Pending text from `summaryText` (line 65)**

Find:
```jsx
  const summaryText = row.reported_eps != null && row.eps_estimate != null
    ? `${verdictLabel} — EPS ${fmtEps(row.reported_eps)} vs ${fmtEps(row.eps_estimate)} est (${row.surprise_pct} surprise)`
    : isPending ? 'Pending — not yet reported' : null
```

Replace with:
```jsx
  const summaryText = row.reported_eps != null && row.eps_estimate != null
    ? `${verdictLabel} — EPS ${fmtEps(row.reported_eps)} vs ${fmtEps(row.eps_estimate)} est (${row.surprise_pct} surprise)`
    : null
```

- [ ] **Step 6.2: Add the preview block after the existing `{summaryText && ...}` block**

Find (line 112–116):
```jsx
        {summaryText && (
          <div className={`${styles.summary} ${isBeat ? styles.summaryBeat : isMixed ? styles.summaryMixed : styles.summaryMiss}`}>
            {summaryText}
          </div>
        )}
```

Add the following block immediately after it:

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

- [ ] **Step 6.3: Verify the dev server compiles and renders correctly**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run dev
```

Open the dashboard. Click any Pending earnings entry (AMC Tonight section). Verify:
- Red "Pending – not yet reported" box is gone
- Amber-bordered preview box appears (or spinner while loading)
- Post-earnings entries (Beat/Miss/Mixed) are unchanged

- [ ] **Step 6.4: Run backend tests one final time**

```bash
cd C:/Users/Patrick/uct-dashboard && pytest tests/ -v
```

Expected: all tests PASSED

- [ ] **Step 6.5: Final commit**

```bash
git add app/src/components/tiles/EarningsModal.jsx
git commit -m "feat: show AI earnings preview for pending entries in EarningsModal"
```

---

## Verification Checklist

Before calling this done:

- [ ] `pytest tests/ -v` — all tests pass
- [ ] Backend starts: `uvicorn api.main:app --reload --port 8000`
- [ ] Click a **Pending** entry → amber preview box loads (spinner → content)
- [ ] Click a **Beat/Miss/Mixed** entry → post-earnings analysis unchanged
- [ ] Beat history + YoY row renders for Pending entries (trend block)
- [ ] "Preview unavailable" shown gracefully if AI call returns no text
