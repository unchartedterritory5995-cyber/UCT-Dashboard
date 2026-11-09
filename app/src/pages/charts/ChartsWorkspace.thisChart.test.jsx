/* UCT Agent — Context & Awareness, Slice 1B: "this chart" = the chart the member last CLICKED.
 *
 * The REAL ChartsWorkspace, Layout Dock and UCT Agent panel. Only the chart widget is a stand-in
 * (canvas charts don't run in jsdom): it registers an Agent adapter into the workspace's own
 * chartApiById exactly as ChartWidget does, and shows its timeframe in `data-tf`. The selection is
 * made the member's way — a pointer-down in the chart's grid cell — and every assertion is on which
 * chart actually changed, never on the reply text alone.
 */
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const hostSpy = vi.hoisted(() => ({ widgetOps: null }))
vi.mock('../../agent/host', async (orig) => {
  const real = await orig()
  return { ...real, buildWorkspaceHost: (o) => { hostSpy.widgetOps = o.widgetOps; return real.buildWorkspaceHost(o) } }
})
vi.mock('./WidgetHost', async () => {
  const React = await import('react')
  const { useWorkspace } = await import('./WorkspaceContext')
  const { mergeChartSettings } = await import('../../components/chart/chartDefaults')
  function FakeChart({ widget }) {
    const { chartApiById, groupSyms } = useWorkspace()
    const [tf, setTf] = React.useState(widget.opts?.tf || 'D')
    const tfRef = React.useRef(tf)
    const sym = groupSyms?.[widget.color] || 'SPY'
    const symRef = React.useRef(sym)
    React.useEffect(() => { symRef.current = sym }, [sym])
    React.useEffect(() => {
      const id = `mount-${widget.id}`
      const registry = chartApiById.current
      registry.set(id, { agent: {
        read: () => ({ chartId: widget.id, tabId: null, groupKey: widget.color, symbol: symRef.current, tf: tfRef.current, cs: mergeChartSettings(null), stored: null }),
        view: () => null, drawSym: () => symRef.current,
        commit: (p) => { if (p.tf) { tfRef.current = p.tf; setTf(p.tf) } return true },
      } })
      return () => { registry.delete(id) }
    }, [chartApiById, widget.id, widget.color])
    return <div data-testid={`chart-${widget.id}`} data-tf={tf}>chart {sym}</div>
  }
  return { default: ({ widget }) => (widget.type === 'chart' ? <FakeChart widget={widget} /> : <div data-testid={`body-${widget.type}`} />) }
})
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))
vi.mock('../journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const prefStore = (() => {
  let prefs = {}
  const subs = new Set()
  return {
    get: () => prefs,
    set: (p) => { prefs = p; subs.forEach(f => f()) },
    write: (k, v) => { prefs = { ...prefs, [k]: v }; subs.forEach(f => f()) },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
  }
})()
const setPref = vi.fn((k, v) => { prefStore.write(k, v); return Promise.resolve(true) })
vi.mock('../../hooks/usePreferences', () => ({
  default: function usePreferences() { return { prefs: useSyncExternalStore(prefStore.subscribe, prefStore.get), setPref, loading: false } },
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 1, role: 'admin', plan: 'pro' }, addressSpaceEnabled: false }
  return { AuthContext: createContext(value), useAuth: () => value }
})

const TWO = { widgets: [
  { id: 'c-left', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { tf: 'D' } },
  { id: 'c-right', type: 'chart', color: 'B', x: 12, y: 0, w: 12, h: 20, opts: { tf: 'D' } },
], cols: 24 }
const ONE = { widgets: [{ id: 'c-only', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: { tf: 'D' } }], cols: 24 }
const MAIN = { id: 1, name: 'Desk One', scope: 'user', groups: null, layout: TWO }
const ALT = { id: 2, name: 'Alt Board', scope: 'user', groups: null, layout: TWO }      // the SAME widget ids
const SOLO = { id: 3, name: 'Solo', scope: 'user', groups: null, layout: ONE }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN, ALT, SOLO], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { AGENT_FLAG_KEY, AGENT_OPEN_KEY } from '../../agent/agentFlag'

let turns
let turnReply
let records          // the Agent's outcome rows (/api/agent/record) — one per change the runtime actually applied
beforeEach(() => {
  turns = []
  records = []
  turnReply = null
  try { localStorage.clear() } catch { /* jsdom's own storage, this file only */ }
  localStorage.setItem(AGENT_FLAG_KEY, '1')
  localStorage.setItem(AGENT_OPEN_KEY, '1')
  globalThis.fetch = vi.fn(async (url, init) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/agent/turn')) {
      const body = JSON.parse(init.body)
      turns.push(body)
      return json({ conversationId: 'ac_1', envelope: turnReply(body), usage: {} })
    }
    if (String(url).startsWith('/api/agent/record')) { try { records.push(JSON.parse(init.body)) } catch { /* */ } return json({ conversationId: 'ac_1' }) }
    if (String(url).startsWith('/api/watchlists')) return json([])
    // the cross-tab guard's server read is railed in its own suites; unreadable = unchecked here
    if (String(url).startsWith('/api/auth/preferences')) return new Response('', { status: 503 })
    return json({ conversations: [] })
  })
})
afterEach(() => {
  cleanup()
  localStorage.removeItem(AGENT_FLAG_KEY)
  localStorage.removeItem(AGENT_OPEN_KEY)
  delete globalThis.fetch
})

function mount(open = MAIN) {
  prefStore.set({
    charts_workspace_layout: JSON.stringify(open.layout),
    charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'AMD' }),
    charts_active_template: JSON.stringify({ id: open.id, name: open.name, scope: open.scope }),
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const tfOf = (id) => screen.getByTestId(`chart-${id}`).getAttribute('data-tf')
const cell = (id) => document.querySelector(`[data-widget-id="${id}"]`)
const click = (id) => act(async () => { fireEvent.pointerDown(screen.getByTestId(`chart-${id}`)) })
const dockButton = (name) => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button')].find(b => b.textContent.trim() === name) || null
const activeId = () => JSON.parse(prefStore.get().charts_active_template || 'null')?.id ?? null
async function say(text) {
  const box = await screen.findByLabelText('Message UCT Agent', {}, { timeout: 15000 })
  fireEvent.change(box, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
}
const receipts = () => screen.queryAllByText(/Switched timeframe to Weekly/)
// DUP-RECEIPT (11-05): a receipt CARD per change (data-testid agent-receipt). A card may say its change twice — its one-liner
// and, for a change NOT saved (this suite's server read is unreadable), the record word for word under Details — so the
// text count above is not the receipt count; the card count and the applied outcome rows are
const receiptCards = () => screen.queryAllByTestId('agent-receipt').filter(n => /Switched timeframe to Weekly/.test(n.textContent))
const applied = (action) => records.filter(r => String(r.outcomeData?.kind || '').startsWith('applied') && (r.outcomeData?.actions || []).includes(action))

test('click the LEFT chart, "switch this chart to weekly": only the left chart changes — no question, no model', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  await say('switch this chart to weekly')
  await waitFor(() => expect(tfOf('c-left')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-right')).toBe('D')
  expect(screen.queryByText(/Which chart/)).toBeNull()
  expect(turns).toHaveLength(0)
}, 45000)

test('click the RIGHT chart (a click inside the cell, on the canvas): "make this chart weekly" changes only the right chart', async () => {
  mount()
  await screen.findByTestId('chart-c-right')
  await click('c-right')
  await say('make this chart weekly')
  await waitFor(() => expect(tfOf('c-right')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-left')).toBe('D')
}, 45000)

test('HOVER is not selection: pointer over a chart, no click → asks which chart, nothing changes', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await act(async () => { fireEvent.pointerEnter(cell('c-left')); fireEvent.mouseOver(screen.getByTestId('chart-c-left')) })
  await say('switch this chart to weekly')
  expect(await screen.findByText(/^Which chart\?$/, {}, { timeout: 15000 })).toBeTruthy()
  expect([tfOf('c-left'), tfOf('c-right')]).toEqual(['D', 'D'])
  // the member picks: the ORIGINAL request runs on that chart
  await act(async () => { screen.getByRole('button', { name: /Right chart/ }).click() })
  await waitFor(() => expect(tfOf('c-right')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-left')).toBe('D')
  expect(turns).toHaveLength(0)
}, 45000)

test('a chart NAMED by its symbol beats the selection: left clicked, "switch the amd chart to weekly" → the AMD chart', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  await say('switch the amd chart to weekly')
  await waitFor(() => expect(tfOf('c-right')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-left')).toBe('D')
  expect(turns).toHaveLength(0)
}, 45000)

test('an explicit position beats the selection: left selected, "switch the right chart to weekly" → right', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  await say('switch the right chart to weekly')
  await waitFor(() => expect(tfOf('c-right')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-left')).toBe('D')
}, 45000)

// OWNER DECISION 2026-10-12: a BARE command ("switch to weekly") goes to the clicked chart while that
// selection is valid; with no valid selection it still asks.
test('a BARE request goes to the clicked chart: click RIGHT, "switch to weekly" → only the right chart changes', async () => {
  mount()
  await screen.findByTestId('chart-c-right')
  await click('c-right')
  await say('switch to weekly')
  await waitFor(() => expect(tfOf('c-right')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-left')).toBe('D')
  expect(screen.queryByText(/^Which chart\?$/)).toBeNull()
  expect(turns).toHaveLength(0)
}, 45000)

test('a BARE request with no click still asks on a multi-chart board — never a guess', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await say('switch to monthly')
  expect(await screen.findByText(/^Which chart\?$/, {}, { timeout: 15000 })).toBeTruthy()
  expect([tfOf('c-left'), tfOf('c-right')]).toEqual(['D', 'D'])
}, 45000)

test('a BARE request after a layout switch (stale selection) asks — the old click does not carry over', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  await act(async () => { dockButton('Alt Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  await act(async () => { dockButton('Desk One').click() })
  await waitFor(() => expect(activeId()).toBe(1))
  await say('switch to weekly')
  expect(await screen.findByText(/^Which chart\?$/, {}, { timeout: 15000 })).toBeTruthy()
  expect([tfOf('c-left'), tfOf('c-right')]).toEqual(['D', 'D'])
}, 45000)

test('a single-chart board needs no selection: "switch this chart to weekly" just works', async () => {
  mount(SOLO)
  await screen.findByTestId('chart-c-only')
  await say('switch this chart to weekly')
  await waitFor(() => expect(tfOf('c-only')).toBe('W'), { timeout: 15000 })
}, 45000)

test('a layout switch makes the selection STALE — even back on the same layout with the same widget ids', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  await act(async () => { dockButton('Alt Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  await act(async () => { dockButton('Desk One').click() })
  await waitFor(() => expect(activeId()).toBe(1))
  await say('switch this chart to weekly')
  expect(await screen.findByText(/^Which chart\?$/, {}, { timeout: 15000 })).toBeTruthy()
  expect([tfOf('c-left'), tfOf('c-right')]).toEqual(['D', 'D'])
}, 45000)

test('MODEL path: a true "this stock" with a chart clicked: a plan on the other chart goes to the clicked one, no question', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  turnReply = (body) => {
    const other = body.context.charts.find(c => !c.selected)
    return { disposition: 'apply', reply: '', question: null, ops: [{ action: 'chart.setTimeframe', target: other.ref, args: { timeframe: 'W' } }], unsupported_category: null }
  }
  await say('could you put this stock on the weekly view please')
  await waitFor(() => expect(tfOf('c-left')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-right')).toBe('D')
  expect(screen.queryByText(/Did you mean/)).toBeNull()
  expect(turns).toHaveLength(1)
}, 45000)

test('MODEL path: the selected chart is in the context, and a plan on ANOTHER chart is never run — asked, then resumed on the pick', async () => {
  mount()
  await screen.findByTestId('chart-c-left')
  await click('c-left')
  // the model "decides" on the other chart for a deictic request
  turnReply = (body) => {
    const other = body.context.charts.find(c => !c.selected)
    return { disposition: 'apply', reply: '', question: null, ops: [{ action: 'chart.setTimeframe', target: other.ref, args: { timeframe: 'W' } }], unsupported_category: null }
  }
  await say('could you put the stock on the weekly view please')
  await waitFor(() => expect(turns).toHaveLength(1), { timeout: 15000 })
  const sent = turns[0].context.charts
  expect(sent.filter(c => c.selected).map(c => c.label)).toEqual(['Left chart (NVDA)'])
  expect(sent.find(c => c.label === 'Right chart (AMD)').selected).toBeUndefined()
  expect(await screen.findByText(/Did you mean Left chart \(NVDA\)\?/, {}, { timeout: 15000 })).toBeTruthy()
  expect([tfOf('c-left'), tfOf('c-right')]).toEqual(['D', 'D'])            // nothing ran
  await act(async () => { screen.getByRole('button', { name: /Left chart \(NVDA\)/ }).click() })
  await waitFor(() => expect(tfOf('c-left')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-right')).toBe('D')
  expect(turns).toHaveLength(1)                                           // the pick resumed the plan: no second model call
  await waitFor(() => expect(receiptCards()).toHaveLength(1), { timeout: 15000 })   // ONE receipt for ONE change
  expect(applied('chart.setTimeframe')).toHaveLength(1)                   // the op ran ONCE (never a second execution)
  expect(receiptCards()[0].querySelectorAll('[data-testid="agent-receipt-summary"]')).toHaveLength(1)
  expect(screen.queryAllByTestId('agent-receipt')).toHaveLength(1)        // and no other receipt at all
}, 45000)

test('MODEL path: a plan on the selected chart runs as planned', async () => {
  mount()
  await screen.findByTestId('chart-c-right')
  await click('c-right')
  turnReply = (body) => ({ disposition: 'apply', reply: '', question: null, ops: [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.selected).ref, args: { timeframe: 'W' } }], unsupported_category: null })
  await say('could you put this stock on the weekly view please')
  await waitFor(() => expect(tfOf('c-right')).toBe('W'), { timeout: 15000 })
  expect(tfOf('c-left')).toBe('D')
}, 45000)

// #823: a board where no widget can give up room. 12 charts at their minimum (6 wide; 6-7 high): see placement/place.test.js
const NO_ROOM = (() => {
  const widgets = []
  for (let c = 0; c < 4; c++) for (const [i, y, h] of [[0, 0, 7], [1, 7, 7], [2, 14, 6]]) widgets.push({ id: `c${c}${i}`, type: 'chart', color: 'A', x: c * 6, y, w: 6, h, opts: { tf: 'D' } })
  return { id: 4, name: 'Packed', scope: 'user', groups: null, layout: { widgets, cols: 24 } }
})()
const banner = () => screen.queryByTestId('board-bound-status')
const addOneChart = async () => {
  await act(async () => { fireEvent.click(screen.getByText('Widgets ▾')) })
  const item = document.querySelector('[data-guide="workspace.widgets.chart"]')
  await act(async () => { fireEvent.click(item) })
}

test('no room left: the refusal banner says so, the board is untouched, and Dismiss clears it', async () => {
    mount(NO_ROOM)
    await screen.findByTestId('chart-c00')
    const before = document.querySelectorAll('[data-widget-id]').length
    await addOneChart()
    await waitFor(() => expect(banner()?.textContent).toMatch(/no room left on this board/i), { timeout: 15000 })
    expect(document.querySelectorAll('[data-widget-id]').length).toBe(before)
    await act(async () => { fireEvent.click(banner().querySelector('button')) })
    expect(banner()).toBeNull()
}, 45000)

test('a refused add that carries a ticker saves no N:<id> pref (the Agent adding a chart when the board filled after its plan)', async () => {
  // The Agent's plan refuses a full board first, so this only happens when the board fills between plan and commit. That
  // is the call capabilities/workspace.js commit makes, through the workspace's real widgetOps.
  mount(NO_ROOM)
  await screen.findByTestId('chart-c00')
  const before = document.querySelectorAll('[data-widget-id]').length
  await act(async () => { hostSpy.widgetOps.add('chart', null, { symbol: 'TSLA', tf: 'D' }) })
  await waitFor(() => expect(banner()?.textContent).toMatch(/no room left on this board/i), { timeout: 15000 })
  // the symbol writer saves on a 400ms debounce: wait past it, then read what was stored
  await act(async () => { await new Promise(r => setTimeout(r, 800)) })
  const groups = JSON.parse(prefStore.get().charts_workspace_groups || '{}')
  expect(Object.keys(groups).filter(k => k.startsWith('N:'))).toEqual([])
  expect(Object.values(groups)).not.toContain('TSLA')
  expect(document.querySelectorAll('[data-widget-id]').length).toBe(before)
}, 45000)
