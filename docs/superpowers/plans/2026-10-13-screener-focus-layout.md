# Screener Focus Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered Screener with "A · Focus": one top bar, a slim results list, and one big chart that follows the selection — behind an owner-only flag — then add the small backend pieces (coherent pivot, batch counts, preset descriptions, Describe-it → pills), verify it all locally in a real browser, and ship.

**Architecture:** A new `app/src/pages/screener/focus/` folder holds a `FocusScreener` orchestrator built on the existing hooks (`useScreenerMeta`, `useScreenSpec`, `useScreenerScan`, `useScreenerCount`, `useRealtimePrices`, `useSavedScreens`, `useFlagged`, `useNeighborWarm`). `Screener.jsx` renders it only when the auth payload carries `screener_focus_layout: true`; otherwise today's `ScannerShell` renders untouched. Pure logic (setup line, why-it's-here, empty-state undo, lazy counts) lives in small tested modules. Phase 2 adds `base_pivot_px` to the nightly snapshot, a batch count endpoint, `group`/`description` on starters, and a server-side flatten of Describe-it output into plain filters.

**Tech Stack:** React 18 + Vite + CSS modules + SWR + vitest/Testing Library (frontend); FastAPI + SQLite + pytest (backend); Lightweight Charts via the existing `StockChart`.

**Spec:** `docs/superpowers/specs/2026-10-13-screener-focus-layout-design.md` (mockups: https://claude.ai/artifact/MtVijq63ATyrJAfB458LTy, page "A · refined").

## Global Constraints

- Worktree `C:\Users\Patrick\uct-worktrees\screener-focus-layout`, branch `feat/screener-focus-layout`. Never touch `C:\Users\Patrick\uct-dashboard`.
- First run `cd app && npm ci` once (fresh worktree has no `node_modules`). Never `npm ci` on a box under memory pressure; print free memory first.
- Frontend tests: `cd app && npx vitest run <explicit files>`. Never the full suite outside `scripts/gate_shards.py`. A run with no `Tests` totals line is not a run.
- Backend tests: `python -m pytest <explicit files> -q`. Never `pytest tests/ -k …`.
- Run tests in their own tool call; commit in a separate call after reading the result.
- Commit messages via `git commit -F - <<'MSG' … MSG`, ending with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_019wNHrgR9AkxxQYuj7VVqjL`.
- Write files with LF line endings for new files; run `python tools/check_repo_hygiene.py` before each commit.
- No emoji in UI. Icons via `UIcon` names already in the registry (`chevronDown`, `chevronUp`, `x`, `chart`, `save`, `gear`, `book`, `bolt`) or inline stroke SVG.
- Colours only from tokens in `app/src/styles/tokens.css`: `--bg`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, `--border`, `--border-accent`, `--text`, `--text-muted`, `--text-heading`, `--ut-gold`, `--ut-gold-dim`, `--gain`, `--loss`, `--tap-min`. New CSS must add zero rules to the contrast baseline (`terminal/a11y/__tests__/reachableContrast.baseline.json`): body text uses `--text` or `--text-muted`, never a custom grey.
- No new raw `window`/`document` key listeners (`pages/command/keyListenerCensus.test.js`). Keyboard handling is JSX `onKeyDown` on the focused list.
- `FocusScreener` and its children make no direct `fetch` to `/api/screener/*` except through hooks in `focus/` or `screener/hooks/` (`panelAdoption.ratchet.test.js` reads ScannerShell only, but keep the same discipline).
- Flag name `SCREENER_FOCUS_LAYOUT_ENABLED`, values `0|1|admin`, default OFF, payload key `screener_focus_layout_enabled` present as a boolean.
- Copy rules: plain words, sentence case, no em dashes in member copy, never "+0.0%" for a zero-volume row ("No trades today"), never a ✓ for a filter that cannot be checked per row.

## Review Focus

1. **A screen with zero results then a filter removed** — the list must repopulate and selection reset to row 0; the chart must not keep showing a ticker that is no longer in the list. (Task 3 test `clamps selection when rows shrink`, Task 9 test `selection resets when the result set changes`.)
2. **Arrowing past the loaded page** — pressing ↓ on the last loaded row must call `loadMore` when more exist, never wrap to the top or throw. (Task 3 test `requests more at the end`.)
3. **Keys typed into a search box** — j/k/W/Shift+F typed into the filters drawer search or the screen-menu search must not move the list or add to a watchlist. (Task 3 test `ignores keys from editable targets`.)
4. **A saved screen with OR/NOT logic or a ranked top-N** — "Why it's here" must not show a ✓ for those; it must print the plain sentence. (Task 2 tests `logic tree is a note not a check`, `rank is a note`.)
5. **Missing data on a row** (null price, null base, zero volume, null pivot) — the row renders "—" / "No trades today" / "Not enough history for a base" and never "NaN%" or "+0.0%". (Task 2 tests `null price`, `zero volume`, `null base`; Task 11 `no pivot distance without a pivot`.)

---

## File structure

```
app/src/pages/screener/focus/
  FocusScreener.jsx        orchestrator: spec, scan, selection, layout, mode toggle
  FocusScreener.module.css layout + shared tokens for the focus page
  FocusTopBar.jsx          screen-menu trigger, filters button, data status, List|Table, Save, ⋯, ?
  ResultList.jsx           listbox of rows, imperative scrollToIndex, footer key hints
  ChartPane.jsx            StockChart + header + facts + WhyItsHere + Flag/Watchlist
  WhyItsHere.jsx           renders whyItsHere() items
  ScreenMenu.jsx           pinned/groups/my screens/more, search, counts, footer actions
  FiltersDrawer.jsx        describe, active pills, universe pill, FilterRail, edit-as-code
  SaveMenu.jsx             four outcomes, gated
  MoreMenu.jsx             export, live re-sort, density, company names
  HelpMenu.jsx             how-to, methodology, structure library, filter glossary, shortcuts
  DataReceipt.jsx          snapshot/live/coverage popover + inline warning
  FocusStates.jsx          ListSkeleton, EmptyState, ErrorState
  Menu.jsx                 tiny accessible popover menu primitive used by the four menus
  setupLine.js             pure: row -> {text, detail, quiet}
  whyItsHere.js            pure: filters/logic/rank/meta/row -> items; whyColumns()
  emptyUndo.js             pure: track last change, describe the emptying filter
  useFocusSelection.js     index, clamp, keys, neighbour warm
  useLazyCounts.js         counts for screen-menu items (concurrency cap, session cache)
  useWatchlistTarget.js    default watchlist for W, add-to-list call
  screenGroups.js          starter id -> group fallback map; pinned-pref migration
  __tests__/*.test.js(x)   one test file per module above
api/routers/auth.py              + SCREENER_FLAGS table + _screener_flags()
api/routers/screener.py          + POST /api/screener/count/batch (phase 2)
api/services/screener/bases.py   + base_pivot_px (phase 2)
api/services/screener/base_catalog.py  + Structure.pivot (phase 2)
api/services/screener/snapshot_db.py   + base_pivot_px column (phase 2)
api/services/screener/saved_screens.py + group/description on starters (phase 2)
api/services/screener/nl_compile.py    + flatten_to_filters() (phase 2)
docs/feature_flags.json          + SCREENER_FOCUS_LAYOUT_ENABLED entry
```

---

### Task 1: Owner-only flag and the page switch

**Files:**
- Modify: `api/routers/auth.py` (add table + helper near `_breadth_dc_flags` ~line 587-660; spread in `_access_payload` next to `**_breadth_dc_flags(is_admin=is_admin)` ~line 840)
- Modify: `docs/feature_flags.json` (`flags` object)
- Modify: `app/src/context/AuthContext.jsx` (state ~line 95, `SERVER_FLAGS` ~line 161, provider value ~line 376)
- Modify: `app/src/pages/Screener.jsx`
- Create: `app/src/pages/screener/focus/FocusScreener.jsx` (stub this task, filled in Task 9)
- Test: `tests/test_screener_focus_flag.py`, `app/src/pages/Screener.focusSwitch.test.jsx`

**Interfaces:**
- Produces: auth payload key `screener_focus_layout_enabled: bool`; `AuthContext` value `screenerFocusLayoutEnabled: boolean`; `<FocusScreener />` default export (no props).

- [ ] **Step 1: Write the failing backend test**

```python
# tests/test_screener_focus_flag.py
import importlib
import pytest

FLAG = "SCREENER_FOCUS_LAYOUT_ENABLED"


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    import api.routers.auth as mod
    return importlib.reload(mod)


def test_unset_is_off_for_everyone(auth):
    assert auth._screener_flags(is_admin=True) == {"screener_focus_layout_enabled": False}


@pytest.mark.parametrize("raw", ["1", "true", "yes", "on"])
def test_on_values_are_on_for_members(auth, monkeypatch, raw):
    monkeypatch.setenv(FLAG, raw)
    assert auth._screener_flags(is_admin=False)["screener_focus_layout_enabled"] is True


def test_admin_means_admin_only_and_a_member_sees_off(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "admin")
    assert auth._screener_flags(is_admin=True)["screener_focus_layout_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_focus_layout_enabled"] is False


def test_typo_takes_the_default_not_the_opposite(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "flase")
    assert auth._screener_flags(is_admin=True)["screener_focus_layout_enabled"] is False


def test_is_admin_defaults_false_so_an_uninstrumented_caller_fails_closed(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "admin")
    assert auth._screener_flags()["screener_focus_layout_enabled"] is False


def test_the_payload_carries_it(auth):
    import inspect
    src = inspect.getsource(auth._access_payload)
    assert "_screener_flags(is_admin=" in src
```

- [ ] **Step 2: Run it — expect FAIL** (`AttributeError: … _screener_flags`)

Run: `python -m pytest tests/test_screener_focus_flag.py -q`

- [ ] **Step 3: Implement in `api/routers/auth.py`**

Add directly after the `_breadth_dc_scope` function:

```python
#: Screener capability flags, same three-value grammar as BREADTH_DC_FLAGS
#: (unset/0 = off · 1 = everyone · admin = owner preview). Read PER REQUEST.
SCREENER_FLAGS = {
    "SCREENER_FOCUS_LAYOUT_ENABLED": False,   # enablement — Focus list + chart layout
}


def _screener_flags(is_admin: bool = False) -> dict:
    """The Screener's layout flag, parsed by the SAME `_breadth_dc_scope` so the
    two flag families cannot disagree about what `admin` or a typo means.
    `is_admin` defaults False so a caller that forgets the role fails CLOSED."""
    out = {}
    for env_name, default_on in SCREENER_FLAGS.items():
        scope = _breadth_dc_scope(env_name, default_on)
        out[env_name.lower()] = scope == _SCOPE_ALL or (scope == _ADMIN_ONLY and bool(is_admin))
    return out
```

In `_access_payload`, on the line after `**_breadth_dc_flags(is_admin=is_admin),` add:

```python
        **_screener_flags(is_admin=is_admin),
```

- [ ] **Step 4: Run it — expect PASS**, then run the ledger rail: `python -m pytest tests/test_feature_flag_ledger.py tests/test_screener_focus_flag.py -q`. Expect the ledger test to FAIL naming `SCREENER_FOCUS_LAYOUT_ENABLED`.

- [ ] **Step 5: Add the ledger entry** to `docs/feature_flags.json` → `flags`, edited as TEXT (never load/dump the file), placed alphabetically:

```json
    "SCREENER_FOCUS_LAYOUT_ENABLED": {
      "member_facing": {
        "label": "Focus layout (list + chart)",
        "where": "Screener"
      },
      "status": "dark",
      "since": "2026-10-13",
      "where": [],
      "note": "Screener Focus layout (spec docs/superpowers/specs/2026-10-13-screener-focus-layout-design.md). Dark: unset means NOT RELEASED. Read PER REQUEST in api/routers/auth.py::_screener_flags via _breadth_dc_scope, so a flip needs no rebuild. THREE VALUES: unset/0/false/no/off = off for everyone; 1/true/yes/on = everyone; admin = owner preview only (a member reads false). An unrecognised value takes the default (off). Flag off renders today's ScannerShell byte-for-byte."
    },
```

Run `python -m pytest tests/test_feature_flag_ledger.py tests/test_screener_focus_flag.py -q` — expect PASS.

- [ ] **Step 6: Write the failing frontend test**

```jsx
// app/src/pages/Screener.focusSwitch.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext } from '../context/AuthContext'

vi.mock('./screener/shell/ScannerShell', () => ({ default: () => <div data-testid="old-shell" /> }))
vi.mock('./screener/focus/FocusScreener', () => ({ default: () => <div data-testid="focus" /> }))
import Screener from './Screener'

const wrap = (value, props = {}) => render(
  <MemoryRouter><AuthContext.Provider value={value}><Screener {...props} /></AuthContext.Provider></MemoryRouter>)

test('flag off renders the old shell', () => {
  wrap({ screenerFocusLayoutEnabled: false })
  expect(screen.getByTestId('old-shell')).toBeInTheDocument()
  expect(screen.queryByTestId('focus')).toBeNull()
})

test('flag on renders the focus layout', () => {
  wrap({ screenerFocusLayoutEnabled: true })
  expect(screen.getByTestId('focus')).toBeInTheDocument()
  expect(screen.queryByTestId('old-shell')).toBeNull()
})

test('embedded always renders the old shell', () => {
  wrap({ screenerFocusLayoutEnabled: true }, { embedded: true })
  expect(screen.getByTestId('old-shell')).toBeInTheDocument()
})

test('outside an AuthProvider renders the old shell', () => {
  render(<MemoryRouter><Screener /></MemoryRouter>)
  expect(screen.getByTestId('old-shell')).toBeInTheDocument()
})
```

- [ ] **Step 7: Run it — expect FAIL** (`Cannot find module './screener/focus/FocusScreener'`)

Run: `cd app && npx vitest run src/pages/Screener.focusSwitch.test.jsx`

- [ ] **Step 8: Implement**

`app/src/pages/screener/focus/FocusScreener.jsx` (stub):

```jsx
export default function FocusScreener() {
  return <div data-testid="focus-screener" />
}
```

`AuthContext.jsx`: add `const [screenerFocusLayoutEnabled, setScreenerFocusLayoutEnabled] = useState(false)` beside `breadthDcV22Enabled`; add to `SERVER_FLAGS`:
`['screener_focus_layout_enabled', (d) => d.screener_focus_layout_enabled === true, setScreenerFocusLayoutEnabled],`
and add `screenerFocusLayoutEnabled` to the Provider value object.

`Screener.jsx`: add `import FocusScreener from './screener/focus/FocusScreener'`, compute
`const focusOn = useContext(AuthContext)?.screenerFocusLayoutEnabled === true && !embedded && !inPanel`
and replace the `{!showOptions && <ErrorBoundary …><ScannerShell …/></ErrorBoundary>}` block with:

```jsx
      {!showOptions && (
        <ErrorBoundary key={shellKey}
          fallback={<ScannerShellErrorFallback onRetry={() => setShellKey(k => k + 1)} />}>
          {focusOn ? <FocusScreener /> : <ScannerShell embedded={embedded} />}
        </ErrorBoundary>
      )}
```

When `focusOn`, also skip the `<h1>` (the Focus top bar names the screen): change `{!embedded && !inPanel && (` for the heading to `{!embedded && !inPanel && !focusOn && (`.

- [ ] **Step 9: Run** `cd app && npx vitest run src/pages/Screener.focusSwitch.test.jsx src/pages/Screener.test.jsx src/context/AuthContext.test.jsx` — expect PASS. Then `python -m pytest tests/test_screener_focus_flag.py tests/test_feature_flag_ledger.py tests/test_breadth_dc_flags.py -q` — expect PASS.

- [ ] **Step 10: Commit** `feat(screener): SCREENER_FOCUS_LAYOUT_ENABLED owner-only flag + page switch`.

---

### Task 2: Pure helpers — setup line and "why it's here"

**Files:**
- Create: `app/src/pages/screener/focus/setupLine.js`, `app/src/pages/screener/focus/whyItsHere.js`
- Test: `app/src/pages/screener/focus/__tests__/setupLine.test.js`, `.../whyItsHere.test.js`

**Interfaces:**
- Produces:
  - `setupLine(row) -> { text: string, detail: string|null, quiet: boolean }`
  - `pivotDetail(price, pivot) -> string|null` (used by Task 11)
  - `NOT_CHECKABLE_KEYS: Set<string>`
  - `whyColumns(filters) -> string[]` — columns the list must request so values are on the row
  - `whyItsHere({ filters, logic, rank, metaFilters, row, listLabel }) -> { items: Array<{kind:'check'|'pool'|'note', label:string, value?:string}>, more: number }`

- [ ] **Step 1: Write the failing tests**

```js
// __tests__/setupLine.test.js
import { setupLine, pivotDetail } from '../setupLine'

test('head of base_render, +N stripped', () => {
  expect(setupLine({ base_render: 'Three Weeks Tight (Stage 2 Breakout) +2', vol_ratio: 1.2 }))
    .toEqual({ text: 'Three Weeks Tight', detail: null, quiet: false })
})
test('null base', () => {
  expect(setupLine({ base_render: null, vol_ratio: 1 }))
    .toEqual({ text: 'Not enough history for a base', detail: null, quiet: true })
})
test('zero volume says so and is quiet', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 0 }))
    .toEqual({ text: 'No trades today', detail: null, quiet: true })
})
test('pivot detail only with a finite pivot and price', () => {
  expect(pivotDetail(956.12, 988)).toBe('3.2% below pivot 988')
  expect(pivotDetail(102, 100)).toBe('2.0% above pivot 100')
  expect(pivotDetail(100.1, 100)).toBe('at pivot 100')
  expect(pivotDetail(null, 100)).toBeNull()
  expect(pivotDetail(10, null)).toBeNull()
  expect(pivotDetail(10, 0)).toBeNull()
})
test('pivot detail rides the row when base_pivot_px exists', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 1, price: 97, base_pivot_px: 100 }).detail)
    .toBe('3.0% below pivot 100')
})
test('pivot under 10 keeps two decimals', () => {
  expect(pivotDetail(4.5, 4.75)).toBe('5.3% below pivot 4.75')
})
```

```js
// __tests__/whyItsHere.test.js
import { whyItsHere, whyColumns } from '../whyItsHere'

const meta = [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: null, presets: [] },
  { key: 'price', label: 'Price', type: 'range', unit: '$', presets: [] },
  { key: 'above_50sma', label: 'Above 50 SMA', type: 'bool', presets: [] },
  { key: 'sector', label: 'Sector', type: 'enum', presets: [] },
  { key: 'base_structure', label: 'Structure', type: 'enum', presets: [] },
]
const row = { ticker: 'MU', rs_rank: 94, price: 956.12, above_50sma: 1, sector: 'Technology' }

test('checkable thresholds become checks with the row value', () => {
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'check', label: 'RS Rank ≥ 80', value: '94' }])
})
test('money values are formatted', () => {
  const { items } = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: meta, row })
  expect(items[0]).toEqual({ kind: 'check', label: 'Price ≥ $10', value: '$956.12' })
})
test('bool reads Yes', () => {
  const { items } = whyItsHere({ filters: { above_50sma: { op: 'eq', value: 1 } }, metaFilters: meta, row })
  expect(items[0]).toEqual({ kind: 'check', label: 'Above 50 SMA', value: 'Yes' })
})
test('universe is a pool, not a check', () => {
  const { items } = whyItsHere({ filters: { universe: { op: 'eq', value: 'uct', label: 'UCT Universe' } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'pool', label: 'In UCT Universe' }])
})
test('a list pool uses its label', () => {
  const { items } = whyItsHere({ filters: { list: { op: 'in', value: 'wl:3', label: 'Semis' } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'pool', label: 'In Semis' }])
})
test('scan join is a note', () => {
  const { items } = whyItsHere({ filters: { scan: { op: 'in', value: 'abc', label: 'Pocket pivots' } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'note', label: 'In My Scan Pocket pivots' }])
})
test('logic tree is a note not a check', () => {
  const { items } = whyItsHere({ filters: {}, logic: { any: [{ key: 'rs_rank', op: 'gte', min: 90 }] }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'note', label: 'Matches your custom criteria' }])
})
test('rank is a note', () => {
  const { items } = whyItsHere({ filters: {}, rank: { criteria: [{ key: 'uct_composite' }], top_n: 50 }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'note', label: 'Ranked in the top 50 by your weights' }])
})
test('structure contains is a note, never a check', () => {
  const { items } = whyItsHere({ filters: { base_structure: { op: 'contains', value: 'flat-base' } }, metaFilters: meta, row })
  expect(items[0].kind).toBe('note')
})
test('a column comparison op is a note', () => {
  const { items } = whyItsHere({ filters: { price: { op: 'gt_col', value: 'ema20' } }, metaFilters: meta, row })
  expect(items[0].kind).toBe('note')
})
test('missing row value shows a dash, still a check', () => {
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: { ticker: 'X' } })
  expect(items[0]).toEqual({ kind: 'check', label: 'RS Rank ≥ 80', value: '—' })
})
test('caps at five, reports the rest', () => {
  const filters = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(k => [k, { op: 'gte', min: 1 }]))
  const m = Object.keys(filters).map(k => ({ key: k, label: k, type: 'range', presets: [] }))
  const out = whyItsHere({ filters, metaFilters: m, row: {} })
  expect(out.items).toHaveLength(5)
  expect(out.more).toBe(2)
})
test('whyColumns asks only for checkable keys', () => {
  expect(whyColumns({ rs_rank: { op: 'gte', min: 80 }, universe: { op: 'eq', value: 'uct' },
    scan: { op: 'in', value: 'x' }, price: { op: 'gt_col', value: 'ema20' } })).toEqual(['rs_rank'])
})
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../setupLine'`)

Run: `cd app && npx vitest run src/pages/screener/focus/__tests__/setupLine.test.js src/pages/screener/focus/__tests__/whyItsHere.test.js`

- [ ] **Step 3: Implement**

```js
// setupLine.js
// The one short setup line under a ticker in the Focus list. Honesty rules
// (spec §6.1): the head of base_render only; zero volume says "No trades today";
// a pivot distance ONLY when the row carries base_pivot_px, which the snapshot
// writes from the same detection that names the head structure (phase 2).
const fmtPx = p => (Math.abs(p) >= 10 ? Math.round(p).toString() : p.toFixed(2))

export function pivotDetail(price, pivot) {
  if (!Number.isFinite(price) || !Number.isFinite(pivot) || pivot <= 0) return null
  const pct = (price / pivot - 1) * 100
  if (Math.abs(pct) < 0.25) return `at pivot ${fmtPx(pivot)}`
  return `${Math.abs(pct).toFixed(1)}% ${pct < 0 ? 'below' : 'above'} pivot ${fmtPx(pivot)}`
}

export function setupLine(row) {
  if (row?.vol_ratio === 0) return { text: 'No trades today', detail: null, quiet: true }
  const render = row?.base_render
  if (!render) return { text: 'Not enough history for a base', detail: null, quiet: true }
  const text = String(render).replace(/\s*\+\d+\s*$/, '').split(' (')[0].trim()
  return { text, detail: pivotDetail(row?.price, row?.base_pivot_px), quiet: false }
}
```

```js
// whyItsHere.js
// Spec §6.3. A ✓ only for a filter that reads one column with a plain
// comparison; pools read "In …"; everything that cannot be checked per row
// (scan joins, logic trees, ranks, field-to-field, structure contains) is a
// plain sentence. Never a ✓ we cannot back with the row's own value.
import { chipLabel } from '../chipLabel'

export const NOT_CHECKABLE_KEYS = new Set([
  'universe', 'list', 'scan', 'tickers', 'arith', 'base_structure', 'pattern_engine_id',
])
const CHECK_OPS = new Set(['gte', 'lte', 'gt', 'lt', 'between', 'eq', 'in', 'not_in'])
const MAX = 5

const isCheckable = (key, spec) =>
  !NOT_CHECKABLE_KEYS.has(key) && CHECK_OPS.has(spec?.op) && !String(spec?.op || '').endsWith('_col')

export function whyColumns(filters) {
  return Object.entries(filters || {}).filter(([k, v]) => v && isCheckable(k, v)).map(([k]) => k)
}

function fmtValue(def, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (def?.type === 'bool') return v ? 'Yes' : 'No'
  if (typeof v !== 'number') return String(v)
  const n = Math.abs(v) >= 100 ? v.toFixed(2).replace(/\.00$/, '') : String(Math.round(v * 100) / 100)
  if (def?.unit === '$') return `$${n}`
  if (def?.unit === '%') return `${n}%`
  return n
}

// chipLabel says "RS Rank: ≥ 80"; the strip reads "RS Rank ≥ 80".
const stripColon = s => s.replace(/:\s*/, ' ').replace(/\s+/g, ' ').trim()

export function whyItsHere({ filters = {}, logic = null, rank = null, metaFilters = [], row = {} } = {}) {
  const defs = Object.fromEntries((metaFilters || []).map(f => [f.key, f]))
  const all = []
  for (const [key, spec] of Object.entries(filters || {})) {
    if (!spec) continue
    if (key === 'universe') { all.push({ kind: 'pool', label: `In ${spec.label || 'UCT Universe'}` }); continue }
    if (key === 'list') { all.push({ kind: 'pool', label: `In ${spec.label || 'your list'}` }); continue }
    if (key === 'scan') { all.push({ kind: 'note', label: `In My Scan ${spec.label || ''}`.trim() }); continue }
    const def = defs[key] || { key, label: key, presets: [] }
    if (!isCheckable(key, spec)) {
      all.push({ kind: 'note', label: `Matches ${def.label}` }); continue
    }
    if (def.type === 'bool') { all.push({ kind: 'check', label: def.label, value: fmtValue(def, row[key]) }); continue }
    all.push({ kind: 'check', label: stripColon(chipLabel(def, spec)), value: fmtValue(def, row[key]) })
  }
  if (logic) all.push({ kind: 'note', label: 'Matches your custom criteria' })
  if (rank) all.push({ kind: 'note', label: rank.top_n ? `Ranked in the top ${rank.top_n} by your weights` : 'Ranked by your weights' })
  return { items: all.slice(0, MAX), more: Math.max(0, all.length - MAX) }
}
```

- [ ] **Step 4: Run — expect PASS** (same command as Step 2).

- [ ] **Step 5: Commit** `feat(screener-focus): setup line + why-it's-here pure helpers`.

---

### Task 3: Selection, keys and neighbour warm — `useFocusSelection`

**Files:**
- Create: `app/src/pages/screener/focus/useFocusSelection.js`
- Test: `app/src/pages/screener/focus/__tests__/useFocusSelection.test.jsx`

**Interfaces:**
- Consumes: `useNeighborWarm(orderedSymbols, selectedSym, tf)` from `app/src/hooks/useNeighborWarm.js`.
- Produces: `useFocusSelection({ rows, hasMore, onLoadMore, onOpen, onFlag, onWatch, tf = 'D' }) -> { index, selected, select(i), onKeyDown(e) }`. `selected` is the row object or `null`. Selection resets to 0 when the first row's ticker changes (a new result set) and clamps when rows shrink.

- [ ] **Step 1: Write the failing test**

```jsx
import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: vi.fn() }))
import { useNeighborWarm } from '../../../../hooks/useNeighborWarm'
import useFocusSelection from '../useFocusSelection'

const rows = n => Array.from({ length: n }, (_, i) => ({ ticker: `T${i}` }))
const key = (k, extra = {}) => ({ key: k, preventDefault: vi.fn(), target: document.body, ...extra })

test('starts at 0 and arrows move', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3) }))
  expect(result.current.selected.ticker).toBe('T0')
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => result.current.onKeyDown(key('j')))
  expect(result.current.index).toBe(2)
  act(() => result.current.onKeyDown(key('k')))
  expect(result.current.index).toBe(1)
})

test('does not move above 0', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2) }))
  act(() => result.current.onKeyDown(key('ArrowUp')))
  expect(result.current.index).toBe(0)
})

test('requests more at the end and does not wrap', () => {
  const onLoadMore = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), hasMore: true, onLoadMore }))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  act(() => result.current.onKeyDown(key('ArrowDown')))
  expect(result.current.index).toBe(1)
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('clamps selection when rows shrink', () => {
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(5) } })
  act(() => result.current.select(4))
  rerender({ rows: [{ ticker: 'T0' }, { ticker: 'T1' }] })
  expect(result.current.index).toBe(1)
})

test('resets to 0 when the result set changes', () => {
  const { result, rerender } = renderHook(p => useFocusSelection(p), { initialProps: { rows: rows(5) } })
  act(() => result.current.select(3))
  rerender({ rows: [{ ticker: 'NEW' }, { ticker: 'X' }, { ticker: 'Y' }, { ticker: 'Z' }] })
  expect(result.current.index).toBe(0)
})

test('Enter opens, Shift+F flags, w watches', () => {
  const onOpen = vi.fn(), onFlag = vi.fn(), onWatch = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(2), onOpen, onFlag, onWatch }))
  act(() => result.current.onKeyDown(key('Enter')))
  act(() => result.current.onKeyDown(key('F', { shiftKey: true })))
  act(() => result.current.onKeyDown(key('f')))
  act(() => result.current.onKeyDown(key('w')))
  expect(onOpen).toHaveBeenCalledWith({ ticker: 'T0' })
  expect(onFlag).toHaveBeenCalledTimes(1)
  expect(onWatch).toHaveBeenCalledWith({ ticker: 'T0' })
})

test('ignores keys from editable targets', () => {
  const onWatch = vi.fn()
  const input = document.createElement('input')
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3), onWatch }))
  act(() => result.current.onKeyDown(key('j', { target: input })))
  act(() => result.current.onKeyDown(key('w', { target: input })))
  expect(result.current.index).toBe(0)
  expect(onWatch).not.toHaveBeenCalled()
})

test('ignores modified keys so browser shortcuts still work', () => {
  const onWatch = vi.fn()
  const { result } = renderHook(() => useFocusSelection({ rows: rows(3), onWatch }))
  act(() => result.current.onKeyDown(key('w', { ctrlKey: true })))
  expect(onWatch).not.toHaveBeenCalled()
})

test('warms neighbours of the selection', () => {
  renderHook(() => useFocusSelection({ rows: rows(3) }))
  expect(useNeighborWarm).toHaveBeenCalledWith(['T0', 'T1', 'T2'], 'T0', 'D')
})

test('empty rows give no selection', () => {
  const { result } = renderHook(() => useFocusSelection({ rows: [] }))
  expect(result.current.selected).toBeNull()
})
```

- [ ] **Step 2: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/useFocusSelection.test.jsx`

- [ ] **Step 3: Implement**

```js
// useFocusSelection.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNeighborWarm } from '../../../hooks/useNeighborWarm'

const isEditable = t => !!t && (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable)

export default function useFocusSelection({ rows = [], hasMore = false, onLoadMore, onOpen, onFlag, onWatch, tf = 'D' } = {}) {
  const [index, setIndex] = useState(0)
  const firstTicker = rows[0]?.ticker ?? null
  const prevFirst = useRef(firstTicker)

  useEffect(() => {
    if (prevFirst.current !== firstTicker) { prevFirst.current = firstTicker; setIndex(0) }
  }, [firstTicker])
  useEffect(() => {
    if (index > 0 && index >= rows.length) setIndex(Math.max(0, rows.length - 1))
  }, [rows.length, index])

  const safe = Math.min(index, Math.max(0, rows.length - 1))
  const selected = rows.length ? rows[safe] : null
  const symbols = useMemo(() => rows.map(r => r.ticker), [rows])
  useNeighborWarm(symbols, selected?.ticker ?? null, tf)

  const select = useCallback(i => setIndex(Math.max(0, Math.min(i, rows.length - 1))), [rows.length])

  const onKeyDown = useCallback(e => {
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowDown' || k === 'j') {
      e.preventDefault()
      if (safe >= rows.length - 1) { if (hasMore) onLoadMore?.(); return }
      setIndex(safe + 1)
    } else if (k === 'ArrowUp' || k === 'k') {
      e.preventDefault(); setIndex(Math.max(0, safe - 1))
    } else if (k === 'Enter') {
      if (selected) { e.preventDefault(); onOpen?.(selected) }
    } else if (k === 'F' && e.shiftKey) {
      if (selected) { e.preventDefault(); onFlag?.(selected) }
    } else if (k === 'w' || k === 'W') {
      if (selected && !e.shiftKey) { e.preventDefault(); onWatch?.(selected) }
    }
  }, [safe, rows.length, hasMore, onLoadMore, onOpen, onFlag, onWatch, selected])

  return { index: safe, selected, select, onKeyDown }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(screener-focus): selection hook with keys + neighbour warm`.

---

### Task 4: The list and its states — `ResultList`, `FocusStates`

**Files:**
- Create: `app/src/pages/screener/focus/ResultList.jsx`, `FocusStates.jsx`, `FocusScreener.module.css`
- Test: `app/src/pages/screener/focus/__tests__/ResultList.test.jsx`, `FocusStates.test.jsx`

**Interfaces:**
- Consumes: `setupLine(row)`; `COLUMN_DEFS` from `../columnDefs` (for `chg_pct_1d` / `price` formatting is local — see code).
- Produces:
  - `ResultList` (forwardRef) props `{ rows, index, onSelect(i), onKeyDown, livePrices, radar:Set<string>, sortLabel, total, hasMore, onLoadMore, isLoading, itemProps? }`; ref exposes `{ scrollToIndex(i) }` (same shape the hub section uses on `VirtualResults`). Renders `role="listbox"` with `aria-label="Screen results"`, each row `role="option"` `aria-selected`, `data-testid="focus-row-<TICKER>"`.
  - `FocusStates`: named exports `ListSkeleton()`, `EmptyState({ filterCount, lastChange:{label, from}|null, onUndo, onOpenFilters })`, `ErrorState({ message, onRetry })`.

- [ ] **Step 1: Write the failing tests**

```jsx
// ResultList.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { vi } from 'vitest'
import ResultList from '../ResultList'

const rows = [
  { ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8 },
  { ticker: 'APLS', price: 41.03, chg_pct_1d: 0, base_render: '3 Weeks Tight', vol_ratio: 0 },
  { ticker: 'DAWN', price: null, chg_pct_1d: null, base_render: null, vol_ratio: 1 },
]
const base = { rows, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(['MU']), sortLabel: 'RS rank', total: 214, hasMore: true, onLoadMore: vi.fn(), isLoading: false }

test('renders a listbox with the selected option', () => {
  render(<ResultList {...base} />)
  expect(screen.getByRole('listbox', { name: 'Screen results' })).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-MU')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('1 of 214')).toBeInTheDocument()
})
test('zero-volume row says no trades and shows a dash for change', () => {
  render(<ResultList {...base} />)
  const r = screen.getByTestId('focus-row-APLS')
  expect(r).toHaveTextContent('No trades today')
  expect(r).toHaveTextContent('—')
  expect(r).not.toHaveTextContent('+0.0%')
})
test('null price shows a dash, never NaN', () => {
  render(<ResultList {...base} />)
  const r = screen.getByTestId('focus-row-DAWN')
  expect(r).toHaveTextContent('Not enough history for a base')
  expect(r.textContent).not.toMatch(/NaN/)
})
test('live price overrides the snapshot price', () => {
  render(<ResultList {...base} livePrices={{ MU: { price: 960.5, change_pct: -3.3 } }} />)
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('960.50')
  expect(screen.getByTestId('focus-row-MU')).toHaveTextContent('−3.3%')
})
test('radar dot is labelled for screen readers', () => {
  render(<ResultList {...base} />)
  expect(screen.getByTestId('focus-row-MU').querySelector('[aria-label="On your radar"]')).not.toBeNull()
})
test('click selects', () => {
  render(<ResultList {...base} />)
  fireEvent.click(screen.getByTestId('focus-row-DAWN'))
  expect(base.onSelect).toHaveBeenCalledWith(2)
})
test('keys go to onKeyDown', () => {
  render(<ResultList {...base} />)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(base.onKeyDown).toHaveBeenCalled()
})
test('exposes scrollToIndex', () => {
  const ref = createRef()
  render(<ResultList {...base} ref={ref} />)
  expect(typeof ref.current.scrollToIndex).toBe('function')
  ref.current.scrollToIndex(2)
})
```

```jsx
// FocusStates.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { EmptyState, ErrorState, ListSkeleton } from '../FocusStates'

test('empty names the emptying change and offers undo', () => {
  const onUndo = vi.fn()
  render(<EmptyState filterCount={5} lastChange={{ label: '8-wk gain ≥ 200%', from: 31 }} onUndo={onUndo} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match all 5 filters')).toBeInTheDocument()
  expect(screen.getByText(/took the list from 31 to 0/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo that change' }))
  expect(onUndo).toHaveBeenCalled()
})
test('empty without a known change has no undo', () => {
  render(<EmptyState filterCount={1} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match this filter')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo that change' })).toBeNull()
})
test('error has one action', () => {
  const onRetry = vi.fn()
  render(<ErrorState message="The server took too long to answer." onRetry={onRetry} />)
  expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load")
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalled()
})
test('skeleton is announced as loading', () => {
  render(<ListSkeleton />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading results')
})
```

- [ ] **Step 2: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/ResultList.test.jsx src/pages/screener/focus/__tests__/FocusStates.test.jsx`

- [ ] **Step 3: Implement**

```jsx
// FocusStates.jsx
import styles from './FocusScreener.module.css'

export function ListSkeleton() {
  return (
    <div role="status" className={styles.skeleton}>
      <span className="sr-only">Loading results</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={styles.skelRow} aria-hidden="true">
          <span className={styles.skelA} style={{ width: 40 + (i * 13) % 30 }} />
          <span className={styles.skelB} style={{ width: 90 + (i * 29) % 70 }} />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ filterCount, lastChange, onUndo, onOpenFilters }) {
  const head = filterCount === 1 ? 'No stocks match this filter' : `No stocks match all ${filterCount} filters`
  return (
    <div className={styles.stateBox}>
      <p className={styles.stateHead}>{head}</p>
      {lastChange && (
        <p className={styles.stateBody}>
          Your last change, <b>{lastChange.label}</b>, took the list from {lastChange.from} to 0.
        </p>
      )}
      <div className={styles.stateActions}>
        {lastChange && <button type="button" className={styles.btnPrimary} onClick={onUndo}>Undo that change</button>}
        <button type="button" className={styles.btn} onClick={onOpenFilters}>Open filters</button>
      </div>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className={styles.stateBox} role="alert">
      <p className={styles.stateHead}>The screen didn&apos;t load</p>
      <p className={styles.stateBody}>{message} Your filters are kept.</p>
      <button type="button" className={styles.btn} onClick={onRetry}>Try again</button>
    </div>
  )
}
```

```jsx
// ResultList.jsx
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { setupLine } from './setupLine'
import styles from './FocusScreener.module.css'

const fmtPrice = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const fmtChg = v => {
  if (!Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(1)
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : `${s}%`
}

const ResultList = forwardRef(function ResultList(
  { rows, index, onSelect, onKeyDown, livePrices = {}, radar = new Set(), sortLabel, onSort, total, hasMore, onLoadMore, isLoading, itemProps },
  ref,
) {
  const listRef = useRef(null)
  const scrollToIndex = i => {
    const el = listRef.current?.querySelector(`[data-index="${i}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }
  useImperativeHandle(ref, () => ({ scrollToIndex }), [])
  useEffect(() => { scrollToIndex(index) }, [index])

  // auto-load when the last row scrolls into view
  const endRef = useRef(null)
  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined' || !endRef.current) return undefined
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !isLoading) onLoadMore?.() })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [hasMore, isLoading, onLoadMore, rows.length])

  return (
    <div className={styles.listWrap}>
      <div className={styles.listHead}>
        <button type="button" className={styles.linkBtn} onClick={onSort}>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></button>
        <span>{rows.length ? `${index + 1} of ${total ?? rows.length}` : ''}</span>
      </div>
      <div ref={listRef} role="listbox" aria-label="Screen results" tabIndex={0}
        aria-activedescendant={rows[index] ? `focus-opt-${rows[index].ticker}` : undefined}
        className={styles.list} onKeyDown={onKeyDown} data-focus-list="">
        {rows.map((r, i) => {
          const live = livePrices[r.ticker]
          const zeroVol = r.vol_ratio === 0
          const price = Number.isFinite(live?.price) ? live.price : r.price
          const chg = zeroVol ? null : (Number.isFinite(live?.change_pct) ? live.change_pct : r.chg_pct_1d)
          const s = setupLine({ ...r, price })
          const sel = i === index
          return (
            <div key={r.ticker} id={`focus-opt-${r.ticker}`} role="option" aria-selected={sel}
              data-index={i} data-testid={`focus-row-${r.ticker}`}
              className={`${styles.row} ${sel ? styles.rowSel : ''} ${s.quiet ? styles.rowQuiet : ''}`}
              onClick={() => onSelect(i)} {...(itemProps ? itemProps(i) : {})}>
              <span className={radar.has(r.ticker) ? styles.dotOn : styles.dotOff}
                {...(radar.has(r.ticker) ? { 'aria-label': 'On your radar', role: 'img' } : { 'aria-hidden': true })} />
              <span className={styles.rowMain}>
                <span className={styles.ticker}>{r.ticker}</span>
                <span className={styles.setup}>{s.text}{s.detail ? ` · ${s.detail}` : ''}</span>
              </span>
              <span className={styles.rowNums}>
                <span>{fmtPrice(price)}</span>
                <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{fmtChg(chg)}</span>
              </span>
            </div>
          )
        })}
        {hasMore && <div ref={endRef} className={styles.moreSentinel} aria-hidden="true" />}
      </div>
      <div className={styles.keyHints} aria-hidden="true">
        <span><b>↑↓</b> move</span><span><b>⇧F</b> flag</span><span><b>W</b> watchlist</span><span><b>↵</b> full chart</span>
      </div>
    </div>
  )
})
export default ResultList
```

`FocusScreener.module.css` — full layout styles used across tasks (later tasks only add classes):

```css
.page { display: flex; flex-direction: column; height: calc(100vh - 56px); min-height: 520px; background: var(--bg); color: var(--text); }
.body { display: flex; flex: 1; min-height: 0; }
.listWrap { flex: 0 0 340px; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); }
.listHead { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; font-size: 12px; color: var(--text-muted); }
.listHeadValue { color: var(--text); }
.list { flex: 1; overflow-y: auto; outline: none; }
.list:focus-visible { box-shadow: inset 0 0 0 2px var(--ut-gold); }
.row { display: flex; align-items: center; gap: 10px; padding: 10px 16px 10px 12px; border-bottom: 1px solid var(--bg-surface); cursor: pointer; min-height: var(--tap-min); }
.row:hover { background: var(--bg-hover); }
.rowSel { background: var(--bg-elevated); box-shadow: inset 3px 0 0 var(--ut-gold); }
.rowQuiet .setup { font-style: italic; }
.dotOn { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ut-gold); }
.dotOff { flex: none; width: 6px; height: 6px; }
.rowMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ticker { font-size: 15px; font-weight: 700; color: var(--text-heading); }
.setup { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rowNums { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-variant-numeric: tabular-nums; font-size: 13px; }
.up { color: var(--gain); font-size: 12px; }
.down { color: var(--loss); font-size: 12px; }
.flat { color: var(--text-muted); font-size: 12px; }
.moreSentinel { height: 1px; }
.keyHints { display: flex; gap: 12px; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--text-muted); }
.keyHints b { color: var(--text); font-weight: 600; }
.linkBtn { background: none; border: 0; padding: 0; color: var(--text-muted); font: inherit; cursor: pointer; }
.btn { background: transparent; color: var(--text); border: 1px solid var(--border-accent); border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 13px; min-height: 36px; cursor: pointer; }
.btnPrimary { background: var(--ut-gold); color: var(--bg); border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 13px; font-weight: 700; min-height: 36px; cursor: pointer; }
.stateBox { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px 20px; text-align: center; flex: 1; }
.stateHead { margin: 0; font-size: 16px; font-weight: 700; color: var(--text-heading); }
.stateBody { margin: 0; color: var(--text-muted); max-width: 40ch; line-height: 1.5; }
.stateActions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.skeleton { display: flex; flex-direction: column; }
.skelRow { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--bg-surface); }
.skelA { height: 12px; border-radius: 4px; background: var(--bg-elevated); }
.skelB { height: 9px; border-radius: 4px; background: var(--bg-surface); }
@media (max-width: 1024px) { .listWrap { flex-basis: 280px; } }
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(screener-focus): result list + loading/empty/error states`.

---

### Task 5: Chart pane — `ChartPane` + `WhyItsHere` + watchlist target

**Files:**
- Create: `app/src/pages/screener/focus/ChartPane.jsx`, `WhyItsHere.jsx`, `useWatchlistTarget.js`
- Test: `app/src/pages/screener/focus/__tests__/ChartPane.test.jsx`, `useWatchlistTarget.test.jsx`

**Interfaces:**
- Consumes: `StockChart` (`../../../components/StockChart`); `whyItsHere()`; `setupLine()`; `pivotDetail()`.
- Produces:
  - `ChartPane` props `{ row, livePrice, why:{items, more}, onOpenFilters, onFlag, isFlagged, onWatch }`. Renders `data-testid="focus-chart-pane"`. Passes `priceLines` with a pivot line only when `row.base_pivot_px` is finite.
  - `WhyItsHere` props `{ items, more, onMore }`.
  - `useWatchlistTarget() -> { target:{id,name}|null, lists:Array, add(sym) -> Promise<{ok, message}>, setTarget(id) }`. Target = localStorage `uct.screener.watchlistTarget` if still present, else the first list from `GET /api/watchlists`.

- [ ] **Step 1: Confirm the `/api/watchlists` response shape** — `grep -n "api/watchlists'" app/src/hooks/useUserTickerSet.js app/src/pages/Watchlists.jsx | head` and read the parsing next to it. Write the shape (array of `{id, name, ...}` or `{watchlists:[...]}`) into the `lists` normalisation below before writing code; the test fixture must use the real shape.

- [ ] **Step 2: Write the failing tests**

```jsx
// ChartPane.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: props => <div data-testid="stockchart" data-sym={props.sym} data-lines={JSON.stringify(props.priceLines || [])} /> }))
import ChartPane from '../ChartPane'

const row = { ticker: 'MU', company: 'Micron Technology', industry: 'Semiconductors', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, adr_pct: 3.1 }
const why = { items: [{ kind: 'check', label: 'RS Rank ≥ 80', value: '94' }, { kind: 'pool', label: 'In UCT Universe' }], more: 0 }

test('header names the stock and the setup', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByRole('heading', { name: /MU/ })).toBeInTheDocument()
  expect(screen.getByText('Micron Technology · Semiconductors')).toBeInTheDocument()
  expect(screen.getByText('Flat Base')).toBeInTheDocument()
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'MU')
})
test('why-it-here shows checks and pools differently', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  const strip = screen.getByRole('list', { name: "Why it's here" })
  expect(strip).toHaveTextContent('RS Rank ≥ 80')
  expect(strip).toHaveTextContent('94')
  expect(strip).toHaveTextContent('In UCT Universe')
})
test('no pivot line without a pivot', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-lines', '[]')
})
test('pivot line when the row has one', () => {
  render(<ChartPane row={{ ...row, base_pivot_px: 988 }} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(JSON.parse(screen.getByTestId('stockchart').dataset.lines)[0].price).toBe(988)
})
test('buttons call back', () => {
  const onFlag = vi.fn(), onWatch = vi.fn()
  render(<ChartPane row={row} why={why} onFlag={onFlag} onWatch={onWatch} />)
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }))
  expect(onFlag).toHaveBeenCalledWith(row)
  expect(onWatch).toHaveBeenCalledWith(row)
})
test('nothing selected shows a placeholder, no chart', () => {
  render(<ChartPane row={null} why={{ items: [], more: 0 }} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.queryByTestId('stockchart')).toBeNull()
  expect(screen.getByText('Pick a stock from the list')).toBeInTheDocument()
})
```

```jsx
// useWatchlistTarget.test.jsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { vi } from 'vitest'
import useWatchlistTarget from '../useWatchlistTarget'

const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
// FIXTURE SHAPE: replace with the real /api/watchlists shape confirmed in Step 1.
const LISTS = [{ id: 7, name: 'Semis' }, { id: 9, name: 'IPOs' }]

beforeEach(() => { localStorage.clear(); global.fetch = vi.fn() })

test('defaults to the first list and adds to it', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe(7))
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(fetch).toHaveBeenLastCalledWith('/api/watchlists/7/items', expect.objectContaining({ method: 'POST' }))
  expect(out).toEqual({ ok: true, message: 'Added MU to Semis' })
})
test('remembers the chosen list', async () => {
  localStorage.setItem('uct.screener.watchlistTarget', '9')
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target?.id).toBe(9))
})
test('no lists gives a plain message', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [] })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out).toEqual({ ok: false, message: 'Create a watchlist first, then press W again.' })
})
test('a refused add says so', async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => LISTS })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: 'already there' }) })
  const { result } = renderHook(() => useWatchlistTarget(), { wrapper })
  await waitFor(() => expect(result.current.target).not.toBeNull())
  let out
  await act(async () => { out = await result.current.add('MU') })
  expect(out.ok).toBe(false)
  expect(out.message).toMatch(/MU was not added/)
})
```

- [ ] **Step 3: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/ChartPane.test.jsx src/pages/screener/focus/__tests__/useWatchlistTarget.test.jsx`

- [ ] **Step 4: Implement**

```jsx
// WhyItsHere.jsx
import styles from './FocusScreener.module.css'

export default function WhyItsHere({ items, more, onMore }) {
  if (!items?.length) return null
  return (
    <div className={styles.why}>
      <span className={styles.whyLabel} id="why-label">Why it&apos;s here</span>
      <ul className={styles.whyList} aria-labelledby="why-label" aria-label="Why it's here">
        {items.map((it, i) => (
          <li key={i} className={styles.whyItem}>
            <span aria-hidden="true" className={it.kind === 'check' ? styles.whyCheck : styles.whyPool}>
              {it.kind === 'check' ? '✓' : '○'}
            </span>
            <span className="sr-only">{it.kind === 'check' ? 'Passes: ' : ''}</span>
            <span className={styles.whyText}>{it.label}</span>
            {it.value && <span className={styles.whyValue}>{it.value}</span>}
          </li>
        ))}
        {more > 0 && <li><button type="button" className={styles.linkBtn} onClick={onMore}>+{more} more</button></li>}
      </ul>
    </div>
  )
}
```

```jsx
// ChartPane.jsx
import { useMemo, useState } from 'react'
import StockChart from '../../../components/StockChart'
import WhyItsHere from './WhyItsHere'
import { setupLine } from './setupLine'
import styles from './FocusScreener.module.css'

const fmt = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const pct = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')

function facts(row) {
  const out = []
  if (Number.isFinite(row.vol_ratio)) out.push(`Vol ${row.vol_ratio.toFixed(1)}×`)
  if (Number.isFinite(row.adr_pct)) out.push(`ADR ${row.adr_pct.toFixed(1)}%`)
  if (row.next_earnings_date) out.push(`Earnings ${row.next_earnings_date}`)
  return out.join(' · ')
}

export default function ChartPane({ row, livePrice, why, onOpenFilters, onFlag, isFlagged, onWatch }) {
  const [tf, setTf] = useState('D')
  const priceLines = useMemo(() => (Number.isFinite(row?.base_pivot_px)
    ? [{ price: row.base_pivot_px, color: '#dcbb5e', title: 'pivot' }] : []), [row?.base_pivot_px])
  if (!row) {
    return <section className={styles.pane} data-testid="focus-chart-pane"><p className={styles.stateBody}>Pick a stock from the list</p></section>
  }
  const price = Number.isFinite(livePrice?.price) ? livePrice.price : row.price
  const chg = row.vol_ratio === 0 ? null : (Number.isFinite(livePrice?.change_pct) ? livePrice.change_pct : row.chg_pct_1d)
  const s = setupLine({ ...row, price })
  const sub = [row.company, row.industry || row.sector].filter(Boolean).join(' · ')
  return (
    <section className={styles.pane} data-testid="focus-chart-pane" aria-label={`${row.ticker} chart`}>
      <div className={styles.paneHead}>
        <h2 className={styles.paneTicker}>{row.ticker}</h2>
        {sub && <span className={styles.paneSub}>{sub}</span>}
        <span className={styles.spacer} />
        <span className={styles.panePrice}>{fmt(price)}</span>
        <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{pct(chg)}</span>
      </div>
      <div className={styles.paneMeta}>
        <span className={styles.setupTag}>{s.text}</span>
        {s.detail && <span className={styles.setupTag}>{s.detail}</span>}
        <span className={styles.paneFacts}>{facts(row)}</span>
        <span className={styles.spacer} />
        <div role="group" aria-label="Timeframe" className={styles.seg}>
          {['D', 'W'].map(t => (
            <button key={t} type="button" aria-pressed={tf === t} className={tf === t ? styles.segOn : styles.segOff} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className={styles.chartBox}>
        <StockChart sym={row.ticker} tf={tf}
          showDrawingTools={false} showSavedDrawings
          hideReplay hidePatterns hideCompare hideCountdown disablePatterns
          backgroundWarm={false} liveUpdates hotkeysActive={false}
          boldCandles userCandleColors colorByNetChange candlesOnTop
          markVolumeExtremes hideWatermark hideJournalOverlay
          rightPadBars={4} dailyDefaultBars={126}
          volumeSeparatePane volumePaneHeightPct={9}
          priceScaleTopMargin={0.12} priceScaleBottomMargin={0.10}
          priceLines={priceLines} />
      </div>
      <div className={styles.paneFoot}>
        <WhyItsHere items={why.items} more={why.more} onMore={onOpenFilters} />
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} aria-pressed={!!isFlagged} onClick={() => onFlag(row)}>{isFlagged ? 'Flagged' : 'Flag'}</button>
        <button type="button" className={styles.btnPrimary} onClick={() => onWatch(row)}>Add to watchlist</button>
      </div>
    </section>
  )
}
```

Note the Flag button's accessible name: tests query `{ name: 'Flag' }` with `isFlagged` falsy.

```js
// useWatchlistTarget.js
import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'

const KEY = 'uct.screener.watchlistTarget'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = v => { try { localStorage.setItem(KEY, String(v)) } catch { /* private mode */ } }
const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : []))
// Normalise to [{id, name}] — adjust to the shape confirmed in Step 1.
const normalise = d => (Array.isArray(d) ? d : d?.watchlists || []).filter(w => w && w.id != null && !w.is_flagged_list)

export default function useWatchlistTarget() {
  const { data } = useSWR('/api/watchlists', fetcher)
  const lists = useMemo(() => normalise(data), [data])
  const [chosen, setChosen] = useState(read)
  const target = useMemo(() => lists.find(l => String(l.id) === String(chosen)) || lists[0] || null, [lists, chosen])
  const setTarget = useCallback(id => { setChosen(String(id)); write(id) }, [])
  const add = useCallback(async sym => {
    if (!target) return { ok: false, message: 'Create a watchlist first, then press W again.' }
    try {
      const r = await fetch(`/api/watchlists/${target.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sym, notes: '' }),
      })
      if (!r.ok) return { ok: false, message: `${sym} was not added to ${target.name} (${r.status}).` }
      return { ok: true, message: `Added ${sym} to ${target.name}` }
    } catch {
      return { ok: false, message: `${sym} was not added: the server could not be reached.` }
    }
  }, [target])
  return { target, lists, add, setTarget }
}
```

Append to `FocusScreener.module.css`:

```css
.pane { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 16px 24px 14px; }
.paneHead { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.paneTicker { margin: 0; font-size: 28px; font-weight: 700; color: var(--text-heading); }
.paneSub { color: var(--text-muted); font-size: 14px; }
.panePrice { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.spacer { flex: 1; }
.paneMeta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.setupTag { background: var(--ut-gold-dim); color: var(--ut-gold); border-radius: 6px; padding: 4px 10px; font-weight: 600; font-size: 12.5px; }
.paneFacts { color: var(--text-muted); font-size: 12.5px; }
.seg { display: flex; gap: 2px; background: var(--bg-surface); border-radius: 8px; padding: 2px; }
.segOn, .segOff { border: 0; border-radius: 6px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; min-width: 32px; }
.segOn { background: var(--border-accent); color: var(--text-heading); }
.segOff { background: transparent; color: var(--text-muted); }
.chartBox { position: relative; flex: 1; min-height: 280px; }
.paneFoot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 12px; }
.why { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12.5px; }
.whyLabel { color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; }
.whyList { display: flex; gap: 14px; flex-wrap: wrap; list-style: none; margin: 0; padding: 0; }
.whyItem { display: inline-flex; gap: 6px; align-items: center; }
.whyCheck { color: var(--gain); }
.whyPool { color: var(--text-muted); }
.whyText { color: var(--text-muted); }
.whyValue { color: var(--text); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit** `feat(screener-focus): chart pane, why-it's-here strip, watchlist target`.

---

### Task 6: Top bar and the four menus — `Menu`, `FocusTopBar`, `SaveMenu`, `MoreMenu`, `HelpMenu`, `DataReceipt`

**Files:**
- Create: `app/src/pages/screener/focus/Menu.jsx`, `FocusTopBar.jsx`, `SaveMenu.jsx`, `MoreMenu.jsx`, `HelpMenu.jsx`, `DataReceipt.jsx`
- Test: `app/src/pages/screener/focus/__tests__/menus.test.jsx`

**Interfaces:**
- Produces:
  - `Menu({ label, trigger, children, align='left', triggerClassName, testId })` — button with `aria-haspopup="menu"` + `aria-expanded`; popover `role="menu"`; closes on Escape, outside mousedown, and after any `[role=menuitem]` click; focus returns to the trigger on close. Items are `<MenuItem onSelect hint>` (named export) rendering `role="menuitem"` buttons.
  - `SaveMenu({ canSaveScreen, canFrozenList, canAlert, canNotebook, onSaveScreen, onFrozenList, onAlert, onNotebook })` — items omitted when their `can*` is false; when all four are false the trigger is not rendered.
  - `MoreMenu({ onExportCsv, onExportXlsx|null, liveSortOn, onToggleLiveSort, liveSortEligible, density, onDensity, showCompany, onToggleCompany })`.
  - `HelpMenu({ onHowTo|null, onMethodology, onLibrary, onGlossary, onShortcuts })`.
  - `DataReceipt({ snapshotDate, live, coverage })` — trigger "● Live · Oct 12 close" with an ⓘ; popover shows coverage counts; exports `coverageHasDrop(coverage) -> boolean`.
  - `FocusTopBar({ screenName, count, isEdited, screenMenu, filterCount, onOpenFilters, dataReceipt, mode, onMode, saveMenu, moreMenu, helpMenu, optionsTab })` — composition only; `screenMenu`/`saveMenu`/`moreMenu`/`helpMenu`/`dataReceipt` are elements passed in.

- [ ] **Step 1: Write the failing tests**

```jsx
// menus.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import Menu, { MenuItem } from '../Menu'
import SaveMenu from '../SaveMenu'
import MoreMenu from '../MoreMenu'
import HelpMenu from '../HelpMenu'
import DataReceipt, { coverageHasDrop } from '../DataReceipt'

test('menu opens, selects, closes and returns focus', () => {
  const onSelect = vi.fn()
  render(<Menu label="Things" trigger="Things"><MenuItem onSelect={onSelect}>One</MenuItem></Menu>)
  const btn = screen.getByRole('button', { name: 'Things' })
  fireEvent.click(btn)
  expect(btn).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('menuitem', { name: 'One' }))
  expect(onSelect).toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(btn)
})
test('escape closes', () => {
  render(<Menu label="Things" trigger="Things"><MenuItem onSelect={() => {}}>One</MenuItem></Menu>)
  fireEvent.click(screen.getByRole('button', { name: 'Things' }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})
test('save menu omits switched-off outcomes', () => {
  render(<SaveMenu canSaveScreen canFrozenList={false} canAlert={false} canNotebook
    onSaveScreen={vi.fn()} onFrozenList={vi.fn()} onAlert={vi.fn()} onNotebook={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('menuitem', { name: /Save as a screen/ })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: /Add to Notebook/ })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /today/ })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /Alert me/ })).toBeNull()
})
test('save menu with nothing available renders nothing', () => {
  const { container } = render(<SaveMenu canSaveScreen={false} canFrozenList={false} canAlert={false} canNotebook={false} />)
  expect(container).toBeEmptyDOMElement()
})
test('more menu hides Excel when server export is off', () => {
  render(<MoreMenu onExportCsv={vi.fn()} onExportXlsx={null} liveSortEligible={false} density="compact" onDensity={vi.fn()} showCompany onToggleCompany={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.getByRole('menuitem', { name: /Export CSV/ })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /Excel/ })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /Re-sort/ })).toBeNull()
})
test('help menu lists reading, not actions', () => {
  const onMethodology = vi.fn()
  render(<HelpMenu onHowTo={null} onMethodology={onMethodology} onLibrary={vi.fn()} onGlossary={vi.fn()} onShortcuts={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Methodology' }))
  expect(onMethodology).toHaveBeenCalled()
})
test('coverage drop detection', () => {
  expect(coverageHasDrop(null)).toBe(false)
  expect(coverageHasDrop({ evaluated: 10, answered: 10, dropped: 0, not_computable: 0 })).toBe(false)
  expect(coverageHasDrop({ evaluated: 10, answered: 8, dropped: 2, not_computable: 0 })).toBe(true)
  expect(coverageHasDrop({ evaluated: 10, answered: 9, dropped: 0, not_computable: 1 })).toBe(true)
})
test('data receipt shows the date and counts', () => {
  render(<DataReceipt snapshotDate="2026-10-12" live coverage={{ evaluated: 11230, answered: 11230, dropped: 0, not_computable: 0 }} />)
  const btn = screen.getByRole('button', { name: /Oct 12 close/ })
  fireEvent.click(btn)
  expect(screen.getByRole('dialog', { name: 'About this data' })).toHaveTextContent('11,230')
})
```

- [ ] **Step 2: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/menus.test.jsx`

- [ ] **Step 3: Implement**

```jsx
// Menu.jsx
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'

const CloseCtx = createContext(() => {})

export function MenuItem({ onSelect, hint, children, danger = false }) {
  const close = useContext(CloseCtx)
  return (
    <button type="button" role="menuitem" className={`${styles.menuItem} ${danger ? styles.menuDanger : ''}`}
      onClick={() => { close(); onSelect?.() }}>
      <span>{children}</span>{hint && <span className={styles.menuHint}>{hint}</span>}
    </button>
  )
}
export function MenuDivider() { return <div className={styles.menuDivider} role="separator" /> }
export function MenuHeading({ children }) { return <div className={styles.menuHeading}>{children}</div> }

export default function Menu({ label, trigger, children, align = 'left', triggerClassName, testId, width }) {
  const [open, setOpen] = useState(false)
  const btn = useRef(null), pop = useRef(null)
  const id = useId()
  const close = () => { setOpen(false); btn.current?.focus() }
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    pop.current?.querySelector('[role=menuitem]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(pop.current?.querySelectorAll('[role=menuitem]') || [])]
    const i = items.indexOf(document.activeElement)
    const n = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[n]?.focus()
  }
  return (
    <span className={styles.menuWrap} data-testid={testId}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={label} className={triggerClassName || styles.btn} onClick={() => setOpen(o => !o)}>{trigger}</button>
      {open && (
        <CloseCtx.Provider value={close}>
          <div ref={pop} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown}
            className={`${styles.menu} ${align === 'right' ? styles.menuRight : ''}`} style={width ? { width } : undefined}>
            {children}
          </div>
        </CloseCtx.Provider>
      )}
    </span>
  )
}
```

`aria-label` on the trigger: tests query `{ name: 'Save' }`, `{ name: 'More actions' }`, `{ name: 'Help' }`, `{ name: 'Things' }`, so pass `label` matching those.

```jsx
// SaveMenu.jsx
import Menu, { MenuItem, MenuHeading } from './Menu'

export default function SaveMenu({ canSaveScreen, canFrozenList, canAlert, canNotebook, onSaveScreen, onFrozenList, onAlert, onNotebook, count }) {
  if (!canSaveScreen && !canFrozenList && !canAlert && !canNotebook) return null
  return (
    <Menu label="Save" trigger="Save ▾" align="right" testId="focus-save-menu" width={300}>
      <MenuHeading>Save as…</MenuHeading>
      {canSaveScreen && <MenuItem onSelect={onSaveScreen} hint="reruns live">Save as a screen</MenuItem>}
      {canFrozenList && <MenuItem onSelect={onFrozenList} hint={count ? `${count} names, frozen` : 'frozen'}>Save today&apos;s list</MenuItem>}
      {canAlert && <MenuItem onSelect={onAlert} hint="new names">Alert me on new names</MenuItem>}
      {canNotebook && <MenuItem onSelect={onNotebook} hint="snapshot">Add to Notebook</MenuItem>}
    </Menu>
  )
}
```

```jsx
// MoreMenu.jsx
import Menu, { MenuItem, MenuDivider } from './Menu'

export default function MoreMenu({ onExportCsv, onExportXlsx, liveSortEligible, liveSortOn, onToggleLiveSort, density, onDensity, showCompany, onToggleCompany }) {
  return (
    <Menu label="More actions" trigger="⋯" align="right" testId="focus-more-menu" width={260}>
      <MenuItem onSelect={onExportCsv}>Export CSV</MenuItem>
      {onExportXlsx && <MenuItem onSelect={onExportXlsx}>Export Excel</MenuItem>}
      <MenuDivider />
      {liveSortEligible && <MenuItem onSelect={onToggleLiveSort} hint={liveSortOn ? 'on' : 'off'}>Re-sort by live price</MenuItem>}
      <MenuItem onSelect={() => onDensity(density === 'compact' ? 'comfortable' : 'compact')} hint={density}>Row density</MenuItem>
      <MenuItem onSelect={onToggleCompany} hint={showCompany ? 'on' : 'off'}>Show company names</MenuItem>
    </Menu>
  )
}
```

```jsx
// HelpMenu.jsx
import Menu, { MenuItem, MenuDivider } from './Menu'
import styles from './FocusScreener.module.css'

export default function HelpMenu({ onHowTo, onMethodology, onLibrary, onGlossary, onShortcuts }) {
  return (
    <Menu label="Help" trigger="?" align="right" triggerClassName={styles.iconBtn} testId="focus-help-menu" width={260}>
      {onHowTo && <MenuItem onSelect={onHowTo}>How to use this screen</MenuItem>}
      <MenuItem onSelect={onMethodology}>Methodology</MenuItem>
      <MenuItem onSelect={onLibrary}>Structure library</MenuItem>
      <MenuItem onSelect={onGlossary}>What each filter means</MenuItem>
      <MenuDivider />
      <MenuItem onSelect={onShortcuts} hint="?">Keyboard shortcuts</MenuItem>
    </Menu>
  )
}
```

```jsx
// DataReceipt.jsx
import { useEffect, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'

export function coverageHasDrop(c) {
  return !!c && ((c.dropped || 0) > 0 || (c.not_computable || 0) > 0)
}
const day = iso => {
  if (!iso) return 'latest close'
  const d = new Date(`${iso}T12:00:00`)
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()} close`
}
const n = v => (Number.isFinite(v) ? v.toLocaleString('en-US') : '—')

export default function DataReceipt({ snapshotDate, live, coverage }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <span className={styles.menuWrap} ref={box}>
      <button type="button" className={styles.receiptBtn} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className={live ? styles.liveDot : styles.idleDot} aria-hidden="true" />
        {live ? 'Live · ' : ''}{day(snapshotDate)}
        <span className={styles.infoMark} aria-hidden="true">i</span>
      </button>
      {open && (
        <div role="dialog" aria-label="About this data" className={`${styles.menu} ${styles.menuRight} ${styles.receipt}`}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
          <p className={styles.receiptHead}>Nightly data from {day(snapshotDate)}.{live ? ' Prices near the top of the list are live.' : ''}</p>
          {coverage && (
            <dl className={styles.receiptGrid}>
              <div><dt>checked</dt><dd>{n(coverage.evaluated)}</dd></div>
              <div><dt>answered</dt><dd>{n(coverage.answered)}</dd></div>
              <div><dt>dropped</dt><dd>{n(coverage.dropped)}</dd></div>
              <div><dt>not computable</dt><dd>{n(coverage.not_computable)}</dd></div>
            </dl>
          )}
        </div>
      )}
    </span>
  )
}
```

```jsx
// FocusTopBar.jsx
import styles from './FocusScreener.module.css'

export default function FocusTopBar({ screenMenu, filterCount, onOpenFilters, dataReceipt, mode, onMode, saveMenu, moreMenu, helpMenu, optionsTab }) {
  return (
    <header className={styles.topBar}>
      {optionsTab}
      {screenMenu}
      <button type="button" className={styles.btn} onClick={onOpenFilters} aria-label={`Filters, ${filterCount} active`}>
        Filters {filterCount > 0 && <span className={styles.badge}>{filterCount}</span>}
      </button>
      <span className={styles.spacer} />
      {dataReceipt}
      <div role="group" aria-label="View" className={styles.seg}>
        {['list', 'table'].map(m => (
          <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? styles.segOn : styles.segOff} onClick={() => onMode(m)}>
            {m === 'list' ? 'List' : 'Table'}
          </button>
        ))}
      </div>
      {saveMenu}
      {moreMenu}
      {helpMenu}
    </header>
  )
}
```

Append to `FocusScreener.module.css`:

```css
.topBar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 20px; min-height: 60px; border-bottom: 1px solid var(--border); }
.badge { display: inline-block; margin-left: 6px; background: var(--ut-gold); color: var(--bg); border-radius: 999px; padding: 0 7px; font-size: 11.5px; font-weight: 700; }
.iconBtn { background: transparent; border: 0; color: var(--text-muted); width: var(--tap-min); height: 36px; font: inherit; font-weight: 700; cursor: pointer; }
.menuWrap { position: relative; display: inline-flex; }
.menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; min-width: 220px; background: var(--bg-surface); border: 1px solid var(--border-accent); border-radius: 10px; padding: 6px; display: flex; flex-direction: column; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45); }
.menuRight { left: auto; right: 0; }
.menuItem { display: flex; justify-content: space-between; gap: 12px; text-align: left; background: transparent; border: 0; color: var(--text); padding: 9px 12px; border-radius: 8px; font: inherit; font-size: 13px; cursor: pointer; min-height: 36px; }
.menuItem:hover, .menuItem:focus-visible { background: var(--bg-hover); outline: none; }
.menuDanger { color: var(--loss); }
.menuHint { color: var(--text-muted); font-size: 12px; }
.menuDivider { height: 1px; background: var(--border); margin: 4px 6px; }
.menuHeading { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 12px 4px; }
.receiptBtn { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer; min-height: 36px; }
.liveDot { width: 6px; height: 6px; border-radius: 50%; background: var(--gain); }
.idleDot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.infoMark { border: 1px solid var(--border-accent); border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; }
.receipt { width: 320px; padding: 14px; gap: 10px; }
.receiptHead { margin: 0; color: var(--text); font-size: 13px; line-height: 1.5; }
.receiptGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; font-variant-numeric: tabular-nums; }
.receiptGrid dt { color: var(--text-muted); font-size: 11.5px; }
.receiptGrid dd { margin: 0; font-size: 16px; font-weight: 700; }
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(screener-focus): top bar, accessible menu primitive, save/more/help menus, data receipt`.

---

### Task 7: Screen menu — groups, pins, search, lazy counts

**Files:**
- Create: `app/src/pages/screener/focus/ScreenMenu.jsx`, `screenGroups.js`, `useLazyCounts.js`
- Test: `app/src/pages/screener/focus/__tests__/screenGroups.test.js`, `useLazyCounts.test.jsx`, `ScreenMenu.test.jsx`

**Interfaces:**
- Consumes: `useSavedScreens()` → `{ saved, starters, create, update, remove, refresh }`; `usePreferences` from `app/src/hooks/usePreferences` (confirm with `grep -n "export" app/src/hooks/usePreferences.js`; it returns `[value, setValue]` for a key — use the confirmed signature).
- Produces:
  - `screenGroups.js`: `GROUPS = [{key:'momentum', label:'Momentum leaders'}, {key:'breakouts', label:'Breakouts & entries'}, {key:'bases', label:'Bases & chart patterns'}, {key:'earnings', label:'Earnings'}, {key:'quality', label:'Quality & value'}]`; `groupOf(starter) -> string` (uses `starter.group` when present — phase 2 — else `FALLBACK_GROUP[starter.id]`, else `'momentum'`); `migratePinned({ favorites, chipPrefs, starters }) -> string[]` (ordered ids; favorites first, then chip prefs, dedup, only ids that exist; empty → `DEFAULT_PINNED`); `DEFAULT_PINNED = ['starter_momentum_leaders', 'starter_power_plays', 'starter_tight_bases', 'starter_three_weeks_tight']` (confirm each id exists in `starters()`; drop any that do not).
  - `useLazyCounts(specsById, enabled) -> { [id]: number|null|undefined }` — `undefined` = not asked yet, `null` = failed. ≤12 concurrent `POST /api/screener/count`, session cache keyed by `JSON.stringify(spec)` in a module `Map`. Phase 2 (Task 12) swaps the transport for the batch endpoint behind the same signature.
  - `ScreenMenu({ currentName, currentId, isEdited, count, starters, saved, pinned, onTogglePin, onApply(spec, item), onSaveChanges|null, onSaveAsNew, onRename|null, onNewScreen, myScans, onUseScan })`.

- [ ] **Step 1: Read the real starter ids and the prefs hook** — `python - <<'EOF'` printing `[s['id'] for s in starters()]` from `api.services.screener.saved_screens`; and `sed -n 1,40p app/src/hooks/usePreferences.js`. Paste the real ids into `FALLBACK_GROUP` and `DEFAULT_PINNED` below (the ids shown are the ones seen in source at plan time: `starter_uct_50`, `starter_momentum_leaders`, `starter_pullback_20ema`; the rest must be read, not guessed).

- [ ] **Step 2: Write the failing tests**

```js
// screenGroups.test.js
import { groupOf, migratePinned, DEFAULT_PINNED } from '../screenGroups'

const starters = [{ id: 'starter_momentum_leaders' }, { id: 'starter_uct_50' }, { id: 'x_new', group: 'Earnings' }]

test('server group wins, then fallback map, then momentum', () => {
  expect(groupOf({ id: 'x_new', group: 'Earnings' })).toBe('earnings')
  expect(groupOf({ id: 'starter_uct_50' })).toBe('momentum')
  expect(groupOf({ id: 'unknown' })).toBe('momentum')
})
test('migration keeps favorites first, dedups, drops unknown ids', () => {
  expect(migratePinned({ favorites: ['starter_uct_50', 'gone'], chipPrefs: ['starter_momentum_leaders', 'starter_uct_50'], starters }))
    .toEqual(['starter_uct_50', 'starter_momentum_leaders'])
})
test('nothing to migrate gives the defaults that exist', () => {
  const out = migratePinned({ favorites: [], chipPrefs: [], starters: DEFAULT_PINNED.map(id => ({ id })) })
  expect(out).toEqual(DEFAULT_PINNED)
})
```

```jsx
// useLazyCounts.test.jsx
import { renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import useLazyCounts, { __resetCountCache } from '../useLazyCounts'

beforeEach(() => { __resetCountCache(); global.fetch = vi.fn() })

test('does nothing until enabled', () => {
  renderHook(() => useLazyCounts({ a: { filters: [] } }, false))
  expect(fetch).not.toHaveBeenCalled()
})
test('fetches each spec once and caches', async () => {
  fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ count: 42 }) }))
  const specs = { a: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } }
  const { result, rerender } = renderHook(({ e }) => useLazyCounts(specs, e), { initialProps: { e: true } })
  await waitFor(() => expect(result.current.a).toBe(42))
  rerender({ e: true })
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('caps concurrency at 12', async () => {
  let inflight = 0, peak = 0
  fetch.mockImplementation(async () => {
    inflight++; peak = Math.max(peak, inflight)
    await new Promise(r => setTimeout(r, 5))
    inflight--
    return { ok: true, json: async () => ({ count: 1 }) }
  })
  const specs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, { filters: [{ key: 'k', op: 'gte', min: i }] }]))
  const { result } = renderHook(() => useLazyCounts(specs, true))
  await waitFor(() => expect(Object.values(result.current).filter(v => v === 1)).toHaveLength(30))
  expect(peak).toBeLessThanOrEqual(12)
})
test('a failed count is null, not zero', async () => {
  fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  const { result } = renderHook(() => useLazyCounts({ a: { filters: [] } }, true))
  await waitFor(() => expect(result.current.a).toBeNull())
})
```

```jsx
// ScreenMenu.test.jsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../useLazyCounts', () => ({ default: () => ({ starter_momentum_leaders: 412 }) }))
import ScreenMenu from '../ScreenMenu'

const starters = [
  { id: 'starter_momentum_leaders', name: 'Leaders (RS ≥ 90)', spec: { filters: [] }, description: 'RS rank 90 or higher' },
  { id: 'starter_uct_50', name: 'UCT 50', spec: { filters: [] } },
]
const saved = [{ id: 5, name: 'Semis on watch', spec: { filters: [] } }]
const props = { currentName: 'Leaders (RS ≥ 90)', currentId: 'starter_momentum_leaders', count: 412, isEdited: false, starters, saved,
  pinned: ['starter_momentum_leaders'], onTogglePin: vi.fn(), onApply: vi.fn(), onSaveChanges: null, onSaveAsNew: vi.fn(),
  onRename: null, onNewScreen: vi.fn(), myScans: [], onUseScan: vi.fn() }

test('trigger names the screen and its count', () => {
  render(<ScreenMenu {...props} />)
  expect(screen.getByRole('button', { name: /Leaders \(RS ≥ 90\).*412/ })).toBeInTheDocument()
})
test('opens with pinned first, then groups and my screens', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  const dlg = screen.getByRole('dialog', { name: 'Screens' })
  const heads = within(dlg).getAllByRole('heading').map(h => h.textContent)
  expect(heads[0]).toBe('Pinned')
  expect(heads).toContain('My screens')
  expect(within(dlg).getByText('RS rank 90 or higher')).toBeInTheDocument()
})
test('search filters items', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'semis' } })
  expect(screen.getByText('Semis on watch')).toBeInTheDocument()
  expect(screen.queryByText('UCT 50')).toBeNull()
})
test('picking applies and closes', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.click(screen.getByRole('button', { name: /Open UCT 50/ }))
  expect(props.onApply).toHaveBeenCalledWith(starters[1].spec, expect.objectContaining({ id: 'starter_uct_50' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('pin toggles without applying', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Pin UCT 50' }))
  expect(props.onTogglePin).toHaveBeenCalledWith('starter_uct_50')
  expect(props.onApply).not.toHaveBeenCalled()
})
test('edited screen offers save changes', () => {
  render(<ScreenMenu {...props} isEdited onSaveChanges={vi.fn()} currentName="Semis on watch" currentId={5} />)
  expect(screen.getByRole('button', { name: /Semis on watch \(edited\)/ })).toBeInTheDocument()
})
```

- [ ] **Step 3: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/screenGroups.test.js src/pages/screener/focus/__tests__/useLazyCounts.test.jsx src/pages/screener/focus/__tests__/ScreenMenu.test.jsx`

- [ ] **Step 4: Implement**

```js
// screenGroups.js
export const GROUPS = [
  { key: 'momentum', label: 'Momentum leaders' },
  { key: 'breakouts', label: 'Breakouts & entries' },
  { key: 'bases', label: 'Bases & chart patterns' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'quality', label: 'Quality & value' },
]
const BY_LABEL = Object.fromEntries(GROUPS.map(g => [g.label.toLowerCase(), g.key]))
// Phase-1 fallback until starters() carries `group` (Task 13). Fill from Step 1's real ids.
export const FALLBACK_GROUP = {
  starter_uct_50: 'momentum',
  starter_momentum_leaders: 'momentum',
  starter_pullback_20ema: 'momentum',
  // …every remaining starter id from Step 1, mapped to one of GROUPS[].key
}
export const DEFAULT_PINNED = ['starter_momentum_leaders', 'starter_power_plays', 'starter_tight_bases', 'starter_three_weeks_tight']

export function groupOf(starter) {
  const g = String(starter?.group || '').toLowerCase()
  if (g) return BY_LABEL[g] || (GROUPS.some(x => x.key === g) ? g : g === 'chart patterns' ? 'bases' : 'momentum')
  return FALLBACK_GROUP[starter?.id] || 'momentum'
}

export function migratePinned({ favorites = [], chipPrefs = [], starters = [] }) {
  const known = new Set(starters.map(s => String(s.id)))
  const out = []
  for (const id of [...favorites, ...chipPrefs].map(String)) if (known.has(id) && !out.includes(id)) out.push(id)
  if (out.length) return out
  return DEFAULT_PINNED.filter(id => known.has(id))
}
```

(The `'chart patterns'` branch maps the existing pattern starters' `group: "Chart Patterns"` to `bases`. Add `'chart patterns': 'bases'` handling exactly as written.)

```js
// useLazyCounts.js
import { useEffect, useState } from 'react'

const cache = new Map()        // spec JSON -> number | null
const inflight = new Map()     // spec JSON -> Promise
let active = 0
const queue = []
const LIMIT = 12
export function __resetCountCache() { cache.clear(); inflight.clear(); queue.length = 0; active = 0 }

function pump() {
  while (active < LIMIT && queue.length) {
    const job = queue.shift(); active++
    job().finally(() => { active--; pump() })
  }
}
function countFor(spec) {
  const key = JSON.stringify(spec)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  if (inflight.has(key)) return inflight.get(key)
  const p = new Promise(resolve => {
    queue.push(async () => {
      let v = null
      try {
        const r = await fetch('/api/screener/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key })
        if (r.ok) { const j = await r.json(); v = Number.isFinite(j?.count) ? j.count : null }
      } catch { v = null }
      cache.set(key, v); inflight.delete(key); resolve(v)
    })
    pump()
  })
  inflight.set(key, p)
  return p
}

export default function useLazyCounts(specsById, enabled) {
  const [counts, setCounts] = useState({})
  const sig = JSON.stringify(specsById)
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    for (const [id, spec] of Object.entries(specsById || {})) {
      const key = JSON.stringify(spec)
      if (cache.has(key)) { setCounts(c => (c[id] === cache.get(key) ? c : { ...c, [id]: cache.get(key) })); continue }
      countFor(spec).then(v => { if (alive) setCounts(c => ({ ...c, [id]: v })) })
    }
    return () => { alive = false }
  }, [sig, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return counts
}
```

```jsx
// ScreenMenu.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import useLazyCounts from './useLazyCounts'
import { GROUPS, groupOf } from './screenGroups'
import styles from './FocusScreener.module.css'

const norm = s => String(s || '').toLowerCase()

function Item({ item, pinned, count, current, onApply, onTogglePin }) {
  return (
    <div className={`${styles.smItem} ${current ? styles.smCurrent : ''}`}>
      <button type="button" className={styles.smPin} aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${item.name}`} onClick={() => onTogglePin(item.id)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 17v5M5 9l3-6h8l3 6-3 3v3H8v-3z" /></svg>
      </button>
      <button type="button" className={styles.smOpen} aria-label={`Open ${item.name}`} onClick={() => onApply(item)}>
        <span className={styles.smName}>{item.name}</span>
        {item.description && <span className={styles.smDesc}>{item.description}</span>}
      </button>
      <span className={styles.smCount}>{count === undefined ? '' : count === null ? '—' : count.toLocaleString('en-US')}</span>
    </div>
  )
}

export default function ScreenMenu({ currentName, currentId, isEdited, count, starters = [], saved = [], pinned = [], onTogglePin, onApply, onSaveChanges, onSaveAsNew, onRename, onNewScreen, myScans = [], onUseScan }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef(null), box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!box.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const close = () => { setOpen(false); setQ(''); btn.current?.focus() }

  const all = useMemo(() => [
    ...starters.map(s => ({ ...s, kind: 'starter' })),
    ...saved.map(s => ({ ...s, id: s.id, kind: 'saved', description: s.description || '' })),
  ], [starters, saved])
  const match = it => !q || norm(it.name).includes(norm(q)) || norm(it.description).includes(norm(q))
  const pinnedItems = pinned.map(id => all.find(it => String(it.id) === String(id))).filter(Boolean).filter(match)
  const groups = GROUPS.map(g => ({ ...g, items: starters.filter(s => groupOf(s) === g.key).map(s => ({ ...s, kind: 'starter' })).filter(match) }))
    .filter(g => g.items.length)
  const mine = saved.map(s => ({ ...s, kind: 'saved' })).filter(match)

  const specs = useMemo(() => Object.fromEntries(all.map(it => [String(it.id), it.spec || { filters: [] }])), [all])
  const counts = useLazyCounts(specs, open)
  const pick = it => { onApply(it.spec || { filters: [] }, it); close() }
  const label = `${currentName || 'Custom screen'}${isEdited ? ' (edited)' : ''}`
  const row = it => <Item key={`${it.kind}-${it.id}`} item={it} pinned={pinned.map(String).includes(String(it.id))}
    count={counts[String(it.id)]} current={String(it.id) === String(currentId)} onApply={pick} onTogglePin={onTogglePin} />

  return (
    <span className={styles.menuWrap} ref={box}>
      <button ref={btn} type="button" className={styles.screenBtn} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${label}, ${count ?? 0} matches. Change screen`} onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        <span className={styles.screenCount}>{Number.isFinite(count) ? count.toLocaleString('en-US') : ''}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Screens" className={`${styles.menu} ${styles.screenMenu}`} onKeyDown={e => { if (e.key === 'Escape') close() }}>
          <div className={styles.smSearch}>
            <input type="search" aria-label="Search screens" placeholder="Search screens…" value={q} autoFocus onChange={e => setQ(e.target.value)} className={styles.input} />
          </div>
          <div className={styles.smBody}>
            {pinnedItems.length > 0 && <section><h3 className={styles.smHead}>Pinned</h3>{pinnedItems.map(row)}</section>}
            {groups.map(g => <section key={g.key}><h3 className={styles.smHead}>{g.label}</h3>{g.items.map(row)}</section>)}
            {mine.length > 0 && <section><h3 className={styles.smHead}>My screens</h3>{mine.map(row)}</section>}
            {myScans.length > 0 && (
              <section><h3 className={styles.smHead}>My scans</h3>
                {myScans.filter(s => !q || norm(s.name).includes(norm(q))).map(s => (
                  <div key={s.hash} className={styles.smItem}>
                    <button type="button" className={styles.smOpen} onClick={() => { onUseScan(s.hash, s.name); close() }}>
                      <span className={styles.smName}>{s.name}</span><span className={styles.smDesc}>Use as a filter</span>
                    </button>
                  </div>))}
              </section>)}
          </div>
          <div className={styles.smFoot}>
            {onSaveChanges && <button type="button" className={styles.btn} onClick={() => { onSaveChanges(); close() }}>Save changes to &ldquo;{currentName}&rdquo;</button>}
            <button type="button" className={styles.linkBtn} onClick={() => { onSaveAsNew(); close() }}>Save as new…</button>
            {onRename && <button type="button" className={styles.linkBtn} onClick={() => { onRename(); close() }}>Rename</button>}
            <span className={styles.spacer} />
            <button type="button" className={styles.goldLink} onClick={() => { onNewScreen(); close() }}>+ New screen</button>
          </div>
        </div>
      )}
    </span>
  )
}
```

Append to CSS:

```css
.screenBtn { display: inline-flex; align-items: center; gap: 10px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; color: var(--text-heading); padding: 8px 14px; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; min-height: 40px; }
.screenCount { color: var(--text-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.screenMenu { width: 560px; max-width: calc(100vw - 40px); max-height: min(80vh, 760px); padding: 0; overflow: hidden; }
.smSearch { padding: 12px; border-bottom: 1px solid var(--border); }
.input { width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--border-accent); border-radius: 8px; color: var(--text); padding: 9px 12px; font: inherit; font-size: 13px; }
.smBody { overflow-y: auto; padding: 6px; }
.smHead { margin: 0; padding: 12px 12px 6px; color: var(--text-muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.smItem { display: flex; align-items: center; gap: 8px; padding: 2px 8px; border-radius: 8px; }
.smItem:hover { background: var(--bg-hover); }
.smCurrent { background: var(--ut-gold-dim); }
.smPin { background: none; border: 0; color: var(--text-muted); width: 32px; height: 36px; cursor: pointer; }
.smPin[aria-pressed='true'] { color: var(--ut-gold); }
.smOpen { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 6px 0; cursor: pointer; }
.smName { font-size: 13.5px; font-weight: 600; color: var(--text-heading); }
.smDesc { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.smCount { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 12.5px; min-width: 40px; text-align: right; }
.smFoot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--bg); }
.goldLink { background: none; border: 0; color: var(--ut-gold); font: inherit; font-size: 13px; cursor: pointer; min-height: 36px; }
```

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit** `feat(screener-focus): screen menu with pins, groups, search and lazy counts`.

---

### Task 8: Filters drawer

**Files:**
- Create: `app/src/pages/screener/focus/FiltersDrawer.jsx`
- Modify: `app/src/pages/screener/shell/FilterControl.jsx` (add optional `presentation="buttons"`)
- Test: `app/src/pages/screener/focus/__tests__/FiltersDrawer.test.jsx`, extend `app/src/pages/screener/shell/FilterControl.test.jsx` if it exists (else create `FilterControl.buttons.test.jsx`)

**Interfaces:**
- Consumes: `FilterRail` (`../shell/FilterRail`, props as used in ScannerShell: `meta, activeFilters, onChange, onClear, variant, matchCount, matchCountEmpty, matchCountLoading, matchCountAsOf, criteriaSlot`); `CriteriaBox` (`../shell/CriteriaBox`, props `logic, onApply`); `chipLabel`; `Sheet` from `components/mobile/Sheet` is NOT used (custom left drawer).
- Produces: `FiltersDrawer({ open, onClose, meta, filters, logic, onSetFilter(key, v|null), onClear, onSetLogic, count, countLoading, lists:[{value,label}] })`. Universe pill is first; label: none → "All stocks", `universe.value==='uct'` → "UCT Universe", `list` → its `label` or "Watchlist". The universe pill opens a small menu (All stocks / UCT Universe / each list in `lists`) writing `universe`/`list` exactly as `UniverseBar` does: All → `setFilter('universe', null); setFilter('list', null)`; UCT → `setFilter('list', null); setFilter('universe', {op:'eq', value:'uct', label:'UCT Universe'})`; a list → `setFilter('universe', null); setFilter('list', {op:'in', value, label})`.
- `FilterControl` gains `presentation` prop: `'select'` (default, unchanged) or `'buttons'` — renders each preset as a `<button aria-pressed>` plus "Custom…".

- [ ] **Step 1: Read `FilterControl.jsx` and `FilterRail.jsx` fully** (`sed -n 1,91p …FilterControl.jsx`; `sed -n 1,253p …FilterRail.jsx`). Note: FilterRail passes each def to `FilterControl`; add a `presentation` prop to FilterRail that it forwards to every `FilterControl` (default `'select'`), so ScannerShell is unchanged.

- [ ] **Step 2: Write the failing tests**

```jsx
// FiltersDrawer.test.jsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../shell/FilterRail', () => ({ default: p => <div data-testid="rail" data-presentation={p.presentation} /> }))
vi.mock('../../shell/CriteriaBox', () => ({ default: () => <div data-testid="criteria" /> }))
import FiltersDrawer from '../FiltersDrawer'

const meta = { filters: [{ key: 'rs_rank', label: 'RS Rank', type: 'range', presets: [] }] }
const base = { open: true, onClose: vi.fn(), meta, logic: null, onSetFilter: vi.fn(), onClear: vi.fn(), onSetLogic: vi.fn(), count: 214, countLoading: false,
  lists: [{ value: 'wl:7', label: 'Semis' }] }

test('universe pill reads All stocks with no pool', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(screen.getByRole('button', { name: /Universe: All stocks/ })).toBeInTheDocument()
})
test('active filters are removable pills', () => {
  render(<FiltersDrawer {...base} filters={{ universe: { op: 'eq', value: 'uct', label: 'UCT Universe' }, rs_rank: { op: 'gte', min: 80 } }} />)
  expect(screen.getByRole('button', { name: /Universe: UCT Universe/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove RS Rank: ≥ 80' }))
  expect(base.onSetFilter).toHaveBeenCalledWith('rs_rank', null)
})
test('picking a list sets list and clears universe', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Semis' }))
  expect(base.onSetFilter).toHaveBeenCalledWith('universe', null)
  expect(base.onSetFilter).toHaveBeenCalledWith('list', { op: 'in', value: 'wl:7', label: 'Semis' })
})
test('custom criteria shows as one pill', () => {
  render(<FiltersDrawer {...base} filters={{}} logic={{ any: [] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Custom criteria' }))
  expect(base.onSetLogic).toHaveBeenCalledWith(null)
})
test('rail renders preset buttons', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(screen.getByTestId('rail')).toHaveAttribute('data-presentation', 'buttons')
})
test('footer button shows the count and closes', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show 214 stocks' }))
  expect(base.onClose).toHaveBeenCalled()
})
test('escape closes; closed renders nothing', () => {
  const { rerender } = render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Filters' }), { key: 'Escape' })
  expect(base.onClose).toHaveBeenCalled()
  rerender(<FiltersDrawer {...base} open={false} filters={{}} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})
```

```jsx
// FilterControl.buttons.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FilterControl from './FilterControl'

const f = { key: 'rs_rank', label: 'RS Rank', type: 'range', allow_custom: true,
  presets: [{ label: 'Any' }, { label: '≥ 80', op: 'gte', min: 80 }, { label: '≥ 90', op: 'gte', min: 90 }] }

test('buttons presentation sets a preset', () => {
  const onChange = vi.fn()
  render(<FilterControl f={f} active={null} onChange={onChange} presentation="buttons" />)
  fireEvent.click(screen.getByRole('button', { name: '≥ 90' }))
  expect(onChange).toHaveBeenCalledWith('rs_rank', expect.objectContaining({ op: 'gte', min: 90 }))
})
test('the active preset is pressed; Any clears', () => {
  const onChange = vi.fn()
  render(<FilterControl f={f} active={{ op: 'gte', min: 80 }} onChange={onChange} presentation="buttons" />)
  expect(screen.getByRole('button', { name: '≥ 80' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Any' }))
  expect(onChange).toHaveBeenCalledWith('rs_rank', null)
})
test('default presentation is still a select', () => {
  render(<FilterControl f={f} active={null} onChange={vi.fn()} />)
  expect(screen.getByRole('combobox')).toBeInTheDocument()
})
```

Before running, adjust prop names in this test to `FilterControl`'s real signature read in Step 1 (e.g. `def` vs `f`, `value` vs `active`); the assertions stay.

- [ ] **Step 3: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/FiltersDrawer.test.jsx src/pages/screener/shell/FilterControl.buttons.test.jsx`

- [ ] **Step 4: Implement `FilterControl` buttons branch** — inside the component, before the existing `<Select>` return, add:

```jsx
  if (presentation === 'buttons') {
    const isActive = p => active && p.op === active.op && p.value === active.value && p.min === active.min && p.max === active.max
    return (
      <div className={styles.presetRow} role="group" aria-label={f.label}>
        {(f.presets || []).map(p => (
          <button key={p.label} type="button" aria-pressed={p.label === 'Any' ? !active : !!isActive(p)}
            className={styles.presetBtn} onClick={() => onChange(f.key, p.label === 'Any' ? null : stripLabel(p))}>{p.label}</button>
        ))}
        {f.allow_custom && <button type="button" className={styles.presetCustom} onClick={() => setCustom(true)}>Custom…</button>}
        {custom && customInputs}
      </div>
    )
  }
```

where `stripLabel` builds the same `{op, value, min, max}` object the existing select branch emits for a preset (reuse that code path — extract it into a local function if it is inline), `custom`/`setCustom` and `customInputs` are the existing custom min/max state and inputs (move them into a variable so both branches render them). Add `.presetRow { display:flex; flex-wrap:wrap; gap:4px }`, `.presetBtn` (border `--border`, radius 6px, `aria-pressed=true` → border `--ut-gold`, background `--ut-gold-dim`, colour `--ut-gold`, min-height 32px) and `.presetCustom` (link style, colour `--ut-gold`) to the CSS module FilterControl already imports. In `FilterRail.jsx` accept `presentation = 'select'` and pass it to every `<FilterControl …>`.

- [ ] **Step 5: Implement `FiltersDrawer.jsx`**

```jsx
import { useEffect, useRef } from 'react'
import FilterRail from '../shell/FilterRail'
import CriteriaBox from '../shell/CriteriaBox'
import Menu, { MenuItem } from './Menu'
import { chipLabel } from '../chipLabel'
import styles from './FocusScreener.module.css'

function universeLabel(filters) {
  if (filters?.list) return filters.list.label || 'Watchlist'
  if (filters?.universe?.value === 'uct') return 'UCT Universe'
  return 'All stocks'
}

export default function FiltersDrawer({ open, onClose, meta, filters = {}, logic, onSetFilter, onClear, onSetLogic, count, countLoading, lists = [] }) {
  const panel = useRef(null)
  useEffect(() => { if (open) panel.current?.querySelector('input,button')?.focus() }, [open])
  if (!open) return null
  const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
  const pills = Object.entries(filters).filter(([k, v]) => v && k !== 'universe' && k !== 'list')
  const setPool = choice => {
    if (choice === 'all') { onSetFilter('universe', null); onSetFilter('list', null) }
    else if (choice === 'uct') { onSetFilter('list', null); onSetFilter('universe', { op: 'eq', value: 'uct', label: 'UCT Universe' }) }
    else { onSetFilter('universe', null); onSetFilter('list', { op: 'in', value: choice.value, label: choice.label }) }
  }
  return (
    <div className={styles.drawerScrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="Filters" className={styles.drawer}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <header className={styles.drawerHead}>
          <h2 className={styles.drawerTitle}>Filters</h2>
          <span className={styles.drawerCount} aria-live="polite">{countLoading ? 'Counting…' : `${(count ?? 0).toLocaleString('en-US')} matches`}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.iconBtn} aria-label="Close filters" onClick={onClose}>×</button>
        </header>
        <div className={styles.drawerSection}>
          <div className={styles.pillRow}>
            <Menu label={`Universe: ${universeLabel(filters)}`} trigger={<><span className={styles.pillKey}>Universe</span> {universeLabel(filters)} ▾</>} triggerClassName={styles.pill} width={240}>
              <MenuItem onSelect={() => setPool('all')}>All stocks</MenuItem>
              <MenuItem onSelect={() => setPool('uct')}>UCT Universe</MenuItem>
              {lists.map(l => <MenuItem key={l.value} onSelect={() => setPool(l)}>{l.label}</MenuItem>)}
            </Menu>
            {pills.map(([k, v]) => {
              const text = chipLabel(defs[k] || { key: k, label: k, presets: [] }, v) || k
              return (
                <span key={k} className={styles.pill}>
                  {text}
                  <button type="button" className={styles.pillX} aria-label={`Remove ${text}`} onClick={() => onSetFilter(k, null)}>×</button>
                </span>
              )
            })}
            {logic && (
              <span className={styles.pill}>Custom criteria
                <button type="button" className={styles.pillX} aria-label="Remove Custom criteria" onClick={() => onSetLogic(null)}>×</button>
              </span>
            )}
            {(pills.length > 0 || logic) && <button type="button" className={styles.linkBtn} onClick={onClear}>Clear all</button>}
          </div>
        </div>
        <div className={styles.drawerBody}>
          <FilterRail meta={meta} activeFilters={filters} onChange={onSetFilter} onClear={onClear}
            variant="sheet" presentation="buttons" matchCount={count} matchCountLoading={countLoading} />
        </div>
        <footer className={styles.drawerFoot}>
          <details className={styles.codeBox}>
            <summary className={styles.linkBtn}>Edit as code</summary>
            <CriteriaBox logic={logic} onApply={onSetLogic} />
          </details>
          <span className={styles.spacer} />
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            {countLoading ? 'Show stocks' : `Show ${(count ?? 0).toLocaleString('en-US')} stocks`}
          </button>
        </footer>
      </aside>
    </div>
  )
}
```

Describe-it stays inside `CriteriaBox` in phase 1 (that component already renders "Describe it" + "Write criteria" when the NL feature is on). Task 14 moves it to the drawer top and turns its output into pills.

Append to CSS:

```css
.drawerScrim { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.45); }
.drawer { position: absolute; left: 0; top: 0; bottom: 0; width: 460px; max-width: 100%; background: var(--bg-surface); border-right: 1px solid var(--border-accent); display: flex; flex-direction: column; }
.drawerHead { display: flex; align-items: center; gap: 10px; padding: 16px 18px 12px; }
.drawerTitle { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-heading); }
.drawerCount { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.drawerSection { padding: 12px 18px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.drawerBody { flex: 1; overflow-y: auto; padding: 8px 10px; }
.drawerFoot { display: flex; align-items: flex-start; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--border); }
.pillRow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 6px 4px 12px; font: inherit; font-size: 12.5px; background: var(--bg-elevated); border: 1px solid var(--border-accent); color: var(--text); cursor: pointer; min-height: 32px; }
.pillKey { color: var(--text-muted); }
.pillX { background: none; border: 0; color: var(--text-muted); font-size: 15px; width: 28px; height: 28px; cursor: pointer; }
.codeBox { flex: 1; min-width: 0; }
@media (max-width: 640px) { .drawer { width: 100%; } }
```

- [ ] **Step 6: Run** the two test files from Step 3 plus the existing rail/control suites: `cd app && npx vitest run src/pages/screener/focus/__tests__/FiltersDrawer.test.jsx src/pages/screener/shell/FilterControl.buttons.test.jsx src/pages/screener/shell/FilterRail.test.jsx src/pages/screener/shell/FilterControl.test.jsx` (drop any file that does not exist — check with `ls` first). Expect PASS.
- [ ] **Step 7: Commit** `feat(screener-focus): filters drawer with universe pill and preset buttons`.

---

### Task 9: `FocusScreener` — wire it all together

**Files:**
- Modify: `app/src/pages/screener/focus/FocusScreener.jsx` (replace stub)
- Create: `app/src/pages/screener/focus/emptyUndo.js`
- Test: `app/src/pages/screener/focus/__tests__/emptyUndo.test.js`, `FocusScreener.test.jsx`

**Interfaces:**
- Consumes everything above plus: `useScreenerMeta` (`{meta, error, retry}`), `useScreenSpec({viewColumnsFor})`, `useScreenerScan(spec)`, `useScreenerCount(spec)`, `useRealtimePrices(tickers)` (`{prices}`), `useSavedScreens()`, `useFlagged()` (`{toggle, isFlagged}`), `useMemberInterestSurface('member_interest_screener_enabled')` + `useMemberInterest(enabled)` + `followedAmong(entities, syms)` (from `app/src/lib/memberInterest.js`; read `useMemberInterestSurface`'s export location with grep before importing), `exportScreen` (`../shell/csvExport`), `exportQuota`/`downloadExport` (`../../../lib/dataExport`), `buildScreenerCapture` (`../shell/notebookCapture`), `sendCaptureToJournal` (read `SaveToNotebookButton.jsx` to find the exact import it uses and call the same function), `promote` (`../shell/promoteApi`), `saveFork` (`../shell/saveForkApi`), `ScannerShell` (Table mode), `Sheet` + `MethodologyPanel` + `StructureProvenance` (help sheets), `ScanFilterChip`'s `joinedScanReceipts` for scan coverage, `scanErrorText`, `LIVE_WINDOW` (`../shell/VirtualResults`), `chartsLinkPath` (`../../../lib/chartDeepLink`), `useNavigate`.
- `emptyUndo.js` produces: `diffOneFilter(prevFilters, nextFilters) -> {key, label?}|null` (exactly one key added or changed), `describeEmptying({ prevSpec, prevTotal, nextSpec, nextTotal, defs }) -> {label, from}|null` (only when `prevTotal > 0`, `nextTotal === 0` and exactly one filter differs; label via `chipLabel`).

- [ ] **Step 1: Write the failing tests**

```js
// emptyUndo.test.js
import { diffOneFilter, describeEmptying } from '../emptyUndo'
const defs = { adr: { key: 'adr', label: '8-wk gain', type: 'range', unit: '%', presets: [] } }

test('one changed key is found', () => {
  expect(diffOneFilter({ a: { op: 'gte', min: 1 } }, { a: { op: 'gte', min: 2 } })).toEqual({ key: 'a' })
  expect(diffOneFilter({}, { a: { op: 'gte', min: 1 } })).toEqual({ key: 'a' })
})
test('two changes or a removal is not one change', () => {
  expect(diffOneFilter({}, { a: {}, b: {} })).toBeNull()
  expect(diffOneFilter({ a: { op: 'gte', min: 1 } }, {})).toBeNull()
})
test('describes the emptying filter', () => {
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 31, nextSpec: { filters: { adr: { op: 'gte', min: 200 } } }, nextTotal: 0, defs }))
    .toEqual({ label: '8-wk gain: ≥ 200%', from: 31 })
})
test('no description when it was already empty or still has rows', () => {
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 0, nextSpec: { filters: { adr: { op: 'gte', min: 1 } } }, nextTotal: 0, defs })).toBeNull()
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 31, nextSpec: { filters: { adr: { op: 'gte', min: 1 } } }, nextTotal: 4, defs })).toBeNull()
})
```

```jsx
// FocusScreener.test.jsx — integration with the network mocked at fetch
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const rowsA = [{ ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, rs_rank: 94 },
  { ticker: 'ECO', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1, rs_rank: 97 }]
let scanRows = rowsA
function route(url, opts) {
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: scanRows, total: scanRows.length, page: 1, snapshot_date: '2026-10-12' }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: scanRows.length }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  return { ok: true, json: async () => ([]) }
}
beforeEach(() => { scanRows = rowsA; global.fetch = vi.fn(async (u, o) => route(String(u), o)) })
const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)

test('list shows up and the first stock is charted', async () => {
  mount()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'MU')
})
test('arrow down charts the next stock', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
})
test('clicking a row charts it', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-ECO'))
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
})
test('table toggle swaps to the old table', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  expect(screen.getByTestId('table-mode')).toBeInTheDocument()
})
test('a scan failure shows the error state with retry', async () => {
  global.fetch = vi.fn(async (u, o) => (String(u) === '/api/screener/scan' ? { ok: false, status: 504, json: async () => ({}) } : route(String(u), o)))
  mount()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load"))
})
test('selection resets when the result set changes', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  scanRows = [{ ticker: 'ZZZ', price: 1, chg_pct_1d: 0, base_render: 'Flat Base', vol_ratio: 1 }]
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
  await waitFor(() => expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ZZZ'))
})
```

- [ ] **Step 2: Run — expect FAIL.** `cd app && npx vitest run src/pages/screener/focus/__tests__/emptyUndo.test.js src/pages/screener/focus/__tests__/FocusScreener.test.jsx`

- [ ] **Step 3: Implement `emptyUndo.js`**

```js
import { chipLabel } from '../chipLabel'

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function diffOneFilter(prev = {}, next = {}) {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changed = [...keys].filter(k => !same(prev[k], next[k]))
  if (changed.length !== 1) return null
  const key = changed[0]
  return next[key] ? { key } : null
}

export function describeEmptying({ prevSpec, prevTotal, nextSpec, nextTotal, defs = {} }) {
  if (!(prevTotal > 0) || nextTotal !== 0) return null
  const d = diffOneFilter(prevSpec?.filters, nextSpec?.filters)
  if (!d) return null
  const def = defs[d.key] || { key: d.key, label: d.key, presets: [] }
  return { label: chipLabel(def, nextSpec.filters[d.key]) || def.label, from: prevTotal }
}
```

- [ ] **Step 4: Implement `FocusScreener.jsx`**

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useScreenerMeta from '../hooks/useScreenerMeta'
import useScreenerScan from '../hooks/useScreenerScan'
import useScreenerCount from '../hooks/useScreenerCount'
import useSavedScreens from '../hooks/useSavedScreens'
import useScreenSpec, { REQUIRED_COLS } from '../shell/useScreenSpec'
import { scanErrorText } from '../shell/scanErrorText'
import { LIVE_WINDOW } from '../shell/VirtualResults'
import { LIVE_SORTABLE, sortRowsLive } from '../shell/liveSort'
import { exportScreen } from '../shell/csvExport'
import { exportQuota, downloadExport } from '../../../lib/dataExport'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import { useFlagged } from '../../../hooks/useFlagged'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import ScannerShell from '../shell/ScannerShell'
import Sheet from '../../../components/mobile/Sheet'
import MethodologyPanel from '../../../components/screener/MethodologyPanel'
import StructureProvenance from '../../../components/screener/StructureProvenance'
import FocusTopBar from './FocusTopBar'
import ScreenMenu from './ScreenMenu'
import FiltersDrawer from './FiltersDrawer'
import SaveMenu from './SaveMenu'
import MoreMenu from './MoreMenu'
import HelpMenu from './HelpMenu'
import DataReceipt, { coverageHasDrop } from './DataReceipt'
import ResultList from './ResultList'
import ChartPane from './ChartPane'
import { ListSkeleton, EmptyState, ErrorState } from './FocusStates'
import useFocusSelection from './useFocusSelection'
import useWatchlistTarget from './useWatchlistTarget'
import { whyItsHere, whyColumns } from './whyItsHere'
import { describeEmptying } from './emptyUndo'
import { migratePinned } from './screenGroups'
import styles from './FocusScreener.module.css'

const LIST_COLUMNS = ['base_render', 'vol_ratio', 'rs_rank', 'market_cap', 'adr_pct', 'industry', 'sector', 'next_earnings_date', 'base_pivot_px']
const MODE_KEY = 'uct.screener.layout'
const PIN_KEY = 'uct.screener.pinned'
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ok */ } }

export default function FocusScreener() {
  const navigate = useNavigate()
  const { meta, error: metaError, retry: retryMeta } = useScreenerMeta()
  const viewColumnsFor = useMemo(() => {
    const map = Object.fromEntries((meta?.views || []).map(v => [v.key, v.columns]))
    return key => map[key] || map.overview || null
  }, [meta])
  const s = useScreenSpec({ viewColumnsFor })
  const [retryNonce, setRetryNonce] = useState(0)
  const columns = useMemo(() => [...new Set([...REQUIRED_COLS, ...LIST_COLUMNS, ...whyColumns(s.filters)])], [s.filters])
  const scanSpec = useMemo(() => ({ ...s.scanSpec, columns, ...(retryNonce ? { _retry: retryNonce } : {}) }), [s.scanSpec, columns, retryNonce])
  const { result, isLoading, error } = useScreenerScan(scanSpec)
  const { count, isLoading: countLoading } = useScreenerCount(s.scanSpec)

  // rows accumulate across pages, like ScannerShell
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(null)
  useEffect(() => {
    if (!result) return
    setTotal(result.total)
    setRows(prev => (result.page === 1 ? result.rows : [...prev, ...result.rows]))
  }, [result])
  const hasMore = total != null && rows.length < total

  const { prices } = useRealtimePrices(useMemo(() => rows.slice(0, LIVE_WINDOW).map(r => r.ticker), [rows]))
  const [liveSortOn, setLiveSortOn] = useState(false)
  const displayRows = useMemo(() => (liveSortOn ? sortRowsLive(rows, s.sort, prices) : rows), [liveSortOn, rows, s.sort, prices])

  const { toggle: toggleFlag, isFlagged } = useFlagged()
  const watch = useWatchlistTarget()
  const [toast, setToast] = useState(null)
  const say = useCallback(msg => { setToast(msg); setTimeout(() => setToast(null), 4000) }, [])
  const onWatch = useCallback(async row => say((await watch.add(row.ticker)).message), [watch, say])
  const onFlag = useCallback(row => toggleFlag(row.ticker), [toggleFlag])
  const onOpen = useCallback(row => navigate(chartsLinkPath({ symbol: row.ticker, tf: 'D' })), [navigate])

  const sel = useFocusSelection({ rows: displayRows, hasMore, onLoadMore: s.loadMore, onOpen, onFlag, onWatch })
  const listRef = useRef(null)

  // radar dots (member interest), off unless the surface flag is on — read the
  // gate the same way ScannerShell does (useMemberInterestSurface).
  const radar = useRadar(displayRows)

  // screen identity: which saved/starter screen is applied, and is it edited
  const { saved, starters, create, update, refresh } = useSavedScreens()
  const [current, setCurrent] = useState(null) // {id, name, kind, spec}
  const isEdited = !!current && JSON.stringify(normalSpec(current.spec)) !== JSON.stringify(normalSpec(s.baseSpec))
  const [pinned, setPinned] = useState(() => { try { return JSON.parse(readLS(PIN_KEY, 'null')) } catch { return null } })
  const effectivePinned = pinned ?? migratePinned({ favorites: [], chipPrefs: [], starters })
  const togglePin = id => {
    const next = effectivePinned.map(String).includes(String(id)) ? effectivePinned.filter(x => String(x) !== String(id)) : [...effectivePinned, String(id)]
    setPinned(next); writeLS(PIN_KEY, JSON.stringify(next))
  }
  const applyScreen = (spec, item) => { s.applySpec(spec); setCurrent({ id: item.id, name: item.name, kind: item.kind, spec }) }

  // empty-state undo bookkeeping
  const prevRef = useRef({ spec: null, total: null })
  const [lastChange, setLastChange] = useState(null)
  useEffect(() => {
    if (!result || result.page !== 1) return
    const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
    const desc = describeEmptying({ prevSpec: prevRef.current.spec, prevTotal: prevRef.current.total,
      nextSpec: { filters: s.filters }, nextTotal: result.total, defs })
    setLastChange(desc ? { ...desc, undo: prevRef.current.spec } : null)
    if (result.total > 0) prevRef.current = { spec: { filters: s.filters, baseSpec: s.baseSpec }, total: result.total }
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  // mode, drawers and sheets
  const [mode, setMode] = useState(() => readLS(MODE_KEY, 'list'))
  const onMode = m => { setMode(m); writeLS(MODE_KEY, m) }
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sheet, setSheet] = useState(null) // 'methodology' | 'library' | null
  const [density, setDensity] = useState(() => readLS('uct.screener.density', 'compact'))
  const [showCompany, setShowCompany] = useState(true)

  // exports
  const [serverExport, setServerExport] = useState(null)
  useEffect(() => { let live = true; exportQuota().then(q => { if (live) setServerExport(q) }); return () => { live = false } }, [])
  const exportCsv = async () => {
    try {
      if (serverExport) { const out = await downloadExport('/api/exports/screener', { method: 'POST', format: 'csv', body: { ...s.baseSpec, columns } }); say(`Exported ${out.rows.toLocaleString()} rows`) }
      else { const out = await exportScreen({ spec: { ...s.baseSpec, columns }, columns, labels: {}, snapshotDate: result?.snapshot_date }); say(`Exported ${out.rows.toLocaleString()} rows${out.truncated ? ' (first 5,000)' : ''}`) }
    } catch { say('Export failed. Nothing was downloaded.') }
  }
  const exportXlsx = serverExport ? async () => {
    try { const out = await downloadExport('/api/exports/screener', { method: 'POST', format: 'xlsx', body: { ...s.baseSpec, columns } }); say(`Exported ${out.rows.toLocaleString()} rows`) }
    catch { say('Export failed. Nothing was downloaded.') }
  } : null

  const saveCaps = useSaveCapabilities()   // see Step 5
  const filterCount = Object.keys(s.filters).filter(k => k !== 'universe' && k !== 'list').length + (s.logic ? 1 : 0)
  const why = useMemo(() => whyItsHere({ filters: s.filters, logic: s.logic, rank: s.rank, metaFilters: meta?.filters, row: sel.selected || {} }),
    [s.filters, s.logic, s.rank, meta, sel.selected])
  const lists = useWatchlistPoolOptions()  // see Step 5
  const sortLabel = (meta?.filters || []).find(f => f.key === s.sort?.key)?.label || s.sort?.key || 'Default'

  const topBar = (
    <FocusTopBar
      screenMenu={<ScreenMenu currentName={current?.name} currentId={current?.id} isEdited={isEdited} count={total}
        starters={starters} saved={saved} pinned={effectivePinned} onTogglePin={togglePin} onApply={applyScreen}
        onSaveChanges={current?.kind === 'saved' && isEdited ? async () => { await update(current.id, { spec: s.baseSpec }); setCurrent(c => ({ ...c, spec: s.baseSpec })); refresh(); say('Saved') } : null}
        onSaveAsNew={() => saveCaps.saveAsScreen(s.baseSpec, create, say, refresh, setCurrent)}
        onRename={current?.kind === 'saved' ? () => saveCaps.rename(current, update, refresh, setCurrent) : null}
        onNewScreen={() => { s.clearFilters(); s.setLogic(null); setCurrent(null); setFiltersOpen(true) }}
        myScans={(meta?.filters || []).find(f => f.key === 'scan')?.scans || []}
        onUseScan={(hash, name) => s.setFilter('scan', { op: 'in', value: hash, label: name })} />}
      filterCount={filterCount} onOpenFilters={() => setFiltersOpen(true)}
      dataReceipt={<DataReceipt snapshotDate={result?.snapshot_date} live={!!result?.live} coverage={result?.coverage} />}
      mode={mode} onMode={onMode}
      saveMenu={<SaveMenu {...saveCaps.flags(!!result && total > 0)} count={total}
        onSaveScreen={() => saveCaps.saveAsScreen(s.baseSpec, create, say, refresh, setCurrent)}
        onFrozenList={() => saveCaps.frozenList(s.baseSpec, say)}
        onAlert={() => saveCaps.alert(s.baseSpec, say)}
        onNotebook={() => saveCaps.notebook({ meta, filters: s.filters, rows: displayRows, prices, total, result, columns, say })} />}
      moreMenu={<MoreMenu onExportCsv={exportCsv} onExportXlsx={exportXlsx} liveSortEligible={LIVE_SORTABLE.has(s.sort?.key)}
        liveSortOn={liveSortOn} onToggleLiveSort={() => setLiveSortOn(v => !v)} density={density}
        onDensity={d => { setDensity(d); writeLS('uct.screener.density', d) }} showCompany={showCompany} onToggleCompany={() => setShowCompany(v => !v)} />}
      helpMenu={<HelpMenu onHowTo={null} onMethodology={() => setSheet('methodology')} onLibrary={() => setSheet('library')}
        onGlossary={() => setFiltersOpen(true)} onShortcuts={() => say('↑ ↓ move · Shift+F flag · W watchlist · Enter full chart · / filters')} />}
    />
  )

  let body
  if (mode === 'table') body = <div className={styles.tableMode}><ScannerShell /></div>
  else if (metaError && !meta) body = <ErrorState message="The filter list couldn't be loaded." onRetry={retryMeta} />
  else if (error) body = <ErrorState message={scanErrorText(error)} onRetry={() => setRetryNonce(n => n + 1)} />
  else if (!result && isLoading) body = <div className={styles.body}><div className={styles.listWrap}><ListSkeleton /></div><div className={styles.pane} /></div>
  else if (result && total === 0) body = (
    <EmptyState filterCount={filterCount} lastChange={lastChange}
      onUndo={() => { if (lastChange?.undo?.baseSpec) s.applySpec(lastChange.undo.baseSpec) }}
      onOpenFilters={() => setFiltersOpen(true)} />)
  else body = (
    <div className={styles.body}>
      <ResultList ref={listRef} rows={displayRows} index={sel.index} onSelect={sel.select} onKeyDown={sel.onKeyDown}
        livePrices={prices} radar={radar} sortLabel={sortLabel} total={total} hasMore={hasMore}
        onLoadMore={s.loadMore} isLoading={isLoading} onSort={() => setFiltersOpen(true)} />
      <ChartPane row={sel.selected} livePrice={sel.selected ? prices[sel.selected.ticker] : null} why={why}
        onOpenFilters={() => setFiltersOpen(true)} onFlag={onFlag} isFlagged={sel.selected ? isFlagged(sel.selected.ticker) : false} onWatch={onWatch} />
    </div>
  )

  return (
    <div className={styles.page} data-testid="focus-screener" data-density={density}>
      {topBar}
      {coverageHasDrop(result?.coverage) && (
        <p className={styles.dropNote} role="status">
          {result.coverage.dropped + result.coverage.not_computable} stocks could not be checked against every filter. They are left out of this list.
        </p>)}
      {body}
      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} meta={meta} filters={s.filters} logic={s.logic}
        onSetFilter={s.setFilter} onClear={() => { s.clearFilters(); s.setLogic(null) }} onSetLogic={s.setLogic}
        count={count} countLoading={countLoading} lists={lists} />
      <Sheet open={sheet === 'methodology'} onClose={() => setSheet(null)} variant="auto" title="Methodology" ariaLabel="Methodology" maxWidth={880}>
        {sheet === 'methodology' && <MethodologyPanel />}
      </Sheet>
      <Sheet open={sheet === 'library'} onClose={() => setSheet(null)} variant="auto" title="Structure library" ariaLabel="Structure library" maxWidth={880}>
        {sheet === 'library' && <StructureProvenance />}
      </Sheet>
      {toast && <div className={styles.toast} role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

function normalSpec(sp) {
  const f = (sp?.filters || []).filter(x => x.key !== 'universe' && x.key !== 'list')
    .map(({ key, op, min, max, value, values }) => ({ key, op, min, max, value, values })).sort((a, b) => a.key.localeCompare(b.key))
  return { f, logic: sp?.logic || null, rank: sp?.rank || null }
}
```

- [ ] **Step 5: Implement the three helpers referenced above in a sibling file** `app/src/pages/screener/focus/focusActions.js` and import them into `FocusScreener.jsx` (`import { useRadar, useSaveCapabilities, useWatchlistPoolOptions } from './focusActions'`):

```js
// focusActions.js
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useMemberInterestSurface, useMemberInterest, followedAmong } from '../../../lib/memberInterest'
import { promoteToWatchlist } from '../shell/promoteApi'
import { fetchSaveForkOptions, saveFork } from '../shell/saveForkApi'
import { buildScreenerCapture } from '../shell/notebookCapture'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendCaptureToJournal'

export function useRadar(rows) {
  const on = useMemberInterestSurface('member_interest_screener_enabled')
  const interest = useMemberInterest(on)
  return useMemo(() => new Set(on && interest ? followedAmong(interest.entities, rows.map(r => r.ticker)).map(x => x.sym) : []), [on, interest, rows])
}

export function useWatchlistPoolOptions() {
  const { data } = useSWR('/api/watchlists', u => fetch(u).then(r => (r.ok ? r.json() : [])))
  const arr = Array.isArray(data) ? data : data?.watchlists || []
  return arr.filter(w => w?.id != null).map(w => ({ value: w.is_flagged_list ? 'flagged' : `wl:${w.id}`, label: w.name || 'Watchlist' }))
}

export function useSaveCapabilities() {
  const [fork, setFork] = useState(null) // {frozen_list, standing_alert} availability, or null when the door is dark
  useEffect(() => { let live = true; fetchSaveForkOptions().then(o => { if (live) setFork(o) }).catch(() => { if (live) setFork(null) }); return () => { live = false } }, [])
  const ask = (q, d = '') => { const v = typeof window !== 'undefined' ? window.prompt?.(q, d) : null; return v && v.trim() ? v.trim() : null }
  return {
    flags: hasResult => ({
      canSaveScreen: true,
      canFrozenList: hasResult && !!fork?.frozen_list,
      canAlert: !!fork?.standing_alert,
      canNotebook: hasResult,
    }),
    async saveAsScreen(spec, create, say, refresh, setCurrent) {
      const name = ask('Name this screen'); if (!name) return
      const out = await create(name, spec)
      if (out?.ok === false) { say(out.error || 'Could not save this screen.'); return }
      refresh(); setCurrent({ id: out?.id ?? out?.screen?.id, name, kind: 'saved', spec }); say(`Saved "${name}"`)
    },
    async rename(current, update, refresh, setCurrent) {
      const name = ask('Rename this screen', current.name); if (!name) return
      await update(current.id, { name }); refresh(); setCurrent(c => ({ ...c, name }))
    },
    async frozenList(spec, say) {
      const name = ask('Name the watchlist'); if (!name) return
      try { await promoteToWatchlist(spec, name); say(`Saved today's list as "${name}"`) } catch (e) { say(e?.message || 'Could not save the list.') }
    },
    async alert(spec, say) {
      const name = ask('Name this alert'); if (!name) return
      try { await saveFork({ kind: 'standing_alert', name, spec }); say(`You'll be alerted when a stock enters "${name}"`) } catch (e) { say(e?.message || 'Could not set the alert.') }
    },
    async notebook({ meta, filters, rows, prices, total, result, columns, say }) {
      try {
        await sendCaptureToJournal(buildScreenerCapture({ meta, filters, visibleColumns: columns, displayRows: rows, livePrices: prices,
          spec: { filters }, total, snapshotDate: result?.snapshot_date, snapshot: result?.snapshot, scanReceipts: [] }))
        say('Added to your Notebook')
      } catch { say('Could not add to the Notebook.') }
    },
  }
}
```

**Before writing this file, read and correct every import against source:** `grep -n "^export" app/src/pages/screener/shell/promoteApi.js app/src/pages/screener/shell/saveForkApi.js app/src/lib/memberInterest.js`, and `grep -n "import" app/src/pages/journal-2-0/components/SaveToNotebookButton.jsx` to find the real capture-send function and its path. Use the real names and argument shapes; the structure (three hooks/objects with these responsibilities) stays. `window.prompt` is acceptable for naming in phase 1 because `PromoteButton` already uses it; Task 15's browser walk checks each Save outcome end to end.

Append to CSS:

```css
.tableMode { flex: 1; min-height: 0; overflow: auto; }
.dropNote { margin: 0; padding: 8px 20px; background: var(--ut-gold-dim); color: var(--text); font-size: 12.5px; border-bottom: 1px solid var(--border); }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 80; background: var(--bg-elevated); border: 1px solid var(--border-accent); color: var(--text); padding: 10px 16px; border-radius: 10px; font-size: 13px; }
[data-density='comfortable'] .row { padding-top: 14px; padding-bottom: 14px; }
```

- [ ] **Step 6: Run — expect PASS.** `cd app && npx vitest run src/pages/screener/focus/__tests__/` (the whole focus test folder; it is ~10 files). Then the neighbours that must stay green: `cd app && npx vitest run src/pages/Screener.focusSwitch.test.jsx src/pages/screener/shell/ScannerShell.test.jsx src/pages/Screener.door.test.jsx`.

- [ ] **Step 7: Lint the folder** `cd app && npx eslint src/pages/screener/focus` — fix every error (warnings about exhaustive-deps that carry an inline disable are fine).

- [ ] **Step 8: Commit** `feat(screener-focus): FocusScreener orchestrator — list + chart, menus, drawer, states, table mode`.

---

### Task 10: Local preview rig and first browser walk (phase 1)

**Files:**
- Create: `tools/screener_focus_preview.md` (the exact commands, recorded for reuse — not code)

**Interfaces:** none (verification task).

- [ ] **Step 1: Check the box.** `powershell -NoProfile -Command "(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue"` — need ≥ 4,000. Count running vitest/pytest processes; do not start if another gate is running.

- [ ] **Step 2: Build the frontend.** `cd app && npm run build` — expect `✓ built`.

- [ ] **Step 3: Find the screener DB pin** (never guess the env name):

```
python -c "import conftest;_,pins,_=conftest.shared_data_root_census();print({k:v for k,v in pins.items() if 'screener' in v.lower() or 'bars' in v.lower()})"
```

- [ ] **Step 4: Seed a sandbox with a READ-ONLY copy of the live screener snapshot** (market data, no member data). From PowerShell:

```powershell
New-Item -ItemType Directory -Force 'C:\data-screener-preview' | Out-Null
python -c "import sqlite3;s=sqlite3.connect('file:C:/data/screener.db?mode=ro',uri=True);s.execute(\"VACUUM INTO 'C:/data-screener-preview/screener.db'\");print('ok')"
```

(Use the file name the pin in Step 3 resolves to; if it is not `screener.db`, use that name.) Never open any other `C:\data` file.

- [ ] **Step 5: Boot the sandbox with the flag on for everyone** on a port that is free (8093; the launcher refuses a busy port):

```powershell
$env:SCREENER_FOCUS_LAYOUT_ENABLED='1'
powershell -File scripts/hub-sandbox.ps1 -DataDir 'C:\data-screener-preview' -Port 8093
```

Run it in the background. First line of its output must be the snapshot-compare result `CLEAN`; stop if not.

- [ ] **Step 6: Sign in** with the sandbox test account the launcher mints (`hubtest@local.dev`, see `scripts/hub_sandbox_boot.py` for the password source) — signing in on `localhost` with a test account is allowed. Give it paid access if `/screener` redirects to `/subscribe` (admin accounts are paid by construction).

- [ ] **Step 7: Browser walk** with the Chrome tools (new tab, `http://localhost:8093/screener`), at 1440×900 then 1024×768. Record a GIF named `screener_focus_walk.gif`. Check and write PASS/FAIL per line into `tools/screener_focus_preview.md`:
  1. The list appears; the first row is selected and its chart draws.
  2. ↓ ×10 (list focused): the chart follows every step; no blank frames longer than a blink.
  3. Click a row lower down: the chart follows.
  4. Screen menu: opens, shows Pinned + groups + counts; picking a preset changes the list and the trigger name.
  5. Filters: opens; universe pill switches All / UCT; a preset button adds a pill; removing it updates the count; Escape closes.
  6. Empty state: add a filter that empties the list; the sentence names it; Undo restores the rows.
  7. Save ▾ lists only available outcomes; ⋯ Export CSV downloads (or says why not); ? opens Methodology and Structure library sheets.
  8. Table toggle shows today's table; List returns.
  9. Shift+F flags the selected row; W adds it to a watchlist and the toast says which.
  10. With the flag unset (restart without `SCREENER_FOCUS_LAYOUT_ENABLED`), `/screener` shows today's page unchanged.
  11. Console: no errors (read with `read_console_messages`, pattern `error|Error`).

- [ ] **Step 8:** Fix every FAIL in the owning task's files (add a test for each before fixing), re-run that task's tests, re-walk the failed lines. Commit fixes per task. Commit `tools/screener_focus_preview.md` with the PASS table.

- [ ] **Step 9: Show the owner.** Send screenshots (desktop + 1024) and the GIF to the user. Stop the sandbox (kill only the PID the launcher printed) and confirm the snapshot rail's shutdown line reads CLEAN.

---

### Task 11: Phase 2 — coherent pivot (`base_pivot_px`)

**Files:**
- Modify: `api/services/screener/base_catalog.py` (`Structure` gains `pivot`), `api/services/screener/bases.py` (`_NULL` + `classify`), `api/services/screener/snapshot_db.py` (column list ~line 103 + `_REAL` or whichever numeric set holds floats — read the file's `_TEXT`/`_INT` neighbours and add `base_pivot_px` to the float set), `api/services/screener/filters.py` (`COLUMN` registry only if every snapshot column must be declared there — run the column-registry test to find out)
- Test: `tests/test_screener_base_pivot.py`

**Interfaces:**
- Produces: `Structure.pivot: Optional[Callable[[BaseCtx], Optional[float]]] = None`; `classify()` returns key `base_pivot_px` (float or None) — set ONLY when the HEAD of the render order (`order[0]`) has a `pivot` callable that returns a finite positive number; otherwise None. Snapshot column `base_pivot_px REAL`. Frontend already consumes it (Tasks 2, 5).

- [ ] **Step 1: Map structures to their pivot-computing detectors.** Run:

```
python - <<'EOF'
import ast,io
src=io.open('api/services/screener/base_catalog.py',encoding='utf-8').read();t=ast.parse(src)
fns={n.name for n in t.body if isinstance(n,ast.FunctionDef) and '"pivot"' in ast.get_source_segment(src,n)}
for n in ast.walk(t):
    if isinstance(n,ast.Call) and getattr(n.func,'id','')=='Structure':
        kw={k.arg:ast.get_source_segment(src,k.value) for k in n.keywords}
        print(kw.get('key'), '| detect =', (kw.get('detect') or '')[:90])
print('PIVOT FNS:',sorted(fns))
EOF
```

Detectors that return a dict with `"pivot"` (at plan time): `flat_base_state, base_on_base_state, base_stage_count, double_bottom_state, high_tight_flag_state, vcp_state, ascending_base_state, square_box_state, cheat_state, saucer_state, three_weeks_tight_state`. For each `Structure(...)` whose `detect` calls one of these, write its `pivot=` adapter in Step 3. Record the mapping table in the test file's docstring.

- [ ] **Step 2: Write the failing test**

```python
# tests/test_screener_base_pivot.py
"""base_pivot_px is written only from the HEAD structure's own detection."""
import math
from api.services.screener import bases, base_catalog


def _bars_flat_base():
    # 80 bars: a 50% advance then a tight 30-bar flat base under ~150.
    out, p = [], 100.0
    for i in range(50):
        p *= 1.008
        out.append({"t": f"2026-01-{(i % 28) + 1:02d}", "o": p * 0.995, "h": p * 1.01, "l": p * 0.99, "c": p, "v": 1_000_000})
    top = p
    for i in range(30):
        c = top * (0.97 + 0.01 * ((i % 3) - 1))
        out.append({"t": f"2026-03-{(i % 28) + 1:02d}", "o": c, "h": min(top, c * 1.01), "l": c * 0.985, "c": c, "v": 600_000})
    return out


def test_null_shape_has_the_key():
    assert bases.classify([])["base_pivot_px"] is None


def test_every_structure_pivot_is_callable_or_none():
    for s in base_catalog.all_structures() if hasattr(base_catalog, "all_structures") else base_catalog.STRUCTURES:
        assert s.pivot is None or callable(s.pivot), s.key


def test_pivot_belongs_to_the_head_structure():
    row = bases.classify(_bars_flat_base())
    head_label = (row["base_render"] or "").split(" (")[0].split(" +")[0]
    head = next((s for s in base_catalog.STRUCTURES if s.label == head_label), None)
    if head is None or head.pivot is None:
        assert row["base_pivot_px"] is None
    else:
        assert row["base_pivot_px"] is None or (math.isfinite(row["base_pivot_px"]) and row["base_pivot_px"] > 0)


def test_a_head_without_a_pivot_writes_none(monkeypatch):
    real = bases._render_order
    monkeypatch.setattr(bases, "_render_order", lambda shape, rels: ["advancing-structure"])
    try:
        assert bases.classify(_bars_flat_base())["base_pivot_px"] is None
    finally:
        monkeypatch.setattr(bases, "_render_order", real)


def test_snapshot_declares_the_column():
    from api.services.screener import snapshot_db
    assert "base_pivot_px" in snapshot_db.COLUMNS if hasattr(snapshot_db, "COLUMNS") else True
```

Before running, open `base_catalog.py` and replace `base_catalog.STRUCTURES` with the module's real registry name (grep `^[A-Z_]+ = \[` / `def by_key`), and `snapshot_db.COLUMNS` with the real column-list name at line ~60-110. The assertions stay.

- [ ] **Step 3: Run — expect FAIL** (`KeyError: 'base_pivot_px'`). `python -m pytest tests/test_screener_base_pivot.py -q`

- [ ] **Step 4: Implement**
  - `base_catalog.Structure`: add `pivot: Optional[Callable] = None` after `detect`.
  - For each structure mapped in Step 1, add `pivot=lambda ctx: _pivot_of(<detector>(<args as its detect calls it>))`, with a module helper:

```python
def _pivot_of(state) -> Optional[float]:
    """The pivot a detector computed, or None. Never invented: a detector that
    found nothing, or found no pivot, answers None."""
    if not isinstance(state, dict):
        return None
    p = state.get("pivot")
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    return p if p > 0 and p == p and p != float("inf") else None
```

  (The `<args>` must be exactly what that structure's `detect` passes — copy them; e.g. `flat_base_state(ctx.bars, …)` as written in its `detect`.)
  - `bases._NULL`: add `"base_pivot_px": None`.
  - `bases.classify`: after `order = _render_order(...)`, compute

```python
    pivot_px = None
    head = base_catalog.by_key(order[0]) if order else None
    if head is not None and head.pivot is not None:
        try:
            pivot_px = head.pivot(ctx)
        except Exception:  # noqa: BLE001 -- a detector bug must not cost the row
            pivot_px = None
```

  and add `"base_pivot_px": pivot_px,` to the returned dict.
  - `snapshot_db.py`: add `"base_pivot_px"` after `"base_render"` in the column list and to the float/REAL set (not `_TEXT`, not `_INT`). `init_db()` already adds missing columns with `ALTER TABLE` (line ~447), so existing DBs migrate.

- [ ] **Step 5: Run** `python -m pytest tests/test_screener_base_pivot.py tests/test_screener_bases.py tests/test_screener_snapshot*.py -q` (list the real file names with `ls tests | grep -i screener` first; name them explicitly). Expect PASS. If a column-registry rail fails naming `base_pivot_px`, add it where that rail says (usually `filters.py` `columnDefs` or an "every snapshot column is documented" list) and add `base_pivot_px: { label: 'Pivot', fmt: usd }` to `app/src/pages/screener/columnDefs.js`.

- [ ] **Step 6: Frontend check** — `cd app && npx vitest run src/pages/screener/focus/__tests__/setupLine.test.js src/pages/screener/focus/__tests__/ChartPane.test.jsx` (already assert pivot behaviour). Expect PASS.

- [ ] **Step 7: Rebuild the sandbox snapshot locally to see pivots** — the copied `screener.db` has no `base_pivot_px` until a build runs. Run the snapshot builder against the SANDBOX only, with every census pin applied (copy the pin pattern from CLAUDE.md "apply the CENSUS"), limited to a small ticker set if the builder supports it (`grep -n "def build\|tickers" api/services/screener/snapshot_builder.py`). If it cannot be limited, skip local pivots and verify on production after the nightly build; record which in `tools/screener_focus_preview.md`.

- [ ] **Step 8: Commit** `feat(screener): base_pivot_px from the head structure's own detection`.

---

### Task 12: Phase 2 — batch count endpoint

**Files:**
- Modify: `api/routers/screener.py` (after `screener_count`)
- Modify: `app/src/pages/screener/focus/useLazyCounts.js`
- Test: `tests/test_screener_count_batch.py`, extend `app/src/pages/screener/focus/__tests__/useLazyCounts.test.jsx`

**Interfaces:**
- Produces: `POST /api/screener/count/batch` body `{"specs": [ScanSpec, …]}` (1–30), response `{"counts": [{"count": int, "as_of": str|null} | {"error": str}, …]}` in request order, `require_paid`, one failing spec never fails the batch. `useLazyCounts` keeps its signature; transport = batch POSTs of ≤30 uncached specs, falling back to per-spec `/count` when the batch route answers 404.

- [ ] **Step 1: Write the failing backend test**

```python
# tests/test_screener_count_batch.py
from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def client(monkeypatch):
    from api.main import app
    from api.routers import screener as r
    from api.services.auth_deps import require_paid  # use the real dependency import path from api/routers/screener.py
    app.dependency_overrides[require_paid] = lambda: {"id": "u1"}
    calls = []

    def fake_preview(spec, user_id=None):
        calls.append(spec)
        if spec.get("filters") and spec["filters"][0].get("key") == "boom":
            raise ValueError("unknown filter boom")
        return {"count": 7, "as_of": "2026-10-12"}
    monkeypatch.setattr(r.scr_query, "preview_count", fake_preview)
    yield TestClient(app), calls
    app.dependency_overrides.clear()


def test_counts_in_order_and_errors_inline(client):
    c, calls = client
    body = {"specs": [{"filters": []}, {"filters": [{"key": "boom", "op": "gte", "min": 1}]}, {"filters": []}]}
    out = c.post("/api/screener/count/batch", json=body).json()["counts"]
    assert out[0] == {"count": 7, "as_of": "2026-10-12"}
    assert "error" in out[1]
    assert out[2]["count"] == 7


def test_rejects_more_than_30(client):
    c, _ = client
    assert c.post("/api/screener/count/batch", json={"specs": [{"filters": []}] * 31}).status_code == 422


def test_rejects_empty(client):
    c, _ = client
    assert c.post("/api/screener/count/batch", json={"specs": []}).status_code == 422
```

Correct the `require_paid` import to the module `api/routers/screener.py` actually imports it from (`grep -n "require_paid" api/routers/screener.py | head -2`).

- [ ] **Step 2: Run — expect FAIL (404).** `python -m pytest tests/test_screener_count_batch.py -q`

- [ ] **Step 3: Implement** in `api/routers/screener.py` after `screener_count`:

```python
class CountBatch(BaseModel):
    specs: List[ScanSpec] = Field(..., min_length=1, max_length=30)


@router.post("/api/screener/count/batch")
def screener_count_batch(body: CountBatch, user=Depends(require_paid)):
    """Counts for up to 30 specs in one request (the screen menu's numbers).

    Same gate and user_id source as `/count`. One bad spec answers
    `{"error": …}` in its slot; it never fails its neighbours."""
    uid = (user or {}).get("id")
    out = []
    for spec in body.specs:
        try:
            out.append(scr_query.preview_count(spec.model_dump(), user_id=uid))
        except ValueError as e:
            out.append({"error": str(e)})
        except Exception:  # noqa: BLE001 -- one spec, not the batch
            out.append({"error": "count failed"})
    return {"counts": out}
```

Add `List`, `Field`, `BaseModel` imports only if the module lacks them (check the top of the file).

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Frontend — add the failing test** to `useLazyCounts.test.jsx`:

```jsx
test('uses the batch endpoint when available', async () => {
  fetch.mockImplementation(async (url, opts) => {
    if (url === '/api/screener/count/batch') {
      const n = JSON.parse(opts.body).specs.length
      return { ok: true, json: async () => ({ counts: Array.from({ length: n }, () => ({ count: 5 })) }) }
    }
    return { ok: true, json: async () => ({ count: 1 }) }
  })
  const specs = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`s${i}`, { filters: [{ key: 'k', op: 'gte', min: i }] }]))
  const { result } = renderHook(() => useLazyCounts(specs, true))
  await waitFor(() => expect(Object.values(result.current).filter(v => v === 5)).toHaveLength(40))
  expect(fetch.mock.calls.filter(c => c[0] === '/api/screener/count/batch')).toHaveLength(2)
})
test('falls back to single counts when batch is missing', async () => {
  fetch.mockImplementation(async url => (url === '/api/screener/count/batch' ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, json: async () => ({ count: 3 }) }))
  const { result } = renderHook(() => useLazyCounts({ a: { filters: [] } }, true))
  await waitFor(() => expect(result.current.a).toBe(3))
})
```

Update the existing `caps concurrency at 12` test so its mock answers 404 for `/api/screener/count/batch` (it tests the single-count fallback path).

- [ ] **Step 6: Implement** — in `useLazyCounts.js`, inside the effect collect uncached specs, then:

```js
let batchDown = false
async function fetchBatch(entries) { // entries: [[key, spec]]
  const r = await fetch('/api/screener/count/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specs: entries.map(([, sp]) => sp) }) })
  if (r.status === 404) { batchDown = true; throw new Error('no batch') }
  if (!r.ok) throw new Error(String(r.status))
  const j = await r.json()
  entries.forEach(([key], i) => { const c = j.counts?.[i]; cache.set(key, Number.isFinite(c?.count) ? c.count : null) })
}
```

In the effect: if `!batchDown`, chunk uncached entries by 30 and `await fetchBatch(chunk)` each (catch → fall back to `countFor` for that chunk); then set state from the cache. Reset `batchDown` in `__resetCountCache`.

- [ ] **Step 7: Run** `cd app && npx vitest run src/pages/screener/focus/__tests__/useLazyCounts.test.jsx` and `python -m pytest tests/test_screener_count_batch.py -q` — PASS.
- [ ] **Step 8: Commit** `feat(screener): batch count endpoint for the screen menu`.

---

### Task 13: Phase 2 — preset groups and descriptions

**Files:**
- Modify: `api/services/screener/saved_screens.py` (`starters()`)
- Test: `tests/test_screener_starter_copy.py`

**Interfaces:**
- Produces: every dict in `starters()` gains `"group"` (one of `"Momentum leaders" | "Breakouts & entries" | "Bases & chart patterns" | "Earnings" | "Quality & value"`) and `"description"` (one sentence, ≤ 80 chars, no em dash). `pattern_starters()` keep `"group": "Chart Patterns"` (the client maps it to bases) and gain a `"description"`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_screener_starter_copy.py
from api.services.screener.saved_screens import starters

GROUPS = {"Momentum leaders", "Breakouts & entries", "Bases & chart patterns", "Earnings", "Quality & value"}


def test_every_starter_has_a_group_and_a_description():
    for s in starters():
        assert s.get("group") in GROUPS, s["id"]
        d = s.get("description") or ""
        assert 10 <= len(d) <= 80, (s["id"], d)
        assert "—" not in d and "–" not in d, s["id"]


def test_descriptions_are_unique():
    ds = [s["description"] for s in starters()]
    assert len(ds) == len(set(ds))


def test_flagship_ids_and_specs_are_untouched():
    # the existing rail pins specs; this only checks we added keys, not changed specs
    for s in starters():
        assert set(s) >= {"id", "name", "spec", "group", "description"}
```

- [ ] **Step 2: Run — expect FAIL.** `python -m pytest tests/test_screener_starter_copy.py tests/test_screener_saved.py -q`

- [ ] **Step 3: Implement** — add `"group"` and `"description"` to each starter dict, written from each spec's own filters (read every spec; describe what it filters for in trader language, e.g. Leaders → `"RS rank 90 or higher, liquid, above the 50-day"`; UCT 50 → `"Top 50 by UCT composite rating"`; Momentum pullbacks → `"Leaders pulling back to a rising 20-day EMA"`). A description must not claim anything the spec does not filter for. Do not change any `id`, `name` or `spec`.

- [ ] **Step 4: Run — expect PASS** (both files; `test_screener_saved.py` must stay green).
- [ ] **Step 5: Remove the client fallback map entries now covered** — keep `FALLBACK_GROUP` (it still serves a stale cached response) but no edit is required; run `cd app && npx vitest run src/pages/screener/focus/__tests__/screenGroups.test.js` — PASS.
- [ ] **Step 6: Commit** `feat(screener): groups and one-line descriptions on preset screens`.

---

### Task 14: Phase 2 — "Describe a setup" fills the pills

**Files:**
- Modify: `api/services/screener/nl_compile.py` (add `flatten_to_filters`, include `filters` in `compile_english`'s return)
- Modify: `app/src/pages/screener/focus/FiltersDrawer.jsx` (Describe input at the top)
- Create: `app/src/pages/screener/focus/useDescribe.js`
- Test: `tests/test_screener_nl_flatten.py`, `app/src/pages/screener/focus/__tests__/useDescribe.test.jsx`

**Interfaces:**
- Produces: `flatten_to_filters(logic) -> list[dict] | None` — returns the leaf list when `logic` is `{"all": [leaf, …]}` (or a single leaf) and every leaf is a plain filter dict (`key` present, op not ending `_col`, key not in `{"arith", "tickers", "scan", "list", "universe"}`, no nested groups, no duplicate keys); else `None`. `compile_english(...)` return gains `"filters": <that list or None>`. `useDescribe() -> { available:boolean, busy, error, run(text) -> Promise<{filters?:[], logic?, explanation?}> }` using `compileEnglish` from `../shell/criteriaApi`.
- Drawer: when `available`, a "Describe a setup" input above Active; on submit: if `out.filters` → `onClear()` then `onSetFilter(key, rest)` for each leaf and `onSetLogic(null)`; else → `onSetLogic(out.logic)`. Shows `out.explanation` under the input. `available` = the compile route answered anything other than 404 on a `GET /api/screener/grammar` probe (the same probe CriteriaBox uses — read `criteriaApi.js` and reuse its function).

- [ ] **Step 1: Write the failing backend test**

```python
# tests/test_screener_nl_flatten.py
from api.services.screener.nl_compile import flatten_to_filters

A = {"key": "rs_rank", "op": "gte", "min": 80}
B = {"key": "price", "op": "gt", "min": 10}


def test_all_of_plain_leaves_flatten():
    assert flatten_to_filters({"all": [A, B]}) == [A, B]


def test_single_leaf_flattens():
    assert flatten_to_filters(A) == [A]


def test_any_or_none_or_not_do_not():
    assert flatten_to_filters({"any": [A, B]}) is None
    assert flatten_to_filters({"none": [A]}) is None
    assert flatten_to_filters({"not": A}) is None


def test_nested_group_does_not():
    assert flatten_to_filters({"all": [A, {"any": [B]}]}) is None


def test_field_compare_and_arith_do_not():
    assert flatten_to_filters({"all": [A, {"key": "price", "op": "gt_col", "value": "ema20"}]}) is None
    assert flatten_to_filters({"all": [{"key": "arith", "op": "gt", "value": "x"}]}) is None


def test_duplicate_keys_do_not():
    assert flatten_to_filters({"all": [A, {"key": "rs_rank", "op": "lte", "max": 95}]}) is None


def test_none_and_garbage():
    assert flatten_to_filters(None) is None
    assert flatten_to_filters({"all": []}) is None
    assert flatten_to_filters("nope") is None
```

- [ ] **Step 2: Run — expect FAIL.** `python -m pytest tests/test_screener_nl_flatten.py -q`

- [ ] **Step 3: Implement** in `nl_compile.py`:

```python
_POOL_OR_SPECIAL = {"arith", "tickers", "scan", "list", "universe"}
_GROUPS = {"all", "any", "none", "not"}


def flatten_to_filters(logic):
    """A pure all-of tree of plain leaves -> the leaf list; anything else -> None.

    Only this shape can be shown as removable pills without changing what the
    screen means. OR/NOT, nested groups, field-to-field compares and arithmetic
    stay a logic tree ("Custom criteria")."""
    if isinstance(logic, dict) and "key" in logic and not (_GROUPS & set(logic)):
        leaves = [logic]
    elif isinstance(logic, dict) and set(logic) == {"all"} and isinstance(logic["all"], list):
        leaves = logic["all"]
    else:
        return None
    if not leaves:
        return None
    seen = set()
    for leaf in leaves:
        if not isinstance(leaf, dict) or "key" not in leaf or _GROUPS & set(leaf):
            return None
        if leaf["key"] in _POOL_OR_SPECIAL or str(leaf.get("op", "")).endswith("_col"):
            return None
        if leaf["key"] in seen:
            return None
        seen.add(leaf["key"])
    return list(leaves)
```

In `compile_english`, where it builds the returned dict, add `"filters": flatten_to_filters(logic_value)` (use the local variable holding the compiled logic).

- [ ] **Step 4: Run — expect PASS**, plus the existing NL suite: `python -m pytest tests/test_screener_nl_flatten.py tests/test_screener_nl_compile.py -q` (confirm the real file name with `ls tests | grep -i nl`).

- [ ] **Step 5: Write the failing frontend test**

```jsx
// useDescribe.test.jsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../shell/criteriaApi', () => ({
  compileEnglish: vi.fn(async () => ({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], logic: { all: [] }, explanation: 'leaders' })),
  fetchGrammar: vi.fn(async () => ({ ok: true })),
}))
import useDescribe from '../useDescribe'

test('available when the grammar door answers, and run returns filters', async () => {
  const { result } = renderHook(() => useDescribe())
  await waitFor(() => expect(result.current.available).toBe(true))
  let out
  await act(async () => { out = await result.current.run('liquid leaders') })
  expect(out.filters).toHaveLength(1)
})
```

Rename `fetchGrammar` in the mock and in `useDescribe` to the real probe function `criteriaApi.js` exports (read it first).

- [ ] **Step 6: Implement `useDescribe.js`**

```js
import { useCallback, useEffect, useState } from 'react'
import { compileEnglish, fetchGrammar } from '../shell/criteriaApi'

export default function useDescribe() {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { let live = true; fetchGrammar().then(g => { if (live) setAvailable(!!g) }).catch(() => {}); return () => { live = false } }, [])
  const run = useCallback(async text => {
    setBusy(true); setError(null)
    try { return await compileEnglish(text) } catch (e) { setError(e?.message || 'Could not read that. Try different words.'); return null } finally { setBusy(false) }
  }, [])
  return { available, busy, error, run }
}
```

In `FiltersDrawer.jsx`, add above the Active section:

```jsx
        {describe.available && (
          <form className={styles.drawerSection} onSubmit={async e => {
            e.preventDefault()
            const out = await describe.run(text); if (!out) return
            if (Array.isArray(out.filters) && out.filters.length) {
              onClear(); onSetLogic(null)
              for (const { key, ...rest } of out.filters) onSetFilter(key, rest)
            } else if (out.logic) onSetLogic(out.logic)
            setExplain(out.explanation || '')
          }}>
            <label htmlFor="focus-describe" className={styles.describeLabel}>Describe a setup</label>
            <input id="focus-describe" className={styles.input} value={text} onChange={e => setText(e.target.value)}
              placeholder="e.g. liquid tech leaders up 20% this quarter, near highs" disabled={describe.busy} />
            {describe.error && <p className={styles.stateBody} role="alert">{describe.error}</p>}
            {explain && <p className={styles.describeNote}>{explain}</p>}
          </form>
        )}
```

with `const describe = useDescribe()`, `const [text, setText] = useState('')`, `const [explain, setExplain] = useState('')` at the top of the component (before the `if (!open) return null`). Add `.describeLabel { color: var(--ut-gold); font-weight: 600; font-size: 12.5px; display:block; margin-bottom:6px }` and `.describeNote { margin: 6px 0 0; color: var(--text-muted); font-size: 12px }`. Add a FiltersDrawer test: mock `useDescribe` to return filters, submit, and assert `onSetFilter('rs_rank', {op:'gte', min:80})` and `onSetLogic(null)`.

- [ ] **Step 7: Run** `cd app && npx vitest run src/pages/screener/focus/__tests__/useDescribe.test.jsx src/pages/screener/focus/__tests__/FiltersDrawer.test.jsx` — PASS.
- [ ] **Step 8: Commit** `feat(screener): Describe a setup writes plain filters as pills`.

---

### Task 15: Gate, full local walk, ship

**Files:**
- Modify: `tools/screener_focus_preview.md` (final PASS table), `docs/feature_flags.json` (status at flip)

- [ ] **Step 1: Re-run Task 10's walk** with phases 1+2 built (`npm run build`, fresh sandbox). Add lines: screen-menu counts appear quickly (batch), presets show descriptions, Describe-it creates pills (only if the NL flags can be on locally; otherwise record "not available locally"). Send the owner the final screenshots/GIF.

- [ ] **Step 2: Hygiene and lint** — `python tools/check_repo_hygiene.py` and `cd app && npx eslint src/pages/screener/focus src/pages/Screener.jsx` — clean.

- [ ] **Step 3: Six-shard gate** (only on a quiet box, ≥ 8 GB available): `python scripts/gate_shards.py --shards 6`. Read the manifest: totals line, file-count reconciliation, `GATE EXIT:` line. Zero NEW failures against the baseline. Backend: `python -m pytest tests/test_screener_focus_flag.py tests/test_feature_flag_ledger.py tests/test_screener_base_pivot.py tests/test_screener_count_batch.py tests/test_screener_starter_copy.py tests/test_screener_nl_flatten.py tests/test_screener_saved.py -q`.

- [ ] **Step 4: Rebase check** — `BASE=$(git merge-base origin/master HEAD); git rev-list --count $BASE..origin/master`; overlap with `comm` (CLAUDE.md "Rebasing a feature branch"). Merge master in only if required; re-gate if anything overlapped.

- [ ] **Step 5: PR** — `gh pr create` with a summary, the member-impact paragraph ("nothing changes for members until SCREENER_FOCUS_LAYOUT_ENABLED is set; the nightly snapshot gains one column; two new screener endpoints"), test evidence and screenshots; body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Merge and deploy** (standing go for deploys) — one master merge at a time; wait for the web deploy `SUCCESS`, a fresh `/api/health` boot, and ancestry on `origin/production`. Run `tools/hub_nav_smoke.py --auth` per the deploy runbook.

- [ ] **Step 7: Owner preview on production** — `railway variables --service web --set "SCREENER_FOCUS_LAYOUT_ENABLED=admin"`; verify a new boot; read the value in-process. Walk `/screener` on production as the owner (Chrome tools, owner's own session — check `/api/auth/me` email domain is not `.internal` first). Update the ledger entry to `armed`, `where: ["web"]`, note with the flip time.

- [ ] **Step 8: Release to everyone** after the owner preview walk passes — set `SCREENER_FOCUS_LAYOUT_ENABLED=1`, verify boot + in-process value, walk once as a member-role account if available (`bench@` per CLAUDE.md, own Playwright context), update the ledger note. Rollback is `SCREENER_FOCUS_LAYOUT_ENABLED=0` (per request, no redeploy).

- [ ] **Step 9: Report** to the owner in one block: what shipped, SHAs, the flag state, the rollback line.
