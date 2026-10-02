// UCT Terminal — the shell's behaviour: the gate pair, the command line driving the focused
// panel, the security link, and the PHONE layout (one panel, command line first, functions
// in a Sheet). Panels are stubbed here — `functions.rail.test.js` imports every real one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), writes: [] }))

vi.mock('../../hooks/usePreferences', () => {
  const parsePref = (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  }
  const notify = () => store.listeners.forEach((f) => f())
  return {
    parsePref,
    default: function usePreferences() {
      const [, force] = useReducer((x) => x + 1, 0)
      useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      return {
        prefs: store.prefs,
        loading: false,
        setPref: (k, v) => { store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify() },
        setPrefMerged: async (k, updater) => {
          const next = updater(parsePref(store.prefs[k], undefined))
          if (next === undefined) return
          const v = typeof next === 'string' ? next : JSON.stringify(next)
          store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify()
        },
      }
    },
  }
})

vi.mock('./panels', () => {
  const stubs = new Map()
  return {
    URL_OWNING_PANELS: new Set(['Calendar']),
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym, volSurface }) {
          return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}{volSurface ? ':vol' : ''}</div>
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { CalendarRoute, TerminalRoute } from './TerminalRoutes'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true, optionsChainEnabled: true, optionsVolSurfaceEnabled: true }

function renderAt(url, auth = OPEN) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/calendar" element={<CalendarRoute><div data-testid="legacy-calendar" /></CalendarRoute>} />
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="/terminal/calendar" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

beforeEach(() => {
  store.prefs = {}
  store.writes = []
  setViewport(1400)
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => cleanup())

describe('the gate pair — /calendar still reaches the calendar, never a 404', () => {
  it('closed: /calendar renders TERMINAL-CURRENT', () => {
    renderAt('/calendar?week=2026-10-05', { cohorts: [] })
    expect(screen.getByTestId('legacy-calendar')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/calendar?week=2026-10-05')
  })

  it('closed: /terminal and /terminal/calendar send you to /calendar, params kept', () => {
    renderAt('/terminal/calendar?earnings=NVDA', { cohorts: [] })
    expect(screen.getByTestId('legacy-calendar')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/calendar?earnings=NVDA')
  })

  it('closed for a payload with NO cohorts field at all (an old server) — fail closed', () => {
    renderAt('/terminal', {})
    expect(screen.getByTestId('legacy-calendar')).toBeTruthy()
  })

  it('open: /calendar redirects INTO the shell\'s Calendar section with every param', async () => {
    renderAt('/calendar?earnings=NVDA&esection=setup&week=2026-10-05')
    expect(screen.getByTestId('where').textContent)
      .toBe('/terminal/calendar?earnings=NVDA&esection=setup&week=2026-10-05')
    expect(await screen.findByTestId('stub-Calendar')).toBeTruthy()
  })
})

describe('the command line drives the focused panel', () => {
  it('a fresh member lands on CAL (today\'s UCT Terminal content)', async () => {
    renderAt('/terminal')
    expect(await screen.findByTestId('stub-Calendar')).toBeTruthy()
  })

  it('TICKER FUNC renders that function, links the group, and persists the layout', async () => {
    renderAt('/terminal')
    await type('nvda fa')
    expect(await screen.findByTestId('stub-Financials')).toHaveTextContent('Financials:NVDA')
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'NVDA' })
    expect(JSON.parse(store.prefs.terminal_layout).panels[0].code).toBe('FA')
  })

  it('a bare TICKER opens DES; a bare security code uses the linked security', async () => {
    renderAt('/terminal')
    await type('AAPL')
    expect(await screen.findByTestId('stub-Overview')).toHaveTextContent('Overview:AAPL')
    await type('OMON')
    expect(await screen.findByTestId('stub-OptionsChain')).toHaveTextContent('OptionsChain:AAPL')
  })

  it('a registry prop reaches the embedded component (OVS = the chain with its surface)', async () => {
    renderAt('/terminal')
    await type('TSLA OVS')
    expect(await screen.findByTestId('stub-OptionsChain')).toHaveTextContent('OptionsChain:TSLA:vol')
  })

  it('an unknown function is said OUT LOUD with a suggestion that runs', async () => {
    renderAt('/terminal')
    await type('NVDA GPX')
    const notice = screen.getByTestId('terminal-notice')
    expect(notice).toHaveTextContent('Unknown function "GPX" for NVDA')
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'GP' })) })
    expect(await screen.findByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
  })

  it('a flag-gated function the member lacks is refused with a reason, not rendered', async () => {
    renderAt('/terminal', { ...OPEN, optionsChainEnabled: false })
    await type('NVDA OMON')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('OMON is not enabled')
    expect(screen.queryByTestId('stub-OptionsChain')).toBeNull()
  })

  it('a door function navigates to its existing surface', async () => {
    renderAt('/terminal')
    await type('BRD')
    expect(screen.getByTestId('where').textContent).toBe('/breadth')
  })

  it('NVDA ERN opens the calendar with its own earnings deep link', async () => {
    renderAt('/terminal')
    await type('NVDA ERN')
    expect(screen.getByTestId('where').textContent).toBe('/terminal/calendar?earnings=NVDA')
  })

  it('an address needs the address-space flag, and says so when it is off', async () => {
    renderAt('/terminal')
    await type('L:12')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('not enabled')
  })

  it('history: ArrowUp recalls the last command', async () => {
    renderAt('/terminal')
    await type('NVDA GP')
    const input = screen.getByTestId('terminal-command')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('NVDA GP')
  })
})

describe('linked panels', () => {
  it('4 panels: a command targets the focused one, and same-group panels follow the security', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 4, focus: 1, panels: [
      { code: 'GP', group: 'A' }, { code: 'DES', group: 'A' }, { code: 'CN', group: 'B' }, { code: 'FA', group: 'N', sym: 'MSFT' },
    ] }) }
    renderAt('/terminal')
    expect(screen.getAllByTestId(/^terminal-panel-/)).toHaveLength(4)
    await type('AMD')
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent('Chart:AMD')
    expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('Overview:AMD')
    expect(screen.getByTestId('terminal-panel-3')).toHaveTextContent('Financials:MSFT')
  })

  it('the panel count is user-selectable and persisted', async () => {
    renderAt('/terminal')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-count-2')) })
    expect(screen.getAllByTestId(/^terminal-panel-/)).toHaveLength(2)
    expect(JSON.parse(store.prefs.terminal_layout).count).toBe(2)
  })

  it('the calendar appears at most once: CAL from another panel re-uses its slot', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 2, focus: 1, panels: [
      { code: 'CAL', group: 'A' }, { code: 'GP', group: 'A' }, { code: 'GP', group: 'A' }, { code: 'GP', group: 'A' },
    ] }) }
    renderAt('/terminal')
    await type('CAL')
    expect(screen.getAllByTestId('stub-Calendar')).toHaveLength(1)
    expect(JSON.parse(store.prefs.terminal_layout).focus).toBe(0)
  })

  it('arriving on /terminal/calendar shows the calendar in the focused panel', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 1, focus: 0, panels: [{ code: 'GP', group: 'N', sym: 'NVDA' }] }) }
    renderAt('/terminal/calendar')
    expect(await screen.findByTestId('stub-Calendar')).toBeTruthy()
  })
})

describe('PHONE (<=640): one panel, the command line pinned first, functions in a Sheet', () => {
  beforeEach(() => setViewport(390))

  it('renders exactly one panel even when the layout holds four', () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 4, focus: 2, panels: [
      { code: 'GP', group: 'A' }, { code: 'DES', group: 'A' }, { code: 'CN', group: 'N', sym: 'AMD' }, { code: 'FA', group: 'A' },
    ] }) }
    renderAt('/terminal')
    const panels = screen.getAllByTestId(/^terminal-panel-/)
    expect(panels).toHaveLength(1)
    expect(panels[0].getAttribute('data-testid')).toBe('terminal-panel-2')
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('1')
    expect(screen.queryByTestId('terminal-count-4')).toBeNull()
  })

  it('the command line comes BEFORE the panel in document order, and there is no rail', () => {
    renderAt('/terminal')
    const cmd = screen.getByTestId('terminal-command')
    const grid = screen.getByTestId('terminal-grid')
    expect(cmd.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Terminal functions' })).toBeNull()
  })

  it('the function list opens in a Sheet and a tap runs the function', async () => {
    renderAt('/terminal')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-fn-button')) })
    const help = await screen.findByTestId('terminal-help')
    await act(async () => { fireEvent.click(within(help).getByRole('button', { name: /BRD/ })) })
    expect(screen.getByTestId('where').textContent).toBe('/breadth')
  })
})

describe('PHONE layout rail (CSS source — jsdom computes no layout; see tapFloor.test.js)', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/TerminalShell.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (q) => {
    const i = css.indexOf(`@media ${q}`)
    expect(i, q).toBeGreaterThan(-1)
    let depth = 0
    for (let j = css.indexOf('{', i); j < css.length; j++) {
      if (css[j] === '{') depth++
      if (css[j] === '}' && --depth === 0) return css.slice(i, j + 1)
    }
    return ''
  }

  it('the whole TOUCH tier (<=1024) floors every control at --tap-min (44px)', () => {
    const touch = block('(max-width: 1024px)')
    for (const cls of ['.cmdGo', '.barBtn', '.suggestRow', '.chip', '.railItem', '.helpRow', '.panelLink', '.noticeClose']) {
      expect(touch, cls).toContain(cls)
    }
    expect(touch).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(touch).toMatch(/\.groupDot\s*\{[^}]*width:\s*var\(--tap-min\)/)
    expect(touch).toMatch(/\.cmdInput\s*\{[^}]*height:\s*var\(--tap-min\)/)
  })

  it('no horizontal overflow: no fixed width over 390px anywhere, and the grid/panels can shrink', () => {
    const widths = [...css.matchAll(/(?:^|[\s;{])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(widths.filter((w) => w > 390)).toEqual([])
    expect(css).toMatch(/\.shell\s*\{[^}]*overflow:\s*hidden/)
    for (const cls of ['.grid', '.panel', '.panelBody', '.cmdWrap', '.body']) {
      expect(css).toMatch(new RegExp(`\\${cls}\\s*\\{[^}]*min-width:\\s*0`))
    }
    expect(block('(max-width: 640px)')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })

  it('the command input is >=16px on touch, so iOS does not zoom the page on focus', () => {
    expect(block('(max-width: 1024px)')).toMatch(/\.cmdInput\s*\{[^}]*font-size:\s*16px/)
  })
})
