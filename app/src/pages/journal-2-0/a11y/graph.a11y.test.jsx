// app/src/pages/journal-2-0/a11y/graph.a11y.test.jsx
//
// A3: the note graph's two accessible doors, each through axe on the real
// component over the fixture network (ruling D-A3).
//   · graph-canvas — the keyboard canvas with a note selected: the focusable
//     application region, its key description and its polite live region
//     carrying "<title>, <n> links".
//   · graph-list — "Show as list": the table of every note, by title, with
//     its linked notes as buttons.
// jsdom has no 2d context, so the canvas gets a no-op one: the layout still
// runs (it is what gives the keyboard something to walk) and nothing is drawn.
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import { axeSurface } from './surface'
import NoteGraphView from '../components/notebook/NoteGraphView'
import { GRAPH_VIEW_KEY } from '../lib/graphNavigation'

const noopContext = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true },
})

describe('the note graph', () => {
  let origGetContext
  beforeEach(() => {
    installFetch()
    latchWave8Flags(true)
    origGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => noopContext()
    try { window.localStorage.removeItem(GRAPH_VIEW_KEY) } catch { /* canvas either way */ }
  })
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext
    try { window.localStorage.removeItem(GRAPH_VIEW_KEY) } catch { /* canvas either way */ }
    vi.restoreAllMocks()
  })

  axeSurface('graph-canvas', async () => {
    const { container } = render(<Providers><NoteGraphView onOpenNote={() => {}} /></Providers>)
    const canvas = await waitFor(() => {
      const c = container.querySelector('canvas[role="application"]')
      if (!c) throw new Error('graph canvas not mounted')
      return c
    })
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'Home' })
    // non-vacuity: the selection really landed, and was said out loud
    await waitFor(() => expect(container.querySelector('[data-graph-live]').textContent).toBe('AMD thesis, 1 link'))
    return { root: container }
  })

  axeSurface('graph-list', async () => {
    const { container } = render(<Providers><NoteGraphView onOpenNote={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Show as list' }))
    const table = await screen.findByRole('table')
    // non-vacuity: all four fixture notes, by title, and a linked-note button
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent))
      .toEqual(['AMD thesis', 'Lonely note', 'NVDA thesis', 'Weekly plan'])
    within(table).getAllByRole('button', { name: 'Weekly plan' })
    return { root: container }
  })
})
