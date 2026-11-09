/**
 * Survive the Drawdown's arithmetic (docs/study/GAMES.md §1 rule 6): every formula with known values worked by hand
 * (compounding, the deepest drawdown, the gain to recover, the wins a pick needs), the seeded stretch and its rules, the
 * three questions and the named mistakes their tiles model, how the questions' answers spread across deals, the many
 * stretches (recomputed here from the definition, and checked against exact binomial and streak arithmetic), and the
 * words on screen. Seeds are fixed, so every run here is the run a member would see for that seed.
 */
import { describe, it, expect } from 'vitest'
import house from '../../../../constants/houseSizing.json'
import {
  COLD_BELOW, EDGE_R100, EDGE_TEXT, FALLBACK, LESSON_RULE, LESSON_STREAK, LOSS_TEXT, MANY, MANY_FIRST_SEED, MANY_N, ORDER, RULE_RANGE, SMALL_EDGE_R100, SMALL_EDGE_TEXT,
  SMALL_WIN_PCT, SOURCE_MANY, STREAK_MISTAKES, WIN_TEXT, LINE, LINE_CLEAR, LOW_FLOOR, MAX_DOUBLINGS, PICKS, RULE_MAX_BPS, RULE_MIN_BPS, START, TOP_CLEAR, TRADES,
  WIN_MAX, WIN_MIN, WIN_PCT, atText, bagDraw, balancesOf, choiceOf, climbFor, climbOf, countText, dealStretch, deepQuestion, deepestOf, dollars,
  domainOf, edgeText, fallOf, fallsOf, firstRisk, fits, halfRun, headlineOf, isRight, kText, lineLabel, lineQuestion, liveAt, longestLosing, losingRunAt,
  manyHalfLine, manyOf, manyPanel, mistakeFamily, mixSeed, niceStep, pathOf, peaksOf, pct, pickLabel, pickLine, pickOf, pickText, questionsFor, readoutAt, rngOf,
  runFall, runIdOf, signedPct, spreadLabels, stepOf, streakChance, streakFamily, streakQuestion, streakRisks,
  stretchLine, stretchOf, survivalLine, survivalTitle, survived, textOf, ticksOf, verdictOf, whyLine, winsOf, windowText,
  winsToFinishAbove, workingOf,
} from './survive'

const MINUS = '−'
const SEEDS = Array.from({ length: 160 }, (_, i) => 1731100000000 + i * 7919)
const FB = stretchOf(winsOf(FALLBACK))
const clean = (t) => expect(String(t)).not.toMatch(/[–—]|\bthe firm\b|NaN|undefined|Infinity/i)

describe('the system and the house numbers', () => {
  it('is the course\'s System B: wins 40% at +2.5R, loses 60% at −1R, +0.4R a trade', () => {
    expect(WIN_PCT).toBe(40)
    expect(EDGE_R100).toBe(40)                                 // 0.4 × 2.5 − 0.6 × 1 = 1.0 − 0.6 = 0.4R
    expect(edgeText()).toBe(`Wins 40% at +2.5R, loses 60% at ${MINUS}1R: +0.4R a trade on average.`)
    expect([WIN_TEXT, LOSS_TEXT, EDGE_TEXT, RULE_RANGE]).toEqual(['+2.5R', `${MINUS}1R`, '+0.4R', '0.25% to 2%'])
    expect(LESSON_RULE).toBe(`Our rule: risk ${RULE_RANGE} of the account a trade. ${pickLabel(RULE_MAX_BPS)} is the ceiling.`)
  })

  it('reads the account and the 2% ceiling from the pinned house file, and offers the five picks', () => {
    expect(START).toBe(house.placeholderAccountSize)
    expect(START).toBe(100000)
    expect(RULE_MAX_BPS).toBe(200)
    expect(RULE_MIN_BPS).toBe(25)
    expect(PICKS).toEqual([50, 100, 200, 500, 1000])
    expect(PICKS.map(pickLabel)).toEqual(['0.5%', '1%', '2%', '5%', '10%'])
    expect(PICKS.map(firstRisk)).toEqual(['$500', '$1,000', '$2,000', '$5,000', '$10,000'])
    expect(pickText(200)).toBe('2% a trade')
  })
})

describe('compounding', () => {
  it('a win adds 2.5 times the risk and a loss takes it, on the account as it stands', () => {
    expect(stepOf(100000, 200, true)).toBeCloseTo(105000, 9)   // 2% risk is $2,000; 2.5R is +$5,000
    expect(stepOf(100000, 200, false)).toBeCloseTo(98000, 9)
    expect(stepOf(50000, 1000, true)).toBeCloseTo(62500, 9)    // 10% of $50,000 is $5,000; 2.5R is +$12,500
    expect(pathOf(winsOf('WL'), 200)).toEqual([100000, 105000, expect.closeTo(102900, 6)])   // 105,000 × 0.98
  })

  it('ends in the same place whatever the order, because only the count of winners sets the finish', () => {
    expect(pathOf(winsOf('LW'), 200)[2]).toBeCloseTo(pathOf(winsOf('WL'), 200)[2], 6)
    const a = pathOf(winsOf('WWLLL'), 1000), b = pathOf(winsOf('LLLWW'), 1000)
    expect(a[5]).toBeCloseTo(b[5], 6)
    expect(a[5]).toBeCloseTo(100000 * 1.25 ** 2 * 0.9 ** 3, 6)  // $113,906.25
  })

  it('three losses at 10% take 27.1%, not 30%: losses compound', () => {
    expect(balancesOf(winsOf('LLL'), 1000)).toEqual([100000, 90000, 81000, 72900])
    expect(fallOf(100000, 72900)).toBeCloseTo(0.271, 12)
    expect(pct(fallOf(100000, 72900))).toBe('27.1%')
  })

  it('shows whole dollars, rounded from the exact path', () => {
    // 100,000 → 125,000 → 156,250 → 140,625 → 126,562.5 (→ 126,563) → 158,203.125 → ...
    expect(balancesOf(winsOf('WWLLWLLL'), 1000)).toEqual([100000, 125000, 156250, 140625, 126563, 158203, 142383, 128145, 115330])
  })
})

describe('the deepest drawdown and the climb back (F9.04)', () => {
  it('runs from a peak to the low after it, keeps the deepest, and counts the trades between', () => {
    const wins = winsOf('WWLLWLLL')
    const d = deepestOf(balancesOf(wins, 1000), wins)
    // 156,250 → 126,563 is 19.0%; the deeper fall is 158,203 → 115,330: three losses, 1 − 0.9³
    expect(d).toMatchObject({ peak: 158203, peakAt: 5, low: 115330, lowAt: 8, wins: 0, losses: 3 })
    expect(pct(d.dd)).toBe('27.1%')
  })

  it('counts a fall from the start, and a bounce that never makes a new high stays inside the fall', () => {
    // 100,000 → 90,000 → 81,000 → 72,900 → (a win) 91,125 → 82,012.5 → 73,811.25 → 66,430.125
    const wins = winsOf('LLLWLLL')
    const b = balancesOf(wins, 1000)
    expect(b).toEqual([100000, 90000, 81000, 72900, 91125, 82013, 73811, 66430])
    const d = deepestOf(b, wins)                                // 91,125 is under the 100,000 high, so the fall runs on from it
    expect(d).toMatchObject({ peak: 100000, peakAt: 0, low: 66430, lowAt: 7, wins: 1, losses: 6 })
    expect(pct(d.dd)).toBe('33.6%')                             // 1 − 0.9⁶ × 1.25 = 1 − 0.66430
    // a bounce that does make a new high starts a new fall: 81,000 × 1.25 = 101,250, above the 100,000 start
    const w2 = winsOf('LLWWLLL')
    const b2 = balancesOf(w2, 1000)
    expect(b2).toEqual([100000, 90000, 81000, 101250, 126563, 113906, 102516, 92264])
    expect(deepestOf(b2, w2)).toMatchObject({ peak: 126563, peakAt: 4, low: 92264, lowAt: 7, wins: 0, losses: 3 })
    const flat = deepestOf(balancesOf(winsOf('LLLL'), 500), winsOf('LLLL'))
    expect(flat).toMatchObject({ peak: 100000, peakAt: 0, lowAt: 4, losses: 4, wins: 0 })
  })

  it('the low is the lowest point anywhere after its peak (any lower point would be a deeper fall)', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const s = dealStretch(seed)
      for (const p of s.picks) expect(Math.min(...p.balances.slice(p.deep.peakAt))).toBe(p.deep.low)
    }
  })

  it('the gain to get back grows faster than the fall: down 10% needs 11.1%, 25% needs 33.3%, 50% needs 100%', () => {
    expect(pct(climbFor(0.1))).toBe('11.1%')
    expect(pct(climbFor(0.25))).toBe('33.3%')
    expect(climbFor(0.5)).toBe(1)
    expect(climbOf(100000, 50000)).toBe(1)
    expect(pct(climbFor(0.226))).toBe('29.2%')                 // F9.04 f19: Black Monday's 22.6% needed 29.2%
    expect(climbFor(1)).toBe(Infinity)
    for (const dd of [0.05, 0.2, 0.4, 0.6]) expect(climbFor(dd)).toBeGreaterThan(dd)
  })

  it('finds the longest losing streak and where it sat (trades counted from 1)', () => {
    expect(longestLosing(winsOf('WLLWLLLW'))).toEqual({ length: 3, from: 5, to: 7 })
    expect(longestLosing(winsOf('WWW'))).toEqual({ length: 0, from: 0, to: 0 })
    expect(longestLosing(winsOf(FALLBACK))).toEqual({ length: 8, from: 14, to: 21 })
  })

  it('the high-water mark never falls', () => {
    expect(peaksOf([100, 90, 120, 110, 130])).toEqual([100, 100, 120, 120, 130])
  })
})

describe('losing streaks: what a run of losers takes, and how often 50 trades deal one', () => {
  it('losses in a row compound: 7 at 10% take 52.2%, the same 7 at 2% take 13.2%', () => {
    expect(runFall(1000, 7)).toBeCloseTo(1 - 0.9 ** 7, 12)                      // 1 − 0.4782969
    expect(pct(runFall(1000, 7))).toBe('52.2%')
    expect(pct(runFall(200, 7))).toBe('13.2%')                                    // 1 − 0.98⁷ = 1 − 0.8681
    expect(runFall(200, 0)).toBe(0)
    expect(runFall(1000, 3)).toBeCloseTo(0.271, 12)                               // the same 27.1% as LLL above
  })

  it('the fewest losses in a row that halve the account: 7 at 10%, 14 at 5%, 35 at 2%', () => {
    expect(halfRun(1000)).toEqual({ n: 7, fall: expect.closeTo(0.5217031, 7) })   // 0.9⁶ = 0.531 keeps more than half
    expect(halfRun(500)).toEqual({ n: 14, fall: expect.closeTo(1 - 0.95 ** 14, 12) })
    expect(1 - 0.95 ** 13).toBeLessThan(0.5)
    expect(halfRun(200).n).toBe(35)
    expect(1 - 0.98 ** 34).toBeLessThan(0.5)
    expect(PICKS.map((b) => halfRun(b).n)).toEqual([139, 69, 35, 14, 7])
  })

  it('the chance of a losing streak, worked exactly: 7 or more in 50 trades at 60% losers is 42.6%', () => {
    expect(pct(streakChance(7))).toBe('42.6%')
    expect(streakChance(1, 1)).toBeCloseTo(0.6, 12)                               // one trade: it loses 60% of the time
    expect(streakChance(2, 2)).toBeCloseTo(0.36, 12)                              // two in two: 0.6 × 0.6
    expect(streakChance(2, 3)).toBeCloseTo(0.36 + 0.4 * 0.36, 12)                 // LL? or WLL: 0.504
    expect(streakChance(0)).toBe(1)
    expect(streakChance(51)).toBe(0)                                              // longer than the trades
    // a longer streak is rarer, and more trades make one likelier
    expect(streakChance(8)).toBeLessThan(streakChance(7))
    expect(streakChance(7, 100)).toBeGreaterThan(streakChance(7, 50))
  })
})

describe('the wins a pick needs to finish above the start', () => {
  it('10% needs 17 of 50, 5% needs 16, 2% and under need 15', () => {
    expect(PICKS.map((b) => winsToFinishAbove(b))).toEqual([15, 15, 15, 16, 17])
    // the boundary by hand: 1.25^16 × 0.9^34 is 0.988 (below the start), 1.25^17 × 0.9^33 is 1.372
    expect(1.25 ** 16 * 0.9 ** 34).toBeLessThan(1)
    expect(1.25 ** 17 * 0.9 ** 33).toBeGreaterThan(1)
    expect(1.05 ** 14 * 0.98 ** 36).toBeLessThan(1)
    expect(1.05 ** 15 * 0.98 ** 35).toBeGreaterThan(1)
  })
})

describe('the seeded draw', () => {
  it('mixes neighbouring seeds apart and replays a seed exactly', () => {
    expect(mixSeed(1731100000000)).toBe(mixSeed(1731100000000))
    expect(mixSeed(1731100000000)).not.toBe(mixSeed(1731100000001))
    const a = rngOf(7), b = rngOf(7)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })

  it('draws marbles from a bag that is 40% winners', () => {
    const marbles = bagDraw(rngOf(42), 50000)
    const rate = marbles.filter(Boolean).length / marbles.length
    expect(rate).toBeGreaterThan(0.39)
    expect(rate).toBeLessThan(0.41)
    expect(textOf(winsOf('WLLW'))).toBe('WLLW')
  })
})

describe('the stretch', () => {
  it('the fallback is a known stretch, worked by hand at 2% and 10%', () => {
    expect(FB.count).toBe(20)
    expect(FB.losses).toBe(30)
    expect(fits(FB)).toBe(true)
    const two = pickOf(FB, 200), ten = pickOf(FB, 1000)
    // 2%: four straight wins, 100,000 × 1.05⁴ = 121,550.63; then 15 losses and 2 wins to 98,975
    expect(two.deep).toMatchObject({ peak: 121551, peakAt: 4, low: 98975, lowAt: 21, losses: 15, wins: 2 })
    expect(pct(fallOf(two.deep.peak, two.deep.low))).toBe('18.6%')
    expect(two.final).toBe(144733)
    // 10%: 100,000 × 1.25⁴ = 244,140.63; × 0.9¹⁵ × 1.25² = 78,541
    expect(ten.deep).toMatchObject({ peak: 244141, peakAt: 4, low: 78541, lowAt: 21 })
    expect(pct(ten.deep.dd)).toBe('67.8%')
    expect(FB.top).toBe(1000)
    expect(FB.fell).toEqual([1000])
  })

  it('deals the same stretch for the same seed and a different one for the next seed', () => {
    const a = dealStretch(1731100000000), b = dealStretch(1731100000000), c = dealStretch(1731100000001)
    expect(a.text).toBe(b.text)
    expect(a.text).not.toBe(c.text)
    expect(a.text).toHaveLength(TRADES)
  })

  it('keeps every rule on every seed: about 40%, clear to read, inside the chart, all three questions dealt', () => {
    for (const seed of SEEDS) {
      const s = dealStretch(seed)
      expect(fits(s)).toBe(true)
      expect(s.fallback).toBeUndefined()
      expect(s.count).toBeGreaterThanOrEqual(WIN_MIN)
      expect(s.count).toBeLessThanOrEqual(WIN_MAX)
      const finals = s.picks.map((p) => p.final).sort((x, y) => y - x)
      expect(finals[0]).toBeGreaterThanOrEqual(finals[1] * TOP_CLEAR)
      s.picks.forEach((p, i) => {
        expect(Math.abs(p.deep.dd - LINE)).toBeGreaterThanOrEqual(LINE_CLEAR)
        if (i) expect(p.deep.dd).toBeGreaterThan(s.picks[i - 1].deep.dd)   // more risk, deeper fall, same trades
      })
      const big = pickOf(s, 1000)
      expect(Math.log2(big.high / big.low)).toBeLessThanOrEqual(MAX_DOUBLINGS)
      expect(big.low).toBeGreaterThanOrEqual(LOW_FLOOR)
      for (const bps of PICKS) expect(questionsFor(s, bps, seed)).toHaveLength(3)
      // cold is what the bag dealt, never asked for: 10% a trade finished below the start
      expect(s.cold).toBe(s.count < COLD_BELOW)
      expect(s.cold).toBe(big.final < START)
      if (s.cold) expect(s.top).not.toBe(1000)
    }
  })

  it('deals the stretch the bag deals: the first draw that fits, with no draw asked to be cold', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const rnd = rngOf(seed)
      let first = null
      for (let t = 0; t < 4000 && !first; t++) { const s = stretchOf(bagDraw(rnd)); if (fits(s)) first = s }
      expect(dealStretch(seed).text).toBe(first.text)
    }
  })

  it('refuses a stretch that breaks a rule', () => {
    expect(fits(stretchOf(winsOf('W'.repeat(25) + 'L'.repeat(25))))).toBe(false)   // 25 wins, and a 25-loss streak
    expect(fits(stretchOf(winsOf('WL'.repeat(10))))).toBe(false)                     // not 50 trades
    expect(fits(FB, true)).toBe(false)                                                 // asked cold, 20 wins is not
    expect(fits(null)).toBe(false)
  })

  it('reads the live state trade by trade', () => {
    expect(liveAt(FB, 1000, 0)).toEqual({ step: 0, balance: 100000, peak: 100000, under: 0, last: null, streak: 0, done: false })
    const st = liveAt(FB, 1000, 5)                               // four wins, then a loss: 244,141 → 219,727
    expect(st).toMatchObject({ step: 5, balance: 219727, peak: 244141, last: { win: false, amount: 219727 - 244141 }, streak: 1, done: false })
    expect(pct(st.under)).toBe('10.0%')
    expect(liveAt(FB, 1000, 7).streak).toBe(3)                   // WWWWLLL
    expect(liveAt(FB, 1000, 8).streak).toBe(0)                   // then a winner
    expect(liveAt(FB, 1000, 21).streak).toBe(8)                  // the longest run, trades 14 to 21
    expect(liveAt(FB, 1000, 99).step).toBe(50)
    expect(liveAt(FB, 1000, 50).done).toBe(true)
  })

  it('counts the losers in a row ending at a trade', () => {
    expect(losingRunAt(winsOf('WLLWLLL'), 0)).toBe(0)
    expect(losingRunAt(winsOf('WLLWLLL'), 3)).toBe(2)
    expect(losingRunAt(winsOf('WLLWLLL'), 4)).toBe(0)
    expect(losingRunAt(winsOf('WLLWLLL'), 7)).toBe(3)
    expect(losingRunAt(winsOf('LLL'), 99)).toBe(3)
  })

  it('reads any trade on the chart in one line', () => {
    expect(readoutAt(FB, 1000, 0)).toBe('Start · the start · $100,000, at its high')
    expect(readoutAt(FB, 1000, 4)).toBe('Trade 4 · won 2.5R · $244,141, at its high')
    expect(readoutAt(FB, 1000, 5)).toBe('Trade 5 · lost 1R · $219,727, 10.0% under its peak')
    expect(readoutAt(FB, 1000, 7)).toBe('Trade 7 · lost 1R, 3 in a row · $177,979, 27.1% under its peak')
  })

  it('until the depth question is checked, the readout gives the peak in dollars, never the fall as a percent', () => {
    expect(readoutAt(FB, 1000, 5, false)).toBe('Trade 5 · lost 1R · $219,727, its peak $244,141')
    expect(readoutAt(FB, 1000, 4, false)).toBe('Trade 4 · won 2.5R · $244,141, at its high')
    expect(readoutAt(FB, 1000, 0, false)).toBe('Start · the start · $100,000, at its high')
    for (let i = 0; i <= FB.n; i++) expect(readoutAt(FB, 200, i, false)).not.toMatch(/%/)
  })
})

describe('Q1: what the longest losing streak takes, compounded', () => {
  /** The fall as a whole number on screen ("3.2%" inside "13.2%" is another number). */
  const fallRe = (s, mine) => new RegExp(`(^|[^\\d.])${pct(fallOf(pickOf(s, mine).deep.peak, pickOf(s, mine).deep.low)).replace('.', '\\.')}`)

  it('asks at 10% a trade, or at our 2% ceiling for a member who took 10%, and never at the member\'s own risk', () => {
    expect(PICKS.map((b) => streakRisks(b)[0])).toEqual([1000, 1000, 1000, 1000, 200])
    for (const mine of PICKS) expect(streakRisks(mine)).not.toContain(mine)
    for (const seed of SEEDS.slice(0, 60)) {
      const s = dealStretch(seed)
      for (const mine of PICKS) expect(questionsFor(s, mine, seed)[0].at, `${seed} ${mine}`).not.toBe(mine)
    }
  })

  it('works the fallback stretch\'s 8 losses in a row by hand: at 10% they keep 0.9⁸ = 43.0% and take 57.0%', () => {
    expect(FB.streak).toEqual({ length: 8, from: 14, to: 21 })
    const q = streakQuestion(FB, 200, 0)
    expect(q.at).toBe(1000)
    expect(q.question).toBe('What do 8 losses in a row take at 10% a trade?')
    expect(q.detail).toBe('This stretch\'s longest losing streak was 8 in a row, trades 14 to 21. Each trade risks 10% of the account as it stands.')
    expect(q.value).toBeCloseTo(1 - 0.9 ** 8, 12)                                  // 1 − 0.43046721
    expect(q.answer).toBe('57.0%')
    expect(q.labels).toEqual(['52.2%', '57.0%', '80.0%', '132.3%'])
    expect(q.choices.map((c) => c.mistake)).toEqual(['fewer', null, 'added', 'climb'])
    // 7 losses: 1 − 0.9⁷ = 52.2%; added up: 8 × 10% = 80%; the climb back: 1 / 0.9⁸ − 1 = 132.3%
    expect(q.choices[0].value).toBeCloseTo(1 - 0.9 ** 7, 12)
    expect(q.choices[2].value).toBeCloseTo(0.8, 12)
    expect(q.choices[3].value).toBeCloseTo(1 / 0.9 ** 8 - 1, 12)
  })

  it('names each mistake and teaches it on the question\'s own numbers', () => {
    const q = streakQuestion(FB, 200, 0)
    expect(headlineOf(q, '57.0%')).toBe('Compounded right.')
    expect(whyLine(q, FB, '57.0%')).toBe('Each loss keeps 90% of what was left. 8 in a row keep 43.0%, so they take 57.0%.')
    expect(headlineOf(q, '80.0%')).toBe('Losses compound.')
    expect(whyLine(q, FB, '80.0%')).toBe('Adding them up gives 80.0%. Each loss comes off what the last one left, so 8 take 57.0%.')
    expect(headlineOf(q, '132.3%')).toBe('That is the climb back.')
    expect(whyLine(q, FB, '132.3%')).toBe('132.3% is the gain to get back from there. The 8 losses take 57.0%.')
    expect(headlineOf(q, '52.2%')).toBe('Count the streak again.')
    expect(whyLine(q, FB, '52.2%')).toBe('52.2% is 7 losses. The streak was 8 in a row, and 8 take 57.0%.')
    // the two other named mistakes, worded on a hand-made choice: what is left, and another pick's cost
    const more = { ...q, choices: [...q.choices, { label: '43.0%', value: 0.9 ** 8, right: false, mistake: 'left' }, { label: '14.9%', value: 1 - 0.98 ** 8, right: false, mistake: 'risk200', bps: 200 }] }
    expect(headlineOf(more, '43.0%')).toBe('That is what is left.')
    expect(whyLine(more, FB, '43.0%')).toBe('43.0% is what is left after 8 losses. They take 57.0%.')
    expect(headlineOf(more, '14.9%')).toBe('That is another risk.')
    expect(whyLine(more, FB, '14.9%')).toBe('14.9% is what 8 losses take at 2% a trade. At 10% a trade they take 57.0%.')
    expect(Object.keys(STREAK_MISTAKES)).toEqual(['added', 'left', 'climb', 'count', 'risk'])
    expect(['fewer', 'more', 'risk50', 'added', null].map(streakFamily)).toEqual(['count', 'count', 'risk', 'added', null])
  })

  it('works the streak step by step, with our ceiling beside it and how often 50 trades deal a halving run', () => {
    const w = workingOf(streakQuestion(FB, 50, 0), FB)
    expect(w.title).toBe('What 8 losses in a row take at 10%')
    expect(w.steps).toEqual([
      'The streak: 8 losses in a row, trades 14 to 21.',
      'Each loss takes 10% of the account as it stands, so it keeps 90% of what was left.',
      'Keep 90%, 8 times over, and 43.0% is left. The streak takes 57.0%.',
      'Getting back from there needs +132.3%.',
      'At our 2% ceiling, the same 8 losses take 14.9%.',                           // 1 − 0.98⁸ = 0.14924
      `Across 10,000 stretches of this game, ${countText(MANY[40].streak)} dealt 7 or more losses in a row. At 10% a trade, 7 take 52.2%.`,
    ])
    expect(w.rule).toBe(LESSON_STREAK)
    expect(w.source).toContain('F9.03')
    // a member on 2% gets no ceiling line: that number is their own line's streak
    expect(workingOf(streakQuestion(FB, 200, 0), FB).steps.join(' ')).not.toContain('ceiling')
  })

  it('a member who took 10% is asked at our 2% ceiling: 8 losses there take 14.9%', () => {
    const q = streakQuestion(FB, 1000, 0)
    expect(q.at).toBe(200)
    expect(q.question).toBe('What do 8 losses in a row take at 2% a trade?')
    expect(q.answer).toBe('14.9%')
    expect(q.labels).toEqual(['7.7%', '13.2%', '14.9%', '17.5%'])                  // 1% a trade, 7 losses, the answer, the climb
    expect(q.contrast).toBeNull()
    expect(workingOf(q, FB).steps[2]).toBe('Keep 98%, 8 times over, and 85.1% is left. The streak takes 14.9%.')
  })

  it('every tile is its own formula on the same streak, four tiles at least 0.3 points apart', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const s = dealStretch(seed)
      for (const mine of PICKS) {
        const q = questionsFor(s, mine, seed)[0]
        const n = s.streak.length, f = q.at / 10000
        expect(q.n).toBe(n)
        expect(q.value).toBeCloseTo(1 - (1 - f) ** n, 12)
        for (const c of q.choices) {
          if (c.right) continue
          const fam = streakFamily(c.mistake)
          if (fam === 'added') expect(c.value).toBeCloseTo(n * f, 12)
          else if (fam === 'left') expect(c.value).toBeCloseTo((1 - f) ** n, 12)
          else if (fam === 'climb') expect(c.value).toBeCloseTo((1 - f) ** -n - 1, 12)
          else if (c.mistake === 'fewer') expect(c.value).toBeCloseTo(1 - (1 - f) ** (n - 1), 12)
          else if (c.mistake === 'more') expect(c.value).toBeCloseTo(1 - (1 - f) ** (n + 1), 12)
          else if (fam === 'risk') {
            expect([mine, q.at]).not.toContain(c.bps)
            expect(c.value).toBeCloseTo(1 - (1 - c.bps / 10000) ** n, 12)
          } else throw new Error(`an unnamed mistake ${c.mistake}`)
        }
        expect(q.choices).toHaveLength(4)
        expect(q.choices.filter((c) => c.right)).toHaveLength(1)
        const v = q.choices.map((c) => Math.round(c.value * 1000))
        for (let k = 1; k < 4; k++) expect(v[k] - v[k - 1]).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('never puts the member\'s own fall on screen, so the depth question that follows is never answered early', () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const s = dealStretch(seed)
      for (const mine of PICKS) {
        const q = questionsFor(s, mine, seed)[0]
        const fall = fallRe(s, mine)
        const w = workingOf(q, s)
        for (const t of [q.question, q.detail, ...q.labels, ...w.steps, w.rule]) expect(t, `${seed} ${mine}`).not.toMatch(fall)
        for (const l of q.labels) expect(whyLine(q, s, l), `${seed} ${mine} ${l}`).not.toMatch(fall)
      }
    }
    // when the 10% streak's cost would read as the member's own fall, the question moves to the next risk
    const q = streakQuestion(FB, 500, 0, ['57.0%'])
    expect(q.at).toBe(200)
    expect(q.labels).not.toContain('57.0%')
  })

  it('on a cold stretch, 5% ends on top and 10% below the start (the bag deals one now and then)', () => {
    const seed = SEEDS.find((sd) => dealStretch(sd).cold)
    const s = dealStretch(seed)
    expect(s.count).toBe(16)
    expect(s.top).toBe(500)
    expect(pickOf(s, 1000).final).toBeLessThan(START)
  })
})

describe('Q3: which picks fell 50% or more (the 50% line)', () => {
  it('counts down from 10%: the labels and the four tiles around the answer', () => {
    expect([0, 1, 2, 3, 4, 5].map(lineLabel)).toEqual(['None of them', '10% only', '5% and 10%', '2%, 5% and 10%', 'All but 0.5%', 'All five'])
    expect(lineQuestion(FB).labels).toEqual(['None of them', '10% only', '5% and 10%', '2%, 5% and 10%'])
    expect(lineQuestion(FB).answer).toBe('10% only')
    const fake = (k) => lineQuestion({ ...FB, fell: PICKS.slice(5 - k) })
    expect(fake(0).answer).toBe('None of them')
    expect(fake(3).labels).toEqual(['10% only', '5% and 10%', '2%, 5% and 10%', 'All but 0.5%'])
    expect(fake(5).labels).toEqual(['5% and 10%', '2%, 5% and 10%', 'All but 0.5%', 'All five'])
    for (let k = 0; k <= 5; k++) expect(fake(k).labels).toContain(fake(k).answer)
  })

  it('names fewer and more, with the falls that decide it', () => {
    const q = lineQuestion(FB)
    expect(isRight(q, '10% only')).toBe(true)
    expect(headlineOf(q, '10% only')).toBe('You found the line.')
    expect(headlineOf(q, 'None of them')).toBe('Deeper than that.')
    expect(headlineOf(q, '5% and 10%')).toBe('Not that deep.')
    expect(choiceOf(q, 'None of them').mistake).toBe('fewer')
    expect(whyLine(q, FB, 'None of them')).toBe('10% a trade fell 67.8% from the peak. 5% a trade fell 41.4%.')
    expect(fallsOf(FB).map((f) => [f.bps, pct(f.dd), f.crossed])).toEqual([
      [50, '4.9%', false], [100, '9.6%', false], [200, '18.6%', false], [500, '41.4%', false], [1000, '67.8%', true],
    ])
    expect(workingOf(q, FB).rule).toBe('Every loss needs a bigger gain to repair it. Down 50% needs +100%.')
  })

  it('when none crossed, says so and names the closest', () => {
    const seed = SEEDS.find((sd) => !dealStretch(sd).fell.length)
    const s = dealStretch(seed)
    const q = lineQuestion(s)
    expect(q.answer).toBe('None of them')
    expect(whyLine(q, s, 'None of them')).toBe(`None did. The deepest was 10% a trade, down ${pct(pickOf(s, 1000).deep.dd)} from its peak.`)
  })
})

describe('Q2: how deep the member\'s own pick fell, and the mistakes its tiles model', () => {
  it('gives the peak and the low in dollars, and the window\'s trades', () => {
    const q = deepQuestion(FB, 200, 0)
    expect(q.question).toBe('How deep was your worst drawdown?')
    expect(q.detail).toBe('Your 2% account peaked at $121,551 after trade 4. Its low after that was $98,975, after trade 21 (15 losses, 2 wins).')
    expect(q.answer).toBe('18.6%')
  })

  it('every mistake tile is its own formula on the same dollars', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const s = dealStretch(seed)
      for (const mine of PICKS) {
        const q = deepQuestion(s, mine, seed)
        const d = pickOf(s, mine).deep
        const f = mine / 10000
        expect(q.value).toBeCloseTo(1 - d.low / d.peak, 12)
        for (const c of q.choices) {
          if (c.right) continue
          const fam = mistakeFamily(c.mistake)
          if (fam === 'climb') expect(c.value).toBeCloseTo(d.peak / d.low - 1, 12)
          else if (fam === 'start') { expect(c.value).toBeCloseTo(1 - d.low / START, 12); expect(d.peakAt).toBeGreaterThan(0) }
          else if (fam === 'added') expect(c.value).toBeCloseTo(d.losses * f - d.wins * 2.5 * f, 12)
          else if (fam === 'oneLoss') expect(c.value).toBeCloseTo(f, 12)
          else if (fam === 'line') {
            const other = pickOf(s, q.lines[c.mistake])
            expect(other.bps).not.toBe(mine)
            expect(c.value).toBeCloseTo(fallOf(other.deep.peak, other.deep.low), 12)
          } else throw new Error(`an unnamed mistake ${c.mistake}`)
        }
        // four tiles, one right, every two at least 0.3 points apart, in order
        expect(q.choices).toHaveLength(4)
        expect(q.choices.filter((c) => c.right)).toHaveLength(1)
        const v = q.choices.map((c) => Math.round(c.value * 1000))
        for (let k = 1; k < 4; k++) expect(v[k] - v[k - 1]).toBeGreaterThanOrEqual(3)
        expect(new Set(q.labels).size).toBe(4)
      }
    }
  })

  it('the answer sits in every place among the tiles across runs, so its position tells nothing', () => {
    const seen = new Set()
    for (const seed of SEEDS) seen.add(deepQuestion(dealStretch(seed), 200, seed).choices.findIndex((c) => c.right))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
    // every pick: no one place holds the answer most of the time. A 0.5% pick's mistakes mostly read above its small
    // fall, so its answer splits between first and second (it once sat second 73% of the time); 2%, whose mistakes reach
    // all four places, spreads across all four.
    const runs = Array.from({ length: 400 }, (_, i) => 1762700000000 + i * 104729).map((seed) => [seed, dealStretch(seed)])
    for (const mine of PICKS) {
      const at = [0, 0, 0, 0]
      for (const [seed, s] of runs) at[deepQuestion(s, mine, seed).choices.findIndex((c) => c.right)] += 1
      expect(Math.max(...at) / runs.length, `${mine} ${at}`).toBeLessThan(mine === 200 ? 0.35 : 0.55)
      expect(at.filter((n) => n >= runs.length * 0.15).length, `${mine} ${at}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('names each mistake and teaches it on the card\'s own numbers', () => {
    // the tiles a seed deals are fixed: seed 18 deals the start, another line and the climb back around 18.6%; seed 0
    // puts the answer on top, seed 10 at the bottom
    expect(deepQuestion(FB, 200, 0).labels).toEqual(['1.0%', '4.9%', '9.6%', '18.6%'])
    expect(deepQuestion(FB, 200, 10).labels).toEqual(['18.6%', '22.8%', '41.4%', '67.8%'])
    expect(deepQuestion(FB, 200, 1).labels).toEqual(['1.0%', '4.9%', '18.6%', '22.8%'])
    const q = deepQuestion(FB, 200, 18)
    const by = (k) => q.choices.find((c) => c.mistake === k)
    expect(q.labels).toEqual(['1.0%', '9.6%', '18.6%', '22.8%'])
    expect(headlineOf(q, '18.6%')).toBe('Measured from the peak.')
    expect(whyLine(q, FB, '18.6%')).toBe('$121,551 down to $98,975 is 18.6%. Getting back needs +22.8%.')
    expect(by('climb').label).toBe('22.8%')
    expect(headlineOf(q, '22.8%')).toBe('That is the climb back.')
    expect(whyLine(q, FB, '22.8%')).toBe('22.8% is the gain from $98,975 back to $121,551. The fall itself was 18.6%.')
    expect(by('start').label).toBe('1.0%')
    expect(headlineOf(q, '1.0%')).toBe('Measured from the start.')
    expect(whyLine(q, FB, '1.0%')).toBe('A drawdown runs from the peak, $121,551, not the $100,000 start. The fall was 18.6%.')
    expect(by('lower').label).toBe('9.6%')
    expect(headlineOf(q, '9.6%')).toBe('That is another line.')
    expect(whyLine(q, FB, '9.6%')).toBe('9.6% was the 1% line\'s worst fall. Yours, at 2%, was 18.6%.')
    // the other two named mistakes, worded on a hand-made choice
    const added = { ...q, choices: [...q.choices, { label: '25.0%', value: 0.25, right: false, mistake: 'added' }, { label: '2.0%', value: 0.02, right: false, mistake: 'oneLoss' }] }
    expect(headlineOf(added, '25.0%')).toBe('Losses compound.')
    expect(whyLine(added, FB, '25.0%')).toBe('Adding the trades up gives 25.0%. Each one comes off what the last one left, so the fall was 18.6%.')
    expect(headlineOf(added, '2.0%')).toBe('That is one loss.')
    expect(whyLine(added, FB, '2.0%')).toBe('One loss at 2% is 2.0%. The drawdown is the whole fall from the peak: 18.6%.')
  })

  it('works the fall step by step, the climb back, and our rule', () => {
    const w = workingOf(deepQuestion(FB, 200, 0), FB)
    expect(w.title).toBe('How deep 2% a trade fell')
    expect(w.steps).toEqual([
      'The peak: $121,551, after trade 4.',
      'The low after it: $98,975, after trade 21 (15 losses, 2 wins).',
      `1 ${MINUS} $98,975 / $121,551 = 18.6%.`,
      'Back up from $98,975 to $121,551 is +22.8%.',
    ])
    expect(w.rule).toBe('Our rule: risk 0.25% to 2% of the account a trade. 2% is the ceiling.')
    expect(w.source).toContain('F9.01')
  })

  it('a fall from the start says so, and never offers "from the start" as a mistake', () => {
    const wins = winsOf(FALLBACK.replace(/^WWWW/, 'LLLL'))
    const s = stretchOf(wins)
    const q = deepQuestion(s, 1000, 0)
    expect(q.detail).toMatch(/^Your 10% account's high was the \$100,000 start\. Its low after that was \$[\d,]+, after trade \d+ \(/)
    expect(q.choices.some((c) => c.mistake === 'start')).toBe(false)
    expect(workingOf(q, s).steps[0]).toBe('The peak: the $100,000 start.')
  })
})

describe('the run', () => {
  it('deals three questions for any pick, the member\'s own depth second, and none for a pick it does not know', () => {
    const qs = questionsFor(FB, 500, 3)
    // the depth is asked before the 50% line, whose review lists every pick's fall (the member's own among them)
    expect(ORDER).toEqual(['streak', 'deep', 'line'])
    expect(qs.map((q) => q.key)).toEqual(['streak', 'deep', 'line'])
    expect(qs.map((q) => q.no)).toEqual([1, 2, 3])
    expect(fallsOf(FB).map((f) => f.bps)).toContain(500)
    expect(workingOf(qs[2], FB).steps.join(' ')).toContain(pct(pickOf(FB, 500).deep.dd))   // so it must come after
    expect(questionsFor(FB, 300, 3)).toEqual([])
    expect(deepQuestion(FB, 300, 0)).toBeNull()
  })

  it('says the stretch, the pick and its survival plainly', () => {
    expect(stretchLine(FB)).toBe('These 50 trades: 20 wins (40%), longest losing streak 8.')
    expect(pickLine(pickOf(FB, 200))).toBe('2% a trade: $100,000 to $144,733, deepest drawdown 18.6%')
    expect(survived(pickOf(FB, 200))).toBe(true)
    expect(survived(pickOf(FB, 1000))).toBe(false)
    expect(survivalTitle(pickOf(FB, 200))).toBe('Survived at 2%')
    expect(survivalTitle(pickOf(FB, 1000))).toBe('Down 67.8% at 10%')
    expect(survivalLine(pickOf(FB, 200))).toBe('Survived. It never fell 50% from its peak.')
    expect(survivalLine(pickOf(FB, 1000))).toBe('It fell more than 50% from its peak. Getting back from there takes more than a 100% gain.')
    expect(climbOf(244141, 78541)).toBeCloseTo(2.1085, 3)                         // 67.8% down needed +210.8%: more than 100%
  })

  it('a pick over our 2% ceiling never "survives": above the 50% line it only held this time', () => {
    expect(PICKS.map((b) => verdictOf(pickOf(FB, b)))).toEqual(['survived', 'survived', 'survived', 'held', 'fell'])
    const five = pickOf(FB, 500)
    expect(survived(five)).toBe(true)                                              // 41.4%: above the line
    expect(survivalTitle(five)).toBe('Down 41.4% at 5%')
    expect(survivalLine(five)).toBe('It held above the 50% line this time. At 5% a trade, 14 losses in a row take 51.2% of the account.')
    // a 10% pick that stayed above the line: the line names the 7 losses that would have halved it
    const seed = SEEDS.find((sd) => survived(pickOf(dealStretch(sd), 1000)))
    const ten = pickOf(dealStretch(seed), 1000)
    expect(verdictOf(ten)).toBe('held')
    expect(survivalLine(ten)).toBe('It held above the 50% line this time. At 10% a trade, 7 losses in a row take 52.2% of the account.')
    expect(survivalTitle(ten)).toBe(`Down ${pct(ten.deep.dd)} at 10%`)
  })

  it('the line under the drawn curve never states the pick\'s fall as a percent (the depth question asks for it)', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const s = dealStretch(seed)
      for (const mine of PICKS) {
        const p = pickOf(s, mine)
        const whole = (t) => new RegExp(`(^|[^\\d.])${t.replace(/[.+]/g, '\\$&')}`)   // "2.2%" inside "52.2%" is another number
        expect(survivalLine(p)).not.toMatch(whole(pct(p.deep.dd)))
        expect(survivalLine(p)).not.toMatch(whole(signedPct(climbOf(p.deep.peak, p.deep.low))))
      }
    }
    expect(runIdOf(1731100000000, 2)).toBe(`survive-${(1731100000000).toString(36)}-2`)
    expect(runIdOf(1731100000000, 2).length).toBeLessThanOrEqual(64)
  })

  it('writes no dash, no "the firm", no NaN anywhere a member reads', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const s = dealStretch(seed)
      clean(stretchLine(s))
      for (const mine of PICKS) {
        clean(pickLine(pickOf(s, mine))); clean(survivalLine(pickOf(s, mine))); clean(survivalTitle(pickOf(s, mine)))
        for (const q of questionsFor(s, mine, seed)) {
          clean(q.question); clean(q.detail)
          const w = workingOf(q, s)
          clean(w.title); w.steps.forEach(clean); clean(w.rule); clean(w.source)
          for (const l of q.labels) { clean(l); clean(headlineOf(q, l)); clean(whyLine(q, s, l)) }
          // a question is one line of plain words: no sentence over 22 words (VOICE.md §1)
          for (const sentence of `${q.question} ${q.detail}`.split(/[.?]\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(22)
        }
      }
    }
  })
})

describe('many stretches: the same game 10,000 times, every draw kept', () => {
  /** The definition worked here without the module's path, drawdown, streak or sort helpers: the same draws (rngOf and
   *  bagDraw, tested above), then each pick compounded trade by trade, its running peak and deepest fall kept by hand. */
  function byHand(winPct) {
    const k = PICKS.length
    const o = { winPct, n: 10000, top: Array(k).fill(0), half: Array(k).fill(0), deep30: Array(k).fill(0), below: Array(k).fill(0), median: [], p10: [], streak: 0 }
    const ends = PICKS.map(() => [])
    for (let i = 0; i < 10000; i++) {
      const w = bagDraw(rngOf(1 + i), 50, winPct)
      let run = 0, longest = 0
      for (const x of w) { run = x ? 0 : run + 1; if (run > longest) longest = run }
      if (longest >= 7) o.streak += 1
      const fin = PICKS.map((bps, j) => {
        const f = bps / 10000
        let b = 100000, peak = b, dd = 0
        for (const x of w) { b *= x ? 1 + 2.5 * f : 1 - f; if (b > peak) peak = b; if (1 - b / peak > dd) dd = 1 - b / peak }
        if (dd >= 0.5) o.half[j] += 1
        if (dd >= 0.3) o.deep30[j] += 1
        if (b < 100000) o.below[j] += 1
        ends[j].push(b)
        return b
      })
      o.top[fin.indexOf(Math.max(...fin))] += 1
    }
    for (const e of ends) { e.sort((a, b) => a - b); o.median.push(Math.round(e[4999])); o.p10.push(Math.round(e[999])) }
    return o
  }
  /** The exact chance of `w` winners in 50 draws. */
  const binom = (w, p, n = 50) => { let c = 1; for (let i = 0; i < w; i++) c = (c * (n - i)) / (i + 1); return c * p ** w * (1 - p) ** (n - w) }
  /** Where a pick ends with `w` winners in 50: only the count sets it. */
  const endAt = (bps, w) => 100000 * (1 + 2.5 * bps / 10000) ** w * (1 - bps / 10000) ** (50 - w)

  it('the pinned counts are what manyOf measures, seeds 1 to 10,000, on both bags', () => {
    expect([MANY_N, MANY_FIRST_SEED, SMALL_WIN_PCT]).toEqual([10000, 1, 30])
    expect(manyOf(WIN_PCT)).toEqual(MANY[WIN_PCT])
    expect(manyOf(SMALL_WIN_PCT)).toEqual(MANY[SMALL_WIN_PCT])
  })

  it('recomputed here from the definition, every count, middle finish and tenth matches', () => {
    expect(byHand(40)).toEqual(MANY[40])
    expect(byHand(30)).toEqual(MANY[30])
  })

  it('agrees with exact arithmetic: finishing below the start, finishing highest and the streak, within sampling error', () => {
    for (const winPct of [40, 30]) {
      const p = winPct / 100, m = MANY[winPct]
      const near = (count, exact, why) => {
        const se = Math.sqrt((exact * (1 - exact)) / 10000)
        expect(Math.abs(count / 10000 - exact), `${winPct} ${why}: ${count} against ${exact}`).toBeLessThan(4 * se + 1e-9)
      }
      PICKS.forEach((bps, j) => {
        let below = 0
        for (let w = 0; w < winsToFinishAbove(bps); w++) below += binom(w, p)
        near(m.below[j], below, `below ${bps}`)
        // the top finisher for each win count, from the finishes alone
        let top = 0
        for (let w = 0; w <= 50; w++) { const ends = PICKS.map((b) => endAt(b, w)); if (ends.indexOf(Math.max(...ends)) === j) top += binom(w, p) }
        near(m.top[j], top, `top ${bps}`)
      })
      near(m.streak, streakChance(7, 50, 100 - winPct), 'streak')
    }
    // the middle finish is the finish at the middle win count: 20 of 50 on 4 in 10, 15 of 50 on 3 in 10
    expect(MANY[40].median).toEqual(PICKS.map((b) => Math.round(endAt(b, 20))))
    expect(MANY[30].median).toEqual(PICKS.map((b) => Math.round(endAt(b, 15))))
    expect(MANY[40].median[4]).toBe(367685)                                       // 1.25²⁰ × 0.9³⁰ × $100,000
    expect(MANY[30].median[4]).toBe(71144)                                        // 1.25¹⁵ × 0.9³⁵ × $100,000
  })

  it('says why the old first question failed: this bag grows fastest at 16% a trade, above every pick', () => {
    const growth = (p, f) => p * Math.log(1 + 2.5 * f) + (1 - p) * Math.log(1 - f)  // the average log change a trade
    const best = (p) => p - (1 - p) / 2.5                                           // where growth peaks (the Kelly fraction)
    expect(best(0.4)).toBeCloseTo(0.16, 12)
    for (let i = 1; i < PICKS.length; i++) expect(growth(0.4, PICKS[i] / 10000)).toBeGreaterThan(growth(0.4, PICKS[i - 1] / 10000))
    expect(MANY[40].top[4]).toBeGreaterThan(8000)                                  // so 10% finished highest in 8,409
    // the same bag a little worse, 3 in 10: still +0.05R a trade, its growth peaks at exactly our 2% ceiling, and 5% and
    // 10% shrink the account on average
    expect(SMALL_EDGE_R100).toBe(5)
    expect(SMALL_EDGE_TEXT).toBe('+0.05R')
    expect(best(0.3)).toBeCloseTo(0.02, 12)
    expect(growth(0.3, 0.02)).toBeGreaterThan(0)
    expect(growth(0.3, 0.05)).toBeLessThan(0)
    expect(growth(0.3, 0.1)).toBeLessThan(0)
  })

  it('the headline facts: 10% fell by half in 5,958, 2% in none; on 3 in 10, 10% fell by half in 9,115', () => {
    const [a, b] = [MANY[40], MANY[30]]
    expect([a.half, b.half]).toEqual([[0, 0, 0, 520, 5958], [0, 0, 3, 3422, 9115]])
    expect([a.below[4], b.below[4], a.below[1], b.below[1]]).toEqual([1591, 6850, 547, 4462])
    // a bigger risk falls deeper on the same trades, on either bag
    for (const m of [a, b]) for (let j = 1; j < PICKS.length; j++) expect(m.half[j]).toBeGreaterThanOrEqual(m.half[j - 1])
    // on 3 in 10, 2% keeps the best middle finish of the five
    expect(Math.max(...b.median)).toBe(b.median[2])
  })

  it('the panel says what the many stretches say, in a mentor\'s words, never that bigger risk is better', () => {
    const m = manyPanel()
    expect(m.eyebrow).toBe('Across 10,000 stretches')
    expect(m.title).toBe('One stretch is one draw. Here is the same game 10,000 times.')
    expect(m.bags.map((x) => x.label)).toEqual(['4 in 10 win, +0.4R', '3 in 10 win, +0.05R'])
    expect(m.rows).toEqual(PICKS.map((bps, j) => ({ bps, big: MANY[40].half[j], small: MANY[30].half[j] })))
    expect(m.lines).toEqual([
      'On this bag, 4 in 10 at +2.5R, 10% a trade fell by half or more in 5,958 of them. 2% a trade never did, in any of the 10,000.',
      '10% a trade did finish highest in 8,409 of them. Big risk only pays like that on a big edge you know for sure.',
      'You never know your real edge for sure. Make the bag 3 in 10, still +0.05R a trade: 10% a trade fell by half in 9,115 and finished below the start in 6,850. 2% a trade fell by half in 3 of them.',
      'Over many trades on 3 in 10, 2% grows the account fastest. 5% and 10% shrink it.',
      'The middle stretch at 10% a trade: $367,685 on 4 in 10, $71,144 on 3 in 10. At 2%: $144,733 and $102,507.',
      'A 50% fall needs +100% to get back. That is why our ceiling is 2%.',
    ])
    expect(m.source).toBe(SOURCE_MANY)
    for (const t of [m.eyebrow, m.title, ...m.lines, m.source]) { clean(t); expect(t).not.toMatch(/\bbetter\b|\bbest\b|\bgo big\b/i) }
    // the one fact in big risk's favour is said with what it needs, in the same line
    const finish = m.lines.find((l) => /finish highest/.test(l))
    expect(finish).toMatch(/only pays like that on a big edge you know for sure/)
    expect(countText(0)).toBe('none')
    expect(countText(5958)).toBe('5,958')
    expect(manyHalfLine()).toBe('Across 10,000 stretches of this game, 10% a trade fell by half or more in 5,958, 5% in 520, 2% in none.')
    expect(workingOf(lineQuestion(FB), FB).steps).toContain(manyHalfLine())
  })
})

describe('how the answers spread across deals: no answer, and no guess from the tiles alone, covers most runs', () => {
  // 1,500 deals here; the same run carried on to 10,000 deals measured: the streak's commonest answer 24.3%, the depth's
  // 19.7%, the 50% line's 59.1% ("10% only"); the answer's place among the tiles at most 32.7% (streak) and 46.8% (depth)
  let cache = null
  const deals = () => (cache ||= Array.from({ length: 1500 }, (_, i) => 1762800000000 + i * 7919).map((seed) => {
    const s = dealStretch(seed)
    return { s, qs: PICKS.map((bps) => questionsFor(s, bps, seed)) }
  }))
  const shareOf = (list) => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) || 0) + 1); return Math.max(...m.values()) / list.length }

  it('the streak, the depth and the 50% line: the commonest answer and the commonest place, per pick', () => {
    const limits = { streak: [0.3, 0.4], deep: [0.25, 0.55], line: [0.62, 0.62] }
    PICKS.forEach((bps, j) => {
      ORDER.forEach((key, qi) => {
        const qs = deals().map((d) => d.qs[j][qi])
        expect(qs.every((q) => q.key === key)).toBe(true)
        const [answer, place] = limits[key]
        expect(shareOf(qs.map((q) => q.answer)), `${key} ${bps} answer`).toBeLessThan(answer)
        expect(shareOf(qs.map((q) => q.choices.findIndex((c) => c.right))), `${key} ${bps} place`).toBeLessThan(place)
      })
    })
  })

  it('no rule read off the streak tiles alone wins most runs: not a place, not the pair that makes 100%', () => {
    PICKS.forEach((bps, j) => {
      const qs = deals().map((d) => d.qs[j][0])
      let smaller = 0, larger = 0
      for (const q of qs) {
        const pair = []
        q.choices.forEach((a, x) => q.choices.forEach((b, y) => { if (x < y && Math.abs(a.value + b.value - 1) < 1e-9) pair.push([x, y]) }))
        if (pair.length && q.choices[pair[0][0]].right) smaller += 1
        if (pair.length && q.choices[pair[0][1]].right) larger += 1
      }
      expect(smaller / qs.length, `${bps}`).toBeLessThan(0.5)
      expect(larger / qs.length, `${bps}`).toBeLessThan(0.5)
    })
  })

  it('the deals fall by half at the bag\'s own rate: 10% crossed the 50% line in about 6 runs in 10', () => {
    const crossed = deals().filter((d) => d.s.fell.includes(1000)).length / deals().length
    expect(Math.abs(crossed - MANY[40].half[4] / MANY_N)).toBeLessThan(0.05)
  })
})

describe('the words and the chart helpers', () => {
  it('formats money, percents and axis labels exactly', () => {
    expect(dollars(131240)).toBe('$131,240')
    expect(dollars(1959749.4)).toBe('$1,959,749')
    expect(pct(0.131343)).toBe('13.1%')
    expect(pct(0.5)).toBe('50.0%')
    expect(signedPct(0.312)).toBe('+31.2%')
    expect(signedPct(-0.012)).toBe(`${MINUS}1.2%`)
    expect(signedPct(0)).toBe('0.0%')
    expect([12500, 50000, 102500, 1600000].map(kText)).toEqual(['$12.5k', '$50k', '$102.5k', '$1.6M'])
    expect(windowText({ losses: 7, wins: 0 })).toBe('7 losses in a row')
    expect(windowText({ losses: 7, wins: 1 })).toBe('7 losses, 1 win')
    expect(windowText({ losses: 1, wins: 0 })).toBe('1 loss')
    expect(atText(0)).toBe('at the start')
    expect(atText(21)).toBe('after trade 21')
  })

  it('the five-line chart always holds two gridlines a doubling apart, reaching only the nearer one it needs', () => {
    // lines from $100k to $120k: double the start ($200k) is nearer than half ($50k), so the chart reaches up to it
    const [lo, hi] = domainOf([[100000, 120000]], true)
    expect(lo).toBeGreaterThan(50000)
    expect(lo).toBeLessThan(100000)
    expect(hi).toBeGreaterThan(200000)
    expect(ticksOf(lo, hi, true)).toEqual([100000, 200000])
    // lines from $70k to $105k: half the start is nearer, so the chart reaches down to $50k
    const [lo2, hi2] = domainOf([[100000, 70000, 105000]], true)
    expect(ticksOf(lo2, hi2, true)).toEqual([50000, 100000])
    expect(hi2).toBeLessThan(200000)
    // lines that already cross two gridlines are left as they are, padded
    const [lo3, hi3] = domainOf([[100000, 40000, 450000]], true)
    expect(ticksOf(lo3, hi3, true)).toEqual([50000, 100000, 200000, 400000])
    expect(ticksOf(40000, 450000, true)).toEqual([50000, 100000, 200000, 400000])
    for (const seed of SEEDS.slice(0, 40)) {
      const s = dealStretch(seed)
      const [a, b] = domainOf(s.picks.map((p) => p.balances), true)
      expect(ticksOf(a, b, true).length).toBeGreaterThanOrEqual(2)
    }
    expect(niceStep(15000, 4)).toBe(5000)
    expect(ticksOf(97000, 112000, false)).toEqual([100000, 105000, 110000])
    const [a, b] = domainOf([[100000, 103000, 101000]], false)
    expect(a).toBeLessThan(100000)
    expect(b).toBeGreaterThan(103000)
  })

  it('pushes the end labels apart in order, inside the plot', () => {
    expect(spreadLabels([100, 105, 300], 14, 0, 400)).toEqual([100, 114, 300])
    expect(spreadLabels([395, 398], 14, 0, 400)).toEqual([386, 400])
    expect(spreadLabels([300, 100, 104], 14, 0, 400)).toEqual([300, 100, 114])
    const many = spreadLabels([200, 201, 202, 203, 204], 14, 0, 400)
    for (let i = 1; i < many.length; i++) expect(many[i] - many[i - 1]).toBeGreaterThanOrEqual(14)
  })
})

describe('growth over many trades (the Kelly idea, recomputed from the definition)', () => {
  it('on 3 in 10 at +2.5R, 2% grows fastest and 5% and 10% shrink the account; on 4 in 10, 10% grows fastest', async () => {
    const { growthPerTrade, growthOfPicks, smallGrowthLine } = await import('./survive')
    const g = (p, f) => p * Math.log(1 + 2.5 * f) + (1 - p) * Math.log(1 - f)
    for (const [w, bps] of [[30, 50], [30, 200], [30, 500], [40, 1000]]) expect(growthPerTrade(w, bps)).toBeCloseTo(g(w / 100, bps / 10000), 12)
    expect(0.3 - 0.7 / 2.5).toBeCloseTo(0.02, 12)                       // the best fraction on 3 in 10 is exactly 2%
    expect(growthOfPicks(30)).toEqual({ fastest: 200, shrink: [500, 1000] })
    expect(growthOfPicks(40)).toEqual({ fastest: 1000, shrink: [] })    // why one lucky stretch can flatter 10%
    expect(smallGrowthLine(30)).toBe('Over many trades on 3 in 10, 2% grows the account fastest. 5% and 10% shrink it.')
  })
})
