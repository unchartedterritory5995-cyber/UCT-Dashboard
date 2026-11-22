import { describe, expect, it } from 'vitest'
import { clausesOf, firstSentence, sentencesOf, splitLesson, stepsOf } from './lesson'

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
    expect(splitLesson('')).toEqual({ setup: '', rule: '', ruleLead: '', ruleRest: '', here: '', nothing: false, template: false, reason: '', citations: [] })
  })
  it('never rewrites a word: the halves re-join to the stamped-free original', () => {
    const L = splitLesson(HVE)
    const original = HVE.replace(/\s*\(owner rulings[^)]*\)/g, '')
    expect(`${L.setup}: ${L.rule.charAt(0).toLowerCase()}${L.rule.slice(1)} ${L.here}`).toBe(original)
  })
})

describe('the brand and the near-miss (batch 19: "dont say THE FIRM")', () => {
  it('reads "the firm" through the brand words and turns a near-miss fixture into a reason', () => {
    const L = splitLesson("Gap Support: the firm's detector does not fire on the last bar of this chart. an unfilled volume gap and a pullback, but the low never reached the gap")
    expect(L.nothing).toBe(true)
    expect(L.setup).toBe('Gap Support')
    expect(L.reason).toBe('An unfilled volume gap and a pullback, but the low never reached the gap.')
    expect(L.here).toBe('')
    expect(JSON.stringify(L)).not.toMatch(/the firm/i)
  })
  it('a setups lesson is not a near-miss, and never says the firm either', () => {
    const L = splitLesson("Kicker: the firm's Kicker needs a red day first. Here the stock gapped up 3% after a red day.")
    expect(L.nothing).toBe(false)
    expect(L.ruleLead).toBe("UCT's Kicker needs a red day first.")
    expect(L.here).toBe('Here the stock gapped up 3% after a red day.')
  })
})

describe('clausesOf: a chained sentence reads as steps', () => {
  it('splits on the semicolons the bank wrote, capitalises each step and closes it', () => {
    expect(clausesOf('Here the drive was a gap of 5.9%; the pullback ran 6 sessions; the trigger day closed up 4.32%.')).toEqual([
      'Here the drive was a gap of 5.9%.', 'The pullback ran 6 sessions.', 'The trigger day closed up 4.32%.'])
    expect(clausesOf('Here the stock closed up 18.23% on the heaviest volume.')).toEqual(['Here the stock closed up 18.23% on the heaviest volume.'])
    expect(clausesOf('')).toEqual([])
  })
})

describe('firstSentence', () => {
  it('ends at a stop followed by a capital, never inside a number', () => {
    expect(firstSentence('It opened 0.48% lower. Then it ran.')).toEqual(['It opened 0.48% lower.', 'Then it ran.'])
    expect(firstSentence('One sentence only')).toEqual(['One sentence only', ''])
  })
})

describe('round 21: the rule as steps, the fixture templates, the review notes', () => {
  it('cuts the rule at the semicolons the bank wrote, and at the commas of a sentence that walks through a session', () => {
    expect(stepsOf(splitLesson(OOPS).ruleLead)).toEqual([
      'Opens below the prior close.', "Trades under the prior day's low.", 'Then reverses and closes above the prior close.'])
    const sling = 'A drive first, usually an earnings gapper, sometimes a strong rally; THEN a tight orderly pullback of three to seven sessions; THEN the trigger, the first close back above that average.'
    expect(stepsOf(sling)).toEqual([
      'A drive first, usually an earnings gapper, sometimes a strong rally.', 'Then a tight orderly pullback of three to seven sessions.',
      'Then the trigger, the first close back above that average.'])
    expect(stepsOf('One plain sentence, with a comma in it')).toEqual(['One plain sentence, with a comma in it.'])
    expect(stepsOf('')).toEqual([])
  })
  it('reads a fixture positive as a template with no rule, and lifts the review notes out of a near-miss reason', () => {
    const pos = splitLesson("Oops Reversal: the firm's detector fires on the last bar of this chart. real daily bars; the detector's rule holds on the last session")
    expect(pos).toMatchObject({ setup: 'Oops Reversal', template: true, nothing: false, rule: '', here: '' })
    const neg = splitLesson("Oops Reversal: the firm's detector does not fire on the last bar of this chart. open below prior close and close above it, but no undercut of the prior low (dropped by the blind review)")
    expect(neg.reason).toBe('Open below prior close and close above it, but no undercut of the prior low.')
    expect(neg.citations).toEqual(['dropped by the blind review'])
  })
})

describe('sentencesOf: the chart line, a sentence a line', () => {
  it('cuts at sentence stops, never inside a number, and keeps semicolon clauses apart', () => {
    const here = "Here it opened -1.64% from the prior low and closed up 2.73%: also a Williams Oops. The setup was already there: the stock was above its 200-day; the dip tested the 21-day."
    expect(sentencesOf(here)).toEqual([
      'Here it opened -1.64% from the prior low and closed up 2.73%: also a Williams Oops.',
      'The setup was already there: the stock was above its 200-day.', 'The dip tested the 21-day.'])
    expect(sentencesOf('')).toEqual([])
  })
})
