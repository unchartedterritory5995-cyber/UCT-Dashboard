// GREEKS LAB (docs/study/GAMES.md §3, kind 'greeks'): the pure side of the game. A lab of one option on XYZ, a made-up
// stock: three sliders (XYZ's price within 30% of the strike, the days to expiry 1 to 120, implied volatility 10% to
// 120%) and a call/put toggle; the option's price and its delta, gamma, theta (a calendar day) and vega (one point of
// IV) from Black-Scholes with no dividends and a fixed 4% rate. Five challenges a run, one per station in the course's
// order (delta, theta, vega, gamma, then time against IV), each scored from the slider state or a choice. Every number
// the game shows or scores comes from here; a run comes from a seed (the component seeds once at start; nothing here
// reads the clock or Math.random).
//
// The rules it teaches (the course, docs/study/courses/F6/F6.04-F6.07.json, every one from OIC/OCC sources):
//   F6.04  delta is the option's move per $1 in the stock; near 0.50 at the money, toward 1.00 in the money and 0 out
//          of it; times 100 it is the shares one contract acts like
//   F6.05  theta is one day's decay with nothing else changing; it speeds up as expiry nears, most at the money
//   F6.06  vega is the price change for one point of IV; more IV lifts calls and puts alike, falling IV cuts both
//   F6.07  gamma is how much delta changes per $1; highest at the money, and near expiry most of all
//
// Scoring reads the numbers as the screen shows them (delta to 0.01, gamma to 0.001, dollars to the cent), so a value
// the member sees inside the zone always counts and one outside never does.

export const GREEKS_KIND = 'greeks'
export const GREEKS_TOTAL = 5
export const GREEKS_BEST_KEY = 'study.greeks.best'
export const RATE = 0.04
export const YEAR = 365
export const TICKER = 'XYZ'
export const MINUS = '−'
export const BAND = 0.3
export const DAYS = { min: 1, max: 120, step: 1 }
export const IVS = { min: 10, max: 120, step: 1 }
/** Strikes whose 30% band sits on a whole number of slider steps. */
export const STRIKES = [50, 60, 80, 100, 120, 150, 200, 250]
export const MODEL_LINE = 'Black-Scholes · no dividends · 4% rate'
export const SHARES = 100

/* ── numbers and words ────────────────────────────────────────────────────────────────────────────────────────── */

/** Round to `dp` places; never a negative zero. The one rounding the screen and the scoring share. */
export function rnd(x, dp = 2) {
  const f = 10 ** dp
  const v = Math.round(x * f) / f
  return v === 0 ? 0 : v
}

const commas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Dollars to the cent: 4.123 → "$4.12", −0.07 → "−$0.07". */
export function money(x) {
  const v = rnd(x, 2)
  const [i, f] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? MINUS : ''}$${commas(i)}.${f}`
}

/** Dollars, whole when whole: 124 → "$124", 1.24 → "$1.24", 128.4 → "$128.40". */
export function dollars(x) {
  const v = rnd(x, 2)
  if (Number.isInteger(v)) return `${v < 0 ? MINUS : ''}$${commas(String(Math.abs(v)))}`
  return money(v)
}

/** A signed amount: "+$124", "−$1.24", "$0". */
export function signed(x) {
  const v = rnd(x, 2)
  if (v === 0) return '$0'
  return `${v > 0 ? '+' : ''}${dollars(v)}`
}

/** A plain number to `dp` places with a true minus sign. */
export function num(x, dp) {
  const v = rnd(x, dp)
  return `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(dp)}`
}

export const fmtDelta = (d) => num(d, 2)
export const fmtGamma = (g) => num(g, 3)
export const fmtIv = (iv) => `${iv}%`
export const fmtDays = (d) => `${d} day${d === 1 ? '' : 's'}`
/** XYZ's price: "$100" when whole, "$99.50" otherwise. */
export const fmtStock = (S) => dollars(S)

/* ── the model ────────────────────────────────────────────────────────────────────────────────────────────────── */

export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** The standard normal CDF to double precision (Hart's algorithm 5666 as given by G. West, "Better approximations to
 *  cumulative normal functions", 2005). */
export function normCdf(x) {
  const a = Math.abs(x)
  let c
  if (a > 37) c = 0
  else {
    const e = Math.exp(-a * a / 2)
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688
      b = b * a + 6.37396220353165
      b = b * a + 33.912866078383
      b = b * a + 112.079291497871
      b = b * a + 221.213596169931
      b = b * a + 220.206867912376
      c = e * b
      b = 8.83883476483184e-2 * a + 1.75566716318264
      b = b * a + 16.064177579207
      b = b * a + 86.7807322029461
      b = b * a + 296.564248779674
      b = b * a + 637.333633378831
      b = b * a + 793.826512519948
      b = b * a + 440.413735824752
      c = c / b
    } else {
      let b = a + 0.65
      b = a + 4 / b
      b = a + 3 / b
      b = a + 2 / b
      b = a + 1 / b
      c = e / b / 2.506628274631
    }
  }
  return x > 0 ? 1 - c : c
}

/** What the option is worth on expiry day. */
export function intrinsic(type, S, K) {
  return Math.max(0, type === 'call' ? S - K : K - S)
}

/**
 * Black-Scholes for a European option with no dividends. S the stock, K the strike, T in years, r the rate and sigma
 * the volatility as fractions. Returns the price, delta, gamma, vega (per 1.00 of volatility) and theta (per year), with
 * d1 and d2. At or past expiry (or with no volatility) the option is its intrinsic value.
 */
export function blackScholes(type, S, K, T, r, sigma) {
  if (type !== 'call' && type !== 'put') throw new Error(`unknown type ${type}`)
  if (!(S > 0) || !(K > 0)) throw new Error('the stock and the strike must be above zero')
  if (!(T > 0) || !(sigma > 0)) {
    const call = type === 'call'
    const inside = call ? S > K : S < K
    return { price: intrinsic(type, S, K), delta: inside ? (call ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, d1: NaN, d2: NaN }
  }
  const sq = Math.sqrt(T)
  const v = sigma * sq
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / v
  const d2 = d1 - v
  const disc = K * Math.exp(-r * T)
  const pd1 = normPdf(d1)
  const gamma = pd1 / (S * v)
  const vega = S * pd1 * sq
  const decay = -(S * pd1 * sigma) / (2 * sq)
  if (type === 'call') {
    return { price: S * normCdf(d1) - disc * normCdf(d2), delta: normCdf(d1), gamma, vega, theta: decay - r * disc * normCdf(d2), d1, d2 }
  }
  return { price: disc * normCdf(-d2) - S * normCdf(-d1), delta: normCdf(d1) - 1, gamma, vega, theta: decay + r * disc * normCdf(-d2), d1, d2 }
}

/** The lab's state is { type, K, S, days, iv } (iv in whole percent). Its numbers, unrounded: the price a share, delta,
 *  gamma, theta for one calendar day and vega for one point of IV. */
export function greeksOf(st) {
  const g = blackScholes(st.type, st.S, st.K, st.days / YEAR, RATE, st.iv / 100)
  return { price: g.price, delta: g.delta, gamma: g.gamma, theta: g.theta / YEAR, vega: g.vega / 100 }
}

/** The numbers as the screen shows them, and as every challenge scores them. */
export function shown(st) {
  const g = greeksOf(st)
  return { price: rnd(g.price, 2), delta: rnd(g.delta, 2), gamma: rnd(g.gamma, 3), theta: rnd(g.theta, 2), vega: rnd(g.vega, 2) }
}

/** The price card: a share, a contract (100 shares), what it would be worth on expiry day at this price (intrinsic), and
 *  the rest (time value). Time value dips under zero only for a deep in-the-money put: this model pays its strike at
 *  expiry, and the rate discounts that. A call with no dividends never does. */
export function priceParts(st) {
  const price = shown(st).price
  const intr = rnd(intrinsic(st.type, st.S, st.K), 2)
  return { price, contract: rnd(price * SHARES, 2), intrinsic: intr, timeValue: rnd(price - intr, 2) }
}

/** One measure of a state, as shown: delta, gamma, vega, the price, or `decay` (what one day costs, positive when the
 *  option loses value). */
export function measureOf(key, st) {
  const g = shown(st)
  switch (key) {
    case 'delta': return g.delta
    case 'gamma': return g.gamma
    case 'vega': return g.vega
    case 'price': return g.price
    case 'decay': return rnd(-g.theta, 2)
    default: throw new Error(`unknown measure ${key}`)
  }
}

/* ── the sliders ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** XYZ's slider step for a strike: 50 cents up to a $60 strike, $1 to $150, $2 to $200, $2.50 above. */
export function stockStep(K) {
  return K <= 60 ? 0.5 : K <= 150 ? 1 : K <= 200 ? 2 : 2.5
}

/** One slider's range for a strike: 'S' (XYZ within 30% of the strike), 'days' or 'iv'. */
export function sliderOf(key, K) {
  if (key === 'days') return { ...DAYS }
  if (key === 'iv') return { ...IVS }
  if (key === 'S') return { min: rnd(K * (1 - BAND), 2), max: rnd(K * (1 + BAND), 2), step: stockStep(K) }
  throw new Error(`unknown slider ${key}`)
}

/** Every value a slider can take, low to high. */
export function gridOf(key, K) {
  const { min, max, step } = sliderOf(key, K)
  const n = Math.round((max - min) / step)
  return Array.from({ length: n + 1 }, (_, i) => rnd(min + i * step, 2))
}

/** The slider value nearest `v`, inside the slider's range. */
export function snapTo(key, K, v) {
  const { min, max, step } = sliderOf(key, K)
  const k = Math.round((Math.min(max, Math.max(min, Number(v) || 0)) - min) / step)
  return rnd(min + k * step, 2)
}

/** A state with every slider on its grid. */
export function snapState(st) {
  return { type: st.type === 'put' ? 'put' : 'call', K: st.K, S: snapTo('S', st.K, st.S), days: snapTo('days', st.K, st.days), iv: snapTo('iv', st.K, st.iv) }
}

export const SLIDER_NAMES = { S: 'Stock price', days: 'Days to expiry', iv: 'Implied volatility' }
export const SLIDER_SHORT = { S: TICKER, days: 'Days', iv: 'IV' }

/** A slider value in words: "$100", "30 days", "35%". */
export function sliderText(key, v) {
  return key === 'S' ? fmtStock(v) : key === 'days' ? fmtDays(v) : fmtIv(v)
}

/** A run of slider values in words: "$97 to $101", "12 to 15 days", "35% to 38%"; one value alone when lo is hi. */
export function rangeText(key, lo, hi) {
  if (lo === hi) return sliderText(key, lo)
  if (key === 'days') return `${lo} to ${hi} days`
  return `${sliderText(key, lo)} to ${sliderText(key, hi)}`
}

/** What the last slider move did: the slider, from and to, the price's change, and that change per unit of the slider
 *  ($1 of XYZ, one day, one point of IV). Null when nothing moved, or the type, strike or more than one slider changed. */
export function stepOf(prev, next) {
  if (!prev || !next || prev.type !== next.type || prev.K !== next.K) return null
  const keys = ['S', 'days', 'iv'].filter((k) => prev[k] !== next[k])
  if (keys.length !== 1) return null
  const key = keys[0]
  const units = rnd(next[key] - prev[key], 2)
  const change = rnd(shown(next).price - shown(prev).price, 2)
  return { key, from: prev[key], to: next[key], units, change, per: rnd(change / units, 2) }
}

/** The last move in words: { move: "XYZ $99 → $100", change: "+$0.53", per: "about +$0.53 per $1", "one day cost
 *  $0.21", or null when one unit up already says it }. A unit DOWN still reads per unit up ("XYZ $100 → $99, price
 *  −$0.53, about +$0.53 per $1"), so the reading never carries the step's own minus sign into the Greek it stands for. */
export function stepText(step) {
  if (!step) return null
  const move = moveLabel(step.key, step.from, step.to)
  const change = signed(step.change)
  const up1 = step.units === 1
  let per = null
  if (step.key === 'days' && step.units === -1) {
    // a day off the clock: what it cost (a deep in-the-money put can gain a cent as the rate's discount shrinks)
    per = step.change > 0 ? `one day added ${money(step.change)}` : `one day cost ${money(-step.change)}`
  } else if (step.key === 'days') per = up1 ? null : `about ${signed(-step.per)} a day off the clock`
  else if (step.key === 'iv') per = up1 ? null : `about ${signed(step.per)} a point`
  else per = up1 ? null : `about ${signed(step.per)} per $1`
  return { move, change, per }
}

/** What the last move reads per unit of its slider, rounded as the screen shows it: the price's change per $1 of XYZ
 *  (about the delta), per day on the clock (what a day costs, the decay) or per point of IV (about the vega). Null unless
 *  exactly one slider moved. */
export function readOf(prev, next) {
  const s = stepOf(prev, next)
  return s ? s.per : null
}

/**
 * Fair to the hint (rule 6). A set challenge covers its Greek and tells the member to read it off the last move, one
 * notch at a time; that reading is the price's change between two rounded prices, so near a zone's edge it can sit a
 * cent or a hundredth away from the Greek it stands for. A deal is fair when, stepping the live slider one notch either
 * way, every reading inside the stated range lands on a value that scores right, and at least one reading does (so the
 * hint can be followed to an answer). For gamma's peak the hint is delta's jump per notch: both ends of every notch where
 * delta (as shown) jumps most must score right.
 */
export function fairToHint(start, live, check) {
  const vals = gridOf(live, start.K)
  const at = (v) => ({ ...start, [live]: v })
  if (check.atLeast != null) {
    const d = vals.map((v) => measureOf('delta', at(v)))
    const jump = vals.map((_, i) => (i ? Math.abs(rnd(d[i] - d[i - 1], 2)) : -1))
    const top = Math.max(...jump)
    return jump.every((j, i) => j !== top || (passes(check, at(vals[i])) && passes(check, at(vals[i - 1]))))
  }
  let seen = false
  for (let i = 0; i < vals.length; i++) {
    for (const k of [i - 1, i + 1]) {
      if (k < 0 || k >= vals.length) continue
      if (Math.abs(readOf(at(vals[k]), at(vals[i])) - check.target) > check.tol + 1e-9) continue
      if (!passes(check, at(vals[i]))) return false
      seen = true
    }
  }
  return seen
}

/* ── the drawing ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** A tidy axis step: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span, target = 4) {
  if (!(span > 0)) return 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
}

/**
 * The option's price across XYZ's slider range today (the gold curve) and on expiry day (the dashed hockey stick), for
 * the drawing. The height holds the expiry line's full 30% with room to spare and grows only when today's curve needs
 * more, so it stays still while a slider moves through ordinary values.
 */
export function curveOf(st, n = 61) {
  const { min: x0, max: x1 } = sliderOf('S', st.K)
  const T = st.days / YEAR, sigma = st.iv / 100
  const today = Array.from({ length: n }, (_, i) => {
    const x = x0 + (i / (n - 1)) * (x1 - x0)
    return { x, y: blackScholes(st.type, x, st.K, T, RATE, sigma).price }
  })
  const expiry = [x0, st.K, x1].map((x) => ({ x, y: intrinsic(st.type, x, st.K) }))
  const need = Math.max(st.K * BAND * 1.25, ...today.map((p) => p.y * 1.06))
  const step = niceStep(need, 4)
  const y1 = Math.ceil(need / step - 1e-9) * step
  const ticks = []
  for (let v = 0; v <= y1 + 1e-9; v += step) ticks.push(rnd(v, 2))
  const g = greeksOf(st)
  return { x0, x1, y0: 0, y1, today, expiry, ticks, at: { x: st.S, y: g.price, delta: g.delta }, timeValue: g.price - intrinsic(st.type, st.S, st.K) }
}

/* ── the seed ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The seed through a 32-bit integer hash (the murmur3 finalizer over both halves of a millisecond clock), so two seeds
 *  a millisecond apart start the generator far apart. */
export function scramble(seed) {
  const n = Math.abs(Math.floor(Number(seed) || 0))
  let h = (n % 4294967296) ^ Math.imul(Math.floor(n / 4294967296), 0x9e3779b1)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A small seeded generator (Park-Miller, the one the other games use, on a scrambled seed): the same seed, the same run;
 *  the next millisecond, an unrelated one. */
export function rng(seed) {
  let s = scramble(seed) % 2147483647 || 1
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

export function shuffled(list, r) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const pickOf = (list, r) => list[Math.floor(r() * list.length)]
const between = (lo, hi, r) => lo + Math.floor(r() * (hi - lo + 1))
const typeOf = (r, callShare = 0.6) => (r() < callShare ? 'call' : 'put')
const optName = (st) => `${st.K} ${st.type}`

/* ── the stations ─────────────────────────────────────────────────────────────────────────────────────────────── */

const SRC = {
  delta: 'F6.04 Delta',
  theta: 'F6.05 Theta',
  vega: 'F6.06 Vega and implied volatility',
  gamma: 'F6.07 Gamma',
  lever: 'F6.05 Theta and F6.06 Vega',
}

/** The five stations of a run, in the course's order; each draws one of its challenge kinds. */
export const STATIONS = [
  { key: 'delta', name: 'Delta', kinds: ['delta_atm', 'delta_wing', 'delta_dollars'] },
  { key: 'theta', name: 'Theta', kinds: ['theta_day', 'theta_most'] },
  { key: 'vega', name: 'Vega', kinds: ['iv_move', 'vega_dollars'] },
  { key: 'gamma', name: 'Gamma', kinds: ['gamma_peak', 'gamma_most'] },
  { key: 'lever', name: 'Time or IV', kinds: ['lever'] },
]
/** The challenges scored from the slider state; the rest are a choice. */
export const SET_KINDS = ['delta_atm', 'delta_wing', 'theta_day', 'gamma_peak']

/* ── set challenges: put the slider where the number lands ────────────────────────────────────────────────────── */

/** Whether a state lands in a set challenge's zone, on the numbers as shown. */
export function passes(check, st) {
  const m = measureOf(check.measure, st)
  if (check.atLeast != null) return m >= check.atLeast - 1e-9
  return Math.abs(m - check.target) <= check.tol + 1e-9
}

/** The slider values that land in the zone: { lo, hi, count, values, contiguous }, or null when none do. */
export function zoneOf(base, live, check) {
  const vals = gridOf(live, base.K)
  const idx = []
  vals.forEach((v, i) => { if (passes(check, { ...base, [live]: v })) idx.push(i) })
  if (!idx.length) return null
  return {
    lo: vals[idx[0]], hi: vals[idx[idx.length - 1]], count: idx.length, values: idx.map((i) => vals[i]),
    contiguous: idx.every((k, i) => i === 0 || k === idx[i - 1] + 1),
  }
}

/** The measure in words, as the readout shows it. */
export function measureText(key, v) {
  if (key === 'delta') return fmtDelta(v)
  if (key === 'gamma') return fmtGamma(v)
  return money(v)
}

const MEASURE_NAME = { delta: 'delta', gamma: 'gamma', decay: 'one day costs', vega: 'vega', price: 'price' }

/** Common shape of a set challenge from its base, slider, check and the value the lab glides to on a miss. */
function setChallenge(kind, station, start, live, covered, check, zone, best, words) {
  return { kind, station, mode: 'set', start, live, covered, check, zone, best, measure: check.measure, ...words }
}

function dealDeltaAtm(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES, r)
  const days = between(14, 60, r), iv = between(20, 45, r)
  const side = r() < 0.5 ? -1 : 1
  const S = snapTo('S', K, K * (1 + side * (0.14 + r() * 0.14)))
  const start = { type, K, S, days, iv }
  const target = type === 'call' ? 0.5 : -0.5
  const check = { measure: 'delta', target, tol: 0.05 }
  const zone = zoneOf(start, 'S', check)
  // the zone holds the strike itself (the lesson says "at the money"), and the deal starts outside it
  if (!zone || !zone.contiguous || zone.count < 3 || K < zone.lo || K > zone.hi || passes(check, start)) return null
  if (!fairToHint(start, 'S', check)) return null
  const best = bestIn(start, 'S', zone, check)
  const atK = measureOf('delta', { ...start, S: K })
  return setChallenge('delta_atm', 'delta', start, 'S', ['delta'], check, zone, best, {
    title: `Delta ${fmtDelta(target)}`,
    question: `Set ${TICKER} so this ${optName(start)}'s delta is about ${fmtDelta(target)}.`,
    detail: `Delta is covered. Step ${TICKER} a notch at a time and read the last move: its change per $1 is about the delta. ${fmtDelta(target - 0.05)} to ${fmtDelta(target + 0.05)} counts.`,
    lesson: type === 'call'
      ? 'At the money, delta sits near 0.50: the option moves about half as much as the stock.'
      : 'At the money, a put\'s delta sits near −0.50: it gains about half of every dollar the stock falls.',
    note: `Right at the ${K} strike, this ${type}'s delta is ${fmtDelta(atK)}.`,
    source: SRC.delta,
  })
}

function dealDeltaWing(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES, r)
  const days = between(20, 60, r), iv = between(25, 45, r)
  const otm = r() < 0.55
  const mag = otm ? 0.3 : 0.7
  const target = type === 'call' ? mag : -mag
  // where the zone sits: a call's 0.30 and a put's -0.70 under the strike, a call's 0.70 and a put's -0.30 over it
  const zoneBelow = (type === 'call') === otm
  const S = snapTo('S', K, K * (1 + (zoneBelow ? 1 : -1) * (0.1 + r() * 0.15)))
  const start = { type, K, S, days, iv }
  const check = { measure: 'delta', target, tol: 0.05 }
  const zone = zoneOf(start, 'S', check)
  const { min, max } = sliderOf('S', K)
  if (!zone || !zone.contiguous || zone.count < 3 || zone.lo <= min || zone.hi >= max || passes(check, start)) return null
  if (zoneBelow ? zone.hi >= K : zone.lo <= K) return null
  if (!fairToHint(start, 'S', check)) return null
  const best = bestIn(start, 'S', zone, check)
  return setChallenge('delta_wing', 'delta', start, 'S', ['delta'], check, zone, best, {
    title: `Delta ${fmtDelta(target)}`,
    question: `Set ${TICKER} so this ${optName(start)}'s delta is about ${fmtDelta(target)}.`,
    detail: `Delta is covered. Step ${TICKER} a notch at a time and read the last move: its change per $1 is about the delta. ${fmtDelta(target - 0.05)} to ${fmtDelta(target + 0.05)} counts.`,
    lesson: type === 'call'
      ? 'Out of the money, a call\'s delta shrinks toward 0. In the money, it climbs toward 1.00.'
      : 'Out of the money, a put\'s delta shrinks toward 0. In the money, it heads toward −1.00.',
    note: `Here ${fmtDelta(target)} sits at ${TICKER} ${rangeText('S', zone.lo, zone.hi)}, ${zoneBelow ? 'under' : 'over'} the ${K} strike: ${otm ? 'out of' : 'in'} the money.`,
    source: SRC.delta,
  })
}

function dealThetaDay(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES.filter((k) => k >= 80), r)
  const iv = between(25, 50, r)
  const at = between(5, 30, r)
  const S = K
  const target = measureOf('decay', { type, K, S, days: at, iv })
  if (target < 0.04) return null
  // at least two cents either side: the one-day readout is two rounded prices apart, so it is itself good to a cent
  const tol = Math.max(0.02, rnd(target * 0.12, 2))
  const start = { type, K, S, days: between(95, 120, r), iv }
  const check = { measure: 'decay', target, tol }
  const zone = zoneOf(start, 'days', check)
  if (!zone || !zone.contiguous || zone.count < 2 || zone.count > 15 || zone.hi >= start.days || passes(check, start)) return null
  // fair to the hint: inside the zone, one day off the clock drops the price by an amount that also reads as in it
  for (const d of zone.values) {
    if (d <= 1) return null
    const drop = rnd(shown({ ...start, days: d }).price - shown({ ...start, days: d - 1 }).price, 2)
    if (Math.abs(drop - target) > tol + 0.01 + 1e-9) return null
  }
  if (!fairToHint(start, 'days', check)) return null
  const best = bestIn(start, 'days', zone, check)
  return setChallenge('theta_day', 'theta', start, 'days', ['theta'], check, zone, best, {
    title: `Theta ${money(target)} a day`,
    question: `Set the days so this ${optName(start)} loses about ${money(target)} a day.`,
    detail: `Theta is covered. Take one day off the clock: the last move shows what that day cost. ${money(target - tol)} to ${money(target + tol)} counts.`,
    lesson: 'Theta grows as expiry nears. The last few weeks cost the most each day.',
    note: `With ${fmtDays(start.days)} left this ${type} lost ${money(measureOf('decay', start))} a day; with ${fmtDays(best.days)}, ${money(measureOf('decay', best))}.`,
    source: SRC.theta,
  })
}

function dealGammaPeak(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES, r)
  const days = between(5, 14, r), iv = between(25, 50, r)
  const side = r() < 0.5 ? -1 : 1
  const S = snapTo('S', K, K * (1 + side * (0.15 + r() * 0.1)))
  const start = { type, K, S, days, iv }
  const grid = gridOf('S', K)
  let top = -1, peak = K
  for (const v of grid) { const g = measureOf('gamma', { ...start, S: v }); if (g > top) { top = g; peak = v } }
  const check = { measure: 'gamma', atLeast: top * 0.9 }
  const zone = zoneOf(start, 'S', check)
  if (!zone || !zone.contiguous || zone.count < 3 || zone.count > grid.length * 0.4 || passes(check, start)) return null
  if (Math.abs(peak / K - 1) > 0.03) return null
  if (!fairToHint(start, 'S', check)) return null
  return setChallenge('gamma_peak', 'gamma', start, 'S', ['gamma'], check, zone, { ...start, S: peak }, {
    title: 'Gamma at its peak',
    question: `Set ${TICKER} where this ${optName(start)}'s delta changes fastest.`,
    detail: `Gamma is covered. Step ${TICKER} a notch at a time and watch delta: it jumps most where gamma peaks. A gamma within 10% of its peak counts.`,
    lesson: 'Gamma peaks at the money: that is where delta changes fastest, and near expiry it peaks hardest.',
    note: `The peak is ${fmtGamma(top)} at ${TICKER} ${fmtStock(peak)}, right by the ${K} strike. The zone runs ${rangeText('S', zone.lo, zone.hi)}.`,
    source: SRC.gamma,
    top,
    peak,
  })
}

/** The zone's value nearest the target (the middle of the zone for gamma, where it peaks). */
function bestIn(start, live, zone, check) {
  let best = zone.values[0], gap = Infinity
  for (const v of zone.values) {
    const m = measureOf(check.measure, { ...start, [live]: v })
    const d = check.atLeast != null ? -m : Math.abs(m - check.target)
    if (d < gap - 1e-12) { gap = d; best = v }
  }
  return { ...start, [live]: best }
}

/* ── pick challenges: one choice, scored on the module's numbers ──────────────────────────────────────────────── */

/** A move on one slider, in words: "Days 45 → 5", "IV 40% → 28%", "XYZ $100 → $120". */
export function moveLabel(key, from, to) {
  return `${SLIDER_SHORT[key]} ${key === 'days' ? from : sliderText(key, from)} → ${key === 'days' ? to : sliderText(key, to)}`
}

/** "Which move does the most": four moves on the lab's own option, the measure after each, the intended one the best
 *  by `margin` (the deal is redrawn otherwise, so the lesson always matches the numbers). */
function movesChallenge(kind, station, start, moves, measure, better, margin, words) {
  const before = measureOf(measure, start)
  const scored = moves.map((m) => {
    const after = snapState({ ...start, [m.key]: m.to })
    return { ...m, label: moveLabel(m.key, start[m.key], after[m.key]), after, value: measureOf(measure, after) }
  })
  if (new Set(scored.map((m) => m.label)).size !== scored.length) return null
  if (new Set(scored.map((m) => m.value)).size !== scored.length) return null
  const ranked = [...scored].sort((a, b) => (better === 'max' ? b.value - a.value : a.value - b.value))
  if (!ranked[0].right) return null
  if (!(ranked[0].value > 0) || ranked[0].value < ranked[1].value * margin) return null
  // on the numbers as shown, the right move raises the measure and every other move lowers it, as their lines say
  if (!(ranked[0].value > before) || scored.some((m) => !m.right && !(m.value < before))) return null
  const best = ranked[0]
  const what = measure === 'decay' ? 'one day\'s decay' : measure
  const note = `${best.label} took ${what} from ${measureText(measure, before)} to ${measureText(measure, best.value)}.`
  return { kind, station, mode: 'pick', start, before, measure, moves: scored, after: best.after, note, ...words }
}

function dealThetaMost(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES.filter((k) => k >= 80), r)
  const S = snapTo('S', K, K * (1 + (r() - 0.5) * 0.06))
  const days = between(30, 75, r), iv = between(25, 50, r)
  const start = { type, K, S, days, iv }
  const far = r() < 0.5 ? 1.2 : 0.8
  const moves = [
    { key: 'days', to: between(3, 10, r), right: true, headline: 'Right.', why: 'Theta grows as expiry nears.' },
    { key: 'days', to: Math.min(120, days + between(40, 55, r)), headline: 'That slows the decay.', why: 'More days left means less decay each day.' },
    { key: 'iv', to: Math.max(10, iv - between(10, 15, r)), headline: 'That shrinks the decay.', why: 'Lower IV means less time value to lose each day.' },
    { key: 'S', to: K * far, headline: 'That shrinks the decay.', why: 'Far from the strike there is less time value to lose.' },
  ]
  const ch = movesChallenge('theta_most', 'theta', start, moves, 'decay', 'max', 1.4, {
    title: 'The biggest daily decay',
    question: `Which move makes this ${optName(start)} lose the most value in one day?`,
    detail: `Each tile moves one slider. Theta is one day's decay; now it costs ${money(measureOf('decay', start))} a day.`,
    lesson: 'Theta grows as expiry nears. Less time left, more decay every day.',
    source: SRC.theta,
  })
  if (!ch) return null
  return withTiles(ch, r, (m) => `${money(m.value)} a day`)
}

function dealGammaMost(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES, r)
  const days = between(30, 60, r), iv = between(25, 45, r)
  const start = { type, K, S: K, days, iv }
  const moves = [
    { key: 'days', to: between(2, 5, r), right: true, headline: 'Right.', why: 'At the money near expiry, gamma is at its biggest.' },
    { key: 'days', to: Math.min(120, days + between(45, 60, r)), headline: 'That calms delta down.', why: 'More time spreads gamma out: delta changes slower.' },
    { key: 'S', to: K * (r() < 0.5 ? 1.15 : 0.85), headline: 'That calms delta down.', why: 'Away from the strike, gamma fades.' },
    { key: 'iv', to: Math.min(120, iv + between(25, 35, r)), headline: 'That calms delta down.', why: 'More IV spreads gamma out at the money.' },
  ]
  const ch = movesChallenge('gamma_most', 'gamma', start, moves, 'gamma', 'max', 1.5, {
    title: 'The jumpiest delta',
    question: `Which move makes this ${optName(start)}'s delta jump most on the next $1?`,
    detail: `Each tile moves one slider. Gamma is how much delta changes per $1; now it is ${fmtGamma(measureOf('gamma', start))}.`,
    lesson: 'Gamma is biggest at the money near expiry. That is where delta swings fastest.',
    source: SRC.gamma,
  })
  if (!ch) return null
  return withTiles(ch, r, (m) => `gamma ${fmtGamma(m.value)}`)
}

/** The tiles of a moves challenge in a seeded order, each with the result it gets. */
function withTiles(ch, r, resultText) {
  const order = shuffled(ch.moves, r)
  const choices = order.map((m) => ({ label: m.label, right: !!m.right, mistake: m.right ? 'right' : 'move', headline: m.headline, why: m.why, result: resultText(m), after: m.after, value: m.value }))
  return finishPick(ch, choices)
}

function finishPick(ch, choices) {
  const labels = choices.map((c) => c.label)
  if (new Set(labels).size !== labels.length) return null
  const right = choices.find((c) => c.right)
  return { ...ch, choices, labels, answer: right.label }
}

function dealLever(r) {
  const type = typeOf(r, 0.4)
  const K = pickOf(STRIKES, r)
  const S = snapTo('S', K, K * (1 + (r() - 0.5) * 0.1))
  const short = r() < 0.45
  const days = short ? between(1, 14, r) : between(30, 110, r)
  const iv = short ? between(15, 60, r) : between(10, 110, r)
  const start = { type, K, S, days, iv }
  const p0 = greeksOf(start).price
  const viaDays = rnd(greeksOf({ ...start, days: days + 10 }).price - p0, 2)
  const viaIv = rnd(greeksOf({ ...start, iv: iv + 10 }).price - p0, 2)
  if (!(viaDays > 0) || !(viaIv > 0) || Math.max(viaDays, viaIv) < 0.05) return null
  const ivWins = viaIv > viaDays
  if (Math.max(viaDays, viaIv) < Math.min(viaDays, viaIv) * 1.3) return null
  // the lesson's words hold for the deal: time wins only close to expiry, IV only with real time left
  if (ivWins ? days < 30 : days > 21) return null
  const aDays = { ...start, days: days + 10 }, aIv = { ...start, iv: iv + 10 }
  const choices = [
    { label: '10 more days', right: !ivWins, mistake: ivWins ? 'move' : 'right', headline: ivWins ? 'IV moved it more.' : 'Right.', why: `10 more days added ${signed(viaDays)} a share.`, result: `${signed(viaDays)} a share`, after: aDays, value: viaDays },
    { label: '10 points of IV', right: ivWins, mistake: ivWins ? 'right' : 'move', headline: ivWins ? 'Right.' : 'Time moved it more.', why: `10 points of IV added ${signed(viaIv)} a share.`, result: `${signed(viaIv)} a share`, after: aIv, value: viaIv },
  ]
  return finishPick({
    kind: 'lever', station: 'lever', mode: 'pick', start, measure: 'price', before: rnd(p0, 2), after: ivWins ? aIv : aDays,
    title: 'Time or IV',
    question: `Which raises this ${optName(start)}'s price more: 10 more days or 10 points of IV?`,
    detail: `It has ${fmtDays(days)} left at ${iv}% IV. Theta and vega are live.`,
    lesson: ivWins
      ? 'IV lifts calls and puts alike. With time left, 10 points of IV can outweigh 10 more days.'
      : 'Close to expiry, time is precious. Here 10 more days outweighed 10 points of IV.',
    note: `10 more days: ${signed(viaDays)} a share. 10 points of IV: ${signed(viaIv)} a share.`,
    source: SRC.lever,
  }, choices)
}

function dealIvMove(r) {
  const up = r() < 0.5
  const type = up ? typeOf(r, 0.3) : typeOf(r, 0.7)
  const K = pickOf(STRIKES, r)
  const S = snapTo('S', K, K * (1 + (r() - 0.5) * 0.1))
  const days = between(10, 45, r)
  const iv = up ? between(20, 40, r) : between(60, 100, r)
  const to = up ? iv + between(15, 30, r) : Math.max(15, iv - between(25, 45, r))
  const start = { type, K, S, days, iv }
  const after = { ...start, iv: to }
  const p0 = shown(start).price, p1 = shown(after).price
  const change = rnd(p1 - p0, 2)
  if (Math.abs(change) < 0.1 || (change > 0) !== up) return null
  const lift = up ? `Rising IV lifts ${type}s too.` : `Falling IV cuts ${type}s too.`
  const choices = [
    { label: 'It gains value', right: up, mistake: up ? 'right' : 'sign', headline: up ? 'Right.' : lift, why: up ? '' : 'Falling IV takes value from calls and puts alike.' },
    { label: 'It loses value', right: !up, mistake: up ? 'sign' : 'right', headline: up ? lift : 'Right.', why: up ? 'Rising IV adds value to calls and puts alike.' : '' },
    { label: 'No change', right: false, mistake: 'still', headline: 'The stock sat still. IV did not.', why: 'The price moves with IV even when the stock is flat.' },
  ].map((c) => ({ ...c, result: c.right ? `${money(p0)} → ${money(p1)}` : '' }))
  return finishPick({
    kind: 'iv_move', station: 'vega', mode: 'pick', start, measure: 'price', before: p0, after,
    title: up ? `IV up, the ${type}` : 'The IV crush',
    question: up
      ? `IV jumps from ${iv}% to ${to}% ahead of earnings. ${TICKER} doesn't move. What does this ${optName(start)} do?`
      : `Earnings are out and IV falls from ${iv}% to ${to}%. ${TICKER} doesn't move. What does this ${optName(start)} do?`,
    detail: 'Same stock price, same days. Only IV changes.',
    lesson: up
      ? 'IV lifts calls and puts alike. More expected movement means a higher price either way.'
      : 'Falling IV takes value from calls and puts alike, even with the stock flat. That is the crush after a report.',
    note: `This ${type} went from ${money(p0)} to ${money(p1)}: ${signed(change)} a share, ${signed(change * SHARES)} a contract.`,
    source: SRC.vega,
  }, choices)
}

/** The dollar tiles: the right estimate and the named mistakes, each a different amount. */
function dollarTiles(r, list) {
  const amounts = list.map((c) => rnd(c.value, 2))
  if (new Set(amounts).size !== amounts.length || amounts.some((a) => a === 0)) return null
  return shuffled(list.map((c) => ({ ...c, right: !!c.right, label: signed(c.value) })), r)
}

function dealDeltaDollars(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES, r)
  const S = snapTo('S', K, K * (1 + (r() - 0.5) * 0.16))
  const days = between(20, 60, r), iv = between(25, 45, r)
  const start = { type, K, S, days, iv }
  // a whole-dollar move on the slider's grid, so delta (to 0.01) times the move is exact to the cent: $1 to $3 on the
  // 50-cent and $1 grids, $2 on the $2 grid, $5 (two steps) on the $2.50 grid
  const step = stockStep(K)
  const h = step <= 1 ? pickOf([1, 2, 3], r) : step === 2 ? 2 : 5
  const dir = r() < 0.5 ? 1 : -1
  const after = { ...start, S: rnd(S + dir * h, 2) }
  const { min, max } = sliderOf('S', K)
  if (after.S < min || after.S > max) return null
  const d = measureOf('delta', start)
  if (Math.abs(d) < 0.15 || Math.abs(d) > 0.85) return null
  const perShare = rnd(d * h * dir, 2)
  const est = rnd(d * h * dir * SHARES, 2)
  if (rnd(perShare * SHARES, 2) !== est) return null
  const raw = (greeksOf(after).price - greeksOf(start).price) * SHARES
  const full = rnd(raw, 2)
  const gap = rnd(full - est, 2)
  // what the curve added past the straight line on the unrounded delta: a long option's gamma, always in your favour
  const bend = raw - greeksOf(start).delta * h * dir * SHARES
  // the note says gamma made the gap only when it did; a gap that is mostly delta's rounding to 0.01 is redrawn
  const bent = gap >= 1 && bend >= 1
  if (gap <= -1 || (gap >= 1 && !bent)) return null
  const moved = dir > 0 ? 'rises' : 'falls'
  const goes = est > 0 ? 'gains' : 'loses'
  const choices = dollarTiles(r, [
    { value: est, right: true, mistake: 'right', headline: 'Right.', why: '' },
    { value: est / SHARES, mistake: 'x100', headline: 'Forgot the x100.', why: `That is one share. One contract is 100 shares: ${signed(perShare)} x 100 = ${signed(est)}.` },
    { value: Math.sign(est) * h * SHARES, mistake: 'stock', headline: 'That is the stock\'s own move.', why: `That moves dollar for dollar with ${TICKER}. This ${type} moves ${fmtDelta(Math.abs(d))} per $1.` },
    { value: -est, mistake: 'sign', headline: 'Wrong sign.', why: `A ${type} ${goes === 'gains' ? 'gains' : 'loses'} when ${TICKER} ${moved}: its delta is ${fmtDelta(d)}.` },
  ])
  if (!choices) return null
  return finishPick({
    kind: 'delta_dollars', station: 'delta', mode: 'pick', start, measure: 'price', before: shown(start).price, after,
    title: 'Delta in dollars',
    question: `This ${optName(start)}'s delta is ${fmtDelta(d)}. ${TICKER} ${moved} ${fmtStock(h)}. By delta, what does one contract make or lose?`,
    detail: 'One contract is 100 shares. Delta is the move per $1 of the stock.',
    lesson: 'Delta is the option\'s move per $1 in the stock. Times 100, it is the shares one contract acts like.',
    working: [`Delta ${fmtDelta(d)} x ${fmtStock(h)} ${dir > 0 ? 'up' : 'down'} = ${signed(perShare)} a share.`, `One contract is 100 shares: ${signed(perShare)} x 100 = ${signed(est)}.`],
    note: bent
      ? `Delta said ${signed(est)}. The full reprice is ${signed(full)}: gamma bends the price your way as ${TICKER} moves.`
      : `Delta said ${signed(est)}. The full reprice is ${signed(full)}: for a small move, delta is close.`,
    source: SRC.delta,
    est,
    full,
  }, choices)
}

function dealVegaDollars(r) {
  const type = typeOf(r)
  const K = pickOf(STRIKES, r)
  const S = snapTo('S', K, K * (1 + (r() - 0.5) * 0.12))
  const days = between(20, 90, r), iv = between(45, 90, r)
  const pts = pickOf([10, 15, 20], r)
  const start = { type, K, S, days, iv }
  const after = { ...start, iv: iv - pts }
  const v = measureOf('vega', start)
  if (v < 0.05) return null
  const est = rnd(-v * pts, 2)
  const full = rnd(greeksOf(after).price - greeksOf(start).price, 2)
  if (Math.abs(full - est) > Math.abs(est) * 0.15) return null      // the note says the estimate lands close
  const choices = dollarTiles(r, [
    { value: est, right: true, mistake: 'right', headline: 'Right.', why: '' },
    { value: -est, mistake: 'sign', headline: 'Wrong way.', why: 'Falling IV takes value from calls and puts alike.' },
    { value: -v, mistake: 'point', headline: 'That is one point.', why: `That is one point of IV. ${pts} points: ${money(v)} x ${pts} = ${money(Math.abs(est))}.` },
    { value: est * SHARES, mistake: 'x100', headline: 'That is a contract.', why: `That is one contract. The question asks a share: ${signed(est)}.` },
  ])
  if (!choices) return null
  return finishPick({
    kind: 'vega_dollars', station: 'vega', mode: 'pick', start, measure: 'price', before: shown(start).price, after,
    title: 'Vega in dollars',
    question: `This ${optName(start)}'s vega is ${money(v)}. IV falls ${pts} points. By vega, how much does its price move a share?`,
    detail: `Vega is the price change for 1 point of IV. ${TICKER} stays where it is.`,
    lesson: 'Vega is what one point of IV is worth. Multiply it by the points IV moved.',
    working: [`Vega ${money(v)} x ${pts} points of IV, falling = ${signed(est)} a share.`],
    note: `Vega said ${signed(est)}. The full reprice is ${signed(full)}: vega is the quick estimate, and it lands close.`,
    source: SRC.vega,
    est,
    full,
  }, choices)
}

const DEALERS = {
  delta_atm: dealDeltaAtm, delta_wing: dealDeltaWing, delta_dollars: dealDeltaDollars,
  theta_day: dealThetaDay, theta_most: dealThetaMost,
  iv_move: dealIvMove, vega_dollars: dealVegaDollars,
  gamma_peak: dealGammaPeak, gamma_most: dealGammaMost,
  lever: dealLever,
}
export const KINDS = Object.keys(DEALERS)

/** One challenge of a kind from the generator: redrawn until it is fair (a zone to land in, an answer clear of the
 *  rest by a margin). Deterministic for the same generator state. */
export function deal(kind, r, id = '') {
  const fn = DEALERS[kind]
  if (!fn) throw new Error(`unknown kind ${kind}`)
  for (let tries = 0; tries < 400; tries++) {
    const ch = fn(r)
    if (ch) return { ...ch, id: id || `${kind}-${tries}` }
  }
  throw new Error(`no ${kind} challenge for this seed`)
}

/** A run: one challenge per station in the course's order, two or three of them set on a slider. The same seed, the
 *  same run. */
export function buildRun(seed, n = GREEKS_TOTAL) {
  const r = rng(seed)
  const kinds = STATIONS.map((st) => pickOf(st.kinds, r))
  // at least two of the five are put on a slider: a seeded one of the delta, theta and gamma stations flips to its own
  while (kinds.filter((k) => SET_KINDS.includes(k)).length < 2) {
    const open = [0, 1, 3].filter((i) => !SET_KINDS.includes(kinds[i]))
    const i = pickOf(open, r)
    kinds[i] = pickOf(STATIONS[i].kinds.filter((k) => SET_KINDS.includes(k)), r)
  }
  return kinds.slice(0, n).map((k, i) => deal(k, r, `greeks-${seed}-${i}`))
}

/* ── scoring and the review ───────────────────────────────────────────────────────────────────────────────────── */

/** A set challenge scored on the lab's state: { ok, value } with the measure as shown. */
export function scoreSet(ch, st) {
  return { ok: passes(ch.check, st), value: measureOf(ch.measure, st) }
}

/** The zone in words, both ways: the measure ("0.45 to 0.55", "gamma 0.094 or more") and where on the slider. */
export function zoneText(ch) {
  const c = ch.check
  const m = c.atLeast != null ? `gamma ${fmtGamma(c.atLeast)} or more` : `${MEASURE_NAME[ch.measure]} ${measureText(ch.measure, c.target - c.tol)} to ${measureText(ch.measure, c.target + c.tol)}`
  return { measure: m, slider: rangeText(ch.live, ch.zone.lo, ch.zone.hi) }
}

/** What a set challenge's verdict says of the member's state. */
export function setLine(ch, st) {
  const v = measureOf(ch.measure, st)
  const where = sliderText(ch.live, st[ch.live])
  if (ch.measure === 'decay') return `At ${where} it loses ${money(v)} a day.`
  return `At ${TICKER} ${where}, ${ch.measure} is ${measureText(ch.measure, v)}.`
}

/** The before and after the review shows: the slider that moved and the number that matters, each as words. */
export function rowsOf(ch, from, to) {
  const rows = []
  const keys = ['S', 'days', 'iv'].filter((k) => from[k] !== to[k])
  for (const k of keys) rows.push({ key: k, label: SLIDER_SHORT[k], before: sliderText(k, from[k]), after: sliderText(k, to[k]) })
  const m = ch.measure === 'price' ? 'price' : ch.measure
  const label = m === 'decay' ? 'A day costs' : m === 'price' ? 'Price a share' : m === 'delta' ? 'Delta' : m === 'gamma' ? 'Gamma' : 'Vega'
  rows.push({ key: m, label, before: measureText(m, measureOf(m, from)), after: measureText(m, measureOf(m, to)), main: true })
  return rows
}

/** The verdict of a run, by the share right. */
export function verdictOf(right, total) {
  if (total > 0 && right === total) return 'Lab legend'
  const r = total ? right / total : 0
  if (r >= 0.8) return 'Sharp on the Greeks'
  if (r >= 0.6) return 'Getting the feel'
  if (r >= 0.4) return 'Halfway there'
  return 'Back to the bench'
}

/** The run's id for POST /api/study/game-runs (1 to 64 characters; a resend grants nothing). */
export const runIdOf = (seed) => `greeks-${seed}`.slice(0, 64)
