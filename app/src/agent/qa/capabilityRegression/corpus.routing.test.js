// CAPABILITY REGRESSION · corpus level (a) ROUTING — for every owner-style phrasing, the PRODUCTION routed request
// (testing/route.js: the same call useAgent makes) carries every action the intent needs. A capability the model is
// never shown cannot be used, however good the model is (live LT-4, the 11-03 four-charts regression).
import { describe, expect } from 'vitest'
import { registerCatalog, isDark } from './testing/registry'
import { corpus, phrasingsOf, gapIt } from './testing/corpus'
import { routedNames } from './testing/route'
import { wordsSelect, groupOfAction } from '../../routing'
import { panelHost } from './testing/harness'
import { pinClock } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

await registerCatalog()

// (a DARK intent — `"kinds": "ALL"` — runs in corpus.dark.test.jsx, with every gated kind on)
for (const intent of corpus.intents.filter(i => !isDark(i))) {
  describe(`(a) routing · ${intent.id}`, () => {
    for (const ph of phrasingsOf(intent)) {
      const { run, tag } = gapIt(ph.gaps?.a)
      run(`"${ph.text}" routes ${intent.needs.join(' + ')}${tag}`, () => {
        const host = panelHost(intent.board)
        const { names, overBudget } = routedNames(ph.text, { host, recentActions: intent.recentActions || [] })
        for (const a of intent.needs) expect(names, `"${ph.text}" → ${a}`).toContain(a)
        // catalog truncation: a group the message needs is never the one the per-request budget cut
        for (const a of intent.needs) expect(overBudget, `"${ph.text}": ${a}'s group was cut by the budget`).not.toContain(groupOfAction(a))
        // `ownWords`: the group must be selected by the message's OWN words — reaching it only through the
        // unrecognised-message budget fill is luck (the fill order changes with every catalog change)
        for (const g of intent.ownWords || []) expect(wordsSelect(g, ph.text), `"${ph.text}" names the ${g} group by its own words`).toBe(true)
      })
    }
  })
}
