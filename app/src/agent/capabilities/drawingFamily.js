// ── DRAWINGS, THE WHOLE FAMILY: one generic path per job, driven by the drawing layer's own tables ──
//
// Owner rule: a capability family, not one sentence at a time. So nothing here names a tool's setting by hand when the
// drawing layer already declares it, and no second store, renderer or validator exists. Every write is updateDrawing /
// addDrawing through drawingKind (capabilities/drawings.js), read back by id, undone by id.
//
//   drawing.add           every toolbar tool without a dedicated capability. How many points a tool takes is POINT_COUNT
//                         (the overlay's table), whether they are valid is validateDrawing, the stored shape is what the
//                         overlay's finish block writes (newDrawingProps, constrainPoints). The table below adds only what
//                         a mouse gets for free: what each point MEANS, and which geometry cannot be drawn.
//   drawing.setAnchors    what dragging an anchor writes: one or several points, by position, to a new date and/or price.
//   drawing.setProps      every setting the drawing's menu offers, read from drawingSettingsSchema: CONTROLS + controlIdsFor
//                         decide which tool has which setting, so a new control with a `prop` is reachable here unchanged.
//   drawing.setFibLevels  the Levels… editor and Reset levels: withLevel / withBand / RESET_FIB_STYLE, the editor's writers.
//   drawing.setAlert      the menu's "Set alert…" with "follow this line" on: anchorsForDrawing + boundIdFor, then the same
//                         POST; the bound-alert resync (useBoundDrawingAlerts) and the server's _alert_level_now do the rest.
//
// ⛔ MEASURE IS A DRAWING. `measure`, `priceRange` and `dateRange` are stored objects whose figures are derived from their
// anchors every frame (drawingMeasure), so they go through drawing.add, drawing.setAnchors and drawing.setProps like any
// tool. A receipt states only what follows from the anchors; the bar count needs the chart's bars and is left to the chart.

import { objectTypeName as titleOf } from '../../components/chart/drawingObjects'
import { CONTROLS, SCHEMA, controlIdsFor } from '../../components/chart/drawingSettingsSchema'
import { POINT_COUNT, validateDrawing, drawingTimeFor } from '../../components/chart/drawingTools'
import { constrainPoints } from '../../components/chart/drawingGeometry'
import { drawingProp } from '../../components/chart/drawingSchema'
import { RESET_FIB_STYLE, bandKey, bandsFor, bandState, defaultBandColor, hasFibOverrides, isFib, levelKey, levelsFor, withBand, withLevel } from '../../components/chart/drawingFib'
import { alertKindFor, anchorsForDrawing, boundIdFor } from '../../components/chart/drawingAlertAnchors'
import { measurementFor } from '../../components/chart/drawingMeasure'
import { FONT_OPTIONS, fontLabelFor } from '../../components/chart/drawingText'
import { fromChartTime, etDateOf } from '../../components/chart/barTime'
import { pointUnixTime, toUnixTimeBase } from '../../components/chart/drawingTimeBase'
import { isDateTf } from '../../components/chart/patternTime'
import { isoDayMs, dayWord } from '../dateWords'
import { normalizeColor, colorName } from './chart'

const FONT_MIN = 8, FONT_MAX = 64            // bumpFont's clamp in DrawingContextMenu
const TEXT_MAX = 200
const FILL_ALPHA = 0.15                      // DEFAULT_BAND_ALPHA's 15%: an explicit fill's alpha is in its colour (fillFor), so a bare #rrggbb would hide the candles
// a tool's name inside a sentence: the Objects list's Title Case name, lower-cased but for its proper nouns
const objectTypeName = (t) => titleOf(t).toLowerCase().replace('fibonacci', 'Fibonacci').replace('vwap', 'VWAP')
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const a_ = (w) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`
const A_ = (w) => `${/^[aeiou]/i.test(w) ? 'An' : 'A'} ${w}`

// ── what each point of a tool means ──
//   order    the points run forward in time (true = all of them, a number = the first n)
//   strict   and two of those may not share a time
//   spread   needs width AND height to be visible
//   off      the third point sits off the line through the first two (a channel has no width otherwise)
//   prices   the first two prices differ (a Fibonacci measures their range)
export const ADD_TOOLS = Object.freeze({
  extended: { points: ['first point', 'second point'], order: true },
  vertical: { points: ['the date (price null)'], timeOnly: true },
  circle: { points: ['one corner', 'opposite corner'], spread: true },
  arrow: { points: ['tail', 'tip'] },
  fibext: { points: ['move start', 'move end'], order: true, prices: true },
  pitchfork: { points: ['pivot', 'left shoulder', 'right shoulder'] },
  channel: { points: ['base start', 'base end', 'a point on the parallel line'], order: 2, strict: true, off: true },
  cup: { points: ['left rim', 'bottom', 'right rim'], order: true, strict: true },
  measure: { points: ['start', 'end'] },
  priceRange: { points: ['start', 'end'] },
  dateRange: { points: ['start', 'end'], order: true, strict: true },
  advance: { points: ['setup candle', 'candle where the move tops'], order: true, strict: true },
})
// the same rules for the tools with their own add capability, so moving their anchors cannot make what adding refuses
const RULES = { ...ADD_TOOLS, trendline: { order: true }, ray: { order: true }, fib: { order: true, prices: true } }

const timeMs = (p) => (typeof p?.time === 'string' ? isoDayMs(p.time.slice(0, 10)) : Number.isFinite(p?.time) ? pointUnixTime(p.time) * 1000 : null)
/** A stored point's calendar day: D/W/M dates as stored; an intraday point (raw unix, or a legacy
 *  Agent chart time — drawingTimeBase.js) by its ET calendar date. */
export function pointDay(p, drawing = null) {
  if (typeof p?.time === 'string') return p.time.slice(0, 10)
  if (!Number.isFinite(p?.time)) return null
  return etDateOf(pointUnixTime(p.time, drawing))
}
const ordinal = (i) => ['first', 'second', 'third'][i] || `#${i + 1}`
/** The sentence refusing points this tool cannot be drawn from, or null. */
function geometryWhy(type, pts) {
  const r = RULES[type] || {}
  const n = pts.length
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
    if (pts[i].time === pts[j].time && pts[i].price === pts[j].price) return `The ${ordinal(i)} and ${ordinal(j)} points are the same — say different points.`
  }
  if (r.order) {
    const last = r.order === true ? n : r.order
    for (let i = 1; i < last; i += 1) {
      const a = timeMs(pts[i - 1]), b = timeMs(pts[i])
      if (a == null || b == null) continue
      if (b < a || (r.strict && b === a)) return `The ${ordinal(i)} point (${dayWord(pointDay(pts[i]))}) has to be after the ${ordinal(i - 1)} (${dayWord(pointDay(pts[i - 1]))}) — give them in time order.`
    }
  }
  if (r.prices && pts[0].price === pts[1].price) return `${A_(objectTypeName(type))} measures a move, and those two prices are the same.`
  if (r.spread && (pts[0].time === pts[1].time || pts[0].price === pts[1].price)) return `${A_(objectTypeName(type))} needs a different date and a different price at its two corners.`
  if (r.off) {
    const [a, b, c] = pts.map(timeMs)
    const onLine = pts[0].price + ((pts[1].price - pts[0].price) * (c - a)) / (b - a)
    if (Math.abs(onLine - pts[2].price) < 1e-9) return 'The third point sits on the base line, so the channel would have no width — say a point off that line.'
  }
  return null
}

/** The extras the overlay's finish block stores for a Price Move. It recomputes them from the candles wherever both
 *  anchors are bars; these are what it paints otherwise (its line-mode formula), since without them it paints nothing. */
function advanceFigures(pts) {
  const a = pts[0].price, b = pts.at(-1).price
  return a > 0 && Number.isFinite(b) ? { advPct: ((b - a) / a) * 100, advDelta: b - a, advHigh: b } : {}
}

const inPane = (d) => (d.pane && d.pane !== 'price') || (d.points || []).some(p => p?.paneY != null || p?.paneRelY != null)
export const paneWhy = (d) => (inPane(d) ? `That ${objectTypeName(d.type)} sits in an indicator pane — move it on the chart.` : null)

// ── the settings a tool's menu offers, read from the table the menu renders ──
const KIND_OF_WIDGET = { toggle: 'toggle', choice: 'choice', colorRow: 'color', fontPicker: 'font' }
const TEXT_PROP = { kind: 'text', control: { label: 'Text' } }
/** prop → {kind, control}. A colour row with no `prop` is drawing.style's (color / width / style). */
export function drawingPropsFor(type) {
  const out = new Map()
  for (const id of controlIdsFor(type)) {
    const c = CONTROLS[id]
    if (!c) continue
    if (id === 'fontSize') out.set('fontSize', { kind: 'size', control: c })
    else if (c.prop && KIND_OF_WIDGET[c.widget]) out.set(c.prop, { kind: KIND_OF_WIDGET[c.widget], control: c })
  }
  if (type === 'text') out.set('text', TEXT_PROP)    // what double-clicking a note edits
  return out
}
export const ALL_PROPS = Object.freeze([...new Set(Object.keys(SCHEMA).flatMap(t => [...drawingPropsFor(t).keys()]))])
/** Does this tool have a line to style? Its colour row says so (`line: false` = no width, no dash). */
export const hasLineStyle = (type) => !controlIdsFor(type).some(id => CONTROLS[id]?.widget === 'colorRow' && !CONTROLS[id].prop && CONTROLS[id].line === false)
// A colour that only paints while its toggle is on (the row's own `available` rule): asking for the colour means showing it.
const ENABLED_BY = { bgColor: 'bgEnabled', borderColor: 'borderEnabled' }
const PROP_LABEL = Object.fromEntries(Object.values(CONTROLS).filter(c => c.prop).map(c => [c.prop, c.label]))

const alphaHex = (o) => Math.round(o * 255).toString(16).padStart(2, '0')
const opacityOf = (raw) => {
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN
  return n > 1 ? n / 100 : n
}
/** A colour value, with its alpha where one applies → {value, says} or {why}. */
function colorValue(raw, opacity, { defaultAlpha = null } = {}) {
  const hex = normalizeColor(raw)
  if (!hex) return { why: `“${raw}” isn't a colour I know — use a name like blue or a #hex.` }
  const o = opacityOf(opacity)
  if (Number.isNaN(o)) return { why: `“${opacity}” isn't an opacity — say a percent from 0 to 100.` }
  const alpha = o ?? defaultAlpha
  return alpha == null ? { value: hex, says: colorName(hex) } : { value: `${hex}${alphaHex(alpha)}`, says: `${colorName(hex)} at ${Math.round(alpha * 100)}%` }
}
const onWord = (v) => (v === true || /^(on|true|yes|show)$/i.test(String(v)) ? true : v === false || /^(off|false|no|hide)$/i.test(String(v)) ? false : null)

/** One {prop, value, opacity} for this drawing → {prop, value, says} or {why}. */
function propValue(d, { prop, value, opacity }) {
  const offered = drawingPropsFor(d.type)
  const e = offered.get(prop)
  if (!e) {
    const labels = [...offered.values()].map(x => x.control.label.replace('…', ''))
    return { why: `${A_(objectTypeName(d.type))} has no “${PROP_LABEL[prop] || prop}” setting.${labels.length ? ` Its settings are: ${labels.join(', ')}.` : ''}` }
  }
  const label = e.control.label
  switch (e.kind) {
    case 'toggle': {
      const v = onWord(value)
      return v == null ? { why: `${label} is on or off.` } : { prop, value: v, says: `${label} ${v ? 'on' : 'off'}` }
    }
    case 'choice': {
      const s = String(value ?? '').trim().toLowerCase()
      const c = e.control.choices.find(x => x.value === value || String(x.value) === s || x.title.toLowerCase() === s)
      return c ? { prop, value: c.value, says: `${label} ${c.title.toLowerCase()}` } : { why: `${label} is one of: ${e.control.choices.map(x => x.title.toLowerCase()).join(', ')}.` }
    }
    case 'color': {
      if (value == null) return { prop, value: null, says: `${label} back to its default` }
      const c = colorValue(value, opacity, { defaultAlpha: prop === 'fillColor' ? FILL_ALPHA : null })
      return c.why ? c : { prop, value: c.value, says: `${label} ${c.says}` }
    }
    case 'font': {
      if (value == null || /^default$/i.test(String(value))) return { prop, value: null, says: `${label} back to its default` }
      const s = String(value).trim().toLowerCase()
      const f = FONT_OPTIONS.find(x => String(x.value).toLowerCase() === s || String(x.label).toLowerCase() === s)
      return f ? { prop, value: f.value || null, says: `${label} ${fontLabelFor(f.value)}` } : { why: `The fonts are: ${FONT_OPTIONS.map(x => x.label).join(', ')}.` }
    }
    case 'size': {
      const n = Number(value)
      return Number.isInteger(n) && n >= FONT_MIN && n <= FONT_MAX ? { prop, value: n, says: `${label} ${n}` } : { why: `${label} is a whole number from ${FONT_MIN} to ${FONT_MAX}.` }
    }
    default: {
      const t = String(value ?? '').trim()
      if (!t) return { why: 'Say what the note should say.' }
      return t.length > TEXT_MAX ? { why: `That note is ${t.length} characters — keep it under ${TEXT_MAX}.` } : { prop, value: t, says: `Text “${t.length > 40 ? `${t.slice(0, 40)}…` : t}”` }
    }
  }
}
const currentOf = (d, prop, e) => (e?.control?.resolve ? e.control.resolve(d) : e?.kind === 'text' ? d.text : prop === 'fontSize' ? (d.fontSize ?? 13) : drawingProp(d, prop))

/** The change a list of settings makes, applied in order so one setting's rule sees the ones before it. */
function propsPlan(d, set) {
  if (!Array.isArray(set) || !set.length) return { why: 'Say which setting to change.' }
  const offered = drawingPropsFor(d.type)
  let sim = d
  const changes = {}, says = []
  const put = (prop, value, say) => {
    if (same(currentOf(sim, prop, offered.get(prop)), value)) return
    changes[prop] = value; sim = { ...sim, [prop]: value }
    if (say) says.push(say)
  }
  for (const item of set) {
    const r = propValue(d, item || {})
    if (r.why) return r
    const c = offered.get(r.prop).control
    // the toggle's own refusal: a Price Move must keep one figure showing
    if (r.value === false && c.lockedWhen?.({ drawing: sim })) return { why: `${c.lockedHint}.` }
    if (ENABLED_BY[r.prop] && r.value != null) put(ENABLED_BY[r.prop], true, null)
    put(r.prop, r.value, r.says)
    if (r.value != null && c.available && !c.available({ drawing: sim, points: sim.points })) return { why: `${c.label} isn't available on that ${objectTypeName(d.type)} right now.` }
  }
  return { changes, says }
}

// ── Fibonacci ──
/** "78.6", 78.6, 0.786 → the table's 0.786; a number above the table's own range is a percent. */
function fibLevel(type, raw) {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace('%', ''))
  if (!Number.isFinite(n)) return null
  const v = n > Math.max(...levelsFor(type)) ? n / 100 : n
  return levelsFor(type).find(l => levelKey(l) === levelKey(v)) ?? null
}
const fibList = (type) => levelsFor(type).join(', ')
function fibPlan(d, { levels, bands, reset }) {
  const type = d.type
  let cur = d
  const says = []
  if (reset) {
    if (!hasFibOverrides(d)) return { why: 'Those levels are already at their defaults.' }
    cur = { ...cur, ...RESET_FIB_STYLE }
    says.push('levels back to their defaults')
  }
  for (const it of levels || []) {
    const lv = fibLevel(type, it?.level)
    if (lv == null) return { why: `“${it?.level}” isn't a level of that ${objectTypeName(type)}. Its levels are ${fibList(type)}.` }
    const patch = {}
    if (it.visible != null) patch.visible = !!it.visible
    if (it.color != null) {
      const c = colorValue(it.color, null)
      if (c.why) return c
      patch.color = c.value
    }
    if (!Object.keys(patch).length) return { why: `Say what to change on the ${lv} level: show, hide or a colour.` }
    cur = { ...cur, levels: withLevel(cur, lv, patch) }
    says.push(`${lv}${patch.visible != null ? (patch.visible ? ' shown' : ' hidden') : ''}${patch.color ? ` ${colorName(patch.color)}` : ''}`)
  }
  const pairs = bandsFor(type)
  for (const it of bands || []) {
    const a = fibLevel(type, it?.from), b = fibLevel(type, it?.to)
    const pair = a == null || b == null ? null : pairs.find(([x, y]) => bandKey(x, y) === bandKey(a, b))
    if (!pair) return { why: `A fill runs between two neighbouring levels (${fibList(type)}).` }
    const [x, y] = pair
    if (it.enabled === false) {
      cur = { ...cur, fills: withBand(cur, x, y, { enabled: false }) }
      says.push(`fill ${x} to ${y} off`)
      continue
    }
    const st = bandState(cur, x, y)
    let color = st.enabled ? st.color : defaultBandColor(cur, x), word = ''
    if (it.color != null) {
      const c = colorValue(it.color, it.opacity, { defaultAlpha: FILL_ALPHA })
      if (c.why) return c
      color = c.value
      word = ` ${c.says}`
    }
    cur = { ...cur, fills: withBand(cur, x, y, { enabled: true, color }) }
    says.push(`fill ${x} to ${y} on${word}`)
  }
  if (!says.length) return { why: 'Say which levels or fills to change.' }
  const set = {}
  if (!same(d.levels, cur.levels)) set.levels = cur.levels ?? null
  if (!same(d.fills, cur.fills)) set.fills = cur.fills ?? null
  return { set, says }
}

export function registerDrawingFamily(common, h) {
  const { registerCapability, byId, notFound, boundIds, prepareBound, setOn, anchorFor, newDrawing, styleWhy, dupOf, addedBy, at, money, STYLE_ARGS, DATE_HINT, sameBound } = h

  // ── one tool, one path ──
  const addPlan = (st, { tool, points, color, style }) => {
    const spec = ADD_TOOLS[tool]
    const name = objectTypeName(tool)
    if (!spec) return { why: `I can't place “${tool}” as a drawing.` }
    const s = styleWhy({ color, style })
    if (s) return { why: s }
    const need = POINT_COUNT[tool]
    if (!Array.isArray(points) || points.length !== need) return { why: `${A_(name)} takes ${need} point${need === 1 ? '' : 's'}: ${spec.points.join(', ')}.` }
    const out = []
    for (const p of points) {
      const r = anchorFor(st, p, { priceOptional: !!spec.timeOnly })
      if (r.why) return r
      out.push(r)
    }
    const w = geometryWhy(tool, out)
    if (w) return { why: w }
    const placed = constrainPoints(tool, out.map(a => ({ time: a.time, price: a.price })))
    const v = validateDrawing(tool, placed, { tf: st.tf })
    if (!v.ok) return { why: `That ${name} can't be drawn here (${v.reason}).` }
    if (dupOf(st, tool, placed)) return { why: `There is already ${a_(name)} on those points on ${st.symbol}.` }
    return { placed }
  }
  const measured = (tool, points) => {
    if (tool !== 'measure' && tool !== 'priceRange') return ''
    const m = measurementFor(points, points.map(p => ({ rawPrice: p.price })))
    return m.delta == null ? '' : `: ${m.delta >= 0 ? '+' : '-'}${money(Math.abs(m.delta))} (${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(2)}%)`
  }

  registerCapability({
    ...common,
    name: 'drawing.add',
    summary: 'Draw any other toolbar tool from dates and prices: extended line, vertical line, circle, arrow, Fibonacci extension, pitchfork, parallel channel, cup curve, Measure, Price Range, Bars & Time or Price Move. Every chart on that symbol shows it; Undo removes it.',
    hints: `target = the drawings entry for the chart's symbol; points = [{date, price}, …] in the tool's order: ${Object.entries(ADD_TOOLS).map(([t, s]) => `${t}: ${s.points.join(', ')}`).join('; ')}. ${DATE_HINT}; a point with no number ("the low") has no anchor — clarify, never guess. color / style null = defaults.`,
    args: { type: 'object', properties: {
      tool: { type: 'string', enum: Object.keys(ADD_TOOLS) },
      points: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, price: { type: ['number', 'null'] } }, required: ['date', 'price'], additionalProperties: false } },
      ...STYLE_ARGS,
    }, required: ['tool', 'points', 'color', 'style'], additionalProperties: false },
    check(st, args) { return addPlan(st, args).why || null },
    apply(st, args) {
      const { tool, color, style } = args
      const { placed } = addPlan(st, args)
      const extra = tool === 'advance' ? { ...advanceFigures(placed), ...(color != null ? { labelColor: normalizeColor(color) } : {}) } : {}
      return { ...st, n: st.n + 1, drawings: [...st.drawings, newDrawing(st, tool, placed, { color, style, extra })] }
    },
    describe(b, a, { tool }) {
      const added = addedBy(b, a)
      if (!added.length) return null
      const d = added[0]
      const pts = d.points.map(p => (p.price == null ? dayWord(pointDay(p)) : at({ price: p.price, day: pointDay(p) })))
      return `Drew ${a_(objectTypeName(tool))} on ${a.symbol}: ${pts.join(' to ')}${measured(tool, d.points)}${d.lineStyle ? ` (${d.lineStyle})` : ''} — on every chart showing ${a.symbol}`
    },
  })

  // ── moving anchors ──
  const movePlan = (st, { drawing, points }) => {
    const d = byId(st, drawing)
    if (!d) return { why: notFound(drawing) }
    const name = objectTypeName(d.type)
    if (d.locked) return { why: `That ${name} is locked — unlock it first.` }
    const pane = paneWhy(d)
    if (pane) return { why: pane }
    if (!Array.isArray(points) || !points.length) return { why: 'Say which point to move, and to what date or price.' }
    // An intraday Agent drawing being rewritten moves to the ONE time base (raw unix, `tb` stamp) whole,
    // so a new raw point never sits beside a legacy chart-time one (drawingTimeBase.js).
    const was = (toUnixTimeBase(d) || d).points || []
    // a new time is written in the form the drawing's other points use (one made on the daily stays in dates)
    const numeric = typeof was.find(p => p?.time != null)?.time === 'number'
    const tf = numeric ? (isDateTf(st.tf) ? '5' : st.tf) : 'D'
    const next = was.slice()
    for (const m of points) {
      const i = Number(m?.point) - 1
      const old = was[i]
      if (!old) return { why: `That ${name} has ${was.length} point${was.length === 1 ? '' : 's'}.` }
      if (m.date == null && m.price == null) return { why: `Say the new date or price for point ${i + 1}.` }
      if (old.time == null && m.date != null) return { why: 'A horizontal line has no date — only its price moves.' }
      if (RULES[d.type]?.timeOnly && m.price != null) return { why: 'A vertical line has no price — only its date moves.' }
      const p = { ...next[i] }
      if (m.price != null) {
        if (!Number.isFinite(m.price) || m.price <= 0) return { why: `“${m.price}” isn't a price — say a positive number.` }
        p.price = m.price
      }
      if (m.date != null) {
        const r = anchorFor(st, { date: m.date, price: p.price }, { priceOptional: true, needsWeekday: d.type === 'avwap' })
        if (r.why) return r
        const time = drawingTimeFor(r.day, tf)
        if (time == null) return { why: `I couldn't place ${dayWord(r.day)} on that ${name}.` }
        p.time = time
        delete p.futureBars
      }
      next[i] = p
    }
    const w = geometryWhy(d.type, next)
    if (w) return { why: w }
    const placed = constrainPoints(d.type, next)
    const v = validateDrawing(d.type, placed, { tf })
    if (!v.ok) return { why: `That ${name} can't be moved there (${v.reason}).` }
    return { d, placed }
  }
  registerCapability({
    ...common,
    name: 'drawing.setAnchors',
    summary: 'Move the anchors of ONE drawing (what dragging its points does): any tool, any point, a new date and/or price. "Flatten that line" sets every point to the first point\'s price. Refused for a locked drawing. A drawing with an alert is shown first (its alert follows). Undo puts it back.',
    hints: `target = the drawings entry; drawing = its id (the recent one for "it"); points = [{point, date, price}]: point 1 = the first of that drawing's \`anchors\`, date / price null = keep it. "Move the second point to Nov 1 at 210" = one item; a whole drawing up $5 = one item per point, from its anchors. ${DATE_HINT}.`,
    args: { type: 'object', properties: {
      drawing: { type: 'string' },
      points: { type: 'array', items: { type: 'object', properties: { point: { type: 'integer' }, date: { type: ['string', 'null'] }, price: { type: ['number', 'null'] } }, required: ['point', 'date', 'price'], additionalProperties: false } },
    }, required: ['drawing', 'points'], additionalProperties: false },
    prepare: prepareBound,
    confirmIf: (st, { drawing }, env) => !!boundIds(env)?.has(String(drawing)),
    check(st, args, env) {
      const r = movePlan(st, args)
      if (r.why) return r.why
      return boundIds(env) ? null : 'I couldn\'t check whether an alert is attached to that drawing, so I left it alone.'
    },
    apply(st, args) {
      const { d, placed } = movePlan(st, args)
      if (same(placed, d.points)) return st
      const tb = placed.some(p => typeof p?.time === 'number') ? { tb: 'unix' } : {}   // drawingTimeBase.js
      return setOn(st, d.id, { points: placed, ...tb, ...(d.type === 'advance' ? advanceFigures(placed) : {}) })
    },
    describe(b, a, args, env) {
      const o = byId(b, args.drawing), n = byId(a, args.drawing)
      if (!o || !n || same(o.points, n.points)) return null
      const moved = n.points.flatMap((p, i) => {
        if (same(p, o.points[i])) return []
        const where = p.price == null ? dayWord(pointDay(p)) : p.time == null ? money(p.price) : at({ price: p.price, day: pointDay(p) })
        return [`point ${i + 1} to ${where}`]
      })
      const alert = boundIds(env)?.has(String(args.drawing)) ? ' (its alert follows)' : ''
      return `Moved the ${objectTypeName(o.type)} on ${a.symbol}: ${moved.join(', ')}${alert}`
    },
    noop: () => 'That drawing is already there',
  })

  // ── every setting the menu offers ──
  registerCapability({
    ...common,
    name: 'drawing.setProps',
    summary: 'Change settings on ONE drawing, as its right-click menu does: fill, price label, percent label, arrow size, Measure label fields and position, a note\'s words, font, size, bold, italic, background, border. Each tool has only its own settings; one it lacks is refused and its real ones named. Colour, width and line style are drawing.style. Undo puts them back.',
    hints: 'target = the drawings entry; drawing = its id; set = [{prop, value, opacity}]. prop by tool: rectangle fillColor, showPercentChange; horizontal line / ray showPriceLabel; arrow arrowSize (small | medium | large); Measure / Price Range showDollar, showPercent, showBars, showTime, labelPos (top | center | bottom); Bars & Time showBars, showTime, labelPos; Price Move showDollar, showPercent; note text, fontFamily, fontSize (8-64), bold, italic, bgEnabled, bgColor, borderEnabled, borderColor. value = true / false for a switch, a colour, null = back to default. opacity = 0-100 for a colour, null = default.',
    args: { type: 'object', properties: {
      drawing: { type: 'string' },
      set: { type: 'array', items: { type: 'object', properties: { prop: { type: 'string', enum: [...ALL_PROPS] }, value: { type: ['string', 'number', 'boolean', 'null'] }, opacity: { type: ['number', 'null'] } }, required: ['prop', 'value', 'opacity'], additionalProperties: false } },
    }, required: ['drawing', 'set'], additionalProperties: false },
    check(st, { drawing, set }) {
      const d = byId(st, drawing)
      if (!d) return notFound(drawing)
      if (d.locked) return `That ${objectTypeName(d.type)} is locked — unlock it first.`
      return propsPlan(d, set).why || null
    },
    apply(st, { drawing, set }) {
      const { changes } = propsPlan(byId(st, drawing), set)
      return Object.keys(changes).length ? setOn(st, drawing, changes) : st
    },
    describe(b, a, { drawing, set }) {
      const o = byId(b, drawing)
      const r = o ? propsPlan(o, set) : null
      return r?.says?.length ? `Changed the ${objectTypeName(o.type)} on ${a.symbol}: ${r.says.join(', ')}` : null
    },
    noop: () => 'That drawing is already set like that',
  })

  // ── Fibonacci levels and bands ──
  registerCapability({
    ...common,
    name: 'drawing.setFibLevels',
    summary: 'Edit a Fibonacci retracement or extension\'s Levels… menu: show or hide a level, colour a level, turn the fill between two neighbouring levels on or off and colour it, or reset them all to defaults. The anchors and any level alerts are not touched. Undo puts them back.',
    hints: 'target = the drawings entry; drawing = the Fibonacci\'s id. levels = [{level, visible, color}], level as the member says it (0.786 or 78.6), visible false = "remove the 78.6"; null = leave. bands = [{from, to, enabled, color, opacity}] between two neighbouring levels, color null = its default, opacity = 0-100 or null. reset = true for "reset the fib levels" (levels and bands then both []). Levels are the tool\'s own table: there are no custom levels.',
    args: { type: 'object', properties: {
      drawing: { type: 'string' },
      levels: { type: 'array', items: { type: 'object', properties: { level: { type: 'number' }, visible: { type: ['boolean', 'null'] }, color: { type: ['string', 'null'] } }, required: ['level', 'visible', 'color'], additionalProperties: false } },
      bands: { type: 'array', items: { type: 'object', properties: { from: { type: 'number' }, to: { type: 'number' }, enabled: { type: 'boolean' }, color: { type: ['string', 'null'] }, opacity: { type: ['number', 'null'] } }, required: ['from', 'to', 'enabled', 'color', 'opacity'], additionalProperties: false } },
      reset: { type: 'boolean' },
    }, required: ['drawing', 'levels', 'bands', 'reset'], additionalProperties: false },
    check(st, args) {
      const d = byId(st, args.drawing)
      if (!d) return notFound(args.drawing)
      if (!isFib(d.type)) return `That ${objectTypeName(d.type)} isn't a Fibonacci — it has no levels.`
      if (d.locked) return `That ${objectTypeName(d.type)} is locked — unlock it first.`
      return fibPlan(d, args).why || null
    },
    apply(st, args) {
      const { set } = fibPlan(byId(st, args.drawing), args)
      return Object.keys(set).length ? setOn(st, args.drawing, set) : st
    },
    describe(b, a, args) {
      const o = byId(b, args.drawing), n = byId(a, args.drawing)
      if (!o || !n || (same(o.levels, n.levels) && same(o.fills, n.fills))) return null
      return `Changed the ${objectTypeName(o.type)} on ${a.symbol}: ${fibPlan(o, args).says.join(', ')}`
    },
    noop: () => 'Those levels are already set like that',
  })

  // ── an alert that follows the drawing ──
  const alertPlan = (st, { drawing, direction, level }, env) => {
    const d = byId(st, drawing)
    if (!d) return { why: notFound(drawing) }
    const name = objectTypeName(d.type)
    if (d.type === 'position') return { why: 'Set a position\'s alerts on the chart: its entry alert picks its side from the live price.' }
    if (!alertKindFor(d.type)) return { why: `${A_(name)} can't carry an alert — only lines, rays and Fibonacci levels can.` }
    if (direction !== 'above' && direction !== 'below') return { why: 'Should it go off above or below the line?' }
    const pane = paneWhy(d)
    if (pane) return { why: pane }
    // ⛔ a future anchor's time is derived from the chart's bars, which the Agent does not hold: a guess would tilt the line
    if ((d.points || []).some(p => Number.isFinite(p?.futureBars) && p.futureBars > 0)) return { why: `That ${name} has a point past the last bar — set its alert on the chart.` }
    let lv = null
    if (isFib(d.type)) {
      lv = fibLevel(d.type, level)
      if (lv == null) return { why: `Which level of the ${name}? Its levels are ${fibList(d.type)}.` }
    } else if (level != null) return { why: `That ${name} has no levels.` }
    const geom = anchorsForDrawing(d, { tf: st.tf, etOffset: fromChartTime, level: lv })
    if (!geom) return { why: `I can't read that ${name}'s position to set an alert on it.` }
    if (!boundIds(env)) return { why: 'I couldn\'t read your alerts, so I set nothing.' }
    const id = boundIdFor(d.id, lv)
    if (sameBound(env, id, direction)) return { why: `That ${name} already has an active alert ${direction} it.` }
    return { d, lv, c: { sym: String(st.symbol).toUpperCase(), price: geom.target_price, direction, body: { sym: st.symbol, direction, ...geom, drawing_id: id } } }
  }
  registerCapability({
    ...common,
    name: 'drawing.setAlert',
    risk: 'confirm',
    summary: 'Set an alert that FOLLOWS a drawing (the drawing menu\'s "Set alert…"): a trendline, ray, extended line, horizontal line or ray, or one Fibonacci level. A sloped line\'s level moves with time; moving the drawing moves the alert. Always shown first; Undo removes the alert unless it already went off.',
    hints: 'target = the drawings entry; drawing = its id; direction = above ("breaks above", "gets above") or below ("breaks below", "loses"). If they do not say which side, clarify — never guess. level = the Fibonacci level (0.618 or 61.8), else null. Plan it, disposition propose. For a price with no drawing use alert.create.',
    args: { type: 'object', properties: { drawing: { type: 'string' }, direction: { type: 'string', enum: ['above', 'below'] }, level: { type: ['number', 'null'] } }, required: ['drawing', 'direction', 'level'], additionalProperties: false },
    prepare: prepareBound,
    check(st, args, env) { return alertPlan(st, args, env).why || null },
    apply(st, args, env) { return { ...st, alerts: [...st.alerts, alertPlan(st, args, env).c] } },
    describe(b, a, args, env) {
      if (a.alerts.length <= b.alerts.length) return null
      const { d, lv, c } = alertPlan(b, args, env)
      const what = lv != null ? `${lv} level of the ${objectTypeName(d.type)}` : objectTypeName(d.type)
      const moves = c.body.alert_type === 'trendline' ? ', and its level moves with the line' : ''
      return `Alert on ${c.sym}: price ${c.direction === 'above' ? 'at or above' : 'at or below'} the ${what} — goes off once, checked while the market is open${moves}. It follows the drawing if you move it. If price is already past it, it goes off at the next check`
    },
  })
}
