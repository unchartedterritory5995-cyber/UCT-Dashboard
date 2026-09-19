import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * ⛔ THE LOAD-BEARING TEST IN THIS FILE IS `hovering costs ONE repaint`.
 *
 * The first version of this component listed the hovered id in the layout
 * effect's dependency array, so every mouse move tore down the simulation and
 * re-seeded every node back onto the start ring. Position equality CANNOT catch
 * that -- the layout is deterministic, so a full re-run converges on exactly the
 * same coordinates. What separates the two is the COST: a redraw is one frame, a
 * re-run is the whole tick budget. That is what is asserted.
 */

let swrResult
const swrKeys = []
vi.mock('swr', () => ({
  default: (key) => { swrKeys.push(key); return swrResult },
}))

import NoteGraphView from './NoteGraphView'

// ── a recording 2d context, because jsdom has no canvas ────────────────────
// ⛔ THE LOG IS RESET IN beforeEach, NEVER IN makeCtx. A re-running layout effect
// calls getContext() again, and a per-context log would zero itself on exactly
// the run the hover test exists to detect -- the counter would read "no extra
// frames" for the defect. Counting across contexts is what makes a re-simulation
// show up as the hundreds of frames it actually is.
let ctxLog
function makeCtx() {
  ctxLog.contexts += 1
  let pending = null
  return {
    canvas: null,
    setTransform: vi.fn(),
    clearRect: () => { ctxLog.clears += 1 },
    beginPath: () => { pending = null },
    moveTo: vi.fn(),
    lineTo: () => { ctxLog.lines += 1 },
    stroke: vi.fn(),
    arc: (x, y, r) => { pending = { x, y, r }; ctxLog.arcs.push(pending) },
    fill: vi.fn(),
    setLineDash: vi.fn(),
    fillText: (t, x, y) => { ctxLog.texts.push({ t, x, y }) },
    measureText: () => ({ width: 10 }),
  }
}

const RECT = { left: 0, top: 0, width: 820, height: 560 }

beforeEach(() => {
  ctxLog = { arcs: [], clears: 0, texts: [], lines: 0, contexts: 0 }
  swrKeys.length = 0
  swrResult = { data: { nodes: [], edges: [], truncated: false }, isLoading: false }

  HTMLCanvasElement.prototype.getContext = vi.fn(() => makeCtx())
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => RECT)
  // Synchronous rAF so the simulation settles inside render(): the whole point
  // of the hover test is to compare a SETTLED graph against what a hover does
  // to it.
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => { vi.unstubAllGlobals() })

/** Where the last draw actually put each node. */
function drawnNodes(count) {
  return ctxLog.arcs.slice(-count)
}

describe('NoteGraphView', () => {
  it('reads the whole-notebook graph endpoint, not a filtered slice', () => {
    render(<NoteGraphView />)
    expect(swrKeys[0]).toBe('/api/j2/notes/graph')
  })

  it('says it is loading rather than drawing an empty canvas', () => {
    swrResult = { data: undefined, isLoading: true }
    render(<NoteGraphView />)
    expect(screen.getByText(/loading the graph/i)).toBeTruthy()
  })

  it('tells a member with no notes what to do instead of showing a blank box', () => {
    render(<NoteGraphView />)
    expect(screen.getByText(/no notes yet/i)).toBeTruthy()
  })

  it('counts unlinked notes, because they are the finding', () => {
    swrResult = {
      isLoading: false,
      data: {
        nodes: [
          { id: 'a', title: 'A', degree: 1 },
          { id: 'b', title: 'B', degree: 1 },
          { id: 'c', title: 'Lonely', degree: 0 },
          { id: 'd', title: 'Also lonely', degree: 0 },
        ],
        edges: [{ source: 'a', target: 'b', weight: 1 }],
        truncated: false,
      },
    }
    const { container } = render(<NoteGraphView />)
    const legend = container.querySelector('[class*="legend"]')
    expect(legend.textContent).toMatch(/4\s*notes/)
    expect(legend.textContent).toMatch(/1\s*links/)
    expect(legend.textContent).toMatch(/2\s*unlinked/)
  })

  it('DRAWS unlinked notes -- it never filters the graph down to linked ones', () => {
    swrResult = {
      isLoading: false,
      data: {
        nodes: [
          { id: 'a', title: 'A', degree: 1 },
          { id: 'b', title: 'B', degree: 1 },
          { id: 'c', title: 'Lonely', degree: 0 },
        ],
        edges: [{ source: 'a', target: 'b', weight: 1 }],
        truncated: false,
      },
    }
    render(<NoteGraphView />)
    // One arc per node on the final frame. An inner join against the edges
    // would draw two.
    expect(drawnNodes(3)).toHaveLength(3)
    expect(ctxLog.arcs.length % 3).toBe(0)
  })

  it('says so out loud when the graph is truncated', () => {
    swrResult = {
      isLoading: false,
      data: {
        nodes: [{ id: 'a', title: 'A', degree: 0 }],
        edges: [],
        truncated: true,
      },
    }
    render(<NoteGraphView />)
    expect(screen.getByText(/older notes are not drawn/i)).toBeTruthy()
  })

  it('does NOT claim truncation when the whole notebook fits', () => {
    swrResult = {
      isLoading: false,
      data: { nodes: [{ id: 'a', title: 'A', degree: 0 }], edges: [], truncated: false },
    }
    render(<NoteGraphView />)
    expect(screen.queryByText(/older notes are not drawn/i)).toBeNull()
  })

  it('hovering costs ONE repaint, not a whole re-simulation', () => {
    swrResult = {
      isLoading: false,
      data: {
        nodes: [
          { id: 'a', title: 'A', degree: 1 },
          { id: 'b', title: 'B', degree: 1 },
          { id: 'c', title: 'C', degree: 0 },
        ],
        edges: [{ source: 'a', target: 'b', weight: 1 }],
        truncated: false,
      },
    }
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')

    const settled = drawnNodes(3).map((n) => ({ x: n.x, y: n.y }))
    const clearsAfterMount = ctxLog.clears
    expect(clearsAfterMount).toBeGreaterThan(50) // the simulation really ran

    fireEvent.mouseMove(canvas, { clientX: settled[0].x, clientY: settled[0].y })

    // ⛔ EXACTLY ONE more frame. Re-running the simulation adds a whole tick
    // budget, and re-acquires the drawing context to do it.
    expect(ctxLog.clears - clearsAfterMount).toBe(1)
    expect(ctxLog.contexts).toBe(1)
    // ...and the graph the member is reading has not moved under them.
    expect(drawnNodes(3).map((n) => ({ x: n.x, y: n.y }))).toEqual(settled)
  })

  it('opens the note that was actually clicked', () => {
    const onOpenNote = vi.fn()
    swrResult = {
      isLoading: false,
      data: {
        nodes: [
          { id: 'note-a', title: 'A', degree: 1 },
          { id: 'note-b', title: 'B', degree: 1 },
        ],
        edges: [{ source: 'note-a', target: 'note-b', weight: 1 }],
        truncated: false,
      },
    }
    const { container } = render(<NoteGraphView onOpenNote={onOpenNote} />)
    const canvas = container.querySelector('canvas')
    const [first, second] = drawnNodes(2)

    fireEvent.click(canvas, { clientX: second.x, clientY: second.y })
    expect(onOpenNote).toHaveBeenCalledTimes(1)
    // The SECOND drawn arc is the second node in the data.
    expect(onOpenNote).toHaveBeenCalledWith('note-b')

    onOpenNote.mockClear()
    fireEvent.click(canvas, { clientX: first.x, clientY: first.y })
    expect(onOpenNote).toHaveBeenCalledWith('note-a')
  })

  it('clicking empty space opens nothing', () => {
    const onOpenNote = vi.fn()
    swrResult = {
      isLoading: false,
      data: {
        nodes: [{ id: 'note-a', title: 'A', degree: 0 }],
        edges: [],
        truncated: false,
      },
    }
    const { container } = render(<NoteGraphView onOpenNote={onOpenNote} />)
    const canvas = container.querySelector('canvas')
    const [only] = drawnNodes(1)
    fireEvent.click(canvas, { clientX: only.x + 200, clientY: only.y + 150 })
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('lays the same notebook out the same way twice', () => {
    swrResult = {
      isLoading: false,
      data: {
        nodes: [
          { id: 'a', title: 'A', degree: 2 },
          { id: 'b', title: 'B', degree: 1 },
          { id: 'c', title: 'C', degree: 1 },
        ],
        edges: [
          { source: 'b', target: 'a', weight: 1 },
          { source: 'c', target: 'a', weight: 1 },
        ],
        truncated: false,
      },
    }
    const first = render(<NoteGraphView />)
    const a = drawnNodes(3).map((n) => ({ x: n.x, y: n.y }))
    first.unmount()
    render(<NoteGraphView />)
    const b = drawnNodes(3).map((n) => ({ x: n.x, y: n.y }))
    // A member's mental map of their own graph has to survive a reload, so the
    // seed is a ring by index and never Math.random().
    expect(b).toEqual(a)
  })
})
