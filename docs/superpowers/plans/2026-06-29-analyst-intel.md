# Analyst Intel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface analyst consensus, price target (+upside%), and an upgrades/downgrades feed for any ticker — via one reusable `AnalystPanel` mounted in the Fundamentals widget, EarningsModal, and TickerPopup.

**Architecture:** FMP-Ultimate-first service (`analyst_intel.py`) with Finnhub fallback → one auth endpoint `GET /api/analyst/{sym}` → one SWR hook + one `AnalystPanel` component, mounted in three surfaces. Build once, mount thrice.

**Tech Stack:** FastAPI, FMP Ultimate + Finnhub, React + Vite + SWR, vitest + pytest.

## Global Constraints

- React + Vite SPA — NO Next.js.
- FMP-first, **graceful fallback** to Finnhub on any FMP failure/tier-gate; a missing slice omits that field, never blanks the panel.
- Exact FMP endpoint paths are **verified live during implementation** via `GET /api/debug/earnings-sources/{sym}` before locking the source chain (the proven pattern; an unverified path must still fall back cleanly).
- Real design tokens only (`--ut-*`, `--text-*`, `--bg-*`, `--border`, `--font-sans`); **no generic emoji** (use styled ↑/↓ glyphs / SVG).
- Isolated worktree off `origin/master`; stage explicit paths (never `git add -A`); ship via fast-forward `push origin <branch>:master`.
- Provider cache is a process-global singleton (`api.services.cache.cache`) — tests use unique `ZZ...` tickers.
- Auth: `from api.middleware.auth_middleware import get_current_user`; `user: dict = Depends(get_current_user)`.
- Reuse `earnings_estimates._fmp_get` (FMP GET wrapper) and `earnings_estimates.get_earnings_intel` (Finnhub consensus/PT) — do not re-implement.
- Tests: `python -m pytest <path> -v`; `cd app && npx vitest run <path>`; build `cd app && npm run build`.

## File Structure

| Path | Responsibility |
|------|----------------|
| `api/services/analyst_intel.py` | **New.** `get_analyst_intel(ticker)` — FMP grades/PT/upgrades → Finnhub fallback. |
| `api/routers/analyst.py` | **New.** `GET /api/analyst/{sym}` (also hosts `/api/ownership/{sym}` from Plan B). |
| `api/main.py` | include the analyst router. |
| `app/src/hooks/useAnalystIntel.js` | **New.** SWR hook. |
| `app/src/components/fundamentals/AnalystPanel.{jsx,module.css}` | **New.** reusable panel. |
| `app/src/pages/charts/widgets/FundamentalsWidget.jsx` | add `analyst` view tab. |
| `app/src/components/tiles/EarningsModal.jsx` | replace inline consensus/PT block with `<AnalystPanel>`. |
| `app/src/components/TickerPopup.jsx` | add `analyst` mode. |

---

## Task 1: analyst_intel service — consensus + price target

**Files:**
- Create: `api/services/analyst_intel.py`
- Test: `tests/test_analyst_intel.py`

**Interfaces:**
- Consumes: `earnings_estimates._fmp_get(path, params)`, `earnings_estimates.get_earnings_intel(ticker)` (returns `{consensus:{buy,hold,sell,strongBuy,strongSell}, price_target:{targetLow,targetMean,targetHigh,...}}`).
- Produces: `get_analyst_intel(ticker: str, current_price: float | None = None, debug: bool = False) -> dict` with keys `ticker, consensus, price_target, recent_actions`. Mockable helpers `_fmp_consensus`, `_fmp_price_target`, `_fmp_recent_actions`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_analyst_intel.py
import importlib

def _mod(monkeypatch):
    import api.services.analyst_intel as ai
    importlib.reload(ai)
    return ai

def test_consensus_and_pt_from_fmp_with_upside(monkeypatch):
    ai = _mod(monkeypatch)
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: {"rating": "Buy", "buy": 28, "hold": 9, "sell": 2, "strong_buy": 12, "strong_sell": 0})
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: {"low": 210.0, "avg": 285.0, "high": 320.0, "count": 41, "updated": "2026-06-20"})
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [])
    out = ai.get_analyst_intel("ZZAAPL", current_price=250.0)
    assert out["consensus"]["rating"] == "Buy"
    assert out["price_target"]["avg"] == 285.0
    # upside = (285-250)/250 = +14.0%
    assert out["price_target"]["upside_pct"] == 14.0

def test_falls_back_to_finnhub_when_fmp_empty(monkeypatch):
    ai = _mod(monkeypatch)
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [])
    monkeypatch.setattr(ai.ee, "get_earnings_intel", lambda t: {
        "consensus": {"buy": 5, "hold": 1, "sell": 0, "strongBuy": 3, "strongSell": 0},
        "price_target": {"targetLow": 100, "targetMean": 130, "targetHigh": 160},
    })
    out = ai.get_analyst_intel("ZZFB", current_price=120.0)
    assert out["consensus"]["buy"] == 5
    assert out["price_target"]["avg"] == 130
    assert out["price_target"]["upside_pct"] == 8.3   # (130-120)/120

def test_empty_everywhere_returns_shape(monkeypatch):
    ai = _mod(monkeypatch)
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: None)
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [])
    monkeypatch.setattr(ai.ee, "get_earnings_intel", lambda t: None)
    out = ai.get_analyst_intel("ZZNADA")
    assert out == {"ticker": "ZZNADA", "consensus": None, "price_target": None, "recent_actions": []}
```

- [ ] **Step 2: Run → fail** (`ModuleNotFoundError`).
Run: `python -m pytest tests/test_analyst_intel.py -v`

- [ ] **Step 3: Implement the service**

```python
# api/services/analyst_intel.py
"""Analyst intelligence — consensus, price target (+upside%), recent
upgrades/downgrades. FMP Ultimate first, Finnhub (get_earnings_intel) fallback.
Cached ~6h. Never raises."""
from __future__ import annotations
import logging
from api.services import earnings_estimates as ee
from api.services.cache import cache

_log = logging.getLogger(__name__)
_TTL = 21_600  # 6h

def _round(v, n=1):
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None

# ── FMP slices (mockable; exact paths verified live, fall back to None) ──────
def _fmp_consensus(ticker):
    data = ee._fmp_get("/stable/grades-consensus", {"symbol": ticker})
    row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
    if not row:
        return None
    buy = int(row.get("buy") or 0); hold = int(row.get("hold") or 0); sell = int(row.get("sell") or 0)
    sb = int(row.get("strongBuy") or 0); ss = int(row.get("strongSell") or 0)
    return {"rating": row.get("consensus") or _derive_rating(buy + sb, hold, sell + ss),
            "buy": buy, "hold": hold, "sell": sell, "strong_buy": sb, "strong_sell": ss}

def _fmp_price_target(ticker):
    data = ee._fmp_get("/stable/price-target-summary", {"symbol": ticker})
    row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
    if not row:
        return None
    return {"low": _round(row.get("lastMonthLow") or row.get("low"), 2),
            "avg": _round(row.get("lastMonthAvgPriceTarget") or row.get("avg"), 2),
            "high": _round(row.get("lastMonthHigh") or row.get("high"), 2),
            "count": row.get("lastMonth") or row.get("count"),
            "updated": str(row.get("date") or "")[:10] or None}

def _fmp_recent_actions(ticker):
    data = ee._fmp_get("/stable/grades-historical", {"symbol": ticker, "limit": 20})
    if not isinstance(data, list):
        return []
    out = []
    for r in data[:15]:
        out.append({"date": str(r.get("date") or "")[:10],
                    "firm": r.get("gradingCompany") or r.get("analystCompany"),
                    "action": (r.get("action") or "").lower() or None,
                    "from_grade": r.get("previousGrade"),
                    "to_grade": r.get("newGrade"),
                    "price_target": _round(r.get("priceTarget"), 2)})
    return out

def _derive_rating(buy, hold, sell):
    if buy == hold == sell == 0:
        return None
    if buy >= max(hold, sell) and buy > sell:
        return "Buy"
    if sell > buy:
        return "Sell"
    return "Hold"

def _finnhub_consensus(intel):
    c = (intel or {}).get("consensus")
    if not c:
        return None
    buy = int(c.get("buy") or 0); hold = int(c.get("hold") or 0); sell = int(c.get("sell") or 0)
    sb = int(c.get("strongBuy") or 0); ss = int(c.get("strongSell") or 0)
    return {"rating": _derive_rating(buy + sb, hold, sell + ss),
            "buy": buy, "hold": hold, "sell": sell, "strong_buy": sb, "strong_sell": ss}

def _finnhub_pt(intel):
    p = (intel or {}).get("price_target")
    if not p:
        return None
    return {"low": _round(p.get("targetLow"), 2), "avg": _round(p.get("targetMean"), 2),
            "high": _round(p.get("targetHigh"), 2), "count": None,
            "updated": str(p.get("lastUpdated") or "")[:10] or None}

def get_analyst_intel(ticker, current_price=None, debug=False):
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"ticker": "", "consensus": None, "price_target": None, "recent_actions": []}
    ckey = f"analyst_intel::{ticker}"
    if not debug:
        hit = cache.get(ckey)
        if hit is not None:
            return hit

    src = "fmp"
    consensus = _fmp_consensus(ticker)
    pt = _fmp_price_target(ticker)
    actions = _fmp_recent_actions(ticker)
    if consensus is None or pt is None:
        intel = ee.get_earnings_intel(ticker)
        if consensus is None:
            consensus = _finnhub_consensus(intel); src = "finnhub" if consensus else src
        if pt is None:
            pt = _finnhub_pt(intel); src = "finnhub" if pt else src

    if pt and pt.get("avg") and current_price:
        try:
            pt["current"] = _round(current_price, 2)
            pt["upside_pct"] = _round((pt["avg"] - current_price) / current_price * 100)
        except Exception:
            pass

    result = {"ticker": ticker, "consensus": consensus, "price_target": pt, "recent_actions": actions or []}
    if debug:
        result["_source"] = src
        return result
    cache.set(ckey, result, _TTL)
    return result
```

- [ ] **Step 4: Run → pass.** `python -m pytest tests/test_analyst_intel.py -v`
- [ ] **Step 5: Commit.**
```bash
git add api/services/analyst_intel.py tests/test_analyst_intel.py
git commit -m "feat: analyst_intel service (FMP grades/PT/upgrades + Finnhub fallback)"
```

---

## Task 2: endpoint `GET /api/analyst/{sym}`

**Files:**
- Create: `api/routers/analyst.py`
- Modify: `api/main.py` (include router)
- Test: `tests/test_analyst_router.py`

**Interfaces:**
- Consumes: `analyst_intel.get_analyst_intel`; a live price helper — reuse `api.services.massive.get_snapshot`-style price if cheap, else pass `current_price=None` (upside omitted). For the plan, pass `None` (the panel still shows the PT range; upside is best-effort and can be added once a cheap price source is confirmed).
- Produces: `GET /api/analyst/{sym}?debug=0` → the service dict.

- [ ] **Step 1: Failing test**

```python
# tests/test_analyst_router.py
from fastapi import FastAPI
from fastapi.testclient import TestClient
import api.routers.analyst as ar
from api.middleware.auth_middleware import get_current_user

def _client(monkeypatch):
    app = FastAPI(); app.include_router(ar.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1}
    return TestClient(app)

def test_requires_auth():
    app = FastAPI(); app.include_router(ar.router)
    r = TestClient(app).get("/api/analyst/AAPL")
    assert r.status_code in (401, 403)

def test_happy(monkeypatch):
    monkeypatch.setattr(ar, "get_analyst_intel", lambda sym, current_price=None, debug=False: {"ticker": sym.upper(), "consensus": {"rating": "Buy"}, "price_target": None, "recent_actions": []})
    r = _client(monkeypatch).get("/api/analyst/aapl")
    assert r.status_code == 200 and r.json()["ticker"] == "AAPL"

def test_unknown_returns_shape_not_500(monkeypatch):
    monkeypatch.setattr(ar, "get_analyst_intel", lambda sym, current_price=None, debug=False: {"ticker": sym.upper(), "consensus": None, "price_target": None, "recent_actions": []})
    r = _client(monkeypatch).get("/api/analyst/ZZNOPE")
    assert r.status_code == 200 and r.json()["consensus"] is None
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement router**

```python
# api/routers/analyst.py
"""Analyst intel + institutional ownership endpoints (FMP Ultimate)."""
from __future__ import annotations
import logging
from fastapi import APIRouter, Depends
from api.middleware.auth_middleware import get_current_user
from api.services.analyst_intel import get_analyst_intel

_log = logging.getLogger(__name__)
router = APIRouter()

@router.get("/api/analyst/{sym}")
def analyst_endpoint(sym: str, debug: int = 0, user: dict = Depends(get_current_user)):
    s = (sym or "").upper().strip()
    if not s:
        return {"ticker": "", "consensus": None, "price_target": None, "recent_actions": []}
    try:
        return get_analyst_intel(s, debug=bool(debug))
    except Exception as e:
        _log.warning("analyst endpoint failed for %s: %s", s, e)
        return {"ticker": s, "consensus": None, "price_target": None, "recent_actions": []}
```

In `api/main.py`, add alongside the other router includes:
```python
from api.routers import analyst as analyst_router
app.include_router(analyst_router.router)
```
(Run `grep -n "include_router" api/main.py` to match the established placement/style.)

- [ ] **Step 4: Run → pass.** `python -m pytest tests/test_analyst_router.py -v`
- [ ] **Step 5: Commit.**
```bash
git add api/routers/analyst.py api/main.py tests/test_analyst_router.py
git commit -m "feat: GET /api/analyst/{sym} endpoint"
```

---

## Task 3: SWR hook + AnalystPanel component

**Files:**
- Create: `app/src/hooks/useAnalystIntel.js`
- Create: `app/src/components/fundamentals/AnalystPanel.jsx` + `AnalystPanel.module.css`
- Test: `app/src/components/fundamentals/AnalystPanel.test.jsx`

**Interfaces:**
- Produces: `useAnalystIntel(sym)` → SWR `{data}`; `<AnalystPanel sym={string} />`.

- [ ] **Step 1: Hook**
```js
// app/src/hooks/useAnalystIntel.js
import useSWR from 'swr'
const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)
export default function useAnalystIntel(sym) {
  return useSWR(sym ? `/api/analyst/${encodeURIComponent(sym)}` : null, fetcher,
    { refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false })
}
```

- [ ] **Step 2: Failing panel test**
```jsx
// app/src/components/fundamentals/AnalystPanel.test.jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import AnalystPanel from './AnalystPanel'
const mockData = vi.fn()
vi.mock('../../hooks/useAnalystIntel', () => ({ default: () => ({ data: mockData() }) }))

test('renders consensus, price target, and an upgrade action', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    consensus: { rating: 'Buy', buy: 28, hold: 9, sell: 2, strong_buy: 12, strong_sell: 0 },
    price_target: { low: 210, avg: 285, high: 320, current: 250, upside_pct: 14.0 },
    recent_actions: [{ date: '2026-06-20', firm: 'Morgan Stanley', action: 'upgrade', from_grade: 'Equal-Weight', to_grade: 'Overweight', price_target: 300 }],
  })
  render(<AnalystPanel sym="AAPL" />)
  expect(screen.getByText('Buy')).toBeInTheDocument()
  expect(screen.getByText(/\+14%/)).toBeInTheDocument()
  expect(screen.getByText('Morgan Stanley')).toBeInTheDocument()
})

test('empty state when no coverage', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', consensus: null, price_target: null, recent_actions: [] })
  render(<AnalystPanel sym="ZZ" />)
  expect(screen.getByText(/no analyst coverage/i)).toBeInTheDocument()
})
```

- [ ] **Step 3: Implement panel + css**
```jsx
// app/src/components/fundamentals/AnalystPanel.jsx
import useAnalystIntel from '../../hooks/useAnalystIntel'
import styles from './AnalystPanel.module.css'

const fmtPct = v => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`)
const fmt$ = v => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const pctClass = v => (v == null ? '' : v >= 0 ? styles.pos : styles.neg)

function ConsensusBar({ c }) {
  if (!c) return null
  const buy = (c.buy || 0) + (c.strong_buy || 0)
  const sell = (c.sell || 0) + (c.strong_sell || 0)
  const total = buy + (c.hold || 0) + sell || 1
  return (
    <div className={styles.block}>
      <div className={styles.row}><span className={styles.rating}>{c.rating || '—'}</span>
        <span className={styles.counts}>
          <span className={styles.pos}>{buy} Buy</span>
          <span className={styles.muted}>{c.hold || 0} Hold</span>
          <span className={styles.neg}>{sell} Sell</span>
        </span></div>
      <div className={styles.bar}>
        <span className={styles.barBuy} style={{ width: `${buy / total * 100}%` }} />
        <span className={styles.barHold} style={{ width: `${(c.hold || 0) / total * 100}%` }} />
        <span className={styles.barSell} style={{ width: `${sell / total * 100}%` }} />
      </div>
    </div>
  )
}

function TargetRange({ p }) {
  if (!p || p.avg == null) return null
  return (
    <div className={styles.block}>
      <div className={styles.row}><span className={styles.muted}>Price Target</span>
        {p.upside_pct != null && <span className={pctClass(p.upside_pct)}>{fmtPct(p.upside_pct)} upside</span>}</div>
      <div className={styles.row}>
        <span className={styles.muted}>{fmt$(p.low)}</span>
        <span className={styles.ptAvg}>{fmt$(p.avg)}</span>
        <span className={styles.muted}>{fmt$(p.high)}</span>
      </div>
    </div>
  )
}

function ActionRow({ a }) {
  const up = a.action === 'upgrade' || (a.action || '').includes('up')
  const down = a.action === 'downgrade' || (a.action || '').includes('down')
  return (
    <div className={styles.action}>
      <span className={`${styles.glyph} ${up ? styles.pos : down ? styles.neg : styles.muted}`}>{up ? '▲' : down ? '▼' : '•'}</span>
      <span className={styles.firm}>{a.firm || '—'}</span>
      <span className={styles.grades}>{a.from_grade ? `${a.from_grade} → ` : ''}{a.to_grade || ''}</span>
      {a.price_target != null && <span className={styles.muted}>{fmt$(a.price_target)}</span>}
      <span className={styles.date}>{a.date}</span>
    </div>
  )
}

export default function AnalystPanel({ sym }) {
  const { data } = useAnalystIntel(sym)
  if (!sym) return <div className={styles.hint}>Pick a ticker.</div>
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  const has = data.consensus || data.price_target || (data.recent_actions || []).length
  if (!has) return <div className={styles.hint}>No analyst coverage for {sym}.</div>
  return (
    <div className={styles.root}>
      <ConsensusBar c={data.consensus} />
      <TargetRange p={data.price_target} />
      {(data.recent_actions || []).length > 0 && (
        <div className={styles.block}>
          <div className={styles.sectionLabel}>Recent rating changes</div>
          {data.recent_actions.map((a, i) => <ActionRow key={i} a={a} />)}
        </div>
      )}
    </div>
  )
}
```
```css
/* app/src/components/fundamentals/AnalystPanel.module.css */
.root { height: 100%; overflow: auto; padding: 8px 10px; font-family: var(--font-sans); font-size: var(--text-base, 12px); color: var(--text); }
.hint { display: flex; align-items: center; justify-content: center; height: 100%; padding: 16px; text-align: center; color: var(--text-muted); font-size: var(--text-sm, 11px); }
.block { margin-bottom: 12px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
.rating { font-weight: 700; color: var(--text-heading); font-size: var(--text-md, 13px); }
.counts { display: flex; gap: 8px; }
.sectionLabel { font-size: var(--text-xs, 10px); letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
.bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--bg-elevated); }
.barBuy { background: var(--ut-green-bright); }
.barHold { background: var(--ut-gold); }
.barSell { background: var(--ut-red-bright); }
.ptAvg { font-weight: 700; color: var(--text-heading); }
.pos { color: var(--ut-green-bright); }
.neg { color: var(--ut-red-bright); }
.muted { color: var(--text-muted); }
.action { display: flex; gap: 6px; align-items: baseline; padding: 3px 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm, 11px); white-space: nowrap; }
.glyph { font-size: 9px; }
.firm { color: var(--text-bright); font-weight: 600; }
.grades { color: var(--text-muted); }
.date { margin-left: auto; color: var(--text-muted); font-size: var(--text-xs, 10px); }
```

- [ ] **Step 4: Run → pass.** `cd app && npx vitest run src/components/fundamentals/AnalystPanel.test.jsx`
- [ ] **Step 5: Commit.**
```bash
git add app/src/hooks/useAnalystIntel.js app/src/components/fundamentals/AnalystPanel.jsx app/src/components/fundamentals/AnalystPanel.module.css app/src/components/fundamentals/AnalystPanel.test.jsx
git commit -m "feat: useAnalystIntel hook + reusable AnalystPanel"
```

---

## Task 4: mount AnalystPanel in the three surfaces

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx` (replace inline consensus/PT block ~lines 349-368 with `<AnalystPanel sym={row.sym} />`)
- Modify: `app/src/components/TickerPopup.jsx` (add `'analyst'` to the `view` mode toggle + render `<AnalystPanel sym={sym} />` when `view === 'analyst'`)
- Modify: `app/src/pages/charts/widgets/FundamentalsWidget.jsx` (add `Analyst` tab to the view toggle; render `<AnalystPanel sym={sym} />` when selected)
- Test: extend `FundamentalsWidget.test.jsx` (Analyst tab selects + renders the panel via a mocked AnalystPanel)

- [ ] **Step 1: EarningsModal** — import `AnalystPanel from '../fundamentals/AnalystPanel'`; replace the inline block:
```jsx
{/* ── Analyst ─────────────────────────────── */}
<AnalystPanel sym={row.sym} />
```
(remove the old `{intel && (intel.consensus || intel.price_target) && (...)}` block; keep the `intel` fetch only if still used elsewhere — `grep intel` first).

- [ ] **Step 2: TickerPopup** — `const [view,setView] = useState('chart')` stays; add a third mode button after Fundamentals:
```jsx
<button className={`${styles.modalModeBtn} ${view === 'analyst' ? styles.modalModeBtnActive : ''}`}
  onClick={() => setView('analyst')} role="tab" aria-selected={view === 'analyst'}>Analyst</button>
```
and in the body, alongside the `view === 'fundamentals'` branch:
```jsx
{view === 'analyst' && <Suspense fallback={null}><AnalystPanel sym={sym} /></Suspense>}
```
(import `AnalystPanel` lazily like `FundamentalSnapshot`, or directly — match the file's import style.)

- [ ] **Step 3: FundamentalsWidget** — generalize the view toggle to include `analyst`. Add a third toggle button `Analyst` (never disabled); when `effectiveView === 'analyst'` render `<AnalystPanel sym={sym} />`. Adjust the early no-data guard so the Analyst view still renders when earnings data is empty:
```jsx
const view = ['annual','quarterly','analyst'].includes(opts?.view) ? opts.view : 'quarterly'
// ...
if (!sym) return <div className={styles.hint}>Pick a ticker…</div>
// allow analyst view even when earnings table is empty:
if (view !== 'analyst' && !data) return <div className={styles.hint}>Loading {sym}…</div>
// render: toggle has Quarterly | Annual | Analyst; body switches on effectiveView
```
Add the failing widget test first:
```jsx
vi.mock('../../../components/fundamentals/AnalystPanel', () => ({ default: ({ sym }) => <div data-testid="analyst-panel">{sym}</div> }))
test('Analyst tab renders the AnalystPanel', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap initialOpts={{ view: 'analyst' }} />)
  expect(screen.getByTestId('analyst-panel')).toHaveTextContent('AAPL')
})
```

- [ ] **Step 4: Run + build.**
```
cd app && npx vitest run src/pages/charts src/components/fundamentals && npm run build
```
Expected: all pass; build clean.

- [ ] **Step 5: Commit.**
```bash
git add app/src/components/tiles/EarningsModal.jsx app/src/components/TickerPopup.jsx app/src/pages/charts/widgets/FundamentalsWidget.jsx app/src/pages/charts/widgets/FundamentalsWidget.test.jsx
git commit -m "feat: mount AnalystPanel in EarningsModal, TickerPopup, Fundamentals widget"
```

---

## Task 5: live verification

- [ ] **Step 1:** Probe FMP grade/PT/grades-historical paths for a real ticker:
  `curl "http://localhost:8077/api/debug/earnings-sources/AAPL"` and a direct `analyst_intel` python probe (load `.env`) — confirm which FMP paths return data; adjust `_fmp_*` field mapping + add a `?period`/path fix with a unit test if the live shape differs. If FMP grades are empty on the plan, confirm Finnhub fallback fills consensus/PT.
- [ ] **Step 2:** `GET /api/analyst/AAPL?debug=1` (authed) → non-empty consensus + PT + actions; `_source` shows which won.
- [ ] **Step 3:** Browser: open the Fundamentals widget Analyst tab, an EarningsModal, and a TickerPopup Analyst mode → panel renders for each.

## Self-Review
- Spec coverage: consensus+PT+upside (T1/T3), upgrades feed (T1/T3), endpoint (T2), 3 surfaces (T4), fallback (T1), live verify (T5). ✓
- Placeholder scan: complete code in every code step; T5 is explicit verification, not a placeholder. ✓
- Type consistency: service dict keys (`consensus{rating,buy,hold,sell,strong_buy,strong_sell}`, `price_target{low,avg,high,current,upside_pct,count,updated}`, `recent_actions[{date,firm,action,from_grade,to_grade,price_target}]`) identical across service, panel, tests. ✓
