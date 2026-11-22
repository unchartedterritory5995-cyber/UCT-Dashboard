// CAPABILITY REGRESSION · the DARK corpus (PKG2) — intents, golden workflows and refusal cases marked `"kinds": "ALL"`:
// their capability rides on a data kind production does not list yet (history.eventStudy → history.afterEvent, the
// index / commodity / crypto quote kinds). They run here at all three levels — (a) routing, (b) deterministic,
// (c) final state through the real panel — with EVERY gated kind on, exactly as the other suites run the production
// ones, so the behaviour an owner gets on enabling the kind is pinned before the flip. No model, no market value.
import { describe, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog, ALL_KINDS, isDark } from './testing/registry'
import { corpus, golden, phrasingsOf, gapIt, deterministicReading, equivalent } from './testing/corpus'
import { routedNames } from './testing/route'
import { wordsSelect, groupOfAction } from '../../routing'
import { panelHost } from './testing/harness'
import { replay } from './testing/run'
import { finalStateSuite } from './testing/finalState'
import { pinClock } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog(ALL_KINDS)
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const dark = corpus.intents.filter(isDark)

describe('dark corpus: every dark entry names a data kind production does not serve yet', () => {
  for (const e of [...dark, ...golden.workflows.filter(isDark), ...corpus.refusals.filter(isDark)]) {
    const run = gapIt(null).run
    run(`${e.id} is dark`, () => { expect(e.kinds).toBe('ALL') })
  }
})

for (const intent of dark) {
  describe(`(a) routing · ${intent.id} [dark]`, () => {
    for (const ph of phrasingsOf(intent)) {
      const { run, tag } = gapIt(ph.gaps?.a)
      run(`"${ph.text}" routes ${intent.needs.join(' + ')}${tag}`, () => {
        const host = panelHost(intent.board)
        const { names, overBudget } = routedNames(ph.text, { host, recentActions: intent.recentActions || [] })
        for (const a of intent.needs) expect(names, `"${ph.text}" → ${a}`).toContain(a)
        for (const a of intent.needs) expect(overBudget, `"${ph.text}": ${a}'s group was cut by the budget`).not.toContain(groupOfAction(a))
        for (const g of intent.ownWords || []) expect(wordsSelect(g, ph.text), `"${ph.text}" names the ${g} group by its own words`).toBe(true)
      })
    }
  })
  describe(`(b) deterministic · ${intent.id} [dark]`, () => {
    for (const ph of phrasingsOf(intent)) {
      if (ph.prelude) continue
      const { run, tag } = gapIt(ph.gaps?.b)
      run(`"${ph.text}"${ph.det === 'required' ? ' (required)' : ''}${tag}`, () => {
        const r = deterministicReading(ph.text, panelHost(intent.board))
        if (ph.det === 'required') expect(r, `"${ph.text}" must be read without the model`).not.toBeNull()
        if (r && intent.deterministic) expect(equivalent(r, intent.deterministic), `"${ph.text}" read as ${JSON.stringify(r)}`).toBe(true)
        if (r && !intent.deterministic) expect(r.say || r.plan?.length === 0 || r.kind, `"${ph.text}" claimed by ${r.via} for an intent with no deterministic plan: ${JSON.stringify(r)}`).toBeFalsy()
      })
    }
  })
}

finalStateSuite(0, { dark: true })

describe('golden workflows [dark]', () => {
  for (const w of golden.workflows.filter(isDark)) {
    const { run, tag } = gapIt(w.gap)
    run(`${w.id} (${w.source})${tag}`, async () => { await replay(w, w.id) }, 60000)
  }
})
describe('refusals (the corpus) [dark]', () => {
  for (const r of corpus.refusals.filter(isDark)) {
    const { run, tag } = gapIt(r.gap)
    run(`${r.id}${tag}`, async () => { await replay(r, r.id) }, 40000)
  }
})
