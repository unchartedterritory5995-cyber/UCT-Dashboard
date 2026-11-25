// W3 guard-recall (2026-11-04): the browser mirror of the structural advice / critical-risk rules. Every case of the
// DEVELOPMENT set (coachGuardDev.json) must get exactly the codes the server guard gives it (coachGuardDevParity.json,
// written by scripts/agent/measure_coach_guard_dev.py --write-parity and checked current by the server suite), in both
// modes — so guard.py and guard.js agree case by case, not only on aggregate rates.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, advice, critical } from './coach/guard'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, '__fixtures__', f), 'utf8'))
const DEV = read('coachGuardDev.json')
const PARITY = read('coachGuardDevParity.json')
const MODES = { noInputs: () => null, selfInputs: (t) => [t] }

describe('coach guard recall (browser mirror) — parity with the server on the development set', () => {
  for (const [mode, inputs] of Object.entries(MODES)) {
    it(`${mode}: every case gets the server's codes`, () => {
      const diffs = DEV.cases.filter(c => JSON.stringify(check(c.text, inputs(c.text))) !== JSON.stringify(PARITY[mode][c.id]))
      expect(diffs.map(c => c.id)).toEqual([])
    })
  }
  it('the snapshot covers every case', () => {
    expect(Object.keys(PARITY.noInputs).sort()).toEqual(DEV.cases.map(c => c.id).sort())
  })
})

describe('coach guard recall (browser mirror) — the structural rules', () => {
  it('advice by structure; refusals, quoted mentions and open questions are not advice', () => {
    expect(advice('Buy NVDA here.')).toContain('imperative')
    expect(advice('Promoters inflate a price, then sell to late buyers.')).toEqual([])
    expect(advice('You might want to trim some here.')).toContain('second_person')
    expect(advice("I can't tell you whether to sell; here is what traders look at.")).toEqual([])
    expect(advice("'Buy the dip' is a popular phrase.")).toEqual([])
    expect(advice('Is it smart to use margin? It magnifies losses.')).toEqual([])
    expect(advice('Покупай сейчас')).toContain('unverified-script')
  })
  it('critical risk: a topic needs a directive; a protective negation is not one', () => {
    expect(critical('Use margin to double your position.')).toEqual(['critical-directive'])
    expect(critical('Margin amplifies losses as well as gains.')).toEqual([])
    expect(critical("Please don't go all in.")).toEqual([])
    expect(critical("Don't report the gains to the IRS.")).toContain('critical-directive')
  })
})
