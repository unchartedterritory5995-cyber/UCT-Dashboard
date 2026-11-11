// CAPABILITY REGRESSION · corpus level (c) FINAL STATE — every phrasing through the REAL panel, with the faithful
// scripted model (testing/harness.jsx) answering the intent's canonical plan only with the actions it was sent. Asserted:
// the final board / indicators / canonical reads and writes / receipt, proposal and refusal STRUCTURE. Never prose.
// The intents are dealt round-robin into SLICES (corpus.finalState.<k>.test.jsx) so the Agent CI shards share them.
import { describe, it } from 'vitest'
import { corpus, phrasingsOf, gapIt } from './corpus'
import { replay } from './run'
import { CLOCK } from './clock'
import { isDark } from './registry'
import clockExpectations from '../baseline/clockExpectations.json'

export const SLICES = 4
export function finalStateSuite(slice, { dark = false } = {}) {
  corpus.intents.forEach((intent, i) => {
    if (isDark(intent) !== dark) return                // a dark entry runs only in corpus.dark.test.jsx (every gated kind on)
    if (!dark && i % SLICES !== slice) return
    describe(`(c) final state · ${intent.id}`, () => {
      for (const ph of phrasingsOf(intent)) {
        const { run, tag } = gapIt(ph.gaps?.c)
        run(`"${ph.text}"${tag}`, async () => {
          // baseline/clockExpectations.json: the product legitimately answers differently at this pinned instant (testing/clock.js)
          const byClock = clockExpectations.intents[intent.id]?.[CLOCK]?.expect
          await replay({ board: intent.board, seed: intent.seed, kinds: intent.kinds, steps: [...(intent.before || []), ...(ph.prelude || []).map(say => ({ say })),
            { say: ph.text, model: intent.model, expect: byClock || intent.expect, approve: byClock ? undefined : intent.approve, afterApprove: byClock ? undefined : intent.afterApprove }] }, `${intent.id} "${ph.text}" @${CLOCK}`)
        }, 40000)
      }
      if (intent.undo && !clockExpectations.intents[intent.id]?.[CLOCK]) {      // nothing to undo where this instant refuses the change
        const first = phrasingsOf(intent).find(ph => !ph.gaps?.c) || phrasingsOf(intent)[0]      // the undo runs on a phrasing that works
        it(`undo: "${first.text}" then "${intent.undo.say}" puts it back`, async () => {
          await replay({ board: intent.board, seed: intent.seed, kinds: intent.kinds, steps: [...(intent.before || []), { say: first.text, model: intent.model, expect: intent.expect }, intent.undo] }, `${intent.id} undo`)
        }, 40000)
      }
    })
  })
}
