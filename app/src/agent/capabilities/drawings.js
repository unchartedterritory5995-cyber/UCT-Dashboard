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
// ⭐ W1-B (Wave 1, 2026-11-02) — tools anchored in TIME, through the SAME store writer and the drawing
// layer's own exports (components/chart/drawingTools.js: POINT_COUNT, validateDrawing, drawingTimeFor):
//   drawing.addTrendline / addRay / addRectangle / addFib   two anchors {date, price}
//   drawing.addHorizontalRay / addText / addAvwap           one anchor {date, price} (+ text)
//   A date is an ISO day or a member's date word (agent/dateWords.js: "last friday", "oct 15"); it is
//   converted to the chart's stored point shape for the symbol's chart TIMEFRAME (drawingTimeFor), every
//   point is checked by validateDrawing, and an anchor outside the history the chart has loaded (or in
//   the future) is refused — a drawing is never written where the chart could not place it.
// Drawings are keyed by SYMBOL (every chart on NVDA shares one array) — receipts say so.
// ⭐ Complete drawing control (2026-11-05): the rest of the family, generic and schema-driven, is capabilities/drawingFamily.js
// (drawing.add, drawing.setAnchors, drawing.setProps, drawing.setFibLevels, drawing.setAlert).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { objectTypeName, objectSummary } from '../../components/chart/drawingObjects'
import { UCT_DRAW_GOLD } from '../../components/chart/drawingColors'
import { LINE_DASH } from '../../components/chart/drawingStyle'
import { normalizeColor, colorName } from './chart'
// the drawing layer's own rule for what a tool's points must be (C-3): every point the Agent writes is checked by it
import { validateDrawing, drawingTimeFor } from '../../components/chart/drawingTools'
import { newDrawingProps } from '../../components/chart/drawingSettingsSchema'
import { PRICE } from '../../components/chart/drawingPanes'
import { resolveDateWord, isoDayMs, dayWord } from '../dateWords'
import { alertLibraryKind, loadAlerts } from './alert'
import { parseBoundId } from '../../components/chart/drawingAlertAnchors'
import { registerDrawingFamily, hasLineStyle, paneWhy, pointDay } from './drawingFamily'

const STYLES = Object.keys(LINE_DASH)            // solid, dashed, dotted
const WIDTHS = [1, 2, 3, 4]
const TEMP = 'new:'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
const fmtMs = (ms) => new Date(ms).toISOString().slice(0, 10)
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
/** A drawing's anchors as the model reads them, first to last: what drawing.setAnchors's `point` counts. A flat line's
 *  one price is in its name already. */
const anchorsOf = (d) => ((d.points || []).some(p => p?.time != null)
  ? d.points.map(p => [pointDay(p), p.price].filter(v => v != null).join(' at '))
  : null)

export const drawingKind = {
  name: 'drawing',
  // Drawings are keyed by SYMBOL (and Drawing Board), not by the open layout: a layout switch
  // does not change what a drawing id means, so it neither pins a proposal nor blocks an Undo.
  boardScoped: false,
  // host.drawings: one entry per SYMBOL shown on a chart (agent/host.js buildDrawingSource)
  list: (host) => host?.drawings?.list() || [],
  read: (host, ref) => host?.drawings?.read(ref) || null,
  stateOf: (snap) => ({ drawings: snap.drawings, defaults: snap.defaults, symbol: snap.symbol, tf: snap.tf || 'D', history: snap.history || null, n: 0, alerts: [] }),
  patch(before, after) {
    const b = new Map(before.drawings.map(d => [d.id, d]))
    const a = new Map(after.drawings.map(d => [d.id, d]))
    const add = after.drawings.filter(d => !b.has(d.id))
    const remove = before.drawings.filter(d => !a.has(d.id))
    const update = []
    for (const d of after.drawings) {
      const o = b.get(d.id)
      if (!o || same(o, d)) continue
      // every key that changed: a fixed list would drop a new menu setting while the receipt claimed it
      const set = {}, prev = {}
      for (const k of new Set([...Object.keys(o), ...Object.keys(d)])) if (!same(o[k], d[k])) { set[k] = d[k]; prev[k] = o[k] }
      if (Object.keys(set).length) update.push({ id: d.id, set, prev })
    }
    const alerts = after.alerts || []
    return add.length || remove.length || update.length || alerts.length ? { add, remove, update, ...(alerts.length ? { alerts } : {}) } : null
  },
  // Removes, then restyles, then adds — each through the store's own writer for this symbol. The
  // store mints the id of an added drawing; it is recorded on the patch (`added`) so the read-back
  // and the Undo address the REAL drawing. An alert on a drawing goes through the Alerts product's own write
  // (alertLibraryKind: POST / DELETE, re-read from the server), recorded on the patch the same way.
  async commit(host, ref, patch) {
    const d = host?.drawings
    if (!d) return false
    if (patch.deleteAlerts?.length) await alertLibraryKind.commit(host, 'alerts', { deleteCreated: patch.deleteAlerts })
    if (patch.alerts?.length) {
      try { patch.alertsCreated = Object.values((await alertLibraryKind.commit(host, 'alerts', { create: patch.alerts })).created) } catch (e) {
        patch.alertsCreated = Object.values(e?.created || {})
        throw e
      }
    }
    for (const x of patch.remove || []) d.remove(ref, x.id)
    for (const u of patch.update || []) d.update(ref, u.id, u.set)
    patch.added = []
    for (const x of patch.add || []) {
      const { id: temp, restore, ...body } = x
      patch.added.push({ temp, id: restore ? d.restore(ref, restore) : d.add(ref, body), body: restore || body })
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
    const book = alertLibraryKind.read(null, 'alerts')
    if (patch.alerts?.length && !alertLibraryKind.landed(book, { create: patch.alerts })) return false
    if (patch.deleteAlerts?.length && !alertLibraryKind.landed(book, { deleteCreated: patch.deleteAlerts })) return false
    return true
  },
  // Exactly the inverse, by id: drop what was added, put back what was removed (whole, under its OWN id, so an
  // earlier change to it can still be undone), restyle back.
  undoPatch(item) {
    const p = item.patch
    if (!p || (p.add?.length && !p.added)) return null
    const alerts = p.alertsCreated || []
    return {
      add: (p.remove || []).map(x => ({ id: `${TEMP}undo:${x.id}`, restore: x })),
      remove: (p.added || []).map(x => ({ id: x.id })),
      update: (p.update || []).map(u => ({ id: u.id, set: u.prev, prev: u.set })),
      ...(alerts.length ? { deleteAlerts: alerts } : {}),
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
        ref: refFor('drawing', s.ref), symbol: s.symbol, shownOn: s.charts, timeframe: s.tf || 'D',
        // the history the chart has loaded: a time anchor must fall inside it (W1-B anchored tools)
        ...(s.history ? { loadedHistory: `${fmtMs(s.history.firstMs)} to ${fmtMs(s.history.lastMs)}` } : {}),
        drawings: s.drawings.slice(-40).map(d => ({
          id: d.id, what: nameOf(d), color: d.color || null, style: d.lineStyle || 'solid', width: d.lineWidth || 1,
          ...(anchorsOf(d) ? { anchors: anchorsOf(d) } : {}),
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
  registerAnchoredDrawingCapabilities(common)

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
    summary: 'Draw a HORIZONTAL LINE at a price on a chart\'s symbol — the price axis\'s own "Draw horizontal line at $X". Every chart on that symbol shows it; Undo removes it. A level that starts on a date is drawing.addHorizontalRay; every other tool has its own capability or drawing.add.',
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
      if (!validateDrawing('horizontal', [{ price }]).ok) return 'Say the price for the line (a positive number).'
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
      // the drawing's own colour row says whether it has a line (a note has none): a receipt must not claim one
      if ((style != null || width != null) && !hasLineStyle(d.type)) return `That ${objectTypeName(d.type)} has no line to style — it takes a colour, and drawing.setProps has its text settings.`
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
      if (o[ck] !== n[ck]) what.push(`colour ${colorName(n[ck])}`)
      if ((o.lineStyle || 'solid') !== (n.lineStyle || 'solid')) what.push(n.lineStyle)
      if ((o.lineWidth || 1) !== (n.lineWidth || 1)) what.push(`${n.lineWidth}px`)
      return `Restyled the ${nameOf(o)} on ${a.symbol}: ${what.join(', ')}`
    },
    noop: () => 'That drawing already looks like that',
  })

  // Which drawings carry an alert — the server's own list, read fresh for every op that could touch one. A Fibonacci
  // level's alert is bound as `<drawing id>#<level>` (boundIdFor), and that IS an alert on the drawing.
  const prepareBound = async () => {
    try {
      const rows = (await loadAlerts({ force: true })).filter(r => r.drawingId)
      return { boundDrawingIds: new Set(rows.map(r => parseBoundId(r.drawingId).drawingId)), boundAlerts: rows }
    } catch { return { boundDrawingIds: null, boundAlerts: null } }
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
      if (paneWhy(d)) return paneWhy(d)      // a pane drawing is placed by paneY: writing `price` would move nothing
      if (!Number.isFinite(price) || price <= 0) return 'Say the new price (a positive number).'
      // the moved line must still be a drawing the overlay can draw (its time anchor, if any, is kept)
      const pts = [{ ...(d.points?.[0] || {}), price }, ...(d.points || []).slice(1)]
      if (d.type !== 'hray' && !validateDrawing(d.type, pts).ok) return `That ${objectTypeName(d.type)} can't be moved to that price.`
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

  registerDrawingFamily(common, {
    registerCapability, byId, notFound, boundIds, prepareBound, setOn, anchorFor, newDrawing, styleWhy, dupOf, addedBy, at, money, STYLE_ARGS, DATE_HINT,
    sameBound: (env, id, direction) => (env?.boundAlerts || []).some(a => a.active && a.drawingId === id && a.direction === direction),
  })
}

// ── W1-B: TIME-ANCHORED tools — the toolbar's own drawings, placed from dates instead of clicks ─────
//
// What the overlay writes when a member finishes placing a tool (ChartDrawingOverlay, the "finish"
// block): { type, points, color, lineWidth, lineStyle, pane: PRICE, ...newDrawingProps(type, byTool) }.
// The Agent writes the same keys. A point's `time` is what `drawingTimeFor(day, tf)` gives for the
// symbol's chart timeframe ('YYYY-MM-DD' on D/W/M, the 09:30 ET open as RAW unix seconds intraday, `tb: 'unix'`) — never a time
// the Agent computed itself. The chart's overlay places a daily anchor that is not a bar on the
// containing bar (its toPixel fallback), so a weekend date on a trendline still lands; the AVWAP
// renderer looks its anchor up by EXACT bar time, so its anchor must be a weekday (a market holiday
// cannot be known here — said in the receipt).
const DAY_MS = 86400000
const TEXT_MAX = 200
const ANCHOR_ARG = { type: 'object', properties: { date: { type: 'string' }, price: { type: 'number' } }, required: ['date', 'price'], additionalProperties: false }
const STYLE_ARGS = { color: { type: ['string', 'null'] }, style: { type: ['string', 'null'], enum: [...STYLES, null] } }
const TOOL_NAME = { trendline: 'trendline', ray: 'ray', hray: 'horizontal ray', rect: 'rectangle', fib: 'Fibonacci retracement', text: 'note', avwap: 'anchored VWAP' }
const DATE_HINT = 'a date is YYYY-MM-DD or the member\'s words (today, yesterday, last friday, oct 15, 10/15); price = the number the member said — never invented'

/** A member's anchor {date, price} → { time, price, day } for this symbol's timeframe, or a refusal sentence. */
function anchorFor(st, pt, { needsWeekday = false, priceOptional = false } = {}) {
  if (!pt || typeof pt !== 'object') return { why: 'Say the date and price for each point.' }
  const price = priceOptional && pt.price == null ? null : Number(pt.price)
  if (price !== null && (!Number.isFinite(price) || price <= 0)) return { why: `“${pt.price}” isn't a price — say a positive number.` }
  const r = resolveDateWord(pt.date)
  if (!r) return { why: `I couldn't read “${pt.date}” as a date — use YYYY-MM-DD or a day like “last Friday”.` }
  if (r.future) return { why: `${dayWord(r.to)} is in the future — a drawing can only be anchored on history the chart has.` }
  const ms = isoDayMs(r.to)
  if (st.history) {
    if (ms < st.history.firstMs) return { why: `${dayWord(r.to)} is before the history loaded on the chart (it starts ${dayWord(fmtMs(st.history.firstMs))}) — scroll the chart back to load it first.` }
    if (ms > st.history.lastMs + DAY_MS) return { why: `${dayWord(r.to)} is after the last bar on the chart (${dayWord(fmtMs(st.history.lastMs))}).` }
  }
  if (needsWeekday) {
    const w = new Date(ms).getUTCDay()
    if (w === 0 || w === 6) return { why: `${dayWord(r.to)} is a ${w === 0 ? 'Sunday' : 'Saturday'} — an anchored VWAP starts on a trading day.` }
  }
  const time = drawingTimeFor(r.to, st.tf)
  if (time == null) return { why: `I couldn't place ${dayWord(r.to)} on this chart's timeframe.` }
  return { time, price, day: r.to }
}
const anchorsFor = (st, pts, opts) => {
  const out = []
  for (const p of pts) { const a = anchorFor(st, p, opts); if (a.why) return a; out.push(a) }
  return { points: out }
}
const styleWhy = ({ color, style }) => (color != null && !normalizeColor(color) ? `“${color}” isn't a colour I know — use a name like blue or a #hex.`
  : style != null && !STYLES.includes(style) ? `Line styles are ${STYLES.join(', ')}.` : null)
/** The drawing exactly as the toolbar would store it for this symbol's chart. */
function newDrawing(st, type, points, { color, style, extra = {} }) {
  return {
    id: `${TEMP}${st.n + 1}`,
    type,
    points: points.map(a => ({ time: a.time, price: a.price })),
    // intraday points are raw unix (drawingTimeFor); the stamp says so (drawingTimeBase.js)
    ...(points.some(a => typeof a.time === 'number') ? { tb: 'unix' } : {}),
    color: color != null ? normalizeColor(color) : (st.defaults?.color || UCT_DRAW_GOLD),
    lineWidth: st.defaults?.width || 1,
    ...(style && style !== 'solid' ? { lineStyle: style } : {}),
    pane: PRICE,
    ...(newDrawingProps(type, st.defaults?.byTool || null) || {}),
    ...extra,
  }
}
const sameAnchors = (a, b) => JSON.stringify((a || []).map(p => [p.time, p.price])) === JSON.stringify((b || []).map(p => [p.time, p.price]))
const dupOf = (st, type, points) => st.drawings.find(d => d.type === type && !d.hidden && sameAnchors(d.points, points))
const at = (a) => `${money(a.price)} on ${dayWord(a.day)}`
const addedBy = (b, a) => a.drawings.filter(d => !b.drawings.some(o => o.id === d.id))

function registerAnchoredDrawingCapabilities(common) {
  // two-anchor tools: trendline, ray, rectangle, Fibonacci retracement
  const two = [
    ['drawing.addTrendline', 'trendline', 'Draw a TRENDLINE between two points (date + price each) on a chart\'s symbol — the toolbar\'s own trendline tool. Every chart on that symbol shows it; Undo removes it.',
      'from / to = {date, price}: the two anchors in time order ("from the Oct 15 low at 180 to last Friday at 195"). A point the member describes without a date AND a price ("the recent low") has no anchor — clarify, never guess.'],
    ['drawing.addRay', 'ray', 'Draw a RAY from one point (date + price) through a second, extended to the right — the toolbar\'s own ray tool. Every chart on that symbol shows it; Undo removes it.',
      'from = the start {date, price}; to = a second point it passes through {date, price}, after the first.'],
    ['drawing.addRectangle', 'rect', 'Draw a RECTANGLE between two opposite corners (date + price each) on a chart\'s symbol — the toolbar\'s own rectangle. Undo removes it.',
      'from / to = {date, price}: opposite corners ("a box from Oct 1 at 170 to Oct 20 at 185").'],
    ['drawing.addFib', 'fib', 'Draw a FIBONACCI RETRACEMENT between two points (date + price each) on a chart\'s symbol — the toolbar\'s own tool with its standard levels. Undo removes it.',
      'from = the swing start {date, price} (the low for an up move); to = the swing end {date, price}. "Fib from the Oct 7 low at 150 to the Oct 28 high at 190".'],
  ]
  for (const [name, type, summary, hint] of two) {
    registerCapability({
      ...common,
      name,
      summary,
      hints: `target = the drawings entry for the chart's symbol; ${hint} ${DATE_HINT}; color = a colour name or #hex, null = the member's drawing default; style = solid | dashed | dotted, null = solid.`,
      args: { type: 'object', properties: { from: ANCHOR_ARG, to: ANCHOR_ARG, ...STYLE_ARGS }, required: ['from', 'to', 'color', 'style'], additionalProperties: false },
      check(st, { from, to, color, style }) {
        const s = styleWhy({ color, style })
        if (s) return s
        const r = anchorsFor(st, [from, to])
        if (r.why) return r.why
        if (r.points[0].time === r.points[1].time && r.points[0].price === r.points[1].price) return 'The two points are the same — say two different points.'
        if (type !== 'rect' && isoDayMs(r.points[1].day) < isoDayMs(r.points[0].day)) return `The second point (${dayWord(r.points[1].day)}) is before the first (${dayWord(r.points[0].day)}) — give them in time order.`
        const v = validateDrawing(type, r.points.map(a => ({ time: a.time, price: a.price })), { tf: st.tf })
        if (!v.ok) return `That ${TOOL_NAME[type]} can't be drawn here (${v.reason}).`
        if (dupOf(st, type, r.points)) return `There is already a ${TOOL_NAME[type]} between those two points on ${st.symbol}.`
        return null
      },
      apply(st, { from, to, color, style }) {
        const r = anchorsFor(st, [from, to])
        const d = newDrawing(st, type, r.points, { color, style })
        return { ...st, n: st.n + 1, drawings: [...st.drawings, d] }
      },
      describe(b, a, { from, to }) {
        const added = addedBy(b, a)
        if (!added.length) return null
        const r = anchorsFor(b, [from, to])
        return `Drew a ${TOOL_NAME[type]} on ${a.symbol} from ${at(r.points[0])} to ${at(r.points[1])}${added[0].lineStyle ? ` (${added[0].lineStyle})` : ''} — on every chart showing ${a.symbol}`
      },
    })
  }

  registerCapability({
    ...common,
    name: 'drawing.addHorizontalRay',
    summary: 'Draw a HORIZONTAL RAY from a date at a price, extending to the right — the toolbar\'s own horizontal ray (a level that starts on a day, e.g. a breakout level from its breakout date). Undo removes it.',
    hints: `target = the drawings entry for the chart's symbol; date = where the ray starts; price = its level; ${DATE_HINT}; color / style as for other drawings (null = defaults). A level with no start date is drawing.addLevel.`,
    args: { type: 'object', properties: { date: { type: 'string' }, price: { type: 'number' }, ...STYLE_ARGS }, required: ['date', 'price', 'color', 'style'], additionalProperties: false },
    check(st, { date, price, color, style }) {
      const s = styleWhy({ color, style })
      if (s) return s
      const r = anchorsFor(st, [{ date, price }])
      if (r.why) return r.why
      const v = validateDrawing('hray', r.points.map(a => ({ time: a.time, price: a.price })), { tf: st.tf })
      if (!v.ok) return `That horizontal ray can't be drawn here (${v.reason}).`
      if (dupOf(st, 'hray', r.points)) return `There is already a horizontal ray from ${at(r.points[0])} on ${st.symbol}.`
      return null
    },
    apply(st, { date, price, color, style }) {
      const r = anchorsFor(st, [{ date, price }])
      return { ...st, n: st.n + 1, drawings: [...st.drawings, newDrawing(st, 'hray', r.points, { color, style })] }
    },
    describe(b, a, { date, price }) {
      const added = addedBy(b, a)
      if (!added.length) return null
      const r = anchorsFor(b, [{ date, price }])
      return `Drew a horizontal ray on ${a.symbol} from ${at(r.points[0])}, extending right${added[0].lineStyle ? ` (${added[0].lineStyle})` : ''} — on every chart showing ${a.symbol}`
    },
  })

  registerCapability({
    ...common,
    name: 'drawing.addText',
    summary: 'Place a TEXT NOTE on a chart\'s symbol at a date and price — the toolbar\'s own text tool, with the member\'s exact words. Undo removes it.',
    hints: `target = the drawings entry for the chart's symbol; text = the note exactly as the member said it (never reworded, up to ${TEXT_MAX} characters); date / price = where it sits; ${DATE_HINT}; color = a colour name or #hex, null = the member's default.`,
    args: { type: 'object', properties: { text: { type: 'string' }, date: { type: 'string' }, price: { type: 'number' }, color: { type: ['string', 'null'] } }, required: ['text', 'date', 'price', 'color'], additionalProperties: false },
    check(st, { text, date, price, color }) {
      const t = String(text || '').trim()
      if (!t) return 'Say what the note should say.'
      if (t.length > TEXT_MAX) return `That note is ${t.length} characters — keep it under ${TEXT_MAX}.`
      const s = styleWhy({ color, style: null })
      if (s) return s
      const r = anchorsFor(st, [{ date, price }])
      if (r.why) return r.why
      const v = validateDrawing('text', r.points.map(a => ({ time: a.time, price: a.price })), { tf: st.tf })
      if (!v.ok) return `That note can't be placed here (${v.reason}).`
      if (st.drawings.some(d => d.type === 'text' && !d.hidden && sameAnchors(d.points, r.points) && String(d.text || '').trim() === t)) return `That note is already on ${st.symbol} at that point.`
      return null
    },
    apply(st, { text, date, price, color }) {
      const r = anchorsFor(st, [{ date, price }])
      const d = newDrawing(st, 'text', r.points, { color, style: null, extra: { text: String(text).trim(), fontSize: st.defaults?.fontSize || 13, boxWidth: null } })
      return { ...st, n: st.n + 1, drawings: [...st.drawings, d] }
    },
    describe(b, a, { text, date, price }) {
      if (!addedBy(b, a).length) return null
      const r = anchorsFor(b, [{ date, price }])
      const t = String(text).trim()
      return `Added the note “${t.length > 40 ? `${t.slice(0, 40)}…` : t}” on ${a.symbol} at ${at(r.points[0])} — on every chart showing ${a.symbol}`
    },
  })

  registerCapability({
    ...common,
    name: 'drawing.addAvwap',
    summary: 'Draw an ANCHORED VWAP on a chart\'s symbol starting from a date — the toolbar\'s own anchored VWAP (volume-weighted average price from that session forward). Undo removes it.',
    hints: `target = the drawings entry for the chart's symbol; date = the anchor session (a trading day: an earnings day, a low, "last friday"); price = the price on that day the member named, or the price they are looking at there (the anchor's level — the VWAP itself is computed from the bars); ${DATE_HINT}; color null = the member's default.`,
    args: { type: 'object', properties: { date: { type: 'string' }, price: { type: 'number' }, color: { type: ['string', 'null'] } }, required: ['date', 'price', 'color'], additionalProperties: false },
    check(st, { date, price, color }) {
      const s = styleWhy({ color, style: null })
      if (s) return s
      const r = anchorsFor(st, [{ date, price }], { needsWeekday: true })
      if (r.why) return r.why
      const v = validateDrawing('avwap', r.points.map(a => ({ time: a.time, price: a.price })), { tf: st.tf })
      if (!v.ok) return `That anchored VWAP can't be drawn here (${v.reason}).`
      if (st.drawings.some(d => d.type === 'avwap' && !d.hidden && d.points?.[0]?.time === r.points[0].time)) return `There is already an anchored VWAP from ${dayWord(r.points[0].day)} on ${st.symbol}.`
      return null
    },
    apply(st, { date, price, color }) {
      const r = anchorsFor(st, [{ date, price }], { needsWeekday: true })
      return { ...st, n: st.n + 1, drawings: [...st.drawings, newDrawing(st, 'avwap', r.points, { color, style: null })] }
    },
    describe(b, a, { date, price }) {
      if (!addedBy(b, a).length) return null
      const r = anchorsFor(b, [{ date, price }], { needsWeekday: true })
      return `Drew an anchored VWAP on ${a.symbol} from ${dayWord(r.points[0].day)} forward (it draws from that session's bar; a market holiday would show nothing) — on every chart showing ${a.symbol}`
    },
  })
}
