# Charts Fundamentals Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `fundamentals` widget to the `/charts` workspace showing a MarketSurge-style annual EPS/Sales growth table (with forward analyst estimates + revision markers) and a quarterly actual-vs-estimate strip, kept accurate via tiered caching, an earnings-event fast-path, and an estimate-revision snapshot store.

**Architecture:** New self-contained React widget reads its color-group ticker and SWR-fetches one new backend endpoint `GET /api/fundamentals/earnings-table`. The endpoint orchestrates three data slices: quarterly actuals (reuse existing `get_year_earnings`), annual actuals + forward estimates (new `get_annual_financials`), and the next earnings date. A small SQLite store snapshots forward estimates over time to compute ▲/▼ "consensus raised/cut" markers. A gated daily warm job keeps snapshot history dense.

**Tech Stack:** FastAPI (Python), SQLite, yfinance / FMP / Finnhub / AlphaVantage providers, React + Vite + SWR, react-grid-layout, vitest + pytest.

## Global Constraints

- **Frontend is React + Vite SPA** — NO Next.js, ignore any "use client" suggestion.
- **Charts Hub V2 invariant:** widget-responsive CSS uses **`@container`** queries (root `.widgetBody` has `container-type: inline-size`), NEVER `@media`.
- **No generic emoji in UI** — ▲/▼ markers are styled glyphs/SVG, gold/green/red token palette.
- **Shared working tree:** a live parallel session co-edits this repo. Implement in an **isolated git worktree off `origin/master`** (per `superpowers:using-git-worktrees`). Never `git add -A`; stage explicit paths only. Ship via fast-forward `push origin <branch>:master`.
- **Provider cache is a process-global singleton** (`api.services.cache.cache`) — tests MUST use unique `ZZ...` ticker symbols (as the existing `tests/test_year_earnings_window.py` does) to avoid cross-test cache bleed.
- **Auth import:** `from api.middleware.auth_middleware import get_current_user`; used as `user: dict = Depends(get_current_user)`.
- **Run backend tests:** `python -m pytest <path> -v`. **Run frontend tests:** `cd app && npx vitest run <path>`. **Build check:** `cd app && npm run build`.
- Use **Opus 4.8** for any LLM calls (none in this feature).

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `api/services/fundamentals_estimates_store.py` | **New.** SQLite snapshot store for forward estimates + ▲/▼ revision computation. |
| `api/services/annual_financials.py` | **New.** `get_annual_financials()` — annual actuals (FMP→yf→quarter-rollup) + forward estimates (yf/FMP) + YoY% + revision markers. |
| `api/services/earnings_table.py` | **New.** `get_earnings_table()` orchestrator — combines annual + quarterly + next-earnings, picks TTL (tiered + earnings fast-path), caches the combined payload. |
| `api/routers/fundamentals.py` | **Modify.** Add `GET /api/fundamentals/earnings-table` ABOVE the `/{ticker}` wildcard route. |
| `api/main.py` | **Modify.** Add gated daily warm job (snapshot cadence). |
| `app/src/hooks/useEarningsTable.js` | **New.** SWR hook. |
| `app/src/pages/charts/widgets/FundamentalsWidget.jsx` | **New.** The widget. |
| `app/src/pages/charts/widgets/FundamentalsWidget.module.css` | **New.** Styles (`@container`). |
| `app/src/pages/charts/ChartsWorkspace.jsx` | **Modify.** Register defaults + Add-Widget menu item. |
| `app/src/pages/charts/WidgetHost.jsx` | **Modify.** Label + dispatch case. |
| `app/src/pages/charts/widgets/MobileWorkspace.jsx` | **Modify.** Include in mobile tab stack. |
| `tests/test_fundamentals_estimates_store.py` | **New.** Store + revision tests. |
| `tests/test_annual_financials.py` | **New.** Annual assembly tests. |
| `tests/test_earnings_table.py` | **New.** Orchestrator + TTL/fast-path tests. |
| `tests/test_earnings_table_router.py` | **New.** Endpoint tests. |
| `app/src/pages/charts/widgets/FundamentalsWidget.test.jsx` | **New.** Widget render tests. |

---

## Task 1: Estimate snapshot store

**Files:**
- Create: `api/services/fundamentals_estimates_store.py`
- Test: `tests/test_fundamentals_estimates_store.py`

**Interfaces:**
- Produces:
  - `record_snapshot(ticker: str, fiscal_year: int, eps_est: float | None, sales_est: float | None, now: float | None = None) -> None` — dedups to ≤1 row per (ticker, fiscal_year) per calendar day.
  - `revision_for(ticker: str, fiscal_year: int, eps_est: float | None, sales_est: float | None, now: float | None = None, lookback_days: int = 30) -> dict` — returns `{"eps": "up"|"down"|None, "sales": "up"|"down"|None}` comparing current estimate to the snapshot nearest `lookback_days` ago (None if no prior snapshot or change within ±0.5%).
  - `prune(now: float | None = None, max_age_days: int = 400) -> int` — deletes old snapshots, returns count removed.
  - `_db_path() -> str` — resolves `FUNDAMENTALS_ESTIMATES_DB_PATH` env each call (default `/data/fundamentals_estimates.db`, falling back to a local path when `/data` absent).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_fundamentals_estimates_store.py
import os
import importlib


def _fresh_store(tmp_path, monkeypatch):
    db = tmp_path / "est.db"
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(db))
    import api.services.fundamentals_estimates_store as s
    importlib.reload(s)  # re-resolve module-level state against the tmp db
    return s


def test_revision_none_without_history(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    rev = s.revision_for("ZZAAA", 2026, 3.15, 7.8e9, now=1_700_000_000.0)
    assert rev == {"eps": None, "sales": None}


def test_revision_up_when_estimate_raised(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    day = 86400.0
    base = 1_700_000_000.0
    # Snapshot 31 days ago at a lower estimate.
    s.record_snapshot("ZZAAA", 2026, eps_est=3.00, sales_est=7.0e9, now=base - 31 * day)
    rev = s.revision_for("ZZAAA", 2026, eps_est=3.15, sales_est=7.8e9, now=base, lookback_days=30)
    assert rev["eps"] == "up"
    assert rev["sales"] == "up"


def test_revision_down_when_estimate_cut(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    day = 86400.0
    base = 1_700_000_000.0
    s.record_snapshot("ZZAAA", 2026, eps_est=3.30, sales_est=8.0e9, now=base - 40 * day)
    rev = s.revision_for("ZZAAA", 2026, eps_est=3.15, sales_est=7.8e9, now=base, lookback_days=30)
    assert rev["eps"] == "down"
    assert rev["sales"] == "down"


def test_snapshot_dedups_per_day(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    base = 1_700_000_000.0
    s.record_snapshot("ZZBBB", 2026, 3.0, 7.0e9, now=base)
    s.record_snapshot("ZZBBB", 2026, 3.1, 7.1e9, now=base + 3600)  # same day → ignored
    assert s._count("ZZBBB", 2026) == 1
    s.record_snapshot("ZZBBB", 2026, 3.2, 7.2e9, now=base + 2 * 86400)  # 2 days later → kept
    assert s._count("ZZBBB", 2026) == 2


def test_prune_removes_old(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    base = 1_700_000_000.0
    s.record_snapshot("ZZCCC", 2026, 3.0, 7.0e9, now=base - 500 * 86400)
    s.record_snapshot("ZZCCC", 2026, 3.1, 7.1e9, now=base)
    removed = s.prune(now=base, max_age_days=400)
    assert removed == 1
    assert s._count("ZZCCC", 2026) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_fundamentals_estimates_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.fundamentals_estimates_store'`

- [ ] **Step 3: Write the store**

```python
# api/services/fundamentals_estimates_store.py
"""Forward-estimate snapshot store — powers the ▲/▼ "consensus raised/cut"
markers on the fundamentals widget. One row per (ticker, fiscal_year) per
calendar day; revision_for() compares the current estimate to the snapshot
nearest N days ago. Lazy-init, dashboard-owned SQLite (mirrors catalyst metadata DB)."""
from __future__ import annotations

import os
import sqlite3
import time
from contextlib import closing

_REVISION_EPS_TOL = 0.005  # ±0.5% — ignore noise below this as "flat"


def _db_path() -> str:
    p = os.environ.get("FUNDAMENTALS_ESTIMATES_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/fundamentals_estimates.db"
    # Local-dev fallback next to the repo working dir.
    return os.path.join(os.getcwd(), "fundamentals_estimates.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS estimate_snapshots (
                   ticker TEXT NOT NULL,
                   fiscal_year INTEGER NOT NULL,
                   eps_est REAL,
                   sales_est REAL,
                   captured_at REAL NOT NULL,
                   day_key TEXT NOT NULL,
                   PRIMARY KEY (ticker, fiscal_year, day_key)
               )"""
        )
        conn.commit()


def _day_key(now: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(now))


def record_snapshot(ticker, fiscal_year, eps_est, sales_est, now=None):
    now = time.time() if now is None else now
    _ensure_init()
    with closing(_connect()) as conn:
        conn.execute(
            """INSERT OR IGNORE INTO estimate_snapshots
                   (ticker, fiscal_year, eps_est, sales_est, captured_at, day_key)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ticker.upper(), int(fiscal_year), eps_est, sales_est, now, _day_key(now)),
        )
        conn.commit()


def _nearest_before(conn, ticker, fiscal_year, cutoff):
    row = conn.execute(
        """SELECT eps_est, sales_est FROM estimate_snapshots
               WHERE ticker=? AND fiscal_year=? AND captured_at<=?
               ORDER BY captured_at DESC LIMIT 1""",
        (ticker.upper(), int(fiscal_year), cutoff),
    ).fetchone()
    return row


def _dir(cur, old):
    if cur is None or old is None or old == 0:
        return None
    delta = (cur - old) / abs(old)
    if delta > _REVISION_EPS_TOL:
        return "up"
    if delta < -_REVISION_EPS_TOL:
        return "down"
    return None


def revision_for(ticker, fiscal_year, eps_est, sales_est, now=None, lookback_days=30):
    now = time.time() if now is None else now
    _ensure_init()
    cutoff = now - lookback_days * 86400
    with closing(_connect()) as conn:
        prior = _nearest_before(conn, ticker, fiscal_year, cutoff)
    if not prior:
        return {"eps": None, "sales": None}
    return {"eps": _dir(eps_est, prior[0]), "sales": _dir(sales_est, prior[1])}


def prune(now=None, max_age_days=400):
    now = time.time() if now is None else now
    _ensure_init()
    cutoff = now - max_age_days * 86400
    with closing(_connect()) as conn:
        cur = conn.execute("DELETE FROM estimate_snapshots WHERE captured_at < ?", (cutoff,))
        conn.commit()
        return cur.rowcount


def _count(ticker, fiscal_year):
    """Test helper — snapshot count for a (ticker, fiscal_year)."""
    _ensure_init()
    with closing(_connect()) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM estimate_snapshots WHERE ticker=? AND fiscal_year=?",
            (ticker.upper(), int(fiscal_year)),
        ).fetchone()[0]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_fundamentals_estimates_store.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add api/services/fundamentals_estimates_store.py tests/test_fundamentals_estimates_store.py
git commit -m "feat: forward-estimate snapshot store for revision markers"
```

---

## Task 2: Annual financials assembly

**Files:**
- Create: `api/services/annual_financials.py`
- Test: `tests/test_annual_financials.py`

**Interfaces:**
- Consumes: `fundamentals_estimates_store.record_snapshot` / `revision_for` (Task 1).
- Produces:
  - `get_annual_financials(ticker: str, years_back: int = 6, now: float | None = None) -> list[dict]` — rows sorted ascending by year, estimate rows last. Row shape: `{"year": int, "eps": float|None, "eps_chg_pct": float|None, "sales": float|None, "sales_chg_pct": float|None, "estimate": bool, "eps_revision": "up"|"down"|None, "sales_revision": "up"|"down"|None, "_source": str}`.
  - Mockable helpers (tests monkeypatch these, never the network): `_annual_actuals_from_fmp(ticker) -> dict[int, dict]`, `_annual_actuals_from_yf(ticker) -> dict[int, dict]`, `_annual_rollup_from_quarters(ticker, years) -> dict[int, dict]`, `_forward_estimates(ticker, now) -> list[dict]`. Each actuals helper returns `{year: {"eps": float|None, "sales": float|None}}`; `_forward_estimates` returns `[{"year": int, "eps": float|None, "sales": float|None}, ...]` for the current FY and next FY.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_annual_financials.py
import importlib


def _mod(monkeypatch, tmp_path):
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(tmp_path / "est.db"))
    import api.services.fundamentals_estimates_store as s
    importlib.reload(s)
    import api.services.annual_financials as af
    importlib.reload(af)
    return af, s


def test_yoy_pct_and_estimate_rows(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    # 2024 actual, 2025 actual, plus 2026e + 2027e estimates.
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {
        2024: {"eps": 2.00, "sales": 6.0e9},
        2025: {"eps": 2.50, "sales": 6.9e9},
    })
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [
        {"year": 2026, "eps": 3.00, "sales": 7.8e9},
        {"year": 2027, "eps": 3.30, "sales": 8.6e9},
    ])
    rows = af.get_annual_financials("ZZTKR", years_back=6, now=1_760_000_000.0)
    years = [r["year"] for r in rows]
    assert years == [2024, 2025, 2026, 2027]
    r25 = next(r for r in rows if r["year"] == 2025)
    assert r25["eps_chg_pct"] == 25  # (2.50-2.00)/2.00 = +25%
    assert r25["estimate"] is False
    r26 = next(r for r in rows if r["year"] == 2026)
    assert r26["estimate"] is True
    assert r26["eps_chg_pct"] == 20  # (3.00-2.50)/2.50 = +20%


def test_fmp_falls_back_to_rollup(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {
        2024: {"eps": 1.0, "sales": 1.0e9},
        2025: {"eps": 1.2, "sales": 1.1e9},
    })
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [])
    rows = af.get_annual_financials("ZZROLL", now=1_760_000_000.0)
    assert [r["year"] for r in rows] == [2024, 2025]
    assert rows[0]["_source"] == "rollup"


def test_estimate_revision_marker(monkeypatch, tmp_path):
    af, s = _mod(monkeypatch, tmp_path)
    day = 86400.0
    base = 1_760_000_000.0
    # A 31-day-old snapshot at a LOWER estimate → current read should mark "up".
    s.record_snapshot("ZZREV", 2026, eps_est=2.80, sales_est=7.0e9, now=base - 31 * day)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {2025: {"eps": 2.5, "sales": 6.9e9}})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [{"year": 2026, "eps": 3.00, "sales": 7.8e9}])
    rows = af.get_annual_financials("ZZREV", now=base)
    r26 = next(r for r in rows if r["year"] == 2026)
    assert r26["eps_revision"] == "up"


def test_empty_returns_empty(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [])
    assert af.get_annual_financials("ZZNADA", now=1_760_000_000.0) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_annual_financials.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.annual_financials'`

- [ ] **Step 3: Write the assembly**

```python
# api/services/annual_financials.py
"""Annual EPS/Sales history + forward analyst estimates for the fundamentals
widget. Actuals source chain: FMP stable/income-statement → yfinance annual
income_stmt → roll-up of get_year_earnings quarters. Forward estimates: yfinance
earnings_estimate/revenue_estimate (current FY + next FY). YoY % computed here;
▲/▼ revision markers from the snapshot store."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from api.services import earnings_estimates as ee
from api.services import fundamentals_estimates_store as store

_log = logging.getLogger(__name__)


def _pct_chg(cur, prev):
    try:
        c, p = float(cur), float(prev)
    except (TypeError, ValueError):
        return None
    if p == 0:
        return None
    return round((c - p) / abs(p) * 100)


# ── Actuals sources (mockable) ───────────────────────────────────────────────
def _annual_actuals_from_fmp(ticker: str) -> dict[int, dict]:
    """{year: {eps, sales}} from FMP stable/income-statement (annual)."""
    data = ee._fmp_get("/stable/income-statement", {"symbol": ticker, "limit": 12})
    out: dict[int, dict] = {}
    if isinstance(data, list):
        for row in data:
            try:
                y = int(str(row.get("date") or row.get("calendarYear") or "")[:4])
            except (TypeError, ValueError):
                continue
            eps = row.get("epsdiluted") if row.get("epsdiluted") is not None else row.get("eps")
            sales = row.get("revenue")
            if eps is None and sales is None:
                continue
            out[y] = {"eps": _num(eps), "sales": _num(sales)}
    return out


def _annual_actuals_from_yf(ticker: str) -> dict[int, dict]:
    """{year: {eps, sales}} from yfinance annual income statement (~4 fiscal years)."""
    try:
        import math
        import yfinance as yf
    except Exception:
        return {}
    try:
        t = yf.Ticker(ticker)
        df = getattr(t, "income_stmt", None)
        if df is None or getattr(df, "empty", True):
            return {}

        def _row(names):
            for n in names:
                if n in df.index:
                    return df.loc[n]
            return None

        rev = _row(["Total Revenue", "TotalRevenue", "Operating Revenue"])
        eps = _row(["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"])
        out: dict[int, dict] = {}
        for col in df.columns:
            try:
                y = int(col.year)
            except Exception:
                continue

            def _v(series):
                if series is None:
                    return None
                try:
                    fv = float(series.get(col))
                    return None if math.isnan(fv) else fv
                except Exception:
                    return None

            ev, sv = _v(eps), _v(rev)
            if ev is None and sv is None:
                continue
            out[y] = {"eps": ev, "sales": sv}
        return out
    except Exception as exc:
        _log.info("yfinance annual income_stmt failed for %s: %s", ticker, exc)
        return {}


def _annual_rollup_from_quarters(ticker: str, years: list[int]) -> dict[int, dict]:
    """{year: {eps, sales}} by summing get_year_earnings quarterly actuals.
    Last-resort; reuses the multi-source merged quarterly data."""
    out: dict[int, dict] = {}
    for y in years:
        rows = ee.get_year_earnings(ticker, y)
        eps_vals = [r.get("eps_actual") for r in rows if r.get("eps_actual") is not None]
        rev_vals = [r.get("revenue_actual") for r in rows if r.get("revenue_actual") is not None]
        if not eps_vals and not rev_vals:
            continue
        out[y] = {
            "eps": round(sum(eps_vals), 2) if eps_vals else None,
            "sales": sum(rev_vals) if rev_vals else None,
        }
    return out


# ── Forward estimates (mockable) ─────────────────────────────────────────────
def _forward_estimates(ticker: str, now: float) -> list[dict]:
    """Current FY (0y) + next FY (+1y) mean EPS & revenue from yfinance."""
    try:
        import yfinance as yf
    except Exception:
        return []
    cur_y = datetime.fromtimestamp(now, tz=timezone.utc).year
    out: list[dict] = []
    try:
        t = yf.Ticker(ticker)
        eps_df = getattr(t, "earnings_estimate", None)
        rev_df = getattr(t, "revenue_estimate", None)

        def _avg(df, idx):
            try:
                if df is None or idx not in df.index:
                    return None
                v = float(df.loc[idx].get("avg"))
                return v
            except Exception:
                return None

        mapping = [("0y", cur_y), ("+1y", cur_y + 1)]
        for idx, year in mapping:
            eps = _avg(eps_df, idx)
            sales = _avg(rev_df, idx)
            if eps is None and sales is None:
                continue
            out.append({"year": year, "eps": eps, "sales": sales})
    except Exception as exc:
        _log.info("yfinance forward estimates failed for %s: %s", ticker, exc)
    return out


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def get_annual_financials(ticker: str, years_back: int = 6, now: float | None = None) -> list[dict]:
    now = time.time() if now is None else now
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return []
    cur_y = datetime.fromtimestamp(now, tz=timezone.utc).year

    # 1. Actuals — FMP, then yfinance fills gaps, then quarter roll-up fills the rest.
    actuals = dict(_annual_actuals_from_fmp(ticker))
    source = "fmp" if actuals else None
    yf_a = _annual_actuals_from_yf(ticker)
    for y, v in yf_a.items():
        if y not in actuals:
            actuals[y] = v
            source = source or "yfinance"
    wanted = list(range(cur_y - years_back, cur_y))
    missing = [y for y in wanted if y not in actuals]
    if missing:
        roll = _annual_rollup_from_quarters(ticker, missing)
        for y, v in roll.items():
            actuals.setdefault(y, v)
        if roll and source is None:
            source = "rollup"

    # Keep only closed years in the wanted window, ascending.
    actual_years = sorted(y for y in actuals if y < cur_y and y >= cur_y - years_back)

    # 2. Forward estimates (current FY + next FY).
    fwd = _forward_estimates(ticker, now)

    if not actual_years and not fwd:
        return []

    rows: list[dict] = []
    prev = None
    for y in actual_years:
        v = actuals[y]
        row = {
            "year": y, "eps": v.get("eps"), "sales": v.get("sales"),
            "eps_chg_pct": _pct_chg(v.get("eps"), prev.get("eps")) if prev else None,
            "sales_chg_pct": _pct_chg(v.get("sales"), prev.get("sales")) if prev else None,
            "estimate": False, "eps_revision": None, "sales_revision": None,
            "_source": source or "unknown",
        }
        rows.append(row)
        prev = v

    for est in fwd:
        rev = store.revision_for(ticker, est["year"], est.get("eps"), est.get("sales"), now=now)
        store.record_snapshot(ticker, est["year"], est.get("eps"), est.get("sales"), now=now)
        row = {
            "year": est["year"], "eps": est.get("eps"), "sales": est.get("sales"),
            "eps_chg_pct": _pct_chg(est.get("eps"), prev.get("eps")) if prev else None,
            "sales_chg_pct": _pct_chg(est.get("sales"), prev.get("sales")) if prev else None,
            "estimate": True,
            "eps_revision": rev.get("eps"), "sales_revision": rev.get("sales"),
            "_source": "estimate",
        }
        rows.append(row)
        prev = est

    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_annual_financials.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add api/services/annual_financials.py tests/test_annual_financials.py
git commit -m "feat: annual financials assembly (actuals chain + forward estimates + revisions)"
```

---

## Task 3: Earnings-table orchestrator (quarterly strip + tiered TTL + fast-path)

**Files:**
- Create: `api/services/earnings_table.py`
- Test: `tests/test_earnings_table.py`

**Interfaces:**
- Consumes: `annual_financials.get_annual_financials` (Task 2); `earnings_estimates.get_year_earnings`, `earnings_estimates.get_earnings_intel`, `earnings_estimates._fh_get` (existing).
- Produces:
  - `get_earnings_table(ticker: str, now: float | None = None, debug: bool = False) -> dict` — `{"ticker", "annual": [...], "quarterly": [...]}` (+ `"_sources"` when `debug`). Caches the combined payload at the TTL chosen by `_choose_ttl`.
  - `_build_quarterly(ticker, now) -> list[dict]` — last 5 reported quarters + the next (unreported) earnings row. Reported row: `{"label": "2025 Q2", "eps_actual", "eps_estimate", "eps_surprise_pct", "rev_actual", "rev_estimate", "rev_surprise_pct", "reported": True}`. Next row: `{"label": "2026 Q2", "report_date": "2026-08-05", "eps_estimate", "eps_est_chg_pct", "rev_est_chg_pct", "reported": False}`.
  - `_next_earnings(ticker) -> dict | None` — `{"date": "YYYY-MM-DD", "eps_estimate": float|None, "rev_estimate": float|None}` from Finnhub `/calendar/earnings`.
  - `_choose_ttl(ticker, now) -> int` — seconds; `_FAST_TTL` (900) when within the earnings window, else `_SLOW_TTL` (21600).
  - `_in_earnings_window(next_date: str | None, last_report: str | None, now: float) -> bool` — True if today is within ±1 day of `next_date` OR within +2 days after `last_report`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_earnings_table.py
import importlib


def _mod(monkeypatch, tmp_path):
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(tmp_path / "est.db"))
    import api.services.earnings_table as et
    importlib.reload(et)
    return et


def test_in_window_pre_and_post(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    # base = 2026-08-05 00:00 UTC
    import calendar, time
    base = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    assert et._in_earnings_window("2026-08-05", None, base) is True        # day-of
    assert et._in_earnings_window("2026-08-06", None, base) is True        # day before
    assert et._in_earnings_window("2026-09-20", None, base) is False       # far future
    assert et._in_earnings_window(None, "2026-08-04", base) is True        # day after report
    assert et._in_earnings_window(None, "2026-07-01", base) is False       # old report


def test_choose_ttl(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import calendar, time
    base = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    monkeypatch.setattr(et, "_next_earnings", lambda t: {"date": "2026-08-05", "eps_estimate": 0.58, "rev_estimate": 1.85e9})
    monkeypatch.setattr(et, "_last_report_date", lambda t: None)
    assert et._choose_ttl("ZZW", base) == et._FAST_TTL
    monkeypatch.setattr(et, "_next_earnings", lambda t: {"date": "2026-12-01", "eps_estimate": None, "rev_estimate": None})
    assert et._choose_ttl("ZZW", base) == et._SLOW_TTL


def test_build_quarterly_takes_last_five_plus_next(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_year(ticker, year):
        # Return 4 reported quarters per requested year.
        return [{"label": None, "quarter": q, "year": year, "date": f"{year}-0{q}-15",
                 "eps_actual": q + 0.0, "eps_estimate": q - 0.1, "eps_surprise_pct": 5.0,
                 "revenue_actual": 1e9 * q, "revenue_estimate": 0.9e9 * q, "revenue_surprise_pct": 4.0}
                for q in (1, 2, 3, 4)]

    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    monkeypatch.setattr(etmod, "_next_earnings", lambda t: {"date": "2026-08-05", "eps_estimate": 0.58, "rev_estimate": 1.85e9})
    import calendar, time
    now = calendar.timegm(time.strptime("2026-07-01", "%Y-%m-%d"))
    q = et._build_quarterly("ZZQ", now)
    reported = [r for r in q if r["reported"]]
    nxt = [r for r in q if not r["reported"]]
    assert len(reported) == 5      # last 5 of the 8 returned
    assert len(nxt) == 1
    assert nxt[0]["report_date"] == "2026-08-05"
    assert reported[-1]["label"]   # labels are filled, e.g. "2026 Q2"


def test_get_earnings_table_shape(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now: [{"label": "2025 Q4", "reported": True}])
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [{"year": 2025, "estimate": False}])
    monkeypatch.setattr(et, "_choose_ttl", lambda t, now: 60)
    out = et.get_earnings_table("ZZTBL", now=1_760_000_000.0, debug=True)
    assert out["ticker"] == "ZZTBL"
    assert out["annual"] and out["quarterly"]
    assert "_sources" in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_earnings_table.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.earnings_table'`

- [ ] **Step 3: Write the orchestrator**

```python
# api/services/earnings_table.py
"""Orchestrates the fundamentals widget payload: annual table (annual_financials)
+ quarterly strip (get_year_earnings) + next earnings date. Picks a cache TTL
that collapses to 15 min around a ticker's earnings (the event fast-path)."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from api.services import earnings_estimates as ee
from api.services.annual_financials import get_annual_financials
from api.services.cache import cache

_log = logging.getLogger(__name__)

_FAST_TTL = 900       # 15 min — within the earnings window
_SLOW_TTL = 21_600    # 6 h — normal cadence

# Indirection so tests can monkeypatch the annual builder by name.
get_annual_financials_fn = get_annual_financials

_Q_LABEL = lambda year, q: f"{year} Q{q}"


def _parse_date(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _in_earnings_window(next_date, last_report, now, days=1):
    nowdt = datetime.fromtimestamp(now, tz=timezone.utc)
    nd = _parse_date(next_date)
    if nd is not None and abs((nd - nowdt).days) <= days:
        return True
    lr = _parse_date(last_report)
    if lr is not None and 0 <= (nowdt - lr).days <= days + 1:
        return True
    return False


def _next_earnings(ticker):
    """Upcoming earnings date + consensus from Finnhub /calendar/earnings."""
    from datetime import date, timedelta
    today = date.today()
    to = today + timedelta(days=120)
    data = ee._fh_get("/calendar/earnings",
                      {"symbol": ticker, "from": today.isoformat(), "to": to.isoformat()})
    rows = (data or {}).get("earningsCalendar") if isinstance(data, dict) else None
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: str(r.get("date") or ""))
    nxt = rows[0]
    return {
        "date": str(nxt.get("date") or "")[:10] or None,
        "eps_estimate": nxt.get("epsEstimate"),
        "rev_estimate": nxt.get("revenueEstimate"),
    }


def _last_report_date(ticker):
    intel = ee.get_earnings_intel(ticker) or {}
    hist = intel.get("beat_history") or []
    dates = [h.get("period") for h in hist if h.get("period")]
    return max(dates) if dates else None


def _choose_ttl(ticker, now):
    try:
        nxt = _next_earnings(ticker)
    except Exception:
        nxt = None
    try:
        last = _last_report_date(ticker)
    except Exception:
        last = None
    nd = nxt.get("date") if nxt else None
    return _FAST_TTL if _in_earnings_window(nd, last, now) else _SLOW_TTL


def _build_quarterly(ticker, now):
    cur_y = datetime.fromtimestamp(now, tz=timezone.utc).year
    reported = []
    for y in (cur_y - 1, cur_y):
        for r in ee.get_year_earnings(ticker, y):
            if r.get("eps_actual") is None and r.get("revenue_actual") is None:
                continue
            reported.append({
                "label": _Q_LABEL(r.get("year"), r.get("quarter")),
                "_sort": (r.get("year") or 0, r.get("quarter") or 0),
                "eps_actual": r.get("eps_actual"),
                "eps_estimate": r.get("eps_estimate"),
                "eps_surprise_pct": r.get("eps_surprise_pct"),
                "rev_actual": r.get("revenue_actual"),
                "rev_estimate": r.get("revenue_estimate"),
                "rev_surprise_pct": r.get("revenue_surprise_pct"),
                "reported": True,
            })
    reported.sort(key=lambda r: r["_sort"])
    last5 = reported[-5:]
    for r in last5:
        r.pop("_sort", None)

    out = list(last5)
    try:
        nxt = _next_earnings(ticker)
    except Exception:
        nxt = None
    if nxt and nxt.get("date"):
        nd = _parse_date(nxt["date"])
        q = (nd.month - 1) // 3 + 1 if nd else None
        out.append({
            "label": _Q_LABEL(nd.year, q) if nd else None,
            "report_date": nxt["date"],
            "eps_estimate": nxt.get("eps_estimate"),
            "rev_estimate": nxt.get("rev_estimate"),
            "eps_est_chg_pct": None,
            "rev_est_chg_pct": None,
            "reported": False,
        })
    return out


def get_earnings_table(ticker, now=None, debug=False):
    now = time.time() if now is None else now
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"ticker": "", "annual": [], "quarterly": []}

    ckey = f"earnings_table::{ticker}"
    if not debug:
        hit = cache.get(ckey)
        if hit is not None:
            return hit

    annual = get_annual_financials_fn(ticker, now=now)
    quarterly = _build_quarterly(ticker, now)
    result = {"ticker": ticker, "annual": annual, "quarterly": quarterly}
    if debug:
        result["_sources"] = {
            "annual": (annual[0].get("_source") if annual else None),
            "quarterly": "get_year_earnings",
        }
        return result

    ttl = _choose_ttl(ticker, now)
    cache.set(ckey, result, ttl)
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_earnings_table.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add api/services/earnings_table.py tests/test_earnings_table.py
git commit -m "feat: earnings-table orchestrator with tiered TTL + earnings fast-path"
```

---

## Task 4: Router endpoint

**Files:**
- Modify: `api/routers/fundamentals.py` (add the new route ABOVE the `/{ticker}` wildcard at line ~52)
- Test: `tests/test_earnings_table_router.py`

**Interfaces:**
- Consumes: `earnings_table.get_earnings_table` (Task 3); `get_current_user` auth dep.
- Produces: `GET /api/fundamentals/earnings-table?sym=AAPL[&debug=1]` → the orchestrator payload. Empty/unknown ticker → `{"ticker": "...", "annual": [], "quarterly": []}` (never 500).

**CRITICAL — route ordering:** FastAPI matches in declaration order. The static `earnings-table` route MUST be declared BEFORE `@router.get("/api/fundamentals/{ticker}")`, or `{ticker}` captures the literal string `earnings-table` (the same gotcha noted for journal `/psychology` before `/{entry_id}`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_earnings_table_router.py
from fastapi.testclient import TestClient
import api.routers.fundamentals as fr
from api.middleware.auth_middleware import get_current_user
from fastapi import FastAPI


def _client(monkeypatch):
    app = FastAPI()
    app.include_router(fr.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "t@t.dev"}
    return TestClient(app)


def test_requires_auth():
    app = FastAPI()
    app.include_router(fr.router)
    c = TestClient(app)
    # No override → dependency runs for real; unauthenticated should be 401/403.
    r = c.get("/api/fundamentals/earnings-table?sym=AAPL")
    assert r.status_code in (401, 403)


def test_happy_path(monkeypatch):
    monkeypatch.setattr(fr, "get_earnings_table",
                        lambda sym, debug=False: {"ticker": sym.upper(), "annual": [{"year": 2025}], "quarterly": [{"label": "2025 Q4"}]})
    c = _client(monkeypatch)
    r = c.get("/api/fundamentals/earnings-table?sym=aapl")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "AAPL"
    assert body["annual"] and body["quarterly"]


def test_unknown_ticker_returns_empty_not_500(monkeypatch):
    monkeypatch.setattr(fr, "get_earnings_table",
                        lambda sym, debug=False: {"ticker": sym.upper(), "annual": [], "quarterly": []})
    c = _client(monkeypatch)
    r = c.get("/api/fundamentals/earnings-table?sym=ZZNOPE")
    assert r.status_code == 200
    assert r.json()["annual"] == []


def test_debug_flag_passes_through(monkeypatch):
    seen = {}
    def fake(sym, debug=False):
        seen["debug"] = debug
        return {"ticker": sym, "annual": [], "quarterly": [], "_sources": {}}
    monkeypatch.setattr(fr, "get_earnings_table", fake)
    c = _client(monkeypatch)
    r = c.get("/api/fundamentals/earnings-table?sym=AAPL&debug=1")
    assert r.status_code == 200
    assert seen["debug"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_earnings_table_router.py -v`
Expected: FAIL (route not found → 404, or import error for `get_earnings_table`)

- [ ] **Step 3: Add the route**

In `api/routers/fundamentals.py`, add imports near the top (after the existing imports, line ~18):

```python
from fastapi import APIRouter, Depends, Query
from api.middleware.auth_middleware import get_current_user
from api.services.earnings_table import get_earnings_table
```

(If `from fastapi import APIRouter` already exists, replace it with the line above so `Depends`/`Query` are imported.)

Then insert this route **immediately above** `@router.get("/api/fundamentals/{ticker}")` (line ~52):

```python
@router.get("/api/fundamentals/earnings-table")
def get_earnings_table_endpoint(
    sym: str = Query(...),
    debug: int = Query(0),
    user: dict = Depends(get_current_user),
):
    """Annual EPS/Sales table + quarterly actual-vs-estimate strip for `sym`.
    Null-safe: unknown ticker returns empty arrays, never 500."""
    s = (sym or "").upper().strip()
    if not s:
        return {"ticker": "", "annual": [], "quarterly": []}
    try:
        return get_earnings_table(s, debug=bool(debug))
    except Exception as e:
        _log.warning("earnings-table failed for %s: %s", s, e)
        return {"ticker": s, "annual": [], "quarterly": []}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_earnings_table_router.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Run the full new backend suite + commit**

Run: `python -m pytest tests/test_fundamentals_estimates_store.py tests/test_annual_financials.py tests/test_earnings_table.py tests/test_earnings_table_router.py -v`
Expected: PASS (all)

```bash
git add api/routers/fundamentals.py tests/test_earnings_table_router.py
git commit -m "feat: GET /api/fundamentals/earnings-table endpoint"
```

---

## Task 5: Daily warm job (gated)

**Files:**
- Modify: `api/main.py` (add a scheduled job next to the COT/Twitter/Catalyst APScheduler blocks)

**Interfaces:**
- Consumes: `earnings_table.get_earnings_table`, `fundamentals_estimates_store.prune`.
- Produces: a once-daily job that warms the earnings table (and thus records estimate snapshots) for today's/tomorrow's reporters + watchlist/flagged/UCT20 tickers, gated by `FUNDAMENTALS_WARM_ENABLED`.

- [ ] **Step 1: Locate the scheduler block**

Run: `grep -n "CATALYST_ENGINE_ENABLED\|add_job\|AsyncIOScheduler\|BackgroundScheduler" api/main.py | head -30`
Expected: shows the existing scheduler instance variable (e.g. `scheduler`) and the gated `add_job(...)` blocks for COT/Twitter/Catalyst. Note the scheduler variable name and the import style for `CronTrigger`.

- [ ] **Step 2: Add the warm function + gated job**

Add this module-level function in `api/main.py` (near the other job callables):

```python
def _fundamentals_warm_job():
    """Daily: warm the earnings table for the day's reporters + user-tracked
    tickers so estimate snapshots accrue (keeps ▲/▼ revision markers accurate)
    and those stocks are pre-fresh during earnings season. Best-effort; never raises."""
    import logging
    log = logging.getLogger("fundamentals.warm")
    try:
        from api.services.earnings_table import get_earnings_table
        from api.services import fundamentals_estimates_store as store
        import time as _t

        syms: set[str] = set()
        # User-tracked tickers (watchlists + flagged), best-effort.
        try:
            from api.services.watchlist_service import all_tracked_symbols  # if available
            syms.update(all_tracked_symbols())
        except Exception:
            pass
        # UCT20 + today's reporters via the engine, best-effort.
        try:
            from api.services import engine
            lead = engine.get_leadership() or []
            syms.update((row.get("symbol") or row.get("ticker") or "").upper() for row in lead)
        except Exception:
            pass

        syms = {s for s in syms if s}
        log.info("fundamentals warm: %d tickers", len(syms))
        for s in sorted(syms):
            try:
                get_earnings_table(s)
            except Exception as e:
                log.debug("warm %s failed: %s", s, e)
            _t.sleep(0.25)  # polite to yfinance/FMP
        try:
            store.prune()
        except Exception:
            pass
    except Exception as e:
        log.warning("fundamentals warm job crashed: %s", e)
```

Then, inside the lifespan/startup where the other gated jobs are added (use the same scheduler variable + `CronTrigger` import the file already uses), add:

```python
    if os.environ.get("FUNDAMENTALS_WARM_ENABLED") == "1":
        scheduler.add_job(
            _fundamentals_warm_job,
            CronTrigger(hour=5, minute=30, timezone="America/New_York"),
            id="fundamentals_warm",
            replace_existing=True,
        )
```

> If `all_tracked_symbols` / `get_leadership` signatures differ in this codebase, adjust the symbol-gathering to whatever returns a list of tickers — the job is intentionally best-effort and the gather block is wrapped in try/except. The widget works fully without this job (load-driven freshness still covers every stock); the job only densifies snapshot history.

- [ ] **Step 3: Verify the app still imports/boots**

Run: `python -c "import api.main"`
Expected: no exception (import succeeds).

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat: gated daily fundamentals warm job (densifies estimate snapshots)"
```

---

## Task 6: SWR hook

**Files:**
- Create: `app/src/hooks/useEarningsTable.js`

**Interfaces:**
- Produces: `useEarningsTable(ticker)` → SWR result whose `data` is `{ticker, annual, quarterly}` or `null`. Polls every 5 min (backend owns freshness).

- [ ] **Step 1: Write the hook**

```js
// app/src/hooks/useEarningsTable.js
// SWR hook: GET /api/fundamentals/earnings-table?sym=TICKER
// Returns { ticker, annual: [...], quarterly: [...] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useEarningsTable(ticker) {
  return useSWR(
    ticker ? `/api/fundamentals/earnings-table?sym=${encodeURIComponent(ticker)}` : null,
    fetcher,
    { refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false },
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/hooks/useEarningsTable.js
git commit -m "feat: useEarningsTable SWR hook"
```

---

## Task 7: FundamentalsWidget component

**Files:**
- Create: `app/src/pages/charts/widgets/FundamentalsWidget.jsx`
- Create: `app/src/pages/charts/widgets/FundamentalsWidget.module.css`
- Test: `app/src/pages/charts/widgets/FundamentalsWidget.test.jsx`

**Interfaces:**
- Consumes: `useWorkspace()` (from `../WorkspaceContext`) for `groupSyms`; `useEarningsTable` (Task 6).
- Produces: `<FundamentalsWidget color={color} opts={opts} />` — renders the annual table + quarterly strip for `groupSyms[color]`.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/charts/widgets/FundamentalsWidget.test.jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import FundamentalsWidget from './FundamentalsWidget'

const mockData = vi.fn()
vi.mock('../../../hooks/useEarningsTable', () => ({
  default: () => ({ data: mockData() }),
}))

function Wrap({ color = 'A', sym = 'AAPL' }) {
  const groupSyms = { A: null, B: null, C: null, D: null, [color]: sym }
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders annual rows and quarterly blocks', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    annual: [
      { year: 2024, eps: 2.37, eps_chg_pct: 45, sales: 6.0e9, sales_chg_pct: 12, estimate: false },
      { year: 2026, eps: 3.15, eps_chg_pct: 14, sales: 7.8e9, sales_chg_pct: 15, estimate: true, eps_revision: 'up' },
    ],
    quarterly: [
      { label: '2025 Q2', eps_actual: 0.64, eps_estimate: 0.57, eps_surprise_pct: 12, rev_actual: 1.63e9, rev_estimate: 1.43e9, rev_surprise_pct: 14, reported: true },
      { label: '2026 Q2', report_date: '2026-08-05', eps_estimate: 0.58, reported: false },
    ],
  })
  render(<Wrap />)
  expect(screen.getByText('2024')).toBeInTheDocument()
  expect(screen.getByText('2026 e')).toBeInTheDocument()   // estimate-year suffix
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
})

test('shows pick-a-ticker prompt when no symbol', () => {
  mockData.mockReturnValue(null)
  const groupSyms = { A: null, B: null, C: null, D: null }
  render(
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color="A" opts={{}} />
    </WorkspaceContext.Provider>,
  )
  expect(screen.getByText(/pick a ticker/i)).toBeInTheDocument()
})

test('shows empty state when data has no rows', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', annual: [], quarterly: [] })
  render(<Wrap sym="ZZ" />)
  expect(screen.getByText(/no fundamentals/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/charts/widgets/FundamentalsWidget.test.jsx`
Expected: FAIL (cannot resolve `./FundamentalsWidget`)

- [ ] **Step 3: Write the component**

```jsx
// app/src/pages/charts/widgets/FundamentalsWidget.jsx
import { useWorkspace } from '../WorkspaceContext'
import useEarningsTable from '../../../hooks/useEarningsTable'
import styles from './FundamentalsWidget.module.css'

function fmtSales(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v}`
}
function fmtEps(v) { return v == null ? '—' : v.toFixed(2) }
function fmtPct(v) { return v == null ? '' : `${v > 0 ? '+' : ''}${v}%` }
function pctClass(v) { return v == null ? '' : v >= 0 ? styles.pos : styles.neg }

function RevisionMark({ dir }) {
  if (dir === 'up') return <span className={`${styles.rev} ${styles.revUp}`} aria-label="estimate raised">▲</span>
  if (dir === 'down') return <span className={`${styles.rev} ${styles.revDown}`} aria-label="estimate cut">▼</span>
  return null
}

function AnnualTable({ rows }) {
  if (!rows?.length) return null
  return (
    <table className={styles.annual}>
      <thead>
        <tr>
          <th className={styles.left}>Year</th>
          <th>EPS</th><th>% Chg</th>
          <th>Sales</th><th>% Chg</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.year} className={r.estimate ? styles.estRow : ''}>
            <td className={styles.left}>{r.year}{r.estimate ? ' e' : ''}</td>
            <td>{fmtEps(r.eps)}</td>
            <td className={pctClass(r.eps_chg_pct)}>{fmtPct(r.eps_chg_pct)}<RevisionMark dir={r.eps_revision} /></td>
            <td>{fmtSales(r.sales)}</td>
            <td className={pctClass(r.sales_chg_pct)}>{fmtPct(r.sales_chg_pct)}<RevisionMark dir={r.sales_revision} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QuarterBlock({ q }) {
  if (!q.reported) {
    return (
      <div className={`${styles.qBlock} ${styles.qNext}`}>
        <div className={styles.qLabel}>{q.label || 'Next'}</div>
        <div className={styles.qNextDate}>{q.report_date}</div>
        <div className={styles.qRow}><span>EPS Est.</span> <span className={styles.pos}>{q.eps_estimate ?? '—'}</span></div>
        <div className={styles.qRow}><span>Sales Est.</span> <span className={styles.pos}>{fmtSales(q.rev_estimate)}</span></div>
      </div>
    )
  }
  return (
    <div className={styles.qBlock}>
      <div className={styles.qLabel}>{q.label}</div>
      <div className={styles.qRow}>
        <span>{fmtEps(q.eps_actual)}</span> vs <span>{fmtEps(q.eps_estimate)}</span>
        <span className={pctClass(q.eps_surprise_pct)}>{fmtPct(q.eps_surprise_pct)}</span>
      </div>
      <div className={styles.qRow}>
        <span>{fmtSales(q.rev_actual)}</span> vs <span>{fmtSales(q.rev_estimate)}</span>
        <span className={pctClass(q.rev_surprise_pct)}>{fmtPct(q.rev_surprise_pct)}</span>
      </div>
    </div>
  )
}

export default function FundamentalsWidget({ color }) {
  const { groupSyms } = useWorkspace()
  const sym = groupSyms?.[color] || null
  const { data } = useEarningsTable(sym)

  if (!sym) return <div className={styles.hint}>Pick a ticker (link this widget to a chart by color).</div>
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  const hasAnnual = data.annual?.length
  const hasQ = data.quarterly?.length
  if (!hasAnnual && !hasQ) return <div className={styles.hint}>No fundamentals for {sym}.</div>

  return (
    <div className={styles.root}>
      {hasAnnual ? <AnnualTable rows={data.annual} /> : null}
      {hasQ ? (
        <div className={styles.qStrip}>
          {data.quarterly.map((q, i) => <QuarterBlock key={q.label || i} q={q} />)}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Write the CSS**

```css
/* app/src/pages/charts/widgets/FundamentalsWidget.module.css */
.root { height: 100%; overflow: auto; padding: 8px 10px; font-size: 13px; color: var(--color-text, #e6e6e6); }
.hint { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-muted, #8a8a8a); padding: 16px; text-align: center; }

.annual { width: 100%; border-collapse: collapse; }
.annual th { text-align: right; font-weight: 600; color: var(--color-text-muted, #9a9a9a); padding: 4px 6px; border-bottom: 1px solid var(--color-border, #2a2a2a); }
.annual td { text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--color-border-subtle, #1d1d1d); font-variant-numeric: tabular-nums; }
.left { text-align: left !important; }
.estRow td { color: var(--color-text-muted, #b8b8b8); font-style: italic; }

.pos { color: var(--color-success, #36c46a); }
.neg { color: var(--color-danger, #e5534b); }
.rev { font-size: 9px; margin-left: 3px; vertical-align: middle; }
.revUp { color: var(--color-success, #36c46a); }
.revDown { color: var(--color-danger, #e5534b); }

.qStrip { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.qBlock { flex: 1 1 120px; min-width: 110px; border: 1px solid var(--color-border, #2a2a2a); border-radius: 6px; padding: 6px 8px; }
.qNext { border-color: var(--color-gold, #c9a84c); }
.qLabel { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
.qNextDate { color: var(--color-gold, #c9a84c); font-size: 11px; margin-bottom: 4px; }
.qRow { display: flex; gap: 6px; align-items: baseline; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Container-query collapse: hide the oldest quarter blocks as the WIDGET narrows
   (root is inside .widgetBody which is container-type: inline-size). */
@container (max-width: 520px) { .qBlock:nth-last-child(n+5) { display: none; } }
@container (max-width: 380px) { .qBlock:nth-last-child(n+4) { display: none; } }
@container (max-width: 280px) { .qBlock:nth-last-child(n+3) { display: none; } }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/charts/widgets/FundamentalsWidget.test.jsx`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/charts/widgets/FundamentalsWidget.jsx app/src/pages/charts/widgets/FundamentalsWidget.module.css app/src/pages/charts/widgets/FundamentalsWidget.test.jsx
git commit -m "feat: FundamentalsWidget (annual table + quarterly strip)"
```

---

## Task 8: Wire the widget into the workspace

**Files:**
- Modify: `app/src/pages/charts/ChartsWorkspace.jsx` (`WIDGET_DEFAULTS` + Add-Widget menu array)
- Modify: `app/src/pages/charts/WidgetHost.jsx` (`TYPE_LABEL` + dispatch case)
- Modify: `app/src/pages/charts/widgets/MobileWorkspace.jsx` (`TYPE_LABEL` + `ADD_TYPES`)

**Interfaces:**
- Consumes: `FundamentalsWidget` (Task 7).

- [ ] **Step 1: ChartsWorkspace — register defaults + menu item**

In `app/src/pages/charts/ChartsWorkspace.jsx`, add to `WIDGET_DEFAULTS` (after the `scanner` entry, line ~32):

```js
  fundamentals: { w: 4, h: 10, minW: 3, minH: 5 },
```

And change the Add-Widget menu type array (line ~262) from:

```js
                {['chart', 'watchlist', 'themes', 'scanner'].map(t => (
```

to:

```js
                {['chart', 'watchlist', 'themes', 'scanner', 'fundamentals'].map(t => (
```

- [ ] **Step 2: WidgetHost — label + dispatch**

In `app/src/pages/charts/WidgetHost.jsx`, add the import (line ~4):

```js
import FundamentalsWidget from './widgets/FundamentalsWidget'
```

Add to `TYPE_LABEL`:

```js
  fundamentals: 'Fundamentals',
```

Add to the `WidgetBody` switch (after the `scanner` case):

```js
    case 'fundamentals': return <FundamentalsWidget color={widget.color} opts={widget.opts} />
```

- [ ] **Step 3: MobileWorkspace — label + add type**

In `app/src/pages/charts/widgets/MobileWorkspace.jsx` (line ~5), change:

```js
const TYPE_LABEL = { chart: 'Chart', watchlist: 'Watchlist', themes: 'Themes', scanner: 'Scanner' }
const ADD_TYPES = ['chart', 'watchlist', 'themes', 'scanner']
```

to:

```js
const TYPE_LABEL = { chart: 'Chart', watchlist: 'Watchlist', themes: 'Themes', scanner: 'Scanner', fundamentals: 'Fundamentals' }
const ADD_TYPES = ['chart', 'watchlist', 'themes', 'scanner', 'fundamentals']
```

- [ ] **Step 4: Run the charts workspace tests + build**

Run: `cd app && npx vitest run src/pages/charts && npm run build`
Expected: all charts tests PASS; build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/ChartsWorkspace.jsx app/src/pages/charts/WidgetHost.jsx app/src/pages/charts/widgets/MobileWorkspace.jsx
git commit -m "feat: register fundamentals widget in charts workspace (desktop + mobile)"
```

---

## Task 9: Real-data verification + provider confirmation

**Files:** none (manual verification + possible follow-up tuning)

- [ ] **Step 1: Probe live providers for a real ticker**

Start the backend locally (admin test account per CLAUDE.md mobile-audit recipe) and hit:

Run: `curl "http://localhost:8077/api/debug/earnings-sources/AAPL"`
Expected: confirms whether FMP `stable/income-statement` / `analyst-estimates` return data on the current plan. If FMP annual is empty, `get_annual_financials` should still produce rows from yfinance / quarter roll-up — verify next step.

- [ ] **Step 2: Hit the new endpoint with debug**

Run: `curl "http://localhost:8077/api/fundamentals/earnings-table?sym=AAPL&debug=1"` (with an authenticated session cookie)
Expected: JSON with non-empty `annual` (≥4 closed years + up to 2 `estimate:true` rows) and `quarterly` (5 reported + 1 next), plus `_sources` showing which provider filled `annual`. Spot-check the EPS/Sales numbers against MarketSurge/Yahoo for AAPL.

- [ ] **Step 3: Browser smoke**

Build (`cd app && npm run build`), open `/charts`, click **+ Add Widget → Fundamentals**, color-link it to a Chart widget, change the chart's ticker, and confirm the widget follows and renders both sections. Narrow the widget to confirm the `@container` quarterly collapse. Check phone viewport via the mobile tab stack.

- [ ] **Step 4: If a provider gap is found**, adjust the `_annual_actuals_from_*` chain or `_forward_estimates` source order in `api/services/annual_financials.py` accordingly (e.g. add an FMP `analyst-estimates` path if it's live), with a matching unit test. Commit any change.

---

## Self-Review

**Spec coverage:**
- Annual EPS/Sales table w/ forward estimates → Tasks 2, 7. ✓
- Quarterly actual-vs-estimate strip + next earnings → Task 3, 7. ✓
- Widget wiring (ChartsWorkspace/WidgetHost/MobileWorkspace, color-group) → Tasks 7, 8. ✓
- `@container` responsive collapse → Task 7 CSS. ✓
- Endpoint w/ auth + debug + route ordering → Task 4. ✓
- Tiered caching + earnings fast-path → Task 3. ✓
- Estimate-revision snapshot store + ▲/▼ → Tasks 1, 2, 7. ✓
- Daily warm job (gated) → Task 5. ✓
- Source accuracy / debug auditability → Task 3 (`_sources`), Task 9. ✓
- Tests (backend + frontend) → every task. ✓
- Env vars (`FUNDAMENTALS_WARM_ENABLED`, `FUNDAMENTALS_ESTIMATES_DB_PATH`) → Tasks 1, 5. ✓

**Type consistency:** row keys (`eps`, `eps_chg_pct`, `sales`, `sales_chg_pct`, `estimate`, `eps_revision`, `sales_revision`) identical across annual_financials (T2), the widget (T7), and tests. Quarterly keys (`label`, `eps_actual`, `eps_estimate`, `eps_surprise_pct`, `rev_actual`, `rev_estimate`, `rev_surprise_pct`, `reported`, `report_date`) identical across T3 and T7. Store signatures (`record_snapshot`, `revision_for`) match between T1 and T2. ✓

**Placeholder scan:** no TBD/"handle edge cases"/"similar to" — all code blocks complete. The only deferred item is Task 9 provider confirmation, which is an explicit verification task, not a code placeholder. ✓
