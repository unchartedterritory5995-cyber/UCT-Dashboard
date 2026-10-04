// UCT Terminal — lane T4: the chrome (V7 strip, V8 panel as-of, P14a phone switcher), each
// DARK behind `terminalChromeEnabled`. Panels are stubbed; the Chart stub fetches through
// SWR exactly as the real chart does, so the as-of path is the real middleware.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import useSWR, { SWRConfig } from 'swr'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set() }))

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
        setPref: (k, v) => { store.prefs = { ...store.prefs, [k]: v }; notify() },
        setPrefMerged: async (k, updater) => {
          const next = updater(parsePref(store.prefs[k], undefined))
          if (next === undefined) return
          store.prefs = { ...store.prefs, [k]: typeof next === 'string' ? next : JSON.stringify(next) }; notify()
        },
      }
    },
  }
})

const fetched = vi.hoisted(() => ({ resolve: null, n: 0 }))

vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, name === 'Chart'
          ? function ChartStub({ sym }) {
            // The real chart's door: an SWR hook with a fetcher. Resolved by the test.
            const { data } = useSWR(`bars:${sym}`, () => new Promise((res) => { fetched.n += 1; fetched.resolve = res }))
            return <div data-testid="stub-Chart">Chart:{sym}:{data || 'loading'}</div>
          }
          : function Stub({ sym }) { return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div> })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { PanelAsOf, freshnessText, sessionText } from './TerminalChrome'
import { createFreshnessStore } from './panelFreshness'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

const BASE = { cohorts: ['terminal-next'], isPaid: true, user: { id: 'u1' } }
const ON = { ...BASE, terminalChromeEnabled: true }

function renderShell(auth = ON, url = '/terminal') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/terminal" element={<TerminalShell />} />
            <Route path="*" element={<div />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

const realFetch = globalThis.fetch
beforeEach(() => {
  store.prefs = {}
  fetched.resolve = null
  fetched.n = 0
  setViewport(1400)
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/alerts')) {
      return { ok: true, status: 200, json: async () => [{ id: 1, read: false }, { id: 2, read: false }, { id: 3, read: true }] }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('dark: absent the key, the shell renders none of the chrome', () => {
  it.each([1400, 820, 390])('at %ipx: no strip, no switcher, no as-of, no Layout door', async (w) => {
    setViewport(w)
    renderShell(BASE)
    await type('NVDA GP')
    expect(screen.getByTestId('terminal-shell')).toBeTruthy()
    expect(screen.queryByTestId('terminal-strip')).toBeNull()
    expect(screen.queryByTestId('terminal-switcher')).toBeNull()
    expect(screen.queryByTestId('terminal-layout-sheet')).toBeNull()
    expect(document.querySelector('[data-testid^="terminal-asof-"]')).toBeNull()
  })

  it('a non-boolean key is still dark (=== true only)', () => {
    renderShell({ ...BASE, terminalChromeEnabled: 'true' })
    expect(screen.queryByTestId('terminal-strip')).toBeNull()
  })
})

describe('V7 — the L0 strip', () => {
  it('is on screen on desktop AND phone, with session, clock, freshness, connection, channel and alerts', async () => {
    for (const w of [1400, 390]) {
      setViewport(w)
      renderShell()
      const strip = screen.getByTestId('terminal-strip')
      expect(within(strip).getByTestId('terminal-strip-session').textContent).toMatch(/Market|Pre-market|After hours/)
      expect(within(strip).getByTestId('terminal-strip-clock').textContent).toMatch(/\d{1,2}:\d{2} [AP]M ET/)
      expect(within(strip).getByTestId('terminal-strip-freshness')).toBeTruthy()
      expect(within(strip).getByTestId('terminal-strip-connection').textContent).toBe('Online')
      expect(within(strip).getByTestId('terminal-strip-channel').textContent).toMatch(/:/)
      expect(await within(strip).findByText('2 unread alerts')).toBeTruthy()
      cleanup()
    }
  })

  it('the alert count READS the bell\'s cache entry; it adds no poll of its own', async () => {
    renderShell()
    await screen.findByText('2 unread alerts')
    const calls = globalThis.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/alerts'))
    expect(calls.length).toBe(1)
    expect(calls[0][0]).toBe('/api/alerts?limit=20')   // AlertBell's own key, so the two share one entry
  })

  it('says Offline the moment the browser does, and Online when it comes back', async () => {
    renderShell()
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(screen.getByTestId('terminal-strip-connection').textContent).toMatch(/^Offline/)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(screen.getByTestId('terminal-strip-connection').textContent).toBe('Online')
  })

  it('the channel item follows the active channel\'s security', async () => {
    renderShell()
    await type('AMD DES')
    expect(screen.getByTestId('terminal-strip-channel').textContent).toMatch(/AMD$/)
  })

  it('session words come from S11 (a Saturday is closed; a weekday 10:00 ET is open)', () => {
    expect(sessionText(new Date('2026-10-03T15:00:00Z')).session).toBe('closed')
    const open = sessionText(new Date('2026-10-05T14:00:00Z'))
    expect(open.session).toBe('regular')
    expect(open.head).toBe('Market open')
    expect(open.tail).toMatch(/4:00 PM ET$/)
  })

  it('freshness words: stale beats everything, nothing judged says so, fresh is earned', () => {
    expect(freshnessText({ stale: 1, unreported: 2, judged: 3 })).toEqual({ tone: 'warn', text: '1 panel past due' })
    expect(freshnessText({ stale: 0, unreported: 0, judged: 0 }).text).toBe('No data panels')
    expect(freshnessText({ stale: 0, unreported: 2, judged: 2 }).text).toBe('Data as-of not reported yet')
    expect(freshnessText({ stale: 0, unreported: 0, judged: 2 }).text).toBe('Data fresh')
  })
})

describe('V8 — each panel states its as-of, decided by the TERM-006 authority', () => {
  it('a panel that has fetched nothing says "as-of not reported" — never rendered as fresh', async () => {
    renderShell()
    await type('NVDA DES')
    await screen.findByTestId('stub-Overview')
    const asof = document.querySelector('[data-testid^="terminal-asof-"]')
    expect(asof.textContent).toBe('as-of not reported')
    expect(asof.getAttribute('data-state')).toBe('unreported')
  })

  it('the moment the panel\'s own SWR fetch RESOLVES, the header says "as of <time> ET"', async () => {
    renderShell()
    await type('NVDA GP')
    await screen.findByTestId('stub-Chart')
    await waitFor(() => expect(fetched.resolve).toBeTypeOf('function'))
    const before = document.querySelector('[data-testid^="terminal-asof-"]')
    expect(before.getAttribute('data-state')).toBe('unreported')
    await act(async () => { fetched.resolve('bars') })
    await screen.findByText('Chart:NVDA:bars')
    const after = document.querySelector('[data-testid^="terminal-asof-"]')
    expect(after.getAttribute('data-state')).toBe('fresh')
    expect(after.textContent).toMatch(/^as of \d{1,2}:\d{2} [AP]M ET$/)
    expect(screen.getByTestId('terminal-strip-freshness').textContent).toBeTruthy()
  })

  it('a live panel older than its threshold states its age; the same age on a daily panel does not', () => {
    const s = createFreshnessStore()
    s.stamp('live', Date.now() - 5 * 60_000)
    s.stamp('daily', Date.now() - 5 * 60_000)
    render(<><PanelAsOf store={s} panelId="live" name="Chart" /><PanelAsOf store={s} panelId="daily" name="Financials" /></>)
    expect(screen.getByTestId('terminal-asof-live').getAttribute('data-state')).toBe('stale')
    expect(screen.getByTestId('terminal-asof-live').textContent).toMatch(/· 5m ago$/)
    expect(screen.getByTestId('terminal-asof-daily').getAttribute('data-state')).toBe('fresh')
  })

  it('the shell\'s own Help panel states nothing (it shows no market data)', async () => {
    renderShell()
    await type('HELP')
    await screen.findByTestId('stub-Help')
    expect(document.querySelector('[data-testid^="terminal-asof-"]')).toBeNull()
  })
})

describe('P14a — the touch-tier panel switcher (full phone parity, <=1024px)', () => {
  it.each([390, 820])('at %ipx: a tab per stored panel; a tap shows that panel', async (w) => {
    setViewport(w)
    renderShell()
    await type('NVDA DES')
    fireEvent.click(screen.getByTestId('terminal-switch-add'))
    await type('AMD FA')
    // the new panel joined the active channel, so both follow AMD (the shell's linking rule)
    expect(screen.getByTestId('terminal-switch-0').textContent).toMatch(/AMD DES/)
    expect(screen.getByTestId('terminal-switch-1').textContent).toMatch(/AMD FA/)
    expect(screen.getByTestId('terminal-switch-1').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-switch-0'))
    expect(screen.getByTestId('terminal-switch-0').getAttribute('aria-selected')).toBe('true')
    if (w <= 640) {
      // the phone shows ONE panel: the one the tab picked
      expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('1')
      expect(screen.getByTestId('stub-Overview')).toBeTruthy()
      expect(screen.queryByTestId('stub-Financials')).toBeNull()
    }
  })

  it('is not on desktop (the grid and the bar already carry every control there)', () => {
    renderShell()
    expect(screen.queryByTestId('terminal-switcher')).toBeNull()
  })

  it('the phone reaches every board control: count, density, duplicate, close, undo-close', async () => {
    setViewport(390)
    renderShell()
    await type('NVDA DES')
    fireEvent.click(screen.getByTestId('terminal-switch-layout'))
    const sheet = await screen.findByTestId('terminal-layout-sheet')
    fireEvent.click(within(sheet).getByTestId('terminal-layout-count-3'))
    expect(screen.getByTestId('terminal-switch-2')).toBeTruthy()
    expect(screen.queryByTestId('terminal-switch-add')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('terminal-layout-sheet')).getByTestId('terminal-layout-density-dense'))
    expect(screen.getByTestId('terminal-shell').getAttribute('data-density')).toBe('dense')
    fireEvent.click(within(screen.getByTestId('terminal-layout-sheet')).getByTestId('terminal-layout-dup'))
    expect(screen.getByTestId('terminal-switch-3')).toBeTruthy()   // 3 panels + the duplicate
    expect(screen.queryByTestId('terminal-switch-add')).toBeNull()   // 4 is the most a board shows
    fireEvent.click(screen.getByTestId('terminal-switch-layout'))
    fireEvent.click(within(await screen.findByTestId('terminal-layout-sheet')).getByTestId('terminal-layout-close'))
    expect(screen.queryByTestId('terminal-switch-3')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-switch-layout'))
    fireEvent.click(within(await screen.findByTestId('terminal-layout-sheet')).getByTestId('terminal-layout-undo'))
    expect(screen.getByTestId('terminal-switch-3')).toBeTruthy()
  })
})
