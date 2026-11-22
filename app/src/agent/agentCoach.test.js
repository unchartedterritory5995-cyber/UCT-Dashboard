// Wave 3 W3-1 (w3-a, 2026-11-03): coach.explain — dark by construction, the curated knowledge base (the REAL
// docs/agent/coach/concepts/*.md, parsed here as the server parses them), ONE grounded observation from a served
// envelope, and the rails: every figure in a coach answer is in its inputs and no answer carries a guarantee word.
// No model call, no network: fetch is scripted.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAgentConfig, _resetAgentConfig, serverServesCoach } from './agentClient'
import { allCapabilityNames, getCapability, manifestFor, buildContext } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { registerCoachCapabilities, explainConcept, coachTopic, _resetCoachForTest, COACH_WORDS } from './capabilities/coach'
import { conceptFor, loadConcepts, conceptsLoaded, _resetConceptsForTest } from './coach/concepts'
import { observationFromEnvelope, _resetObserveForTest } from './coach/observe'
import { check, untraceableFigures, unsupported, FOOTER } from './coach/guard'
import { fastParse } from './fastPath'

vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => 't-coach' }))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOCS = path.resolve(HERE, '..', '..', '..', 'docs', 'agent', 'coach', 'concepts')

/** The real knowledge base, parsed the way the server parses it (front matter + four sections → text). */
function realConcepts() {
  return fs.readdirSync(DOCS).filter(f => f.endsWith('.md')).sort().map((f) => {
    const raw = fs.readFileSync(path.join(DOCS, f), 'utf8').replace(/\r\n/g, '\n')
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
    const meta = Object.fromEntries(m[1].split('\n').map(l => l.split('#')[0]).filter(l => l.includes(':')).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
    const parts = m[2].split(/^## +(.+?)\s*$/m)
    const sections = {}
    for (let i = 1; i < parts.length - 1; i += 2) sections[parts[i].trim()] = parts[i + 1].replace(/\s+/g, ' ').trim()
    const text = `${meta.title}. ${sections['What it is']}\n\nWhat to look for: ${sections['What to look for']}\n\nCommon mistakes: ${sections['Common mistakes']}\n\nUncertainty: ${sections.Uncertainty}`
    return { id: meta.id, title: meta.title, aliases: meta.aliases.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), observe: meta.observe || 'none', text, sections }
  })
}
const ROWS = realConcepts()

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const THROUGH = '2026-10-30'
// 60 completed sessions: closes rising (last above 20-avg, 20-avg above 50-avg); the last session's volume above its average
const bars = (n = 60, { rising = true, lastVolume = 5_000_000 } = {}) => Array.from({ length: n }, (_, i) => ({
  date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`,
  open: 0, high: 0, low: 0, close: rising ? 100 + i : 200 - i, volume: i === n - 1 ? lastVolume : 1_000_000,
}))
const barsEnv = (data = {}, o = {}) => ({ contract: 'MD-1.0', kind: 'bars.daily', params_echo: { symbol: 'NVDA', bars: 50 }, status: 'ok',
  freshness: 'historical', as_of: '2026-10-30T20:00:00Z', fetched_at: '2026-11-02T15:00:00Z', delay_s: null, stale: false,
  source: 'uct-bars', coverage: null, provider_calls: 0, notes: [], data: { symbol: 'NVDA', bars: bars(), through: THROUGH, latest_completed_session: THROUGH, ...data }, ...o })

const host = (charts = [{ ref: 'c1', label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D' }]) => ({ charts: { list: () => charts, read: (r) => charts.find(c => c.ref === r) || null, selected: () => null } })

function stubServer({ coach = true, data = true, env = barsEnv() } = {}) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, news: false, data, scan: false, data_kinds: data ? ['bars.daily', 'instrument.resolve'] : [], planner: 'v1', coach })
    if (u === '/api/agent/coach/concepts') return coach ? json({ concepts: ROWS, footer: FOOTER }) : json({ detail: 'Not found' }, 404)
    if (u === '/api/agent/data') return json(typeof env === 'function' ? env(JSON.parse(init.body)) : env)
    return json({})
  })
}

beforeEach(() => {
  _resetAgentConfig(); _resetConceptsForTest(); _resetObserveForTest(); _resetCoachForTest()
})

describe('dark by construction', () => {
  it('a server that does not serve `coach` registers nothing: the manifest is exactly as before', async () => {
    stubServer({ coach: false, data: false })        // (data off too: only the coach's absence is under test)
    await loadAgentConfig()
    expect(serverServesCoach()).toBe(false)
    registerBuiltins()
    const before = manifestFor({ surface: 'charts' }).map(c => c.name)
    registerServerGatedBuiltins()
    expect(manifestFor({ surface: 'charts' }).map(c => c.name)).toEqual(before)
    // train2: W2-C1's journal page registers journal.listNotes / journal.createNote (its own surface, ungated), so the
    // coach's absence is checked by the coach's own names, not the journal.* prefix
    expect(allCapabilityNames().some(n => n.startsWith('coach.') || n === 'journal.reviewTrades' || n === 'journal.proposeNote')).toBe(false)
  })
  it('an older server (no coach key) and a refused config are both off', async () => {
    globalThis.fetch = vi.fn(async () => json({ stream: false }))
    await loadAgentConfig()
    expect(serverServesCoach()).toBe(false)
    _resetAgentConfig()
    globalThis.fetch = vi.fn(async () => json({ detail: 'Admin only' }, 403))
    await loadAgentConfig()
    expect(serverServesCoach()).toBe(false)
  })
})

describe('with the server serving coach', () => {
  beforeEach(async () => {
    stubServer()
    await loadAgentConfig()
    registerBuiltins()
    registerServerGatedBuiltins()
    await loadConcepts()
  })

  it('registers coach.explain on the coach target, a query, available on charts only', () => {
    expect(serverServesCoach()).toBe(true)
    const c = getCapability('coach.explain')
    expect(c.query).toBe(true)
    expect(c.target).toBe('coach')
    expect(c.available({ surface: 'charts' })).toBe(true)
    expect(c.available({ surface: 'journal' })).toBe(false)
    expect(manifestFor({ surface: 'charts' }).find(x => x.name === 'coach.explain').summary).toMatch(/Educational, not advice/)
  })

  it('the knowledge base is the real one: ≥ 12 concepts, each with the four sections and an uncertainty note', () => {
    expect(conceptsLoaded().length).toBeGreaterThanOrEqual(12)
    for (const c of conceptsLoaded()) {
      expect(c.text, c.id).toMatch(/Uncertainty: /)
      expect(unsupported(c.text), c.id).toEqual([])
      expect(c.aliases.length, c.id).toBeGreaterThan(0)
    }
  })

  it.each([
    ['what is relative strength?', 'relative-strength'], ['explain the rs line', 'relative-strength'],
    ['coach me on failed breakouts', 'breakouts-and-failure'], ['teach me about position sizing', 'risk-per-trade-position-sizing'],
    ['help me understand expectancy', 'expectancy'], ['what does drawdown mean', 'drawdown'],
    ['where to put a stop', 'stop-placement'], ['what is the 50-day', 'moving-averages-context'],
  ])('matches "%s" to %s', (said, id) => {
    const topic = coachTopic(said)
    expect(topic).toBeTruthy()
    expect(conceptFor(topic)?.id).toBe(id)
  })
  it('names no concept for UCT indicators or unknown words', () => {
    for (const said of ['what is RSI?', 'explain MACD', 'change the chart to weekly', 'hello']) expect(conceptFor(coachTopic(said) || said)).toBe(null)
  })

  it('🔴 the fast path answers a COACHING phrasing instantly (N5), not a bare question, and leaves UCT’s own terms to the guide', () => {
    for (const said of ['coach me on failed breakouts', 'teach me about failed breakouts', 'quiz me on stop placement', 'walk me through position sizing',
      'help me understand how to apply relative strength']) {
      const hit = fastParse(said, { host: host() })
      expect(hit?.kind, said).toBe('ops')
      expect(hit.ops[0].action, said).toBe('coach.explain')
    }
    // N5: a bare concept / setup question is not the coach's instant answer (the playbook group / the model decide)
    for (const said of ['what is a failed breakout?', 'what is a VCP?']) expect(fastParse(said, { host: host() })?.ops?.[0]?.action ?? null, said).not.toBe('coach.explain')
    // "what is RSI" names a catalog indicator: guide.explain's (instant) — never the coach's
    const rsi = fastParse('what is RSI?', { host: host() })
    expect(rsi?.ops?.[0]?.action ?? null).not.toBe('coach.explain')
  })

  it('🔴 explains from the concept text + ONE grounded observation, ends with the footer, every figure traceable', async () => {
    const a = await explainConcept('moving averages', host())
    const c = conceptFor('moving averages')
    expect(a.title).toBe(c.title)
    expect(a.text).toContain(c.sections['What it is'])
    expect(a.text).toContain(`On this chart (NVDA, daily bars through ${THROUGH}): the last close is above its 20-day average, and the 20-day average is above the 50-day average.`)
    expect(a.text.trim().endsWith(FOOTER)).toBe(true)
    expect(a.text.split(/On this chart/).length - 1).toBe(1)                   // exactly one observation line
    // the rails: no figure outside the inputs (the concept text + the envelope's own date), no guarantee word
    expect(untraceableFigures(a.text, [c.text, THROUGH, '20 50'])).toEqual([])
    expect(check(a.text, [c.text, `through ${THROUGH} 20-day 50-day`])).toEqual([])
    // a value never leaves observe.js: no close or volume figure, no dollar sign
    expect(a.text).not.toMatch(/\$\d|\b1[0-9]{2}\b|5,?000,?000/)
    const call = globalThis.fetch.mock.calls.find(([u]) => u === '/api/agent/data')
    expect(JSON.parse(call[1].body)).toMatchObject({ kind: 'bars.daily', params: { symbol: 'NVDA', bars: 50 }, purpose: 'answer', turn_id: 't-coach' })
  })

  it('a volume concept gets the volume observation', async () => {
    const a = await explainConcept('relative volume', host())
    expect(a.text).toContain(`On this chart (NVDA, daily bars through ${THROUGH}): the last completed session's volume was above its 20-session average.`)
  })

  it('a concept with observe: none reads nothing', async () => {
    const a = await explainConcept('expectancy', host())
    expect(a.text).not.toContain('On this chart')
    expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/agent/data')).toBe(false)
  })

  it('no chart, a refused read, or too few bars → the concept text alone (nothing guessed)', async () => {
    expect((await explainConcept('support and resistance', host([]))).text).not.toContain('On this chart')
    stubServer({ env: { ...barsEnv(), status: 'refused', data: null } })
    expect((await explainConcept('support and resistance', host())).text).not.toContain('On this chart')
    stubServer({ env: barsEnv({ bars: bars(10) }) })
    expect((await explainConcept('support and resistance', host())).text).not.toContain('On this chart')
  })

  it('with the data gateway dark the observation is skipped and no read is attempted', async () => {
    _resetAgentConfig(); stubServer({ data: false }); await loadAgentConfig()
    const a = await explainConcept('breakouts', host())
    expect(a.text).not.toContain('On this chart')
    expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/agent/data')).toBe(false)
  })

  it('an unknown topic lists what the coach can explain, with the footer (no figures)', async () => {
    const a = await explainConcept('the gartley pattern', host())
    expect(a.text).toMatch(/I don't have a coach note on that yet\. I can explain: /)
    expect(a.text).toContain(conceptFor('drawdown').title)
    expect(a.text.endsWith(FOOTER)).toBe(true)
    expect(untraceableFigures(a.text, [])).toEqual([])
  })

  it('🔴 the coach context entry rides only on a coaching message, carries the concept TEXT as data, never a value', async () => {
    await explainConcept('moving averages', host())           // sets the latest observation
    const { context } = buildContext(host(), { surface: 'charts', message: 'what is the 50-day telling me?' })
    const [entry] = context.coach
    expect(entry).toMatchObject({ conceptId: 'moving-averages-context', consent: 'unknown' })
    expect(entry.concept).toBe(conceptFor('50-day').text)
    expect(entry.observation).toContain('the 20-day average is above the 50-day average')
    expect(JSON.stringify(entry)).not.toMatch(/"close"|\$\d|159|5000000/)
    expect(buildContext(host(), { surface: 'charts', message: 'switch to weekly' }).context.coach).toBeUndefined()
    expect(buildContext(host(), { surface: 'charts', message: 'review my trades' }).context.coach[0].concept).toBeUndefined()
    expect(COACH_WORDS.test('review my trades')).toBe(true)
  })
})

describe('observationFromEnvelope (pure)', () => {
  it('names relations only, from the envelope’s own date', () => {
    const e = barsEnv({ bars: bars(60, { rising: false }) })
    expect(observationFromEnvelope(e, 'ma', { symbol: 'NVDA' })).toBe(`On this chart (NVDA, daily bars through ${THROUGH}): the last close is below its 20-day average, and the 20-day average is below the 50-day average.`)
    expect(observationFromEnvelope(barsEnv({ bars: bars(30) }), 'ma', { symbol: 'NVDA' })).toBe(`On this chart (NVDA, daily bars through ${THROUGH}): the last close is above its 20-day average.`)
    expect(observationFromEnvelope(barsEnv({ bars: bars(60, { lastVolume: 10 }) }), 'volume', { symbol: 'NVDA' })).toMatch(/volume was below its 20-session average\.$/)
    expect(observationFromEnvelope(barsEnv({ through: '' }), 'ma', { symbol: 'NVDA' })).toBe(null)
    expect(observationFromEnvelope(null, 'ma', { symbol: 'NVDA' })).toBe(null)
    expect(observationFromEnvelope(barsEnv({}, { status: 'unavailable' }), 'ma', { symbol: 'NVDA' })).toBe(null)
  })
})

describe('registerCoachCapabilities is idempotent and dark without the flag', () => {
  it('registers nothing before the config says coach', () => {
    _resetAgentConfig()
    registerCoachCapabilities()
    expect(allCapabilityNames().includes('coach.explain')).toBe(false)
  })
})
