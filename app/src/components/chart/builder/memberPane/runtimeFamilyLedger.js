// app/src/components/chart/builder/memberPane/runtimeFamilyLedger.js
//
// ─── ⭐⭐ THE FAMILY LEDGER: EVERY FAMILY A SCRIPT DRAWS IS DRAWN OR NAMED (2026-11-19) ─────────────────────
//
// THE CLASS (coordinator ruling, 2026-11-19, after the silent-partial probe): a document drawn bar by bar
// named what it did not draw only where some branch of the door had been written to say it: a withheld row,
// a withheld paint, a fill or `hline` the host listed. Everything else it left out said nothing, and the
// member read the chart as the whole script. Measured: market-structure-with-inducements-sweeps-luxalgo
// (two plots drawn; its lines and labels, 38 objects on TradingView, not drawn and not named: the run's
// drawing build refused on `color(na)`, the host translation held no object program, and no branch spoke).
//
// ⭐ THE ANSWER IS ONE LEDGER AT THE END OF THE DOOR, NOT ONE MORE BRANCH. What the script DECLARES is read
// from its source with the engine's own vocabulary (`pine.js::CHART_DRAWING_CALLS`, the object families of
// `objectProgram.js` and `objectPool.js`); what the document DRAWS and what its notes already NAME are told
// by the door; anything declared, neither drawn, named nor hidden by its author, is named here.
// ⛔ Never a hand list of scripts or of families per script: a family the vocabulary gains is ledgered the
// moment it is added (`runtimeFamilyLedger.test.js` fails until it has a member's word).
import { strippedForScan, CHART_DRAWING_CALLS } from '../../engine/ast/pine'
import { OBJECT_FAMILIES } from '../../engine/ast/objectProgram'
import { OBJECT_KINDS } from '../../engine/objectPool'

/** Every drawing-object family a script can create with `<family>.new(…)`. */
export const OBJECT_DRAWING_FAMILIES = Object.freeze([...new Set([...OBJECT_FAMILIES, ...OBJECT_KINDS])])

/** The member's word for each family, as the note says it. The four the runtime door named before the ledger (`fill`,
 *  `hline`, `bgcolor`, `barcolor`) keep the door's own words (`memberPaneDefinition.js::RUNTIME_UNDRAWN_KINDS`), so
 *  they are not restated here; `familyWord` there answers for every family. */
export const FAMILY_WORDS = Object.freeze({
  plot: 'plotted lines (`plot`)',
  plotshape: 'shapes (`plotshape`)',
  plotchar: 'characters (`plotchar`)',
  plotarrow: 'arrows (`plotarrow`)',
  plotcandle: 'candles (`plotcandle`)',
  plotbar: 'bars (`plotbar`)',
  line: 'lines (`line.new`)',
  label: 'labels (`label.new`)',
  box: 'boxes (`box.new`)',
  table: 'tables (`table.new`)',
  linefill: 'fills between lines (`linefill.new`)',
  polyline: 'polylines (`polyline.new`)',
})

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ⛔ NO LOOKBEHIND: Safari before 16.4 throws a SyntaxError on one, and the declared floor is iOS 16 (the whole
// module would fail to load on an older iPhone). The character before the name is matched as a group instead: the
// start of the text, or anything that is not part of a name or a namespace (`myplot(`, `m.plot(` never count).
const CALL_RX = new Map(CHART_DRAWING_CALLS.map((c) => [c, new RegExp(`(?:^|[^\\w.])${esc(c)}\\s*\\(`)]))
const NEW_RX = new Map(OBJECT_DRAWING_FAMILIES.map((f) => [f, new RegExp(`(?:^|[^\\w.])${esc(f)}\\s*\\.\\s*new\\s*\\(`)]))

/** The families a script's SOURCE declares: every chart-drawing call and every `<family>.new(` outside comments and
 *  strings, in vocabulary order. */
export function declaredFamiliesOf(source) {
  const s = strippedForScan(String(source || ''))
  const out = []
  for (const [c, rx] of CALL_RX) if (rx.test(s)) out.push(c)
  for (const [f, rx] of NEW_RX) if (rx.test(s)) out.push(f)
  return out
}

/** The families every one of whose translated elements its AUTHOR hid (`display = display.none`, a paint coloured
 *  `na` or hidden; a run output the run lowered as hidden, as a fill with `display.none` or `color = na` is): TradingView
 *  draws none of them either, so there is nothing to name. A family no record holds is never "hidden": what is not known
 *  is named. */
export function authorHiddenFamiliesOf(t, runOutputs = null) {
  const per = new Map()
  const add = (kind, hidden) => {
    if (!kind) return
    const e = per.get(kind) || { all: 0, hidden: 0 }
    e.all += 1
    if (hidden) e.hidden += 1
    per.set(kind, e)
  }
  for (const o of (t && t.outputs) || []) add(o && o.kind, !!o && (o._authorHidden === true || o.hiddenReason === 'author'))
  for (const p of ((t && t.presentation) || {}).paints || []) add(p && p.kind, !!p && (p.hidden === true || p.na === true))
  for (const ro of runOutputs || []) {
    add(ro && ro.call, !!ro && (ro.hidden === true || (!!ro.candle && ro.candle.display === 'display.none')))
  }
  return new Set([...per].filter(([, e]) => e.all > 0 && e.hidden === e.all).map(([k]) => k))
}

/**
 * @param {object} a
 * @param {string} a.source
 * @param {object} a.t                 the host translation
 * @param {object[]} [a.runOutputs]    the run's outputs (`probeRuntimeProgram(...).outputs`): a hidden one is the author's
 * @param {Iterable<string>} a.drawn   families the document draws (rows, candles, paints)
 * @param {Iterable<string>} a.named   families a note of the door already names (a withheld row or paint, an undrawn kind)
 * @param {Iterable<string>} [a.authorSkipped] families of elements the door skipped as hidden by their author
 * @param {boolean} a.objectsAccounted the document's drawings are drawn or named as a whole (a carried program, the run's
 *                                     own drawings, or a drawing note)
 * @returns {{declared: string[], drawn: string[], named: string[], hidden: string[], unnamed: string[]}}
 *   `unnamed`: what the door must name now (declared, and neither drawn, named nor author-hidden).
 */
export function runtimeFamilyLedger({ source, t, runOutputs = null, drawn = [], named = [], authorSkipped = [],
  objectsAccounted = false }) {
  const declared = declaredFamiliesOf(source)
  const drawnSet = new Set(drawn)
  const namedSet = new Set(named)
  // what the translation records as its author's hiding, and what the DOOR skipped for that reason (its own rule:
  // a candle hidden by its run's `display`, a row the author hid): neither is drawn on TradingView
  const hidden = new Set([...authorHiddenFamiliesOf(t, runOutputs), ...authorSkipped])
  const objectFamily = new Set(OBJECT_DRAWING_FAMILIES)
  const unnamed = declared.filter((f) => !drawnSet.has(f) && !namedSet.has(f) && !hidden.has(f)
    && !(objectsAccounted && objectFamily.has(f)))
  return {
    declared,
    drawn: declared.filter((f) => drawnSet.has(f) || (objectsAccounted && objectFamily.has(f))),
    named: declared.filter((f) => namedSet.has(f) || unnamed.includes(f)),
    hidden: declared.filter((f) => hidden.has(f)),
    unnamed,
  }
}
