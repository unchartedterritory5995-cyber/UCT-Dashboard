# Screener Wave 3 — Scanner Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Scanner tab's UI with a shell built for ~105 columns and ~84 filters: filter sidebar, column picker, virtualized results, URL-encoded screens, honest states, phone card mode — shipped as a direct replacement once the parity checklist is green.

**Architecture:** One new directory `app/src/pages/screener/shell/` owns the shell; the old `ScannerPro.jsx` / `FilterPanel.jsx` / `ResultsTable.jsx` are deleted at cutover (their module CSS survives — `ChartsGallery`, `FilterChips`, `SaveScreenBar` still import it). Spec state lives in one hook (`useScreenSpec`) with a pure URL codec beside it. The server gains column projection and strict sort validation (one small backend task). Everything renders from the server's `meta` — categories and filters are never hardcoded, so Wave 1's new registry flows through untouched.

**Tech Stack:** React 19 + Vite, `@tanstack/react-virtual` ^3.13.24 (installed, unused until now), CSS modules on the house token system, vitest (`--pool=threads`), FastAPI/SQLite for the projection task.

**Spec:** `docs/superpowers/specs/2026-08-21-screener-deep-work-design.md` (§5.5, §6, §10 Wave 3)

## Global Constraints

- Canonical breakpoints 640/1024 ONLY (`app/src/styles/breakpoints.js`); never introduce a new literal.
- `UIcon` for all iconography — NO emoji.
- Design tokens only — no new hex literals; `ScannerPro.module.css`'s discipline is the reference (`--bg-surface/--bg-elevated/--bg-hover/--border/--border-accent/--ut-gold/--text/--text-muted/--text-bright/--gain/--loss/--gain-bg/--loss-bg/--radius-sm/md/--ls-label/--shadow-popover/--tap-min/--font-mono`).
- `--tap-min: 44px` on touch targets.
- Frontend tests: `cd app && npx vitest run <paths> --pool=threads`. Backend: `python -m pytest tests/<file> -v` from the worktree root.
- Never `git add -A` — named files only.
- Share-link constants stay derived from `app/src/pages/screener/screenShareLink.js` — never retyped.
- The shell renders whatever categories/filters `GET /api/screener/meta` sends — no hardcoded category or filter lists anywhere.
- UIcon glyph names used in this plan (`search`, `chevron-up/-down/-right`, `close`, `columns`, `rows`, `download`, `check`, `gear`, `bolt`) MUST be verified against the registry in `app/src/components/ui/UIcon.jsx` at implementation time — pick the nearest existing glyph or add one to the registry (its documented extension path); never fall back to an emoji.
- AuthGuard paid gate and the PUBLIC `/screener/shared/:token` route are untouched.
- Embedded/widget mode must keep working: container-query root is `.widgetBody` (the /charts workspace); use `@container` queries per the existing ScannerPro.module.css idiom.
- Worktree: `C:\Users\Patrick\uct-worktrees\screener-deep-work`, branch `feat/screener-deep-work`.

## Design language (decided; implementers follow, not revisit)

- **Layout**: 264px filter rail left (desktop ≥1025px), results fill the rest. In tablet/embedded-narrow contexts the rail collapses to a "Filters" button opening the existing `FiltersSheet`. Toolbar is ONE 40px strip: view presets (left) · status/provenance seal (center-right) · columns/density/CSV/Screens (right).
- **Type**: numeric cells and the seal use `var(--font-mono)` (the Live Scan idiom promoted); headers 10px uppercase `--ls-label`; ticker cells gold 600.
- **Signature element**: the **provenance seal** — the snapshot date as a stamped mono tag with a gold left border (the SharedScreen disclosure idiom) opening a popover that renders the `result.snapshot` provenance object in full: median date + rows on it, oldest/newest, distinct dates, missing, and the `mixed` flag in words. Boldness is spent here; everything else stays quiet.
- **Density**: `compact` (30px rows) / `comfortable` (38px rows), persisted in `localStorage['uct.screener.density']` — UI preference, never part of the spec/URL.

```
┌────────────┬──────────────────────────────────────────────────────────┐
│ ⌕ search   │ Overview Valuation … Momentum │ ⟨seal 2026-08-21⟩ ▦ ≡ ⤓ ▾│
│ DESCRIPTIVE│──────────────────────────────────────────────────────────│
│  Sector  ▾ │ TICKER│ Company        │ Price │ Chg%  │ RS │ Score │ …  │
│  Mkt Cap ▾²│ NVDA ●│ Nvidia Corp    │182.11 │ +2.4% │ 97 │  85   │    │
│ MOMENTUM   │ MU   ●│ Micron         │ 141.02│ +1.1% │ 94 │  75   │    │
│  Score   ▾ │ AVGO ○│ Broadcom       │ …     │       │    │       │    │
│  Pole %  ▾ │  (virtualized · sticky ticker col · sticky header)       │
└────────────┴──────────────────────────────────────────────────────────┘
```

---

### Task 1: Backend — column projection + strict sort validation

**Files:**
- Modify: `api/services/screener/query.py`
- Modify: `api/routers/screener.py:114-133` (ScanSpec + handler untouched except the model field)
- Test: `tests/test_screener_scan_projection.py` (new)

**Interfaces:**
- Consumes: `snapshot_db.COLUMNS`, existing `build_where`/`describe_rows`.
- Produces: `run_scan(spec)` honors optional `spec["columns"]: list[str]` — validated against `snapshot_db.COLUMNS` (ValueError → 400 on unknown), projected SELECT with `ticker` and the sort column always included; `view_columns` echoes the requested list (ticker first) when given. An unknown `sort.key` now raises ValueError (400) instead of silently substituting `uct_composite`; an ABSENT sort still defaults to `uct_composite DESC`.

In `query.py`, replace the sort/select block of `run_scan` (`:52-63`):

```python
    sort = spec.get("sort") or {}
    sort_key = sort.get("key") or "uct_composite"
    if sort_key not in _SORTABLE:
        # ⛔ No silent substitution: a member sorting a column that does not
        # exist deserves a 400 naming it, not a quiet uct_composite reorder.
        raise ValueError(f"unknown sort key: {sort_key}")
    sort_dir = "ASC" if (sort.get("dir") == "asc") else "DESC"
    page = max(int(spec.get("page", 1)), 1)
    page_size = min(max(int(spec.get("page_size", 50)), 1), _MAX_PAGE)
    offset = (page - 1) * page_size

    cols_req = spec.get("columns")
    if cols_req:
        bad = [c for c in cols_req if c not in set(snapshot_db.COLUMNS)]
        if bad:
            raise ValueError(f"unknown columns: {', '.join(sorted(bad))}")
        # ticker first, then the request's own order, then the sort column so
        # the client can always show why the rows are in this order. Dedupe
        # preserves first position.
        seen, select_cols = set(), []
        for c in ["ticker", *cols_req, sort_key]:
            if c not in seen:
                seen.add(c)
                select_cols.append(c)
        select_sql = ", ".join(f'"{c}"' for c in select_cols)
        out_columns = select_cols
    else:
        select_sql = "*"
        out_columns = view["columns"]

    with snapshot_db.connect() as conn:
        rows = conn.execute(
            f"SELECT {select_sql} FROM screener_rows{where} "
            f'ORDER BY "{sort_key}" {sort_dir} NULLS LAST '
            f"LIMIT ? OFFSET ?", [*params, page_size, offset]).fetchall()
```

…and in the return dict, `"view_columns": out_columns` (the `snap = describe_rows(...)` line and everything else stays byte-identical).

In `api/routers/screener.py`, the model gains one field:

```python
class ScanSpec(BaseModel):
    filters: list[dict] = []
    sort: dict | None = None
    view: str = "overview"
    columns: list[str] | None = None
    page: int = 1
    page_size: int = 50
```

- [ ] **Step 1: Write the failing tests**

```python
"""Scan projection + strict sort validation."""
import pytest


def _seed(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "AAA", "price": 10.0, "rsi14": 55.0, "uct_composite": 90,
         "sector": "Tech", "snapshot_date": "2026-08-21"},
        {"ticker": "BBB", "price": 20.0, "rsi14": 45.0, "uct_composite": 80,
         "sector": "Tech", "snapshot_date": "2026-08-21"},
    ])


def test_projection_returns_only_requested_plus_ticker_and_sort(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    out = query.run_scan({"columns": ["price"], "sort": {"key": "rsi14", "dir": "desc"}})
    assert out["view_columns"] == ["ticker", "price", "rsi14"]
    assert set(out["rows"][0].keys()) == {"ticker", "price", "rsi14"}
    assert [r["ticker"] for r in out["rows"]] == ["AAA", "BBB"]  # rsi 55 first


def test_unknown_column_is_a_400_shaped_valueerror(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    with pytest.raises(ValueError, match="unknown columns: nope"):
        query.run_scan({"columns": ["nope"]})


def test_unknown_sort_key_no_longer_silently_substitutes(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    with pytest.raises(ValueError, match="unknown sort key"):
        query.run_scan({"sort": {"key": "not_a_column"}})
    # absent sort still defaults quietly — only a WRONG key is refused
    assert query.run_scan({})["rows"]


def test_no_columns_keeps_full_rows_and_view_columns(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    from api.services.screener import query
    out = query.run_scan({"view": "overview"})
    assert "rsi14" in out["rows"][0]          # SELECT * unchanged
    assert out["view_columns"]                 # view echo unchanged
```

- [ ] **Step 2: Run to verify failure** — `python -m pytest tests/test_screener_scan_projection.py -v` → FAIL (projection keys mismatch; no ValueError raised).
- [ ] **Step 3: Implement as shown** (query.py block + ScanSpec field).
- [ ] **Step 4: Run to green** — same file plus `python -m pytest tests/test_screener_query.py tests/test_screener_api.py tests/test_scan_screener_auth.py -v` (no route added, count rail untouched).
- [ ] **Step 5: Commit**

```bash
git add api/services/screener/query.py api/routers/screener.py tests/test_screener_scan_projection.py
git commit -m "screener: scan column projection + strict sort validation"
```

---

### Task 2: specUrl codec — the screen state as a URL

**Files:**
- Create: `app/src/pages/screener/shell/specUrl.js`
- Test: `app/src/pages/screener/shell/specUrl.test.js` (new)

**Interfaces:**
- Produces: `encodeSpec({filters, sort, view, columns}) -> string|null` (null when the spec is the default: no filters, overview view, default sort, no custom columns); `decodeSpec(str) -> {filters, sort, view, columns}|null` (never throws — malformed input returns null); `SPEC_PARAM = 's'`; `DEFAULT_SORT = { key: 'uct_composite', dir: 'desc' }`.
- Consumed by Task 8's `useScreenSpec`. `filters` here is the OBJECT form (`{key: {op,...}}`) the shell holds in state, not the array the API takes.

```js
// The working screen as a URL: refresh/back/forward safe. One codec, no
// second authority — useScreenSpec encodes with this and decodes with this.
// The `screen=` share-token param (screenShareLink.js) is a DIFFERENT door:
// it carries a saved screen's token; `s=` carries this session's working spec.
export const SPEC_PARAM = 's'
export const DEFAULT_SORT = { key: 'uct_composite', dir: 'desc' }
export const DEFAULT_VIEW = 'overview'

const b64url = s => btoa(unescape(encodeURIComponent(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = s => decodeURIComponent(escape(
  atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

const isDefaultSort = sort =>
  !sort || (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir)

export function encodeSpec({ filters = {}, sort, view, columns } = {}) {
  const f = Object.entries(filters).filter(([, v]) => v)
  const payload = {}
  if (f.length) payload.f = Object.fromEntries(f)
  if (!isDefaultSort(sort)) payload.sort = sort
  if (view && view !== DEFAULT_VIEW) payload.view = view
  if (columns?.length) payload.cols = columns
  if (!Object.keys(payload).length) return null
  return b64url(JSON.stringify(payload))
}

export function decodeSpec(str) {
  if (!str) return null
  try {
    const p = JSON.parse(unb64url(str))
    if (!p || typeof p !== 'object') return null
    return {
      filters: p.f && typeof p.f === 'object' && !Array.isArray(p.f) ? p.f : {},
      sort: p.sort?.key ? { key: String(p.sort.key), dir: p.sort.dir === 'asc' ? 'asc' : 'desc' } : { ...DEFAULT_SORT },
      view: typeof p.view === 'string' && p.view ? p.view : DEFAULT_VIEW,
      columns: Array.isArray(p.cols) && p.cols.every(c => typeof c === 'string') && p.cols.length ? p.cols : null,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { encodeSpec, decodeSpec, DEFAULT_SORT } from './specUrl'

describe('specUrl codec', () => {
  it('round-trips a working screen', () => {
    const spec = {
      filters: { rs_rank: { op: 'gte', min: 80 }, sector: { op: 'eq', value: 'Technology' } },
      sort: { key: 'candle_score', dir: 'desc' },
      view: 'momentum',
      columns: ['ticker', 'price', 'candle_score'],
    }
    const out = decodeSpec(encodeSpec(spec))
    expect(out.filters).toEqual(spec.filters)
    expect(out.sort).toEqual(spec.sort)
    expect(out.view).toBe('momentum')
    expect(out.columns).toEqual(spec.columns)
  })

  it('a default screen encodes to null (clean URL)', () => {
    expect(encodeSpec({ filters: {}, sort: { ...DEFAULT_SORT }, view: 'overview', columns: null })).toBeNull()
  })

  it('malformed input never throws', () => {
    expect(decodeSpec('%%%not-base64%%%')).toBeNull()
    expect(decodeSpec(btoa('[1,2,3]'))).toBeNull()
    expect(decodeSpec('')).toBeNull()
  })

  it('decode fills honest defaults for missing halves', () => {
    const only = decodeSpec(encodeSpec({ filters: { price: { op: 'gte', min: 10 } } }))
    expect(only.sort).toEqual(DEFAULT_SORT)
    expect(only.view).toBe('overview')
    expect(only.columns).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd app && npx vitest run src/pages/screener/shell/specUrl.test.js --pool=threads` → FAIL (module missing).
- [ ] **Step 3: Create the module as shown.**
- [ ] **Step 4: Run to green.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/specUrl.js app/src/pages/screener/shell/specUrl.test.js
git commit -m "screener shell: URL spec codec"
```

---

### Task 3: useScreenSpec — one hook owns the screen state

**Files:**
- Create: `app/src/pages/screener/shell/useScreenSpec.js`
- Test: `app/src/pages/screener/shell/useScreenSpec.test.jsx` (new)

**Interfaces:**
- Consumes: Task 2's codec; `SHARED_SCREEN_PARAM`, `sharedScreenReadUrl` from `../screenShareLink`.
- Produces:

```js
useScreenSpec() -> {
  filters,          // {key: {op,...}} object form
  sort, view, columns, page,
  setFilter(key, valOrNull), clearFilters(),
  setSort(updaterOrValue), setView(key), setColumns(listOrNull),
  applySpec(savedSpec),          // from SaveScreenBar / shared arrival
  loadMore(), baseSpec, scanSpec // baseSpec = api-shaped w/o page; scanSpec adds page/page_size/columns
}
```

- URL contract: any state change writes `s=` via debounced (400ms) `history.replaceState` AND strips `screen=` (a locally edited screen is no longer the shared one). `popstate` re-reads the URL. On mount: `s=` wins if present; else a `screen=` token is fetched from the PUBLIC route and applied (never saved) — the existing ScannerPro arrival contract, moved here verbatim.
- Page: any change to filters/sort/view/columns resets page to 1; `loadMore()` increments.
- `PAGE_SIZE = 100`; `REQUIRED_COLS = ['ticker', 'company', 'price', 'chg_pct_1d']` — always unioned into the request's `columns` (phone cards and the live overlay need them even when hidden).

```js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SHARED_SCREEN_PARAM, sharedScreenReadUrl } from '../screenShareLink'
import { SPEC_PARAM, DEFAULT_SORT, DEFAULT_VIEW, encodeSpec, decodeSpec } from './specUrl'

export const PAGE_SIZE = 100
export const REQUIRED_COLS = ['ticker', 'company', 'price', 'chg_pct_1d']

const specToFilters = spec =>
  Object.fromEntries((spec?.filters || []).map(({ key, ...rest }) => [key, rest]))

export default function useScreenSpec({ viewColumnsFor } = {}) {
  const fromUrl = useMemo(
    () => decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM)),
    [], // once, on mount — popstate handles the rest
  )
  const [filters, setFilters] = useState(fromUrl?.filters ?? {})
  const [sort, setSortState] = useState(fromUrl?.sort ?? { ...DEFAULT_SORT })
  const [view, setViewState] = useState(fromUrl?.view ?? DEFAULT_VIEW)
  const [columns, setColumnsState] = useState(fromUrl?.columns ?? null)
  const [page, setPage] = useState(1)

  // ── shared-screen arrival: only when no working spec is in the URL ───────
  useEffect(() => {
    if (fromUrl) return undefined
    const token = new URLSearchParams(window.location.search).get(SHARED_SCREEN_PARAM)
    if (!token) return undefined
    let alive = true
    fetch(sharedScreenReadUrl(token))
      .then(r => (r.ok ? r.json() : null))
      .then(rec => { if (alive && rec?.spec) applySpec(rec.spec) })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── URL write: debounced replaceState; local edits strip `screen=` ───────
  const writeTimer = useRef()
  const skipNextWrite = useRef(false)
  useEffect(() => {
    if (skipNextWrite.current) { skipNextWrite.current = false; return undefined }
    clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      const url = new URL(window.location.href)
      const enc = encodeSpec({ filters, sort, view, columns })
      if (enc) url.searchParams.set(SPEC_PARAM, enc)
      else url.searchParams.delete(SPEC_PARAM)
      url.searchParams.delete(SHARED_SCREEN_PARAM)
      window.history.replaceState(null, '', url)
    }, 400)
    return () => clearTimeout(writeTimer.current)
  }, [filters, sort, view, columns])

  // ── back/forward restores the encoded screen ─────────────────────────────
  useEffect(() => {
    const onPop = () => {
      const dec = decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))
      skipNextWrite.current = true
      setFilters(dec?.filters ?? {})
      setSortState(dec?.sort ?? { ...DEFAULT_SORT })
      setViewState(dec?.view ?? DEFAULT_VIEW)
      setColumnsState(dec?.columns ?? null)
      setPage(1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const resetPage = () => setPage(1)
  const setFilter = useCallback((key, v) => {
    setFilters(prev => {
      const n = { ...prev }
      if (v) n[key] = v
      else delete n[key]
      return n
    })
    setPage(1)
  }, [])
  const clearFilters = useCallback(() => { setFilters({}); setPage(1) }, [])
  const setSort = useCallback(v => { setSortState(v); setPage(1) }, [])
  const setView = useCallback(k => { setViewState(k); setColumnsState(null); setPage(1) }, [])
  const setColumns = useCallback(c => { setColumnsState(c?.length ? c : null); setPage(1) }, [])
  const applySpec = useCallback(s => {
    setFilters(specToFilters(s))
    if (s?.view) setViewState(s.view)
    if (s?.sort) setSortState(s.sort)
    setColumnsState(Array.isArray(s?.columns) && s.columns.length ? s.columns : null)
    setPage(1)
  }, [])
  const loadMore = useCallback(() => setPage(p => p + 1), [])

  const visibleColumns = columns
    ?? (viewColumnsFor ? viewColumnsFor(view) : null)
    ?? null
  const requestColumns = visibleColumns
    ? [...new Set([...REQUIRED_COLS, ...visibleColumns])]
    : null

  const baseSpec = useMemo(() => ({
    filters: Object.entries(filters).filter(([, v]) => v).map(([key, v]) => ({ key, ...v })),
    sort, view, ...(columns?.length ? { columns } : {}),
  }), [filters, sort, view, columns])

  const scanSpec = useMemo(() => ({
    ...baseSpec,
    ...(requestColumns ? { columns: requestColumns } : {}),
    page, page_size: PAGE_SIZE,
  }), [baseSpec, requestColumns, page])

  return { filters, sort, view, columns, visibleColumns, page,
    setFilter, clearFilters, setSort, setView, setColumns, applySpec,
    loadMore, resetPage, baseSpec, scanSpec }
}
```

- [ ] **Step 1: Write the failing tests** (renderHook via `@testing-library/react`):

```jsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useScreenSpec, { REQUIRED_COLS } from './useScreenSpec'
import { encodeSpec, SPEC_PARAM } from './specUrl'

const setUrl = qs => window.history.replaceState(null, '', `/screener${qs ? `?${qs}` : ''}`)

describe('useScreenSpec', () => {
  beforeEach(() => { setUrl(''); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('hydrates from s= on mount', () => {
    const enc = encodeSpec({ filters: { rs_rank: { op: 'gte', min: 80 } }, view: 'momentum' })
    setUrl(`${SPEC_PARAM}=${enc}`)
    const { result } = renderHook(() => useScreenSpec())
    expect(result.current.filters.rs_rank).toEqual({ op: 'gte', min: 80 })
    expect(result.current.view).toBe('momentum')
  })

  it('writes s= (debounced) and strips screen= on a local edit', () => {
    setUrl('screen=tok123')
    const { result } = renderHook(() => useScreenSpec())
    act(() => result.current.setFilter('price', { op: 'gte', min: 10 }))
    act(() => vi.advanceTimersByTime(500))
    const qs = new URLSearchParams(window.location.search)
    expect(qs.get(SPEC_PARAM)).toBeTruthy()
    expect(qs.get('screen')).toBeNull()
  })

  it('a screen= token is fetched from the PUBLIC route and applied, never saved', async () => {
    vi.useRealTimers()
    setUrl('screen=tok123')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(u => {
      calls.push(String(u))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'technical' } }) })
    }))
    const { result } = renderHook(() => useScreenSpec())
    await waitFor(() => expect(result.current.filters.rs_rank).toEqual({ op: 'gte', min: 90 }))
    expect(calls[0]).toContain('/api/screener/shared/tok123')
    expect(calls.some(u => u.includes('/saved-screens'))).toBe(false)
  })

  it('filter/sort/view changes reset the page; loadMore advances it', () => {
    const { result } = renderHook(() => useScreenSpec())
    act(() => result.current.loadMore())
    expect(result.current.page).toBe(2)
    act(() => result.current.setSort({ key: 'price', dir: 'asc' }))
    expect(result.current.page).toBe(1)
  })

  it('scanSpec unions REQUIRED_COLS into custom columns', () => {
    const { result } = renderHook(() => useScreenSpec())
    act(() => result.current.setColumns(['candle_score']))
    for (const c of REQUIRED_COLS) expect(result.current.scanSpec.columns).toContain(c)
    expect(result.current.scanSpec.columns).toContain('candle_score')
    expect(result.current.visibleColumns).toEqual(['candle_score'])
  })
})
```

- [ ] **Step 2: Run to verify failure** → module missing.
- [ ] **Step 3: Create the hook as shown.**
- [ ] **Step 4: Run to green** — this file + `npx vitest run src/pages/screener --pool=threads` (nothing else touched yet).
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/useScreenSpec.js app/src/pages/screener/shell/useScreenSpec.test.jsx
git commit -m "screener shell: useScreenSpec — state, URL round-trip, shared arrival"
```

---

### Task 4: FilterControl — controlled inputs, Enter-to-apply

**Files:**
- Create: `app/src/pages/screener/shell/FilterControl.jsx`
- Create: `app/src/pages/screener/shell/ScannerShell.module.css` (started here; grows in later tasks)
- Test: `app/src/pages/screener/shell/FilterControl.test.jsx`

**Interfaces:**
- Produces: `<FilterControl filter={metaEntry} value={activeSpecOrNull} onChange={(specOrNull) => …} />`. Preset semantics identical to the old FilterPanel (`Any` clears; preset rows carry op/value/min/max). Custom range: CONTROLLED min/max inputs, committed on Enter or blur; clearing both clears the filter. No `document.getElementById` anywhere.

```jsx
import { useEffect, useState } from 'react'
import styles from './ScannerShell.module.css'

const currentLabel = (filter, value, customOpen) => {
  if (customOpen) return 'Custom…'
  if (!value) return 'Any'
  const match = (filter.presets || []).find(o =>
    o.op === value.op && o.value === value.value && o.min === value.min && o.max === value.max)
  return match ? match.label : 'Custom…'
}

export default function FilterControl({ filter, value, onChange }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [minV, setMinV] = useState(value?.min ?? '')
  const [maxV, setMaxV] = useState(value?.max ?? '')

  // A spec applied from outside (saved screen, URL) re-seeds the inputs.
  useEffect(() => { setMinV(value?.min ?? ''); setMaxV(value?.max ?? '') }, [value])

  const commit = (lo = minV, hi = maxV) => {
    const hasMin = lo !== '' && lo != null
    const hasMax = hi !== '' && hi != null
    if (!hasMin && !hasMax) { setCustomOpen(false); onChange(null); return }
    if (hasMin && hasMax) onChange({ op: 'between', min: +lo, max: +hi })
    else if (hasMin) onChange({ op: 'gte', min: +lo })
    else onChange({ op: 'lte', max: +hi })
  }

  const onSelect = label => {
    if (label === 'Custom…') { setCustomOpen(true); return }
    setCustomOpen(false)
    const p = (filter.presets || []).find(o => o.label === label)
    if (!p || label === 'Any') { onChange(null); return }
    const spec = { op: p.op }
    if (p.value !== undefined) spec.value = p.value
    if (p.min !== undefined) spec.min = p.min
    if (p.max !== undefined) spec.max = p.max
    onChange(spec)
  }

  const options = (filter.presets || []).map(p => p.label)
  if (filter.allow_custom && !options.includes('Custom…')) options.push('Custom…')
  const onKey = e => { if (e.key === 'Enter') commit() }

  return (
    <div className={styles.filterRow}>
      <label className={styles.filterLabel} htmlFor={`fc_${filter.key}`}>{filter.label}</label>
      <select id={`fc_${filter.key}`} aria-label={filter.label}
        className={`${styles.filterSelect} ${value ? styles.filterSelectActive : ''}`}
        value={currentLabel(filter, value, customOpen)}
        onChange={e => onSelect(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
      {customOpen && (
        <div className={styles.customRange}>
          <input type="number" placeholder="min" aria-label={`${filter.label} min`}
            value={minV} onChange={e => setMinV(e.target.value)}
            onKeyDown={onKey} onBlur={() => commit()} />
          <input type="number" placeholder="max" aria-label={`${filter.label} max`}
            value={maxV} onChange={e => setMaxV(e.target.value)}
            onKeyDown={onKey} onBlur={() => commit()} />
        </div>
      )}
    </div>
  )
}
```

Module CSS started (tokens only; the rail/table classes land in their tasks):

```css
/* ScannerShell — the third door's flagship surface. Tokens only; numeric text
   is mono; the provenance seal is the one loud element. CQ root for embedded
   mode is .widgetBody (the /charts workspace). */
.filterRow { display: flex; flex-direction: column; gap: 3px; padding: 4px 10px; }
.filterLabel { color: var(--text-muted); font-size: 9.5px; text-transform: uppercase; letter-spacing: var(--ls-label, .5px); }
.filterSelect { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm, 6px); padding: 6px 7px; color: var(--text); font-size: 12px; min-height: 32px; }
.filterSelectActive { border-color: var(--ut-gold); color: var(--ut-gold); }
.customRange { display: flex; gap: 4px; }
.customRange input { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm, 6px); padding: 5px 6px; color: var(--text); width: 100%; font-size: 12px; min-height: 32px; }
```

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterControl from './FilterControl'

const RS = { key: 'rs_rank', label: 'RS Rank', type: 'range', allow_custom: true,
  presets: [{ label: 'Any' }, { label: 'Over 80', op: 'gte', min: 80 }], unit: null }

describe('FilterControl', () => {
  it('preset select emits the preset spec; Any clears', () => {
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Over 80' } })
    expect(onChange).toHaveBeenCalledWith({ op: 'gte', min: 80 })
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Any' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('custom range commits on Enter — controlled, no DOM id pairing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    await user.type(screen.getByLabelText('RS Rank min'), '70')
    await user.type(screen.getByLabelText('RS Rank max'), '95{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ op: 'between', min: 70, max: 95 })
  })

  it('clearing both custom inputs drops the filter and closes the row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FilterControl filter={RS} value={{ op: 'gte', min: 70 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    await user.clear(screen.getByLabelText('RS Rank min'))
    fireEvent.keyDown(screen.getByLabelText('RS Rank min'), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByLabelText('RS Rank min')).toBeNull()
  })

  it('a value applied from outside re-seeds the inputs', () => {
    const { rerender } = render(<FilterControl filter={RS} value={null} onChange={() => {}} />)
    rerender(<FilterControl filter={RS} value={{ op: 'between', min: 60, max: 90 }} onChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('RS Rank'), { target: { value: 'Custom…' } })
    expect(screen.getByLabelText('RS Rank min')).toHaveValue(60)
    expect(screen.getByLabelText('RS Rank max')).toHaveValue(90)
  })
})
```

- [ ] **Step 2: Run to verify failure.** **Step 3: implement.** **Step 4: green.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/FilterControl.jsx app/src/pages/screener/shell/FilterControl.test.jsx app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: controlled FilterControl with Enter-to-apply"
```

---

### Task 5: FilterRail — searchable, collapsible taxonomy

**Files:**
- Create: `app/src/pages/screener/shell/FilterRail.jsx`
- Modify: `app/src/pages/screener/shell/ScannerShell.module.css` (rail classes)
- Test: `app/src/pages/screener/shell/FilterRail.test.jsx`

**Interfaces:**
- Produces: `<FilterRail meta={meta} activeFilters={filters} onChange={setFilter} onClear={clearFilters} variant="rail"|"sheet" />`. Categories come from `meta.categories` (never hardcoded); groups collapsible (persisted per category in `localStorage['uct.screener.rail.<key>']`, default open); each header shows a gold count pip of active filters in the group; a search box filters by filter label (searching auto-expands matching groups and hides empty ones). `variant="sheet"` renders the same data as a touch-first single-column list (44px rows).

```jsx
import { useMemo, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import FilterControl from './FilterControl'
import styles from './ScannerShell.module.css'

const openKey = k => `uct.screener.rail.${k}`
const readOpen = k => { try { return localStorage.getItem(openKey(k)) !== '0' } catch { return true } }

export default function FilterRail({ meta, activeFilters, onChange, onClear, variant = 'rail' }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(() =>
    Object.fromEntries((meta?.categories || []).map(c => [c.key, readOpen(c.key)])))
  if (!meta) return null

  const needle = q.trim().toLowerCase()
  const byCat = useMemo(() => {
    const m = new Map((meta.categories || []).map(c => [c.key, []]))
    for (const f of meta.filters || []) {
      if (needle && !f.label.toLowerCase().includes(needle)) continue
      if (m.has(f.category)) m.get(f.category).push(f)
    }
    return m
  }, [meta, needle])

  const toggle = key => setOpen(prev => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(openKey(key), next[key] ? '1' : '0') } catch { /* private mode */ }
    return next
  })
  const activeIn = key => (meta.filters || [])
    .filter(f => f.category === key && activeFilters[f.key]).length
  const activeTotal = Object.keys(activeFilters).length

  return (
    <div className={variant === 'sheet' ? styles.railSheet : styles.rail} data-testid="filter-rail">
      <div className={styles.railSearchRow}>
        <UIcon name="search" size={12} />
        <input className={styles.railSearch} placeholder="Find a filter…" value={q}
          aria-label="Find a filter" onChange={e => setQ(e.target.value)} />
        {activeTotal > 0 && (
          <button type="button" className={styles.railClear} onClick={onClear}>Clear {activeTotal}</button>
        )}
      </div>
      {(meta.categories || []).map(cat => {
        const list = byCat.get(cat.key) || []
        if (needle && !list.length) return null
        const isOpen = needle ? true : open[cat.key]
        const n = activeIn(cat.key)
        return (
          <section key={cat.key} className={styles.railGroup}>
            <button type="button" className={styles.railHead} aria-expanded={isOpen}
              onClick={() => toggle(cat.key)}>
              <span>{cat.label}</span>
              {n > 0 && <span className={styles.railPip}>{n}</span>}
              <UIcon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} />
            </button>
            {isOpen && list.map(f => (
              <FilterControl key={f.key} filter={f}
                value={activeFilters[f.key] || null}
                onChange={v => onChange(f.key, v)} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
```

Rail CSS additions:

```css
.rail { width: 264px; flex-shrink: 0; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md, 8px); padding-bottom: 8px; }
.railSheet { display: flex; flex-direction: column; }
.railSheet .filterRow { min-height: var(--tap-min, 44px); justify-content: center; }
.railSheet .filterSelect, .railSheet .customRange input { min-height: var(--tap-min, 44px); font-size: 14px; }
.railSearchRow { display: flex; align-items: center; gap: 6px; padding: 10px; position: sticky; top: 0; background: var(--bg-surface); z-index: 2; border-bottom: 1px solid var(--border); }
.railSearch { flex: 1; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm, 6px); padding: 6px 8px; color: var(--text); font-size: 12px; min-width: 0; }
.railClear { background: none; border: none; color: var(--ut-gold); font-size: 11px; cursor: pointer; text-decoration: underline; white-space: nowrap; }
.railGroup { border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.railHead { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: var(--ls-label, .5px); padding: 9px 10px 5px; cursor: pointer; }
.railHead span:first-child { flex: 1; text-align: left; }
.railHead:hover { color: var(--ut-gold); }
.railPip { background: var(--ut-gold); color: var(--bg); border-radius: 8px; padding: 0 5px; font-size: 9px; font-weight: 700; }
```

- [ ] **Step 1: Write the failing tests** — categories render from meta (use a two-category fixture with three filters); collapse hides controls and persists; search narrows to matching labels and force-opens; count pip shows active count; sheet variant renders (smoke: `data-testid` + class).

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterRail from './FilterRail'

const META = {
  categories: [{ key: 'descriptive', label: 'Descriptive' }, { key: 'momentum', label: 'Momentum' }],
  filters: [
    { key: 'price', label: 'Price', category: 'descriptive', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] },
    { key: 'sector', label: 'Sector', category: 'descriptive', type: 'enum', presets: [{ label: 'Any' }] },
    { key: 'pole_pct', label: 'Prior Run (Pole %)', category: 'momentum', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] },
  ],
}

beforeEach(() => localStorage.clear())

describe('FilterRail', () => {
  it('renders every category the server sends — nothing hardcoded', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: /descriptive/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /momentum/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Price')).toBeInTheDocument()
  })

  it('collapsing a group hides its controls and persists', () => {
    const { unmount } = render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /descriptive/i }))
    expect(screen.queryByLabelText('Price')).toBeNull()
    unmount()
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.queryByLabelText('Price')).toBeNull()   // remembered closed
    expect(screen.getByLabelText('Prior Run (Pole %)')).toBeInTheDocument()
  })

  it('search narrows by label and reaches inside collapsed groups', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /momentum/i }))          // collapse
    fireEvent.change(screen.getByLabelText('Find a filter'), { target: { value: 'pole' } })
    expect(screen.getByLabelText('Prior Run (Pole %)')).toBeInTheDocument()     // force-open
    expect(screen.queryByLabelText('Price')).toBeNull()                          // no match
    expect(screen.queryByRole('button', { name: /descriptive/i })).toBeNull()   // empty group hidden
  })

  it('active counts pip the group head and Clear N clears', () => {
    const onClear = vi.fn()
    render(<FilterRail meta={META} activeFilters={{ price: { op: 'gte', min: 10 } }}
      onChange={() => {}} onClear={onClear} />)
    expect(screen.getByRole('button', { name: /descriptive/i })).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: /clear 1/i }))
    expect(onClear).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: fail. Step 3: implement. Step 4: green.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/FilterRail.jsx app/src/pages/screener/shell/FilterRail.test.jsx app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: searchable collapsible filter rail"
```

---

### Task 6: ColumnPicker + loud CSV export helper

**Files:**
- Create: `app/src/pages/screener/shell/ColumnPicker.jsx`
- Create: `app/src/pages/screener/shell/csvExport.js`
- Modify: `app/src/pages/screener/shell/ScannerShell.module.css`
- Test: `app/src/pages/screener/shell/ColumnPicker.test.jsx`, `app/src/pages/screener/shell/csvExport.test.js`

**Interfaces:**
- `<ColumnPicker open onClose allColumns={[{key,label}]} visible={['ticker',…]} onChange={cols => …} onReset={() => …} />` — search box, checkbox per column (`ticker` always checked + disabled), reorder via per-row ▲/▼ buttons (touch-safe and keyboard-accessible; native HTML5 drag additionally wired on the row for desktop). `allColumns` is built by the shell from `COLUMN_DEFS` ∪ the meta's filter/view columns.
- `csvExport.exportScreen({ spec, columns, labels, snapshotDate })` — pages the full set via the existing `fetchAllRows`, downloads, and RETURNS `{ rows: n }`; on ANY failure it THROWS (no silent visible-rows fallback — the caller shows the failure). Reuses `toCsv`/`downloadCsv`/`fetchAllRows` from `../exportCsv` (that module is pure and stays).

```js
// csvExport.js — the loud path. The old ResultsTable silently exported only
// the on-screen rows when the full fetch failed; a member could not tell a
// 5,000-row export from a 100-row fallback. Here failure THROWS and downloads
// nothing — the shell names the failure out loud.
import { toCsv, downloadCsv, fetchAllRows } from '../exportCsv'

export async function exportScreen({ spec, columns, labels = {}, snapshotDate }) {
  const all = await fetchAllRows(spec || {})
  const cols = columns?.length ? columns : (all.view_columns || [])
  if (!all.rows.length) throw new Error('the scan returned no rows to export')
  downloadCsv(`screen_${snapshotDate || 'export'}.csv`, toCsv(all.rows, cols, labels))
  return { rows: all.rows.length, truncated: all.rows.length < (all.total ?? all.rows.length) }
}
```

```jsx
// ColumnPicker.jsx
import { useMemo, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './ScannerShell.module.css'

export default function ColumnPicker({ open, onClose, allColumns, visible, onChange, onReset }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? allColumns.filter(c => c.label.toLowerCase().includes(needle) || c.key.includes(needle))
      : allColumns
  }, [allColumns, q])
  if (!open) return null

  const isOn = key => visible.includes(key)
  const toggleCol = key => {
    if (key === 'ticker') return
    onChange(isOn(key) ? visible.filter(c => c !== key) : [...visible, key])
  }
  const move = (key, delta) => {
    const i = visible.indexOf(key)
    const j = i + delta
    if (i < 0 || j < 0 || j >= visible.length || visible[j] === 'ticker' && j === 0 && delta < 0) return
    if (visible[i] === 'ticker') return
    const next = [...visible]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className={styles.pickerPop} role="dialog" aria-label="Choose columns">
      <div className={styles.pickerHead}>
        <input className={styles.railSearch} placeholder="Find a column…" value={q}
          aria-label="Find a column" onChange={e => setQ(e.target.value)} />
        <button type="button" className={styles.pickerReset} onClick={onReset}>Reset to view</button>
        <button type="button" className={styles.pickerClose} aria-label="Close column picker" onClick={onClose}>
          <UIcon name="close" size={12} />
        </button>
      </div>
      <div className={styles.pickerList}>
        {shown.map(c => (
          <div key={c.key} className={styles.pickerRow}>
            <label className={styles.pickerLabel}>
              <input type="checkbox" checked={isOn(c.key)} disabled={c.key === 'ticker'}
                onChange={() => toggleCol(c.key)} />
              <span>{c.label}</span>
              <span className={styles.pickerKey}>{c.key}</span>
            </label>
            {isOn(c.key) && c.key !== 'ticker' && (
              <span className={styles.pickerMove}>
                <button type="button" aria-label={`Move ${c.label} up`} onClick={() => move(c.key, -1)}>
                  <UIcon name="chevron-up" size={11} />
                </button>
                <button type="button" aria-label={`Move ${c.label} down`} onClick={() => move(c.key, 1)}>
                  <UIcon name="chevron-down" size={11} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

Picker CSS:

```css
.pickerPop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; width: 300px; max-height: 55vh; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-accent); border-radius: var(--radius-md, 8px); box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, .4)); }
.pickerHead { display: flex; gap: 6px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border); }
.pickerReset { background: none; border: none; color: var(--ut-gold); font-size: 11px; cursor: pointer; white-space: nowrap; }
.pickerClose { background: none; border: none; color: var(--text-muted); cursor: pointer; }
.pickerList { overflow-y: auto; padding: 4px 0; }
.pickerRow { display: flex; align-items: center; gap: 4px; padding: 2px 8px; }
.pickerRow:hover { background: var(--bg-hover); }
.pickerLabel { flex: 1; display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text); cursor: pointer; min-height: 26px; }
.pickerKey { color: var(--text-muted); font-size: 10px; font-family: var(--font-mono); }
.pickerMove { display: flex; gap: 2px; }
.pickerMove button { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; }
.pickerMove button:hover { color: var(--ut-gold); }
```

- [ ] **Step 1: Write the failing tests**

```jsx
// ColumnPicker.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ColumnPicker from './ColumnPicker'

const ALL = [
  { key: 'ticker', label: 'Ticker' }, { key: 'price', label: 'Price' },
  { key: 'candle_score', label: 'Score' }, { key: 'pole_pct', label: 'Pole%' },
]

describe('ColumnPicker', () => {
  it('toggles a column on/off; ticker is locked', () => {
    const onChange = vi.fn()
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker', 'price']} onChange={onChange} onReset={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /score/i }))
    expect(onChange).toHaveBeenCalledWith(['ticker', 'price', 'candle_score'])
    expect(screen.getByRole('checkbox', { name: /ticker/i })).toBeDisabled()
  })

  it('reorder buttons move a visible column', () => {
    const onChange = vi.fn()
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker', 'price', 'candle_score']} onChange={onChange} onReset={() => {}} />)
    fireEvent.click(screen.getByLabelText('Move Score up'))
    expect(onChange).toHaveBeenCalledWith(['ticker', 'candle_score', 'price'])
  })

  it('search narrows the list', () => {
    render(<ColumnPicker open onClose={() => {}} allColumns={ALL}
      visible={['ticker']} onChange={() => {}} onReset={() => {}} />)
    fireEvent.change(screen.getByLabelText('Find a column'), { target: { value: 'pole' } })
    expect(screen.getByText('Pole%')).toBeInTheDocument()
    expect(screen.queryByText('Price')).toBeNull()
  })
})
```

```js
// csvExport.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as base from '../exportCsv'
import { exportScreen } from './csvExport'

describe('exportScreen', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('downloads the full set and reports the row count', async () => {
    vi.spyOn(base, 'fetchAllRows').mockResolvedValue({
      rows: [{ ticker: 'AAA', price: 1 }], view_columns: ['ticker', 'price'], total: 1 })
    const dl = vi.spyOn(base, 'downloadCsv').mockImplementation(() => {})
    const out = await exportScreen({ spec: {}, columns: ['ticker', 'price'], snapshotDate: '2026-08-21' })
    expect(out.rows).toBe(1)
    expect(dl).toHaveBeenCalledWith('screen_2026-08-21.csv', expect.stringContaining('AAA'))
  })

  it('a failed fetch THROWS and downloads nothing — no silent partial file', async () => {
    vi.spyOn(base, 'fetchAllRows').mockRejectedValue(new Error('network'))
    const dl = vi.spyOn(base, 'downloadCsv').mockImplementation(() => {})
    await expect(exportScreen({ spec: {} })).rejects.toThrow()
    expect(dl).not.toHaveBeenCalled()
  })
})
```

⚠️ If `vi.spyOn` on the ESM namespace fails (Vite ESM immutability), refactor `csvExport.js` to accept `{ fetcher = fetchAllRows, downloader = downloadCsv }` injection params and test through those — the production call sites pass nothing.

- [ ] **Step 2: fail. Step 3: implement. Step 4: green.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/ColumnPicker.jsx app/src/pages/screener/shell/ColumnPicker.test.jsx app/src/pages/screener/shell/csvExport.js app/src/pages/screener/shell/csvExport.test.js app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: column picker + loud CSV export"
```

---

### Task 7: ShellToolbar — views as presets, density, the provenance seal

**Files:**
- Create: `app/src/pages/screener/shell/ShellToolbar.jsx`
- Modify: `app/src/pages/screener/shell/ScannerShell.module.css`
- Test: `app/src/pages/screener/shell/ShellToolbar.test.jsx`

**Interfaces:**
- Produces:

```jsx
<ShellToolbar
  meta={meta} view={view} onView={setView}
  visibleColumns={visibleColumns} allColumns={allColumns}
  onColumns={setColumns} onResetColumns={() => setColumns(null)}
  density={density} onDensity={setDensity}
  snapshot={result?.snapshot} snapshotDate={result?.snapshot_date}
  total={total} shown={rows.length} isLoading={isLoading}
  onExport={handleExport} exportState={{ busy, note, error }}
  saveBar={<SaveScreenBar currentSpec={baseSpec} onApply={applySpec} />}
/>
```

- View buttons render from `meta.views`; clicking one calls `onView` (which resets custom columns — a view IS a column preset). The **provenance seal** is a `<button>` styled as a stamped mono tag showing `snapshotDate`; clicking opens the popover rendering the snapshot object: `N rows · most built 2026-08-21 (3,540 of 3,742) · oldest 2026-08-19 · newest 2026-08-21 · 3 without a date` and, when `mixed`, the line `Mixed snapshot — not every row was rebuilt the same night.` Export button shows busy state; `exportState.note`/`error` render in an `aria-live="polite"` strip.

```jsx
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import ColumnPicker from './ColumnPicker'
import styles from './ScannerShell.module.css'

function Seal({ snapshot, snapshotDate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!snapshotDate) return null
  return (
    <span className={styles.sealWrap} ref={ref}>
      <button type="button" className={styles.seal} aria-expanded={open}
        aria-label={`Snapshot ${snapshotDate} — data provenance`}
        onClick={() => setOpen(o => !o)}>
        <UIcon name="check" size={10} /> {snapshotDate}
      </button>
      {open && snapshot && (
        <div className={styles.sealPop} role="dialog" aria-label="Snapshot provenance">
          <div className={styles.sealRow}><span>Rows served</span><b>{snapshot.rows?.toLocaleString()}</b></div>
          <div className={styles.sealRow}><span>Most built</span>
            <b>{snapshot.snapshot_date} ({snapshot.rows_on_snapshot_date?.toLocaleString()})</b></div>
          <div className={styles.sealRow}><span>Oldest / newest</span>
            <b>{snapshot.oldest_snapshot_date || '—'} / {snapshot.newest_snapshot_date || '—'}</b></div>
          {snapshot.rows_missing_snapshot_date > 0 && (
            <div className={styles.sealRow}><span>No date</span><b>{snapshot.rows_missing_snapshot_date}</b></div>
          )}
          {snapshot.mixed && (
            <p className={styles.sealMixed}>Mixed snapshot — not every row was rebuilt the same night.</p>
          )}
        </div>
      )}
    </span>
  )
}

export default function ShellToolbar({ meta, view, onView, visibleColumns, allColumns,
  onColumns, onResetColumns, density, onDensity, snapshot, snapshotDate,
  total, shown, isLoading, onExport, exportState, saveBar }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div className={styles.toolbar}>
      <div className={styles.viewTabs} role="tablist" aria-label="Column views">
        {(meta?.views || []).map(v => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
            className={`${styles.viewTab} ${view === v.key ? styles.viewTabOn : ''}`}
            onClick={() => onView(v.key)}>{v.label}</button>
        ))}
      </div>
      <span className={styles.statusLine} aria-live="polite">
        {isLoading && !shown ? 'Scanning…' : `${(total ?? 0).toLocaleString()} matches`}
      </span>
      <Seal snapshot={snapshot} snapshotDate={snapshotDate} />
      <span className={styles.toolGroup}>
        <span className={styles.pickerAnchor}>
          <button type="button" className={styles.toolBtn} aria-label="Choose columns"
            aria-expanded={pickerOpen} onClick={() => setPickerOpen(o => !o)}>
            <UIcon name="columns" size={13} /> Columns
          </button>
          <ColumnPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
            allColumns={allColumns} visible={visibleColumns}
            onChange={onColumns} onReset={() => { onResetColumns(); setPickerOpen(false) }} />
        </span>
        <button type="button" className={styles.toolBtn}
          aria-label={`Density: ${density}`} aria-pressed={density === 'compact'}
          onClick={() => onDensity(density === 'compact' ? 'comfortable' : 'compact')}>
          <UIcon name="rows" size={13} />
        </button>
        <button type="button" className={styles.toolBtn} disabled={exportState?.busy} onClick={onExport}>
          <UIcon name="download" size={13} /> {exportState?.busy ? 'Exporting…' : 'CSV'}
        </button>
        {saveBar}
      </span>
      {(exportState?.note || exportState?.error) && (
        <span role="status" className={exportState.error ? styles.exportErr : styles.exportNote}>
          {exportState.error || exportState.note}
        </span>
      )}
    </div>
  )
}
```

Toolbar + seal CSS:

```css
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 8px; background: var(--bg); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 3; }
.viewTabs { display: flex; gap: 4px; flex-wrap: wrap; }
.viewTab { padding: 5px 11px; border-radius: var(--radius-sm, 6px); background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; min-height: 30px; }
.viewTabOn { background: var(--bg-elevated); border-color: var(--ut-gold); color: var(--ut-gold); }
.statusLine { color: var(--text-muted); font-size: 12px; margin-left: auto; }
.toolGroup { display: flex; gap: 6px; align-items: center; }
.toolBtn { display: inline-flex; align-items: center; gap: 5px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm, 6px); color: var(--text); padding: 5px 10px; font-size: 12px; cursor: pointer; min-height: 30px; }
.toolBtn:hover { border-color: var(--ut-gold); color: var(--ut-gold); }
.toolBtn:disabled { opacity: .5; cursor: default; }
.pickerAnchor { position: relative; display: inline-block; }
.exportNote { color: var(--gain); font-size: 11.5px; }
.exportErr { color: var(--loss); font-size: 11.5px; }

/* ── the provenance seal: the one loud element ── */
.sealWrap { position: relative; display: inline-block; }
.seal { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 11px; letter-spacing: .4px; color: var(--text-bright); background: var(--bg-elevated); border: 1px solid var(--border); border-left: 2px solid var(--ut-gold); border-radius: 0 var(--radius-sm, 6px) var(--radius-sm, 6px) 0; padding: 4px 9px; cursor: pointer; min-height: 26px; }
.seal:hover { border-color: var(--ut-gold); }
.sealPop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; width: 260px; background: var(--bg-surface); border: 1px solid var(--border-accent); border-left: 2px solid var(--ut-gold); border-radius: 0 var(--radius-md, 8px) var(--radius-md, 8px) 0; box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, .4)); padding: 10px 12px; }
.sealRow { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--text-muted); padding: 2px 0; }
.sealRow b { color: var(--text-bright); font-family: var(--font-mono); font-weight: 600; }
.sealMixed { margin: 6px 0 0; color: var(--ut-gold); font-size: 11px; line-height: 1.5; }
```

- [ ] **Step 1: Write the failing tests** — views render from meta and select; seal renders the date and opens the provenance popover (mixed line present iff `mixed`); density button flips and carries `aria-pressed`; export busy state disables; error strip renders under `role="status"`.

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShellToolbar from './ShellToolbar'

const META = { views: [{ key: 'overview', label: 'Overview' }, { key: 'momentum', label: 'Momentum' }] }
const SNAP = { rows: 3742, snapshot_date: '2026-08-21', rows_on_snapshot_date: 3540,
  oldest_snapshot_date: '2026-08-19', newest_snapshot_date: '2026-08-21',
  rows_missing_snapshot_date: 0, mixed: true }
const base = {
  meta: META, view: 'overview', onView: vi.fn(), visibleColumns: ['ticker'], allColumns: [],
  onColumns: vi.fn(), onResetColumns: vi.fn(), density: 'compact', onDensity: vi.fn(),
  snapshot: SNAP, snapshotDate: '2026-08-21', total: 120, shown: 100, isLoading: false,
  onExport: vi.fn(), exportState: {}, saveBar: <span>savebar</span>,
}

describe('ShellToolbar', () => {
  it('views come from meta and select through onView', () => {
    render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Momentum' }))
    expect(base.onView).toHaveBeenCalledWith('momentum')
  })

  it('the seal opens the provenance popover and says when the snapshot is mixed', () => {
    render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    expect(screen.getByRole('dialog', { name: /provenance/i })).toHaveTextContent(/3,540/)
    expect(screen.getByText(/mixed snapshot/i)).toBeInTheDocument()
  })

  it('density toggles with aria-pressed; export error is a status', () => {
    render(<ShellToolbar {...base} exportState={{ error: 'Export failed — nothing downloaded.' }} />)
    expect(screen.getByRole('button', { name: /density/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/nothing downloaded/i)
  })
})
```

- [ ] **Step 2: fail. Step 3: implement. Step 4: green.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/ShellToolbar.jsx app/src/pages/screener/shell/ShellToolbar.test.jsx app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: toolbar with view presets, density, provenance seal"
```

---

### Task 8: VirtualResults — the virtualized grid-table

**Files:**
- Create: `app/src/pages/screener/shell/VirtualResults.jsx`
- Create: `app/src/pages/screener/shell/liveSort.js`
- Modify: `app/src/pages/screener/shell/ScannerShell.module.css`
- Test: `app/src/pages/screener/shell/VirtualResults.test.jsx`, `app/src/pages/screener/shell/liveSort.test.js`

**Interfaces:**
- `<VirtualResults rows columns sort onSort livePrices liveSortOn density hasMore onLoadMore isLoading virtualOpts />` — an ARIA grid (`role="table"/"row"/"columnheader"/"cell"`) built on `useVirtualizer` from `@tanstack/react-virtual`. Rows are absolutely positioned by `top` (never `transform` — a transformed ancestor breaks the sticky first column). Sticky header row (top) and sticky ticker column (left). Headers are `<button>`s inside `role="columnheader"` cells carrying `aria-sort`. Heat/format from `COLUMN_DEFS` (unknown key → raw). Live overlay only patches `price` / `chg_pct_1d` cells; the ticker cell carries a live dot: filled gold when `livePrices[ticker]` exists, hollow (`.dotStatic`, `title="beyond the live window"`) otherwise. `LIVE_WINDOW = 300` — rows past it are by construction hollow. When the virtualizer's last visible index reaches `rows.length - 20` and `hasMore && !isLoading`, `onLoadMore()` fires (plus the explicit button at the end).
- `liveSort.js`: `sortRowsLive(rows, sort, livePrices) -> rows` — pure; stable copy sorted by the LIVE value for `price`/`chg_pct_1d` (falling back to the row value), used only when the toggle is on. `LIVE_SORTABLE = new Set(['price', 'chg_pct_1d'])`.
- `virtualOpts` is spread into `useVirtualizer` — tests pass `{ initialRect: { width: 1200, height: 800 } }` so jsdom (zero-height) renders rows.

```js
// liveSort.js
export const LIVE_SORTABLE = new Set(['price', 'chg_pct_1d'])

const liveVal = (row, key, lp) => {
  if (key === 'price' && lp?.price != null) return lp.price
  if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
  return row[key]
}

export function sortRowsLive(rows, sort, livePrices) {
  if (!sort?.key || !LIVE_SORTABLE.has(sort.key)) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = liveVal(a, sort.key, livePrices?.[a.ticker])
    const bv = liveVal(b, sort.key, livePrices?.[b.ticker])
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return av === bv ? 0 : av > bv ? dir : -dir
  })
}
```

```jsx
// VirtualResults.jsx
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import TickerPopup from '../../../components/TickerPopup'
import TickerActionsMenu, { useTickerActions } from '../../../components/TickerActions'
import PatternFeedbackChip from '../../../components/PatternFeedbackChip'
import { COLUMN_DEFS } from '../columnDefs'
import { sortRowsLive } from './liveSort'
import styles from './ScannerShell.module.css'

export const LIVE_WINDOW = 300
const ROW_H = { compact: 30, comfortable: 38 }
const colWidth = key =>
  key === 'ticker' ? '108px'
  : key === 'company' ? 'minmax(150px, 1.4fr)'
  : ['sector', 'industry', 'theme', 'patterns'].includes(key) ? 'minmax(120px, 1fr)'
  : '92px'

export default function VirtualResults({ rows, columns, sort, onSort, livePrices,
  liveSortOn, density = 'compact', view, hasMore, onLoadMore, isLoading, virtualOpts }) {
  const ta = useTickerActions()
  const scrollRef = useRef(null)
  const displayRows = liveSortOn ? sortRowsLive(rows, sort, livePrices) : rows
  const rowH = ROW_H[density] || ROW_H.compact

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 12,
    ...(virtualOpts || {}),
  })
  const items = virtualizer.getVirtualItems()

  // auto-append near the end (the explicit button below remains)
  const last = items[items.length - 1]
  useEffect(() => {
    if (!last) return
    if (hasMore && !isLoading && last.index >= displayRows.length - 20) onLoadMore()
  }, [last?.index, hasMore, isLoading, displayRows.length, onLoadMore])

  const gridCols = columns.map(colWidth).join(' ')
  const toggleSort = key => onSort(s => s && s.key === key
    ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' })
  const ariaSort = key => sort?.key === key
    ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'

  const cellValue = (row, key) => {
    const lp = livePrices?.[row.ticker]
    if (key === 'price' && lp?.price != null) return lp.price
    if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
    return row[key]
  }

  return (
    <div className={styles.gridScroll} ref={scrollRef} data-density={density}>
      <div role="table" aria-label="Scan results" aria-rowcount={displayRows.length}
        className={styles.grid} style={{ '--grid-cols': gridCols }}>
        <div role="row" className={`${styles.gridRow} ${styles.gridHead}`}>
          {columns.map(c => (
            <div role="columnheader" aria-sort={ariaSort(c)} key={c}
              className={`${styles.hcell} ${c === 'ticker' ? styles.stickyCol : ''}`}>
              <button type="button" className={styles.hbtn} onClick={() => toggleSort(c)}>
                {COLUMN_DEFS[c]?.label || c}
                {sort?.key === c && <span aria-hidden="true">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span>}
              </button>
            </div>
          ))}
        </div>
        <div className={styles.gridBody} style={{ height: virtualizer.getTotalSize() }}>
          {items.map(vi => {
            const row = displayRows[vi.index]
            const live = !!livePrices?.[row.ticker]
            return (
              <div role="row" key={row.ticker} className={styles.gridRow}
                style={{ position: 'absolute', top: vi.start, left: 0, right: 0, height: vi.size }}>
                {columns.map(c => {
                  if (c === 'ticker') {
                    return (
                      <div role="cell" key={c} className={`${styles.cell} ${styles.symCell} ${styles.stickyCol}`}>
                        <span className={live ? styles.dotLive : styles.dotStatic}
                          title={live ? 'live price' : 'beyond the live window — snapshot values'} />
                        <span {...ta.longPressProps(row.ticker)}>
                          <TickerPopup sym={row.ticker}>{row.ticker}</TickerPopup>
                        </span>
                        <PatternFeedbackChip ticker={row.ticker}
                          setup={`scan:${view || 'screener'}`} source="scanner" compact />
                      </div>
                    )
                  }
                  const def = COLUMN_DEFS[c] || { fmt: v => v ?? '—' }
                  const val = cellValue(row, c)
                  const heat = def.heat ? def.heat(val) : ''
                  const cls = heat === 'g' ? styles.heatG : heat === 'g1' ? styles.heatG1
                    : heat === 'r' ? styles.heatR : ''
                  return (
                    <div role="cell" key={c} className={`${styles.cell} ${styles.numCell} ${cls}`}>
                      {def.fmt(val, row)}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {hasMore && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? 'Loading…' : `Load more (${rows.length.toLocaleString()} loaded)`}
          </button>
        </div>
      )}
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}
```

Grid CSS:

```css
.gridScroll { flex: 1; min-height: 0; overflow: auto; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md, 8px); position: relative; }
.grid { min-width: max-content; }
.gridRow { display: grid; grid-template-columns: var(--grid-cols); align-items: stretch; }
.gridHead { position: sticky; top: 0; z-index: 4; background: var(--bg); border-bottom: 1px solid var(--border); }
.gridBody { position: relative; }
.hcell { padding: 0; }
.hbtn { width: 100%; text-align: left; background: none; border: none; color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: var(--ls-label, .5px); padding: 7px 9px; cursor: pointer; white-space: nowrap; }
.hbtn:hover, .hbtn:focus-visible { color: var(--ut-gold); }
.cell { display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--bg-surface); }
.numCell { font-family: var(--font-mono); font-size: 11.5px; }
.gridRow:hover .cell { background: var(--bg-hover); }
.stickyCol { position: sticky; left: 0; z-index: 2; }
.gridHead .stickyCol { z-index: 5; background: var(--bg); }
.symCell { color: var(--ut-gold); font-weight: 600; gap: 6px; }
.dotLive, .dotStatic { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dotLive { background: var(--ut-gold); }
.dotStatic { border: 1px solid var(--text-muted); background: transparent; }
.heatG { background: var(--gain-bg); color: var(--gain); }
.heatG1 { background: var(--gain-bg); }
.heatR { background: var(--loss-bg); color: var(--loss); }
.loadMoreRow { display: flex; justify-content: center; padding: 12px; }
.loadMoreBtn { background: var(--bg-elevated); border: 1px solid var(--border-accent); border-radius: var(--radius-sm, 6px); color: var(--ut-gold); padding: 8px 18px; font-size: 12.5px; cursor: pointer; min-height: 36px; }
.loadMoreBtn:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 1: Write the failing tests** (pass `virtualOpts={{ initialRect: { width: 1200, height: 800 } }}` in every render):

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VirtualResults from './VirtualResults'
import { sortRowsLive } from './liveSort'

vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))

const rows = Array.from({ length: 500 }, (_, i) => ({
  ticker: `T${String(i).padStart(3, '0')}`, company: `Co ${i}`, price: 10 + i, chg_pct_1d: i % 7 - 3 }))
const base = {
  rows, columns: ['ticker', 'company', 'price', 'chg_pct_1d'],
  sort: { key: 'price', dir: 'desc' }, onSort: vi.fn(), livePrices: {},
  liveSortOn: false, density: 'compact', hasMore: false, onLoadMore: vi.fn(),
  isLoading: false, virtualOpts: { initialRect: { width: 1200, height: 800 } },
}

describe('VirtualResults', () => {
  it('virtualizes: renders a window, not 500 rows', () => {
    render(<VirtualResults {...base} />)
    const rendered = screen.getAllByRole('row')
    expect(rendered.length).toBeGreaterThan(10)
    expect(rendered.length).toBeLessThan(120)          // window + overscan, never the full set
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '500')
  })

  it('headers carry aria-sort and toggle through onSort', () => {
    render(<VirtualResults {...base} />)
    const hdr = screen.getAllByRole('columnheader').find(h => h.textContent.includes('Price'))
    expect(hdr).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(hdr.querySelector('button'))
    expect(base.onSort).toHaveBeenCalled()
  })

  it('live dot is filled for subscribed tickers, hollow past the window', () => {
    render(<VirtualResults {...base} livePrices={{ T000: { price: 99, change_pct: 1 } }} />)
    const firstRow = screen.getAllByRole('row')[1]
    expect(firstRow.querySelector('[title="live price"]')).toBeTruthy()
    const second = screen.getAllByRole('row')[2]
    expect(second.querySelector('[title*="beyond the live window"]')).toBeTruthy()
  })
})

describe('sortRowsLive', () => {
  it('re-sorts loaded rows by live values, nulls last, original array untouched', () => {
    const r = [{ ticker: 'A', price: 1 }, { ticker: 'B', price: 2 }]
    const out = sortRowsLive(r, { key: 'price', dir: 'desc' }, { A: { price: 100 } })
    expect(out.map(x => x.ticker)).toEqual(['A', 'B'])
    expect(r[0].ticker).toBe('A')                       // pure
    const asc = sortRowsLive(r, { key: 'price', dir: 'asc' }, { A: { price: 100 } })
    expect(asc.map(x => x.ticker)).toEqual(['B', 'A'])
  })

  it('non-live sort keys pass through untouched', () => {
    const r = [{ ticker: 'A' }, { ticker: 'B' }]
    expect(sortRowsLive(r, { key: 'rs_rank', dir: 'desc' }, {})).toBe(r)
  })
})
```

- [ ] **Step 2: fail. Step 3: implement. Step 4: green.**
- [ ] **Step 5: Manual check (dev):** temporary story or the Task 10 shell — scroll horizontally: ticker column stays pinned; scroll vertically: header stays pinned. (Sticky-left depends on rows using `top`, never `transform` — if the column drifts, that is the regression.)
- [ ] **Step 6: Commit**

```bash
git add app/src/pages/screener/shell/VirtualResults.jsx app/src/pages/screener/shell/VirtualResults.test.jsx app/src/pages/screener/shell/liveSort.js app/src/pages/screener/shell/liveSort.test.js app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: virtualized results grid with sticky ticker column"
```

---

### Task 9: ResultCards — the phone mode

**Files:**
- Create: `app/src/pages/screener/shell/ResultCards.jsx`
- Modify: `app/src/pages/screener/shell/ScannerShell.module.css`
- Test: `app/src/pages/screener/shell/ResultCards.test.jsx`

**Interfaces:**
- `<ResultCards rows columns livePrices hasMore onLoadMore isLoading virtualOpts />` — virtualized card list (row height 64/estimate). Line 1: live dot + ticker (TickerPopup + long-press actions) + company (truncated) + price / chg% right-aligned (live-overlaid, gain/loss colored). Line 2: the first THREE visible non-`REQUIRED_COLS` columns as `label value` stats (picker-driven by construction). Cards are full-width; tap targets ≥ `--tap-min`.

```jsx
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import TickerPopup from '../../../components/TickerPopup'
import TickerActionsMenu, { useTickerActions } from '../../../components/TickerActions'
import { COLUMN_DEFS } from '../columnDefs'
import { REQUIRED_COLS } from './useScreenSpec'
import styles from './ScannerShell.module.css'

export default function ResultCards({ rows, columns, livePrices,
  hasMore, onLoadMore, isLoading, virtualOpts }) {
  const ta = useTickerActions()
  const scrollRef = useRef(null)
  const statCols = columns.filter(c => !REQUIRED_COLS.includes(c)).slice(0, 3)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    ...(virtualOpts || {}),
  })
  return (
    <div className={styles.cardsScroll} ref={scrollRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vi => {
          const row = rows[vi.index]
          const lp = livePrices?.[row.ticker]
          const price = lp?.price ?? row.price
          const chg = lp?.change_pct ?? row.chg_pct_1d
          return (
            <div key={row.ticker} className={styles.card}
              style={{ position: 'absolute', top: vi.start, left: 0, right: 0 }}>
              <div className={styles.cardTop}>
                <span className={lp ? styles.dotLive : styles.dotStatic} />
                <span {...ta.longPressProps(row.ticker)} className={styles.cardSym}>
                  <TickerPopup sym={row.ticker}>{row.ticker}</TickerPopup>
                </span>
                <span className={styles.cardCompany}>{row.company || ''}</span>
                <span className={styles.cardPx}>
                  {price != null ? `$${Number(price).toFixed(2)}` : '—'}
                  <span className={chg == null ? '' : chg >= 0 ? styles.pos : styles.neg}>
                    {chg == null ? '' : ` ${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%`}
                  </span>
                </span>
              </div>
              <div className={styles.cardStats}>
                {statCols.map(c => {
                  const def = COLUMN_DEFS[c] || { label: c, fmt: v => v ?? '—' }
                  return (
                    <span key={c} className={styles.cardStat}>
                      <span className={styles.cardStatLabel}>{def.label}</span>
                      <span className={styles.cardStatVal}>{def.fmt(row[c], row)}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {hasMore && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}
```

Card CSS (inside the existing phone media query discipline — 640 only):

```css
.cardsScroll { flex: 1; min-height: 0; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md, 8px); }
.card { display: flex; flex-direction: column; gap: 4px; padding: 9px 12px; border-bottom: 1px solid var(--border); min-height: var(--tap-min, 44px); }
.cardTop { display: flex; align-items: center; gap: 8px; }
.cardSym { color: var(--ut-gold); font-weight: 700; font-size: 14px; }
.cardCompany { flex: 1; color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cardPx { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-bright); }
.cardStats { display: flex; gap: 14px; }
.cardStat { display: flex; gap: 5px; align-items: baseline; }
.cardStatLabel { color: var(--text-muted); font-size: 9.5px; text-transform: uppercase; letter-spacing: var(--ls-label, .5px); }
.cardStatVal { font-family: var(--font-mono); font-size: 11.5px; color: var(--text); }
.pos { color: var(--gain); }
.neg { color: var(--loss); }
```

- [ ] **Step 1: Failing tests** — line 1 carries ticker/price/live chg; line 2 renders exactly three picker-driven stats (given columns `['ticker','company','price','chg_pct_1d','candle_score','pole_pct','rs_rank','adr_pct']` expect `candle_score`, `pole_pct`, `rs_rank` labels and NOT `adr_pct`); live overlay patches price. Same TickerPopup/TickerActions mocks and `virtualOpts` as Task 8.
- [ ] **Step 2: fail. Step 3: implement. Step 4: green. Step 5: Commit**

```bash
git add app/src/pages/screener/shell/ResultCards.jsx app/src/pages/screener/shell/ResultCards.test.jsx app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: phone card mode"
```

---

### Task 10: ScannerShell — the orchestrator, states, embedded mode

**Files:**
- Create: `app/src/pages/screener/shell/ScannerShell.jsx`
- Modify: `app/src/pages/screener/shell/ScannerShell.module.css`
- Test: `app/src/pages/screener/shell/ScannerShell.test.jsx`

**Interfaces:**
- `<ScannerShell embedded={bool} />` — the drop-in replacement for ScannerPro (same prop). Composes: `useScreenerMeta` + `useScreenSpec` + `useScreenerScan` (both hooks reused as-is) + `useRealtimePrices` (first `LIVE_WINDOW` tickers) + `FilterRail`/`FiltersSheet` + `FilterChips` + `ShellToolbar` + `VirtualResults`/`ResultCards`/`ChartsGallery` + `SaveScreenBar`.
- Layout: desktop = rail beside results; phone (`useIsPhone`) or narrow container = Filters button → `FiltersSheet` with `<FilterRail variant="sheet">`. The narrow-container collapse is CSS (`@container (max-width: 900px)` hides `.rail`, shows `.railToggle`) so the /charts widget behaves without JS resize logic; the toggle also exists on tablet.
- States, all present at once by construction: initial load → `SkeletonRows` (12 shimmer rows, reuse `SkeletonTable` from `../../../components/Skeleton` with `rows={12} cols={6}`); empty → message INSIDE the results area, toolbar stays mounted and usable; error → the existing `.scanError` banner idiom with a Retry button (`retry()` = re-set page state to force a refetch: `setSort({...sort})`); page-append → button spinner (Task 8). Live-sort toggle + "snapshot order" chip: when `sort.key` is live-overlaid and the toggle is OFF, a small chip beside the toolbar status says `snapshot order`; the toggle button `aria-pressed` flips `liveSortOn`.
- CSV: `handleExport` wraps `exportScreen` — success sets `note = "Exported 1,204 rows"` (+ `" (capped at 5,000)"` when truncated), failure sets `error = "Export failed — nothing downloaded. Try again."`; both clear after 6s.

```jsx
import { useEffect, useMemo, useState } from 'react'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import { prefetchBars } from '../../../utils/prefetchBars'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { FiltersSheet } from '../../../components/mobile'
import { SkeletonTable } from '../../../components/Skeleton'
import UIcon from '../../../components/ui/UIcon'
import useScreenerMeta from '../hooks/useScreenerMeta'
import useScreenerScan from '../hooks/useScreenerScan'
import FilterChips from '../FilterChips'
import ChartsGallery from '../ChartsGallery'
import SaveScreenBar from '../SaveScreenBar'
import { COLUMN_DEFS } from '../columnDefs'
import useScreenSpec from './useScreenSpec'
import FilterRail from './FilterRail'
import ShellToolbar from './ShellToolbar'
import VirtualResults, { LIVE_WINDOW } from './VirtualResults'
import ResultCards from './ResultCards'
import { exportScreen } from './csvExport'
import { LIVE_SORTABLE } from './liveSort'
import styles from './ScannerShell.module.css'

const densityKey = 'uct.screener.density'

export default function ScannerShell({ embedded = false }) {
  const { meta } = useScreenerMeta()
  const isPhone = useIsPhone()
  const viewColumnsFor = useMemo(() => {
    const map = Object.fromEntries((meta?.views || []).map(v => [v.key, v.columns]))
    return key => map[key] || map.overview || null
  }, [meta])
  const s = useScreenSpec({ viewColumnsFor })
  // Retry must change the spec's JSON or useScreenerScan's key-diff refires
  // nothing. `_retry` rides the spec; Pydantic v2 ignores unknown fields, so
  // the server never sees it as anything but noise. Zero is omitted so the
  // steady-state spec (and the URL codec, which never reads it) is untouched.
  const [retryNonce, setRetryNonce] = useState(0)
  const scanSpec = useMemo(
    () => (retryNonce ? { ...s.scanSpec, _retry: retryNonce } : s.scanSpec),
    [s.scanSpec, retryNonce])
  const { result, isLoading, error } = useScreenerScan(scanSpec)

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!result) return
    setTotal(result.total)
    setRows(prev => (result.page === 1 ? result.rows : [...prev, ...result.rows]))
  }, [result])

  const liveTickers = useMemo(() => rows.slice(0, LIVE_WINDOW).map(r => r.ticker), [rows])
  const { prices } = useRealtimePrices(liveTickers)
  useEffect(() => { if (rows.length) prefetchBars(rows.slice(0, 30).map(r => r.ticker), 'D') }, [rows])

  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem(densityKey) || 'compact' } catch { return 'compact' }
  })
  const onDensity = d => { setDensity(d); try { localStorage.setItem(densityKey, d) } catch { /* ok */ } }
  const [liveSortOn, setLiveSortOn] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exportState, setExportState] = useState({})

  const visibleColumns = s.visibleColumns || ['ticker']
  const allColumns = useMemo(() => {
    const keys = new Set(Object.keys(COLUMN_DEFS))
    for (const v of meta?.views || []) v.columns.forEach(c => keys.add(c))
    for (const f of meta?.filters || []) if (f.column) keys.add(f.column)
    return [...keys].map(k => ({ key: k, label: COLUMN_DEFS[k]?.label || k }))
  }, [meta])

  const handleExport = async () => {
    setExportState({ busy: true })
    try {
      const labels = Object.fromEntries(visibleColumns.map(c => [c, COLUMN_DEFS[c]?.label || c]))
      const out = await exportScreen({ spec: { ...s.baseSpec, columns: visibleColumns },
        columns: visibleColumns, labels, snapshotDate: result?.snapshot_date })
      setExportState({ note: `Exported ${out.rows.toLocaleString()} rows${out.truncated ? ' (capped at 5,000)' : ''}` })
    } catch {
      setExportState({ error: 'Export failed — nothing downloaded. Try again.' })
    } finally {
      setTimeout(() => setExportState({}), 6000)
    }
  }

  const retry = () => setRetryNonce(n => n + 1)
  const isEmpty = result && total === 0
  const hasMore = rows.length < total
  const liveSortEligible = LIVE_SORTABLE.has(s.sort?.key)
  const rail = meta && (
    <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
      onClear={s.clearFilters} variant={isPhone ? 'sheet' : 'rail'} />
  )

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ''}`}>
      {!isPhone && <div className={styles.railSlot}>{rail}</div>}
      <div className={styles.main}>
        <ShellToolbar meta={meta} view={s.view} onView={s.setView}
          visibleColumns={visibleColumns} allColumns={allColumns}
          onColumns={s.setColumns} onResetColumns={() => s.setColumns(null)}
          density={density} onDensity={onDensity}
          snapshot={result?.snapshot} snapshotDate={result?.snapshot_date}
          total={total} shown={rows.length} isLoading={isLoading}
          onExport={handleExport} exportState={exportState}
          saveBar={<SaveScreenBar currentSpec={s.baseSpec} onApply={s.applySpec} />} />
        <div className={styles.underbar}>
          <button type="button" className={styles.railToggle} onClick={() => setSheetOpen(true)}>
            <UIcon name="gear" size={12} /> Filters{Object.keys(s.filters).length ? ` · ${Object.keys(s.filters).length}` : ''}
          </button>
          <FilterChips meta={meta} activeFilters={s.filters}
            onRemove={key => s.setFilter(key, null)} onClear={s.clearFilters} />
          {liveSortEligible && (
            <span className={styles.sortHonesty}>
              {!liveSortOn && <span className={styles.snapChip}>snapshot order</span>}
              <button type="button" className={styles.toolBtn} aria-pressed={liveSortOn}
                onClick={() => setLiveSortOn(v => !v)}>
                <UIcon name="bolt" size={11} /> Re-sort loaded rows live
              </button>
            </span>
          )}
        </div>
        {error && (
          <div className={styles.scanError} role="alert">
            Scan failed — {String(error.message || error)}.
            <button type="button" className={styles.retryBtn} onClick={retry}>Retry</button>
          </div>
        )}
        {!result && isLoading ? (
          <SkeletonTable rows={12} cols={6} />
        ) : isEmpty ? (
          <div className={styles.empty}>
            No stocks match the current filters. Remove a chip above or Reset — the
            toolbar and views stay live.
          </div>
        ) : s.view === 'charts' ? (
          <div className={styles.gridScroll}>
            <ChartsGallery rows={rows} livePrices={prices} />
            {hasMore && (
              <div className={styles.loadMoreRow}>
                <button type="button" className={styles.loadMoreBtn} disabled={isLoading}
                  onClick={s.loadMore}>{isLoading ? 'Loading…' : 'Load more'}</button>
              </div>
            )}
          </div>
        ) : isPhone ? (
          <ResultCards rows={rows} columns={visibleColumns} livePrices={prices}
            hasMore={hasMore} onLoadMore={s.loadMore} isLoading={isLoading} />
        ) : (
          <VirtualResults rows={rows} columns={visibleColumns} sort={s.sort}
            onSort={s.setSort} livePrices={prices} liveSortOn={liveSortOn}
            density={density} view={s.view} hasMore={hasMore}
            onLoadMore={s.loadMore} isLoading={isLoading} />
        )}
      </div>
      <FiltersSheet open={sheetOpen} onClose={() => setSheetOpen(false)}
        onClear={s.clearFilters} onApply={() => setSheetOpen(false)}
        title="Scan Filters" activeCount={Object.keys(s.filters).length}
        applyLabel="Show results">
        {meta && (
          <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
            onClear={s.clearFilters} variant="sheet" />
        )}
      </FiltersSheet>
    </div>
  )
}
```

⚠️ The `FiltersSheet` renders UNCONDITIONALLY (it returns null while closed): the rail is CSS-hidden at ≤1024px and in narrow containers, and the Filters button must open the sheet at tablet width and inside a narrow /charts widget too — an `isPhone &&` guard would leave those widths with a button that opens nothing. `isPhone` gates only the CARD results mode. The sheet's child is its own `variant="sheet"` rail instance (the desktop `rail` variable stays phone/desktop-agnostic).

Shell layout CSS (+ container-query collapse):

```css
.shell { display: flex; gap: 10px; padding: 16px 20px; flex: 1; min-height: 0; overflow: hidden; }
.shellEmbedded { padding: 0; height: 100%; }
.railSlot { display: flex; min-height: 0; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.underbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.railToggle { display: none; align-items: center; gap: 5px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm, 6px); color: var(--text); padding: 6px 12px; font-size: 12px; cursor: pointer; min-height: 32px; }
.sortHonesty { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.snapChip { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: var(--ls-label, .5px); border: 1px dashed var(--border); border-radius: 999px; padding: 2px 8px; }
.scanError { background: var(--loss-bg); border: 1px solid var(--loss); border-radius: var(--radius-sm, 6px); color: var(--loss); font-size: 12px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; }
.retryBtn { background: none; border: 1px solid var(--loss); border-radius: var(--radius-sm, 6px); color: var(--loss); padding: 3px 10px; cursor: pointer; font-size: 11.5px; }
.empty { padding: 40px; text-align: center; color: var(--text-muted); }

/* Narrow container (the /charts widget) or tablet: rail collapses to a button.
   .widgetBody is the CQ root per the workspace contract. */
@container (max-width: 900px) {
  .railSlot { display: none; }
  .railToggle { display: inline-flex; }
}
@media (max-width: 1024px) {
  .railSlot { display: none; }
  .railToggle { display: inline-flex; }
}
@media (max-width: 640px) {
  .shell { padding: 12px; }
}
```

⚠️ Tablet (641–1024) uses the FiltersSheet too — `isPhone` gates the CARD mode only; the sheet open button works at any width where the rail is hidden. In `ScannerShell`, render the `FiltersSheet` whenever `sheetOpen` (drop the `isPhone &&` guard around it; keep it around ResultCards).

- [ ] **Step 1: Write the failing tests** — mock `useScreenerScan` (module mock returning fixtures), `useRealtimePrices` (`{ prices: {} }`), TickerPopup/TickerActions/StockChart-free paths. Cases: (a) skeleton on first load (`result:null, isLoading:true` → SkeletonTable markup); (b) empty keeps toolbar (`result:{total:0,rows:[],page:1}` → empty message AND the view tabs still present); (c) error banner + Retry bumps the spec the scan hook receives (mock `useScreenerScan` and assert its LAST call's spec carries `_retry: 1` after clicking Retry); (d) live-sort chip appears only when sort.key is price/chg_pct_1d; (e) export failure path sets the loud error (mock `csvExport.exportScreen` to reject → `role="status"` shows "nothing downloaded").
- [ ] **Step 2: fail. Step 3: implement. Step 4: green** + `npx vitest run src/pages/screener --pool=threads`.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/shell/ScannerShell.jsx app/src/pages/screener/shell/ScannerShell.test.jsx app/src/pages/screener/shell/ScannerShell.module.css
git commit -m "screener shell: orchestrator with honest states and embedded collapse"
```

---

### Task 11: ChartsGallery — the whole card opens the chart

**Files:**
- Modify: `app/src/pages/screener/ChartsGallery.jsx`
- Test: `app/src/pages/screener/ChartsGallery.cardclick.test.jsx` (new)

**Interfaces:** unchanged props. The card body (chart area) becomes a click target that opens the same TickerPopup the symbol opens — wrap the WHOLE card content in the `TickerPopup` trigger rather than only the symbol text. TickerPopup renders an inline trigger around children; restructure the card so `<TickerPopup sym>` wraps a full-card `<div className={styles.galleryCardInner}>` (head + chart). The chart stays `frozen` so the click is not eaten by chart interactions.

```jsx
          return (
            <div key={r.ticker} className={styles.galleryCard}>
              <TickerPopup sym={r.ticker}>
                <div className={styles.galleryCardInner} data-testid={`gallery-card-${r.ticker}`}>
                  <div className={styles.galleryHead}>
                    <span className={styles.symCell}>{r.ticker}</span>
                    <span className={chg == null ? '' : chg >= 0 ? styles.heatG : styles.heatR}>
                      {chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className={styles.galleryChart}>
                    <StockChart sym={r.ticker} tf="D" liveUpdates={false} frozen
                      showDrawingTools={false} hideLegend hideCrosshair hideCountdown
                      hideReplay hidePatterns hideCompare hideLastValue hidePriceLine
                      disableHvc />
                  </div>
                </div>
              </TickerPopup>
            </div>
          )
```

Add `.galleryCardInner { cursor: pointer; }` to `ScannerPro.module.css` (this file stays post-cutover — it styles the gallery).

- [ ] **Step 1: Failing test** — mock StockChart (`() => <div>chart</div>`) and TickerPopup as a trigger that records clicks (`({ sym, children }) => <button data-popup={sym}>{children}</button>`): clicking the card body (the chart div) reaches the popup trigger for that sym.
- [ ] **Step 2: fail. Step 3: implement. Step 4: green** + existing gallery-covering tests (`npx vitest run src/pages/screener --pool=threads`).
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/screener/ChartsGallery.jsx app/src/pages/screener/ChartsGallery.cardclick.test.jsx app/src/pages/screener/ScannerPro.module.css
git commit -m "screener: whole gallery card opens the chart popup"
```

---

### Task 12: Board + Live Scan hygiene — tokens, keyframe collision, phone CSS

**Files:**
- Modify: `app/src/pages/Screener.module.css`
- Test: `app/src/pages/Screener.liveScanCss.test.js` (new — structural, parses the CSS text)

Three fixes, all in the module CSS (no JSX changes):

1. **Duplicate `@keyframes pulse`** — the file defines `pulse` at `:480` and again at `:848`; in one CSS-module file the second silently wins for both call sites. Rename the Live Scan pair: `@keyframes streamPulse { … }` and `.streamDotLive { … animation: streamPulse 2s infinite; }` (the `:452` badge animation keeps the `pulse` name).
2. **Token restyle of the Live Scan block** (`:838-913`) — replace the raw literals with tokens, keeping the visual intent: `#4ade80` → `var(--gain)`; `#f87171` → `var(--loss)`; `#555` → `var(--text-muted)`; `#e2e0d8` → `var(--text-bright)`; `#c9a84c` fallbacks (`var(--color-accent, #c9a84c)`) → `var(--ut-gold)`; `rgba(255,255,255,.03/.04/.05/.06/.15)` borders/hover → `var(--border)` / `var(--bg-hover)`; `rgba(0,0,0,.2/.3)` panels → `var(--bg)`; `rgba(201,168,76,…)` flashes → `var(--gain-bg)` where a tint is needed. The TRIGGERS array's per-trigger colors in `Screener.jsx` are DATA (`--trig-color` custom property), not styling — leave them.
3. **Live Scan phone CSS — its first ever.** Append inside the canonical phone query:

```css
@media (max-width: 640px) {
  .liveScanBody { flex-direction: column; }
  .feedPanel { width: 100%; max-height: 40vh; border-right: none; border-bottom: 1px solid var(--border); }
  .watchHeader, .watchRow { grid-template-columns: 72px 72px 64px 1fr; }
  .watchHeader span:nth-child(4), .watchRow .watchPdh { display: none; }
  .trigFilter, .clearFeed { min-height: var(--tap-min, 44px); display: inline-flex; align-items: center; }
}
```

(PDH column is the one dropped on phone — its value is already in the trigger feed when it fires.)

4. **PatternFeedbackChip admin scoping — VERIFY ONLY, no change:** `app/src/components/PatternFeedbackChip.jsx:16` already returns null unless `user?.role === 'admin'`. The spec's §6.3 item is thus already true. Add one structural assertion to the new test so it cannot silently regress.

- [ ] **Step 1: Write the failing structural test**

```js
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const read = rel => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')

describe('Screener.module.css hygiene', () => {
  const css = () => read('pages/Screener.module.css')

  it('defines @keyframes pulse exactly once (CSS modules: a duplicate silently wins)', () => {
    expect([...css().matchAll(/@keyframes\s+pulse\b/g)].length).toBe(1)
    expect(css()).toMatch(/@keyframes\s+streamPulse\b/)
    expect(css()).toMatch(/animation:\s*streamPulse/)
  })

  it('the Live Scan block carries no raw palette hex', () => {
    const block = css().slice(css().indexOf('Live Scan Tab'))
    for (const hex of ['#4ade80', '#f87171', '#555', '#e2e0d8', '#c9a84c']) {
      expect(block, `${hex} should be a token in the Live Scan block`).not.toContain(hex)
    }
  })

  it('Live Scan has phone rules: the body stacks', () => {
    const phone = css().split('@media (max-width: 640px)').slice(1).join('\n')
    expect(phone).toMatch(/\.liveScanBody[^}]*flex-direction:\s*column/)
  })

  it('PatternFeedbackChip stays admin-only (spec §6.3 — already true, pinned here)', () => {
    const chip = read('components/PatternFeedbackChip.jsx')
    expect(chip).toMatch(/role\s*!==\s*'admin'/)
  })
})
```

- [ ] **Step 2: fail (streamPulse missing, hexes present, no phone rule). Step 3: apply the CSS edits. Step 4: green** + `npx vitest run src/pages --pool=threads` smoke on Screener tests.
- [ ] **Step 5: Manual verification (visual):** run the app, open Live Scan on desktop (stream dot pulses; colors unchanged in spirit) and in a 390px viewport (feed stacks above the table; no horizontal overflow).
- [ ] **Step 6: Commit**

```bash
git add app/src/pages/Screener.module.css app/src/pages/Screener.liveScanCss.test.js
git commit -m "screener: live-scan tokens + keyframe collision fix + first phone CSS"
```

---

### Task 13: CUTOVER — the shell becomes the Scanner tab; the old components die

**Files:**
- Modify: `app/src/pages/Screener.jsx` (`:5` import + `:486` render)
- Modify: `app/src/pages/Screener.scanmount.test.jsx` (`:59` — the ScannerPro stub follows the wire)
- Modify: every other test importing/stubbing `./screener/ScannerPro` (find them: `cd app && grep -rl "screener/ScannerPro" src --include="*.test.jsx"`) — update each stub path to `./screener/shell/ScannerShell` with the same stub body
- Delete: `app/src/pages/screener/ScannerPro.jsx`, `app/src/pages/screener/FilterPanel.jsx`, `app/src/pages/screener/ResultsTable.jsx`
- KEEP: `ScannerPro.module.css` (styles `ChartsGallery`/`FilterChips`/`SaveScreenBar`), `ChartsGallery.jsx`, `FilterChips.jsx`, `SaveScreenBar.jsx`, `chipLabel.js`, `exportCsv.js`, `hooks/*`, `SharedScreen.jsx`, `screenShareLink.js`

**Parity checklist — every box checked before the deletions land (run the app locally: backend `uvicorn api.main:app --port 8077` with the heavy-job env-offs from CLAUDE.md, `cd app && npm run dev`):**

- [ ] All registry categories/filters render in the rail (count against `GET /api/screener/meta` — including Wave 1's performance/momentum/context when landed)
- [ ] Preset select + custom range (Enter) both filter; chips label and remove
- [ ] Views switch columns; column picker adds/removes/reorders; Reset to view
- [ ] Sort via header, `aria-sort` present; snapshot-order chip + live re-sort toggle on Chg%
- [ ] Saved screens: save, apply, rename, delete, publish + copy link, unpublish (SaveScreenBar untouched — smoke each)
- [ ] `?screen=<token>` arrival applies a shared spec; editing then strips `screen=` and writes `s=`; refresh restores the working screen; back/forward walks spec states
- [ ] CSV downloads the full set; a forced failure (devtools offline) shows the loud error and downloads nothing
- [ ] Charts view renders; card click opens the popup; pager works
- [ ] Live overlay: gold dots on subscribed rows, hollow past 300; empty/error/skeleton states reachable
- [ ] Embedded: add a Scanner widget on /charts — narrow widget shows the Filters button, sheet opens, results render inside the widget
- [ ] Phone (devtools 390px): card mode, FiltersSheet list with 44px targets, no horizontal overflow

**The swap (Screener.jsx):**

```jsx
import ScannerShell from './screener/shell/ScannerShell'
…
      {pageTab === 'scanner' ? (
        <ScannerShell embedded={embedded} />
```

**scanmount test stub follows the wire (`:59`):**

```jsx
vi.mock('./screener/shell/ScannerShell', () => ({ default: () => <div>scanner shell</div> }))
```

- [ ] **Step 1: Run the parity checklist above** — fix in place until every box checks. Anything unfixable in this task is a plan defect: stop and report, do not cut over.
- [ ] **Step 2: Swap the import/render; update the test stubs** (scanmount + every file the grep finds).
- [ ] **Step 3: Delete the three superseded files** (`git rm app/src/pages/screener/ScannerPro.jsx app/src/pages/screener/FilterPanel.jsx app/src/pages/screener/ResultsTable.jsx`).
- [ ] **Step 4: Full frontend gate** — `cd app && npx vitest run src --pool=threads` (reachable.test.js sweeps the orphans; scanmount proves the Formulas wire survived the tab swap) and `npm run build`.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Screener.jsx app/src/pages/Screener.scanmount.test.jsx
git rm app/src/pages/screener/ScannerPro.jsx app/src/pages/screener/FilterPanel.jsx app/src/pages/screener/ResultsTable.jsx
git add -u app/src
git commit -m "screener: shell replaces ScannerPro — direct cutover, old components deleted"
```

(`git add -u app/src` here stages ONLY tracked-file modifications/deletions under app/src — the named-files rule holds; never `git add -A`.)

---

### Task 14: Ship gate — audits, screenshots, artifact checks

- [ ] **Step 1: Mobile audit with opened screenshots** — per CLAUDE.md's harness recipe:

```powershell
$env:ADMIN_EMAILS="mobtest@local.dev"; $env:WORKER_ENABLED="0"; $env:CATALYST_ENGINE_ENABLED="0"; $env:TWITTERAPI_IO_ENABLED="0"; $env:BARS_PREWARM_DISABLED="1"; $env:TICKER_NAMES_PREWARM_DISABLED="1"
python -m uvicorn api.main:app --port 8077
# fresh build first: cd app && npm run build
$env:MOBILE_AUDIT_EMAIL="mobtest@local.dev"; $env:MOBILE_AUDIT_PASSWORD="LocalTest2026!"
python tools/mobile_audit.py --base http://localhost:8077 --auth --routes /screener
```

OPEN the phone + tablet screenshots in `tools/mobile_audit_out/` (the vacuous-pass lesson: `overflowX=0` proves nothing — look at the image). Zero horizontal overflow, tap targets ≥44px on the flagged list.
- [ ] **Step 2: Desktop artifact check** — real payload, real page: load `/screener` with a filter set that returns >300 rows, screenshot desktop; verify sticky column/header while scrolling, seal popover contents against `GET /api/screener/snapshot-status`.
- [ ] **Step 3: Backend + frontend suites once more** — `python -m pytest tests/ -k "screener or scan" -q` and `cd app && npx vitest run src --pool=threads && npm run build`.
- [ ] **Step 4: Ship** — controller merges/pushes per the wave workflow (`git push origin feat/screener-deep-work:master` after fetch→merge→re-verify; `grep -c broker_sync api/main.py` ≥ 7 post-merge; deploy verified by `/api/health` uptime reset + served `dist/assets` grep + opening the real page).

---

## Self-review (done at plan time)

- **Spec §6 coverage:** §6.1 sidebar ✓(T5) toolbar/picker/density/provenance ✓(T6,T7) virtualized+sticky+aria-sort+live badges+static marker ✓(T8) sort honesty ✓(T8 liveSort + T10 chip/toggle) states+loud CSV ✓(T6,T10) URL state ✓(T2,T3); §6.2 mobile cards/sheet/LiveScan phone ✓(T9,T10,T12); §6.3 gallery click ✓(T11) board/live tokens+pulse ✓(T12) chip admin ✓(already true — pinned in T12); §6.4 cutover+deletion+rails ✓(T13,T14); §5.5 projection+400 ✓(T1).
- **Placeholder scan:** none — every task carries real code or an explicit manual-verification recipe; the one conditional (Task 6's ESM spy fallback) names its exact alternative.
- **Type consistency:** `useScreenSpec` return names match every consumer (`visibleColumns`, `baseSpec`, `scanSpec`, `setFilter(key, v)`); `virtualOpts` threaded T8/T9; `LIVE_WINDOW` exported from VirtualResults and consumed in ScannerShell; `REQUIRED_COLS` exported from useScreenSpec and consumed in ResultCards; `density` values `'compact'|'comfortable'` everywhere.
- **Known risks, named:** sticky-left + absolutely-positioned rows is verified manually in T8 Step 5 and again at the T13 checklist (the fallback, if a browser breaks it, is pinning via a duplicated first-column overlay — a T13 stop-and-report, not an improvisation); `FiltersSheet` at tablet width is a deliberate behavior extension (rail hidden 641-1024 per the canonical touch boundary); the retry path rides an `_retry` nonce inside the scan spec because `useScreenerScan` diffs the spec's JSON (Pydantic v2 ignores the unknown field server-side — if the router ever sets `extra='forbid'`, retry breaks loudly with a 422 and this note is where to look).
