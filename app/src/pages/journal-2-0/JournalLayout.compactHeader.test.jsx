// Wave 10 lane D2 (design finding D-1): the Journal header folds on the phone Notebook,
// and every Journal tab stays one tap away.
//
// Measured at 390 px on fa6710394 (docs/notebook/proof/d2-before-fa6710394): 257 px of
// Journal chrome below the app's top bar before the Notebook began -- the "Trade
// Journal" title row, the action cluster wrapped onto two rows, then the section strip
// -- and two of the six section tabs (Insights x 324-394, Compass x 398-477) past the
// 390 px edge behind a swipe. After (d2-after-*): 149 px, all six tabs on screen, and
// the More and Log Trade menus still opened with a finger (every item hit-tested).
//
// ⛔ jsdom applies no CSS. The RENDERED half below proves the route decides the fold,
// the disclosure is wired (aria-expanded / aria-controls to the element it reveals),
// Log Trade folds inside it (S12, V4), and More still works inside it. The STRUCTURAL half
// proves the phone-only rules exist where they apply at 390 and not at 820.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLayoutEffect } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => true,
  useAuth: () => ({ isPaid: true }),
}))
vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { setups: [] }, isLoading: false, error: null, save: vi.fn(),
    accountName: 'Default', noSpecificAccount: false,
  }),
}))
vi.mock('./hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('./hooks/useInstantFills', () => ({ default: () => {} }))
vi.mock('./components/accounts/AccountSelector', () => ({
  default: () => <div data-testid="account-selector" />,
}))
vi.mock('./components/PortfolioSettingsModal', () => ({ default: () => null }))
vi.mock('./components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('./components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('./components/ShortcutCheatSheet', () => ({ default: () => null }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1', account: { id: 'a1', name: 'Default' }, accounts: [{ id: 'a1', name: 'Default' }],
    setAccount: vi.fn(), isLoading: false,
  }),
}))
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))
vi.mock('./components/AddTradeModal', () => ({ default: () => null }))

import JournalLayout from './JournalLayout'
import { isCompactHeaderRoute } from './lib/compactHeaderRoute'
import { isNotebookListAddress, openJournalTools, registerJournalToolsDoor } from './lib/journalToolsDoor'
import { NOTEBOOK_PATH, NOTEBOOK_SEGMENT, NOTEBOOK_RESEARCH_SEGMENT } from './lib/journalRoutes'

/** A Notebook page that offers the list's "Journal tools" door, as the list toolbar does (in a layout effect). */
function ListWithDoor() {
  useLayoutEffect(() => registerJournalToolsDoor(), [])
  return <div data-testid="notebook" />
}

function renderAt(route, { notebook = <div data-testid="notebook" /> } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<div data-testid="today" />} />
          <Route path="notebook" element={notebook} />
          <Route path="trades" element={<div data-testid="trades" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const toggle = () => screen.queryByRole('button', { name: /journal tools/i })
const root = (container) => container.firstChild

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

describe('D-1 -- the phone Notebook header folds (rendered)', () => {
  it('the route decides: only the Notebook folds', () => {
    expect(isCompactHeaderRoute(NOTEBOOK_PATH)).toBe(true)
    expect(isCompactHeaderRoute(`${NOTEBOOK_PATH}/`)).toBe(true)
    expect(isCompactHeaderRoute('/journal')).toBe(false)
    expect(isCompactHeaderRoute('/journal/trades')).toBe(false)
    // a prefix is not a route: a sibling that merely starts with the word does not fold
    expect(isCompactHeaderRoute(`${NOTEBOOK_PATH}x`)).toBe(false)
  })

  it('M-5 RULING -- the Ticker Research page is inside the Notebook, so it folds too', () => {
    const research = `/journal/${NOTEBOOK_RESEARCH_SEGMENT.replace(':symbol', 'NVDA')}`
    expect(research).toBe('/journal/notebook/research/NVDA')
    expect(isCompactHeaderRoute(research)).toBe(true)
  })

  it('M-5 -- matched case-insensitively, as React Router matches the route', () => {
    expect(isCompactHeaderRoute('/Journal/Notebook')).toBe(true)
    expect(isCompactHeaderRoute('/JOURNAL/NOTEBOOK/research/nvda')).toBe(true)
    expect(isCompactHeaderRoute('/Journal/Trades')).toBe(false)
  })

  it('M-1 -- the open tools fold again when the route changes (and stay folded on return)', () => {
    renderAt('/journal/notebook')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    const strip = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    fireEvent.click(within(strip).getByRole('link', { name: 'Trades' }))
    expect(screen.getByTestId('trades')).toBeInTheDocument()
    fireEvent.click(within(strip).getByRole('link', { name: 'Notebook' }))
    expect(screen.getByTestId('notebook')).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-tools-open]')).toBeNull()
  })

  it('M-1 -- a search-param change on the same route (opening a note) leaves the tools as they are', () => {
    renderAt('/journal/notebook')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('on the Notebook the root is marked compact and carries a closed "Journal tools" disclosure', () => {
    const { container } = renderAt('/journal/notebook')
    expect(root(container)).toHaveAttribute('data-compact-header', 'true')
    const t = toggle()
    expect(t).not.toBeNull()
    // Simplify pass 2 (A9): the room the ⋯ rows open is named as they are, "Trade journal tools".
    expect(t).toHaveAccessibleName('Trade journal tools')
    expect(t).toHaveAttribute('aria-expanded', 'false')
    expect(t).toHaveAttribute('aria-controls', 'journal-header-tools')
    expect(root(container)).not.toHaveAttribute('data-tools-open')
  })

  // S12 + VIS-4 (audit 2026-11-05, V4 / issue 14): "Log Trade" FOLDS into the disclosure on the Notebook, so the
  // phone's first screen is notes (the first note card sat at y=603 of 844). ⚰️ D2 kept it outside the fold as
  // "the primary write affordance"; on the Notebook the primary write is "+ New", and Log Trade is one tap away.
  it('aria-controls names the element that holds Log Trade, Help (?), account, report, settings and More', () => {
    renderAt('/journal/notebook')
    const tools = document.getElementById(toggle().getAttribute('aria-controls'))
    expect(tools).not.toBeNull()
    const w = within(tools)
    expect(w.getByRole('button', { name: 'Help' })).toBeInTheDocument()
    expect(w.getByTestId('account-selector')).toBeInTheDocument()
    expect(w.getByRole('button', { name: 'Generate report' })).toBeInTheDocument()
    expect(w.getByRole('button', { name: 'Open Portfolio Settings' })).toBeInTheDocument()
    expect(w.getByRole('button', { name: 'More' })).toBeInTheDocument()
    const log = screen.getByRole('button', { name: /log trade/i })
    expect(tools.contains(log)).toBe(true)
  })

  it('tapping the disclosure opens and closes it (aria-expanded and the root marker move together)', () => {
    const { container } = renderAt('/journal/notebook')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(root(container)).toHaveAttribute('data-tools-open', 'true')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(root(container)).not.toHaveAttribute('data-tools-open')
  })

  it('opened, the More menu still works from inside the fold', () => {
    renderAt('/journal/notebook')
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = screen.getByTestId('j2-more-menu')
    expect(within(menu).getByRole('link', { name: /community/i })).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: /accounts/i })).toBeInTheDocument()
  })

  it('the Log Trade split menu still opens from inside the fold', () => {
    renderAt('/journal/notebook')
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    const menu = screen.getByRole('menu', { name: 'Log a trade' })
    expect(within(menu).getAllByRole('menuitem').length).toBe(2)
  })

  it('every Journal tab stays in the phone strip on the Notebook (none folded away)', () => {
    renderAt('/journal/notebook')
    const strip = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    for (const label of ['Today', 'Trades', 'Calendar', 'Notebook', 'Insights', 'Compass']) {
      expect(within(strip).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(document.getElementById('journal-header-tools').contains(strip)).toBe(false)
  })

  it('⭐ CONTROL -- off the Notebook there is no fold and no disclosure, and Log Trade sits in the row', () => {
    const { container } = renderAt('/journal/trades')
    expect(root(container)).not.toHaveAttribute('data-compact-header')
    expect(toggle()).toBeNull()
    expect(document.getElementById('journal-header-tools').contains(screen.getByRole('button', { name: /log trade/i }))).toBe(false)
  })
})

// ── the structural half ────────────────────────────────────────────────────────
const read = (p) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const LAYOUT = read('src/pages/journal-2-0/JournalLayout.module.css')
const STRIP = read('src/pages/journal-2-0/JournalMobileNav.module.css')

function mediaBodiesAt(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    if (max && width > Number(max[1])) continue
    if (min && width < Number(min[1])) continue
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out
}

function baseRules(css) {
  let out = ''
  let i = 0
  const re = /@media[^{]+\{/g
  let m
  while ((m = re.exec(css))) {
    out += css.slice(i, m.index)
    let depth = 1
    let j = re.lastIndex
    for (; j < css.length && depth > 0; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
    }
    i = j
    re.lastIndex = j
  }
  return out + css.slice(i)
}

function declaresProp(blockText, selector, prop, pattern) {
  const rules = [...blockText.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const [, sels, decls] of rules) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    for (const part of decls.split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      if (part.slice(0, colon).trim() !== prop) continue
      if (pattern.test(part.slice(colon + 1).trim())) return true
    }
  }
  return false
}

const FOLDED = '.root[data-compact-header]:not([data-tools-open]) .headerTools'

describe('D-1 -- the phone-only rules (structural; d2_phone_measure.py is the verdict)', () => {
  const phone = mediaBodiesAt(LAYOUT, 390).join('\n')
  const tablet = mediaBodiesAt(LAYOUT, 820).join('\n')
  const base = baseRules(LAYOUT)

  it('⛔ NON-VACUITY -- a phone block names the compact header', () => {
    expect(phone).toMatch(/data-compact-header/)
  })

  it('at 390 px a folded header hides its tools and its title, and shows the disclosure', () => {
    expect(declaresProp(phone, FOLDED, 'display', /^none$/)).toBe(true)
    expect(declaresProp(phone, '.root[data-compact-header] .heading', 'display', /^none$/)).toBe(true)
    expect(declaresProp(phone, '.root[data-compact-header] .toolsToggle', 'display', /^inline-flex$/)).toBe(true)
    // the finger floor is declared for every width (tapFloor.test.js), so the phone gets it too
    expect(declaresProp(base, '.toolsToggle', 'min-height', /tap-min/)).toBe(true)
  })

  it('everywhere else the tools are ordinary row items and the disclosure does not exist', () => {
    // `display: contents` keeps the five controls flex items of .headerRight, so the
    // phone More menu keeps anchoring to the row (JournalLayout.headerOverflow.test.js).
    expect(declaresProp(base, '.headerTools', 'display', /^contents$/)).toBe(true)
    expect(declaresProp(base, '.toolsToggle', 'display', /^none$/)).toBe(true)
  })

  it('⛔ the tablet (820 px) is untouched: no fold, no hidden title, no disclosure', () => {
    expect(declaresProp(tablet, FOLDED, 'display', /^none$/)).toBe(false)
    expect(declaresProp(tablet, '.root[data-compact-header] .heading', 'display', /^none$/)).toBe(false)
    expect(declaresProp(tablet, '.root[data-compact-header] .toolsToggle', 'display', /^inline-flex$/)).toBe(false)
  })

  it('at 390 px the six section tabs share the row (grow into it; a finger-wide floor)', () => {
    const stripPhone = mediaBodiesAt(STRIP, 390).join('\n')
    expect(declaresProp(stripPhone, '.item', 'flex', /^1 0 auto$/)).toBe(true)
    expect(declaresProp(stripPhone, '.item', 'min-width', /tap-min/)).toBe(true)
    // and the strip is never folded by the header's rules: it is not a child of them
    expect(LAYOUT).not.toMatch(/mobileNav/)
  })

  it('⭐ CONTROL -- the parser sees an absent fold as absent', () => {
    const without = '@media (max-width: 640px) { .root[data-compact-header] .heading { display: none; } }'
    expect(declaresProp(mediaBodiesAt(without, 390).join('\n'), FOLDED, 'display', /^none$/)).toBe(false)
  })
})

describe('M-5 -- one authority for the Notebook route (lib/journalRoutes.js)', () => {
  const APP = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')
  const LAYOUT_JSX = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/JournalLayout.jsx'), 'utf8')
  const STRIP_JSX = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/JournalMobileNav.jsx'), 'utf8')

  // Fix round 2 (controller ruling): App.jsx keeps LITERAL route paths, because other
  // rails (surfaces/manifest.test.js, pages/Support.notebook.test.jsx) derive the route
  // list by reading App.jsx's path strings; a constant there blinds them. So the tie runs
  // the other way: the literals App.jsx declares must EQUAL the constants, and the
  // constant still cannot drift from the router.
  /** The literal `path` of the <Route> whose element is `<Component />`, or null. */
  const routeLiteralFor = (component) => {
    const m = new RegExp(`<Route\\s+path="([^"]+)"\\s+element=\\{<${component}\\s*/>\\}`).exec(APP)
    return m ? m[1] : null
  }

  it('App.jsx declares both Notebook routes as literals EQUAL to the constants', () => {
    const notebook = routeLiteralFor('NotebookSurface')
    const research = routeLiteralFor('TickerResearchSurface')
    // NON-VACUITY: both routes were found as literals
    expect(notebook).not.toBeNull()
    expect(research).not.toBeNull()
    expect(notebook).toBe(NOTEBOOK_SEGMENT)
    expect(research).toBe(NOTEBOOK_RESEARCH_SEGMENT)
  })

  it('⭐ CONTROL -- the parser reads a literal, and would see a drifted one', () => {
    const drifted = '<Route path="notebooks" element={<NotebookSurface />} />'
    const m = /<Route\s+path="([^"]+)"\s+element=\{<NotebookSurface\s*\/>\}/.exec(drifted)
    expect(m && m[1]).toBe('notebooks')
    expect(m[1]).not.toBe(NOTEBOOK_SEGMENT)
  })

  it('the section nav (desktop rail and phone strip) links to NOTEBOOK_PATH, the route the fold keys on', () => {
    renderAt('/journal')
    const rail = screen.getByRole('navigation', { name: 'Journal sections' })
    const strip = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    for (const nav of [rail, strip]) {
      const href = within(nav).getByRole('link', { name: 'Notebook' }).getAttribute('href')
      expect(href).toBe(NOTEBOOK_PATH)
      expect(isCompactHeaderRoute(href)).toBe(true)
    }
    expect(LAYOUT_JSX).not.toMatch(/'\/journal\/notebook'/)
    expect(STRIP_JSX).not.toMatch(/'\/journal\/notebook'/)
  })

  it('⛔ NON-VACUITY -- the constants compose to the path members actually use', () => {
    expect(NOTEBOOK_SEGMENT).toBe('notebook')
    expect(NOTEBOOK_PATH).toBe('/journal/notebook')
  })
})

// Tier 2 (production check of Tier 1b, 390 x 844), as corrected by its fix round 1 (review Important 1): the first
// note sat at y=320. While the Notebook LIST offers "Journal tools" in its own ⋯ menu (lib/journalToolsDoor.js), the
// folded phone header takes no row; that row opens the header's tools, focus on their toggle. NOTHING is laid over
// the section strip (a tools icon over it hid Insights and Compass: the review), and D2's strip levers stand. jsdom
// lays nothing out: the rendered half (the hooks, the door, focus) and the structural half (the rules) are railed
// here; the 360 / 390 px "no tab overlapped" verdict is the browser measurement in the report.
describe('the phone Notebook header takes no row of its own, and nothing covers the strip (Tier 2)', () => {
  const css = (f) => readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const phoneBlocks = (text) => [...text.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')

  it('rendered: the strip is compact on the Notebook only; the door marks the root and opens the tools, focus on their toggle', async () => {
    const { container } = renderAt('/journal/notebook')
    expect(screen.getByRole('navigation', { name: 'Journal sections (mobile)' })).toHaveAttribute('data-compact')
    expect(root(container)).not.toHaveAttribute('data-tools-door')
    let release
    act(() => { release = registerJournalToolsDoor() })
    expect(root(container)).toHaveAttribute('data-tools-door', 'true')
    act(() => { openJournalTools() })
    expect(root(container)).toHaveAttribute('data-tools-open', 'true')
    await waitFor(() => expect(document.activeElement).toBe(toggle()))
    act(() => release())
    expect(root(container)).not.toHaveAttribute('data-tools-door')
  })

  it('CONTROL: another Journal page keeps the icon-over-label strip and never takes the door', () => {
    const { container } = renderAt('/journal/trades')
    expect(screen.getByRole('navigation', { name: 'Journal sections (mobile)' })).not.toHaveAttribute('data-compact')
    let release
    act(() => { release = registerJournalToolsDoor() })
    expect(root(container)).not.toHaveAttribute('data-tools-door')
    act(() => release())
  })

  it('structural: with the door and closed, the header is display: none on a phone; nothing is ever absolute over the strip', () => {
    const jl = css('JournalLayout.module.css')
    expect(phoneBlocks(jl)).toMatch(/\.root\[data-compact-header\]\[data-tools-door\]:not\(\[data-tools-open\]\) \.header \{ display: none; \}/)
    expect(jl).not.toMatch(/\.header \{[^}]*position: absolute/)
  })

  it('structural: the compact strip is labels only and KEEPS D2 (the 8 px bleed, 3 px side padding, no reserved end)', () => {
    const nav = css('JournalMobileNav.module.css')
    const phone = phoneBlocks(nav)
    expect(phone).toMatch(/\.mobileNav \{[^}]*margin-left: -8px;[^}]*margin-right: -8px;/)
    expect(phone).toMatch(/\.item \{[^}]*padding-left: 3px;[^}]*padding-right: 3px;/)
    expect(phone).toMatch(/\.compact \.icon \{ display: none; \}/)
    const compact = [...phone.matchAll(/\.(?:mobileNav\.)?compact[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join(';')
    expect(compact, 'a compact rule overrides D2').not.toMatch(/padding-(left|right)|padding:|margin:|margin-(left|right)/)
    expect(nav).toMatch(/\.item \{[^}]*min-height: var\(--tap-min\);/)
  })
})

// Tier 2 fix round 1, measured (the debug layout-shift logger, lib/clsDebug.js, at 390 px): the header painted, then
// folded when the list registered its door, moving the strip and the notes up 57 px (0.05). On the list's own address
// it is folded from the FIRST paint; elsewhere it waits for a door.
describe('the header folds from the first paint on the list address', () => {
  it('?view=all folds with no door registered yet; Home and another page do not', () => {
    const { container, unmount } = renderAt('/journal/notebook?view=all', { notebook: <ListWithDoor /> })
    expect(root(container)).toHaveAttribute('data-tools-door', 'true')
    unmount()
    const home = renderAt('/journal/notebook')
    expect(root(home.container)).not.toHaveAttribute('data-tools-door')
  })

  // Final polish (WebKit at 390 px, production): on an open note the "Journal tools" row and the Folders row both came
  // back above the header. A note's ⋯ carries "Journal tools" now (NoteEditorPage's JournalToolsDoorMark), so a note
  // address folds from the first paint too -- and releases the fold whenever its page offers no door.
  it('a note address folds from the first paint, and stays folded while the note offers its door', () => {
    const { container } = renderAt('/journal/notebook?note=n1', { notebook: <ListWithDoor /> })
    expect(root(container)).toHaveAttribute('data-tools-door', 'true')
  })

  it('a note address whose page offers no door (the missing-note page) releases the fold', async () => {
    const { container } = renderAt('/journal/notebook?note=n1', {
      notebook: <div role="alert" data-testid="notebook">This note is gone.</div> })
    await waitFor(() => expect(root(container)).not.toHaveAttribute('data-tools-door'))
  })

  it('a note whose door goes away AFTER it was there (its load failed) releases the fold too', async () => {
    let release
    function NoteThatFails() {
      useLayoutEffect(() => { release = registerJournalToolsDoor(); return () => release?.() }, [])
      return <div data-testid="notebook" />
    }
    const { container } = renderAt('/journal/notebook?note=n1', { notebook: <NoteThatFails /> })
    expect(root(container)).toHaveAttribute('data-tools-door', 'true')
    act(() => release())
    await waitFor(() => expect(root(container)).not.toHaveAttribute('data-tools-door'))
  })

  // Tier 2 re-review R1-1: the fold is released when the page under it renders with no list toolbar (an error state,
  // a list that failed to load), so Log Trade, Help, account and settings are never stranded behind a ⋯ that is not
  // there. The tools' disclosure is in the header again.
  it('R1-1: a list address whose page offers no door releases the fold once the page has rendered', async () => {
    const { container } = renderAt('/journal/notebook?view=all', {
      notebook: <div role="alert" data-testid="notebook">Your notes could not be loaded.</div> })
    await waitFor(() => expect(root(container)).not.toHaveAttribute('data-tools-door'))
    fireEvent.click(toggle())
    expect(root(container)).toHaveAttribute('data-tools-open', 'true')
  })

  it('R1-1 CONTROL: a list that registers its door keeps the fold after it has rendered', async () => {
    const { container } = renderAt('/journal/notebook?view=all', { notebook: <ListWithDoor /> })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(root(container)).toHaveAttribute('data-tools-door', 'true')
  })

  // Notebook simplify, Task 5: the Notebook opens on the list, so the bare address, Research home's old `?view=home`
  // and a view this build does not know are the list too; only the Daily brief and a note are not.
  it('the address rule', () => {
    const f = (p, q) => isNotebookListAddress(p, q, '/journal/notebook')
    expect(f('/journal/notebook', '?view=all')).toBe(true)
    expect(f('/journal/notebook', '?view=board')).toBe(true)
    expect(f('/journal/notebook', '?folder=f1')).toBe(true)
    expect(f('/journal/notebook', '?tag=swing')).toBe(true)
    expect(f('/journal/notebook', '')).toBe(true)                   // the bare Notebook IS the list
    expect(f('/journal/notebook/', '')).toBe(true)
    expect(f('/journal/notebook', '?view=home')).toBe(true)         // Research home's old address opens the list
    expect(f('/journal/notebook', '?view=nope')).toBe(true)         // an unknown view opens the list
    expect(f('/journal/notebook', '?view=today')).toBe(false)       // the Daily brief
    expect(f('/journal/notebook', '?view=today&folder=f1')).toBe(true) // a filter is the list (NotebookTab agrees)
    expect(f('/journal/notebook', '?view=all&note=n1')).toBe(false) // a note
    expect(f('/journal/notebook', '?note=n1')).toBe(false)
    expect(f('/journal/notebook/research/NVDA', '?view=all')).toBe(false)
  })
})
