// ── ⛔ STATE RAIL (owner safety principle 2026-11-13: "An additive request must never be treated as permission to replace
// or destroy existing user state.") — the CHART RAIL's sibling (chartRail.js), for everything else in the Charts workspace ──
//
// A DETERMINISTIC check (code, never model instructions) on every PLANNED change, in the same execute hook as the chart rail
// (useAgent railOf: after planning, before anything is written or proposed, on every path — instant, model, composed, deferred,
// approved). It reads what the plan would do to the member's EXISTING state from the plan's own before / after / patch, per
// TARGET KIND (never per action name, so a new action on these kinds is covered without being listed here):
//
//   indicator    an instance removed, its settings overwritten (inputs / style / calc timeframe), the chart's
//                indicators replaced wholesale (a chart template), a saved indicator deleted
//                                                                     indicatorEdits · chart · definitionLibrary
//   drawing      a drawing removed (all of them: cleared), its shape / style / anchors overwritten        drawing
//   drawingBoard a Drawing Board deleted or renamed                                                  drawingBoards
//   watchlist    symbols removed (clear / keep only / unflag), the list deleted, renamed, a note overwritten
//                                                                                         watchlist · flaggedList
//   widget       a widget removed (charts: the chart rail), a widget tab closed, the list / scan a widget
//                already shows replaced, an item in a widget's own list deleted or renamed      board · workspace
//   layout       a saved layout deleted, renamed, or saved over (the open layout's stored arrangement)     layouts
//   layoutBar    a layout unpinned from the Layout bar                                                  layoutDock
//   template     a saved chart / indicator template deleted or saved over          chartTemplates · indicatorTemplates
//
// (not destroying, never refused here: show / hide / lock, reorder, move / resize / re-pane, link colours, switching the
// active layout or Drawing Board — the chart rail guards the charts a layout switch replaces — and every add / create.)
//
// ADDITIVE: when this turn's words (the message, plus the request a pending question carried — useAgent railWordsRef) ASK FOR
// MORE (add / put / include / insert / new / another / more / extra / also / as well / too …, any casing, with or without a
// verb), a destroying effect is refused — the WHOLE plan, nothing written, the reason said — unless the words themselves ask
// for that kind of change:
//   remove · clear · delete   only explicit destroy words (remove / delete / clear / replace / instead / swap / overwrite /
//                             get rid of / erase / wipe / keep only / reset …) — a NEGATED one ("don't remove") never counts
//   replace                   destroy words, or the words that pick what is shown (apply / show / switch / load / use …)
//   overwrite                 destroy words, or a modify verb (change / set / make / turn / rename / edit / move …); a SAVE
//                             over an existing one also by "save", unless the words ask for a NEW one ("save a new layout")
// An effect that cannot be read, or a reader that throws, is refused when the words are additive (fail closed).
//
// Pure: reads the plan and the words; never writes. It never loosens the chart rail — both run, either refuses.
import { instancesOf } from '../components/chart/builder/agentSeams'
import * as nativeRegistry from '../components/chart/engine/nativeRegistry'
import { tickersIn } from './multiChart'
import { matchPosition } from './fastPath'
import { pronounReferent } from './chartRail'

export const STATE_RAIL_MARK = 'state-rail'

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const rowsOf = (cs) => instancesOf(cs, nativeRegistry).filter(r => !r.setting)
const nm = (x) => (x == null ? '' : String(x))

// ── what a plan does to the member's existing state, by target kind ─────────────────────────────────────────────────────
// each effect: { state, type: 'remove' | 'clear' | 'delete' | 'replace' | 'overwrite', name, via? }
const OVERWRITE_OPS = new Set(['setInputs', 'setAppearance', 'setPlotStyle', 'setColor', 'setDotSize'])
// an indicator change read from the Indicators interface's own request (indicatorEdits: `change.request`)
function indicatorOfRequest(req, rows, chartRef = null, chartSymbol = null) {
  const op = req?.op
  const id = req?.instanceId
  const row = (rows || []).find(r => r.instanceId === id)
  const name = row?.name || 'an indicator'
  const what = row ? { defId: row.defId, inputs: row.inputs } : {}
  // id: the exact instance (a pointer at the conversation's subject may restyle only that one)
  const oid = chartRef && id ? `ind:${chartRef}:${id}` : null
  // (H14) the chart's instances before the change: the scope a class noun ("the moving average") is counted in
  const peers = (rows || []).map(r => ({ id: r.instanceId, defId: r.defId, inputs: r.inputs, name: r.name }))
  if (op === 'remove') return [{ state: 'indicator', type: 'remove', name, label: name, id: oid, instanceId: id, peers, chartSymbol: chartSymbol ? String(chartSymbol).toUpperCase() : null, ...what }]
  if (OVERWRITE_OPS.has(op)) return [{ state: 'indicator', type: 'overwrite', name, label: name, id: oid, instanceId: id, peers, ...what }]
  // add / duplicate / copyFrom (a template's indicators) add; setVisible / movePane / setPaneSize / setDisplayTarget /
  // setVisibility / setCalculationTimeframe arrange, show, or pick the bars it computes on — its settings are kept
  if (['add', 'duplicate', 'copyFrom', 'setVisible', 'movePane', 'setPaneSize', 'setDisplayTarget', 'setVisibility', 'setCalculationTimeframe'].includes(op)) return []
  return [{ state: 'indicator', type: 'unreadable', name: `an indicator change (${nm(op) || 'unknown'})` }]
}
// a chart's whole settings blob written (chart kind): its indicator instances before and after
function indicatorOfSettings(before, after) {
  const was = rowsOf(before)
  const now = new Map(rowsOf(after).map(r => [r.instanceId, r]))
  const out = []
  const gone = was.filter(r => !now.has(r.instanceId))
  if (gone.length) {
    // a whole settings blob written that drops instances: the chart's indicator set REPLACED (a chart template) — named by
    // the indicator or by the template that replaces it
    for (const r of gone) out.push({ state: 'indicator', type: 'replace', name: r.name, label: r.name, classes: ['indicator', 'template'] })
  }
  for (const r of was) {
    const n = now.get(r.instanceId)
    // its SETTINGS (inputs) — never its colours: a chart theme repaints the indicators on purpose (chart.applyTheme)
    if (n && !sameJson(settingsOf(r.inputs), settingsOf(n.inputs))) out.push({ state: 'indicator', type: 'overwrite', name: r.name, label: r.name, instanceId: r.instanceId })
  }
  return out
}
// an instance's settings, without its paint (a colour input is the look, which a theme sets)
const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i
const settingsOf = (inputs) => Object.fromEntries(Object.entries(inputs || {}).filter(([, v]) => !(typeof v === 'string' && COLOR.test(v))))
const dname = (d) => `the ${nm(d?.type) || 'drawing'}${d?.text ? ` “${d.text}”` : ''}`
const HARMLESS_DRAWING_KEYS = new Set(['hidden', 'locked'])
const contentOf = (opts) => opts?.watchKey ?? opts?.scanKey ?? null
const tabIds = (w) => (Array.isArray(w?.wtabs) ? w.wtabs.map(t => t.id) : [])

const READERS = {
  indicatorEdits(p) {
    const req = p.patch?.change?.request ?? p.after?.change?.request
    if (!p.patch && !p.after?.change) return []
    return indicatorOfRequest(req, p.before?.rows || p.snap?.rows, p.before?.chartRef || p.snap?.chartRef || null, p.before?.symbol || p.snap?.symbol || null)
  },
  // the member's own saved indicator definitions (the Indicators library): a delete
  definitionLibrary(p) {
    const pl = p.patch?.action?.plan
    if (!pl) return []
    if (pl.op === 'duplicate') return []
    return [{ state: 'indicator', type: pl.op === 'delete' ? 'delete' : 'unreadable', name: `your saved indicator “${nm(pl.preview?.name || pl.defId)}”` }]
  },
  chart(p) {
    if (!p.patch || !('settings' in p.patch) || p.virtual) return []
    return indicatorOfSettings(p.before?.cs, p.patch.settings).map(e => ({ ...e, id: e.instanceId ? `ind:${p.ref}:${e.instanceId}` : null }))
  },
  drawing(p) {
    const pt = p.patch
    if (!pt) return []
    const all = p.before?.drawings || []
    const removed = pt.remove || []
    const out = []
    if (removed.length && removed.length >= all.length && all.length > 1) out.push({ state: 'drawing', type: 'clear', name: `all ${all.length} drawings on ${nm(p.before?.symbol || p.ref)}` })
    else for (const x of removed) out.push({ state: 'drawing', type: 'remove', name: dname(all.find(d => d.id === x.id) || x), id: `draw:${p.ref}:${x.id}`, dtype: (all.find(d => d.id === x.id) || x).type, sameType: all.filter(d => d.type === (all.find(y => y.id === x.id) || x).type).length, inScope: all.length, hidden: !!(all.find(d => d.id === x.id) || x).hidden, hiddenInScope: all.filter(d => d.hidden).length })
    for (const u of pt.update || []) {
      const keys = Object.keys(u.set || {}).filter(k => !HARMLESS_DRAWING_KEYS.has(k))
      const d = all.find(x => x.id === u.id) || {}
      // its own target: which settings / levels of WHICH drawing (a fib level value binds only to that fib)
      if (keys.length) out.push({ state: 'drawing', type: 'overwrite', name: dname(d), id: `draw:${p.ref}:${u.id}`, dtype: d.type, sameType: all.filter(x => x.type === d.type).length, inScope: all.length, hidden: !!d.hidden, hiddenInScope: all.filter(x => x.hidden).length, keys, levels: [...Object.keys(u.set.levels || {}), ...Object.keys(u.set.fills || {}).flatMap(f => f.split('>'))] })
    }
    return out
  },
  drawingBoards(p) {
    const pt = p.patch
    if (!pt) return []
    if (pt.remove) return [{ state: 'drawingBoard', type: 'delete', name: `the Drawing Board “${nm(pt.remove.label)}”` }]
    if (pt.rename) return [{ state: 'drawingBoard', type: 'overwrite', name: `the Drawing Board “${nm(pt.rename.fromLabel)}”` }]
    return []
  },
  watchlist(p) {
    const pt = p.patch
    if (!pt) return []
    const list = `your “${nm(p.before?.name || pt.name)}” watchlist`
    const lid = `list:${p.ref}`
    if (pt.deleteList) return [{ state: 'watchlist', type: 'delete', name: list, id: lid }]
    const out = []
    const rm = pt.remove || []
    const had = (p.before?.items || pt.beforeItems || []).length
    // its own target: the symbols it removes, and the symbols the list holds (a ticker said counts only if it is IN the list)
    const own = { syms: rm.map(x => String(x.sym).toUpperCase()), listSyms: (p.before?.items || pt.beforeItems || []).map(x => String(x.sym).toUpperCase()) }
    if (rm.length && had && rm.length >= had) out.push({ state: 'watchlist', type: 'clear', name: `every symbol in ${list}`, id: lid, listName: nm(p.before?.name || pt.name), ...own })
    else if (rm.length) out.push({ state: 'watchlist', type: 'remove', name: `${rm.map(x => x.sym).join(', ')} from ${list}`, id: lid, listName: nm(p.before?.name || pt.name), ...own })
    if (pt.rename) out.push({ state: 'watchlist', type: 'overwrite', name: `the name of ${list}` })
    for (const n of pt.notes || []) if (nm(n.from).trim()) out.push({ state: 'watchlist', type: 'overwrite', name: `your note on ${n.sym}` })
    return out.map(e => ({ ...e, id: lid }))
  },
  // the Flagged list (a watchlist of its own): an unflag removes the symbol from it
  flaggedList(p) {
    const rm = p.patch?.remove || []
    return rm.length ? [{ state: 'watchlist', type: 'remove', name: `${rm.join(', ')} from your Flagged list`, label: 'Flagged', syms: rm.map(x => String(x).toUpperCase()), listSyms: (p.before?.symbols || []).map(x => String(x).toUpperCase()) }] : []
  },
  board(p) {
    const pt = p.patch
    if (!pt || pt.grid || pt.add) return []                       // chartGrid.set / a new widget: the chart rail reads the grid
    const was = new Map((p.before?.board || []).map(w => [String(w.id), w]))
    const out = []
    for (const id of pt.remove || []) {
      const w = was.get(String(id))
      if (w && w.type !== 'chart') out.push({ state: 'widget', type: 'remove', name: `the ${nm(w.type)} widget` })
    }
    for (const [id, d] of Object.entries(pt.set || {})) {
      const w = was.get(String(id))
      if (!w) continue
      if ('wtabs' in d) {
        const now = new Set((d.wtabs || []).map(t => t.id))
        for (const t of tabIds(w)) if (!now.has(t)) out.push({ state: 'widget', type: 'remove', name: `a tab of the ${nm(w.type)} widget` })
      }
      if ('opts' in d && contentOf(w.opts) != null && contentOf(d.opts) !== contentOf(w.opts)) {
        out.push({ state: 'widget', type: 'replace', widgetType: w.type, to: nm(d.opts?.watchName || d.opts?.scanName || contentOf(d.opts)), name: `what the ${nm(w.type)} widget shows (${nm(w.opts.watchName || w.opts.scanName || contentOf(w.opts))})` })
      }
    }
    for (const o of pt.itemOps || []) {
      if (o.op === 'delete') out.push({ state: 'widget', type: 'remove', name: `“${nm(o.name || o.label)}” in the ${nm(was.get(String(o.widget))?.type) || 'widget'}`, id: `item:${o.widget}:${o.key}:${nm(o.name || o.label)}`, itemName: nm(o.name || o.label), itemKey: o.key })
      else if (o.op === 'rename') out.push({ state: 'widget', type: 'overwrite', name: `“${nm(o.was || o.label)}” in the ${nm(was.get(String(o.widget))?.type) || 'widget'}` })
    }
    return out
  },
  // a new widget (widget.add / widget.addCharts): its patch only ADDS — a removal on it (its Undo's shape) is read as one
  workspace(p) {
    return (p.patch?.remove || []).map(() => ({ state: 'widget', type: 'remove', name: 'a widget' }))
  },
  layouts(p) {
    const pt = p.patch
    if (!pt) return []
    if (pt.remove) return [{ state: 'layout', type: 'delete', name: `your layout “${nm(pt.remove.name)}”` }]
    if (pt.rename) return [{ state: 'layout', type: 'overwrite', name: `the name of your layout “${nm(pt.rename.from)}”` }]
    if (pt.saveCurrent) return [{ state: 'layout', type: 'overwrite', via: 'save', name: `your saved layout “${nm(pt.saveCurrent.name)}”` }]
    return []                                                     // open (the chart rail), saveAs / create / duplicate (new)
  },
  layoutDock(p) {
    const op = p.patch
    return op?.op === 'unpin' ? [{ state: 'layoutBar', classes: ['layoutBar', 'layout'], type: 'remove', name: `“${nm(op.name)}” from the Layout bar` }] : []
  },
  chartTemplates(p) {
    const pt = p.patch
    if (!pt) return []
    return templateDiff(pt.prev, pt.write, 'chart template')
  },
  indicatorTemplates(p) {
    const ch = p.patch
    if (!ch) return []
    if (ch.drop && !ch.put) return [{ state: 'template', type: 'delete', name: `your indicator template “${nm(ch.drop.name)}”` }]
    if (ch.drop && ch.put) return [{ state: 'template', type: 'overwrite', via: 'save', name: `your indicator template “${nm(ch.drop.name)}”` }]
    return []
  },
  // recentlyDeleted.* (2026-11-19): a restore only ADDS (it recreates a deleted item under its old id; nothing existing is
  // replaced). Its Undo / compensation (`sendBack`, never planned from words) deletes what it brought back — read as a delete.
  recentlyDeleted(p) {
    return (p.patch?.sendBack || []).filter(it => it.kind === 'watchlist' || it.kind === 'layout')
      .map(it => ({ state: it.kind, type: 'delete', name: `your ${it.kind} “${nm(it.name)}”` }))
  },
  // newsLibrary.* (2026-11-15): the member's UCT News library — a headline taken out (its note and collection places go
  // with it), a NON-EMPTY note replaced, a collection renamed or deleted, a headline taken out of a collection. A save, a
  // first note, an appended note, a new collection and putting a headline in one only add.
  newsLibrary(p) {
    const out = []
    for (const o of p.patch?.ops || []) {
      const hl = o.text ? `the saved headline “${nm(o.text).slice(0, 80)}”` : 'a saved headline'
      const pointed = o.pointed === true
      if (o.op === 'unsave') out.push({ state: 'newsLibrary', type: 'remove', name: `${hl} from your library`, id: o.id ? `news:${o.id}` : null, pointed })
      else if (o.op === 'note' && nm(o.prev).trim() && !(o.mode === 'append' && nm(o.note).startsWith(nm(o.prev)))) out.push({ state: 'newsLibrary', type: 'overwrite', name: `your note on ${hl}`, pointed })
      else if (o.op === 'rename') out.push({ state: 'newsLibrary', type: 'overwrite', name: `the name of your collection “${nm(o.prev)}”`, label: nm(o.prev) })
      else if (o.op === 'delete') out.push({ state: 'newsLibrary', type: 'delete', name: `your collection “${nm(o.name)}”`, label: nm(o.name) })
      else if (o.op === 'place' && o.member === false) out.push({ state: 'newsLibrary', type: 'remove', name: `${hl} from your collection “${nm(o.cname)}”`, label: nm(o.cname), pointed })
    }
    return out
  },
}
function templateDiff(prev, write, what) {
  const now = new Map((write || []).map(t => [nm(t.name).toLowerCase(), t]))
  const out = []
  for (const t of prev || []) {
    const n = now.get(nm(t.name).toLowerCase())
    if (!n) out.push({ state: 'template', type: 'delete', name: `your ${what} “${nm(t.name)}”` })
    else if (!sameJson({ ...t, id: undefined }, { ...n, id: undefined })) out.push({ state: 'template', type: 'overwrite', via: 'save', name: `your ${what} “${nm(t.name)}”` })
  }
  return out
}
export const STATE_KINDS = Object.keys(READERS)

/** Every destroying effect a planned change has on existing state: [{ state, type, name, kind, via? }]. A reader that
 *  throws yields an 'unreadable' effect (refused when the words are additive). */
export function stateEffects(plan, scope = null) {
  const out = []
  for (const p of plan?.plans || []) {
    const f = READERS[p.kind]
    if (!f) continue
    try { for (const e of f(p)) out.push({ ...e, kind: p.kind, ...(e.state === 'watchlist' && scope?.watchlists != null ? { inScope: scope.watchlists } : {}), ...(e.state === 'watchlist' && e.syms && Array.isArray(scope?.lists) ? { holders: scope.lists.filter(l => (l.symbols || []).some(x => e.syms.includes(String(x).toUpperCase()))).map(l => ({ ref: l.ref, name: l.name })) } : {}) }) } catch { out.push({ state: p.kind, type: 'unreadable', name: 'a change I could not read', kind: p.kind }) }
  }
  return out
}

// ── what the member's words say ────────────────────────────────────────────────────────────────────────────────────────
// words that ask for MORE: an add verb, or "new / another / more / also / too …" with no verb at all ("another RSI")
export const STATE_ADDITIVE = /\b(?:add|adds|added|adding|include|includes|included|including|put|puts|putting|insert|inserts|inserting|append|appends|appending|plus|new|another|more|additional|extra|also|as well|too|in addition|one more)\b/i
// a negated word never permits anything: the negation and the rest of its clause are not read ("don't remove or change
// anything", "without deleting", "never replace") — a permission said later in that clause is lost too (fail closed)
const NEGATED = /\b(?:do not|don['’]?t|dont|never|without|no need to|not)\b[^.;,!?]*/gi
const strip = (w) => String(w || '').replace(NEGATED, ' ')
function DESTROY_SRC() { return '(?:replac\\w*|instead|swap\\w*|remov\\w*|delet\\w*|clear\\w*|eras\\w*|wip(?:e|es|ed|ing)\\b|get rid|gets rid|getting rid|overwrit\\w*|keep only|only keep|keep just|just keep|reset\\w*|trash\\w*|discard\\w*|unpin\\w*|unsav\\w*|unbookmark\\w*|take (?:off|out|away))' }
function MODIFY_SRC() { return '(?:chang\\w*|set|sets|setting|make|makes|making|made|turn\\w*|switch\\w*|updat\\w*|edit\\w*|modif\\w*|renam\\w*|adjust\\w*|bump\\w*|increas\\w*|decreas\\w*|tweak\\w*|recolou?r\\w*|colou?r(?:s|ed|ing)?|paint\\w*|restyl\\w*|move|moves|moved|moving|shift\\w*)' }
const DESTROY = new RegExp(`\\b${DESTROY_SRC()}`, 'i')
const MODIFY = new RegExp(`\\b${MODIFY_SRC()}\\b`, 'i')
// the words that pick what is SHOWN or applied (a widget's list, a chart template)
const PICK = /\b(?:apply|applies|applied|applying|show|shows|showing|display\w*|load\w*|open|opens|use|using|view|switch\w*|change\w*)\b/i
const SAVE = /\b(?:save|saves|saved|saving|update|updates|updated)\b/i
const NEW_ONE = /\b(?:new|another|second|copy|duplicate|as (?:a|an)\b|called|named)\b/i

// ⛔ KIND-MATCHED (AUDIT #1247): a permit word licenses an effect only on the CLASS its own clause names — never every kind.
// "add a 20 EMA, and clear up the layout name confusion" licenses nothing on drawings. A permit word whose clause names no
// class (and not the thing itself by its name) licenses nothing.
export const CLASS = {
  // (an indicator draws LINES too: "add the 50 sma then make that line purple")
  indicator: /\b(?:indicators?|lines?|plots?|studies|study|emas?|smas?|wmas?|rsi|macd|vwap|atr|adx|bollinger\w*|stoch\w*|moving averages?|averages?|mas?|obv|cci|keltner|ichimoku|length|period|lookback|(?:the|my|that) \d{1,3}|\d{1,3}[- ]?(?:day|period|bar|ema|sma))\b/i,
  drawing: /\b(?:drawings?(?! boards?\b)|lines?|trend ?lines?|fib\w*|rays?|rectangles?|texts?|labels?|positions?|avwaps?|levels?|arrows?|channels?|circles?|shapes?|annotations?|horizontals?|verticals?|pitchforks?|measures?|points?|anchors?)\b/i,
  drawingBoard: /\b(?:drawing )?boards?\b/i,
  watchlist: /\b(?:watch ?lists?(?! widgets?\b)|lists?|flagged|flags?|notes?)\b/i,
  widget: /\b(?:widgets?|panels?|tabs?|scanners?|news)\b/i,
  layout: /\b(?:layouts?(?! bar)|arrangements?|workspaces?)\b/i,
  layoutBar: /\b(?:layout bar|the bar|bar)\b/i,
  template: /\btemplates?\b/i,
  // newsLibrary.* (2026-11-15): the member's saved UCT News headlines and their collections. A bare "collection" is NOT
  // this class (a watchlist is a collection too: "retire the Momentum collection") — a collection is named by its own name
  newsLibrary: /\b(?:headlines?|stor(?:y|ies)|articles?|bookmarks?|(?:news|headline) collections?|(?:news )?library)\b/i,
}
const classesOf = (e) => e.classes || [e.state]
const phrase = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const has = (clause, label) => { const p = phrase(label); return !!p && ` ${phrase(clause)} `.includes(` ${p} `) }
// the member's own name for the thing (a list "Tech", a layout "Swing", "RSI (14)") — quoted in the effect, or its label
const labelOf = (e) => e.label || (/“([^”]+)”/.exec(e.name || '') || [])[1] || null
// ⛔ UNIQUE IDENTIFICATION (H14 hotfix 2026-11-14, AUDIT probe 48): an indicator CLASS noun ("the moving average", "the ema",
// "the 50", "the line") licenses a change to an existing indicator ONLY when it describes exactly ONE instance on that chart
// (or the words make it plural: "the moving averages", "all the emas" — every instance it describes). Several → asked, with
// the chart's instances as the choices (kind 'demo'); never a guess. Read from the chart's own rows before the change.
const IND_TYPE = [
  [/\bemas?\b|\bexponential\b/i, (r) => r.defId === 'movingAverage' && String(r.inputs?.maType || '').toLowerCase() === 'ema'],
  [/\bsmas?\b|\bsimple\b/i, (r) => r.defId === 'movingAverage' && String(r.inputs?.maType || '').toLowerCase() === 'sma'],
  [/\bwmas?\b|\bweighted\b/i, (r) => r.defId === 'movingAverage' && String(r.inputs?.maType || '').toLowerCase() === 'wma'],
  [/\b(?:moving averages?|averages?|mas)\b|\bma\b/i, (r) => r.defId === 'movingAverage'],
  [/\brsi\b/i, (r) => r.defId === 'rsi'], [/\bmacd\b/i, (r) => r.defId === 'macd'], [/\bvwap\b/i, (r) => /vwap/i.test(r.defId)],
  [/\batr\b/i, (r) => r.defId === 'atr'], [/\badx\b/i, (r) => r.defId === 'adx'], [/\bbollinger\w*\b|\bbb\b/i, (r) => r.defId === 'bb'],
  [/\bstoch\w*\b/i, (r) => /^stoch/i.test(r.defId)], [/\bobv\b/i, (r) => r.defId === 'obv'], [/\bcci\b/i, (r) => r.defId === 'cci'],
]
const IND_GENERIC = /\b(?:indicators?|lines?|plots?|studies|study)\b/i
const IND_PLURAL = /\b(?:all|both|every|each)\b|\b(?:moving averages|averages|emas|smas|wmas|mas|indicators|lines|plots|studies)\b/i
/** The instances a clause's indicator words describe on this chart → { ids, plural } — or null when it names no indicator. */
export function indicatorsNamed(clause, peers) {
  const c = String(clause || '')
  const rows = Array.isArray(peers) ? peers : []
  const types = IND_TYPE.filter(([re]) => re.test(c))
  const nums = [...c.matchAll(/(?:^|[^#\w.])(\d{1,3})(?![\w.%])/g)].map(m => Number(m[1]))
  const generic = IND_GENERIC.test(c)
  if (!types.length && !generic && !nums.length) return null
  if (!types.length && !generic && !rows.some(r => nums.includes(Number(r.inputs?.period)))) return null
  let hit = types.length ? rows.filter(r => types.some(([, ok]) => ok(r))) : rows
  // each LENGTH said names the instance(s) of that length: "the 9 green and the 20 yellow" names EMA 9 and EMA 20 one by one
  const unique = new Set()
  const byNum = hit.filter(r => nums.includes(Number(r.inputs?.period)))
  if (nums.length && byNum.length) {
    for (const n of new Set(nums)) { const at = byNum.filter(r => Number(r.inputs?.period) === n); if (at.length === 1) unique.add(at[0].id) }
    hit = byNum
  } else if (hit.length === 1) unique.add(hit[0].id)
  return { ids: hit.map(r => r.id), unique, plural: IND_PLURAL.test(c), typed: types.length > 0 }
}
// (H14) a drawing's TYPE noun names it when it is the only one of that type in scope ("the trendline" beside a horizontal and a fib)
const DTYPE_NOUN = { trendline: /\btrend ?lines?\b/i, horizontal: /\bhorizontal(?: lines?)?\b|\bh-?lines?\b/i, vertical: /\bvertical(?: lines?)?\b/i,
  fib: /\bfib\w*\b/i, ray: /\brays?\b/i, rect: /\b(?:box|boxes|rectangles?|rect)\b/i, circle: /\bcircles?\b/i, channel: /\bchannels?\b/i,
  arrow: /\barrows?\b/i, text: /\b(?:notes?|texts?|labels?)\b/i, avwap: /\bavwaps?\b/i, pitchfork: /\bpitchforks?\b/i }
/** Does this clause name the effect's object — its class, or (when it names no OTHER class) its own name? */
export function namesObject(e, clause, why = null) {
  // ⛔ H14: an indicator is named only UNIQUELY (its own words, or a class with one instance / said as plural)
  if (e.state === 'indicator' && e.instanceId && Array.isArray(e.peers)) {
    const n = indicatorsNamed(clause, e.peers)
    if (n) {
      if (n.unique.has(e.instanceId) || (n.plural && n.ids.includes(e.instanceId))) return true
      if (e.subjectNow && n.ids.includes(e.instanceId)) return true
      if (n.ids.includes(e.instanceId) && why) why.demo = true
      if (n.ids.length) return false
      // ⛔ (AUDIT H14 / D31) a TYPE named that this chart does not have ("get rid of the MACD" beside an RSI) names nothing here
      if (n.typed) return false
    }
  }
  const mine = classesOf(e)
  if ((e.state === 'drawing' || e.state === 'watchlist') && e.inScope > 1 && mine.some(c => CLASS[c]?.test(clause))) {
    // ⛔ H14: "the line" / "my list" with several in scope names none of them — its own name (below) still does
    const label = labelOf(e)
    if (label && has(clause, label)) return true
    // (a state the words give narrows the class: "the hidden line" is the one hidden drawing)
    if (e.state === 'drawing' && e.hidden && e.hiddenInScope === 1 && /\bhidden\b/i.test(clause)) return true
    if (e.state === 'drawing' && e.sameType === 1 && (typeNamed(e, clause) || (DTYPE_NOUN[e.dtype] && DTYPE_NOUN[e.dtype].test(clause)))) return true
    return /\b(?:all|both|every|each|them|those|these)\b|\b(?:lines|drawings|lists|watchlists|trend ?lines|fibs|rays|levels)\b/i.test(clause)
  }
  if (mine.some(c => CLASS[c]?.test(clause))) return true
  if (Object.keys(CLASS).some(c => !mine.includes(c) && CLASS[c].test(clause))) {
    // its OWN name beside another class ("delete the Paper watchlist look"): which is meant is asked, with both as choices
    const label = labelOf(e) || e.itemName
    if (why && label && has(clause, label)) why.labelOther = { label, classes: Object.keys(CLASS).filter(c => !mine.includes(c) && CLASS[c].test(clause)) }
    return false
  }
  const label = labelOf(e)
  return !!label && (has(clause, label) || phrase(label).split(' ').filter(t => t.length >= 3 && /[a-z]/.test(t)).some(t => has(clause, t)))
}
// clauses: punctuation, "then", "but", and an "and" that starts a new request ("…, and clear …", "add X and remove Y")
const CLAUSES = /\.(?!\d)|[;,!?]|\bthen\b|\bbut\b|\band (?=(?:then |also )?(?:add|put|include|insert|remove|delete|clear|replace|change|set|make|rename|save|show|swap|keep|move|turn|switch|get rid|erase|wipe|reset|overwrite|unpin|colou?r|apply|use|load|open)\b)/i
// ("all but X" / "everything but X" is one object, never two clauses — said as "except" before the split; no lookbehind: iOS 16)
export const clausesOf = (words) => String(words || '').replace(/\b(all|everything|anything|every one) but\b/gi, '$1 except').split(CLAUSES).map(c => c.trim()).filter(Boolean)
// "put Momentum up in my watchlist" / "put the Flagged list in my watchlist widget": a clause that names the LIST a widget is to
// show (its own name) and where — never "put AAPL on my watchlist" (adding a symbol never switches what a widget shows)
const PUT_IN = /\bput\b[^.;!?]*\b(?:in|into|on|up in|up on)\s+(?:the|my|that|this|your)\b[^.;!?]*\b(?:watch ?lists?|widgets?|scanner)\b/i

// the OBJECT a clause names or creates, matched against an effect's own name ("a 20 EMA" names EMA 20, never RSI (14))
const tokens = (s) => phrase(s).split(' ').filter(Boolean)
const namesThatObject = (e, clause) => { const want = tokens(labelOf(e)); const got = new Set(tokens(clause)); return want.length > 0 && want.every(t => got.has(t)) }
// "the Flagged list" / "my Swing list" / "list Swing": the words say it is a LIST
const SAID_LIST = (c, name) => {
  const n = phrase(name).replace(/ /g, '\\s+')
  return new RegExp(`\\b(?:the|my|your)\\s+(?:public\\s+)?${n}\\s+(?:watch ?)?list\\b|\\blist\\s+${n}\\b`, 'i').test(phrase(c))
}
/** A display switch named by a word that is BOTH the list's name and a ticker ("put AI up in my watchlist", a list called
 *  "AI"): which one is meant is asked — never guessed. → the list name, or null. */
export function homograph(e, words) {
  if (e.type !== 'replace' || !e.to) return null
  for (const c of clausesOf(words)) {
    if (!PUT_IN.test(c) || !has(c, e.to) || SAID_LIST(c, e.to)) continue
    if (tickersIn(c).includes(String(e.to).toUpperCase())) return e.to
  }
  return null
}

// ⛔ A PERMIT IS A COMMAND ON A NAMED OBJECT (AUDIT #1247 probe 38 — structural, never a phrase list of what "adding" sounds like):
//   · every destroy / replace / overwrite effect needs one, whatever else the words say (the gate is no longer "the words
//     look additive": slang — "throw an rsi on there", "gimme a widget" — reaches the same wall)
//   · NEGATION voids it: a clause with no / not / nothing / never / without / n't … permits nothing ("delete nothing",
//     "no deleting", "don't remove anything")
//   · the verb's OBJECT must be the thing: a class noun or the instance's own name right after the verb, before any
//     "how / why / what / because / so / if / when" ("clear my drawings" ✓; "clear my head", "delete that thought", "replace
//     my bad habits", "clear up how to add an ema" ✗)
//   · an object that only POINTS ("it", "them", "that one", "the fast one"): an overwrite takes the class the clause before it
//     named; a destroy / replace takes only the very object that clause named or made ("add a 20 EMA, then remove it")
const NEG = /\b(?:no|not|nothing|none|never|without|neither|nor|don['’]?t|dont|doesn['’]?t|didn['’]?t|won['’]?t|can['’]?t|cannot|shouldn['’]?t|mustn['’]?t)\b|n['’]t\b/i
// destroy verbs the member uses for their own things (beyond DESTROY): "drop TSLA from Momentum", "take TSLA off the list",
// "empty the watchlist", "unflag", "close the news tab" — each only with an EXISTING object of the right class after it
const MORE_DESTROY = String.raw`retire\w*|prune\w*|trim\w*|ditch\w*|scrap\w*|purge\w*|axe|axed|drop|drops|dropped|dropping|take (?:\S+ ){0,3}?(?:off|out|away|down)|empty|emptied|unflag\w*|close|closes|closing`
// modify verbs (beyond MODIFY): hide / show a part, drag an anchor, flatten, call it something, thicken
const MORE_MODIFY = String.raw`stretch\w*|extend\w*|shrink\w*|lengthen\w*|shorten\w*|hide|hides|hid|hidden|unhide|drag|drags|dragged|flatten\w*|call|thick\w*|thin\w*|widen\w*|narrow\w*|darken\w*|lighten\w*|bold|italic\w*|move|nudge\w*|bump\w*|raise|lower`
// what picks a widget's CONTENT (its list / scan): show, switch, open, load, go / take back to the picker, pick, exit, leave
const DISPLAY = /^(?:show\w*|switch\w*|open\w*|load\w*|view\w*|display\w*|use|using|apply|change\w*|go(?:es)? back|take (?:\S+ ){0,3}?back|pick\w*|exit\w*|leave\w*|replac\w*|swap\w*|instead)$/i
const VERBS = new RegExp(String.raw`\b(?:${DESTROY_SRC().slice(3, -1)}|${MORE_DESTROY}|take (?:\S+ ){0,3}?back|${MODIFY_SRC().slice(3, -1)}|${MORE_MODIFY}|apply|applies|applied|applying|show|shows|showing|display\w*|load\w*|open|opens|use|using|view|save|saves|saved|saving|update|updates|updated|go(?:es)? back|pick\w*|exit\w*|leave\w*)\b`, 'gi')
const DESTROY_ANY = new RegExp(String.raw`^(?:${DESTROY_SRC().slice(3, -1)}|${MORE_DESTROY})$`, 'i')
const MODIFY_ANY = new RegExp(String.raw`^(?:${MODIFY_SRC().slice(3, -1)}|${MORE_MODIFY})$`, 'i')
const CUT = /\b(?:how|why|what|whether|because|since|so|if|when|while|once|until|unless|in order)\b/i
// an object that only POINTS back at something already there ("it", "them", "that one", "the fast one")
const POINTS = /^(?:it|them|both(?= of them|\s*$)|all of them|(?:the|that|this|these|those) (?:\w+ )?ones?|(?:that|this|these|those)(?=\s*$|\s+(?:to|on|in|into|at|from|with|up|down|over|a|an|the|red|green|blue|yellow|orange|purple|pink|white|black|gr[ae]y|teal|cyan|gold|brown|thicker|thinner|dashed|dotted|solid|bolder|bigger|smaller|wider|narrower|darker|lighter)\b)|(?:the )?(?:first|second|third|fourth|last|other|fast|slow|left|right|top|bottom)\b)/i
// the object ends where its sentence goes elsewhere ("my life WITH an rsi", "the rsi length TO 20"); a container after it stays
// ("nvda FROM my tech watchlist", "spy IN my list"); a SAVE keeps "to / into / as" (its container: "save it to my layout",
// "save these indicators as my Swing Setup template")
const OBJ_END = /\s(?:with|for|by|using|like|as|and|onto|into|to|at|than)\s/i
const SAVE_END = /\s(?:with|for|by|using|like|and|at|than)\s/i
// a NEW object ("a 20 ema", "another line", "some notes"): never an existing one to destroy or change
const INDEFINITE = /^(?:a|an|another|some|any|new|one more|more|extra)\b/i
// a VERBLESS style command on a named / pointed-at object: "the 9 green, the 20 yellow", "fast one green and the slow one yellow"
const STYLE_VALUE = String.raw`(?:red|green|blue|yellow|orange|purple|pink|white|black|gr[ae]y|teal|cyan|gold|brown|thicker|thinner|dashed|dotted|solid|bolder|bigger|smaller|hidden|visible|\d{1,4})`
const VERBLESS = new RegExp(String.raw`(?:^|\s)(?:the\s+)?(?:\w+\s+){0,2}?(?:ones?|\d{1,3}|emas?|smas?|rsi|macd|lines?|fib|trendline|vwap)\s+(?:a\s+)?${STYLE_VALUE}\b`, 'i')
const strengthOf = (verb, e) => {
  if (e.type === 'replace' && e.state === 'widget') return DISPLAY.test(verb) || MODIFY_ANY.test(verb)
  // a save-over is asked for by a SAVE (or "overwrite / replace my layout"), never by a delete of something else
  if (e.via === 'save') return SAVE.test(verb) || /^(?:overwrit\w*|replac\w*)$/i.test(verb)
  if (DESTROY_ANY.test(verb)) return true
  if (e.type === 'replace') return /^(?:apply|applies|applied|applying|use|using|load\w*)$/i.test(verb) && classesOf(e).includes('template')
  if (e.type === 'overwrite') return MODIFY_ANY.test(verb) || PICK.test(verb) || (e.via === 'save' && SAVE.test(verb))
  return false
}
// ── the plan's OWN target, named by what only it has (AUDIT #1247: never "any value / any ticker counts") ──
// a widget's content: named by that widget's own kind (a Watchlist widget by watchlist / list / picker; a Scanner by scan)
const DISPLAY_OF = { watchlist: /\b(?:watch ?lists?|lists?|picker|flagged|widgets?|panels?)\b/i, scanner: /\b(?:scanners?|scans?|picker|widgets?|panels?)\b/i }
const OTHER_WIDGET = { watchlist: /\b(?:scanners?|scans?|news|charts?)\b/i, scanner: /\b(?:watch ?lists?|lists?|news|charts?)\b/i }
const displayNamed = (e, obj) => (DISPLAY_OF[e.widgetType] || /\b(?:widgets?|panels?)\b/i).test(obj) && !(OTHER_WIDGET[e.widgetType] && OTHER_WIDGET[e.widgetType].test(obj))
// a fib level value ("the 78.6", "0.786") names only a level THIS drawing's change touches
const levelOf = (t) => { const n = Number(t); return !Number.isFinite(n) ? null : (n > 1.5 ? n / 100 : n) }
const levelNamed = (e, obj) => {
  const said = (obj.match(/\b\d*\.\d+\b|\b\d{2}\.\d\b/g) || []).map(levelOf).filter(v => v != null)
  return said.length > 0 && said.every(v => (e.levels || []).some(l => Math.abs(Number(l) - v) < 1e-6))
}
// a drawing SETTING ("the arrow size", "its price label", "the font", "the end point") names only a key THIS change sets
const KEY_WORDS = (k) => (k === 'points' ? ['point', 'points', 'anchor', 'corner', 'end', 'start', 'date', 'price', 'top', 'bottom']
  : k === 'levels' ? ['level', 'levels'] : (k === 'bands' || k === 'fills') ? ['band', 'bands', 'fill', 'shade', 'shading', 'shaded']
  // a fill is said as shade / shading too ("shade that box blue")
  : /fill/i.test(k) ? [...String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ').filter(w => w.length >= 3), 'shade', 'shading', 'shaded'] : String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ').filter(w => w.length >= 3))
// (a word said in the plural names the same setting: "the dollars" → showDollar)
const settingNamed = (e, obj) => { const got = new Set(tokens(obj).flatMap(t => [t, t.replace(/s$/, '')])); return (e.keys || []).some(k => KEY_WORDS(k).some(w => got.has(w))) }
// a ticker said for a list counts only if it is IN that list, and the change removes one of them
const symbolsNamed = (e, obj) => {
  if (!e.syms) return false
  const said = [...new Set([...tickersIn(obj), ...tokens(obj).map(t => t.toUpperCase()).filter(t => (e.listSyms || []).includes(t))])]
  return said.length > 0 && said.every(t => (e.listSyms || []).includes(t)) && said.some(t => e.syms.includes(t) || e.type === 'clear' || (e.listSyms || []).length > e.syms.length)
}
// a drawing named by its TYPE ("the box", "the rectangle") binds only when that symbol holds exactly ONE of that type
const TYPE_NOUNS = { rect: /\b(?:box|boxes|rectangles?|rect)\b/i, circle: /\bcircles?\b/i, channel: /\bchannels?\b/i, arrow: /\barrows?\b/i, text: /\b(?:notes?|texts?|labels?)\b/i }
const typeNamed = (e, obj) => !!(e.dtype && TYPE_NOUNS[e.dtype] && TYPE_NOUNS[e.dtype].test(obj) && e.sameType === 1)
// a widget's content named by the very list / scan it is to show ("open Software Over $10")
const toNamed = (e, obj) => !!(e.to && has(obj, e.to))
// ⛔ H14 (AUDIT condition 4): "remove AAPL" with AAPL on two lists names neither — asked, the lists as the choices
const listUnclear = (e, obj, why) => {
  if (e.state !== 'watchlist' || !['remove', 'clear'].includes(e.type) || !Array.isArray(e.holders) || e.holders.length < 2) return false
  if (e.listName && has(obj, e.listName)) return false
  if (why) why.listMany = { syms: e.syms, lists: e.holders }
  return true
}
const namesOwn = (e, obj, why = null) => (listUnclear(e, obj, why) ? false : e.state === 'widget' && e.type === 'replace' ? displayNamed(e, obj) || toNamed(e, obj)
  : namesObject(e, obj, why) || (e.state === 'drawing' && (levelNamed(e, obj) || settingNamed(e, obj) || typeNamed(e, obj))) || symbolsNamed(e, obj))

/** Do this turn's words COMMAND that kind of change on THAT existing object? (per clause, kind-matched, never negated).
 *  `subjects`: the conversation's current subject (exact object ids) — what a pointer at the start of a message means. */
// "from the right one" / "off the bottom two": the positions a pointer is narrowed to
const POS_WORDS = /\b(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)\b/gi
const normPosWord = (w) => w.toLowerCase().replace(/\s/, '-').replace('upper', 'top').replace('lower', 'bottom')
const atPosition = (pos, words) => !!pos && words.some(w => matchPosition([{ position: pos }], normPosWord(w)).length > 0)
// "the one I just made" / "the list I just created": exactly the object this session last made
const JUST_MADE = /\b(?:the )?(?:one|list|watchlist)\s+(?:that\s+)?I\s+(?:just\s+)?(?:made|created|built)\b/i
// "keep this arrangement in my current layout": a save over the layout it names (as "save my layout")
const KEEP_IN_LAYOUT = /\bkeep\b[^.;!?]*\b(?:in|into|to)\s+(?:my|the|this)\s+(?:current\s+|open\s+)?layout\b/i
// (D19) a COUNT the words give ("all five") and the rows an earlier view showed ("the top three")
const NUMBER = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const countOf = (w) => (/^\d{1,3}$/.test(w) ? Number(w) : NUMBER[String(w).toLowerCase()] ?? null)
const ALL_N = /\b(?:all|every one of|each of)\s+(?:the\s+|those\s+|these\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i
const TOP_N = /\b(top|first|bottom|last)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
// the rows a recorded view showed for THIS list (same members as the list holds now: any edit since → no view)
const viewOfList = (views, listSyms) => (views || []).find(v => Array.isArray(v.rows) && v.rows.length && sameSet(v.rows.map(x => String(x).toUpperCase()), listSyms || []))
// "do the same on the other charts": the previous turn's ONE indicator change, repeated on another chart's matching instance
const SAME_OTHER = /\b(?:do|make|apply)?\s*(?:the\s+)?same(?:\s+thing)?\b[^.;!?]*\b(?:other|rest)\b/i
const chartOfId = (id) => String(id || '').split(':')[1] || null
// ⛔ NAMED TARGET IDENTITY (AUDIT H14 · D31 oracle masterGaps, 2026-11-16): a clause that PLACES the thing on a chart by its ticker
// ("the RSI from the SPY chart", "the horizontal line on SPY") never licenses destroying that kind of thing on ANOTHER chart; a clause
// naming a list's rows ("remove AMD from Tech") never licenses removing OTHER rows. (Tickers: tickersIn, the Agent's own reader.)
const PLACE_TICKER = /\b(?:[Oo]n|[Ff]rom|[Oo]ff|[Ii]n|[Oo]f|[Ff]or)\s+(?:(?:the|my)\s+)?\$?([A-Z]{1,5})\b/g
const KEPT_ROWS = /\b(?:except|excluding|but|other than|apart from|keep\w*|leav\w*|only)\b/i
function targetMismatch(e, c) {
  if (!e || e.type === 'overwrite' || e.type === 'replace') return false
  const sym = e.state === 'indicator' ? e.chartSymbol : e.state === 'drawing' && e.id ? String(e.id).split(':')[1] : null
  if (sym) {
    const said = new Set(tickersIn(c))
    const placed = [...String(c).matchAll(PLACE_TICKER)].map(m => m[1]).filter(t => said.has(t))
    if (placed.length && !placed.includes(String(sym).toUpperCase())) return true
  }
  // (a row the clause KEEPS — "all but SPY", "everything except SPY", "keep only SPY" — is no row it removes)
  if (e.state === 'watchlist' && Array.isArray(e.syms) && e.syms.length && Array.isArray(e.listSyms) && !KEPT_ROWS.test(c)) {
    const rows = new Set(e.listSyms.map(x => String(x).toUpperCase()))
    const named = tickersIn(c).filter(t => rows.has(t))
    if (named.length && e.syms.some(x => !named.includes(String(x).toUpperCase()))) return true
  }
  return false
}
// (an earlier clause that MAKES a thing — "add an RSI", "draw a trendline" — is what a destroying pronoun after it stands for)
const MADE_NOW = /\b(?:add|adds|adding|put|puts|putting|insert\w*|include\w*|draw|draws|drawing|create\w*|make|makes|making)\b[^.;!?]*?\b(?:a|an|another|new)\b/i
export function permits(e0, words, subjects = null, previous = null, previousSet = null, made = null, extra = null) {
  // (H14) the conversation's subject — the indicator this conversation just added or changed — is what a class noun said
  // right after means ("…add the 21 EMA and RSI, and make the EMA orange"): it narrows the class to that one instance
  const e = e0 && e0.state === 'indicator' && e0.id && subjects?.has?.(e0.id) ? { ...e0, subjectNow: true } : e0
  const why = extra?.why || {}
  // a PICK the member made from the choices this rail asked with: exactly that object
  if (e.id && extra?.picked && extra.picked.has(e.id)) return true
  // before / prev: the classes and the clause the latest earlier clause NAMED; spoke: an earlier clause said anything of
  // substance (named a thing, or asked for something) — then a pointer speaks of THAT, never of the conversation before
  let before = [], prev = '', spoke = false
  let ref0 = null
  // (a ticker here is no chart: "add AAPL to Tech, then remove it" is the list row — only a chart WORD types the pronoun a chart)
  const referent = () => (ref0 ||= (() => { try { return pronounReferent(words) } catch { return { kind: 'none' } } })())
  const isSubject = () => !!e.id && !!subjects && subjects.has(e.id)
  for (const c of clausesOf(words)) {
    const named = Object.keys(CLASS).filter(k => CLASS[k].test(c))
    const negated = NEG.test(c)
    // a display switch named by the list it shows (never a symbol; a homograph is asked: stateRailRefusal)
    if (!negated && e.type === 'replace' && e.to && PUT_IN.test(c) && has(c, e.to) && (SAID_LIST(c, e.to) || !tickersIn(c).includes(String(e.to).toUpperCase()))) return true
    if (!negated && e.via === 'save' && KEEP_IN_LAYOUT.test(c)) return true
    if (!negated && e.state === 'watchlist' && e.syms && e.listSyms) {
      // "remove all five": the count IS the list's size, and the change removes every one
      const an = ALL_N.exec(c)
      if (an && countOf(an[1]) === e.listSyms.length && sameSet(e.syms, e.listSyms)) return true
      // "remove the top three" / "keep only the top two": the rows the recorded view showed, the list unchanged since
      const tn = TOP_N.exec(c)
      if (tn) {
        const n = countOf(tn[2]), v = viewOfList(extra?.views, e.listSyms)
        if (v && n) {
          const rows = v.rows.map(x => String(x).toUpperCase())
          const pick = /^(?:bottom|last)$/i.test(tn[1]) ? rows.slice(-n) : rows.slice(0, n)
          const keeps = /\bkeep\b/i.test(c)
          if (keeps ? sameSet(e.syms, rows.filter(r => !pick.includes(r))) : sameSet(e.syms, pick)) return true
          why.rows = pick
        } else why.rowsUnknown = true
      }
    }
    if (!negated && e.state === 'indicator' && e.type === 'overwrite' && SAME_OTHER.test(c) && e.defId) {
      // the ONE indicator the previous turn changed, on ANOTHER chart: the instance with the same definition and settings
      const src = (previousSet || []).filter(o => String(o.id).startsWith('ind:'))
      // (matched against what the changed one WAS before the change — "change the 20 to a 50" then "the same" finds the 20s)
      if (src.length === 1 && chartOfId(src[0].id) !== chartOfId(e.id) && src[0].defId === e.defId && sameJson(settingsOf(src[0].beforeInputs || src[0].inputs), settingsOf(e.inputs))) return true
    }
    if (!negated && JUST_MADE.test(c) && e.id && made && made.has(e.id)) return true
    if (!negated && !targetMismatch(e, c)) {
      // a verbless style command ("the 9 green") changes the look of what it names or points at — an overwrite only
      // the conversation's drawing, named by a setting / level / anchor its change sets ("big arrow", "the top was 150",
      // "shade 0.5 to 0.618"): an overwrite of EXACTLY that drawing, never another (the subject bar)
      if (e.type === 'overwrite' && e.state === 'drawing' && !spoke && isSubject() && !named.some(k => k !== 'drawing') && (settingNamed(e, c) || levelNamed(e, c))) return true
      if (e.type === 'overwrite' && VERBLESS.test(c) && (named.length ? namesObject(e, c) : spoke ? classesOf(e).some(k => before.includes(k)) : isSubject())) return true
      for (const m of c.matchAll(VERBS)) {
        if (!strengthOf(m[0], e)) continue
        const saving = e.via === 'save' && SAVE.test(m[0])
        if (saving && NEW_ONE.test(c)) continue                                          // "save a new layout" never saves over one
        // "take NVDA off …" / "take the watchlist back to …": the object sits INSIDE the verb
        const inner = /^take\s+(.*?)\s+(?:off|out|away|down|back)$/i.exec(m[0])?.[1] || ''
        let obj = `${inner} ${c.slice(m.index + m[0].length)}`
        // "use a hull average FOR the 20" / "apply X TO the rsi": a new VALUE, then the object it is for
        const forObj = /^\s*(?:a|an|another|some)\b[^.;!?]*?\s(?:for|to|on)\s+(.*)$/i.exec(obj)
        if (forObj && /^(?:use|using|apply|applies|applied|applying|set|make|change\w*|switch\w*|turn\w*)$/i.test(m[0]) && e.type === 'overwrite') obj = forObj[1]
        const cut = obj.search(CUT)
        if (cut >= 0) obj = obj.slice(0, cut)
        // a display verb's object is where it goes ("go back TO the list picker", "take the watchlist back TO its picker")
        if (e.type === 'replace' && e.state === 'widget') obj = obj.replace(/^\s*(?:to|back to|over to|into)\s+/i, ' ')
        const end = obj.search(saving ? SAVE_END : OBJ_END)
        if (end >= 0) obj = obj.slice(0, end)
        obj = obj.trim().replace(/^(?:up|out|off|away|over|down|of|rid of)\s+/i, '')
        // a widget's content may be switched to a NEW pick ("pick a different list"); nothing else is named by "a …"
        if (!obj) { if (e.type === 'replace' && e.state === 'widget' && displayNamed(e, c)) return true; continue }
        // (a NEW value for one of the change's own settings — "use a large arrow size" — names that setting)
        if (INDEFINITE.test(obj) && !(e.type === 'replace' && e.state === 'widget') && !(e.type === 'overwrite' && e.state === 'drawing' && settingNamed(e, obj))) continue
        // (D19) "that indicator" / "this line" / "those emas": a demonstrative + class noun POINTS at the conversation's subject
        const demo = /^(?:that|this|these|those)\s+/i.test(obj) && Object.keys(CLASS).some(k => CLASS[k].test(obj.split(/\s+/).slice(0, 3).join(' ')))
        if (demo || POINTS.test(obj)) {
          // ⛔ REFERENT TYPE (owner 11-16, AUDIT probe 62 — chartRail pronounReferent, the ONE reader both rails share): a destroying
          // pronoun the words go on past ("take this down a timeframe", "clear it of drawings") destroys nothing; one whose
          // antecedent is a CHART ("the SPY chart — close it") or a thing of another class ("draw a trendline and delete it")
          // never licenses destroying THIS object
          if (e.type !== 'overwrite' && !saving) {
            const ref = referent()
            if (ref.kind === 'cont' || ref.kind === 'chart') continue
            if (ref.kind === 'thing' && ref.word) { const ks = Object.keys(CLASS).filter(k => CLASS[k].test(ref.word)); if (ks.length && !classesOf(e).some(k => ks.includes(k))) continue }
          }
          const rest = demo ? obj.replace(/^(?:that|this|these|those)\s+/i, '') : obj.replace(POINTS, '')
          // "make it orange on the QQQ chart": a pointer narrowed by a class named after it must be that class
          if (named.length && !classesOf(e).some(k => named.includes(k)) && Object.keys(CLASS).some(k => CLASS[k].test(rest))) continue
          if (demo && !classesOf(e).some(k => CLASS[k]?.test(rest))) continue
          // a save names its container after the pointer ("save it to my layout")
          if (saving && namesObject(e, rest)) return true
          // newsLibrary.* (2026-11-15): a headline the member has OPEN (their click) or the one the previous turn named — the
          // library resolved the pointer to exactly that headline, so "unsave that headline" means it (never another)
          if (e.pointed && e.state === 'newsLibrary') return true
          if (!spoke) {
            // the message's first words point at the conversation's CURRENT subject ("make it thicker"): an overwrite of
            // EXACTLY that object (never another of its class); a destroy, a replace or a save-over is asked, never assumed
            if (e.type === 'overwrite' && !saving && isSubject()) return true
            // no subject (or another object): which one is asked, with the chart's own instances as the choices
            if (e.type === 'overwrite' && e.state === 'indicator') why.demo = true
            // a destroy right after: only the ONE object the immediately previous turn made or changed (AUDIT #1247 A)
            if (e.type !== 'overwrite' && !saving && e.id && previous && e.id === previous) return true
            // "remove it from the right one": among what the previous turn made, exactly the one(s) at those positions
            const pw = c.match(POS_WORDS)
            if (e.type !== 'overwrite' && !saving && e.id && pw && (previousSet || []).some(o => o.id === e.id && atPosition(o.position, pw))) return true
            // several made: which one is asked, with them as the choices (never acted on as a guess)
            if (e.type !== 'overwrite' && !saving && (previousSet || []).length > 1 && (previousSet || []).some(o => o.id === e.id)) why.previousMany = true
            continue
          }
          // after words of its own: an overwrite takes the class they named; a destroy / replace only the very object they
          // named or made ("add a 20 EMA, then remove it"); a widget's content, the list those words made ("make me a
          // watchlist … and open it")
          // ⛔ (D31 oracle rm-appB-011, AUDIT 11-16 ruling — supersedes the #1247 allowance) "add an RSI, then delete it": the pronoun is
          // the one this turn MAKES — a destroy of a PRE-EXISTING instance is never licensed by it
          if (e.type !== 'overwrite' && e.type !== 'replace' && MADE_NOW.test(prev) && !(made && e.id && made.has(e.id))) continue
          const prevInd = e.state === 'indicator' && e.instanceId && Array.isArray(e.peers) ? indicatorsNamed(prev, e.peers) : null
          if (prevInd) { if (prevInd.unique.has(e.instanceId) || (prevInd.plural && prevInd.ids.includes(e.instanceId))) return true; if (prevInd.ids.includes(e.instanceId)) why.demo = true; continue }
          if (classesOf(e).some(k => before.includes(k)) && (e.type === 'overwrite' || namesThatObject(e, prev))) return true
          if (e.type === 'replace' && e.state === 'widget' && before.includes('watchlist') && /\b(?:make|makes|made|create\w*|build\w*|new)\b/i.test(prev)) return true
          continue
        }
        if (namesOwn(e, obj, why)) return true
        if (e.type !== 'overwrite') namesObject(e, obj, why)
      }
    }
    if (named.length) { before = named; prev = c }
    if (named.length || STATE_ADDITIVE.test(c) || new RegExp(VERBS.source, 'i').test(c)) spoke = true
  }
  return false
}
export const isStateAdditive = (words) => STATE_ADDITIVE.test(String(words || ''))

const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const VERB = { remove: 'remove', clear: 'clear', delete: 'delete', replace: 'replace', overwrite: 'change', unreadable: 'change' }
const said = (e) => `${VERB[e.type] || 'change'} ${e.name}`

// ⛔ A REFUSED BUNDLE (AUDIT #1247): the parts of the plan that only ADD were not done either — said by name, so a member is
// never left thinking the add landed ("Nothing was changed: I didn't add AAPL to Tech either — say …")
const PAST = { added: 'add', drew: 'draw', created: 'create', saved: 'save', opened: 'open', put: 'put', placed: 'place', copied: 'copy',
  duplicated: 'duplicate', pinned: 'pin', set: 'set', showed: 'show', flagged: 'flag', made: 'make', applied: 'apply', moved: 'move' }
const plainName = (s) => String(s || '').replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim()
function asked(line) {
  const t = plainName(line)
  const m = /^(\w+)\s+(.*)$/.exec(t)
  const v = m && PAST[m[1].toLowerCase()]
  return v ? `${v} ${m[2]}` : null
}
/** The ADD parts of a plan the rail refused (each plan with no destroying effect of its own, by its own lines). */
export function notDoneAdds(plan, alsoBlocked = () => false) {
  const out = []
  for (const p of plan?.plans || []) {
    let mine = []
    try { mine = stateEffects({ ok: true, plans: [p] }) } catch { mine = [{}] }
    if (mine.length || alsoBlocked(p)) continue
    for (const l of p.lines || []) { const a = asked(l); if (a && !out.includes(a)) out.push(a) }
  }
  return out
}
export const notDoneLine = (adds) => (adds.length
  ? ` Nothing was changed: I didn’t ${listOf(adds)} either — say “${adds[0]}” on its own to have just that done.`
  : '')

/**
 * The refusal sentence for a plan the STATE rail stops, or null. `words`: this turn's words (the message, and the request
 * a pending question carried). Every mode (apply / propose / approved): an additive request never reaches a card that
 * destroys either. Fails closed: anything that throws while reading an additive request's plan refuses it.
 */
/**
 * (D19) What the rail decides for a plan: null (it may run), { card: true } (an irreversible save-over: its approval card IS the
 * confirmation — never a bare ask, never a silent save), or { text, ask? } — refused, with what to ask: `previous` (which of
 * the objects the previous turn made), `demo` (which instance a demonstrative means), `label` (which kind of thing a name
 * means), `rows` (the rows an earlier view showed).
 */
export function stateRailDecision(plan, ctx = {}) {
  const { mode = 'apply' } = ctx
  if (!plan?.ok || mode === 'approved') return null
  let effects
  try { effects = stateEffects(plan, ctx.scope) } catch { return { text: 'I didn’t change anything: I couldn’t check what this would remove or change. Ask again, or say exactly what to replace or remove.' } }
  if (!effects.length) return null
  const text = stateRailRefusal(plan, ctx)
  // a save-over the words do not ask for in so many words goes to its CARD (as before the state rail)
  const saves = effects.filter(e => e.via === 'save')
  const ok = (e) => permits(e, String(ctx.words || ''), ctx.subjects, ctx.previous, ctx.previousSet, ctx.made, ctx)
  // (said in so many words — "save my layout" — it runs as it always has; otherwise its card asks first)
  if (saves.length && effects.every(e => e.via === 'save' || ok(e))) return saves.every(ok) ? null : { card: true }
  if (!text) return null
  const why = {}
  for (const e of effects) if (e.via !== 'save') permits(e, String(ctx.words || ''), ctx.subjects, ctx.previous, ctx.previousSet, ctx.made, { ...ctx, why })
  const first = effects.find(e => e.via !== 'save' && !permits(e, String(ctx.words || ''), ctx.subjects, ctx.previous, ctx.previousSet, ctx.made, ctx)) || effects[0]
  if (why.listMany) {
    const names = why.listMany.lists.map(l => `“${l.name}”`)
    return { text: `${listOf(why.listMany.syms)} ${why.listMany.syms.length === 1 ? 'is' : 'are'} on ${listOf(names)} — which list should I remove ${why.listMany.syms.length === 1 ? 'it' : 'them'} from? Nothing was changed.`, ask: { kind: 'lists', lists: why.listMany.lists } }
  }
  const ask = why.previousMany ? { kind: 'previous' } : why.demo ? { kind: 'demo', effect: first } : why.labelOther ? { kind: 'label', effect: first, ...why.labelOther } : why.rows ? { kind: 'rows', rows: why.rows } : null
  if (ask?.kind === 'rows') return { text: `I didn’t change anything: your list has changed since I showed it, so I can’t be sure which ones you mean. The top ones it showed were ${listOf(ask.rows)} — say them by name (for example “remove ${listOf(ask.rows)}”).`, ask }
  return { text, ask }
}
export function stateRailRefusal(plan, { words = '', mode = 'apply', subjects = null, previous = null, previousSet = null, made = null, views = null, picked = null, scope = null } = {}) {
  if (!plan?.ok) return null
  // an APPROVED card was shown, naming what it removes or changes, to the member who approved it (and its binding is checked
  // before it runs): the card is the permit. Every other path — instant, model, proposal, composed, deferred — needs the words.
  if (mode === 'approved') return null
  const w = String(words || '')
  try {
    const effects = stateEffects(plan, scope)
    if (!effects.length) return null
    const amb = effects.map(e => homograph(e, w)).find(Boolean)
    if (amb) return `Do you mean your “${amb}” list, or the ticker ${String(amb).toUpperCase()}? Nothing was changed — say “show my ${amb} list” to switch the widget to it, or “add ${String(amb).toUpperCase()} to my watchlist” to add the symbol.${notDoneLine(notDoneAdds(plan))}`
    // (a save-over is never refused here: it goes to its card — stateRailDecision)
    const bad = effects.filter(e => e.via !== 'save' && !permits(e, w, subjects, previous, previousSet, made, { views, picked }))
    if (!bad.length) return null
    const what = listOf([...new Set(bad.map(said))])
    const lead = isStateAdditive(w) ? `you asked to add, but this would ${what}. Adding never replaces or removes what you already have` : `this would ${what}, and you didn’t ask for that`
    return `I didn’t change anything: ${lead} — say what to replace, remove or change, by name (for example “remove the RSI”), if that is what you want.${notDoneLine(notDoneAdds(plan))}`
  } catch {
    return 'I didn’t change anything: I couldn’t check what this would remove or change. Ask again, or say exactly what to replace or remove.'
  }
}

// ── THE CONVERSATION'S SUBJECT (AUDIT #1247): exact object ids, read from the conversation memory (agent/memory.js) and the
// drawing last drawn or changed — what a pointer at the start of a message may restyle, and the one object "remove it"
// right after may destroy. Pure: useAgent hands in its memory, the board epoch and the last-touched drawing ──
/** The subject NOW: the indicator(s) the latest adding / editing turns touched, what the latest turn acted on (its copies
 *  included), the drawing last touched. */
export function subjectIdsOf(memory, epoch = null, drawing = null) {
  const out = new Set()
  try {
    const ind = (x) => { if (x?.chart && x.instanceId) out.add(`ind:${x.chart}:${x.instanceId}`) }
    ind(memory?.subject?.('indicator', epoch))
    for (const x of [...(memory?.indicatorSet?.(epoch) || []), ...(memory?.priorIndicatorSet?.(epoch) || []), ...(memory?.mentioned?.(epoch) || [])]) ind(x)
  } catch { /* no subject */ }
  if (drawing?.sym && drawing.id) out.add(`draw:${drawing.sym}:${drawing.id}`)
  return out
}
/** The ONE object the immediately previous turn made or changed (null when it made two or more, or none). */
export function previousObjectsOf(memory, epoch = null, drawing = null) {
  try {
    const t = memory?.lastTurn?.(epoch)
    if (!t?.ops?.length) return []
    const acts = t.ops.map(o => String(o.action))
    if (acts.every(a => a.startsWith('indicator.'))) return (memory.indicatorSet?.(epoch) || []).map(x => `ind:${x.chart}:${x.instanceId}`)
    if (acts.every(a => a.startsWith('drawing.')) && t.ops.length === 1) return drawing?.sym && drawing.id ? [`draw:${drawing.sym}:${drawing.id}`] : []
    // a list the previous turn acted on, alone ("rename the one I just made …" → "delete that one")
    if (acts.every(a => a.startsWith('watchlist.') && a !== 'watchlist.create')) { const refs = [...new Set(t.ops.map(o => String(o.target)))]; return refs.length === 1 ? [`list:${refs[0]}`] : [] }
  } catch { /* none */ }
  return []
}
export function previousObjectOf(memory, epoch = null, drawing = null) {
  const all = previousObjectsOf(memory, epoch, drawing)
  return all.length === 1 ? all[0] : null
}
/** What the member's NEW turn starts from: the subject as it is when they speak — never an earlier turn's carried over. */
export const turnStartOf = (memory, epoch = null, drawing = null, host = null) => {
  if (!host) return { ids: subjectIdsOf(memory, epoch, drawing), previous: previousObjectOf(memory, epoch, drawing), previousAll: previousObjectsOf(memory, epoch, drawing), candidates: [] }
  // (D19) with the board: only what the previous APPLIED turn made / changed and is still there, unchanged
  const candidates = previousCandidatesOf(memory, epoch, drawing, host)
  return { ids: subjectIdsOf(memory, epoch, drawing), previous: candidates.length === 1 ? candidates[0].id : null, previousAll: candidates.map(c => c.id), candidates, views: appliedViewsOf(memory) }
}
/** The next turn's start, given the last one's: the subject NOW only — what an earlier turn's start held never carries over
 *  ("copies from an earlier turn" are not the subject; only what the latest turns touched). */
export const nextTurnSubjects = (prevStart, memory, epoch = null, drawing = null, host = null) => { void prevStart; return turnStartOf(memory, epoch, drawing, host) }

// ── (D19) WHAT THE PREVIOUS APPLIED TURN MADE OR CHANGED — still present and unchanged since, ref-matched (AUDIT rule i) ──
// noteApplied is called when a turn's change lands (useAgent rememberChange): each object it made / changed is recorded with a
// fingerprint of how it stood then. At the member's next message, previousCandidatesOf keeps only those whose fingerprint is
// the same NOW (a member edit, or a delete, since → not that object any more). With `host` (the board) — pure otherwise.
const APPLIED = new WeakMap()
const rowFp = (host, chart, instanceId) => { try { const r = indicatorRowsOf(host?.charts?.read?.(chart)?.cs).find(x => x.instanceId === instanceId); return r ? JSON.stringify([r.defId, r.inputs, r.presentation, r.hidden]) : null } catch { return null } }
const indicatorRowsOf = (cs) => { try { return instancesOf(cs, nativeRegistry).filter(r => !r.setting) } catch { return [] } }
const chartFp = (host, ref) => { try { const c = host?.charts?.read?.(ref); return c ? JSON.stringify([c.ref, c.symbol]) : null } catch { return null } }
const drawFp = (host, sym, id) => { try { const d = host?.drawings?.read?.(sym)?.drawings?.find(x => x.id === id); return d ? JSON.stringify(d) : null } catch { return null } }
/** Every object the previous turn made or changed, as { id, label, kind, remove (the op that removes exactly it), fp() }. */
function rawCandidates(memory, epoch, drawing, host) {
  const out = []
  try {
    const t = memory?.lastTurn?.(epoch)
    if (!t?.ops?.length) return out
    const acts = t.ops.map(o => String(o.action))
    // charts a widget add made
    for (const o of t.ops) {
      if (!/^widget\.add/.test(String(o.action))) continue
      const c = host?.charts?.read?.(String(o.target))
      if (c) out.push({ id: `chart:${c.ref}`, label: `the ${c.symbol || ''} chart`.replace(/\s+/g, ' '), remove: { action: 'widget.remove', target: 'board', args: { widget: c.ref } }, fp: () => chartFp(host, c.ref) })
    }
    // indicators: the exact instance each op of the turn changed, and what its adds made (the memory's set for that turn)
    const seen = new Set()
    for (const o of t.ops) {
      const chart = String(o.target || '').replace(/^ixe:/, '')
      if (!/^(?:indicator|indicatorStyle|indicatorCopy|pane)\./.test(String(o.action)) || typeof o.args?.instance !== 'string') continue
      const rows = indicatorRowsOf(host?.charts?.read?.(chart)?.cs)
      // by id, or by the portable form an instant edit names it with ("#20:ema": the ONE average of that length and type)
      const pm = /^#(\d{1,4})(?::(\w+))?$/.exec(o.args.instance)
      // (a settings change renamed it: "#20:ema" names what it WAS — read against the rows before the change)
      const beforeRows = beforeRowsOf(memory, chart) || rows
      const byLen = pm ? beforeRows.filter(r => r.defId === 'movingAverage' && Number(r.inputs?.period) === Number(pm[1]) && (!pm[2] || String(r.inputs?.maType) === pm[2])) : []
      const hitId = rows.find(r => r.instanceId === o.args.instance)?.instanceId || (byLen.length === 1 ? byLen[0].instanceId : null)
      const row = hitId ? rows.find(r => r.instanceId === hitId) : null
      if (!row || seen.has(`${chart}:${row.instanceId}`)) continue
      seen.add(`${chart}:${row.instanceId}`)
      const was = (beforeRowsOf(memory, chart) || []).find(r => r.instanceId === row.instanceId)
      out.push({ id: `ind:${chart}:${row.instanceId}`, label: `the ${row.name}`, defId: row.defId, inputs: row.inputs, beforeInputs: was?.inputs || null,
        remove: { action: 'indicator.remove', target: `ixe:${chart}`, args: { instance: row.instanceId } }, fp: () => rowFp(host, chart, row.instanceId) })
    }
    if (acts.some(a => a === 'indicator.add' || a.startsWith('indicatorCopy.'))) {
      for (const x of (memory.indicatorSet?.(epoch) || []).filter(x => !seen.has(`${x.chart}:${x.instanceId}`))) {
        const row = indicatorRowsOf(host?.charts?.read?.(x.chart)?.cs).find(r => r.instanceId === x.instanceId)
        out.push({ id: `ind:${x.chart}:${x.instanceId}`, label: `the ${row?.name || x.label || 'indicator'}`, defId: row?.defId, inputs: row?.inputs,
          remove: { action: 'indicator.remove', target: `ixe:${x.chart}`, args: { instance: x.instanceId } }, fp: () => rowFp(host, x.chart, x.instanceId) })
      }
    }
    if (acts.every(a => a.startsWith('drawing.')) && t.ops.length === 1 && drawing?.sym && drawing.id) {
      out.push({ id: `draw:${drawing.sym}:${drawing.id}`, label: 'that drawing', remove: { action: 'drawing.remove', target: drawing.sym, args: { drawing: drawing.id } }, fp: () => drawFp(host, drawing.sym, drawing.id) })
    }
    if (acts.every(a => a.startsWith('watchlist.') && a !== 'watchlist.create')) {
      const refs = [...new Set(t.ops.map(o => String(o.target)))]
      if (refs.length === 1) out.push({ id: `list:${refs[0]}`, label: 'that list', remove: null, fp: () => 'list' })
    }
  } catch { /* none */ }
  return out
}
/** Record how the objects of the turn that just landed stand now (the bar a later "it" is checked against). */
export function noteApplied(memory, epoch = null, drawing = null, host = null) {
  if (!memory || !host) return
  try {
    const t = memory.lastTurn?.(epoch)
    const fps = new Map(rawCandidates(memory, epoch, drawing, host).map(c => [c.id, c.fp()]))
    // …and the rows each list view shows now ("the top three" next turn means THESE rows)
    let views = []
    try { views = (host.listViews?.snapshot?.() || []).map(v => ({ ref: v.ref, rows: [...(v.rows || [])] })) } catch { views = [] }
    APPLIED.set(memory, { turn: t?.id ?? null, fps, views })
  } catch { /* best effort */ }
}
/** The previous turn's objects that are STILL PRESENT and UNCHANGED since it landed (no host: the old, memory-only reading). */
export function previousCandidatesOf(memory, epoch = null, drawing = null, host = null) {
  const all = rawCandidates(memory, epoch, drawing, host)
  if (!host) return all
  const rec = APPLIED.get(memory)
  const t = memory?.lastTurn?.(epoch)
  if (!rec || rec.turn !== (t?.id ?? null)) return []
  return all.filter(c => { const was = rec.fps.get(c.id); const now = c.fp(); return was != null && now != null && was === now })
}
// (D19) each chart's indicator rows as they stood just BEFORE the latest change landed on it — "do the same on the other charts"
// after "change the 20 to a 50" finds the other charts' EMA 20 (what the changed one WAS), never the 50 it became
const BEFORE = new WeakMap()
/** Record, for a plan that is about to land, every chart's indicator rows before it (indicatorEdits plans' own `before`). */
export function noteBeforeRows(memory, plan) {
  if (!memory || !plan?.plans) return
  try {
    const by = new Map(BEFORE.get(memory) || [])
    for (const p of plan.plans) if (p.kind === 'indicatorEdits' && p.before?.chartRef && Array.isArray(p.before.rows)) by.set(String(p.before.chartRef), p.before.rows.map(r => ({ instanceId: r.instanceId, defId: r.defId, name: r.name, inputs: r.inputs })))
    BEFORE.set(memory, by)
  } catch { /* best effort */ }
}
/** That chart's rows as they stood before the latest change on it (null when none was recorded). */
export const beforeRowsOf = (memory, chart) => { try { return BEFORE.get(memory)?.get(String(chart)) || null } catch { return null } }
/** The list rows the last applied turn left on screen. */
export const appliedViewsOf = (memory) => APPLIED.get(memory)?.views || []
