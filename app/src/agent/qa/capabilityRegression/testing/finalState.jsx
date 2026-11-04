// CAPABILITY REGRESSION · corpus level (c) FINAL STATE — every phrasing through the REAL panel, with the faithful
// scripted model (testing/harness.jsx) answering the intent's canonical plan only with the actions it was sent. Asserted:
// the final board / indicators / canonical reads and writes / receipt, proposal and refusal STRUCTURE. Never prose.
// The intents are dealt round-robin into SLICES (corpus.finalState.<k>.test.jsx) so the Agent CI shards share them.
import { describe, it } from 'vitest'
import { corpus, phrasingsOf, gapIt } from './corpus'
import { replay } from './run'

export const SLICES = 4
export function finalStateSuite(slice) {
  corpus.intents.forEach((intent, i) => {
    if (i % SLICES !== slice) return
    describe(`(c) final state · ${intent.id}`, () => {
      for (const ph of phrasingsOf(intent)) {
        const { run, tag } = gapIt(ph.gaps?.c)
        run(`"${ph.text}"${tag}`, async () => {
          await replay({ board: intent.board, steps: [...(intent.before || []), ...(ph.prelude || []).map(say => ({ say })),
            { say: ph.text, model: intent.model, expect: intent.expect, approve: intent.approve, afterApprove: intent.afterApprove }] }, `${intent.id} "${ph.text}"`)
        }, 40000)
      }
      if (intent.undo) {
        const first = phrasingsOf(intent)[0]
        it(`undo: "${first.text}" then "${intent.undo.say}" puts it back`, async () => {
          await replay({ board: intent.board, steps: [...(intent.before || []), { say: first.text, model: intent.model, expect: intent.expect }, intent.undo] }, `${intent.id} undo`)
        }, 40000)
      }
    })
  })
}
