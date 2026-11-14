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

export const STATE_RAIL_MARK = 'state-rail'

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const rowsOf = (cs) => instancesOf(cs, nativeRegistry).filter(r => !r.setting)
const nm = (x) => (x == null ? '' : String(x))

// ── what a plan does to the member's existing state, by target kind ─────────────────────────────────────────────────────
// each effect: { state, type: 'remove' | 'clear' | 'delete' | 'replace' | 'overwrite', name, via? }
const OVERWRITE_OPS = new Set(['setInputs', 'setAppearance', 'setPlotStyle', 'setColor', 'setDotSize'])
// an indicator change read from the Indicators interface's own request (indicatorEdits: `change.request`)
function indicatorOfRequest(req, rows) {
  const op = req?.op
  const id = req?.instanceId
  const name = (rows || []).find(r => r.instanceId === id)?.name || 'an indicator'
  if (op === 'remove') return [{ state: 'indicator', type: 'remove', name, label: name }]
  if (OVERWRITE_OPS.has(op)) return [{ state: 'indicator', type: 'overwrite', name, label: name }]
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
    if (n && !sameJson(settingsOf(r.inputs), settingsOf(n.inputs))) out.push({ state: 'indicator', type: 'overwrite', name: r.name, label: r.name })
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
    return indicatorOfRequest(req, p.before?.rows || p.snap?.rows)
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
    return indicatorOfSettings(p.before?.cs, p.patch.settings)
  },
  drawing(p) {
    const pt = p.patch
    if (!pt) return []
    const all = p.before?.drawings || []
    const removed = pt.remove || []
    const out = []
    if (removed.length && removed.length >= all.length && all.length > 1) out.push({ state: 'drawing', type: 'clear', name: `all ${all.length} drawings on ${nm(p.before?.symbol || p.ref)}` })
    else for (const x of removed) out.push({ state: 'drawing', type: 'remove', name: dname(all.find(d => d.id === x.id) || x) })
    for (const u of pt.update || []) {
      if (Object.keys(u.set || {}).some(k => !HARMLESS_DRAWING_KEYS.has(k))) out.push({ state: 'drawing', type: 'overwrite', name: dname(all.find(d => d.id === u.id)) })
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
    if (pt.deleteList) return [{ state: 'watchlist', type: 'delete', name: list }]
    const out = []
    const rm = pt.remove || []
    const had = (p.before?.items || pt.beforeItems || []).length
    if (rm.length && had && rm.length >= had) out.push({ state: 'watchlist', type: 'clear', name: `every symbol in ${list}` })
    else if (rm.length) out.push({ state: 'watchlist', type: 'remove', name: `${rm.map(x => x.sym).join(', ')} from ${list}` })
    if (pt.rename) out.push({ state: 'watchlist', type: 'overwrite', name: `the name of ${list}` })
    for (const n of pt.notes || []) if (nm(n.from).trim()) out.push({ state: 'watchlist', type: 'overwrite', name: `your note on ${n.sym}` })
    return out
  },
  // the Flagged list (a watchlist of its own): an unflag removes the symbol from it
  flaggedList(p) {
    const rm = p.patch?.remove || []
    return rm.length ? [{ state: 'watchlist', type: 'remove', name: `${rm.join(', ')} from your Flagged list` }] : []
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
        out.push({ state: 'widget', type: 'replace', to: nm(d.opts?.watchName || d.opts?.scanName || contentOf(d.opts)), name: `what the ${nm(w.type)} widget shows (${nm(w.opts.watchName || w.opts.scanName || contentOf(w.opts))})` })
      }
    }
    for (const o of pt.itemOps || []) {
      if (o.op === 'delete') out.push({ state: 'widget', type: 'remove', name: `“${nm(o.name || o.label)}” in the ${nm(was.get(String(o.widget))?.type) || 'widget'}` })
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
    return op?.op === 'unpin' ? [{ state: 'layoutBar', type: 'remove', name: `“${nm(op.name)}” from the Layout bar` }] : []
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
export function stateEffects(plan) {
  const out = []
  for (const p of plan?.plans || []) {
    const f = READERS[p.kind]
    if (!f) continue
    try { for (const e of f(p)) out.push({ ...e, kind: p.kind }) } catch { out.push({ state: p.kind, type: 'unreadable', name: 'a change I could not read', kind: p.kind }) }
  }
  return out
}

// ── what the member's words say ────────────────────────────────────────────────────────────────────────────────────────
// words that ask for MORE: an add verb, or "new / another / more / also / too …" with no verb at all ("another RSI")
export const STATE_ADDITIVE = /\b(?:add|adds|added|adding|include|includes|included|including|put|puts|putting|insert|inserts|inserting|append|appends|appending|plus|new|another|more|additional|extra|also|as well|too|in addition|one more|second)\b/i
// a negated word never permits anything: the negation and the rest of its clause are not read ("don't remove or change
// anything", "without deleting", "never replace") — a permission said later in that clause is lost too (fail closed)
const NEGATED = /\b(?:do not|don['’]?t|dont|never|without|no need to|not)\b[^.;,!?]*/gi
const strip = (w) => String(w || '').replace(NEGATED, ' ')
function DESTROY_SRC() { return '(?:replac\\w*|instead|swap\\w*|remov\\w*|delet\\w*|clear\\w*|eras\\w*|wip(?:e|es|ed|ing)\\b|get rid|gets rid|getting rid|overwrit\\w*|keep only|only keep|keep just|just keep|reset\\w*|trash\\w*|discard\\w*|unpin\\w*|take (?:off|out|away))' }
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
  indicator: /\b(?:indicators?|studies|study|emas?|smas?|wmas?|rsi|macd|vwap|atr|adx|bollinger\w*|stoch\w*|moving averages?|averages?|mas?|obv|cci|keltner|ichimoku|length|period|lookback|the \d{1,3})\b/i,
  drawing: /\b(?:drawings?(?! boards?\b)|lines?|trend ?lines?|fib\w*|rays?|rectangles?|texts?|labels?|positions?|avwaps?|levels?|arrows?|channels?|circles?|shapes?|annotations?|horizontals?|verticals?|pitchforks?|measures?)\b/i,
  drawingBoard: /\b(?:drawing )?boards?\b/i,
  watchlist: /\b(?:watch ?lists?(?! widgets?\b)|lists?|flagged|flags?|notes?)\b/i,
  widget: /\b(?:widgets?|panels?|tabs?|scanners?|news)\b/i,
  layout: /\b(?:layouts?(?! bar)|arrangements?|workspaces?)\b/i,
  layoutBar: /\b(?:layout bar|the bar|bar)\b/i,
  template: /\btemplates?\b/i,
}
const classesOf = (e) => e.classes || [e.state]
const phrase = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const has = (clause, label) => { const p = phrase(label); return !!p && ` ${phrase(clause)} `.includes(` ${p} `) }
// the member's own name for the thing (a list "Tech", a layout "Swing", "RSI (14)") — quoted in the effect, or its label
const labelOf = (e) => e.label || (/“([^”]+)”/.exec(e.name || '') || [])[1] || null
/** Does this clause name the effect's object — its class, or (when it names no OTHER class) its own name? */
export function namesObject(e, clause) {
  const mine = classesOf(e)
  if (mine.some(c => CLASS[c]?.test(clause))) return true
  if (Object.keys(CLASS).some(c => !mine.includes(c) && CLASS[c].test(clause))) return false
  const label = labelOf(e)
  return !!label && (has(clause, label) || phrase(label).split(' ').filter(t => t.length >= 3 && /[a-z]/.test(t)).some(t => has(clause, t)))
}
// clauses: punctuation, "then", "but", and an "and" that starts a new request ("…, and clear …", "add X and remove Y")
const CLAUSES = /[.;,!?]|\bthen\b|\bbut\b|\band (?=(?:then |also )?(?:add|put|include|insert|remove|delete|clear|replace|change|set|make|rename|save|show|swap|keep|move|turn|switch|get rid|erase|wipe|reset|overwrite|unpin|colou?r|apply|use|load|open)\b)/i
export const clausesOf = (words) => strip(words).split(CLAUSES).map(c => c.trim()).filter(Boolean)
// "put Momentum up in my watchlist" / "put the Flagged list in my watchlist widget": a clause that names the LIST a widget is to
// show (its own name) and where — never "put AAPL on my watchlist" (adding a symbol never switches what a widget shows)
const PUT_IN = /\bput\b[^.;!?]*\b(?:in|into|on|up in|up on)\s+(?:the|my|that|this|your)\b[^.;!?]*\b(?:watch ?lists?|widgets?|scanner)\b/i

/** Do this turn's words ask for that kind of change to THAT kind of existing state? (per clause, kind-matched) */
export function permits(e, words) {
  for (const c of clausesOf(words)) {
    if (e.type === 'replace' && e.to && PUT_IN.test(c) && has(c, e.to)) return true
    const strong = DESTROY.test(c)
      || (e.type === 'replace' && (PICK.test(c) || MODIFY.test(c)))
      || (e.type === 'overwrite' && (MODIFY.test(c) || PICK.test(c) || (e.via === 'save' && SAVE.test(c) && !NEW_ONE.test(c))))
    if (strong && namesObject(e, c)) return true
  }
  return false                                                  // remove / clear / delete / unreadable without both
}
export const isStateAdditive = (words) => STATE_ADDITIVE.test(String(words || ''))

const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const VERB = { remove: 'remove', clear: 'clear', delete: 'delete', replace: 'replace', overwrite: 'change', unreadable: 'change' }
const said = (e) => `${VERB[e.type] || 'change'} ${e.name}`

/**
 * The refusal sentence for a plan the STATE rail stops, or null. `words`: this turn's words (the message, and the request
 * a pending question carried). Every mode (apply / propose / approved): an additive request never reaches a card that
 * destroys either. Fails closed: anything that throws while reading an additive request's plan refuses it.
 */
export function stateRailRefusal(plan, { words = '' } = {}) {
  if (!plan?.ok) return null
  const w = String(words || '')
  if (!isStateAdditive(w)) return null
  try {
    const bad = stateEffects(plan).filter(e => !permits(e, w))
    if (!bad.length) return null
    return `I didn’t change anything: you asked to add, but this would ${listOf([...new Set(bad.map(said))])}. Adding never replaces or removes what you already have — say “replace”, “remove” or “change” if that is what you want.`
  } catch {
    return 'I didn’t change anything: I couldn’t check that this only adds to what you already have. Ask again, or say exactly what to replace or remove.'
  }
}
