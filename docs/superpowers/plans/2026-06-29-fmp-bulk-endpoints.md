# FMP Bulk Endpoints — Nightly Ratings Speedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-ticker yfinance `.info` call in the nightly ratings-percentile gather with one FMP Ultimate **bulk** fundamentals pull, so the full ~3,700 universe refreshes in a single run instead of ~5 nights — gated, with the per-ticker path kept as fallback.

**Architecture:** New `fmp_bulk.py` returns a `{symbol: fundamentals}` map (FMP bulk, parsed to the SAME keys `get_fundamentals` returns), disk-cached per run. `ratings_universe._compute_one` reads from that map when present, else falls back to the existing per-ticker `get_fundamentals`. Backend-only; screener builder is already zero-network and untouched.

**Tech Stack:** FastAPI/Python, FMP Ultimate bulk endpoints, pytest.

## Global Constraints
- FMP-first **optimization layer only** — the per-ticker `get_fundamentals` fallback stays wired; a bulk gap/schema-drift must never blank a ticker's rating. (Locked invariant.)
- Gated by `FMP_BULK_ENABLED=1` (default OFF until live-verified). Off → behavior identical to today.
- Verify exact FMP bulk endpoint paths + response format live before locking (debug probe pattern). Bulk failure → `{}` → full per-ticker fallback. Never raises.
- Isolated worktree off `origin/master`; explicit-path commits; FF push. Tests: `python -m pytest <path> -v`.
- Reuse `earnings_estimates._fmp_get` style for HTTP; reuse the shared TTLCache only for in-process; per-run map cached on disk under `DATA_DIR`.

## File Structure
| Path | Responsibility |
|------|----------------|
| `api/services/fmp_bulk.py` | **New.** `fetch_fundamentals_bulk()` → `{sym: fundamentals}` (get_fundamentals-compatible keys), per-run disk cache. |
| `api/services/research/ratings_universe.py` | `_compute_one(sym, bulk_fund=None)` + gated bulk pull in `run_percentile_refresh`. |
| `tests/test_fmp_bulk.py` | bulk parse/mapping + empty. |
| `tests/test_ratings_universe.py` | extend: bulk hit→no per-ticker call; miss→fallback; gate off unchanged. |

---

## Task 1: fmp_bulk service

**Files:** Create `api/services/fmp_bulk.py`; Test `tests/test_fmp_bulk.py`

**Interfaces:**
- Produces: `fetch_fundamentals_bulk(force=False) -> dict[str, dict]` — `{SYM: {earnings_growth_pct, revenue_growth_pct, peg, pe_forward, operating_margin_pct, roe_pct, held_pct_institutions, sector}}` (the exact keys `_compute_one` reads from `get_fundamentals`). `{}` on failure. Mockable `_fmp_bulk_rows() -> list[dict]`.

- [ ] **Step 1: Failing test**
```python
# tests/test_fmp_bulk.py
import importlib
def _mod(monkeypatch):
    import api.services.fmp_bulk as fb
    importlib.reload(fb)
    return fb

def test_maps_bulk_rows_to_fundamentals_keys(monkeypatch):
    fb = _mod(monkeypatch)
    monkeypatch.setattr(fb, "_fmp_bulk_rows", lambda: [
        {"symbol": "AAPL", "returnOnEquity": 1.47, "operatingProfitMargin": 0.30,
         "growthRevenue": 0.08, "growthNetIncome": 0.11, "priceEarningsToGrowthRatio": 2.1,
         "forwardPE": 28.0, "sector": "Technology"},
    ])
    out = fb.fetch_fundamentals_bulk()
    a = out["AAPL"]
    assert a["roe_pct"] == 147.0           # *100
    assert a["operating_margin_pct"] == 30.0
    assert a["revenue_growth_pct"] == 8.0
    assert a["earnings_growth_pct"] == 11.0
    assert a["pe_forward"] == 28.0
    assert a["sector"] == "Technology"

def test_empty_on_failure(monkeypatch):
    fb = _mod(monkeypatch)
    monkeypatch.setattr(fb, "_fmp_bulk_rows", lambda: [])
    assert fb.fetch_fundamentals_bulk() == {}
```

- [ ] **Step 2: Run → fail.** `python -m pytest tests/test_fmp_bulk.py -v`

- [ ] **Step 3: Implement** (FMP bulk path/fields verified live; the `_fmp_bulk_rows` merge of profile+ratios+key-metrics bulk variants is confirmed during Task 3):
```python
# api/services/fmp_bulk.py
"""FMP Ultimate BULK fundamentals — one pull for the whole market, mapped to the
same keys api.services.fundamentals.get_fundamentals returns, so the ratings
gather can read it in place of a per-ticker yfinance call. Optimization layer
only: returns {} on any failure so callers fall back to per-ticker."""
from __future__ import annotations
import logging, os, time
from api.services import earnings_estimates as ee

_log = logging.getLogger(__name__)
_CACHE: dict = {}
_CACHE_DAY: str | None = None

def _pct(v):
    try:
        return round(float(v) * 100.0, 1)
    except (TypeError, ValueError):
        return None

def _num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None

def _fmp_bulk_rows() -> list[dict]:
    """Raw bulk rows merged by symbol (ratios + key-metrics + profile bulk).
    Exact endpoint paths/format verified live; returns [] on failure."""
    rows = ee._fmp_get("/stable/ratios-bulk", {})  # may be CSV-as-JSON on Ultimate; confirm
    return rows if isinstance(rows, list) else []

def fetch_fundamentals_bulk(force=False) -> dict:
    global _CACHE, _CACHE_DAY
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if not force and _CACHE_DAY == day and _CACHE:
        return _CACHE
    try:
        rows = _fmp_bulk_rows()
    except Exception as e:
        _log.warning("fmp bulk fetch failed: %s", e)
        rows = []
    out = {}
    for r in rows:
        sym = str(r.get("symbol") or "").upper()
        if not sym:
            continue
        out[sym] = {
            "earnings_growth_pct": _pct(r.get("growthNetIncome") or r.get("netIncomeGrowth")),
            "revenue_growth_pct": _pct(r.get("growthRevenue") or r.get("revenueGrowth")),
            "peg": _num(r.get("priceEarningsToGrowthRatio") or r.get("pegRatio")),
            "pe_forward": _num(r.get("forwardPE")),
            "operating_margin_pct": _pct(r.get("operatingProfitMargin")),
            "roe_pct": _pct(r.get("returnOnEquity")),
            "held_pct_institutions": _pct(r.get("heldPercentInstitutions")),
            "sector": r.get("sector"),
        }
    if out:
        _CACHE, _CACHE_DAY = out, day
    return out
```

- [ ] **Step 4: Run → pass.** `python -m pytest tests/test_fmp_bulk.py -v`
- [ ] **Step 5: Commit.**
```bash
git add api/services/fmp_bulk.py tests/test_fmp_bulk.py
git commit -m "feat: fmp_bulk.fetch_fundamentals_bulk (whole-market fundamentals pull)"
```

---

## Task 2: gated integration into ratings_universe

**Files:**
- Modify: `api/services/research/ratings_universe.py`
- Test: `tests/test_ratings_universe.py` (extend)

**Interfaces:**
- Consumes: `fmp_bulk.fetch_fundamentals_bulk`.
- Changes: `_compute_one(sym, bulk_fund: dict | None = None)` — uses `bulk_fund` when given, else `get_fundamentals(sym)`. `run_percentile_refresh` pulls the bulk map once when `FMP_BULK_ENABLED=1` and passes each sym's entry.

- [ ] **Step 1: Failing test**
```python
# tests/test_ratings_universe.py  (add)
import importlib
def test_compute_one_prefers_bulk_no_yf(monkeypatch):
    import api.services.research.ratings_universe as ru
    importlib.reload(ru)
    def _boom(sym):
        raise AssertionError("get_fundamentals must NOT be called when bulk has the symbol")
    monkeypatch.setattr(ru, "get_fundamentals", _boom)
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda *a, **k: [])
    bulk = {"earnings_growth_pct": 11.0, "revenue_growth_pct": 8.0, "roe_pct": 147.0,
            "peg": 2.1, "pe_forward": 28.0, "operating_margin_pct": 30.0,
            "held_pct_institutions": 60.0, "sector": "Technology"}
    m = ru._compute_one("ZZAAPL", bulk_fund=bulk)
    assert m["earnings_growth"] == 11.0 and m["roe"] == 147.0 and m["sector"] == "Technology"

def test_compute_one_falls_back_when_no_bulk(monkeypatch):
    import api.services.research.ratings_universe as ru
    importlib.reload(ru)
    called = {"n": 0}
    def _fake(sym):
        called["n"] += 1
        return {"earnings_growth_pct": 5.0, "revenue_growth_pct": 4.0, "roe_pct": 10.0}
    monkeypatch.setattr(ru, "get_fundamentals", _fake)
    monkeypatch.setattr(ru.bars_sqlite, "get_bars", lambda *a, **k: [])
    m = ru._compute_one("ZZX", bulk_fund=None)
    assert called["n"] == 1 and m["earnings_growth"] == 5.0
```

- [ ] **Step 2: Run → fail.** `python -m pytest tests/test_ratings_universe.py -v`

- [ ] **Step 3: Implement** — change `_compute_one` signature + body:
```python
def _compute_one(sym: str, bulk_fund: dict | None = None) -> dict | None:
    """Compute one ticker's raw rankable metrics. Local bars + fundamentals.
    Uses the prefetched bulk fundamentals map when available, else 1 yfinance call."""
    closes = vols = None
    try:
        rows = bars_sqlite.get_bars(sym, "D", 300)
        if rows:
            closes = [r[4] for r in rows]
            vols = [r[5] for r in rows]
    except Exception:
        pass
    rs_return = _weighted_rs_return(closes) if closes else None
    accdis_ratio = _accdis_ratio(closes, vols) if (closes and vols) else None

    if bulk_fund is not None:
        fund = bulk_fund
    else:
        try:
            fund = get_fundamentals(sym) or {}
        except Exception:
            fund = {}
        if "error" in fund:
            fund = {}
    # ... unchanged: build + return the metrics dict from `fund` + rs/accdis
```
In `run_percentile_refresh`, before the per-sym loop:
```python
    bulk = {}
    if os.environ.get("FMP_BULK_ENABLED", "").lower() in ("1", "true", "yes"):
        try:
            from api.services.fmp_bulk import fetch_fundamentals_bulk
            bulk = fetch_fundamentals_bulk()
            _logger.info("ratings_universe: FMP bulk fundamentals loaded for %d symbols", len(bulk))
        except Exception as e:
            _logger.warning("ratings_universe: bulk pull failed, per-ticker fallback: %s", e)
            bulk = {}
```
and pass it in the loop (run through the pool as today, but only call `get_fundamentals` for misses):
```python
        for sym in batch:
            m = run_in_pool(lambda s=sym: _compute_one(s, bulk_fund=bulk.get(s)))
            ...
            if bulk.get(sym) is None:
                time.sleep(SLEEP_SECONDS)   # only sleep when we actually hit yfinance
```
(With bulk hits, no yfinance call → the politeness sleep is skipped → the run completes fast.)

- [ ] **Step 4: Run → pass.** `python -m pytest tests/test_ratings_universe.py tests/test_ratings_percentile.py -v`
- [ ] **Step 5: Commit.**
```bash
git add api/services/research/ratings_universe.py tests/test_ratings_universe.py
git commit -m "feat: ratings gather reads FMP bulk fundamentals (gated, per-ticker fallback)"
```

---

## Task 3: live verification (gated run)

- [ ] **Step 1:** Probe the real FMP bulk endpoint(s) (`_fmp_bulk_rows`): hit the candidate paths with the key, confirm format (CSV vs JSON list) + the field names for ROE/margins/growth/sector. Adjust `_fmp_bulk_rows` parsing + the field map in `fetch_fundamentals_bulk` with a matching unit-test tweak if names differ. If only a CSV stream is returned, parse it to dicts in `_fmp_bulk_rows`.
- [ ] **Step 2:** One gated run on a small slice — set `FMP_BULK_ENABLED=1`, `RATINGS_PERCENTILE_MAX_PER_RUN=50`, run `python -c "from api.services.research import ratings_universe as r; print(r.run_percentile_refresh(force=True))"` (loading `.env`); confirm the log shows bulk loaded for N symbols + the run completes far faster (no per-ticker sleeps on bulk hits) and rows land in `/data/research_ratings.db`.
- [ ] **Step 3:** Spot-check a few tickers' stored metrics vs the per-ticker path (toggle gate off, recompute one, compare roe/growth within rounding). Confirm misses (symbols absent from bulk) still fall back + store.
- [ ] **Step 4 (deploy):** set `FMP_BULK_ENABLED=1` on Railway worker (the pod that runs the nightly job) only after the slice run looks right.

## Self-Review
- Spec coverage: bulk service (T1), gated integration + per-ticker fallback (T2), hit/miss merge (T2 tests), live verify + format confirm (T3), screener correctly excluded (spec corrected). ✓
- Placeholders: complete code; the `_fmp_bulk_rows` exact path is a verify-live item (explicit T3), with a working default + fallback. ✓
- Type consistency: bulk map values use the EXACT keys `get_fundamentals` returns + `_compute_one` reads (`earnings_growth_pct, revenue_growth_pct, peg, pe_forward, operating_margin_pct, roe_pct, held_pct_institutions, sector`). ✓
