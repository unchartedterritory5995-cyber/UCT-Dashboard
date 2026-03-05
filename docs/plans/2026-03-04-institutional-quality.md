# Institutional Quality Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lift the EarningsModal feature stack to institutional engineering quality across observability, testing, reliability, UX, and security.

**Architecture:** 13 independent tasks ordered by blast radius — foundational backend constants + logging first, then reliability patterns, then frontend UX improvements, then security hardening. No task breaks a passing baseline.

**Tech Stack:** Python 3.12, FastAPI, pytest + unittest.mock, React 18, CSS Modules, slowapi, sentry-sdk

**Run tests with:** `cd C:\Users\Patrick\uct-dashboard && pytest tests/ -v`

---

## Task 1: Named constants block in engine.py

**Files:**
- Modify: `api/services/engine.py` — add constants after the `_av_last_call` module-level block (around line 68)

**Step 1: Add constants block**

Find the line `_av_last_call: list[float] = [0.0]` in `api/services/engine.py`. After the full `_av_get` function definition, insert this constants block:

```python
# ── Earnings analysis configuration ───────────────────────────────────────────
_EARNINGS_NEWS_MAX_ITEMS    = 4        # max Finnhub headlines per ticker
_EARNINGS_AI_MAX_TOKENS     = 400      # Haiku response token limit
_EARNINGS_CACHE_TTL_HIT     = 43_200   # 12 h — full result cached after success
_EARNINGS_CACHE_TTL_MISS    = 300      # 5 min — retry window on failure
_AV_TIMEOUT_SECS            = 8        # Alpha Vantage request timeout
_FH_TIMEOUT_SECS            = 6        # Finnhub request timeout
_AV_RATE_INTERVAL_SECS      = 13.0     # ≥13s between AV calls → ≤4.6/min (free tier: 5/min)
_EARNINGS_AI_MODEL          = "claude-haiku-4-5-20251001"
```

**Step 2: Wire constants into `_av_get` and `_generate_earnings_analysis`**

In `_av_get`, replace the hardcoded `13.0`:
```python
# Old:
        wait = 13.0 - (_time.monotonic() - _av_last_call[0])
        if wait > 0:
            _time.sleep(wait)
        _av_last_call[0] = _time.monotonic()
# New:
        wait = _AV_RATE_INTERVAL_SECS - (_time.monotonic() - _av_last_call[0])
        if wait > 0:
            _time.sleep(wait)
        _av_last_call[0] = _time.monotonic()
```

In `_generate_earnings_analysis`, replace all magic numbers:
- `_av_get(_req, av_url)` → `_av_get(_req, av_url, timeout=_AV_TIMEOUT_SECS)`
- `_req.get(fh_url, timeout=6)` → `_req.get(fh_url, timeout=_FH_TIMEOUT_SECS)`
- `fh_resp[:4]` → `fh_resp[:_EARNINGS_NEWS_MAX_ITEMS]`
- `max_tokens=400` → `max_tokens=_EARNINGS_AI_MAX_TOKENS`
- `model="claude-haiku-4-5-20251001"` → `model=_EARNINGS_AI_MODEL`
- `ttl = 43200 if analysis is not None else 300` → `ttl = _EARNINGS_CACHE_TTL_HIT if analysis is not None else _EARNINGS_CACHE_TTL_MISS`

**Step 3: Verify**

Run: `python -c "import api.services.engine; print('OK')"` from `C:\Users\Patrick\uct-dashboard`
Expected: `OK`

---

## Task 2: Structured logging — replace all silent `except` blocks

**Files:**
- Modify: `api/services/engine.py` — add module-level logger, update 3 except blocks in `_generate_earnings_analysis`

**Step 1: Add logger after imports**

After `from api.services.cache import cache`, add:
```python
import logging as _logging
_logger = _logging.getLogger(__name__)
```

**Step 2: Replace AV except block**

Find (around line 681):
```python
    except Exception:
        pass
```
This is the one closing the AV `try` block (Step 1 of the function). Replace with:
```python
    except Exception as _e:
        _logger.warning("AV history fetch failed for %s: %s", sym, _e)
```

**Step 3: Replace Finnhub except block**

Find the next bare `except Exception: pass` (Step 2 of the function, after Finnhub news). Replace with:
```python
    except Exception as _e:
        _logger.warning("Finnhub news fetch failed for %s: %s", sym, _e)
```

**Step 4: Replace AI except block**

Find `except Exception: analysis = None` (Step 3). Replace with:
```python
    except Exception as _e:
        _logger.warning("AI analysis failed for %s: %s", sym, _e)
        analysis = None
```

**Step 5: Add prewarm log**

In `_prewarm_earnings_analysis`, after the `if not os.environ.get("ANTHROPIC_API_KEY"): return` guard, add:
```python
    _logger.info("prewarm: starting for buckets bmo/amc/amc_tonight")
```

**Step 6: Verify**

Run: `python -c "import api.services.engine; print('OK')"`
Expected: `OK`

---

## Task 3: Anthropic client singleton + proper key validation

**Files:**
- Modify: `api/services/engine.py`

**Step 1: Add module-level singleton after the `_logger` line**

```python
_anthropic_client: "object | None" = None  # anthropic.Anthropic, lazy-init

def _get_anthropic_client():
    """Return the module-level Anthropic client, initializing it once."""
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic as _anthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _anthropic_client = _anthropic.Anthropic(api_key=api_key)
    return _anthropic_client
```

**Step 2: Replace the per-call client construction in `_generate_earnings_analysis`**

Find in the AI block (around line 716–717):
```python
            import anthropic

            def _fmt_eps(v):
```

Remove the `import anthropic` line — it's no longer needed here.

Find (around line 764):
```python
            client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            msg = client.messages.create(
```
Replace with:
```python
            client = _get_anthropic_client()
            msg = client.messages.create(
```

**Step 3: Verify**

Run: `python -c "import api.services.engine; print('OK')"`
Expected: `OK`

---

## Task 4: ThreadPoolExecutor replaces raw thread spawning

**Files:**
- Modify: `api/services/engine.py`

**Step 1: Add module-level executor after the `_anthropic_client` singleton**

```python
from concurrent.futures import ThreadPoolExecutor as _ThreadPoolExecutor

# Bounded pool for pre-warm work. Max 4 workers: respects AV rate limiter
# (4 concurrent threads → at most 4 AV calls queued, serialized by _av_lock).
_prewarm_executor = _ThreadPoolExecutor(max_workers=4, thread_name_prefix="prewarm")
```

**Step 2: Replace raw threading in `_prewarm_earnings_analysis`**

Remove `import threading` from the function body.

Replace the two `threading.Thread(...).start()` blocks:

Old (partial pre-warm block):
```python
                t = threading.Thread(
                    target=_partial_prewarm,
                    args=(sym,),
                    daemon=True,
                )
                t.start()
```
New:
```python
                _prewarm_executor.submit(_partial_prewarm, sym)
```

Old (full pre-warm block):
```python
                t = threading.Thread(
                    target=_generate_earnings_analysis,
                    args=(sym, dict(entry)),
                    daemon=True,
                )
                t.start()
```
New:
```python
                _prewarm_executor.submit(_generate_earnings_analysis, sym, dict(entry))
```

**Step 3: Verify**

Run: `python -c "import api.services.engine; print('OK')"`
Expected: `OK`

---

## Task 5: Fix `amc_tonight` missing from earnings-analysis router

**Files:**
- Modify: `api/routers/earnings.py:51`

**Step 1: Update the row-lookup loop**

Find (line 51):
```python
    for bucket in ("bmo", "amc"):
```
Replace with:
```python
    for bucket in ("bmo", "amc", "amc_tonight"):
```

**Step 2: Write the test**

Create `tests/api/test_earnings.py`:

```python
import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

MOCK_EARNINGS = {
    "bmo": [],
    "amc": [],
    "amc_tonight": [
        {
            "sym": "AVGO",
            "verdict": "beat",
            "reported_eps": 1.60,
            "eps_estimate": 1.50,
            "surprise_pct": "+6.7%",
            "rev_actual": 14000,
            "rev_estimate": 13500,
            "rev_surprise_pct": "+3.7%",
            "change_pct": 5.2,
            "ew_total": 195,
        }
    ],
}

MOCK_ANALYSIS = {
    "sym": "AVGO",
    "analysis": "Broadcom beat on all metrics.",
    "yoy_eps_growth": "+22.1%",
    "beat_streak": "Beat 4 of last 4",
    "news": [],
}


@pytest.mark.asyncio
async def test_earnings_analysis_finds_amc_tonight_row():
    """Router must search amc_tonight bucket so AVGO gets its row context."""
    with patch("api.routers.earnings.get_earnings", return_value=MOCK_EARNINGS), \
         patch("api.routers.earnings._generate_earnings_analysis", return_value=MOCK_ANALYSIS) as mock_gen:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/AVGO")
    assert r.status_code == 200
    # The row from amc_tonight should have been passed to the analysis function
    call_args = mock_gen.call_args
    assert call_args[0][0] == "AVGO"           # sym
    assert call_args[0][1] is not None          # row was found (not None)
    assert call_args[0][1]["verdict"] == "beat" # correct row


@pytest.mark.asyncio
async def test_earnings_analysis_sym_not_found_passes_none_row():
    """When sym isn't in any bucket, row=None is passed (Pending/cold state)."""
    with patch("api.routers.earnings.get_earnings", return_value={"bmo": [], "amc": [], "amc_tonight": []}), \
         patch("api.routers.earnings._generate_earnings_analysis", return_value=MOCK_ANALYSIS) as mock_gen:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings-analysis/UNKNOWN")
    assert r.status_code == 200
    call_args = mock_gen.call_args
    assert call_args[0][1] is None  # row=None when sym not found
```

**Step 3: Run the test (should fail before the fix)**

Run: `pytest tests/api/test_earnings.py::test_earnings_analysis_finds_amc_tonight_row -v`
Expected: FAIL (because `amc_tonight` is not yet searched)

**Step 4: Apply the fix** (already done in Step 1)

**Step 5: Run tests again**

Run: `pytest tests/api/test_earnings.py -v`
Expected: 2 PASS

---

## Task 6: Unit tests for `_generate_earnings_analysis` internals

**Files:**
- Create: `tests/test_earnings_analysis.py`

**Step 1: Write the test file**

```python
"""
Unit tests for _generate_earnings_analysis internals.

All external I/O (requests, anthropic) is mocked. Tests verify:
- YoY EPS growth math and formatting
- Beat streak counting
- Graceful degradation when APIs fail
- Cache TTL logic
- AV rate limit response handling
"""
import pytest
from unittest.mock import patch, MagicMock, call
from api.services import engine
from api.services.cache import cache


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_quarters(eps_pairs):
    """Build AV-style quarterlyEarnings list from [(reported, estimated), ...]."""
    return [
        {"reportedEPS": str(r), "estimatedEPS": str(e)}
        for r, e in eps_pairs
    ]


def _mock_av_response(quarters):
    return {"quarterlyEarnings": quarters}


def _mock_fh_response(items=None):
    return items if items is not None else []


def _mock_anthropic_analysis(text="Test analysis text."):
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    return msg


# ── YoY EPS growth ────────────────────────────────────────────────────────────

class TestYoYEpsGrowth:
    def setup_method(self):
        cache.invalidate("earnings_analysis_TEST")

    def _run(self, quarters, row=None):
        av_data = _mock_av_response(quarters)
        with patch.object(engine, "_av_get", return_value=av_data), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_req.return_value.json.return_value = []
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            import requests
            result = engine._generate_earnings_analysis("TEST", row)
        return result

    def test_positive_growth(self):
        # q0=$1.60, q4=$1.30 → +23.1%
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] == "+23.1%"

    def test_negative_growth(self):
        # q0=$1.00, q4=$1.50 → -33.3%
        quarters = _make_quarters([(1.00, 1.10), (1.10, 1.20), (1.20, 1.30), (1.30, 1.40), (1.50, 1.40)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] == "-33.3%"

    def test_q4_zero_returns_none(self):
        # Division by zero guard
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (0.00, 0.10)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] is None

    def test_fewer_than_5_quarters_returns_none(self):
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25)])
        result = self._run(quarters)
        assert result["yoy_eps_growth"] is None

    def test_non_numeric_eps_returns_none(self):
        quarters = [{"reportedEPS": "N/A", "estimatedEPS": "1.50"}] * 5
        result = self._run(quarters)
        assert result["yoy_eps_growth"] is None


# ── Beat streak ───────────────────────────────────────────────────────────────

class TestBeatStreak:
    def setup_method(self):
        cache.invalidate("earnings_analysis_TEST")

    def _run(self, quarters):
        av_data = _mock_av_response(quarters)
        with patch.object(engine, "_av_get", return_value=av_data), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_req.return_value.json.return_value = []
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        return result

    def test_beat_all_4(self):
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 4 of last 4"

    def test_beat_none(self):
        quarters = _make_quarters([(1.00, 1.50), (1.10, 1.40), (1.20, 1.30), (1.25, 1.35), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 0 of last 4"

    def test_beat_with_exactly_4_quarters(self):
        """Bug guard: beat streak must work when AV returns exactly 4 quarters (no 5th for YoY)."""
        quarters = _make_quarters([(1.60, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 4 of last 4"
        # YoY should be None — only 4 quarters available
        assert result["yoy_eps_growth"] is None

    def test_beat_streak_exact_match_counts_as_beat(self):
        """reportedEPS == estimatedEPS counts as beat (>=)."""
        quarters = _make_quarters([(1.50, 1.50), (1.50, 1.40), (1.40, 1.30), (1.35, 1.25), (1.30, 1.20)])
        result = self._run(quarters)
        assert result["beat_streak"] == "Beat 4 of last 4"


# ── Graceful degradation ──────────────────────────────────────────────────────

class TestGracefulDegradation:
    def setup_method(self):
        cache.invalidate("earnings_analysis_TEST")

    def test_av_failure_returns_none_fields(self):
        with patch.object(engine, "_av_get", side_effect=RuntimeError("AV down")), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_req.return_value.json.return_value = []
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        assert result["yoy_eps_growth"] is None
        assert result["beat_streak"] is None
        assert result["sym"] == "TEST"  # always present

    def test_finnhub_dict_response_returns_empty_news(self):
        """Finnhub returning error dict (not list) should yield empty news."""
        with patch.object(engine, "_av_get", return_value={"quarterlyEarnings": []}), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_req.return_value.json.return_value = {"error": "Invalid token"}
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        assert result["news"] == []

    def test_ai_failure_returns_none_analysis_with_short_ttl(self):
        """When AI fails, analysis=None and TTL is short (5 min retry)."""
        row = {"verdict": "beat", "reported_eps": 1.60, "eps_estimate": 1.50,
               "surprise_pct": "+6.7%", "rev_actual": 14000, "rev_estimate": 13500,
               "rev_surprise_pct": "+3.7%", "change_pct": 5.2}
        with patch.object(engine, "_av_get", return_value={"quarterlyEarnings": []}), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client", side_effect=RuntimeError("API key missing")):
            mock_req.return_value.json.return_value = []
            result = engine._generate_earnings_analysis("TEST", row)
        assert result["analysis"] is None
        # Verify short TTL was used (cache should expire quickly — check via direct cache inspection)
        cached = cache.get("earnings_analysis_TEST")
        assert cached is not None  # cached immediately
        assert cached["analysis"] is None

    def test_pending_row_skips_ai(self):
        """row=None (pending) should return analysis=None without calling Anthropic."""
        with patch.object(engine, "_av_get", return_value={"quarterlyEarnings": []}), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_req.return_value.json.return_value = []
            result = engine._generate_earnings_analysis("TEST", None)
        mock_ac.assert_not_called()
        assert result["analysis"] is None

    def test_av_rate_limit_response_logged_not_silenced(self):
        """AV rate-limit Note response should raise (caught by outer try) not silently return empty."""
        rate_limit_resp = {"Note": "Thank you for using Alpha Vantage! Standard API call frequency is 5 calls per minute."}
        with patch.object(engine, "_av_get", side_effect=RuntimeError("AV rate limit hit")), \
             patch("requests.get") as mock_req, \
             patch.object(engine, "_get_anthropic_client") as mock_ac:
            mock_req.return_value.json.return_value = []
            mock_ac.return_value.messages.create.return_value = _mock_anthropic_analysis()
            result = engine._generate_earnings_analysis("TEST", None)
        # Should degrade gracefully — no crash, but also no AV data
        assert result["yoy_eps_growth"] is None
        assert result["beat_streak"] is None


# ── Cache behaviour ───────────────────────────────────────────────────────────

class TestCacheBehaviour:
    def setup_method(self):
        cache.invalidate("earnings_analysis_CACHED")

    def test_returns_cached_result_without_api_calls(self):
        """Cache hit must return immediately without any I/O."""
        cached_data = {"sym": "CACHED", "analysis": "cached", "yoy_eps_growth": None,
                       "beat_streak": None, "news": []}
        cache.set("earnings_analysis_CACHED", cached_data, ttl=300)
        with patch.object(engine, "_av_get") as mock_av, \
             patch("requests.get") as mock_req:
            result = engine._generate_earnings_analysis("CACHED", None)
        mock_av.assert_not_called()
        mock_req.assert_not_called()
        assert result["analysis"] == "cached"
```

**Step 2: Run the tests**

Run: `pytest tests/test_earnings_analysis.py -v`
Expected: All PASS (the bug fixes from the previous session make these pass)

---

## Task 7: Retry logic for transient errors

**Files:**
- Modify: `api/services/engine.py`

**Step 1: Add `_with_retry` helper after the `_av_get` function**

```python
def _with_retry(fn, retries: int = 1, delay: float = 2.0):
    """Call fn(); on requests.Timeout or ConnectionError, retry up to `retries` times."""
    import requests as _r
    for attempt in range(retries + 1):
        try:
            return fn()
        except (_r.Timeout, _r.ConnectionError) as e:
            if attempt < retries:
                _logger.warning("Transient error (attempt %d/%d): %s", attempt + 1, retries + 1, e)
                _time.sleep(delay)
            else:
                raise
```

**Step 2: Wrap the Finnhub call with retry**

In `_generate_earnings_analysis`, find the Finnhub fetch:
```python
        fh_resp = _req.get(fh_url, timeout=_FH_TIMEOUT_SECS).json()
```
Replace with:
```python
        fh_resp = _with_retry(lambda: _req.get(fh_url, timeout=_FH_TIMEOUT_SECS).json())
```

**Step 3: Verify**

Run: `python -c "import api.services.engine; print('OK')"`
Expected: `OK`

---

## Task 8: Beat history visual pattern `✓ ✗ ✓ ✓`

**Files:**
- Modify: `api/services/engine.py` — add `beat_history` field
- Modify: `app/src/components/tiles/EarningsModal.jsx` — render symbols
- Modify: `app/src/components/tiles/EarningsModal.module.css` — add `.beatHistory`

**Step 1: Compute `beat_history` in `_generate_earnings_analysis`**

In the beat streak block (after line `beat_streak = f"Beat {beats} of last 4"`), add:

```python
            # Visual beat history: oldest→newest, e.g. ["✗", "✓", "✓", "✓"]
            beat_history = []
            for _q in reversed(quarters[:4]):
                _r = _to_f(_q.get("reportedEPS"))
                _e = _to_f(_q.get("estimatedEPS"))
                if _r is not None and _e is not None:
                    beat_history.append("✓" if _r >= _e else "✗")
                else:
                    beat_history.append("—")
```

**Step 2: Add `beat_history` to result dict**

Find the result dict:
```python
    result = {
        "sym":            sym,
        "analysis":       analysis,
        "yoy_eps_growth": yoy_eps_growth,
        "beat_streak":    beat_streak,
        "news":           news_items,
    }
```
Replace with:
```python
    result = {
        "sym":            sym,
        "analysis":       analysis,
        "yoy_eps_growth": yoy_eps_growth,
        "beat_streak":    beat_streak,
        "beat_history":   beat_history,   # ["✗","✓","✓","✓"] oldest→newest
        "news":           news_items,
    }
```

Note: `beat_history` is defined in the AV `try` block. Initialize it before the try so it's always present:
```python
    yoy_eps_growth = None
    beat_streak    = None
    beat_history   = []       # ← add this line
```

**Step 3: Update `EarningsModal.jsx` — replace text label with visual symbols**

Find the beat_streak span (around line 115):
```jsx
            {aiState.data.beat_streak && (
              <span className={styles.muted}>{aiState.data.beat_streak}</span>
            )}
```
Replace with:
```jsx
            {aiState.data.beat_history?.length > 0 && (
              <span className={styles.beatHistory}>
                {aiState.data.beat_history.map((s, i) => (
                  <span key={i} className={s === '✓' ? styles.pos : s === '✗' ? styles.neg : styles.muted}>
                    {s}
                  </span>
                ))}
                <span className={styles.muted}>{aiState.data.beat_streak}</span>
              </span>
            )}
```

**Step 4: Add `.beatHistory` to CSS**

In `EarningsModal.module.css`, after `.trend`:
```css
.beatHistory {
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 12px;
}
```

**Step 5: Add beat_history to the test (Task 6)**

In `tests/test_earnings_analysis.py`, in `TestBeatStreak.test_beat_all_4`, add:
```python
        assert result["beat_history"] == ["✓", "✓", "✓", "✓"]
```

In `test_beat_none`, add:
```python
        assert result["beat_history"] == ["✗", "✗", "✗", "✗"]
```

**Step 6: Run tests**

Run: `pytest tests/test_earnings_analysis.py -v`
Expected: All PASS

---

## Task 9: React fetch timeout with AbortController

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`

**Step 1: Update the AI analysis `useEffect`**

Find (lines 32–39):
```jsx
  // AI analysis + related news
  useEffect(() => {
    if (!row) return
    setAiState({ loading: true, data: null })
    fetch(`/api/earnings-analysis/${row.sym}`)
      .then(r => r.json())
      .then(d => setAiState({ loading: false, data: d }))
      .catch(() => setAiState({ loading: false, data: null }))
  }, [row?.sym])
```

Replace with:
```jsx
  // AI analysis + related news
  useEffect(() => {
    if (!row) return
    setAiState({ loading: true, data: null })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    fetch(`/api/earnings-analysis/${row.sym}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => setAiState({ loading: false, data: d }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setAiState({ loading: false, data: null })
        }
      })
      .finally(() => clearTimeout(timer))
    return () => { controller.abort(); clearTimeout(timer) }
  }, [row?.sym])
```

The `return () => controller.abort()` cleanup ensures that if the modal is closed while the fetch is in-flight, it gets cancelled rather than updating state on an unmounted component.

---

## Task 10: React ErrorBoundary component

**Files:**
- Create: `app/src/components/ErrorBoundary.jsx`
- Modify: `app/src/components/tiles/CatalystFlow.jsx`

**Step 1: Create `ErrorBoundary.jsx`**

```jsx
// app/src/components/ErrorBoundary.jsx
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }}>
          Component error — reload to retry
        </div>
      )
    }
    return this.props.children
  }
}
```

**Step 2: Wrap `EarningsModal` in `CatalystFlow.jsx`**

Add import at top:
```jsx
import ErrorBoundary from '../ErrorBoundary'
```

Find (around lines 112–118):
```jsx
      {selected && (
        <EarningsModal
          row={selected.row}
          label={selected.label}
          onClose={() => setSelected(null)}
        />
      )}
```
Replace with:
```jsx
      {selected && (
        <ErrorBoundary fallback={<div style={{ display: 'none' }} />} key={selected.row.sym}>
          <EarningsModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
```

The `key={selected.row.sym}` resets the boundary when a different ticker is selected, so one bad ticker doesn't permanently break the modal for all tickers.

---

## Task 11: Accessibility fixes

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`
- Modify: `app/src/components/tiles/EarningsModal.module.css`

**Step 1: Add `aria-labelledby` to dialog and `id` to heading**

Find:
```jsx
        <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
```
Replace with:
```jsx
        <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="earnings-modal-title">
```

Find:
```jsx
          <span className={styles.sym}>{row.sym}</span>
```
Replace with:
```jsx
          <span className={styles.sym} id="earnings-modal-title">{row.sym}</span>
```

**Step 2: Add `aria-label` to news links**

Find (inside the news `.map()`):
```jsx
                    <a
                      key={i}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.newsItem}
                    >
```
Replace with:
```jsx
                    <a
                      key={i}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.newsItem}
                      aria-label={`${item.source}: ${item.headline}`}
                    >
```

**Step 3: Add focus-visible style to close button in CSS**

Find in `EarningsModal.module.css`:
```css
.close:hover { color: var(--text); }
```
Replace with:
```css
.close:hover { color: var(--text); }
.close:focus-visible { outline: 2px solid var(--gain); outline-offset: 2px; border-radius: 3px; }
```

---

## Task 12: API rate limiting with slowapi

**Files:**
- Modify: `requirements.txt`
- Modify: `api/main.py`
- Modify: `api/routers/earnings.py`

**Step 1: Add slowapi to requirements**

Add to `requirements.txt`:
```
slowapi==0.1.9
```

**Step 2: Install it**

Run: `pip install slowapi==0.1.9`

**Step 3: Wire slowapi into `api/main.py`**

Add after existing imports:
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
```

After `app = FastAPI(...)`, add:
```python
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

**Step 4: Add rate limit to earnings-analysis endpoint in `api/routers/earnings.py`**

Add import at top:
```python
from fastapi import Request
from api.main import limiter
```

Find:
```python
@router.get("/api/earnings-analysis/{sym}")
def earnings_analysis(sym: str):
```
Replace with:
```python
@router.get("/api/earnings-analysis/{sym}")
@limiter.limit("10/minute")
def earnings_analysis(request: Request, sym: str):
```

**Step 5: Verify import**

Run: `python -c "import api.main; print('OK')"`
Expected: `OK`

---

## Task 13: Sentry SDK integration

**Files:**
- Modify: `requirements.txt`
- Modify: `api/main.py`

**Step 1: Add sentry-sdk to requirements**

Add to `requirements.txt`:
```
sentry-sdk[fastapi]==2.23.1
```

**Step 2: Install it**

Run: `pip install "sentry-sdk[fastapi]==2.23.1"`

**Step 3: Initialize Sentry in `api/main.py`**

Add after existing imports:
```python
import sentry_sdk

_SENTRY_DSN = os.environ.get("SENTRY_DSN")
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        traces_sample_rate=0.1,   # 10% of requests traced
        environment=os.environ.get("RAILWAY_ENVIRONMENT", "development"),
    )
```

This is a no-op when `SENTRY_DSN` is not set (local dev, no Railway env var). To enable in production: add `SENTRY_DSN` to Railway environment variables with your project DSN from sentry.io.

**Step 4: Verify import (without DSN — should be silent no-op)**

Run: `python -c "import api.main; print('OK')"`
Expected: `OK`

---

## Final verification

Run the full test suite:

```bash
cd C:\Users\Patrick\uct-dashboard
pytest tests/ -v
```

Expected: All existing tests pass + new tests in `tests/test_earnings_analysis.py` and `tests/api/test_earnings.py` pass.

Check module imports clean:
```bash
python -c "import api.main; import api.services.engine; print('all imports OK')"
```
