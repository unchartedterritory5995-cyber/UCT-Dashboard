// CAPABILITY REGRESSION · corpus level (b) DETERMINISTIC — what the no-model layers (multiChart → fast path →
// compound, useAgent's order) make of each phrasing. A claimed reading must be EQUIVALENT to the intent's canonical
// plan (a wrong deterministic reading runs with no model to catch it); `det: "required"` phrasings must be claimed.
// An unclaimed optional phrasing is the model's (levels a and c cover it).
import { describe, expect } from 'vitest'
import { registerCatalog, isDark } from './testing/registry'
import { corpus, phrasingsOf, gapIt, deterministicReading, equivalent } from './testing/corpus'
import { panelHost } from './testing/harness'
import { pinClock } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

await registerCatalog()

// (a DARK intent — `"kinds": "ALL"` — runs in corpus.dark.test.jsx, with every gated kind on)
for (const intent of corpus.intents.filter(i => !isDark(i))) {
  describe(`(b) deterministic · ${intent.id}`, () => {
    for (const ph of phrasingsOf(intent)) {
      if (ph.prelude) continue                       // a reading that depends on the conversation is the model's
      const { run, tag } = gapIt(ph.gaps?.b)
      run(`"${ph.text}"${ph.det === 'required' ? ' (required)' : ''}${tag}`, () => {
        const host = panelHost(intent.board)
        const r = deterministicReading(ph.text, host)
        if (ph.det === 'required') expect(r, `"${ph.text}" must be read without the model`).not.toBeNull()
        if (r && intent.deterministic) expect(equivalent(r, intent.deterministic), `"${ph.text}" read as ${JSON.stringify(r)}`).toBe(true)
        if (r && !intent.deterministic) expect(r.say || r.plan?.length === 0 || r.kind, `"${ph.text}" claimed by ${r.via} for an intent with no deterministic plan: ${JSON.stringify(r)}`).toBeFalsy()
      })
    }
  })
}
