// KN-1 (agent-kn) — Agent WITH vs WITHOUT Brain retrieval, deterministic (no model).
// For each knowledge-shaped prompt: with the knowledge kinds served, the routed request the model receives carries the
// right playbook.* capability (so the answer can come from UCT's approved knowledge, cited); without them, no knowledge
// capability exists and the model would answer from its own training. Control prompts (chart commands, prices, breadth,
// screens) must not be pulled into the knowledge group, and keep their own capability.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins } from './builtins'
import { selectGroups, routeManifest, wordsSelect } from './routing'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { registerKnowledgeCapabilities, _resetKnowledgeForTest, KNOWLEDGE_CAPS } from './capabilities/knowledge'

registerBuiltins()
const CTX = { surface: 'charts', createIndicator: true }
const BUDGET = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
const routed = (m) => routeManifest(manifestFor(CTX), m, BUDGET).manifest.map(c => c.name)

export const KNOWLEDGE_PROMPTS = [
  ['what does UCT mean by an episodic pivot?', 'playbook.explain'],
  ['what is an EP setup', 'playbook.explain'],
  ['explain the VCP setup', 'playbook.explain'],
  ['how does the team think about patience', 'playbook.explain'],
  ['how does the team trade a flag breakout', 'playbook.explain'],
  ['according to UCT, when should I take profits?', 'playbook.explain'],
  ['what is a pullback setup in the playbook', 'playbook.explain'],
  ['define a high tight flag', 'playbook.explain'],
  ['show me the playbook for the U&R', 'playbook.setup'],
  ["what's the max stop on a kicker", 'playbook.setup'],
  ['rules for an episodic pivot', 'playbook.setup'],
  ['invalidation for a VCP', 'playbook.setup'],
  ['common mistakes on EPs', 'playbook.setup'],
  ['setup template for the HTF', 'playbook.setup'],
  ['what is the win rate of the EP', 'playbook.record'],
  ['how often does the undercut and rally work?', 'playbook.record'],
  ['track record of the kicker', 'playbook.record'],
  ['hit rate of tight flags in a red market', 'playbook.record'],
  ['what sample size is behind the VCP stats', 'playbook.record'],
  ['win rates for U&R setups', 'playbook.record'],
]
export const CONTROL_PROMPTS = [
  ['switch the left chart to weekly', 'chart.setTimeframe'],
  ['add the 20 ema to this chart', 'indicator.add'],
  ['what is NVDA trading at', 'stock.quote'],
  ['what is breadth today', 'breadth.show'],
  ['save this layout as Momentum', 'layout.saveAs'],
  ['find stocks above the 50 sma with volume over 2x', 'screener.run'],
  ['news on AAPL', 'news.latest'],
  ['create a watchlist called growth', 'watchlist.create'],
]

function wire(kinds) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    return json({}, 404)
  })
}

describe('WITHOUT the Brain (knowledge kinds not served): no knowledge capability exists', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire(['quote', 'quotes']); await loadAgentConfig(); registerKnowledgeCapabilities() })
  it.each(KNOWLEDGE_PROMPTS)('"%s" → nothing grounded in UCT\'s knowledge reaches the model', (m) => {
    const names = routed(m)
    for (const cap of Object.keys(KNOWLEDGE_CAPS)) expect(names).not.toContain(cap)
  })
})

describe('WITH the Brain (knowledge kinds served)', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire(['quote', 'quotes', ...Object.values(KNOWLEDGE_CAPS)]); await loadAgentConfig(); registerKnowledgeCapabilities() })
  afterAll(() => { _resetKnowledgeForTest(); _resetAgentConfig() })

  it.each(KNOWLEDGE_PROMPTS)('"%s" → the playbook group is selected and %s is in the request', (m, cap) => {
    expect(wordsSelect('playbook', m)).toBe(true)
    expect(selectGroups(m).selected).toContain('playbook')
    expect(routed(m)).toContain(cap)
  })

  it.each(CONTROL_PROMPTS)('control "%s" → not pulled into the knowledge group; its own action stays', (m, own) => {
    expect(wordsSelect('playbook', m)).toBe(false)
    const names = routed(m)
    if (manifestFor(CTX).some(c => c.name === own)) expect(names).toContain(own)
  })

  it('the routed request stays within the per-request limit for every prompt', () => {
    for (const [m] of [...KNOWLEDGE_PROMPTS, ...CONTROL_PROMPTS]) expect(routed(m).length).toBeLessThanOrEqual(BUDGET.limit)
  })
})

describe('dark routing is unchanged: with the kinds off, the playbook group never matches', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire([]); await loadAgentConfig(); registerKnowledgeCapabilities() })
  it.each(KNOWLEDGE_PROMPTS)('"%s" → no playbook words match while the kinds are off', (m) => {
    expect(wordsSelect('playbook', m)).toBe(false)
  })
})

describe('review round 1: dark routing stays pre-routing for the phrasings that regressed', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire([]); await loadAgentConfig(); registerKnowledgeCapabilities() })
  it.each(['What is a pullback, in plain words?', 'explain this breakout', 'what is a tight flag', 'rules for a breakout'])(
    '"%s" → with the kinds off, nothing new is recognised (the full manifest goes, as before)', (m) => {
      expect(wordsSelect('playbook', m)).toBe(false)
    })
  it('control prompts are not vacuous: most own actions exist in the charts manifest', () => {
    const have = CONTROL_PROMPTS.filter(([, own]) => manifestFor(CTX).some(c => c.name === own)).length
    expect(have).toBeGreaterThanOrEqual(5)
  })
})

// FORMER LIMITATION (review finding 8): with the feature ON, a message whose ONLY recognised
// group is `playbook` narrows the request to it ("explain this setup" about the chart on screen loses the chart actions).
// Proposed fix (routing.js, integrator-owned): `addOnly: true` on the playbook group, and in selectGroups
// `matched = [...hits].some(id => !GROUPS.find(g => g.id === id)?.addOnly)`, with add-only hits placed first in the
// unmatched fill. That fix is now applied (integrator-approved): the cases below assert it.
describe('fixed limitation: knowledge-only messages no longer narrow the routed request (feature ON)', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire(['quote', 'quotes', ...Object.values(KNOWLEDGE_CAPS)]); await loadAgentConfig(); registerKnowledgeCapabilities() })
  afterAll(() => { _resetKnowledgeForTest(); _resetAgentConfig() })
  it('"explain this setup" matches the playbook group, which alone does not count as recognising the message', () => {
    expect(wordsSelect('playbook', 'explain this setup')).toBe(true)
    expect(selectGroups('explain this setup').matched).toBe(false)
    expect(selectGroups('explain this setup').priority.indexOf('playbook')).toBeLessThan(selectGroups('explain this setup').priority.indexOf('charts'))
  })
  it('"explain this setup" keeps the chart actions in the request (fixed: add-only group)', () => {
    expect(routed('explain this setup')).toContain('chart.setTimeframe')
    expect(routed('explain this setup')).toContain('playbook.explain')
  })
  it('a message that names another group as well is still routed to both', () => {
    expect(selectGroups('explain the VCP setup and switch to weekly').matched).toBe(true)
    expect(routed('explain the VCP setup and switch to weekly')).toEqual(expect.arrayContaining(['playbook.explain', 'chart.setTimeframe']))
  })
})

// N5 (owner, 2026-11-03): coaching phrasings belong to the coach group; concept/definition questions to the playbook
describe('N5: coaching phrasings never match the playbook group (kinds served)', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire(['quote', 'quotes', ...Object.values(KNOWLEDGE_CAPS)]); await loadAgentConfig(); registerKnowledgeCapabilities() })
  afterAll(() => { _resetKnowledgeForTest(); _resetAgentConfig() })
  it.each(['teach me how to trade a flag breakout', 'help me understand how to apply the VCP rules', 'quiz me on EP setups',
    'coach me through a pullback setup', 'walk me through applying the U&R'])('"%s" → not the playbook group', (m) => {
    expect(wordsSelect('playbook', m)).toBe(false)
  })
  it.each(['what is a VCP setup', 'define a high tight flag', 'rules for an episodic pivot'])('"%s" → still the playbook group', (m) => {
    expect(wordsSelect('playbook', m)).toBe(true)
  })
})

describe('re-review r2 N-3: the coaching exclusion reads the whole message; "practice" is narrowed', () => {
  beforeAll(async () => { _resetAgentConfig(); _resetKnowledgeForTest(); wire(['quote', 'quotes', ...Object.values(KNOWLEDGE_CAPS)]); await loadAgentConfig(); registerKnowledgeCapabilities() })
  afterAll(() => { _resetKnowledgeForTest(); _resetAgentConfig() })
  it.each(['hi\nwhat is a VCP setup', 'what is the practice of a VCP setup', 'i practice a lot; what is a VCP setup'])('"%s" → the playbook group', (m) => {
    expect(wordsSelect('playbook', m)).toBe(true)
  })
  it.each(['what is a VCP setup\nteach me', 'what is a VCP setup? practice with me', 'practice applying the EP setup'])('"%s" → coaching, not the playbook group', (m) => {
    expect(wordsSelect('playbook', m)).toBe(false)
  })
})
