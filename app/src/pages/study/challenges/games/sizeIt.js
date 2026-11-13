// SIZE IT (docs/study/GAMES.md §3, kind 'size'): the pure arithmetic of the game. Sixty seconds of trade cards: an
// account, the risk per trade, a long entry and its stop. How many shares? Four tiles: the right size and three of the
// named sizing mistakes (sized on the price, rounded up past the risk, a 10x slip, the stop's percent read as dollars;
// the catalogue's "forgot the risk %" only where one of those cannot be dealt). Every number the game shows or scores
// comes from here, in whole cents (no float drift), from a seed (the component seeds once at start; nothing here reads
// the clock or Math.random).
//
// The rule it teaches is ours, docs/study/sizing_rule.md:
//   §1  risk 0.25% to 2% of the account a trade; 2% is the hard ceiling; under 1% is normal
//   §2  stop first, distance second, size last
//   §3  shares = account × risk% ÷ (entry − stop), ROUNDED DOWN (the same as Position % = risk % ÷ stop % of the price,
//       then Position $ ÷ entry)
//   §4  no position over the account rulebook's cap, 40% of the account (docs/study/sizing_rule.md §9, A7, the owner
//       2026-11-09: "RAISE THE CAP TO 40% ACTUALLY"), so no card ever asks for a size our cap would cut. The market x grade
//       ceiling table (houseSizing.json) is a guide that varies (A10), not the cap
// Course unit: F9.02 "Stop first, then size" (docs/study/UNITS-foundations.md).
import house from '../../../../constants/houseSizing.json'

export const SIZE_KIND = 'size'
export const SIZE_SECS = 60
export const SIZE_POINTS = 10
export const SIZE_BEST_KEY = 'study.size.best'
export const LESSON = 'Stop first, distance second, size last.'
/** §3: shares are rounded DOWN, so the loss at the stop never runs past the risk. */
export const ROUND_DOWN = 'Round the shares down, so the loss at the stop stays inside your risk.'
export const LESSON_SOURCE = 'Our sizing rule · course unit F9.02, Stop first, then size'

/** §1: risk per trade in basis points (25 = 0.25%), 0.25% to the 2% ceiling. */
export const MIN_RISK_BPS = 25
export const MAX_RISK_BPS = Math.round(Number(house.maxAccountRiskPct) * 100)   // 200: the pinned house ceiling
export const RISK_BPS = [25, 50, 75, 100, 125, 150, 175, 200]
/** §4: the account rulebook's max position, as a percent of the account (A7, 40%). The ceiling table in houseSizing.json
 *  is the market x grade guide (A10), kept for the Journal's sizing blocks; the cap a card never crosses is this one. */
export const MAX_POSITION_PCT = 40
/** Realistic cards (the game's brief): stops 1% to 8% under the entry, prices $8 to $400, accounts $10k to $500k. */
export const MIN_STOP_PCT = 1
export const MAX_STOP_PCT = 8
export const MIN_PRICE = 8
export const MAX_PRICE = 400
export const MIN_SHARES = 2
export const ACCOUNTS = [10000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 75000, 80000, 100000, 120000, 150000, 200000, 250000, 300000, 400000, 500000]

/** The run ramps: three warm-up cards on whole dollars that divide exactly, four on quarter prices, then any price to the
 *  cent. Under 1% is normal (§1), so the draws lean there; 2% shows up, rarely. */
export const LEVELS = {
  easy: { key: 'easy', name: 'Warm-up', exact: true, step: 100, lo: 10, hi: 150, risk: [50, 100, 100], accounts: [10000, 20000, 25000, 40000, 50000, 100000, 200000] },
  medium: { key: 'medium', name: 'Quarter prices', step: 25, lo: MIN_PRICE, hi: 250, risk: [25, 50, 50, 75, 100, 100, 125, 150], accounts: ACCOUNTS },
  hard: { key: 'hard', name: 'Any price', step: 1, lo: MIN_PRICE, hi: MAX_PRICE, risk: [25, 50, 50, 75, 75, 100, 100, 100, 125, 150, 175, 200], accounts: ACCOUNTS },
}
export const levelAt = (index) => (index < 3 ? LEVELS.easy : index < 7 ? LEVELS.medium : LEVELS.hard)

/** The named mistakes the distractors model, each with the line the miss teaches. */
export const MISTAKES = {
  price: { key: 'price', title: 'Sized on the price.', short: 'sized on the price' },
  roundUp: { key: 'roundUp', title: 'Rounded up.', short: 'rounded up' },
  tenX: { key: 'tenX', title: 'A 10x slip.', short: 'a 10x slip' },
  // a no-break space keeps "%" with its word, so a title never wraps to a lone "%." on a phone
  stopPct: { key: 'stopPct', title: 'A percent is not dollars.', short: 'used the stop\u00a0% as dollars' },
  noRisk: { key: 'noRisk', title: 'Forgot the risk\u00a0%.', short: 'forgot the risk\u00a0%' },
}
/** The game's four named mistakes (its brief): the ones a real trader makes at the desk. */
export const NAMED = ['price', 'roundUp', 'tenX', 'stopPct']
/** The catalogue's "forgot the risk %": the whole account over the stop distance, 50 to 400 times the right size. A size
 *  nobody would buy gives the answer away, so it fills a slot only when one of the four cannot be dealt on a card. */
export const LAST_RESORT = 'noRisk'
/** The share of cards that deal the round-up trap. Its tile is always the right size plus one share, so on a card that
 *  carries it the lower of the two neighbours is the answer. Dealt on nearly every card, that pair would answer the
 *  question for you (OWNER_PRINCIPLES rule 10: questions that ask, not lead), so half the draws carry the trap and the
 *  rest make you do the sum. */
export const TRAP_SHARE = 0.5

// ── the seeded draw ─────────────────────────────────────────────────────────────────────────────────────────────
const MOD = 2147483647
/** A Park-Miller generator (the one challengeBank.shuffle uses), seeded per card so card i is the same for a seed. */
export function rngFor(seed, index = 0) {
  let s = (Math.abs(Math.floor(Number(seed) || 0)) % (MOD - 1)) + 1
  s = (s * 48271 + (Math.floor(index) + 1) * 2654435761) % MOD || 1
  const next = () => { s = (s * 48271) % MOD; return s / MOD }
  next(); next(); next()   // let neighbouring cards drift apart
  return next
}
const pickOf = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]

// ── the arithmetic, in whole cents ──────────────────────────────────────────────────────────────────────────────
/** §3: whole shares, rounded down. Account in dollars, risk in basis points, prices in cents. */
export function sharesFor(account, riskBps, entryCents, stopCents) {
  const dist = entryCents - stopCents
  if (!(dist > 0)) return 0
  return Math.floor((account * riskBps) / 100 / dist)
}

/** The stop's distance as a percent of the entry, in tenths of a percent, half up (4.1% → 41). */
export const stopPctTenths = (distCents, entryCents) => Math.round((distCents * 1000) / entryCents)

/** Every mistake's size for a card, null where the mistake gives no whole positive size or is not a mistake here. */
export function mistakeValues(card, tenDir = 'up') {
  const { riskCents, distCents, entryCents, account, shares } = card
  const tenths = stopPctTenths(distCents, entryCents)
  const v = {
    // risk dollars divided by the share price instead of by the stop distance
    price: Math.floor(riskCents / entryCents),
    // the quotient rounded up: one share more than the risk allows (only when it does not divide exactly)
    roundUp: riskCents % distCents ? shares + 1 : null,
    // the risk dollars slipped a decimal place, up or down
    tenX: tenDir === 'down' ? Math.floor(riskCents / (10 * distCents)) : Math.floor((riskCents * 10) / distCents),
    // the stop's percent used as if it were dollars a share (4.1% read as $4.10)
    stopPct: tenths > 0 ? Math.floor(riskCents / (10 * tenths)) : null,
    // the whole account divided by the stop distance, the risk % left out
    noRisk: Math.floor((account * 100) / distCents),
  }
  for (const k of Object.keys(v)) if (!(v[k] >= 1) || v[k] === shares) v[k] = null
  return v
}

/** Build one card from its numbers, or null when it breaks a rule of the game (the generator then draws again). */
export function buildCard({ index = 0, level = LEVELS.hard, account, riskBps, entryCents, distCents, tenDir = 'up', order = null, preferRoundUp = true }) {
  if (!ACCOUNTS.includes(account) || !RISK_BPS.includes(riskBps)) return null
  if (!(entryCents >= MIN_PRICE * 100 && entryCents <= MAX_PRICE * 100)) return null
  if (!(distCents >= 1 && distCents < entryCents)) return null
  // the stop 1% to 8% under the entry, measured on the cents shown
  if (distCents * 100 < entryCents * MIN_STOP_PCT || distCents * 100 > entryCents * MAX_STOP_PCT) return null
  const riskCents = (account * riskBps) / 100
  const stopCents = entryCents - distCents
  const shares = sharesFor(account, riskBps, entryCents, stopCents)
  if (shares < MIN_SHARES) return null
  const positionCents = shares * entryCents
  if (positionCents > account * MAX_POSITION_PCT) return null   // account × 100 cents × pct / 100
  const base = { index, level: level.key, levelName: level.name, account, riskBps, entryCents, stopCents, distCents, riskCents, shares, positionCents,
    q100: Math.floor((riskCents * 100) / distCents), exact: riskCents % distCents === 0, stopTenths: stopPctTenths(distCents, entryCents), tenDir }
  const values = mistakeValues(base, tenDir)
  // three distinct mistakes: the round-up trap first when the draw asks for it (round down is the rule), then the order
  const keys = order || Object.keys(MISTAKES)
  const ranked = preferRoundUp && values.roundUp != null ? ['roundUp', ...keys.filter((k) => k !== 'roundUp')] : keys
  const used = new Set([shares])
  const picked = []
  for (const k of ranked) {
    const val = values[k]
    if (val == null || used.has(val)) continue
    used.add(val); picked.push({ value: val, mistake: k })
    if (picked.length === 3) break
  }
  if (picked.length < 3) return null
  const choices = [{ value: shares, mistake: null }, ...picked].sort((a, b) => a.value - b.value)
  return { ...base, choices }
}

// a known good card for the (never yet seen) case the draw cannot place one: $40,000 at 1%, $50.00 to $48.00, 200 shares
const FALLBACK = { account: 40000, riskBps: 100, entryCents: 5000, distCents: 200 }

/** Card `index` of the run seeded `seed`: the same card every time for the same pair. */
export function cardAt(seed, index) {
  const level = levelAt(index)
  const rnd = rngFor(seed, index)
  for (let tries = 0; tries < 400; tries++) {
    const account = pickOf(level.accounts, rnd)
    const riskBps = pickOf(level.risk, rnd)
    // a price drawn evenly on a log scale, so $9 and $300 stocks both turn up
    const raw = Math.exp(Math.log(level.lo) + rnd() * (Math.log(level.hi) - Math.log(level.lo))) * 100
    const entryCents = Math.max(level.lo * 100, Math.min(level.hi * 100, Math.round(raw / level.step) * level.step))
    // §4: a stop no tighter than the cap allows (risk % ÷ 40% of the account), and inside 1% to 8%
    const lo = Math.max(MIN_STOP_PCT, (riskBps / 100) * (100 / MAX_POSITION_PCT))
    if (lo > MAX_STOP_PCT) continue
    const pct = lo + rnd() * (MAX_STOP_PCT - lo)
    const distCents = Math.round((entryCents * pct) / 100 / level.step) * level.step
    const tenDir = rnd() < 0.5 ? 'down' : 'up'
    const trap = rnd() < TRAP_SHARE
    const card = buildCard({ index, level, account, riskBps, entryCents, distCents, tenDir, order: mistakeOrder(rnd, trap), preferRoundUp: trap })
    if (card && (!level.exact || card.exact)) return card
  }
  return buildCard({ index, level, ...FALLBACK })
}

/** The order a card fills its three slots: the named four shuffled (the round-up trap only on a trap draw), then the
 *  last resort. */
export function mistakeOrder(rnd, trap = true) {
  const a = NAMED.filter((k) => trap || k !== 'roundUp')
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return [...a, LAST_RESORT]
}

// ── the words and numbers on screen ─────────────────────────────────────────────────────────────────────────────
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
/** $40,000 · $562.50 · $400 (cents only when there are some; `always` for prices). */
export function money(cents, always = false) {
  const c = Math.round(cents)
  const whole = Math.floor(c / 100), part = c % 100
  return always || part ? `$${group(whole)}.${String(part).padStart(2, '0')}` : `$${group(whole)}`
}
export const price = (cents) => money(cents, true)
export const dollars = (account) => money(account * 100)
export const sharesText = (n) => group(n)
export const riskPctText = (bps) => `${bps / 100}%`
export const stopPctText = (tenths) => (tenths % 10 ? `${(tenths / 10).toFixed(1)}%` : `${tenths / 10}%`)
/** The quotient, cut (never rounded) to two places, so the shown number never sits above the size it rounds down to. */
export const quotientText = (q100) => `${group(Math.floor(q100 / 100))}.${String(q100 % 100).padStart(2, '0')}`

/** The working, in three steps (the brief: "Risk $X = account x risk%. Per share $Y = entry - stop. X / Y = N shares,
 *  rounded down."). Each step: { pre, value, post }; the text is pre + value + post. */
export function working(card) {
  const risk = money(card.riskCents), dist = price(card.distCents)
  const steps = [
    { key: 'risk', pre: 'Risk ', value: risk, post: ` = ${dollars(card.account)} × ${riskPctText(card.riskBps)}.` },
    { key: 'dist', pre: 'Per share ', value: dist, post: ` = ${price(card.entryCents)} − ${price(card.stopCents)}.` },
    card.exact
      ? { key: 'size', pre: `${risk} / ${dist} = `, value: `${sharesText(card.shares)} shares`, post: ', exactly.' }
      : { key: 'size', pre: `${risk} / ${dist} = ${quotientText(card.q100)}, so `, value: `${sharesText(card.shares)} shares`, post: ', rounded down.' },
  ]
  return steps.map((s) => ({ ...s, text: s.pre + s.value + s.post }))
}
export const workingText = (card) => working(card).map((s) => s.text).join(' ')

/** Which mistake a picked size is, or null (the right size, or a number no tile carried). */
export function mistakeOf(card, value) {
  if (value === card.shares) return null
  return card.choices.find((c) => c.value === value)?.mistake || null
}

/** The line a miss teaches, on the card's own numbers. */
export function whyLine(card, value) {
  const k = mistakeOf(card, value)
  const risk = money(card.riskCents), dist = price(card.distCents), acct = dollars(card.account), pct = riskPctText(card.riskBps)
  if (k === 'price') return `You divided the ${risk} risk by the ${price(card.entryCents)} price. Divide it by the stop distance, ${dist} a share.`
  if (k === 'roundUp') return `${sharesText(value)} shares lose ${money(value * card.distCents)} at the stop, over your ${risk}. Round down.`
  if (k === 'tenX') return `That is the size for ${money(card.tenDir === 'down' ? card.riskCents / 10 : card.riskCents * 10)} of risk. ${pct} of ${acct} is ${risk}.`
  if (k === 'stopPct') return `The stop is ${stopPctText(card.stopTenths)} under the entry. That is not ${price(card.stopTenths * 10)} a share; it is ${dist}.`
  if (k === 'noRisk') return `That puts the whole ${acct} at risk at the stop. Take ${pct} of it first: ${risk}.`
  return `The size is ${sharesText(card.shares)} shares.`
}

/** The verdict a miss opens on: the mistake's name. */
export const missTitle = (card, value) => MISTAKES[mistakeOf(card, value)]?.title || 'Not this one.'

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The multiplier, the same ladder as Blitz (challengeBank.blitzMult): x2 from the first right answer, x5 at nine. */
export const sizeMult = (combo) => (combo >= 9 ? 5 : combo >= 6 ? 4 : combo >= 3 ? 3 : combo >= 1 ? 2 : 1)
/** Points for a right answer that makes the combo `combo`. */
export const pointsFor = (combo) => SIZE_POINTS * sizeMult(combo)

/** The end screen's title, counted from the run. */
export function sizeVerdict(right, total) {
  if (!total) return 'No cards sized'
  if (right === total) return 'Every card right'
  if (right / total >= 0.75) return 'Clean sizing'
  if (right / total >= 0.5) return 'Getting there'
  return 'Tough run'
}

/** The slip the member made most in a run (log rows carry `ok` and `mistake`), ties to the earlier one. */
export function topSlip(log) {
  const misses = log.filter((r) => !r.ok)
  if (!misses.length) return null
  const n = new Map()
  for (const r of misses) if (r.mistake) n.set(r.mistake, (n.get(r.mistake) || 0) + 1)
  let best = null
  for (const [k, c] of n) if (!best || c > best.count) best = { key: k, count: c }
  return best ? { ...best, misses: misses.length, title: MISTAKES[best.key].title, short: MISTAKES[best.key].short } : null
}

/** The end screen's teaching line. */
export function slipLine(log) {
  const t = topSlip(log)
  if (!log.length) return `Every card is one rule: ${LESSON.toLowerCase()}`
  if (!t) return `No slips. ${LESSON}`
  return `Your most common slip: ${t.short}, ${t.count} of ${t.misses} miss${t.misses === 1 ? '' : 'es'}. ${LESSON}`
}

/** The ladder on the card: the stop's distance scaled 0 (a 1% stop) to 1 (an 8% stop), so a wide stop looks wide. */
export const ladderGap = (card) => Math.max(0, Math.min(1, (card.distCents / card.entryCents * 100 - MIN_STOP_PCT) / (MAX_STOP_PCT - MIN_STOP_PCT)))

/** One run's id for POST /api/study/game-runs (idempotent per id on the server). */
export const runIdOf = (seed, n = 0) => `size-${Math.abs(Math.floor(Number(seed) || 0)).toString(36)}-${n}`
