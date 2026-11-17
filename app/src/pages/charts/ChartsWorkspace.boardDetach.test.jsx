// boardDetach.* on the REAL ChartsWorkspace (the harness is ChartsWorkspace.layoutUndoAgent.test.jsx's): the Agent reaches the
// workspace's OWN float state and handlers through the `detach` host source, and "Move into tabs" lands EXACTLY what the
// member's own click on the floating panel's "Move into tabs of …" lands (handleFloatWidgetToTab → widgetTabs.moveIntoTabs) —
// the equality rail. WidgetHost is a stub that renders the props the workspace hands it (float / dock / move-into-tabs).
// Evidence: LOCAL / SIMULATED: jsdom, the real workspace, a scripted model (no paid call).
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({
  default: ({ widget, floating, onFloat, onDock, floatTabTargets, onFloatToTab }) => (
    <div data-testid={`body-${widget.id}`} data-floating={floating ? '1' : '0'}>
      {!floating && onFloat && <button type="button" data-testid={`float-${widget.id}`} onClick={() => onFloat(widget.id)}>float</button>}
      {floating && onDock && <button type="button" data-testid={`dock-${widget.id}`} onClick={() => onDock()}>dock</button>}
      {floating && (floatTabTargets || []).map(t => <button type="button" key={t.id} data-testid={`totab-${widget.id}-${t.id}`} onClick={() => onFloatToTab(t.id)}>into {t.id}</button>)}
    </div>
  ),
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({ Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>, WidthProvider: (C) => C }))
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
  default: function usePreferences() { return { prefs: useSyncExternalStore(prefStore.subscribe, prefStore.get), setPref, setPrefMerged: setPref, loading: false } },
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
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { AGENT_FLAG_KEY, AGENT_OPEN_KEY } from '../../agent/agentFlag'

const W = (id, type, x, y, opts = {}) => ({ id, type, color: 'A', x, y, w: 12, h: 10, opts })
const LAYOUT = { widgets: [W('news-1', 'news', 0, 0), W('watchlist-1', 'watchlist', 12, 0, { watchName: 'Momentum' })], cols: 24 }
const MAIN = { id: 1, name: 'Detach Board', scope: 'user', groups: null, layout: LAYOUT }

let envelopes
beforeEach(() => {
  envelopes = []
  try { localStorage.clear() } catch { /* */ }
  localStorage.setItem(AGENT_FLAG_KEY, '1')
  localStorage.setItem(AGENT_OPEN_KEY, '1')
  setPref.mockClear()
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/agent/turn')) {
      const body = init.body ? JSON.parse(init.body) : null
      const e = envelopes.shift()
      if (!e) return new Response(JSON.stringify({ detail: 'no model in this test' }), { status: 503, headers: { 'content-type': 'application/json' } })
      return json({ conversationId: 'ac_1', envelope: e(body), usage: { research_calls: 0, citations: [] } })
    }
    if (String(url).startsWith('/api/agent/record')) return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/watchlists')) return json([])
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

function mount(extraPrefs = {}) {
  prefStore.set({
    charts_workspace_layout: JSON.stringify(LAYOUT),
    charts_active_template: JSON.stringify({ id: MAIN.id, name: MAIN.name, scope: MAIN.scope }),
    ...extraPrefs,
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
async function say(text) {
  const box = await screen.findByLabelText('Message UCT Agent', {}, { timeout: 15000 })
  fireEvent.change(box, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
}
const floatingOf = (id) => screen.queryByTestId(`body-${id}`)?.getAttribute('data-floating') === '1'
const savedLayout = () => JSON.parse(prefStore.get().charts_workspace_layout || 'null')
// a new tab's id is the product's random one or the Agent's planned one: compared blanked
const noTabIds = (ws) => JSON.parse(JSON.stringify(ws, (k, v) => (k === 'id' && typeof v === 'string' && /^wt/.test(v) ? '·' : v)))
const settle = (ms = 700) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

test('"float the news widget": the workspace\'s own float flag flips (the stub is rendered floating); "dock the news widget back" docks it', async () => {
  mount()
  await screen.findByTestId('body-news-1')
  expect(floatingOf('news-1')).toBe(false)
  await say('float the news widget')
  await waitFor(() => expect(floatingOf('news-1')).toBe(true), { timeout: 15000 })
  expect(await screen.findByText(/Floated the News .* over the board \(floating until reload/, {}, { timeout: 15000 })).toBeTruthy()
  await say('dock the news widget back')
  await waitFor(() => expect(floatingOf('news-1')).toBe(false), { timeout: 15000 })
  // floating is this tab's state: nothing about it was saved
  expect(setPref.mock.calls.some(([k]) => /float/i.test(k))).toBe(false)
}, 60000)

test('EQUALITY RAIL: the Agent\'s "move into tabs" saves EXACTLY the board the member\'s own click saves (tab id aside)', async () => {
  // the member's own click: float the news widget, then "Move into tabs of" the watchlist on its floating panel
  // (owner 11-14: the widget header's Float button is switched off — FLOAT_BUTTON_ON — so the widget is floated through the
  //  workspace's own handleFloatWidget via the Agent's float; the floating panel's "Move into tabs of" click is the member's own)
  const first = mount()
  await screen.findByTestId('body-news-1')
  await say('float the news widget')
  await waitFor(() => expect(floatingOf('news-1')).toBe(true), { timeout: 15000 })
  fireEvent.click(screen.getByTestId('totab-news-1-watchlist-1'))
  await waitFor(() => expect(savedLayout().widgets.some(w => w.id === 'news-1')).toBe(false))
  const byHand = savedLayout().widgets
  first.unmount()
  cleanup()

  // the Agent, on the same board (scripted model plan, then Apply on the card)
  mount()
  await screen.findByTestId('body-news-1')
  envelopes.push((body) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null,
    ops: [{ action: 'boardDetach.intoTabs', target: body.context.board[0].ref, args: { widget: 'news-1', into: 'watchlist-1' } }] }))
  await say('move the news widget into the watchlist tabs')
  const applyBtn = await screen.findByRole('button', { name: 'Apply' }, { timeout: 15000 })
  await act(async () => { fireEvent.click(applyBtn) })
  await waitFor(() => expect(savedLayout().widgets.some(w => w.id === 'news-1')).toBe(false), { timeout: 15000 })
  await settle()
  expect(noTabIds(savedLayout().widgets)).toEqual(noTabIds(byHand))
}, 60000)

test('"merge the board": the Merge widgets toggle\'s own key (charts_merged) is written once, read back; "on every layout" is said', async () => {
  mount()
  await screen.findByTestId('body-news-1')
  await say('merge the board')
  expect(await screen.findByText(/Merged the board’s widgets \(no gaps between them\) — on every layout/, {}, { timeout: 15000 })).toBeTruthy()
  expect(setPref.mock.calls.filter(([k]) => k === 'charts_merged')).toEqual([['charts_merged', 'true']])
  expect(prefStore.get().charts_merged).toBe('true')
}, 60000)
