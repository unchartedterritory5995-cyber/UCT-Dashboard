/**
 * Sector Race, the pure half (docs/study/GAMES.md §1 rule 6): every formula and generator with known values. The draw
 * (what the tiles can answer, the bank's own strings posted as stored, our name on screen), the deal (seeded, the easier
 * rungs first, the tiles in their own seeded order so the answer the courses write first is not always tile 1), the key
 * (the right tile from the verdict and the server's key, never a guess), the lines a miss teaches (the bank's words, the
 * verdict sentence dropped only when it restates the answer on screen), the run (Blitz's multiplier, a leg per right
 * answer, the line and its bonus) and the clock. The fixtures are F7.09's own questions as the bank builds them
 * (scripts/study/courses_lib.build_items), trimmed.
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_LINE, EMPTY_RUN, FALSE, FINISH_POINTS_PER_SEC, LEG_M, LOST_LINE, RACE_MIN, RACE_SECS, RACE_SIZE, READ_MS_PER_WORD,
  SECTORS_SKILL, TAKEOVER_FADE_IN_MS, TAKEOVER_MAX_MS, TAKEOVER_MIN_MS, TRUE, applyCall, applyLost, choicesOf, crossed,
  dealChoices, deckOf, distanceLine, distanceOf, endOf, figuresOf, finishBonus, hashOf, keyIndex, kindOf, lineOf, metres,
  missLine, missWhy, norm, pointsFor, progressPct, questionsOf, raceMult, raceVerdict, reasonOf, restates, rowOf, secsOf,
  sessionBody, shortSource, sourceFor, startRun, takeoverMs, tickClock, titleOf, topMult, trackLabel, trackOf, truthOf,
  verdictOf, verdictTitle, wrongOf,
} from './sectorRace'
import { blitzMult } from '../challengeBank'

const SRC = { name: 'SEC EDGAR: Prospectus, January 2023: returns for periods ending 12/31/22', url: 'https://www.sec.gov/x', quote: 'q' }
const item = (id, prompt_json, extra = {}) => ({ id, version: 1, type: 'recall', skill_id: SECTORS_SKILL, module: 'F7', difficulty: 2, prompt_json, tier_scale_id: null, has_chart: false, ...extra })

// F7.09 q08, q09, q04, q12, q01 and q11 (the typed number), as a member receives them (no `subject`, no key)
const Q08 = item('si_q08', { q: 'In 2022 the S&P 500 lost 18.11%. Which sector index did best?', kind: 'mcq', choices: ['Energy', 'Utilities', 'Technology', 'Consumer Staples'] })
const Q09 = item('si_q09', { q: 'In 2022 the S&P 500 lost 18.11%. The utilities, staples and health care indexes each finished within 3% of flat.', kind: 'tf', choices: ['True', 'False'] })
const Q04 = item('si_q04', { q: 'Fill in the blank.', kind: 'fill', sentence: 'Divide a sector fund by the S&P 500 and chart it. A rising line shows relative ___.', bank: ['strength', 'weakness', 'volume', 'value'] }, { difficulty: 1 })
const Q12 = item('si_q12', { q: 'How did energy do in 2021?', kind: 'mcq', story: '2020: the energy index loses 32.84% while the S&P 500 gains 18.40%. A friend says energy is finished and you should ignore it in 2021.', choices: ['It was the best sector that year', 'It fell again and kept lagging', 'It roughly matched the S&P 500'] }, { type: 'scenario', difficulty: 3 })
const Q01 = item('si_q01', { q: 'GICS sorts stocks into sectors. How many sectors does it have?', kind: 'mcq', choices: ['11', '9', '25', '163'] }, { difficulty: 1 })
const Q11 = item('si_q11', { q: 'In 2022 the energy index returned 64.56% and the S&P 500 returned -18.11%. By how many points did energy beat it?', kind: 'fill_numeric', suffix: 'points' })
const SET = { session_id: 'sess-1', kind: 'skill', items: [Q08, Q09, Q04, Q12, Q01, Q11] }

const REVEAL_Q08 = {
  unit: 'F7.09', why: 'Energy, by a mile. The energy index gained 64.56%. The next best, utilities, gained 1.57%.',
  lesson_line: 'Even in a bad year, some group leads. In 2022 it was energy.', facts: {},
  depth: { summary: '', sources: [SRC] }, answer: { answer: 'Energy' },
  wrong: { Utilities: 'Utilities came second, up 1.57%. Energy gained 64.56%.', Technology: 'Tech fell hard as rates rose.' },
}

describe('the draw', () => {
  it('asks for one skill session of the Sector leadership questions', () => {
    expect(sessionBody()).toEqual({ kind: 'skill', skill_id: 'history.sectors', size: 10 })
    expect(RACE_SIZE).toBe(10)
    expect(RACE_SECS).toBe(60)
    expect(RACE_MIN).toBe(4)
  })

  it('reads a prompt kind the way the lesson player does', () => {
    expect(kindOf({ kind: 'mcq', choices: ['a', 'b'] })).toBe('mcq')
    expect(kindOf({ bank: ['a', 'b'], sentence: 'x ___' })).toBe('fill')
    expect(kindOf({ sentence: 'x ___' })).toBe('fill_numeric')
    expect(kindOf({ q: 'x' })).toBe('tf')
    expect(kindOf({ choices: ['a', 'b'] })).toBe('mcq')
    expect(kindOf(null)).toBe('')
  })

  it('keeps every question the tiles can answer, with the session id, and leaves out a typed number', () => {
    const qs = questionsOf(SET)
    expect(qs.map((q) => q.id)).toEqual(['si_q08', 'si_q09', 'si_q04', 'si_q12', 'si_q01'])
    expect(qs.every((q) => q.sessionId === 'sess-1')).toBe(true)
    const [q08, q09, q04, q12] = qs
    expect(q08).toMatchObject({ kind: 'mcq', scenario: false, q: Q08.prompt_json.q, story: '', difficulty: 2, skill: 'history.sectors' })
    expect(q08.choices.map((c) => c.value)).toEqual(['Energy', 'Utilities', 'Technology', 'Consumer Staples'])
    expect(q09.kind).toBe('tf')
    expect(q09.choices).toEqual([{ value: 'True', label: 'True' }, { value: 'False', label: 'False' }])
    expect(q04).toMatchObject({ kind: 'fill', sentence: Q04.prompt_json.sentence, difficulty: 1 })
    expect(q04.choices.map((c) => c.value)).toEqual(['strength', 'weakness', 'volume', 'value'])
    expect(q12).toMatchObject({ kind: 'mcq', scenario: true, story: Q12.prompt_json.story, difficulty: 3 })
  })

  it('posts the bank\'s own string and shows our name: a label is cleaned, its value never is', () => {
    const p = { kind: 'mcq', choices: ['What the firm calls a leader', 'A laggard — by far', 'A fund'] }
    expect(choicesOf(p, 'mcq')).toEqual([
      { value: 'What the firm calls a leader', label: 'What UCT calls a leader' },
      { value: 'A laggard — by far', label: 'A laggard, by far' },
      { value: 'A fund', label: 'A fund' },
    ])
  })

  it('refuses tiles it cannot deal honestly', () => {
    expect(choicesOf({ choices: ['Only one'] }, 'mcq')).toBeNull()
    expect(choicesOf({ choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 'mcq')).toBeNull()
    expect(choicesOf({ choices: ['Energy', ' energy '] }, 'mcq')).toBeNull()          // two tiles the server reads as one
    expect(choicesOf({ choices: ['Yes', 'No'] }, 'tf')).toBeNull()                    // a statement with the wrong buttons
    expect(choicesOf({}, 'tf')).toEqual([{ value: 'True', label: 'True' }, { value: 'False', label: 'False' }])
    expect(choicesOf({ choices: ['false', 'TRUE'] }, 'tf').map((c) => c.value)).toEqual(['True', 'False'])
  })

  it('leaves out a chart question, a duplicate, a blank-less fill-in, an empty prompt and junk', () => {
    const qs = questionsOf({ session_id: 's', items: [
      Q08, { ...Q08 }, { ...Q08, id: 'si_dup_words' },
      item('si_chart', { q: 'What led on this chart?', kind: 'mcq', choices: ['a', 'b'] }, { has_chart: true }),
      item('si_bars', { q: 'And this one?', kind: 'mcq', choices: ['a', 'b'] }, { bars: { bars: [] } }),
      item('si_noblank', { q: 'Fill in the blank.', kind: 'fill', sentence: 'No blank here.', bank: ['a', 'b'] }),
      item('si_noq', { q: '', kind: 'mcq', choices: ['a', 'b'] }),
      item('', { q: 'No id', kind: 'mcq', choices: ['a', 'b'] }),
      // a walk-through (F7.09 w1 as the bank builds it): no kind, no choices; read as a prompt it would deal as true/false
      item('si_walk', { q: 'Eleven sectors, one market', steps: ['GICS puts each company in one of 11 sectors.'], order: 1, part: 1, parts: 3 }, { type: 'walkthrough' }),
      item('si_steps', { q: 'Steps with no type', steps: ['One step.'] }),
      null, 'x', { id: 'si_noprompt' },
    ] })
    expect(qs.map((q) => q.id)).toEqual(['si_q08'])
    expect(questionsOf(null)).toEqual([])
    expect(questionsOf({ items: 'x' })).toEqual([])
    expect(questionsOf({ items: [Q08] })[0].sessionId).toBeNull()                  // no session: the attempt goes without one
  })

  it('says each question as one line for the log', () => {
    const [q08, , q04, q12] = questionsOf(SET)
    expect(titleOf(q08)).toBe(Q08.prompt_json.q)
    expect(titleOf(q04)).toBe(Q04.prompt_json.sentence)
    expect(titleOf(q12)).toBe(`${Q12.prompt_json.story} ${Q12.prompt_json.q}`)
    expect(titleOf(null)).toBe('')
  })
})

describe('the deal', () => {
  const qs = questionsOf(SET)

  it('is the same for the same seed, and puts the easier rungs first', () => {
    const a = deckOf(qs, 1731100000000)
    const b = deckOf(qs, 1731100000000)
    expect(a).toEqual(b)
    expect(a.map((q) => q.difficulty)).toEqual([1, 1, 2, 2, 3])
    expect(new Set(a.map((q) => q.id))).toEqual(new Set(qs.map((q) => q.id)))
    expect(deckOf([], 1)).toEqual([])
    expect(deckOf(null, 1)).toEqual([])
  })

  it('changes with the seed', () => {
    const orders = new Set()
    for (let s = 1; s <= 40; s++) orders.add(deckOf(qs, 1731100000000 + s * 1000).map((q) => q.id + q.choices.map((c) => c.value).join('')).join('|'))
    expect(orders.size).toBeGreaterThan(10)
  })

  it('keeps True first on a statement', () => {
    for (let s = 1; s <= 25; s++) expect(dealChoices(qs[1], s).map((c) => c.value)).toEqual([TRUE, FALSE])
  })

  it('deals the tiles so the answer, written first by the course, lands in every slot about equally', () => {
    // over 4,000 seeds the stored first tile (the answer, in F7.09) sits in each of the four slots 25% of the time, +/- 3%
    const slots = [0, 0, 0, 0]
    const N = 4000
    for (let s = 1; s <= N; s++) slots[dealChoices(qs[0], 1700000000000 + s * 7919).findIndex((c) => c.value === 'Energy')] += 1
    for (const k of slots) expect(Math.abs(k / N - 0.25)).toBeLessThan(0.03)
    // and the same seed always deals the same order; every tile is kept
    expect(dealChoices(qs[0], 99)).toEqual(dealChoices(qs[0], 99))
    expect(dealChoices(qs[0], 99).map((c) => c.value).sort()).toEqual(['Consumer Staples', 'Energy', 'Technology', 'Utilities'])
  })

  it('hashes a string to a stable 32-bit number', () => {
    expect(hashOf('')).toBe(2166136261)
    expect(hashOf('a')).toBe(3826002220)          // FNV-1a of "a"
    expect(hashOf('si_q08')).toBe(hashOf('si_q08'))
    expect(hashOf('si_q08')).not.toBe(hashOf('si_q09'))
  })

  it('maps a key to a tile: numbers on every question, T and F on a statement', () => {
    const [q08, q09] = qs
    expect(keyIndex(q08, '1')).toBe(0)
    expect(keyIndex(q08, '4')).toBe(3)
    expect(keyIndex(q08, '5')).toBe(-1)
    expect(keyIndex(q08, '0')).toBe(-1)
    expect(keyIndex(q08, 't')).toBe(-1)
    expect(keyIndex(q09, 't')).toBe(0)
    expect(keyIndex(q09, 'F')).toBe(1)
    expect(keyIndex(q09, '2')).toBe(1)
    expect(keyIndex(q09, '3')).toBe(-1)
    expect(keyIndex(null, '1')).toBe(-1)
  })
})

describe('the verdict and the key', () => {
  const [q08, q09] = questionsOf(SET)

  it('reads a verdict only when the reply carries one', () => {
    expect(verdictOf({ correct: true })).toBe(true)
    expect(verdictOf({ correct: false })).toBe(false)
    expect(verdictOf({ correct: null })).toBeNull()
    expect(verdictOf({ reveal: {} })).toBeNull()
    expect(verdictOf(null)).toBeNull()
  })

  it('compares the way the server does: case and spacing never matter', () => {
    expect(norm('  Consumer   STAPLES ')).toBe('consumer staples')
    expect(norm(true)).toBe('true')
    expect(norm(null)).toBe('')
    expect(norm(11)).toBe('11')
  })

  it('finds the right tile from the key, in any of its shapes', () => {
    expect(truthOf(q08, 'Energy', true, null).value).toBe('Energy')
    expect(truthOf(q08, 'Utilities', false, { answer: { answer: 'Energy' } }).value).toBe('Energy')
    expect(truthOf(q08, 'Utilities', false, { answer: 'energy' }).value).toBe('Energy')
    expect(truthOf(q08, 'Utilities', false, { answer: { answer: 'Oil', accept: ['ENERGY'] } }).value).toBe('Energy')
    expect(truthOf(q08, 'Utilities', false, { detail: { expected: 'Energy' } }).value).toBe('Energy')
  })

  it('shows no answer rather than a wrong one', () => {
    expect(truthOf(q08, 'Utilities', false, null)).toBeNull()                                  // no key in the reply
    expect(truthOf(q08, 'Utilities', false, { answer: { answer: 'Materials' } })).toBeNull()   // a key no tile carries
    expect(truthOf(q08, 'Utilities', false, { answer: { answer: 'Utilities' } })).toBeNull()   // the key names the member's own tile
  })

  it('on a statement, a miss means the other tile', () => {
    expect(truthOf(q09, 'False', false, null).value).toBe('True')
    expect(truthOf(q09, 'True', false, { answer: { answer: 'True' } }).value).toBe('False')   // the verdict wins
  })
})

describe('the lines a miss teaches', () => {
  it('knows a sentence that only restates the answer', () => {
    expect(restates('Energy, by a mile.', 'Energy')).toBe(true)
    expect(restates('11.', '11')).toBe(true)
    expect(restates('It was the best sector that year.', 'It was the best sector that year')).toBe(true)
    expect(restates('False.', null)).toBe(true)
    expect(restates('Consumer discretionary.', 'Consumer Discretionary')).toBe(true)
    expect(restates('110 stocks rose.', '11')).toBe(false)
    expect(restates('Energyless markets rarely last.', 'Energy')).toBe(false)
    expect(restates('The energy index gained 64.56%.', 'Energy')).toBe(false)
    expect(restates('', 'Energy')).toBe(false)
  })

  it('gives why without the verdict, two sentences while they are short', () => {
    expect(reasonOf(REVEAL_Q08, 'Energy')).toBe('The energy index gained 64.56%. The next best, utilities, gained 1.57%.')
    expect(reasonOf({ why: 'False. GICS gives each company one spot at each level, set by its main business. The first test is the activity that brings in more than 60% of revenue.' }, 'False'))
      .toBe('GICS gives each company one spot at each level, set by its main business. The first test is the activity that brings in more than 60% of revenue.')
  })

  it('keeps the verdict when the answer is not known, so the line still names it', () => {
    expect(reasonOf(REVEAL_Q08, null)).toBe('Energy, by a mile. The energy index gained 64.56%.')
  })

  it('stops at one sentence when two run long, and always keeps a sentence that turns on the first', () => {
    const long = { why: 'Energy. One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen. One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.' }
    expect(reasonOf(long, 'Energy')).toBe('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.')
    const turn = { why: 'Energy. One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen. But one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.' }
    expect(reasonOf(turn, 'Energy')).toMatch(/sixteen\. But one/)
  })

  it('is empty when there is nothing past the verdict, cleans our name and the dashes', () => {
    expect(reasonOf({ why: 'Energy.' }, 'Energy')).toBe('')
    expect(reasonOf({}, 'Energy')).toBe('')
    expect(reasonOf({ why: 'Energy. The firm watched it lead — all year.' }, 'Energy')).toBe('UCT watched it lead, all year.')
  })

  it('finds the unit\'s note on the tile the member picked', () => {
    expect(wrongOf(REVEAL_Q08, 'utilities')).toBe('Utilities came second, up 1.57%. Energy gained 64.56%.')
    expect(wrongOf(REVEAL_Q08, 'Consumer Staples')).toBe('')
    expect(wrongOf({ wrong: ['x'] }, 'x')).toBe('')
    expect(wrongOf(null, 'x')).toBe('')
    expect(lineOf(REVEAL_Q08)).toBe('Even in a bad year, some group leads. In 2022 it was energy.')
    expect(lineOf({})).toBe('')
  })

  it('keeps one row per answer, with the answer, the call, why, the note, the line and the source', () => {
    const [q08, q09] = questionsOf(SET)
    const miss = rowOf({ question: q08, said: 'Utilities', correct: false, reveal: REVEAL_Q08 })
    expect(miss).toEqual({
      id: 'si_q08', title: Q08.prompt_json.q, kind: 'mcq', ok: false, said: 'Utilities', truth: 'Energy',
      reason: 'The energy index gained 64.56%. The next best, utilities, gained 1.57%.',
      wrong: 'Utilities came second, up 1.57%. Energy gained 64.56%.',
      line: 'Even in a bad year, some group leads. In 2022 it was energy.',
      source: { name: SRC.name, full: SRC.name, url: 'https://www.sec.gov/x' },
    })
    expect(verdictTitle(miss)).toBe('Not this one.')
    expect(missWhy(miss)).toBe(miss.wrong)                                              // the note on their own pick leads
    expect(missWhy({ ...miss, wrong: '' })).toBe(miss.reason)
    const hit = rowOf({ question: q08, said: 'Energy', correct: true, reveal: REVEAL_Q08 })
    expect(hit).toMatchObject({ ok: true, said: 'Energy', truth: 'Energy', wrong: '' })
    const tf = rowOf({ question: q09, said: 'False', correct: false, reveal: { why: 'True. Utilities gained 1.57%.' } })
    expect(tf).toMatchObject({ truth: 'True', reason: 'Utilities gained 1.57%.' })
    expect(verdictTitle(tf)).toBe("It's true.")
    expect(verdictTitle(null)).toBe('Not this one.')
  })

  it('reads the figures a line states, each once', () => {
    expect(figuresOf('Energy gained 64.56%. The S&P 500 lost 18.11% in 2022.')).toEqual(['64.56', '18.11', '2022'])   // "S&P 500" is a name
    expect(figuresOf('A 1,000 m track, 1,000 again.')).toEqual(['1000'])
    expect(figuresOf('In 2021, energy rose.')).toEqual(['2021'])                                  // the comma ends the figure
    expect(figuresOf('18.40% and 0.70%')).toEqual(['18.4', '0.7'])                                // written either way, one figure
    expect(figuresOf('Q1 and 3% are too common to tell sources apart.')).toEqual([])
    expect(figuresOf('Highest Quarterly Return 38.97% Q1 2022 Lowest Quarterly Return -50.72% Q1 2020')).toEqual(['38.97', '2022', '50.72', '2020'])
    expect(figuresOf(null)).toEqual([])
  })

  // F7.09's own citations, as the bank builds them (names and quotes as the unit wrote them): the first page cited is not
  // always the one a line's figures come from
  const SEC = 'SEC EDGAR (Select Sector SPDR Trust, Form 485BPOS): Prospectus, '
  const JAN21 = { name: `${SEC}January 2021: returns for periods ending 12/31/20`, url: 'https://www.sec.gov/2021', quote: 'Energy Select Sector Index (reflects no deduction for fees, expenses or taxes) -32.84%' }
  const SPX21 = { name: JAN21.name, url: 'https://www.sec.gov/2021', quote: 'S&P 500 Index (reflects no deduction for fees, expenses or taxes) 18.40%' }
  const JAN22 = { name: `${SEC}January 2022: returns for periods ending 12/31/21`, url: 'https://www.sec.gov/2022', quote: 'Energy Select Sector Index (reflects no deduction for fees, expenses or taxes) 53.43%' }
  const SPX22 = { name: JAN22.name, url: 'https://www.sec.gov/2022', quote: 'S&P 500 Index (reflects no deduction for fees, expenses or taxes) 28.71%' }
  const CNBC21 = { name: 'CNBC: S&P 500 ends 2021 with a nearly 27% gain, but dips in final trading day', url: 'https://www.cnbc.com/2021', quote: 'Energy and real estate were the best-performing sectors in the S&P 500 this year, surging more than 40% each.' }
  const FED20 = { name: 'Federal Reserve Board: Monetary Policy Report, June 2020, Part 1: Recent Economic and Financial Developments', url: 'https://www.federalreserve.gov/2020', quote: 'The decline in stock prices was widespread across all sectors, with the largest declines in the energy and banking sectors.' }
  const XLP = { name: `${SEC}January 2026: fund summaries, returns for periods ending 12/31/25`, url: 'https://www.sec.gov/2026', quote: 'Highest Quarterly Return 12.77% Q4 2021 Lowest Quarterly Return -12.99% Q1 2020' }
  const REVEAL_Q12 = {
    why: 'It was the best sector that year. The energy index gained 53.43% against 28.71% for the S&P 500. Real estate came next at 46.19%.',
    lesson_line: "Last year's ranking isn't this year's. Judge a group by what it's doing now.",
    answer: { answer: 'It was the best sector that year' }, depth: { sources: [JAN21, SPX21, JAN22, SPX22, CNBC21] },
    wrong: { 'It fell again and kept lagging': 'The opposite. Cyclical stocks, energy among them, beat the broad indexes in early 2021, and energy finished the year up 53.43%.' },
  }

  it('names the page a line\'s figures come from, not just the first one cited', () => {
    // q12: energy's 2021 gain is in the January 2022 prospectus; the first page cited is the January 2021 one (the story's 2020)
    const note = REVEAL_Q12.wrong['It fell again and kept lagging']
    expect(sourceFor(REVEAL_Q12, [note, REVEAL_Q12.lesson_line])).toEqual({ name: shortSource(JAN22.name), full: JAN22.name, url: 'https://www.sec.gov/2022' })
    // q16: "XLP fell 12.99% that quarter" is in the fund summaries, not in the Fed's report cited first
    expect(sourceFor({ depth: { sources: [FED20, XLP] } }, ['Those held up far better. XLP fell 12.99% that quarter and XLU 13.53%.']).url).toBe('https://www.sec.gov/2026')
    // a line that only names the index never picks a page for the index's name: CNBC's "S&P 500" is not a figure
    expect(sourceFor({ depth: { sources: [JAN21, CNBC21] } }, ['The S&P 500 led.']).url).toBe('https://www.sec.gov/2021')
  })

  it('weighs the first line before the next, and keeps the unit\'s order on a tie or with no figures', () => {
    const rev = { depth: { sources: [JAN21, SPX21, CNBC21, JAN22] } }
    // the first line's 53.43 decides, though the second line's figure is on another page
    expect(sourceFor({ depth: { sources: [SPX21, JAN22] } }, ['Up 53.43%.', 'The S&P 500 gained 18.40%.']).url).toBe('https://www.sec.gov/2022')
    // a tie on the first line is broken by the next one
    const twoPages = { depth: { sources: [SPX21, JAN22] } }
    expect(sourceFor(twoPages, ['53.43% against 18.40%.']).url).toBe('https://www.sec.gov/2021')            // a tie: the unit's order
    expect(sourceFor(twoPages, ['53.43% against 18.40%.', 'Energy 53.43%.']).url).toBe('https://www.sec.gov/2022')
    // no figures on screen: the first page cited, as before
    expect(sourceFor(rev, ['Judge a group by what it is doing now.']).url).toBe('https://www.sec.gov/2021')
    expect(sourceFor(rev, []).full).toBe(JAN21.name)
    // nothing cited, or nothing with a name
    expect(sourceFor({}, ['53.43'])).toBeNull()
    expect(sourceFor({ depth: { sources: [{ name: ' ', quote: '53.43' }, null] } }, ['53.43'])).toBeNull()
    expect(sourceFor(null)).toBeNull()
  })

  it('keeps the row\'s source on the page behind what the takeover shows', () => {
    const [, , , q12] = questionsOf(SET)
    const miss = rowOf({ question: q12, said: 'It fell again and kept lagging', correct: false, reveal: REVEAL_Q12 })
    expect(miss.source).toEqual({ name: shortSource(JAN22.name), full: JAN22.name, url: 'https://www.sec.gov/2022' })   // the note's 53.43%
    const other = rowOf({ question: q12, said: 'It roughly matched the S&P 500', correct: false, reveal: REVEAL_Q12 })
    expect(other.wrong).toBe('')                                                   // no note: the takeover shows why
    expect(other.source.url).toBe('https://www.sec.gov/2022')                      // why's 53.43%
    const hit = rowOf({ question: q12, said: 'It was the best sector that year', correct: true, reveal: REVEAL_Q12 })
    expect(hit.source.url).toBe('https://www.sec.gov/2022')
  })

  it('holds a miss as long as it takes to read, between its floor and its ceiling', () => {
    expect(takeoverMs('')).toBe(TAKEOVER_MIN_MS)
    expect(takeoverMs('one two three four five six seven eight nine ten')).toBe(TAKEOVER_FADE_IN_MS + 10 * READ_MS_PER_WORD)   // 3,400
    expect(takeoverMs('one two three four five', 'six seven eight nine ten')).toBe(3400)
    expect(takeoverMs('word '.repeat(80))).toBe(TAKEOVER_MAX_MS)
  })
})

describe('the run', () => {
  it('climbs Blitz\'s multiplier', () => {
    for (let c = 0; c <= 12; c++) expect(raceMult(c)).toBe(blitzMult(c))
    expect([0, 1, 2, 3, 5, 6, 8, 9, 20].map(pointsFor)).toEqual([10, 20, 20, 30, 30, 40, 40, 50, 50])
  })

  it('promises only the multiplier a track can reach: every leg right is the longest streak', () => {
    // x5 needs nine in a row, so a draw of four to eight questions tops out lower (the start screen says so)
    expect([4, 5, 6, 8, 9, 10].map(topMult)).toEqual([3, 3, 4, 4, 5, 5])
    expect(topMult(0)).toBe(1)
    expect(topMult(undefined)).toBe(1)
    // and the run proves it: six right in a row on a six-leg track ends at x4
    let r = startRun(new Array(6).fill(null).map((_, k) => ({ id: `q${k}` })))
    for (let k = 0; k < 6; k++) r = applyCall(r, { ok: true })
    expect(raceMult(r.best)).toBe(topMult(6))
  })

  it('runs a leg for each right answer', () => {
    expect(LEG_M).toBe(100)
    expect(distanceOf(7)).toBe(700)
    expect(distanceOf(-2)).toBe(0)
    expect(trackOf(10)).toBe(1000)
    expect(metres(1000)).toBe('1,000 m')
    expect(metres(0)).toBe('0 m')
    expect(progressPct(3, 10)).toBe(30)
    expect(progressPct(12, 10)).toBe(100)
    expect(progressPct(1, 0)).toBe(0)
    expect(trackLabel(3, 10, 1)).toBe('300 m of 1,000 m run, 3 right, 1 miss')
    expect(trackLabel(0, 8)).toBe('0 m of 800 m run, 0 right')
  })

  it('scores a run of ten right at 350 points and crosses the line', () => {
    let r = startRun(new Array(10).fill(null).map((_, k) => ({ id: `q${k}` })), 3)
    expect(r).toMatchObject({ token: 3, legs: 10, i: 0, score: 0 })
    const sums = []
    for (let k = 0; k < 10; k++) { r = applyCall(r, { ok: true }); sums.push(r.score) }
    expect(sums).toEqual([20, 40, 70, 100, 130, 170, 210, 250, 300, 350])
    expect(r).toMatchObject({ right: 10, answered: 10, combo: 10, best: 10 })
    expect(crossed(r)).toBe(true)
    expect(endOf(r)).toBe('line')
  })

  it('resets the streak on a miss and keeps the best', () => {
    let r = startRun([{}, {}, {}, {}, {}])
    r = applyCall(r, { ok: true }); r = applyCall(r, { ok: true }); r = applyCall(r, { ok: true })
    r = applyCall(r, { ok: false })
    r = applyCall(r, { ok: true })
    expect(r).toMatchObject({ score: 20 + 20 + 30 + 0 + 20, combo: 1, best: 3, right: 4, answered: 5, results: [true, true, true, false, true] })
    expect(crossed(r)).toBe(false)
    expect(endOf(r)).toBe('deck')
  })

  it('does not count an answer the server never scored', () => {
    let r = applyCall(startRun([{}, {}]), { ok: true })
    r = applyLost(r)
    r = applyLost(r)
    expect(r).toMatchObject({ lost: 2, fails: 2, answered: 1, right: 1 })
    expect(applyCall(r, { ok: false }).fails).toBe(0)
    expect(applyLost(null)).toMatchObject({ lost: 1, fails: 1 })
    expect(crossed(EMPTY_RUN)).toBe(false)
    expect(crossed(null)).toBe(false)
  })

  it('turns each second left at the line into points', () => {
    expect(FINISH_POINTS_PER_SEC).toBe(5)
    expect(finishBonus(19)).toBe(95)
    expect(finishBonus(19.9)).toBe(95)
    expect(finishBonus(-3)).toBe(0)
    expect(finishBonus(undefined)).toBe(0)
  })

  it('runs the clock in steps that stop while it is paused', () => {
    expect(tickClock(60000, false)).toBe(59900)
    expect(tickClock(60000, true)).toBe(60000)
    expect(tickClock(50, false)).toBe(0)
    expect(secsOf(59900)).toBe(60)
    expect(secsOf(59000)).toBe(59)
    expect(secsOf(1)).toBe(1)
    expect(secsOf(0)).toBe(0)
  })
})

describe('the end', () => {
  it('names the race', () => {
    expect(raceVerdict(0, 0, 10)).toBe('No answers this run')
    expect(raceVerdict(10, 10, 10)).toBe('Crossed the line')
    expect(raceVerdict(8, 10, 10)).toBe('Strong run')
    expect(raceVerdict(6, 10, 10)).toBe('Solid run')
    expect(raceVerdict(5, 10, 10)).toBe('Tough run')
  })

  it('says the distance', () => {
    expect(distanceLine({ right: 10, legs: 10, stop: 'line', secsLeft: 19 })).toBe('You ran the full 1,000 m with 19 seconds to spare, worth +95 points.')
    expect(distanceLine({ right: 6, legs: 6, stop: 'line', secsLeft: 1 })).toBe('You ran the full 600 m with 1 second to spare, worth +5 points.')
    expect(distanceLine({ right: 4, legs: 10, stop: 'time' })).toBe('The clock ran out at 400 m of the 1,000 m track.')
    expect(distanceLine({ right: 7, legs: 10, stop: 'deck' })).toBe('You ran 700 m of the 1,000 m track.')
    expect(distanceLine()).toBe('You ran 0 m of the 0 m track.')
  })

  it('says what the misses carry', () => {
    expect(missLine([])).toBe('')
    expect(missLine([{ ok: true }])).toMatch(/^No misses\./)
    expect(missLine([{ ok: true }, { ok: false }])).toBe('The miss below carries its answer, its lesson and its source.')
    expect(missLine([{ ok: false }, { ok: false }])).toBe('Each miss below carries its answer, its lesson and its source.')
  })

  it('keeps every word of member copy free of em dashes and of "the firm"', () => {
    const copy = [EMPTY_LINE, LOST_LINE, missLine([{ ok: true }]), missLine([{ ok: false }]), missLine([{ ok: false }, { ok: false }]),
      distanceLine({ right: 3, legs: 10, stop: 'line', secsLeft: 2 }), distanceLine({ right: 3, legs: 10, stop: 'time' }),
      raceVerdict(0, 0, 0), raceVerdict(1, 1, 1), raceVerdict(1, 2, 2), verdictTitle({}), trackLabel(3, 10, 2)]
    for (const t of copy) expect(t).not.toMatch(/[—–]|\bthe firm\b/i)
    expect(EMPTY_LINE).toBe('No questions in this game yet. They arrive as the courses are approved.')
  })
})
