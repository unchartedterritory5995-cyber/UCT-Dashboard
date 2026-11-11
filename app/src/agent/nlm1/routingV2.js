// ── NLM-1 D1 · ROUTING V2: registry-derived capability discovery (LIVE, on by default: nlm1/flag.js has its kill switches) ─
//
// v1 (routing.js) picks groups with hand-written per-group regexes. v2 SCORES every group against a lexical index
// GENERATED from the capability manifest (capabilityIndex.js: names, summaries, argument names and enum values, group
// titles, the indicator catalog) — the index carries the weight — with three supplements:
//   • entity typing   a value's TYPE in the registry's own argument words (a date → `date`, AMD → `symbol`, 182.50 →
//                     `price`, orange → `color`, 65 minute → `timeframe`), weighted below a word;
//   • vocabulary      a small curated trader table (vocabulary.json, data, reviewed): studies, oscillator, pane, s/r…;
//   • context         the last change's groups (pinned, = v1) and, for a short follow-up, their RELATED groups; the
//                     pending question's groups (`after`, = v1).
// v1's regexes are kept as the BOOST layer: every v1 hit stays selected, so no phrasing v1 routes loses its group.
// A typo-corrected reading (nl/lexicon.js) is scored too, but only the words the correction CHANGED, discounted —
// a correction is a guess ("march" → "match" must not name the screener).
//
// selectGroupsV2 has selectGroups' interface (the held-out scorer's NLM1_ROUTER='nlm1'). routeManifestV2 packs it
// under the SAME per-request budget as v1, in priority order:
//   1. pinned   always-on, undo rider, a reroute's groups, a pending proposal's and the last change's groups (= v1)
//   2. own      v1's regex hits (smallest first, = v1), then the strong scored groups (best first)
//   3. carried  the groups the model's question was asked with (`after`, = v1)
//   4. weak     every other group with lexical evidence, best first
//   5. context  short follow-ups: the last change's RELATED groups (vocabulary.json `related`)
//   6. fill     nothing recognised at all: v1's own unrecognised-message order (soft, charts, then smallest)
// A group that does not fit is named, never partially sent (= v1). `overBudget` lists only tiers 1–3.
//
// KNOWING ≠ DOING (unchanged): routing only changes what the model SEES. Every op is re-validated against the full
// registry in the browser and against the sent manifest on the server; approvals and protected layouts apply as
// before. The `routing` object sent to the server has v1's exact shape.

import { GROUPS, ROUTING_VERSION, groupOfAction, selectGroups, wordsSelect, routeManifest, warnBudgetCut } from '../routing'
import { manifestFor } from '../capabilities'
import { buildIndex, lexicalScores, tokens, stem, entityTokens, tickerWordsOf, vocabularyHits, ENTITY_W, ENTITY_GROUPS, RELATED } from './capabilityIndex'

export const ROUTING_V2_VERSION = 1
// tuned on the capreg corpus + nlm1 dev paraphrases (never on the held-out set); a frozen object — tests read it
export const TUNING = Object.freeze({
  STRONG: 6.0,          // a score that names a group on its own, whatever the top score (sweep: 3→6 cut avg selected groups 4.2→3.4)
  REL_STRONG: 0.6,      // …or this fraction of the best score, when at least STRONG_FLOOR
  STRONG_FLOOR: 1.8,
  WEAK: 99,             // the weak tier is OFF (D1.2 sweep: 2.5→off cut corpus avg actions 35.4→26.8 with availability unchanged)
  VOCAB_W: 3.2,         // a vocabulary weight of 1 ≈ one strong group on its own
  CORRECTED_W: 0.5,     // a word only a typo correction produced
  SHORT_WORDS: 6,       // a follow-up this short carries the last change's related groups
  CONTEXT_W: 1.5,       // what being RELATED to the last change adds to a short follow-up's group
  TICKER_WORDS: 3,      // D1.1: a ticker plus at most this many other content words, nothing else named → charts
  // D1.2 (routed size, AUDIT 11-04): when v1's fill / the critical tier apply, how far evidence must go for a group to ride
  FILL_WHEN: 'uncertain',       // 'v1fill': whenever v1 did not recognise the message | 'uncertain': only when v2 is not decisive
  CRITICAL_WHEN: 'uncertain',   // same choice for the critical tier
  // D1.2: alerts / data ride with their entities (a ticker, a price) through the LIKELY tier; these three have none
  CRITICAL: ['charts', 'undo', 'chartGrid'],
  EVID_FLOOR: 0.0001,   // the least score that makes a group "evidenced" (packed smallest-first under uncertainty)
  LIKELY_FLOOR: 1,      // the least own score an entity-expanded group needs to be packed (charts exempt)
  MATCHED_ADD: 0,       // D1.3: the evidence a v2 group needs to be ADDED to a request v1's words already recognised
  DOUBT_FILL: 1,        // D1.3: under doubt, v1's fill stops at this share of the byte budget (v1's own fallback request size)
})
// dev sweeps only (nlm1 tuning script): an override object; production never sets it
const T = () => (globalThis.__NLM1_TUNING__ ? { ...TUNING, ...globalThis.__NLM1_TUNING__ } : TUNING)

const defaultManifest = () => manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })

/** The v2 scores for a message: { scores: {group: n}, vocabulary: [terms] } (groups the manifest carries only). */
export function scoreGroups(manifest, message, { correct = null } = {}) {
  const k = T()
  const raw = String(message || '')
  let corrected = []
  try { if (typeof correct === 'function') corrected = (correct(raw) || []).map(String).filter(t => t.toLowerCase() !== raw.toLowerCase()) } catch { corrected = [] }
  const index = buildIndex(manifest)
  // D1.1: a TICKER is an entity (`symbol`), never a word — "SPY" must not match an indicator whose default symbol is SPY
  const tick = new Set(tickerWordsOf(raw).map(w => stem(w.toLowerCase())))
  const own = tokens(raw).filter(t => !tick.has(t))
  const ownSet = new Set(own)
  const weights = new Map()
  const qTokens = [...own]
  for (const t of entityTokens(raw)) if (!ownSet.has(t)) { qTokens.push(t); weights.set(t, ENTITY_W) }
  for (const c of corrected) for (const t of tokens(c)) if (!ownSet.has(t) && !weights.has(t)) { qTokens.push(t); weights.set(t, k.CORRECTED_W) }
  const lex = lexicalScores(index, qTokens, weights)
  const vocab = {}
  const terms = new Set()
  for (const [text, f] of [[raw, 1], ...corrected.map(c => [c, k.CORRECTED_W])]) {
    const v = vocabularyHits(text)
    v.terms.forEach(x => terms.add(x))
    for (const [g, w] of Object.entries(v.groups)) vocab[g] = Math.max(vocab[g] || 0, w * f)
  }
  // D1.2: an entity SHAPE that points at a group (vocabulary.json `entities`: a percent move → a screen)
  for (const e of entityTokens(raw)) for (const [g, w] of Object.entries(ENTITY_GROUPS[e] || {})) vocab[g] = Math.max(vocab[g] || 0, w)
  const scores = {}
  for (const g of index.groups) {
    const s = (lex[g] || 0) + k.VOCAB_W * (vocab[g] || 0)
    if (s > 0) scores[g] = s
  }
  return { scores, vocabulary: [...terms], vocab, lex, tickers: tick.size, words: own.length }
}

/**
 * selectGroups' interface: { selected, priority, matched, soft } (+ scores, strong, v1 for diagnostics).
 * `selected` = the groups the message's OWN words chose (v1's regex hits ∪ the strong scored groups), with the
 * always-on and follow-up groups as v1 has them; nothing recognised → every group (v1's fallback), matched false.
 */
export function selectGroupsV2(message, opts = {}) {
  const k = T()
  const v1 = selectGroups(message, opts)
  const manifest = opts.manifest || defaultManifest()
  const sc = scoreGroups(manifest, message, opts)
  const { scores, vocabulary } = sc
  const known = new Set(GROUPS.map(g => g.id))
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  const followUps = [...new Set([...(opts.pendingActions || []), ...(opts.recentActions || [])].map(groupOfAction).filter(Boolean))]
  // D1.1: ANY undo signal (its words or its vocabulary) offers Undo — add-only, one action (#766's rule)
  // ⛔ …and never its index. The undo group's document is its own description, and in a document that small the words that
  // carry the score are the generic ones: "last" alone scored 1.91 ("when did nh/nl last go negative", "last earnings date"),
  // past the floor, where "undo" itself scores 0.58. So Undo was read from a question, and the question counted as recognised.
  // Without a signal the group has no score to rank on.
  const undoSignal = known.has('undo') && ((sc.vocab.undo || 0) > 0 || wordsSelect('undo', message))
  if (!undoSignal) delete scores.undo
  // CONTEXT: a short follow-up to the last change ("make it blue" after an indicator was added) — the last change's
  // RELATED groups (vocabulary.json `related`) get CONTEXT_W on top of whatever the message's own words gave them, and
  // may be selected on that evidence alone
  const words = String(message || '').trim().split(/\s+/).filter(Boolean).length
  const recent = [...new Set((opts.recentActions || []).map(groupOfAction).filter(Boolean))]
  const related = words <= k.SHORT_WORDS ? new Set(recent.flatMap(g => RELATED[g] || []).filter(g => known.has(g) && !followUps.includes(g))) : new Set()
  for (const g of related) if (scores[g]) scores[g] += k.CONTEXT_W
  const rank = (sc0) => Object.entries(sc0).filter(([g]) => known.has(g) && !always.includes(g)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const lexRanked = rank(scores)
  const top = lexRanked.length ? lexRanked[0][1] : 0
  // the BOOST layer made explicit: a group v1's regexes select ranks as if it scored STRONG more (selection below reads
  // the unboosted scores, so a v1 hit never raises the bar another group must clear)
  const boosted = { ...scores }
  if (v1.matched) for (const g of v1.priority) if (known.has(g) && !always.includes(g) && !followUps.includes(g)) boosted[g] = (boosted[g] || 0) + k.STRONG
  const ranked = rank(boosted)
  const strong = lexRanked.filter(([g, s]) => s >= k.STRONG || (s >= k.STRONG_FLOOR && (s >= k.REL_STRONG * top || related.has(g)))).map(([g]) => g)
  // D1.1: a short request LED by a ticker that names nothing else ("ARM", "lemme peek at UBER") is a chart symbol request
  // — what typing a ticker on the chart does
  if (!strong.length && sc.tickers > 0 && sc.words <= k.TICKER_WORDS && known.has('charts')) strong.push('charts')
  // an always-on group (agent: "what can you actually do") named by the message recognises it, too
  const alwaysNamed = always.some(g => (scores[g] || 0) >= k.STRONG_FLOOR)
  const v1Own = v1.matched ? v1.priority.filter(id => !always.includes(id) && !followUps.includes(id)) : []
  const matched = v1.matched || strong.length > 0 || alwaysNamed
  // D1.1 (held-out, AUDIT 11-04): v2 recognising a message v1 did not, on evidence short of decisive, is UNCERTAIN — the
  // page's own controls (charts) stay in its selection, as v1's fallback puts them first
  const uncertain = !v1.matched && matched && top < k.STRONG
  const diag = { scores: Object.fromEntries(ranked.slice(0, 8).map(([g, s]) => [g, Math.round(s * 100) / 100])), ranked, vocabulary, strong,
    v1: v1.matched ? v1Own : null, v1Matched: v1.matched, v1Soft: v1.soft || [], uncertain, undoSignal }
  if (!matched) return { ...v1, ...diag }
  const priority = [...new Set([...always, ...followUps, ...(uncertain ? ['charts'] : []), ...v1Own, ...strong, ...(undoSignal ? ['undo'] : [])])]
  return { selected: GROUPS.map(g => g.id).filter(id => priority.includes(id)), priority, matched: true, soft: [], ...diag }
}

// D1.3: each group's manifest JSON bytes, and v1's own fallback request size for this manifest (memoised per manifest)
let BYTES_MEMO = { key: null, val: null }
function bytesFor(manifest, opts) {
  const key = `${manifest.map(c => c.name).join('|')}#${opts.limit ?? ''}#${opts.budget ?? ''}`
  if (BYTES_MEMO.key === key) return BYTES_MEMO.val
  const groupBytes = new Map()
  for (const c of manifest) { const g = groupOfAction(c.name); groupBytes.set(g, (groupBytes.get(g) || 0) + JSON.stringify(c).length) }
  let byteBudget = Infinity
  try {
    const fb = routeManifest(manifest, '', { enabled: true, limit: opts.limit, budget: opts.budget })
    if (fb.routing) byteBudget = fb.manifest.reduce((a, c) => a + JSON.stringify(c).length, 0)
  } catch { byteBudget = Infinity }
  BYTES_MEMO = { key, val: { groupBytes, byteBudget } }
  return BYTES_MEMO.val
}

const SENT_WITH_GROUP = ['boardEdit', 'calendar']

/** Route a manifest — routeManifest's contract (manifest, routing, overBudget, refresh), plus `v2` diagnostics. */
export function routeManifestV2(manifest, message, opts = {}, extra = []) {
  const k = T()
  const limit = opts.limit ?? Infinity
  const budget = Math.min(opts.budget ?? limit, limit)
  if (opts.enabled === false && manifest.length <= limit) return { manifest, routing: null }
  const sel = selectGroupsV2(message, { ...opts, manifest })
  const known = new Set(GROUPS.map(g => g.id))
  const always = GROUPS.filter(g => g.always).map(g => g.id)
  const counts = new Map()
  for (const c of manifest) { const g = groupOfAction(c.name); counts.set(g, (counts.get(g) || 0) + 1) }
  const sizeOf = (id) => counts.get(id) || 0
  const bySize = (a, b) => sizeOf(a) - sizeOf(b)
  const after = (opts.after || []).filter(id => known.has(id))
  // 1. pinned (= v1)
  const riders = [...GROUPS.filter(g => g.ridesAlong && wordsSelect(g.id, message)).map(g => g.id), ...(sel.undoSignal ? ['undo'] : [])]
  const pinned = [...new Set([...always, ...riders, ...extra, ...(opts.pendingActions || []), ...(opts.recentActions || [])]
    .map(x => (x.includes?.('.') ? groupOfAction(x) : x)).filter(Boolean))]
  // 2. own: v1's hits smallest first (exactly v1's order), then the strong scored groups, best first (uncertain: charts first)
  //    UNCERTAIN (v1 recognised nothing, v2's best is short of decisive): no v2 group is ranked ahead of another on that
  //    evidence — charts first (as v1's fallback), then EVERY group with any v2 evidence, smallest first (v1's own packing
  //    principle: the most distinct candidates that fit), then v1's fill (D1.1: weak evidence never buys a big group the
  //    room v1's fallback gave several)
  //    D1.2: …except the single BEST-scoring group when its evidence reaches the floor ("add a news panel": workspace) — it
  //    leads the evidenced ones, so a big group the message plainly points at is never squeezed out by smaller guesses
  const scoreOf = new Map(sel.ranked)
  const evidenced = sel.ranked.filter(([, s]) => s >= k.EVID_FLOOR).map(([g]) => g).sort(bySize)
  const best = sel.ranked.find(([g]) => g !== 'charts')
  const lead = sel.uncertain && best && best[1] >= k.STRONG_FLOOR ? [best[0]] : []
  // D2.1: v1's own hits are packed smallest-first (v1's order) while they all FIT; when they don't, the cut falls on the
  // least evidence, never simply on the biggest group ("add a chart for AMD then add RSI and MACD to it": charts, the
  // group the request most plainly needs, was cut for being the largest)
  const v1Own = (sel.v1 || []).filter(id => !pinned.includes(id))
  const pinnedSize = pinned.reduce((a, id) => a + sizeOf(id), counts.get(null) || 0)
  const v1Fits = v1Own.reduce((a, id) => a + sizeOf(id), pinnedSize) <= budget
  // D2.2: the message's ENTITIES count as evidence in that cut — "put TSLA on the left and AMD on the right and add rsi to
  // both" names tickers, so the chart group outranks a group a stray word touched
  const entEvidence = (() => {
    const e = new Set(entityTokens(message))
    const by = { symbol: ['charts', 'data', 'alerts'], price: ['alerts', 'drawings'], date: ['charts', 'chartSetup'], pctmove: ['screener'], tickerinfo: ['data'], periodchange: ['data'], tickercharts: ['workspace', 'chartGrid'] }
    return new Set([...e].flatMap(x => by[x] || []))
  })()
  const evidenceOf = (g) => (scoreOf.get(g) || 0) + (entEvidence.has(g) ? k.STRONG : 0)
  const v1Order = v1Fits ? [...v1Own].sort(bySize) : [...v1Own].sort((a, b) => (evidenceOf(b) - evidenceOf(a)) || bySize(a, b))
  const own = !sel.matched ? [] : sel.uncertain ? ['charts', ...lead]
    : [...v1Order,
      // D1.3 (bytes): on a message v1's words recognised, v2 ADDS a group to the request only on evidence ≥ MATCHED_ADD
      ...(sel.v1Matched ? sel.strong.filter(g => (scoreOf.get(g) || 0) >= k.MATCHED_ADD) : sel.strong)]
  // 4. weak
  const weak = sel.ranked.filter(([, s]) => s >= k.WEAK).map(([g]) => g)
  // 5. context
  const words = String(message || '').trim().split(/\s+/).filter(Boolean).length
  const recentGroups = [...new Set((opts.recentActions || []).map(groupOfAction).filter(Boolean))]
  const context = words <= k.SHORT_WORDS ? recentGroups.flatMap(g => RELATED[g] || []).filter(g => known.has(g)) : []
  // 6. fill: whenever V1 did not recognise the message (whatever v2 made of it) → v1's own unrecognised order, after v2's
  //    own groups (D1.1: v2's evidence never costs a message the groups v1's fallback would have sent it)
  const LAST = new Set(GROUPS.filter(g => g.fillLast).map(g => g.id))
  const fillOrder = (a, b) => (LAST.has(a) - LAST.has(b)) || bySize(a, b)
  const v1Fill = sel.v1Matched === false || !sel.matched
  // D1.2 (routed size): v1's fill and the critical tier only when v2's evidence is NOT decisive — a message v2 reads
  // decisively (best ≥ STRONG) is routed on that evidence plus its entities, as v1 routes a message its words recognise
  const doubt = sel.uncertain || !sel.matched
  const fillOn = k.FILL_WHEN === 'uncertain' ? doubt : v1Fill
  const fill = fillOn ? [...(sel.v1Soft || sel.soft || []), 'charts', ...GROUPS.map(g => g.id).filter(id => id !== 'charts').sort(fillOrder)] : []

  // 3b. LIKELY (D1.1, context-aware candidate expansion — never an all-tool fallback): what the message's ENTITIES make
  //     likely, packed right after its own groups — a ticker: its chart, its data, an alert on it; a price: an alert or a
  //     level; a date: the chart's time controls. Only when v1 did not recognise the message or v2 is uncertain.
  const ents = new Set(entityTokens(message))
  //     D1.2: an expanded group (charts aside) is packed only when the message gave it some evidence of its own (≥ LIKELY_FLOOR)
  const likely = (sel.uncertain || sel.v1Matched === false)
    ? [...(ents.has('symbol') ? ['charts', 'data', 'alerts'] : []), ...(ents.has('price') ? ['alerts', 'drawings'] : []), ...(ents.has('date') ? ['charts', 'chartSetup'] : []),
      ...(ents.has('pctmove') ? ['screener'] : []), ...(ents.has('tickerinfo') || ents.has('periodchange') ? ['data'] : [])]
      .filter(g => known.has(g) && (g === 'charts' || (scoreOf.get(g) || 0) >= k.LIKELY_FLOOR))
    : []
  // 3c. CRITICAL (D1.1): whenever v1 would have fallen back, the groups that fallback always carried for the critical
  //     capabilities with no entity of their own — symbol switching (charts), Undo, N-chart grids — stay in the request,
  //     right after v2's own groups (23 of the 55-action budget); alerts / data ride with tickers and prices (LIKELY).
  //     D1.2: only while v2's evidence is NOT decisive (CRITICAL_WHEN)
  const critical = (k.CRITICAL_WHEN === 'uncertain' ? doubt : v1Fill) ? k.CRITICAL.filter(g => known.has(g)) : []
  const needed = [...new Set([...pinned, ...own, ...critical, ...likely, ...after])]
  // v1's fill goes BEFORE v2's weak / context tiers: on an unrecognised-by-v1 message v1's order is the safer one
  const order = fillOn ? [...new Set([...needed, ...(doubt ? evidenced : []), ...fill, ...weak, ...context])]
    : [...new Set([...needed, ...weak, ...context])]
  // D1.3 BYTE BUDGET (#785 reserves the per-turn cap on bytes): a request is never larger than v1's own fallback request
  // for this manifest (v1's largest), and under doubt the fill stops at DOUBT_FILL of it — v2's own, critical, likely and
  // evidenced groups are packed first, so what the fill leaves out is what nothing in the message pointed at
  const { groupBytes, byteBudget } = bytesFor(manifest, opts)
  const want = new Set()
  let used = counts.get(null) || 0
  let usedBytes = groupBytes.get(null) || 0
  const over = []
  const fillOnly = new Set(fill.filter(id => !needed.includes(id) && !(doubt && evidenced.includes(id))))
  for (const id of order) {
    const n = sizeOf(id)
    if (!n) continue
    const b = groupBytes.get(id) || 0
    const cap = fillOnly.has(id) && doubt ? byteBudget * k.DOUBT_FILL : byteBudget
    if ((used + n > budget || usedBytes + b > cap) && want.size >= always.length) { if (needed.includes(id)) over.push(id); continue }
    want.add(id); used += n; usedBytes += b
  }
  warnBudgetCut(manifest, groupOfAction, over)          // a needed group the budget cut is never silent (routing.js)
  const sentWith = sel.undoSignal ? [] : SENT_WITH_GROUP.filter(id => id === 'calendar' || (scoreOf.get(id) || 0) >= k.EVID_FLOOR)
  const present = GROUPS.filter(g => counts.has(g.id))
  const routed = manifest.filter(c => want.has(groupOfAction(c.name)) || groupOfAction(c.name) === null)
  const diag = { version: ROUTING_V2_VERSION, scores: sel.scores, vocabulary: sel.vocabulary, strong: sel.strong, v1: sel.v1, context, matched: sel.matched }
  if (!sel.matched && !extra.length && !after.length && manifest.length <= limit) return { manifest, routing: null, v2: diag }
  if (routed.length === manifest.length) return { manifest, routing: null, v2: diag }
  return {
    manifest: routed,
    routing: { version: ROUTING_VERSION, groups: present.map(g => ({ id: g.id, title: g.title })), selected: present.filter(g => want.has(g.id)).map(g => g.id) },
    overBudget: over,
    // re-read live data for what the message is about (tiers 1–3); weak / context / fill act on the context loaded
    // boardEdit, calendar: a context section sent only with its group (widgetControls, the /charts calendar ref), and not on
    // an undo signal (Undo reads neither; capability text says "Undo" often). The control list also needs the message's own
    // evidence. The calendar ref does not: it is a few bytes, and with its group already sent no need_groups could bring it.
    refresh: sel.matched ? present.filter(g => want.has(g.id) && (needed.includes(g.id) || sentWith.includes(g.id))).map(g => g.id)
      : [...new Set([...pinned, ...(sel.soft || []), 'charts', ...sentWith])].filter(id => want.has(id)),
    v2: diag,
  }
}
