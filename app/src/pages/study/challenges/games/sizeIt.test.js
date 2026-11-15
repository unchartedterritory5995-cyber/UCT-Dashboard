// Size It's arithmetic, on known values worked by hand, and its generator's rules over thousands of seeded cards.
import { describe, it, expect } from 'vitest'
import house from '../../../../constants/houseSizing.json'
import { sizeFor } from '../../../journal-2-0/lib/blocks/sizeCalc'
import { blitzMult } from '../challengeBank'
import {
  ACCOUNTS, LAST_RESORT, LESSON, LESSON_SOURCE, LEVELS, MAX_POSITION_PCT, MAX_PRICE, MAX_RISK_BPS, MAX_STOP_PCT, MIN_PRICE, MIN_RISK_BPS,
  MIN_SHARES, MIN_STOP_PCT, MISTAKES, NAMED, RISK_BPS, ROUND_DOWN, SIZE_KIND, SIZE_POINTS, SIZE_SECS, TRAP_SHARE, buildCard, cardAt, dollars,
  ladderGap, levelAt, missTitle, mistakeOf, mistakeOrder, mistakeValues, money, pointsFor, price, quotientText, riskPctText, rngFor, runIdOf,
  sharesFor, sharesText, sizeMult, sizeVerdict, slipLine, stopPctTenths, stopPctText, topSlip, whyLine, working, workingText,
} from './sizeIt'

// $40,000 at 1%, long $50.00, stop $48.00: $400 / $2.00 = 200 shares exactly
const ROUND = { account: 40000, riskBps: 100, entryCents: 5000, distCents: 200 }
// $75,000 at 0.75%, long $137.42, stop $131.80: $562.50 / $5.62 = 100.08, 100 shares
const REAL = { account: 75000, riskBps: 75, entryCents: 13742, distCents: 562 }
const ORDER = ['price', 'roundUp', 'tenX', 'stopPct', 'noRisk']
const roundCard = (over = {}) => buildCard({ ...ROUND, order: ORDER, tenDir: 'up', ...over })
const realCard = (over = {}) => buildCard({ ...REAL, order: ORDER, tenDir: 'up', ...over })

describe('the house numbers', () => {
  it('reads the risk range and the ceiling from our sizing rule', () => {
    expect(MIN_RISK_BPS).toBe(25)
    expect(MAX_RISK_BPS).toBe(200)
    expect(MAX_RISK_BPS).toBe(house.maxAccountRiskPct * 100)
    expect(Math.min(...RISK_BPS)).toBe(MIN_RISK_BPS)
    expect(Math.max(...RISK_BPS)).toBe(MAX_RISK_BPS)
    expect(MAX_POSITION_PCT).toBe(40)   // the account rulebook's cap (sizing_rule.md §9 A7), not the ceiling table's top
    expect(SIZE_KIND).toBe('size')
    expect(SIZE_SECS).toBe(60)
    expect(LESSON).toBe('Stop first, distance second, size last.')
  })
  it('keeps every level inside the range, and leans to 1% or under (normal per sizing_rule §1)', () => {
    for (const lv of Object.values(LEVELS)) {
      expect(lv.risk.every((b) => RISK_BPS.includes(b))).toBe(true)
      expect(lv.accounts.every((a) => ACCOUNTS.includes(a))).toBe(true)
      expect(lv.risk.filter((b) => b <= 100).length).toBeGreaterThan(lv.risk.length / 2)
    }
    expect(ACCOUNTS[0]).toBe(10000)
    expect(ACCOUNTS[ACCOUNTS.length - 1]).toBe(500000)
  })
  it('ramps: three warm-up cards, four on quarter prices, then any price', () => {
    expect([0, 1, 2].map((i) => levelAt(i).key)).toEqual(['easy', 'easy', 'easy'])
    expect([3, 4, 5, 6].map((i) => levelAt(i).key)).toEqual(['medium', 'medium', 'medium', 'medium'])
    expect([7, 20, 99].map((i) => levelAt(i).key)).toEqual(['hard', 'hard', 'hard'])
  })
})

describe('the formula (sizing_rule §3)', () => {
  it('sizes from the stop, rounded down', () => {
    expect(sharesFor(40000, 100, 5000, 4800)).toBe(200)
    expect(sharesFor(75000, 75, 13742, 13180)).toBe(100)
    expect(sharesFor(25000, 50, 2000, 1940)).toBe(208)       // $125 / $0.60 = 208.33
    expect(sharesFor(10000, 25, 4000, 4000)).toBe(0)         // no distance, no size
    expect(sharesFor(10000, 25, 4000, 4100)).toBe(0)         // a stop above a long entry is not a long stop
  })
  it('agrees with the journal calculator and with the house route (risk % / stop % of the price, then / entry)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const idx of [0, 4, 9]) {
        const c = cardAt(seed, idx)
        const calc = sizeFor({ entry: c.entryCents / 100, stop: c.stopCents / 100, riskPct: c.riskBps / 100, accountSize: c.account })
        expect(calc.ok).toBe(true)
        expect(calc.shares).toBe(c.shares)
        const position = (c.riskBps / 10000) / (c.distCents / c.entryCents)              // Position % = risk % / stop %, as a fraction
        const viaHouse = Math.floor(Math.round(((position * c.account) / (c.entryCents / 100)) * 1e6) / 1e6)
        expect(viaHouse).toBe(c.shares)
      }
    }
  })
  it('measures the stop as a percent of the entry, in tenths, half up', () => {
    expect(stopPctTenths(200, 5000)).toBe(40)
    expect(stopPctTenths(562, 13742)).toBe(41)
    expect(stopPctTenths(25, 1000)).toBe(25)
  })
})

describe('the named mistakes', () => {
  it('computes each one on a card that divides exactly', () => {
    const base = { ...ROUND, riskCents: 40000, shares: 200 }
    // $400 / $50 = 8 · exact, so no round-up · $4,000 / $2 = 2,000 · $400 / 4 = 100 · $40,000 / $2 = 20,000
    expect(mistakeValues(base, 'up')).toEqual({ price: 8, roundUp: null, tenX: 2000, stopPct: 100, noRisk: 20000 })
    expect(mistakeValues(base, 'down').tenX).toBe(20)                                    // $40 / $2 = 20
  })
  it('computes each one on a card with real cents', () => {
    const base = { ...REAL, riskCents: 56250, shares: 100 }
    // $562.50 / $137.42 = 4.09 · 101 · $5,625 / $5.62 = 1,000.89 · $562.50 / 4.1 = 137.2 · $75,000 / $5.62 = 13,345.2
    expect(mistakeValues(base, 'up')).toEqual({ price: 4, roundUp: 101, tenX: 1000, stopPct: 137, noRisk: 13345 })
    expect(mistakeValues(base, 'down').tenX).toBe(10)                                   // $56.25 / $5.62 = 10.0
  })
  it('drops a mistake that lands on the right size, and one under a whole share', () => {
    // $100 risk, $4.00 stop on a $100 stock: the 4% stop read as $4.00 IS the right size, so it is no mistake here
    const v = mistakeValues({ account: 10000, riskBps: 100, entryCents: 10000, distCents: 400, riskCents: 10000, shares: 25 }, 'down')
    expect(v.stopPct).toBe(null)
    expect(v.price).toBe(1)
    expect(v.tenX).toBe(2)                                                               // $10 / $4.00 = 2.5
    // $25 risk on a $40 stock: sized on the price it is under one share, so it is no tile
    expect(mistakeValues({ account: 10000, riskBps: 25, entryCents: 4000, distCents: 100, riskCents: 2500, shares: 25 }, 'up').price).toBe(null)
  })
  it('deals the four named in the brief first, the round-up trap only on a trap draw, and the risk % left out last', () => {
    expect(NAMED).toEqual(['price', 'roundUp', 'tenX', 'stopPct'])
    expect(LAST_RESORT).toBe('noRisk')
    expect(TRAP_SHARE).toBe(0.5)
    for (let seed = 1; seed <= 50; seed++) {
      const trap = mistakeOrder(rngFor(seed, 0), true)
      expect([...trap].sort()).toEqual([...NAMED, LAST_RESORT].sort())
      expect(trap[trap.length - 1]).toBe(LAST_RESORT)
      const plain = mistakeOrder(rngFor(seed, 0), false)
      expect(plain).not.toContain('roundUp')
      expect(plain).toHaveLength(4)
      expect(plain[3]).toBe(LAST_RESORT)
      expect(mistakeOrder(rngFor(seed, 0), false)).toEqual(plain)          // the same draw for the same seed
    }
  })
  it('names every mistake for the miss', () => {
    expect(Object.keys(MISTAKES)).toEqual(ORDER)
    for (const m of Object.values(MISTAKES)) {
      expect(m.title).toMatch(/\.$/)
      expect(m.title).not.toMatch(/—/)
      expect(m.short.length).toBeLessThan(28)
      expect(`${m.title} ${m.short}`).not.toMatch(/ %/)    // a no-break space: never a lone "%." on its own line on a phone
    }
    expect(MISTAKES.noRisk.title).toBe('Forgot the risk %.')
  })
})

describe('a card', () => {
  it('builds the round card: 200 shares, three mistakes, sorted, the working exact', () => {
    const c = roundCard()
    expect(c).toMatchObject({ shares: 200, riskCents: 40000, stopCents: 4800, exact: true, q100: 20000, positionCents: 1000000, stopTenths: 40 })
    expect(c.choices).toEqual([
      { value: 8, mistake: 'price' }, { value: 100, mistake: 'stopPct' }, { value: 200, mistake: null }, { value: 2000, mistake: 'tenX' },
    ])
    expect(workingText(c)).toBe('Risk $400 = $40,000 × 1%. Per share $2.00 = $50.00 − $48.00. $400 / $2.00 = 200 shares, exactly.')
  })
  it('builds the real card: the round-up trap first, the working rounded down', () => {
    const c = realCard()
    expect(c).toMatchObject({ shares: 100, riskCents: 56250, stopCents: 13180, exact: false, q100: 10008, stopTenths: 41 })
    expect(c.choices.map((x) => x.value)).toEqual([4, 100, 101, 1000])
    expect(c.choices.map((x) => x.mistake)).toEqual(['price', null, 'roundUp', 'tenX'])
    expect(working(c).map((s) => s.text)).toEqual([
      'Risk $562.50 = $75,000 × 0.75%.',
      'Per share $5.62 = $137.42 − $131.80.',
      '$562.50 / $5.62 = 100.08, so 100 shares, rounded down.',
    ])
    expect(working(c).map((s) => s.value)).toEqual(['$562.50', '$5.62', '100 shares'])
    // without the trap preferred, the order decides
    expect(realCard({ preferRoundUp: false, order: ['noRisk', 'stopPct', 'tenX', 'price', 'roundUp'] }).choices.map((x) => x.value)).toEqual([100, 137, 1000, 13345])
  })
  it('refuses a card that breaks a rule of the game', () => {
    expect(roundCard({ account: 12345 })).toBe(null)                         // not one of our accounts
    expect(roundCard({ riskBps: 300 })).toBe(null)                           // over the 2% ceiling
    expect(roundCard({ riskBps: 10 })).toBe(null)                            // under 0.25%
    expect(roundCard({ entryCents: 700 })).toBe(null)                        // under $8
    expect(roundCard({ entryCents: 45000 })).toBe(null)                      // over $400
    expect(roundCard({ distCents: 45 })).toBe(null)                          // a 0.9% stop
    expect(roundCard({ distCents: 450 })).toBe(null)                         // a 9% stop
    expect(roundCard({ distCents: 100 })).toBe(null)                         // 400 shares of $50 = 50% of the account, over our 40%
    expect(buildCard({ account: 10000, riskBps: 25, entryCents: 40000, distCents: 2000, order: ORDER })).toBe(null)   // $25 / $20 = 1 share
  })
  it('knows which mistake a tile was, and says what it teaches on the card\'s own numbers', () => {
    const c = realCard()
    expect(mistakeOf(c, 100)).toBe(null)
    expect(mistakeOf(c, 101)).toBe('roundUp')
    expect(mistakeOf(c, 7)).toBe(null)
    expect(whyLine(c, 101)).toBe('101 shares lose $567.62 at the stop, over your $562.50. Round down.')
    expect(whyLine(c, 4)).toBe('You divided the $562.50 risk by the $137.42 price. Divide it by the stop distance, $5.62 a share.')
    expect(whyLine(c, 1000)).toBe('That is the size for $5,625 of risk. 0.75% of $75,000 is $562.50.')
    const down = realCard({ tenDir: 'down' })
    expect(whyLine(down, 10)).toBe('That is the size for $56.25 of risk. 0.75% of $75,000 is $562.50.')
    const pct = realCard({ preferRoundUp: false, order: ['stopPct', 'noRisk', 'price'] })
    expect(whyLine(pct, 137)).toBe('The stop is 4.1% under the entry. That is not $4.10 a share; it is $5.62.')
    expect(whyLine(pct, 13345)).toBe('That puts the whole $75,000 at risk at the stop. Take 0.75% of it first: $562.50.')
    expect(missTitle(c, 101)).toBe('Rounded up.')
    expect(missTitle(c, 4)).toBe('Sized on the price.')
    expect(missTitle(c, 7)).toBe('Not this one.')
  })
  it('scales the ladder from a 1% stop (0) to an 8% stop (1)', () => {
    expect(ladderGap(roundCard())).toBeCloseTo(3 / 7, 6)
    expect(ladderGap(buildCard({ account: 10000, riskBps: 25, entryCents: 8000, distCents: 80, order: ORDER }))).toBe(0)
    expect(ladderGap(buildCard({ account: 50000, riskBps: 200, entryCents: 5000, distCents: 400, order: ORDER }))).toBe(1)
  })
})

describe('the generator', () => {
  it('deals the same card for the same seed and index, and a different run for another seed', () => {
    expect(cardAt(12345, 3)).toEqual(cardAt(12345, 3))
    const a = Array.from({ length: 10 }, (_, i) => cardAt(777, i).shares)
    const b = Array.from({ length: 10 }, (_, i) => cardAt(778, i).shares)
    expect(a).not.toEqual(b)
    const r1 = rngFor(9, 2), r2 = rngFor(9, 2)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
    expect(rngFor(9, 3)()).not.toBe(rngFor(9, 2)())
  })
  it('keeps every rule on thousands of cards: range, realism, our ceiling, four distinct positive tiles, the right one floor()', () => {
    const seen = { roundUp: 0, noRisk: 0, cards: 0, risk: new Set(), levels: new Set(), mistakes: new Set(), fractional: 0 }
    for (let seed = 1; seed <= 400; seed++) {
      for (let i = 0; i < 14; i++) {
        const c = cardAt(seed * 7919 + 13, i)
        expect(c).not.toBe(null)
        expect(c.level).toBe(levelAt(i).key)
        if (c.level === 'easy') expect(c.exact).toBe(true)                               // the warm-up divides exactly
        expect(RISK_BPS).toContain(c.riskBps)
        expect(ACCOUNTS).toContain(c.account)
        expect(c.entryCents).toBeGreaterThanOrEqual(MIN_PRICE * 100)
        expect(c.entryCents).toBeLessThanOrEqual(MAX_PRICE * 100)
        expect(c.entryCents % LEVELS[c.level].step).toBe(0)
        expect(c.distCents % LEVELS[c.level].step).toBe(0)
        const stopPct = (c.distCents / c.entryCents) * 100
        expect(stopPct).toBeGreaterThanOrEqual(MIN_STOP_PCT)
        expect(stopPct).toBeLessThanOrEqual(MAX_STOP_PCT)
        expect(c.stopCents).toBe(c.entryCents - c.distCents)
        expect(c.shares).toBe(Math.floor(c.riskCents / c.distCents))
        expect(c.riskCents).toBe((c.account * c.riskBps) / 100)
        expect(Number.isInteger(c.riskCents)).toBe(true)
        expect(c.shares).toBeGreaterThanOrEqual(MIN_SHARES)
        expect(c.shares * c.distCents).toBeLessThanOrEqual(c.riskCents)                  // the loss at the stop stays inside the risk
        expect((c.shares + 1) * c.distCents).toBeGreaterThan(c.riskCents)                // and one more share would break it
        expect(c.shares * c.entryCents).toBeLessThanOrEqual(c.account * MAX_POSITION_PCT) // no position over 40% of the account
        expect(c.choices).toHaveLength(4)
        const vals = c.choices.map((x) => x.value)
        expect(new Set(vals).size).toBe(4)
        expect(vals.every((v) => Number.isInteger(v) && v >= 1)).toBe(true)
        expect([...vals].sort((p, q) => p - q)).toEqual(vals)
        expect(c.choices.filter((x) => x.mistake == null)).toEqual([{ value: c.shares, mistake: null }])
        for (const x of c.choices) if (x.mistake) expect(mistakeValues(c, c.tenDir)[x.mistake]).toBe(x.value)
        expect(sharesText(Math.max(...vals)).length).toBeLessThanOrEqual(12)             // fits a 2x2 tile (VOICE §4)
        const dealt = new Set(c.choices.map((x) => x.mistake))
        if (dealt.has('roundUp')) {
          seen.roundUp += 1
          expect(c.choices.find((x) => x.mistake === 'roundUp').value).toBe(c.shares + 1)   // the trap is one share over
        }
        if (dealt.has('noRisk')) {
          // the risk % left out only when the named four could not fill three distinct slots on this card
          seen.noRisk += 1
          const v = mistakeValues(c, c.tenDir)
          const usable = new Set(NAMED.filter((k) => k !== 'roundUp' || dealt.has('roundUp')).map((k) => v[k]).filter((x) => x != null))
          expect(usable.size).toBeLessThan(3)
        }
        seen.cards += 1
        if (!c.exact) seen.fractional += 1
        seen.risk.add(c.riskBps); seen.levels.add(c.level)
        c.choices.forEach((x) => x.mistake && seen.mistakes.add(x.mistake))
      }
    }
    expect(seen.risk.size).toBe(RISK_BPS.length)                    // 0.25% to 2%, every step turns up
    expect([...seen.levels].sort()).toEqual(['easy', 'hard', 'medium'])
    expect([...seen.mistakes].sort()).toEqual([...ORDER].sort())   // every named mistake is dealt
    // the trap sits on about half the cards that do not divide exactly: common enough to teach "round down", rare enough
    // that the lower of two neighbours is not the answer to every card (OWNER_PRINCIPLES rule 10)
    expect(seen.roundUp / seen.fractional).toBeGreaterThan(0.4)
    expect(seen.roundUp / seen.fractional).toBeLessThan(0.6)
    expect(seen.noRisk / seen.cards).toBeLessThan(0.1)              // a size nobody would buy is a rare filler, not a tile on most cards
  })
})

describe('the words and numbers', () => {
  it('formats money, prices, shares and percents', () => {
    expect(money(40000)).toBe('$400')
    expect(money(56250)).toBe('$562.50')
    expect(money(562500)).toBe('$5,625')
    expect(money(5)).toBe('$0.05')
    expect(price(5000)).toBe('$50.00')
    expect(price(13742)).toBe('$137.42')
    expect(dollars(500000)).toBe('$500,000')
    expect(sharesText(13345)).toBe('13,345')
    expect(sharesText(1250000)).toBe('1,250,000')
    expect([25, 50, 75, 100, 125, 150, 175, 200].map(riskPctText)).toEqual(['0.25%', '0.5%', '0.75%', '1%', '1.25%', '1.5%', '1.75%', '2%'])
    expect(stopPctText(41)).toBe('4.1%')
    expect(stopPctText(40)).toBe('4%')
    expect(quotientText(10008)).toBe('100.08')
    expect(quotientText(123405)).toBe('1,234.05')
  })
  it('cuts the quotient, never rounds it up past the size it rounds down to', () => {
    // $100 / $0.03 = 3,333.33; $1,250 / $3.75 = 333.33; 99.999 shows 99.99, never 100.00
    expect(quotientText(Math.floor((10000 * 100) / 3))).toBe('3,333.33')
    expect(quotientText(Math.floor((9999900 * 100) / 100000))).toBe('99.99')
  })
  it('writes no em-dash and never "the firm" anywhere a member reads', () => {
    const texts = []
    for (let seed = 1; seed <= 60; seed++) {
      for (let i = 0; i < 10; i++) {
        const c = cardAt(seed, i)
        texts.push(workingText(c), ...c.choices.map((x) => whyLine(c, x.value)), ...c.choices.map((x) => missTitle(c, x.value)))
      }
    }
    texts.push(slipLine([]), slipLine([{ ok: true }]), slipLine([{ ok: false, mistake: 'tenX' }]), LESSON, ROUND_DOWN, LESSON_SOURCE)
    for (const t of texts) {
      expect(t).not.toMatch(/—/)
      expect(t).not.toMatch(/the firm/i)
      expect(t).not.toMatch(/NaN|undefined|Infinity/)
    }
  })
})

describe('the run', () => {
  it('climbs the multiplier on the same ladder as Blitz', () => {
    for (let c = 0; c <= 14; c++) expect(sizeMult(c)).toBe(blitzMult(c))
    expect([0, 1, 2, 3, 6, 9, 20].map(sizeMult)).toEqual([1, 2, 2, 3, 4, 5, 5])
    expect(pointsFor(1)).toBe(SIZE_POINTS * 2)
    expect(pointsFor(9)).toBe(50)
  })
  it('names the run', () => {
    expect(sizeVerdict(0, 0)).toBe('No cards sized')
    expect(sizeVerdict(6, 6)).toBe('Every card right')
    expect(sizeVerdict(6, 8)).toBe('Clean sizing')
    expect(sizeVerdict(4, 8)).toBe('Getting there')
    expect(sizeVerdict(1, 8)).toBe('Tough run')
  })
  it('finds the slip made most, and says it with the rule', () => {
    const log = [{ ok: true }, { ok: false, mistake: 'roundUp' }, { ok: false, mistake: 'price' }, { ok: false, mistake: 'roundUp' }]
    expect(topSlip(log)).toEqual({ key: 'roundUp', count: 2, misses: 3, title: 'Rounded up.', short: 'rounded up' })
    expect(topSlip([{ ok: true }])).toBe(null)
    expect(topSlip([{ ok: false, mistake: 'price' }, { ok: false, mistake: 'tenX' }]).key).toBe('price')   // a tie goes to the first
    expect(slipLine(log)).toBe('Your most common slip: rounded up, 2 of 3 misses. Stop first, distance second, size last.')
    expect(slipLine([{ ok: false, mistake: 'tenX' }])).toBe('Your most common slip: a 10x slip, 1 of 1 miss. Stop first, distance second, size last.')
    expect(slipLine([{ ok: true }])).toBe('No slips. Stop first, distance second, size last.')
    expect(slipLine([])).toBe('Every card is one rule: stop first, distance second, size last.')
  })
  it('gives each run an id the server accepts (1 to 64 characters)', () => {
    expect(runIdOf(1730000000000, 2)).toBe(`size-${(1730000000000).toString(36)}-2`)
    expect(runIdOf(1730000000000, 2).length).toBeLessThanOrEqual(64)
    expect(runIdOf(5)).toBe('size-5-0')
  })
})
