// screenRelevant (owner: agent-sc) decides whether the planner sees the Screener catalog WITH labels and units or as
// bare keys. A false negative leaves the model guessing what a key means ("dist_20d_high_pct" with no unit), so every
// answerable discovery-corpus question must read as screen-relevant. SAT-1 §B capture (F-SB-1 follow-up): d04, d14,
// d19 and d21 did not before this change.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { screenRelevant } from './capabilities/screener'

const REPO = path.resolve(__dirname, '../../..')
const CORPUS = JSON.parse(fs.readFileSync(path.join(REPO, 'api/services/uct_agent/scan/eval/discovery.json'), 'utf8'))

describe('screenRelevant: the full Screener catalog for screening language', () => {
  it.each(['d04', 'd14', 'd19', 'd21'])('%s, keys-only before, now reads as screening', (id) => {
    const q = CORPUS.questions.find(x => x.id === id)
    expect(screenRelevant(q.question)).toBe(true)
  })

  it('every corpus question reads as screening', () => {
    expect(CORPUS.questions.filter(q => !screenRelevant(q.question)).map(q => q.id)).toEqual([])
  })

  it('CONTROL: plain chat still gets the keys only', () => {
    for (const m of ['hello', 'what do you think about the market today', 'explain this chart', 'thanks!', 'what is an EMA?', 'make the left chart weekly']) {
      expect(screenRelevant(m)).toBe(false)
    }
  })
})
