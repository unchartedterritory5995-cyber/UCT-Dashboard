// The Screener in UCT Signature (docs/uct-signature-style.md), 2026-11-16: the rails for its
// STRUCTURE (one top bar, a picker with a group rail) and for the style's hardest rule (gold
// only on what is current or chosen; sentence case).
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi, beforeEach, describe, expect, test } from 'vitest'
import { AuthContext } from '../../../../context/AuthContext'

vi.mock('../useLazyCounts', () => ({ default: () => ({}) }))
// The page shell is tested with the two layouts as stand-ins: what matters here is WHERE the
// Stocks | Options switch is drawn. The Focus stand-in draws the switch it is handed.
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="old-shell" /> }))
vi.mock('../FocusScreener', () => ({ default: ({ modeTabs }) => <div data-testid="focus"><header data-testid="focus-bar">{modeTabs}</header></div> }))
vi.mock('../../options/OptionsScreener', () => ({ default: () => <div data-testid="options-page" /> }))
import ScreenMenu from '../ScreenMenu'
import Screener from '../../../Screener'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = name => readFileSync(path.join(here, '..', name), 'utf8').replace(/\r\n/g, '\n')
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '')

const starters = [
  { id: 'starter_momentum_leaders', name: 'Leaders', group: 'Momentum leaders', spec: { filters: [] } },
  { id: 'starter_uct_50', name: 'UCT 50', group: 'Momentum leaders', spec: { filters: [] } },
  { id: 'starter_tight_base', name: 'Tight bases', group: 'Bases & chart patterns', spec: { filters: [] } },
  { id: 'starter_52w_breakout', name: 'New highs on volume', group: 'Breakouts & entries', spec: { filters: [] } },
]
const saved = [{ id: 5, name: 'Semis on watch', spec: { filters: [] } }]
const props = { currentName: 'UCT 50', currentId: 'starter_uct_50', count: 50, isEdited: false, starters, saved,
  pinned: ['starter_momentum_leaders'], onTogglePin: vi.fn(), onApply: vi.fn(), onSaveChanges: null, onSaveAsNew: vi.fn(),
  onRename: null, onNewScreen: vi.fn(), myScans: [], onUseScan: vi.fn() }
const openPicker = extra => {
  render(<ScreenMenu {...props} {...extra} />)
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  return screen.getByRole('dialog', { name: 'Screens' })
}
const names = dlg => within(dlg).getAllByRole('button', { name: /^Open / }).map(b => b.getAttribute('aria-label').replace(/^Open /, ''))

beforeEach(() => { vi.clearAllMocks() })

describe('the screen picker has a group rail', () => {
  test('the rail lists every section with its count, and opens on All screens', () => {
    const dlg = openPicker()
    const rail = within(dlg).getByRole('navigation', { name: 'Screen groups' })
    const items = within(rail).getAllByRole('button').map(b => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])
    expect(items).toEqual([
      ['Show All screens, 5', 'true'],
      ['Show Pinned, 1', 'false'],
      ['Show Momentum leaders, 1', 'false'],
      ['Show Breakouts & entries, 1', 'false'],
      ['Show Bases & chart patterns, 1', 'false'],
      ['Show My screens, 1', 'false'],
    ])
    // All screens is the picker as it always was: every screen, pinned first
    expect(names(dlg)).toEqual(['Leaders', 'UCT 50', 'New highs on volume', 'Tight bases', 'Semis on watch'])
  })

  test('a group on the rail narrows the list to that group; All screens brings the rest back', () => {
    const dlg = openPicker()
    const rail = within(dlg).getByRole('navigation', { name: 'Screen groups' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Show Breakouts & entries, 1' }))
    expect(names(dlg)).toEqual(['New highs on volume'])
    expect(within(rail).getByRole('button', { name: 'Show Breakouts & entries, 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(rail).getByRole('button', { name: 'Show All screens, 5' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(rail).getByRole('button', { name: 'Show My screens, 1' }))
    expect(names(dlg)).toEqual(['Semis on watch'])
    fireEvent.click(within(rail).getByRole('button', { name: 'Show All screens, 5' }))
    expect(names(dlg)).toHaveLength(5)
  })

  test('a search that empties the open group falls back to every match, never a blank list', () => {
    const dlg = openPicker()
    const rail = within(dlg).getByRole('navigation', { name: 'Screen groups' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Show Breakouts & entries, 1' }))
    fireEvent.change(within(dlg).getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'semis' } })
    expect(names(dlg)).toEqual(['Semis on watch'])
  })

  test('a search that matches nothing says so', () => {
    const dlg = openPicker()
    fireEvent.change(within(dlg).getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'zzzz' } })
    expect(within(dlg).getByRole('status')).toHaveTextContent('No screen matches')
    expect(within(dlg).queryAllByRole('button', { name: /^Open / })).toHaveLength(0)
  })

  test('with one section there is nothing to move between, so no rail', () => {
    const dlg = openPicker({ starters: [starters[0], starters[1]], saved: [], pinned: [] })
    expect(within(dlg).queryByRole('navigation', { name: 'Screen groups' })).toBeNull()
    expect(names(dlg)).toEqual(['Leaders', 'UCT 50'])
  })

  test('the open screen carries the tick, and only it does', () => {
    const dlg = openPicker()
    const ticks = within(dlg).getAllByTestId('screen-current-tick')
    expect(ticks).toHaveLength(1)
    expect(ticks[0].parentElement).toContainElement(within(dlg).getByRole('button', { name: 'Open UCT 50' }))
  })
})

describe('one bar: the Stocks | Options switch rides the Focus top bar', () => {
  const wrap = value => render(<MemoryRouter><AuthContext.Provider value={value}><Screener /></AuthContext.Provider></MemoryRouter>)
  const desktop = () => { window.matchMedia = q => ({ matches: !/max-width:\s*(640|1024)px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }) }

  test('Focus layout with Options: the switch is inside the top bar, and no separate header is drawn', async () => {
    desktop()
    const { container } = wrap({ screenerFocusLayoutEnabled: true, optionsScreenerEnabled: true })
    const bar = await screen.findByTestId('focus-bar')
    const lists = screen.getAllByRole('tablist', { name: 'Screener mode' })
    expect(lists).toHaveLength(1)
    expect(bar).toContainElement(lists[0])
    expect(within(lists[0]).getByRole('tab', { name: 'Stocks', selected: true })).toBeInTheDocument()
    // the page frame's first child is the layout itself: nothing above its bar
    expect(container.firstElementChild.firstElementChild).toBe(screen.getByTestId('focus'))
  })

  test('Focus layout without Options: no switch anywhere, and still nothing above the layout', async () => {
    desktop()
    const { container } = wrap({ screenerFocusLayoutEnabled: true })
    await screen.findByTestId('focus')
    expect(screen.queryByRole('tablist', { name: 'Screener mode' })).toBeNull()
    expect(container.firstElementChild.firstElementChild).toBe(screen.getByTestId('focus'))
  })

  test('the Options tab keeps the switch, on a slim bar of its own', async () => {
    desktop()
    wrap({ screenerFocusLayoutEnabled: true, optionsScreenerEnabled: true })
    fireEvent.click(within(await screen.findByTestId('focus-bar')).getByRole('tab', { name: 'Options' }))
    expect(await screen.findByTestId('options-page')).toBeInTheDocument()
    const lists = screen.getAllByRole('tablist', { name: 'Screener mode' })
    expect(lists).toHaveLength(1)
    expect(within(lists[0]).getByRole('tab', { name: 'Options', selected: true })).toBeInTheDocument()
    fireEvent.click(within(lists[0]).getByRole('tab', { name: 'Stocks' }))
    expect(await screen.findByTestId('focus')).toBeInTheDocument()
  })

  test('the old layout keeps its header, with the switch in it', async () => {
    desktop()
    wrap({ screenerFocusLayoutEnabled: false, optionsScreenerEnabled: true })
    expect(await screen.findByTestId('old-shell')).toBeInTheDocument()
    expect(screen.getAllByRole('tablist', { name: 'Screener mode' })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /Screener/ })).toBeInTheDocument()
  })
})

describe('the style: gold only on what is current or chosen, sentence case', () => {
  const sheets = ['FocusScreener.module.css', 'RsScreens.module.css', 'FocusMenus.module.css', 'FiltersDrawer.module.css']

  test('every use of gold is one of the marks the style allows', () => {
    // selector -> why it may be gold (docs/uct-signature-style.md section 2b)
    const ALLOWED = [
      /^\.rowSel$/,                                   // the selected row's bar
      /^\.dotOn$/,                                    // on your radar
      /^\.segOn::after$/,                             // the open view's underline
      /^\.smPin\[aria-pressed='true'\]$/,             // a pinned screen (a favourite)
      /^\.describeLabel::before$/,                    // UCT Intelligence's spark
      /^\.skipLink:focus-visible$/,                   // the app-wide skip link ring (not this page's chrome)
      /^\.modeTab\[aria-selected='true'\]::after$/,   // the open tab's underline
      /^\.smRailBtn\[aria-pressed='true'\]$/,         // the open group's bar
      /^\.smTick$/,                                   // the tick on the open screen
    ]
    const found = []
    for (const name of sheets) {
      for (const m of noComments(css(name)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/--ut-gold/.test(m[2])) continue
        for (const sel of m[1].split(',').map(x => x.trim()).filter(Boolean)) found.push(`${name}: ${sel}`)
      }
    }
    const strays = found.filter(f => !ALLOWED.some(re => re.test(f.split(': ')[1])))
    expect(strays).toEqual([])
    // and the allowed marks are really there (this list cannot pass by matching nothing)
    for (const need of ['.rowSel', '.segOn::after', '.smTick', ".smRailBtn[aria-pressed='true']"]) {
      expect(found.some(f => f.endsWith(`: ${need}`))).toBe(true)
    }
  })

  test('gold is never a fill, a border or text on the page: a bar, an underline, a dot or a glyph only', () => {
    for (const name of sheets) {
      const text = noComments(css(name))
      expect(text).not.toMatch(/border(-color)?:[^;}]*--ut-gold/)
      expect(text).not.toMatch(/--ut-gold-dim/)
    }
    const page = noComments(css('FocusScreener.module.css'))
    // the open view is an underline, never a filled segment; the Filters count is grey
    expect(page).toMatch(/\.segOn\s*\{\s*color: var\(--scr-bright\);\s*\}/)
    expect(page).toMatch(/\.badge\s*\{[^}]*background: var\(--scr-soft-hi\)/)
    expect(page).toMatch(/\.setupTag\s*\{[^}]*background: var\(--scr-soft\)/)
  })

  test('labels are sentence case: nothing on the page is forced to capitals', () => {
    for (const name of sheets) {
      const forced = [...noComments(css(name)).matchAll(/([^{}]+)\{([^{}]*text-transform:\s*uppercase[^{}]*)\}/g)].map(m => m[1].trim())
      // the one exception is a typed TICKER, which is capitals by nature
      expect(forced.filter(sel => sel !== '.whyNotInput')).toEqual([])
    }
  })

  test('the Signature values are set in the stylesheet the page shell itself loads', () => {
    const menus = noComments(css('FocusMenus.module.css'))
    expect(menus).toMatch(/:global\(:root\)\s*\{[^}]*--scr-menu:\s*#111214/)
    expect(menus).toMatch(/:global\(\[data-theme='light'\]\)\s*\{[^}]*--scr-menu:/)
    const shell = readFileSync(path.join(here, '..', '..', '..', 'Screener.jsx'), 'utf8')
    expect(shell).toMatch(/import focusMenus from '\.\/screener\/focus\/FocusMenus\.module\.css'/)
  })
})
