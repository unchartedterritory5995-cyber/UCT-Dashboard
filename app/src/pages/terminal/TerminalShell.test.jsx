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
// A stub given the security FLAKY throws while `flaky.on` is true (the crash-retry rail).
const flaky = vi.hoisted(() => ({ on: false }))

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

// The REAL panels module (names, the panel-set surface ids, URL ownership) with only the
// components stubbed — so a surface code here resolves through the real TERM-037 panel set.
// A stub given the security BOOM throws during render (the V22 throwing-panel rail).
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym, volSurface, tf, focusCode }) {
          if (sym === 'BOOM') throw new Error(`stub ${name} blew up`)
          if (sym === 'FLAKY' && flaky.on) throw new Error(`stub ${name} blew up once`)
          return (
            <div data-testid={`stub-${name}`}>
              {name}:{sym || '-'}{volSurface ? ':vol' : ''}{tf ? `:tf=${tf}` : ''}{focusCode ? `:focus=${focusCode}` : ''}
            </div>
          )
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { CalendarRoute, TerminalRoute } from './TerminalRoutes'
import { defaultLayout, serializeLayout } from './boardModel'

// These rails drive a RETURNING member's one-panel board. A brand-new member (no saved board)
// opens on the two-panel first-visit board instead; that has its own file
// (TerminalShell.firstVisit.test.jsx).
const SAVED_ONE_PANEL = serializeLayout(defaultLayout())

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
  saveTiming.debounceMs = 0   // layout writes land at once here; the debounce has its own rail
  try { window.sessionStorage.clear() } catch { /* */ }   // the per-tab "Back to my layout" memory
  store.prefs = { terminal_layout: SAVED_ONE_PANEL }
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
    await type('DP')
    expect(screen.getByTestId('where').textContent).toBe('/dark-pool')
  })

  it('V13: a surface function EMBEDS the page in the panel (panel-set id), with a Full page link', async () => {
    renderAt('/terminal')
    await type('BRD')
    // V6d: the shell stays on /terminal and the URL now carries the panel's command.
    expect(screen.getByTestId('where').textContent).toBe('/terminal?cmd=BRD')
    const panel = screen.getByTestId('terminal-panel-0')
    expect(await within(panel).findByTestId('stub-surfaceBreadth')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Full page' }).getAttribute('href')).toBe('/breadth')
  })

  it('V1: OSCR and OBT open the BUILT surfaces — neither answers "not on this release"', async () => {
    renderAt('/terminal', { ...OPEN, optionsScreenerEnabled: true, optionsBacktestEnabled: true })
    await type('OSCR')
    expect(await screen.findByTestId('stub-OptionsScreener')).toBeTruthy()
    expect(screen.queryByTestId('terminal-notice')).toBeNull()
    await type('NVDA OBT')
    expect(await screen.findByTestId('stub-Backtest')).toHaveTextContent('Backtest:NVDA')
  })

  it('a dotted Depth flag gates its panel off the researchDepth object', async () => {
    renderAt('/terminal', { ...OPEN, researchDepth: { ftd_dataset_enabled: true } })
    await type('NVDA FTD')
    expect(await screen.findByTestId('stub-Ftd')).toHaveTextContent('Ftd:NVDA')
    await type('NVDA EVTS')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('EVTS is not enabled')
  })
})

describe('V6a: arguments are honoured, and every one is echoed', () => {
  it('NVDA GP W sets the chart timeframe and says so', async () => {
    renderAt('/terminal')
    await type('NVDA GP W')
    expect(await screen.findByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA:tf=W')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('GP: applied timeframe W.')
    expect(JSON.parse(store.prefs.terminal_layout).panels[0].args).toEqual(['W'])
  })

  it('an argument a function does not take is NOT dropped silently', async () => {
    renderAt('/terminal')
    await type('NVDA GP BANANA')
    expect(await screen.findByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
    expect(screen.getByTestId('stub-Chart')).not.toHaveTextContent('tf=')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Not applied: "BANANA"')
    await type('NVDA FA 1Y')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Not applied: "1Y" — FA takes no arguments.')
  })

  it('CAL TODAY drives the calendar through its own ?d= (and clears ?week=)', async () => {
    renderAt('/terminal/calendar?week=2026-01-05')
    await type('CAL TODAY')
    const where = new URL(`http://x${screen.getByTestId('where').textContent}`)
    expect(where.pathname).toBe('/terminal/calendar')
    expect(where.searchParams.get('d')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(where.searchParams.has('week')).toBe(false)
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent(/CAL: applied day \d{4}-\d{2}-\d{2}\./)
  })

  it('CAL 2026-10-07 opens that week on that day', async () => {
    renderAt('/terminal')
    await type('CAL 2026-10-07')
    const where = new URL(`http://x${screen.getByTestId('where').textContent}`)
    expect(where.searchParams.get('d')).toBe('2026-10-07')
  })

  it('a door refuses rather than carry away an argument it cannot use', async () => {
    renderAt('/terminal')
    await type('NVDA CMP AMD EXTRA')
    expect(screen.getByTestId('where').textContent).toBe('/terminal')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Not applied: "EXTRA"')
  })

  it('FIX 2: NVDA CMP SECTOR FOO surfaces a dropped-arg notice, same as the AMD case, and never navigates', async () => {
    renderAt('/terminal')
    await type('NVDA CMP SECTOR FOO')
    // Previously the SECTOR branch read only `sym` and ignored `cmd.args` entirely, so "FOO"
    // was silently dropped and the (still-pending) sector lookup would have navigated anyway.
    expect(screen.getByTestId('where').textContent).toBe('/terminal')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Not applied: "FOO"')
  })

  it('HELP GP hands the help panel its focus code', async () => {
    renderAt('/terminal')
    await type('HELP GP')
    expect(await screen.findByTestId('stub-Help')).toHaveTextContent('focus=GP')
  })
})

describe('V22: a panel that throws takes down ONLY itself', () => {
  it('the crashed panel says so; its neighbour renders; the command line still drives the shell', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 2, focus: 1, panels: [
        { code: 'FA', group: 'N', sym: 'BOOM' }, { code: 'DES', group: 'N', sym: 'AAPL' },
        { code: 'GP', group: 'A' }, { code: 'GP', group: 'A' },
      ] }) }
      renderAt('/terminal')
      const crashed = await within(screen.getByTestId('terminal-panel-0')).findByTestId('terminal-panel-crashed')
      expect(crashed).toHaveTextContent('FA hit an error')
      expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('Overview:AAPL')
      await type('MSFT')
      expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('Overview:MSFT')
      expect(screen.getByTestId('terminal-shell')).toBeTruthy()
    } finally {
      quiet.mockRestore()
    }
  })
})

describe('a crashed panel can be retried (audit lane C, 2026-10-08)', () => {
  it('"Try again" remounts the panel body; re-running the same command alone never could', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    flaky.on = true
    try {
      store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 1, focus: 0, panels: [
        { code: 'FA', group: 'N', sym: 'FLAKY' }, { code: 'DES', group: 'N' },
        { code: 'GP', group: 'A' }, { code: 'GP', group: 'A' },
      ] }) }
      renderAt('/terminal')
      const panel = screen.getByTestId('terminal-panel-0')
      await within(panel).findByTestId('terminal-panel-crashed')
      // the cause is gone, but nothing remounts the boundary on its own
      flaky.on = false
      expect(within(panel).queryByText(/run FA again/)).toBeNull()
      fireEvent.click(within(panel).getByTestId('terminal-panel-retry'))
      expect(await within(panel).findByTestId('stub-Financials')).toHaveTextContent('Financials:FLAKY')
      expect(within(panel).queryByTestId('terminal-panel-crashed')).toBeNull()
    } finally {
      flaky.on = false
      quiet.mockRestore()
    }
  })
})

describe('the command line: doors, deep links, addresses, history', () => {
  it('NVDA GEX opens Options Flow ON its GEX view for that ticker', async () => {
    renderAt('/terminal')
    await type('NVDA GEX')
    expect(screen.getByTestId('where').textContent).toBe('/options-flow?view=gex&ticker=NVDA')
  })

  it('a door that needs an argument says so instead of navigating to a broken URL', async () => {
    renderAt('/terminal')
    await type('NVDA CMP')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('CMP needs a comparator')
    expect(screen.getByTestId('where').textContent).toBe('/terminal')
    await type('NVDA CMP AMD')
    expect(screen.getByTestId('where').textContent).toBe('/research/NVDA/compare/AMD')
  })

  it('NVDA ERN opens the calendar with its own earnings deep link', async () => {
    renderAt('/terminal')
    await type('NVDA ERN')
    expect(screen.getByTestId('where').textContent).toBe('/terminal/calendar?earnings=NVDA')
  })

  it('FIX 1: NVDA ERN from /terminal keeps its ERN identity after the calendar-entry effect runs — not clobbered to CAL', async () => {
    // Navigating from /terminal to /terminal/calendar re-matches a DIFFERENT <Route>, which
    // remounts TerminalShell and re-arms the `enteredCalendar` effect. That effect used to key
    // only on `p.code === 'CAL'`, so on this exact remount it never recognised the just-created
    // ERN panel as "the calendar is already here" and silently overwrote it back to bare CAL.
    renderAt('/terminal')
    await type('NVDA ERN')
    expect(screen.getByTestId('where').textContent).toBe('/terminal/calendar?earnings=NVDA')
    const panel = await screen.findByTestId('terminal-panel-0')
    expect(panel.getAttribute('data-code')).toBe('ERN')
    expect(panel).toHaveTextContent('NVDA ERN')
    expect(JSON.parse(store.prefs.terminal_layout).panels[0].code).toBe('ERN')
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
    // focus moved to the calendar's slot (a focus-only change is held on screen, not posted)
    expect(screen.getByTestId('terminal-panel-0').dataset.focused).toBe('true')
  })

  it('arriving on /terminal/calendar shows the calendar in the focused panel', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 1, focus: 0, panels: [{ code: 'GP', group: 'N', sym: 'NVDA' }] }) }
    renderAt('/terminal/calendar')
    expect(await screen.findByTestId('stub-Calendar')).toBeTruthy()
  })
})

describe('FIX 5: the pop-out window handle is kept and closed, not discarded', () => {
  it('"Bring it back" closes the real window handle `window.open()` returned', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 1, focus: 0, panels: [{ code: 'GP', group: 'N', sym: 'NVDA' }] }) }
    const fakeWin = { closed: false, close: vi.fn(() => { fakeWin.closed = true }) }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin)
    try {
      renderAt('/terminal')
      await act(async () => { fireEvent.click(screen.getByTestId('terminal-popout-0')) })
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(await screen.findByTestId('terminal-popped-0')).toBeTruthy()

      await act(async () => {
        fireEvent.click(within(screen.getByTestId('terminal-popped-0')).getByRole('button', { name: 'Bring it back' }))
      })
      expect(fakeWin.close).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('terminal-popped-0')).toBeNull()
    } finally {
      openSpy.mockRestore()
    }
  })

  it('does not throw when the member already closed the pop-out window by hand', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 1, focus: 0, panels: [{ code: 'GP', group: 'N', sym: 'NVDA' }] }) }
    const fakeWin = { closed: false, close: vi.fn(() => { fakeWin.closed = true }) }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin)
    try {
      renderAt('/terminal')
      await act(async () => { fireEvent.click(screen.getByTestId('terminal-popout-0')) })
      await screen.findByTestId('terminal-popped-0')

      // The member closed the real browser window by hand — `.closed` is now true on the
      // handle the shell is holding, but nobody told the shell via "Bring it back" yet.
      fakeWin.closed = true

      await act(async () => {
        fireEvent.click(within(screen.getByTestId('terminal-popped-0')).getByRole('button', { name: 'Bring it back' }))
      })
      // `.close()` is never called on an already-closed handle, and nothing throws.
      expect(fakeWin.close).not.toHaveBeenCalled()
      expect(screen.queryByTestId('terminal-popped-0')).toBeNull()
    } finally {
      openSpy.mockRestore()
    }
  })
})

describe('FIX: the H14 ?cmd= write-budget guard surfaces a user-facing notice when it trips', () => {
  it('6+ URL writes inside 2s trips the guard AND sets the notice (not just console.warn)', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderAt('/terminal')
      // Each distinct command on the focused panel changes `focusedText`, which is what drives
      // a `?cmd=` write. Running 7 distinct commands back-to-back (all well inside 2s of real
      // time in a test) exceeds the budget (>=6 writes/2s).
      const codes = ['NVDA DES', 'AMD DES', 'MSFT DES', 'TSLA DES', 'AAPL DES', 'META DES', 'GOOG DES']
      for (const c of codes) await type(c)

      const notice = screen.getByTestId('terminal-notice')
      // Accurate (audit #16): the budget is a sliding window that resumes by itself — no
      // "reload" instruction — and a trailing write catches the URL up (its own rail below).
      expect(notice).toHaveTextContent(/catches up/i)
      expect(notice).not.toHaveTextContent(/reload/i)
      expect(notice.textContent.toLowerCase()).toMatch(/address bar|url/)
      expect(quiet).toHaveBeenCalledWith(expect.stringContaining('write budget'))
    } finally {
      quiet.mockRestore()
    }
  })
})

describe('FIX: the channel-link popover survives a layout mutation (re-keyed by panel id)', () => {
  it('closing panel 1 while panel 2\'s menu is open relinks the RIGHT panel, not whatever shifted into its old index', async () => {
    // 4 panels, all 4 visible. Panel ids are b/c/d/e (closePanel renumbers by splice, not by
    // rewriting ids) so "panel at index 2" and "the panel whose menu is open" can diverge.
    // v2 shape (not v1): the v1 migration shim discards a stored id and renumbers p1..p4, which
    // would hide exactly the bug this test exists to catch.
    store.prefs = { terminal_layout: JSON.stringify({ v: 2, count: 4, focus: 0, channels: [], closed: [], panels: [
      { id: 'b', code: 'GP', channel: 'A', sym: 'AAA' },
      { id: 'c', code: 'DES', channel: null, sym: 'BBB' },
      { id: 'd', code: 'CN', channel: null, sym: 'CCC' },
      { id: 'e', code: 'FA', channel: null, sym: 'DDD' },
    ] }) }
    renderAt('/terminal')
    expect(screen.getAllByTestId(/^terminal-panel-/)).toHaveLength(4)

    // Open "link this panel" on the panel at index 2 (id 'd', CCC).
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-group-2')) })
    expect(screen.getByRole('menu')).toBeTruthy()

    // Now close panel at index 1 (id 'c', BBB) — every panel after it shifts down one index.
    // The menu is non-modal and stays open across this mutation.
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-close-1')) })
    expect(screen.getAllByTestId(/^terminal-panel-/)).toHaveLength(3)
    // Confirm the shift actually happened: what was at index 2 (id 'd') is now at index 1.
    expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('CCC')

    // The still-open menu's "New group" picks a channel for panel id 'd' — the panel the
    // member actually opened the menu on — never whatever panel the STALE index 2 now names.
    // (A row of the shared ContextPopover menu is a `menuitem` since the Notebook keyboard lane's
    // dfe97c9152: a `menu` must hold menu items, not plain buttons. Same row, same click.)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /New group/ })) })

    const layout = JSON.parse(store.prefs.terminal_layout)
    const relinked = layout.panels.find((p) => p.id === 'd')
    const wrongTarget = layout.panels.find((p) => p.id === 'e')
    expect(relinked.channel).toBeTruthy()   // CCC (the intended panel) got the new group
    expect(wrongTarget.channel == null || wrongTarget.channel === undefined || wrongTarget.channel === 'N' || !wrongTarget.channel)
      .toBeTruthy() // DDD (what a stale index would have hit) was untouched
  })

  it('closing the panel the menu was opened on makes the still-open menu a no-op', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 2, count: 2, focus: 0, channels: [], closed: [], panels: [
      { id: 'b', code: 'GP', channel: 'A', sym: 'AAA' },
      { id: 'c', code: 'DES', channel: null, sym: 'BBB' },
    ] }) }
    renderAt('/terminal')

    // Open the menu on panel index 1 (id 'c'), then close panel index 0 — panel 'c' slides to
    // index 0, but count drops to 1 and panel 'c' becomes the LAST panel, so it cannot close.
    // Instead: duplicate panel 0 first so a close is always available, keeping this test to
    // "the targeted panel itself is gone" rather than "count hit the floor".
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-dup-0')) })
    expect(screen.getAllByTestId(/^terminal-panel-/)).toHaveLength(3)
    // Panel ids after duplicate: b, (copy of b), c — in that order (duplicate inserts after i).
    const before = JSON.parse(store.prefs.terminal_layout)
    const dupId = before.panels[1].id
    expect(dupId).not.toBe('b')

    // Open the menu on the duplicate (index 1), then close that exact panel.
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-group-1')) })
    expect(screen.getByRole('menu')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-close-1')) })
    expect(JSON.parse(store.prefs.terminal_layout).panels.some((p) => p.id === dupId)).toBe(false)

    // The menu's own target panel no longer exists on the board: resolving by id fails, so the
    // popover closes itself (`menuPanel` resolves to null) rather than staying open and letting
    // a later click fall through to whatever panel now sits at the stale index.
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('PHONE (<=640): one panel, the command line pinned first, functions in a Sheet', () => {
  beforeEach(() => setViewport(390))

  it('shows exactly one panel even when the layout holds four (the rest stay mounted, hidden)', () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 4, focus: 2, panels: [
      { code: 'GP', group: 'A' }, { code: 'DES', group: 'A' }, { code: 'CN', group: 'N', sym: 'AMD' }, { code: 'FA', group: 'A' },
    ] }) }
    renderAt('/terminal')
    const panels = screen.getAllByTestId(/^terminal-panel-\d+$/)
    expect(panels).toHaveLength(4)
    const shown = panels.filter((el) => !el.hidden)
    expect(shown).toHaveLength(1)
    expect(shown[0].getAttribute('data-testid')).toBe('terminal-panel-2')
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
    await act(async () => { fireEvent.click(within(help).getByRole('button', { name: /^DASH/ })) })
    expect(screen.getByTestId('where').textContent).toBe('/dashboard')
  })
})

describe('wave 4 lane D: a panel header dot draws its group through the theme token, the stored hex unchanged', () => {
  it('a linked panel paints var(--link-group-*) (ring + letter); the saved board still holds the hex', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 2, count: 2, focus: 0, closed: [],
      channels: [{ id: 'E', name: 'Group E', color: '#facc15', sym: 'EEE', history: [] }],
      panels: [{ id: 'b', code: 'GP', channel: 'A', sym: 'AAA' }, { id: 'c', code: 'DES', channel: 'E', sym: 'EEE' }] }) }
    renderAt('/terminal')
    const a = screen.getByTestId('terminal-group-0')
    const e = screen.getByTestId('terminal-group-1')
    expect(a.style.getPropertyValue('--dot')).toBe('var(--link-group-a)')
    expect(a.style.getPropertyValue('--dot-ink')).toBe('var(--link-group-a)')
    expect(e.style.getPropertyValue('--dot')).toBe('var(--link-group-4)')
    expect(e.style.getPropertyValue('--dot-ink')).toBe('var(--link-group-4)')
    expect(JSON.parse(store.prefs.terminal_layout).channels.find((c) => c.id === 'E').color).toBe('#facc15')
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
