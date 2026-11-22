// CAPABILITY REGRESSION · SINGULAR REFERENTS (#806 review, 11-04): a phrase that names ONE chart ("the other one", "one",
// "it") never acts on several. On 2- and 4-chart boards, the reviewer's probes: after a change to one chart (or two),
// a follow-up whose words name a single chart that the board does not single out changes NOTHING by itself — the model
// is asked (it asks which chart), exactly as the panel does without NLM-1 — and one that does single it out changes that
// chart only. Runs under capreg's default (NLM-1 ON, as production) and under CAPREG_NLM1=off (the kill-switch path).
import { describe, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from './testing/registry'
import { replay } from './testing/run'
import { pinClock } from './testing/clock'
import { nlm1Of } from './testing/harness'

pinClock()
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// the follow-up names ONE chart, the board has several candidates: NOTHING changes — the panel asks which chart (v1's own
// question since #807) or the model is asked; never a write to several charts
const NO_WRITE = { unchanged: true }
const CASES = [
  // the reviewer's probes (wrong-target writes before the fix)
  ['S1.four.other-one-after-one', 'FOUR', ['make the top right chart weekly', 'and the other one']],
  ['S2.four.other-one-monthly', 'FOUR', ['make the top left chart weekly', 'the other one monthly']],
  ['S3.two.put-one-back-after-both', 'TWO', ['make both charts weekly', 'put one back to daily']],
  ['S4.four.put-one-back-after-top-two', 'FOUR', ['make the top two charts weekly', 'put one back to daily']],
  ['S5.four.same-for-the-other-one', 'FOUR', ['add rsi to the top left chart', 'same for the other one']],
  ['S6.four.put-it-on-one-more', 'FOUR', ['add rsi to the top left chart', 'put it on one more']],
  ['S7.two.set-one-to-monthly', 'TWO', ['make both charts weekly', 'set one to monthly']],
  ['S8.four.and-one-on-the-bottom', 'FOUR', ['add rsi to the top left chart', 'and one on the bottom']],
].map(([id, board, [first, then]]) => ({ id, board, steps: [{ say: first }, { say: then, expect: NO_WRITE }] }))

// controls: a singular phrase the board DOES single out still works, on that chart only
CASES.push(
  { id: 'C1.two.same-for-the-other-one', board: 'TWO', steps: [
    { say: 'add the 21 ema to the left chart' },
    { say: 'same for the other one', expect: { bySymbol: { AMD: { ma: [21] }, NVDA: { ma: [21] } }, modelTurns: 0 } }] },
  // (an NLM-1 reading: with the kill switch off the panel asks the model, as v1 always has)
  ...(nlm1Of() ? [{ id: 'C2.two.put-the-right-one-back', board: 'TWO', steps: [
    { say: 'make both charts weekly' },
    { say: 'put the right one back to daily', expect: { bySymbol: { NVDA: { tf: 'W' }, AMD: { tf: 'D' } }, modelTurns: 0 } }] }] : []),
)

describe('singular referents never act on several charts', () => {
  for (const c of CASES) it(c.id, async () => { await replay(c, c.id) }, 60000)
})
