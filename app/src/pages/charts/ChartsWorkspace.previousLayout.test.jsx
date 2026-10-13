/* UCT Agent — Context & Awareness, Slice 1A: "switch back to the previous layout".
 *
 * Owner-reported (prod, 2026-10-11): "open <B>" worked; "Okay, now switch back to the previous
 * layout" made the Agent ask which layout, listing all of them — UCT kept no layout history and the
 * receipt never named the layout left.
 *
 * These rails mount the REAL ChartsWorkspace, the REAL Layout Dock and the REAL UCT Agent panel
 * (lazy-loaded, as in the app). Preferences live in a small in-memory store, so a pointer write
 * (charts_active_template) re-renders the workspace the way the real hook does. Every assertion is
 * on UI STATE — the open-layout pointer the workspace persisted and the Dock's aria-current — and
 * the model is never called (the test fails on any /api/agent/turn).
 */
import { render, screen, act, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({ default: ({ widget }) => <div data-testid={`body-${widget.type}`}>{widget.type}</div> }))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  // the grid's own drag callback: a member moving a widget (the board's arrangement changes)
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-drag" onClick={() => onLayoutChange && onLayoutChange([{ i: 'calendar-1', x: 10, y: 2, w: 6, h: 8 }])}>drag</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))
vi.mock('../journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

// ── preferences: a store, so a write re-renders like the real hook ──
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

const board = (type) => ({ widgets: [{ id: `${type}-1`, type, color: 'A', x: 0, y: 0, w: 6, h: 8, opts: {} }], cols: 24 })
const MAIN = { id: 1, name: 'Main Trading', scope: 'user', groups: null, layout: board('watchlist') }
const SWING = { id: 2, name: 'Swing Board', scope: 'user', groups: null, layout: board('fundamentals') }
const MACRO = { id: 3, name: 'Macro Board', scope: 'user', groups: null, layout: board('news') }
const FIRM = { id: 9, name: 'Firm Board', scope: 'global', groups: null, layout: board('calendar') }
let library
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: library.global, mine: library.mine, isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { AGENT_FLAG_KEY, AGENT_OPEN_KEY } from '../../agent/agentFlag'

let modelCalls
beforeEach(() => {
  modelCalls = 0
  // jsdom's own storage (this file only): no conversation / in-flight marker from an earlier test
  try { localStorage.clear() } catch { /* */ }
  library = { global: [FIRM], mine: [MAIN, SWING, MACRO] }
  localStorage.setItem(AGENT_FLAG_KEY, '1')
  localStorage.setItem(AGENT_OPEN_KEY, '1')
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/agent/turn')) { modelCalls += 1; return json({}) }
    if (String(url).startsWith('/api/agent/record')) return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/watchlists')) return json([])
    // the cross-tab guard's server read (host.boardInSync) is railed in its own suites; here it is
    // unreadable, which the guard treats as unchecked (never blocks on a network blip)
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

function mount(open) {
  prefStore.set({
    charts_workspace_layout: JSON.stringify(open.layout),
    charts_active_template: JSON.stringify({ id: open.id, name: open.name, scope: open.scope }),
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const activeId = () => JSON.parse(prefStore.get().charts_active_template || 'null')?.id ?? null
const dockButton = (name) => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button')].find(b => b.textContent.trim() === name) || null
const dockActive = () => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button[aria-current="true"]')].map(b => b.textContent.trim())
async function say(text) {
  const box = await screen.findByLabelText('Message UCT Agent', {}, { timeout: 15000 })
  fireEvent.change(box, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
}
const BACK = 'Okay, now switch back to the previous layout'

test('the reported failure: Agent opens B, then "Okay, now switch back to the previous layout" opens A — no question, no model', async () => {
  mount(MAIN)
  await say('open Swing Board')
  await waitFor(() => expect(activeId()).toBe(2), { timeout: 15000 })
  expect(await screen.findByText(/Opened “Swing Board” in place of “Main Trading”/, {}, { timeout: 15000 })).toBeTruthy()
  await say(BACK)
  await waitFor(() => expect(activeId()).toBe(1), { timeout: 15000 })
  expect(dockActive()).toEqual(['Main Trading'])
  expect(await screen.findByText(/Opened “Main Trading” in place of “Swing Board”/, {}, { timeout: 15000 })).toBeTruthy()
  expect(screen.queryByText(/Which layout/)).toBeNull()
  expect(modelCalls).toBe(0)
}, 45000)

test('a MANUAL Dock switch is history too: click Swing in the Dock, then "switch back to the previous layout"', async () => {
  mount(MAIN)
  await act(async () => { dockButton('Swing Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  await say(BACK)
  await waitFor(() => expect(activeId()).toBe(1), { timeout: 15000 })
  expect(dockActive()).toEqual(['Main Trading'])
  expect(modelCalls).toBe(0)
}, 45000)

test('back-and-forth is Alt-Tab: A→B, back → A, back → B, back → A', async () => {
  mount(MAIN)
  await act(async () => { dockButton('Swing Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  const names = { 1: 'Main Trading', 2: 'Swing Board' }
  let n = 0
  for (const want of [1, 2, 1]) {
    await say('go back to the previous layout')
    await waitFor(() => expect(activeId()).toBe(want), { timeout: 15000 })
    // the receipt lands after the pointer; the panel takes the next message only then
    n += 1
    await waitFor(() => expect(screen.getAllByText(/^Opened “/).length).toBe(n), { timeout: 15000 })
    expect(screen.getAllByText(/^Opened “/).at(-1).textContent).toMatch(new RegExp('Opened “' + names[want] + '” in place of'))
  }
  expect(modelCalls).toBe(0)
}, 60000)

test('no history in this tab: an honest refusal, the board untouched, never the whole layout list', async () => {
  mount(MAIN)
  await say(BACK)
  expect(await screen.findByText(/hasn't had another layout open yet/, {}, { timeout: 15000 })).toBeTruthy()
  expect(activeId()).toBe(1)
  expect(screen.queryByText(/Which layout/)).toBeNull()
  expect(modelCalls).toBe(0)
}, 45000)

test('the previous layout was DELETED: says so and offers only the recent layouts still there', async () => {
  const view = mount(MAIN)
  await act(async () => { dockButton('Macro Board').click() })
  await waitFor(() => expect(activeId()).toBe(3))
  await act(async () => { dockButton('Swing Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  // Macro Board (the layout before Swing) is deleted elsewhere; Main Trading is still there
  library = { global: [FIRM], mine: [MAIN, SWING] }
  view.rerender(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
  await say(BACK)
  expect(await screen.findByText(/“Macro Board” isn't in your layout list anymore/, {}, { timeout: 15000 })).toBeTruthy()
  expect(activeId()).toBe(2)
  // the choices are the recent layouts that still exist — not every layout
  const choices = screen.getAllByRole('button').map(b => b.textContent.trim())
  expect(choices).toContain('Main Trading')
  expect(modelCalls).toBe(0)
}, 45000)

test('a RENAMED previous layout is found by id and receipted under its new name', async () => {
  const view = mount(MAIN)
  await act(async () => { dockButton('Swing Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  library = { global: [FIRM], mine: [{ ...MAIN, name: 'Main Desk' }, SWING, MACRO] }
  view.rerender(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
  await say(BACK)
  await waitFor(() => expect(activeId()).toBe(1), { timeout: 15000 })
  expect(await screen.findByText(/Opened “Main Desk” in place of “Swing Board”/, {}, { timeout: 15000 })).toBeTruthy()
}, 45000)

test('UNSAVED edits on the board being left: proposed (never applied silently); "do it" then opens the previous layout', async () => {
  mount(FIRM)
  await act(async () => { dockButton('Main Trading').click() })
  await waitFor(() => expect(activeId()).toBe(1))
  await act(async () => { dockButton('Firm Board').click() })
  await waitFor(() => expect(activeId()).toBe(9))
  // a prebuilt never auto-saves: the member moves its widget, so a switch would discard that
  await act(async () => { screen.getByTestId('rgl-drag').click() })
  await say(BACK)
  expect(await screen.findByTestId('agent-proposal', {}, { timeout: 15000 })).toBeTruthy()
  expect(screen.getByTestId('agent-proposal').textContent).toMatch(/Open “Main Trading” — unsaved changes on “Firm Board” are discarded/)
  expect(activeId()).toBe(9)
  await say('do it')
  await waitFor(() => expect(activeId()).toBe(1), { timeout: 15000 })
  expect(modelCalls).toBe(0)
}, 60000)

test('navigation is not Undo: "undo" after a non-layout change still reverses that change, never a layout switch', async () => {
  mount(MAIN)
  await act(async () => { dockButton('Swing Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  await say('undo')
  expect(await screen.findByText(/nothing of mine to undo/, {}, { timeout: 15000 })).toBeTruthy()
  expect(activeId()).toBe(2)
}, 45000)

// ⭐ A1.3b (owner Q7) — a MEMBER's layout open is undoable with the Agent's rules: Undo
// reopens the previous saved layout (here MAIN, an own layout that auto-saves, so nothing
// was discarded).
test('A1.3b — Dock open → "Switched to …" → Undo reopens the previous layout', async () => {
  mount(MAIN)
  await act(async () => { dockButton('Swing Board').click() })
  await waitFor(() => expect(activeId()).toBe(2))
  const toast = await screen.findByTestId('layout-undo-toast')
  expect(toast.textContent).toMatch(/^Switched to “Swing Board”/)
  await act(async () => { within(toast).getByRole('button', { name: 'Undo' }).click() })
  await waitFor(() => expect(activeId()).toBe(1))
  expect(modelCalls).toBe(0)
}, 30000)

