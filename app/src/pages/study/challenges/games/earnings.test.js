/**
 * Earnings Desk, the pure half (games/earnings.js): the draw shaped into reports (what this desk can play, what it must
 * skip), the masthead read off the front of the bank's own words, the run's order, the seeded tiles, what a member typed
 * and how a number reads, the server's verdict and reveal read into the desk note (why, the sentences that say what the
 * stock did, the working of a computed answer recomputed and shown only when it agrees with the server), the near-miss
 * notes for a typed number, the hearts, the log and the end's rank. The fixtures are F5.08's own items
 * (docs/study/courses/F5/F5.08.json) as scripts/study/courses_lib.build_items makes them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  EARNINGS_HEARTS, EARNINGS_KIND, EARNINGS_MIN, EARNINGS_SKILL, EARNINGS_TOTAL, EMPTY_LINE, FAILED_LINE, FORMULAS, NUMBER_HINT,
  SIGNED_OUT_LINE, TAKEOVER_STOCK_MAX, TF_CHOICES, addCase, answerFor, cardText, dealChoices, deckOf, decimalsOf, deskLine, evalExpr,
  exprText, headOf, heartsLeft, heartsLine, isReaction, kindWord, nearNote, numLabel, pickNote, rankOf, reasonOf, reportsOf, rightIndex,
  roundTo, rowOf, runOver, saidOf, sentencesIn, sessionBody, solvedOf, splitWhy, stockLine, teachOf, thinLine, tokensOf, truthOf,
  verdictOf, weakLine, weakestOf, workingOf, xpOf,
} from './earnings'

// F5.08's own questions, built the way courses_lib.build_items builds them (rung 1-3 → difficulty 1, 4-6 → 2, 7-9 → 3)
const Q01 = { id: 'ed_q01', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 1, has_chart: false,
  prompt_json: { q: 'Netflix, first quarter 2022: EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?', kind: 'mcq', choices: ['A beat', 'A miss', 'In line'] } }
const Q02 = { id: 'ed_q02', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 1, has_chart: false,
  prompt_json: { q: "Walmart, first quarter of fiscal 2023: adjusted EPS of $1.30 against $1.48 expected. That's a beat.", kind: 'tf', choices: ['True', 'False'] } }
const Q03 = { id: 'ed_q03', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 1, has_chart: false,
  prompt_json: { q: 'Tap the word that fits the blank.', kind: 'fill', sentence: 'Actual EPS minus the consensus, divided by the consensus, times 100, is the earnings ___ in percent.', bank: ['surprise', 'margin', 'guidance', 'growth', 'multiple'] } }
const Q07 = { id: 'ed_q07', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 1, has_chart: false,
  prompt_json: { q: "Nike's fiscal Q4 2024 release says results \"led us to update our Fiscal '25 outlook.\" No new numbers follow. Where do you find them?", kind: 'mcq',
    choices: ['On the earnings call', 'In the consensus estimate', 'In the after-hours price', "In the prior quarter's release"] } }
const Q09 = { id: 'ed_q09', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 2, has_chart: false,
  prompt_json: { q: 'Alphabet, first quarter 2024: EPS $1.89. The LSEG consensus was $1.51. What was the surprise, in percent?', kind: 'fill_numeric', suffix: '%' } }
const Q10 = { id: 'ed_q10', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 2, has_chart: false,
  prompt_json: { q: 'Netflix forecast 2.5 million new paid members for the first quarter of 2022. It lost 0.2 million. How many million short was it?', kind: 'fill_numeric', suffix: 'million' } }
const Q13 = { id: 'ed_q13', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 2, has_chart: false,
  prompt_json: { q: "Meta's Q4 2022 EPS was $1.76. Its release says that without restructuring charges, EPS would have been $1.24 higher. What EPS is that?", kind: 'fill_numeric', prefix: '$' } }
const Q14 = { id: 'ed_q14', type: 'scenario', skill_id: EARNINGS_SKILL, difficulty: 2, has_chart: false,
  prompt_json: { q: 'Which line in this report worries you most?', kind: 'mcq',
    story: 'Nike, fiscal Q4 2024: adjusted EPS $1.01 vs 83 cents expected. Revenue $12.61 billion vs $12.84 billion expected. On the call, it guides fiscal 2025 sales down mid-single digits. Analysts expected a 0.9% rise.',
    choices: ['The full-year sales guide', 'The EPS line', 'The revenue miss', 'Nothing: EPS beat'] } }
const Q15 = { id: 'ed_q15', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 2, has_chart: false,
  prompt_json: { q: 'Walmart, May 2022. New full-year guide: sales up about 4%, was 3%. EPS down about 1%, was up mid single digits. How does it read?', kind: 'mcq',
    choices: ['Sales raised, profit cut', 'A raise across the board', 'A cut across the board', 'No real change'] } }
const Q22 = { id: 'ed_q22', type: 'scenario', skill_id: EARNINGS_SKILL, difficulty: 3, has_chart: false,
  prompt_json: { q: "What does Walmart's report tell you about your Target shares?", kind: 'mcq',
    story: "May 2022. On Tuesday, Walmart's sales beat but its profit missed, and it blamed food and fuel inflation. You own Target, which reports on Wednesday.",
    choices: ['The same costs may squeeze Target', "Nothing: they're separate companies", "Target should gain from Walmart's miss", 'Sales beat, so retail is fine'] } }
const Q23 = { id: 'ed_q23', type: 'scenario', skill_id: EARNINGS_SKILL, difficulty: 3, has_chart: false,
  prompt_json: { q: 'Which report carried bad news beyond the EPS line?', kind: 'mcq',
    story: 'Two EPS beats. Nike, fiscal Q4 2024: EPS $1.01 vs 83 cents, revenue $12.61 billion vs $12.84 billion, full-year sales guided down. Alphabet, first quarter 2024: EPS $1.89 vs $1.51, revenue $80.54 billion vs $78.59 billion, first dividend.',
    choices: ["Nike's: a revenue miss and a cut guide", "Alphabet's: dividends mean slower growth", 'Both: any beat gets sold', 'Neither: both beat on EPS'] } }
const Q24 = { id: 'ed_q24', type: 'scenario', skill_id: EARNINGS_SKILL, difficulty: 3, has_chart: false,
  prompt_json: { q: 'How does the midpoint of the guide compare?', kind: 'mcq',
    story: "Meta guides first-quarter 2023 revenue to $26 billion to $28.5 billion. Refinitiv's consensus is $27.1 billion. Bloomberg News cites an average projection of $27.3 billion.",
    choices: ['$27.25B: above one, below the other', 'A beat: the top end is $28.5B', 'A miss: the low end is $26B', 'Exactly in line with both'] } }
const WALK = { id: 'ed_w1', type: 'walkthrough', skill_id: EARNINGS_SKILL, difficulty: 1, has_chart: false, prompt_json: { q: 'Two numbers, one verdict', steps: ['a', 'b'] } }
const CHARTED = { id: 'ed_c1', type: 'recall', skill_id: EARNINGS_SKILL, difficulty: 1, has_chart: true, prompt_json: { q: 'What did this gap do?', kind: 'tf', choices: ['True', 'False'] } }
const SET = { session_id: 'sess-e', items: [Q23, Q09, Q01, WALK, Q14, Q02, CHARTED, Q03, Q13, Q24, Q01] }

const cite = (name, url, quote) => ({ name, url, quote, accessed: '2026-11-09', tier: 1 })
const CNBC_NFLX = cite('CNBC: Netflix shares crater 25% after company reports it lost subscribers for the first time in more than 10 years (Sarah Whitten, April 19, 2022)',
  'https://www.cnbc.com/2022/04/19/netflix-nflx-earnings-q1-2022.html', 'Netflix earned $3.53 per share against a $2.89 Refinitiv consensus.')
const FINRA = cite('FINRA: What Is Earnings Season? (Investor Insights, July 23, 2024)', 'https://www.finra.org/investors/insights/earnings-season',
  'A company beats (exceeds) the estimate or misses (falls short of) the estimate based on how actual earnings or revenues compare to the consensus.')

const R01 = { why: 'A beat. $3.53 is well above the $2.89 consensus, and actual above the estimate is a beat.',
  lesson_line: 'Actual against the consensus. Above is a beat, below is a miss, equal is in line.',
  wrong: { 'A miss': 'A miss means actual came in below the estimate. $3.53 is above $2.89.', 'In line': 'In line means actual equals the estimate. $3.53 and $2.89 are far apart.' },
  depth: { sources: [CNBC_NFLX, FINRA, CNBC_NFLX] }, answer: { answer: 'A beat' } }
const R09 = { why: '25.2%. $1.89 minus $1.51, divided by $1.51, times 100. A big beat.', lesson_line: 'Work every surprise in percent. Then a big company and a small one read on one scale.',
  facts: { calc: { fn: 'pct_change', args: { start: 1.51, end: 1.89 }, result: 25.2 } }, answer: { answer: 25.2, accept: ['25.2', '25.20', '25.200'] }, depth: { sources: [FINRA] } }
const R12 = { why: '12.2%. It came in 18 cents short of $1.48. Divide the shortfall by the estimate.', lesson_line: 'Put the miss in percent, so you can weigh it against any other quarter.',
  facts: { calc: { fn: 'arith', args: { expr: '(consensus - actual) / consensus * 100', consensus: 1.48, actual: 1.3 }, result: 12.2 } }, answer: { answer: 12.2 } }
const R13 = { why: "$3.00. $1.76 plus $1.24. That's EPS without the $4.20 billion of restructuring charges.", lesson_line: 'When a big charge sits in EPS, work the number without it too. Then compare.',
  facts: { calc: { fn: 'arith', args: { expr: 'reported + charges', reported: 1.76, charges: 1.24 }, result: 3 } }, answer: { answer: 3, accept: ['3', '3.0', '3.00'] } }
const R14 = { why: 'The full-year sales guide. Analysts saw the year growing 0.9%, and Nike guided to a drop. Guidance looks ahead and often sets the near-term price. Shares plunged nearly 20% the next day.',
  lesson_line: 'Read the guide before you celebrate the beat. The beat is last quarter; the guide is the year ahead.',
  wrong: { 'The EPS line': "It beat: $1.01 against 83 cents expected. And it's the quarter just gone.", 'Nothing: EPS beat': "A beat doesn't cancel a weak outlook. CNBC tied the plunge to the guidance cut." },
  answer: { answer: 'The full-year sales guide' } }
const R20 = { why: 'False. Nike earned $1.01 against 83 cents expected and plunged nearly 20%. Alphabet earned $1.89 against $1.51 and rose 10%. Netflix beat too, and fell 35% in one day.',
  lesson_line: "The size of the beat doesn't set the move. The guide and the rest of the report do.", answer: { answer: 'False' } }
const R23 = { why: "Nike's. Its revenue missed and its guide marked the year down. Alphabet's revenue beat and grew 15%. Nike plunged nearly 20%; Alphabet rose 10%, its sharpest rally since July 2015.",
  lesson_line: 'Two beats, two opposite days. Read past the EPS line before you decide anything.', answer: { answer: "Nike's: a revenue miss and a cut guide" } }
const R24 = { why: "$27.25B: above one, below the other. Read a range at its midpoint, as FactSet does when it scores EPS guidance. That sits above Refinitiv's $27.1 billion and just under the $27.3 billion average. Both gaps are small, and Bloomberg called the range in line.",
  lesson_line: "Judge a guided range by its midpoint, and know whose consensus you're using. Close calls flip with the survey.",
  facts: { calc: { fn: 'arith', args: { expr: '(low + high) / 2', low: 26, high: 28.5 }, result: 27.25 } }, answer: { answer: '$27.25B: above one, below the other' } }

const reports = reportsOf(SET)
const by = (id) => reports.find((c) => c.id === id)

describe('the draw', () => {
  it('asks the server for the unit’s one skill, eight reports, three hearts', () => {
    expect(sessionBody()).toEqual({ kind: 'skill', skill_id: 'fund.earnings_desk', size: 8 })
    expect(EARNINGS_KIND).toBe('earnings')
    expect(EARNINGS_TOTAL).toBe(8)
    expect(EARNINGS_HEARTS).toBe(3)
    expect(EARNINGS_MIN).toBe(3)
    expect(TF_CHOICES).toEqual(['True', 'False'])
  })

  it('keeps the reports this desk can play, each once, and skips a walk-through and a chart item', () => {
    expect(reports.map((c) => c.id)).toEqual(['ed_q23', 'ed_q09', 'ed_q01', 'ed_q14', 'ed_q02', 'ed_q03', 'ed_q13', 'ed_q24'])
    expect(reports.every((c) => c.sessionId === 'sess-e' && c.chart === false && c.bars === null)).toBe(true)
    expect(by('ed_q01').kind).toBe('mcq')
    expect(by('ed_q02').kind).toBe('tf')
    expect(by('ed_q02').choices).toEqual(['True', 'False'])
    expect(by('ed_q03').kind).toBe('fill')
    expect(by('ed_q09').kind).toBe('numeric')
    expect(by('ed_q09').suffix).toBe('%')
    expect(by('ed_q13').prefix).toBe('$')
    expect(by('ed_q14').kind).toBe('mcq')
    expect(by('ed_q14').story).toMatch(/^Nike, fiscal Q4 2024/)
    expect(reportsOf(null)).toEqual([])
    expect(reportsOf({ items: [{ id: 'x', type: 'recall', prompt_json: { q: 'One choice', kind: 'mcq', choices: ['Only'] } }] })).toEqual([])
  })

  it('deals easiest first, at most the run’s total, the server’s order within a difficulty', () => {
    expect(deckOf(reports).map((c) => c.id)).toEqual(['ed_q01', 'ed_q02', 'ed_q03', 'ed_q09', 'ed_q14', 'ed_q13', 'ed_q23', 'ed_q24'])
    expect(deckOf(reports, 3).map((c) => c.id)).toEqual(['ed_q01', 'ed_q02', 'ed_q03'])
    expect(deckOf([])).toEqual([])
  })
})

describe('the masthead', () => {
  it('reads the company and the quarter off a report that opens on them, and lifts that opening off the card', () => {
    expect(headOf('Netflix, first quarter 2022: EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?'))
      .toEqual({ company: 'Netflix', period: 'First quarter 2022', rest: 'EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?' })
    expect(headOf(Q02.prompt_json.q)).toEqual({ company: 'Walmart', period: 'First quarter of fiscal 2023', rest: "Adjusted EPS of $1.30 against $1.48 expected. That's a beat." })
    expect(headOf(Q15.prompt_json.q)).toMatchObject({ company: 'Walmart', period: 'May 2022', rest: 'New full-year guide: sales up about 4%, was 3%. EPS down about 1%, was up mid single digits. How does it read?' })
    expect(headOf(Q14.prompt_json.story)).toMatchObject({ company: 'Nike', period: 'Fiscal Q4 2024', rest: 'Adjusted EPS $1.01 vs 83 cents expected. Revenue $12.61 billion vs $12.84 billion expected. On the call, it guides fiscal 2025 sales down mid-single digits. Analysts expected a 0.9% rise.' })
    expect(headOf('Meta, fourth quarter 2022: revenue $32.17 billion, down 4% from a year earlier.')).toMatchObject({ company: 'Meta', period: 'Fourth quarter 2022' })
  })

  it('keeps a sentence whole when the name and the quarter sit inside it', () => {
    expect(headOf(Q13.prompt_json.q)).toEqual({ company: 'Meta', period: 'Q4 2022', rest: Q13.prompt_json.q })
    expect(headOf(Q07.prompt_json.q)).toEqual({ company: 'Nike', period: 'Fiscal Q4 2024', rest: Q07.prompt_json.q })
  })

  it('names no company for a desk rule, two companies at once, or a story that opens on a month', () => {
    expect(headOf(Q23.prompt_json.story)).toBeNull()
    expect(headOf(Q22.prompt_json.story)).toBeNull()
    expect(headOf(Q24.prompt_json.story)).toBeNull()
    expect(headOf('Two news outlets can print different "expected" numbers for the same quarter.')).toBeNull()
    expect(headOf('The bigger a company’s EPS beat, the bigger the stock’s jump the next day.')).toBeNull()
    expect(headOf('')).toBeNull()
    expect(headOf(null)).toBeNull()
  })

  it('puts the masthead on the report and the rest of the words on the card', () => {
    expect(by('ed_q01')).toMatchObject({ company: 'Netflix', period: 'First quarter 2022', cardQ: 'EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?' })
    expect(deskLine(by('ed_q01'))).toBe('Netflix · First quarter 2022')
    expect(by('ed_q14')).toMatchObject({ company: 'Nike', period: 'Fiscal Q4 2024', cardQ: 'Which line in this report worries you most?' })
    expect(by('ed_q14').cardStory).toBe('Adjusted EPS $1.01 vs 83 cents expected. Revenue $12.61 billion vs $12.84 billion expected. On the call, it guides fiscal 2025 sales down mid-single digits. Analysts expected a 0.9% rise.')
    // a fill sentence is never cut, and a two-company story keeps its words
    expect(by('ed_q03')).toMatchObject({ company: '', period: '', cardQ: 'Tap the word that fits the blank.' })
    expect(by('ed_q23')).toMatchObject({ company: '', cardStory: Q23.prompt_json.story })
    expect(deskLine(by('ed_q23'))).toBe('')
    expect(deskLine(null)).toBe('')
  })
})

describe('the screen’s words', () => {
  it('names each report’s kind for the eyebrow and the end screen', () => {
    expect(kindWord(by('ed_q01'))).toBe('Beat or miss')
    expect(kindWord({ kind: 'mcq', choices: ['Beat on both', 'EPS beat, revenue missed'] })).toBe('Beat or miss')
    expect(kindWord({ kind: 'mcq', choices: ['On the earnings call', 'In the consensus estimate'] })).toBe('Make the call')
    expect(kindWord(by('ed_q02'))).toBe('True or false')
    expect(kindWord(by('ed_q03'))).toBe('Fill the blank')
    expect(kindWord(by('ed_q09'))).toBe('Do the math')
    expect(kindWord(by('ed_q14'))).toBe('Read the report')
    expect(kindWord(null)).toBe('')
  })

  it('lays the words out: the story on the card, the question big, a short ask over the tiles, a fill keeps its own question', () => {
    expect(cardText(by('ed_q01'))).toEqual({ story: '', big: 'EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?', question: 'Make the call.' })
    expect(cardText(by('ed_q02'))).toEqual({ story: '', big: "Adjusted EPS of $1.30 against $1.48 expected. That's a beat.", question: 'True or false?' })
    expect(cardText(by('ed_q09'))).toEqual({ story: '', big: 'EPS $1.89. The LSEG consensus was $1.51. What was the surprise, in percent?', question: 'Work it out.' })
    expect(cardText(by('ed_q14'))).toEqual({ story: by('ed_q14').cardStory, big: 'Which line in this report worries you most?', question: 'Make the call.' })
    expect(cardText(by('ed_q03'))).toEqual({ story: '', big: Q03.prompt_json.sentence, question: 'Tap the word that fits the blank.' })
    expect(cardText(null)).toEqual({ story: '', big: '', question: '' })
  })
})

describe('the tiles and what the member gave', () => {
  it('deals the tiles in a seeded order, the same for the same seed, True and False never swapped', () => {
    const a = dealChoices(by('ed_q14'), 7)
    expect(a).toEqual(dealChoices(by('ed_q14'), 7))
    expect([...a].sort()).toEqual([...Q14.prompt_json.choices].sort())
    expect(dealChoices(by('ed_q02'), 7)).toEqual(['True', 'False'])
    expect(dealChoices(by('ed_q09'), 7)).toEqual([])
    // across seeds the answer does not always sit first
    const firsts = new Set(Array.from({ length: 40 }, (_, k) => dealChoices(by('ed_q14'), k * 977 + 1)[0]))
    expect(firsts.size).toBeGreaterThan(1)
  })

  it('posts a tile in the bank’s words and a typed number as a number', () => {
    const choices = dealChoices(by('ed_q01'), 3)
    expect(answerFor(by('ed_q01'), { pick: choices.indexOf('A miss'), choices })).toEqual({ choice: 'A miss' })
    expect(answerFor(by('ed_q01'), { pick: null, choices })).toBeNull()
    expect(answerFor(by('ed_q09'), { text: '25.2' })).toEqual({ choice: 25.2 })
    expect(answerFor(by('ed_q09'), { text: '25.2%' })).toEqual({ choice: 25.2 })
    expect(answerFor(by('ed_q13'), { text: '$3.00' })).toEqual({ choice: 3 })
    expect(answerFor(by('ed_q09'), { text: '25,2' })).toBeNull()
    expect(rightIndex(choices, 'a beat')).toBe(choices.indexOf('A beat'))
  })

  it('says what the member gave the way a desk writes it', () => {
    expect(saidOf(by('ed_q09'), { text: '25.20' })).toBe('25.2%')
    expect(saidOf(by('ed_q13'), { text: '3' })).toBe('$3.00')
    expect(saidOf(by('ed_q10'), { text: '2.7' })).toBe('')   // Q10 is not in this draw
    expect(saidOf({ ...by('ed_q09'), suffix: 'million' }, { text: '2.7' })).toBe('2.7 million')
    expect(saidOf(by('ed_q09'), { text: 'abc' })).toBe('abc')
    const choices = dealChoices(by('ed_q01'), 3)
    expect(saidOf(by('ed_q01'), { pick: choices.indexOf('In line'), choices })).toBe('In line')
  })
})

describe('numbers', () => {
  it('counts decimals and rounds half away from zero past a float’s own error', () => {
    expect(decimalsOf(3)).toBe(0)
    expect(decimalsOf(25.2)).toBe(1)
    expect(decimalsOf(0.125)).toBe(3)
    expect(decimalsOf(1e-7)).toBe(6)
    expect(roundTo(25.15, 1)).toBe(25.2)
    expect(roundTo(-25.15, 1)).toBe(-25.2)
    expect(roundTo(2.675, 2)).toBe(2.68)
    expect(roundTo(3, 2)).toBe(3)
  })

  it('writes money to the cent at least, percents and units as they are', () => {
    expect(numLabel({ prefix: '$' }, 3)).toBe('$3.00')
    expect(numLabel({ prefix: '$' }, 1.765)).toBe('$1.765')
    expect(numLabel({ prefix: '$' }, 1234.5)).toBe('$1,234.50')
    expect(numLabel({ suffix: '%' }, 25.2)).toBe('25.2%')
    expect(numLabel({ suffix: '%' }, -12.2)).toBe('−12.2%')
    expect(numLabel({ suffix: 'million' }, 2.7)).toBe('2.7 million')
    expect(numLabel({}, 27.25)).toBe('27.25')
    expect(numLabel({}, 'x')).toBe('')
  })

  it('reads the right number from the server in the desk’s way, or what was said on a right answer', () => {
    expect(truthOf(by('ed_q09'), R09, { said: '25.2%', correct: true })).toBe('25.2%')
    expect(truthOf(by('ed_q13'), R13, {})).toBe('$3.00')
    expect(truthOf(by('ed_q13'), { answer: { answer: '3' } }, {})).toBe('$3.00')
    expect(truthOf(by('ed_q09'), { answer: null }, { said: '25.2%', correct: true })).toBe('25.2%')
    expect(truthOf(by('ed_q09'), { answer: null }, { said: '25%', correct: false })).toBeNull()
    const choices = dealChoices(by('ed_q01'), 3)
    expect(truthOf(by('ed_q01'), R01, { said: 'A miss', correct: false, choices })).toBe('A beat')
    expect(truthOf(by('ed_q02'), { answer: { answer: 'False' } }, { said: 'True', correct: false, choices: TF_CHOICES })).toBe('False')
  })

  it('names a near thing a typed number missed by, and nothing for a plain miss', () => {
    expect(nearNote(by('ed_q09'), '25.15', R09)).toBe('Close. 25.15% rounds to 25.2%, and the answer is given to one decimal.')
    expect(nearNote(by('ed_q09'), '25.17', R09)).toBe('Close. 25.17% rounds to 25.2%, and the answer is given to one decimal.')
    expect(nearNote(by('ed_q09'), '-25.2', R09)).toBe('Right size, wrong sign. The answer is 25.2%.')
    expect(nearNote(by('ed_q09'), '25.1', R09)).toBe('')
    expect(nearNote(by('ed_q09'), '25.25', R09)).toBe('')   // rounds to 25.3, a plain miss
    expect(nearNote(by('ed_q09'), '25.2', R09)).toBe('')
    expect(nearNote(by('ed_q09'), 'abc', R09)).toBe('')
    expect(nearNote(by('ed_q09'), '25.15', { answer: null })).toBe('')
    expect(nearNote(by('ed_q13'), '3.004', R13)).toBe('Close. $3.004 rounds to $3.00, and the answer is given to two decimals.')
    expect(nearNote(by('ed_q13'), '3.1', R13)).toBe('')
    expect(nearNote(by('ed_q01'), '25.15', R09)).toBe('')
  })
})

describe('the working', () => {
  it('reads an expression into tokens and refuses anything that is not plain arithmetic', () => {
    expect(tokensOf('(consensus - actual) / consensus * 100')).toEqual([
      { t: 'op', v: '(' }, { t: 'name', v: 'consensus' }, { t: 'op', v: '-' }, { t: 'name', v: 'actual' }, { t: 'op', v: ')' },
      { t: 'op', v: '/' }, { t: 'name', v: 'consensus' }, { t: 'op', v: '*' }, { t: 'num', v: 100, s: '100' },
    ])
    expect(tokensOf('a ^ 2')).toBeNull()
    expect(tokensOf('Math.max(a, b)')).toBeNull()
    expect(tokensOf('')).toBeNull()
  })

  it('values an expression over its names, never eval, null for anything it cannot read', () => {
    expect(evalExpr('(consensus - actual) / consensus * 100', { consensus: 1.48, actual: 1.3 })).toBeCloseTo(12.162, 3)
    expect(evalExpr('reported + charges', { reported: 1.76, charges: 1.24 })).toBeCloseTo(3, 9)
    expect(evalExpr('(low + high) / 2', { low: 26, high: 28.5 })).toBe(27.25)
    expect(evalExpr('-(a - b) * 2', { a: 1, b: 3 })).toBe(4)
    expect(evalExpr('a / b', { a: 1, b: 0 })).toBeNull()
    expect(evalExpr('a + b', { a: 1 })).toBeNull()
    expect(evalExpr('a + b', { a: 1, b: 'two' })).toBeNull()
    expect(evalExpr('(a + b', { a: 1, b: 2 })).toBeNull()
    expect(evalExpr('a + b)', { a: 1, b: 2 })).toBeNull()
    expect(evalExpr('a b', { a: 1, b: 2 })).toBeNull()
    expect(evalExpr('process.exit()', {})).toBeNull()
  })

  it('writes an expression the way a member reads it, in names or in numbers', () => {
    expect(exprText('(consensus - actual) / consensus * 100')).toBe('(consensus − actual) ÷ consensus × 100')
    expect(exprText('(consensus - actual) / consensus * 100', { consensus: 1.48, actual: 1.3 })).toBe('(1.48 − 1.3) ÷ 1.48 × 100')
    expect(exprText('loss_pct / 2')).toBe('loss pct ÷ 2')
    expect(exprText('-a + 1000', { a: 2 })).toBe('−2 + 1,000')
  })

  it('recomputes a computed answer from the reveal’s inputs and shows it only when it agrees with the server', () => {
    expect(workingOf(R09, by('ed_q09'))).toEqual({ formula: '(end − start) ÷ start × 100', filled: '(1.89 − 1.51) ÷ 1.51 × 100', result: '25.2%', text: '(end − start) ÷ start × 100 = (1.89 − 1.51) ÷ 1.51 × 100 = 25.2%' })
    expect(workingOf(R12, { kind: 'numeric', suffix: '%' }).text).toBe('(consensus − actual) ÷ consensus × 100 = (1.48 − 1.3) ÷ 1.48 × 100 = 12.2%')
    expect(workingOf(R13, by('ed_q13'))).toMatchObject({ formula: 'reported + charges', filled: '1.76 + 1.24', result: '$3.00' })
    // a choice item with a calculation reads as a plain number; a percent calculation keeps its %
    expect(workingOf(R24, by('ed_q24'))).toMatchObject({ filled: '(26 + 28.5) ÷ 2', result: '27.25' })
    expect(workingOf({ facts: { calc: { fn: 'pct_change', args: { start: 100, end: 115 }, result: 15 } } }, by('ed_q01')).result).toBe('15%')
    expect(workingOf({ facts: { calc: { fn: 'pe', args: { price: 150, eps: 6 }, result: 25 } } }).text).toBe('price ÷ eps = 150 ÷ 6 = 25')
    expect(workingOf({ facts: { calc: { fn: 'yoy_growth', args: { current: 115, prior: 100 }, result: 15 } } }).result).toBe('15%')
    // nothing rather than a wrong line: a disagreeing result, an unknown calculation, a prior at or below zero, bad inputs
    expect(workingOf({ facts: { calc: { fn: 'pct_change', args: { start: 1.51, end: 1.89 }, result: 24.2 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 100, trough: 80 }, result: 20 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'yoy_growth', args: { current: 5, prior: -10 }, result: -150 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'arith', args: { expr: 'a / b', a: 1, b: 0 }, result: 1 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'arith', args: { expr: 7 }, result: 7 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'pe', args: { price: 150, eps: 6 }, result: null } } })).toBeNull()
    expect(workingOf({ facts: {} })).toBeNull()
    expect(workingOf(null)).toBeNull()
    expect(Object.keys(FORMULAS).sort()).toEqual(['arith', 'pct_change', 'pe', 'yoy_growth'])
  })
})

describe('the reveal, as the desk note reads it', () => {
  it('splits a passage into sentences without breaking a number, an abbreviation or a semicolon', () => {
    expect(sentencesIn('A beat. $3.53 is well above the $2.89 consensus, and actual above the estimate is a beat.'))
      .toEqual(['A beat.', '$3.53 is well above the $2.89 consensus, and actual above the estimate is a beat.'])
    expect(sentencesIn(R13.why)).toEqual(['$3.00.', '$1.76 plus $1.24.', "That's EPS without the $4.20 billion of restructuring charges."])
    expect(sentencesIn('Revenue $12.61 billion vs. $12.84 billion expected. Shares fell.')).toEqual(['Revenue $12.61 billion vs. $12.84 billion expected.', 'Shares fell.'])
    expect(sentencesIn('Nike plunged nearly 20%; Alphabet rose 10%, its sharpest rally since July 2015.')).toHaveLength(1)
    expect(sentencesIn('Is it a beat? Yes. "Well above," CNBC said.')).toEqual(['Is it a beat?', 'Yes.', '"Well above," CNBC said.'])
    expect(sentencesIn('')).toEqual([])
    expect(sentencesIn(null)).toEqual([])
  })

  it('drops the verdict why opens on when the screen already shows that answer, and keeps a first sentence that says more', () => {
    expect(reasonOf(R01, 'A beat')).toBe('$3.53 is well above the $2.89 consensus, and actual above the estimate is a beat.')
    expect(reasonOf(R01, 'A miss')).toBe(R01.why)
    expect(reasonOf(R09, '25.2%')).toBe('$1.89 minus $1.51, divided by $1.51, times 100. A big beat.')
    expect(reasonOf(R13, '$3.00')).toBe("$1.76 plus $1.24. That's EPS without the $4.20 billion of restructuring charges.")
    expect(reasonOf(R23, "Nike's: a revenue miss and a cut guide")).toMatch(/^Its revenue missed and its guide marked the year down\./)
    expect(reasonOf(R20, 'False')).toMatch(/^Nike earned \$1\.01/)
    expect(reasonOf(R24, '$27.25B: above one, below the other')).toMatch(/^Read a range at its midpoint/)
    expect(reasonOf({ why: 'Unclear: the charges muddy it. You don’t know whether the $2.22 estimate allowed for them.' }, 'Unclear: the charges muddy it')).toBe('You don’t know whether the $2.22 estimate allowed for them.')
    expect(reasonOf({ why: 'A beat.' }, 'A beat')).toBe('A beat.')
    expect(reasonOf({ lesson: 'Only the lesson. Two lines.' }, null)).toBe('Only the lesson. Two lines.')
    expect(reasonOf({}, 'x')).toBe('')
  })

  it('knows a sentence that says what the stock did from one that reports the books', () => {
    expect(isReaction('Shares plunged nearly 20% the next day.')).toBe(true)
    expect(isReaction('The stock closed down 11.38% that day.')).toBe(true)
    expect(isReaction('The stock closed up 23% the next day.')).toBe(true)
    expect(isReaction('Nike plunged nearly 20%; Alphabet rose 10%, its sharpest rally since July 2015.')).toBe(true)
    expect(isReaction('Netflix beat too, and fell 35% in one day.')).toBe(true)
    expect(isReaction('Revenue grew 15% from a year earlier.')).toBe(false)
    expect(isReaction('Sales fell 4% from a year earlier.')).toBe(false)
    expect(isReaction('Analysts saw the year growing 0.9%, and Nike guided to a drop.')).toBe(false)
    expect(isReaction('Guidance looks ahead and often sets the near-term price.')).toBe(false)
    expect(isReaction('Shares fell.')).toBe(false)
    expect(isReaction('')).toBe(false)
  })

  it('lifts the stock’s sentences off the end of why, in order and word for word', () => {
    expect(splitWhy(R14, 'The full-year sales guide')).toEqual({
      print: ['Analysts saw the year growing 0.9%, and Nike guided to a drop.', 'Guidance looks ahead and often sets the near-term price.'],
      stock: ['Shares plunged nearly 20% the next day.'],
    })
    expect(splitWhy(R23, "Nike's: a revenue miss and a cut guide")).toEqual({
      print: ['Its revenue missed and its guide marked the year down.', "Alphabet's revenue beat and grew 15%."],
      stock: ['Nike plunged nearly 20%; Alphabet rose 10%, its sharpest rally since July 2015.'],
    })
    // a why that only says what the stock did is all stock
    expect(splitWhy(R20, 'False')).toEqual({ print: [], stock: ['Nike earned $1.01 against 83 cents expected and plunged nearly 20%.', 'Alphabet earned $1.89 against $1.51 and rose 10%.', 'Netflix beat too, and fell 35% in one day.'] })
    expect(splitWhy(R01, 'A beat')).toEqual({ print: ['$3.53 is well above the $2.89 consensus, and actual above the estimate is a beat.'], stock: [] })
    expect(splitWhy(null)).toEqual({ print: [], stock: [] })
  })

  it('gives the takeover the stock’s line only when it fits', () => {
    expect(stockLine(['Shares plunged nearly 20% the next day.'])).toBe('Shares plunged nearly 20% the next day.')
    // three short sentences fit together; with a long one on the end only the first fits
    const three = splitWhy(R20, 'False').stock
    expect(three.join(' ').length).toBeLessThanOrEqual(TAKEOVER_STOCK_MAX)
    expect(stockLine(three)).toBe(three.join(' '))
    const long = [...three, `The stock ${'slid 1% '.repeat(20)}that day.`]
    expect(long.join(' ').length).toBeGreaterThan(TAKEOVER_STOCK_MAX)
    expect(stockLine(long)).toBe('Nike earned $1.01 against 83 cents expected and plunged nearly 20%.')
    expect(stockLine(['x'.repeat(TAKEOVER_STOCK_MAX + 1)])).toBe('')
    expect(stockLine([])).toBe('')
    expect(stockLine(null)).toBe('')
  })

  it('picks the one line a miss holds the screen with', () => {
    expect(teachOf({ near: 'Close.', mine: 'Mine.', working: { text: 'W' }, print: ['P'] })).toBe('Close.')
    expect(teachOf({ mine: 'Mine.', working: { text: 'W' }, print: ['P'] })).toBe('Mine.')
    expect(teachOf({ working: { text: 'W' }, print: ['P'] })).toBe('W')
    expect(teachOf({ print: ['P one.', 'P two.'] })).toBe('P one. P two.')
    expect(teachOf({})).toBe('')
  })

  it('reads the note for the member’s own pick, the verdict and the XP', () => {
    expect(pickNote(R01, 'A miss')).toBe('A miss means actual came in below the estimate. $3.53 is above $2.89.')
    expect(pickNote(R01, 'a miss')).toBe('A miss means actual came in below the estimate. $3.53 is above $2.89.')
    expect(pickNote(R01, 'A beat')).toBe('')
    expect(verdictOf({ correct: false })).toBe(false)
    expect(verdictOf({ reveal: {} })).toBeNull()
    expect(xpOf({ progress: { xp_gained: 10 } })).toBe(10)
    expect(xpOf({})).toBe(0)
  })
})

describe('the run', () => {
  it('keeps the hearts and ends the run when they are gone or every report is answered', () => {
    expect(heartsLeft([])).toBe(3)
    expect(heartsLeft([true, false, true, false])).toBe(1)
    expect(heartsLeft([false, false, false, false])).toBe(0)
    expect(heartsLine(3)).toBe('3 hearts left')
    expect(heartsLine(1)).toBe('1 heart left')
    expect(heartsLine(0)).toBe('Out of hearts')
    expect(runOver([true, true], 8)).toBe(false)
    expect(runOver([false, false, false], 8)).toBe(true)
    expect(runOver(Array(8).fill(true), 8)).toBe(true)
    expect(solvedOf([true, false, true])).toBe(2)
  })

  it('keeps one answered report as the log keeps it: the masthead, the ask, the answer, what the stock did, the lesson and the source', () => {
    const row = rowOf(by('ed_q14'), { ok: false, said: 'The EPS line', truth: 'The full-year sales guide', reveal: { ...R14, depth: { sources: [FINRA] } }, xp: 2 })
    expect(row).toEqual({
      id: 'ed_q14', ok: false, xp: 2, kind: 'Read the report', name: 'Nike · Fiscal Q4 2024', ask: 'Which line in this report worries you most?',
      said: 'The EPS line', truth: 'The full-year sales guide', stock: 'Shares plunged nearly 20% the next day.',
      line: 'Read the guide before you celebrate the beat. The beat is last quarter; the guide is the year ahead.',
      source: { name: 'FINRA: What Is Earnings Season?', full: FINRA.name, url: FINRA.url },
    })
    const plain = rowOf(by('ed_q01'), { ok: true, said: 'A beat', truth: 'A beat', reveal: R01, xp: 10 })
    expect(plain).toMatchObject({ name: 'Netflix · First quarter 2022', ask: 'EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?', stock: '', xp: 10 })
    // a long source name is cut for a phone; the full name rides beside it
    expect(plain.source.name).toMatch(/^CNBC: Netflix shares crater 25% after company reports it lost subscribers for the first…$/)
    expect(plain.source.full).toBe(CNBC_NFLX.name)
    expect(plain.source.url).toBe(CNBC_NFLX.url)
    // no masthead: the question (or the fill sentence) is the name, and there is no ask
    expect(rowOf(by('ed_q03'), { ok: true, said: 'surprise', truth: 'surprise' })).toMatchObject({ name: Q03.prompt_json.sentence, ask: '', kind: 'Fill the blank' })
    expect(rowOf(by('ed_q23'), { ok: true })).toMatchObject({ name: 'Which report carried bad news beyond the EPS line?', ask: '' })
    const run = addCase(addCase(null, plain), row)
    expect(run).toEqual({ results: [true, false], log: [plain, row], xp: 12 })
  })

  it('ranks the run and names the kind to work on next', () => {
    expect(rankOf(8, 8)).toBe('Head of the desk')
    expect(rankOf(6, 8)).toBe('Senior analyst')
    expect(rankOf(4, 8)).toBe('Analyst')
    expect(rankOf(2, 8)).toBe('Junior analyst')
    expect(rankOf(0, 0)).toBe('No calls yet')
    const log = [
      { kind: 'Beat or miss', ok: true }, { kind: 'Beat or miss', ok: true },
      { kind: 'Do the math', ok: false }, { kind: 'Do the math', ok: true },
      { kind: 'Read the report', ok: false }, { kind: 'Read the report', ok: false }, { kind: 'Read the report', ok: true },
    ]
    expect(weakestOf(log)).toEqual({ word: 'Read the report', ok: 1, n: 3 })
    expect(weakLine(weakestOf(log))).toBe('Work on next: Read the report. 1 of 3 right this run.')
    // a tie on the share right goes to the kind with more misses; nothing missed, nothing to work on
    expect(weakestOf([{ kind: 'A', ok: false }, { kind: 'A', ok: true }, { kind: 'B', ok: false }, { kind: 'B', ok: true }, { kind: 'B', ok: false }, { kind: 'B', ok: true }])).toEqual({ word: 'B', ok: 2, n: 4 })
    expect(weakestOf([{ kind: 'A', ok: true }])).toBeNull()
    expect(weakestOf([])).toBeNull()
    expect(weakLine(null)).toBe('')
  })

  it('says its member lines without a dash or the old name', () => {
    for (const line of [EMPTY_LINE, FAILED_LINE, SIGNED_OUT_LINE, NUMBER_HINT, thinLine(1), thinLine(2)]) {
      expect(line).not.toMatch(/[—–]|\bthe firm\b/i)
    }
    expect(EMPTY_LINE).toBe('No questions in this game yet. They arrive as the courses are approved.')
    expect(thinLine(1)).toBe('Only 1 report is approved so far, too few for a run. More arrive as the courses are approved.')
    expect(thinLine(2)).toBe('Only 2 reports are approved so far, too few for a run. More arrive as the courses are approved.')
  })
})

// ── the unit itself: every F5.08 question in the repo, built the way courses_lib.build_items builds it ──────────────
describe('the F5.08 unit in the repo', () => {
  const doc = JSON.parse(readFileSync(resolve(globalThis.process.cwd(), '..', 'docs/study/courses/F5/F5.08.json'), 'utf8'))
  // the bank holds only the questions the checker passed (build_items only_passed); the calc results the server stores
  const RESULT = { q09: 25.2, q10: 2.7, q12: 12.2, q13: 3, q16: 28.7, q24: 27.25 }
  const passed = doc.questions.filter((q) => doc.verify?.[q.key]?.status === 'pass')
  const items = passed.map((q) => {
    const kind = { mcq: 'mcq', scenario: 'mcq', tf: 'tf', fill: 'fill', numeric: 'fill_numeric' }[q.format]
    const prompt = { q: q.q, kind }
    if (kind === 'mcq') prompt.choices = q.choices
    if (q.format === 'scenario') prompt.story = q.story
    if (kind === 'tf') prompt.choices = ['True', 'False']
    if (kind === 'fill') { prompt.sentence = q.sentence; prompt.bank = q.bank }
    for (const k of ['prefix', 'suffix', 'label']) if (q[k]) prompt[k] = q[k]
    const reveal = { unit: 'F5.08', why: q.why, lesson_line: q.lesson_line, facts: {}, depth: { sources: [] } }
    if (q.calc) reveal.facts.calc = { fn: q.calc.fn, args: q.calc.args, result: RESULT[q.key] }
    if (q.wrong) reveal.wrong = q.wrong
    reveal.answer = { answer: q.format === 'numeric' ? RESULT[q.key] : q.answer }
    return { key: q.key, q, reveal, item: { id: `f5_08_${q.key}`, type: q.format === 'scenario' ? 'scenario' : 'recall', skill_id: EARNINGS_SKILL,
      difficulty: q.rung <= 3 ? 1 : q.rung <= 6 ? 2 : 3, has_chart: false, prompt_json: prompt } }
  })
  const set = { session_id: 'sess-unit', items: items.map((x) => x.item) }
  const all = reportsOf(set)
  const report = (key) => all.find((c) => c.id === `f5_08_${key}`)
  const truthFor = (key) => { const { reveal } = items.find((x) => x.key === key); const c = report(key); return truthOf(c, reveal, { choices: c.choices }) }

  it('plays every approved question of the unit, and the whole unit fills a run', () => {
    expect(passed.length).toBeGreaterThanOrEqual(20)
    expect(all.map((c) => c.id)).toEqual(items.map((x) => x.item.id))
    expect(all.length).toBeGreaterThanOrEqual(EARNINGS_MIN)
    expect(deckOf(all)).toHaveLength(EARNINGS_TOTAL)
    const d = deckOf(all).map((c) => c.difficulty)
    expect(d).toEqual([...d].sort())
  })

  it('reads the company and the quarter off every report that opens on them, and none off the rest', () => {
    const mast = Object.fromEntries(all.map((c) => [c.id.slice(6), deskLine(c)]))
    expect(mast).toEqual({
      q01: 'Netflix · First quarter 2022', q02: 'Walmart · First quarter of fiscal 2023', q04: 'Alphabet · First quarter 2024',
      q05: 'Target · First quarter 2022', q06: '', q07: 'Nike · Fiscal Q4 2024', q08: '', q09: 'Alphabet · First quarter 2024', q10: '',
      q11: 'Meta · Fourth quarter 2022', q12: 'Walmart · First quarter of fiscal 2023', q13: 'Meta · Q4 2022', q14: 'Nike · Fiscal Q4 2024',
      q15: 'Walmart · May 2022', q16: 'Target · First quarter 2022', q17: 'Walmart · First quarter of fiscal 2023', q18: 'Netflix · First quarter 2022',
      q19: 'Meta · Fourth quarter 2022', q20: '', q21: '', q22: '', q23: '', q24: '',
    })
    // the words the card carries are the bank's own: the masthead's opening lifted off, nothing else changed
    for (const c of all) {
      const { story, big } = cardText(c)
      const src = c.story || c.q
      const shown = c.story ? story : big
      expect(src.toLowerCase().endsWith(shown.toLowerCase()), c.id).toBe(true)
      if (!c.company) expect(shown, c.id).toBe(src)
    }
  })

  it('reads every reveal without losing or changing a word: why, the stock’s sentences, the notes and the lesson', () => {
    const squash = (s) => s.replace(/\s+/g, ' ').trim()
    for (const { key, q, reveal } of items) {
      const truth = truthFor(key)
      expect(truth, key).toBeTruthy()
      // the sentence splitter keeps every word of every passage
      for (const text of [q.why, q.lesson_line, ...Object.values(q.wrong || {})]) expect(sentencesIn(text).join(' '), key).toBe(squash(text))
      // why opens on the verdict the screen already shows, so the desk note starts on the next sentence of the same text
      const reason = reasonOf(reveal, truth)
      expect(reason.length, key).toBeLessThan(q.why.length)
      expect(q.why.toLowerCase().endsWith(reason.toLowerCase()), key).toBe(true)
      // the note keeps every sentence of why in order, the stock's at the end, word for word
      const { print, stock } = splitWhy(reveal, truth)
      expect([...print, ...stock].join(' '), key).toBe(reason)
      for (const s of stock) expect(q.why.includes(s), key).toBe(true)
      if (stock.length) expect(stockLine(stock), key).not.toBe('')
    }
  })

  it('lifts out exactly the sentences that say what the stock did', () => {
    const stocks = Object.fromEntries(items.map(({ key, reveal }) => [key, splitWhy(reveal, truthFor(key)).stock]))
    expect(stocks).toEqual({
      q01: [], q02: [], q04: [], q05: [], q06: [], q07: [], q08: [], q09: [], q10: [], q11: [], q12: [], q13: [], q15: [], q16: [], q24: [],
      q14: ['Shares plunged nearly 20% the next day.'],
      q17: ['The stock closed down 11.38% that day.'],
      q18: ['The stock plunged 35% in one day.'],
      q19: ['The stock closed up 23% the next day.'],
      q20: ['Nike earned $1.01 against 83 cents expected and plunged nearly 20%.', 'Alphabet earned $1.89 against $1.51 and rose 10%.', 'Netflix beat too, and fell 35% in one day.'],
      q21: ['Revenue beat, it cut its cost outlook, and it closed up 23% the next day.'],
      q22: ['Its shares fell nearly 25%, and both stocks had their worst days since 1987.'],
      q23: ['Nike plunged nearly 20%; Alphabet rose 10%, its sharpest rally since July 2015.'],
    })
  })

  it('recomputes every calculation in the unit and agrees with the stored result', () => {
    const texts = Object.fromEntries(items.filter((x) => x.q.calc).map(({ key, reveal }) => [key, workingOf(reveal, report(key))?.text]))
    expect(texts).toEqual({
      q09: '(end − start) ÷ start × 100 = (1.89 − 1.51) ÷ 1.51 × 100 = 25.2%',
      q10: 'forecast + lost = 2.5 + 0.2 = 2.7 million',
      q12: '(consensus − actual) ÷ consensus × 100 = (1.48 − 1.3) ÷ 1.48 × 100 = 12.2%',
      q13: 'reported + charges = 1.76 + 1.24 = $3.00',
      q16: '(consensus − actual) ÷ consensus × 100 = (3.07 − 2.19) ÷ 3.07 × 100 = 28.7%',
      q24: '(low + high) ÷ 2 = (26 + 28.5) ÷ 2 = 27.25',
    })
    // the number cases read their answers the desk's way
    expect(['q09', 'q10', 'q12', 'q13', 'q16'].map(truthFor)).toEqual(['25.2%', '2.7 million', '12.2%', '$3.00', '28.7%'])
  })

  it('keeps every wrong note under the pick it was written for', () => {
    for (const { key, q, reveal } of items) {
      const c = report(key)
      for (const [pick, note] of Object.entries(q.wrong || {})) {
        expect(c.choices, key).toContain(pick)
        expect(pickNote(reveal, pick), key).toBe(note)
      }
      expect(pickNote(reveal, q.answer), key).toBe('')
    }
  })
})
