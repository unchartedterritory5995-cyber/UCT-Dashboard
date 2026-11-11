// NLM-1 D1 — routing v2 units: the vocabulary is valid data, the router registry (NLM1_ROUTER) has selectGroups'
// interface, the index is generated from the registry (a capability registered later is routable by its own words),
// and the dev paraphrase floor holds (dev/paraphrases.json — the TUNING set, not the held-out one).
import { describe, it, expect } from 'vitest'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { routedNames } from '../qa/capabilityRegression/testing/route'
import { GROUPS, groupOfAction, selectGroups, routeManifest, wordsSelect } from '../routing'
import { MANIFEST_CONTRACT, manifestFor } from '../capabilities'
import { correctTypos, lexiconFor } from '../nl/lexicon'
import vocabulary from './vocabulary.json'
import dev from './dev/paraphrases.json'
import { vocabularyTerms, buildIndex, entityTokens, tokens } from './capabilityIndex'
import { selectGroupsV2, scoreGroups, routeManifestV2 } from './routingV2'
import { ROUTERS, routerFromEnv, routerName, routeManifestFromEnv } from './routers'

await registerCatalog()
const ids = new Set(GROUPS.map(g => g.id))
const correct = (t) => (correctTypos(t, lexiconFor(null)) || []).map(v => v.text)
const ownHit = (k) => {
  const s = selectGroupsV2(k.text, { recentActions: k.recentActions || [], correct })
  return { s, ok: s.matched && k.needs.map(groupOfAction).every(g => s.selected.includes(g)) }
}

describe('vocabulary.json is valid, reviewed data', () => {
  it('every term names known groups with weights in (0, 1] and compiles', () => {
    for (const [term, groups] of Object.entries(vocabulary.terms)) {
      expect(term, 'lower-case').toBe(term.toLowerCase())
      for (const [g, w] of Object.entries(groups)) {
        expect(ids.has(g), `${term} → unknown group ${g}`).toBe(true)
        expect(w > 0 && w <= 1, `${term} weight`).toBe(true)
      }
    }
    expect(vocabularyTerms().length).toBe(Object.keys(vocabulary.terms).length)
    for (const [g, rel] of Object.entries(vocabulary.related)) {
      expect(ids.has(g)).toBe(true)
      for (const r of rel) expect(ids.has(r), `${g} related ${r}`).toBe(true)
    }
    expect(vocabulary.reviewed?.status).toBeTruthy()
  })
  it('stays a SUPPLEMENT: the registry index alone recognises most of the dev set', () => {
    globalThis.__NLM1_TUNING__ = { VOCAB_W: 0 }
    try {
      const ok = dev.cases.filter(k => ownHit(k).ok).length
      expect(ok / dev.cases.length).toBeGreaterThanOrEqual(0.75)
    } finally { globalThis.__NLM1_TUNING__ = null }
  })
})

describe('the index is generated from the registry', () => {
  const full = () => manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  it('every manifest group is a document; names, args and the indicator catalog are in it', () => {
    const idx = buildIndex(full())
    for (const c of full()) expect(idx.docs.has(groupOfAction(c.name)), c.name).toBe(true)
    expect(idx.docs.get('charts').has('timeframe')).toBe(true)
    expect(idx.docs.get('drawingTools').has('fib')).toBe(true)
    expect(idx.docs.get('indicators').has('rsi')).toBe(true)
  })
  it('a capability only the index knows is routable by its own words', () => {
    const fake = [...full(), { name: 'layout.zorbify', summary: 'Zorbify the quantum flux capacitor', args: { type: 'object', properties: {} } }]
    expect(scoreGroups(fake, 'zorbify my flux capacitor').scores.layouts).toBeGreaterThan(0)
    expect(scoreGroups(full(), 'zorbify my flux capacitor').scores.layouts || 0).toBe(0)
  })
  it('entity typing maps values onto argument words', () => {
    expect(entityTokens('jump back to march 2020')).toContain('date')
    expect(entityTokens('line at 182.50')).toContain('price')
    expect(entityTokens('flip to AMD')).toContain('symbol')
    expect(entityTokens('make it orange')).toContain('color')
    expect(tokens('the studies')).toEqual(['study'])
  })
})

describe('NLM1_ROUTER: pluggable routers with the selectGroups interface', () => {
  it('default v1; nlm1 = selectGroupsV2; unknown refused', () => {
    expect(routerName({})).toBe('v1')
    expect(routerFromEnv({})).toBe(selectGroups)
    expect(routerFromEnv({ NLM1_ROUTER: 'nlm1' })).toBe(selectGroupsV2)
    expect(routeManifestFromEnv({})).toBe(routeManifest)
    expect(routeManifestFromEnv({ NLM1_ROUTER: 'nlm1' })).toBe(routeManifestV2)
    expect(() => routerFromEnv({ NLM1_ROUTER: 'zzz' })).toThrow(/unknown router/)
  })
  it('same shape as selectGroups', () => {
    for (const name of Object.keys(ROUTERS)) {
      const s = ROUTERS[name]('add the 9 ema', { recentActions: [] })
      for (const k of ['selected', 'priority', 'matched', 'soft']) expect(s, `${name}.${k}`).toHaveProperty(k)
      expect(Array.isArray(s.selected) && Array.isArray(s.priority)).toBe(true)
    }
  })
})

describe('dev paraphrase floor (tuning set)', () => {
  it('own-words recall ≥ 95%, fallback ≤ 2%, packed recall ≥ 97%, every request within the budget', () => {
    let own = 0, fb = 0, packed = 0
    for (const k of dev.cases) {
      const { s, ok } = ownHit(k)
      own += ok; fb += !s.matched
      const p = routedNames(k.text, { recentActions: k.recentActions || [], after: k.after || null, v2: true })
      packed += k.needs.every(n => p.names.includes(n))
      expect(p.names.length).toBeLessThanOrEqual(MANIFEST_CONTRACT.routingThreshold)
    }
    const n = dev.cases.length
    expect(own / n).toBeGreaterThanOrEqual(0.95)
    expect(fb / n).toBeLessThanOrEqual(0.02)
    expect(packed / n).toBeGreaterThanOrEqual(0.97)
  })
})
// autotest follow-up: "when did nh/nl last go negative" got Undo offered, and counted as recognised, on the word "last". The
// undo group's index is its own description, so only its words and vocabulary may name it.
describe('undo rides on its own words, never on the words of its description', () => {
  const m = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const sel = (q, o = {}) => selectGroupsV2(q, { manifest: m, ...o })
  it.each(['when did nh/nl last go negative', 'when did the market last go up', 'what was the last price', 'last earnings date for NVDA', 'last time new lows outnumbered new highs on nasdaq',
    'show the last change in breadth', 'when was the last change in nh/nl', 'what changed last', 'MSFT performance over the last 20 days', "what was NVDA's EPS last quarter",
    'rename my Momentum layout to Momentum Trades', 'move the macd pane above the rsi pane', 'what was your last change',
    'back out of this layout', 'walk back through the last 5 days', 'what you just changed, explain it', 'what you just added to the chart, show me its settings'])('no signal: %s', (q) => {
    const s = sel(q)
    expect(s.undoSignal).toBe(false)
    expect(s.priority || []).not.toContain('undo')
    expect(s.scores.undo).toBeUndefined()
  })
  it.each(['undo', 'undo that', 'undo the last change', 'undo my last change', 'revert your last change', 'undo everything you just did', 'take that back', 'reverse that',
    'put it back how it was', 'go back to how it was', 'oops', 'whoops', 'my bad, go back to before', 'ctrl z', 'nah that is wrong, put it the way it was', 'that was wrong, change it back',
    'your last change was wrong', 'not what i wanted', 'back out the last change', 'back that out', 'walk that back', 'walk back the last change', 'change it back', 'remove what you just added'])('signal, offered and recognised: %s', (q) => {
    const s = sel(q)
    expect(s.undoSignal).toBe(true)
    expect(s.matched).toBe(true)
    expect(s.priority).toContain('undo')
    expect(routedNames(q, { v2: true }).names).toContain('agent.undo')
  })
  it('a typo of an undo word still counts through its correction; "last" through a correction does not', () => {
    expect(sel('undoo that', { correct }).undoSignal).toBe(true)
    expect(sel('whne did nh/nl last go negative', { correct }).undoSignal).toBe(false)
  })
  it('a recognised question is not sent Undo; one nothing recognises still gets the fallback fill, undo included, exactly as v1', () => {
    expect(routedNames('last earnings date for NVDA', { v2: true }).names).not.toContain('agent.undo')
    expect(routedNames('when did nh/nl last go negative', { v2: true }).names).toContain('breadth.history')
  })
})

// DRAWING EXTRAS (drawingExtras, words-only): its words never take a plain drawing, a price alert or a ticker's flag — and
// they DO reach each action in the FIRST call on both routers (the action is in the manifest sent)
describe('drawingExtras: its own words, and the controls that must stay where they were, v1 and v2', () => {
  const full = () => manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const opts = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold, correct })
  const BY = { v1: routeManifest, v2: routeManifestV2 }
  const first = (v, msg) => {
    const r = BY[v](full(), msg, opts())
    return { selected: r.routing ? r.routing.selected : ['FULL'], names: new Set(r.manifest.map(c => c.name)) }
  }
  const OWN = [
    ['open the position calculator with entry 50 stop 48 target 56', 'drawing.positionCalculator'],
    ['size this trade: entry 20, stop 19, target 23', 'drawing.positionCalculator'],
    ['make this trendline my default style', 'drawing.saveDefaults'],
    ['save this rectangle as the default for new drawings', 'drawing.saveDefaults'],
    ['add the fib tool to my favourites', 'drawing.favoriteTool'],
    ['unstar the measure tool', 'drawing.favoriteTool'],
  ]
  it.each(['v1', 'v2'].flatMap(v => OWN.map(o => [v, ...o])))('%s "%s" carries %s in the first call', (v, msg, action) => {
    expect(wordsSelect('drawingExtras', msg)).toBe(true)
    expect(first(v, msg).names.has(action)).toBe(true)
  })
  // [request, group it must keep, action it must keep]
  const CONTROLS = [['draw a line', 'drawings', null], ['set an alert at my stop', 'alerts', 'alert.create'], ['favourite NVDA', null, null],
    ['flag NVDA as a favorite', null, null], ['star NVDA in my watchlist', 'lists', null], ['save this layout as default', null, null], ['reset the chart to its defaults', null, null]]
  it.each(['v1', 'v2'].flatMap(v => CONTROLS.map(c => [v, ...c])))('%s control "%s" never selects drawingExtras', (v, msg, group, action) => {
    const { selected, names } = first(v, msg)
    expect(wordsSelect('drawingExtras', msg)).toBe(false)
    expect(selected).not.toContain('drawingExtras')
    if (group) expect(selected).toContain(group)
    if (action) expect(names.has(action)).toBe(true)
  })
})

// AUDIT (wordsOnly fill, post-#1027): a `wordsOnly` group (routing.js) is chosen by its OWN words only. v1's fallback already
// left it out of the filler (selectGroups `filler`); v2's step-6 fill packed EVERY group, so on a request nothing recognised
// watchlistShow rode the fill and took the room `definitions` / `indicatorAlerts` had before #1027. The rail is generic over
// GROUPS.filter(g => g.wordsOnly): a new words-only group must add a phrase of its own words to OWN_WORDS below.
describe('routing v2: a words-only group never rides the fill, and is still sent on its own words', () => {
  const full = () => manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const opts = () => ({ enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold, correct })
  const sentOf = (msg) => new Set(routeManifestV2(full(), msg, opts()).manifest.map(c => groupOfAction(c.name)))
  const wordsOnly = GROUPS.filter(g => g.wordsOnly)
  const OWN_WORDS = {
    // drawing extras: the Position Calculator, a drawing's Save as default, a drawing tool's ★
    drawingExtras: ['open the position calculator with entry 50 stop 48 target 56', 'make this trendline my default style', 'add the fib tool to my favourites'],
    watchlistShow: ['put my flagged list in the watchlist widget', 'export my momentum list to excel', 'make the price column wider in the watchlist'],
    // #1073: chartSetup.compareGroup's own words — a compare/remove verb governing the group noun, or a group noun with its overlay/scale
    compareGroups: ['compare this chart with the semiconductor industry group', 'remove the energy sector from this chart', 'set the software theme overlay to a percent scale'],
  }
  it('there is a words-only group, and every one has phrases of its own words here', () => {
    expect(wordsOnly.length).toBeGreaterThan(0)
    for (const g of wordsOnly) expect(OWN_WORDS[g.id]?.length, `${g.id}: add phrases of its own words to OWN_WORDS`).toBeGreaterThan(0)
  })
  // requests v1 does not recognise, on which v2's fill is on (all but "hmm" sent watchlistShow on master a15b666119)
  it.each(['flip to AMD', 'lose the gridlines', 'any articles on RIVN lately', 'show me the leaders', 'both', 'whats the RS on this', 'hmm'])
  ('"%s": the v2 first call carries no words-only group', (msg) => {
    const sent = sentOf(msg)
    expect(sent.size).toBeGreaterThan(1)
    for (const g of wordsOnly) expect(sent.has(g.id), `${g.id} for "${msg}"`).toBe(false)
  })
  it.each(wordsOnly.flatMap(g => (OWN_WORDS[g.id] || []).map(m => [g.id, m])))('%s on its own words: "%s"', (id, msg) => {
    expect(wordsSelect(id, msg)).toBe(true)
    expect(sentOf(msg).has(id)).toBe(true)
  })
})
