// SAT-1 section B (owner: agent-sc) — the EXACT planner request the real panel sends for every discovery-corpus
// question, captured so the section-B runner (api/services/uct_agent/scan/sat/section_b.py) replays what a member's
// browser would send instead of re-deriving routing, context or the manifest in Python (a second copy would drift).
//
// For each question: a fresh panel (panelHarness), the screener catalog = the REAL field registry
// (__fixtures__/program/scores/screener-fields.json), loaded BEFORE the message; flags OFF (production state, so the
// legacy interpreter — NL-1 stays off). The harness answers the model with its sentinel: NO model call is made here.
// Recorded per question: the /api/agent/turn body (message, context, capabilities, manifestVersion, routing, …).
// The file is a measurement: it changes only with UPDATE_SAT1_REQUESTS=1, otherwise this test asserts it is current.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from './testing/panelHarness'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { _resetAgentConfig } from './agentClient'
import { _resetTurns } from './trace'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../..')
const CORPUS = JSON.parse(fs.readFileSync(path.join(REPO, 'api/services/uct_agent/scan/eval/discovery.json'), 'utf8'))
const META = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/scores/screener-fields.json'), 'utf8'))
const OUT = path.join(REPO, 'api/services/uct_agent/scan/sat/section_b_requests.json')
const results = {}
const reroutes = {}

let p
beforeEach(async () => {
  _resetScreenerCache(); _resetAgentConfig(); _resetTurns()
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false })
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: {} } : { fields: META.fields })
    if (u === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (u.startsWith('/api/screener/scan')) return json({ total: 0, rows: [], snapshot_date: '2026-10-31', snapshot: {} })
    return harness(url, init)
  })
  await loadMeta()
})
afterEach(() => { _resetTurns(); vi.restoreAllMocks() })

describe('SAT-1 section B: the planner request the real panel sends per corpus question', () => {
  for (const q of CORPUS.questions) {
    it(`${q.id}: ${q.question}`, async () => {
      const { say } = p.mount(...ONE())
      await say(q.question)
      const body = p.lastTurnBody()
      // every discovery question reaches the planner today (QA #608: the fast path handles 0/31); if one stops
      // doing so this records null and the runner reports it as answered without the planner
      results[q.id] = body ? { ...body, conversationId: null } : null
      if (body) expect(body.message).toBe(q.question)
    }, 30000)
  }

  // ROUTING: a question routed WITHOUT the screener group can only screen after the model asks for it
  // (`need_groups`), which the browser answers with ONE reroute of the same request. The reroute body for
  // need_groups=["screener"] is captured too, so the runner can replay it if that is what the model asks for.
  for (const q of CORPUS.questions) {
    it(`${q.id} reroute (need_groups: screener)`, async () => {
      const first = results[q.id]
      if (!first || (first.routing?.selected || []).includes('screener')) return
      const { say } = p.mount(...ONE())
      p.st.envelopes.push({ disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, need_groups: ['screener'] })
      await say(q.question)
      const bodies = p.st.calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
      expect(bodies).toHaveLength(2)
      expect(bodies[1].reroute).toBe(true)
      expect(bodies[1].routing.selected).toContain('screener')
      reroutes[q.id] = { need_groups: ['screener'], body: { ...bodies[1], conversationId: null } }
    }, 30000)
  }

  afterAll(() => {
    // the manifest is the same few sets across questions: stored once each, referenced by name (`capabilities_ref`)
    const manifests = {}
    const keyOf = new Map()
    const requests = {}
    const pack = (body) => {
      const sig = JSON.stringify(body.capabilities)
      if (!keyOf.has(sig)) { const k = `m${keyOf.size + 1}`; keyOf.set(sig, k); manifests[k] = body.capabilities }
      const { capabilities, ...rest } = body
      return { ...rest, capabilities_ref: keyOf.get(sig) }
    }
    for (const [id, body] of Object.entries(results)) {
      if (!body) { requests[id] = null; continue }
      requests[id] = pack(body)
      if (reroutes[id]) requests[id].reroute_on = { need_groups: reroutes[id].need_groups, body: pack(reroutes[id].body) }
    }
    const text = JSON.stringify({ about: 'captured by app/src/agent/agentScanSat1Requests.test.jsx (UPDATE_SAT1_REQUESTS=1 rewrites); '
      + 'replayed by api/services/uct_agent/scan/sat/section_b.py', corpus_version: CORPUS.version, manifests, requests }, null, 1) + '\n'
    if (process.env.UPDATE_SAT1_REQUESTS === '1') { fs.writeFileSync(OUT, text); return }
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''
    if (have !== text) throw new Error('the captured planner requests moved: review, then rerun with UPDATE_SAT1_REQUESTS=1')
  })
})
