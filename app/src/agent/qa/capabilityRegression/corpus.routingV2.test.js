// CAPABILITY REGRESSION · corpus level (a) ROUTING with NLM-1 ROUTING V2 ON (UCT_AGENT_ROUTING_V2, dark): every owner
// phrasing still carries every action its intent needs, no needed group is cut by the per-request budget, the request
// never exceeds that budget, and v2 never loses a group v1 selected for the message (the regexes are v2's boost layer).
import { describe, expect } from 'vitest'
import { registerCatalog, isDark } from './testing/registry'
import { corpus, phrasingsOf, gapIt } from './testing/corpus'
import { routedNames } from './testing/route'
import { groupOfAction } from '../../routing'
import { MANIFEST_CONTRACT } from '../../capabilities'
import { panelHost } from './testing/harness'
import { pinClock } from './testing/clock'

pinClock()

await registerCatalog()

// (a DARK intent — `"kinds": "ALL"` — runs in corpus.dark.test.jsx, with every gated kind on; same split as corpus.routing.test.js)
for (const intent of corpus.intents.filter(i => !isDark(i))) {
  describe(`(a·v2) routing · ${intent.id}`, () => {
    for (const ph of phrasingsOf(intent)) {
      const { run, tag } = gapIt(ph.gaps?.a)
      run(`"${ph.text}" routes ${intent.needs.join(' + ')} (v2)${tag}`, () => {
        const host = panelHost(intent.board)
        const ctx = { host, recentActions: intent.recentActions || [] }
        const v1 = routedNames(ph.text, ctx)
        const { names, overBudget } = routedNames(ph.text, { ...ctx, v2: true })
        for (const a of intent.needs) expect(names, `"${ph.text}" → ${a}`).toContain(a)
        for (const a of intent.needs) expect(overBudget, `"${ph.text}": ${a}'s group was cut by the budget`).not.toContain(groupOfAction(a))
        expect(names.length, `"${ph.text}" over the per-request budget`).toBeLessThanOrEqual(MANIFEST_CONTRACT.routingThreshold)
        // no intent loses its owning group: every group v1 SELECTED by the message's own words is still sent
        const lost = [...new Set(v1.names.map(groupOfAction))].filter(g => g && !names.some(n => groupOfAction(n) === g) && intent.needs.some(a => groupOfAction(a) === g))
        expect(lost, `"${ph.text}" lost an owning group v1 sent`).toEqual([])
      })
    }
  })
}
