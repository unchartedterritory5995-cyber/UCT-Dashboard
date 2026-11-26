/* ⚡ (2026-11-26, the board switch; owner: "buggy, jumpy") A LAYOUT SWITCH NEVER ANIMATES THE WIDGETS.
 *
 * react-grid-layout ships `.react-grid-item { transition: all 200ms }`. When two layouts share widget ids (a layout saved
 * from another keeps them), a switch keeps the same grid item, and its new size and place ANIMATED over 200 ms: the bench
 * rig measured a chart widget going 463 -> 529 -> 670 -> 846 -> 1124 -> ... -> 1400 px over ~230 ms, its header shedding and
 * taking back controls and its canvas resizing at every step. The transition belongs to drag and resize gestures only.
 * A board switch now marks the grid's node `charts-switching` before the commit that shows the new layout (the same
 * pattern as `.charts-resizing`, which kills the transition during a custom resize), and clears it once the next frame
 * has drawn: on the node, so the board is not rendered again just to drop a class.
 *   W1 (red first) a dock switch to a layout whose widget keeps its id and changes size: the grid node carries
 *      `charts-switching` at the commit that shows the new size
 *   W2 the mark clears after the next frame (later gestures animate as before)
 *   W3 a drag (the grid's own layout change) never carries it
 *   W4 the stylesheet kills the item transition under the mark, beside the resize one
 */
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('./WidgetHost', () => ({ default: ({ widget }) => <div data-testid={`body-${widget.type}`}>{widget.type}</div> }))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
// the grid (its node carries `react-grid-layout`, as the real one's does): every COMMIT records the node's classes and the
// layout it was given; a button stands in for a member's drag
const gridCommits = []
vi.mock('react-grid-layout', async () => {
  const { useLayoutEffect, useRef } = await import('react')
  return {
    Responsive: ({ children, onLayoutChange, className, layouts }) => {
      const ref = useRef(null)
      const lg = (layouts && layouts.lg) || []
      useLayoutEffect(() => { gridCommits.push({ classes: String(ref.current?.className || ''), lg }) })
      return (
        <div ref={ref} data-testid="rgl-responsive" className={`react-grid-layout ${className || ''}`}>
          <button data-testid="rgl-drag" onClick={() => onLayoutChange && onLayoutChange([{ i: 'watchlist-1', x: 10, y: 2, w: 6, h: 8 }])}>drag</button>
          {children}
        </div>
      )
    },
    WidthProvider: (C) => C,
  }
})
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

// Two layouts that SHARE the widget id 'watchlist-1' (as a layout saved from the other does), at different sizes
const MAIN = { id: 1, name: 'Main Trading', scope: 'user', groups: null, layout: { widgets: [{ id: 'watchlist-1', type: 'watchlist', color: 'A', x: 0, y: 0, w: 6, h: 8, opts: {} }], cols: 24 } }
const WIDE = { id: 2, name: 'Wide Board', scope: 'user', groups: null, layout: { widgets: [{ id: 'watchlist-1', type: 'watchlist', color: 'A', x: 0, y: 0, w: 18, h: 12, opts: {} }], cols: 24 } }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [MAIN, WIDE], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'

beforeEach(() => {
  gridCommits.length = 0
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/watchlists')) return json([])
    if (String(url).startsWith('/api/auth/preferences')) return new Response('', { status: 503 })
    return json({})
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch })

function mount() {
  prefStore.set({
    charts_workspace_layout: JSON.stringify(MAIN.layout),
    charts_active_template: JSON.stringify({ id: MAIN.id, name: MAIN.name, scope: MAIN.scope }),
  })
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const dockButton = (name) => [...document.querySelectorAll('[role="toolbar"][aria-label="Saved layouts"] button')].find(b => b.textContent.trim() === name) || null
const nextFrames = async (n = 3) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => requestAnimationFrame(() => r())) }) }
const isWide = (c) => c.lg.some((it) => it.i === 'watchlist-1' && it.w === 18)
const marked = (classes) => String(classes).split(' ').includes('charts-switching')
const gridNode = () => document.querySelector('[data-testid="rgl-responsive"]')

test('W1 (red first) a switch to a layout whose widget keeps its id and changes size: the commit showing it carries charts-switching', async () => {
  mount()
  await nextFrames()
  expect(dockButton('Wide Board'), 'the dock lists the other layout').toBeTruthy()
  await act(async () => { dockButton('Wide Board').click() })
  const first = gridCommits.find(isWide)
  expect(first, 'the grid was given the new size').toBeTruthy()
  expect(marked(first.classes), 'the new size was committed with the item transition live').toBe(true)
})

test('W2 the mark clears once the next frame has drawn', async () => {
  mount()
  await nextFrames()
  await act(async () => { dockButton('Wide Board').click() })
  await nextFrames(4)
  expect(isWide(gridCommits[gridCommits.length - 1])).toBe(true)
  expect(marked(gridNode().className), 'still marked after the frames: later gestures would not animate').toBe(false)
})

test('W3 a drag (the grid\'s own layout change) never carries the mark', async () => {
  const { getByTestId } = mount()
  await nextFrames()
  const from = gridCommits.length
  await act(async () => { getByTestId('rgl-drag').click() })
  expect(marked(gridNode().className)).toBe(false)
  await nextFrames(1)
  const after = gridCommits.slice(from)
  expect(after.length).toBeGreaterThan(0)
  expect(after.some((c) => marked(c.classes))).toBe(false)
})

test('W4 the stylesheet kills the grid item transition under the mark, as it does while resizing', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ChartsWorkspace.module.css'), 'utf8')
  const flat = css.replace(/\s+/g, ' ')
  expect(flat).toContain(':global(.charts-resizing) > :global(.react-grid-item) { transition: none !important; }')
  expect(flat).toContain(':global(.charts-switching) > :global(.react-grid-item) { transition: none !important; }')
})
