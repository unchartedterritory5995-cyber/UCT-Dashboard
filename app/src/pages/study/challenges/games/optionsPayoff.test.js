/**
 * Options Payoff, the numbers. Every expected value here was worked out by hand (one contract = 100 shares; at expiry an
 * option is worth its intrinsic value; P/L = intrinsic, minus the premium paid or plus the premium collected, times 100),
 * for every kind, including the at-the-strike and between-the-strikes cases.
 */
import { describe, it, expect } from 'vitest'
import {
  KINDS, KIND_INFO, freeSpot, lineSpan, MINUS, PAYOFF_HEARTS, PAYOFF_TOTAL, axisTicks, bare, breakevenOf, bsPrice, buildRun, dollars, extremesOf,
  fmtPL, headlineOf, heartsLeft, makePosition, mistakeLine, mistakeOf, niceStep, normCdf, payoffChart, perShare, plAt,
  position, price, priceAt, quote, rng, runIdOf, runOver, strikeStep, tileValues, zonesFor,
} from './optionsPayoff'

const M = MINUS
// the hand-built positions (all prices in cents)
const longCall = (expiry) => position('long_call', { stock: 4820, strike: 5000, premium: 210, expiry, dte: 30 })
const longPut = (expiry) => position('long_put', { stock: 4610, strike: 4500, premium: 185, expiry })
const shortPut = (expiry) => position('short_put', { stock: 4630, strike: 4500, premium: 135, expiry })
const covered = (expiry) => position('covered_call', { stock: 4820, basis: 4820, strike: 5000, premium: 140, expiry })
const bull = (expiry) => position('bull_call_debit', { stock: 5010, low: 5000, high: 5500, premium: 190, legPrices: [265, 75], expiry })
const bear = (expiry) => position('bear_call_credit', { stock: 4880, low: 5000, high: 5500, premium: 160, legPrices: [220, 60], expiry })

const tiles = (p) => tileValues(p)

describe('the words for numbers', () => {
  it('writes prices to the cent, strikes bare, P/L signed with whole dollars and no cents', () => {
    expect(price(5430)).toBe('$54.30')
    expect(price(450000)).toBe('$4,500.00')
    expect(price(5)).toBe('$0.05')
    expect(bare(5000)).toBe('50')
    expect(bare(5430)).toBe('54.30')
    expect(bare(4705)).toBe('47.05')
    expect(fmtPL(220)).toBe('+$220')
    expect(fmtPL(-85)).toBe(`${M}$85`)
    expect(fmtPL(2.2)).toBe('+$2.20')
    expect(fmtPL(-0.35)).toBe(`${M}$0.35`)
    expect(fmtPL(0)).toBe('$0')
    expect(fmtPL(-1240)).toBe(`${M}$1,240`)
    expect(perShare(-85)).toBe(`${M}$0.85`)
    expect(perShare(220)).toBe('+$2.20')
    expect(perShare(0)).toBe('$0.00')
    expect(dollars(4315)).toBe('$4,315')
    expect(dollars(15000)).toBe('$15,000')
  })
})

describe('the option math', () => {
  it('prices with Black-Scholes, no rates: the at-the-money textbook case and put-call parity', () => {
    // S = K = 100, one year, 20% vol, r = 0: C = P = 100 x (2N(0.1) − 1) = 7.9656
    expect(bsPrice('call', 100, 100, 1, 0.2)).toBeCloseTo(7.9656, 3)
    expect(bsPrice('put', 100, 100, 1, 0.2)).toBeCloseTo(7.9656, 3)
    // parity with no rates: C − P = S − K
    const c = bsPrice('call', 48.2, 50, 30 / 365, 0.35), p = bsPrice('put', 48.2, 50, 30 / 365, 0.35)
    expect(c - p).toBeCloseTo(48.2 - 50, 6)
    // at expiry, the intrinsic value
    expect(bsPrice('call', 54.3, 50, 0, 0.3)).toBeCloseTo(4.3, 9)
    expect(bsPrice('put', 54.3, 50, 0, 0.3)).toBe(0)
    expect(normCdf(0)).toBeCloseTo(0.5, 7)
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normCdf(-1)).toBeCloseTo(0.1587, 4)
  })

  it('quotes to the nickel, never under $0.05, and a further strike is cheaper', () => {
    const T = 30 / 365
    const q = quote('call', 4820, 5000, T, 0.35)
    expect(q % 5).toBe(0)
    expect(Math.abs(q - bsPrice('call', 48.2, 50, T, 0.35) * 100)).toBeLessThanOrEqual(2.5)
    expect(quote('call', 4820, 5500, T, 0.35)).toBeLessThan(q)
    expect(quote('call', 2000, 9000, 21 / 365, 0.28)).toBe(5)
  })

  it('a long call: 50 call for $2.10', () => {
    // above breakeven: worth 4.30, less 2.10 = +2.20 a share = +$220
    let p = longCall(5430)
    expect(p.breakeven).toBe(5210)
    expect(p.pl).toBe(220)
    expect(tiles(p)).toEqual({ right: 220, x100: 2.2, premium: 430, sign: -220 })
    // right on the strike: worth $0, the whole premium is lost
    p = longCall(5000)
    expect(p.pl).toBe(-210)
    expect(tiles(p)).toEqual({ right: -210, x100: -2.1, premium: 0, sign: 210 })
    // over the strike, short of breakeven: worth 1.40, still −0.70 a share
    p = longCall(5140)
    expect(p.pl).toBe(-70)
    expect(tiles(p)).toEqual({ right: -70, x100: -0.7, premium: 140, sign: 70 })
    // under the strike: expires worthless
    expect(longCall(4860).pl).toBe(-210)
    expect(extremesOf(longCall(5430))).toEqual({ maxGain: null, maxLoss: 210 })
  })

  it('a long put: 45 put for $1.85', () => {
    let p = longPut(4120)          // worth 3.80, less 1.85 = +1.95
    expect(p.breakeven).toBe(4315)
    expect(p.pl).toBe(195)
    expect(tiles(p)).toEqual({ right: 195, x100: 1.95, premium: 380, sign: -195 })
    expect(longPut(4500).pl).toBe(-185)   // at the strike
    p = longPut(4400)                // worth 1.00, short of breakeven: −0.85
    expect(p.pl).toBe(-85)
    expect(tiles(p).premium).toBe(100)
    expect(longPut(4700).pl).toBe(-185)   // over the strike: worthless
    expect(extremesOf(p)).toEqual({ maxGain: 4315, maxLoss: 185 })
  })

  it('a cash-secured put: 45 put sold for $1.35', () => {
    let p = shortPut(4280)        // owe 2.20, plus 1.35 collected = −0.85
    expect(p.breakeven).toBe(4365)
    expect(p.pl).toBe(-85)
    expect(tiles(p)).toEqual({ right: -85, x100: -0.85, premium: -220, sign: 85 })
    p = shortPut(4710)            // over the strike: keep it all
    expect(p.pl).toBe(135)
    expect(tiles(p)).toEqual({ right: 135, x100: 1.35, premium: 0, sign: -135 })
    expect(shortPut(4500).pl).toBe(135)   // at the strike: still keep it all
    expect(shortPut(4400).pl).toBe(35)    // under the strike, over breakeven: owe 1.00, +0.35
    expect(extremesOf(p)).toEqual({ maxGain: 135, maxLoss: 4365 })
  })

  it('a covered call: 100 shares at $48.20, the 50 call sold for $1.40', () => {
    let p = covered(5300)        // shares +4.80, owe 3.00, +1.40 = +3.20 (the cap)
    expect(p.breakeven).toBe(4680)
    expect(p.pl).toBe(320)
    expect(tiles(p)).toEqual({ right: 320, x100: 3.2, premium: 180, sign: -320 })
    p = covered(5000)            // at the strike: +1.80 + 1.40 = the same cap
    expect(p.pl).toBe(320)
    expect(tiles(p).premium).toBe(180)
    p = covered(4910)            // between the cost and the strike: +0.90 + 1.40
    expect(p.pl).toBe(230)
    expect(tiles(p).premium).toBe(90)
    p = covered(4720)            // a dollar under the cost, cushioned: −1.00 + 1.40 = +0.40
    expect(p.pl).toBe(40)
    expect(tiles(p)).toEqual({ right: 40, x100: 0.4, premium: -100, sign: -40 })
    expect(covered(4500).pl).toBe(-180)   // under breakeven: −3.20 + 1.40
    expect(extremesOf(p)).toEqual({ maxGain: 320, maxLoss: 4680 })
  })

  it('a bull call debit spread: 50/55 for $1.90 (2.65 − 0.75)', () => {
    let p = bull(5240)           // between the strikes: worth 2.40, less 1.90 = +0.50
    expect(p.breakeven).toBe(5190)
    expect(p.pl).toBe(50)
    expect(tiles(p)).toEqual({ right: 50, x100: 0.5, premium: 240, sign: -50 })
    expect(bull(5140).pl).toBe(-50)       // between the strikes, short of breakeven
    expect(bull(5000).pl).toBe(-190)      // at the lower strike
    expect(bull(4860).pl).toBe(-190)      // under both
    p = bull(5500)                // at the upper strike: the full width, 5.00 − 1.90
    expect(p.pl).toBe(310)
    expect(tiles(p).premium).toBe(500)
    expect(bull(5710).pl).toBe(310)       // over both: capped
    expect(extremesOf(p)).toEqual({ maxGain: 310, maxLoss: 190 })
  })

  it('a bear call credit spread: 50/55 sold for $1.60 (2.20 − 0.60)', () => {
    let p = bear(5310)           // between the strikes: owe 3.10, plus 1.60 = −1.50
    expect(p.breakeven).toBe(5160)
    expect(p.pl).toBe(-150)
    expect(tiles(p)).toEqual({ right: -150, x100: -1.5, premium: -310, sign: 150 })
    expect(bear(5100).pl).toBe(60)        // between the strikes, under breakeven: owe 1.00
    p = bear(4860)                // under both: keep it all
    expect(p.pl).toBe(160)
    expect(tiles(p).premium).toBe(0)
    expect(bear(5000).pl).toBe(160)       // at the lower strike
    expect(bear(5500).pl).toBe(-340)      // at the upper strike: owe the full width
    expect(bear(5710).pl).toBe(-340)      // over both: capped
    expect(extremesOf(p)).toEqual({ maxGain: 160, maxLoss: 340 })
  })

  it('breaks even at the breakeven, for every kind', () => {
    for (const p of [longCall(5430), longPut(4120), shortPut(4280), covered(5300), bull(5240), bear(5310)]) {
      expect(plAt(p, breakevenOf(p))).toBe(0)
      expect(plAt(p, breakevenOf(p) + 5)).not.toBe(0)
    }
  })
})

describe('the words of a position', () => {
  it('says the position plainly', () => {
    expect(longCall(5430).sentence).toBe('You bought 1 XYZ 50 call for $2.10.')
    expect(longPut(4120).sentence).toBe('You bought 1 XYZ 45 put for $1.85.')
    expect(shortPut(4280).sentence).toBe('You sold 1 XYZ 45 put for $1.35, cash-secured.')
    expect(shortPut(4280).note).toBe('You set aside $4,500 to buy 100 shares at $45.00 if you are assigned.')
    expect(covered(5300).sentence).toBe('You own 100 XYZ shares at $48.20 and sold 1 XYZ 50 call against them for $1.40.')
    expect(bull(5240).sentence).toBe('You bought the XYZ 50/55 call spread for $1.90.')
    expect(bear(5310).sentence).toBe('You sold the XYZ 50/55 call spread for $1.60.')
    expect(bull(5240).legs).toEqual([{ side: 'Buy', what: '1 XYZ 50 call', at: '$2.65' }, { side: 'Sell', what: '1 XYZ 55 call', at: '$0.75' }])
    expect(longCall(5430).question).toBe('XYZ closes at $54.30 on expiry day. What is your profit or loss?')
    expect(longCall(5430).context).toBe('Opened with 30 days to go, XYZ at $48.20. A made-up stock, real math.')
  })

  it('works a long call: intrinsic, less the premium, times 100', () => {
    expect(longCall(5430).working).toEqual([
      `At $54.30 the 50 call is worth $4.30 (54.30 ${M} 50).`,
      `Less the $2.10 you paid: $4.30 ${M} $2.10 = +$2.20 a share.`,
      'One contract is 100 shares: +$2.20 x 100 = +$220.',
    ])
    expect(longCall(5000).working).toEqual([
      'At $50.00, right on the strike, the 50 call is worth $0.00.',
      `Less the $2.10 you paid: ${M}$2.10 a share.`,
      `One contract is 100 shares: ${M}$2.10 x 100 = ${M}$210.`,
    ])
    expect(longCall(4860).working[0]).toBe('At $48.60 the 50 call expires worthless: $0.00.')
  })

  it('works a long put', () => {
    expect(longPut(4120).working).toEqual([
      `At $41.20 the 45 put is worth $3.80 (45 ${M} 41.20).`,
      `Less the $1.85 you paid: $3.80 ${M} $1.85 = +$1.95 a share.`,
      'One contract is 100 shares: +$1.95 x 100 = +$195.',
    ])
  })

  it('works a cash-secured put: what you owe, the assignment, plus the premium', () => {
    expect(shortPut(4280).working).toEqual([
      `At $42.80 the 45 put you sold is worth $2.20 (45 ${M} 42.80). You owe that.`,
      'Assigned, you pay $45.00 for shares worth $42.80: the same $2.20 a share.',
      `Add the $1.35 you collected: $1.35 ${M} $2.20 = ${M}$0.85 a share.`,
      `One contract is 100 shares: ${M}$0.85 x 100 = ${M}$85.`,
    ])
    expect(shortPut(4710).working).toEqual([
      'At $47.10 the 45 put you sold expires worthless. You owe nothing.',
      'You keep the $1.35 you collected: +$1.35 a share.',
      'One contract is 100 shares: +$1.35 x 100 = +$135.',
    ])
  })

  it('works a covered call: the shares, the call owed, plus the premium', () => {
    expect(covered(5300).working).toEqual([
      `The shares: $53.00 ${M} $48.20 = +$4.80 a share.`,
      `The 50 call you sold is worth $3.00 (53 ${M} 50). You owe that.`,
      `Add the $1.40 you collected: +$4.80 ${M} $3.00 + $1.40 = +$3.20 a share.`,
      'One contract is 100 shares: +$3.20 x 100 = +$320.',
    ])
    expect(covered(4720).working[2]).toBe(`Add the $1.40 you collected: ${M}$1.00 + $1.40 = +$0.40 a share.`)
    expect(covered(5000).working[1]).toBe('The 50 call you sold is worth $0.00, right on the strike.')
  })

  it('works the spreads: between the strikes, at a strike, past both', () => {
    expect(bull(5240).working).toEqual([
      `At $52.40 the 50 call is worth $2.40 (52.40 ${M} 50) and the 55 call nothing. The spread is worth $2.40.`,
      `Less the $1.90 you paid: $2.40 ${M} $1.90 = +$0.50 a share.`,
      'One contract is 100 shares: +$0.50 x 100 = +$50.',
    ])
    expect(bull(5710).working[0]).toBe(`At $57.10 the spread is worth its full width, $5.00 (55 ${M} 50).`)
    expect(bull(5000).working[0]).toBe('At $50.00, right on the lower strike, both calls expire worthless. The spread is worth $0.00.')
    expect(bear(5310).working).toEqual([
      `At $53.10 the 50 call you sold is worth $3.10 (53.10 ${M} 50) and the 55 call nothing. You owe $3.10.`,
      `Add the $1.60 you collected: $1.60 ${M} $3.10 = ${M}$1.50 a share.`,
      `One contract is 100 shares: ${M}$1.50 x 100 = ${M}$150.`,
    ])
    expect(bear(4860).working[0]).toBe('At $48.60 both calls expire worthless. You owe nothing.')
    expect(bear(5710).working[0]).toBe(`At $57.10 the spread is worth its full width, $5.00 (55 ${M} 50). You owe $5.00.`)
  })

  it('states each rule with its own numbers and its course unit', () => {
    expect(longCall(5430).rule).toBe('A long call can lose only what you paid, $210. It makes money above the strike plus the premium: $52.10.')
    expect(longPut(4120).rule).toBe('A long put can lose only what you paid, $185. It makes money below the strike minus the premium: $43.15.')
    expect(shortPut(4280).rule).toBe('A cash-secured put pays you $135 up front. Under $43.65, the strike minus the premium, it loses a dollar for every dollar XYZ falls.')
    expect(covered(5300).rule).toBe('The call caps the trade at the strike: the most it can make is $320. The premium lowers your breakeven to $46.80.')
    expect(bull(5240).rule).toBe(`A debit spread risks what you paid, $190. The most it makes is the width less that: $500 ${M} $190 = $310.`)
    expect(bear(5310).rule).toBe(`A credit spread keeps what you collected, $160, if XYZ ends at or under $50.00. The most it loses is the width less that: $500 ${M} $160 = $340.`)
    expect(KINDS.map((k) => KIND_INFO[k].unit)).toEqual(['F6.11', 'F6.11', 'F6.13', 'F6.13', 'F6.12', 'F6.12'])
  })

  it('names the mistake each wrong tile makes', () => {
    const p = longCall(5430)
    expect(mistakeOf(p, '+$2.20')).toBe('x100')
    expect(mistakeOf(p, '+$430')).toBe('premium')
    expect(mistakeOf(p, `${M}$220`)).toBe('sign')
    expect(mistakeOf(p, '+$220')).toBe('right')
    expect(mistakeLine(p, 'x100')).toBe('That is the answer for one share. One contract is 100 shares: +$2.20 x 100 = +$220.')
    expect(mistakeLine(p, 'premium')).toBe('That leaves out the $2.10 you paid. A buyer starts $2.10 a share down.')
    expect(mistakeLine(shortPut(4280), 'premium')).toBe('That leaves out the $1.35 you collected. The premium is yours whatever XYZ does.')
    expect(mistakeLine(p, 'sign')).toBe('Right size, wrong sign. This one made money.')
    expect(mistakeLine(shortPut(4280), 'sign')).toBe('Right size, wrong sign. This one lost money.')
    expect(headlineOf(p, 'right')).toBe('Priced it.')
    expect(headlineOf(p, 'x100')).toBe('Forgot the x100.')
    expect(headlineOf(p, 'premium')).toBe('Left out what you paid.')
    expect(headlineOf(bear(5310), 'premium')).toBe('Left out what you collected.')
    expect(headlineOf(p, 'sign')).toBe('Wrong sign.')
  })

  it('deals the four tiles in a seeded order, the same for the same seed', () => {
    const a = position('long_call', { stock: 4820, strike: 5000, premium: 210, expiry: 5430, order: 7 })
    const b = position('long_call', { stock: 4820, strike: 5000, premium: 210, expiry: 5430, order: 7 })
    expect(a.labels).toEqual(b.labels)
    expect([...a.labels].sort()).toEqual(['+$2.20', '+$220', '+$430', `${M}$220`].sort())
    expect(a.answer).toBe('+$220')
  })

  it('refuses a price whose tiles would collide or that sits on breakeven', () => {
    // shares −0.70 + 1.40 = +0.70: forgetting the premium gives −$70, the same as the sign flipped
    expect(covered(4750).ok).toBe(false)
    expect(longCall(5210).ok).toBe(false)     // breakeven: $0 both ways
    expect(longCall(5430).ok).toBe(true)
  })
})

describe('the generator', () => {
  it('a run is six positions, one of each kind, the same for the same seed', () => {
    const a = buildRun(42), b = buildRun(42)
    expect(a).toHaveLength(PAYOFF_TOTAL)
    expect(new Set(a.map((p) => p.kind))).toEqual(new Set(KINDS))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(buildRun(43))).not.toBe(JSON.stringify(a))
    expect(PAYOFF_HEARTS).toBe(3)
  })

  it('every generated position is a sensible trade with four different tiles that model the named mistakes', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const p of buildRun(seed)) {
        const v = p.values
        expect(p.ok).toBe(true)
        expect(new Set(p.labels).size).toBe(4)
        expect(p.labels).toContain(p.answer)
        expect(v.right).toBe(p.pl)
        expect(v.x100).toBeCloseTo(p.pl / 100, 9)
        expect(v.sign).toBe(-p.pl)
        expect(v.premium).toBe(p.pl + (p.buyer ? p.premium : -p.premium))
        // strikes on the listed grid, premiums on the nickel and at least a dime
        const step = strikeStep(p.stock)
        for (const k of p.strikes) expect(k % step).toBe(0)
        expect(p.premium % 5).toBe(0)
        expect(p.premium).toBeGreaterThanOrEqual(10)
        if (p.spread) {
          expect(p.premium).toBeLessThanOrEqual(p.width - 10)      // a spread costs less than its width
          expect(p.legPrices[0] - p.legPrices[1]).toBe(p.premium)
          expect(p.legPrices[0]).toBeGreaterThan(p.legPrices[1])
        }
        if (p.kind === 'long_call') expect(p.strike).toBeGreaterThanOrEqual(p.stock)
        if (p.kind === 'covered_call') expect(p.strike).toBeGreaterThan(p.basis)
        if (p.kind === 'long_put' || p.kind === 'short_put') expect(p.strike).toBeLessThanOrEqual(p.stock)
        // a realistic month: the expiry price inside a third of where XYZ opened, on the nickel
        expect(p.expiry % 5).toBe(0)
        expect(Math.abs(p.expiry - p.stock) / p.stock).toBeLessThan(0.35)
        expect(plAt(p, p.breakeven)).toBe(0)
        // the working ends on the answer; the copy keeps the voice rules
        expect(p.working[p.working.length - 1].endsWith(`= ${p.answer}.`)).toBe(true)
        const text = [p.sentence, p.question, p.detail, p.note || '', p.rule, ...p.working].join(' ')
        expect(text).not.toMatch(/—|firm/i)
      }
    }
  })

  it('reaches every zone of every kind: at the strike, between the strikes, past both', () => {
    const seen = new Set()
    for (let seed = 1; seed <= 600; seed++) buildRun(seed).forEach((p) => seen.add(`${p.kind}:${p.scenario}`))
    const want = {
      long_call: ['win', 'short_of_breakeven', 'at_strike', 'worthless'],
      long_put: ['win', 'short_of_breakeven', 'at_strike', 'worthless'],
      short_put: ['keep', 'at_strike', 'partial', 'loss'],
      covered_call: ['called_away', 'at_strike', 'between', 'cushion', 'loss'],
      bull_call_debit: ['below', 'at_lower', 'between_loss', 'between_win', 'at_upper', 'above'],
      bear_call_credit: ['below', 'at_lower', 'between_win', 'between_loss', 'at_upper', 'above'],
    }
    for (const [k, zones] of Object.entries(want)) for (const z of zones) expect(seen.has(`${k}:${z}`)).toBe(true)
  })

  it('draws a zone inside its bounds', () => {
    const z = zonesFor('long_call', { stock: 4820, strike: 5000, premium: 210 })
    expect(z).toEqual([
      { key: 'win', lo: 5215, hi: 5630 },
      { key: 'short_of_breakeven', lo: 5005, hi: 5205 },
      { key: 'at_strike', lo: 5000, hi: 5000 },
      { key: 'worthless', lo: 4580, hi: 4995 },
    ])
    const spread = zonesFor('bull_call_debit', { stock: 5010, low: 5000, high: 5500, premium: 190 })
    expect(spread.map((x) => x.key)).toEqual(['below', 'at_lower', 'between_loss', 'between_win', 'at_upper', 'above'])
    expect(spread.find((x) => x.key === 'between_loss')).toEqual({ key: 'between_loss', lo: 5005, hi: 5185 })
    expect(spread.find((x) => x.key === 'between_win')).toEqual({ key: 'between_win', lo: 5195, hi: 5495 })
  })

  it('makes one position of a kind from a generator', () => {
    const p = makePosition('bear_call_credit', rng(9), 'x')
    expect(p.kind).toBe('bear_call_credit')
    expect(p.id).toBe('x')
    expect(p.ok).toBe(true)
  })

  it('lays the strikes on the listed grid', () => {
    expect(strikeStep(4820)).toBe(100)
    expect(strikeStep(8100)).toBe(500)
    expect(strikeStep(23600)).toBe(1000)
  })
})

describe('the payoff drawing', () => {
  it('a long call: flat at the premium under the strike, rising past it, with every mark in range', () => {
    const c = payoffChart(longCall(5430))
    // range: strike 50, breakeven 52.10, expiry 54.30; span 4.30, padded 1.70 a side
    expect(c.x0).toBe(4830)
    expect(c.x1).toBe(5600)
    expect(c.points).toEqual([{ x: 4830, y: -210 }, { x: 5000, y: -210 }, { x: 5600, y: 390 }])
    expect(c.y0).toBeCloseTo(-306, 9)
    expect(c.y1).toBeCloseTo(486, 9)
    expect(c.ticks).toEqual([-200, 0, 200, 400])
    expect(c.expiry).toEqual({ x: 5430, y: 220 })
    expect(c.breakeven).toBe(5210)
  })

  it('a spread bends at both strikes and is flat past them', () => {
    const c = payoffChart(bull(5240))
    expect(c.points.map((q) => q.x)).toEqual([c.x0, 5000, 5500, c.x1])
    expect(c.points.map((q) => q.y)).toEqual([-190, -190, 310, 310])
    expect(c.y0).toBeLessThan(-190)
    expect(c.y1).toBeGreaterThan(310)
  })

  it('a covered call holds its cost in range and bends at the strike', () => {
    const c = payoffChart(covered(4720))
    expect(c.x0).toBeLessThan(4680)
    expect(c.x1).toBeGreaterThan(5000)
    expect(c.points.map((q) => q.x)).toContain(5000)
    expect(c.points[c.points.length - 1].y).toBe(320)
  })

  it('reads a price off the drawing to the nickel, inside its range', () => {
    const c = payoffChart(longCall(5430))
    expect(priceAt(c, 0)).toBe(4830)
    expect(priceAt(c, 1)).toBe(5600)
    expect(priceAt(c, 0.5)).toBe(5215)
    expect(priceAt(c, 2)).toBe(5600)
    expect(priceAt(c, -1)).toBe(4830)
  })

  it('labels the axis on tidy steps', () => {
    expect(niceStep(792, 4)).toBe(200)
    expect(niceStep(10, 4)).toBe(2.5)
    expect(niceStep(0)).toBe(1)
    expect(axisTicks(-306, 486)).toEqual([-200, 0, 200, 400])
    expect(axisTicks(-12, 12)).toEqual([-10, 0, 10])          // 24 / 4 = 6, so a step of 10
    expect(axisTicks(-10, 10)).toEqual([-10, -5, 0, 5, 10])   // 20 / 4 = 5
    expect(Object.is(axisTicks(-30, 300)[0], -0)).toBe(false)  // never a negative zero
  })
})

describe('placing the labels in open space', () => {
  // a rising line in screen units (y grows downward): flat at y 100 to x 50, then up to y 0 at x 150
  const line = [{ x: 0, y: 100 }, { x: 50, y: 100 }, { x: 150, y: 0 }]
  const bounds = { x0: 0, y0: 0, x1: 200, y1: 120 }

  it("reads the line's highest and lowest point between two x positions", () => {
    expect(lineSpan(line, 0, 40)).toEqual([100, 100])
    expect(lineSpan(line, 40, 100)).toEqual([50, 100])
    expect(lineSpan(line, 100, 60)).toEqual([50, 90])
    expect(lineSpan(line, 160, 190)).toEqual([0, 0])
  })

  it('takes the first box clear of the line, the marks and the edges', () => {
    const onTheLine = { x: 90, y: 50, w: 30, h: 14 }        // the line passes through it
    const offEdge = { x: 190, y: 10, w: 30, h: 14 }         // past the right edge
    const onMark = { x: 10, y: 10, w: 30, h: 14 }
    const clear = { x: 10, y: 40, w: 30, h: 14 }
    const mark = { x: 0, y: 0, w: 45, h: 30 }
    expect(freeSpot([onTheLine, offEdge, onMark, clear], { boxes: [mark], bounds, points: line })).toBe(clear)
    // nothing clear: the first inside the bounds, or nothing when strict
    expect(freeSpot([onTheLine, offEdge], { bounds, points: line })).toBe(onTheLine)
    expect(freeSpot([onTheLine, offEdge], { bounds, points: line, strict: true })).toBe(null)
  })

  it('keeps a margin from the line, and with nowhere clear takes the spot that overlaps the least', () => {
    const near = { x: 10, y: 84, w: 30, h: 14 }             // 2px above the flat part of the line
    const clear = { x: 10, y: 40, w: 30, h: 14 }
    expect(freeSpot([near, clear], { bounds, points: line })).toBe(near)
    expect(freeSpot([near, clear], { bounds, points: line, pad: 4 })).toBe(clear)
    const grazes = { x: 0, y: 90, w: 40, h: 20 }            // the flat line runs along it: a sliver
    const crosses = { x: 60, y: 55, w: 30, h: 30 }          // the rising line cuts through it
    expect(freeSpot([crosses, grazes], { bounds, points: line })).toBe(grazes)
  })
})

describe('the run', () => {
  it('three hearts; the run ends at six positions or when they run out', () => {
    expect(heartsLeft([])).toBe(3)
    expect(heartsLeft([true, false, true, false])).toBe(1)
    expect(heartsLeft([false, false, false, false])).toBe(0)
    expect(runOver([true, false, false])).toBe(false)
    expect(runOver([false, true, false, false])).toBe(true)
    expect(runOver([true, true, true, true, true])).toBe(false)
    expect(runOver([true, true, true, true, true, false])).toBe(true)
  })

  it('names the run for the XP post, inside the server limit', () => {
    expect(runIdOf(1731100000000)).toBe('payoff-1731100000000')
    expect(runIdOf(1731100000000).length).toBeLessThanOrEqual(64)
  })
})
