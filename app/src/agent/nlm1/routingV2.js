// ── NLM-1 D1 · ROUTING V2: registry-derived capability discovery (DARK: UCT_AGENT_ROUTING_V2 + browser switch) ─
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

import { GROUPS, ROUTING_VERSION, groupOfAction, selectGroups, wordsSelect } from '../routing'
import { manifestFor } from '../capabilities'
import { buildIndex, lexicalScores, tokens, stem, entityTokens, tickerWordsOf, vocabularyHits, ENTITY_W, RELATED } from './capabilityIndex'

export const ROUTING_V2_VERSION = 1
// tuned on the capreg corpus + nlm1 dev paraphrases (never on the held-out set); a frozen object — tests read it
export const TUNING = Object.freeze({
  STRONG: 6.0,          // a score that names a group on its own, whatever the top score (sweep: 3→6 cut avg selected groups 4.2→3.4)
  REL_STRONG: 0.6,      // …or this fraction of the best score, when at least STRONG_FLOOR
  STRONG_FLOOR: 1.8,
  WEAK: 2.5,            // the least evidence that earns a fill slot when the message was recognised (sweep: 0.9→2.5 cut avg caps 42→29, recall unchanged)
  VOCAB_W: 3.2,         // a vocabulary weight of 1 ≈ one strong group on its own
  CORRECTED_W: 0.5,     // a word only a typo correction produced
  SHORT_WORDS: 6,       // a follow-up this short carries the last change's related groups
  CONTEXT_W: 1.5,       // what being RELATED to the last change adds to a short follow-up's group
  TICKER_WORDS: 3,      // D1.1: a ticker plus at most this many other content words, nothing else named → charts
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
  // D1.1: ANY undo signal (its words, its vocabulary, its index) offers Undo — add-only, one action (#766's rule)
  const undoSignal = known.has('undo') && ((sc.vocab.undo || 0) > 0 || (sc.lex.undo || 0) >= k.STRONG_FLOOR || wordsSelect('undo', message))
  const diag = { scores: Object.fromEntries(ranked.slice(0, 8).map(([g, s]) => [g, Math.round(s * 100) / 100])), ranked, vocabulary, strong,
    v1: v1.matched ? v1Own : null, v1Matched: v1.matched, v1Soft: v1.soft || [], uncertain, undoSignal }
  if (!matched) return { ...v1, ...diag }
  const priority = [...new Set([...always, ...followUps, ...(uncertain ? ['charts'] : []), ...v1Own, ...strong, ...(undoSignal ? ['undo'] : [])])]
  return { selected: GROUPS.map(g => g.id).filter(id => priority.includes(id)), priority, matched: true, soft: [], ...diag }
}

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
  const evidenced = sel.ranked.filter(([, s]) => s > 0).map(([g]) => g).sort(bySize)
  const own = !sel.matched ? [] : sel.uncertain ? ['charts']
    : [...(sel.v1 || []).filter(id => !pinned.includes(id)).sort(bySize), ...sel.strong]
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
  const fill = v1Fill ? [...(sel.v1Soft || sel.soft || []), 'charts', ...GROUPS.map(g => g.id).filter(id => id !== 'charts').sort(fillOrder)] : []

  // 3b. LIKELY (D1.1, context-aware candidate expansion — never an all-tool fallback): what the message's ENTITIES make
  //     likely, packed right after its own groups — a ticker: its chart, its data, an alert on it; a price: an alert or a
  //     level; a date: the chart's time controls. Only when v1 did not recognise the message or v2 is uncertain.
  const ents = new Set(entityTokens(message))
  const likely = (sel.uncertain || sel.v1Matched === false)
    ? [...(ents.has('symbol') ? ['charts', 'data', 'alerts'] : []), ...(ents.has('price') ? ['alerts', 'drawings'] : []), ...(ents.has('date') ? ['charts', 'chartSetup'] : [])].filter(g => known.has(g))
    : []
  // 3c. CRITICAL (D1.1): whenever v1 would have fallen back, the groups that fallback always carried for the critical
  //     capabilities — symbol switching (charts), Undo, price alerts, N-chart grids, news / data — stay in the request,
  //     right after v2's own groups (34 of the 55-action budget): weak evidence can add, never take these away
  const critical = v1Fill ? ['charts', 'undo', 'alerts', 'chartGrid', 'data'].filter(g => known.has(g)) : []
  const needed = [...new Set([...pinned, ...own, ...critical, ...likely, ...after])]
  // v1's fill goes BEFORE v2's weak / context tiers: on an unrecognised-by-v1 message v1's order is the safer one
  const order = v1Fill ? [...new Set([...needed, ...(sel.uncertain || !sel.matched ? evidenced : []), ...fill, ...weak, ...context])]
    : [...new Set([...needed, ...weak, ...context])]
  const want = new Set()
  let used = counts.get(null) || 0
  const over = []
  for (const id of order) {
    const n = sizeOf(id)
    if (!n) continue
    if (used + n > budget && want.size >= always.length) { if (needed.includes(id)) over.push(id); continue }
    want.add(id); used += n
  }
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
    refresh: sel.matched ? present.filter(g => want.has(g.id) && needed.includes(g.id)).map(g => g.id)
      : [...new Set([...pinned, ...(sel.soft || []), 'charts'])].filter(id => want.has(id)),
    v2: diag,
  }
}
