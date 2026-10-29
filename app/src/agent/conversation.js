// ── UCT Agent CONVERSATION FOLLOW-UPS (Phase 2 — natural-language intelligence, 2026-10-29) ─────────────
//
// How traders actually follow up on what the Agent just did, read deterministically (no model call):
//
//   indicator referents   "make the first one green", "the fast one", "the slow ema", "those", "them both",
//                         "that indicator I just added", "the other one", "the 20" — from session memory's
//                         indicator set (memory.indicatorSet: what the latest adding / editing turn touched, in
//                         order), re-checked on the LIVE chart every time
//   what to do with them  colour · line style · width · remove · hide / show · a new length or type · pane size
//                         ("a little taller") · where it draws ("in its own pane", "under price") · copy them
//                         onto other charts ("put those on my other charts")
//   chart sets            "my other charts", "the others", "the rest", "all my charts", "all of them", "both",
//                         "everywhere" — the LIVE board, relative to the charts the conversation is about
//   repeat                "do the same thing on the other charts" — the last TURN's committed steps (memory.lastTurn),
//                         on each chart named; an indicator a step named is re-found there by what it IS (EMA 9),
//                         never by an id that belongs to another chart
//   match a look          "make all my charts match this one", "make this chart look like the one next to it"
//
// It returns the SAME registry ops a typed command produces; they go through the same planner, policy (a
// removal or a look copy is still a proposal), runtime, receipts and Undo — there is no second path. Anything
// it cannot read with certainty returns null (→ the model, which sees the same memory and asks); a reference
// that cannot hold is said plainly. It never invents an indicator, a chart or a value.
//
// Returns null | { kind: 'ops', ops, note?, pick? } | { kind: 'say', text }
//              | { kind: 'ask', text, choices: [{ ref, label }], ops, pickArg }

import { canon, matchPosition } from './fastPath'
import { getCapability, getTargetKind } from './capabilities'
import { indicatorRowsOf, indicatorEditsRef, defIdOfWords, inputsOfEditWords } from './capabilities/indicatorEdits'
import { colorValueOf } from './capabilities/indicatorControls'
import { selectedChart, ordinalChart } from './deixis'
import { subjectChart } from './references'
import { correctTypos, lexiconFor } from './nl/lexicon'

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────
// Conversational wrapping that carries no meaning of its own ("actually, …", "can you …", "… instead").
const LEADS = /^(?:(?:actually|ok|okay|now|and|also|then|so|alright|all right|cool|great|perfect|nice|sweet|good|hmm|hm|wait|oh|yeah|yep|right|um|uh|hey)[,!.]?\s+)+/
const ASKS = /^(?:(?:can|could|would|will) (?:you|u) (?:please |pls )?|please |pls |i want you to |i'?d like you to |go ahead and |let'?s |lets |just |quickly )+/
const TAILS = /(?:,?\s+(?:instead|too|as well|also|then|now|for me|please|pls|thanks|thank you|thx|real quick|quickly|again|if you can|if possible))+$/
export function tidy(text) {
  let s = canon(text).replace(/[.!?]+$/, '').trim()
  for (let i = 0; i < 3; i++) {
    const t = s.replace(LEADS, '').replace(ASKS, '').replace(TAILS, '').trim()
    if (t === s) break
    s = t
  }
  return s
}

const IND_NOUN = '(?:one|indicator|line|ema|sma|wma|hma|ma|average|moving average|study)'
const IND_NOUNS = '(?:ones|indicators|lines|emas|smas|mas|averages|moving averages|studies)'
const R_PLURAL = new RegExp(`^(?:them|those|these|both|both of (?:them|those)|them both|them all|those all|all of (?:them|those)|all (?:the |those |these |of the |of those )?${IND_NOUNS}|(?:the|those|these) (?:two|three|four|2|3|4)(?: ${IND_NOUNS})?|(?:those|these|the) (?:new )?${IND_NOUNS}|the (?:ones|indicators) (?:i|you) (?:just )?added)$`)
// (the shared normaliser drops the word "indicator": "that indicator I just added" arrives as "that i just added")
const R_IT = new RegExp(`^(?:it|that|this|that one|this one|(?:that|this|the) (?:new )?(?:indicator|line|study)|the new one|(?:the|that|this) (?:one |indicator |line )?(?:i|you) (?:just )?(?:added|put on)|what (?:i|you) (?:just )?added|the last (?:one|indicator )?(?:i|you) added)$`)
const R_ORD = new RegExp(`^the (first|second|third|fourth|1st|2nd|3rd|4th|last|top|bottom|other)(?: ${IND_NOUN})?$`)
const R_SPEED = new RegExp(`^the (fast|faster|fastest|quick|quicker|short|shorter|shortest|slow|slower|slowest|long|longer|longest)(?: ${IND_NOUN})?$`)
const R_LEN = /^(?:the )?(\d{1,4})(?: (ema|sma|wma|hma|ma|moving average|line|one|day|period))?$/
const PRONOUN = /^(?:it|that|this|that one|this one|them|those|these|both|them both|them all)$/
/** Was the last committed change about indicators? (a pronoun then points at them) */
export function aboutIndicators(memory, epoch) {
  const last = memory?.lastTurn?.(epoch)
  return !!last && last.ops.length > 0 && last.ops.every(o => getCapability(o.action)?.target === 'indicatorEdits')
}
const ORD_N = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, top: 1, last: -1, bottom: -1 }
const FAST = /^(?:fast|faster|fastest|quick|quicker|short|shorter|shortest)$/

// ── referents: which of the conversation's indicators the words mean ─────────────────────────────────
const lenOf = (row) => {
  const i = row?.inputs || {}
  const v = Number(i.period ?? i.length)
  if (Number.isFinite(v) && v > 0) return v
  const m = /(\d{1,4})/.exec(String(row?.name || ''))
  return m ? Number(m[1]) : null
}
const typeOf = (row) => {
  const t = String(row?.inputs?.maType || '').toLowerCase()
  if (t) return t
  const m = /\b(ema|sma|wma|hma|vwma|smma|dema|tema)\b/i.exec(String(row?.name || ''))
  return m ? m[1].toLowerCase() : null
}
function chartSnap(host, ref) { try { return host?.charts?.read?.(ref) || null } catch { return null } }
function chartsOf(host) { try { return host?.charts?.list?.() || [] } catch { return [] } }

/** The conversation's indicators that are STILL on their charts, in order, with what each one is. */
export function liveIndicators(host, memory, epoch) {
  const set = memory?.indicatorSet?.(epoch) || null
  if (!set) return []
  const out = []
  for (const s of set) {
    const c = chartSnap(host, s.chart)
    if (!c) continue
    const row = indicatorRowsOf(c.cs).find(r => r.instanceId === s.instanceId)
    if (row) out.push({ chart: s.chart, chartLabel: c.label, instanceId: row.instanceId, defId: row.defId, name: row.name, len: lenOf(row), type: typeOf(row), placement: row.displayTarget || row.placement, hidden: row.hidden === true })
  }
  return out
}
// a description means what the member can SEE: a hidden indicator counts only when no visible one fits
const visibleFirst = (list) => { const v = list.filter(i => !i.hidden && !i.none); return v.length ? v : list.filter(i => !i.none) }
/** Every indicator the latest turn acted on (any change), still on its chart, in order. */
export function liveMentions(host, memory, epoch) {
  const list = memory?.mentioned?.(epoch) || null
  if (!list) return []
  const out = []
  for (const s of list) {
    const row = rowsOnChart(host, s.chart).find(r => r.instanceId === s.instanceId)
    if (row) out.push(row)
  }
  return out
}
// the one chart a referent-less "the 20" / "the rsi" means: the conversation's indicators' chart, else the chart
// in front of the member (one chart / the clicked one / the subject) — never a guess between several
function homeChart(host, memory, epoch, live) {
  const charts = [...new Set(live.map(i => i.chart))]
  if (charts.length === 1) return charts[0]
  return subjectChart(host, memory, epoch)?.ref || null
}
function rowsOnChart(host, chartRef) {
  const c = chartSnap(host, chartRef)
  return c ? indicatorRowsOf(c.cs).map(r => ({ chart: chartRef, chartLabel: c.label, instanceId: r.instanceId, defId: r.defId, name: r.name, len: lenOf(r), type: typeOf(r), placement: r.displayTarget || r.placement, hidden: r.hidden === true })) : []
}

/**
 * Words → the indicators they mean. → { list } (one or more, in order) | { ask: { text, choices } } | { say } | null
 * (the words are not an indicator reference this module reads).
 */
// `taken`: the indicators an EARLIER part of the same instruction already named ("make the fast one green and the other
// one yellow" — "the other one" is the one that is left)
export function resolveReferent(words, { host, memory, epoch = null, live = null, pinned = null, dry = false, working = null, taken = null } = {}) {
  const w = String(words || '').trim()
  if (!w) return null
  // `dry`: is this a reference at all? (a multi-step request is read in full before anything runs — compound.js)
  if (dry) return isReferentWords(w) ? { list: [DRY] } : null
  if (!isReferentWords(w)) return null
  // the member already picked which one (a local "which one?") — a singular reference means exactly that one
  if (pinned && !R_PLURAL.test(w)) return { list: [pinned] }
  const set0 = live || liveIndicators(host, memory, epoch)
  // ⛔ a bare PRONOUN ("it", "that", "them", "those") means the conversation's indicators only while the
  // conversation is ABOUT them — the last change was an indicator change ("make it weekly" after a chart change
  // is the chart's). A description ("the first one", "the fast one", "those indicators") always may.
  let set = PRONOUN.test(w) && !aboutIndicators(memory, epoch) ? [] : set0
  // ⭐ a multi-step request (compound.js) working on several charts, with nothing of the conversation's to point
  // at (its adds were already there): a DESCRIPTION ("the 9", "the fast one") is read on each of those charts
  // (inside such a request a description is read on its charts even when some of them were just added to) — and on
  // EVERY one of them: a chart where nothing matches is said, never silently skipped
  if (!live && Array.isArray(working) && working.length && !PRONOUN.test(w) && !R_IT.test(w)) {
    const all = []
    for (const ref of working) {
      const sub = rowsOnChart(host, ref)
      const r = resolveReferent(w, { host, memory, epoch, live: sub.length ? sub : [{ chart: ref, chartLabel: chartSnap(host, ref)?.label || 'that chart', none: true }] })
      if (!r?.list || r.list.length !== 1 || r.list[0].none) {
        const label = chartSnap(host, ref)?.label || 'one of those charts'
        return r?.say ? r : { say: `${label} has nothing that matches “${w}”` }
      }
      all.push(r.list[0])
    }
    return { list: all }
  }
  const had = (memory?.indicatorSet?.(epoch) || []).length
  const gone = () => ({ say: had && set === set0 ? 'The indicators I last added aren’t on the chart any more, so there’s nothing to change.' : null })
  // ⭐ the conversation's indicators are on SEVERAL charts ("put the 9 and 20 on all four"): a singular description
  // means that one ON EACH chart ("make the 9 green" → every chart's EMA 9), only when it is clear on every one
  const groups = byChart(set)
  if (groups.size > 1 && !R_PLURAL.test(w)) {
    if (R_IT.test(w)) {
      const same = new Set(set.map(i => `${i.defId}|${i.len}|${i.type}`))
      return [...groups.values()].every(g => g.length === 1) && same.size === 1 ? { list: set } : { say: `Which one — ${[...new Set(set.map(i => i.name))].join(' or ')}? Say it by name (“the ${set[0].name}”).` }
    }
    const all = []
    for (const sub of groups.values()) {
      const r = resolveReferent(w, { host, memory, epoch, live: sub })
      if (!r?.list || r.list.length !== 1) return r?.say ? r : { say: `I can't tell which one you mean on ${sub[0].chartLabel} — say it by name.` }
      all.push(r.list[0])
    }
    return { list: all }
  }
  if (R_PLURAL.test(w)) {
    // right after a COPY ("put those on my other charts"), "them all" is the originals AND their copies
    const last = memory?.lastTurn?.(epoch)
    if (!live && last && last.ops.length && last.ops.every(o => o.action === 'indicatorCopy.copyTo')) {
      const copies = liveMentions(host, memory, epoch).filter(c => !set.some(i => i.chart === c.chart && i.instanceId === c.instanceId))
      if (copies.length) return { list: [...set, ...copies] }
    }
    if (set.length >= 1) return { list: set }
    return gone().say ? gone() : null
  }
  if (R_IT.test(w)) {
    if (set.length === 1) return { list: set }
    if (set.length > 1) return { ask: askOne(set, `Which one — ${set.map(i => i.name).join(' or ')}?`) }
    return gone().say ? gone() : null
  }
  let m = R_ORD.exec(w)
  if (m) {
    if (set.length < 2) return set.length ? null : (gone().say ? gone() : null)
    if (m[1] === 'other') {
      const picked = (Array.isArray(taken) && taken.length ? taken : null) || memory?.lastPick?.() || []
      const rest = set.filter(i => !picked.includes(i.instanceId))
      return rest.length === 1 && picked.length ? { list: rest } : { ask: askOne(set, `Which one — ${set.map(i => i.name).join(' or ')}?`) }
    }
    const n = ORD_N[m[1]]
    const i = n === -1 ? set.length - 1 : n - 1
    if (i < 0 || i >= set.length) return { say: `I only added ${set.length} — ${set.map(x => x.name).join(' and ')}.` }
    return { list: [set[i]] }
  }
  m = R_SPEED.exec(w)
  if (m) {
    // the conversation's moving averages, else the moving averages on the chart in front of the member
    let pool = visibleFirst(set.filter(i => i.len != null && i.defId === 'movingAverage'))
    if (pool.length < 2) {
      const home = homeChart(host, memory, epoch, set)
      pool = home ? visibleFirst(rowsOnChart(host, home).filter(i => i.len != null && i.defId === 'movingAverage')) : []
    }
    if (pool.length < 2) return null
    const lens = [...new Set(pool.map(i => i.len))].sort((a, b) => a - b)
    const want = FAST.test(m[1]) ? lens[0] : lens[lens.length - 1]
    const hit = pool.filter(i => i.len === want)
    if (hit.length !== 1) return { ask: askOne(pool, `Which one — ${pool.map(i => i.name).join(', ')}?`) }
    return { list: hit }
  }
  m = R_LEN.exec(w)
  if (m) {
    const n = Number(m[1])
    const type = m[2] && /^(?:ema|sma|wma|hma)$/.test(m[2]) ? m[2] : null
    const fit = (i) => i.len === n && (!type || i.type === type)
    const inSet = visibleFirst(set.filter(fit))
    if (inSet.length === 1) return { list: inSet }
    const home = homeChart(host, memory, epoch, set)
    if (!home) return null
    const onChart = visibleFirst(rowsOnChart(host, home).filter(fit))
    if (onChart.length === 1) return { list: onChart }
    if (onChart.length > 1) return { ask: askOne(onChart, `More than one ${type ? type.toUpperCase() + ' ' : ''}${n} is on ${onChart[0].chartLabel} — which one?`) }
    return null
  }
  // "the rsi", "the macd" — one indicator of that kind (the conversation's first, else the chart's)
  const kind = defIdOfWords(w.replace(/^(?:the|my) /, '').replace(/ (?:pane|indicator|line)$/, ''))
  if (kind) {
    const inSet = visibleFirst(set.filter(i => i.defId === kind))
    if (inSet.length === 1) return { list: inSet }
    const home = homeChart(host, memory, epoch, set)
    if (!home) return null
    const onChart = visibleFirst(rowsOnChart(host, home).filter(i => i.defId === kind))
    if (onChart.length === 1) return { list: onChart }
    if (onChart.length > 1) return { ask: askOne(onChart, `More than one ${onChart[0].name.split(' ')[0]} is on ${onChart[0].chartLabel} — which one?`) }
  }
  return null
}
const DRY = Object.freeze({ chart: null, instanceId: null, defId: null, name: 'it', len: null, type: null, placement: null, dry: true })
/** Do these words name an indicator by reference or description (not: are they on the board)? */
export function isReferentWords(w) {
  const s = String(w || '').trim()
  return R_PLURAL.test(s) || R_IT.test(s) || R_ORD.test(s) || R_SPEED.test(s) || R_LEN.test(s)
    || !!defIdOfWords(s.replace(/^(?:the|my) /, '').replace(/ (?:pane|indicator|line)$/, ''))
}
// a local question whose choices ARE the indicators (each choice fills the op's `instance`; all on one chart)
function askOne(list, text) {
  const charts = new Set(list.map(i => i.chart))
  return { text, choices: charts.size === 1 ? list.map(i => ({ ref: i.instanceId, label: i.name })) : [] }
}

// ── chart sets ────────────────────────────────────────────────────────────────────────────────────────
const NUMW = '(?:two|three|four|five|six|2|3|4|5|6)'
const R_OTHERS = new RegExp(`^(?:all )?(?:of )?(?:my |the |our )?(?:${NUMW} )?other(?: ${NUMW})?(?: (?:charts?|ones?))?$|^(?:the )?others$|^(?:all )?the rest(?: of (?:them|the charts|my charts|the board))?$|^every other chart$|^everything else$|^all the others$`)
const R_ALL = new RegExp(`^(?:all(?: of)? (?:my |the |these |those )?charts|all (?:of )?(?:them|those|these)|(?:all )?(?:${NUMW}) (?:of them|charts)|all ${NUMW}(?: of them| charts)?|every chart|each chart|each of them|every one of them|everywhere|every single chart|both(?: charts| of them)?|the whole board|my whole board)$`)

/**
 * A chart-set phrase → { refs } (one or more live chart refs) | { say } | null. `sources` = the charts the
 * conversation is about (excluded by "the other charts"; "all" keeps every chart).
 */
export function chartSet(phrase, { host, sources = [] } = {}) {
  const p = String(phrase || '').trim().replace(/\s+(?:too|as well|also)$/, '')
  if (!p) return null
  const charts = chartsOf(host)
  if (!charts.length) return { say: 'There are no charts on this board.' }
  if (R_OTHERS.test(p)) {
    const src = new Set(sources)
    if (!src.size) return null                                   // "the others" — other than what? → the model
    const refs = charts.filter(c => !src.has(c.ref)).map(c => c.ref)
    return refs.length ? { refs } : { say: 'There are no other charts on this board.' }
  }
  if (R_ALL.test(p)) {
    if (/^both/.test(p) && charts.length !== 2) return { say: `There are ${charts.length} charts here, not two — say “all charts” or name the ones you mean. Nothing has changed.` }
    return { refs: charts.map(c => c.ref) }
  }
  const one = oneChart(p, charts, host)
  return one ? { refs: [one] } : null
}
// one chart named by a position ("the top right one", "top left"), an ordinal ("the second chart") or the symbol it shows
function oneChart(p, charts, host) {
  const s = p.replace(/^(?:on|to|onto|for|in) /, '').replace(/^(?:the|my) /, '')
  if (/^(?:this|this chart|this one|the selected chart)$/.test(s)) { const sel = selectedChart(host); return charts.some(c => c.ref === sel) ? sel : null }
  const ord = ordinalChart(`the ${s}`, charts)
  if (ord?.ref) return ord.ref
  const pos = /^(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)(?: (?:chart|one|side))?$/.exec(s)
  if (pos) {
    const word = pos[1].replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom')
    const hit = matchPosition(charts, word)
    return hit.length === 1 ? hit[0].ref : null
  }
  const sym = /^\$?([a-z][a-z0-9.]{0,9})(?: chart| one)?$/.exec(s)
  if (sym) {
    const hit = charts.filter(c => String(c.symbol || '').toLowerCase() === sym[1])
    return hit.length === 1 ? hit[0].ref : null
  }
  return null
}

// ── verbs ─────────────────────────────────────────────────────────────────────────────────────────────
const COLOR_RE = /^(?:light |dark |bright )?[a-z]+$|^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/
const colorOf = (w) => (COLOR_RE.test(w) ? colorValueOf(w) : null)
const STYLE_WORDS = { dashed: ['lineStyle', 'dashed'], dotted: ['lineStyle', 'dotted'], solid: ['lineStyle', 'solid'], thicker: ['lineWidth', 'thicker'], thinner: ['lineWidth', 'thinner'], bolder: ['lineWidth', 'thicker'], bold: ['lineWidth', 'thicker'], thick: ['lineWidth', 'thicker'], thin: ['lineWidth', 'thinner'], fatter: ['lineWidth', 'thicker'] }
const SIZE_RE = /^(?:a (?:little|bit|tad|touch)(?: bit)? |slightly |much |way |a lot |a little more |more |even )?(taller|bigger|larger|shorter|smaller|tiny|huge)$/
const SIZE_WORD = { taller: 'bigger', bigger: 'bigger', larger: 'bigger', huge: 'bigger', shorter: 'smaller', smaller: 'smaller', tiny: 'smaller' }
const PLACE_WORDS = [
  [/^(?:its own pane|their own panes?|a (?:separate|new|different|seperate) pane|(?:separate|seperate|own|new) panes?|a pane of (?:its|their) own|(?:its|their) own window)$/, 'pane'],
  [/^(?:the )?(?:price|price pane|price chart|candles|main chart|chart|main pane)$/, 'price'],
  [/^(?:the )?(?:volume|volume pane)$/, 'volume'],
]
const placeOf = (w) => { for (const [re, v] of PLACE_WORDS) if (re.test(w)) return v; return null }
const VERB = '(?:make|turn|colou?r|paint|change|set|switch)'
const REMOVE_VERB = '(?:remove|delete|kill|drop|lose|ditch|nuke|scrap|get rid of|take off|take away|clear)'

const ixe = (chart) => indicatorEditsRef(chart)
const byChart = (list) => list.reduce((m, i) => m.set(i.chart, [...(m.get(i.chart) || []), i]), new Map())

/** One clause about indicators the words point at → { ops, ids } | { ask } | { say } | null. */
function indicatorClause(t, ctx) {
  const ref = (words) => resolveReferent(words, ctx)
  if (ctx.dry) {
    // shape only: every branch below is reachable with a stand-in indicator; the placement checks are not
    const r = indicatorClauseShape(t)
    return r
  }
  const done = (r, make) => {
    if (!r) return null
    if (r.say || r.ask) return r
    const ops = r.list.map(make).filter(Boolean)
    return ops.length === r.list.length ? { ops, ids: r.list.map(i => i.instanceId), list: r.list } : null
  }
  let m
  // colour: "make the first one green", "turn them yellow", "colour the fast one #ff0"
  m = new RegExp(`^${VERB} (.+?) (?:to |into )?(?:be )?(?:a |an )?((?:light |dark |bright )?[a-z]+|#[0-9a-f]{3,6})(?: colou?r)?$`).exec(t)
  if (m && colorOf(m[2])) {
    return done(ref(m[1]), i => ({ action: 'indicatorStyle.set', target: ixe(i.chart), args: { instance: i.instanceId, property: 'color', value: m[2], output: null } }))
  }
  // line style / width: "make them dashed", "make the 20 thicker"
  m = new RegExp(`^${VERB} (.+?) (?:a (?:little|bit) )?(${Object.keys(STYLE_WORDS).join('|')})$`).exec(t)
  if (m) {
    const [property, value] = STYLE_WORDS[m[2]]
    return done(ref(m[1]), i => ({ action: 'indicatorStyle.set', target: ixe(i.chart), args: { instance: i.instanceId, property, value, output: null } }))
  }
  // pane size: "make it a little taller", "make the rsi bigger"
  m = new RegExp(`^${VERB} (.+?)(?:'s pane| pane)? (.+)$`).exec(t)
  if (m && SIZE_RE.test(m[2])) {
    const size = SIZE_WORD[SIZE_RE.exec(m[2])[1]]
    const r = ref(m[1])
    if (r?.list && r.list.some(i => i.placement === 'price')) {
      const one = r.list.find(i => i.placement === 'price')
      return { say: `${one.name} draws on the price chart, so it has no pane of its own to resize — say “put ${one.name} in its own pane” first.` }
    }
    return done(r, i => ({ action: 'pane.resize', target: ixe(i.chart), args: { pane: i.instanceId, size } }))
  }
  // remove: "get rid of that indicator I just added", "remove the slow one" (a proposal — policy)
  m = new RegExp(`^${REMOVE_VERB} (.+?)(?: (?:from|off|off of) (?:the|my|this|that) chart)?$`).exec(t)
    || /^take (.+?) off(?: of)?(?: (?:the|my|this|that) chart)?$/.exec(t)
  if (m) return done(ref(m[1]), i => ({ action: 'indicator.remove', target: ixe(i.chart), args: { instance: i.instanceId } }))
  // hide / show
  m = /^(hide|show|unhide|turn off|turn on) (.+)$/.exec(t) || /^turn (.+) (off|on)$/.exec(t)
  if (m) {
    const [verb, words] = /^turn .+ (?:off|on)$/.test(t) ? [m[2] === 'off' ? 'hide' : 'show', m[1]] : [m[1], m[2]]
    const action = /hide|off/.test(verb) ? 'indicator.hide' : 'indicator.show'
    return done(ref(words), i => ({ action, target: ixe(i.chart), args: { instance: i.instanceId } }))
  }
  // where it draws: "put it in its own pane", "move them to the price chart"
  m = /^(?:put|move|place|stick|send|throw) (.+?) (?:in|into|on|onto|to|in to) (.+)$/.exec(t)
  if (m && placeOf(m[2])) {
    const place = placeOf(m[2])
    return done(ref(m[1]), i => ({ action: 'indicatorStyle.placeIn', target: ixe(i.chart), args: { instance: i.instanceId, place } }))
  }
  // above / below: "put rsi under price", "move the 9 above the 20"
  m = /^(?:put|move|place|stick) (.+?) (under|below|beneath|underneath|above|on top of) (.+)$/.exec(t)
  if (m) {
    const r = ref(m[1])
    if (!r || r.say || r.ask) return r
    if (r.list.length !== 1) return null
    const it = r.list[0]
    const to = /^(?:under|below|beneath|underneath)$/.test(m[2]) ? 'below' : 'above'
    const other = m[3].replace(/^the /, '')
    const rel = /^(?:price|candles|chart|price pane|main chart)$/.test(other) ? 'price' : /^volume(?: pane)?$/.test(other) ? 'volume' : null
    if (!rel) {
      const r2 = resolveReferent(m[3], ctx)
      if (!r2?.list || r2.list.length !== 1) return r2?.say || r2?.ask ? r2 : null
      const o = r2.list[0]
      if (it.placement === 'price' && o.placement === 'price') {
        return { say: `${it.name} and ${o.name} both draw on the price chart — UCT can’t change which line draws on top yet. I can put one of them in its own pane instead.` }
      }
      if (it.placement === 'price') return { say: `${it.name} draws on the price chart — say “put ${it.name} in its own pane” first, then I can move its pane.` }
      return { ops: [{ action: 'pane.move', target: ixe(it.chart), args: { pane: it.instanceId, to, relativeTo: o.instanceId } }], ids: [it.instanceId], list: [it] }
    }
    // already in its own pane → move that pane; on the price chart and asked to go under it → its own pane (drawn below)
    if (it.placement === 'price' && rel === 'price' && to === 'below') return { ops: [{ action: 'indicatorStyle.placeIn', target: ixe(it.chart), args: { instance: it.instanceId, place: 'pane' } }], ids: [it.instanceId], list: [it] }
    if (it.placement === 'price') return { say: `${it.name} draws on the price chart — say “put ${it.name} in its own pane” first, then I can move its pane.` }
    return { ops: [{ action: 'pane.move', target: ixe(it.chart), args: { pane: it.instanceId, to, relativeTo: rel } }], ids: [it.instanceId], list: [it] }
  }
  // a new length / type: "make the first one a 50", "change them to sma"
  m = new RegExp(`^${VERB} (.+?) (?:to |into )?(?:an? |the )?(\\d{1,4}(?:[- ](?:day|period))?(?: (?:ema|sma|wma|hma))?|ema|sma|wma|hma|exponential|simple|weighted)$`).exec(t)
  if (m) {
    const r = ref(m[1])
    return done(r, i => {
      const inputs = inputsOfEditWords(i.defId, m[2])
      return inputs && inputs.length ? { action: 'indicator.update', target: ixe(i.chart), args: { instance: i.instanceId, inputs } } : null
    })
  }
  return null
}

// the same grammar with no board: does this clause SAY something about indicators the conversation can resolve?
function indicatorClauseShape(t) {
  const isRef = (w) => isReferentWords(w)
  let m = new RegExp(`^${VERB} (.+?) (?:to |into )?(?:be )?(?:a |an )?((?:light |dark |bright )?[a-z]+|#[0-9a-f]{3,6})(?: colou?r)?$`).exec(t)
  if (m && colorOf(m[2]) && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  m = new RegExp(`^${VERB} (.+?) (?:a (?:little|bit) )?(${Object.keys(STYLE_WORDS).join('|')})$`).exec(t)
  if (m && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  m = new RegExp(`^${VERB} (.+?)(?:'s pane| pane)? (.+)$`).exec(t)
  if (m && SIZE_RE.test(m[2]) && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  m = new RegExp(`^${REMOVE_VERB} (.+?)(?: (?:from|off|off of) (?:the|my|this|that) chart)?$`).exec(t) || /^take (.+?) off(?: of)?(?: (?:the|my|this|that) chart)?$/.exec(t)
  if (m && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  m = /^(?:put|move|place|stick|send|throw) (.+?) (?:in|into|on|onto|to|in to) (.+)$/.exec(t)
  if (m && placeOf(m[2]) && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  m = /^(?:put|move|place|stick) (.+?) (under|below|beneath|underneath|above|on top of) (.+)$/.exec(t)
  if (m && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  m = new RegExp(`^${VERB} (.+?) (?:to |into )?(?:an? |the )?(\\d{1,4}(?:[- ](?:day|period))?(?: (?:ema|sma|wma|hma))?|ema|sma|wma|hma|exponential|simple|weighted)$`).exec(t)
  if (m && isRef(m[1])) return { ops: [{ dry: true }], ids: [] }
  return null
}

// "make the 9 green and the 20 yellow", "make the first one green, the second red" — a bare follow-on clause
// takes the previous clause's verb
const CLAUSE_SPLIT = /\s*(?:,\s*(?:and\s+)?|\s+and\s+|;\s*|\s+then\s+)\s*/
const LEAD_VERB = new RegExp(`^(${VERB}|${REMOVE_VERB}|hide|show|unhide|put|move|place)\\b`)
// a part that starts a NEW instruction (any verb UCT reads) — in a multi-step request it is a step of its own
const NEW_VERB = new RegExp(`^(?:${VERB}|${REMOVE_VERB}|hide|show|unhide|put|move|place|add|copy|throw|give|create|open|load|switch|apply|repeat|do|match)\\b`)
function indicatorClauses(t, ctx) {
  const whole = indicatorClause(t, ctx)
  if (whole) return whole
  const parts = t.split(CLAUSE_SPLIT).filter(Boolean)
  if (parts.length < 2 || parts.length > 6) return null
  // read for SHAPE (a multi-step request): one step is one instruction — "make the 9 green and 20 yellow" (the
  // second part borrows the verb); a part with a verb of its own ("…, and put RSI in its own pane") is its own step
  if (ctx.dry && parts.slice(1).some(c => NEW_VERB.test(c))) return null
  const ops = []
  const ids = []
  let verb = null
  for (const c of parts) {
    const v = LEAD_VERB.exec(c)
    const clause = v ? c : verb ? `${verb} ${c.replace(/^(?:the )?/, 'the ')}` : null
    if (!clause) return null
    if (v) verb = v[1]
    const r = indicatorClause(clause, ids.length ? { ...ctx, taken: [...ids] } : ctx)
    if (!r || r.say || r.ask) return r && (r.say || r.ask) ? r : null
    ops.push(...r.ops); ids.push(...r.ids)
  }
  return { ops, ids }
}

// ── copy / repeat / match ─────────────────────────────────────────────────────────────────────────────
const COPY_RE = /^(?:put|add|copy|throw|apply|stick|place|slap|give|get) (.+?) (?:on|to|onto|in|into|across|for|over to) (.+)$/
const GIVE_RE = /^give (.+?) (the same(?: indicators| ones| studies| setup)?|those|them|these)$/
const SAME_RE = /^(?:(?:do|apply|make|repeat|copy) )?(?:the )?same(?: thing| things| changes?| settings| again| setup)?(?: (?:on|for|to|with|in|across|onto)) (.+)$/
const THAT_RE = /^(?:do|repeat|apply|copy) (?:that|it|this|those|these)(?: change| changes)? (?:on|for|to|with|in|across|onto) (.+)$/
const SAME_THINGS = /^(?:the same(?: indicators?| ones| studies| setup| lines)?|these indicators|my indicators|(?:the|those|these) same ones)$/
const MATCH_RE = /^(?:make|set|have|get) (.+?) (?:match|look like|look the same as|look just like|mirror) (.+)$/
const MATCH2_RE = /^match (.+?) (?:to|with) (.+)$/
const NEXT_TO = /^(?:the (?:one|chart) )?(?:next to|beside|by) (?:it|this(?: one)?|that(?: one)?)$|^the (?:one|chart) next door$|^its neighbou?r$|^the neighbou?ring chart$/

// what each step of a turn IS, so it can be found again on another chart ("#9:ema", "rsi") — or null
function portable(row) {
  if (!row) return null
  if (row.defId === 'movingAverage' && row.len) return `#${row.len}${row.type ? `:${row.type}` : ''}`
  return row.defId
}
function repeatOps(last, dests, host) {
  const out = []
  for (const o of last.ops) {
    const cap = getCapability(o.action)
    if (!cap || cap.query || (cap.risk || 'local') !== 'local' || cap.reversible === false) return null
    const kind = getTargetKind(cap.target)
    if (!kind) return null
    if (cap.target === 'indicatorEdits') {
      const src = String(o.target)
      const rows = rowsOnChart(host, src)
      const args = { ...(o.args || {}) }
      for (const key of ['instance', 'pane']) {
        if (typeof args[key] !== 'string' || /^(?:price|volume)$/.test(args[key])) continue
        // already said by what it IS ("#20:ema", "rsi" — the instant path's own form): re-found on each chart as it is
        if (/^#\d/.test(args[key]) || defIdOfWords(args[key])) continue
        const row = rows.find(r => r.instanceId === args[key])
        const p = portable(row)
        if (!p) return null                                            // not re-findable on another chart
        args[key] = p
      }
      if (o.action === 'indicatorCopy.copyTo') return null
      for (const d of dests) out.push({ action: o.action, target: ixe(d), args })
    } else if (kind.name === 'chart') {
      for (const d of dests) out.push({ action: o.action, target: d, args: o.args })
    } else return null                                                 // a board / list change does not repeat per chart
  }
  return out
}
const MAX_FOLLOW_OPS = 24        // the most one follow-up may plan (each is still planned, checked and receipted)

/** "the one next to it" — the other chart on a two-chart board, else the one beside `of` in its row. */
function neighbour(charts, of) {
  if (charts.length === 2) return charts.find(c => c.ref !== of)?.ref || null
  const me = charts.find(c => c.ref === of)
  if (!me?.cell) return null
  const row = charts.filter(c => c.ref !== of && c.cell && c.cell.y === me.cell.y && (c.cell.x + c.cell.w === me.cell.x || me.cell.x + me.cell.w === c.cell.x))
  return row.length === 1 ? row[0].ref : null
}

/** The chart "this one" / "it" means for a look or a repeat: the clicked chart, else the conversation's chart. */
function thisChart(host, memory, epoch) {
  const sel = selectedChart(host)
  if (sel && chartsOf(host).some(c => c.ref === sel)) return sel
  return subjectChart(host, memory, epoch)?.ref || null
}

function copyLookPlan(toWords, fromWords, ctx) {
  const { host, memory, epoch } = ctx
  const charts = chartsOf(host)
  if (charts.length < 2) return null
  const fromPhrase = fromWords.trim()
  let from = null
  // (the shared normaliser reads "this chart" / "my chart" as "the chart")
  const THIS = /^(?:this|this one|this chart|it|that one|that chart|the chart|my chart|the selected chart)$/
  if (THIS.test(fromPhrase)) from = thisChart(host, memory, epoch)
  let to = null
  const toSet = THIS.test(toWords) ? { refs: [thisChart(host, memory, epoch)].filter(Boolean) } : chartSet(toWords, { host, sources: from ? [from] : [] })
  if (!from && NEXT_TO.test(fromPhrase) && toSet?.refs?.length === 1) from = neighbour(charts, toSet.refs[0])
  if (!from) { const s = chartSet(fromPhrase, { host }); from = s?.refs?.length === 1 ? s.refs[0] : null }
  if (!from || !toSet?.refs?.length) return toSet?.say ? { kind: 'say', text: toSet.say } : null
  to = toSet.refs.filter(r => r !== from)
  if (!to.length) return { kind: 'say', text: 'That names the same chart twice — which chart should change, and which should it look like?' }
  return { kind: 'ops', ops: to.map(r => ({ action: 'chartSetup.copyLook', target: r, args: { from } })) }
}

// ── the entry point ───────────────────────────────────────────────────────────────────────────────────
function readOnce(t, ctx) {
  const { host, memory, epoch } = ctx
  // match a look: "make all my charts match this one", "make this chart look like the one next to it"
  let m = MATCH_RE.exec(t) || MATCH2_RE.exec(t)
  if (m) {
    const r = copyLookPlan(m[1], m[2], ctx)
    if (r) return r
  }
  // repeat the last turn: "do the same thing on the other charts", "same on the right one"
  m = SAME_RE.exec(t) || THAT_RE.exec(t)
  if (m) {
    const last = memory?.lastTurn?.(epoch)
    // nothing of the board's to repeat: another reader's ("same thing for Nasdaq" re-runs a breadth search) or the model's
    if (!last) return null
    const set = chartSet(m[1], { host, sources: last.charts.map(c => String(c).replace(/^ixe:/, '')) })
    if (!set) return null
    if (set.say) return { kind: 'say', text: set.say }
    const srcs = new Set(last.charts.map(c => String(c).replace(/^ixe:/, '')))
    const dests = set.refs.filter(r => !srcs.has(r))
    if (!dests.length) return { kind: 'say', text: 'That change is already on that chart.' }
    const ops = repeatOps({ ops: last.ops.map(o => ({ ...o, target: String(o.target).replace(/^ixe:/, '') })) }, dests, host)
    if (!ops) return null                                           // not plainly repeatable → the model (which may ask)
    if (ops.length > MAX_FOLLOW_OPS) return { kind: 'say', text: `That would be ${ops.length} changes at once — UCT makes at most ${MAX_FOLLOW_OPS} in one follow-up. Name fewer charts. Nothing has changed.` }
    return { kind: 'ops', ops }
  }
  // copy the conversation's indicators onto charts: "now put those on my other charts", "add them to all of them"
  m = COPY_RE.exec(t)
  const g = m ? null : GIVE_RE.exec(t)
  if (m || g) {
    const [what, where] = m ? [m[1], m[2]] : [g[2], g[1]]
    const live = liveIndicators(host, memory, epoch)
    const same = SAME_THINGS.test(what)
    // only words that POINT BACK ("those", "the first one", "the same indicators"); "add rsi to all my charts"
    // names an indicator to add fresh — the fast path's, as before
    const back = same || R_PLURAL.test(what) || R_IT.test(what) || R_ORD.test(what) || R_SPEED.test(what)
    // "those" / "the same indicators": everything the latest turn acted on when that was several ("add the 9 and 20, make
    // the 9 green, move RSI into its own pane, and copy those …"), else the conversation's indicator set
    const ment = liveMentions(host, memory, epoch)
    const plural = same || R_PLURAL.test(what)
    const pool = PRONOUN.test(what) && !aboutIndicators(memory, epoch) ? [] : plural && ment.length >= 2 ? ment : live
    const r = !back ? null : plural ? (pool.length ? { list: pool } : null) : resolveReferent(what, { ...ctx, live })
    if (r?.list) {
      const srcCharts = [...byChart(r.list).keys()]
      if (srcCharts.length !== 1) return null                       // indicators on several charts: which to copy? → the model
      const src = srcCharts[0]
      const set = chartSet(where, { host, sources: [src] })
      if (!set) return null
      if (set.say) return { kind: 'say', text: set.say }
      const dests = set.refs.filter(x => x !== src)
      if (!dests.length) return { kind: 'say', text: `${r.list.length === 1 ? 'It is' : 'They are'} already on that chart.` }
      const ids = r.list.map(i => i.instanceId)
      return { kind: 'ops', ops: dests.map(d => ({ action: 'indicatorCopy.copyTo', target: ixe(d), args: { from: src, instances: ids } })), pick: ids }
    }
    if (r?.say) return { kind: 'say', text: r.say }
    if (r?.ask) return askOf(r.ask, null)
  }
  // something about the conversation's indicators
  const ind = indicatorClauses(t, ctx)
  if (ind?.say) return { kind: 'say', text: ind.say }
  if (ind?.ask) return askOf(ind.ask, t)
  if (ind?.ops?.length) {
    if (ind.ops.length > MAX_FOLLOW_OPS) return null
    return { kind: 'ops', ops: ind.ops, pick: ind.ids }
  }
  return null
}
function askOf(ask, t) {
  if (!ask.choices.length || !t) return { kind: 'say', text: ask.text }
  return { kind: 'ask', text: ask.text, choices: ask.choices, words: t }
}

// a guessed spelling is used only for plain, local, reversible changes, and only when every reading agrees
function safeOps(r) {
  return r?.kind === 'ops' && r.ops.every(o => { const c = getCapability(o.action); return c && (c.risk || 'local') === 'local' && c.reversible !== false })
}

// does a phrase NAME charts (a set, a position, an ordinal, "this one", "the one next to it", a symbol word)? — shape only
const CHART_WORDS = /^(?:(?:on|to|onto|for|in) )?(?:the |my )?(?:this|this one|this chart|it|that one|that chart|chart|selected chart|(?:top|bottom|upper|lower)?[- ]?(?:left|right)|top|bottom|upper|lower|(?:first|second|third|fourth|fifth|sixth|last|middle|1st|2nd|3rd|4th)(?: chart| one)?|chart \d)(?: chart| one| side)?$/
const isChartWords = (w) => {
  const p = String(w || '').trim()
  return CHART_WORDS.test(p) || R_OTHERS.test(p) || R_ALL.test(p) || NEXT_TO.test(p) || /^\$?[a-z][a-z0-9.]{0,9}(?: chart| one)?$/.test(p.replace(/^(?:the|my) /, ''))
}
/** Shape only (no board, no memory): would `resolveFollowUp` read this clause once its referents exist? */
export function followUpShape(text) {
  const t = tidy(text)
  if (!t) return false
  const look = MATCH_RE.exec(t) || MATCH2_RE.exec(t)
  if (look && isChartWords(look[1]) && isChartWords(look[2])) return true
  const same = SAME_RE.exec(t) || THAT_RE.exec(t)
  if (same && isChartWords(same[1])) return true
  const c = COPY_RE.exec(t)
  if (c && isChartWords(c[2]) && (SAME_THINGS.test(c[1]) || R_PLURAL.test(c[1]) || R_IT.test(c[1]) || R_ORD.test(c[1]) || R_SPEED.test(c[1]))) return true
  return !!indicatorClauses(t, { dry: true })?.ops
}

/**
 * A follow-up about what this conversation did. → null (not one this module reads: the fast path / the model
 * decide, exactly as before) | { kind: 'ops', ops, pick? } | { kind: 'say', text } | { kind: 'ask', text, choices, words }
 */
export function resolveFollowUp(text, { host, memory, epoch = null, working = null } = {}) {
  if (!memory || !host) return null
  const raw = String(text || '')
  if (!raw.trim() || raw.length > 200) return null
  const ctx = { host, memory, epoch, working }
  const exact = readOnce(tidy(raw), ctx)
  if (exact) return exact
  let variants = null
  try { variants = correctTypos(raw, lexiconFor(host)) } catch { variants = null }
  if (!variants) return null
  const seen = new Map()
  for (const v of variants) {
    const r = readOnce(tidy(v.text), ctx)
    if (r) seen.set(JSON.stringify(r), r)
  }
  if (seen.size !== 1) return null
  const [r] = seen.values()
  return safeOps(r) ? { ...r, corrected: true } : null
}

/** After a local "which one?" for an indicator, the member's pick re-reads the same words with that indicator. */
export function resolvePicked(words, instanceId, { host, memory, epoch = null } = {}) {
  const live = liveIndicators(host, memory, epoch)
  let hit = live.find(i => i.instanceId === instanceId)
  if (!hit) {
    for (const c of chartsOf(host)) { const r = rowsOnChart(host, c.ref).find(i => i.instanceId === instanceId); if (r) { hit = r; break } }
  }
  if (!hit) return null
  const r = indicatorClause(words, { host, memory, epoch, pinned: hit })
  return r
}
