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
// Log Trade stays outside the fold, and More still works inside it. The STRUCTURAL half
// proves the phone-only rules exist where they apply at 390 and not at 820.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => true,
  useAuth: () => ({ isPaid: true }),
}))
vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { setups: [] }, isLoading: false, error: null, save: vi.fn(),
    accountName: 'Default', isAllAccounts: false,
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
import { NOTEBOOK_PATH, NOTEBOOK_SEGMENT, NOTEBOOK_RESEARCH_SEGMENT } from './lib/journalRoutes'

function renderAt(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<div data-testid="today" />} />
          <Route path="notebook" element={<div data-testid="notebook" />} />
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
    expect(t).toHaveAttribute('aria-expanded', 'false')
    expect(t).toHaveAttribute('aria-controls', 'journal-header-tools')
    expect(root(container)).not.toHaveAttribute('data-tools-open')
  })

  it('aria-controls names the element that holds ?, account, report, settings and More -- and NOT Log Trade', () => {
    renderAt('/journal/notebook')
    const tools = document.getElementById(toggle().getAttribute('aria-controls'))
    expect(tools).not.toBeNull()
    const w = within(tools)
    expect(w.getByRole('button', { name: 'Show keyboard shortcuts' })).toBeInTheDocument()
    expect(w.getByTestId('account-selector')).toBeInTheDocument()
    expect(w.getByRole('button', { name: 'Generate report' })).toBeInTheDocument()
    expect(w.getByRole('button', { name: 'Open Portfolio Settings' })).toBeInTheDocument()
    expect(w.getByRole('button', { name: 'More' })).toBeInTheDocument()
    // Log Trade is the primary write affordance: never folded away.
    const log = screen.getByRole('button', { name: /log trade/i })
    expect(tools.contains(log)).toBe(false)
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

  it('the Log Trade split menu still opens on the folded header', () => {
    renderAt('/journal/notebook')
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

  it('⭐ CONTROL -- off the Notebook there is no fold and no disclosure', () => {
    const { container } = renderAt('/journal/trades')
    expect(root(container)).not.toHaveAttribute('data-compact-header')
    expect(toggle()).toBeNull()
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
