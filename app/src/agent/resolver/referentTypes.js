// ── D31 RESOLVER · THE REFERENT TYPE TABLE (design §2) ───────────────────────────────────────────────────────────────────
// One type system for every object a destroying op can target. A TypedRef is { type, id } with the id scheme the rails
// already use (stateRail's typed ids): chart:<ref> · ind:<chart>:<instance> · draw:<symbol>:<id> · list:<ref> · item:<ref>:<SYM>.
//
// REFERENT_TYPES maps each registered TARGET KIND (capabilities.registerTargetKind) to the RefType(s) its ops act on — the
// analogue of chartSettingsDescriptors.js: metadata a completeness rail walks (referentTypes.test.js fails any destructive
// capability whose kind has no row). Each row's `nouns` is a vocabulary IMPORTED from the reader that already owns it
// (stateRail CLASS, deixis thingWord / chartishWord) — never a copy.
import { CLASS } from '../stateRail'
import { chartishWord } from '../deixis'

/** The closed RefType enum (design §2; `screen` = a saved screener screen). */
export const REF_TYPES = Object.freeze(['chart', 'indicator', 'drawing', 'drawingBoard', 'list', 'headline', 'collection', 'layout', 'template', 'alert', 'widget', 'screen'])

// (alerts have no class noun in stateRail CLASS — the alert capabilities' own object word; the only vocabulary row here)
const ALERT_NOUN = /\b(?:alerts?|alarms?)\b/i
const SCREEN_NOUN = /\b(?:screens?|scans?|screeners?)\b/i
const CHART_NOUN = { test: (s) => String(s || '').toLowerCase().split(/[^a-z]+/).some(chartishWord) }

/** The nouns that name an object of each type (imported vocabularies). */
export const NOUNS = Object.freeze({
  chart: CHART_NOUN, indicator: CLASS.indicator, drawing: CLASS.drawing, drawingBoard: CLASS.drawingBoard, list: CLASS.watchlist,
  layout: CLASS.layout, template: CLASS.template, widget: CLASS.widget, alert: ALERT_NOUN, screen: SCREEN_NOUN,
})

/** target kind → { types, note }. A kind whose ops can destroy MORE than one type lists each. */
export const REFERENT_TYPES = Object.freeze({
  chart: { types: ['chart', 'indicator'], note: 'symbol / settings of one chart; a settings blob can drop its indicators' },
  board: { types: ['chart', 'widget'], note: 'widget.remove / chartGrid.set: a chart widget or another widget' },
  multiChart: { types: ['chart'], note: 'Multi Chart cells' },
  layouts: { types: ['layout', 'chart'], note: 'a saved layout; opening one replaces the charts on screen' },
  layoutDock: { types: ['layout'], note: 'the Layout bar' },
  workspace: { types: ['widget', 'chart'], note: 'widget.add / widget.addCharts' },
  indicatorEdits: { types: ['indicator'], note: 'an indicator instance on a chart' },
  indicatorDrafts: { types: ['indicator'], note: 'an unsaved indicator draft' },
  definitionLibrary: { types: ['indicator'], note: 'a saved indicator definition' },
  drawing: { types: ['drawing'], note: 'drawings on a symbol' },
  drawingBoards: { types: ['drawingBoard'], note: 'a Drawing Board' },
  watchlist: { types: ['list'], note: 'a watchlist, or a row in it (item:<ref>:<SYM>)' },
  watchlistLibrary: { types: ['list'], note: 'the member’s watchlists' },
  flaggedList: { types: ['list'], note: 'the Flagged list' },
  alert: { types: ['alert'], note: 'a price alert' },
  alertLibrary: { types: ['alert'], note: 'the member’s price alerts' },
  indicatorAlert: { types: ['alert'], note: 'an indicator alert' },
  indicatorAlertLibrary: { types: ['alert'], note: 'the member’s indicator alerts' },
  savedScreens: { types: ['screen'], note: 'a saved screener screen' },
  chartTemplates: { types: ['template'], note: 'a chart template' },
  indicatorTemplates: { types: ['template'], note: 'an indicator template' },
  // (#1325 news library — caught by the completeness rail on the 11-16 master merge; the headline family is P3)
  newsLibrary: { types: ['headline', 'collection'], note: 'a saved headline, its note, or a collection (by action)' },
})
for (const [k, row] of Object.entries(REFERENT_TYPES)) for (const t of row.types) if (!REF_TYPES.includes(t)) throw new Error(`referentTypes: ${k} → unknown type ${t}`)

/** The RefType of a typed id. */
export function typeOfId(id) {
  const p = String(id || '').split(':')[0]
  return { chart: 'chart', ind: 'indicator', draw: 'drawing', list: 'list', item: 'list', alert: 'alert', layout: 'layout', tpl: 'template', board: 'drawingBoard', widget: 'widget', screen: 'screen' }[p] || null
}
export const ref = (id) => ({ type: typeOfId(id), id: String(id) })

/** The RefType a single noun (or short noun phrase) names, or null. Thing types before `chart`: "the drawing board" is no chart. */
export function typeOfNoun(np) {
  const s = String(np || '').toLowerCase()
  if (!s.trim()) return null
  if (CLASS.drawingBoard.test(s) && /\bdrawing\b/.test(s)) return 'drawingBoard'
  if (ALERT_NOUN.test(s)) return 'alert'
  // (a drawing TYPE noun outranks the indicator class's own "line": "the horizontal line", "the trendline")
  if (CLASS.drawing.test(s) && !/^(?:the |my |that |this )?lines?$/.test(s.trim()) && !CLASS.indicator.test(s.replace(/\blines?\b/g, ''))) return 'drawing'
  if (CLASS.indicator.test(s)) return 'indicator'
  if (CLASS.drawing.test(s)) return 'drawing'
  if (CLASS.watchlist.test(s)) return 'list'
  if (CLASS.template.test(s)) return 'template'
  if (CLASS.layout.test(s)) return 'layout'
  if (SCREEN_NOUN.test(s)) return 'screen'
  if (CHART_NOUN.test(s)) return 'chart'
  if (CLASS.widget.test(s)) return 'widget'
  return null
}

/**
 * The completeness rail (design §2): every capability that is destructive (risk 'confirm', reversible false) or whose target
 * kind a rail reads (chartRail RAIL_KINDS ∪ stateRail STATE_KINDS) must have a REFERENT_TYPES row. → [{ capability, kind }].
 */
export function untypedCapabilities(capabilities, railKinds = []) {
  const rail = new Set(railKinds)
  return capabilities.filter(c => c && (c.risk === 'confirm' || c.reversible === false || rail.has(c.target)) && !REFERENT_TYPES[c.target])
    .map(c => ({ capability: c.name, kind: c.target }))
}
