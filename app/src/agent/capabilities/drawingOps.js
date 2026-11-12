// ── DRAWING MENU OPERATIONS: the two menu rows the family did not reach yet ──
//
// Both go through drawingKind (capabilities/drawings.js): the same store writer, read back by id, undone by id.
//   drawing.duplicate        the drawing menu's own Duplicate (ChartDrawingOverlay onDuplicate):
//                            addDrawing({ ...drawing without its id, points: offsetPoints(points), locked: false }).
//                            The copy sits a little below the original (offsetPoints: price −0.5%, or a pane drawing
//                            +0.03 down its pane) so it never lands exactly on top. Undo removes the copy only.
//   drawing.setPositionAlerts  a position drawing's "Alerts" row (FT-032): one bound `line` alert per level, Entry,
//                            Stop, Target or All three, bound as `<drawing>#<point index>` (boundIdFor), each going off
//                            on the side positionLevelDirection gives it — the menu's own rule. Stop and target are
//                            fixed by the position's side; the ENTRY's side comes from where price is now (the chart
//                            uses its last close; the Agent reads the current price, and refuses the entry when it
//                            cannot). Always shown first; Undo removes the alerts unless one already went off.
//
// ⛔ WHAT THE MENU DOES NOT OFFER, THE AGENT DOES NOT DO. A retired type (the 3-point position) has no Duplicate in its
// menu (drawingSettingsSchema RETIRED_ACTIONS: a clone would be a backdoor around the retirement), so it is refused here
// too — and a position's alerts exist only while its three points make a long or a short (positionSide).

import { controlIdsFor, isRetired } from '../../components/chart/drawingSettingsSchema'
import { offsetPoints } from '../../components/chart/drawingGeometry'
import { objectTypeName } from '../../components/chart/drawingObjects'
import { POSITION_LEVELS, anchorsForDrawing, boundIdFor, parseBoundId, positionLevelDirection, positionSide } from '../../components/chart/drawingAlertAnchors'
import { fromChartTime } from '../../components/chart/barTime'
import { quotesFor } from './alert'

const TEMP = 'new:'
const LEVEL_WORDS = Object.freeze({ entry: 0, stop: 1, target: 2 })
export const POSITION_LEVEL_NAMES = Object.freeze(Object.keys(LEVEL_WORDS))
const nameOf = (d) => objectTypeName(d.type).toLowerCase().replace('fibonacci', 'Fibonacci').replace('vwap', 'VWAP')

/** The drawing's menu offers this control (the same table DrawingContextMenu renders from). */
export const menuOffers = (type, id) => controlIdsFor(type).includes(id)

export function registerDrawingOps(common, { registerCapability, byId, notFound, boundIds, prepareBound, money, addedBy }) {
  registerCapability({
    ...common,
    name: 'drawing.duplicate',
    summary: 'Duplicate ONE drawing (its menu\'s Duplicate): an unlocked duplicate drawing just below the original on the same symbol — every chart on that symbol shows it. The duplicate is the drawing "it" means next. Undo removes the duplicate only.',
    hints: 'target = the drawings entry; drawing = its id (the one marked recent for "duplicate it"). Not offered for a hidden drawing (show it first) or a retired tool. To copy a drawing to a DIFFERENT symbol there is no capability — say so.',
    args: { type: 'object', properties: { drawing: { type: 'string' } }, required: ['drawing'], additionalProperties: false },
    check(st, { drawing }) {
      const d = byId(st, drawing)
      if (!d) return notFound(drawing)
      if (isRetired(d.type) || !menuOffers(d.type, 'duplicate')) return `That ${nameOf(d)} can't be duplicated — its menu has no Duplicate.`
      // the copy keeps `hidden`, so it would be a write nobody can see
      if (d.hidden) return `That ${nameOf(d)} is hidden — show it first, then duplicate it.`
      if (!Array.isArray(d.points) || !d.points.length) return `I can't read that ${nameOf(d)}'s points to copy it.`
      return null
    },
    apply(st, { drawing }) {
      const { id: _id, ...rest } = byId(st, drawing)
      const copy = { id: `${TEMP}${st.n + 1}`, ...rest, points: offsetPoints(rest.points), locked: false }
      return { ...st, n: st.n + 1, drawings: [...st.drawings, copy] }
    },
    describe(b, a, { drawing }) {
      const added = addedBy(b, a)
      const o = byId(b, drawing)
      if (added.length !== 1 || !o) return null
      const where = (o.points || []).some(p => p?.paneRelY != null) ? 'just below it in its pane' : 'just below it (0.5% lower)'
      return `Duplicated the ${nameOf(o)} on ${a.symbol}: the copy sits ${where}, unlocked — on every chart showing ${a.symbol}`
    },
  })

  // ── a position's three level alerts ──
  // the price the ENTRY's side is read from, per symbol; the alert book for what is already bound
  const prepare = async (ops) => {
    const syms = [...new Set(ops.map(o => String(o?.target || '').toUpperCase()).filter(s => /^[A-Z][A-Z0-9.\-^]{0,14}$/.test(s)))]
    const [bound, quotes] = await Promise.all([prepareBound(), quotesFor(syms).catch(() => ({}))])
    return { ...bound, positionQuotes: quotes || {} }
  }
  const levelOf = (w) => (typeof w === 'string' ? LEVEL_WORDS[w.trim().toLowerCase()] : undefined)
  const plan = (st, { drawing, levels }, env) => {
    const d = byId(st, drawing)
    if (!d) return { why: notFound(drawing) }
    if (!menuOffers(d.type, 'positionAlerts')) return { why: `That ${nameOf(d)} isn't a position — it has no entry, stop or target; an alert on the line itself is a different request.` }
    const side = positionSide(d)
    if (!side) return { why: `That position's points don't make a long or a short (target, entry, stop in order), so it has no alerts.` }
    const want = Array.isArray(levels) ? levels : []
    if (!want.length) return { why: 'Which alert: entry, stop, target, or all three?' }
    const idx = []
    for (const w of want) {
      const i = levelOf(w)
      if (i === undefined) return { why: `“${w}” isn't a level of a position — its levels are entry, stop and target.` }
      if (!idx.includes(i)) idx.push(i)
    }
    if (!boundIds(env)) return { why: 'I couldn\'t read your alerts, so I set nothing.' }
    const all = want.length === 3 && idx.length === 3
    const rows = (env?.boundAlerts || []).filter(r => r.active)
    const has = (i) => rows.some(r => { const p = parseBoundId(r.drawingId); return p.drawingId === d.id && p.level === i })
    const sym = String(st.symbol).toUpperCase()
    const last = env?.positionQuotes?.[sym]
    const creates = [], skipped = []
    for (const i of idx.sort()) {
      const label = POSITION_LEVELS[i].key
      if (has(i)) {
        // "All three" in the menu sets only the bells not already on; one named level that is already on is said
        if (all) { skipped.push(label); continue }
        return { why: `That position already has an active ${label} alert.` }
      }
      if (i === 0 && !Number.isFinite(last)) return { why: `I couldn't read ${sym}'s current price, and the entry alert's side comes from it — set the entry alert on the chart${idx.length > 1 ? ', or ask me for the stop and target alone' : ''}.` }
      const direction = positionLevelDirection(d, i, i === 0 ? last : null)
      const geom = anchorsForDrawing(d, { tf: st.tf, etOffset: fromChartTime, level: i })
      if (!direction || !geom) return { why: `I can't read that position's ${label} to set an alert on it.` }
      creates.push({ sym, price: geom.target_price, direction, label, body: { sym: st.symbol, direction, ...geom, drawing_id: boundIdFor(d.id, i) } })
    }
    if (!creates.length) return { why: 'That position already has all three alerts.' }
    return { d, side, creates, skipped }
  }
  registerCapability({
    ...common,
    name: 'drawing.setPositionAlerts',
    risk: 'confirm',
    summary: 'Set a POSITION drawing\'s alerts (its menu\'s Alerts row): entry, stop, target, or all three. Each is an alert bound to that level, going off on the side the menu gives it (stop = the losing side, target = the winning side, entry = toward the entry from the current price). Always shown first; Undo removes them unless one already went off.',
    hints: 'target = the drawings entry; drawing = the position\'s id; levels = any of "entry", "stop", "target" ("all three" / "all its alerts" = all three). The side is the position\'s own — never ask the member. A line, ray or Fibonacci is drawing.setAlert.',
    args: { type: 'object', properties: {
      drawing: { type: 'string' },
      levels: { type: 'array', items: { type: 'string', enum: POSITION_LEVEL_NAMES } },
    }, required: ['drawing', 'levels'], additionalProperties: false },
    prepare,
    check(st, args, env) { return plan(st, args, env).why || null },
    apply(st, args, env) {
      const p = plan(st, args, env)
      return { ...st, alerts: [...st.alerts, ...p.creates.map(c => ({ sym: c.sym, price: c.price, direction: c.direction, body: c.body }))] }
    },
    describe(b, a, args, env) {
      if (a.alerts.length <= b.alerts.length) return null
      const p = plan(b, args, env)
      if (p.why) return null
      const each = p.creates.map(c => `${c.label} ${money(c.price)} (${c.direction === 'above' ? 'at or above' : 'at or below'})`).join(', ')
      const skip = p.skipped.length ? ` · ${p.skipped.join(' and ')} already had one` : ''
      return `Alerts on the ${p.side} position on ${a.symbol}: ${each} — each goes off once, checked while the market is open, and follows its level if you move the position${skip}`
    },
  })
}
