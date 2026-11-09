/**
 * True or False, the pure half (docs/study/GAMES.md §1 rule 6): the multiplier and its points, the pool's filter, the
 * seeded deal, the keys, the reveal read into the lines a miss teaches (the reason without its verdict, the lesson line,
 * the source cut to fit a phone), the run's tally, the clock and the end screen's words. The reveals here have the shape
 * scripts/study/courses_lib.build_items gives a course "tf" question, with real course text.
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_RUN, FALSE, REASON_MIN_WORDS, SOURCE_MAX, TF_CHOICES, TF_KIND, TF_MIN, TF_POOL_SIZE, TF_SECS, TF_TAKEOVER_GUARD_MS, TF_TAKEOVER_MS,
  TF_TICK_MS, TRUE, applyCall, applyLost, clean, deckOf, keyChoice, leanLine, lessonLineOf, otherOf, pointsFor, reasonOf, rowOf, secsOf,
  shortSource, sourceOf, statementsOf, tfMult, tfVerdict, tickClock, truthOf, verdictOf, verdictTitle,
} from './trueFalse'

const SPY = {
  unit: 'F1.02',
  why: "False. You can't invest directly in an index. A SPY share is ownership in a fund that aims to match the S&P 500, before expenses.",
  lesson_line: 'SPY is the fund. The S&P 500 is the scoreboard it follows.',
  depth: { summary: '', sources: [
    { name: 'SEC, Investor.gov: Index Funds (Investor Bulletin, August 2024)', url: 'https://www.investor.gov/index-funds', quote: '...' },
    { name: 'Second source', url: 'https://example.org' },
  ] },
  answer: { answer: 'False' },
}
const item = (id, q, extra = {}) => ({ id, version: 1, type: 'recall', skill_id: 'basics.shares', module: 'F1', difficulty: 1, prompt_json: { q, kind: 'tf', choices: ['True', 'False'] }, has_chart: false, ...extra })

describe('the game constants', () => {
  it('match the catalogue: 45 seconds, a 40-statement draw, five to play, a 2.5 second takeover', () => {
    expect(TF_KIND).toBe('tf')
    expect(TF_SECS).toBe(45)
    expect(TF_POOL_SIZE).toBe(40)
    expect(TF_MIN).toBe(5)
    expect(TF_TAKEOVER_MS).toBe(2500)
    expect(TF_TAKEOVER_GUARD_MS).toBe(400)                                            // a stray second tap, well under a reading
    expect(TF_TAKEOVER_GUARD_MS).toBeLessThan(TF_TAKEOVER_MS)
    expect(TF_CHOICES).toEqual(['True', 'False'])
    expect(TRUE).toBe('True')
    expect(FALSE).toBe('False')
  })
})

describe('tfMult and pointsFor', () => {
  it("climb with the streak like Blitz's: x2 from the first right call, x3 at 3, x4 at 6, x5 from 9", () => {
    expect([0, 1, 2, 3, 5, 6, 8, 9, 20].map(tfMult)).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect([1, 2, 3, 6, 9, 15].map(pointsFor)).toEqual([20, 20, 30, 40, 50, 50])
    expect(pointsFor(0)).toBe(10)
  })
})

describe('clean', () => {
  it('says UCT, never "the firm", and prints no em or en dash', () => {
    expect(clean("The firm's rule — stop first")).toBe("UCT's rule, stop first")
    expect(clean('the firm sizes on the stop')).toBe('UCT sizes on the stop')
    expect(clean('pp. 569–579')).toBe('pp. 569-579')
    expect(clean('  a   b \n c ')).toBe('a b c')
    expect(clean(null)).toBe('')
    expect(clean(undefined)).toBe('')
  })
})

describe('statementsOf', () => {
  it('keeps each true/false statement once, with no chart, on True and False buttons', () => {
    const items = [
      item('si_a', 'A company can cut its dividend, or stop paying one altogether.'),
      item('si_a', 'The same id again, with other words.'),                                    // the same id
      item('si_b', 'a company can cut its dividend, or stop paying one altogether.'),          // the same words
      item('si_c', 'Which index does SPY track?', { prompt_json: { q: 'Which index does SPY track?', kind: 'mcq', choices: ['S&P 500', 'Nasdaq-100'] } }),
      item('si_d', 'This chart closed over its high.', { has_chart: true }),
      item('si_e', 'Yes or no, the stop goes first.', { prompt_json: { q: 'Yes or no, the stop goes first.', kind: 'tf', choices: ['Yes', 'No'] } }),
      item('si_f', '   '),
      null, 'si_g', { prompt_json: { q: 'No id', kind: 'tf' } },
      item('si_h', 'A stop order becomes a market order once the stop price trades.', { prompt_json: { q: 'A stop order becomes a market order once the stop price trades.', kind: 'tf' } }),
      item('si_i', 'The firm sizes every trade from its stop.'),
      { id: 'si_j', prompt_json: { question: 'A limit order sets the worst price you accept.', kind: 'tf', choices: ['false', 'TRUE'] } },
    ]
    expect(statementsOf(items)).toEqual([
      { id: 'si_a', q: 'A company can cut its dividend, or stop paying one altogether.', skill: 'basics.shares' },
      { id: 'si_h', q: 'A stop order becomes a market order once the stop price trades.', skill: 'basics.shares' },
      { id: 'si_i', q: 'UCT sizes every trade from its stop.', skill: 'basics.shares' },
      { id: 'si_j', q: 'A limit order sets the worst price you accept.', skill: null },
    ])
  })

  it('is empty for anything that is not a list', () => {
    expect(statementsOf(undefined)).toEqual([])
    expect(statementsOf({ items: [] })).toEqual([])
  })
})

describe('deckOf', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f']
  it('deals the same order for the same seed, a new one for another, and leaves the pool alone', () => {
    expect(deckOf(six, 42)).toEqual(['b', 'f', 'e', 'a', 'd', 'c'])
    expect(deckOf(six, 7)).toEqual(['b', 'e', 'f', 'c', 'd', 'a'])
    expect(deckOf(six, 1731100000000)).toEqual(['e', 'a', 'c', 'b', 'f', 'd'])
    expect(deckOf(six, 1731100001000)).toEqual(['f', 'd', 'e', 'a', 'c', 'b'])
    expect(deckOf(six, 42)).toEqual(deckOf(six, 42))
    expect([...deckOf(six, 99)].sort()).toEqual(six)
    expect(six).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(deckOf(null, 1)).toEqual([])
  })

  it('spreads the first statement evenly over the last place across runs a second apart', () => {
    const last = {}
    for (let k = 0; k < 600; k++) { const d = deckOf(six, 1731100000000 + k * 1000); last[d[5]] = (last[d[5]] || 0) + 1 }
    for (const x of six) expect(last[x]).toBeGreaterThan(70)
  })
})

describe('keyChoice, otherOf and truthOf', () => {
  it('reads T and 1 as True, F and 2 as False, and nothing else as a call', () => {
    expect(['t', 'T', '1', 'f', 'F', '2'].map(keyChoice)).toEqual([TRUE, TRUE, TRUE, FALSE, FALSE, FALSE])
    expect(['3', 'Enter', ' ', 'y', '', undefined, null].map(keyChoice)).toEqual([null, null, null, null, null, null, null])
  })

  it('takes the answer from the verdict: right means what was said, wrong means the other', () => {
    expect(otherOf(TRUE)).toBe(FALSE)
    expect(otherOf(FALSE)).toBe(TRUE)
    expect(truthOf(TRUE, true)).toBe(TRUE)
    expect(truthOf(TRUE, false)).toBe(FALSE)
    expect(truthOf(FALSE, false)).toBe(TRUE)
  })

  it('reads a verdict only when the server gave one: a reply without it is not a miss', () => {
    expect(verdictOf({ correct: true })).toBe(true)
    expect(verdictOf({ correct: false, reveal: {} })).toBe(false)
    for (const reply of [{}, { reveal: SPY }, { correct: 'false' }, { correct: 0 }, { correct: null }, null, undefined, 'ok']) expect(verdictOf(reply)).toBeNull()
  })
})

describe('reasonOf and lessonLineOf', () => {
  it("drop the verdict the why opens on and keep its first sentence", () => {
    expect(reasonOf(SPY)).toBe("You can't invest directly in an index.")
    expect(reasonOf({ why: 'True. A company may pay dividends, but it doesn\'t have to. The amount isn\'t guaranteed.' })).toBe("A company may pay dividends, but it doesn't have to.")
  })

  it('never ends a sentence inside a number', () => {
    expect(reasonOf({ why: 'False. The expected move is the price times the IV, scaled for time. 16% IV prices about 1% a day.' }))
      .toBe('The expected move is the price times the IV, scaled for time. 16% IV prices about 1% a day.')
    expect(reasonOf({ why: 'False. A 2.5% stop on a $40.25 entry sits at $39.24. Size from there.' })).toBe('A 2.5% stop on a $40.25 entry sits at $39.24.')
  })

  it(`lets a first sentence under ${REASON_MIN_WORDS} words take the next one with it`, () => {
    expect(reasonOf({ why: 'True. It helps. Volume on the breakout shows real demand. More here.' })).toBe('It helps. Volume on the breakout shows real demand.')
    expect(reasonOf({ why: 'False. You sold first.' })).toBe('You sold first.')
  })

  it('keeps a concession with the sentence that turns on it, so the line never argues for the wrong answer', () => {
    // real course text (F7, F8, F6): alone, each first sentence under "It's false." reads as a reason it is true
    expect(reasonOf({ why: 'False. The rule of thumb says about a year, and inversions came before each of the last eight recessions. But there were false alarms, including late 2022 through late 2024.' }))
      .toBe('The rule of thumb says about a year, and inversions came before each of the last eight recessions. But there were false alarms, including late 2022 through late 2024.')
    expect(reasonOf({ why: 'False. Experience helps: in one study, experienced poker players took bad luck more maturely. But pros at the Chicago Board of Trade still took extra risk to win back losing mornings.' }))
      .toBe('Experience helps: in one study, experienced poker players took bad luck more maturely. But pros at the Chicago Board of Trade still took extra risk to win back losing mornings.')
    expect(reasonOf({ why: 'False. More time slows the daily bleed. But hold any call to expiry with the stock below the strike, and it expires worthless.' }))
      .toBe('More time slows the daily bleed. But hold any call to expiry with the stock below the strike, and it expires worthless.')
    expect(reasonOf({ why: 'False. A stop is a promise you keep. However wide it is, it goes in first.' })).toBe('A stop is a promise you keep. However wide it is, it goes in first.')
    // a full first sentence keeps a next one that does not turn out ("Butter" is not "But")
    expect(reasonOf({ why: 'False. ATR measures how big the moves are, never which way. Big ranges come with strong moves either way.' })).toBe('ATR measures how big the moves are, never which way.')
    expect(reasonOf({ why: 'True. A buy limit fills at your limit or lower. Butter is not a price.' })).toBe('A buy limit fills at your limit or lower.')
  })

  it('falls back to the whole lesson, capitalises, cleans, and is empty with nothing to read', () => {
    expect(reasonOf({ lesson: "True. A company may pay dividends, but it doesn't have to. You own the business." })).toBe("A company may pay dividends, but it doesn't have to.")
    expect(reasonOf({ why: 'false: the firm’s stop goes first, always below the entry.' })).toBe('UCT’s stop goes first, always below the entry.')
    expect(reasonOf({ why: 'False.' })).toBe('')
    expect(reasonOf(null)).toBe('')
  })

  it("take the mentor's lesson line for the run log, else the reason", () => {
    expect(lessonLineOf(SPY)).toBe('SPY is the fund. The S&P 500 is the scoreboard it follows.')
    expect(lessonLineOf({ why: SPY.why })).toBe("You can't invest directly in an index.")
    expect(lessonLineOf({})).toBe('')
  })
})

describe('shortSource and sourceOf', () => {
  it('drops the parentheses from a cited page', () => {
    expect(shortSource('SEC, Investor.gov: Understanding Order Types: Investor Bulletin (July 12, 2017, updated August 18, 2026)'))
      .toBe('SEC, Investor.gov: Understanding Order Types: Investor Bulletin')
    expect(shortSource("UCT house rule: Study: the trade plan for every setup (the setup table, from the app's own detectors and the owner's rulings)"))
      .toBe('UCT house rule: Study: the trade plan for every setup')
    expect(shortSource('The Options Industry Council (OCC): Delta')).toBe('The Options Industry Council: Delta')
  })

  it(`cuts a name still over ${SOURCE_MAX} characters at its last comma or colon, else at a word with an ellipsis`, () => {
    expect(shortSource("Journal of Personality and Social Psychology (Baron and Hershey, 1988): Outcome Bias in Decision Evaluation, vol. 54, no. 4, pp. 569-579 (the published article, on the first author's University of Pennsylvania page)"))
      .toBe('Journal of Personality and Social Psychology: Outcome Bias in Decision Evaluation')
    const long = Array(30).fill('word').join(' ')
    expect(shortSource(long)).toBe(`${Array(18).fill('word').join(' ')}…`)
    expect(shortSource('Short: name')).toBe('Short: name')
  })

  it('reads the first named source, with a link only when it is a web address', () => {
    expect(sourceOf(SPY)).toEqual({ name: 'SEC, Investor.gov: Index Funds', full: 'SEC, Investor.gov: Index Funds (Investor Bulletin, August 2024)', url: 'https://www.investor.gov/index-funds' })
    expect(sourceOf({ depth: { sources: [{ name: '' }, { name: 'FINRA: Options', url: 'javascript:alert(1)' }] } })).toEqual({ name: 'FINRA: Options', full: 'FINRA: Options', url: null })
    expect(sourceOf({ depth: { sources: [] } })).toBeNull()
    expect(sourceOf({})).toBeNull()
  })
})

describe('rowOf and verdictTitle', () => {
  it('keeps one call with its answer, its reason, its lesson line and its source', () => {
    const row = rowOf({ statement: { id: 'si_b', q: 'When you buy SPY, you are buying the S&P 500 index itself.' }, said: TRUE, correct: false, reveal: SPY })
    expect(row).toEqual({
      id: 'si_b', q: 'When you buy SPY, you are buying the S&P 500 index itself.', said: TRUE, ok: false, truth: FALSE,
      reason: "You can't invest directly in an index.", line: 'SPY is the fund. The S&P 500 is the scoreboard it follows.',
      source: { name: 'SEC, Investor.gov: Index Funds', full: 'SEC, Investor.gov: Index Funds (Investor Bulletin, August 2024)', url: 'https://www.investor.gov/index-funds' },
    })
    expect(rowOf({ statement: { id: 'x', q: 'q' }, said: FALSE, correct: true })).toMatchObject({ ok: true, truth: FALSE, reason: '', line: '', source: null })
    expect(verdictTitle(FALSE)).toBe("It's false.")
    expect(verdictTitle(TRUE)).toBe("It's true.")
  })
})

describe('applyCall and applyLost', () => {
  it('score each right call at the streak it makes and reset the streak on a miss', () => {
    const calls = [true, true, false, true, true, true].map((ok, k) => ({ id: `s${k}`, ok }))
    const runs = []
    let r = EMPTY_RUN
    for (const c of calls) { r = applyCall(r, c); runs.push(r) }
    expect(runs.map((x) => x.combo)).toEqual([1, 2, 0, 1, 2, 3])
    expect(runs.map((x) => x.score)).toEqual([20, 40, 40, 60, 80, 110])
    expect(r).toMatchObject({ best: 3, right: 5, answered: 6, results: [true, true, false, true, true, true], fails: 0 })
    expect(r.log).toEqual(calls)
    expect(EMPTY_RUN.log).toEqual([])
  })

  it('count a call that never reached the server as lost, not as an answer, and a scored call clears the failures', () => {
    let r = applyLost(applyLost(EMPTY_RUN))
    expect(r).toMatchObject({ lost: 2, fails: 2, answered: 0, score: 0 })
    r = applyCall(r, { ok: true })
    expect(r).toMatchObject({ lost: 2, fails: 0, answered: 1, score: 20 })
  })
})

describe('tickClock and secsOf', () => {
  it('runs down a step at a time, stands still while paused, and never goes below zero', () => {
    expect(TF_TICK_MS).toBe(100)
    expect(tickClock(45000, false)).toBe(44900)
    expect(tickClock(45000, true)).toBe(45000)
    expect(tickClock(50, false)).toBe(0)
    expect(tickClock(0, false)).toBe(0)
    expect(tickClock(-5, true)).toBe(0)
    let ms = TF_SECS * 1000
    for (let k = 0; k < 10; k++) ms = tickClock(ms, false)
    expect(ms).toBe(44000)
  })

  it('shows a part second as a whole one', () => {
    expect([45000, 44900, 44001, 44000, 999, 1, 0, -3].map(secsOf)).toEqual([45, 45, 45, 44, 1, 1, 0, 0])
  })
})

describe('tfVerdict and leanLine', () => {
  it('names the run', () => {
    expect(tfVerdict(0, 0)).toBe('No calls this run')
    expect(tfVerdict(7, 7)).toBe('Every call right')
    expect(tfVerdict(8, 10)).toBe('Sharp calls')
    expect(tfVerdict(6, 10)).toBe('Solid run')
    expect(tfVerdict(5, 10)).toBe('Tough run')
  })

  it('says which way the misses leaned, only when two thirds of two or more went one way', () => {
    const row = (ok, said) => ({ ok, said })
    expect(leanLine([])).toBe('')
    expect(leanLine([row(true, TRUE), row(true, FALSE)])).toBe('No misses. Every statement here comes from a course and the source it cites.')
    expect(leanLine([row(false, TRUE), row(true, TRUE)])).toBe('The miss below carries its lesson and its source.')
    expect(leanLine([row(false, TRUE), row(false, TRUE), row(false, FALSE)]))
      .toBe('2 of your 3 misses were false statements you called true. One wrong word makes a statement false.')
    expect(leanLine([row(false, FALSE), row(false, FALSE), row(true, TRUE)]))
      .toBe('Both your misses were true statements you called false. Read what it says, not how it sounds.')
    expect(leanLine([row(false, TRUE), row(false, TRUE), row(false, TRUE)]))
      .toBe('All 3 of your misses were false statements you called true. One wrong word makes a statement false.')
    expect(leanLine([row(false, TRUE), row(false, FALSE), row(false, TRUE), row(false, FALSE)])).toBe('Each miss below carries its lesson and its source.')
  })

  it('writes no em dash and never "the firm" in any line it can say', () => {
    const lines = [leanLine([{ ok: true, said: TRUE }]), leanLine([{ ok: false, said: TRUE }]), leanLine([{ ok: false, said: TRUE }, { ok: false, said: TRUE }]),
      leanLine([{ ok: false, said: FALSE }, { ok: false, said: FALSE }]), leanLine([{ ok: false, said: TRUE }, { ok: false, said: FALSE }]),
      ...[[0, 0], [1, 1], [8, 10], [6, 10], [1, 10]].map(([a, b]) => tfVerdict(a, b)), verdictTitle(TRUE), verdictTitle(FALSE)]
    for (const l of lines) expect(l).not.toMatch(/[—–]|the firm/i)
  })
})

describe('takeoverMs: a long reason holds the screen longer', () => {
  it('never under the base hold, a quarter second a word after the fade, never past the cap', async () => {
    const { takeoverMs, TF_FADE_IN_MS, TF_READ_MS_PER_WORD, TF_TAKEOVER_MAX_MS } = await import('./trueFalse')
    expect(takeoverMs('')).toBe(TF_TAKEOVER_MS)
    expect(takeoverMs(null)).toBe(TF_TAKEOVER_MS)
    expect(takeoverMs('Stops become market orders.')).toBe(TF_TAKEOVER_MS)                  // 4 words: 900 + 1,000 < 2,500
    expect(takeoverMs('A stop order becomes a market order.')).toBe(2650)                    // 7 words: 900 + 1,750
    const twenty = Array.from({ length: 20 }, () => 'word').join(' ')
    expect(takeoverMs(twenty)).toBe(TF_FADE_IN_MS + 20 * TF_READ_MS_PER_WORD)                  // 5,900 ms
    const forty = Array.from({ length: 40 }, () => 'word').join('  ')
    expect(takeoverMs(forty)).toBe(TF_TAKEOVER_MAX_MS)
  })
})
