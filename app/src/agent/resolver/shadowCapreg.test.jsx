// ── D31 RESOLVER · the shadow hook through the REAL panel (capreg harness), and the OFFLINE capreg replay ─────────────────
// 1. SWALLOW (AUDIT R4): with the shadow hook replaced by one that THROWS on every call, every destructive capreg intent's
//    phrasing reaches the SAME final state its corpus entry expects — the rails' decision stands; the turn never breaks.
// 2. OFFLINE REPLAY (RESOLVER_REPLAY=1 only — never in CI's default run, never in production): the real hook with a test sink,
//    over every phrasing of every capreg intent whose plan destroys; records are tallied A / B / C (shadowReplay.generated.test.js).
import { vi, describe, it, expect, afterEach, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { corpus, phrasingsOf } from '../qa/capabilityRegression/testing/corpus'
import { replay } from '../qa/capabilityRegression/testing/run'
import { CLOCK, pinClock } from '../qa/capabilityRegression/testing/clock'
import clockExpectations from '../qa/capabilityRegression/baseline/clockExpectations.json'

pinClock()
const REPLAY = !!globalThis.process?.env?.RESOLVER_REPLAY
const calls = { n: 0 }
vi.mock('./shadow', async (orig) => {
  const real = await orig()
  return { ...real, shadowRemoval: (...a) => { calls.n++; if (!globalThis.__RESOLVER_REPLAY__) throw new Error('shadow boom'); return real.shadowRemoval(...a) } }
})
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const DESTROY = /\.(?:remove|delete|clear|closeTab|deleteSaved|deleteTemplate|deleteBoard)$/
const destructive = corpus.intents.filter(i => (i.model?.ops || []).some(o => DESTROY.test(o.action)) && i.kinds !== 'ALL')
const run = (intent, ph) => {
  const byClock = clockExpectations.intents[intent.id]?.[CLOCK]?.expect
  return replay({ board: intent.board, seed: intent.seed, kinds: intent.kinds, steps: [...(intent.before || []), ...(ph.prelude || []).map(say => ({ say })),
    { say: ph.text, model: intent.model, expect: byClock || intent.expect, approve: byClock ? undefined : intent.approve, afterApprove: byClock ? undefined : intent.afterApprove }] }, `${intent.id} "${ph.text}" @${CLOCK}`)
}

describe.skipIf(REPLAY)('SWALLOW · a throwing shadow hook changes no outcome (destructive capreg intents, first phrasing each)', () => {
  it('there are destructive intents to run', () => expect(destructive.length).toBeGreaterThanOrEqual(10))
  for (const intent of destructive) {
    const ph = phrasingsOf(intent).find(p => !p.gaps?.c)
    if (!ph) continue
    it(`${intent.id} · "${ph.text}"`, async () => {
      const before = calls.n
      await run(intent, ph)
      // (a proposal-only capability may never reach railOf with a destroy: the hook ran wherever the rails did)
      expect(calls.n).toBeGreaterThanOrEqual(before)
    }, 40000)
  }
  it('the throwing hook was reached by the rails', () => expect(calls.n).toBeGreaterThan(0))
})

const recs = []
describe.runIf(REPLAY)('OFFLINE REPLAY · capreg destructive intents, every phrasing, through the real shadow hook', async () => {
  const { setShadowSink } = await import('./shadow')
  globalThis.__RESOLVER_REPLAY__ = true
  for (const intent of destructive) {
    for (const ph of phrasingsOf(intent)) {
      it(`${intent.id} · "${ph.text}"`, async () => {
        const was = setShadowSink((r) => recs.push({ intent: intent.id, words: ph.text, ...r }))
        try { await run(intent, ph).catch(() => {}) } finally { setShadowSink(was) }
      }, 40000)
    }
  }
})
afterAll(async () => {
  if (!REPLAY) return
  const by = (c) => recs.filter(r => r.cls === c)
  const line = (r) => `  ${r.intent} "${r.words}" · rails ${r.rail} · resolver ${r.verdict} (${r.reason}) · ${r.types.join('+')}`
  const report = [`CAPREG SHADOW REPLAY: records ${recs.length} · agree ${recs.filter(r => r.agree).length} · A ${by('A').length} · B ${by('B').length} · C ${by('C').length}`,
    'A:', ...by('A').map(line), 'B:', ...by('B').map(line), 'C:', ...by('C').map(line)].join('\n')
  console.log(report)
  if (globalThis.process?.env?.RESOLVER_REPLAY_OUT) { const fs = await import('node:fs'); fs.writeFileSync(globalThis.process?.env?.RESOLVER_REPLAY_OUT, JSON.stringify(recs, null, 1)) }
})
