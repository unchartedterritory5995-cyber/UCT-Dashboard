import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '../../a11y/axeHarness'

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
import { GRAPH_VIEW_KEY, nearestInDirection } from '../../lib/graphNavigation'

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
  const ctx = {
    canvas: null,
    setTransform: vi.fn(),
    clearRect: () => { ctxLog.clears += 1; ctxLog.strokes.push('frame') },
    beginPath: () => { pending = null },
    moveTo: vi.fn(),
    lineTo: () => { ctxLog.lines += 1 },
    // Wave 8 (8A): a stroke records what it drew and in what, so the keyboard
    // selection ring can be found in a frame. 'frame' marks each clearRect.
    stroke: () => { ctxLog.strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, arc: pending }) },
    arc: (x, y, r) => { pending = { x, y, r }; ctxLog.arcs.push(pending) },
    fill: vi.fn(),
    setLineDash: vi.fn(),
    fillText: (t, x, y) => { ctxLog.texts.push({ t, x, y }) },
    measureText: () => ({ width: 10 }),
  }
  return ctx
}

const RECT = { left: 0, top: 0, width: 820, height: 560 }

beforeEach(() => {
  ctxLog = { arcs: [], clears: 0, texts: [], lines: 0, contexts: 0, strokes: [] }
  window.localStorage.removeItem(GRAPH_VIEW_KEY)
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

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
    expect(screen.getByRole('status')).toHaveAccessibleName(/loading the graph/i)
  })

  it('the loading skeleton disappears once the graph data resolves', () => {
    render(<NoteGraphView />)
    expect(screen.queryByRole('status')).toBeNull()
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
    expect(legend.textContent).toMatch(/2\s*unlinked/)
    // ⛔ ONE LINK IS "1 link". This asserted /1\s*links/ and so pinned the bug:
    // production read "1 notes, 0 links", in the legend AND in the canvas
    // aria-label, which a screen reader says out loud.
    expect(legend.textContent).toMatch(/1\s*link(?!s)/)
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

  it('counts read as English at ONE and at zero', () => {
    swrResult = {
      isLoading: false,
      data: {
        nodes: [{ id: 'a', title: 'A', degree: 0 }],
        edges: [],
        truncated: false,
      },
    }
    const { container } = render(<NoteGraphView />)
    const legend = container.querySelector('[class*="legend"]').textContent
    expect(legend).toMatch(/1\s*note(?!s)/)   // not "1 notes"
    expect(legend).toMatch(/0\s*links/)       // zero IS plural
    expect(container.querySelector('canvas').getAttribute('aria-label'))
      .toBe('Note graph: 1 note, 0 links')
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

  it('SIZES THE CANVAS TO ITS CONTAINER once the canvas actually mounts', () => {
    // ⛔⛔ THE DEFECT THIS EXISTS FOR, FOUND ONLY IN A BROWSER. Measured on
    // production: container 1501px, canvas stuck at its 820px default -- 681px
    // of unused width. The sizing ran in an effect with `[]` deps, so it fired
    // once on mount; on that render `isLoading` is true and the component
    // returns an early <div>, so there was no canvas to observe and nothing
    // ever re-ran it.
    //
    // ⛔ AND NO TEST COULD SEE IT, because jsdom has no ResizeObserver and the
    // component guards on exactly that. So this test SUPPLIES one -- which is
    // the only way the path is reachable here at all.
    const observed = []
    class FakeRO {
      constructor(cb) { this.cb = cb }
      observe(el) { observed.push(el); this.cb([{ target: el }]) }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeRO)
    // A container wider than the 820x560 default, the way a real page is.
    const rect = { width: 1501, height: 562, left: 0, top: 0, right: 1501, bottom: 562 }
    const origProto = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () { return rect }

    swrResult = {
      isLoading: false,
      data: { nodes: [{ id: 'a', title: 'A', degree: 0 }], edges: [], truncated: false },
    }
    try {
      const { container } = render(<NoteGraphView />)
      const canvas = container.querySelector('canvas')
      expect(observed.length, 'the container was never observed').toBeGreaterThan(0)
      expect(canvas.style.width).toBe('1501px')
      expect(canvas.style.width).not.toBe('820px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origProto
    }
  })

  describe('resizing does not thrash the simulation', () => {
    // ⛔ WHY THIS EXISTS. Making the ResizeObserver actually fire (the previous
    // fix) meant `size` finally changes -- and the layout effect depends on it,
    // so every resize tick re-ran the whole 220-tick O(n^2) simulation from the
    // seed ring. Dragging a window edge scattered and re-settled the graph
    // dozens of times. Fixing the first defect is what made this one reachable.
    let fireResize
    let rect

    const mountWithObserver = (w = 1000, h = 600) => {
      rect = { width: w, height: h, left: 0, top: 0, right: w, bottom: h }
      class FakeRO {
        constructor(cb) { fireResize = cb }
        observe() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', FakeRO)
      HTMLElement.prototype.getBoundingClientRect = function () { return rect }
      swrResult = {
        isLoading: false,
        data: {
          nodes: [
            { id: 'a', title: 'A', degree: 1 },
            { id: 'b', title: 'B', degree: 1 },
          ],
          edges: [{ source: 'a', target: 'b', weight: 1 }],
          truncated: false,
        },
      }
      return render(<NoteGraphView />)
    }

    let origRect
    beforeEach(() => {
      origRect = HTMLElement.prototype.getBoundingClientRect
      // ⛔ FAKE ONLY setTimeout/clearTimeout. `vi.useFakeTimers()` also fakes
      // requestAnimationFrame, which overrides the synchronous rAF stub the
      // outer beforeEach installs -- so the simulation never ran and the test
      // measured 3 frames instead of the full budget. The debounce is the only
      // thing here that needs controllable time.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => { HTMLElement.prototype.getBoundingClientRect = origRect; vi.useRealTimers() })

    it('TEN resizes in one gesture cost ONE re-layout, not ten', () => {
      mountWithObserver(1000, 600)
      const settled = ctxLog.clears
      expect(settled).toBeGreaterThan(50)   // the first layout really ran

      // a drag: ten observer callbacks, each a genuinely different width
      act(() => {
        for (let i = 1; i <= 10; i += 1) {
          rect = { ...rect, width: 1000 + i * 20 }
          fireResize([{ target: document.body }])
        }
      })
      // nothing yet -- the gesture has not settled
      expect(ctxLog.clears - settled).toBe(0)

      act(() => { vi.advanceTimersByTime(500) })
      const afterOne = ctxLog.clears - settled
      expect(afterOne).toBeGreaterThan(50)  // exactly one full layout happened

      // and a second settle does not happen on its own
      act(() => { vi.advanceTimersByTime(2000) })
      expect(ctxLog.clears - settled).toBe(afterOne)
    })

    it('a 2px jitter costs NOTHING, even after the debounce elapses', () => {
      mountWithObserver(1000, 600)
      const settled = ctxLog.clears

      act(() => {
        rect = { ...rect, width: 1002 }       // below RESIZE_EPSILON_PX
        fireResize([{ target: document.body }])
        vi.advanceTimersByTime(500)
      })

      // ⛔ The threshold returns the SAME state object, so React does not
      // re-run the layout effect at all. A debounce alone would still pay for
      // this; that is why both guards exist.
      expect(ctxLog.clears - settled).toBe(0)
    })
  })

  describe('labels are budgeted, at both ends of the scale', () => {
    // ⛔ THE OLD RULE WAS `degree >= 3` UNDER A COMMENT SAYING "every label at
    // once is illegible". Measured with real font metrics at 500 notes, that
    // rule drew 291 labels and 54% of them overlapped another one — it was the
    // thing its own comment warned about. It was also wrong in the other
    // direction: a 5-note notebook got 2 labels.
    //
    // TWO tests because a budget has two failure modes and one does not imply
    // the other: too many labels on a big graph, too few on a small one.
    const graphOf = (n, degreeOf) => ({
      nodes: Array.from({ length: n }, (_, i) => ({
        id: `n${i}`, title: `Note ${i}`, degree: degreeOf(i),
      })),
      edges: [],
      truncated: false,
    })

    it('caps the labels on a big notebook, and keeps the biggest hub', () => {
      // Degrees descend, so the top of the budget is n0 and the bottom is n199.
      swrResult = { isLoading: false, data: graphOf(200, (i) => 200 - i) }
      render(<NoteGraphView />)

      const drawn = ctxLog.texts.slice(-40)
      const titles = new Set(ctxLog.texts.map((t) => t.t))
      // Every frame redraws, so count DISTINCT titles rather than fillText calls.
      expect(titles.size).toBeLessThanOrEqual(40)
      expect(titles.has('Note 0')).toBe(true)      // the biggest hub is labelled
      expect(titles.has('Note 199')).toBe(false)   // the smallest is not
      expect(drawn.length).toBeGreaterThan(0)
    })

    it('labels EVERY note in a small notebook, even the barely-linked ones', () => {
      // ⛔ THE CASE THAT EXISTS TODAY. Under `degree >= 3` these five notes drew
      // two labels between them, which is a graph that will not say what it is
      // showing. A budget labels all five because five is under the budget.
      swrResult = { isLoading: false, data: graphOf(5, () => 1) }
      render(<NoteGraphView />)

      const titles = new Set(ctxLog.texts.map((t) => t.t))
      expect(titles).toEqual(new Set(['Note 0', 'Note 1', 'Note 2', 'Note 3', 'Note 4']))
    })
  })

  describe('the layout spreads — it does not pile onto the frame', () => {
    // ⛔⛔ WHY THIS EXISTS, AND WHY IT IS NOT ANOTHER TIMING TEST.
    // The bench measured milliseconds per frame. The endpoint cap was set from
    // those numbers. Every test in this file passed. And at 500 notes the
    // product drew a RECTANGLE OUTLINE with an empty middle, because the layout
    // diverged inside its tick budget: the seed ring puts adjacent nodes ~2px
    // apart, and REPULSION/d^2 at 2px flings every node into the frame on tick
    // one. Speed was the wrong axis. This asserts SHAPE.
    //
    // TWO assertions, because there are two ways to be wrong and neither one
    // catches the other:
    //   · on-frame fraction — the defect that actually shipped
    //   · distinct cells    — the opposite failure, everything in one clump,
    //                         which is what a too-aggressive cap would produce
    const N = 100
    const BAND = 10
    const CELL = 40

    const spreadGraph = () => ({
      nodes: Array.from({ length: N }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, degree: 2 })),
      edges: Array.from({ length: N - 1 }, (_, k) => ({
        source: `n${k + 1}`, target: `n${((k + 1) * 7) % N}`, weight: 1,
      })),
      truncated: false,
    })

    it('does not pile the notes onto the edge of the canvas', () => {
      swrResult = { isLoading: false, data: spreadGraph() }
      render(<NoteGraphView />)

      const drawn = drawnNodes(N)
      expect(drawn).toHaveLength(N)

      const onFrame = drawn.filter(
        (a) => a.x < BAND || a.x > RECT.width - BAND || a.y < BAND || a.y > RECT.height - BAND,
      ).length
      // Measured on this canvas: 83/100 without the step cap, 15/100 with it.
      expect(onFrame / N).toBeLessThan(0.4)
    })

    it('and does not collapse them into one clump', () => {
      swrResult = { isLoading: false, data: spreadGraph() }
      render(<NoteGraphView />)

      const cells = new Set(
        drawnNodes(N).map((a) => `${Math.floor(a.x / CELL)},${Math.floor(a.y / CELL)}`),
      )
      // Measured: 33 distinct cells without the cap, 99 with it.
      expect(cells.size).toBeGreaterThan(70)
    })
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

// ─────────────────────────────────────────────────────────────────────────────
// Wave 8, lane 8A (ruling D-A3): a picture nobody can operate is not a view.
// ─────────────────────────────────────────────────────────────────────────────

/** The strokes of the LAST frame (everything after the final clearRect). */
function lastFrameStrokes() {
  const i = ctxLog.strokes.lastIndexOf('frame')
  return ctxLog.strokes.slice(i + 1)
}
/** The selection ring is the one stroke drawn wider than 1px. */
const ringsIn = (strokes) => strokes.filter((s) => s.width > 1)

const live = (container) => container.querySelector('[data-graph-live]').textContent

// Titles out of data order on purpose, and one lower-case: Home/End and the
// list's rows are ordered by localeCompare, which is not data order and not a
// byte sort ('alpha' sorts before 'Mid').
const KEY_GRAPH = {
  isLoading: false,
  data: {
    nodes: [
      { id: 'z', title: 'Zeta', degree: 1 },
      { id: 'a', title: 'alpha', degree: 2 },
      { id: 'm', title: 'Mid', degree: 1 },
    ],
    edges: [
      { source: 'a', target: 'z', weight: 1 },
      { source: 'a', target: 'm', weight: 1 },
    ],
    truncated: false,
  },
}

describe('the canvas is operable from the keyboard', () => {
  it('is focusable, has a role, and describes its own keys', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    expect(canvas.tabIndex).toBe(0)
    expect(canvas.getAttribute('role')).toBe('application')
    const described = document.getElementById(canvas.getAttribute('aria-describedby'))
    expect(described).not.toBeNull()
    for (const key of ['Arrow keys', 'Home', 'End', 'Enter', 'Escape', 'Show as list']) {
      expect(described.textContent).toContain(key)
    }
    // The live region exists BEFORE anything is said into it: a region that
    // arrives with its text already in place is not announced.
    const region = container.querySelector('[data-graph-live]')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('⛔ H14: every key press costs ONE frame and never re-runs the simulation', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    const settled = drawnNodes(3).map((n) => ({ x: n.x, y: n.y }))
    let before = ctxLog.clears
    expect(before).toBeGreaterThan(50) // the simulation really ran

    canvas.focus()
    for (const key of ['Home', 'End', 'ArrowLeft', 'Escape']) {
      fireEvent.keyDown(canvas, { key })
      // ⛔ EXACTLY ONE more frame per press. A re-simulation is the whole
      // tick budget, on a freshly acquired drawing context.
      expect(ctxLog.clears - before, `frames for ${key}`).toBe(1)
      expect(ctxLog.contexts).toBe(1)
      expect(drawnNodes(3).map((n) => ({ x: n.x, y: n.y })), `moved on ${key}`).toEqual(settled)
      before = ctxLog.clears
    }
  })

  it('a key that changes nothing draws nothing', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    fireEvent.keyDown(canvas, { key: 'Home' })
    const before = ctxLog.clears
    fireEvent.keyDown(canvas, { key: 'Home' }) // already there
    fireEvent.keyDown(canvas, { key: 'x' }) // not a graph key
    expect(ctxLog.clears - before).toBe(0)
  })

  it('Home and End go to the first and last note BY TITLE, and say so politely', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    fireEvent.keyDown(canvas, { key: 'Home' })
    expect(live(container)).toBe('alpha, 2 links')
    fireEvent.keyDown(canvas, { key: 'End' })
    expect(live(container)).toBe('Zeta, 1 link') // ONE link, not "1 links"
  })

  it('the first arrow, with nothing selected, lands on the first note by title', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    fireEvent.keyDown(container.querySelector('canvas'), { key: 'ArrowDown' })
    expect(live(container)).toBe('alpha, 2 links')
  })

  it('an arrow moves to the note the direction rule picks over the DRAWN positions', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    // the drawn positions, in data order (z, a, m)
    const [z, a, m] = drawnNodes(3)
    const placed = [{ id: 'z', ...z }, { id: 'a', ...a }, { id: 'm', ...m }]
    const title = { z: 'Zeta', a: 'alpha', m: 'Mid' }
    const DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    let moved = 0
    for (const key of Object.keys(DIRS)) {
      fireEvent.keyDown(canvas, { key: 'Home' }) // back to alpha each time
      const want = nearestInDirection(placed, placed[1], DIRS[key])
      fireEvent.keyDown(canvas, { key })
      // nothing that way -> the selection stays on alpha
      expect(live(container), key).toMatch(new RegExp(`^${want ? title[want.id] : 'alpha'},`))
      if (want) moved += 1
    }
    // non-vacuity: two other notes exist, so SOME direction reaches one
    expect(moved).toBeGreaterThan(0)
  })

  it('paints the selection as a ring around the selected note, and Escape clears it', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    expect(ringsIn(lastFrameStrokes())).toHaveLength(0)

    fireEvent.keyDown(canvas, { key: 'Home' }) // alpha, data index 1
    const alpha = drawnNodes(3)[1]
    const rings = ringsIn(lastFrameStrokes())
    expect(rings).toHaveLength(1)
    expect(rings[0].arc.x).toBe(alpha.x)
    expect(rings[0].arc.y).toBe(alpha.y)
    expect(rings[0].arc.r).toBeGreaterThan(alpha.r) // OUTSIDE the node, not over it
    expect(rings[0].style).toBeTruthy()

    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(ringsIn(lastFrameStrokes())).toHaveLength(0)
    expect(live(container)).toBe('')
  })

  it('Enter opens the selected note, and nothing when nothing is selected', () => {
    const onOpenNote = vi.fn()
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView onOpenNote={onOpenNote} />)
    const canvas = container.querySelector('canvas')
    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onOpenNote).not.toHaveBeenCalled()
    fireEvent.keyDown(canvas, { key: 'End' })
    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onOpenNote).toHaveBeenCalledTimes(1)
    expect(onOpenNote).toHaveBeenCalledWith('z')
  })

  it('an arrow never scrolls the page; a chord with Ctrl/Alt/Cmd passes through', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    const canvas = container.querySelector('canvas')
    // fireEvent returns false when the handler called preventDefault
    expect(fireEvent.keyDown(canvas, { key: 'ArrowDown' })).toBe(false)
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(fireEvent.keyDown(canvas, { key: 'ArrowDown', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(canvas, { key: 'Home', metaKey: true })).toBe(true)
    expect(live(container)).toBe('')
  })
})

describe('nearestInDirection -- "right" means right', () => {
  const from = { id: 'o', x: 0, y: 0 }
  it('prefers a note straight ahead over a nearer one off to the side', () => {
    const ahead = { id: 'ahead', x: 100, y: 0 }
    const side = { id: 'side', x: 60, y: 55 } // nearer (81px), ~42 degrees off
    expect(nearestInDirection([from, ahead, side], from, [1, 0]).id).toBe('ahead')
  })
  it('among notes on the axis, the nearer wins', () => {
    const near = { id: 'near', x: 0, y: 40 }
    const far = { id: 'far', x: 0, y: 90 }
    expect(nearestInDirection([from, far, near], from, [0, 1]).id).toBe('near')
  })
  it('never moves backwards or to a note level with it; nothing ahead is null', () => {
    const behind = { id: 'behind', x: -50, y: 0 }
    const level = { id: 'level', x: 0, y: 30 }
    expect(nearestInDirection([from, behind, level], from, [1, 0])).toBeNull()
  })
  it('screen up is negative y', () => {
    const up = { id: 'up', x: 5, y: -40 }
    const down = { id: 'down', x: 5, y: 40 }
    expect(nearestInDirection([from, up, down], from, [0, -1]).id).toBe('up')
  })
})

describe('"Show as list" -- the same graph as a table', () => {
  const toggle = () => screen.getByRole('button', { name: 'Show as list' })
  const rowTitles = () => screen.getAllByRole('rowheader').map((th) => th.textContent)

  it('is a real toggle button, pressed state and all, and it is remembered', () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    expect(toggle().tagName).toBe('BUTTON')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(window.localStorage.getItem(GRAPH_VIEW_KEY)).toBe('list')
  })

  it('opens in list mode when this browser chose it last time', () => {
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = KEY_GRAPH
    render(<NoteGraphView />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
  })

  it('⛔ a storage that throws means canvas mode -- and the toggle still works', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    expect(container.querySelector('canvas')).not.toBeNull()
    fireEvent.click(toggle())
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('every node renders exactly once, sorted by title (locale compare)', () => {
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = KEY_GRAPH
    render(<NoteGraphView />)
    expect(rowTitles()).toEqual(['alpha', 'Mid', 'Zeta'])
  })

  it('each row carries the link count and its linked notes as buttons', () => {
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = KEY_GRAPH
    render(<NoteGraphView />)
    const alphaRow = screen.getByRole('rowheader', { name: 'alpha' }).closest('tr')
    const cells = within(alphaRow).getAllByRole('cell')
    expect(cells[0].textContent).toBe('2')
    expect(within(cells[1]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mid', 'Zeta'])
    const zetaRow = screen.getByRole('rowheader', { name: 'Zeta' }).closest('tr')
    expect(within(zetaRow).getAllByRole('cell')[1].textContent).toBe('alpha')
  })

  it('a title opens its note on click AND on Enter; a linked note opens that note', async () => {
    const user = userEvent.setup()
    const onOpenNote = vi.fn()
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = KEY_GRAPH
    render(<NoteGraphView onOpenNote={onOpenNote} />)
    await user.click(within(screen.getByRole('rowheader', { name: 'Mid' })).getByRole('button'))
    expect(onOpenNote).toHaveBeenLastCalledWith('m')
    within(screen.getByRole('rowheader', { name: 'Zeta' })).getByRole('button').focus()
    await user.keyboard('{Enter}')
    expect(onOpenNote).toHaveBeenLastCalledWith('z')
    const alphaRow = screen.getByRole('rowheader', { name: 'alpha' }).closest('tr')
    await user.click(within(alphaRow).getByRole('button', { name: 'Mid' }))
    expect(onOpenNote).toHaveBeenLastCalledWith('m')
    expect(onOpenNote).toHaveBeenCalledTimes(3)
  })

  it('keeps the truncation sentence, word for word', () => {
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = { ...KEY_GRAPH, data: { ...KEY_GRAPH.data, truncated: true } }
    render(<NoteGraphView />)
    expect(screen.getByText('showing the 3 most recently edited — older notes are not drawn')).toBeInTheDocument()
  })

  it('going back to the canvas draws it again (a new canvas is a new layout)', () => {
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView />)
    expect(ctxLog.clears).toBe(0) // nothing was drawn in list mode
    fireEvent.click(toggle())
    expect(container.querySelector('canvas')).not.toBeNull()
    expect(ctxLog.clears).toBeGreaterThan(50)
    expect(drawnNodes(3)).toHaveLength(3)
  })

  it('axe finds 0 violations in list mode', async () => {
    window.localStorage.setItem(GRAPH_VIEW_KEY, 'list')
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView onOpenNote={() => {}} />)
    await expectNoAxeViolations(container)
  })

  it('axe finds 0 violations on the keyboard canvas with a note selected', async () => {
    swrResult = KEY_GRAPH
    const { container } = render(<NoteGraphView onOpenNote={() => {}} />)
    fireEvent.keyDown(container.querySelector('canvas'), { key: 'Home' })
    await expectNoAxeViolations(container)
  })
})
