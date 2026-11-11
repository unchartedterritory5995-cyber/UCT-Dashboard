import { render, screen, within, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

// RS Phase 2a visual round, unit VA6 (spec A7, 2026-11-07): the "Screener" menu
// groups the UCT starters by the group each one declares, and on a phone it opens
// as a panel pinned 8px inside each screen edge. Data sources mocked as in
// ScreensManager.test.jsx; the grouping and placement are the REAL code.

const create = vi.fn(), update = vi.fn(), remove = vi.fn()

// The seven RS starters as `saved_screens.rs_starters()` sends them (names and
// order copied from api/services/screener/saved_screens.py), between ordinary
// starters, with one momentum starter AFTER them to prove a group is collected
// where it first appears rather than split.
const RS_NAMES = [
  'RS new highs (52-week)',
  'RS new high before price',
  'RS new highs on a red day',
  'Up on down days (3+ of 20)',
  'RS line crossed above its 21 EMA within 5 bars',
  'Mansfield turned positive this month',
  'Leaders vs equal-weight too',
]
const STARTERS = [
  { id: 'starter_uct_50', name: 'UCT 50', group: 'Momentum leaders', spec: {} },
  { id: 'starter_power_play', name: 'Power Plays', group: 'Momentum leaders', spec: {} },
  { id: 'starter_tight_base', name: 'Tight bases near highs', group: 'Bases & chart patterns', spec: {} },
  { id: 'starter_stage2_breakout', name: 'Stage-2 breakouts', group: 'Breakouts & entries', spec: {} },
  ...RS_NAMES.map((name, i) => ({ id: `starter_rs_${i}`, name, group: 'Relative strength', spec: { rs: i } })),
  { id: 'starter_trend_template', name: 'Trend template', group: 'Momentum leaders', spec: {} },
  { id: 'starter_value_quality', name: 'Cheap quality compounders', group: 'Quality & value', spec: {} },
  { id: 'starter_earnings_momentum', name: 'Earnings momentum', group: 'Earnings', spec: {} },
]

const state = vi.hoisted(() => ({ saved: [], starters: [], error: null }))
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({ ...state, create, update, remove }),
}))
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => ({ rows: [], error: null, refresh: vi.fn() }),
  deleteUserDefinition: vi.fn(),
}))
vi.mock('../../components/screener/ScanResults', () => ({ default: () => null }))
const META = vi.hoisted(() => ({ meta: { filters: [] }, isLoading: false }))
vi.mock('./hooks/useScreenerMeta', () => ({ default: () => META, META_KEY: '/api/screener/meta' }))

import ScreensManager, { groupStarters } from './ScreensManager'

const realMatchMedia = window.matchMedia
const realInnerH = window.innerHeight
const realInnerW = window.innerWidth
function setViewport({ phone, w = 390, h = 844 }) {
  window.matchMedia = (q) => ({
    matches: phone && q === '(max-width: 640px)', media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

beforeEach(() => {
  state.saved = []
  state.starters = STARTERS
  state.error = null
  setViewport({ phone: false, w: 1440, h: 900 })
})
afterEach(() => {
  window.matchMedia = realMatchMedia
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: realInnerW })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: realInnerH })
})

const openMenu = () => fireEvent.click(screen.getByText('Screener ▾'))
const presetSection = () => screen.getByText('UCT Preset Scans').parentElement

describe('starters grouped by the group the data declares', () => {
  test('groups render in the order the API first sends each one, under the section header', () => {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    openMenu()
    const groups = within(presetSection()).getAllByRole('group')
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual([
      'Momentum leaders', 'Bases & chart patterns', 'Breakouts & entries',
      'Relative strength', 'Quality & value', 'Earnings',
    ])
    // The late momentum starter files under the FIRST momentum group, not a second one.
    const mom = within(groups[0]).getAllByRole('button', { name: /^(?!Favorite|Unfavorite)/ }).map(b => b.textContent)
    expect(mom).toEqual(['UCT 50', 'Power Plays', 'Trend template'])
  })

  test('acceptance 1: "Relative strength" directly precedes "RS new highs (52-week)" and the six that follow', () => {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    openMenu()
    const rs = screen.getByRole('group', { name: 'Relative strength' })
    const hdr = rs.firstElementChild
    expect(hdr.textContent).toBe('Relative strength')
    const rows = [...rs.children].slice(1)
    expect(rows.map(r => r.querySelector('button').textContent)).toEqual(RS_NAMES)
    // Directly: the header's next element is the first RS starter's row.
    expect(hdr.nextElementSibling.querySelector('button').textContent).toBe('RS new highs (52-week)')
  })

  test('a sub-header is sentence case as declared (no text-transform) and sits between section header and rows', () => {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    openMenu()
    const hdr = screen.getByText('Relative strength')
    expect(hdr.className).toMatch(/saveMenuGroupHdr/)
    expect(hdr.className).not.toMatch(/saveMenuHdr(?!\w)/)
  })

  test('applying and favoriting a grouped starter still work', () => {
    const onApply = vi.fn()
    render(<ScreensManager currentSpec={{}} onApply={onApply} onUseScan={vi.fn()} />)
    openMenu()
    fireEvent.click(screen.getByText('Mansfield turned positive this month'))
    expect(onApply).toHaveBeenCalledWith({ rs: 5 })
    openMenu()
    expect(screen.getByRole('button', { name: 'Favorite RS new highs (52-week)' })).toBeInTheDocument()
  })

  test('control: starters that declare no group render as one flat run with no sub-header', () => {
    state.starters = [{ id: 's1', name: 'Oversold', spec: {} }, { id: 's2', name: 'Gappers', spec: {} }]
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    openMenu()
    expect(within(presetSection()).queryAllByRole('group')).toHaveLength(0)
    expect(screen.getByText('Oversold')).toBeInTheDocument()
    expect(screen.getByText('Gappers')).toBeInTheDocument()
  })

  test('control: Favorites and My screens are unchanged (no sub-headers there)', () => {
    state.saved = [{ id: 9, name: 'My RSI', spec: {}, is_public: false, share_token: null }]
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    openMenu()
    const mine = screen.getByText('My screens').parentElement
    expect(within(mine).queryAllByRole('group')).toHaveLength(0)
    expect(within(mine).getByText('My RSI')).toBeInTheDocument()
  })
})

describe('groupStarters (pure)', () => {
  test('normalises known labels through the shared GROUPS table, keeps unknown labels as declared', () => {
    const out = groupStarters([
      { id: 'a', group: 'Chart Patterns' },
      { id: 'b', group: 'relative strength' },
      { id: 'c', group: 'Seasonal plays' },
      { id: 'starter_tight_base' },
      { id: 'zz' },
    ])
    expect(out.map(g => [g.label, g.items.map(s => s.id)])).toEqual([
      ['Bases & chart patterns', ['a', 'starter_tight_base']],
      ['Relative strength', ['b']],
      ['Seasonal plays', ['c']],
      [null, ['zz']],
    ])
  })

  test('the sandbox menu shape: 23 starters, six groups, RS holds seven', () => {
    const counts = { 'Momentum leaders': 8, 'Breakouts & entries': 4, 'Bases & chart patterns': 2,
      'Quality & value': 1, Earnings: 1, 'Relative strength': 7 }
    const list = Object.entries(counts).flatMap(([g, n]) =>
      Array.from({ length: n }, (_, i) => ({ id: `${g}-${i}`, name: `${g} ${i}`, group: g })))
    const out = groupStarters(list)
    expect(out).toHaveLength(6)
    expect(Object.fromEntries(out.map(g => [g.label, g.items.length]))).toEqual(counts)
  })
})

describe('phone: the menu stays on screen', () => {
  test('acceptance 2: at 390 px the open menu is pinned 8 px inside both edges, under the trigger', () => {
    setViewport({ phone: true, w: 390, h: 844 })
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    const wrap = screen.getByText('Screener ▾').parentElement
    wrap.getBoundingClientRect = () => ({ left: 24, right: 246, top: 216, bottom: 304, width: 222, height: 88, x: 24, y: 216 })
    openMenu()
    const pop = screen.getByRole('menu')
    expect(pop).toHaveAttribute('data-phone-panel')
    expect(pop.style.position).toBe('fixed')
    // left >= 8 and right <= 382 at a 390 px viewport (CSS right: 8px => x = 382).
    expect(pop.style.left).toBe('8px')
    expect(pop.style.right).toBe('8px')
    expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8)
    expect(390 - parseFloat(pop.style.right)).toBeLessThanOrEqual(382)
    expect(pop.style.width).toBe('auto')
    expect(pop.style.top).toBe('308px')
    expect(parseFloat(pop.style.maxHeight)).toBeLessThanOrEqual(Math.round(844 * 0.7))
  })

  test('control: desktop keeps the anchored CSS popover (no inline placement)', () => {
    render(<ScreensManager currentSpec={{}} onApply={() => {}} onUseScan={vi.fn()} />)
    openMenu()
    const pop = screen.getByRole('menu')
    expect(pop).not.toHaveAttribute('data-phone-panel')
    expect(pop.getAttribute('style')).toBeNull()
  })

  test('the stylesheet lets a starter name wrap on the phone and gives the star 44 px on touch', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(globalThis.process.cwd(), 'src/pages/screener/ScannerPro.module.css'), 'utf8').replace(/\r\n/g, '\n')
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'))
    const phoneBlock = phone.slice(0, phone.indexOf('\n}\n'))
    expect(phoneBlock).toMatch(/\.saveMenuName\s*\{[^}]*overflow-wrap:\s*anywhere/)
    const touch = css.slice(css.indexOf('@media (max-width: 1024px)'))
    expect(touch).toMatch(/\.saveMenuAct button\s*\{[^}]*min-width:\s*var\(--tap-min, 44px\)[^}]*min-height:\s*var\(--tap-min, 44px\)/)
    // No ellipsis or nowrap on the name anywhere (a name never clips).
    expect(css).not.toMatch(/\.saveMenuName\s*\{[^}]*(text-overflow|white-space:\s*nowrap)/)
    // The sub-header: 11px / 600 / muted token, 8px above, no uppercase.
    expect(css).toMatch(/\.saveMenuGroupHdr\s*\{[^}]*color:\s*var\(--text-muted\)[^}]*font-size:\s*11px[^}]*font-weight:\s*600[^}]*margin-top:\s*8px/)
    expect(css).not.toMatch(/\.saveMenuGroupHdr\s*\{[^}]*text-transform/)
    // Canonical breakpoints only in what this file declares.
    for (const m of css.matchAll(/@media \(max-width: (\d+)px\)/g)) expect(['640', '1024']).toContain(m[1])
  })
})
