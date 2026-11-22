// OPTIONS PAYOFF (docs/study/GAMES.md §3, kind 'payoff'): the pure side of the game. Six positions a run, one of each
// kind: a long call, a long put, a cash-secured put, a covered call (100 shares and one short call), a bull call debit
// spread and a bear call credit spread. The stock's price on expiry day is given; the member picks the position's profit
// or loss from four tiles built on two of the three classic slips (forgot the x100, left out the premium, the sign
// flipped), a pair seeded per position: the right amount, each slip alone, and both slips together. The set is closed
// under its two slips (every tile has the same partners), so the pattern of the four amounts never points at the answer:
// only the math does. Every number the game shows or scores comes from here, from a seed (the component seeds once at
// start; nothing here reads the clock or Math.random).
//
// The rules it teaches (the course, docs/study/UNITS-foundations.md):
//   F6.01  one contract is 100 shares
//   F6.02  the premium: what a buyer pays, what a seller collects
//   F6.03  at expiry an option is worth only its intrinsic value: a call max(S − K, 0), a put max(K − S, 0)
//   F6.11  long calls and puts: the most you can lose is the premium; breakeven is the strike plus (call) or minus
//          (put) the premium
//   F6.12  verticals: a debit spread risks the debit and makes at most the width less it; a credit spread keeps the
//          credit and risks at most the width less it
//   F6.13  covered calls and cash-secured puts: the call caps the gain at the strike; the put's premium is yours, and
//          below the strike you own the fall
// Profit or loss at expiry, one contract: (intrinsic value at expiry − premium paid, or + premium collected) x 100.
//
// All prices are whole cents, so the math is exact. One contract is 100 shares, so the position's P/L in dollars is the
// per-share P/L in cents (cents x 100 shares / 100 cents a dollar). The stock is a practice stock with NO ticker (as in
// Order Ticket: a game never invents a market fact; "XYZ", the textbooks' placeholder, has been a real NYSE listing since
// January 2025). Strikes sit on a listed-style grid ($1 under $60, $5 to $200, $10 above), premiums are priced by
// Black-Scholes (no rates, no dividends) for 21 to 45 days and 28% to 48% implied volatility, rounded to the nickel.
// Fees are left out.

export const PAYOFF_KIND = 'payoff'
export const PAYOFF_TOTAL = 6
export const PAYOFF_HEARTS = 3
export const PAYOFF_BEST_KEY = 'study.payoff.best'
export const SHARES = 100
/** What the copy calls the practice stock (no ticker: see above). */
export const STOCK = 'the stock'
export const MINUS = '−'
export const KINDS = ['long_call', 'long_put', 'short_put', 'covered_call', 'bull_call_debit', 'bear_call_credit']
/** The three slips a wrong tile makes: the per-share answer (forgot the x100), the options part without the premium
 *  (left out what was paid or collected), the sign flipped. */
export const SLIPS = ['x100', 'premium', 'sign']
/** The pairs of slips a position's four tiles are built on: the right amount, slip A, slip B, and A and B together. */
export const PAIRS = [['x100', 'sign'], ['x100', 'premium'], ['premium', 'sign']]
export const PAIR_KEYS = PAIRS.map(([a, b]) => `${a}_${b}`)
/** Every tile a position can show: the right amount, each slip alone, and each pair of slips together. */
export const MISTAKES = ['right', ...SLIPS, ...PAIR_KEYS]

const U11 = { unit: 'F6.11', unitName: 'Long calls and long puts' }
const U12 = { unit: 'F6.12', unitName: 'Debit and credit verticals' }
const U13 = { unit: 'F6.13', unitName: 'Covered calls and cash-secured puts' }
/** buyer: the premium is paid (a debit); a seller collects it (a credit). */
export const KIND_INFO = {
  long_call: { title: 'Long call', buyer: true, spread: false, ...U11 },
  long_put: { title: 'Long put', buyer: true, spread: false, ...U11 },
  short_put: { title: 'Cash-secured put', buyer: false, spread: false, ...U13 },
  covered_call: { title: 'Covered call', buyer: false, spread: false, ...U13 },
  bull_call_debit: { title: 'Bull call spread', buyer: true, spread: true, ...U12 },
  bear_call_credit: { title: 'Bear call spread', buyer: false, spread: true, ...U12 },
}

/* ── the seed ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A small seeded generator (Park-Miller, the one challengeBank.shuffle uses): the same seed, the same run. */
export function rng(seed) {
  let s = Math.abs(Math.floor(Number(seed) || 0)) % 2147483647 || 1
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

/** A seed scrambled (the murmur3 finish), so a position's own generator never runs in step with the run's generator it
 *  was drawn from: Park-Miller seeded with a state of itself replays its own next draws, which would tie the pair of slips
 *  and the tiles' order to the zone the expiry price came from. */
export function mixSeed(seed) {
  let h = (Math.abs(Math.floor(Number(seed) || 0)) ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export function shuffled(list, r) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const pickOf = (list, r) => list[Math.floor(r() * list.length)]

/* ── the words for numbers ────────────────────────────────────────────────────────────────────────────────────── */

const commas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const pad2 = (n) => String(n).padStart(2, '0')

/** A price in cents, always to the cent: 5430 → "$54.30". */
export function price(cents) {
  const c = Math.round(cents)
  const a = Math.abs(c)
  return `${c < 0 ? MINUS : ''}$${commas(Math.floor(a / 100))}.${pad2(a % 100)}`
}

/** A strike or a price in a sum, no dollar sign: 5000 → "50", 5430 → "54.30". */
export function bare(cents) {
  const c = Math.round(cents)
  return c % 100 === 0 ? String(c / 100) : `${Math.floor(c / 100)}.${pad2(c % 100)}`
}

/** Whole dollars: 4500 → "$4,500". */
export function dollars(d) {
  const c = Math.round(d * 100)
  const a = Math.abs(c)
  const body = a % 100 === 0 ? commas(a / 100) : `${commas(Math.floor(a / 100))}.${pad2(a % 100)}`
  return `${c < 0 ? MINUS : ''}$${body}`
}

/** A profit or loss in dollars, signed: +$220, −$85, +$2.20, $0. Whole dollars show no cents. */
export function fmtPL(d) {
  const c = Math.round(d * 100)
  if (c === 0) return '$0'
  return `${c > 0 ? '+' : ''}${dollars(d)}`
}

/** A per-share amount in cents, signed and to the cent: 220 → "+$2.20", −85 → "−$0.85". */
export function perShare(cents) {
  const c = Math.round(cents)
  return c === 0 ? '$0.00' : `${c > 0 ? '+' : ''}${price(c)}`
}

/* ── the option math ──────────────────────────────────────────────────────────────────────────────────────────── */

/** The standard normal CDF (Abramowitz and Stegun 7.1.26 on erf; error under 1.5e-7). */
export function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Black-Scholes with no rates and no dividends, in dollars. At or past expiry, the intrinsic value. */
export function bsPrice(type, S, K, T, iv) {
  if (!(T > 0) || !(iv > 0)) return Math.max(0, type === 'call' ? S - K : K - S)
  const v = iv * Math.sqrt(T)
  const d1 = (Math.log(S / K) + (v * v) / 2) / v
  const d2 = d1 - v
  return type === 'call' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1)
}

/** A quote in cents: the model price rounded to the nickel, never under $0.05. */
export function quote(type, stockCents, strikeCents, T, iv) {
  const p = bsPrice(type, stockCents / 100, strikeCents / 100, T, iv)
  return Math.max(5, Math.round(p * 20) * 5)
}

/** F6.03: what an option is worth on expiry day, per share, in cents. */
export const callValue = (S, K) => Math.max(0, S - K)
export const putValue = (S, K) => Math.max(0, K - S)

/** The options part of the position at expiry, per share in cents: what you own (a buyer) or owe (a seller). */
export function optionValueAt(pos, S) {
  switch (pos.kind) {
    case 'long_call': case 'covered_call': return callValue(S, pos.strike)
    case 'long_put': case 'short_put': return putValue(S, pos.strike)
    case 'bull_call_debit': case 'bear_call_credit': return callValue(S, pos.low) - callValue(S, pos.high)
    default: throw new Error(`unknown kind ${pos.kind}`)
  }
}

/** Profit or loss at expiry per share, in cents. */
export function perShareAt(pos, S) {
  const v = optionValueAt(pos, S)
  switch (pos.kind) {
    case 'long_call': case 'long_put': case 'bull_call_debit': return v - pos.premium
    case 'short_put': case 'bear_call_credit': return pos.premium - v
    case 'covered_call': return (S - pos.basis) + pos.premium - v
    default: throw new Error(`unknown kind ${pos.kind}`)
  }
}

/** F6.01: profit or loss at expiry for the position (one contract, 100 shares), in dollars. */
export function plAt(pos, S) {
  return (perShareAt(pos, S) * SHARES) / 100
}

/** Where the position breaks even at expiry, in cents. */
export function breakevenOf(pos) {
  switch (pos.kind) {
    case 'long_call': return pos.strike + pos.premium
    case 'long_put': case 'short_put': return pos.strike - pos.premium
    case 'covered_call': return pos.basis - pos.premium
    case 'bull_call_debit': case 'bear_call_credit': return pos.low + pos.premium
    default: throw new Error(`unknown kind ${pos.kind}`)
  }
}

/** The most the position can make and lose at expiry, in dollars (null: no limit). */
export function extremesOf(pos) {
  const d = (c) => (c * SHARES) / 100
  switch (pos.kind) {
    case 'long_call': return { maxGain: null, maxLoss: d(pos.premium) }
    case 'long_put': return { maxGain: d(pos.strike - pos.premium), maxLoss: d(pos.premium) }
    case 'short_put': return { maxGain: d(pos.premium), maxLoss: d(pos.strike - pos.premium) }
    case 'covered_call': return { maxGain: d(pos.strike - pos.basis + pos.premium), maxLoss: d(pos.basis - pos.premium) }
    case 'bull_call_debit': return { maxGain: d(pos.high - pos.low - pos.premium), maxLoss: d(pos.premium) }
    case 'bear_call_credit': return { maxGain: d(pos.premium), maxLoss: d(pos.high - pos.low - pos.premium) }
    default: throw new Error(`unknown kind ${pos.kind}`)
  }
}

/** The position's per share P/L without the premium, in cents: what the options part (and, in a covered call, the shares)
 *  came to on expiry day. A buyer's P/L is this less what was paid; a seller's is this plus what was collected. */
export function partAt(pos, S = pos.expiry) {
  return perShareAt(pos, S) + (KIND_INFO[pos.kind].buyer ? pos.premium : -pos.premium)
}

const neg = (x) => (x === 0 ? 0 : -x)   // never a negative zero

/** Every tile's amount in dollars: the right one; each slip alone (the per-share answer, forgot the x100; the options
 *  part alone, a buyer forgot to subtract what was paid or a seller to add what was collected; the sign flipped); and
 *  each pair of slips together. */
export function tileValues(pos, S = pos.expiry) {
  const ps = perShareAt(pos, S)
  const part = partAt(pos, S)
  const right = (ps * SHARES) / 100
  const premium = (part * SHARES) / 100
  return {
    right, x100: ps / 100, premium, sign: neg(right),
    x100_sign: neg(ps / 100), x100_premium: part / 100, premium_sign: neg(premium),
  }
}

/** The tiles a pair of slips makes: the right amount, each slip alone, both together. */
export const tilesOf = (pair) => {
  const [a, b] = PAIRS[PAIR_KEYS.indexOf(pair)]
  return ['right', a, b, pair]
}

/** The tiles name four different amounts (to the cent) and none is $0 (a breakeven would make the sign flipped the same
 *  as the answer; an option worth nothing would make the premium slip $0). */
export function tilesDiffer(values, keys) {
  const cents = keys.map((m) => Math.round(values[m] * 100))
  return cents.every((c) => c !== 0) && new Set(cents).size === cents.length
}

/** The pair a position's tiles are built on: the seeded pair first, then the other two in turn, and the first whose four
 *  amounts all differ and none is $0. Null when none does (the position is then not dealt). */
export function pickPair(values, first = 0) {
  for (let k = 0; k < PAIR_KEYS.length; k++) {
    const pair = PAIR_KEYS[(first + k) % PAIR_KEYS.length]
    if (tilesDiffer(values, tilesOf(pair))) return pair
  }
  return null
}

/* ── the words of a position ──────────────────────────────────────────────────────────────────────────────────── */

const strikeName = (K, type) => `${bare(K)} ${type}`

function sentenceOf(p) {
  switch (p.kind) {
    case 'long_call': return `You bought one ${strikeName(p.strike, 'call')} for ${price(p.premium)}.`
    case 'long_put': return `You bought one ${strikeName(p.strike, 'put')} for ${price(p.premium)}.`
    case 'short_put': return `You sold one ${strikeName(p.strike, 'put')} for ${price(p.premium)}, cash-secured.`
    case 'covered_call': return `You own 100 shares at ${price(p.basis)} and sold one ${strikeName(p.strike, 'call')} against them for ${price(p.premium)}.`
    case 'bull_call_debit': return `You bought the ${bare(p.low)}/${bare(p.high)} call spread for ${price(p.premium)}.`
    case 'bear_call_credit': return `You sold the ${bare(p.low)}/${bare(p.high)} call spread for ${price(p.premium)}.`
    default: return ''
  }
}

function legsOf(p) {
  const [a, b] = p.legPrices || []
  switch (p.kind) {
    case 'long_call': return [{ side: 'Buy', what: `1 ${strikeName(p.strike, 'call')}`, at: price(p.premium) }]
    case 'long_put': return [{ side: 'Buy', what: `1 ${strikeName(p.strike, 'put')}`, at: price(p.premium) }]
    case 'short_put': return [{ side: 'Sell', what: `1 ${strikeName(p.strike, 'put')}`, at: price(p.premium) }]
    case 'covered_call': return [{ side: 'Own', what: '100 shares', at: price(p.basis) }, { side: 'Sell', what: `1 ${strikeName(p.strike, 'call')}`, at: price(p.premium) }]
    case 'bull_call_debit': return [{ side: 'Buy', what: `1 ${strikeName(p.low, 'call')}`, at: price(a ?? p.premium) }, { side: 'Sell', what: `1 ${strikeName(p.high, 'call')}`, at: b != null ? price(b) : '' }]
    case 'bear_call_credit': return [{ side: 'Sell', what: `1 ${strikeName(p.low, 'call')}`, at: price(a ?? p.premium) }, { side: 'Buy', what: `1 ${strikeName(p.high, 'call')}`, at: b != null ? price(b) : '' }]
    default: return []
  }
}

function netOf(p) {
  return KIND_INFO[p.kind].buyer ? `${price(p.premium)} paid` : `${price(p.premium)} collected`
}

function noteOf(p) {
  if (p.kind === 'short_put') return `You set aside ${dollars((p.strike * SHARES) / 100)} to buy 100 shares at ${price(p.strike)} if you are assigned.`
  return null
}

function detailOf(p) {
  if (p.kind === 'covered_call') return 'The shares and the call together, held to expiry. Fees left out.'
  if (KIND_INFO[p.kind].spread) return 'Both legs together, held to expiry. Fees left out.'
  return 'Held to expiry. Fees left out.'
}

/** The premium step of the working, written the way it adds up: a buyer takes what was paid off the option's value
 *  ("$4.30 − $2.10"); a seller adds what was collected to what is owed ("−$2.20 + $1.35"). */
function premiumStep(p, v, ps) {
  if (KIND_INFO[p.kind].buyer) {
    return `Less the ${price(p.premium)} you paid: ${price(v)} ${MINUS} ${price(p.premium)} = ${perShare(ps)} a share.`
  }
  return v > 0
    ? `Add the ${price(p.premium)} you collected: ${MINUS}${price(v)} + ${price(p.premium)} = ${perShare(ps)} a share.`
    : `You keep the ${price(p.premium)} you collected: ${perShare(ps)} a share.`
}

/** The working on a miss, step by step: the intrinsic value at expiry, minus or plus the premium, times 100. */
export function workingOf(p) {
  const S = p.expiry
  const v = optionValueAt(p, S)
  const ps = perShareAt(p, S)
  const times = `One contract is 100 shares: ${perShare(ps)} x 100 = ${fmtPL(plAt(p, S))}.`
  const atS = `At ${price(S)}`
  switch (p.kind) {
    case 'long_call': case 'long_put': {
      const type = p.kind === 'long_call' ? 'call' : 'put'
      const name = strikeName(p.strike, type)
      const sum = type === 'call' ? `${bare(S)} ${MINUS} ${bare(p.strike)}` : `${bare(p.strike)} ${MINUS} ${bare(S)}`
      const first = v > 0 ? `${atS} the ${name} is worth ${price(v)} (${sum}).`
        : S === p.strike ? `${atS}, right on the strike, the ${name} is worth $0.00.`
          : `${atS} the ${name} expires worthless: $0.00.`
      return [first, premiumStep(p, v, ps), times]
    }
    case 'short_put': {
      const name = strikeName(p.strike, 'put')
      const first = v > 0 ? `${atS} the ${name} you sold is worth ${price(v)} (${bare(p.strike)} ${MINUS} ${bare(S)}). You owe that.`
        : S === p.strike ? `${atS}, right on the strike, the ${name} you sold is worth $0.00. You owe nothing.`
          : `${atS} the ${name} you sold expires worthless. You owe nothing.`
      const steps = [first, premiumStep(p, v, ps), times]
      if (v > 0) steps.splice(1, 0, `Assigned, you pay ${price(p.strike)} for shares worth ${price(S)}: the same ${price(v)} a share.`)
      return steps
    }
    case 'covered_call': {
      const shares = S - p.basis
      const name = strikeName(p.strike, 'call')
      const second = v > 0 ? `The ${name} you sold is worth ${price(v)} (${bare(S)} ${MINUS} ${bare(p.strike)}). You owe that.`
        : S === p.strike ? `The ${name} you sold is worth $0.00, right on the strike.`
          : `The ${name} you sold expires worthless.`
      const owe = v > 0 ? ` ${MINUS} ${price(v)}` : ''
      const steps = [
        `The shares: ${price(S)} ${MINUS} ${price(p.basis)} = ${perShare(shares)} a share.`,
        second,
        `Add the ${price(p.premium)} you collected: ${perShare(shares)}${owe} + ${price(p.premium)} = ${perShare(ps)} a share.`,
        times,
      ]
      // F6.13, "assignment is the plan": called away, the shares go at the strike, so the gain stops there
      if (v > 0) steps.splice(2, 0, `Assigned, you sell your shares at ${price(p.strike)} when they are worth ${price(S)}: the same ${price(v)} a share.`)
      return steps
    }
    case 'bull_call_debit': case 'bear_call_credit': {
      const sold = p.kind === 'bear_call_credit'
      const width = p.high - p.low
      const first = S <= p.low
        ? `${atS}${S === p.low ? ', right on the lower strike,' : ''} both calls expire worthless. ${sold ? 'You owe nothing.' : 'The spread is worth $0.00.'}`
        : S < p.high
          ? `${atS} the ${strikeName(p.low, 'call')}${sold ? ' you sold' : ''} is worth ${price(v)} (${bare(S)} ${MINUS} ${bare(p.low)}) and the ${strikeName(p.high, 'call')} nothing. ${sold ? `You owe ${price(v)}.` : `The spread is worth ${price(v)}.`}`
          : `${atS} the spread is worth its full width, ${price(width)} (${bare(p.high)} ${MINUS} ${bare(p.low)}).${sold ? ` You owe ${price(width)}.` : ''}`
      return [first, premiumStep(p, v, ps), times]
    }
    default: return []
  }
}

/** The rule the position teaches, with its own numbers, and the course unit it comes from. */
export function ruleOf(p) {
  const { maxGain, maxLoss } = extremesOf(p)
  const be = price(breakevenOf(p))
  switch (p.kind) {
    case 'long_call': return `A long call can lose only what you paid, ${dollars(maxLoss)}. It makes money above the strike plus the premium: ${be}.`
    case 'long_put': return `A long put can lose only what you paid, ${dollars(maxLoss)}. It makes money below the strike minus the premium: ${be}.`
    // one contract: under the breakeven every dollar the stock falls costs 100 dollars (the put's 100 shares)
    case 'short_put': return `A cash-secured put pays you ${dollars(maxGain)} up front. Under ${be}, the strike minus the premium, it loses $100 for every dollar ${STOCK} falls.`
    case 'covered_call': return `The call caps the trade at the strike: the most it can make is ${dollars(maxGain)}. The premium lowers your breakeven to ${be}.`
    case 'bull_call_debit': return `A debit spread risks what you paid, ${dollars(maxLoss)}. The most it makes is the width less that: ${dollars(maxGain + maxLoss)} ${MINUS} ${dollars(maxLoss)} = ${dollars(maxGain)}.`
    case 'bear_call_credit': return `A credit spread keeps what you collected, ${dollars(maxGain)}, if ${STOCK} ends at or under ${price(p.low)}. The most it loses is the width less that: ${dollars(maxGain + maxLoss)} ${MINUS} ${dollars(maxGain)} = ${dollars(maxLoss)}.`
    default: return ''
  }
}

/** The line that names the mistake a wrong tile makes, with its numbers. A tile with two slips names both and works
 *  back to the answer from the amount the member picked. */
export function mistakeLine(p, mistake) {
  const ps = perShareAt(p, p.expiry)
  const pl = plAt(p, p.expiry)
  const part = partAt(p, p.expiry)
  const buyer = KIND_INFO[p.kind].buyer
  const did = pl > 0 ? 'made money' : 'lost money'
  const prem = price(p.premium)
  const what = buyer ? `the ${prem} you paid` : `the ${prem} you collected`
  const perContract = dollars((p.premium * SHARES) / 100)
  const op = buyer ? MINUS : '+'
  switch (mistake) {
    case 'x100': return `That is the answer for one share. One contract is 100 shares: ${perShare(ps)} x 100 = ${fmtPL(pl)}.`
    case 'premium': return buyer
      ? `That leaves out ${what}. A buyer starts ${prem} a share down.`
      : `That leaves out ${what}. The premium is yours whatever ${STOCK} does.`
    case 'sign': return `Right size, wrong sign. This one ${did}.`
    case 'x100_sign': return `That is one share, with the sign flipped. This one ${did}: ${perShare(ps)} x 100 = ${fmtPL(pl)}.`
    case 'x100_premium': return `That leaves out ${what}, and it is for one share. ${perShare(part)} ${op} ${prem} = ${perShare(ps)} a share, x 100 = ${fmtPL(pl)}.`
    case 'premium_sign': return `That leaves out ${what}, ${perContract} a contract, and flips the sign. ${fmtPL((part * SHARES) / 100)} ${op} ${perContract} = ${fmtPL(pl)}, so this one ${did}.`
    default: return ''
  }
}

/** The verdict's headline for a tile. */
export function headlineOf(p, mistake) {
  const left = KIND_INFO[p.kind].buyer ? 'left out what you paid' : 'left out what you collected'
  switch (mistake) {
    case 'right': return 'Priced it.'
    case 'x100': return 'Forgot the x100.'
    case 'premium': return `${left[0].toUpperCase()}${left.slice(1)}.`
    case 'sign': return 'Wrong sign.'
    case 'x100_sign': return 'Wrong sign, and forgot the x100.'
    case 'x100_premium': return `${left[0].toUpperCase()}${left.slice(1)}, and the x100.`
    case 'premium_sign': return `Wrong sign, and ${left}.`
    default: return 'Not this one.'
  }
}

/** The slip a wrong tile made, in a few words, for the run's log: "wrong sign, forgot the x100". Empty when right. */
export function slipOf(mistake) {
  const words = { x100: 'forgot the x100', premium: 'left out the premium', sign: 'wrong sign' }
  if (!mistake || mistake === 'right') return ''
  if (words[mistake]) return words[mistake]
  const [a, b] = mistake.split('_')
  // the sign first, then the premium, then the x100: "wrong sign, left out the premium"
  return [a, b].sort((x, y) => SLIPS.indexOf(y) - SLIPS.indexOf(x)).map((k) => words[k]).join(', ')
}

/** The position in a few words for the run log: "50 call", "50/55 calls", "45 put". */
export function shortName(p) {
  if (KIND_INFO[p.kind].spread) return `${bare(p.low)}/${bare(p.high)} calls`
  return strikeName(p.strike, p.kind === 'long_put' || p.kind === 'short_put' ? 'put' : 'call')
}

/**
 * One position, every number and every word the game shows for it, from its own inputs (all prices in cents):
 * `{ stock, dte, iv, premium, expiry }` and `strike` (single option, covered call; plus `basis` for the covered call) or
 * `low` and `high` (the spreads; `premium` is the net, `legPrices` the two legs). `order` seeds the pair of slips the
 * tiles are built on and the tiles' order; `pair` (one of PAIR_KEYS) names the pair to try first instead.
 */
export function position(kind, o) {
  const info = KIND_INFO[kind]
  if (!info) throw new Error(`unknown kind ${kind}`)
  const p = {
    kind, id: o.id || `${kind}-${o.expiry}`, title: info.title, unit: info.unit, unitName: info.unitName,
    buyer: info.buyer, spread: info.spread, stock: o.stock, dte: o.dte ?? 30, iv: o.iv ?? null, premium: o.premium,
    expiry: o.expiry, scenario: o.scenario || null,
    strike: info.spread ? null : o.strike, low: info.spread ? o.low : null, high: info.spread ? o.high : null,
    basis: kind === 'covered_call' ? (o.basis ?? o.stock) : null, legPrices: o.legPrices || null,
  }
  p.strikes = info.spread ? [p.low, p.high] : [p.strike]
  p.width = info.spread ? p.high - p.low : null
  p.breakeven = breakevenOf(p)
  p.value = optionValueAt(p, p.expiry)
  p.perShare = perShareAt(p, p.expiry)
  p.pl = plAt(p, p.expiry)
  Object.assign(p, extremesOf(p))
  p.values = tileValues(p)
  // the position's own seed picks the pair of slips to try first (always drawn, so the tiles' order is the same either way)
  const r = rng(mixSeed(o.order ?? 1))
  const drawn = Math.floor(r() * PAIR_KEYS.length)
  const first = PAIR_KEYS.includes(o.pair) ? PAIR_KEYS.indexOf(o.pair) : drawn
  const pair = pickPair(p.values, first)
  p.ok = pair != null
  p.firstPair = PAIR_KEYS[first]                 // the pair tried first; `pair` is the one dealt
  p.pair = pair ?? PAIR_KEYS[first]
  p.tiles = tilesOf(p.pair)
  const order = shuffled(p.tiles, r)
  p.choices = order.map((m) => ({ mistake: m, value: p.values[m], label: fmtPL(p.values[m]) }))
  p.labels = p.choices.map((c) => c.label)
  p.answer = fmtPL(p.pl)
  p.sentence = sentenceOf(p)
  p.legs = legsOf(p)
  p.net = netOf(p)
  p.note = noteOf(p)
  p.context = `Opened with ${p.dte} days to go, the stock at ${price(p.stock)}. Made-up prices, real math.`
  p.question = `The stock closes at ${price(p.expiry)} on expiry day. What is your profit or loss?`
  p.detail = detailOf(p)
  p.working = workingOf(p)
  p.rule = ruleOf(p)
  p.short = shortName(p)
  return p
}

/** The mistake a tile label stands for (one of MISTAKES: 'right', a slip, or two slips such as 'x100_sign'), or null. */
export function mistakeOf(p, label) {
  return p.choices.find((c) => c.label === label)?.mistake || null
}

/* ── the generator ────────────────────────────────────────────────────────────────────────────────────────────── */

/** Price levels for the practice stock, in dollars; each run jitters them by up to a dollar either way. */
export const LEVELS = [18, 23, 27, 32, 36, 41, 46, 52, 57, 63, 68, 74, 81, 88, 96, 104, 115, 128, 142, 156, 175, 190, 212, 236, 265]
export const DTES = [21, 30, 45]
export const IVS = [0.28, 0.34, 0.4, 0.48]

/** The listed strike grid: $1 apart under $60, $5 to $200, $10 above (in cents). */
export function strikeStep(stockCents) {
  return stockCents < 6000 ? 100 : stockCents < 20000 ? 500 : 1000
}

/** A spread's width: two or three strikes on the $1 grid (one or two under $30), one or two on the wider grids. */
function widthsFor(stockCents, step) {
  if (step === 100) return stockCents < 3000 ? [100, 200] : [200, 300, 500]
  return [step, 2 * step]
}

const nickel = (c) => Math.round(c / 5) * 5

/** The expiry-price zones a kind can land in, in cents, each [lo, hi] (a single price when lo = hi). Every zone sits
 *  on the nickel; a zone with lo over hi is left out. */
export function zonesFor(kind, o) {
  const S = o.stock, p = o.premium
  const f = (x) => nickel(S * x)
  let z = []
  switch (kind) {
    case 'long_call': {
      const K = o.strike, be = K + p
      z = [
        { key: 'win', lo: be + 5, hi: K + Math.max(3 * p, f(0.1)) },
        { key: 'short_of_breakeven', lo: K + 5, hi: be - 5 },
        { key: 'at_strike', lo: K, hi: K },
        { key: 'worthless', lo: K - Math.max(2 * p, f(0.08)), hi: K - 5 },
      ]
      break
    }
    case 'long_put': {
      const K = o.strike, be = K - p
      z = [
        { key: 'win', lo: K - Math.max(3 * p, f(0.1)), hi: be - 5 },
        { key: 'short_of_breakeven', lo: be + 5, hi: K - 5 },
        { key: 'at_strike', lo: K, hi: K },
        { key: 'worthless', lo: K + 5, hi: K + Math.max(2 * p, f(0.08)) },
      ]
      break
    }
    case 'short_put': {
      const K = o.strike, be = K - p
      z = [
        { key: 'keep', lo: K + 5, hi: K + f(0.08) },
        { key: 'at_strike', lo: K, hi: K },
        { key: 'partial', lo: be + 5, hi: K - 5 },
        { key: 'loss', lo: K - Math.max(3 * p, f(0.12)), hi: be - 5 },
      ]
      break
    }
    case 'covered_call': {
      const K = o.strike, B = o.basis, be = B - p
      z = [
        { key: 'called_away', lo: K + 5, hi: K + f(0.1) },
        { key: 'at_strike', lo: K, hi: K },
        { key: 'between', lo: B + 5, hi: K - 5 },
        { key: 'cushion', lo: be + 5, hi: B - 5 },
        { key: 'loss', lo: B - f(0.15), hi: be - 5 },
      ]
      break
    }
    case 'bull_call_debit': case 'bear_call_credit': {
      const K1 = o.low, K2 = o.high, be = K1 + p
      const up = kind === 'bull_call_debit'
      z = [
        { key: 'below', lo: K1 - f(0.08), hi: K1 - 5 },
        { key: 'at_lower', lo: K1, hi: K1 },
        { key: up ? 'between_loss' : 'between_win', lo: K1 + 5, hi: be - 5 },
        { key: up ? 'between_win' : 'between_loss', lo: be + 5, hi: K2 - 5 },
        { key: 'at_upper', lo: K2, hi: K2 },
        { key: 'above', lo: K2 + 5, hi: K2 + f(0.08) },
      ]
      break
    }
    default: throw new Error(`unknown kind ${kind}`)
  }
  return z.filter((x) => x.lo <= x.hi && x.lo > 0)
}

/** The strikes and premiums for one kind, or null when the draw is not a sensible trade (a premium under a dime, a
 *  spread priced at or over its width). */
function drawTrade(kind, r) {
  const level = pickOf(LEVELS, r)
  const stock = level * 100 + (Math.floor(r() * 41) - 20) * 5
  const dte = pickOf(DTES, r)
  const iv = pickOf(IVS, r)
  const T = dte / 365
  const step = strikeStep(stock)
  const j = r() < 0.6 ? 0 : 1          // near the money most of the time, one strike further out the rest
  const o = { stock, dte, iv }
  switch (kind) {
    case 'long_call': o.strike = Math.ceil(stock / step) * step + j * step; o.premium = quote('call', stock, o.strike, T, iv); break
    case 'long_put': o.strike = Math.floor(stock / step) * step - j * step; o.premium = quote('put', stock, o.strike, T, iv); break
    case 'short_put': o.strike = Math.floor(stock / step) * step - j * step; o.premium = quote('put', stock, o.strike, T, iv); break
    case 'covered_call': o.basis = stock; o.strike = (Math.floor(stock / step) + 1 + j) * step; o.premium = quote('call', stock, o.strike, T, iv); break
    case 'bull_call_debit': case 'bear_call_credit': {
      const w = pickOf(widthsFor(stock, step), r)
      o.low = kind === 'bull_call_debit' ? Math.round(stock / step) * step : (Math.floor(stock / step) + 1) * step
      o.high = o.low + w
      const a = quote('call', stock, o.low, T, iv), b = quote('call', stock, o.high, T, iv)
      o.legPrices = [a, b]
      o.premium = a - b
      if (o.premium < 10 || o.premium > w - 10) return null
      break
    }
    default: throw new Error(`unknown kind ${kind}`)
  }
  if (!(o.premium >= 10) || (o.strike != null && o.strike <= 0)) return null
  return o
}

/** How often each zone comes up, by kind (relative weights). The buyers (the long call and put, the debit spread) end in
 *  profit about a third of the time and the sellers (the cash-secured put, the covered call, the credit spread) about
 *  three times in four, close to how these trades go. The mix is also what keeps the tiles honest (OWNER_PRINCIPLES rule
 *  10): a buyer's option that expires worthless and a seller's kept premium both deal the x100 and sign tiles (left out,
 *  the premium would read $0), so they come up about as often as each other, and over all six kinds no guess from the
 *  four amounts alone (the loss, the smaller amount, the one with a 1/100 partner) beats about one in two. Measured over
 *  30,000 positions; the unit test holds the line. */
export const ZONE_WEIGHTS = {
  long_call: { win: 6, short_of_breakeven: 9, at_strike: 2, worthless: 2 },
  long_put: { win: 6, short_of_breakeven: 9, at_strike: 2, worthless: 2 },
  short_put: { keep: 3, at_strike: 1, partial: 14, loss: 7 },
  covered_call: { called_away: 3, at_strike: 2, between: 4, cushion: 5, loss: 5 },
  bull_call_debit: { below: 6, at_lower: 4, between_loss: 5, between_win: 2, at_upper: 3, above: 2 },
  bear_call_credit: { below: 7, at_lower: 3, between_win: 4, between_loss: 2, at_upper: 1, above: 2 },
}

/** The zone a draw u (0 to 1) lands in, by the kind's weights over the zones this trade has. */
export function zoneIndex(kind, zones, u) {
  const w = zones.map((z) => ZONE_WEIGHTS[kind]?.[z.key] ?? 1)
  let x = u * w.reduce((t, v) => t + v, 0)
  for (let k = 0; k < w.length; k++) { x -= w[k]; if (x < 0) return k }
  return w.length - 1
}

/** One position of a kind from the generator: a sensible trade, an expiry price in one of its zones, a closed set of
 *  four different tiles. Deterministic for the same generator state. */
export function makePosition(kind, r, id = '') {
  for (let tries = 0; tries < 60; tries++) {
    const o = drawTrade(kind, r)
    if (!o) continue
    const zones = zonesFor(kind, o)
    if (!zones.length) continue
    const order = 1 + Math.floor(r() * 2147483640)
    const z0 = zoneIndex(kind, zones, r())
    const at = r()
    for (let zi = 0; zi < zones.length; zi++) {
      const zone = zones[(z0 + zi) % zones.length]
      const count = (zone.hi - zone.lo) / 5 + 1
      const k0 = Math.floor(at * count)
      for (let k = 0; k < count; k++) {
        const expiry = zone.lo + ((k0 + k) % count) * 5
        const p = position(kind, { ...o, expiry, order, scenario: zone.key, id })
        if (p.ok) return p
      }
    }
  }
  throw new Error(`no ${kind} position for this seed`)
}

/** A run: one position of each kind in a seeded order. The same seed, the same run. */
export function buildRun(seed, n = PAYOFF_TOTAL) {
  const r = rng(seed)
  const order = shuffled(KINDS, r)
  return Array.from({ length: n }, (_, i) => makePosition(order[i % order.length], r, `payoff-${seed}-${i}`))
}

/* ── the payoff drawing ───────────────────────────────────────────────────────────────────────────────────────── */

/** A tidy step for an axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span, target = 4) {
  if (!(span > 0)) return 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return n * mag
}

/** The axis's labelled values inside [lo, hi]. */
export function axisTicks(lo, hi, target = 4) {
  const st = niceStep(hi - lo, target)
  const out = []
  for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(Math.round(v * 100) / 100 + 0)   // + 0: never a negative zero
  return out
}

/** The payoff at expiry as a drawing: x is the stock's price at expiry (cents), y the P/L (dollars). The line is straight
 *  between the strikes, so its points are the two edges and every strike between them. The range always holds the
 *  strikes, the breakeven, the expiry price and $0. */
export function payoffChart(p) {
  const xs = [...p.strikes, p.breakeven, p.expiry, ...(p.kind === 'covered_call' ? [p.basis] : [])]
  const lo = Math.min(...xs), hi = Math.max(...xs)
  const span = Math.max(hi - lo, nickel(p.stock * 0.06))
  const pad = Math.max(nickel(span * 0.4), 50)
  const x0 = Math.max(0, lo - pad), x1 = hi + pad
  const kinks = p.strikes.filter((k) => k > x0 && k < x1)
  const points = [x0, ...kinks, x1].map((x) => ({ x, y: plAt(p, x) }))
  const ys = [0, p.pl, ...points.map((q) => q.y)]
  const top = Math.max(...ys), bottom = Math.min(...ys)
  const ypad = Math.max((top - bottom) * 0.16, 10)
  const y0 = bottom - ypad, y1 = top + ypad
  return { x0, x1, y0, y1, points, breakeven: p.breakeven, expiry: { x: p.expiry, y: p.pl }, strikes: p.strikes, ticks: axisTicks(y0, y1) }
}

/** A price on the drawing to the nickel, held inside its range (for the finger or the mouse reading the line). */
export function priceAt(chart, share) {
  const s = Math.max(0, Math.min(1, Number(share) || 0))
  return Math.max(chart.x0, Math.min(chart.x1, nickel(chart.x0 + s * (chart.x1 - chart.x0))))
}

/** The highest and lowest the drawn line reaches between two x positions (screen units). The line is straight between
 *  its points, so the extremes sit at the two ends or at a point between them. */
export function lineSpan(points, xa, xb) {
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb)
  const yAt = (x) => {
    if (x <= points[0].x) return points[0].y
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k]
      if (x <= b.x) return b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
    }
    return points[points.length - 1].y
  }
  const ys = [yAt(lo), yAt(hi), ...points.filter((q) => q.x > lo && q.x < hi).map((q) => q.y)]
  return [Math.min(...ys), Math.max(...ys)]
}

/** Where a label goes (OWNER_PRINCIPLES rule 4: in open space, never over the line or another mark): the first of the
 *  candidate boxes {x, y, w, h} that sits inside `bounds` {x0, y0, x1, y1} and, grown by `pad` on every side, clear of
 *  every box in `boxes` and of the line through `points`. When none is clear: null when `strict`, else the candidate
 *  inside the bounds that overlaps the least (the first of equals). */
export function freeSpot(candidates, { boxes = [], bounds, points = null, strict = false, pad = 0 }) {
  const inside = (c) => c.x >= bounds.x0 && c.x + c.w <= bounds.x1 && c.y >= bounds.y0 && c.y + c.h <= bounds.y1
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const cost = (c) => {
    const g = { x: c.x - pad, y: c.y - pad, w: c.w + 2 * pad, h: c.h + 2 * pad }
    let sum = boxes.reduce((t, b) => t + area(g, b), 0)
    if (points && points.length > 1) {
      const [top, bottom] = lineSpan(points, g.x, g.x + g.w)
      if (top <= g.y + g.h && bottom >= g.y) sum += Math.max(1, Math.min(bottom, g.y + g.h) - Math.max(top, g.y)) * g.w
    }
    return sum
  }
  let best = null, bestCost = Infinity
  for (const c of candidates) {
    if (!inside(c)) continue
    const k = cost(c)
    if (k === 0) return c
    if (k < bestCost) { best = c; bestCost = k }
  }
  if (strict) return null
  return best || candidates[0]
}

/* ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Hearts left after a run of results (true right, false a miss). */
export function heartsLeft(results, hearts = PAYOFF_HEARTS) {
  return Math.max(0, hearts - results.filter((x) => x === false).length)
}

/** The run is over after the last position, or when the hearts run out. */
export function runOver(results, total = PAYOFF_TOTAL, hearts = PAYOFF_HEARTS) {
  return results.length >= total || heartsLeft(results, hearts) === 0
}

/** The run's id for POST /api/study/game-runs (1 to 64 characters; a resend grants nothing). */
export const runIdOf = (seed) => `payoff-${seed}`.slice(0, 64)
