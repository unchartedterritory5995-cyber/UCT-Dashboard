# Calendar Header Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the crowded `/calendar` desktop header into a single row with one consolidated ⚙ Filters panel, merging the duplicate "My Stocks" personalization control.

**Architecture:** Frontend-only refactor of `CalendarHeader.jsx`. The secondary controls (event types, cap, sort, metric filters, My-Stocks sources, export) move from the always-visible bar into one popover that reuses the SAME control fragments the phone FiltersSheet already renders — so filter *logic* is unchanged, only the controls' location moves. Audience chips stay inline as the primary filter. Cards are untouched.

**Tech Stack:** React + Vite + CSS Modules, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-calendar-header-simplification-design.md`

---

## File Structure

- `app/src/pages/calendar/CalendarHeader.jsx` — rewritten: single-row header, one `panelOpen` state, unified ⚙ Filters panel, extended active-count, export handlers folded in (drop the `FiltersPopover` and `ExportMenu` sub-components).
- `app/src/pages/calendar/Calendar.module.css` — `.hrow` allowed to wrap; remove dead classes.
- `app/src/pages/calendar/CalendarHeader.test.jsx` — new test for the consolidated header.
- `app/src/components/tiles/EarningsModal.jsx` (+ its CSS module) — optional crisp header logo.

No backend, no `usePreferences` key changes.

---

## Task 1: Write the CalendarHeader test (failing)

**Files:**
- Create: `app/src/pages/calendar/CalendarHeader.test.jsx`

- [ ] **Step 1: Write the test**

Create `app/src/pages/calendar/CalendarHeader.test.jsx`:

```jsx
// app/src/pages/calendar/CalendarHeader.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Force desktop layout + stub the phone sheet so the import resolves cheaply.
vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))

import CalendarHeader from './CalendarHeader'

const baseFilters = {
  audience: 'mine', minMcap: 0, sort: 'mine',
  minAvgVol: null, priceMin: null, priceMax: null,
}

function renderHeader(overrides = {}) {
  const props = {
    view: 'feed', setView: vi.fn(),
    weekLabel: 'Week of Jun 9–13',
    filters: baseFilters, setFilters: vi.fn(),
    mySources: ['watchlist', 'flagged', 'positions', 'uct20'], setMySources: vi.fn(),
    monthCursor: { year: 2026, month: 6 }, setMonthCursor: vi.fn(),
    eventTypes: new Set(['earnings', 'macro']), setEventTypes: vi.fn(),
    ...overrides,
  }
  return render(<MemoryRouter><CalendarHeader {...props} /></MemoryRouter>)
}

describe('CalendarHeader (consolidated)', () => {
  it('shows view toggle + audience chips inline', () => {
    renderHeader()
    expect(screen.getByText('Feed')).toBeTruthy()
    expect(screen.getByText('Watchlist')).toBeTruthy()       // audience chip
  })

  it('hides secondary controls until the Filters panel is opened', () => {
    renderHeader()
    expect(screen.queryByText('Min avg vol')).toBeNull()
    expect(screen.queryByText('Count toward My Stocks')).toBeNull()
    fireEvent.click(screen.getByLabelText('Open calendar filters'))
    expect(screen.getByText('Min avg vol')).toBeTruthy()
    expect(screen.getByText('IPOs')).toBeTruthy()
    expect(screen.getByText('Count toward My Stocks')).toBeTruthy()
    expect(screen.getByText(/Download .ics/)).toBeTruthy()
  })

  it('no longer renders the standalone My Stocks gear or inline Export button', () => {
    renderHeader()
    expect(screen.queryByText('★ My Stocks ⚙')).toBeNull()
    expect(screen.queryByText('Export ▾')).toBeNull()
  })

  it('badges the Filters button with the active-filter count', () => {
    renderHeader({ filters: { ...baseFilters, minAvgVol: 500000 } })
    expect(screen.getByLabelText('Open calendar filters').textContent).toMatch(/· 1/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/calendar/CalendarHeader.test.jsx`
Expected: FAILS (current header has the gear/Export inline and no "Open calendar filters" desktop button / "Count toward My Stocks" label).

---

## Task 2: Rewrite CalendarHeader.jsx

**Files:**
- Modify (full rewrite): `app/src/pages/calendar/CalendarHeader.jsx`
- Modify: `app/src/pages/calendar/Calendar.module.css` (allow `.hrow` to wrap)

- [ ] **Step 1: Replace the entire contents of `app/src/pages/calendar/CalendarHeader.jsx` with:**

```jsx
// app/src/pages/calendar/CalendarHeader.jsx
import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { FiltersSheet } from '../../components/mobile'
import styles from './Calendar.module.css'

const AUDIENCE = [
  ['mine', '★ My Stocks'], ['watchlist', 'Watchlist'], ['positions', 'Positions'],
  ['uct20', 'UCT20'], ['all', 'All ($300M+)'],
]
const SORTS = [['mine', 'My stocks first'], ['time', 'Time'], ['mcap', 'Market cap'], ['move', 'Expected move']]
const SOURCES = [['watchlist','Watchlists'],['flagged','Flagged'],['positions','Positions'],['uct20','UCT20']]

// B3: event-type chips — Earnings + Macro are always on (baseline); IPOs + Dividends are toggleable
export const DEFAULT_EVENT_TYPES = new Set(['earnings', 'macro'])
const EVENT_TYPE_CHIPS = [
  ['earnings', 'Earnings'],
  ['macro',    'Macro'],
  ['ipos',     'IPOs'],
  ['dividends','Dividends'],
]

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

export default function CalendarHeader({
  view, setView, weekLabel, filters, setFilters,
  mySources, setMySources,
  monthCursor, setMonthCursor,
  eventTypes, setEventTypes,
}) {
  const isPhone = useIsPhone()
  const [panelOpen, setPanelOpen] = useState(false)            // desktop ⚙ Filters popover
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  // Export state
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const set = (k, v) => setFilters({ ...filters, [k]: v })
  const setNum = (k, v) => setFilters({ ...filters, [k]: v === '' ? null : Number(v) })
  const toggleSource = s => setMySources(
    mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s])

  const toggleEventType = type => {
    if (!setEventTypes) return
    const locked = type === 'earnings' || type === 'macro'
    if (locked) return
    const next = new Set(eventTypes || DEFAULT_EVENT_TYPES)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setEventTypes(next)
  }

  // ── Export handlers (folded in from the old ExportMenu) ──
  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const tr = await fetch('/api/calendar/export-token', { credentials: 'include' })
      const { token } = tr.ok ? await tr.json() : {}
      const url = token
        ? `/api/calendar/export.ics?scope=mine&token=${token}`
        : '/api/calendar/export.ics?scope=all'
      const a = document.createElement('a')
      a.href = url
      a.download = 'uct-earnings.ics'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (_) { /* silent */ }
    setDownloading(false)
    setPanelOpen(false)
  }, [])

  const copyWebcal = useCallback(async () => {
    setCopying(true)
    try {
      const tr = await fetch('/api/calendar/export-token', { credentials: 'include' })
      const { subscribe_url } = tr.ok ? await tr.json() : {}
      if (subscribe_url) {
        await navigator.clipboard.writeText(subscribe_url)
        setCopied(true)
        setTimeout(() => { setCopied(false); setPanelOpen(false) }, 1500)
      }
    } catch (_) { /* silent */ }
    setCopying(false)
  }, [])

  // ── Active-filter count for the ⚙ Filters badge ──
  const evTypes = eventTypes || DEFAULT_EVENT_TYPES
  const eventTypesChanged = evTypes.has('ipos') || evTypes.has('dividends')
  const activeCount =
    (filters.minAvgVol ? 1 : 0) + (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0) + (filters.minMcap > 0 ? 1 : 0) +
    (eventTypesChanged ? 1 : 0) + (filters.sort !== 'mine' ? 1 : 0)

  const clearAllFilters = () => setFilters({
    ...filters, minAvgVol: null, priceMin: null, priceMax: null, minMcap: 0,
  })

  // ── Shared control fragments (used by desktop panel + phone sheet) ──
  const eventTypeChips = view !== 'month' && EVENT_TYPE_CHIPS.map(([type, lbl]) => {
    const active = evTypes.has(type)
    const locked = type === 'earnings' || type === 'macro'
    return (
      <span
        key={type}
        className={`${styles.chip} ${active ? styles.chipOn : ''}`}
        style={locked ? { opacity: 1, cursor: 'default' } : {}}
        onClick={() => toggleEventType(type)}
        title={locked ? 'Always on' : active ? `Hide ${lbl}` : `Show ${lbl}`}
      >
        {lbl}
      </span>
    )
  })

  const audienceChips = AUDIENCE.map(([k, lbl]) => (
    <span key={k} className={`${styles.chip} ${filters.audience === k ? styles.chipOn : ''}`}
          onClick={() => set('audience', k)}>{lbl}</span>
  ))

  const capSelect = (
    <select className={styles.sel} value={filters.minMcap}
            onChange={e => set('minMcap', Number(e.target.value))}>
      <option value={0}>Any cap</option><option value={2}>$2B+</option>
      <option value={10}>$10B+</option><option value={50}>$50B+</option>
    </select>
  )
  const sortSelect = (
    <select className={styles.sel} value={filters.sort} onChange={e => set('sort', e.target.value)}>
      {SORTS.map(([k, lbl]) => <option key={k} value={k}>Sort: {lbl}</option>)}
    </select>
  )
  const metricInputs = (
    <>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Min avg vol</label>
        <input className={styles.filterInput} type="number" min={0} inputMode="numeric"
               placeholder="e.g. 500000" value={filters.minAvgVol ?? ''}
               onChange={e => setNum('minAvgVol', e.target.value)} />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Price min ($)</label>
        <input className={styles.filterInput} type="number" min={0} inputMode="decimal"
               placeholder="e.g. 5" value={filters.priceMin ?? ''}
               onChange={e => setNum('priceMin', e.target.value)} />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Price max ($)</label>
        <input className={styles.filterInput} type="number" min={0} inputMode="decimal"
               placeholder="e.g. 500" value={filters.priceMax ?? ''}
               onChange={e => setNum('priceMax', e.target.value)} />
      </div>
    </>
  )

  const sourcesCheckboxes = SOURCES.map(([k, lbl]) => (
    <label key={k} className={styles.gearRow}>
      <input type="checkbox" checked={mySources.includes(k)} onChange={() => toggleSource(k)} /> {lbl}
    </label>
  ))

  const exportButtons = (
    <div className={styles.sheetRow}>
      <button className={styles.exportItem} onClick={download} disabled={downloading}>
        {downloading ? 'Downloading…' : '⬇ Download .ics'}
      </button>
      <button className={styles.exportItem} onClick={copyWebcal} disabled={copying}>
        {copied ? '✓ Copied!' : copying ? 'Copying…' : '🔗 Copy webcal URL'}
      </button>
    </div>
  )

  // ── The consolidated secondary-controls panel (desktop popover + phone sheet) ──
  const panelSections = (
    <>
      {view !== 'month' && (
        <div className={styles.sheetSec}>
          <div className={styles.sheetLbl}>Show</div>
          <div className={styles.sheetChips}>{eventTypeChips}</div>
        </div>
      )}
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Cap &amp; sort</div>
        <div className={styles.sheetRow}>{capSelect}{sortSelect}</div>
      </div>
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Metric filters</div>
        {metricInputs}
      </div>
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Count toward My Stocks</div>
        {sourcesCheckboxes}
      </div>
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Export</div>
        {exportButtons}
      </div>
    </>
  )

  function prevMonth() {
    if (!setMonthCursor) return
    setMonthCursor(c => {
      const m = c.month === 1 ? 12 : c.month - 1
      const y = c.month === 1 ? c.year - 1 : c.year
      return { year: y, month: m }
    })
  }
  function nextMonth() {
    if (!setMonthCursor) return
    setMonthCursor(c => {
      const m = c.month === 12 ? 1 : c.month + 1
      const y = c.month === 12 ? c.year + 1 : c.year
      return { year: y, month: m }
    })
  }

  const filterBtn = (onClick) => (
    <button
      className={`${styles.filterBtn} ${activeCount > 0 ? styles.filterBtnActive : ''}`}
      onClick={onClick}
      aria-label="Open calendar filters"
    >
      ⚙ Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
    </button>
  )

  return (
    <div className={styles.header}>
      <div className={styles.hrow}>
        <span className={styles.ttl}>📅 Calendar</span>
        <span className={styles.view}>
          {['Feed','Week','Month'].map(v => (
            <span key={v} className={view === v.toLowerCase() ? styles.viewOn : ''}
                  onClick={() => setView(v.toLowerCase())}>{v}</span>
          ))}
        </span>
        {view !== 'month' ? (
          <span className={styles.wk}>{weekLabel}</span>
        ) : (
          <span className={styles.monthNavHeader}>
            <button className={styles.monthNavBtn} onClick={prevMonth} aria-label="Previous month">‹</button>
            <span className={styles.monthNavLbl}>
              {monthCursor ? `${MONTH_NAMES[monthCursor.month - 1]} ${monthCursor.year}` : ''}
            </span>
            <button className={styles.monthNavBtn} onClick={nextMonth} aria-label="Next month">›</button>
          </span>
        )}

        {/* Desktop: audience chips inline (primary filter) + ⚙ Filters popover */}
        {!isPhone && <span className={styles.sep} />}
        {!isPhone && audienceChips}
        {!isPhone && (
          <span className={styles.filterWrap} style={{ marginLeft: 'auto' }}>
            {filterBtn(() => setPanelOpen(o => !o))}
            {panelOpen && <div className={styles.gearPop}>{panelSections}</div>}
          </span>
        )}

        {/* Phone: single ⚙ Filters button opens the sheet */}
        {isPhone && (
          <span style={{ marginLeft: 'auto' }}>
            {filterBtn(() => setMobileFiltersOpen(true))}
          </span>
        )}

        <Link to="/calendar/mystocks" className={styles.hubLink} title="My Stocks Hub">
          ⭐ Hub
        </Link>
      </div>

      {/* Phone filter sheet — audience moves inside since it isn't inline on phone */}
      {isPhone && (
        <FiltersSheet
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          onClear={activeCount > 0 ? clearAllFilters : undefined}
          onApply={() => setMobileFiltersOpen(false)}
          title="Calendar Filters"
          activeCount={activeCount}
          applyLabel="Done"
        >
          <div className={styles.sheetSec}>
            <div className={styles.sheetLbl}>Audience</div>
            <div className={styles.sheetChips}>{audienceChips}</div>
          </div>
          {panelSections}
        </FiltersSheet>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Allow the header row to wrap**

In `app/src/pages/calendar/Calendar.module.css`, the `.hrow` rule — add wrapping so the inline audience chips never overflow on narrower desktops. Change:

```css
.hrow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
}
```

to:

```css
.hrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  row-gap: 8px;
  gap: 12px;
  padding: 14px 18px;
}
```

- [ ] **Step 3: Run the header tests**

Run: `cd app && npx vitest run src/pages/calendar/CalendarHeader.test.jsx`
Expected: all 4 PASS.

- [ ] **Step 4: Build**

Run: `cd app && npm run build`
Expected: build succeeds (confirms no leftover references to the removed `FiltersPopover` / `ExportMenu` symbols).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/calendar/CalendarHeader.jsx app/src/pages/calendar/Calendar.module.css app/src/pages/calendar/CalendarHeader.test.jsx
git commit -m "feat(calendar): consolidate header into one row + single Filters panel, merge My-Stocks personalization"
```

---

## Task 3: Remove dead CSS

**Files:**
- Modify: `app/src/pages/calendar/Calendar.module.css`

These classes are unused after the Direction-B card ship (verified: no `styles.*`
references in `app/src/pages/calendar`). `.tpill` (EventCard IPO pill), `.bmoHd`,
`.amcHd` (FeedView timing headers) are still used — **do not remove those**.

- [ ] **Step 1: Confirm the classes are unused**

Run: `cd app && npx vitest run src/pages/calendar` (baseline green before deleting)
Then verify no references remain (PowerShell):
`cd app && Select-String -Path src/pages/calendar/*.jsx -Pattern 'styles\.(bmo|amc|sessionLbl|hist|histPos|histNeg|histLbl)\b'`
Expected: no matches (only `styles.tpill` / `styles.bmoHd` / `styles.amcHd` exist elsewhere, which we keep).

- [ ] **Step 2: Delete the dead rules**

In `app/src/pages/calendar/Calendar.module.css`, delete these rule blocks entirely:
`.bmo { … }`, `.amc { … }`, `.sessionLbl { … }`, `.hist { … }`, `.hist i { … }`,
`.histPos { … }`, `.histNeg { … }`, `.histLbl { … }`.
Keep `.tpill`, `.bmoHd`, `.amcHd`, `.beatPill`, `.session`, `.sessionBmo`, `.sessionAmc`.

- [ ] **Step 3: Build + tests**

Run: `cd app && npm run build && npx vitest run src/pages/calendar`
Expected: build succeeds; all calendar tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/calendar/Calendar.module.css
git commit -m "chore(calendar): remove dead card CSS (.bmo/.amc/.sessionLbl/.hist*)"
```

---

## Task 4: Crisp logo in EarningsModal header (small polish)

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`
- Modify: `app/src/components/tiles/EarningsModal.module.css` (only if header isn't already a flex row)

- [ ] **Step 1: Import CompanyLogo**

In `app/src/components/tiles/EarningsModal.jsx`, add near the other imports:

```jsx
import CompanyLogo from '../CompanyLogo'
```

- [ ] **Step 2: Add the logo to the header**

Find the modal header block:

```jsx
        <div className={styles.header}>
          <span className={styles.sym} id="earnings-modal-title">{row.sym}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
```

Replace with:

```jsx
        <div className={styles.header}>
          <CompanyLogo sym={row.sym} size={38} />
          <span className={styles.sym} id="earnings-modal-title">{row.sym}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
```

- [ ] **Step 3: Ensure the header aligns the logo**

Open `app/src/components/tiles/EarningsModal.module.css` and find the `.header` rule. If it is NOT already `display: flex` with vertical centering, update it to include:

```css
  display: flex;
  align-items: center;
  gap: 10px;
```

(Preserve any existing properties such as padding/border on `.header`; only add the three above if missing. If the close button was previously pushed right via `margin-left:auto` on `.close`, that still works.)

- [ ] **Step 4: Build**

Run: `cd app && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/tiles/EarningsModal.jsx app/src/components/tiles/EarningsModal.module.css
git commit -m "feat(calendar): add crisp company logo to EarningsModal header"
```

---

## Task 5: Full verification + push

- [ ] **Step 1: Run the full calendar test suite**

Run: `cd app && npx vitest run src/pages/calendar`
Expected: all calendar tests PASS (including the new `CalendarHeader.test.jsx`).

- [ ] **Step 2: Final production build**

Run: `cd app && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Push to Railway**

```bash
git push origin master
```

- [ ] **Step 4: Manual verification (record result)**

On `/calendar` desktop: one-row header; audience chips switch audience; **⚙ Filters**
opens the panel with event types / cap / sort / metric inputs / "Count toward My
Stocks" sources / Export; the active-count badge appears when a metric filter or
non-default sort is set; Download .ics and Copy webcal still work; toggling a source
still changes what "★ My Stocks" includes. On a phone width: the single ⚙ Filters
button still opens the bottom sheet with Audience + all sections.

---

## Self-Review Notes

- **Spec coverage:** §1 single-row header → Task 2; §2 ⚙ Filters panel → Task 2
  (`panelSections`); §3 active indicator → Task 2 (`activeCount` + `filterBtn`);
  §4 personalization merge → Task 2 (gear removed, sources in panel); §5 phone
  unchanged → Task 2 (phone branch retained, audience added to sheet); §6 dead CSS
  → Task 3, EarningsModal logo → Task 4; testing → Tasks 1 & 5.
- **Name consistency:** `panelOpen` / `panelSections` / `filterBtn` / `activeCount`
  / `clearAllFilters` used consistently. Removed symbols (`FiltersPopover`,
  `ExportMenu`, `gear`, `filterOpen`, `exportOpen`, `mobileActiveCount`,
  `hasMetricFilters`) are fully gone — no dangling references.
- **No placeholders:** full file content in Task 2; every step has a command +
  expected result. Task 4 Step 3 is conditional (only if `.header` lacks flex), but
  states the exact properties to add.
- **Label-for-test:** the sources section label is the plain string
  "Count toward My Stocks" (no smart quotes) so the Task 1 assertion is robust.
