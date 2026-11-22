// W2-B1 (agent-rs, RS-1 v1): `research.ask` over the MD-1 `research.company` kind — the pure envelope → answer
// (three sections + dated sources, freshness from the envelope's own flags), the research VIEW through present.js
// and the real AgentResult renderer, the fast path for the three default questions, ONE read per answer with
// purpose 'research' after instrument.resolve, fixed no-research words, and dark by default (nothing registers,
// nothing matches, the manifest is unchanged). No model, no provider, no web call from the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability, manifestFor } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { fastParse } from './fastPath'
import { presentOf, isView, compactView, VIEW_KINDS } from './present'
import AgentResult from './AgentResult'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'
import {
  answerFromResearch, answerResearch, freshnessLine, sourceLine, match, researchServed, registerResearchCapability,
  _resetResearchForTest, CAPABILITY, KIND, SECTION,
} from './capabilities/research'

let TURN = 't-research'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

const FETCHED = '2026-11-03T15:30:05Z'
const ENV = {
  contract: 'MD-1.0', kind: KIND, params_echo: { symbol: 'NVDA', topic: 'move' }, status: 'ok', freshness: 'periodic',
  as_of: '2026-07-31T00:00:00Z', fetched_at: FETCHED, delay_s: null, stale: true, source: 'uct-agent-research',
  coverage: { evaluated: 4, answered: 4, dropped: 0, not_computable: 0 }, provider_calls: 1,
  notes: ['a server note that must never be echoed'],
  data: {
    symbol: 'NVDA', topic: 'move',
    facts: [
      { text: 'NVDA $142.10, −2.34% vs the previous close — live, regular session, as of 10:29 AM ET.', source: 'Massive market snapshot via the UCT data gateway', as_of: '2026-11-03T15:29:50Z', kind: 'quote', stale: false },
      { text: "NVDA's newest quarterly statements (period ending Jul 31, 2026): revenue $46.74B. Periodic disclosures, not today's figures.", source: 'Yahoo Finance statements via the UCT data gateway', as_of: '2026-07-31T00:00:00Z', kind: 'fundamentals', stale: true },
    ],
    interpretation: ['Shares fell after a downgrade this morning.', 'The next report is due on November 19, 2026.'],
    unknown: ['1 web sentence cited figures UCT\'s data did not return and was left out', 'web sources carry no publication date from the search provider'],
    sources: [
      { title: 'NVIDIA announces a thing', url: 'https://x/1', published_at: '2026-11-03T13:05:00Z' },
      { title: 'example.com', url: 'https://example.com/story', published_at: null },
    ],
    inputs: { quote: 'ok', 'news.company': 'ok', earnings: 'ok', fundamentals: 'ok' }, web: { ran: true, cached: false, stripped: 1 }, facts_refused: 0,
  },
}
const says = (a) => (typeof a === 'string' ? a : a.text)

describe('pure: a research envelope → the three sections, dated sources and an honest freshness line', () => {
  it('facts, interpretation and unknowns are kept apart; every source is dated or says it is not', () => {
    const a = answerFromResearch(ENV, { symbol: 'NVDA', topic: 'move' })
    const lines = a.text.split('\n')
    expect(lines[0]).toBe("NVDA — why it's moving")
    expect(lines[1]).toBe(`${SECTION.facts}:`)
    expect(lines[2]).toBe('• NVDA $142.10, −2.34% vs the previous close — live, regular session, as of 10:29 AM ET.')
    expect(lines[4]).toBe(`${SECTION.interpretation}:`)
    expect(lines[5]).toBe('• Shares fell after a downgrade this morning.')
    expect(lines[7]).toBe(`${SECTION.unknown}:`)
    expect(lines[10]).toBe(`${SECTION.sources}:`)
    expect(lines[11]).toBe('• 8:05 AM ET · NVIDIA announces a thing — https://x/1')
    expect(lines[12]).toBe('• date not given · example.com — https://example.com/story')
    expect(lines[13]).toBe("UCT's facts are as of Jul 31, 2026 to 10:29 AM ET (each fact names its own time); at least one source is behind its usual refresh. Only a fact marked live is a real-time price; the rest are as of their own times.")
    expect(a.text).not.toMatch(/never be echoed/)
    expect(a.present).toMatchObject({ kind: 'research', title: "NVDA — why it's moving", short: 'NVDA' })
    expect(a.present.cited).toEqual([
      { title: 'NVIDIA announces a thing', url: 'https://x/1', when: '8:05 AM ET' },
      { title: 'example.com', url: 'https://example.com/story', when: 'date not given' },
    ])
    expect(a.link).toEqual({ href: '/research/NVDA', label: 'Open NVDA in Research' })
    expect(a.chart).toEqual({ symbol: 'NVDA', label: 'NVDA' })
  })
  it('"live" never appears outside a fact the server worded live; a partial read says sources were missing', () => {
    const closed = { ...ENV, status: 'partial', data: { ...ENV.data, facts: [{ ...ENV.data.facts[1] }], interpretation: [], sources: [] } }
    const a = answerFromResearch(closed, { symbol: 'NVDA', name: 'NVIDIA Corporation', topic: 'catalysts' })
    expect(a.text).toMatch(/^NVDA \(NVIDIA Corporation\) — catalysts ahead\n/)
    expect(a.text).toContain('• No web commentary was available.')
    expect(freshnessLine(closed)).toBe("UCT's facts are as of Jul 31, 2026 (each fact names its own time); at least one source is behind its usual refresh; some sources were not available (listed under Not known). Not a real-time price.")
    expect(a.text.toLowerCase().split('\n').filter(l => /\blive\b/.test(l))).toEqual([])
  })
  it('refused / unavailable answer in fixed words with no figure', () => {
    expect(says(answerFromResearch({ ...ENV, status: 'refused', data: null }, { symbol: 'NVDA' }))).toBe("I couldn't research NVDA: that request wasn't allowed for this question, so no research answer is available. No figure is stated.")
    expect(says(answerFromResearch(null, { symbol: 'AMD' }))).toBe("I couldn't research AMD: neither UCT's data nor a web lookup could contribute, so no research answer is available. No figure is stated.")
    expect(sourceLine({ title: 'x', url: 'javascript:alert(1)', published_at: '2026-11-01' }, FETCHED).url).toBeNull()
  })
})

describe('the research VIEW: present.js and the real renderer', () => {
  afterEach(cleanup)
  it('presentOf keeps the research kind with bounded lists; compactView fits the transcript budget', () => {
    expect(VIEW_KINDS).toContain('research')
    const v = presentOf(answerFromResearch(ENV, { symbol: 'NVDA', topic: 'move' }), { message: 'why is NVDA down today' })
    expect(v.kind).toBe('research')
    expect(isView(v)).toBe(true)
    expect(v.facts).toHaveLength(2)
    expect(v.interpretation).toEqual(ENV.data.interpretation)
    expect(v.unknown).toHaveLength(2)
    expect(v.cited.map(c => c.when)).toEqual(['8:05 AM ET', 'date not given'])
    expect(v.note).toMatch(/Only a fact marked live is a real-time price; the rest are as of their own times\.$/)   // a live fact sits above it (review #726)
    expect(v.text).toBeUndefined()                               // the sections ARE the answer: never doubled
    expect(v.details?.text).toBeUndefined()
    expect(v.link.href).toBe('/research/NVDA')
    expect(compactView(v)).toMatchObject({ kind: 'research', v: 1 })
    expect(isView({ kind: 'research', facts: [], interpretation: [], unknown: [] })).toBe(false)
  })
  it('AgentResult renders the three labelled sections and the dated sources', () => {
    const v = presentOf(answerFromResearch(ENV, { symbol: 'NVDA', topic: 'move' }), { message: 'why is NVDA down today' })
    render(<AgentResult view={v} />)
    expect(screen.getByTestId('agent-result').dataset.kind).toBe('research')
    expect(screen.getByTestId('agent-research-facts')).toHaveTextContent("What UCT's data shows")
    expect(screen.getByTestId('agent-research-facts')).toHaveTextContent('NVDA $142.10, −2.34% vs the previous close — live, regular session, as of 10:29 AM ET.')
    expect(screen.getByTestId('agent-research-interpretation')).toHaveTextContent('Interpretation (web commentary, not UCT data)')
    expect(screen.getByTestId('agent-research-interpretation')).toHaveTextContent('Shares fell after a downgrade this morning.')
    expect(screen.getByTestId('agent-research-unknown')).toHaveTextContent('web sources carry no publication date')
    const sources = screen.getByTestId('agent-research-sources')
    expect(sources).toHaveTextContent('8:05 AM ET')
    expect(sources).toHaveTextContent('date not given')
    const a = sources.querySelector('a[href="https://x/1"]')
    expect(a).not.toBeNull()
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(screen.getAllByText(/the rest are as of their own times\.$/)).toHaveLength(1)
    expect(screen.queryAllByText(/Not a real-time price\.$/)).toHaveLength(0)
  })
})

// ── served vs dark ──────────────────────────────────────────────────────────────────────────────────────────────
let calls
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
function wire(kinds, env = ENV) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push([u, body])
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    if (u === '/api/agent/data') {
      if (body.kind === 'instrument.resolve') return json(resolveEnvelope(body.params))
      if (body.kind === KIND) return json({ ...env, params_echo: body.params })
      return json({ ...ENV, kind: body.kind, status: 'refused', data: null, freshness: 'unavailable', as_of: null })
    }
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return json({}, 404)
  })
}
const reads = () => calls.filter(c => c[0] === '/api/agent/data').map(c => c[1])

describe('research.ask: served vs dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetResearchForTest(); vi.restoreAllMocks() })
  afterEach(() => { _resetResearchForTest() })

  it('dark: nothing registers, the fast path claims nothing, the manifest is unchanged', async () => {
    wire(null)
    await loadAgentConfig()
    expect(researchServed()).toBe(false)
    expect(registerResearchCapability()).toBe(false)
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(match('why is NVDA down today')).toBeNull()
    expect(fastParse('why is NVDA down today', {})).toBeNull()
    wire(['research.company'])                                       // without instrument.resolve: still dark
    _resetAgentConfig(); await loadAgentConfig()
    expect(researchServed()).toBe(false)
    expect(manifestFor({ surface: 'charts', createIndicator: true }).map(c => c.name)).not.toContain(CAPABILITY)
  })

  it('served: registers through registerServerGatedBuiltins; the default questions take the fast path with the word as typed', async () => {
    wire(['research.company', 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).toContain(CAPABILITY)
    const cap = getCapability(CAPABILITY)
    expect(cap.query).toBe(true)
    expect(cap.target).toBe('market')
    expect(cap.undo).toBe('none')
    expect(match('why is NVDA down today?')).toEqual({ action: CAPABILITY, params: { symbol: 'NVDA', topic: 'move', question: 'why is NVDA down today?' } })
    expect(match("what's driving strength in $amd")).toMatchObject({ params: { symbol: '$amd', topic: 'strength' } })
    expect(match('what catalysts next week for TSLA')).toMatchObject({ params: { symbol: 'TSLA', topic: 'catalysts' } })
    expect(match('any catalysts coming up for AMD?')).toMatchObject({ params: { symbol: 'AMD', topic: 'catalysts' } })
    expect(match('why did nvda drop today')).toMatchObject({ params: { symbol: 'nvda', topic: 'move' } })
    // not claimed: a different request, a question with no candidate, a sentence too long
    expect(match('why is the market down today')).toBeNull()
    expect(match('what is NVDA trading at')).toBeNull()
    expect(match('news for NVDA')).toBeNull()
    expect(match('why is NVDA down today ' + 'x'.repeat(120))).toBeNull()
    const f = fastParse('why is NVDA down today', {})
    expect(f?.ops?.[0]?.action ?? f?.action ?? f?.ops?.action).toBeTruthy()
  })

  it('served: ONE research read with purpose research, after the symbol index confirmed the word', async () => {
    wire(['research.company', 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const a = await getCapability(CAPABILITY).answer(null, { symbol: 'nvda', topic: 'move', question: 'why is nvda down today' })
    const r = reads()
    expect(r.map(b => b.kind)).toEqual(['instrument.resolve', KIND])
    expect(r[1]).toEqual({ kind: KIND, params: { symbol: 'NVDA', topic: 'move', question: 'why is nvda down today' }, purpose: 'research', turn_id: 't-research' })
    expect(a.present.kind).toBe('research')
    expect(a.text).toMatch(/^NVDA \(NVIDIA Corporation\) — why it's moving\n/)
    expect(calls.some(c => c[0].startsWith('/api/live-prices'))).toBe(false)
  })

  it('served: an unconfirmed word answers in the §4.7.3 words and reads no research; no turn → no read', async () => {
    wire(['research.company', 'instrument.resolve'])
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const a = await answerResearch({ symbol: 'gld', topic: 'move', question: null })
    expect(says(a)).toMatch(/I'm not sure which instrument "gld" means|isn't one I can price here/)
    expect(reads().map(b => b.kind)).toEqual(['instrument.resolve'])
    TURN = null
    try {
      expect(says(await answerResearch({ symbol: 'NVDA', topic: 'move', question: null }))).toMatch(/needs the Agent's turn/)
    } finally { TURN = 't-research' }
    expect(reads().filter(b => b.kind === KIND)).toHaveLength(0)
  })
})
