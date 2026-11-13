// ── DRAWING EXTRAS: the three drawing-toolbar jobs the family did not reach (C1-144, C1-160, C1-165) ──
//
// Each one goes through the product's OWN writer and is read back from where the product keeps it:
//   drawing.positionCalculator  the toolbar's 'position' tool — the Position CALCULATOR (the 3-point position DRAWING is
//                               retired: drawingSettingsSchema RETIRED_TYPES). StockChart.positionCalc arms the tool
//                               (setActiveTool('position')) and fills the panel's entry / stop / target (PositionPanel's
//                               own state), reached through the chart's view door (viewDo 'positionCalc') and read back
//                               from getDateMeta.positionCalc. ONE chart (the chart kind's targeting). The side comes from
//                               entry vs stop and is never guessed; a missing or unreadable price is refused. Undo puts
//                               the calculator back exactly as it was (closed stays closed). A view: nothing is saved.
//   drawing.saveDefaults        a drawing menu's "Save as default": drawingSaveDefaults.saveDefaultsPayloadFor (the row's
//                               own payload) merged by mergeDrawingDefaults (StockChart's onSaveDefaults) into THAT chart's
//                               cs.drawingDefaults, through the chart's settings writer. Exact Undo (the chart kind).
//   drawing.favoriteTool        the ★ in the toolbar's drawing-tools menu (ChartToolbar toggleFavoriteTool →
//                               drawToolFavorites.writeFavoriteTools). Per browser, every chart's toolbar shows it;
//                               read back from storage; Undo writes the list it replaced.
//
// ⛔ WHAT THE TOOLBAR DOES NOT OFFER, THE AGENT DOES NOT DO: a retired type has no Save as default (its menu has no row),
// and a tool id that is not a toolbar button cannot be starred.

import { registerCapability } from '../capabilities'
import { controlIdsFor, isRetired } from '../../components/chart/drawingSettingsSchema'
import { TYPE_NAMES, objectTypeName } from '../../components/chart/drawingObjects'
import { saveDefaultsPayloadFor, mergeDrawingDefaults } from '../../components/chart/drawingSaveDefaults'
import { toggledFavorites } from '../../components/chart/drawToolFavorites'
import * as drawingsStore from '../../components/chart/drawingsStore'
import { colorName } from './chart'

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const onCharts = (ctx) => ctx.surface === 'charts'
const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
const toolName = (t) => objectTypeName(t).replace(/^(\w)/, (c) => c.toLowerCase()).replace(/^fibonacci/, 'Fibonacci').replace(/vwap/i, 'VWAP')
const NOT_READY = 'That chart hasn\'t finished loading, so I can\'t read its Position Calculator. Try again in a moment.'
const NO_POSITION_TOOL = 'That chart has no drawing toolbar, so it has no Position Calculator — open one on a chart with the drawing tools.'
const POS_NO_UNDO = 'I couldn\'t read the Position Calculator before this, so it can\'t be undone here: close it with its ✕.'

// ── the Position Calculator ──
const priceOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
/** {entry, stop, target, side} → {side, arg} or {why}. The side is read from entry vs stop (never guessed). */
export function positionPlan({ entry, stop, target, side }) {
  const e = priceOf(entry), s = priceOf(stop), t = priceOf(target)
  const missing = [['entry', entry, e], ['stop', stop, s], ['target', target, t]].filter(([, raw, v]) => v == null).map(([k, raw]) => (raw == null ? k : `${k} (“${raw}” isn't a price)`))
  if (missing.length) return { why: `The Position Calculator needs an entry, a stop and a target as prices — ${missing.length === 1 ? 'missing' : 'missing:'} ${missing.join(', ')}. Say ${missing.length === 1 ? 'it' : 'them'}, or open it on the chart and type them in.` }
  if (e === s) return { why: 'The stop is at the entry, so there\'s no risk to size from — is it a long (stop below the entry) or a short (stop above)? Say a different stop.' }
  const read = e > s ? 'long' : 'short'
  if (side != null && side !== read) return { why: `A ${side} has its stop ${side === 'long' ? 'below' : 'above'} the entry, but ${money(s)} is ${read === 'long' ? 'below' : 'above'} ${money(e)} — which did you mean: a ${read}, or a different stop?` }
  if (read === 'long' ? t <= e : t >= e) return { why: `For a ${read} (stop ${read === 'long' ? 'below' : 'above'} the entry) the target goes ${read === 'long' ? 'above' : 'below'} the entry, and ${money(t)} doesn't — which did you mean?` }
  // the panel's own strings (PositionPanel types text); the direction is the calculator's own field
  return { side: read, arg: { open: true, entry: String(e), stop: String(s), target: String(t), direction: read } }
}
const posSig = (p) => (p ? JSON.stringify([!!p.open, ...['entry', 'stop', 'target'].map(k => (p[k] === '' || p[k] == null ? null : Number(p[k])))]) : null)

// ── drawing-tool favourites: the toolbar buttons that can be starred (the chart kind reads and writes the list) ──
export const FAVORITE_TOOLS = Object.freeze(Object.keys(TYPE_NAMES))

let registered = false
export function registerDrawingExtras() {
  if (registered) return
  registered = true
  const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }

  // ── C1-144: the Position Calculator on ONE chart ──
  registerCapability({
    ...chartCommon,
    name: 'drawing.positionCalculator',
    summary: 'Open the Position Calculator on ONE chart (the drawing toolbar\'s Position tool) with an entry, a stop and a target price: its panel sizes the trade from the account size and risk % saved there, and the chart shows the three price lines. Long or short comes from the stop being below or above the entry. A view: nothing is saved. Undo puts the calculator back as it was.',
    hints: 'target = the chart. entry, stop, target = the member\'s prices; a price they did not give is null (then ask — never guess one, never use the current price). side = "long" / "short" only when they said it, else null (it is read from entry vs stop). The old 3-point position DRAWING is retired: this is the only way to place a position.',
    args: { type: 'object', properties: {
      entry: { type: ['number', 'null'] }, stop: { type: ['number', 'null'] }, target: { type: ['number', 'null'] },
      side: { type: ['string', 'null'], enum: ['long', 'short', null] },
    }, required: ['entry', 'stop', 'target', 'side'], additionalProperties: false },
    undoNote: POS_NO_UNDO,
    check(st, args) {
      const p = positionPlan(args)
      if (p.why) return p.why
      const pc = st.view?.positionCalc
      if (!st.view || !pc) return NOT_READY
      return pc.can === false ? NO_POSITION_TOOL : null
    },
    apply(st, args) {
      const { arg } = positionPlan(args)
      return posSig(st.view?.positionCalc) === posSig(arg) ? st : { ...st, viewDo: { op: 'positionCalc', arg } }
    },
    describe(b, a, args) {
      if (!a.viewDo) return null
      const { side } = positionPlan(args)
      const { entry: e, stop: s, target: t } = args
      const risk = Math.abs(e - s), reward = Math.abs(t - e)
      return `Opened the Position Calculator on this chart (${a.symbol}): ${side}, entry ${money(e)}, stop ${money(s)}, target ${money(t)} — ${money(risk)} risk and ${money(reward)} reward a share, 1:${(reward / risk).toFixed(2)}R. The share count comes from the account size and risk % in its panel. Nothing is saved`
    },
    noop: () => 'The Position Calculator on this chart already shows those prices',
  })

  // ── C1-160: a drawing's "Save as default", onto ONE chart's drawing defaults ──
  const drawingOn = (st, id) => (drawingsStore.peekDrawings(st.drawSym || st.symbol) || []).find(d => d.id === String(id)) || null
  const defaultsPlan = (st, { drawing }) => {
    const d = drawingOn(st, drawing)
    if (!d) return { why: `There's no drawing “${drawing}” on this chart (${st.symbol}) — use an id from its drawings entry.` }
    const name = toolName(d.type)
    if (isRetired(d.type) || !controlIdsFor(d.type).includes('saveDefault')) return { why: `That ${name}'s menu has no Save as default, so there's nothing to save from it.` }
    const payload = saveDefaultsPayloadFor(d)
    const next = mergeDrawingDefaults(st.cs?.drawingDefaults, payload)
    return { d, name, payload, next }
  }
  const saysOf = (payload) => {
    const out = []
    if (payload.color) out.push(`colour ${colorName(payload.color)}`)
    if (payload.width) out.push(`width ${payload.width}`)
    if (payload.style) out.push(`${payload.style} line`)
    if (payload.fontSize) out.push(`text size ${payload.fontSize}`)
    const tool = Object.values(payload.byTool || {})[0]
    if (tool && Object.keys(tool).length) out.push(`its own ${Object.keys(tool).length} setting${Object.keys(tool).length === 1 ? '' : 's'}`)
    return out.join(', ')
  }
  registerCapability({
    ...chartCommon,
    name: 'drawing.saveDefaults',
    summary: 'Make ONE drawing\'s style the default for new drawings on ONE chart (the drawing menu\'s "Save as default"): its colour, width, line style, text size and that tool\'s own settings become the chart\'s drawing defaults. Drawings already on the chart do not change. Undo puts the previous defaults back.',
    hints: 'target = the chart the member means (the one showing the drawing); drawing = the id from that symbol\'s drawings entry (the recent one for "this line"). To restyle a drawing itself use drawing.style; to change the defaults by name use chart.setSetting.',
    args: { type: 'object', properties: { drawing: { type: 'string' } }, required: ['drawing'], additionalProperties: false },
    check(st, args) { return defaultsPlan(st, args).why || null },
    apply(st, args) {
      const { next } = defaultsPlan(st, args)
      return sameJson(st.cs?.drawingDefaults, next) ? st : { ...st, cs: { ...st.cs, drawingDefaults: next } }
    },
    describe(b, a, args) {
      if (a.cs === b.cs) return null
      const p = defaultsPlan(b, args)
      if (p.why) return null
      return `Saved the ${p.name}'s style as this chart's drawing default (${a.symbol}): ${saysOf(p.payload)} — new drawings on this chart start with it; the ones already there keep theirs`
    },
    noop: () => 'That style is already this chart\'s drawing default',
  })

  // ── C1-165: a toolbar tool's ★ ──
  const favPlan = (st, { tool, favorite }) => {
    if (!FAVORITE_TOOLS.includes(tool)) return { why: `“${tool}” isn't a drawing tool on the toolbar. The tools are: ${FAVORITE_TOOLS.map(toolName).join(', ')}.` }
    if (typeof favorite !== 'boolean') return { why: `Add the ${toolName(tool)} to your favourites, or take it off?` }
    const on = st.favoriteTools.includes(tool)
    return { on, next: on === favorite ? st.favoriteTools : toggledFavorites(st.favoriteTools, tool) }
  }
  registerCapability({
    ...chartCommon,
    name: 'drawing.favoriteTool',
    summary: 'Star or unstar a DRAWING TOOL as a favourite (the ★ in the drawing toolbar\'s tools menu): starred tools sit on the floating favourites bar on every chart in this browser. Undo puts the favourites back.',
    hints: 'target = the chart whose toolbar they mean (the selected one; the list is the same on every chart); tool = the toolbar tool\'s id; favorite = true to star, false to unstar. Only for a drawing TOOL — flagging or starring a ticker is the watchlist\'s flag (watchlist.setFlag), never this.',
    args: { type: 'object', properties: { tool: { type: 'string', enum: [...FAVORITE_TOOLS] }, favorite: { type: 'boolean' } }, required: ['tool', 'favorite'], additionalProperties: false },
    check(st, args) { return favPlan(st, args).why || null },
    apply(st, args) {
      const { next } = favPlan(st, args)
      return next === st.favoriteTools ? st : { ...st, favoriteTools: next }
    },
    describe(b, a, { tool, favorite }) {
      if (sameJson(a.favoriteTools, b.favoriteTools)) return null
      return favorite
        ? `Added the ${toolName(tool)} to your favourite drawing tools — it's on the floating favourites bar on every chart in this browser`
        : `Took the ${toolName(tool)} off your favourite drawing tools`
    },
    noop: (b, a, { tool, favorite } = {}) => (favorite ? `The ${toolName(tool)} is already a favourite` : `The ${toolName(tool)} isn't a favourite`),
  })
}
