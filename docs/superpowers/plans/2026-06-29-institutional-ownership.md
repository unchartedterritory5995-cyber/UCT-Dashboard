# 13F Institutional Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface 13F ownership — % institutional, top holders, and position-change deltas (new/added/reduced/sold-out) + biggest buyers/sellers — via one reusable `OwnershipPanel` mounted in the Fundamentals widget, EarningsModal, and TickerPopup.

**Architecture:** Extend `institutional_holdings.py` with FMP-Ultimate-first `get_ownership` (deltas) → yfinance fallback (no deltas). One endpoint `GET /api/ownership/{sym}` in the shared `analyst.py` router → one SWR hook + `OwnershipPanel`, mounted thrice. Mirrors the analyst-intel plan's structure.

**Tech Stack:** FastAPI, FMP Ultimate + yfinance, React + Vite + SWR, vitest + pytest.

## Global Constraints
(Same as analyst-intel plan: React+Vite, FMP-first with graceful yfinance fallback, verify FMP paths live, real `--ut-*`/`--text-*` tokens + no emoji, isolated worktree + explicit-path commits + FF push, `ZZ...` test tickers, auth via `get_current_user`, reuse `ee._fmp_get`, test/build commands as before.)

## File Structure
| Path | Responsibility |
|------|----------------|
| `api/services/institutional_holdings.py` | extend: `get_ownership(ticker)` + `_classify_change` + `_fmp_ownership`. |
| `api/routers/analyst.py` | add `GET /api/ownership/{sym}` (router from analyst-intel plan). |
| `app/src/hooks/useOwnership.js` | **New.** SWR hook. |
| `app/src/components/fundamentals/OwnershipPanel.{jsx,module.css}` | **New.** reusable panel. |
| `app/src/pages/charts/widgets/FundamentalsWidget.jsx` | add `ownership` view tab. |
| `app/src/components/tiles/EarningsModal.jsx` | add Ownership section. |
| `app/src/components/TickerPopup.jsx` | add `ownership` mode. |

---

## Task 1: change classification (pure) + ownership assembly

**Files:**
- Modify: `api/services/institutional_holdings.py`
- Test: `tests/test_ownership.py`

**Interfaces:**
- Produces:
  - `_classify_change(current_shares, prior_shares) -> str` ∈ `{"new","added","reduced","sold_out","flat"}`.
  - `get_ownership(ticker: str, debug: bool = False) -> dict` → `{ticker, inst_pct, inst_holders_count, as_of, top_holders:[{holder,shares,pct_out,value,change,change_shares}], biggest_buyers:[...], biggest_sellers:[...]}`.
  - Mockable `_fmp_ownership(ticker) -> list[dict]` (raw rows incl. current+prior shares) and existing `get_institutional_holders` (yfinance fallback).

- [ ] **Step 1: Failing tests**
```python
# tests/test_ownership.py
import importlib
def _mod(monkeypatch):
    import api.services.institutional_holdings as ih
    importlib.reload(ih)
    return ih

def test_classify_change():
    ih = _mod(None) if False else __import__('api.services.institutional_holdings', fromlist=['x'])
    assert ih._classify_change(100, 0) == "new"
    assert ih._classify_change(0, 100) == "sold_out"
    assert ih._classify_change(150, 100) == "added"
    assert ih._classify_change(80, 100) == "reduced"
    assert ih._classify_change(100, 100) == "flat"
    assert ih._classify_change(100, None) == "new"

def test_get_ownership_fmp_with_deltas_and_rankings(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [
        {"holder": "Vanguard", "shares": 1.31e9, "prior_shares": 1.29e9, "pct_out": 8.4, "value": 3.2e11, "date": "2026-03-31"},
        {"holder": "BlackRock", "shares": 1.10e9, "prior_shares": 1.20e9, "pct_out": 7.0, "value": 2.7e11, "date": "2026-03-31"},
        {"holder": "NewCo", "shares": 5.0e8, "prior_shares": 0, "pct_out": 3.0, "value": 1.2e11, "date": "2026-03-31"},
    ])
    out = ih.get_ownership("ZZAAPL")
    by = {h["holder"]: h for h in out["top_holders"]}
    assert by["Vanguard"]["change"] == "added" and by["Vanguard"]["change_shares"] == 2.0e7
    assert by["BlackRock"]["change"] == "reduced"
    assert by["NewCo"]["change"] == "new"
    assert out["biggest_buyers"][0]["holder"] == "NewCo"      # +5.0e8 largest add
    assert out["biggest_sellers"][0]["holder"] == "BlackRock" # -1.0e8
    assert out["as_of"] == "2026-03-31"

def test_get_ownership_yfinance_fallback_no_deltas(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {
        "inst_pct": 61.4, "holders": [{"holder": "Vanguard", "shares": 1.3e9, "pct_out": 8.4, "value": 3.2e11}], "as_of": "2026-03-31"})
    out = ih.get_ownership("ZZFB")
    assert out["inst_pct"] == 61.4
    assert out["top_holders"][0]["change"] is None    # no deltas on fallback
    assert out["biggest_buyers"] == [] and out["biggest_sellers"] == []

def test_empty_returns_shape(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {"error": "x"})
    out = ih.get_ownership("ZZNADA")
    assert out["top_holders"] == [] and out["inst_pct"] is None
```

- [ ] **Step 2: Run → fail.** `python -m pytest tests/test_ownership.py -v`

- [ ] **Step 3: Implement** (append to `institutional_holdings.py`; confirm `get_institutional_holders` returns a `holders` list + `inst_pct` — adapt the fallback adapter to its real keys when wiring):
```python
from api.services.cache import cache as _shared_cache  # if not already imported
_OWN_TTL = 21_600

def _classify_change(cur, prior):
    c = cur or 0; p = prior
    if p is None or p == 0:
        return "new" if c > 0 else "flat"
    if c == 0:
        return "sold_out"
    if c > p:
        return "added"
    if c < p:
        return "reduced"
    return "flat"

def _fmp_ownership(ticker):
    """FMP Ultimate institutional ownership rows (current + prior-quarter shares).
    Exact path/fields verified live; returns [] on any failure."""
    from api.services import earnings_estimates as ee
    data = ee._fmp_get("/stable/institutional-ownership/symbol-ownership",
                       {"symbol": ticker, "limit": 20})
    rows = data if isinstance(data, list) else []
    out = []
    for r in rows:
        out.append({
            "holder": r.get("investorName") or r.get("holder"),
            "shares": r.get("sharesNumber") or r.get("shares"),
            "prior_shares": r.get("lastSharesNumber") or r.get("prior_shares"),
            "pct_out": r.get("ownershipPercent") or r.get("pct_out"),
            "value": r.get("marketValue") or r.get("value"),
            "date": str(r.get("date") or "")[:10] or None,
        })
    return [r for r in out if r.get("holder")]

def get_ownership(ticker, debug=False):
    ticker = (ticker or "").upper().strip()
    empty = {"ticker": ticker, "inst_pct": None, "inst_holders_count": None, "as_of": None,
             "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}
    if not ticker:
        return empty
    ckey = f"ownership::{ticker}"
    if not debug:
        hit = _shared_cache.get(ckey)
        if hit is not None:
            return hit

    rows = _fmp_ownership(ticker)
    src = "fmp"
    if rows:
        holders = []
        for r in rows:
            shares = r.get("shares"); prior = r.get("prior_shares")
            ch = _classify_change(shares, prior)
            holders.append({"holder": r["holder"], "shares": shares, "pct_out": r.get("pct_out"),
                            "value": r.get("value"), "change": ch,
                            "change_shares": (None if shares is None or prior is None else shares - prior)})
        holders.sort(key=lambda h: (h.get("shares") or 0), reverse=True)
        deltas = [h for h in holders if h.get("change_shares") is not None]
        buyers = sorted([h for h in deltas if h["change_shares"] > 0], key=lambda h: h["change_shares"], reverse=True)[:5]
        sellers = sorted([h for h in deltas if h["change_shares"] < 0], key=lambda h: h["change_shares"])[:5]
        as_of = next((r.get("date") for r in rows if r.get("date")), None)
        result = {"ticker": ticker, "inst_pct": None, "inst_holders_count": len(holders),
                  "as_of": as_of, "top_holders": holders[:15],
                  "biggest_buyers": buyers, "biggest_sellers": sellers, "_source": src}
    else:
        src = "yfinance"
        yf = get_institutional_holders(ticker, top_n=15) or {}
        if "error" in yf and not yf.get("holders"):
            result = dict(empty, **{"_source": src})
        else:
            holders = [{"holder": h.get("holder"), "shares": h.get("shares"), "pct_out": h.get("pct_out"),
                        "value": h.get("value"), "change": None, "change_shares": None}
                       for h in (yf.get("holders") or [])]
            result = {"ticker": ticker, "inst_pct": yf.get("inst_pct"),
                      "inst_holders_count": yf.get("inst_holders_count") or len(holders),
                      "as_of": yf.get("as_of"), "top_holders": holders,
                      "biggest_buyers": [], "biggest_sellers": [], "_source": src}

    if debug:
        return result
    out = {k: v for k, v in result.items() if k != "_source"}
    _shared_cache.set(ckey, out, _OWN_TTL)
    return out
```
> Wiring note: confirm `get_institutional_holders`'s real return keys (`grep -n "return" api/services/institutional_holdings.py`) and adapt the fallback adapter (`holders`/`inst_pct`/`as_of`) to match before running.

- [ ] **Step 4: Run → pass.** `python -m pytest tests/test_ownership.py -v`
- [ ] **Step 5: Commit.**
```bash
git add api/services/institutional_holdings.py tests/test_ownership.py
git commit -m "feat: get_ownership with FMP 13F deltas + yfinance fallback"
```

---

## Task 2: endpoint `GET /api/ownership/{sym}`

**Files:**
- Modify: `api/routers/analyst.py` (add route next to `/api/analyst/{sym}`)
- Test: `tests/test_ownership_router.py`

- [ ] **Step 1: Failing test** (mirror the analyst router test: auth required, happy, unknown→shape; `monkeypatch.setattr(ar, "get_ownership", ...)`).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — in `analyst.py`:
```python
from api.services.institutional_holdings import get_ownership

@router.get("/api/ownership/{sym}")
def ownership_endpoint(sym: str, debug: int = 0, user: dict = Depends(get_current_user)):
    s = (sym or "").upper().strip()
    if not s:
        return {"ticker": "", "inst_pct": None, "inst_holders_count": None, "as_of": None, "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}
    try:
        return get_ownership(s, debug=bool(debug))
    except Exception as e:
        _log.warning("ownership endpoint failed for %s: %s", s, e)
        return {"ticker": s, "inst_pct": None, "inst_holders_count": None, "as_of": None, "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}
```
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**
```bash
git add api/routers/analyst.py tests/test_ownership_router.py
git commit -m "feat: GET /api/ownership/{sym} endpoint"
```

---

## Task 3: hook + OwnershipPanel

**Files:**
- Create: `app/src/hooks/useOwnership.js`, `app/src/components/fundamentals/OwnershipPanel.{jsx,module.css}`, `OwnershipPanel.test.jsx`

- [ ] **Step 1: Hook** (mirror useAnalystIntel, URL `/api/ownership/${sym}`).
- [ ] **Step 2: Failing panel test**
```jsx
// OwnershipPanel.test.jsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import OwnershipPanel from './OwnershipPanel'
const mockData = vi.fn()
vi.mock('../../hooks/useOwnership', () => ({ default: () => ({ data: mockData() }) }))

test('renders inst %, a holder with a delta chip, and a buyer', () => {
  mockData.mockReturnValue({ ticker: 'AAPL', inst_pct: 61.4, inst_holders_count: 5123, as_of: '2026-03-31',
    top_holders: [{ holder: 'Vanguard', shares: 1.31e9, pct_out: 8.4, value: 3.2e11, change: 'added', change_shares: 2.0e7 }],
    biggest_buyers: [{ holder: 'NewCo', change_shares: 5.0e8 }], biggest_sellers: [] })
  render(<OwnershipPanel sym="AAPL" />)
  expect(screen.getByText('Vanguard')).toBeInTheDocument()
  expect(screen.getByText(/added/i)).toBeInTheDocument()
  expect(screen.getByText('NewCo')).toBeInTheDocument()
})
test('empty state', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', inst_pct: null, top_holders: [], biggest_buyers: [], biggest_sellers: [] })
  render(<OwnershipPanel sym="ZZ" />)
  expect(screen.getByText(/no ownership data/i)).toBeInTheDocument()
})
```
- [ ] **Step 3: Implement panel** (real tokens, no emoji):
```jsx
// app/src/components/fundamentals/OwnershipPanel.jsx
import useOwnership from '../../hooks/useOwnership'
import styles from './OwnershipPanel.module.css'
const fmtShares = v => v == null ? '—' : v >= 1e9 ? `${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : `${v}`
const fmtVal = v => v == null ? '—' : v >= 1e12 ? `$${(v/1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : `$${(v/1e6).toFixed(0)}M`
const CHIP = { new: 'NEW', added: '+ADD', reduced: '−CUT', sold_out: 'SOLD' }
const chipClass = c => c === 'new' || c === 'added' ? styles.chipUp : c === 'reduced' || c === 'sold_out' ? styles.chipDown : styles.chipFlat

function DeltaChip({ change }) {
  if (!change || change === 'flat') return null
  return <span className={`${styles.chip} ${chipClass(change)}`}>{CHIP[change]}</span>
}
export default function OwnershipPanel({ sym }) {
  const { data } = useOwnership(sym)
  if (!sym) return <div className={styles.hint}>Pick a ticker.</div>
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  if (!data.top_holders?.length && data.inst_pct == null) return <div className={styles.hint}>No ownership data for {sym}.</div>
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {data.inst_pct != null && <span><b>{data.inst_pct}%</b> <span className={styles.muted}>institutional</span></span>}
        {data.as_of && <span className={styles.muted}>as of {data.as_of}</span>}
      </div>
      <div className={styles.sectionLabel}>Top holders</div>
      <table className={styles.tbl}><tbody>
        {data.top_holders.map((h, i) => (
          <tr key={i}>
            <td className={styles.holder}>{h.holder}</td>
            <td>{fmtShares(h.shares)}</td>
            <td className={styles.muted}>{h.pct_out != null ? `${h.pct_out}%` : ''}</td>
            <td className={styles.muted}>{fmtVal(h.value)}</td>
            <td><DeltaChip change={h.change} /></td>
          </tr>
        ))}
      </tbody></table>
      {(data.biggest_buyers?.length || data.biggest_sellers?.length) ? (
        <div className={styles.flow}>
          {data.biggest_buyers?.length > 0 && <div><div className={styles.sectionLabel}>Biggest buyers</div>
            {data.biggest_buyers.map((b, i) => <div key={i} className={styles.flowRow}><span className={styles.holder}>{b.holder}</span><span className={styles.pos}>+{fmtShares(b.change_shares)}</span></div>)}</div>}
          {data.biggest_sellers?.length > 0 && <div><div className={styles.sectionLabel}>Biggest sellers</div>
            {data.biggest_sellers.map((s, i) => <div key={i} className={styles.flowRow}><span className={styles.holder}>{s.holder}</span><span className={styles.neg}>{fmtShares(s.change_shares)}</span></div>)}</div>}
        </div>
      ) : null}
    </div>
  )
}
```
```css
/* OwnershipPanel.module.css */
.root { height: 100%; overflow: auto; padding: 8px 10px; font-family: var(--font-sans); font-size: var(--text-base,12px); color: var(--text); }
.hint { display:flex; align-items:center; justify-content:center; height:100%; padding:16px; text-align:center; color:var(--text-muted); font-size:var(--text-sm,11px); }
.header { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; color:var(--text-bright); }
.sectionLabel { font-size:var(--text-xs,10px); letter-spacing:1px; text-transform:uppercase; color:var(--text-muted); margin:6px 0 4px; }
.tbl { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.tbl td { padding:3px 6px; border-bottom:1px solid var(--border); text-align:right; color:var(--text-bright); white-space:nowrap; }
.holder { text-align:left !important; color:var(--text-bright); font-weight:600; }
.muted { color:var(--text-muted); }
.pos { color:var(--ut-green-bright); } .neg { color:var(--ut-red-bright); }
.chip { font-size:var(--text-xs,10px); padding:1px 5px; border-radius:8px; font-weight:700; }
.chipUp { background:var(--gain-bg); color:var(--ut-green-bright); }
.chipDown { background:var(--loss-bg); color:var(--ut-red-bright); }
.chipFlat { color:var(--text-muted); }
.flow { display:flex; gap:14px; margin-top:8px; }
.flowRow { display:flex; justify-content:space-between; gap:10px; font-size:var(--text-sm,11px); }
```
- [ ] **Step 4: Run → pass.** `cd app && npx vitest run src/components/fundamentals/OwnershipPanel.test.jsx`
- [ ] **Step 5: Commit.**
```bash
git add app/src/hooks/useOwnership.js app/src/components/fundamentals/OwnershipPanel.jsx app/src/components/fundamentals/OwnershipPanel.module.css app/src/components/fundamentals/OwnershipPanel.test.jsx
git commit -m "feat: useOwnership hook + reusable OwnershipPanel"
```

---

## Task 4: mount OwnershipPanel in the three surfaces

Same pattern as analyst-intel Task 4 — add an `Ownership` option to each surface:
- **FundamentalsWidget**: add `'ownership'` to the allowed views + a `Ownership` toggle button; render `<OwnershipPanel sym={sym} />`. Add the widget test (mock OwnershipPanel, assert it renders under the Ownership tab).
- **TickerPopup**: add `'ownership'` mode button + `{view === 'ownership' && <OwnershipPanel sym={sym} />}`.
- **EarningsModal**: add `<OwnershipPanel sym={row.sym} />` as a section (e.g. below the AnalystPanel / transcript).

- [ ] **Step 1-3:** edits above (widget test first → fail → implement).
- [ ] **Step 4: Run + build.** `cd app && npx vitest run src/pages/charts src/components/fundamentals && npm run build`
- [ ] **Step 5: Commit.**
```bash
git add app/src/pages/charts/widgets/FundamentalsWidget.jsx app/src/pages/charts/widgets/FundamentalsWidget.test.jsx app/src/components/TickerPopup.jsx app/src/components/tiles/EarningsModal.jsx
git commit -m "feat: mount OwnershipPanel in Fundamentals widget, TickerPopup, EarningsModal"
```

---

## Task 5: live verification
- [ ] Probe FMP institutional-ownership path live (`/api/debug/earnings-sources` + a direct `get_ownership` python probe loading `.env`); confirm rows carry current+prior shares (deltas). If the endpoint only returns current shares, add a two-quarter diff or accept fallback (no deltas) — adjust `_fmp_ownership` + a unit test.
- [ ] `GET /api/ownership/AAPL?debug=1` → holders + deltas + buyers/sellers; `_source=fmp`.
- [ ] Browser: Ownership tab in widget + TickerPopup + EarningsModal section render.

## Self-Review
- Spec coverage: inst% + holders (T1/T3), deltas/new-added-reduced-sold (T1), buyers/sellers (T1/T3), endpoint (T2), 3 surfaces (T4), yfinance fallback (T1), verify (T5). ✓
- Placeholders: complete code; wiring-note adapts to real yfinance keys (explicit, not a placeholder). ✓
- Type consistency: `get_ownership` dict keys + holder fields (`holder,shares,pct_out,value,change,change_shares`) identical across service/panel/tests. ✓
