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

export const STATE_RAIL_MARK = 'state-rail'

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const rowsOf = (cs) => instancesOf(cs, nativeRegistry).filter(r => !r.setting)
const nm = (x) => (x == null ? '' : String(x))

// ── what a plan does to the member's existing state, by target kind ─────────────────────────────────────────────────────
// each effect: { state, type: 'remove' | 'clear' | 'delete' | 'replace' | 'overwrite', name, via? }
const OVERWRITE_OPS = new Set(['setInputs', 'setAppearance', 'setPlotStyle', 'setColor', 'setDotSize'])
// an indicator change read from the Indicators interface's own request (indicatorEdits: `change.request`)
function indicatorOfRequest(req, rows, chartRef = null) {
  const op = req?.op
  const id = req?.instanceId
  const name = (rows || []).find(r => r.instanceId === id)?.name || 'an indicator'
  // id: the exact instance (a pointer at the conversation's subject may restyle only that one)
  const oid = chartRef && id ? `ind:${chartRef}:${id}` : null
  if (op === 'remove') return [{ state: 'indicator', type: 'remove', name, label: name, id: oid }]
  if (OVERWRITE_OPS.has(op)) return [{ state: 'indicator', type: 'overwrite', name, label: name, id: oid }]
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
    return indicatorOfRequest(req, p.before?.rows || p.snap?.rows, p.before?.chartRef || p.snap?.chartRef || null)
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
    else for (const x of removed) out.push({ state: 'drawing', type: 'remove', name: dname(all.find(d => d.id === x.id) || x), id: `draw:${p.ref}:${x.id}`, dtype: (all.find(d => d.id === x.id) || x).type })
    for (const u of pt.update || []) {
      const keys = Object.keys(u.set || {}).filter(k => !HARMLESS_DRAWING_KEYS.has(k))
      const d = all.find(x => x.id === u.id) || {}
      // its own target: which settings / levels of WHICH drawing (a fib level value binds only to that fib)
      if (keys.length) out.push({ state: 'drawing', type: 'overwrite', name: dname(d), id: `draw:${p.ref}:${u.id}`, dtype: d.type, keys, levels: [...Object.keys(u.set.levels || {}), ...Object.keys(u.set.fills || {}).flatMap(f => f.split('>'))] })
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
    // its own target: the symbols it removes, and the symbols the list holds (a ticker said counts only if it is IN the list)
    const own = { syms: rm.map(x => String(x.sym).toUpperCase()), listSyms: (p.before?.items || pt.beforeItems || []).map(x => String(x.sym).toUpperCase()) }
    if (rm.length && had && rm.length >= had) out.push({ state: 'watchlist', type: 'clear', name: `every symbol in ${list}`, ...own })
    else if (rm.length) out.push({ state: 'watchlist', type: 'remove', name: `${rm.map(x => x.sym).join(', ')} from ${list}`, ...own })
    if (pt.rename) out.push({ state: 'watchlist', type: 'overwrite', name: `the name of ${list}` })
    for (const n of pt.notes || []) if (nm(n.from).trim()) out.push({ state: 'watchlist', type: 'overwrite', name: `your note on ${n.sym}` })
    return out
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
export const STATE_ADDITIVE = /\b(?:add|adds|added|adding|include|includes|included|including|put|puts|putting|insert|inserts|inserting|append|appends|appending|plus|new|another|more|additional|extra|also|as well|too|in addition|one more)\b/i
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
  // (an indicator draws LINES too: "add the 50 sma then make that line purple")
  indicator: /\b(?:indicators?|lines?|plots?|studies|study|emas?|smas?|wmas?|rsi|macd|vwap|atr|adx|bollinger\w*|stoch\w*|moving averages?|averages?|mas?|obv|cci|keltner|ichimoku|length|period|lookback|(?:the|my|that) \d{1,3}|\d{1,3}[- ]?(?:day|period|bar|ema|sma))\b/i,
  drawing: /\b(?:drawings?(?! boards?\b)|lines?|trend ?lines?|fib\w*|rays?|rectangles?|texts?|labels?|positions?|avwaps?|levels?|arrows?|channels?|circles?|shapes?|annotations?|horizontals?|verticals?|pitchforks?|measures?|points?|anchors?)\b/i,
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
const MORE_MODIFY = String.raw`hide|hides|hid|hidden|unhide|drag|drags|dragged|flatten\w*|call|thick\w*|thin\w*|widen\w*|narrow\w*|darken\w*|lighten\w*|bold|italic\w*|move|nudge\w*|bump\w*|raise|lower`
// what picks a widget's CONTENT (its list / scan): show, switch, open, load, go / take back to the picker, pick, exit, leave
const DISPLAY = /^(?:show\w*|switch\w*|open\w*|load\w*|view\w*|display\w*|use|using|apply|change\w*|go(?:es)? back|take (?:\S+ ){0,3}?back|pick\w*|exit\w*|leave\w*|replac\w*|swap\w*|instead)$/i
const VERBS = new RegExp(String.raw`\b(?:${DESTROY_SRC().slice(3, -1)}|${MORE_DESTROY}|take (?:\S+ ){0,3}?back|${MODIFY_SRC().slice(3, -1)}|${MORE_MODIFY}|apply|applies|applied|applying|show|shows|showing|display\w*|load\w*|open|opens|use|using|view|save|saves|saved|saving|update|updates|updated|go(?:es)? back|pick\w*|exit\w*|leave\w*)\b`, 'gi')
const DESTROY_ANY = new RegExp(String.raw`^(?:${DESTROY_SRC().slice(3, -1)}|${MORE_DESTROY})$`, 'i')
const MODIFY_ANY = new RegExp(String.raw`^(?:${MODIFY_SRC().slice(3, -1)}|${MORE_MODIFY})$`, 'i')
const CUT = /\b(?:how|why|what|whether|because|since|so|if|when|while|once|until|unless|in order)\b/i
// an object that only POINTS back at something already there ("it", "them", "that one", "the fast one")
const POINTS = /^(?:it|them|both(?= of them|\s*$)|all of them|(?:the|that|this|these|those) (?:\w+ )?ones?|(?:that|this|these|those)(?=\s*$|\s+(?:to|on|in|into|at|from|with|up|down|over|a|an|the)\b)|(?:the )?(?:first|second|third|fourth|last|other|fast|slow|left|right|top|bottom)\b)/i
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
const namesOwn = (e, obj) => (e.state === 'widget' && e.type === 'replace' ? displayNamed(e, obj)
  : namesObject(e, obj) || (e.state === 'drawing' && (levelNamed(e, obj) || settingNamed(e, obj))) || symbolsNamed(e, obj))

/** Do this turn's words COMMAND that kind of change on THAT existing object? (per clause, kind-matched, never negated).
 *  `subjects`: the conversation's current subject (exact object ids) — what a pointer at the start of a message means. */
export function permits(e, words, subjects = null, previous = null) {
  // before / prev: the classes and the clause the latest earlier clause NAMED; spoke: an earlier clause said anything of
  // substance (named a thing, or asked for something) — then a pointer speaks of THAT, never of the conversation before
  let before = [], prev = '', spoke = false
  const isSubject = () => !!e.id && !!subjects && subjects.has(e.id)
  for (const c of clausesOf(words)) {
    const named = Object.keys(CLASS).filter(k => CLASS[k].test(c))
    const negated = NEG.test(c)
    // a display switch named by the list it shows (never a symbol; a homograph is asked: stateRailRefusal)
    if (!negated && e.type === 'replace' && e.to && PUT_IN.test(c) && has(c, e.to) && (SAID_LIST(c, e.to) || !tickersIn(c).includes(String(e.to).toUpperCase()))) return true
    if (!negated) {
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
        if (POINTS.test(obj)) {
          const rest = obj.replace(POINTS, '')
          // "make it orange on the QQQ chart": a pointer narrowed by a class named after it must be that class
          if (named.length && !classesOf(e).some(k => named.includes(k)) && Object.keys(CLASS).some(k => CLASS[k].test(rest))) continue
          // a save names its container after the pointer ("save it to my layout")
          if (saving && namesObject(e, rest)) return true
          if (!spoke) {
            // the message's first words point at the conversation's CURRENT subject ("make it thicker"): an overwrite of
            // EXACTLY that object (never another of its class); a destroy, a replace or a save-over is asked, never assumed
            if (e.type === 'overwrite' && !saving && isSubject()) return true
            // a destroy right after: only the ONE object the immediately previous turn made or changed (AUDIT #1247 A)
            if (e.type !== 'overwrite' && !saving && e.id && previous && e.id === previous) return true
            continue
          }
          // after words of its own: an overwrite takes the class they named; a destroy / replace only the very object they
          // named or made ("add a 20 EMA, then remove it"); a widget's content, the list those words made ("make me a
          // watchlist … and open it")
          if (classesOf(e).some(k => before.includes(k)) && (e.type === 'overwrite' || namesThatObject(e, prev))) return true
          if (e.type === 'replace' && e.state === 'widget' && before.includes('watchlist') && /\b(?:make|makes|made|create\w*|build\w*|new)\b/i.test(prev)) return true
          continue
        }
        if (namesOwn(e, obj)) return true
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
export function stateRailRefusal(plan, { words = '', mode = 'apply', subjects = null, previous = null } = {}) {
  if (!plan?.ok) return null
  // an APPROVED card was shown, naming what it removes or changes, to the member who approved it (and its binding is checked
  // before it runs): the card is the permit. Every other path — instant, model, proposal, composed, deferred — needs the words.
  if (mode === 'approved') return null
  const w = String(words || '')
  try {
    const effects = stateEffects(plan)
    if (!effects.length) return null
    const amb = effects.map(e => homograph(e, w)).find(Boolean)
    if (amb) return `Do you mean your “${amb}” list, or the ticker ${String(amb).toUpperCase()}? Nothing was changed — say “show my ${amb} list” to switch the widget to it, or “add ${String(amb).toUpperCase()} to my watchlist” to add the symbol.${notDoneLine(notDoneAdds(plan))}`
    const bad = effects.filter(e => !permits(e, w, subjects, previous))
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
export function previousObjectOf(memory, epoch = null, drawing = null) {
  try {
    const t = memory?.lastTurn?.(epoch)
    if (!t?.ops?.length) return null
    const acts = t.ops.map(o => String(o.action))
    if (acts.every(a => a.startsWith('indicator.'))) { const set = memory.indicatorSet?.(epoch) || []; return set.length === 1 ? `ind:${set[0].chart}:${set[0].instanceId}` : null }
    if (acts.every(a => a.startsWith('drawing.')) && t.ops.length === 1) return drawing?.sym && drawing.id ? `draw:${drawing.sym}:${drawing.id}` : null
  } catch { /* none */ }
  return null
}
/** What the member's NEW turn starts from: the subject as it is when they speak — never an earlier turn's carried over. */
export const turnStartOf = (memory, epoch = null, drawing = null) => ({ ids: subjectIdsOf(memory, epoch, drawing), previous: previousObjectOf(memory, epoch, drawing) })
/** The next turn's start, given the last one's: the subject NOW only — what an earlier turn's start held never carries over
 *  ("copies from an earlier turn" are not the subject; only what the latest turns touched). */
export const nextTurnSubjects = (prevStart, memory, epoch = null, drawing = null) => { void prevStart; return turnStartOf(memory, epoch, drawing) }
