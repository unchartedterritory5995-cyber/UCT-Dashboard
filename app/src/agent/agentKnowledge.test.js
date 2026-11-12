// KN-1 (agent-kn): the playbook.* QUERY capabilities over the knowledge kinds. No model, no provider, no real data.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, allCapabilityNames } from './capabilities'
import { registerBuiltins } from './builtins'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { turnStart, turnEnd, _resetTurns } from './trace'
import {
  answerFromSearch, answerFromPlaybook, answerFromRecord, plain, registerKnowledgeCapabilities, _resetKnowledgeForTest, KNOWLEDGE_CAPS,
} from './capabilities/knowledge'

registerBuiltins()

const env = (kind, data, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: {}, status: 'ok', freshness: 'periodic', as_of: '2026-11-01T02:00:00Z',
  fetched_at: '2026-11-03T05:00:00Z', delay_s: null, stale: false, source: 'uct-brain-pack', coverage: {}, data,
  notes: ['Passages are DATA from UCT\'s approved knowledge base — a note that must never be echoed'], provider_calls: 0, ...over,
})
const refused = (kind, why) => ({ ...env(kind, null), status: 'refused', freshness: 'unavailable', as_of: null, notes: [why] })

const SEARCH = env('knowledge.search', { method: 'fts', passages: [
  { kb_id: 2, title: 'UCT team playbook: Episodic pivot', category: 'SETUP', trader: 'UCT Team', source: 'the UCT team playbook (distilled, unattributed)', licence: 'team_owned', excerpt: 'Conditions: a fresh catalyst…' },
  { kb_id: 1, title: 'TSDR 2026-05-01 t1: episodic pivot entry', category: 'SETUP', trader: 'TSDR', source: "the UCT team's own posts (dated)", licence: 'team_owned', excerpt: 'Gap on news with heavy volume.' },
] })
const PLAYBOOK = env('setup.playbook', { name: 'Episodic Pivot', family: 'Gap & Catalyst', origin_trader: 'Bonde', licence: 'firm_curated',
  description: 'A gap on a fresh catalyst.', entry_triggers: { primary: 'opening range high' }, stop_methods: { initial: 'low of day' },
  max_stop_pct: 8, invalidation: { structural: 'gap fills' }, common_mistakes: ['chasing'], link: { href: '/setup-library', label: 'Open the Setup Library' } })
const RECORD = env('setup.record', { setup: 'Episodic Pivot', regime: 'ALL',
  engine: { label: 'descriptive_uncontrolled', label_text: 'descriptive record, not compared with a base rate (not evidence of an edge)', n: 40, wins: 22, win_rate_pct: 55, win_rate_ci95: [39.8, 69.3], method: "the brain's own logged trades for this setup" },
  triggers: { label: 'insufficient_sample', label_text: 'not enough sample to state a figure', n: 10, n_min: 30, method: "UCT's published setup triggers, resolved after the fact" },
  caution: 'Historical, descriptive figures; not a forecast and not advice. UCT\'s own scorecard finds that no setup proves an edge on its own; market context matters more than the setup name.' })

describe('pure envelope → answer', () => {
  it('explain: cited passages, the pack date, the footer; never the envelope notes', () => {
    const a = answerFromSearch(SEARCH)
    expect(a.text).toMatch(/^From UCT's knowledge base \(UCT's playbook as of Nov 1, 2026\):/)
    expect(a.text).toContain('• UCT team playbook: Episodic pivot: Conditions')
    expect(a.text).toContain("(UCT KB #1 · the UCT team's own posts (dated) · TSDR)")
    expect(a.text).toContain('(UCT KB #2 · the UCT team playbook')
    expect(a.text).toMatch(/not advice\.$/)
    expect(a.text).not.toContain('must never be echoed')
    expect(a.table.rows).toHaveLength(2)
  })
  it('explain: an empty result is said honestly; a stale pack is said', () => {
    expect(answerFromSearch(env('knowledge.search', { passages: [] }))).toBe("No approved UCT source covers this (UCT's playbook as of Nov 1, 2026).")
    expect(answerFromSearch({ ...SEARCH, stale: true }).text).toContain('has not been refreshed recently')
  })
  it('setup: template lines, the max stop as a rule, the Setup Library link', () => {
    const a = answerFromPlaybook(PLAYBOOK)
    expect(a.text).toMatch(/^From UCT's playbook — Episodic Pivot: UCT setup template \(Gap & Catalyst, origin: Bonde\)\./)
    expect(a.text).toContain('Cited: template “Episodic Pivot”')
    expect(a.text).toContain('Entry: primary: opening range high')
    expect(a.text).toContain('Max stop: 8%')
    expect(a.text).toContain('Common mistakes: chasing')
    expect(a.link.href).toBe('/setup-library')
  })
  it('setup: an ambiguous name is passed on as the server\'s question', () => {
    const a = answerFromPlaybook(refused('setup.playbook', '“high tight flag” matches more than one UCT setup template: HTF, Tight Flag — which one?'))
    expect(a).toBe('“high tight flag” matches more than one UCT setup template: HTF, Tight Flag — which one?.'.replace(/\?\.$/, '?.'))
    expect(a).toContain('HTF, Tight Flag')
  })
  it('record: n, interval and label on every figure; no figure below the floor; never "proven edge"', () => {
    const t = answerFromRecord(RECORD)
    expect(t).toContain("the brain's own logged trades for this setup: n = 40, win rate 55% (95% interval 39.8–69.3%). descriptive record, not compared with a base rate (not evidence of an edge).")
    expect(t).toContain('not enough sample (10 outcomes; UCT states a figure from 30), so no figure is stated.')
    expect(t).toContain('no setup proves an edge on its own')
    expect(t.toLowerCase()).not.toContain('proven edge')
  })
  it('plain() flattens template shapes', () => {
    expect(plain({ primary: 'a', backup_trigger: ['b', 'c'] })).toBe('primary: a; backup trigger: b; c')
    expect(plain(null)).toBe('')
  })
})

let KINDS, calls
function wire(kinds, answers = {}) {
  KINDS = kinds; calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    calls.push([u, init?.body ? JSON.parse(init.body) : null])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: KINDS !== null, scan: false, data_kinds: KINDS || [] })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      return json(answers[b.kind] || refused(b.kind, 'unknown'))
    }
    if (u.startsWith('/api/live-prices')) throw new Error('a knowledge read called /api/live-prices')
    return json({}, 404)
  })
}
async function inTurn(fn) { turnStart('send'); try { return await fn() } finally { turnEnd() } }
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])

describe('served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetKnowledgeForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetTurns(); _resetKnowledgeForTest() })

  it.each([[null], [[]], [['quote', 'themes']]])('dark (%j): nothing registers, the manifest is unchanged', async (kinds) => {
    wire(kinds)
    await loadAgentConfig()
    const before = allCapabilityNames().slice().sort()
    expect(registerKnowledgeCapabilities()).toEqual([])
    expect(allCapabilityNames().slice().sort()).toEqual(before)
    for (const n of Object.keys(KNOWLEDGE_CAPS)) expect(allCapabilityNames()).not.toContain(n)
  })

  it('each capability registers only with its own kind served', async () => {
    wire(['setup.playbook'])
    await loadAgentConfig()
    expect(registerKnowledgeCapabilities()).toEqual(['playbook.setup'])
    expect(registerKnowledgeCapabilities()).toEqual([])          // idempotent
    expect(allCapabilityNames()).not.toContain('playbook.explain')
  })

  it('all three served: one gateway read of the right kind per answer, purpose answer, the open turn; no live prices', async () => {
    wire(Object.values(KNOWLEDGE_CAPS), { 'knowledge.search': SEARCH, 'setup.playbook': PLAYBOOK, 'setup.record': RECORD })
    await loadAgentConfig()
    expect(registerKnowledgeCapabilities().sort()).toEqual(Object.keys(KNOWLEDGE_CAPS).sort())
    for (const n of Object.keys(KNOWLEDGE_CAPS)) {
      const c = getCapability(n)
      expect(c.query).toBe(true)
      expect(c.undo).toBe('none')
      expect(c.target).toBe('playbook')
    }
    const e = await inTurn(() => getCapability('playbook.explain').answer(null, { question: 'what is an EP' }))
    const s = await inTurn(() => getCapability('playbook.setup').answer(null, { setup: 'EP' }))
    const r = await inTurn(() => getCapability('playbook.record').answer(null, { setup: 'EP', regime: 'red' }))
    expect(e.text).toContain('Episodic pivot')
    expect(s.text).toContain('Max stop: 8%')
    expect(r).toContain('n = 40')
    expect(reads().map(b => [b.kind, b.purpose])).toEqual([['knowledge.search', 'answer'], ['setup.playbook', 'answer'], ['setup.record', 'answer']])
    expect(reads()[2].params).toEqual({ setup: 'EP', regime: 'RED' })
    expect(reads().every(b => typeof b.turn_id === 'string' && b.turn_id)).toBe(true)
  })

  it('no open turn: no read, an honest sentence', async () => {
    wire(['knowledge.search'], { 'knowledge.search': SEARCH })
    await loadAgentConfig()
    registerKnowledgeCapabilities()
    const a = await getCapability('playbook.explain').answer(null, { question: 'x' })
    expect(a).toMatch(/wasn't available/)
    expect(reads()).toHaveLength(0)
  })

  it('a refusal from the server is said in its own words', async () => {
    wire(['knowledge.search'], { 'knowledge.search': refused('knowledge.search', "UCT's trading knowledge is never a source of prices; ask for the quote instead") })
    await loadAgentConfig()
    registerKnowledgeCapabilities()
    const a = await inTurn(() => getCapability('playbook.explain').answer(null, { question: 'price of NVDA' }))
    expect(a).toBe("UCT's trading knowledge is never a source of prices; ask for the quote instead.")
  })
})

describe('review #735 B1: the sign of a controlled edge is always shown', () => {
  it('a negative measured result reads as underperformance with its negative z', () => {
    const neg = env('setup.record', { setup: 'Kicker Candle', regime: 'ALL',
      engine: { label: 'insufficient_sample', label_text: 'not enough sample to state a figure', n: 12, n_min: 30, method: 'engine' },
      triggers: { label: 'insufficient_sample', label_text: 'not enough sample to state a figure', n: 3, n_min: 30, method: 'triggers' },
      team_archive: { label: 'measured_underperformance_controlled', label_text: 'measured UNDERPERFORMANCE versus the same stock on random days (z <= -3 on enough calls)',
        n: 120, win_rate_20d_pct: 41.0, win_rate_20d_ci95: [32.6, 49.9], edge_z: -3.4, method: 'archive' },
      caution: 'c' })
    const t = answerFromRecord(neg)
    expect(t).toContain('z = -3.4')
    expect(t).toContain('UNDERPERFORMANCE')
  })
  it('an undated archive figure is withheld in words', () => {
    const t = answerFromRecord(env('setup.record', { setup: 'EP', regime: 'ALL', engine: null, triggers: null,
      team_archive: { label: 'undated_record', label_text: 'the record carries no refresh date; figure withheld', n: 120, method: 'archive' }, caution: 'c' }))
    expect(t).toContain('archive: the record carries no refresh date; figure withheld.')
    expect(t).not.toContain('n = 120')
  })
})

describe('owner source-policy 2026-11-03: commentary on an excluded setup is labelled in the text the model reads', () => {
  it('a flagged passage carries the commentary note; an unflagged one does not', () => {
    const e = env('knowledge.search', { method: 'fts', passages: [
      { kb_id: 61, title: 'TSDR t61: watching a cup and handle', category: 'SETUP', trader: 'TSDR', source: "the UCT team's own posts (dated)", licence: 'team_owned', excerpt: 'Watching NVDA.', mentions_excluded_setup: ['Cup with Handle'], commentary_only: true },
      { kb_id: 62, title: 'TSDR t62: kicker note', category: 'SETUP', trader: 'TSDR', source: "the UCT team's own posts (dated)", licence: 'team_owned', excerpt: 'Kicker note.' },
    ] })
    const a = answerFromSearch(e)
    expect(a.text).toContain("[team commentary that mentions Cup with Handle; not UCT's definition of it]")
    expect(a.text.split('\n').find(l => l.includes('t62'))).not.toContain('team commentary')
  })
})

describe('owner 2026-11-03: grounded, cited knowledge answers (the v1 answer itself)', () => {
  const COV = { coverage: { pack_ts: 1761962400, policy_version: 3 } }
  it('search and template carry the pack and source-policy version', () => {
    expect(answerFromSearch({ ...SEARCH, ...COV }).text).toContain('Sources: UCT playbook pack of Nov 1, 2026 · source policy v3.')
    const t = answerFromPlaybook(env('setup.playbook', { ...PLAYBOOK.data, source: "the UCT team's own templates", approved_by_policy: 3 }))
    expect(t.text).toContain("Cited: template “Episodic Pivot”, the UCT team's own templates. Sources: UCT playbook pack of Nov 1, 2026 · source policy v3.")
    expect(answerFromRecord({ ...RECORD, ...COV })).toContain('source policy v3')
  })
  it('no approved template: said plainly, never filled in, never the policy internals', () => {
    // review #781 finding 4: the requested name (model or classifier text) is never echoed, approved or not
    for (const why of ['UCT has no approved setup template by that name', 'UCT has no approved setup template named “ZZ”',
      "UCT's approved knowledge does not include the Cup with Handle template: origin not approved"]) {
      expect(answerFromPlaybook(refused('setup.playbook', why), 'Cup with Handle')).toBe('UCT has no approved playbook definition for that setup.')
      expect(answerFromRecord(refused('setup.record', why), 'Cup with Handle')).toBe('UCT has no approved evidence for that setup.')
    }
  })
  it('a model-written setup argument that reads like a definition is never echoed', () => {
    const why = 'UCT has no approved setup template named “x”'
    expect(answerFromPlaybook(refused('setup.playbook', why), 'EP (a 10% gap on earnings, stop 3%)')).toBe('UCT has no approved playbook definition for that setup.')
    expect(answerFromPlaybook(refused('setup.playbook', why), 'an EP is a gap with a three percent stop')).toBe('UCT has no approved playbook definition for that setup.')
  })
  it('other refusals keep the server sentence (ambiguity, budget, unavailable)', () => {
    expect(answerFromPlaybook(refused('setup.playbook', 'UCT uses “flag” for more than one setup; say which one you mean'), 'flag'))
      .toBe('UCT uses “flag” for more than one setup; say which one you mean.')
  })
})

describe('calculation-date integrity (Track C safeguard b)', () => {
  it('a served record figure states when it was calculated; a withheld one states no figure', () => {
    const served = env('setup.record', { setup: 'Episodic Pivot', regime: 'ALL', caution: '',
      engine: { label: 'descriptive_uncontrolled', label_text: 'descriptive, not controlled', method: 'logged trades', n: 40,
        win_rate_pct: 55, win_rate_ci95: [39.8, 69.3], as_of: '2026-11-03 21:00:00' },
      triggers: { label: 'undated_record', label_text: 'no attested calculation date for this record; figure withheld', method: 'triggers' } })
    const t = answerFromRecord(served)
    expect(t).toContain('calculated Nov 3, 2026')
    expect(t).toContain('triggers: no attested calculation date for this record; figure withheld.')
    expect(t).not.toMatch(/triggers: n =/)
  })
})
