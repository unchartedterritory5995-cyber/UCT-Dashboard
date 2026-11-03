// Wave 3 W3-4b (w3-a, 2026-11-03): the coach × Trading Brain. (1) docs/agent/coach/VOCABULARY-MAP.md maps every coach
// concept to the Brain's CANONICAL template names only (owner rule: the Wisdom vocabulary is authoritative, the Brain is
// the source of UCT setup definitions); (2) coach.explain PREFERS an approved Brain passage when — and only when — the
// server serves `knowledge.search`, read through the MD-1 door with the open turn's id; otherwise it is exactly as before.
// No model call, no network: fetch is scripted.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { explainConcept, _resetCoachForTest } from './capabilities/coach'
import { loadConcepts, _resetConceptsForTest } from './coach/concepts'
import { _resetObserveForTest } from './coach/observe'
import { brainServed, BRAIN_KIND } from './coach/brain'
import { FOOTER, FIXED } from './coach/guard'

vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => 't-vocab' }))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COACH_DOCS = path.resolve(HERE, '..', '..', '..', 'docs', 'agent', 'coach')
const MAP = fs.readFileSync(path.join(COACH_DOCS, 'VOCABULARY-MAP.md'), 'utf8').replace(/\r\n/g, '\n')
const SLUGS = fs.readdirSync(path.join(COACH_DOCS, 'concepts')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort()

/** The Brain's 48 canonical setup template names (PR #735, agent/kn/knowledge-poc). Update together with the Brain. */
const CANONICAL = ['20EMA Hold', '7-Week Short Rule', 'Ascending Triangle', 'BGU', 'Base-on-Base', 'Box Theory', 'Cup with Handle',
  'Descending Triangle', 'Double Bottom', 'EMA Crossback', 'EMA Crossover', 'EP', 'FTD', 'Flat Base', 'Gap-and-Go', 'Go Signal',
  'Green Line Breakout', 'HTF', 'HVC', 'Head & Shoulders', 'Kicker Candle', 'Late-Stage Climax', 'Launchpad', 'Low-Cheat', 'Mean Reversion',
  'Measured Move', 'Oops Reversal', 'Open Bull Gap Support', 'PEG', 'Parabolic Short', 'Pocket Pivot', 'Power Play', 'Rectangle',
  'Red to Green', 'Remount', 'Short Squeeze', 'Stage 2 Breakout', 'Stage 2 Momentum', 'Stage 4 Breakdown', 'Symmetrical Triangle',
  'Tight Flag', 'U&R', 'VCP', 'Wedge Pop', 'Wyckoff Accumulation', 'Wyckoff Distribution', 'Wyckoff LPSY', 'Wyckoff SOS']
const GENERIC = 'generic education — no template'

/** The map's table → { slug: [names] | 'generic' } */
function mapRows() {
  const out = {}
  const table = MAP.split('## Templates with no coach concept')[0]          // the concept table only
  for (const line of table.split('\n')) {
    const m = /^\| `([a-z0-9-]+)` \| (.+?) \|$/.exec(line.trim())
    if (!m) continue
    out[m[1]] = m[2].startsWith(GENERIC) ? 'generic' : m[2].split(',').map(s => s.trim())
  }
  return out
}

describe('VOCABULARY-MAP.md — coach concepts → canonical Brain template names', () => {
  const rows = mapRows()
  it('has exactly one row per coach concept', () => {
    expect(Object.keys(rows).sort()).toEqual(SLUGS)
    expect(SLUGS.length).toBe(13)
  })
  it('names only canonical templates (48, exact spelling)', () => {
    expect(new Set(CANONICAL).size).toBe(48)
    for (const [slug, names] of Object.entries(rows)) {
      if (names === 'generic') continue
      for (const n of names) expect(CANONICAL, `${slug}: ${n}`).toContain(n)
    }
  })
  it('accounts for every canonical template (in a row or in the "no coach concept" list)', () => {
    const inRows = new Set(Object.values(rows).filter(v => v !== 'generic').flat())
    const unmapped = CANONICAL.filter(n => !inRows.has(n))
    const section = MAP.split('## Templates with no coach concept')[1]?.split('\n## ')[0] || ''
    for (const n of unmapped) expect(section, n).toContain(n)
  })
})

// ── coach.explain × knowledge.search ────────────────────────────────────────────────────────────────────────────────
const CONCEPTS = [
  { id: 'breakouts-and-failure', title: 'Breakouts and failed breakouts', aliases: ['breakout', 'failed breakout'], observe: 'none',
    text: 'Breakouts and failed breakouts. A move through a level. Uncertainty: it may fail.', sections: {} },
]
const CURATED = `${CONCEPTS[0].text}\n\n${FOOTER}`
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const searchEnv = (passages, o = {}) => ({ contract: 'MD-1.0', kind: BRAIN_KIND, params_echo: {}, status: 'ok', freshness: 'periodic',
  as_of: '2026-11-01T00:00:00Z', fetched_at: '2026-11-03T00:00:00Z', delay_s: null, stale: false, source: 'uct-brain', coverage: null,
  provider_calls: 0, notes: [], data: { passages, method: 'fts' }, ...o })
const PASSAGE = { title: 'Failed breakouts', excerpt: 'The team treats a close back inside the base as the first sign the idea is wrong; it can still recover.',
  source: 'UCT Playbook', category: 'craft' }
const LEAD = `From UCT's playbook — ${PASSAGE.title}: ${PASSAGE.excerpt} (${PASSAGE.source})`

let dataCalls
function stub({ served = true, kinds = ['bars.daily', BRAIN_KIND], env = searchEnv([PASSAGE]) } = {}) {
  dataCalls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/agent/config') return json({ stream: false, data: served, data_kinds: served ? kinds : [], coach: true })
    if (u === '/api/agent/coach/concepts') return json({ concepts: CONCEPTS, footer: FOOTER })
    if (u === '/api/agent/data') { dataCalls.push(JSON.parse(init.body)); return typeof env === 'function' ? env() : json(env) }
    return json({})
  })
}
const host = () => ({ charts: { list: () => [], read: () => null, selected: () => null } })
const reset = () => { _resetAgentConfig(); _resetConceptsForTest(); _resetObserveForTest(); _resetCoachForTest() }
async function boot(opts) { reset(); stub(opts); await loadAgentConfig(); await loadConcepts() }

beforeEach(reset)

describe('coach.explain prefers a Brain passage only when knowledge.search is served', () => {
  it('gateway dark: no read, the answer is exactly the curated note (as before)', async () => {
    await boot({ served: false })
    expect(brainServed()).toBe(false)
    const out = await explainConcept('failed breakout', host())
    expect(dataCalls).toEqual([])
    expect(out.text).toBe(CURATED)
    expect(out.title).toBe(CONCEPTS[0].title)
  })
  it('gateway on without the Brain kind (UCT_AGENT_KNOWLEDGE off): still no read, still the curated note', async () => {
    await boot({ kinds: ['bars.daily'] })
    expect(brainServed()).toBe(false)
    const out = await explainConcept('failed breakout', host())
    expect(dataCalls).toEqual([])
    expect(out.text).toBe(CURATED)
  })
  it('served: ONE knowledge.search read with the open turn id; the passage leads, the curated note follows', async () => {
    await boot()
    expect(brainServed()).toBe(true)
    const out = await explainConcept('failed breakout', host())
    expect(dataCalls).toHaveLength(1)
    expect(dataCalls[0]).toMatchObject({ kind: BRAIN_KIND, purpose: 'answer', turn_id: 't-vocab', params: { question: 'failed breakout', k: 1 } })
    expect(out.text).toBe(`${LEAD}\n\n${CURATED}`)
    expect(out.title).toBe(CONCEPTS[0].title)
  })
  it('served but empty / refused / failing: exactly the curated note', async () => {
    const envs = [searchEnv([]), searchEnv(null, { status: 'refused', data: null, notes: ['the knowledge base is off'] }), () => json({ detail: 'x' }, 500)]
    for (const env of envs) {
      await boot({ env })
      expect((await explainConcept('failed breakout', host())).text).toBe(CURATED)
    }
  })
  it('a passage the mirror guard would replace never reaches the member: the curated note stands', async () => {
    await boot({ env: searchEnv([{ ...PASSAGE, excerpt: 'Buy it now — this pattern is guaranteed to work.' }]) })
    const out = await explainConcept('failed breakout', host())
    expect(out.text).toBe(CURATED)
    expect(out.text).not.toBe(FIXED)
  })
  it('a topic with no coach note: the Brain passage answers when served (else the concept list, as before)', async () => {
    await boot()
    expect((await explainConcept('the team on patience', host())).text).toBe(`${LEAD}\n\n${FOOTER}`)
    await boot({ served: false })
    expect((await explainConcept('the team on patience', host())).text).toMatch(/^I don't have a coach note on that yet\./)
  })
})

// ── N5 (owner, 2026-11-03): a named setup is taught FROM UCT's playbook; the coach never defines a setup ─────────────
import { setupNamed, SETUP_TEMPLATES, PLAYBOOK_KIND } from './coach/brain'
import { APPLY } from './capabilities/coach'
import { conceptsLoaded } from './coach/concepts'

const TEMPLATE = { name: 'VCP', family: 'base', description: 'A base whose pullbacks contract from left to right.',
  entry_triggers: ['a break above the pivot of the last contraction'], stop_methods: ['under the low of the last contraction'],
  invalidation: 'a close back under the pivot', common_mistakes: ['buying a loose, wide base'], link: { href: '/setups/vcp', label: 'Open the Setup Library' } }
const playEnv = (data, o = {}) => ({ ...searchEnv(null), kind: PLAYBOOK_KIND, data, ...o })
function stubBoth({ kinds = ['bars.daily', BRAIN_KIND, PLAYBOOK_KIND], play = playEnv(TEMPLATE), search = searchEnv([PASSAGE]) } = {}) {
  dataCalls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/agent/config') return json({ stream: false, data: true, data_kinds: kinds, coach: true })
    if (u === '/api/agent/coach/concepts') return json({ concepts: CONCEPTS, footer: FOOTER })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); dataCalls.push(b)
      return json(b.kind === PLAYBOOK_KIND ? play : search)
    }
    return json({})
  })
}
async function bootBoth(opts) { reset(); stubBoth(opts); await loadAgentConfig(); await loadConcepts() }

describe('N5 — a named setup is taught from UCT’s playbook, cited; never a coach-written definition', () => {
  it('setupNamed finds the 48 canonical names (EP / PEG only in caps), longest first', () => {
    expect(SETUP_TEMPLATES).toEqual(CANONICAL)
    for (const n of CANONICAL) expect(setupNamed(`help me understand how to apply the ${n}`), n).toBe(n)
    expect(setupNamed('teach me the vcp')).toBe('VCP')
    expect(setupNamed('a stage 2 breakout')).toBe('Stage 2 Breakout')
    expect(setupNamed('gap and go')).toBe('Gap-and-Go')
    for (const s of ['step by step', 'a peg in the ground', 'position sizing', 'relative strength']) expect(setupNamed(s), s).toBe(null)
  })
  it('setup.playbook served: ONE read of the template; the answer teaches FROM it (cited, its own fields, applying-it, footer)', async () => {
    await bootBoth()
    const out = await explainConcept('VCP', host())
    expect(dataCalls).toEqual([expect.objectContaining({ kind: PLAYBOOK_KIND, purpose: 'answer', turn_id: 't-vocab', params: { setup: 'VCP' } })])
    expect(out.text.startsWith("VCP — from UCT's setup template (the approved playbook):\nWhat it is: A base whose pullbacks contract from left to right.")).toBe(true)
    expect(out.text).toContain('Entry: a break above the pivot of the last contraction')
    expect(out.text).toContain('Stop: under the low of the last contraction')
    expect(out.text).toContain(APPLY)
    expect(out.text.endsWith(FOOTER)).toBe(true)
    expect(out.link).toEqual({ href: '/setups/vcp', label: 'Open the Setup Library' })
  })
  it('a template the guard would replace is never shown: the approved passage (cited) answers instead', async () => {
    await bootBoth({ play: playEnv({ ...TEMPLATE, entry_triggers: ['buy it now, guaranteed'] }) })
    const out = await explainConcept('VCP', host())
    expect(out.text).toBe(`${LEAD}\n\n${FOOTER}`)
  })
  it('only knowledge.search served: the passage leads; a related concept note follows ONLY as labelled generic background', async () => {
    await bootBoth({ kinds: ['bars.daily', BRAIN_KIND] })
    const out = await explainConcept('Stage 2 Breakout', host())
    expect(dataCalls.map(c => c.kind)).toEqual([BRAIN_KIND])
    expect(out.text).toBe(`${LEAD}\n\nGeneric background (not UCT's definition of Stage 2 Breakout): ${CONCEPTS[0].text}\n\n${FOOTER}`)
  })
  it('neither kind served: no read; the coach says where the definition lives and never presents a note as the setup', async () => {
    await bootBoth({ kinds: ['bars.daily'] })
    const related = await explainConcept('Stage 2 Breakout', host())
    expect(dataCalls).toEqual([])
    expect(related.text).toBe(`UCT's own definition of Stage 2 Breakout lives in the approved setup playbook, which isn't available here right now — what follows is generic background, not that definition.\n\n${CURATED}`)
    const none = await explainConcept('VCP', host())
    expect(none.text).toBe(`UCT's own definition of VCP lives in the approved setup playbook, which isn't available here right now. ${FOOTER}`)
  })
  it('a non-setup coaching topic is unchanged by the playbook kind (no setup.playbook read)', async () => {
    await bootBoth({ kinds: ['bars.daily', PLAYBOOK_KIND] })
    expect((await explainConcept('failed breakout', host())).text).toBe(CURATED)
    expect(dataCalls).toEqual([])
  })
})

describe('N5 — the 13 coach concept docs stay generic education: none names a UCT setup template', () => {
  it('no concept title, alias or text uses a canonical template name', async () => {
    const real = SLUGS.map(s => fs.readFileSync(path.join(COACH_DOCS, 'concepts', `${s}.md`), 'utf8'))
    for (const [i, raw] of real.entries()) for (const part of raw.split(/[.\n]/)) expect(setupNamed(part), `${SLUGS[i]}: ${part}`).toBe(null)
    expect(conceptsLoaded).toBeTypeOf('function')
  })
})
