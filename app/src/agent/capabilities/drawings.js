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
//   ⭐ Charts operator P1 (2026-10-27), all updateDrawing / removeDrawing by id:
//   drawing.setVisible / drawing.lock      one drawing's eye / lock (the drawing menu's own keys)
//   drawing.setLevel                       a horizontal line's (or ray's) price — what dragging it writes
//   drawing.setAllVisible                  every drawing on the symbol shown / hidden (nothing deleted)
//   drawing.clear                          every drawing removed — BROAD and destructive, so always
//                                          proposed; locked and alert-bound drawings are kept (and said)
//
// ⛔ UNDO IS BY ID, NEVER the store's undo(): that history is shared with the member's own edits
// ("undo the last change to this symbol, whoever made it"), so it could revert THEIR work.
// ⛔ NOT OFFERED YET: tools anchored in TIME (trendlines, rectangles, Fibonacci, text…). The drawing
// layer now exports what they need (components/chart/drawingTools.js: POINT_COUNT, validateDrawing,
// drawingTimeFor) — the anchored tools themselves are the next phase.
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
// What an update may change on an existing drawing (each key is one the drawing's own controls write):
// its style, its eye (hidden), its lock, and — for a level — its anchor's price (points).
const STYLE_KEYS = ['color', 'labelColor', 'lineStyle', 'lineWidth', 'hidden', 'locked', 'points']
// Tools whose ONE anchor is a price (a horizontal line; a horizontal ray keeps its start time): "move the line to $X"
const LEVEL_TYPES = new Set(['horizontal', 'hray'])
// Clearing more than this many drawings at once is refused (clear them on the chart).
const CLEAR_MAX = 60

// ⭐ Charts operator P1: the drawing the Agent last drew or changed ("make it red", "move it to 190") — per
// tab, re-checked against the live store (an id that is gone names nothing). The context marks it `recent`.
let lastTouched = null
export const lastTouchedDrawing = () => lastTouched
export function _resetDrawingMemory() { lastTouched = null }

/** The drawing as the Agent names it: its id, what it is, where. */
const nameOf = (d) => `${objectTypeName(d.type)}${objectSummary(d) ? ` ${objectSummary(d)}` : ''}`

export const drawingKind = {
  name: 'drawing',
  // Drawings are keyed by SYMBOL (and Drawing Board), not by the open layout: a layout switch
  // does not change what a drawing id means, so it neither pins a proposal nor blocks an Undo.
  boardScoped: false,
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
    // the ONE drawing this change drew or changed is the one "it" means next (never after a bulk change)
    const touched = [...patch.added.map(x => x.id), ...(patch.update || []).map(u => u.id)]
    lastTouched = touched.length === 1 && !(patch.remove || []).length ? { sym: ref, id: touched[0] } : (touched.length || (patch.remove || []).length ? null : lastTouched)
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
  fingerprint: (snap) => JSON.stringify([snap.board ?? null, snap.drawings]),
  // UNDO'S STALENESS IS SCOPED TO THE DRAWINGS THIS CHANGE TOUCHED: a line the member drew
  // afterwards is not "a newer edit to what I changed" (Undo works by id and leaves it alone), but
  // moving or restyling the Agent's own line is — then Undo refuses rather than overwrite it.
  fingerprintFor(host, snap, item) {
    const p = item?.patch
    if (!p || !snap) return snap ? JSON.stringify([snap.board ?? null, snap.drawings]) : null
    const by = new Map(snap.drawings.map(d => [d.id, d]))
    const ids = [...(p.added || []).map(x => x.id), ...(p.update || []).map(u => u.id), ...(p.remove || []).map(x => x.id)]
    // …and the ACTIVE BOARD: after a board switch the ids name nothing here, and an Undo would
    // "succeed" while the drawing stayed on the other board.
    return JSON.stringify([snap.board ?? null, ids.map(id => by.get(id) || null)])
  },
}

const drawingArg = { type: 'string' }
const byId = (st, id) => st.drawings.find(d => d.id === String(id)) || null
// The key a drawing's own colour setting writes (ChartDrawingOverlay's style panel): a Price Move's is its label's.
const colorKeyOf = (d) => (d && d.type === 'advance' ? 'labelColor' : 'color')
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
          // the drawing UCT Agent last drew or changed — "it" / "that line" in a follow-up
          ...(lastTouched && lastTouched.sym === s.ref && lastTouched.id === d.id ? { recent: true } : {}),
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
    hints: 'target = the drawings entry; drawing = its id from that entry\'s drawings (the most recent one the member drew is last; the one marked recent is the one I last drew or changed); color / style / width null = leave as is. "Make that line pink and dashed" / "make it red" = the recent one (else the line just drawn).',
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
      // ⛔ F15: a Price Move ("advance") paints its label with `labelColor` — the key its own settings write
      if (color != null) set[colorKeyOf(byId(st, drawing))] = normalizeColor(color)
      if (style != null) set.lineStyle = style
      if (width != null) set.lineWidth = width
      return { ...st, drawings: st.drawings.map(d => (d.id === String(drawing) ? { ...d, ...set } : d)) }
    },
    describe(b, a, { drawing }) {
      const o = byId(b, drawing), n = byId(a, drawing)
      if (!o || !n || same(o, n)) return null
      const what = []
      const ck = colorKeyOf(o)
      if (o[ck] !== n[ck]) what.push(`colour ${n[ck]}`)
      if ((o.lineStyle || 'solid') !== (n.lineStyle || 'solid')) what.push(n.lineStyle)
      if ((o.lineWidth || 1) !== (n.lineWidth || 1)) what.push(`${n.lineWidth}px`)
      return `Restyled the ${nameOf(o)} on ${a.symbol}: ${what.join(', ')}`
    },
    noop: () => 'That drawing already looks like that',
  })

  // Which drawings carry an alert — the server's own list, read fresh for every op that could touch one.
  const prepareBound = async () => {
    try {
      const rows = await loadAlerts({ force: true })
      return { boundDrawingIds: new Set(rows.filter(r => r.drawingId).map(r => String(r.drawingId))) }
    } catch { return { boundDrawingIds: null } }
  }

  registerCapability({
    ...common,
    name: 'drawing.remove',
    // ⭐ OWNER 2026-10-27 (Charts operator P1): approval is for BROAD destructive drawing operations
    // (drawing.clear), not every single removal. One visible drawing is removed at once, with Undo; a
    // HIDDEN one is still shown first (the member cannot see what would go).
    summary: 'Remove ONE drawing by id from a chart\'s symbol (every chart and layout showing it). Refused for a locked drawing and for one an alert is attached to. A hidden drawing is shown as a proposal first. Undo puts it back.',
    hints: 'target = the drawings entry; drawing = its id. "Remove the line I just added" = the newest one (or the one marked recent). To remove EVERY drawing use drawing.clear.',
    args: { type: 'object', properties: { drawing: drawingArg }, required: ['drawing'], additionalProperties: false },
    prepare: prepareBound,
    confirmIf: (st, { drawing }) => !!byId(st, drawing)?.hidden,
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
      return o && !byId(a, drawing) ? `Removed the ${nameOf(o)}${o.hidden ? ' (hidden)' : ''} from ${a.symbol} — on every chart and layout showing ${a.symbol}` : null
    },
  })

  // ── Charts operator P1: visibility, lock, a level's price, bulk show/hide, clear ──
  const setOn = (st, id, set) => ({ ...st, drawings: st.drawings.map(d => (d.id === String(id) ? { ...d, ...set } : d)) })

  registerCapability({
    ...common,
    name: 'drawing.setVisible',
    summary: 'Show or hide ONE drawing (its eye in the drawing\'s menu) on a chart\'s symbol — every chart on that symbol. Nothing is deleted. Undo puts it back.',
    hints: 'target = the drawings entry; drawing = its id; visible = true to show, false to hide. For EVERY drawing on the symbol use drawing.setAllVisible.',
    args: { type: 'object', properties: { drawing: drawingArg, visible: { type: 'boolean' } }, required: ['drawing', 'visible'], additionalProperties: false },
    check(st, { drawing }) { return byId(st, drawing) ? null : notFound(drawing) },
    apply(st, { drawing, visible }) {
      const d = byId(st, drawing)
      return !!d.hidden === !visible ? st : setOn(st, drawing, { hidden: !visible })
    },
    describe(b, a, { drawing }) {
      const o = byId(b, drawing), n = byId(a, drawing)
      if (!o || !n || !!o.hidden === !!n.hidden) return null
      return `${n.hidden ? 'Hid' : 'Showed'} the ${nameOf(o)} on ${a.symbol}`
    },
    noop: (b, a, { visible } = {}) => (visible ? 'That drawing is already showing' : 'That drawing is already hidden'),
  })

  registerCapability({
    ...common,
    name: 'drawing.lock',
    summary: 'Lock or unlock ONE drawing (its lock in the drawing\'s menu): a locked drawing can\'t be moved, restyled or removed until it is unlocked. Undo puts it back.',
    hints: 'target = the drawings entry; drawing = its id; locked = true to lock, false to unlock.',
    args: { type: 'object', properties: { drawing: drawingArg, locked: { type: 'boolean' } }, required: ['drawing', 'locked'], additionalProperties: false },
    check(st, { drawing }) { return byId(st, drawing) ? null : notFound(drawing) },
    apply(st, { drawing, locked }) {
      const d = byId(st, drawing)
      return !!d.locked === locked ? st : setOn(st, drawing, { locked })
    },
    describe(b, a, { drawing }) {
      const o = byId(b, drawing), n = byId(a, drawing)
      if (!o || !n || !!o.locked === !!n.locked) return null
      return `${n.locked ? 'Locked' : 'Unlocked'} the ${nameOf(o)} on ${a.symbol}`
    },
    noop: (b, a, { locked } = {}) => (locked ? 'That drawing is already locked' : 'That drawing is already unlocked'),
  })

  registerCapability({
    ...common,
    name: 'drawing.setLevel',
    summary: 'Move a HORIZONTAL line (or a horizontal ray) to a new price — what dragging it does. Refused for a locked drawing. A line an alert is attached to is shown first (its alert moves with it). Undo puts it back.',
    hints: 'target = the drawings entry; drawing = the horizontal line\'s id (the one marked recent for "move it"); price = the new level as the member said it — never invented.',
    args: { type: 'object', properties: { drawing: drawingArg, price: { type: 'number' } }, required: ['drawing', 'price'], additionalProperties: false },
    prepare: prepareBound,
    confirmIf: (st, { drawing }, env) => !!boundIds(env)?.has(String(drawing)),
    check(st, { drawing, price }, env) {
      const d = byId(st, drawing)
      if (!d) return notFound(drawing)
      if (!LEVEL_TYPES.has(d.type)) return `That ${objectTypeName(d.type)} isn't a horizontal level — only horizontal lines and rays can be moved to a price.`
      if (d.locked) return `That ${objectTypeName(d.type)} is locked — unlock it first.`
      if (!Number.isFinite(price) || price <= 0) return 'Say the new price (a positive number).'
      if (!boundIds(env)) return 'I couldn\'t check whether an alert is attached to that line, so I left it alone.'
      return null
    },
    apply(st, { drawing, price }) {
      const d = byId(st, drawing)
      const p0 = d.points?.[0] || {}
      if (p0.price === price) return st
      return setOn(st, drawing, { points: [{ ...p0, price }, ...(d.points || []).slice(1)] })
    },
    describe(b, a, { drawing }, env) {
      const o = byId(b, drawing), n = byId(a, drawing)
      if (!o || !n || o.points?.[0]?.price === n.points?.[0]?.price) return null
      const alert = boundIds(env)?.has(String(drawing)) ? ' (its alert moves with it)' : ''
      return `Moved the ${objectTypeName(o.type)} on ${a.symbol} from ${money(o.points[0].price)} to ${money(n.points[0].price)}${alert}`
    },
    noop: () => 'That line is already at that price',
  })

  registerCapability({
    ...common,
    name: 'drawing.setAllVisible',
    summary: 'Show or hide EVERY drawing on a chart\'s symbol at once (every chart on that symbol). Nothing is deleted. Undo puts each one back as it was.',
    hints: 'target = the drawings entry; visible = true to show them all, false to hide them all.',
    args: { type: 'object', properties: { visible: { type: 'boolean' } }, required: ['visible'], additionalProperties: false },
    check: (st) => (st.drawings.length ? null : `There are no drawings on ${st.symbol}.`),
    apply(st, { visible }) {
      if (st.drawings.every(d => !!d.hidden === !visible)) return st
      return { ...st, drawings: st.drawings.map(d => (!!d.hidden === !visible ? d : { ...d, hidden: !visible })) }
    },
    describe(b, a, { visible }) {
      const n = a.drawings.filter((d, i) => !!d.hidden !== !!b.drawings[i]?.hidden).length
      return n ? `${visible ? 'Showed' : 'Hid'} ${n} drawing${n === 1 ? '' : 's'} on ${a.symbol}` : null
    },
    noop: (b, a, { visible } = {}) => (visible ? `Every drawing on ${a.symbol} is already showing` : `Every drawing on ${a.symbol} is already hidden`),
  })

  registerCapability({
    ...common,
    name: 'drawing.clear',
    // ⭐ OWNER 2026-10-27: a BROAD destructive drawing operation — always shown first
    risk: 'confirm',
    summary: 'Remove EVERY drawing on a chart\'s symbol (every chart and layout showing it) — always shown as a proposal first. Locked drawings and drawings with an alert attached are kept (and said). Undo puts them all back.',
    hints: 'target = the drawings entry for the chart\'s symbol.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    prepare: prepareBound,
    check(st, _a, env) {
      if (!st.drawings.length) return `There are no drawings on ${st.symbol}.`
      const bound = boundIds(env)
      if (!bound) return 'I couldn\'t check which drawings have alerts attached, so I left them all alone.'
      const go = st.drawings.filter(d => !d.locked && !bound.has(d.id))
      if (!go.length) return `Every drawing on ${st.symbol} is locked or has an alert attached — nothing to clear.`
      if (go.length > CLEAR_MAX) return `${st.symbol} has ${go.length} drawings — more than I clear at once (${CLEAR_MAX}). Clear them on the chart.`
      return null
    },
    apply(st, _a, env) {
      const bound = boundIds(env) || new Set()
      return { ...st, drawings: st.drawings.filter(d => d.locked || bound.has(d.id)) }
    },
    describe(b, a) {
      const gone = b.drawings.length - a.drawings.length
      if (!gone) return null
      const kept = a.drawings.length ? ` · kept ${a.drawings.length} (locked or with an alert attached)` : ''
      return `Removed ${gone} drawing${gone === 1 ? '' : 's'} from ${a.symbol} — on every chart and layout showing ${a.symbol}${kept}`
    },
  })
}
