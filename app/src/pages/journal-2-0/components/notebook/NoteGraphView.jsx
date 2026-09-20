import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import styles from './NoteGraphView.module.css'

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
 * ⛔ HOVERING MUST NOT RE-RUN THE SIMULATION. The layout effect deliberately does
 * NOT depend on the hovered id: a fresh run re-seeds every node back onto the
 * start ring, so a mouse move would visibly scatter the graph the member is
 * reading. Hover writes a ref and asks for ONE redraw of the settled positions.
 *
 * ⛔ ISOLATED NOTES ARE THE POINT. The endpoint returns every note, linked or not,
 * and this draws them. A member's orphaned notes are the most useful thing a graph
 * view can show them; filtering to "notes with edges" would hide exactly what they
 * came to find.
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

/** "1 note", not "1 notes" — this reaches the legend AND the canvas aria-label,
 *  so a screen reader reads the count out loud. */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Radius from degree — sqrt so a hub with 40 links is not 10x a node with 4. */
const radiusFor = (degree) => Math.min(MAX_R, MIN_R + Math.sqrt(degree || 0) * 2.4)

export default function NoteGraphView({ onOpenNote }) {
  const { data, isLoading } = useSWR('/api/j2/notes/graph', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  })
  const canvasRef = useRef(null)
  const roRef = useRef(null)
  const simRef = useRef({ nodes: [], edges: [] })
  const drawRef = useRef(null)
  const hoverRef = useRef(null)
  const rafRef = useRef(0)
  const [hover, setHover] = useState(null)
  const [size, setSize] = useState({ w: 820, h: 560 })

  const graph = useMemo(() => ({
    nodes: data?.nodes || [],
    edges: data?.edges || [],
    truncated: Boolean(data?.truncated),
  }), [data])

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
    if (!node || typeof ResizeObserver === 'undefined') return
    const el = node.parentElement
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0) {
        setSize({ w: Math.floor(r.width), h: Math.max(360, Math.floor(r.height)) })
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [])

  // ── lay out, draw, stop ───────────────────────────────────────────────────
  // ⛔ `hover` is NOT a dependency. See the header note.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !graph.nodes.length) return undefined
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
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges = graph.edges
      .map((e) => ({ s: byId.get(e.source), t: byId.get(e.target) }))
      .filter((e) => e.s && e.t)
    simRef.current = { nodes, edges }

    const step = () => {
      // ⛔ O(n^2) repulsion is fine to ~1500 nodes, which is the endpoint's own
      // default cap. Past that this needs a quadtree — stated so the next person
      // raising the cap knows what they are buying.
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
        n.x += n.vx
        n.y += n.vy
        n.x = Math.max(n.r + 2, Math.min(size.w - n.r - 2, n.x))
        n.y = Math.max(n.r + 2, Math.min(size.h - n.r - 2, n.y))
      }
    }

    const draw = () => {
      const hovered = hoverRef.current
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
      for (const n of nodes) {
        const isHover = hovered === n.id
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
        // Label only hubs and the hovered node — every label at once is illegible.
        if (isHover || n.degree >= 3) {
          ctx.fillStyle = isHover ? '#f8fafc' : 'rgba(226,232,240,0.62)'
          ctx.font = (isHover ? '12px ' : '10px ') + "'Instrument Sans', system-ui, sans-serif"
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
  }, [graph, size])

  // Hover repaints the SETTLED positions. One frame, no simulation.
  useEffect(() => {
    hoverRef.current = hover
    if (drawRef.current) drawRef.current()
  }, [hover])

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

  if (isLoading) return <div className={styles.state}>Loading the graph…</div>
  if (!graph.nodes.length) {
    return (
      <div className={styles.state}>
        No notes yet. Link notes to each other with <code>@</code> and they will
        appear here.
      </div>
    )
  }

  const orphans = graph.nodes.filter((n) => !n.degree).length

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
      </div>
      <div className={styles.canvasWrap}>
        <canvas
          ref={attachCanvas}
          className={styles.canvas}
          style={{ width: size.w, height: size.h }}
          aria-label={`Note graph: ${plural(graph.nodes.length, 'note')}, ${plural(graph.edges.length, 'link')}`}
          onMouseMove={(ev) => { const n = pick(ev); setHover(n ? n.id : null) }}
          onMouseLeave={() => setHover(null)}
          onClick={(ev) => { const n = pick(ev); if (n && onOpenNote) onOpenNote(n.id) }}
        />
      </div>
    </div>
  )
}
