/**
 * Greeks Lab, the pure module: the cumulative normal to double precision, Black-Scholes against textbook values
 * (S=100, K=100, T=1, r=5%, sigma=20%: call 10.4506, put 5.5735, delta 0.6368; Hull's S=42, K=40: 4.76 and 0.81), put-
 * call parity, every Greek against a finite difference of the price, the lab's per-day and per-point units, the slider
 * grids, the display rounding the scoring shares, the last-move readout, the drawing, and every challenge kind over a
 * sweep of seeds: a fair zone, a right answer clear of the rest, words that hold for the numbers, and the house voice.
 * A set challenge is also fair to its hint: a member who reads the covered Greek off the last move, a notch at a time, as
 * the challenge says, is never scored wrong for it (two deals the first generator let through are pinned as unfair).
 */
import { describe, it, expect } from 'vitest'
import {
  BAND, DAYS, GREEKS_KIND, GREEKS_TOTAL, IVS, KINDS, MINUS, MODEL_LINE, RATE, SET_KINDS, STATIONS, STRIKES, YEAR,
  blackScholes, buildRun, curveOf, deal, dollars, fairToHint, fmtDelta, fmtGamma, fmtStock, greeksOf, gridOf, intrinsic, measureOf,
  priceParts, money, moveLabel, niceStep, normCdf, normPdf, num, passes, rangeText, readOf, rng, rnd, rowsOf, runIdOf, scoreSet,
  scramble, setLine, shown, signed, sliderOf, snapState, snapTo, stepOf, stepText, stockStep, verdictOf, zoneOf, zoneText,
} from './greeksLab'

/** States across the lab's whole range, from a seed. */
function states(n, seed = 11) {
  const r = rng(seed)
  return Array.from({ length: n }, () => {
    const K = STRIKES[Math.floor(r() * STRIKES.length)]
    return { type: r() < 0.5 ? 'call' : 'put', K, S: snapTo('S', K, K * (0.7 + r() * 0.6)), days: 1 + Math.floor(r() * 120), iv: 10 + Math.floor(r() * 111) }
  })
}

const SEEDS = Array.from({ length: 300 }, (_, i) => 1731100000000 + i * 104729)

describe('the cumulative normal', () => {
  it('matches the series to double precision', () => {
    // N(x) by the Taylor series of erf, computed to 1e-20 (the reference values)
    const ref = [[0, 0.5], [0.15, 0.5596176923702425], [0.35, 0.6368306511756191], [0.5, 0.6914624612740131], [-0.5, 0.3085375387259869],
      [1, 0.8413447460685428], [1.5, 0.9331927987311419], [-1.96, 0.02499789514822065], [2, 0.9772498680518207], [2.5, 0.9937903346742238]]
    for (const [x, v] of ref) expect(Math.abs(normCdf(x) - v)).toBeLessThan(1e-14)
  })
  it('is symmetric and bounded in the tails', () => {
    for (const x of [0.01, 0.7, 1.3, 3.2, 6.9, 7.2, 12]) expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 14)
    expect(normCdf(-40)).toBe(0)
    expect(normCdf(40)).toBe(1)
    expect(Math.abs(normCdf(-8) / 6.22096057427178e-16 - 1)).toBeLessThan(1e-8)
  })
  it('the density at 0 is 1 over root two pi', () => {
    expect(normPdf(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 15)
    expect(normPdf(1.2)).toBeCloseTo(normPdf(-1.2), 15)
  })
})

describe('Black-Scholes', () => {
  it('the reference case: S=100, K=100, T=1, r=5%, sigma=20%', () => {
    const c = blackScholes('call', 100, 100, 1, 0.05, 0.2)
    const p = blackScholes('put', 100, 100, 1, 0.05, 0.2)
    expect(c.price).toBeCloseTo(10.4506, 4)
    expect(p.price).toBeCloseTo(5.5735, 4)
    expect(c.delta).toBeCloseTo(0.6368, 4)
    expect(p.delta).toBeCloseTo(-0.3632, 4)
    expect(c.d1).toBeCloseTo(0.35, 12)
    expect(c.d2).toBeCloseTo(0.15, 12)
    expect(c.gamma).toBeCloseTo(0.018762, 6)
    expect(c.vega).toBeCloseTo(37.524, 3)
    expect(c.theta).toBeCloseTo(-6.414, 3)
    expect(p.theta).toBeCloseTo(-1.6579, 4)
  })
  it("Hull's worked example: S=42, K=40, r=10%, sigma=20%, six months", () => {
    expect(blackScholes('call', 42, 40, 0.5, 0.1, 0.2).price).toBeCloseTo(4.76, 2)
    expect(blackScholes('put', 42, 40, 0.5, 0.1, 0.2).price).toBeCloseTo(0.81, 2)
  })
  it('put-call parity holds across the lab: C − P = S − K·e^(−rT)', () => {
    for (const st of states(400)) {
      const T = st.days / YEAR, sig = st.iv / 100
      const c = blackScholes('call', st.S, st.K, T, RATE, sig).price
      const p = blackScholes('put', st.S, st.K, T, RATE, sig).price
      expect(Math.abs((c - p) - (st.S - st.K * Math.exp(-RATE * T)))).toBeLessThan(1e-9)
    }
  })
  it('a call and a put share gamma and vega; their deltas are one apart; their thetas differ by rK·e^(−rT)', () => {
    for (const st of states(200, 23)) {
      const T = st.days / YEAR, sig = st.iv / 100
      const c = blackScholes('call', st.S, st.K, T, RATE, sig)
      const p = blackScholes('put', st.S, st.K, T, RATE, sig)
      expect(c.gamma).toBeCloseTo(p.gamma, 14)
      expect(c.vega).toBeCloseTo(p.vega, 12)
      expect(c.delta - p.delta).toBeCloseTo(1, 14)
      expect(c.theta - p.theta).toBeCloseTo(-RATE * st.K * Math.exp(-RATE * T), 10)
    }
  })
  it('every Greek is the slope of the price (a central finite difference)', () => {
    const price = (type, S, K, T, sig) => blackScholes(type, S, K, T, RATE, sig).price
    for (const st of states(250, 37)) {
      const T = st.days / YEAR, sig = st.iv / 100
      const g = blackScholes(st.type, st.S, st.K, T, RATE, sig)
      const h = st.S * 1e-4
      const dS = (price(st.type, st.S + h, st.K, T, sig) - price(st.type, st.S - h, st.K, T, sig)) / (2 * h)
      expect(Math.abs(dS - g.delta)).toBeLessThan(1e-6)
      const hg = st.S * 2e-3
      const d2S = (price(st.type, st.S + hg, st.K, T, sig) - 2 * g.price + price(st.type, st.S - hg, st.K, T, sig)) / (hg * hg)
      expect(Math.abs(d2S - g.gamma)).toBeLessThan(1e-4 + g.gamma * 2e-3)
      const e = 1e-5
      const dV = (price(st.type, st.S, st.K, T, sig + e) - price(st.type, st.S, st.K, T, sig - e)) / (2 * e)
      expect(Math.abs(dV - g.vega)).toBeLessThan(1e-4 + g.vega * 1e-6)
      const tau = Math.min(T / 4, 1e-5)
      const dT = -(price(st.type, st.S, st.K, T + tau, sig) - price(st.type, st.S, st.K, T - tau, sig)) / (2 * tau)
      expect(Math.abs(dT - g.theta)).toBeLessThan(1e-3 + Math.abs(g.theta) * 1e-4)
    }
  })
  it('at expiry, or with no volatility, the option is its intrinsic value', () => {
    expect(blackScholes('call', 110, 100, 0, RATE, 0.3)).toMatchObject({ price: 10, delta: 1, gamma: 0, vega: 0, theta: 0 })
    expect(blackScholes('put', 110, 100, 0, RATE, 0.3)).toMatchObject({ price: 0, delta: 0 })
    expect(blackScholes('put', 90, 100, 0.5, RATE, 0)).toMatchObject({ price: 10, delta: -1 })
    expect(intrinsic('call', 95, 100)).toBe(0)
    expect(intrinsic('put', 95, 100)).toBe(5)
  })
  it('refuses what is not an option', () => {
    expect(() => blackScholes('straddle', 100, 100, 1, RATE, 0.2)).toThrow(/unknown type/)
    expect(() => blackScholes('call', 0, 100, 1, RATE, 0.2)).toThrow()
    expect(() => blackScholes('call', 100, -5, 1, RATE, 0.2)).toThrow()
  })
})

describe("the lab's numbers", () => {
  it('a 4% rate, days over 365, theta for one calendar day and vega for one point of IV', () => {
    expect(RATE).toBe(0.04)
    expect(MODEL_LINE).toBe('Black-Scholes · no dividends · 4% rate')
    const st = { type: 'call', K: 100, S: 100, days: 30, iv: 30 }
    const bs = blackScholes('call', 100, 100, 30 / 365, 0.04, 0.3)
    const g = greeksOf(st)
    expect(g.price).toBe(bs.price)
    expect(g.delta).toBe(bs.delta)
    expect(g.gamma).toBe(bs.gamma)
    expect(g.theta).toBeCloseTo(bs.theta / 365, 15)
    expect(g.vega).toBeCloseTo(bs.vega / 100, 15)
    // the 100 call at the money, 30 days, 30% IV (hand-checked): $3.59 a share, delta 0.53, theta −$0.06, vega $0.11
    expect(shown(st)).toEqual({ price: 3.59, delta: 0.53, gamma: 0.046, theta: -0.06, vega: 0.11 })
  })
  it('the readouts round once, and the scoring reads the same rounding', () => {
    for (const st of states(100, 51)) {
      const g = greeksOf(st), sh = shown(st)
      expect(sh.price).toBe(rnd(g.price, 2))
      expect(sh.delta).toBe(rnd(g.delta, 2))
      expect(sh.gamma).toBe(rnd(g.gamma, 3))
      expect(measureOf('delta', st)).toBe(sh.delta)
      expect(measureOf('gamma', st)).toBe(sh.gamma)
      expect(measureOf('vega', st)).toBe(sh.vega)
      expect(measureOf('price', st)).toBe(sh.price)
      expect(measureOf('decay', st)).toBe(rnd(-sh.theta, 2))
    }
    expect(() => measureOf('rho', states(1)[0])).toThrow()
  })
  it('the price card: a share, a contract, intrinsic and time value', () => {
    expect(priceParts({ type: 'call', K: 100, S: 100, days: 30, iv: 30 })).toEqual({ price: 3.59, contract: 359, intrinsic: 0, timeValue: 3.59 })
    const itm = { type: 'call', K: 100, S: 110, days: 30, iv: 30 }
    expect(priceParts(itm)).toEqual({ price: shown(itm).price, contract: rnd(shown(itm).price * 100, 2), intrinsic: 10, timeValue: rnd(shown(itm).price - 10, 2) })
    // a deep in-the-money put with time left and little IV sits under intrinsic: its strike is paid at expiry, discounted
    const deep = { type: 'put', K: 100, S: 70, days: 120, iv: 10 }
    expect(priceParts(deep).intrinsic).toBe(30)
    expect(priceParts(deep).timeValue).toBeLessThan(0)
    expect(priceParts(deep).price).toBeCloseTo(100 * Math.exp(-RATE * 120 / 365) - 70, 2)
    // a call with no dividends never does, anywhere in the lab (so the screen's note names only a put)
    for (const st of states(800, 91)) if (st.type === 'call') expect(priceParts({ ...st }).timeValue).toBeGreaterThanOrEqual(0)
    for (const K of [50, 100, 250]) for (const S of gridOf('S', K)) for (const days of [1, 30, 120]) for (const iv of [10, 60, 120]) {
      expect(priceParts({ type: 'call', K, S, days, iv }).timeValue).toBeGreaterThanOrEqual(0)
    }
  })
  it('a delta the screen shows as 0.45 counts toward 0.50, one it shows as 0.44 does not', () => {
    // walk XYZ (off the grid) to the two raw deltas either side of the rounding line
    const base = { type: 'call', K: 100, days: 30, iv: 30 }
    const at = (want) => {
      let lo = 70, hi = 130
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (greeksOf({ ...base, S: mid }).delta < want) lo = mid; else hi = mid }
      return { ...base, S: (lo + hi) / 2 }
    }
    const check = { measure: 'delta', target: 0.5, tol: 0.05 }
    const justIn = at(0.4496), justOut = at(0.4449)
    expect(greeksOf(justIn).delta).toBeLessThan(0.45)
    expect(fmtDelta(measureOf('delta', justIn))).toBe('0.45')
    expect(passes(check, justIn)).toBe(true)
    expect(fmtDelta(measureOf('delta', justOut))).toBe('0.44')
    expect(passes(check, justOut)).toBe(false)
    // and the top edge: 0.55 counts, 0.56 does not
    expect(passes(check, at(0.5549))).toBe(true)
    expect(passes(check, at(0.5551))).toBe(false)
  })
})

describe('the words for numbers', () => {
  it('money to the cent with a true minus sign, never a negative zero', () => {
    expect(money(4.123)).toBe('$4.12')
    expect(money(-0.07)).toBe(`${MINUS}$0.07`)
    expect(money(-0.001)).toBe('$0.00')
    expect(money(1234.5)).toBe('$1,234.50')
    expect(rnd(-0.004, 2)).toBe(0)
    expect(Object.is(rnd(-0.004, 2), -0)).toBe(false)
  })
  it('dollars are whole when whole; a signed amount carries its sign', () => {
    expect(dollars(124)).toBe('$124')
    expect(dollars(128.4)).toBe('$128.40')
    expect(dollars(0.62 * 2 * 100)).toBe('$124')
    expect(signed(124)).toBe('+$124')
    expect(signed(-1.24)).toBe(`${MINUS}$1.24`)
    expect(signed(0)).toBe('$0')
    expect(signed(-0.001)).toBe('$0')
  })
  it('the Greeks to their places', () => {
    expect(fmtDelta(0.5349)).toBe('0.53')
    expect(fmtDelta(-0.4699)).toBe(`${MINUS}0.47`)
    expect(fmtDelta(-0.001)).toBe('0.00')
    expect(fmtGamma(0.04649)).toBe('0.046')
    expect(num(2.5, 1)).toBe('2.5')
    expect(fmtStock(100)).toBe('$100')
    expect(fmtStock(99.5)).toBe('$99.50')
  })
})

describe('the sliders', () => {
  it('XYZ moves within 30% of the strike on a step that fits the band exactly', () => {
    expect(BAND).toBe(0.3)
    expect(stockStep(50)).toBe(0.5)
    expect(stockStep(100)).toBe(1)
    expect(stockStep(200)).toBe(2)
    expect(stockStep(250)).toBe(2.5)
    for (const K of STRIKES) {
      const { min, max, step } = sliderOf('S', K)
      expect(min).toBe(rnd(K * 0.7, 2))
      expect(max).toBe(rnd(K * 1.3, 2))
      const grid = gridOf('S', K)
      expect(grid[0]).toBe(min)
      expect(grid[grid.length - 1]).toBe(max)
      expect(grid).toContain(K)
      expect(Number.isInteger(rnd((max - min) / step, 6))).toBe(true)
      for (let i = 1; i < grid.length; i++) expect(rnd(grid[i] - grid[i - 1], 6)).toBe(step)
    }
  })
  it('days run 1 to 120 and IV 10% to 120%, one at a time', () => {
    expect(DAYS).toEqual({ min: 1, max: 120, step: 1 })
    expect(IVS).toEqual({ min: 10, max: 120, step: 1 })
    expect(gridOf('days', 100)).toHaveLength(120)
    expect(gridOf('iv', 100)).toHaveLength(111)
    expect(() => sliderOf('rate', 100)).toThrow()
  })
  it('snaps to the grid and inside the range', () => {
    expect(snapTo('S', 100, 99.6)).toBe(100)
    expect(snapTo('S', 50, 50.3)).toBe(50.5)
    expect(snapTo('S', 100, 500)).toBe(130)
    expect(snapTo('S', 100, 1)).toBe(70)
    expect(snapTo('days', 100, 0)).toBe(1)
    expect(snapTo('days', 100, 400)).toBe(120)
    expect(snapTo('iv', 100, 9)).toBe(10)
    expect(snapTo('iv', 100, 'x')).toBe(10)
    expect(snapState({ type: 'put', K: 250, S: 251, days: 7.6, iv: 55.4 })).toEqual({ type: 'put', K: 250, S: 250, days: 8, iv: 55 })
    expect(snapState({ type: 'oops', K: 100, S: 100, days: 5, iv: 20 }).type).toBe('call')
  })
  it('says a value and a run of values plainly', () => {
    expect(rangeText('S', 98, 100)).toBe('$98 to $100')
    expect(rangeText('days', 7, 12)).toBe('7 to 12 days')
    expect(rangeText('iv', 30, 30)).toBe('30%')
    expect(rangeText('days', 1, 1)).toBe('1 day')
    expect(moveLabel('days', 45, 5)).toBe('Days 45 → 5')
    expect(moveLabel('iv', 40, 28)).toBe('IV 40% → 28%')
    expect(moveLabel('S', 100, 120)).toBe('XYZ $100 → $120')
  })
})

describe('the last move', () => {
  const a = { type: 'call', K: 100, S: 99, days: 30, iv: 30 }
  it("one $1 step of XYZ moves the price by about the delta (here 0.51, between 0.49 and 0.53)", () => {
    const st = stepOf(a, { ...a, S: 100 })
    expect(st).toEqual({ key: 'S', from: 99, to: 100, units: 1, change: 0.51, per: 0.51 })
    expect(stepText(st)).toEqual({ move: 'XYZ $99 → $100', change: '+$0.51', per: null })
  })
  it('a longer move reads per $1, per day and per point', () => {
    expect(stepText(stepOf(a, { ...a, S: 103 }))).toEqual({ move: 'XYZ $99 → $103', change: '+$2.31', per: 'about +$0.58 per $1' })
    expect(stepText(stepOf(a, { ...a, iv: 36 }))).toEqual({ move: 'IV 30% → 36%', change: '+$0.68', per: 'about +$0.11 a point' })
    expect(stepText(stepOf(a, { ...a, days: 25 })).per).toBe(`about ${MINUS}$0.06 a day off the clock`)
  })
  it('one day off the clock says what that day cost', () => {
    const st = stepOf(a, { ...a, days: 29 })
    expect(st.change).toBe(rnd(shown({ ...a, days: 29 }).price - shown(a).price, 2))
    expect(stepText(st)).toEqual({ move: 'Days 30 → 29', change: `${MINUS}$0.06`, per: 'one day cost $0.06' })
  })
  it("a step DOWN still reads per unit up, so a covered Greek never picks up the step's own minus sign", () => {
    // (every price here recomputed by an independent Black-Scholes, math.erfc in Python, rounded to the cent)
    expect(stepText(stepOf(a, { ...a, S: 98 }))).toEqual({ move: 'XYZ $99 → $98', change: `${MINUS}$0.46`, per: 'about +$0.46 per $1' })
    const b = { type: 'call', K: 100, S: 100, days: 30, iv: 30 }
    expect(stepText(stepOf(b, { ...b, S: 99 }))).toEqual({ move: 'XYZ $100 → $99', change: `${MINUS}$0.51`, per: 'about +$0.51 per $1' })
    expect(stepText(stepOf(b, { ...b, iv: 29 }))).toEqual({ move: 'IV 30% → 29%', change: `${MINUS}$0.11`, per: 'about +$0.11 a point' })
    // a put's delta reads negative either way: a step down gains it $0.49, which is −$0.49 per $1 up; a step up IS a
    // dollar up, so its change already reads per $1 and needs no second line
    const p = { ...b, type: 'put' }
    expect(stepText(stepOf(p, { ...p, S: 99 }))).toEqual({ move: 'XYZ $100 → $99', change: '+$0.49', per: `about ${MINUS}$0.49 per $1` })
    expect(stepText(stepOf(p, { ...p, S: 101 }))).toEqual({ move: 'XYZ $100 → $101', change: `${MINUS}$0.44`, per: null })
    // what the member reads is the per-unit number the scoring compares
    expect(readOf(b, { ...b, S: 99 })).toBe(0.51)
    expect(readOf(b, { ...b, days: 29 })).toBe(0.06)
    expect(readOf(b, { ...b, days: 29, iv: 31 })).toBeNull()
  })
  it('a day off a deep in-the-money put can ADD value (the rate discounts its strike less): the readout says so', () => {
    const deep = { type: 'put', K: 100, S: 70, days: 120, iv: 10 }
    const st = stepOf(deep, { ...deep, days: 119 })
    expect(st.change).toBe(0.01)
    expect(stepText(st)).toEqual({ move: 'Days 120 → 119', change: '+$0.01', per: 'one day added $0.01' })
  })
  it('no readout when nothing moved, two sliders moved, or the option changed', () => {
    expect(stepOf(a, a)).toBeNull()
    expect(stepOf(a, { ...a, S: 100, iv: 31 })).toBeNull()
    expect(stepOf(a, { ...a, type: 'put' })).toBeNull()
    expect(stepOf(null, a)).toBeNull()
    expect(stepText(null)).toBeNull()
  })
})

describe('the drawing', () => {
  it('today across the slider range, the hockey stick at expiry, a height that holds both', () => {
    for (const st of states(60, 77)) {
      const c = curveOf(st)
      expect(c.today).toHaveLength(61)
      expect(c.x0).toBe(sliderOf('S', st.K).min)
      expect(c.x1).toBe(sliderOf('S', st.K).max)
      expect(c.today[0].x).toBe(c.x0)
      expect(c.today[60].x).toBeCloseTo(c.x1, 9)
      for (const p of c.today) expect(p.y).toBeCloseTo(blackScholes(st.type, p.x, st.K, st.days / YEAR, RATE, st.iv / 100).price, 12)
      expect(c.expiry.map((p) => p.x)).toEqual([c.x0, st.K, c.x1])
      expect(Math.max(...c.expiry.map((p) => p.y))).toBeCloseTo(st.K * 0.3, 6)
      expect(c.y1).toBeGreaterThanOrEqual(st.K * 0.3 * 1.25 - 1e-9)
      expect(c.y1).toBeGreaterThanOrEqual(Math.max(...c.today.map((p) => p.y)))
      expect(c.ticks[0]).toBe(0)
      expect(c.ticks[c.ticks.length - 1]).toBeCloseTo(c.y1, 6)
      expect(c.at).toEqual({ x: st.S, y: greeksOf(st).price, delta: greeksOf(st).delta })
      expect(c.timeValue).toBeCloseTo(greeksOf(st).price - intrinsic(st.type, st.S, st.K), 12)
    }
  })
  it('keeps its height while the days slide through ordinary values', () => {
    const heights = new Set(Array.from({ length: 120 }, (_, d) => curveOf({ type: 'call', K: 100, S: 100, days: d + 1, iv: 30 }).y1))
    expect([...heights]).toEqual([40])
  })
  it('a tidy axis step', () => {
    expect(niceStep(37.5, 4)).toBe(10)
    expect(niceStep(75, 4)).toBe(20)
    expect(niceStep(9, 4)).toBe(2.5)
    expect(niceStep(0)).toBe(1)
  })
})

// ── the challenges ───────────────────────────────────────────────────────────────────────────────────────────────

const BANNED = ['may potentially', "it's important to", 'in order to', 'leverage', 'utilize', 'journey', 'robust', 'seamless',
  'dive in', 'dive into', 'great job', "let's explore", 'in this scenario', 'as a trader, you', 'it is worth noting', 'key takeaway',
  'comprehensive', 'crucial', 'essential component', 'framework', 'traders should', 'successful traders']

/** What breaks the house voice in a line (docs/study/VOICE.md §6): an empty list when it reads right. */
function voiceProblems(text, { question = false } = {}) {
  const t = String(text ?? '')
  const out = []
  if (/—/.test(t)) out.push('an em-dash')
  if (/\bfirm\b/i.test(t)) out.push('"firm"')
  if (/undefined|NaN|null|\[object/.test(t)) out.push('a broken value')
  if (/\p{Extended_Pictographic}/u.test(t)) out.push('an emoji')
  for (const b of BANNED) if (t.toLowerCase().includes(b)) out.push(`banned "${b}"`)
  for (const sentence of t.split(/(?<=[.!?])\s+/)) if (sentence.split(/\s+/).filter(Boolean).length > 22) out.push(`over 22 words: ${sentence}`)
  if (question && /!/.test(t)) out.push('an exclamation mark in a question')
  return out.map((p) => `${p} in "${t}"`)
}

function copyProblems(ch) {
  const out = [
    ...voiceProblems(ch.question, { question: true }), ...voiceProblems(ch.detail, { question: true }),
    ...voiceProblems(ch.lesson), ...voiceProblems(ch.note), ...voiceProblems(ch.title),
  ]
  if (/\?/.test(ch.lesson)) out.push(`a question in the lesson "${ch.lesson}"`)   // a lesson states; it does not ask
  if (!ch.question || !ch.lesson || !ch.note) out.push(`missing words in ${ch.kind}`)
  for (const w of ch.working || []) out.push(...voiceProblems(w))
  for (const c of ch.choices || []) out.push(...voiceProblems(c.label), ...voiceProblems(c.headline), ...voiceProblems(c.why), ...voiceProblems(c.result))
  if (!/^F6\.0[4-7] /.test(ch.source)) out.push(`source "${ch.source}"`)
  return out
}

function checkCopy(ch) {
  expect(copyProblems(ch)).toEqual([])
}

const sameGrid = (st) => expect(snapState(st)).toEqual(st)

function checkSet(ch) {
  expect(SET_KINDS).toContain(ch.kind)
  sameGrid(ch.start)
  // the deal starts outside the zone, the zone is one unbroken run of slider values, and its best value is inside
  expect(passes(ch.check, ch.start)).toBe(false)
  expect(scoreSet(ch, ch.start)).toEqual({ ok: false, value: measureOf(ch.measure, ch.start) })
  const z = zoneOf(ch.start, ch.live, ch.check)
  expect(z).toEqual(ch.zone)
  expect(z.contiguous).toBe(true)
  expect(z.count).toBeGreaterThanOrEqual(ch.kind === 'theta_day' ? 2 : 3)
  expect(z.values.filter((v) => !passes(ch.check, { ...ch.start, [ch.live]: v }))).toEqual([])
  const grid = gridOf(ch.live, ch.start.K)
  const lo = grid.indexOf(z.lo), hi = grid.indexOf(z.hi)
  if (lo > 0) expect(passes(ch.check, { ...ch.start, [ch.live]: grid[lo - 1] })).toBe(false)
  if (hi < grid.length - 1) expect(passes(ch.check, { ...ch.start, [ch.live]: grid[hi + 1] })).toBe(false)
  expect(scoreSet(ch, ch.best).ok).toBe(true)
  expect(z.values).toContain(ch.best[ch.live])
  // the best differs from the start only on the live slider
  for (const k of ['type', 'K', 'S', 'days', 'iv']) if (k !== ch.live) expect(ch.best[k]).toBe(ch.start[k])
  expect(ch.covered).toEqual([{ delta: 'delta', gamma: 'gamma', decay: 'theta' }[ch.measure]])
  // the words carry the zone the scoring uses
  const zt = zoneText(ch)
  expect(zt.slider).toBe(rangeText(ch.live, z.lo, z.hi))
  if (ch.check.atLeast == null) {
    expect(ch.detail).toContain(`${ch.measure === 'decay' ? money(ch.check.target - ch.check.tol) : fmtDelta(ch.check.target - ch.check.tol)} to`)
  }
  expect(setLine(ch, ch.best)).toContain(ch.live === 'S' ? fmtStock(ch.best.S) : `${ch.best.days} day`)
  expect(fairToHint(ch.start, ch.live, ch.check)).toBe(true)
}

/** A member who follows the hint: from the start, one notch at a time toward the zone, stopping at the first reading in
 *  the stated range (delta and theta), or at an end of the notch where delta jumps most (gamma). Where they stop. */
function followHint(ch) {
  const grid = gridOf(ch.live, ch.start.K)
  const at = (v) => ({ ...ch.start, [ch.live]: v })
  if (ch.check.atLeast != null) {
    const d = grid.map((v) => measureOf('delta', at(v)))
    const jumps = grid.map((_, i) => (i ? Math.abs(rnd(d[i] - d[i - 1], 2)) : -1))
    const top = Math.max(...jumps)
    return grid.flatMap((v, i) => (jumps[i] === top ? [grid[i - 1], v] : []))
  }
  const dir = ch.zone.lo > ch.start[ch.live] ? 1 : -1
  let i = grid.indexOf(ch.start[ch.live])
  while (i + dir >= 0 && i + dir < grid.length) {
    const r = readOf(at(grid[i]), at(grid[i + dir]))
    i += dir
    if (Math.abs(r - ch.check.target) <= ch.check.tol + 1e-9) return [grid[i]]
  }
  return []
}

function checkPick(ch) {
  expect(ch.mode).toBe('pick')
  sameGrid(ch.start)
  sameGrid(ch.after)
  expect(ch.after).not.toEqual(ch.start)
  expect(new Set(ch.labels).size).toBe(ch.labels.length)
  expect(ch.choices.filter((c) => c.right)).toHaveLength(1)
  expect(ch.answer).toBe(ch.choices.find((c) => c.right).label)
  expect(ch.labels).toEqual(ch.choices.map((c) => c.label))
  for (const c of ch.choices) expect(c.mistake === 'right').toBe(c.right)
}

describe('every challenge kind over a sweep of seeds', () => {
  const runs = SEEDS.map((sd) => ({ sd, run: buildRun(sd) }))
  const all = runs.flatMap((x) => x.run)

  it('a run is five challenges, one per station in the course order, two or three set on a slider', () => {
    expect(GREEKS_KIND).toBe('greeks')
    expect(GREEKS_TOTAL).toBe(5)
    for (const { sd, run } of runs) {
      expect(run).toHaveLength(5)
      expect(run.map((c) => c.station)).toEqual(STATIONS.map((s) => s.key))
      const sets = run.filter((c) => c.mode === 'set').length
      expect(sets).toBeGreaterThanOrEqual(2)
      expect(sets).toBeLessThanOrEqual(3)
      expect(new Set(run.map((c) => c.id)).size).toBe(5)
      expect(run[0].id).toBe(`greeks-${sd}-0`)
    }
  })
  it('seeds a millisecond apart deal unrelated runs (the seed is scrambled before the generator)', () => {
    const base = 1731100000000
    const firsts = Array.from({ length: 40 }, (_, i) => rng(base + i)())
    // Park-Miller alone moves its first draw 2e-5 per millisecond: forty in a row would sit in a sliver of [0, 1)
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeGreaterThan(0.5)
    // the first station's kind comes off the first draw: unscrambled, forty milliseconds in a row would all deal the same
    const first = new Set(Array.from({ length: 40 }, (_, i) => buildRun(base + i)[0].kind))
    expect([...first].sort()).toEqual(['delta_atm', 'delta_dollars', 'delta_wing'])
    expect(scramble(base)).toBe(scramble(base))
    expect(scramble(base)).not.toBe(scramble(base + 1))
    expect(scramble(0)).toBe(0)
    expect(rng(0)()).toBeGreaterThan(0)
  })
  it('the same seed deals the same run; another seed deals another', () => {
    expect(buildRun(SEEDS[3])).toEqual(buildRun(SEEDS[3]))
    expect(JSON.stringify(buildRun(SEEDS[3]))).not.toBe(JSON.stringify(buildRun(SEEDS[4])))
  })
  it('every kind comes up, and the lever falls both ways', () => {
    const seen = new Set(all.map((c) => c.kind))
    expect([...seen].sort()).toEqual([...KINDS].sort())
    const lever = all.filter((c) => c.kind === 'lever')
    expect(lever.some((c) => c.answer === '10 more days')).toBe(true)
    expect(lever.some((c) => c.answer === '10 points of IV')).toBe(true)
  })
  it('fair to the hint: following the on-screen reading, as the challenge says, always lands in the zone', () => {
    const sets = all.filter((c) => c.mode === 'set')
    expect(new Set(sets.map((c) => c.kind))).toEqual(new Set(SET_KINDS))
    for (const ch of sets) {
      const stops = followHint(ch)
      expect(stops.length).toBeGreaterThan(0)
      for (const v of stops) expect(passes(ch.check, { ...ch.start, [ch.live]: v })).toBe(true)
    }
  })
  it('the first generator dealt these two, and the rule refuses both', () => {
    // seed 1731100142542: the 80 put, theta zone $0.07 to $0.09; at 29 days the last move read "one day cost $0.07"
    // (two rounded prices) while the covered theta was $0.06, a miss for a member who did exactly what the hint said
    const th = { type: 'put', K: 80, S: 80, days: 107, iv: 43 }
    const thc = { measure: 'decay', target: 0.08, tol: 0.01 }
    expect(readOf({ ...th, days: 30 }, { ...th, days: 29 })).toBe(0.07)
    expect(passes(thc, { ...th, days: 29 })).toBe(false)
    expect(fairToHint(th, 'days', thc)).toBe(false)
    // seed 1731100087109: the 150 call; stepping XYZ $150 → $151 read +$0.55 per $1, but delta at $151 is 0.56
    const de = { type: 'call', K: 150, S: 174, days: 34, iv: 32 }
    const dec = { measure: 'delta', target: 0.5, tol: 0.05 }
    expect(readOf({ ...de, S: 150 }, { ...de, S: 151 })).toBe(0.55)
    expect(measureOf('delta', { ...de, S: 151 })).toBe(0.56)
    expect(fairToHint(de, 'S', dec)).toBe(false)
    // and a dealt one passes
    const ok = all.find((c) => c.kind === 'delta_atm')
    expect(fairToHint(ok.start, 'S', ok.check)).toBe(true)
  })
  it('each challenge is fair, and its words are true for its numbers and in our voice', () => {
    for (const ch of all) {
      checkCopy(ch)
      if (ch.mode === 'set') checkSet(ch)
      else checkPick(ch)
    }
  })

  it('delta at the money: the zone holds the strike, as the lesson says', () => {
    for (const ch of all.filter((c) => c.kind === 'delta_atm')) {
      expect(ch.zone.lo).toBeLessThanOrEqual(ch.start.K)
      expect(ch.zone.hi).toBeGreaterThanOrEqual(ch.start.K)
      expect(ch.check).toEqual({ measure: 'delta', target: ch.start.type === 'call' ? 0.5 : -0.5, tol: 0.05 })
      expect(ch.note).toBe(`Right at the ${ch.start.K} strike, this ${ch.start.type}'s delta is ${fmtDelta(measureOf('delta', { ...ch.start, S: ch.start.K }))}.`)
    }
  })
  it('delta on the wings: 0.30 out of the money, 0.70 in it, on the side the note names', () => {
    for (const ch of all.filter((c) => c.kind === 'delta_wing')) {
      const { type, K } = ch.start
      const t = ch.check.target
      expect([0.3, 0.7, -0.3, -0.7]).toContain(t)
      expect(Math.sign(t)).toBe(type === 'call' ? 1 : -1)
      const otm = Math.abs(t) === 0.3
      const below = (type === 'call') === otm
      if (below) expect(ch.zone.hi).toBeLessThan(K)
      else expect(ch.zone.lo).toBeGreaterThan(K)
      expect(ch.note).toContain(below ? 'under' : 'over')
      expect(ch.note).toContain(otm ? 'out of the money' : 'in the money')
    }
  })
  it('theta by the day: at the strike, the zone nearer expiry than the start, and the one-day price drop reads in the zone', () => {
    for (const ch of all.filter((c) => c.kind === 'theta_day')) {
      expect(ch.start.S).toBe(ch.start.K)
      expect(ch.zone.hi).toBeLessThan(ch.start.days)
      expect(ch.zone.count).toBeLessThanOrEqual(15)
      expect(ch.check.tol).toBe(Math.max(0.02, rnd(ch.check.target * 0.12, 2)))   // at least two cents: the readout is good to one
      expect(measureOf('decay', ch.start)).toBeLessThan(ch.check.target)   // the daily decay grows toward the zone as expiry nears
      for (const d of ch.zone.values) {
        const drop = rnd(shown({ ...ch.start, days: d }).price - shown({ ...ch.start, days: d - 1 }).price, 2)
        expect(Math.abs(drop - ch.check.target)).toBeLessThanOrEqual(ch.check.tol + 0.01 + 1e-9)
      }
    }
  })
  it("gamma's peak sits by the strike, and the zone is within 10% of it", () => {
    for (const ch of all.filter((c) => c.kind === 'gamma_peak')) {
      const grid = gridOf('S', ch.start.K)
      const top = Math.max(...grid.map((v) => measureOf('gamma', { ...ch.start, S: v })))
      expect(ch.top).toBe(top)
      expect(ch.check.atLeast).toBeCloseTo(top * 0.9, 12)
      expect(measureOf('gamma', { ...ch.start, S: ch.peak })).toBe(top)
      expect(Math.abs(ch.peak / ch.start.K - 1)).toBeLessThanOrEqual(0.03)
      expect(ch.best.S).toBe(ch.peak)
    }
  })
  it('the moves challenges: the right move raises the measure clear of the rest, every other move lowers it', () => {
    for (const ch of all.filter((c) => c.kind === 'theta_most' || c.kind === 'gamma_most')) {
      const m = ch.kind === 'theta_most' ? 'decay' : 'gamma'
      expect(ch.measure).toBe(m)
      expect(ch.before).toBe(measureOf(m, ch.start))
      for (const c of ch.choices) {
        expect(c.value).toBe(measureOf(m, c.after))
        expect(c.label).toBe(moveLabel(Object.keys(c.after).find((k) => c.after[k] !== ch.start[k]), ...(() => { const k = Object.keys(c.after).find((x) => c.after[x] !== ch.start[x]); return [ch.start[k], c.after[k]] })()))
        if (c.right) expect(c.value).toBeGreaterThan(ch.before)
        else expect(c.value).toBeLessThan(ch.before)
      }
      const right = ch.choices.find((c) => c.right)
      const rest = Math.max(...ch.choices.filter((c) => !c.right).map((c) => c.value))
      expect(right.value).toBeGreaterThanOrEqual(rest * (m === 'decay' ? 1.4 : 1.5))
      expect(right.after.days).toBeLessThan(ch.start.days)   // the right move is always less time
      expect(ch.after).toEqual(right.after)
    }
  })
  it('time or IV: the right tile is the bigger raise, and the lesson matches who won', () => {
    for (const ch of all.filter((c) => c.kind === 'lever')) {
      const p0 = greeksOf(ch.start).price
      const viaDays = rnd(greeksOf({ ...ch.start, days: ch.start.days + 10 }).price - p0, 2)
      const viaIv = rnd(greeksOf({ ...ch.start, iv: ch.start.iv + 10 }).price - p0, 2)
      const ivWins = viaIv > viaDays
      expect(ch.answer).toBe(ivWins ? '10 points of IV' : '10 more days')
      expect(Math.max(viaDays, viaIv)).toBeGreaterThanOrEqual(Math.min(viaDays, viaIv) * 1.3)
      if (ivWins) { expect(ch.start.days).toBeGreaterThanOrEqual(30); expect(ch.lesson).toMatch(/IV lifts calls and puts alike/) }
      else { expect(ch.start.days).toBeLessThanOrEqual(21); expect(ch.lesson).toMatch(/Close to expiry/) }
      expect(ch.note).toBe(`10 more days: ${signed(viaDays)} a share. 10 points of IV: ${signed(viaIv)} a share.`)
    }
  })
  it('IV up or down with XYZ still: calls and puts both rise with IV and both fall with it', () => {
    for (const ch of all.filter((c) => c.kind === 'iv_move')) {
      expect(ch.after.S).toBe(ch.start.S)
      expect(ch.after.days).toBe(ch.start.days)
      const change = rnd(shown(ch.after).price - shown(ch.start).price, 2)
      expect(Math.abs(change)).toBeGreaterThanOrEqual(0.1)
      expect(ch.answer).toBe(ch.after.iv > ch.start.iv ? 'It gains value' : 'It loses value')
      expect(Math.sign(change)).toBe(ch.after.iv > ch.start.iv ? 1 : -1)
      expect(ch.labels).toEqual(['It gains value', 'It loses value', 'No change'])
      const up = ch.after.iv > ch.start.iv
      const sign = ch.choices.find((c) => c.mistake === 'sign')
      expect(sign.headline).toBe(up ? `Rising IV lifts ${ch.start.type}s too.` : `Falling IV cuts ${ch.start.type}s too.`)
    }
  })
  it('delta in dollars: the right tile is delta x the move x 100, the mistakes are the named ones', () => {
    for (const ch of all.filter((c) => c.kind === 'delta_dollars')) {
      const d = measureOf('delta', ch.start)
      const move = rnd(ch.after.S - ch.start.S, 2)
      const est = rnd(d * move * 100, 2)
      expect(ch.question).toContain(`delta is ${fmtDelta(d)}`)
      expect(ch.question).toContain(`${move > 0 ? 'rises' : 'falls'} ${fmtStock(Math.abs(move))}`)
      const by = Object.fromEntries(ch.choices.map((c) => [c.mistake, c.label]))
      expect(by.right).toBe(signed(est))
      expect(by.x100).toBe(signed(est / 100))
      expect(by.sign).toBe(signed(-est))
      expect(by.stock).toBe(signed(Math.sign(est) * Math.abs(move) * 100))
      expect(ch.est).toBe(est)
      expect(ch.full).toBe(rnd((greeksOf(ch.after).price - greeksOf(ch.start).price) * 100, 2))
      // "gamma bends the price your way" only when the full reprice beats the estimate by a dollar or more AND the curve
      // (not delta's rounding to 0.01) made at least a dollar of it; otherwise the two sit within a dollar ("close")
      const bend = (greeksOf(ch.after).price - greeksOf(ch.start).price) * 100 - greeksOf(ch.start).delta * move * 100
      expect(bend).toBeGreaterThan(0)   // a long option's gamma always bends the price your way
      if (/gamma bends/.test(ch.note)) {
        expect(ch.full - ch.est).toBeGreaterThanOrEqual(1 - 1e-9)
        expect(bend).toBeGreaterThanOrEqual(1)
      } else {
        expect(Math.abs(ch.full - ch.est)).toBeLessThan(1)
        expect(ch.note).toBe(`Delta said ${signed(est)}. The full reprice is ${signed(ch.full)}: for a small move, delta is close.`)
      }
    }
  })
  it('delta in dollars never credits gamma for a gap that delta\'s rounding made', () => {
    // generator seeds whose first draw the first rule let through: the 150 call, XYZ $155 → $154, delta said −$63 and the
    // full reprice is −$61.87; the curve made $0.80 of that $1.13 gap and delta's rounding to 0.63 the rest, yet the note
    // said "gamma bends the price your way". Now such a draw is redrawn, and the note on whatever deals is true
    for (const s of [278, 589, 861]) {
      const ch = deal('delta_dollars', rng(s))
      const move = ch.after.S - ch.start.S
      const bend = (greeksOf(ch.after).price - greeksOf(ch.start).price) * 100 - greeksOf(ch.start).delta * move * 100
      if (/gamma bends/.test(ch.note)) expect(bend).toBeGreaterThanOrEqual(1)
      else expect(Math.abs(ch.full - ch.est)).toBeLessThan(1)
    }
  })
  it('vega in dollars: the right tile is vega x the points, falling; the mistakes are the named ones', () => {
    for (const ch of all.filter((c) => c.kind === 'vega_dollars')) {
      const v = measureOf('vega', ch.start)
      const pts = ch.start.iv - ch.after.iv
      expect([10, 15, 20]).toContain(pts)
      const est = rnd(-v * pts, 2)
      const by = Object.fromEntries(ch.choices.map((c) => [c.mistake, c.label]))
      expect(by.right).toBe(signed(est))
      expect(by.sign).toBe(signed(-est))
      expect(by.point).toBe(signed(-v))
      expect(by.x100).toBe(signed(est * 100))
      expect(ch.full).toBe(rnd(greeksOf(ch.after).price - greeksOf(ch.start).price, 2))
      // "it lands close": within 15% of the estimate, and the note says both numbers
      expect(Math.abs(ch.full - est)).toBeLessThanOrEqual(Math.abs(est) * 0.15 + 1e-9)
      expect(ch.note).toBe(`Vega said ${signed(est)}. The full reprice is ${signed(ch.full)}: vega is the quick estimate, and it lands close.`)
    }
  })
})

describe('the review and the run', () => {
  it('the before and after rows: what moved, and the number that matters', () => {
    const ch = { measure: 'delta' }
    const from = { type: 'call', K: 100, S: 82, days: 30, iv: 30 }
    const to = { ...from, S: 100 }
    expect(rowsOf(ch, from, to)).toEqual([
      { key: 'S', label: 'XYZ', before: '$82', after: '$100' },
      { key: 'delta', label: 'Delta', before: fmtDelta(measureOf('delta', from)), after: '0.53', main: true },
    ])
    const decay = rowsOf({ measure: 'decay' }, { ...from, S: 100 }, { ...from, S: 100, days: 10 })
    expect(decay[0]).toEqual({ key: 'days', label: 'Days', before: '30 days', after: '10 days' })
    expect(decay[1].label).toBe('A day costs')
  })
  it('a deal that cannot be dealt says so', () => {
    expect(() => deal('rho', rng(1))).toThrow(/unknown kind/)
  })
  it('the verdict by the share right, and a run id the server accepts', () => {
    expect(verdictOf(5, 5)).toBe('Lab legend')
    expect(verdictOf(4, 5)).toBe('Sharp on the Greeks')
    expect(verdictOf(3, 5)).toBe('Getting the feel')
    expect(verdictOf(2, 5)).toBe('Halfway there')
    expect(verdictOf(0, 5)).toBe('Back to the bench')
    expect(verdictOf(0, 0)).toBe('Back to the bench')
    expect(runIdOf(1731100000000)).toBe('greeks-1731100000000')
    expect(runIdOf('x'.repeat(80)).length).toBe(64)
  })
})
