# Market Cap Filter — $300M Minimum Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a $300M market cap minimum on all ticker-displaying surfaces: news, theme tracker holdings, and earnings — in both the morning wire engine and the live dashboard API.

**Architecture:** Three targeted changes across two files. The engine fix (Task 1) makes `_get_fv_cap_universe()` persist its universe to disk so a Finviz outage at 7:35 AM never disables the filter. The dashboard fix (Tasks 2–3) adds a market cap check to the live news fetch that currently only filters by dollar volume, and closes the RSS fallback gap by reusing the same `allowed` set built during AV filtering.

**Tech Stack:** Python, yfinance `fast_info`, json disk cache, pytest + unittest.mock

---

## File Map

| File | Change |
|------|--------|
| `C:\Users\Patrick\morning-wire\morning_wire_engine.py` | Fix `_get_fv_cap_universe()` — add disk persistence and load fallback |
| `C:\Users\Patrick\uct-dashboard\api\services\engine.py` | Fix `_check_sym()` — add `market_cap >= 300M`; fix RSS fallback ticker filter |
| `C:\Users\Patrick\uct-dashboard\tests\test_cap_filter.py` | New test file for both fixes |

**Not changing:**
- `_normalize_earnings()` — reads from wire_data already filtered at source (once Task 1 is solid)
- `_normalize_themes()` — same reason
- `get_movers()` / `_fetch_finviz_movers_live()` — already correct (`sh_mktcap_smallover` at URL level)
- `/api/snapshot/{ticker}` — intentional utility endpoint, not a display surface
- `scanner_candidates.py` — already correct (`Market Cap.: Small+ (over $300mln)` on all 3 scans)

---

## Chunk 1: Engine — Persistent Cap Universe

### Task 1: Make `_get_fv_cap_universe()` persist to disk and recover from failure

**File:** `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — lines 1360–1382

**Context:** `_get_fv_cap_universe()` is called three times per engine run (themes ~line 1264, news ~line 4809, earnings ~line 4897). It caches in-process via `_FV_CAP_UNIVERSE` global, but on Finviz failure it returns an empty set and sets the global to `set()`. The `if _cap_uni:` guards in all three callers then silently skip filtering — fail-open.

**Current code (lines 1360–1382):**
```python
_FV_CAP_UNIVERSE: set | None = None

def _get_fv_cap_universe() -> set:
    """Return set of US tickers with market cap >= $300M (FinViz small+ universe).

    Fetches FinViz once per run and caches. Returns empty set on failure
    so callers fail open (no filtering) rather than dropping everything.
    """
    global _FV_CAP_UNIVERSE
    if _FV_CAP_UNIVERSE is not None:
        return _FV_CAP_UNIVERSE
    try:
        url = f"https://elite.finviz.com/export.ashx?v=152&f=cap_smallover&auth={FINVIZ_TOKEN}"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25, allow_redirects=True)
        r.raise_for_status()
        rows = _parse_fv_csv_robust(r.text)
        _FV_CAP_UNIVERSE = {(row.get("Ticker") or "").strip().upper() for row in rows if row.get("Ticker")}
        print(f"  CAP FILTER: {len(_FV_CAP_UNIVERSE)} tickers >= $300M loaded")
        return _FV_CAP_UNIVERSE
    except Exception as e:
        print(f"  WARN _get_fv_cap_universe: {e} — cap filter disabled this run")
        _FV_CAP_UNIVERSE = set()
        return _FV_CAP_UNIVERSE
```

**What to change:**
- On **success**: write the fetched set to `C:\Users\Patrick\uct-intelligence\data\cap_universe_cache.json`
- On **failure**: load from that file; only return empty set if the file also doesn't exist (true first-run edge case)
- Add a second global `_CAP_CACHE_PATH` pointing to the file

- [ ] **Step 1: Replace `_get_fv_cap_universe()` with the persistent version**

Find this exact block in `morning_wire_engine.py`:
```python
_FV_CAP_UNIVERSE: set | None = None

def _get_fv_cap_universe() -> set:
    """Return set of US tickers with market cap >= $300M (FinViz small+ universe).

    Fetches FinViz once per run and caches. Returns empty set on failure
    so callers fail open (no filtering) rather than dropping everything.
    """
    global _FV_CAP_UNIVERSE
    if _FV_CAP_UNIVERSE is not None:
        return _FV_CAP_UNIVERSE
    try:
        url = f"https://elite.finviz.com/export.ashx?v=152&f=cap_smallover&auth={FINVIZ_TOKEN}"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25, allow_redirects=True)
        r.raise_for_status()
        rows = _parse_fv_csv_robust(r.text)
        _FV_CAP_UNIVERSE = {(row.get("Ticker") or "").strip().upper() for row in rows if row.get("Ticker")}
        print(f"  CAP FILTER: {len(_FV_CAP_UNIVERSE)} tickers >= $300M loaded")
        return _FV_CAP_UNIVERSE
    except Exception as e:
        print(f"  WARN _get_fv_cap_universe: {e} — cap filter disabled this run")
        _FV_CAP_UNIVERSE = set()
        return _FV_CAP_UNIVERSE
```

Replace with:
```python
_FV_CAP_UNIVERSE: set | None = None
_CAP_CACHE_PATH = Path(r"C:\Users\Patrick\uct-intelligence\data\cap_universe_cache.json")

def _get_fv_cap_universe() -> set:
    """Return set of US tickers with market cap >= $300M (FinViz small+ universe).

    Fetches FinViz once per run and caches in-process. On success, persists
    to cap_universe_cache.json so subsequent runs survive a Finviz outage.
    On failure, loads from that file. Returns empty set only on true first run
    with no cache file — never silently disables filtering after the first
    successful fetch.
    """
    global _FV_CAP_UNIVERSE
    if _FV_CAP_UNIVERSE is not None:
        return _FV_CAP_UNIVERSE
    try:
        url = f"https://elite.finviz.com/export.ashx?v=152&f=cap_smallover&auth={FINVIZ_TOKEN}"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25, allow_redirects=True)
        r.raise_for_status()
        rows = _parse_fv_csv_robust(r.text)
        _FV_CAP_UNIVERSE = {(row.get("Ticker") or "").strip().upper() for row in rows if row.get("Ticker")}
        print(f"  CAP FILTER: {len(_FV_CAP_UNIVERSE)} tickers >= $300M loaded")
        try:
            _CAP_CACHE_PATH.write_text(json.dumps(sorted(_FV_CAP_UNIVERSE)), encoding="utf-8")
        except Exception:
            pass  # disk write failure is non-fatal
        return _FV_CAP_UNIVERSE
    except Exception as e:
        if _CAP_CACHE_PATH.exists():
            try:
                _FV_CAP_UNIVERSE = set(json.loads(_CAP_CACHE_PATH.read_text(encoding="utf-8")))
                print(f"  CAP FILTER: Finviz unavailable ({e}) — loaded {len(_FV_CAP_UNIVERSE)} tickers from cache")
                return _FV_CAP_UNIVERSE
            except Exception as ce:
                print(f"  WARN _get_fv_cap_universe: cache load failed ({ce}) — cap filter disabled this run")
        else:
            print(f"  WARN _get_fv_cap_universe: {e} — no cache file, cap filter disabled this run")
        _FV_CAP_UNIVERSE = set()
        return _FV_CAP_UNIVERSE
```

- [ ] **Step 2: Verify `json` is already imported in `morning_wire_engine.py`**

Run:
```bash
grep -n "^import json" /c/Users/Patrick/morning-wire/morning_wire_engine.py
```
Expected: a line like `     22→import json`. If not found, add `import json` near the top imports.

- [ ] **Step 3: Smoke-test the function in isolation**

```bash
cd /c/Users/Patrick/morning-wire
python -c "
from morning_wire_engine import _get_fv_cap_universe
uni = _get_fv_cap_universe()
print(f'Universe size: {len(uni)}')
print(f'AAPL in universe: {\"AAPL\" in uni}')
print(f'Cache written: ', end='')
import os; print(os.path.exists(r'C:\\Users\\Patrick\\uct-intelligence\\data\\cap_universe_cache.json'))
"
```
Expected output:
```
  CAP FILTER: XXXX tickers >= $300M loaded
Universe size: XXXX   (typically 3,000–4,500)
AAPL in universe: True
Cache written: True
```

- [ ] **Step 4: Verify fallback by simulating Finviz failure**

```bash
cd /c/Users/Patrick/morning-wire
python -c "
import morning_wire_engine as m
# Patch FINVIZ_TOKEN to force a 403
original = m.FINVIZ_TOKEN
m.FINVIZ_TOKEN = 'INVALID_TOKEN_FORCE_FAIL'
m._FV_CAP_UNIVERSE = None  # reset in-process cache
uni = m._get_fv_cap_universe()
m.FINVIZ_TOKEN = original
print(f'Fallback universe size: {len(uni)}')
print(f'AAPL in fallback: {\"AAPL\" in uni}')
"
```
Expected output (cache file exists from Step 3):
```
  CAP FILTER: Finviz unavailable (...) — loaded XXXX tickers from cache
Fallback universe size: XXXX
AAPL in fallback: True
```

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/morning-wire
git add morning_wire_engine.py
git commit -m "fix: persist cap universe to disk — survive Finviz outage at engine run time

_get_fv_cap_universe() now writes to cap_universe_cache.json on success
and loads from it on failure. Prevents themes/earnings/news filters from
silently disabling when Finviz is unreachable at 7:35 AM.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Dashboard — News Market Cap Filter

### Task 2: Add `market_cap >= $300M` to `_check_sym()` in `get_news()`

**File:** `C:\Users\Patrick\uct-dashboard\api\services\engine.py` — lines 1132–1143

**Context:** `_check_sym()` currently returns `True` for a ticker if `price × 3-month avg volume >= $5M`. This passes a $4 stock trading 2M shares daily ($8M dvol) with a $100M market cap. We need to add `market_cap >= 300_000_000`. The `fast_info` object is already fetched; `market_cap` is a direct attribute on it.

**Current code (lines 1132–1143):**
```python
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
```

- [ ] **Step 1: Write the failing test first**

Create `C:\Users\Patrick\uct-dashboard\tests\test_cap_filter.py`:

```python
"""Tests for $300M market cap enforcement in news and RSS filtering."""
import pytest
from unittest.mock import patch, MagicMock


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_fast_info(market_cap, price=50.0, avg_vol=200_000, quote_type="EQUITY"):
    fi = MagicMock()
    fi.market_cap = market_cap
    fi.last_price = price
    fi.three_month_average_volume = avg_vol
    fi.quote_type = quote_type
    return fi


# ── Task 2 tests: _check_sym market cap gate ───────────────────────────────────

def test_check_sym_passes_large_cap():
    """$1B market cap + $10M dvol → allowed."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=1_000_000_000, price=50.0, avg_vol=300_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("AAPL")
    assert ok is True


def test_check_sym_blocks_micro_cap():
    """$100M market cap → blocked even with high dollar volume."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=100_000_000, price=4.0, avg_vol=2_000_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("TINY")
    assert ok is False


def test_check_sym_blocks_exactly_at_threshold():
    """$299M market cap → blocked (strictly less than 300M)."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=299_999_999, price=10.0, avg_vol=600_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("EDGE")
    assert ok is False


def test_check_sym_passes_exactly_300m():
    """Exactly $300M → passes."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=300_000_000, price=10.0, avg_vol=600_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("PASS")
    assert ok is True


def test_check_sym_blocks_low_dollar_vol():
    """Large cap but $2M dvol → blocked by existing dollar volume gate."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=500_000_000, price=2.0, avg_vol=900_000)
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("ILLIQ")
    assert ok is False  # price×avg_vol = 1.8M < 5M


def test_check_sym_fails_open_on_exception():
    """yfinance exception → fail open (allow ticker through)."""
    from api.services.engine import _check_sym_cap
    with patch("yfinance.Ticker", side_effect=Exception("network error")):
        sym, ok = _check_sym_cap("NOFETCH")
    assert ok is True


def test_check_sym_blocks_non_equity():
    """ETF/FUND quote type → blocked."""
    from api.services.engine import _check_sym_cap
    fi = _make_fast_info(market_cap=5_000_000_000, price=100.0, avg_vol=1_000_000,
                         quote_type="ETF")
    with patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.fast_info = fi
        sym, ok = _check_sym_cap("SPY")
    assert ok is False
```

- [ ] **Step 2: Run the tests — verify they FAIL**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/test_cap_filter.py -v 2>&1 | head -30
```
Expected: `ImportError: cannot import name '_check_sym_cap'` (function doesn't exist yet)

- [ ] **Step 3: Implement the fix**

In `C:\Users\Patrick\uct-dashboard\api\services\engine.py`, find and replace `_check_sym`:

Find:
```python
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
```

Replace with:
```python
        def _check_sym(sym: str) -> tuple[str, bool]:
            return _check_sym_cap(sym)
```

Then, **above** the `get_news()` function definition (around line 1014), add this module-level helper:

```python
def _check_sym_cap(sym: str) -> tuple[str, bool]:
    """Return (sym, allowed) applying $5M dollar-volume AND $300M market-cap gates.

    Fails open on yfinance errors so transient network issues don't silently
    drop all news. ETFs and non-equity instruments are always blocked.
    """
    try:
        import yfinance as yf
        fi = yf.Ticker(sym).fast_info
        qt = getattr(fi, "quote_type", "EQUITY") or "EQUITY"
        if qt.upper() not in ("EQUITY", ""):
            return sym, False
        price      = getattr(fi, "last_price", 0) or 0
        avg_vol    = getattr(fi, "three_month_average_volume", 0) or 0
        market_cap = getattr(fi, "market_cap", 0) or 0
        return sym, (price * avg_vol) >= 5_000_000 and market_cap >= 300_000_000
    except Exception:
        return sym, True
```

- [ ] **Step 4: Run the tests — verify they PASS**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/test_cap_filter.py -v -k "check_sym"
```
Expected: 7 tests PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all previously passing tests still pass

---

### Task 3: Filter RSS fallback tickers against the `allowed` set

**File:** `C:\Users\Patrick\uct-dashboard\api\services\engine.py` — lines 1160–1187

**Context:** The RSS fallback runs when AV is rate-limited. RSS items have a `tickers` field (often empty, sometimes populated by Benzinga/Yahoo). Currently those tickers are passed through with no filtering. We reuse the `allowed` set already built by the `_check_sym_cap` loop above. Items with no tickers pass through (general headlines — fine).

**Current code (lines 1177–1185):**
```python
                    rss_items.append({
                        "headline":  rss.get("title", ""),
                        "source":    rss.get("source", ""),
                        "url":       rss.get("url", ""),
                        "time":      time_str,
                        "category":  _cat_map.get(rss.get("category", "general"), "GENERAL"),
                        "sentiment": rss.get("sentiment_label", "Neutral").lower(),
                        "tickers":   rss.get("tickers", []),
                    })
```

**Note:** `allowed` is built at line 1147–1151 but only if `unique_syms` is non-empty. When AV is rate-limited (and RSS is the primary path), `unique_syms` may be empty and `allowed` will be an empty set. RSS items with no tickers should still pass. Logic: keep item if `tickers` is empty OR any ticker in `allowed`.

But when AV is rate-limited we haven't run `_check_sym_cap` on the RSS tickers. We need to run it on them too.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_cap_filter.py`:

```python
# ── Task 3 tests: RSS fallback ticker filtering ────────────────────────────────

def test_rss_item_no_tickers_passes():
    """RSS item with empty tickers list → always passes (general headline)."""
    item = {"tickers": [], "headline": "Fed holds rates steady"}
    allowed = set()  # empty allowed set
    tickers = item["tickers"]
    result = not tickers or any(t in allowed for t in tickers)
    assert result is True


def test_rss_item_allowed_ticker_passes():
    """RSS item whose ticker is in allowed set → passes."""
    item = {"tickers": ["AAPL"], "headline": "Apple beats estimates"}
    allowed = {"AAPL"}
    tickers = item["tickers"]
    result = not tickers or any(t in allowed for t in tickers)
    assert result is True


def test_rss_item_blocked_ticker_dropped():
    """RSS item whose ticker is not in allowed set → dropped."""
    item = {"tickers": ["MICRO"], "headline": "Micro-cap announces deal"}
    allowed = {"AAPL", "MSFT"}
    tickers = item["tickers"]
    result = not tickers or any(t in allowed for t in tickers)
    assert result is False


def test_rss_item_mixed_tickers_passes_if_one_allowed():
    """RSS item with two tickers — one allowed, one not → passes (allowed ticker kept)."""
    item = {"tickers": ["MICRO", "AAPL"], "headline": "Story mentioning both"}
    allowed = {"AAPL"}
    tickers = item["tickers"]
    result = not tickers or any(t in allowed for t in tickers)
    assert result is True
```

- [ ] **Step 2: Run the new tests — verify they PASS**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/test_cap_filter.py -v -k "rss"
```
Expected: 4 tests PASS (these are unit tests for the filter logic, not the integration)

- [ ] **Step 3: Apply the fix in `get_news()`**

In `api/services/engine.py`, the RSS section currently appends items with unfiltered tickers. The fix has two parts:

**Part A** — After the `allowed` set is built (line ~1151), extend it with any RSS tickers that pass `_check_sym_cap`. Find:

```python
        # ── RSS fallback when AV is rate-limited or returns nothing ──────────
        rss_items = []
        if _av_rate_limited or not av_filtered:
            try:
                from api.services.news_aggregator import fetch_rss_news
                from datetime import date as _date
                _rss_raw = fetch_rss_news(str(_date.today()), limit=40)
```

Replace the entire RSS block with:

```python
        # ── RSS fallback when AV is rate-limited or returns nothing ──────────
        rss_items = []
        if _av_rate_limited or not av_filtered:
            try:
                from api.services.news_aggregator import fetch_rss_news
                from datetime import date as _date
                _rss_raw = fetch_rss_news(str(_date.today()), limit=40)
                _cat_map = {"earnings": "EARN", "analyst": "UPGRADE",
                            "m_and_a": "M&A", "economic": "MACRO", "general": "GENERAL"}

                # Collect RSS tickers not yet validated, run cap check on them
                _rss_new_syms = list({
                    t for rss in _rss_raw
                    for t in (rss.get("tickers") or [])
                    if t not in allowed
                })
                if _rss_new_syms:
                    with ThreadPoolExecutor(max_workers=min(len(_rss_new_syms), 8)) as ex:
                        _rss_allowed = {s for s, ok in (f.result() for f in _ac(
                            ex.submit(_check_sym_cap, s) for s in _rss_new_syms
                        )) if ok}
                    allowed = allowed | _rss_allowed

                for rss in _rss_raw:
                    rss_tickers = [t for t in (rss.get("tickers") or []) if t in allowed]
                    # Drop ticker-specific items whose ticker didn't pass cap check;
                    # items with no tickers at all are general headlines and always kept.
                    if (rss.get("tickers") or []) and not rss_tickers:
                        continue
                    tp = rss.get("time_published", "")
                    try:
                        from datetime import datetime as _dtt, timezone as _tz, timedelta as _td
                        dt_utc = _dtt.fromisoformat(tp.replace("Z", "+00:00")) if tp else None
                        time_str = dt_utc.astimezone(_tz((_td(hours=-5)))).strftime("%Y-%m-%d %H:%M:%S") if dt_utc else ""
                    except Exception:
                        time_str = ""
                    rss_items.append({
                        "headline":  rss.get("title", ""),
                        "source":    rss.get("source", ""),
                        "url":       rss.get("url", ""),
                        "time":      time_str,
                        "category":  _cat_map.get(rss.get("category", "general"), "GENERAL"),
                        "sentiment": rss.get("sentiment_label", "Neutral").lower(),
                        "tickers":   rss_tickers,
                    })
            except Exception:
                pass
```

- [ ] **Step 4: Run all cap filter tests**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/test_cap_filter.py -v
```
Expected: all 11 tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/ -v --tb=short 2>&1 | tail -25
```
Expected: all previously passing tests still pass

- [ ] **Step 6: Commit both Task 2 + Task 3 together**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/services/engine.py tests/test_cap_filter.py
git commit -m "fix: enforce $300M market cap minimum on live news feed

- Extract _check_sym_cap() as module-level helper (was inner function)
- Add market_cap >= 300M gate alongside existing dollar-volume check
- RSS fallback now runs _check_sym_cap on any new tickers before appending;
  ticker-specific RSS items whose ticker fails the cap check are dropped;
  general headlines with no tickers always pass through

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks complete, confirm:

- [ ] `cap_universe_cache.json` exists at `C:\Users\Patrick\uct-intelligence\data\`
- [ ] Simulated Finviz failure still returns a populated cap universe (from cache)
- [ ] `_check_sym_cap("AAPL")` returns `(True)` and `_check_sym_cap("PENNY")` with a mocked $50M cap returns `(False)`
- [ ] All 11 tests in `test_cap_filter.py` pass
- [ ] Full test suite passes with no regressions
- [ ] Morning wire engine runs without error: `cd C:\Users\Patrick\morning-wire && python morning_wire_engine.py`
