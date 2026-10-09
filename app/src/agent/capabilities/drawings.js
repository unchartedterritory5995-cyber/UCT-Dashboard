// ── DRAWING capabilities (Batch 8, narrow): horizontal levels by price, restyle, remove, list ─
//
// Through the product's own drawing store (components/chart/drawingsStore.js — the array every
// overlay on that symbol paints, persisted and synced exactly as a manual edit is), never a second
// store or renderer:
//   drawing.addLevel  the price-axis context menu's own "Draw horizontal line at $X" item
//                     (StockChart: {type:'horizontal', points:[{price}], color: drawingDefaults.color
//                     || UCT_DRAW_GOLD, lineWidth: drawingDefaults.width || 1}) — a level needs no
//                     time anchor, so no display-time conversion is involved.
//   drawing.style     updateDrawing(sym, id, {color|lineStyle|lineWidth}) on ONE drawing, by id.
//   drawing.remove    removeDrawing(sym, id) on ONE drawing, by id — refused for a locked drawing
//                     and for one an alert is bound to (deleting it would delete the alert).
//   drawing.list      what is drawn on the chart's symbol (read).
//
// ⛔ UNDO IS BY ID, NEVER the store's undo(): that history is shared with the member's own edits
// ("undo the last change to this symbol, whoever made it"), so it could revert THEIR work.
// ⛔ NOT OFFERED (PRODUCT-HANDOFFS §11): tools anchored in TIME (trendlines, rectangles, Fibonacci,
// text…) — points are stored in the chart's display-time format with no exported validator,
// point-count table or real→display helper; and "clear all" — it wipes every chart on the symbol
// and every alert bound to its lines.
// Drawings are keyed by SYMBOL (every chart on NVDA shares one array) — receipts say so.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { objectTypeName, objectSummary } from '../../components/chart/drawingObjects'
import { UCT_DRAW_GOLD } from '../../components/chart/drawingColors'
import { LINE_DASH } from '../../components/chart/drawingStyle'
import { normalizeColor } from './chart'
import { loadAlerts } from './alert'

const STYLES = Object.keys(LINE_DASH)            // solid, dashed, dotted
const WIDTHS = [1, 2, 3, 4]
const TEMP = 'new:'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
const STYLE_KEYS = ['color', 'lineStyle', 'lineWidth']

/** The drawing as the Agent names it: its id, what it is, where. */
const nameOf = (d) => `${objectTypeName(d.type)}${objectSummary(d) ? ` ${objectSummary(d)}` : ''}`

export const drawingKind = {
  name: 'drawing',
  // host.drawings: one entry per SYMBOL shown on a chart (agent/host.js buildDrawingSource)
  list: (host) => host?.drawings?.list() || [],
  read: (host, ref) => host?.drawings?.read(ref) || null,
  stateOf: (snap) => ({ drawings: snap.drawings, defaults: snap.defaults, symbol: snap.symbol, n: 0 }),
  patch(before, after) {
    const b = new Map(before.drawings.map(d => [d.id, d]))
    const a = new Map(after.drawings.map(d => [d.id, d]))
    const add = after.drawings.filter(d => !b.has(d.id))
    const remove = before.drawings.filter(d => !a.has(d.id))
    const update = []
    for (const d of after.drawings) {
      const o = b.get(d.id)
      if (!o || same(o, d)) continue
      const set = {}, prev = {}
      for (const k of STYLE_KEYS) if (!same(o[k], d[k])) { set[k] = d[k]; prev[k] = o[k] }
      if (Object.keys(set).length) update.push({ id: d.id, set, prev })
    }
    return add.length || remove.length || update.length ? { add, remove, update } : null
  },
  // Removes, then restyles, then adds — each through the store's own writer for this symbol. The
  // store mints the id of an added drawing; it is recorded on the patch (`added`) so the read-back
  // and the Undo address the REAL drawing.
  commit(host, ref, patch) {
    const d = host?.drawings
    if (!d) return false
    for (const x of patch.remove || []) d.remove(ref, x.id)
    for (const u of patch.update || []) d.update(ref, u.id, u.set)
    patch.added = []
    for (const x of patch.add || []) {
      const { id: temp, ...body } = x
      patch.added.push({ temp, id: d.add(ref, body), body })
    }
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    const byId = new Map(snap.drawings.map(d => [d.id, d]))
    for (const x of patch.remove || []) if (byId.has(x.id)) return false
    for (const u of patch.update || []) {
      const d = byId.get(u.id)
      if (!d || Object.entries(u.set).some(([k, v]) => !same(d[k], v))) return false
    }
    for (const x of patch.added || []) {
      const d = byId.get(x.id)
      if (!d || d.type !== x.body.type || !same(d.points, x.body.points)) return false
    }
    return true
  },
  // Exactly the inverse, by id: drop what was added, put back what was removed (the store mints a
  // new id for it — same type, points and style), restyle back.
  undoPatch(item) {
    const p = item.patch
    if (!p || (p.add?.length && !p.added)) return null
    return {
      add: (p.remove || []).map(x => ({ ...x, id: `${TEMP}undo:${x.id}` })),
      remove: (p.added || []).map(x => ({ id: x.id })),
      update: (p.update || []).map(u => ({ id: u.id, set: u.prev, prev: u.set })),
    }
  },
  fingerprint: (snap) => JSON.stringify(snap.drawings),
  // UNDO'S STALENESS IS SCOPED TO THE DRAWINGS THIS CHANGE TOUCHED: a line the member drew
  // afterwards is not "a newer edit to what I changed" (Undo works by id and leaves it alone), but
  // moving or restyling the Agent's own line is — then Undo refuses rather than overwrite it.
  fingerprintFor(host, snap, item) {
    const p = item?.patch
    if (!p || !snap) return snap ? JSON.stringify(snap.drawings) : null
    const by = new Map(snap.drawings.map(d => [d.id, d]))
    const ids = [...(p.added || []).map(x => x.id), ...(p.update || []).map(u => u.id), ...(p.remove || []).map(x => x.id)]
    return JSON.stringify(ids.map(id => by.get(id) || null))
  },
}

const drawingArg = { type: 'string' }
const byId = (st, id) => st.drawings.find(d => d.id === String(id)) || null
const notFound = (id) => `There's no drawing “${id}” on this chart — use an id from the drawings entry.`
const boundIds = (env) => env?.boundDrawingIds instanceof Set ? env.boundDrawingIds : null

let registered = false
export function registerDrawingCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(drawingKind)
  // What the model is told: per symbol on a chart, which charts show it and its drawings by id
  // (newest last). Capped — a symbol with a long drawing history lists its newest 40.
  registerContextProvider({
    key: 'drawings',
    build: (host, refFor) => {
      const list = drawingKind.list(host)
      return list.length ? list.map(s => ({
        ref: refFor('drawing', s.ref), symbol: s.symbol, shownOn: s.charts,
        drawings: s.drawings.slice(-40).map(d => ({
          id: d.id, what: nameOf(d), color: d.color || null, style: d.lineStyle || 'solid', width: d.lineWidth || 1,
          ...(d.locked ? { locked: true } : {}), ...(d.hidden ? { hidden: true } : {}),
        })),
      })) : undefined
    },
    // over the context budget: the newest 10 per symbol, and say how many were left out
    compact: (sec) => (sec || []).map(e => (e.drawings.length > 10
      ? { ...e, drawings: e.drawings.slice(-10), omitted: `${e.drawings.length - 10} older drawings not listed` } : e)),
  })
  const common = { target: 'drawing', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' }

  registerCapability({
    ...common,
    name: 'drawing.list',
    query: true,
    summary: 'List the drawings on a chart\'s symbol (every chart on that symbol shares them): each one\'s id, tool, level and style. Read-only.',
    hints: 'target = the drawings entry for the chart\'s symbol.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    answer: (snap) => {
      if (!snap) return 'That chart is not available.'
      const live = snap.drawings
      if (!live.length) return `There are no drawings on ${snap.symbol}.`
      return {
        text: `${live.length} drawing${live.length === 1 ? '' : 's'} on ${snap.symbol} (every chart on ${snap.symbol} shows the same ones).`,
        table: {
          columns: [{ key: 'what', label: 'Drawing' }, { key: 'style', label: 'Style' }, { key: 'state', label: '' }],
          rows: live.map(d => ({ what: nameOf(d), style: `${d.color || '—'}, ${d.lineStyle || 'solid'}, ${d.lineWidth || 1}px`, state: [d.hidden && 'hidden', d.locked && 'locked'].filter(Boolean).join(', ') })),
        },
      }
    },
  })

  registerCapability({
    ...common,
    name: 'drawing.addLevel',
    summary: 'Draw a HORIZONTAL LINE at a price on a chart\'s symbol — the price axis\'s own "Draw horizontal line at $X". Every chart on that symbol shows it; Undo removes it. Only horizontal levels: trendlines, rectangles, Fibonacci and text are not available.',
    hints: 'target = the drawings entry for the chart\'s symbol; price = the level (a number, as the member said it — never invented); color = a colour name or #hex, null = the member\'s drawing default; style = solid | dashed | dotted, null = solid. One op per level. '
      + 'A level the member describes without a number ("the recent high", "support") has no price — clarify, never guess.',
    args: { type: 'object', properties: {
      price: { type: 'number' }, color: { type: ['string', 'null'] }, style: { type: ['string', 'null'], enum: [...STYLES, null] },
    }, required: ['price', 'color', 'style'], additionalProperties: false },
    check(st, { price, color, style }) {
      if (!Number.isFinite(price) || price <= 0) return 'Say the price for the line (a positive number).'
      if (color != null && !normalizeColor(color)) return `“${color}” isn't a colour I know — use a name like blue or a #hex.`
      if (style != null && !STYLES.includes(style)) return `Line styles are ${STYLES.join(', ')}.`
      if (st.drawings.some(d => d.type === 'horizontal' && !d.hidden && d.points?.[0]?.price === price)) return `There is already a horizontal line at ${money(price)} on ${st.symbol}.`
      return null
    },
    apply(st, { price, color, style }) {
      const d = {
        id: `${TEMP}${st.n + 1}`,
        type: 'horizontal',
        points: [{ price }],
        color: color != null ? normalizeColor(color) : (st.defaults?.color || UCT_DRAW_GOLD),
        lineWidth: st.defaults?.width || 1,
        ...(style && style !== 'solid' ? { lineStyle: style } : {}),
      }
      return { ...st, n: st.n + 1, drawings: [...st.drawings, d] }
    },
    describe(b, a) {
      const added = a.drawings.filter(d => !b.drawings.some(o => o.id === d.id))
      if (!added.length) return null
      return added.map(d => `Drew a horizontal line at ${money(d.points[0].price)} on ${a.symbol}${d.lineStyle ? ` (${d.lineStyle})` : ''}`).join(' · ')
    },
  })

  registerCapability({
    ...common,
    name: 'drawing.style',
    summary: 'Change ONE drawing\'s colour, line style or width (what its settings do). Undo puts the old style back.',
    hints: 'target = the drawings entry; drawing = its id from that entry\'s drawings (the most recent one the member drew is last); color / style / width null = leave as is. "Make that line pink and dashed" = the line just drawn.',
    args: { type: 'object', properties: {
      drawing: drawingArg, color: { type: ['string', 'null'] }, style: { type: ['string', 'null'], enum: [...STYLES, null] }, width: { type: ['integer', 'null'], enum: [...WIDTHS, null] },
    }, required: ['drawing', 'color', 'style', 'width'], additionalProperties: false },
    check(st, { drawing, color, style, width }) {
      const d = byId(st, drawing)
      if (!d) return notFound(drawing)
      if (d.locked) return `That ${objectTypeName(d.type)} is locked — unlock it on the chart first.`
      if (color == null && style == null && width == null) return 'Say what to change: colour, line style or width.'
      if (color != null && !normalizeColor(color)) return `“${color}” isn't a colour I know — use a name like blue or a #hex.`
      if (style != null && !STYLES.includes(style)) return `Line styles are ${STYLES.join(', ')}.`
      if (width != null && !WIDTHS.includes(width)) return `Line widths are ${WIDTHS.join(', ')}.`
      return null
    },
    apply(st, { drawing, color, style, width }) {
      const set = {}
      if (color != null) set.color = normalizeColor(color)
      if (style != null) set.lineStyle = style
      if (width != null) set.lineWidth = width
      return { ...st, drawings: st.drawings.map(d => (d.id === String(drawing) ? { ...d, ...set } : d)) }
    },
    describe(b, a, { drawing }) {
      const o = byId(b, drawing), n = byId(a, drawing)
      if (!o || !n || same(o, n)) return null
      const what = []
      if (o.color !== n.color) what.push(`colour ${n.color}`)
      if ((o.lineStyle || 'solid') !== (n.lineStyle || 'solid')) what.push(n.lineStyle)
      if ((o.lineWidth || 1) !== (n.lineWidth || 1)) what.push(`${n.lineWidth}px`)
      return `Restyled the ${nameOf(o)} on ${a.symbol}: ${what.join(', ')}`
    },
    noop: () => 'That drawing already looks like that',
  })

  registerCapability({
    ...common,
    name: 'drawing.remove',
    summary: 'Remove ONE drawing by id from a chart\'s symbol (every chart on it). Refused for a locked drawing and for one an alert is attached to. Undo puts it back.',
    hints: 'target = the drawings entry; drawing = its id. "Remove the line I just added" = the newest one. Clearing ALL drawings is not available.',
    args: { type: 'object', properties: { drawing: drawingArg }, required: ['drawing'], additionalProperties: false },
    // Which drawings carry an alert — the server's own list, read fresh for every removal.
    async prepare() {
      try {
        const rows = await loadAlerts({ force: true })
        return { boundDrawingIds: new Set(rows.filter(r => r.drawingId).map(r => String(r.drawingId))) }
      } catch { return { boundDrawingIds: null } }
    },
    check(st, { drawing }, env) {
      const d = byId(st, drawing)
      if (!d) return notFound(drawing)
      if (d.locked) return `That ${objectTypeName(d.type)} is locked — unlock it on the chart first.`
      const bound = boundIds(env)
      if (!bound) return 'I couldn\'t check whether an alert is attached to that drawing, so I left it alone.'
      if (bound.has(d.id)) return `An alert is attached to that ${objectTypeName(d.type)} — removing it would delete the alert too. Remove it on the chart if that's what you want.`
      return null
    },
    apply: (st, { drawing }) => ({ ...st, drawings: st.drawings.filter(d => d.id !== String(drawing)) }),
    describe(b, a, { drawing }) {
      const o = byId(b, drawing)
      return o && !byId(a, drawing) ? `Removed the ${nameOf(o)} from ${a.symbol}` : null
    },
  })
}
