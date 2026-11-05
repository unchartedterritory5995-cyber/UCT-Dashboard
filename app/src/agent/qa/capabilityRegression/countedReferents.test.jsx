// CAPABILITY REGRESSION · COUNTED REFERENTS (owner, 11-05): a phrase that states how many charts it means is held to that
// number. "Do the same for the other two" on a four-chart board once changed all three others with no question and no
// model. A count that does not match the board changes NOTHING and says so, without a model call; a count that matches
// still works. Runs under capreg's default (NLM-1 ON) and under CAPREG_NLM1=off (the kill-switch path).
import { describe, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from './testing/registry'
import { replay } from './testing/run'
import { pinClock } from './testing/clock'

pinClock()
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// the panel names the charts, so the member can just answer (#807's form)
// (`says` entries are regular expressions: the literal parentheses are escaped — '\(' in a JS string is just '(')
const NOTHING = { unchanged: true, modelTurns: 0, says: ['here \\(the .* charts?\\), not [23]', 'Say which', 'Nothing has changed'] }
const MISMATCH = [
  ['M1.owner-sentence', 'FOUR', 'add rsi to the top right chart', 'Actually, do the same for the other two.'],
  ['M2.same-for', 'FOUR', 'add rsi to the top right chart', 'same for the other two'],
  ['M3.digit', 'FOUR', 'make the top left chart weekly', 'do the same on the other 2 charts'],
  ['M4.number-first', 'FOUR', 'make the top left chart weekly', 'do the same on the two other charts'],
  ['M5.too-many', 'TWO', 'make the left chart weekly', 'do the same for the other three'],
  ['M6.all-count', 'FOUR', 'make the top left chart weekly', 'do the same on all three'],
  ['M7.copy', 'FOUR', 'add rsi to the top right chart', 'put that on the other two'],
].map(([id, board, first, then]) => ({ id, board, steps: [{ say: first }, { say: then, expect: NOTHING }] }))

const MATCH = [
  { id: 'K1.other-three-on-four', board: 'FOUR', steps: [
    { say: 'add rsi to the top right chart' },
    { say: 'do the same for the other three', expect: { modelTurns: 0, bySymbol: { SPY: { has: ['rsi'] }, NVDA: { has: ['rsi'] }, TSLA: { has: ['rsi'] }, QQQ: { has: ['rsi'] } } } }] },
  { id: 'K2.others-uncounted', board: 'FOUR', steps: [
    { say: 'add rsi to the top right chart' },
    { say: 'do the same for the others', expect: { modelTurns: 0, bySymbol: { SPY: { has: ['rsi'] }, NVDA: { has: ['rsi'] }, TSLA: { has: ['rsi'] } } } }] },
]

describe('a stated chart count is part of the target', () => {
  for (const c of [...MISMATCH, ...MATCH]) it(c.id, async () => { await replay(c, c.id) }, 60000)
})
