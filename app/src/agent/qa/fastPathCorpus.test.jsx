// agent-qa — the SC-1 discovery corpus through the Agent's NO-MODEL fast path, measured in the REAL panel.
//
// The third interpreter scored by tests/test_uct_agent_qa_scan_corpus.py ("browser-fast-path"). For every corpus
// question: a fresh panel (panelHarness) whose screener catalog is the REAL field registry
// (__fixtures__/program/scores/screener-fields.json, generated from filters.field_catalog()), loaded BEFORE the
// message (agent-sc's F-SAT-3 note: the fast path only claims screener text once the catalog is in). Recorded:
//   model_turns  requests that WOULD have reached the model (0 = the fast path handled it)
//   scan         the /api/screener/scan spec the fast path sent (filters + sort), or null
//   reply        the Agent's visible answer, clipped
// No model call, no network. The file is a measurement: it changes only with UPDATE_QA_FASTPATH=1, and the Python
// scorer pins its score exactly, so a fast-path change cannot move the number unreviewed.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from '../testing/panelHarness'
import { registerBuiltins } from '../builtins'
import { _resetScreenerCache, loadMeta } from '../capabilities/screener'
import { _resetAgentConfig } from '../agentClient'
import { _resetTurns } from '../trace'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../../..')
const CORPUS = JSON.parse(fs.readFileSync(path.join(REPO, 'api/services/uct_agent/scan/eval/discovery.json'), 'utf8'))
const SCORES = path.join(REPO, 'app/src/agent/__fixtures__/program/scores')
const META = JSON.parse(fs.readFileSync(path.join(SCORES, 'screener-fields.json'), 'utf8'))
const OUT = path.join(SCORES, 'fastpath-candidates.json')
const results = {}

let p, scans
beforeEach(async () => {
  _resetScreenerCache(); _resetAgentConfig(); _resetTurns()
  scans = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false })
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: {} } : { fields: META.fields })
    if (u === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (u.startsWith('/api/screener/scan')) { scans.push(JSON.parse(init.body)); return json({ total: 0, rows: [], snapshot_date: '2026-10-31', snapshot: {} }) }
    return harness(url, init)
  })
  await loadMeta()                                                       // the catalog is IN before the message
})
afterEach(() => { _resetTurns(); vi.restoreAllMocks() })

describe('agent-qa: discovery corpus through the browser fast path', () => {
  it('CONTROL: in this exact setup the fast path DOES claim a phrase it knows (0 model turns, 1 scan)', async () => {
    const { say } = p.mount(...ONE())
    await say('show me my strongest stocks')
    expect(p.turns()).toBe(0)
    expect(scans).toHaveLength(1)
    expect(scans[0].sort).toEqual({ key: 'rs_rank', dir: 'desc' })
  }, 30000)

  for (const q of CORPUS.questions) {
    it(`${q.id}: ${q.question}`, async () => {
      const { say } = p.mount(...ONE())
      await say(q.question)
      const s = scans[0] || null
      results[q.id] = {
        model_turns: p.turns(),
        scan: s ? { filters: s.filters || [], sort: s.sort || null } : null,
        reply: String(p.lastAgent?.() ?? '').replace(/\s+/g, ' ').slice(0, 160),
      }
      expect(results[q.id].model_turns).toBeGreaterThanOrEqual(0)
    }, 30000)
  }

  afterAll(() => {
    const text = JSON.stringify({ about: 'measured by app/src/agent/qa/fastPathCorpus.test.jsx (UPDATE_QA_FASTPATH=1 rewrites)',
      corpus_version: CORPUS.version, questions: results }, null, 1) + '\n'
    if (process.env.UPDATE_QA_FASTPATH === '1') { fs.writeFileSync(OUT, text); return }
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''
    if (have !== text) throw new Error('the fast-path measurement moved: review it, then run with UPDATE_QA_FASTPATH=1 and '
      + 'regenerate the Python baseline (python -m tests.test_uct_agent_qa_scan_corpus --write-baseline)')
  })
})
