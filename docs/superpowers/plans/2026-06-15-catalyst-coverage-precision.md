# Stock Catalysts — Coverage & Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Stock Catalysts backend miss nothing notable (analyst actions as a first-class catalyst + a broadened notable-move net + a coverage audit that proves it) while spending no row on untradeable junk (a float-aware tradeability gate with full rejection logging). Tile UI unchanged.

**Architecture:** Pure-function gates/scoring/selection stay deterministic and env-tunable. A new `analyst_actions.py` module sources upgrades/downgrades/PT-changes from the wire push (market-wide) + Finnhub per-candidate (already paid) + TheFly (only if a key exists). `ticker_metadata.py` gains float/shares-outstanding so `filters.quality_gate()` can drop low-float pumps. Every gate rejection is persisted for evidence-based tuning, and `coverage_audit.py` grows an analyst-coverage net.

**Tech Stack:** Python 3.12, FastAPI, SQLite (WAL), yfinance, Finnhub REST, pytest. Spec: `docs/superpowers/specs/2026-06-15-catalyst-coverage-precision-design.md`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `api/services/catalyst/ticker_metadata.py` | modify | Add `float_shares` + `shares_outstanding` to fetch/cache/return |
| `api/services/catalyst/analyst_actions.py` | **create** | Market-wide analyst-action discovery + per-ticker Finnhub recent action |
| `api/services/catalyst/sources.py` | modify | Carry float fields onto candidates; add analyst source to `collect_all`; broaden gap-scan caps |
| `api/services/catalyst/filters.py` | modify | Float lever in `quality_gate`; `analyst_meta` passes `is_real_catalyst` |
| `api/services/catalyst/tagging.py` | modify | `analyst_meta` qualifies as a "Catalyst" signal |
| `api/services/catalyst/scoring.py` | modify | `W_ANALYST_ACTION` bonus when `analyst_meta` present |
| `api/services/catalyst/selection.py` | modify | Min-analyst reserve so analyst movers always get slots |
| `api/services/catalyst/synthesize.py` | modify | Analyst block in prompt; `analyst_meta` counts as a real source |
| `api/services/catalyst/engine.py` | modify | `_compute_catalyst_at` includes analyst ts; per-candidate Finnhub enrichment; persist gate rejections |
| `api/services/catalyst/store.py` | modify | `catalyst_gate_rejections` table + `log_rejection` + `recent_rejections` |
| `api/services/catalyst/coverage_audit.py` | modify | Add analyst-action coverage net + sector breakdown |
| `api/routers/catalysts.py` | modify | `GET /api/admin/catalyst-rejections` |
| `tests/test_catalyst_coverage_precision.py` | **create** | Unit tests for all pure-function changes |

**Conventions to follow (from existing code):** env floats via the local `_f`/`_w`/`_envf` helpers; SQLite via `contextlib.closing(_connect())` + `_WRITE_LOCK`; fail-open on missing external data; all thresholds env-overridable with safe defaults.

**Run backend tests with:** `python -m pytest tests/test_catalyst_coverage_precision.py -v` (from repo root, venv active). Full suite: `python -m pytest tests/ -q`.

---

## Task 1: Add float / shares-outstanding to ticker metadata

**Files:**
- Modify: `api/services/catalyst/ticker_metadata.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_catalyst_coverage_precision.py
from api.services.catalyst import ticker_metadata as tm


def test_fetch_via_yfinance_maps_float_and_shares(monkeypatch):
    class FakeTicker:
        def __init__(self, sym):
            self.info = {
                "sector": "Technology", "industry": "Semis",
                "marketCap": 5_000_000_000, "averageVolume10days": 1_200_000,
                "fiftyTwoWeekHigh": 99.0, "quoteType": "EQUITY",
                "floatShares": 40_000_000, "sharesOutstanding": 50_000_000,
            }

    import yfinance
    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    out = tm._fetch_via_yfinance("FOO")
    assert out["float_shares"] == 40_000_000
    assert out["shares_outstanding"] == 50_000_000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_fetch_via_yfinance_maps_float_and_shares -v`
Expected: FAIL — `KeyError: 'float_shares'`.

- [ ] **Step 3: Implement**

In `_SCHEMA` add two columns (after `quote_type`):
```python
  quote_type          TEXT,
  float_shares        INTEGER,
  shares_outstanding  INTEGER,
  fetched_at          INTEGER NOT NULL
```

In `_init_db()` backwards-compat loop, extend the tuple:
```python
            for col, decl in (("fifty_two_week_high", "REAL"),
                              ("quote_type", "TEXT"),
                              ("float_shares", "INTEGER"),
                              ("shares_outstanding", "INTEGER")):
```

Update `_put_cache` signature + INSERT to include the two fields:
```python
def _put_cache(ticker: str, sector: Optional[str], industry: Optional[str],
               market_cap: Optional[float], avg_volume_30d: Optional[int],
               fifty_two_week_high: Optional[float] = None,
               quote_type: Optional[str] = None,
               float_shares: Optional[int] = None,
               shares_outstanding: Optional[int] = None) -> None:
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO ticker_metadata
               (ticker, sector, industry, market_cap, avg_volume_30d,
                fifty_two_week_high, quote_type, float_shares,
                shares_outstanding, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET
                 sector = excluded.sector,
                 industry = excluded.industry,
                 market_cap = excluded.market_cap,
                 avg_volume_30d = excluded.avg_volume_30d,
                 fifty_two_week_high = excluded.fifty_two_week_high,
                 quote_type = excluded.quote_type,
                 float_shares = excluded.float_shares,
                 shares_outstanding = excluded.shares_outstanding,
                 fetched_at = excluded.fetched_at""",
            (ticker.upper(), sector, industry, market_cap, avg_volume_30d,
             fifty_two_week_high, quote_type, float_shares,
             shares_outstanding, int(time.time())),
        )
        c.commit()
```

In `_fetch_via_yfinance`, add to the returned dict (both success and except branches):
```python
            "float_shares": (int(info.get("floatShares"))
                             if info.get("floatShares") else None),
            "shares_outstanding": (int(info.get("sharesOutstanding"))
                                   if info.get("sharesOutstanding") else None),
```
(except branch adds `"float_shares": None, "shares_outstanding": None`.)

In `get_metadata` empty-return dicts (both the `if not ticker` guard and final return), the cached-return dict, and the `_put_cache(...)` call, add the two fields:
```python
        # cached return:
            "float_shares": cached.get("float_shares"),
            "shares_outstanding": cached.get("shares_outstanding"),
        # _put_cache call:
    _put_cache(ticker, fresh["sector"], fresh["industry"],
               fresh["market_cap"], fresh["avg_volume_30d"],
               fresh.get("fifty_two_week_high"), fresh.get("quote_type"),
               fresh.get("float_shares"), fresh.get("shares_outstanding"))
```
Add `"float_shares": None, "shares_outstanding": None` to both empty-dict literals.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_fetch_via_yfinance_maps_float_and_shares -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/ticker_metadata.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): add float/shares-outstanding to ticker metadata"
```

---

## Task 2: Carry float fields onto candidates

**Files:**
- Modify: `api/services/catalyst/sources.py` (`_enrich_with_snapshot` ~line 165; candidate dict ~line 699)
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_enrich_snapshot_includes_float(monkeypatch):
    from api.services.catalyst import sources
    monkeypatch.setattr(sources, "_get_client", lambda: None, raising=False)

    class _Client:
        def get_batch_rich_snapshots(self, tickers):
            return {"FOO": {"price": 10.0, "vol": 2_000_000, "prev_close": 9.0}}

    monkeypatch.setattr("api.services.massive._get_client", lambda: _Client())
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata_batch",
        lambda tickers: {"FOO": {"avg_volume_30d": 1_000_000, "market_cap": 1e9,
                                 "sector": "Tech", "float_shares": 3_000_000,
                                 "shares_outstanding": 4_000_000}},
    )
    out = sources._enrich_with_snapshot(["FOO"])
    assert out["FOO"]["float_shares"] == 3_000_000
    assert out["FOO"]["shares_outstanding"] == 4_000_000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_enrich_snapshot_includes_float -v`
Expected: FAIL — `KeyError: 'float_shares'`.

- [ ] **Step 3: Implement**

In `_enrich_with_snapshot`, inside the `out[ticker_u] = {...}` dict, add:
```python
            "float_shares": m.get("float_shares"),
            "shares_outstanding": m.get("shares_outstanding"),
```

In `collect_all`, inside the `candidates.append({...})` dict, add:
```python
            "float_shares": snap.get("float_shares"),
            "shares_outstanding": snap.get("shares_outstanding"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_enrich_snapshot_includes_float -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/sources.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): carry float/shares onto candidates"
```

---

## Task 3: Float lever in quality_gate + analyst_meta passes is_real_catalyst

**Files:**
- Modify: `api/services/catalyst/filters.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing tests**

```python
from api.services.catalyst import filters


def test_quality_gate_drops_low_float(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_FLOAT", "5000000")
    c = {"quote_type": "EQUITY", "price": 8.0, "avg_volume_30d": 2_000_000,
         "market_cap": 4e8, "float_shares": 1_000_000}
    passed, reason = filters.quality_gate(c)
    assert passed is False
    assert "float" in (reason or "").lower()


def test_quality_gate_failopen_when_float_missing(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_FLOAT", "5000000")
    c = {"quote_type": "EQUITY", "price": 8.0, "avg_volume_30d": 2_000_000,
         "market_cap": 4e8}  # no float_shares
    passed, _ = filters.quality_gate(c)
    assert passed is True


def test_analyst_action_is_a_real_catalyst():
    c = {"gap_pct": 1.0, "vol_x": 1.0,
         "analyst_meta": {"action": "upgrade", "firm": "MS"}}
    passed, _ = filters.is_real_catalyst(c)
    assert passed is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py -k "float or analyst_action_is" -v`
Expected: FAIL — low-float kept; analyst-only dropped.

- [ ] **Step 3: Implement**

In `quality_gate`, after the market-cap block and before `return True, None`, add:
```python
    # ── Float floor — the classic low-float pump tell. Prefer true float;
    # fall back to shares-outstanding. Fail-open when neither is known. ──
    min_float = _f("CATALYST_MIN_FLOAT", 5_000_000.0)
    flt = c.get("float_shares") or c.get("shares_outstanding")
    if isinstance(flt, (int, float)) and flt > 0 and flt < min_float:
        return False, (
            f"float {flt / 1e6:.1f}M shares below {min_float / 1e6:.1f}M floor"
        )
```

In `is_real_catalyst`, add an analyst pass before the final `return False`:
```python
    if c.get("analyst_meta"):
        return True, None                              # analyst rating/PT change
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py -k "float or analyst_action_is" -v`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/filters.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): float gate lever + analyst actions pass real-catalyst gate"
```

---

## Task 4: Gate-rejection log table + accessors

**Files:**
- Modify: `api/services/catalyst/store.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_gate_rejection_log_roundtrip(monkeypatch, tmp_path):
    db = tmp_path / "catalysts.db"
    monkeypatch.setenv("CATALYST_DB_PATH", str(db))
    import importlib
    from api.services.catalyst import store as store_mod
    importlib.reload(store_mod)
    store_mod._init_db()
    store_mod.log_rejection(market_date="2026-06-15", ticker="JUNK",
                            reason="float 1.0M shares below 5.0M floor",
                            price=8.0, dollar_vol=1.6e7, float_shares=1_000_000,
                            market_cap=4e8)
    rows = store_mod.recent_rejections(limit=10)
    assert any(r["ticker"] == "JUNK" and "float" in r["reason"] for r in rows)
    importlib.reload(store_mod)  # restore default DB path for other tests
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_gate_rejection_log_roundtrip -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'log_rejection'`.

- [ ] **Step 3: Implement**

Add to `_SCHEMA` (before the closing `"""`):
```sql
CREATE TABLE IF NOT EXISTS catalyst_gate_rejections (
  ts            INTEGER NOT NULL,
  market_date   TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  reason        TEXT NOT NULL,
  price         REAL,
  dollar_vol    REAL,
  float_shares  INTEGER,
  market_cap    REAL
);
CREATE INDEX IF NOT EXISTS idx_gate_rej_date ON catalyst_gate_rejections(market_date, ts DESC);
```

Add functions at end of file:
```python
def log_rejection(*, market_date: str, ticker: str, reason: str,
                  price: Optional[float] = None, dollar_vol: Optional[float] = None,
                  float_shares: Optional[int] = None,
                  market_cap: Optional[float] = None) -> None:
    """Persist a quality-gate rejection so thresholds can be tuned from evidence
    instead of guesswork. Rolling — pruned to the last 14 days on write."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalyst_gate_rejections
               (ts, market_date, ticker, reason, price, dollar_vol,
                float_shares, market_cap)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (int(time.time()), market_date, ticker.upper(), reason, price,
             dollar_vol, float_shares, market_cap),
        )
        c.execute(
            "DELETE FROM catalyst_gate_rejections WHERE ts < ?",
            (int(time.time()) - 14 * 86400,),
        )
        c.commit()


def recent_rejections(limit: int = 200, market_date: Optional[str] = None) -> list[dict]:
    sql = "SELECT * FROM catalyst_gate_rejections"
    params: tuple = ()
    if market_date:
        sql += " WHERE market_date = ?"
        params = (market_date,)
    sql += " ORDER BY ts DESC LIMIT ?"
    params = params + (int(limit),)
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql, params).fetchall()]


def rejection_summary(market_date: Optional[str] = None) -> dict:
    """Counts of rejections grouped by the reason's leading phrase (so
    'float ... below' and 'liquidity ... below' aggregate)."""
    rows = recent_rejections(limit=2000, market_date=market_date)
    by_kind: dict[str, int] = {}
    for r in rows:
        kind = (r.get("reason") or "").split(" ")[0] or "other"
        by_kind[kind] = by_kind.get(kind, 0) + 1
    return {"total": len(rows), "by_kind": by_kind}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_gate_rejection_log_roundtrip -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/store.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): persist quality-gate rejections for tuning"
```

---

## Task 5: Engine persists gate rejections

**Files:**
- Modify: `api/services/catalyst/engine.py` (gate loop ~line 627)

- [ ] **Step 1: Implement (integration — verified by the engine's own logging + Task 15 endpoint)**

In the gate loop, change the `else` branch to also persist the rejection:
```python
    for c in candidates:
        passed, reason = filters.quality_gate(c)
        if passed:
            passed, reason = filters.is_real_catalyst(c)
        if passed:
            kept.append(c)
        else:
            sym = (c.get("ticker") or "").upper()
            excluded[sym] = reason or "excluded"
            try:
                adv = c.get("avg_volume_30d") or c.get("today_volume") or 0
                store.log_rejection(
                    market_date=md, ticker=sym, reason=reason or "excluded",
                    price=c.get("price"),
                    dollar_vol=(float(c.get("price") or 0) * float(adv)) or None,
                    float_shares=c.get("float_shares") or c.get("shares_outstanding"),
                    market_cap=c.get("market_cap"),
                )
            except Exception:
                logger.debug("[catalyst-engine] rejection log failed for %s", sym)
```

- [ ] **Step 2: Verify it imports + runs**

Run: `python -c "import api.services.catalyst.engine"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add api/services/catalyst/engine.py
git commit -m "feat(catalyst): log gate rejections from the engine loop"
```

---

## Task 6: Analyst-actions source module

**Files:**
- Create: `api/services/catalyst/analyst_actions.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_analyst_candidates_from_wire(monkeypatch):
    from api.services.catalyst import analyst_actions as aa
    monkeypatch.setattr(
        "api.services.engine.get_analyst_actions",
        lambda: {"upgrades": [{"ticker": "AAA", "action": "upgrade",
                               "firm": "MS", "from_rating": "Hold",
                               "to_rating": "Buy", "price_target": "$120"}],
                 "downgrades": [], "pt_changes": []},
    )
    monkeypatch.setenv("THEFLY_API_KEY", "")  # TheFly off
    out = aa.get_analyst_candidates()
    assert "AAA" in out
    assert out["AAA"]["action"] == "upgrade"
    assert out["AAA"]["firm"] == "MS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_analyst_candidates_from_wire -v`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```python
# api/services/catalyst/analyst_actions.py
"""Analyst-action discovery for the catalyst engine.

Three free / already-paid layers (no new subscription):
  1. Wire push  — engine.get_analyst_actions() (AlphaVantage+TheFly, market-wide,
     lands ~7:43 AM ET). The discovery backbone.
  2. TheFly     — only if THEFLY_API_KEY is set (graceful no-op otherwise).
  3. Finnhub    — per-candidate /stock/upgrade-downgrade enrichment (see
     finnhub_recent_action), called by the engine for pool names lacking
     analyst_meta so analyst-driven gappers are caught before the wire lands.

analyst_meta shape: {action, firm, from_rating, to_rating, price_target, at}
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_FH_BASE = "https://finnhub.io/api/v1"
_TIMEOUT = 8


def _norm_meta(raw: dict) -> dict:
    return {
        "action": str(raw.get("action") or "").lower() or None,
        "firm": raw.get("firm") or raw.get("company") or None,
        "from_rating": raw.get("from_rating") or raw.get("fromGrade") or None,
        "to_rating": raw.get("to_rating") or raw.get("toGrade") or None,
        "price_target": raw.get("price_target") or None,
        "at": raw.get("at"),
    }


def get_analyst_candidates() -> dict[str, dict]:
    """Market-wide {ticker: analyst_meta} for today. Wire backbone + optional
    TheFly. Never raises — returns {} on any failure."""
    out: dict[str, dict] = {}
    try:
        from api.services.engine import get_analyst_actions
        data = get_analyst_actions() or {}
        for key in ("upgrades", "downgrades", "pt_changes"):
            for a in (data.get(key) or []):
                sym = str(a.get("ticker") or "").upper()
                if sym and sym not in out:
                    out[sym] = _norm_meta(a)
    except Exception as e:
        logger.warning("[catalyst-analyst] wire analyst_actions failed: %s", e)

    # Optional TheFly market-wide analyst Squawk (only if a key is configured).
    if os.environ.get("THEFLY_API_KEY", "").strip():
        try:
            from api.services.thefly_news import get_squawks
            res = get_squawks(category="analyst", count=50)
            for item in (res.get("items") or []):
                sym = str(item.get("symbol") or "").upper()
                if sym and sym not in out:
                    out[sym] = _norm_meta({
                        "action": item.get("category"),
                        "firm": None,
                        "at": None,
                    })
        except Exception as e:
            logger.debug("[catalyst-analyst] thefly squawk failed: %s", e)

    return out


def finnhub_recent_action(ticker: str, within_hours: int = 36) -> Optional[dict]:
    """Most-recent Finnhub upgrade/downgrade for one ticker, if within the
    window. Already-paid FINNHUB_API_KEY. Returns analyst_meta or None."""
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not key or not ticker:
        return None
    try:
        r = requests.get(
            f"{_FH_BASE}/stock/upgrade-downgrade",
            params={"symbol": ticker.upper(), "token": key},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        rows = r.json() or []
    except Exception as e:
        logger.debug("[catalyst-analyst] finnhub failed for %s: %s", ticker, e)
        return None
    if not isinstance(rows, list) or not rows:
        return None
    rows.sort(key=lambda x: x.get("gradeTime", 0), reverse=True)
    top = rows[0]
    grade_time = top.get("gradeTime", 0)
    if not grade_time or grade_time < time.time() - within_hours * 3600:
        return None
    return _norm_meta({
        "action": top.get("action"),
        "company": top.get("company"),
        "fromGrade": top.get("fromGrade"),
        "toGrade": top.get("toGrade"),
        "at": int(grade_time),
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_analyst_candidates_from_wire -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/analyst_actions.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): analyst-actions source module (wire + finnhub + thefly)"
```

---

## Task 7: Wire the analyst source into collect_all

**Files:**
- Modify: `api/services/catalyst/sources.py` (`collect_all` ~line 621)
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_collect_all_merges_analyst_meta(monkeypatch):
    from api.services.catalyst import sources
    monkeypatch.setattr(sources, "_pull_movers", lambda: {})
    monkeypatch.setattr(sources, "_pull_gap_scan", lambda: {})
    monkeypatch.setattr(sources, "_pull_earnings", lambda: {})
    monkeypatch.setattr(sources, "_pull_tweet_signals", lambda: {})
    monkeypatch.setattr(sources, "_pull_rss_signals", lambda: {})
    monkeypatch.setattr(sources, "_pull_scanner_setups", lambda: {})
    monkeypatch.setattr(sources, "_pull_perplexity_discovery", lambda: {})
    monkeypatch.setattr(
        "api.services.catalyst.analyst_actions.get_analyst_candidates",
        lambda: {"AAA": {"action": "upgrade", "firm": "MS"}},
    )
    monkeypatch.setattr(sources, "_enrich_with_snapshot",
                        lambda tickers: {"AAA": {"price": 50.0, "vol_x": 1.0}})
    cands = sources.collect_all()
    aaa = next(c for c in cands if c["ticker"] == "AAA")
    assert aaa["analyst_meta"]["action"] == "upgrade"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_collect_all_merges_analyst_meta -v`
Expected: FAIL — `KeyError: 'analyst_meta'`.

- [ ] **Step 3: Implement**

Add a thin source wrapper above `collect_all`:
```python
def _pull_analyst_actions() -> dict[str, dict]:
    """{ticker: analyst_meta} for today (wire + optional TheFly)."""
    try:
        from api.services.catalyst.analyst_actions import get_analyst_candidates
        return get_analyst_candidates()
    except Exception as e:
        logger.warning("[catalyst-sources] analyst pull failed: %s", e)
        return {}
```

In `collect_all`, add to `tasks`:
```python
        "analyst":    _pull_analyst_actions,
```

Add to the universe union:
```python
    universe.update(results.get("analyst", {}).keys())
```

In the per-ticker loop, read and attach analyst_meta:
```python
        analyst_meta = results.get("analyst", {}).get(ticker)
```
and add to the `candidates.append({...})` dict:
```python
            "analyst_meta": analyst_meta,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_collect_all_merges_analyst_meta -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/sources.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): add analyst-actions source to collect_all"
```

---

## Task 8: Analyst actions qualify for the Catalyst tag

**Files:**
- Modify: `api/services/catalyst/tagging.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
from api.services.catalyst import tagging


def test_analyst_meta_tags_as_catalyst():
    c = {"gap_pct": 1.0, "vol_x": 1.0, "tweets": [], "rss": [],
         "analyst_meta": {"action": "upgrade", "firm": "MS"}}
    assert tagging.assign_tag(c) == "Catalyst"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_analyst_meta_tags_as_catalyst -v`
Expected: FAIL — returns `None` (no tweets/rss/earnings/gap).

- [ ] **Step 3: Implement**

In `tagging.assign_tag`, add an analyst clause at the same priority as the existing Catalyst rule (right after the Earnings check, before/with the `2+ tweets OR 1+ rss` Catalyst check). Concretely, change the Catalyst condition to also fire on `analyst_meta`:
```python
    # Catalyst: hard analyst action, or 2+ tweets, or 1+ RSS headline.
    if c.get("analyst_meta") or len(c.get("tweets", [])) >= 2 or len(c.get("rss", [])) >= 1:
        return "Catalyst"
```
(Leave the Earnings clause above it untouched so a reporting name still tags Earnings first.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_analyst_meta_tags_as_catalyst -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/tagging.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): analyst actions tag as Catalyst"
```

---

## Task 9: Analyst-action scoring bonus

**Files:**
- Modify: `api/services/catalyst/scoring.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
from api.services.catalyst import scoring


def test_analyst_action_scores_higher():
    base = {"gap_pct": 2.0, "vol_x": 1.0, "price": 50.0}
    with_analyst = {**base, "analyst_meta": {"action": "upgrade"}}
    assert scoring.score(with_analyst) > scoring.score(base)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_analyst_action_scores_higher -v`
Expected: FAIL — scores equal.

- [ ] **Step 3: Implement**

In `scoring.score`, before the penny penalties block, add:
```python
    # Analyst rating / PT change — a clean upgrade with a modest gap should
    # still rank against bigger pure-% movers.
    if c.get("analyst_meta"):
        s += _w("ANALYST_ACTION", 12.0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_analyst_action_scores_higher -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/scoring.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): score bonus for analyst actions"
```

---

## Task 10: Min-analyst reserve in selection

**Files:**
- Modify: `api/services/catalyst/selection.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
from api.services.catalyst import selection


def test_min_analyst_reserve_keeps_analyst_rows(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_ANALYST_ROWS", "2")
    # 25 high-score Catalyst rows with NO analyst_meta + 2 lower-score analyst rows.
    scored = [{"tag": "Catalyst", "score": 100 - i} for i in range(25)]
    scored += [{"tag": "Catalyst", "score": 1, "analyst_meta": {"action": "upgrade"}},
               {"tag": "Catalyst", "score": 2, "analyst_meta": {"action": "downgrade"}}]
    out = selection.select_top_12(scored)
    analyst_in = [c for c in out if c.get("analyst_meta")]
    assert len(analyst_in) >= 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_min_analyst_reserve_keeps_analyst_rows -v`
Expected: FAIL — low-score analyst rows pushed out by the 25 high-score rows.

- [ ] **Step 3: Implement**

At the end of `select_top_12`, before the final sort/return, add the reserve:
```python
    # Min-analyst reserve: guarantee a few analyst-driven rows survive even when
    # higher-scored pure movers fill the quotas. Never backfills junk — only
    # promotes analyst rows that already passed the gates + tagging.
    min_analyst = int(os.environ.get("CATALYST_MIN_ANALYST_ROWS", "2"))
    if min_analyst > 0:
        chosen_ids = {id(c) for c in selected}
        have = sum(1 for c in selected if c.get("analyst_meta"))
        if have < min_analyst:
            extra = sorted(
                [c for c in scored
                 if c.get("analyst_meta") and id(c) not in chosen_ids],
                key=lambda c: c.get("score", 0.0), reverse=True,
            )[: (min_analyst - have)]
            # Swap out the lowest-scored NON-analyst rows to make room.
            if extra:
                non_analyst = sorted(
                    [c for c in selected if not c.get("analyst_meta")],
                    key=lambda c: c.get("score", 0.0),
                )
                for new_row in extra:
                    if non_analyst:
                        drop = non_analyst.pop(0)
                        selected = [c for c in selected if id(c) != id(drop)]
                    selected.append(new_row)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_min_analyst_reserve_keeps_analyst_rows -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/selection.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): min-analyst reserve in selection"
```

---

## Task 11: Analyst block in the synthesis prompt + counts as a source

**Files:**
- Modify: `api/services/catalyst/synthesize.py`
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
from api.services.catalyst import synthesize


def test_prompt_includes_analyst_block():
    c = {"ticker": "AAA", "price": 50.0, "gap_pct": 3.0, "vol_x": 2.0,
         "analyst_meta": {"action": "upgrade", "firm": "Morgan Stanley",
                          "from_rating": "Hold", "to_rating": "Buy",
                          "price_target": "$120"}}
    prompt = synthesize.format_prompt(c)
    assert "Morgan Stanley" in prompt
    assert "Buy" in prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_prompt_includes_analyst_block -v`
Expected: FAIL — firm not in prompt.

- [ ] **Step 3: Implement**

Add a formatter near the other `_format_*_block` helpers:
```python
def _format_analyst_block(meta: Optional[dict]) -> str:
    if not meta:
        return "None"
    action = (meta.get("action") or "rating change").title()
    firm = meta.get("firm") or "an analyst"
    frm = meta.get("from_rating")
    to = meta.get("to_rating")
    pt = meta.get("price_target")
    parts = [f"{action} at {firm}"]
    if frm and to:
        parts.append(f"({frm} -> {to})")
    elif to:
        parts.append(f"to {to}")
    if pt:
        parts.append(f"PT {pt}")
    return "; ".join(parts)
```
(`Optional` is already imported in this module; if not, add `from typing import Optional`.)

In `format_prompt`, add a line to the SIGNALS section (after the UCT scanner line):
```python

Analyst action: {_format_analyst_block(c.get('analyst_meta'))}
```

Then make `analyst_meta` count as a real source so it doesn't trip the
"no clear catalyst" guard: in `synthesize_ticker`, find where `has_sources`
is computed (it ORs tweets/rss/earnings presence) and add the analyst term:
```python
    has_sources = bool(
        candidate.get("tweets") or candidate.get("rss")
        or candidate.get("earnings_meta") or candidate.get("scanner_setup")
        or candidate.get("analyst_meta")
    )
```
(Match the exact existing expression and add `or candidate.get("analyst_meta")`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_prompt_includes_analyst_block -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/synthesize.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): analyst context in synthesis prompt + counts as a source"
```

---

## Task 12: catalyst_at includes analyst ts + per-candidate Finnhub enrichment

**Files:**
- Modify: `api/services/catalyst/engine.py` (`_compute_catalyst_at` ~line 115; enrichment block ~line 651)
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_compute_catalyst_at_uses_analyst_ts():
    from api.services.catalyst import engine
    c = {"tweets": [], "rss": [], "earnings_meta": None,
         "analyst_meta": {"action": "upgrade", "at": 1_700_000_000}}
    assert engine._compute_catalyst_at(c) == 1_700_000_000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_compute_catalyst_at_uses_analyst_ts -v`
Expected: FAIL — returns None.

- [ ] **Step 3: Implement**

In `_compute_catalyst_at`, before `return min(candidates) if candidates else None`, add:
```python
    am = c.get("analyst_meta") or {}
    ats = am.get("at")
    if isinstance(ats, (int, float)) and ats > 0:
        candidates.append(int(ats))
```

Add a per-candidate Finnhub enrichment helper and call it in `run_refresh`. Helper (place near the other `_enrich_*` functions):
```python
def _enrich_with_analyst_actions(top: list[dict]) -> None:
    """For selected names lacking analyst_meta, check Finnhub for a recent
    upgrade/downgrade so analyst-driven gappers are explained even before the
    daily wire push lands. Bounded to the selected set; cached by Finnhub's own
    layer + the metadata day. Best-effort."""
    from api.services.catalyst.analyst_actions import finnhub_recent_action
    for c in top:
        if c.get("analyst_meta"):
            continue
        try:
            meta = finnhub_recent_action(c.get("ticker") or "")
        except Exception:
            meta = None
        if meta:
            c["analyst_meta"] = meta
```

In `run_refresh`, add the call right after `_enrich_with_twitter_search(top_12)`:
```python
    # Analyst-action enrichment: catch analyst-driven movers pre-wire-push.
    _enrich_with_analyst_actions(top_12)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_compute_catalyst_at_uses_analyst_ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/engine.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): analyst ts in catalyst_at + per-candidate finnhub enrichment"
```

---

## Task 13: Broaden the notable-move net (gap-scan caps)

**Files:**
- Modify: `api/services/catalyst/sources.py` (`_pull_gap_scan` ~line 582, 613)

- [ ] **Step 1: Implement (env-default change — coverage breadth)**

Raise the default caps so more notable movers reach the pool (the gate trims junk; selection still curates the tile). Change the two defaults:
```python
    max_names = int(_envf("CATALYST_GAPSCAN_MAX", 80))
```
```python
    top_gap_n = int(_envf("CATALYST_GAPSCAN_TOP_GAP", 25))
```

- [ ] **Step 2: Verify import**

Run: `python -c "import api.services.catalyst.sources"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add api/services/catalyst/sources.py
git commit -m "feat(catalyst): broaden gap-scan caps for fuller notable-move coverage"
```

---

## Task 14: Coverage audit — analyst-action net + sector breakdown

**Files:**
- Modify: `api/services/catalyst/coverage_audit.py` (`run_audit` ~line 99)
- Test: `tests/test_catalyst_coverage_precision.py`

- [ ] **Step 1: Write the failing test**

```python
def test_audit_grades_analyst_coverage(monkeypatch, tmp_path):
    db = tmp_path / "catalysts.db"
    monkeypatch.setenv("CATALYST_DB_PATH", str(db))
    import importlib
    from api.services.catalyst import store as store_mod
    importlib.reload(store_mod)
    store_mod._init_db()
    # One analyst name surfaced (ranked), one missed.
    store_mod.upsert_catalyst({
        "market_date": "2026-06-15", "ticker": "AAA", "rank": 1, "score": 50,
        "tag": "Catalyst", "price": 50, "gap_pct": 3, "vol_x": 2,
        "market_cap": 1e9, "sector": "Tech", "thesis_text": "x",
        "thesis_model": "m", "thesis_at": 1, "thesis_sources": "[]",
        "signals_hash": "h", "catalyst_at": None, "raw_signals": "{}",
    })
    monkeypatch.setattr(
        "api.services.catalyst.analyst_actions.get_analyst_candidates",
        lambda: {"AAA": {"action": "upgrade"}, "BBB": {"action": "downgrade"}},
    )
    from api.services.catalyst import coverage_audit
    importlib.reload(coverage_audit)
    rep = coverage_audit._grade_analyst_coverage("2026-06-15")
    assert rep["caught"] == 1 and "BBB" in [m["ticker"] for m in rep["missed"]]
    importlib.reload(store_mod)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_audit_grades_analyst_coverage -v`
Expected: FAIL — `_grade_analyst_coverage` does not exist.

- [ ] **Step 3: Implement**

Add a helper and fold it into `run_audit`'s report:
```python
def _grade_analyst_coverage(market_date: str) -> dict:
    """Diff today's market-wide analyst actions against what the engine touched.
    A 'missed' analyst name means the analyst source/enrichment didn't surface a
    rating change a trader would have seen."""
    from api.services.catalyst.analyst_actions import get_analyst_candidates
    from api.services.catalyst import store
    try:
        actions = get_analyst_candidates() or {}
    except Exception:
        actions = {}
    all_rows = {r["ticker"].upper(): r
                for r in store.get_for_date(market_date, ranked_only=False)}
    caught, missed = 0, []
    for sym in actions:
        if sym in all_rows:
            caught += 1
        else:
            missed.append({"ticker": sym, "action": actions[sym].get("action")})
    return {"total": len(actions), "caught": caught, "missed": missed}
```

In `run_audit`, after building `report` (before the DB write), add the analyst net + a sector breakdown of the movers:
```python
        try:
            report["analyst"] = _grade_analyst_coverage(market_date)
        except Exception:
            logger.debug("[catalyst-audit] analyst grading failed")
        # Sector breakdown of the ranked rows — surfaces a whole 'group move'
        # the tile may have under-represented (cheap; reuses stored sectors).
        try:
            sec_counts: dict[str, int] = {}
            for r in store.get_for_date(market_date, ranked_only=True):
                sec = r.get("sector") or "Unknown"
                sec_counts[sec] = sec_counts.get(sec, 0) + 1
            report["ranked_by_sector"] = sec_counts
        except Exception:
            logger.debug("[catalyst-audit] sector breakdown failed")
```
(`store` is already imported a few lines above in `run_audit`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py::test_audit_grades_analyst_coverage -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/coverage_audit.py tests/test_catalyst_coverage_precision.py
git commit -m "feat(catalyst): audit grades analyst coverage + sector breakdown"
```

---

## Task 15: Admin endpoint for gate rejections

**Files:**
- Modify: `api/routers/catalysts.py`
- Test: manual (admin-gated route)

- [ ] **Step 1: Implement**

Add near the other `/admin/catalyst-*` routes (follow the exact `require_admin` dependency pattern already used by `/admin/catalyst-stats` in this file):
```python
@router.get("/admin/catalyst-rejections")
def admin_catalyst_rejections(market_date: str | None = None,
                              _admin=Depends(require_admin)):
    """What the quality gate dropped — for evidence-based threshold tuning."""
    from api.services.catalyst import store
    return {
        "summary": store.rejection_summary(market_date),
        "rows": store.recent_rejections(limit=200, market_date=market_date),
    }
```
(Confirm `require_admin` + `Depends` are already imported in this file — they are, used by the existing admin routes. Match the existing decorator/return style.)

- [ ] **Step 2: Verify it imports + route registers**

Run: `python -c "import api.routers.catalysts"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add api/routers/catalysts.py
git commit -m "feat(catalyst): admin endpoint for gate rejections"
```

---

## Task 16: Full verification + deploy

**Files:** none (verification)

- [ ] **Step 1: Run the new test module**

Run: `python -m pytest tests/test_catalyst_coverage_precision.py -v`
Expected: all PASS.

- [ ] **Step 2: Run the full catalyst-related suite + import smoke**

Run: `python -m pytest tests/ -q -k "catalyst"` then `python -c "import api.main"`
Expected: green; no import errors.

- [ ] **Step 3: Frontend build sanity (no FE changes, but verify nothing broke shared)**

Run: `cd app && npm run build`
Expected: built successfully.

- [ ] **Step 4: Commit any final fixes, then push to master (Railway)**

```bash
git push origin master
```
(If rejected, `git pull --rebase origin master` then push — shared master with a partner.)

- [ ] **Step 5: Post-deploy validation (manual, on Railway)**

- Hit `POST /api/catalysts/refresh` (admin) to force a run.
- Check `GET /api/admin/catalyst-coverage?run=1` — read `missed` and the new `analyst` net; tune `CATALYST_*` env thresholds if misses appear.
- Check `GET /api/admin/catalyst-rejections` — confirm low-float/illiquid names are being dropped for the right reasons (tune `CATALYST_MIN_FLOAT` / `CATALYST_MIN_DOLLAR_VOL` from the evidence).
- User verifies the morning tile: analyst movers appear with firm/rating context; no untradeable junk.

---

## New env knobs (all safe defaults; tune live on Railway)

| Env | Default | Effect |
|-----|---------|--------|
| `CATALYST_MIN_FLOAT` | `5000000` | Float (or shares-outstanding) floor; fail-open when unknown |
| `CATALYST_SCORE_W_ANALYST_ACTION` | `12.0` | Score bonus for a rating/PT change |
| `CATALYST_MIN_ANALYST_ROWS` | `2` | Guaranteed analyst rows in the selected set |
| `CATALYST_GAPSCAN_MAX` | `80` (was 50) | Dollar-volume-ranked gappers admitted |
| `CATALYST_GAPSCAN_TOP_GAP` | `25` (was 15) | Biggest-absolute-gap names admitted regardless of $-vol rank |
| `THEFLY_API_KEY` | _(unset)_ | If present, adds TheFly market-wide analyst Squawk |
```
