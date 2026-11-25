// ── D31 RESOLVER · REMOVAL FAMILY · the evidence readers (design §8, §9) ─────────────────────────────────────────────────
// Destroying verbs × chart / indicator / drawing / list. Reads the member's words for this turn (+ the request a pending
// question carried) against a pure WORLD (resolver/world.js) and returns a READING: typed referent GROUPS, the NEGATED and
// ANCHOR refs, and flags. Never decides (resolve.js does) and never writes. Every vocabulary is the existing readers':
//   chartRail  removalPronouns (pronoun objects, PRONOUN_CONT `cont`, containers, APPOS) · pronounAntecedent · removalAskedFor
//   stateRail  CLASS · indicatorsNamed (H14 unique identification, IND_PLURAL) · namesObject (DTYPE_NOUN, labels) · clausesOf
//   deixis     ordinalChart · describedCharts · relativeChart (click = anchor) · pickedChoice · negatedPointer
//   spatialCheck namedAnchorRelation (a named anchor) · fastPath matchPosition · indexesModel INDEX_SYMBOLS (the house index set)
// A group: { type, refs: [typed id], source, ask?: code, plural?, absent?, made?, anyThing? }.
import { removalPronouns, pronounAntecedent, removalAskedFor } from '../../chartRail'
import { CLASS, indicatorsNamed, namesObject, clausesOf } from '../../stateRail'
import { ordinalChart, describedCharts, relativeChart, pickedChoice, negatedPointer } from '../../deixis'
import { namedAnchorRelation } from '../../spatialCheck'
import { matchPosition } from '../../fastPath'
import { INDEX_SYMBOLS } from '../../../pages/charts/widgets/indexesModel'
import { typeOfNoun, typeOfId, NOUNS } from '../referentTypes'

export const FAMILY_ID = 'removal'
const up = (s) => String(s || '').trim().toUpperCase()
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const linked = (g) => typeof g === 'string' && g && !g.startsWith('N')
const cid = (ref) => `chart:${ref}`
const blank = (s, at, len) => `${s.slice(0, at)}${' '.repeat(len)}${s.slice(at + len)}`

// ── the verb family: words that ask to destroy at all (chartRail's REMOVAL gate + stateRail's DESTROY stems) ──
const MORE_DESTROY = /\b(?:eras\w*|empt(?:y|ies|ied|ying)|wip(?:e|es|ed|ing)|trash\w*|discard\w*|unpin\w*)\b|\btak(?:e|ing)\s+(?:\S+\s+){0,4}?(?:off|out|away|down)\b/i
export const destroying = (w) => removalAskedFor(w) || MORE_DESTROY.test(String(w || ''))

// ── NEGATION (I5): a mention governed by a negator / keep / leave / except is never a referent ──
const NEG_LEAD = /\b(?:(?:do\s+not|don['’]?t|dont|never)\s+(?:close|remove|delete|drop|touch|change|move|replace|clear|lose|get\s+rid\s+of)|except(?:\s+for)?|excluding|other\s+than|apart\s+from|aside\s+from|but(?:\s+not)?(?!\s+(?:close|remove|delete|drop|get|take|clear|keep|leave|then|also|and|please|i)\b)|not|leave|leaving|keep|keeping)\s+/gi
const NEG_END = /[,;.!?—–]|\b(?:and|then|but|while|so)\b/i
const BARE_CONFIRM = /^(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|do\s+it|go\s+ahead|please|that\s+one|correct|right)[\s,.!]*)+$/i

// ── CHART MENTIONS: a chart noun phrase, an ordinal, or a board ticker said bare ──
const CHART_NP = /\b(the|that|this|my|your|our|both|all|every|each|these|those)\s+((?:(?!(?:the|a|an|and|or|from|on|off|of|in|to|then|but|with|for)\b)[^\s.,;:!?()—–]+\s+){0,3}?)(charts?|ones?|panels?|graphs?)\b/gi
const PLACE_BEFORE = /\b(?:from|on|off|of|in|onto|to|into|for|at|with|out\s+of)\s*$/i
// ("get rid OF the SPY chart": the verb's own preposition, never a place)
const isPlace = (before) => PLACE_BEFORE.test(before) && !/\brid\s+of\s*$/i.test(before)
const POSITION = /\b(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|(?:far[- ])?left(?:most|[- ]hand)?|(?:far[- ])?right(?:most|[- ]hand)?|top|bottom|upper|lower|middle|cent(?:er|re))\b/gi
const normPos = (w) => w.toLowerCase().replace(/^far[- ]/, '').replace(/most$/, '').replace(/[- ]hand$/, '').replace(/^cent(?:er|re)$/, 'middle').replace(/\s/, '-').replace('upper', 'top').replace('lower', 'bottom')
const SET_ALL = /\b(?:everything|all\s+(?:of\s+)?(?:my\s+|the\s+|these\s+|those\s+)?(?:charts|ones|panels)|every\s+(?:chart|one|panel)|all\s+of\s+them|the\s+rest|the\s+others|all\s+the\s+others|the\s+remaining(?:\s+(?:charts|ones))?)\b/i
const INDEX_WORD = /\bindex(?:es)?\b/i
const INDEX_SET = new Set(INDEX_SYMBOLS.map(e => e.sym))
// the conversation's chart named by the act ("the last chart I opened", "the one you just added") — the previous object
const BACK_REF = /\b(?:the|that)\s+(?:(?:last|latest|newest|most\s+recent)\s+)?(?:chart|one|graph|panel)\s+(?:(?:that|which)\s+)?(?:i|you|we)(?:['’]ve|\s+have|\s+just)?\s+(?:opened|added|made|created|changed|put\s+up|pulled\s+up|brought\s+up)\b/i

/** The charts a board ticker names in `s` (any casing; a board symbol only), with each mention's span. */
function tickerMentions(s, charts) {
  const syms = [...new Set(charts.map(c => up(c.symbol)).filter(x => x.length >= 2))]
  const out = []
  for (const sym of syms) for (const m of s.matchAll(new RegExp(String.raw`(?:^|[^A-Za-z0-9$])\$?(${esc(sym)})(?![A-Za-z0-9])`, 'gi'))) {
    const at = m.index + m[0].length - m[1].length
    out.push({ sym, index: at, length: m[1].length })
  }
  return out.sort((a, b) => a.index - b.index)
}
const objectsOf = (charts, refs) => new Set(charts.filter(c => refs.includes(c.ref)).map(c => (linked(c.group) ? `g:${c.group}` : `c:${c.ref}`))).size
/** A chart ref and every chart in its link group (one object). */
function withGroup(charts, refs) {
  const out = new Set()
  for (const r of refs) {
    const c = charts.find(x => x.ref === r)
    if (!c) continue
    for (const x of charts) if (x.ref === c.ref || (linked(c.group) && x.group === c.group)) out.add(x.ref)
  }
  return [...out]
}

/** What ONE chart noun phrase names → { refs, constrained, det, plural, source }. */
function npCharts(np, det, charts, { plural = false } = {}) {
  const sets = []
  let source = 'named'
  const syms = tickerMentions(np, charts).map(t => t.sym)
  if (syms.length) sets.push(charts.filter(c => syms.includes(up(c.symbol))).map(c => c.ref))
  const pos = [...np.matchAll(POSITION)].map(m => normPos(m[1]))
  for (const p of pos) { const hit = matchPosition(charts, p).map(c => c.ref); sets.push(hit); source = syms.length ? source : 'ordinal-position' }
  try { const o = ordinalChart(np, charts); if (o?.ref) { sets.push([o.ref]); source = 'ordinal-position' } else if (o?.ask) sets.push(charts.map(c => c.ref)) } catch { /* no ordinal */ }
  // (what the chart IS — "the empty chart": deixis describedCharts; a ticker already names it)
  if (!syms.length) { try { const d = describedCharts(np, charts); if (Array.isArray(d)) { sets.push(d.map(c => c.ref)); source = 'description' } } catch { /* no description */ } }
  if (INDEX_WORD.test(np)) { sets.push(charts.filter(c => INDEX_SET.has(up(c.symbol))).map(c => c.ref)); source = 'description' }
  if (!sets.length) return { refs: null, constrained: false, det, plural, source: null }
  let refs = sets[0]
  for (const s of sets.slice(1)) refs = refs.filter(r => s.includes(r))
  return { refs: withGroup(charts, refs), constrained: true, det, plural, source }
}

/** Every chart mention in a clause: [{ refs|null, role: 'object'|'place', det, plural, source, index, end }]. */
function chartMentions(s, w) {
  const { charts } = w
  const out = []
  const spans = []
  for (const m of s.matchAll(CHART_NP)) {
    const det = m[1].toLowerCase(), noun = m[3].toLowerCase()
    if (/^(?:that|this)$/.test(det) && /^ones?$/.test(noun) && !m[2].trim()) {
      out.push({ refs: null, role: isPlace(s.slice(0, m.index)) ? 'place' : 'object', det, plural: false, pointer: true, index: m.index, end: m.index + m[0].length })
      spans.push([m.index, m.index + m[0].length])
      continue
    }
    if (/\bother\b/i.test(m[2])) continue
    const plural = /s$/.test(noun) || /^(?:both|all|every|each|these|those)$/.test(det)
    // ("the chart ON THE RIGHT": a position phrase right after the noun says which one)
    const tail = /^\s+(?:on|at|in)\s+the\s+(?:far\s+)?(?:top|bottom|upper|lower|left|right|middle|cent(?:er|re))(?:[- ](?:left|right))?(?:\s+side)?\b/i.exec(s.slice(m.index + m[0].length))
    const np = tail ? `${m[0]}${tail[0]}` : m[0]
    const r = npCharts(np, det, charts, { plural })
    out.push({ ...r, role: isPlace(s.slice(0, m.index)) ? 'place' : 'object', index: m.index, end: m.index + np.length })
    spans.push([m.index, m.index + np.length])
  }
  // "chart 3" / "the first one" outside a noun phrase above
  try {
    const o = ordinalChart(s, charts)
    if (o?.ref && o.match && !spans.some(([a, b]) => o.match.index >= a && o.match.index < b)) {
      out.push({ refs: withGroup(charts, [o.ref]), constrained: true, det: null, plural: false, source: 'ordinal-position', role: isPlace(s.slice(0, o.match.index)) ? 'place' : 'object', index: o.match.index, end: o.match.index + o.match[0].length })
      spans.push([o.match.index, o.match.index + o.match[0].length])
    }
  } catch { /* no ordinal */ }
  // a board ticker said bare ("close all my charts but IWM", "the horizontal line on SPY", "the SPY annotation")
  for (const t of tickerMentions(s, charts)) {
    if (spans.some(([a, b]) => t.index >= a && t.index < b)) continue
    const after = s.slice(t.index + t.length)
    const next = /^\s*(?:['’]s\s+)?([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/i.exec(after)?.[1] || ''
    const modifier = next && typeOfNoun(next) && typeOfNoun(next) !== 'chart'
    const role = isPlace(s.slice(0, t.index)) || modifier ? 'place' : 'object'
    const plural = new RegExp(String.raw`\b(?:both|all|every|each)\b[^.;!?]*?\$?${esc(t.sym)}(?![A-Za-z0-9])`, 'i').test(s)
    out.push({ refs: withGroup(charts, charts.filter(c => up(c.symbol) === t.sym).map(c => c.ref)), constrained: true, det: null, plural, source: 'named', role, index: t.index, end: t.index + t.length, bare: true })
  }
  return out.sort((a, b) => a.index - b.index)
}

// ── the pointer order (chartRail resolvePronoun): selection → conversation chart → sole object → asked ──
function pointerGroup(w, { plural = false, source = null } = {}) {
  const { charts, selection, subject } = w
  const prevChart = typeOfId(w.previous) === 'chart' ? String(w.previous).slice(6) : null
  const sel = selection && charts.some(c => c.ref === selection) ? withGroup(charts, [selection]) : []
  const sub = (subject ?? prevChart) && charts.some(c => c.ref === (subject ?? prevChart)) ? withGroup(charts, [subject ?? prevChart]) : []
  const all = charts.map(c => cid(c.ref))
  if (plural) {
    const set = [...new Set([...sel, ...sub])]
    return set.length ? { type: 'chart', refs: set.map(cid), source: source || 'pointer', plural: true } : { type: 'chart', refs: all, source: 'pointer', ask: 'ambiguous-n' }
  }
  if (sel.length) return { type: 'chart', refs: sel.map(cid), source: source || 'pointer' }
  if (sub.length) return { type: 'chart', refs: sub.map(cid), source: source || 'previous' }
  if (charts.length && objectsOf(charts, charts.map(c => c.ref)) === 1) return { type: 'chart', refs: all, source: 'sole' }
  return { type: 'chart', refs: all, source: 'pointer', ask: 'ambiguous-n' }
}

// ── THINGS: indicators (H14), drawings (DTYPE_NOUN), lists (labels / rows) ──
function indicatorGroup(text, w, scope, source = 'named') {
  const charts = scope && scope.length ? w.charts.filter(c => scope.includes(c.ref)) : w.charts
  let said = false, plural = false
  const uniq = [], cand = []
  for (const c of charts) {
    const peers = w.indicators.filter(i => i.chart === c.ref).map(i => ({ id: i.id, defId: i.defId, inputs: i.inputs, name: i.label }))
    const n = indicatorsNamed(text, peers)
    if (!n) continue
    said = true
    if (n.plural) { plural = true; uniq.push(...n.ids); continue }
    if (n.unique.size) uniq.push(...n.unique)
    else cand.push(...n.ids)
  }
  if (!said) return null
  if (!plural && !(scope && scope.length) && uniq.length + cand.length > 1 && w.selection) {
    // several charts hold it and the words name none: the click narrows it (pointer, below words)
    const onSel = [...uniq, ...cand].filter(id => w.indicators.find(i => i.id === id)?.chart === w.selection)
    if (onSel.length) return indicatorGroup(text, w, [w.selection], 'pointer')
  }
  const refs = [...new Set([...uniq, ...cand])]
  if (!refs.length) return { type: 'indicator', refs: [], source, absent: true }
  if (plural) return { type: 'indicator', refs, source, plural: true }
  return refs.length === 1 ? { type: 'indicator', refs, source } : { type: 'indicator', refs, source, ask: 'ambiguous-n' }
}
function drawingGroup(text, w, scopeSyms, source = 'named') {
  if (!CLASS.drawing.test(text)) return null
  const pool = scopeSyms && scopeSyms.length ? w.drawings.filter(d => scopeSyms.includes(up(d.symbol))) : w.drawings
  const hits = pool.filter(d => {
    const e = { state: 'drawing', dtype: d.dtype, sameType: pool.filter(x => x.dtype === d.dtype).length, inScope: pool.length, hidden: !!d.hidden, hiddenInScope: pool.filter(x => x.hidden).length, label: d.label || null }
    try { return namesObject(e, text) } catch { return false }
  }).map(d => d.id)
  if (hits.length === 1) return { type: 'drawing', refs: hits, source }
  if (hits.length > 1 && hits.length === pool.length && /\b(?:all|both|every|each|them|those|these)\b|\b(?:lines|drawings|trend ?lines|fibs|rays|levels)\b/i.test(text)) return { type: 'drawing', refs: hits, source, plural: true }
  const refs = (hits.length ? hits : pool.map(d => d.id))
  return refs.length ? { type: 'drawing', refs, source, ask: 'ambiguous-n' } : { type: 'drawing', refs: [], source, absent: true }
}
const SET_ALL_ROWS = /\b(?:everything|every\s+(?:symbol|ticker|stock|name|row)|all(?:\s+(?:of\s+)?(?:the|my))?\s*(?:symbols|tickers|stocks|names|rows)?|the\s+whole\s+(?:thing|list))\b/i
const LIST_CONTAINER = /\b(?:from|out\s+of|off(?:\s+of)?|in|on)\s+(?:the|my|your|our)?\s*((?:[\w$’'-]+\s+){0,2}?)(?:watch\s?lists?|lists?)\b/i
function listsNamed(words, w) {
  const n = String(words || '').toLowerCase()
  const hits = w.lists.filter(l => l.name && new RegExp(String.raw`(?:^|[^a-z0-9])${esc(String(l.name).toLowerCase())}(?![a-z0-9])`).test(n))
  return hits.length ? hits : null
}
/** "from my Tech list" — or "from Momentum": a preposition and one of the member's list NAMES (no list noun said). */
function listContainerOf(text, w) {
  const c = LIST_CONTAINER.exec(text)
  if (c) return { index: c.index, lists: listsNamed(c[1], w) || w.lists }
  for (const l of w.lists) {
    if (!l.name) continue
    const m = new RegExp(String.raw`\b(?:from|out\s+of|off(?:\s+of)?)\s+(?:the\s+|my\s+)?${esc(String(l.name))}(?![A-Za-z0-9])`, 'i').exec(text)
    if (m) return { index: m.index, lists: [l] }
  }
  return null
}
function listGroups(text, w) {
  const c = listContainerOf(text, w)
  if (c) {
    const lists = c.lists
    const objectPart = text.slice(0, c.index)
    const syms = [...new Set([...objectPart.matchAll(/(?:^|[^A-Za-z0-9$])\$?([A-Z][A-Z0-9.]{0,9})(?![A-Za-z0-9])/g)].map(m => m[1]).filter(s => s.length >= 2 || /^[A-Z]$/.test(s)))]
    // ("remove everything from my Momentum list": the list's rows as a set — the list named)
    if (!syms.length && SET_ALL_ROWS.test(objectPart)) return { group: { type: 'list', refs: lists.map(l => `list:${l.ref}`), source: 'container', plural: true, ...(lists.length > 1 ? { ask: 'ambiguous-n' } : {}) }, container: lists }
    if (!syms.length) return { group: null, container: lists }
    const refs = lists.flatMap(l => syms.map(s => `item:${l.ref}:${up(s)}`))
    const present = refs.filter(id => { const [, r, s] = id.split(':'); return (w.lists.find(l => l.ref === r)?.symbols || []).map(up).includes(s) })
    const group = lists.length > 1 && syms.length && !/\b(?:all|both|every|each)\b/i.test(text) ? { type: 'list', refs, source: 'named', ask: 'ambiguous-n' } : { type: 'list', refs, source: 'named', ...(present.length ? {} : { absent: true }) }
    return { group, container: lists, syms }
  }
  if (!/\b(?:watch\s?lists?|lists?)\b/i.test(text)) return null
  const hits = w.lists.filter(l => { try { return namesObject({ state: 'watchlist', label: l.name, inScope: w.lists.length }, text) } catch { return false } })
  const named = listsNamed(text, w)
  const refs = (named || []).map(l => `list:${l.ref}`)
  if (refs.length === 1) return { group: { type: 'list', refs, source: 'named' } }
  if (/\b(?:all|both|every|each)\b|\b(?:watch\s?lists|lists)\b/i.test(text) && hits.length) return { group: { type: 'list', refs: hits.map(l => `list:${l.ref}`), source: 'named', plural: true } }
  return { group: { type: 'list', refs: w.lists.map(l => `list:${l.ref}`), source: 'named', ask: w.lists.length ? 'ambiguous-n' : undefined, ...(w.lists.length ? {} : { absent: true }) } }
}
/** A thing named by one noun (an appositive, an antecedent, a container): its typed group, narrowed by the previous object. */
function thingGroupOf(word, text, w, { source = 'appositive', made = false, scope = null } = {}) {
  const type = typeOfNoun(word) || typeOfNoun(text) || null
  if (!type || type === 'chart') return { type: '*thing', refs: [], source, anyThing: true }
  if (made) return { type, refs: [], source, made: true }
  let g = null
  if (type === 'indicator') g = indicatorGroup(text, w, scope)
  else if (type === 'drawing') g = drawingGroup(text, w, null)
  else if (type === 'list') g = listGroups(text, w)?.group || null
  g = g || { type, refs: [], source, absent: true }
  g = { ...g, source }
  // (the conversation's previous object of THAT type is the one meant: "delete it, the RSI I mean" right after adding it)
  if (w.previous && typeOfId(w.previous) === type && (g.refs.includes(w.previous) || g.absent)) return { type, refs: [w.previous], source }
  return g
}
/** "add an RSI, then delete it": the antecedent is a NEW object this request makes (an indefinite article / an add verb). */
function antecedentMade(before, word) {
  const s = String(before || '').toLowerCase()
  const at = s.lastIndexOf(String(word || '').toLowerCase())
  if (at < 0) return false
  const lead = s.slice(Math.max(0, at - 40), at)
  return /\b(?:a|an|another|new|one)\s+(?:\S+\s+){0,2}$/.test(lead) || /\b(?:add|put|draw|create|make|plot|set\s+up)\s+(?:\S+\s+){0,3}$/.test(lead)
}

/**
 * READ the removal family's evidence. `input`: { words: { typed, carried }, world } (resolver/world.js shapes).
 * → { family, groups, negated: Set, anchors: Set, destroying, cont, offers }
 */
export function readRemoval(input) {
  const w = input.world
  const typed = String(input.words?.typed || '')
  const carried = input.words?.carried ? String(input.words.carried) : null
  const charts = w.charts || []
  const reading = { family: FAMILY_ID, groups: [], negated: new Set(), anchors: new Set(), destroying: false, cont: false, evidence: [] }
  const ev = (source, extra = {}) => reading.evidence.push({ source, ...extra })

  // (R3 / I9) the member's answer to the Agent's own question — live for ONE turn only; a stale offer carries nothing
  const live = w.offers && !w.offers.stale && w.offers.refs?.length
  if (live) {
    const choices = w.offers.refs.map(r => ({ ref: r, label: `the ${up(charts.find(c => c.ref === r)?.symbol)} chart` }))
    const pick = pickedChoice(typed, choices)
    reading.destroying = destroying(carried || typed)
    if (pick) {
      const byLabel = choices.some(c => c.ref === pick && c.label.toLowerCase() === typed.trim().toLowerCase().replace(/[.!]+$/, ''))
      reading.groups.push({ type: 'chart', refs: withGroup(charts, [pick]).map(cid), source: byLabel ? 'description' : 'answer' })
      ev(byLabel ? 'description' : 'answer', { type: 'chart' })
      return reading
    }
    if (BARE_CONFIRM.test(typed.trim())) {
      const refs = w.offers.refs.map(cid)
      reading.groups.push(refs.length === 1 ? { type: 'chart', refs, source: 'offered' } : { type: 'chart', refs, source: 'offered', ask: 'ambiguous-n' })
      ev('offered', { type: 'chart', count: refs.length })
      return reading
    }
  }
  // (the rail pick: the member clicked one of the rail's own choices — useAgent railPickedRef)
  if (w.picked && w.picked.size) {
    const refs = [...w.picked].filter(x => String(x).startsWith('chart:'))
    if (refs.length) { reading.groups.push({ type: 'chart', refs, source: 'answer' }); reading.destroying = true; ev('answer', { type: 'chart' }); return reading }
  }

  let text = typed
  reading.destroying = destroying(text)
  if (!reading.destroying) return reading                         // words that ask to destroy nothing refer to no target (I1)

  // ── I5 NEGATION: each negator governs the mention right after it, to its clause end ──
  for (const m of [...text.matchAll(NEG_LEAD)].reverse()) {
    const rest = text.slice(m.index + m[0].length)
    const end = rest.search(NEG_END)
    const span = end < 0 ? rest : rest.slice(0, end)
    const ms = chartMentions(span, w)
    for (const x of ms) {
      if (x.pointer) { if (w.selection) reading.negated.add(cid(w.selection)) }
      else for (const r of x.refs || []) reading.negated.add(cid(r))
    }
    if (/^\s*(?:this|that|it)\b/i.test(span) && !ms.length && w.selection) reading.negated.add(cid(w.selection))
    text = blank(text, m.index, m[0].length + span.length)
  }
  try { if (negatedPointer(typed) && w.selection) reading.negated.add(cid(w.selection)) } catch { /* no pointer read */ }
  if (reading.negated.size) ev('negated', { count: reading.negated.size })

  // ── RELATION (I6): the click — or a named chart — is the ANCHOR, its neighbour the referent ──
  let relation = false
  try {
    const rc = relativeChart(text, charts, w.selection)
    // (a relation needs an ANCHOR said — this / it / the clicked one; "the chart on the left" is a position, read below)
    const anchored = rc?.match && /\b(?:this|that|it|here|selected|clicked|current|highlighted|active|focused|picked|tapped)\b/i.test(String(rc.match[0]))
    if (rc && rc.match && (anchored || rc.hits.length)) {
      relation = true
      if (w.selection) reading.anchors.add(cid(w.selection))
      const hits = rc.hits.map(c => c.ref)
      reading.groups.push(hits.length === 1 || (rc.plural && hits.length) ? { type: 'chart', refs: withGroup(charts, hits).map(cid), source: 'relation', plural: !!rc.plural }
        : { type: 'chart', refs: charts.map(c => cid(c.ref)).filter(x => !reading.anchors.has(x)), source: 'relation', ask: 'ambiguous-n' })
      text = blank(text, rc.match.index, rc.match[0].length)
      ev('relation', { hits: hits.length })
    }
  } catch { /* no relation read */ }
  if (!relation) {
    try {
      const na = namedAnchorRelation(text, charts)
      if (na) {
        relation = true
        reading.anchors.add(cid(na.anchor))
        const hits = na.hits.filter(r => r !== na.anchor)
        reading.groups.push(hits.length === 1 ? { type: 'chart', refs: withGroup(charts, hits).map(cid), source: 'relation' } : { type: 'chart', refs: hits.length ? hits.map(cid) : charts.map(c => cid(c.ref)).filter(x => x !== cid(na.anchor)), source: 'relation', ask: 'ambiguous-n' })
        ev('relation', { hits: hits.length, named: true })
      }
    } catch { /* no relation read */ }
  }

  // ── BACK-REFERENCE: "the last chart I opened" is the conversation's previous chart (never the board's last) ──
  const br = BACK_REF.exec(text)
  if (br) {
    const prev = typeOfId(w.previous) === 'chart' ? String(w.previous).slice(6) : w.subject
    reading.groups.push(prev && charts.some(c => c.ref === prev) ? { type: 'chart', refs: withGroup(charts, [prev]).map(cid), source: 'previous' } : { type: 'chart', refs: charts.map(c => cid(c.ref)), source: 'previous', ask: 'ambiguous-n' })
    text = blank(text, br.index, br[0].length)
    ev('previous', { type: 'chart' })
  }

  // ── PRONOUN OBJECTS of removal verbs (chartRail removalPronouns): appositive → container → antecedent → previous → pointer ──
  const syms = new Set(charts.map(c => String(c.symbol || '').toLowerCase()).filter(Boolean))
  const isSym = (x) => syms.has(x)
  const prons = removalPronouns(text)
  const live0 = prons.filter(p => !p.cont)
  if (prons.length && !live0.length) { reading.cont = true; ev('continuation') }
  const p = live0[0]
  if (p) {
    const ap = p.appos ? pronounAntecedent(p.appos, isSym) : null
    const before = text.slice(0, p.verbAt)
    const a = ap ? null : p.from ? null : pronounAntecedent(before, isSym)
    if (ap?.type === 'chart') {
      const ms = chartMentions(p.appos, w).filter(x => x.refs)
      const refs = [...new Set(ms.flatMap(x => x.refs))]
      reading.groups.push(refs.length && objectsOf(charts, refs) === 1 ? { type: 'chart', refs: refs.map(cid), source: 'appositive' } : { type: 'chart', refs: (refs.length ? refs : charts.map(c => c.ref)).map(cid), source: 'appositive', ask: 'ambiguous-n' })
      ev('appositive', { type: 'chart' })
    } else if (ap?.type === 'thing') {
      reading.groups.push(thingGroupOf(ap.word, p.appos, w))
      ev('appositive', { type: typeOfNoun(ap.word) || 'thing' })
    } else if (p.from === 'chart') {
      reading.groups.push(pointerGroup(w, { plural: p.plural }))
      ev('container', { type: 'chart' })
    } else if (p.from === 'thing') {
      const ctext = text.slice(p.index)
      const lg = listGroups(ctext, w)
      if (p.container && typeOfNoun(p.container) === 'list' && lg?.container) {
        const items = lg.container.flatMap(l => (l.symbols || []).map(s => `item:${l.ref}:${up(s)}`))
        const prev = w.previous && typeOfId(w.previous) === 'list' && (items.includes(w.previous) || lg.container.some(l => `list:${l.ref}` === w.previous)) ? [w.previous] : null
        reading.groups.push(prev ? { type: 'list', refs: prev, source: 'container' } : { type: 'list', refs: items, source: 'container', ...(items.length ? { ask: 'ambiguous-n' } : { absent: true }) })
      } else reading.groups.push(p.container ? { ...thingGroupOf(p.container, ctext, w, { source: 'container' }), ask: 'ambiguous-n' } : { type: '*thing', refs: [], source: 'container', anyThing: true })
      ev('container', { type: typeOfNoun(p.container) || 'thing' })
    } else if (a?.type === 'chart') {
      const ms = chartMentions(before, w).filter(x => x.refs && x.role === 'object')
      const refs = [...new Set(ms.flatMap(x => x.refs))]
      reading.groups.push(refs.length && objectsOf(charts, refs) === 1 ? { type: 'chart', refs: refs.map(cid), source: 'appositive' } : pointerGroup(w, { plural: p.plural }))
      ev('appositive', { type: 'chart', before: true })
    } else if (a?.type === 'thing') {
      reading.groups.push(thingGroupOf(a.word, before, w, { made: antecedentMade(before, a.word) }))
      ev('appositive', { type: typeOfNoun(a.word) || 'thing', before: true })
    } else if (w.previous && typeOfId(w.previous) && typeOfId(w.previous) !== 'chart') {
      const t = typeOfId(w.previous)
      const pointed = [w.selection, w.subject].find(r => r != null && charts.some(c => c.ref === r))
      if (pointed != null) {
        reading.groups.push({ type: t, refs: [w.previous], source: 'previous', ask: 'pointer-vs-words' })
        reading.groups.push({ type: 'chart', refs: withGroup(charts, [pointed]).map(cid), source: 'pointer', ask: 'pointer-vs-words' })
      } else reading.groups.push({ type: t, refs: [w.previous], source: 'previous' })
      ev('previous', { type: t })
    } else {
      reading.groups.push(pointerGroup(w, { plural: p.plural }))
      ev('pointer', { plural: !!p.plural })
    }
  }
  // the pronoun's own span is out of the named read below
  for (const q of [...prons].sort((x, y) => y.index - x.index)) text = blank(text, q.index, q.length)

  // ── NAMED / DESCRIBED / ORDINAL mentions in the clauses that destroy ──
  const clauses = clausesOf(text).filter(c => destroying(c))
  let chartObjects = []
  for (const cl of clauses) {
    const lg = listGroups(cl, w)
    const listContainer = !!listContainerOf(cl, w)
    const ms = chartMentions(cl, w)
    const places = ms.filter(x => x.role === 'place' && x.refs).flatMap(x => x.refs)
    const placeSyms = [...new Set(charts.filter(c => places.includes(c.ref)).map(c => up(c.symbol)))]
    const things = []
    const ig = indicatorGroup(cl, w, places)
    if (ig) things.push(ig)
    const dg = drawingGroup(cl, w, placeSyms)
    if (dg) things.push(dg)
    if (lg?.group) things.push(lg.group)
    if (NOUNS.alert.test(cl)) things.push({ type: 'alert', refs: (w.alerts || []).map(a => a.id), source: 'named', ...((w.alerts || []).length ? { ask: 'ambiguous-n' } : { absent: true }) })
    reading.groups.push(...things)
    if (!relation) {
      for (const x of ms) {
        if (x.role !== 'object') continue
        if (listContainer && x.bare) continue                   // a ticker taken OUT of a list is a row, never a chart
        chartObjects.push(x)
      }
      if (!listContainer && SET_ALL.test(cl) && !chartObjects.some(x => x.refs)) chartObjects.push({ refs: charts.map(c => c.ref), plural: true, source: 'named', det: 'all', setAll: true })
    }
  }
  if (chartObjects.length) {
    for (const x of chartObjects) {
      if (x.pointer) { reading.groups.push(pointerGroup(w)); continue }
      if (!x.refs) {
        // the class noun: "the chart" / "all my charts" — the set, the sole chart, the click, else asked
        if (x.plural) { reading.groups.push({ type: 'chart', refs: charts.map(c => cid(c.ref)).filter(r => !reading.negated.has(r)), source: 'named', plural: true }); continue }
        const g = pointerGroup(w)
        reading.groups.push(x.det === 'this' || x.det === 'that' || g.source === 'sole' || g.ask ? g : { ...g })
        continue
      }
      let refs = x.refs.map(cid)
      if (x.setAll || x.plural) refs = refs.filter(r => !reading.negated.has(r))
      const many = objectsOf(charts, x.refs) > 1
      // I4: "this <named chart>" with ANOTHER chart clicked — the pointer and the words disagree: asked, both offered
      if ((x.det === 'this' || x.det === 'that') && w.selection && !x.refs.includes(w.selection) && x.refs.length) {
        reading.groups.push({ type: 'chart', refs: [...new Set([...refs, ...withGroup(charts, [w.selection]).map(cid)])], source: x.source, ask: 'pointer-vs-words' })
        ev('pointer-vs-words')
        continue
      }
      reading.groups.push(!x.refs.length ? { type: 'chart', refs: [], source: x.source || 'named', absent: true }
        : many && !x.plural ? { type: 'chart', refs, source: x.source || 'named', ask: 'ambiguous-n' } : { type: 'chart', refs, source: x.source || 'named', plural: x.plural })
      ev(x.source || 'named', { type: 'chart' })
    }
  }
  return reading
}
