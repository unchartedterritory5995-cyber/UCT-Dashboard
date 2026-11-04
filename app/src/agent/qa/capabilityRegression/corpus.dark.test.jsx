// CAPABILITY REGRESSION · the DARK corpus (baseline/corpus.dark.json) — Track D trading workflows (UCT_AGENT_WORKFLOWS,
// default off). The three corpus levels, exactly as for the main corpus, but under the WHOLE catalog (ALL_KINDS: every
// gated kind and every workflow switched on), since these capabilities do not register under production's config:
//   (a) routing — the routed request carries every needed action, its group named by the message's own words;
//   (b) deterministic — a claimed reading equals the canonical plan; `det: "required"` phrasings must be claimed;
//   (c) final state — the REAL panel with the faithful scripted model: the canonical reads ran, nothing else changed.
import { describe, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog, ALL_KINDS } from './testing/registry'
import { darkCorpus, phrasingsOf, gapIt, deterministicReading, equivalent } from './testing/corpus'
import { routedNames } from './testing/route'
import { wordsSelect, groupOfAction } from '../../routing'
import { panelHost } from './testing/harness'
import { replay } from './testing/run'
import { pinClock, CLOCK } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog(ALL_KINDS)
afterEach(() => { vi.restoreAllMocks(); cleanup() })

for (const intent of darkCorpus.intents) {
  describe(`dark · ${intent.id}`, () => {
    for (const ph of phrasingsOf(intent)) {
      const a = gapIt(ph.gaps?.a)
      a.run(`(a) "${ph.text}" routes ${intent.needs.join(' + ')}${a.tag}`, () => {
        const { names, overBudget } = routedNames(ph.text, { host: panelHost(intent.board), recentActions: intent.recentActions || [] })
        for (const n of intent.needs) expect(names, `"${ph.text}" → ${n}`).toContain(n)
        for (const n of intent.needs) expect(overBudget, `"${ph.text}": ${n}'s group was cut by the budget`).not.toContain(groupOfAction(n))
        for (const g of intent.ownWords || []) expect(wordsSelect(g, ph.text), `"${ph.text}" names the ${g} group by its own words`).toBe(true)
      })
      if (!ph.prelude) {
        const b = gapIt(ph.gaps?.b)
        b.run(`(b) "${ph.text}"${ph.det === 'required' ? ' (required)' : ''}${b.tag}`, () => {
          const r = deterministicReading(ph.text, panelHost(intent.board))
          if (ph.det === 'required') expect(r, `"${ph.text}" must be read without the model`).not.toBeNull()
          if (r && intent.deterministic) expect(equivalent(r, intent.deterministic), `"${ph.text}" read as ${JSON.stringify(r)}`).toBe(true)
          if (r && !intent.deterministic) expect(r.say || r.plan?.length === 0 || r.kind, `"${ph.text}" claimed by ${r.via}: ${JSON.stringify(r)}`).toBeFalsy()
        })
      }
      const c = gapIt(ph.gaps?.c)
      c.run(`(c) "${ph.text}"${c.tag}`, async () => {
        await replay({ board: intent.board, seed: intent.seed, kinds: ALL_KINDS, steps: [...(intent.before || []), ...(ph.prelude || []).map(say => ({ say })),
          { say: ph.text, model: intent.model, expect: intent.expect, approve: intent.approve, afterApprove: intent.afterApprove }] }, `${intent.id} "${ph.text}" @${CLOCK}`)
      }, 40000)
    }
  })
}
