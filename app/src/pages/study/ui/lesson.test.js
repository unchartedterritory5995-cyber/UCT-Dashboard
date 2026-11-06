import { describe, expect, it } from 'vitest'
import { firstSentence, splitLesson } from './lesson'

// Real bank lessons (docs/study/bank/spot.setups.json, 2026-11-05), shortened only where marked.
const HVE = 'High Volume Edge: an up day on a volume that DWARFS everything before it, ten times normal and above the prior record, often on a lesser-known name, the start of a new story; an earnings day counts when the volume is truly massive. That day\'s close is a LEVEL to mark on the chart, the price the biggest participants committed at; price may trade under it later. It is not an HVC (any high-volume close) and not a PEG (an earnings gap on big but ordinary volume); OPEX and month-end sessions do not count (owner rulings 2026-10-23/25). Here the stock closed up 18.23% on the heaviest volume of the lookback.'
const OOPS = 'Oops Reversal (scanner version): opens below the prior close, trades under the prior day\'s low, then reverses and closes above the prior close. A Williams Oops opens below the prior LOW and rallies back above it. LOCATION is the main thing (owner rulings 2026-10-23/24). Here it opened 0.48% from the prior low and closed up 11.57%: a Super Oops'

describe('splitLesson: the chart\'s own sentence leads, the rule follows, the stamps come out', () => {
  it('splits a setups lesson into the setup, the rule and the "Here" sentence', () => {
    const L = splitLesson(HVE)
    expect(L.setup).toBe('High Volume Edge')
    expect(L.here).toBe('Here the stock closed up 18.23% on the heaviest volume of the lookback.')
    expect(L.ruleLead).toBe('An up day on a volume that DWARFS everything before it, ten times normal and above the prior record, often on a lesser-known name, the start of a new story; an earnings day counts when the volume is truly massive.')
    expect(L.ruleRest.startsWith('That day\'s close is a LEVEL')).toBe(true)
    expect(L.rule).not.toMatch(/owner rulings/)
    expect(L.citations).toEqual(['owner rulings 2026-10-23/25'])
  })
  it('keeps a parenthesised setup name, reads the LAST "Here" and closes an open sentence', () => {
    const L = splitLesson(OOPS)
    expect(L.setup).toBe('Oops Reversal (scanner version)')
    expect(L.here).toBe('Here it opened 0.48% from the prior low and closed up 11.57%: a Super Oops.')
    expect(L.ruleLead).toBe('Opens below the prior close, trades under the prior day\'s low, then reverses and closes above the prior close.')
    expect(L.rule.endsWith('LOCATION is the main thing.')).toBe(true)
  })
  it('a lesson with no "Here" sentence is all rule, and an empty lesson is empty', () => {
    const L = splitLesson('Kicker: the day before closes red and weak. Then it gaps up.')
    expect(L.here).toBe('')
    expect(L.ruleLead).toBe('The day before closes red and weak.')
    expect(L.ruleRest).toBe('Then it gaps up.')
    expect(splitLesson('')).toEqual({ setup: '', rule: '', ruleLead: '', ruleRest: '', here: '', citations: [] })
  })
  it('never rewrites a word: the halves re-join to the stamped-free original', () => {
    const L = splitLesson(HVE)
    const original = HVE.replace(/\s*\(owner rulings[^)]*\)/g, '')
    expect(`${L.setup}: ${L.rule.charAt(0).toLowerCase()}${L.rule.slice(1)} ${L.here}`).toBe(original)
  })
})

describe('firstSentence', () => {
  it('ends at a stop followed by a capital, never inside a number', () => {
    expect(firstSentence('It opened 0.48% lower. Then it ran.')).toEqual(['It opened 0.48% lower.', 'Then it ran.'])
    expect(firstSentence('One sentence only')).toEqual(['One sentence only', ''])
  })
})
