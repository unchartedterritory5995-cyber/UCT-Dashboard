import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { SkeletonBlock } from '../../../../components/Skeleton'
import styles from './NoteGraphView.module.css'
import {
  ARROWS, byTitle, nearestInDirection, readGraphView, titleOf, writeGraphView,
} from '../../lib/graphNavigation'

/**
 * The note-link graph, drawn.
 *
 * ⛔ CANVAS, NOT SVG, AND NO NEW DEPENDENCY. A thousand nodes as DOM elements is a
 * thousand layout objects the browser re-lays-out on every tick; the same thousand
 * on a canvas is one element. And a force-directed layout is ~40 lines of
 * arithmetic — pulling in d3-force (or worse, a graph library) to get them would
 * add a bundle to every member who never opens this view, in a repo already trying
 * to shrink a 1.1MB echarts.
 *
 * ⛔ THE SIMULATION IS BOUNDED AND STOPS. It runs a fixed tick budget and then
 * holds still. A loop that never settles pins a core for as long as the tab is
 * open — the same class as the render loop that froze navigation app-wide (H14).
 *
 * ⛔⛔ BOUNDED IS NOT THE SAME AS CORRECT, AND THIS FILE LEARNED IT THE HARD WAY.
 * The tick budget was measured, the per-frame cost was measured, the endpoint cap
 * was set from those numbers — and at 500 notes the thing still drew a rectangle
 * outline with an empty middle, because the layout DIVERGED inside its budget.
 * Speed was the wrong axis. `tools/graph_layout_bench.mjs` now prints wall
 * concentration and occupancy next to the milliseconds, so the next person
 * raising a limit is shown both.
 *
 * ⛔ HOVERING MUST NOT RE-RUN THE SIMULATION. The layout effect deliberately does
 * NOT depend on the hovered id: a fresh run re-seeds every node back onto the
 * start ring, so a mouse move would visibly scatter the graph the member is
 * reading. Hover writes a ref and asks for ONE redraw of the settled positions.
 *
 * ⛔ ISOLATED NOTES ARE THE POINT. The endpoint returns every note, linked or not,
 * and this draws them. A member's orphaned notes are the most useful thing a graph
 * view can show them; filtering to "notes with edges" would hide exactly what they
 * came to find.
 *
 * ⛔ A PICTURE NOBODY CAN OPERATE IS NOT A VIEW (wave 8, lane 8A, ruling D-A3).
 * Two doors, and neither replaces the other:
 *   · "Show as list" — the same notes as a table, sorted by title, every title
 *     and every linked note a real button. It is the whole graph for anybody
 *     who cannot see or point at a canvas, and it is remembered per browser.
 *   · the canvas itself is focusable: arrows walk to the nearest note in that
 *     direction, Home/End jump by title, Enter opens, Escape clears, and a
 *     polite live region says where the selection landed.
 * ⛔ A KEY PRESS IS A HOVER: it writes a ref and asks for ONE redraw of the
 * settled positions. `selected` is not a layout dependency for exactly the
 * reason `hover` is not -- a re-run re-seeds the ring, and a member walking
 * the graph by keyboard would watch it scatter on every press (rule H14).
 */

const fetcher = (url) => fetch(url, { credentials: 'include' })
  .then((r) => (r.ok ? r.json() : { nodes: [], edges: [], truncated: false }))

// Named because each one is a knob somebody will want to turn; a magic number
// buried in the loop is a knob nobody can find.
const TICKS = 220            // the whole simulation; then it STOPS
const REPULSION = 5200
const SPRING = 0.0016
const SPRING_LEN = 92
const CENTER_PULL = 0.014
const DAMPING = 0.86
const MIN_R = 4
const MAX_R = 16
const HIT_SLOP = 8           // px of forgiveness around a node's own radius
// ⛔⛔ A BUDGET, NOT A DEGREE CUT. The rule was `degree >= 3`, under a comment
// saying "every label at once is illegible" — and at 500 notes that rule drew
// 291 labels of which 54% overlapped another label. It was the thing the
// comment warned about. Measured with the browser's own measureText, share of
// labels colliding with another:
//
//     notes        degree >= 3          top 40 by degree
//         5     2 labels,  0%          5 labels,  0%   <- and it labels ALL 5
//        50    23 labels,  4%         40 labels,  8%
//       200   111 labels, 24%         40 labels, 18%
//       500   291 labels, 54%         40 labels, 15%
//
// A budget is the only form that holds at BOTH ends: a 5-note notebook wants
// every title, a 500-note one wants the hubs. A degree threshold gets the small
// case wrong (2 labels out of 5) and the large case wrong (291 out of 500).
const LABEL_BUDGET = 40
const RESIZE_EPSILON_PX = 8  // below this, a size change is not worth a re-layout
const RESIZE_SETTLE_MS = 160 // one re-layout per resize gesture, not per tick
// ⛔⛔ THE STEP CAP IS WHAT KEEPS THIS LAYOUT FROM DIVERGING. The seed ring puts
// adjacent nodes ~2px apart at 500 notes, and REPULSION/d^2 at 2px is a ~1000px
// impulse on tick one -- every node hits the frame before a spring ever acts.
// Measured without it: 98% of 500 nodes held by the clamp, a rectangle outline
// with an empty middle. With it: 4.8x wall concentration, 69-100% occupancy.
// ⚠️ Raising MAX_STEP_FRAC re-opens that. `node tools/graph_layout_bench.mjs`
// prints both the timing AND the shape numbers; run it before touching these.
const MAX_STEP_FRAC = 0.02   // a node may cross 2% of the short side in one tick
const COOLING = 0.985        // the cap decays, so late ticks settle instead of jitter
const TEMP_FLOOR = 0.05      // ...but never to zero, or nothing can still move

/** "1 note", not "1 notes" — this reaches the legend AND the canvas aria-label,
 *  so a screen reader reads the count out loud. */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Radius from degree — sqrt so a hub with 40 links is not 10x a node with 4. */
const radiusFor = (degree) => Math.min(MAX_R, MIN_R + Math.sqrt(degree || 0) * 2.4)

// ── the two accessible doors (wave 8, lane 8A) ─ see lib/graphNavigation.js ──────────

// The selection ring sits OUTSIDE the node (gap), thick enough to read as a
// ring rather than an outline. Its colour is the canvas element's own CSS
// `color` (NoteGraphView.module.css `.canvas`), so it follows the theme and the
// contrast rail measures it where every other colour in the Notebook lives.
const RING_GAP = 3
const RING_WIDTH = 2.5
const RING_FALLBACK = '#dcbb5e' // jsdom and a host with no computed style

export default function NoteGraphView({ onOpenNote }) {
  const { data, isLoading } = useSWR('/api/j2/notes/graph', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  })
  const canvasRef = useRef(null)
  const roRef = useRef(null)
  const resizeTimerRef = useRef(null)
  const simRef = useRef({ nodes: [], edges: [] })
  const drawRef = useRef(null)
  const hoverRef = useRef(null)
  const selectedRef = useRef(null)
  const rafRef = useRef(0)
  const [hover, setHover] = useState(null)
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState(readGraphView)
  const [size, setSize] = useState({ w: 820, h: 560 })
  const keysId = useId()

  const graph = useMemo(() => ({
    nodes: data?.nodes || [],
    edges: data?.edges || [],
    truncated: Boolean(data?.truncated),
  }), [data])

  // Title order, shared by the list's rows and the canvas's Home/End.
  const sortedNodes = useMemo(() => [...graph.nodes].sort(byTitle), [graph])

  // Who links to whom, both directions, for the list's "linked notes" column.
  // An edge to a note that is not drawn (truncation) has no row to open.
  const neighbours = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const out = new Map(graph.nodes.map((n) => [n.id, new Map()]))
    for (const e of graph.edges) {
      if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue
      out.get(e.source).set(e.target, byId.get(e.target))
      out.get(e.target).set(e.source, byId.get(e.source))
    }
    return new Map([...out].map(([id, m]) => [id, [...m.values()].sort(byTitle)]))
  }, [graph])

  const toggleView = () => {
    const next = view === 'list' ? 'canvas' : 'list'
    writeGraphView(next)
    setView(next)
  }

  // ── size to the container, and re-measure on resize ───────────────────────
  //
  // ⛔⛔ A CALLBACK REF, NOT AN EFFECT WITH [] DEPS. Measured on production:
  // container 1501px, canvas stuck at the 820px default -- 681px of unused
  // width. An effect with `[]` runs once on mount, and on THAT render
  // `isLoading` is true so the component returns an early <div>: there is no
  // canvas, the ref is null, the effect bails, and the observer is never
  // attached. When the data lands and the canvas finally mounts, nothing
  // re-runs it.
  //
  // ⛔ NO TEST COULD HAVE CAUGHT IT. jsdom has no ResizeObserver and the code
  // guards on exactly that, so every test skipped this path -- which is why it
  // took a browser. A callback ref fires whenever the node attaches or
  // detaches, however many times, with no dependency array to get wrong.
  const attachCanvas = useCallback((node) => {
    canvasRef.current = node
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (resizeTimerRef.current) { clearTimeout(resizeTimerRef.current); resizeTimerRef.current = null }
    if (!node || typeof ResizeObserver === 'undefined') return
    const el = node.parentElement
    if (!el) return
    // ⛔⛔ ONE RE-LAYOUT PER RESIZE GESTURE, NOT ONE PER TICK. The layout effect
    // depends on `size`, so every setSize re-runs the whole 220-tick O(n^2)
    // simulation from the seed ring. While this observer was inert (the bug the
    // previous commit fixed) that never showed; the moment it started firing,
    // dragging a window edge would scatter and re-settle the graph dozens of
    // times. Fixing the first defect is what made this one reachable.
    //
    // ⛔ THE THRESHOLD AND THE DEBOUNCE ARE NOT THE SAME GUARD. The threshold
    // drops 1px jitter that should never cost anything at all; the debounce
    // collapses a genuine drag into a single settle. Remove either and the
    // other does not cover it.
    const apply = (w, h) => {
      setSize((prev) => (
        Math.abs(prev.w - w) < RESIZE_EPSILON_PX && Math.abs(prev.h - h) < RESIZE_EPSILON_PX
          ? prev            // identity preserved => the layout effect does not re-run
          : { w, h }
      ))
    }
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0) return
      apply(Math.floor(r.width), Math.max(360, Math.floor(r.height)))
    }
    measure()                                  // first one is immediate, not debounced
    const ro = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(measure, RESIZE_SETTLE_MS)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  // ── lay out, draw, stop ───────────────────────────────────────────────────
  // ⛔ `hover` and `selected` are NOT dependencies. See the header note.
  // `view` IS: the canvas unmounts in list mode, so coming back to it is a new
  // element with nothing drawn on it -- one deliberate layout, on a toggle.
  useEffect(() => {
    const canvas = canvasRef.current
    if (view !== 'canvas' || !canvas || !graph.nodes.length) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(size.w * dpr))
    canvas.height = Math.max(1, Math.round(size.h * dpr))
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Deterministic start: a ring, not Math.random(). The same notebook draws the
    // same shape every time, so a member's mental map survives a reload.
    const N = graph.nodes.length
    const spread = Math.min(size.w, size.h) * 0.32
    const nodes = graph.nodes.map((n, i) => {
      const a = (i / N) * Math.PI * 2
      return {
        id: n.id,
        title: n.title || 'Untitled',
        degree: n.degree || 0,
        x: size.w / 2 + Math.cos(a) * spread,
        y: size.h / 2 + Math.sin(a) * spread,
        vx: 0,
        vy: 0,
        r: radiusFor(n.degree),
      }
    })
    // ⛔ COMPUTED ONCE PER LAYOUT, NOT PER FRAME — draw() runs 220 times.
    // Sorting is stable and `nodes` is built in a deterministic order, so the
    // same notebook labels the same notes every time, ties included.
    const labelled = new Set(
      [...nodes]
        .sort((a, b) => b.degree - a.degree)
        .slice(0, LABEL_BUDGET)
        .map((n) => n.id),
    )

    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges = graph.edges
      .map((e) => ({ s: byId.get(e.source), t: byId.get(e.target) }))
      .filter((e) => e.s && e.t)
    simRef.current = { nodes, edges }

    const stepCap0 = MAX_STEP_FRAC * Math.min(size.w, size.h)
    const stepCapFloor = stepCap0 * TEMP_FLOOR
    let stepCap = stepCap0

    const step = () => {
      // ⛔⛔ O(n^2), AND HERE IS WHAT THAT COSTS — MEASURED, not assumed.
      // 220 ticks with these constants, per frame: 500 nodes 0.7ms · 1500
      // 5.5ms · 2000 10.3ms · 3000 24.7ms · 5000 ~80ms (~18s of blocked main
      // thread). ⚠️ Those are the SPEED numbers and speed is only half of it —
      // this layout was once fast at every one of these sizes and still drew a
      // rectangle outline. The bench prints wall concentration and occupancy
      // beside the milliseconds now; read both.
      // ⚰️ This read "fine to ~1500 nodes, which is the endpoint's own default
      // cap" — half right, and the wrong half mattered: 1500 is the DEFAULT,
      // the ceiling was 5000, and the sentence read as if they were one number.
      // The endpoint now caps at 2000, the largest size measured inside a 16ms
      // frame. Past that this needs a quadtree, and raising the cap without one
      // buys the H14 nav-freeze class.
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            // Two nodes exactly on top of each other have no direction to push
            // apart in. Nudge them deterministically by index, never by random,
            // so the same notebook still draws the same shape.
            dx = (i % 7) - 3
            dy = (j % 7) - 3
            d2 = Math.max(1, dx * dx + dy * dy)
          }
          const d = Math.sqrt(d2)
          const f = REPULSION / d2
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }
      for (const e of edges) {
        const dx = e.t.x - e.s.x
        const dy = e.t.y - e.s.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - SPRING_LEN) * SPRING * d
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        e.s.vx += fx
        e.s.vy += fy
        e.t.vx -= fx
        e.t.vy -= fy
      }
      for (const n of nodes) {
        n.vx += (size.w / 2 - n.x) * CENTER_PULL
        n.vy += (size.h / 2 - n.y) * CENTER_PULL
        n.vx *= DAMPING
        n.vy *= DAMPING
        // ⛔ NO NODE CROSSES THE SCREEN IN ONE TICK. See MAX_STEP_FRAC.
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (speed > stepCap) {
          n.vx = (n.vx / speed) * stepCap
          n.vy = (n.vy / speed) * stepCap
        }
        n.x += n.vx
        n.y += n.vy
        n.x = Math.max(n.r + 2, Math.min(size.w - n.r - 2, n.x))
        n.y = Math.max(n.r + 2, Math.min(size.h - n.r - 2, n.y))
      }
      // Cool AFTER the tick, so tick 0 gets the full budget to unpack the ring.
      stepCap = Math.max(stepCap * COOLING, stepCapFloor)
    }

    /** The ring colour, read from the canvas's own CSS `color` -- only when a
     *  note is selected, so an unselected frame costs no style read. */
    const ringColor = () => {
      try {
        const c = window.getComputedStyle(canvas).color
        if (c) return c
      } catch {
        // fall through
      }
      return RING_FALLBACK
    }

    const draw = () => {
      const hovered = hoverRef.current
      const chosen = selectedRef.current ? byId.get(selectedRef.current) : null
      const ring = chosen ? ringColor() : null
      ctx.clearRect(0, 0, size.w, size.h)
      ctx.lineWidth = 1
      for (const e of edges) {
        const lit = hovered && (e.s.id === hovered || e.t.id === hovered)
        ctx.strokeStyle = lit ? 'rgba(201,168,76,0.85)' : 'rgba(148,163,184,0.20)'
        ctx.beginPath()
        ctx.moveTo(e.s.x, e.s.y)
        ctx.lineTo(e.t.x, e.t.y)
        ctx.stroke()
      }
      // The keyboard selection: a ring OUTSIDE the node, drawn before the
      // nodes so a neighbour's fill can never hide the node it rings, and so
      // the last N arcs of a frame are still exactly the N nodes.
      if (chosen) {
        ctx.beginPath()
        ctx.arc(chosen.x, chosen.y, chosen.r + RING_GAP, 0, Math.PI * 2)
        ctx.strokeStyle = ring
        ctx.lineWidth = RING_WIDTH
        ctx.stroke()
        ctx.lineWidth = 1
      }
      for (const n of nodes) {
        const isHover = hovered === n.id
        const isChosen = chosen === n
        // An ORPHAN is drawn differently on purpose — it is the finding.
        const orphan = !n.degree
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = isHover ? '#c9a84c' : (orphan ? 'rgba(148,163,184,0.38)' : '#7aa2c8')
        ctx.fill()
        if (orphan) {
          ctx.strokeStyle = 'rgba(148,163,184,0.55)'
          ctx.setLineDash([2, 2])
          ctx.stroke()
          ctx.setLineDash([])
        }
        // The biggest hubs, whatever is hovered, and the keyboard selection.
        // See LABEL_BUDGET.
        if (isHover || isChosen || labelled.has(n.id)) {
          ctx.fillStyle = isHover ? '#f8fafc' : isChosen ? ring : 'rgba(226,232,240,0.62)'
          ctx.font = (isHover || isChosen ? '12px ' : '10px ') + "'Instrument Sans', system-ui, sans-serif"
          ctx.textAlign = 'center'
          const t = n.title.length > 28 ? n.title.slice(0, 27) + '…' : n.title
          ctx.fillText(t, n.x, n.y - n.r - 5)
        }
      }
    }
    drawRef.current = draw

    let tick = 0
    const loop = () => {
      step()
      draw()
      tick += 1
      // ⛔ STOPS at the tick budget. No permanent animation loop.
      if (tick < TICKS) rafRef.current = requestAnimationFrame(loop)
    }
    if (typeof requestAnimationFrame === 'function') {
      loop()
    } else {
      // A host without rAF: settle synchronously so nobody ever sees the seed ring.
      for (; tick < TICKS; tick += 1) step()
      draw()
    }
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current)
      drawRef.current = null
    }
  }, [graph, size, view])

  // Hover repaints the SETTLED positions. One frame, no simulation.
  useEffect(() => {
    hoverRef.current = hover
    if (drawRef.current) drawRef.current()
  }, [hover])

  // ...and so does a key press. ⛔ Same contract, same reason (header note).
  useEffect(() => {
    selectedRef.current = selected
    if (drawRef.current) drawRef.current()
  }, [selected])

  /**
   * The canvas's keys. Arrows walk to the nearest note in that direction (the
   * first press, with nothing selected yet, lands on the first note by title),
   * Home/End jump by title, Enter opens, Escape clears. A key it does not own
   * -- or any chord with Ctrl/Alt/Cmd -- passes through untouched.
   */
  const onCanvasKeyDown = (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return
    const nodes = simRef.current.nodes
    if (!nodes.length) return
    const current = selected ? nodes.find((n) => n.id === selected) || null : null
    const first = () => nodes.find((n) => n.id === sortedNodes[0]?.id) || null
    let next = null
    if (ARROWS[ev.key]) {
      ev.preventDefault() // an arrow on a focused canvas must never scroll the page
      next = current ? nearestInDirection(nodes, current, ARROWS[ev.key]) : first()
    } else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault()
      const pick = ev.key === 'Home' ? sortedNodes[0] : sortedNodes[sortedNodes.length - 1]
      next = pick ? nodes.find((n) => n.id === pick.id) || null : null
    } else if (ev.key === 'Enter') {
      if (current && onOpenNote) {
        ev.preventDefault()
        onOpenNote(current.id)
      }
      return
    } else if (ev.key === 'Escape') {
      if (current) {
        ev.preventDefault()
        setSelected(null)
      }
      return
    } else {
      return
    }
    // Nothing further that way: the selection stays, and nothing is redrawn.
    if (next && next.id !== selected) setSelected(next.id)
  }

  /** Nearest node under the pointer, within its own radius plus a little slop. */
  const pick = useCallback((ev) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    let best = null
    let bestD = Infinity
    for (const n of simRef.current.nodes) {
      const d = Math.hypot(n.x - x, n.y - y)
      if (d <= n.r + HIT_SLOP && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }, [])

  if (isLoading) {
    // G-106 (Wave B lower-frequency sweep): a chart-shaped placeholder
    // (SkeletonBlock -- the same primitive SkeletonChart wraps elsewhere in
    // the app) standing in for the canvas, instead of bare centered text.
    return (
      <div className={styles.state} role="status" aria-label="Loading the graph…">
        <SkeletonBlock width="100%" height={420} />
      </div>
    )
  }
  if (!graph.nodes.length) {
    return (
      <div className={styles.state}>
        No notes yet. Link notes to each other with <code>@</code> and they will
        appear here.
      </div>
    )
  }

  const orphans = graph.nodes.filter((n) => !n.degree).length
  const chosen = selected ? graph.nodes.find((n) => n.id === selected) : null
  // What the polite live region says. Text, rendered -- so a test can read it
  // and a screen reader can hear it (CLAUDE.md: feedback is asserted by
  // rendered text, never by state).
  const spoken = chosen ? `${titleOf(chosen)}, ${plural(chosen.degree || 0, 'link')}` : ''

  return (
    <div className={styles.wrap}>
      <div className={styles.legend}>
        <span><b>{graph.nodes.length}</b> {graph.nodes.length === 1 ? 'note' : 'notes'}</span>
        <span><b>{graph.edges.length}</b> {graph.edges.length === 1 ? 'link' : 'links'}</span>
        <span className={styles.orphan}><b>{orphans}</b> unlinked</span>
        {graph.truncated ? (
          <span className={styles.truncated}>
            showing the {graph.nodes.length} most recently edited — older notes are not drawn
          </span>
        ) : null}
        <button
          type="button"
          className={styles.viewToggle}
          aria-pressed={view === 'list'}
          onClick={toggleView}
        >
          Show as list
        </button>
      </div>
      {view === 'list' ? (
        <div className={styles.listWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Notes in the graph, by title</caption>
            <thead>
              <tr>
                <th scope="col">Note</th>
                <th scope="col" className={styles.num}>Links</th>
                <th scope="col">Linked notes</th>
              </tr>
            </thead>
            <tbody>
              {sortedNodes.map((n) => {
                const linked = neighbours.get(n.id) || []
                return (
                  <tr key={n.id}>
                    <th scope="row">
                      <button type="button" className={styles.noteBtn} onClick={() => onOpenNote?.(n.id)}>
                        {titleOf(n)}
                      </button>
                    </th>
                    <td className={styles.num}>{n.degree || 0}</td>
                    <td>
                      {linked.length ? (
                        <ul className={styles.linked}>
                          {linked.map((m) => (
                            <li key={m.id}>
                              <button type="button" className={styles.linkBtn} onClick={() => onOpenNote?.(m.id)}>
                                {titleOf(m)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className={styles.none}>None</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.canvasWrap}>
          <canvas
            ref={attachCanvas}
            className={styles.canvas}
            style={{ width: size.w, height: size.h }}
            role="application"
            tabIndex={0}
            aria-label={`Note graph: ${plural(graph.nodes.length, 'note')}, ${plural(graph.edges.length, 'link')}`}
            aria-describedby={keysId}
            onKeyDown={onCanvasKeyDown}
            onMouseMove={(ev) => { const n = pick(ev); setHover(n ? n.id : null) }}
            onMouseLeave={() => setHover(null)}
            onClick={(ev) => { const n = pick(ev); if (n && onOpenNote) onOpenNote(n.id) }}
          />
          <p id={keysId} className="sr-only">
            Arrow keys move to the nearest note in that direction. Home and End go to
            the first and last note by title. Enter opens the selected note. Escape
            clears the selection. Show as list gives the same notes as a table.
          </p>
          <div className="sr-only" aria-live="polite" aria-atomic="true" data-graph-live="">
            {spoken}
          </div>
        </div>
      )}
    </div>
  )
}
