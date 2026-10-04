// Lane T5 — MON inside the REAL shell. Rails:
//   * `MON` then `3` + Enter sets row 3's ticker on the MONITOR'S CHANNEL: the linked panel
//     follows and the monitor stays (it is not replaced by the row's command);
//   * a row click does the same; the monitor's channel dot is a real control;
//   * an unlinked monitor SAYS it drives nothing, and changes nothing;
//   * the flag: without `terminalMonitorEnabled` the shell refuses MON with a reason;
//   * H14: driving a channel re-renders the monitor a bounded number of times.
// The data hooks are stubbed; the panel, the shell, the board model and the grammar are real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), renders: 0 }))

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
          store.prefs = { ...store.prefs, [k]: typeof next === 'string' ? next : JSON.stringify(next) }
          notify()
        },
      }
    },
  }
})

// Every panel but the monitor is a stub; the monitor is the REAL module.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    panelComponent: (name) => {
      if (name === 'Monitor') return real.panelComponent(name)
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym }) { return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div> })
      }
      return stubs.get(name)
    },
  }
})

const WL = { id: 7, name: 'Semis', items: [{ sym: 'NVDA' }, { sym: 'AMD' }, { sym: 'SMCI' }] }
const PRICES = { NVDA: { price: 120, change_pct: 1 }, AMD: { price: 150, change_pct: -1 }, SMCI: { price: 40, change_pct: 0 } }
vi.mock('swr', () => ({ default: (key) => ({ data: key === '/api/watchlists?include_prebuilt=0' ? [WL] : undefined }) }))
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ flagged: [], flaggedName: null }) }))
vi.mock('../../hooks/useTickerTags', () => ({ default: () => ({ tags: {} }) }))
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => { store.renders += 1; return { prices: PRICES, isStreaming: true } },
}))
vi.mock('../../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {} }) }))
vi.mock('../../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: {} }) }))
vi.mock('../../utils/jsonFetcher', () => ({ default: vi.fn(() => Promise.reject(new Error('offline'))) }))

import TerminalShell from './TerminalShell'
import { TerminalRoute } from './TerminalRoutes'

const ON = { cohorts: ['terminal-next'], isPaid: true, terminalMonitorEnabled: true }

function renderShell(auth = ON) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/terminal']}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

function twoPanels(first = { code: 'CAL', channel: 'A' }) {
  store.prefs = { terminal_layout: JSON.stringify({ v: 2, count: 2, focus: 0, panels: [
    { id: 'p1', args: [], ...first }, { id: 'p2', code: 'DES', channel: 'A', args: [] },
  ], channels: [{ id: 'A', name: 'Group A', color: '#f00', sym: null, history: [] }] }) }
}

beforeEach(() => {
  store.prefs = {}
  store.renders = 0
  window.matchMedia = (query) => ({ matches: /min-width/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => cleanup())

describe('MON in the shell', () => {
  it('MON then 3 <GO> sets row 3 on the monitor\'s channel: the linked panel follows, the monitor stays', async () => {
    twoPanels()
    renderShell()
    await type('MON')
    expect(await screen.findByTestId('terminal-monitor-row-3')).toBeTruthy()
    await type('3')
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'SMCI' })
    expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('Overview:SMCI')
    expect(screen.getByTestId('terminal-panel-0').dataset.code).toBe('MON')
    expect(screen.getByTestId('terminal-monitor-row-3').dataset.linked).toBe('true')
    // a row number past the list is refused out loud
    await type('9')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('rows 1-3')
  })

  it('a row click drives the channel too, and the monitor\'s channel dot is a real control', async () => {
    twoPanels({ code: 'MON', channel: 'A' })
    renderShell()
    fireEvent.click(await screen.findByTestId('terminal-monitor-row-2'))
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'AMD' })
    expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('Overview:AMD')
    expect(screen.getByTestId('terminal-group-0').tagName).toBe('BUTTON')
  })

  it('an UNLINKED monitor says it drives nothing and changes nothing', async () => {
    twoPanels({ code: 'MON', channel: null, group: 'N' })
    renderShell()
    fireEvent.click(await screen.findByTestId('terminal-monitor-row-1'))
    expect(store.prefs.charts_workspace_groups).toBeUndefined()
    expect(screen.getByTestId('terminal-notice').textContent).toContain('MON is not linked')
  })

  it('the dark flag: without terminalMonitorEnabled MON is refused with a reason, never rendered', async () => {
    twoPanels()
    renderShell({ cohorts: ['terminal-next'], isPaid: true })
    await type('MON')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('MON is not enabled')
    expect(screen.queryByTestId('terminal-monitor')).toBeNull()
  })

  it('H14: driving the channel re-renders the monitor a bounded number of times', async () => {
    twoPanels({ code: 'MON', channel: 'A' })
    renderShell()
    await screen.findByTestId('terminal-monitor-row-1')
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    const before = store.renders
    fireEvent.click(screen.getByTestId('terminal-monitor-row-1'))
    await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
    const spent = store.renders - before
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThan(12)
    expect(within(screen.getByTestId('terminal-panel-1')).getByText('Overview:NVDA')).toBeTruthy()
  })
})
