/**
 * History Detective, the pure half (games/history.js): the draw shaped into cases (what this game can play, what it must
 * skip), the run's order, the seeded tiles (the bank lists the answer first more often than not, so the order must not
 * point at it), what a member typed, the server's verdict and reveal read into the case file, the working of a computed
 * answer recomputed and shown only when it agrees with the server, the dates, the hearts and the end's rank. The fixtures
 * are F7.08's own items (docs/study/courses/F7/F7.08.json) as scripts/study/courses_lib.build_items makes them.
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_LINE, FAILED_LINE, FUNDS, HISTORY_HEARTS, HISTORY_SKILL, HISTORY_TOTAL, NUMBER_HINT, SIGNED_OUT_LINE, TF_CHOICES,
  addCase, answerFor, bestAfter, bestLine, caseText, casesOf, chartFactsOf, clip, dealChoices, deckOf, detailOf, fmtNumber, fundNote,
  hashSeed, heartsLeft, heartsLine, kindOf, kindWord, lessonLineOf, longDate, numLabel, parseNumber, partsOf, pickNote,
  rankOf, reasonOf, rightIndex, rowOf, runOver, saidOf, sessionBody, shortDate, solvedOf, sourcesOf, thinLine, truthOf, typedNumber,
  verdictOf, workingOf, xpOf,
} from './history'

const bar = (i, c) => ({ t: `2009-03-${String(i + 1).padStart(2, '0')}`, o: c - 0.2, h: c + 0.4, l: c - 0.5, c, v: 1000 })
const BARS = Array.from({ length: 9 }, (_, i) => bar(i, 70 - i))

// F7.08's own questions, built the way courses_lib.build_items builds them
const Q01 = { id: 'si_q01', type: 'recall', skill_id: HISTORY_SKILL, difficulty: 1, has_chart: false,
  prompt_json: { q: 'Since 2000, which fall cut the S&P 500 the most from peak to low?', kind: 'mcq',
    choices: ['The 2007-09 financial crisis', 'The 2000-02 dot-com bust', 'The 2020 COVID crash', 'The 2022 inflation bear'] } }
const Q02 = { id: 'si_q02', type: 'recall', skill_id: HISTORY_SKILL, difficulty: 1, has_chart: false,
  prompt_json: { q: 'Tap the word that fits the blank.', kind: 'fill', sentence: 'The 2007-09 bear market grew out of a collapse in ___ prices.', bank: ['home', 'oil', 'tech', 'gold', 'food'] } }
const Q05 = { id: 'si_q05', type: 'recall', skill_id: HISTORY_SKILL, difficulty: 1, has_chart: true,
  prompt_json: { q: 'When the index made this low, the recession had already ended.', kind: 'tf', choices: ['True', 'False'], chart: { window_bars: 250, tf: 'D' } },
  bars: { symbol: 'si_q05', tf: 'D', bars: BARS } }
const Q08 = { id: 'si_q08', type: 'recall', skill_id: HISTORY_SKILL, difficulty: 2, has_chart: false,
  prompt_json: { q: 'The S&P 500 closed at a 2,930.75 peak in September 2018 and at 2,351.10 on December 24. How far did it fall, in %? One decimal.', kind: 'fill_numeric', suffix: '%' } }
const Q15 = { id: 'si_q15', type: 'scenario', skill_id: HISTORY_SKILL, difficulty: 3, has_chart: false,
  prompt_json: { q: 'What happens to your stop order?', kind: 'mcq', story: 'Stock index futures hit their 5% limit down before the open. Your sell stop sits 6% below Friday’s close.',
    choices: ['It becomes a market order and sells', 'It fills at exactly your stop price', 'It waits for the price to recover', 'It cancels when trading turns wild'] } }
const WALK = { id: 'si_w1', type: 'walkthrough', skill_id: HISTORY_SKILL, difficulty: 1, has_chart: false, prompt_json: { q: 'Four things to read in any fall', steps: ['a', 'b'] } }
const SET = { session_id: 'sess-1', items: [Q15, Q08, Q01, WALK, Q02, Q05] }

const NUM_REVEAL = {
  why: '19.8%. From 2,930.75 down to 2,351.10, on worries about earnings, global growth, trade and the Fed. It stopped just short of the 20% fall that generally marks a bear market.',
  lesson_line: 'Measure from the closing peak. Late 2018 came within a hair of 20%, then turned.',
  facts: { given: '...', calc: { fn: 'drawdown_pct', args: { peak: 2930.75, trough: 2351.1 }, result: 19.8 } },
  answer: { answer: 19.8, accept: ['19.8', '19.80', '19.800'] },
}

describe('the draw', () => {
  it('asks the server for the unit’s one skill', () => {
    expect(sessionBody()).toEqual({ kind: 'skill', skill_id: 'history.detective', size: HISTORY_TOTAL })
    expect(HISTORY_TOTAL).toBe(8)
    expect(HISTORY_HEARTS).toBe(3)
  })

  it('reads each item’s kind of play, and refuses what this game cannot play', () => {
    expect(kindOf(Q01)).toBe('mcq')
    expect(kindOf(Q02)).toBe('fill')
    expect(kindOf(Q05)).toBe('tf')
    expect(kindOf(Q08)).toBe('numeric')
    expect(kindOf(Q15)).toBe('mcq')
    expect(kindOf(WALK)).toBeNull()
    expect(kindOf({ type: 'spot', prompt_json: { q: 'x', choices: ['Yes', 'No'] } })).toBeNull()
    expect(kindOf({ type: 'recall', prompt_json: { q: 'x', kind: 'fill_text' } })).toBeNull()
    expect(kindOf(null)).toBeNull()
  })

  it('shapes the session into cases: the session id, the words cleaned, a chart only with its bars', () => {
    const cases = casesOf(SET)
    expect(cases.map((c) => c.id)).toEqual(['si_q15', 'si_q08', 'si_q01', 'si_q02', 'si_q05'])
    const [q15, q08, q01, q02, q05] = cases
    expect(q15).toMatchObject({ kind: 'mcq', sessionId: 'sess-1', chart: false, bars: null, difficulty: 3 })
    expect(q15.story).toMatch(/^Stock index futures/)
    expect(q08).toMatchObject({ kind: 'numeric', suffix: '%', prefix: '', choices: [] })
    expect(q01.choices).toHaveLength(4)
    expect(q02).toMatchObject({ kind: 'fill', sentence: 'The 2007-09 bear market grew out of a collapse in ___ prices.' })
    expect(q02.choices).toEqual(['home', 'oil', 'tech', 'gold', 'food'])
    expect(q05).toMatchObject({ kind: 'tf', chart: true, choices: TF_CHOICES })
    expect(q05.bars).toHaveLength(9)
  })

  it('normalizes the bars through the function it is given', () => {
    const seen = []
    const cases = casesOf({ items: [Q05] }, (list) => { seen.push(list.length); return list.map((b) => ({ ...b, c: b.c * 2, o: b.o * 2, h: b.h * 2, l: b.l * 2 })) })
    expect(seen).toEqual([9])
    expect(cases[0].bars[0].c).toBe(140)
    // a bare list of bars is read too
    expect(casesOf({ items: [{ ...Q05, bars: BARS }] })[0].bars).toHaveLength(9)
  })

  it('skips a chart question whose chart did not come, a fill without its blank, thin or repeated choices and repeats', () => {
    const noBars = { ...Q05, id: 'nb', bars: null }
    const badBars = { ...Q05, id: 'bb', bars: { bars: [{ t: '2009-03-01', o: 1, h: 2, l: 0.5, c: NaN }, bar(1, 3)] } }
    const noBlank = { ...Q02, id: 'nf', prompt_json: { ...Q02.prompt_json, sentence: 'No slot here.' } }
    const thin = { ...Q01, id: 'th', prompt_json: { ...Q01.prompt_json, choices: ['Only one'] } }
    const twice = { ...Q01, id: 'tw', prompt_json: { ...Q01.prompt_json, choices: ['Same', 'same '] } }
    const noQ = { ...Q01, id: 'nq', prompt_json: { ...Q01.prompt_json, q: '  ' } }
    const out = casesOf({ items: [noBars, badBars, noBlank, thin, twice, noQ, Q01, Q01] })
    expect(out.map((c) => c.id)).toEqual(['si_q01'])
    expect(casesOf(null)).toEqual([])
    expect(casesOf({ items: 'nope' })).toEqual([])
  })

  it('never prints our old name or a long dash', () => {
    const it2 = { ...Q01, id: 'f', prompt_json: { ...Q01.prompt_json, q: "What did the firm’s desk say — then?" } }
    const [c] = casesOf({ items: [it2] })
    expect(c.q).not.toMatch(/firm|—|–/)
    expect(c.q).toMatch(/UCT/)
  })

  it('shows a cleaned label but posts the bank’s own words, so a right pick is never scored wrong over the cleaning', () => {
    const odd = { ...Q01, id: 'odd', prompt_json: { ...Q01.prompt_json, choices: ['The 2000–02 bust', "What the firm's desk said", 'The 2020 crash'] } }
    const [c] = casesOf({ items: [odd] })
    expect(c.choices).toEqual(['The 2000-02 bust', "What UCT's desk said", 'The 2020 crash'])
    expect(answerFor(c, { pick: 0, choices: c.choices })).toEqual({ choice: 'The 2000–02 bust' })
    expect(answerFor(c, { pick: 1, choices: c.choices })).toEqual({ choice: "What the firm's desk said" })
    expect(answerFor(c, { pick: 2, choices: c.choices })).toEqual({ choice: 'The 2020 crash' })
    // the key and the note for a pick come back in the bank's words and read as the cleaned tile
    expect(truthOf(c, { answer: { answer: 'The 2000–02 bust' } }, { said: 'The 2020 crash', correct: false, choices: c.choices })).toBe('The 2000-02 bust')
    expect(pickNote({ wrong: { 'The 2000–02 bust': 'Close, but not the deepest.' } }, 'The 2000-02 bust')).toBe('Close, but not the deepest.')
    // F7.08's own labels need no cleaning: nothing to map
    expect(casesOf({ items: [Q01] })[0].raw).toEqual({})
  })

  it('orders the run easiest first, the server’s order within a difficulty, cut to the run’s size', () => {
    const cases = casesOf(SET)
    expect(deckOf(cases).map((c) => c.id)).toEqual(['si_q01', 'si_q02', 'si_q05', 'si_q08', 'si_q15'])
    expect(deckOf(cases, 2).map((c) => c.id)).toEqual(['si_q01', 'si_q02'])
    expect(deckOf(null)).toEqual([])
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, difficulty: 1 }))
    expect(deckOf(many)).toHaveLength(8)
  })
})

describe('the tiles', () => {
  const [q15, , q01, q02, q05] = casesOf(SET)

  it('deals the same order for the same run and case, and a permutation of the bank’s own choices', () => {
    const a = dealChoices(q01, 1731100000000)
    expect(dealChoices(q01, 1731100000000)).toEqual(a)
    expect([...a].sort()).toEqual([...q01.choices].sort())
    expect([...dealChoices(q02, 5)].sort()).toEqual([...q02.choices].sort())
  })

  it('keeps True and False in that order, and gives a number case no tiles', () => {
    expect(dealChoices(q05, 99)).toEqual(['True', 'False'])
    expect(dealChoices({ kind: 'numeric', id: 'n' }, 99)).toEqual([])
    expect(dealChoices(null, 1)).toEqual([])
  })

  it('never lets the position give the answer away: over 4,000 runs the answer sits in each slot about a quarter of the time', () => {
    const counts = [0, 0, 0, 0]
    for (let s = 1; s <= 4000; s++) counts[dealChoices(q15, 1731100000000 + s * 997).indexOf('It becomes a market order and sells')] += 1
    for (const n of counts) { expect(n).toBeGreaterThan(850); expect(n).toBeLessThan(1150) }
  })

  it('hashes text to a stable seed in range', () => {
    expect(hashSeed('a')).toBe(hashSeed('a'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
    for (const t of ['', 'x', '1731100000000:si_q01']) { const h = hashSeed(t); expect(h).toBeGreaterThanOrEqual(1); expect(h).toBeLessThan(2147483647) }
  })

  it('finds the answer’s tile the way the server compares', () => {
    expect(rightIndex(['Home', 'oil'], 'home')).toBe(0)
    expect(rightIndex(['A b', 'c'], ' a  b. ')).toBe(0)
    expect(rightIndex(['x'], 'y')).toBe(-1)
    expect(rightIndex(['x'], null)).toBe(-1)
  })
})

describe('what the member gave', () => {
  const [, q08, q01] = casesOf(SET)

  it('reads a typed number, and refuses a guess', () => {
    expect(parseNumber('19.8')).toBe(19.8)
    expect(parseNumber(' 19.8% ')).toBe(19.8)
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('$12.50')).toBe(12.5)
    expect(parseNumber('-$5')).toBe(-5)
    expect(parseNumber('−19.8')).toBe(-19.8)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('131')).toBe(131)
    for (const bad of ['', '-', '.', '19,8', '1,23', '5.', 'abc', '1.2.3', '12e3', null, undefined]) expect(parseNumber(bad)).toBeNull()
  })

  it('keeps only what a number field may hold while typing', () => {
    expect(typedNumber('19.8 %x')).toBe('19.8%')
    expect(typedNumber('1234567890123456789')).toHaveLength(16)
  })

  it('formats numbers as a member reads them', () => {
    expect(fmtNumber(19.8)).toBe('19.8')
    expect(fmtNumber(1565.15)).toBe('1,565.15')
    expect(fmtNumber(131)).toBe('131')
    expect(fmtNumber('x')).toBe('')
    expect(numLabel(q08, 19.8)).toBe('19.8%')
    expect(numLabel({ prefix: '$', suffix: '' }, 12.5)).toBe('$12.5')
    expect(numLabel({ suffix: 'shares' }, 250)).toBe('250 shares')
  })

  it('posts the tile’s label, or the typed number as a number; nothing until there is something', () => {
    const tiles = dealChoices(q01, 7)
    expect(answerFor(q01, { pick: 2, choices: tiles })).toEqual({ choice: tiles[2] })
    expect(answerFor(q01, { pick: null, choices: tiles })).toBeNull()
    expect(answerFor(q08, { text: '19.80' })).toEqual({ choice: 19.8 })
    expect(answerFor(q08, { text: '19,8' })).toBeNull()
    expect(answerFor(null, {})).toBeNull()
    expect(saidOf(q08, { text: '20' })).toBe('20%')
    expect(saidOf(q01, { pick: 1, choices: tiles })).toBe(tiles[1])
    expect(saidOf(q01, { pick: null, choices: tiles })).toBe('')
  })
})

describe('the server’s reply, read into the case file', () => {
  const [q15, q08, q01, q02, q05] = casesOf(SET)
  const tiles = dealChoices(q01, 3)

  it('reads the verdict and the XP, never guessing either', () => {
    expect(verdictOf({ correct: true })).toBe(true)
    expect(verdictOf({ correct: false })).toBe(false)
    expect(verdictOf({ correct: 'yes' })).toBeNull()
    expect(verdictOf(null)).toBeNull()
    expect(xpOf({ progress: { xp_gained: 10 } })).toBe(10)
    expect(xpOf({ progress: { xp_gained: -3 } })).toBe(0)
    expect(xpOf({})).toBe(0)
  })

  it('names the right answer: the pick when right, else the key as its tile', () => {
    const reveal = { answer: { answer: 'The 2007-09 financial crisis' } }
    expect(truthOf(q01, reveal, { said: 'The 2020 COVID crash', correct: false, choices: tiles })).toBe('The 2007-09 financial crisis')
    expect(truthOf(q01, reveal, { said: 'The 2007-09 financial crisis', correct: true, choices: tiles })).toBe('The 2007-09 financial crisis')
    expect(truthOf(q02, { answer: { answer: 'HOME' } }, { said: 'oil', correct: false, choices: q02.choices })).toBe('home')
    expect(truthOf(q05, { answer: { answer: 'false' } }, { said: 'True', correct: false, choices: TF_CHOICES })).toBe('False')
    expect(truthOf(q01, {}, { said: 'x', correct: false, choices: tiles })).toBeNull()
    expect(truthOf(q01, { answer: 'The 2007-09 financial crisis' }, { said: 'x', correct: false, choices: tiles })).toBe('The 2007-09 financial crisis')
  })

  it('reads a number case’s answer from the server’s own number, with its suffix', () => {
    expect(truthOf(q08, NUM_REVEAL, { said: '20%', correct: false })).toBe('19.8%')
    expect(truthOf(q08, NUM_REVEAL, { said: '19.80%', correct: true })).toBe('19.8%')
    expect(truthOf(q08, {}, { said: '19.8%', correct: true })).toBe('19.8%')
    expect(truthOf(q08, {}, { said: '20%', correct: false })).toBeNull()
  })

  it('finds the note the case keeps for the member’s own wrong pick', () => {
    const reveal = { wrong: { 'The 2020 COVID crash': 'It was the fastest, not the deepest. The S&P 500 fell 33.9% from February 19 to March 23, 2020.' } }
    expect(pickNote(reveal, 'The 2020 COVID crash')).toMatch(/^It was the fastest/)
    expect(pickNote(reveal, 'the 2020 covid crash.')).toMatch(/^It was the fastest/)
    expect(pickNote(reveal, 'The 2022 inflation bear')).toBe('')
    expect(pickNote({}, 'x')).toBe('')
    expect(pickNote(reveal, '')).toBe('')
  })

  it('gives why without the verdict the screen already shows, and keeps a first sentence that says more', () => {
    expect(reasonOf(NUM_REVEAL, '19.8%')).toMatch(/^From 2,930.75 down to 2,351.10/)
    expect(reasonOf({ why: 'False. The S&P 500 hit its trough in March 2009, but the recession ran until June 2009.' }, 'False')).toMatch(/^The S&P 500 hit its trough/)
    expect(reasonOf({ why: 'False. It ran on.' }, null)).toBe('It ran on.')
    expect(reasonOf({ why: 'The debt-limit fight and Europe’s crisis. Stocks fell sharply.' }, 'Debt-limit fight and Europe’s crisis')).toBe('Stocks fell sharply.')
    const keep = { why: 'It fell to a new low. The S&P 500 rose from 3,666.77 on June 16 to 4,305.20 on August 16.' }
    expect(reasonOf(keep, 'Fell to a new low within two months')).toBe(keep.why)
    expect(reasonOf({ lesson: 'Only the lesson.' })).toBe('Only the lesson.')
    expect(reasonOf({})).toBe('')
  })

  it('reads the lesson line and the sources: each once, short names, quotes grouped, only safe links', () => {
    expect(lessonLineOf(NUM_REVEAL)).toBe('Measure from the closing peak. Late 2018 came within a hair of 20%, then turned.')
    const reveal = { depth: { sources: [
      { name: 'Federal Reserve History (Federal Reserve System): The Great Recession (Robert Rich, written as of November 22, 2013)', url: 'https://www.federalreservehistory.org/essays/great-recession-of-200709', quote: 'the S&P 500 index fell 57 percent' },
      { name: 'Federal Reserve History (Federal Reserve System): The Great Recession (Robert Rich, written as of November 22, 2013)', url: 'https://www.federalreservehistory.org/essays/great-recession-of-200709', quote: 'The Great Recession began in December 2007' },
      { name: 'CNBC: A page', url: 'javascript:alert(1)', quote: '' },
      { name: '', url: 'https://x.test' },
    ] } }
    const src = sourcesOf(reveal)
    expect(src).toHaveLength(2)
    expect(src[0].name).toBe('Federal Reserve History: The Great Recession')
    expect(src[0].quotes).toHaveLength(2)
    expect(src[0].url).toMatch(/^https:\/\/www\.federalreservehistory\.org/)
    expect(src[1]).toMatchObject({ name: 'CNBC: A page', url: null, quotes: [] })
    expect(sourcesOf({})).toEqual([])
  })

  it('reads the chart’s ticker and last day only for a chart case', () => {
    const reveal = { sym: 'spy', asof: '2009-03-09' }
    expect(chartFactsOf(q05, reveal)).toEqual({ sym: 'SPY', date: 'March 9, 2009', short: 'Mar 9, 2009', fund: fundNote('SPY') })
    expect(chartFactsOf(q01, reveal)).toBeNull()
    expect(chartFactsOf(q05, {})).toBeNull()
    expect(chartFactsOf(q05, { sym: '<b>', asof: '2009-03-09' })).toMatchObject({ sym: null, date: 'March 9, 2009', fund: '' })
    expect(q15.chart).toBe(false)
  })
})

describe('dates and funds', () => {
  it('formats a real calendar day, and refuses one that is not', () => {
    expect(longDate('2009-03-09')).toBe('March 9, 2009')
    expect(longDate(20021009)).toBe('October 9, 2002')
    expect(shortDate('2018-12-24T00:00:00Z')).toBe('Dec 24, 2018')
    expect(partsOf('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 })
    for (const bad of ['2023-02-29', '2009-13-01', '2009-00-10', '2009-04-31', 'soon', '', null]) expect(longDate(bad)).toBe('')
  })

  it('says a fund chart is the fund, not the index', () => {
    expect(fundNote('SPY')).toBe('SPY is a fund that tracks the S&P 500. Its moves follow the index closely, not exactly.')
    expect(fundNote('qqq')).toMatch(/^QQQ is a fund that tracks the Nasdaq-100/)
    expect(fundNote('AAPL')).toBe('')
    expect(Object.keys(FUNDS)).toEqual(['SPY', 'QQQ'])
  })
})

describe('the working', () => {
  it('shows the fall, worked from the inputs, when it rounds to the server’s answer (F7.08 q08: 19.8%)', () => {
    const w = workingOf(NUM_REVEAL)
    expect(w).toEqual({ label: 'The fall', formula: '(peak − low) ÷ peak', filled: '(2,930.75 − 2,351.10) ÷ 2,930.75', result: '19.8%',
      text: 'The fall = (peak − low) ÷ peak = (2,930.75 − 2,351.10) ÷ 2,930.75 = 19.8%' })
  })

  it('works the Nasdaq’s 78% (q13) and the 131% gain back to the 2007 peak (q17)', () => {
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 5048.62, trough: 1114.11 }, result: 78 } } }).text)
      .toBe('The fall = (peak − low) ÷ peak = (5,048.62 − 1,114.11) ÷ 5,048.62 = 78%')
    expect(workingOf({ facts: { calc: { fn: 'pct_change', args: { start: 676.53, end: 1565.15 }, result: 131 } } }).text)
      .toBe('The gain = (end − start) ÷ start = (1,565.15 − 676.53) ÷ 676.53 = 131%')
    expect(workingOf({ facts: { calc: { fn: 'gain_to_recover', args: { loss_pct: 56.8 }, result: 131.5 } } }).text)
      .toBe('The gain back to even = 1 ÷ (1 − the loss) − 1 = 1 ÷ (1 − 56.8%) − 1 = 131.5%')
    expect(workingOf({ facts: { calc: { fn: 'pct_change', args: { start: 4796.56, end: 3577.03 }, result: -25.4 } } }).label).toBe('The change')
  })

  it('shows nothing rather than a line that disagrees with the server, or one it cannot work', () => {
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 2930.75, trough: 2351.1 }, result: 21.3 } } })).toBeNull()
    // to the decimals the server's result carries: 19.78 is the same fall at two decimals, 19.77 is not
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 2930.75, trough: 2351.1 }, result: 19.78 } } }).result).toBe('19.78%')
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 2930.75, trough: 2351.1 }, result: 19.77 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'arith', args: { expr: '1+1' }, result: 2 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 0, trough: 1 }, result: 1 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: '10', trough: 5 }, result: 50 } } })).toBeNull()
    expect(workingOf({ facts: { calc: { fn: 'drawdown_pct', args: { peak: 10, trough: 5 } } } })).toBeNull()
    expect(workingOf({})).toBeNull()
  })
})

describe('the screen’s words', () => {
  const [q15, q08, q01, q02, q05] = casesOf(SET)

  it('names each case’s kind', () => {
    expect([q15, q08, q01, q02, q05].map(kindWord)).toEqual(['Scenario', 'Do the math', 'Recall', 'Fill the blank', 'Read the chart'])
    // a scenario told over a chart (F7.08 q15 and q20) is still a scenario
    expect(kindWord({ ...q15, chart: true })).toBe('Scenario')
    expect(kindWord(null)).toBe('')
  })

  it('puts the question in one place only', () => {
    expect(caseText(q01)).toEqual({ big: q01.q, story: '', question: 'Pick the answer.' })
    expect(caseText(q08).question).toBe('Work it out.')
    expect(caseText(q02)).toEqual({ big: q02.sentence, story: '', question: q02.q })
    expect(caseText(q05)).toEqual({ big: '', story: '', question: q05.q })
    expect(caseText(q15)).toMatchObject({ big: q15.q, story: q15.story, question: 'Pick the answer.' })
    expect(caseText(null)).toEqual({ big: '', story: '', question: '' })
  })

  it('helps on a desktop, and on a phone only where the keys are not obvious', () => {
    expect(detailOf(q01)).toBe('Pick one, or press its number. Enter checks.')
    expect(detailOf(q01, true)).toBe('')
    expect(detailOf(q08, true)).toBe('Type the number, then Check.')
    expect(detailOf(q02)).toMatch(/^Pick the word/)
  })

  it('clips a long line at a word', () => {
    expect(clip('short')).toBe('short')
    const c = clip('word '.repeat(60), 40)
    expect(c.length).toBeLessThanOrEqual(41)
    expect(c.endsWith('…')).toBe(true)
  })

  it('writes no long dash, no exclamation and never our old name in its member copy', () => {
    for (const line of [EMPTY_LINE, FAILED_LINE, SIGNED_OUT_LINE, NUMBER_HINT, fundNote('SPY'), heartsLine(2), rankOf(3, 8), thinLine(1), thinLine(2)]) {
      expect(line).not.toMatch(/[—–!]|\bfirm\b/i)
    }
    expect(EMPTY_LINE).toBe('No questions in this game yet. They arrive as the courses are approved.')
  })

  it('says a thin draw as it is, never "no questions" when there are some', () => {
    expect(thinLine(1)).toBe('Only 1 case is approved so far, too few for a run. More arrive as the courses are approved.')
    expect(thinLine(2)).toBe('Only 2 cases are approved so far, too few for a run. More arrive as the courses are approved.')
  })
})

describe('the run', () => {
  const [, , q01, , q05] = casesOf(SET)

  it('counts the hearts and ends the run when they are gone or the cases are done', () => {
    expect(heartsLeft([])).toBe(3)
    expect(heartsLeft([true, false, true])).toBe(2)
    expect(heartsLeft([false, false, false, false])).toBe(0)
    expect(runOver([true, false], 8)).toBe(false)
    expect(runOver([false, false, false], 8)).toBe(true)
    expect(runOver([true, true], 2)).toBe(true)
    expect(heartsLine(2)).toBe('2 hearts left')
    expect(heartsLine(1)).toBe('1 heart left')
    expect(heartsLine(0)).toBe('Out of hearts')
    expect(solvedOf([true, false, true])).toBe(2)
  })

  it('keeps each case as a row: the question, the ticker and day, the lesson, the first source', () => {
    const reveal = { sym: 'SPY', asof: '2009-03-09', lesson_line: 'In 2009 stocks turned while the recession was still on.', depth: { sources: [{ name: 'NBER Business Cycle Dating Committee: Announcement', url: 'https://www.nber.org/x', quote: 'q' }] } }
    const row = rowOf(q05, { ok: false, said: 'True', truth: 'False', reveal, xp: 2 })
    expect(row).toEqual({ id: 'si_q05', ok: false, xp: 2, name: q05.q, said: 'True', truth: 'False', chart: 'SPY · Mar 9, 2009',
      line: 'In 2009 stocks turned while the recession was still on.', source: { name: 'NBER Business Cycle Dating Committee: Announcement', full: 'NBER Business Cycle Dating Committee: Announcement', url: 'https://www.nber.org/x' } })
    expect(rowOf(q01, { ok: true, said: 'x', truth: 'x' })).toMatchObject({ chart: '', source: null, line: '' })
  })

  it('adds a case to the run: its result, its row and the XP the server granted', () => {
    let run = { results: [], log: [], xp: 0 }
    run = addCase(run, { ok: true, xp: 10 })
    run = addCase(run, { ok: false, xp: 2 })
    expect(run.results).toEqual([true, false])
    expect(run.log).toHaveLength(2)
    expect(run.xp).toBe(12)
    expect(addCase(null, { ok: true }).results).toEqual([true])
  })

  it('ranks the detective by the share solved, and keeps the best', () => {
    expect(rankOf(8, 8)).toBe('Chief Detective')
    expect(rankOf(6, 8)).toBe('Senior Detective')
    expect(rankOf(4, 8)).toBe('Detective')
    expect(rankOf(1, 8)).toBe('Junior Detective')
    expect(rankOf(0, 0)).toBe('No cases solved')
    expect(bestAfter(5, 3)).toBe(5)
    expect(bestAfter(undefined, 3)).toBe(3)
  })

  it('says the best line only when there is one: a new best, the standing best, never a best of 0', () => {
    expect(bestLine(3, 0)).toEqual({ fresh: true, n: 3 })
    expect(bestLine(3, 5)).toEqual({ fresh: false, n: 5 })
    expect(bestLine(5, 5)).toEqual({ fresh: false, n: 5 })
    expect(bestLine(0, 2)).toEqual({ fresh: false, n: 2 })
    expect(bestLine(0, 0)).toBeNull()
    expect(bestLine(undefined, undefined)).toBeNull()
  })
})
