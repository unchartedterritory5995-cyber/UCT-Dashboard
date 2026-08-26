import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Mock the widget host + heavy children so we don't bring in real widget
// internals. WidgetHost surfaces the widget type so tests can assert which
// widgets are on the board.
vi.mock('./WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`body-${widget.type}`}>{widget.type}</div>,
}))
vi.mock('./widgets/MobileWorkspace', () => ({ default: () => <div data-testid="mobile-workspace">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))

// Mock react-grid-layout — render children directly so we can assert
// what's in the DOM. The library's drag/resize behavior is its own
// concern; integration is verified in manual smoke.
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-fire-change" onClick={() => onLayoutChange && onLayoutChange([{ i: 'fake', x: 0, y: 0, w: 6, h: 6 }])}>fire</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))

// Mock usePreferences — control returned prefs, capture setPref calls.
// (useMultiChartState consumes the same mock, so seeding `multichart_state`
// here drives the grid mode through the REAL hook.)
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  // Named export used by ChartsWorkspace to read chart_settings when saving a
  // template — mirror the real parse-defensively implementation.
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

// Mock useMediaQuery — default desktop (false); individual tests override.
let mqMatches = false
vi.mock('../../hooks/useMediaQuery', () => ({
  default: () => mqMatches,
}))

// Mock useAuth — ChartsWorkspace reads user.role for the admin-only bits.
let mockUser = { id: 1, role: 'user' }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// Mock useChartLayouts — named layout templates (prebuilt + personal). The
// "default template applies on first visit" behavior gates on isLoading.
let mockLayouts = { global: [], mine: [], isLoading: false, saveLayout: vi.fn(async () => ({})), deleteLayout: vi.fn(async () => {}) }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: mockLayouts.global,
    mine: mockLayouts.mine,
    isLoading: mockLayouts.isLoading,
    saveLayout: (...args) => mockLayouts.saveLayout(...args),
    deleteLayout: (...args) => mockLayouts.deleteLayout(...args),
    refresh: () => {},
  }),
}))

import ChartsWorkspace, { uctDefaultChartSettings } from './ChartsWorkspace'
import { CHART_DEFAULTS, mergeChartSettings } from '../../components/chart/chartDefaults'

function renderWS() {
  return render(
    <MemoryRouter>
      <ChartsWorkspace />
    </MemoryRouter>,
  )
}

// ── Toolbar navigation ──────────────────────────────────────────────────────
// The header used to be seven flat buttons and is now two dropdowns ("Widgets ▾"
// / "Layouts ▾") with sub-panels — and it will very plausibly be regrouped again.
// What these tests care about is that an action is REACHABLE and does what it
// says, not which menu currently holds it, so the PATH is discovered rather than
// typed. Re-nesting an action moves nothing here; only deleting it breaks a test.
//
// Discovery only ever clicks DROPDOWN TRIGGERS, never plain action buttons: a
// trigger sits inside its own positioned group (so its menu can render as a
// sibling), while a plain action — e.g. grid mode's "Workspace" exit — sits
// directly in the <header>. Probing blindly would fire those actions as a side
// effect of merely looking for something else.
function toolbarDropdownTriggers() {
  const header = document.querySelector('header')
  if (!header) return []
  return [...header.querySelectorAll('button')].filter(b => b.parentElement?.parentElement === header)
}

/** The toolbar button matching `name`, opening menus as needed. Null if nothing offers it. */
function toolbarButton(name) {
  // queryAll (not query) so a duplicate label reports as a normal miss/hit rather
  // than throwing out of the search.
  const found = () => screen.queryAllByRole('button', { name })[0] || null
  if (found()) return found()
  for (const trigger of toolbarDropdownTriggers()) {
    // A trigger TOGGLES, and a previous search may have left some menu open, so
    // probe both of its states — and re-check after every click, never only after
    // the first (that miss is how a "close it again" click silently skips a hit).
    for (let i = 0; i < 2; i++) {
      act(() => { trigger.click() })
      if (found()) return found()
    }
  }
  return null
}

/** Click a toolbar action wherever it currently lives. */
function clickToolbar(name) {
  const btn = toolbarButton(name)
  expect(btn, `the toolbar offers nothing matching ${name}`).toBeTruthy()
  act(() => { btn.click() })
  return btn
}

beforeEach(() => {
  setPref.mockReset()
  mockPrefs = {}
  mqMatches = false
  mockUser = { id: 1, role: 'user' }
  mockLayouts = { global: [], mine: [], isLoading: false, saveLayout: vi.fn(async () => ({})), deleteLayout: vi.fn(async () => {}) }
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('every workspace action a member needs is still reachable from the toolbar', () => {
  renderWS()
  // Names, not places. The toolbar consolidation moved every one of these behind a
  // dropdown without removing any; that regrouping is a layout decision and must
  // not be able to fail this file. Losing one outright still must.
  for (const name of [
    /add widget/i, /merge widgets/i, /new layout/i, /open layout/i,
    /save layout/i, /multi chart/i, /pop out layout/i,
  ]) {
    expect(toolbarButton(name), `the toolbar no longer reaches ${name}`).toBeTruthy()
  }
})

// Open the Widget Catalog from the toolbar and return its widget CARDS (each card's
// title is "Add <label>", which isolates them from the pills / close / search).
function openCatalogCards() {
  clickToolbar(/add widget/i)
  const dialog = document.querySelector('[role="dialog"][aria-label="Add a widget"]')
  expect(dialog, 'the Add Widget action should open the Widget Catalog').toBeTruthy()
  return [...dialog.querySelectorAll('button')].filter(b => (b.getAttribute('title') || '').startsWith('Add '))
}

test('a widget can be added to the board from the catalog', () => {
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  const onBoard = () => document.querySelectorAll('[data-testid^="body-"]').length
  expect(onBoard()).toBe(0)

  const cards = openCatalogCards()
  expect(cards.length, 'the catalog offered nothing to add').toBeGreaterThan(0)
  // On an EMPTY board the widget fits in empty space with no adjustment, so smart
  // placement commits it IMMEDIATELY (no ghost). Assert the CAPABILITY — a catalog
  // card puts a widget on the board — rather than naming a type.
  act(() => { cards[0].click() })
  expect(onBoard(), 'clicking a catalog card should add a widget').toBe(1)
})

test('ghost preview appears only when a widget must be adjusted — Cancel adds nothing', () => {
  // A full-width chart fills the board, so adding any widget must resize it → ghost.
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [{ id: 'c1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24 }) }
  renderWS()
  const onBoard = () => document.querySelectorAll('[data-testid^="body-"]').length
  expect(onBoard()).toBe(1) // the seeded chart
  const btnByText = (t) => [...document.querySelectorAll('button')].find(b => b.textContent === t)

  // Pick a widget from the catalog — the full board forces an adjustment → the ghost appears.
  const cards = openCatalogCards()
  act(() => { cards[0].click() })
  expect(btnByText('Place'), 'adding to a full board should preview via ghost').toBeTruthy()
  expect(btnByText('Cancel')).toBeTruthy()
  expect(onBoard(), 'ghost preview must not commit the widget').toBe(1) // still just the chart

  // Cancel → nothing added, ghost dismissed.
  act(() => { btnByText('Cancel').click() })
  expect(onBoard()).toBe(1)
  expect(btnByText('Place'), 'ghost should be gone after Cancel').toBeFalsy()
})

test('first visit (no saved layout) applies the frozen UCT Default arrangement once prefs + templates settle', () => {
  renderWS()
  // No "chart" template exists → falls back to UCT_DEFAULT_LAYOUT: themes + chart +
  // fundamentals + watchlist + aisearch (no scanner).
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
  expect(screen.getByTestId('body-fundamentals')).toBeInTheDocument()
  expect(screen.getByTestId('body-aisearch')).toBeInTheDocument()
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
})

test('clicking "UCT Default" applies the frozen layout AND writes the frozen chart settings', () => {
  // Start from a corrupted/empty board, then open the locked default.
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  clickToolbar(/open layout/i)
  act(() => { screen.getByRole('button', { name: /^UCT Default$/ }).click() })
  // Frozen arrangement is on the board.
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-fundamentals')).toBeInTheDocument()
  // The frozen chart_settings blob is persisted (header titleMode 'both').
  const chartSettingsSave = setPref.mock.calls.find(
    ([k, v]) => k === 'chart_settings' && typeof v === 'string' && v.includes('"titleMode":"both"'),
  )
  expect(chartSettingsSave).toBeTruthy()
})

// ── ENUMERATION SITE #22 — the Flip-B landmine in two menu items ────────────
//
// `UCT_DEFAULT_CHART_SETTINGS_JSON` is a frozen July capture that hand-lists all
// fifteen indicator sections and carries NO engine keys at all (the engine did
// not exist when it was taken). Three first-class actions write it verbatim into
// `chart_settings`, so whatever `uctDefaultChartSettings()` does not stamp from
// the LIVE default is pinned forever for everyone who clicks a menu item.
//
// ⭐⭐ B5 TASK 4 REMOVED HALF OF THIS DEFECT BY REMOVING ITS SUBJECT.
//
// What stood here described a two-key hazard: the capture carried neither
// `engineEnabled` nor `indicatorInstances`, and because `mergeChartSettings` read
// `parsed.engineEnabled === true` — the PARSED BLOB, not the default — an absent
// key and an explicit `false` were the same answer, so clicking "UCT Default"
// after Flip B landed a user on a board where RSI / MACD / BB / VWAP were
// undrawable. **The flag is deleted**, so there is nothing to pin and nothing to
// stamp; `indicatorInstances` is the one key still stamped, and the hazard it
// answers is unchanged.
//
// 🔑 THE ASSERTION THAT MATTERS IS STILL KEY PRESENCE, NOT THE VALUE — the
// `indicatorInstances` half was always the one a value check could not carry
// (`[]` deep-equals `[]` whichever side it came from), which is why the reference
// identity and the presence check are what kill the "route the write back through
// the raw literal" mutation.
//
// ⚠️ AND THE FLAG'S HALF CANNOT BE ASSERTED BY READING THE OUTPUT AT ALL. A
// half-deletion that left `parsed.engineEnabled = CHART_DEFAULTS.engineEnabled` in
// place would assign `undefined`, and **`JSON.stringify` DROPS an `undefined`
// value** — so the persisted string is byte-identical either way and every test in
// this file passes on the un-deleted code. The source scan in
// `engineEnabledMigration.test.js` is what covers it; this comment is here so the
// next reader does not try to add a check that cannot work.
function persistedChartSettings() {
  const call = setPref.mock.calls.find(([k]) => k === 'chart_settings')
  expect(call, 'no chart_settings write happened at all').toBeTruthy()
  expect(typeof call[1], 'chart_settings is persisted as a JSON string').toBe('string')
  return JSON.parse(call[1])
}

function expectEngineKeysFollowTheDefault(parsed) {
  expect(
    Object.prototype.hasOwnProperty.call(parsed, 'indicatorInstances'),
    'the persisted blob must carry indicatorInstances EXPLICITLY — the frozen capture predates '
    + 'the engine, so an absent key here pins the pre-engine value for every menu click',
  ).toBe(true)
  expect(Array.isArray(parsed.indicatorInstances)).toBe(true)
  expect(parsed.indicatorInstances).toEqual(CHART_DEFAULTS.indicatorInstances)
  // …and the deleted flag is not resurrected on the way out.
  expect(Object.prototype.hasOwnProperty.call(parsed, 'engineEnabled'),
    'the write stamped a key that no longer exists').toBe(false)
  // …and read back through the real merge, which is what StockChart sees.
  expect(mergeChartSettings(JSON.stringify(parsed)).indicatorInstances).toEqual([])
}

test('site #22: "UCT Default" persists engine keys that FOLLOW the default, not the frozen capture', () => {
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  clickToolbar(/open layout/i)
  act(() => { screen.getByRole('button', { name: /^UCT Default$/ }).click() })
  const parsed = persistedChartSettings()
  // Still the frozen capture in every respect it was actually a capture of.
  expect(parsed.header.titleMode).toBe('both')
  expectEngineKeysFollowTheDefault(parsed)
})

test('site #22: "New Layout" persists the same engine keys (it writes the same blob)', () => {
  renderWS()
  clickToolbar(/new layout/i)
  expectEngineKeysFollowTheDefault(persistedChartSettings())
})

test('site #22: the written blob follows the default when the default MOVES', () => {
  // The tests above can only assert key PRESENCE, because `[]` deep-equals `[]`
  // whichever side it came from. This is the assertion that actually pins "follows
  // the default", by moving the default and watching the write follow.
  //
  // ⚠️ IT USED TO DRIVE `CHART_DEFAULTS.engineEnabled` (Flip B was exactly that
  // line changing). B5 Task 4 deleted the flag, so the probe is re-pointed at the
  // OTHER stamped key — which is the one that survives into Task 9 and beyond, and
  // which the deletion left behind on purpose.
  const restore = CHART_DEFAULTS.indicatorInstances
  const moved = [{ instanceId: 'probe:rsi', defId: 'rsi', inputs: {} }]
  try {
    CHART_DEFAULTS.indicatorInstances = moved
    const parsed = JSON.parse(uctDefaultChartSettings())
    expect(parsed.indicatorInstances,
      'the frozen capture is still pinning the pre-engine instance list').toEqual(moved)
    expect(mergeChartSettings(uctDefaultChartSettings()).indicatorInstances).toEqual(moved)
  } finally {
    CHART_DEFAULTS.indicatorInstances = restore
  }
  // …and back to the shipped default, so nothing leaks into another test.
  expect(JSON.parse(uctDefaultChartSettings()).indicatorInstances).toEqual(restore)
})

test('site #22 is real: the FROZEN capture enumerates 15 indicator sections and names no engine key', () => {
  // Read from the shipping source, not from a hand-copy. Asserting this against
  // `uctDefaultChartSettings()` would be circular — that function is the fix.
  // The two tests above are only non-vacuous if the raw literal they route
  // around genuinely lacks the keys, and this is where that is established.
  const src = fs.readFileSync(path.join(HERE, 'ChartsWorkspace.jsx'), 'utf8')
  // Greedy `.*` is safe and CRLF-proof: `.` never matches a newline, the literal
  // is one line, and the JSON inside it quotes with `"` only.
  const m = src.match(/const UCT_DEFAULT_CHART_SETTINGS_JSON = '(\{.*\})'/)
  expect(m, 'the frozen chart-settings literal moved — this rail no longer reads it').toBeTruthy()
  const frozen = JSON.parse(m[1])

  // ⭐⭐ B5 TASK 9 RETIRED LEDGER ROW 14 (site #22). The literal used to hand-list
  // FIFTEEN indicator sections — a third copy of ledger sites #1 and #2 — and it
  // now carries the ONE key `mergeChartSettings` still emits. The claim is
  // INVERTED rather than deleted, because "the capture stopped enumerating" and
  // "the assertion was removed" are the same green suite otherwise.
  expect(Object.keys(frozen.indicators),
    'the frozen capture is enumerating indicators again').toEqual(['volumeProfile'])

  // …and no engine key is in it, which is the whole defect. (It named TWO until
  // B5 Task 4; `engineEnabled` is asserted absent from BOTH sides now, and that
  // is not redundant — a resurrected flag in the frozen literal would be the
  // pre-migration value pinned for every menu click, which is the exact shape
  // this site exists to refuse.)
  expect(Object.prototype.hasOwnProperty.call(frozen, 'engineEnabled')).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(frozen, 'indicatorInstances')).toBe(false)

  // The wrapper ADDS exactly TWO engine keys and changes nothing else — the
  // frozen capture stays byte-faithful about everything it was a capture of.
  // ⭐ B5 TASK 9 added the second: `settingsVersion`. The capture predates
  // versioning, so without the stamp every click of **UCT Default** would write a
  // v1-shaped blob the read-time fold re-runs on — record §6's R2 loop.
  const wrapped = JSON.parse(uctDefaultChartSettings())
  expect(Object.prototype.hasOwnProperty.call(wrapped, 'engineEnabled'),
    'the wrapper stamped a key that no longer exists').toBe(false)
  expect(wrapped.settingsVersion, 'the template writes a pre-v2 blob').toBe(2)
  delete wrapped.indicatorInstances
  delete wrapped.settingsVersion
  expect(wrapped).toEqual(frozen)

  // Nothing may write the raw literal to `chart_settings` — the fix is the
  // wrapper, and a writer added later must go through it too. `applyUctDefault`
  // now BRANCHES on the app theme (a white chart on the light theme via
  // `chartDefaultsForTheme('light')`, the frozen wrapper on dark), so every
  // chart_settings writer must route through the wrapper OR that light default —
  // never the raw literal.
  const rawWrites = src.match(/setPref\('chart_settings',\s*UCT_DEFAULT_CHART_SETTINGS_JSON\)/g)
  expect(rawWrites, 'a chart_settings write bypasses uctDefaultChartSettings()').toBeNull()
  // Two writers restore the frozen default directly; `applyUctDefault` BRANCHES on
  // the app theme — a white chart via `chartDefaultsForTheme('light')` on light, the
  // frozen wrapper on dark — so it's ONE theme-conditional writer that still names
  // the wrapper. (The template-restore write of a saved blob's OWN `chartSettings`
  // is a different writer and correctly matches neither.)
  expect(src.match(/setPref\('chart_settings',\s*uctDefaultChartSettings\(\)\)/g)).toHaveLength(2)
  const themed = src.match(/setPref\('chart_settings',\s*appTheme === 'light'[^\n]*uctDefaultChartSettings\(\)\)/g)
  expect(themed, 'applyUctDefault no longer branches the chart canvas on the app theme').toHaveLength(1)
})

test('Save-as-template captures the current chart settings into the saved template', () => {
  const cs = { chartType: 'candles', header: { titleMode: 'both' }, theme: 'dark' }
  mockPrefs = { chart_settings: JSON.stringify(cs) }
  renderWS()
  clickToolbar(/save layout/i)
  fireEvent.change(screen.getByPlaceholderText(/template name/i), { target: { value: 'My Setup' } })
  fireEvent.click(screen.getByRole('button', { name: /^Save template$/ }))
  expect(mockLayouts.saveLayout).toHaveBeenCalledTimes(1)
  const payload = mockLayouts.saveLayout.mock.calls[0][0]
  expect(payload.name).toBe('My Setup')
  expect(payload.layout.chartSettings).toEqual(cs)  // chart settings snapshotted in
  expect(payload.groups).toBeNull()                 // tickers never baked in
})

test('opening a My-layouts template restores its saved chart settings (not leaked into the layout blob)', () => {
  const cs = { chartType: 'bars', header: { titleMode: 'company' }, theme: 'dark' }
  mockLayouts.mine = [{
    id: 42,
    name: 'My Setup',
    layout: {
      widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }],
      cols: 24,
      chartSettings: cs,
    },
  }]
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  clickToolbar(/open layout/i)
  act(() => { screen.getByRole('button', { name: /^My Setup$/ }).click() })
  // Arrangement applied.
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  // Saved chart settings restored.
  const csCall = setPref.mock.calls.find(([k]) => k === 'chart_settings')
  expect(csCall).toBeTruthy()
  expect(csCall[1]).toEqual(cs)
  // chartSettings must NOT leak into the workspace-layout arrangement blob.
  const layoutCall = [...setPref.mock.calls].reverse().find(([k]) => k === 'charts_workspace_layout')
  expect(JSON.parse(layoutCall[1])).not.toHaveProperty('chartSettings')
})

test('Save current arrangement updates the open custom template in place (arrangement + chart settings)', async () => {
  const tpl = {
    id: 42, name: 'My Setup', scope: 'user',
    layout: { widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }], cols: 24 },
  }
  mockLayouts.mine = [tpl]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }),
    chart_settings: JSON.stringify({ chartType: 'bars' }),
    charts_active_template: JSON.stringify({ id: 42, name: 'My Setup', scope: 'user' }),
  }
  renderWS()
  clickToolbar(/save layout/i)
  await act(async () => { screen.getByRole('button', { name: /save current arrangement/i }).click() })
  expect(mockLayouts.saveLayout).toHaveBeenCalledTimes(1)
  const payload = mockLayouts.saveLayout.mock.calls[0][0]
  expect(payload.name).toBe('My Setup')
  expect(payload.scope).toBe('user')
  expect(payload.layout.chartSettings).toEqual({ chartType: 'bars' })
})

test('Save current arrangement does NOT touch any template when none is active', () => {
  mockLayouts.mine = [{ id: 42, name: 'My Setup', scope: 'user', layout: { widgets: [], cols: 24 } }]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }),
    charts_active_template: 'null',
  }
  renderWS()
  clickToolbar(/save layout/i)
  act(() => { screen.getByRole('button', { name: /save current arrangement/i }).click() })
  expect(mockLayouts.saveLayout).not.toHaveBeenCalled()
})

test('deleting a layout asks to confirm; Go back cancels without deleting', () => {
  mockLayouts.mine = [{ id: 42, name: 'My Setup', scope: 'user', layout: { widgets: [], cols: 24 } }]
  renderWS()
  clickToolbar(/open layout/i)
  act(() => { screen.getByRole('button', { name: '✕' }).click() })
  expect(screen.getByText('Delete?')).toBeInTheDocument()
  act(() => { screen.getByRole('button', { name: /go back/i }).click() })
  expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
  expect(mockLayouts.deleteLayout).not.toHaveBeenCalled()
})

test('confirming delete of the OPEN layout deletes it and falls back to UCT Default', async () => {
  mockLayouts.mine = [{
    id: 42, name: 'My Setup', scope: 'user',
    layout: { widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }], cols: 24 },
  }]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({ widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }], cols: 24 }),
    charts_active_template: JSON.stringify({ id: 42, name: 'My Setup', scope: 'user' }),
  }
  renderWS()
  clickToolbar(/open layout/i)
  act(() => { screen.getByRole('button', { name: '✕' }).click() })
  await act(async () => { screen.getByRole('button', { name: /^Yes$/ }).click() })
  expect(mockLayouts.deleteLayout).toHaveBeenCalledWith(42)
  // Fell back to UCT Default: frozen layout persisted + active template cleared.
  const layoutCall = [...setPref.mock.calls].reverse().find(([k]) => k === 'charts_workspace_layout')
  expect(JSON.parse(layoutCall[1]).widgets.some(w => w.type === 'chart')).toBe(true)
  const activeCall = [...setPref.mock.calls].reverse().find(([k]) => k === 'charts_active_template')
  expect(activeCall[1]).toBe('null')
})

test('first visit prefers a prebuilt template named "chart" over the starter fallback', () => {
  mockLayouts.global = [{
    id: 7,
    name: 'Chart',
    layout: {
      widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }],
      cols: 24,
    },
  }]
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
})

test('board stays empty while the layout templates are still loading', () => {
  mockLayouts.isLoading = true
  renderWS()
  // The default-template effect must not run before templates settle.
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
  expect(screen.queryByTestId('body-watchlist')).not.toBeInTheDocument()
  expect(screen.queryByTestId('body-themes')).not.toBeInTheDocument()
})

test('restores saved workspace layout from preferences', () => {
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({
      widgets: [
        { id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 6, h: 6, opts: {} },
      ],
      cols: 12, // legacy 12-col save — parseLayout migrates it to the 24-col grid
      rowHeight: 40,
    }),
  }
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
})

test('corrupted preferences blob falls back safely to the default (starter) layout', () => {
  mockPrefs = { charts_workspace_layout: '{not valid json' }
  renderWS()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
})

test('renders MobileWorkspace (tabbed widget stack) when useMediaQuery indicates mobile', () => {
  mqMatches = true
  renderWS()
  expect(screen.getByTestId('mobile-workspace')).toBeInTheDocument()
  expect(screen.queryByTestId('rgl-responsive')).not.toBeInTheDocument()
})

test('debounced save fires setPref after layout change', () => {
  renderWS()
  act(() => { screen.getByTestId('rgl-fire-change').click() })
  // Debounce is 500ms — advance fake timers; setTimeout callback runs
  // synchronously inside act(), so setPref is already called when we assert.
  act(() => { vi.advanceTimersByTime(600) })
  expect(setPref).toHaveBeenCalledWith(
    'charts_workspace_layout',
    expect.stringContaining('widgets'),
  )
})

test('New Layout wipes the board to empty and persists the blank state', () => {
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({
      widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }],
      cols: 24,
    }),
  }
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  clickToolbar(/new layout/i)
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
  expect(setPref).toHaveBeenCalledWith(
    'charts_workspace_layout',
    expect.stringContaining('"widgets":[]'),
  )
  // Color groups reset too.
  expect(setPref).toHaveBeenCalledWith(
    'charts_workspace_groups',
    JSON.stringify({ A: null, B: null, C: null, D: null }),
  )
})

test('the toolbar opens the MultiChartMenu', () => {
  renderWS()
  expect(screen.queryByTestId('multichart-menu')).not.toBeInTheDocument()
  clickToolbar(/multi chart/i)
  expect(screen.getByTestId('multichart-menu')).toBeInTheDocument()
})

test('grid mode renders MultiChartGrid when multichart_state has mode:"grid"', () => {
  mockPrefs = { multichart_state: JSON.stringify({ mode: 'grid' }) }
  renderWS()
  expect(screen.getByTestId('multichart-grid')).toBeInTheDocument()
  expect(screen.queryByTestId('rgl-responsive')).not.toBeInTheDocument()
  // Workspace-only actions go away entirely in grid mode — not merely off the
  // top level, so this asks the whole toolbar (every dropdown included), which is
  // the only way the absence means what it says now that things nest.
  expect(toolbarButton(/add widget/i), 'Add Widget is still offered in grid mode').toBeNull()
  expect(toolbarButton(/save layout/i), 'Save Layout is still offered in grid mode').toBeNull()
  expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument()
  // Open layout + Multi Chart stay available in grid mode (both are the entry
  // points that persist across modes).
  expect(toolbarButton(/open layout/i)).toBeTruthy()
  expect(toolbarButton(/multi chart/i)).toBeTruthy()
})

// ── Pop-out ────────────────────────────────────────────────────────────────
// Widgets and whole boards open in their own OS windows so they can be dragged
// onto other monitors. They're portals owned by this tab, so the assertions
// below check the popped DOM in a SEPARATE document from the main board's.

/** Stand-in for the window `window.open` returns. */
function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument('popup')
  const listeners = {}
  return {
    document: doc,
    closed: false,
    KeyboardEvent: window.KeyboardEvent,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn) },
    close: vi.fn(function () { this.closed = true }),
    _fire: (t) => (listeners[t] || []).forEach(fn => fn()),
  }
}

function popped(fake, type) {
  return fake.document.querySelector(`[data-testid="body-${type}"]`)
}

test('popping out the layout empties the main board and moves the widgets into the window', () => {
  const fake = makeFakeWindow()
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  try {
    renderWS()
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()

    clickToolbar(/pop out layout/i)

    // Main goes back to a blank board, ready for the next layout.
    expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('body-watchlist')).not.toBeInTheDocument()
    // ...and the whole board is now living in the popped window.
    expect(popped(fake, 'chart')).toBeTruthy()
    expect(popped(fake, 'watchlist')).toBeTruthy()
    expect(popped(fake, 'themes')).toBeTruthy()
  } finally { openSpy.mockRestore() }
})

test('closing a popped-out layout docks its widgets back into the main board', () => {
  const fake = makeFakeWindow()
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  try {
    renderWS()
    clickToolbar(/pop out layout/i)
    expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()

    act(() => { fake._fire('beforeunload') })

    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  } finally { openSpy.mockRestore() }
})

test('a blocked popup leaves the board intact instead of losing the layout', () => {
  // window.open returns null when blocked. Without the dock-on-blocked path the
  // widgets would have been cleared off main with nowhere to have gone.
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
  try {
    renderWS()
    clickToolbar(/pop out layout/i)

    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/blocked/i)
  } finally { openSpy.mockRestore() }
})

test('pop out layout is disabled while the board is empty', () => {
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  expect(toolbarButton(/pop out layout/i)).toBeDisabled()
})

test('a popped-out layout is not disturbed by opening a different layout on the main tab', () => {
  const fake = makeFakeWindow()
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  try {
    renderWS()
    clickToolbar(/pop out layout/i)
    expect(popped(fake, 'chart')).toBeTruthy()

    // Load a fresh layout into the now-blank main tab.
    clickToolbar(/open layout/i)
    act(() => { screen.getByRole('button', { name: /^UCT Default$/ }).click() })

    // Main has its own board again...
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    // ...and the board on the other monitor still stands.
    expect(popped(fake, 'chart')).toBeTruthy()
    expect(popped(fake, 'watchlist')).toBeTruthy()
  } finally { openSpy.mockRestore() }
})
