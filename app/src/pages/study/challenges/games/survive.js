// SURVIVE THE DRAWDOWN (docs/study/GAMES.md §3, kind 'survive'): the pure arithmetic of the game. One system, the course's
// own "System B" (F9.03 q19: wins 40% at +2.5R, loses 60% at −1R, +0.4R a trade), plays the same 50 trades at five risks
// per trade: 0.5%, 1%, 2%, 5% and 10% of the account as it stands. The member picks one; the account curves are drawn from
// here; then three questions: what the stretch's longest losing streak takes at a big risk, how deep the member's own
// pick fell, and which picks fell 50% or more from their peak. The member's own depth is asked second, before the third
// question's review lists every pick's fall, and nothing on screen states that fall as a percent before it is asked (the
// board shows the dollars; the streak question is never asked at the member's own risk and never shows a number equal to
// that fall). Every number the game shows or scores comes from this file, from a seed (the component seeds once at start;
// nothing here reads the clock or Math.random).
//
// Why the first question is the streak and not "which pick ended highest" (review, 2026-11-09): on this bag the best
// long-run growth sits at 16% a trade (0.4 − 0.6 / 2.5), above every pick, so 10% finished highest in about three runs
// in four and that question's answer was nearly always 10%. Every number was true and the lesson was backwards. The game
// now asks about the cost of the risk, and the end screen shows the same game played 10,000 times (below).
//
// The verdict: a pick inside our range that never fell 50% from its peak survived. A pick over our 2% ceiling that stayed
// above the 50% line only held this time, and the game says what it would have taken: at 10% a trade, 7 losses in a row
// take 52.2% of the account.
//
// Many stretches (manyOf, MANY): one stretch is one draw of luck. The end screen shows the same bag played 10,000 times,
// every draw kept (no tidy-reading filter): how often each pick fell by half or more, finished below the start or finished
// highest, and the middle finish. Then the same for a bag a little worse than the system promises, 3 winners in 10 at the
// same +2.5R (still +0.05R a trade), because a trader never knows the real edge for sure (F9.03 q26, f54, f55). On the
// promised bag 10% finished highest in 8,409 of 10,000 and fell by half or more in 5,958, while 2% never fell by half; on
// the smaller bag 10% fell by half in 9,115 and finished below the start in 6,850, and 2% fell by half in 3. Those counts
// are worked once and pinned here (MANY); the unit test recomputes them from the definition.
//
// What it teaches, and where each line comes from:
//   docs/study/sizing_rule.md §1 and F9.01 (h1)  our rule: risk 0.25% to 2% of the account a trade, 2% the hard ceiling
//   F9.03 (q19, w3 "the marble game", q26)       the system's edge, +0.4R a trade; trades drawn like marbles from a bag;
//                                                  size to survive streaks; your edge is an estimate, and edges fade
//   F9.04 (f01, f08, f14, f18, f20)               a drawdown runs from the peak to the low after it; losses compound;
//                                                  every loss needs a bigger gain to repair it (down 50% needs +100%)
//
// The money: every trade risks the pick's share of the account as it stands (F9.01 f43: with a fixed percent the risk
// rises and falls with the account), a win adds 2.5 times that risk and a loss takes it. The path is kept exact and every
// balance the game shows or measures is that path rounded to whole dollars, so every percent on screen can be redone on
// a calculator from the dollars beside it.
//
// The stretches: each run's 50 trades are a fresh draw from the bag (40% winners), seeded. A draw is kept only when the
// questions read cleanly on the chart: the top finisher clear of the next (4% or more, so the five finishes read apart),
// every pick's deepest fall clear of the 50% line (5 points or more either side), each pick's fall deeper than the
// smaller pick's, the 10% curve inside six doublings top to bottom, and all three questions dealt for every pick. The
// first draw that keeps them is the run's. (One draw in four used to be asked for a cold stretch, under 17 wins, where
// 10% finishes below the start; that served the old finish question, and it put "10% only" on the 50% line in 65% of
// deals. Dealt as the bag deals, 10% falls by half in about 6 runs in 10, the bag's own rate (5,958 in 10,000, below),
// and "10% only" answers the 50% line in 59% of deals, measured over 10,000.) Every stretch is a real draw from the bag,
// and the end screen says its win count.
import house from '../../../../constants/houseSizing.json'

export const SURVIVE_KIND = 'survive'
export const SURVIVE_BEST_KEY = 'study.survive.best'
export const TRADES = 50
export const QUESTIONS = 3
/** The bag (F9.03 w3): 40 marbles in 100 are winners. */
export const WIN_PCT = 40
/** Winners make 2.5R, losers lose 1R, in tenths of R so the arithmetic stays whole. */
export const WIN_R10 = 25
export const LOSS_R10 = 10
/** The edge in hundredths of R: 40% × 2.5R − 60% × 1R = +0.4R a trade (F9.03 q19). */
export const EDGE_R100 = (WIN_PCT * WIN_R10 - (100 - WIN_PCT) * LOSS_R10) / 10
/** The account every pick starts from: the house placeholder account, $100,000. */
export const START = Number(house.placeholderAccountSize)
/** The five picks, in basis points of the account (50 = 0.5%). */
export const PICKS = [50, 100, 200, 500, 1000]
/** Our rule (sizing_rule.md §1): 0.25% to 2%; the ceiling is the pinned house value. */
export const RULE_MIN_BPS = 25
export const RULE_MAX_BPS = Math.round(Number(house.maxAccountRiskPct) * 100)
/** The line the game is named for: a fall of half the peak, which needs a 100% gain to repair (F9.04 f14). */
export const LINE = 0.5

/** The stretch rules (see the header). */
export const WIN_MIN = 16
export const WIN_MAX = 24
export const COLD_BELOW = 17
export const TOP_CLEAR = 1.04
export const LINE_CLEAR = 0.05
export const MAX_DOUBLINGS = 6
/** The 10% curve never dips under an eighth of the start, so the lowest gridline is $12.5k and every label is exact. */
export const LOW_FLOOR = START / 8
export const STRETCH_TRIES = 4000
/** A known good stretch (20 wins, longest losing streak 8) for the never yet seen case that no draw fits. */
export const FALLBACK = 'WWWWLLLWLLLLWLLLLLLLLWWLWLLWLLWWLWLWWWWLLLLLLWWLLW'

export const LESSON_STREAK = 'Losing streaks come with every edge. Size so a streak cannot sink you.'
export const LESSON_RECOVER = 'Every loss needs a bigger gain to repair it. Down 50% needs +100%.'
export const LESSON_RULE = 'Our rule: risk 0.25% to 2% of the account a trade. 2% is the ceiling.'
export const SOURCE_EDGE = 'From the course · F9.03 R, expectancy and the marble game'
export const SOURCE_RECOVER = 'From the course · F9.04 Drawdown arithmetic and the protocol'
export const SOURCE_RULE = 'Our sizing rule · course unit F9.01 Risk per trade'
export const SOURCE_MANY = 'From the course · F9.03 your edge is an estimate · F9.04 down 50% needs +100%'

// ── the seeded draw ─────────────────────────────────────────────────────────────────────────────────────────────
const MOD = 2147483647
/** A seed through an integer hash first (both halves of a millisecond clock folded in), so two runs started a few
 *  milliseconds apart deal unrelated stretches: Park-Miller alone starts neighbouring seeds on neighbouring streams. */
export function mixSeed(seed) {
  const n = Math.floor(Math.abs(Number(seed) || 0))
  let h = (n % 4294967296) >>> 0
  h ^= Math.imul(Math.floor(n / 4294967296) >>> 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
/** A Park-Miller generator (the one Size It and challengeBank.shuffle use) on the mixed seed: the same stream for the
 *  same seed. */
export function rngOf(seed) {
  let s = (mixSeed(seed) % (MOD - 1)) + 1
  s = (s * 48271 + 2654435761) % MOD || 1
  const next = () => { s = (s * 48271) % MOD; return s / MOD }
  next(); next(); next()
  return next
}

/** Fifty marbles from the bag, each put back: true for a winner. */
export function bagDraw(rnd, n = TRADES, winPct = WIN_PCT) {
  return Array.from({ length: n }, () => rnd() * 100 < winPct)
}

/** A stretch written as W and L ("WLLW..."), and back. */
export const winsOf = (text) => [...String(text)].map((c) => c === 'W')
export const textOf = (wins) => wins.map((w) => (w ? 'W' : 'L')).join('')

// ── the money ───────────────────────────────────────────────────────────────────────────────────────────────────
/** One trade on the account as it stands: a win adds 2.5 times the risk, a loss takes the risk. */
export const stepOf = (balance, bps, win) => (win ? balance * (1 + (bps * WIN_R10) / 100000) : balance * (1 - (bps * LOSS_R10) / 100000))

/** The exact path, START and then the balance after each trade. */
export function pathOf(wins, bps, start = START) {
  const out = [start]
  let b = start
  for (const w of wins) { b = stepOf(b, bps, w); out.push(b) }
  return out
}

/** The balances the game shows: the exact path to whole dollars. */
export const balancesOf = (wins, bps, start = START) => pathOf(wins, bps, start).map((v) => Math.round(v))

/** The running peak at each trade (the high-water mark). */
export function peaksOf(balances) {
  const out = []
  let p = -Infinity
  for (const b of balances) { if (b > p) p = b; out.push(p) }
  return out
}

/** The deepest drawdown (F9.04 f08: the biggest fall from a peak to a low before a new high): the fall as a fraction,
 *  the peak and the low in dollars, where each sat (0 is the start, n is after trade n), and the wins and losses
 *  between them. The low is the lowest point anywhere after that peak (any lower point would make a deeper fall). The
 *  first of two equal falls is kept. */
export function deepestOf(balances, wins = null) {
  let peak = balances[0], peakAt = 0
  let best = { dd: 0, peak: balances[0], peakAt: 0, low: balances[0], lowAt: 0 }
  balances.forEach((b, i) => {
    if (b > peak) { peak = b; peakAt = i }
    const dd = 1 - b / peak
    if (dd > best.dd) best = { dd, peak, peakAt, low: b, lowAt: i }
  })
  let w = 0, l = 0
  if (wins) for (let t = best.peakAt; t < best.lowAt; t++) { if (wins[t]) w += 1; else l += 1 }
  return { ...best, wins: w, losses: l }
}

/** The fall from `peak` to `low` as a fraction (the drawdown, F9.04 f01). */
export const fallOf = (peak, low) => (peak > 0 ? 1 - low / peak : 0)
/** The gain that takes `low` back to `peak`, as a fraction (F9.04 f14: down 50% needs +100%). */
export const climbOf = (peak, low) => (low > 0 ? peak / low - 1 : Infinity)
/** The same from a fall alone: a fall of dd needs dd / (1 − dd). */
export const climbFor = (dd) => (dd < 1 ? dd / (1 - dd) : Infinity)

/** The chance that `n` trades, each a loser with chance `lossPct` in 100, hold a run of `k` or more losers in a row:
 *  worked exactly, trade by trade, over the length of the run in progress. 7 or more in 50 at 60% losers: 42.6%. */
export function streakChance(k, n = TRADES, lossPct = 100 - WIN_PCT) {
  const q = lossPct / 100
  if (k <= 0) return 1
  let at = Array.from({ length: k }, (_, r) => (r === 0 ? 1 : 0))
  let hit = 0
  for (let t = 0; t < n; t++) {
    const next = new Array(k).fill(0)
    for (let r = 0; r < k; r++) {
      if (!at[r]) continue
      next[0] += at[r] * (1 - q)
      if (r + 1 >= k) hit += at[r] * q
      else next[r + 1] += at[r] * q
    }
    at = next
  }
  return hit
}

/** The longest run of losers, and where it sat (trades are counted from 1). */
export function longestLosing(wins) {
  let best = { length: 0, from: 0, to: 0 }, run = 0
  wins.forEach((w, i) => {
    run = w ? 0 : run + 1
    if (run > best.length) best = { length: run, from: i - run + 2, to: i + 1 }
  })
  return best
}

/** What `n` losses in a row take at a risk, compounded: 1 − (1 − risk)ⁿ. At 2% a trade, 7 take 13.2%. */
export const runFall = (bps, n) => 1 - (1 - (bps * LOSS_R10) / 100000) ** n

/** The fewest losses in a row that take half the account at a risk, and what they take: 7 at 10% take 52.2%, 14 at 5%
 *  take 51.2%, 35 at 2% take 50.7%. */
export function halfRun(bps) {
  let n = 0
  while (runFall(bps, n) < LINE && n < 100000) n += 1
  return { n, fall: runFall(bps, n) }
}

/** The fewest winners in `n` trades that leave a pick above where it started. Where a pick ends comes down to how many
 *  trades won, not their order: each win multiplies the account by 1 + 2.5 × risk and each loss by 1 − risk, and a
 *  product does not care about order. */
export function winsToFinishAbove(bps, n = TRADES) {
  const up = Math.log(1 + (bps * WIN_R10) / 100000), down = Math.log(1 - (bps * LOSS_R10) / 100000)
  for (let w = 0; w <= n; w++) if (w * up + (n - w) * down > 0) return w
  return n + 1
}

// ── one stretch ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Everything the game needs about a stretch: its trades, its win count and longest losing streak, and for each pick
 *  the balances, the finish and the deepest drawdown. */
export function stretchOf(wins) {
  const count = wins.filter(Boolean).length
  const picks = PICKS.map((bps) => {
    const balances = balancesOf(wins, bps)
    const deep = deepestOf(balances, wins)
    const final = balances[balances.length - 1]
    return { bps, balances, final, change: final / START - 1, deep, low: Math.min(...balances), high: Math.max(...balances), needs: winsToFinishAbove(bps, wins.length) }
  })
  const top = picks.reduce((a, p) => (p.final > a.final ? p : a), picks[0])
  return { wins, text: textOf(wins), n: wins.length, count, losses: wins.length - count, streak: longestLosing(wins), picks, top: top.bps, fell: picks.filter((p) => p.deep.dd >= LINE).map((p) => p.bps) }
}

export const pickOf = (stretch, bps) => stretch.picks.find((p) => p.bps === bps) || null

/** The rules a drawn stretch must keep (see the header). `cold` asks for a cold stretch (true), a warm one (false), or
 *  either (null). */
export function fits(stretch, cold = null) {
  if (!stretch || stretch.n !== TRADES) return false
  if (stretch.count < WIN_MIN || stretch.count > WIN_MAX) return false
  if (cold === true && stretch.count >= COLD_BELOW) return false
  if (cold === false && stretch.count < COLD_BELOW) return false
  const finals = stretch.picks.map((p) => p.final).sort((a, b) => b - a)
  if (finals[0] < finals[1] * TOP_CLEAR) return false
  for (let i = 0; i < stretch.picks.length; i++) {
    const d = stretch.picks[i].deep.dd
    if (!(d > 0) || Math.abs(d - LINE) < LINE_CLEAR) return false
    if (i > 0 && !(d > stretch.picks[i - 1].deep.dd)) return false
  }
  const big = stretch.picks[stretch.picks.length - 1]
  if (Math.log2(big.high / big.low) > MAX_DOUBLINGS || big.low < LOW_FLOOR) return false
  // all three questions deal for every pick
  return PICKS.every((bps) => questionsFor(stretch, bps, 0).length === QUESTIONS)
}

/** The stretch for a seed: the first fresh draw from the bag that fits, cold or warm as the bag deals it. `cold` says
 *  whether 10% a trade finished below where it started (under COLD_BELOW wins). */
export function dealStretch(seed) {
  const rnd = rngOf(seed)
  for (let t = 0; t < STRETCH_TRIES; t++) {
    const s = stretchOf(bagDraw(rnd))
    if (fits(s)) return { ...s, seed, cold: s.count < COLD_BELOW }
  }
  return { ...stretchOf(winsOf(FALLBACK)), seed, cold: false, fallback: true }
}

// ── the words and numbers on screen ─────────────────────────────────────────────────────────────────────────────
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const MINUS = '−'
/** $131,240 (whole dollars). */
export const dollars = (v) => `${v < 0 ? MINUS : ''}$${group(Math.abs(Math.round(v)))}`
/** 0.5% · 2% · 10% */
export const pickLabel = (bps) => `${bps / 100}%`
/** "2% a trade" */
export const pickText = (bps) => `${pickLabel(bps)} a trade`
/** A fraction as a percent to one place: 0.1313 → "13.1%". */
export const pct = (f) => `${(Math.round(f * 1000) / 10).toFixed(1)}%`
/** The same, signed: "+31.2%" · "−1.2%". */
export const signedPct = (f) => {
  const t = Math.round(f * 1000) / 10
  return `${t > 0 ? '+' : t < 0 ? MINUS : ''}${Math.abs(t).toFixed(1)}%`
}
/** An axis label: $50k · $102.5k · $1.6M. */
export function kText(v) {
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(3)}M`
  if (v >= 1000) return `$${+(v / 1000).toFixed(3)}k`
  return `$${Math.round(v)}`
}
const lossesText = (n) => `${n} ${n === 1 ? 'loss' : 'losses'}`
const winsText = (n) => `${n} ${n === 1 ? 'win' : 'wins'}`
/** "7 losses in a row" · "7 losses, 1 win" · "1 loss" */
export function windowText(deep) {
  const l = lossesText(deep.losses)
  return deep.wins ? `${l}, ${winsText(deep.wins)}` : `${l}${deep.losses > 1 ? ' in a row' : ''}`
}
/** The system's numbers as they read on screen, from the constants: "+2.5R", "−1R", "+0.4R", "0.25% to 2%". */
export const WIN_TEXT = `+${WIN_R10 / 10}R`
export const LOSS_TEXT = `${MINUS}${LOSS_R10 / 10}R`
export const EDGE_TEXT = `+${EDGE_R100 / 100}R`
export const RULE_RANGE = `${RULE_MIN_BPS / 100}% to ${RULE_MAX_BPS / 100}%`
/** The edge in words: "Wins 40% at +2.5R, loses 60% at −1R: +0.4R a trade on average." */
export const edgeText = () => `Wins ${WIN_PCT}% at ${WIN_TEXT}, loses ${100 - WIN_PCT}% at ${LOSS_TEXT}: ${EDGE_TEXT} a trade on average.`
/** What a pick risks on the first trade: "$2,000". */
export const firstRisk = (bps) => dollars((START * bps) / 10000)
/** "after trade 21" · "at the start" */
export const atText = (i) => (i === 0 ? 'at the start' : `after trade ${i}`)

/** A pick's line in one breath: "2% a trade: $100,000 to $131,240, deepest drawdown 13.1%". */
export const pickLine = (p) => `${pickText(p.bps)}: ${dollars(START)} to ${dollars(p.final)}, deepest drawdown ${pct(fallOf(p.deep.peak, p.deep.low))}`
/** The end screen's stretch line (the brief: the win count and the longest losing streak). */
export const stretchLine = (s) => `These ${s.n} trades: ${s.count} wins (${Math.round((s.count / s.n) * 100)}%), longest losing streak ${s.streak.length}.`
/** Did the pick stay above the 50% line all the way? */
export const survived = (p) => p.deep.dd < LINE
/** The pick's verdict: 'survived' (inside our range and never 50% under its peak), 'held' (over our 2% ceiling, above
 *  the 50% line on this stretch only) or 'fell' (50% or more under its peak). A pick over the ceiling never earns
 *  "survived": the same edge at that risk is one cold streak from the line (halfRun). */
export const verdictOf = (p) => (!survived(p) ? 'fell' : p.bps > RULE_MAX_BPS ? 'held' : 'survived')
/** The end screen's title for the member's pick (the questions are done, so the fall is said in full). */
export const survivalTitle = (p) => (verdictOf(p) === 'survived' ? `Survived at ${pickLabel(p.bps)}` : `Down ${pct(p.deep.dd)} at ${pickLabel(p.bps)}`)
/** The line under the curve once it has drawn. It never states the pick's fall as a percent: the second question asks
 *  for it. */
export function survivalLine(p) {
  const v = verdictOf(p)
  if (v === 'survived') return 'Survived. It never fell 50% from its peak.'
  if (v === 'fell') return 'It fell more than 50% from its peak. Getting back from there takes more than a 100% gain.'
  const h = halfRun(p.bps)
  return `It held above the 50% line this time. At ${pickText(p.bps)}, ${h.n} losses in a row take ${pct(h.fall)} of the account.`
}

// ── the three questions ─────────────────────────────────────────────────────────────────────────────────────────
/** The order the three are asked: the streak, then the member's own depth (asked before the 50% line's review lists
 *  every pick's fall, so it is never answered on screen before it is asked), then the 50% line. */
export const ORDER = ['streak', 'deep', 'line']
const noOf = (key) => ORDER.indexOf(key) + 1

/** The named mistakes the streak question's tiles model, each with the line a miss teaches. */
export const STREAK_MISTAKES = {
  added: { title: 'Losses compound.' },
  left: { title: 'That is what is left.' },
  climb: { title: 'That is the climb back.' },
  count: { title: 'Count the streak again.' },
  risk: { title: 'That is another risk.' },
}
/** The streak mistake's family: one loss too few or too many is one mistake, a miscount; any other pick's cost is one,
 *  another risk. */
export const streakFamily = (key) => (key === 'fewer' || key === 'more' ? 'count' : /^risk\d+$/.test(String(key)) ? 'risk' : key)

/** The risks the streak question may ask at, first to last: 10% a trade, the risk that makes a streak hurt; or our 2%
 *  ceiling for a member who took 10%, since their own streak could be the very fall the depth question asks next. Never
 *  the member's own risk. The later ones stand in only when a number would repeat the member's own fall. */
export function streakRisks(mine) {
  const big = PICKS[PICKS.length - 1]
  return (mine === big ? [RULE_MAX_BPS, PICKS[3], PICKS[1]] : [big, PICKS[3], RULE_MAX_BPS, PICKS[1]]).filter((b) => b !== mine)
}

/** "90%": what one loss at a risk keeps of the account. */
const keepText = (bps) => `${(10000 - bps) / 100}%`

/** The streak question at one risk, or null when its numbers would repeat a label in `no` or three tiles cannot be
 *  dealt. */
function streakAt(stretch, mine, at, seed, no) {
  const n = stretch.streak.length
  const f = at / 10000
  const value = runFall(at, n)
  const left = 1 - value
  const climb = climbFor(value)
  // what the working and a right answer say: the fall, what is left and the climb back. None may repeat the member's fall.
  if ([value, left, climb].some((v) => no.has(pct(v)))) return null
  const contrast = at === PICKS[PICKS.length - 1] && mine !== RULE_MAX_BPS && !no.has(pct(runFall(RULE_MAX_BPS, n)))
    ? { bps: RULE_MAX_BPS, value: runFall(RULE_MAX_BPS, n) } : null
  const others = PICKS.filter((b) => b !== at && b !== mine)
  const cands = {
    added: n * f,
    left,
    climb,
    fewer: n > 1 ? runFall(at, n - 1) : null,
    more: runFall(at, n + 1),
    ...Object.fromEntries(others.map((b) => [`risk${b}`, runFall(b, n)])),
  }
  const counts = { fewer: n - 1, more: n + 1 }
  const gap = Math.max(0.003, value * 0.08)
  const shown = (v) => Math.round(v * 1000) / 1000
  const ok = (k) => cands[k] != null && Number.isFinite(cands[k]) && cands[k] > 0 && cands[k] < 10 && !no.has(pct(cands[k]))
    && !(k === 'added' && cands[k] >= 1)
  const r = rngOf((Number(seed) || 0) + at * 7 + n)
  const order = (keys) => {
    const out = keys.filter(ok)
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
    return out
  }
  const keys = Object.keys(cands)
  const below = order(keys.filter((k) => cands[k] != null && cands[k] < value))
  const above = order(keys.filter((k) => cands[k] != null && cands[k] > value))
  const deal = (want) => {
    const picked = []
    const fits3 = (k) => !picked.some((x) => x.key === k)
      && [value, ...picked.map((x) => x.value)].every((x) => Math.abs(shown(cands[k]) - shown(x)) >= gap - 1e-9)
    const take = (list, m) => { for (const k of list) { if (m <= 0 || picked.length >= 3) break; if (fits3(k)) { picked.push({ key: k, value: cands[k] }); m -= 1 } } }
    take(below, want)
    take(above, 3 - picked.length)
    take(below, 3 - picked.length)
    return picked.length === 3 ? picked : null
  }
  // every place the answer can reach, one deal each; the seed picks one of them, all equally likely
  const reach = []
  for (let want = 0; want <= 3; want++) {
    const got = deal(want)
    if (!got) continue
    const place = got.filter((x) => x.value < value).length
    if (!reach.some((x) => x.place === place)) reach.push({ place, picked: got })
  }
  if (!reach.length) return null
  const { picked } = reach[Math.min(reach.length - 1, Math.floor(r() * reach.length))]
  const choices = [{ value, key: null }, ...picked]
    .sort((a, b) => a.value - b.value)
    .map((c) => ({
      label: pct(c.value), value: c.value, right: c.key == null, mistake: c.key,
      ...(counts[c.key] != null ? { n: counts[c.key] } : {}), ...(/^risk\d+$/.test(String(c.key)) ? { bps: Number(c.key.slice(4)) } : {}),
    }))
  const { from, to } = stretch.streak
  return {
    key: 'streak', no: noOf('streak'), tag: 'The streak',
    question: `What do ${n} losses in a row take at ${pickText(at)}?`,
    detail: `This stretch's longest losing streak was ${n} in a row, trades ${from} to ${to}. Each trade risks ${pickLabel(at)} of the account as it stands.`,
    choices, labels: choices.map((c) => c.label), answer: pct(value), value, mine, at, n, from, to, left, climb, contrast,
  }
}

/** The streak: what the stretch's longest losing streak takes at a big risk, compounded. `avoid` holds labels no number
 *  here may show (the member's own fall, which the depth question asks next). Four tiles, the answer and three named
 *  mistakes: the losses added up, what is left, the climb back, one loss too few or too many, another pick's cost.
 *  Every tile at least 0.3 points (and 8% of the answer) from every other; null when no risk deals. */
export function streakQuestion(stretch, mine, seed = 0, avoid = []) {
  if (!stretch?.streak || stretch.streak.length < 2 || !pickOf(stretch, mine)) return null
  const no = new Set(avoid)
  for (const at of streakRisks(mine)) {
    const q = streakAt(stretch, mine, at, seed, no)
    if (q) return q
  }
  return null
}

/** The 50% line question's tiles: how many picks, counted down from 10%, fell 50% or more from their peak. */
export function lineLabel(k) {
  if (k <= 0) return 'None of them'
  if (k === 1) return `${pickLabel(PICKS[4])} only`
  if (k === 2) return `${pickLabel(PICKS[3])} and ${pickLabel(PICKS[4])}`
  if (k === 3) return `${pickLabel(PICKS[2])}, ${pickLabel(PICKS[3])} and ${pickLabel(PICKS[4])}`
  if (k === 4) return `All but ${pickLabel(PICKS[0])}`
  return 'All five'
}
/** The 50% line: which picks fell 50% or more from their peak? The answer is always the biggest picks (a bigger risk always falls
 *  deeper on the same trades), so the tiles count them: four in a row around the answer. */
export function lineQuestion(stretch) {
  const k = stretch.fell.length
  const from = Math.max(0, Math.min(k - 2, PICKS.length - 3))
  const choices = [0, 1, 2, 3].map((d) => from + d).map((n) => ({ label: lineLabel(n), k: n, right: n === k, mistake: n === k ? null : n < k ? 'fewer' : 'more' }))
  return {
    key: 'line', no: noOf('line'), tag: 'The 50% line', question: 'Which picks fell 50% or more from their peak?',
    detail: 'Measure each line from its high to the low after it. Each gridline is double the one below, so a 50% fall drops a full gridline.',
    choices, labels: choices.map((c) => c.label), answer: lineLabel(k), k,
  }
}

/** The named mistakes the depth question's tiles model, each with the line a miss teaches. */
export const DEEP_MISTAKES = {
  climb: { title: 'That is the climb back.' },
  start: { title: 'Measured from the start.' },
  added: { title: 'Losses compound.' },
  oneLoss: { title: 'That is one loss.' },
  line: { title: 'That is another line.' },
}
/** The mistake's family: every other line's fall ('lower', 'higher2', ...) is one mistake, reading the wrong line. */
export const mistakeFamily = (key) => (key && /^(lower|higher)\d?$/.test(key) ? 'line' : key)

/** The depth question's tiles sit in order, smallest first, so the answer's place is how many wrong tiles sit under it:
 *  none (the answer is the smallest) to all three (the largest). Every place this pick's mistakes can reach is dealt
 *  equally often, so the place tells nothing. (It once drew the place from fixed odds and fell back when that place could
 *  not be filled, which piled the fallbacks onto one place: a 0.5% pick's answer sat second 73% of the time.) */

/** The depth question: how deep did the member's own pick fall? The peak and the low are given in dollars; the tiles are
 *  the fall and three named mistakes: the climb back read as the fall, the trades added up instead of compounded, the
 *  fall measured from the start, one loss read as the whole fall, another line's fall. Every tile at least 0.3 points
 *  (and 8% of the answer) from every other; null when three cannot be dealt. */
export function deepQuestion(stretch, mine, seed = 0) {
  const p = pickOf(stretch, mine)
  if (!p) return null
  const d = p.deep
  if (!(d.dd > 0)) return null
  const value = fallOf(d.peak, d.low)
  const r = rngOf((Number(seed) || 0) + mine)
  const idx = PICKS.indexOf(mine)
  // every other line's fall, nearest first: lower, lower2, ... and higher, higher2, ...
  const lines = {}
  for (let k = 1; k < PICKS.length; k++) {
    for (const [name, at] of [[`lower${k > 1 ? k : ''}`, idx - k], [`higher${k > 1 ? k : ''}`, idx + k]]) {
      const q = stretch.picks[at]
      if (q) lines[name] = { bps: q.bps, v: fallOf(q.deep.peak, q.deep.low) }
    }
  }
  const lineKeys = (side) => Object.keys(lines).filter((k) => k.startsWith(side))
  const cands = {
    climb: climbOf(d.peak, d.low),
    added: (d.losses * mine) / 10000 - (d.wins * mine * WIN_R10) / 100000,
    start: d.peakAt > 0 && d.low < START ? fallOf(START, d.low) : null,
    oneLoss: mine / 10000,
    ...Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.v])),
  }
  const gap = Math.max(0.003, value * 0.08)
  const shown = (v) => Math.round(v * 1000) / 1000
  const ok = (k) => cands[k] != null && Number.isFinite(cands[k]) && cands[k] > 0 && cands[k] < 10
  // the mistakes under the answer: measured from the start first (F9.04 f41), then the rest in a seeded order
  const under = ['oneLoss', 'added', ...lineKeys('lower').slice(0, 2)]
  for (let i = under.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [under[i], under[j]] = [under[j], under[i]] }
  const below = ['start', ...under, ...lineKeys('lower').slice(2)].filter((k) => ok(k) && cands[k] < value)
  const above = ['climb', 'added', ...lineKeys('higher')].filter((k) => ok(k) && cands[k] > value)
  /** Three mistakes with `want` of them under the answer where they fit (topped up from the other side where not). */
  const deal = (want) => {
    const picked = []
    const fits3 = (k) => ok(k) && !picked.some((x) => x.key === k)
      && [value, ...picked.map((x) => x.value)].every((x) => Math.abs(shown(cands[k]) - shown(x)) >= gap - 1e-9)
    const take = (keys, n) => { for (const k of keys) { if (n <= 0 || picked.length >= 3) break; if (fits3(k)) { picked.push({ key: k, value: cands[k] }); n -= 1 } } }
    take(below, want)
    take(above, 3 - picked.length)
    take(below, 3 - picked.length)
    return picked.length === 3 ? picked : null
  }
  // every place the answer can reach for this pick, one deal each; the seed picks one of them, all equally likely
  const reach = []
  for (let want = 0; want <= 3; want++) {
    const got = deal(want)
    if (!got) continue
    const place = got.filter((x) => x.value < value).length
    if (!reach.some((x) => x.place === place)) reach.push({ place, picked: got })
  }
  if (!reach.length) return null
  const { picked } = reach[Math.min(reach.length - 1, Math.floor(r() * reach.length))]
  const choices = [{ value, key: null }, ...picked]
    .sort((a, b) => a.value - b.value)
    .map((c) => ({ label: pct(c.value), value: c.value, right: c.key == null, mistake: c.key }))
  const where = d.peakAt === 0
    ? `Your ${pickLabel(mine)} account's high was the ${dollars(START)} start.`
    : `Your ${pickLabel(mine)} account peaked at ${dollars(d.peak)} ${atText(d.peakAt)}.`
  return {
    key: 'deep', no: noOf('deep'), tag: 'Your worst fall', question: 'How deep was your worst drawdown?',
    detail: `${where} Its low after that was ${dollars(d.low)}, ${atText(d.lowAt)} (${windowText(d)}).`,
    choices, labels: choices.map((c) => c.label), answer: pct(value), value, mine,
    lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.bps])),
  }
}

/** The run's three questions for the member's pick, in ORDER. The streak question never shows the member's own fall, so
 *  the depth question that follows is never answered on screen before it is asked. (A depth tile may repeat a number the
 *  streak question showed: another line's fall is often exactly what the streak took on that line. That gives nothing
 *  away, and keeping the tiles off those numbers piled the answer onto one place.) Each falls back to the seed-0 deal,
 *  which `fits` proved deals. */
export function questionsFor(stretch, mine, seed = 0) {
  const p = pickOf(stretch, mine)
  if (!p || !(p.deep.dd > 0)) return []
  const mineFall = pct(fallOf(p.deep.peak, p.deep.low))
  const streak = streakQuestion(stretch, mine, seed, [mineFall]) || streakQuestion(stretch, mine, 0, [mineFall])
  if (!streak) return []
  const deep = deepQuestion(stretch, mine, seed) || deepQuestion(stretch, mine, 0)
  if (!deep) return []
  const by = { streak, deep, line: lineQuestion(stretch) }
  return ORDER.map((k) => by[k])
}

/** The choice a tile carries, or null. */
export const choiceOf = (q, label) => q.choices.find((c) => c.label === label) || null
export const isRight = (q, label) => !!choiceOf(q, label)?.right

/** The verdict a checked answer opens on. */
export function headlineOf(q, label) {
  const c = choiceOf(q, label)
  if (c?.right) return q.key === 'streak' ? 'Compounded right.' : q.key === 'line' ? 'You found the line.' : 'Measured from the peak.'
  if (q.key === 'streak') return STREAK_MISTAKES[streakFamily(c?.mistake)]?.title || 'Not this one.'
  if (q.key === 'line') return c?.mistake === 'fewer' ? 'Deeper than that.' : 'Not that deep.'
  return DEEP_MISTAKES[mistakeFamily(c?.mistake)]?.title || 'Not this one.'
}

const fallText = (p) => pct(fallOf(p.deep.peak, p.deep.low))
/** The 50% line's facts in a line: the picks that crossed the line and the deepest that did not. */
function lineFacts(stretch) {
  const fell = stretch.picks.filter((p) => p.deep.dd >= LINE)
  const held = stretch.picks.filter((p) => p.deep.dd < LINE)
  const near = held[held.length - 1]
  if (!fell.length) return `None did. The deepest was ${pickText(near.bps)}, down ${fallText(near)} from its peak.`
  const list = fell.map((p) => `${pickText(p.bps)} fell ${fallText(p)}`).join(' and ')
  return `${list} from the peak.${near ? ` ${pickText(near.bps)} fell ${fallText(near)}.` : ''}`
}

/** The streak question's one line: the compounding on a right answer, the mistake named on its own numbers on a miss. */
function streakWhy(q, c) {
  const fall = pct(q.value)
  if (!c || c.right) return `Each loss keeps ${keepText(q.at)} of what was left. ${q.n} in a row keep ${pct(q.left)}, so they take ${fall}.`
  switch (streakFamily(c.mistake)) {
    case 'added': return `Adding them up gives ${pct(c.value)}. Each loss comes off what the last one left, so ${q.n} take ${fall}.`
    case 'left': return `${pct(c.value)} is what is left after ${q.n} losses. They take ${fall}.`
    case 'climb': return `${pct(c.value)} is the gain to get back from there. The ${q.n} losses take ${fall}.`
    case 'count': return `${pct(c.value)} is ${c.n} losses. The streak was ${q.n} in a row, and ${q.n} take ${fall}.`
    case 'risk': return `${pct(c.value)} is what ${q.n} losses take at ${pickText(c.bps)}. At ${pickText(q.at)} they take ${fall}.`
    default: return `${q.n} losses in a row at ${pickText(q.at)} take ${fall}.`
  }
}

/** The one line under the verdict (the takeover cannot scroll, so it stays one line): the facts on a right answer, the
 *  mistake named on its own numbers on a miss. */
export function whyLine(q, stretch, label) {
  const c = choiceOf(q, label)
  if (q.key === 'streak') return streakWhy(q, c)
  if (q.key === 'line') return lineFacts(stretch)
  const p = pickOf(stretch, q.mine)
  const d = p.deep
  const fall = pct(q.value)
  if (!c || c.right) return `${dollars(d.peak)} down to ${dollars(d.low)} is ${fall}. Getting back needs ${signedPct(climbOf(d.peak, d.low))}.`
  switch (mistakeFamily(c.mistake)) {
    case 'climb': return `${pct(c.value)} is the gain from ${dollars(d.low)} back to ${dollars(d.peak)}. The fall itself was ${fall}.`
    case 'start': return `A drawdown runs from the peak, ${dollars(d.peak)}, not the ${dollars(START)} start. The fall was ${fall}.`
    case 'added': return `Adding the trades up gives ${pct(c.value)}. Each one comes off what the last one left, so the fall was ${fall}.`
    case 'oneLoss': return `One loss at ${pickLabel(q.mine)} is ${pct(c.value)}. The drawdown is the whole fall from the peak: ${fall}.`
    case 'line': return `${pct(c.value)} was the ${pickLabel(q.lines[c.mistake])} line's worst fall. Yours, at ${pickLabel(q.mine)}, was ${fall}.`
    default: return `The fall was ${fall}.`
  }
}

/** The working for the coach's card: { title, steps, rule, source }. */
export function workingOf(q, stretch) {
  if (q.key === 'streak') {
    const big = PICKS[PICKS.length - 1]
    const half = halfRun(big)
    const many = MANY[WIN_PCT]
    return {
      title: `What ${q.n} losses in a row take at ${pickLabel(q.at)}`,
      steps: [
        `The streak: ${q.n} losses in a row, trades ${q.from} to ${q.to}.`,
        `Each loss takes ${pickLabel(q.at)} of the account as it stands, so it keeps ${keepText(q.at)} of what was left.`,
        `Keep ${keepText(q.at)}, ${q.n} times over, and ${pct(q.left)} is left. The streak takes ${pct(q.value)}.`,
        `Getting back from there needs ${signedPct(q.climb)}.`,
        ...(q.contrast ? [`At our ${pickLabel(q.contrast.bps)} ceiling, the same ${q.n} losses take ${pct(q.contrast.value)}.`] : []),
        // how common a streak that halves 10% is, from the many stretches (counts, never a percent that could repeat a fall)
        `Across ${group(MANY_N)} stretches of this game, ${group(many.streak)} dealt ${half.n} or more losses in a row.`
          + (q.at === big && q.n === half.n ? '' : ` At ${pickText(big)}, ${half.n} take ${pct(half.fall)}.`),
      ],
      rule: LESSON_STREAK,
      source: SOURCE_EDGE,
    }
  }
  if (q.key === 'line') {
    return {
      title: 'The deepest fall for each pick',
      steps: [
        'A drawdown runs from a high to the low after it, before a new high.',
        lineFacts(stretch),
        manyHalfLine(),
      ],
      rule: LESSON_RECOVER,
      source: SOURCE_RECOVER,
    }
  }
  const p = pickOf(stretch, q.mine)
  const d = p.deep
  return {
    title: `How deep ${pickText(q.mine)} fell`,
    steps: [
      d.peakAt === 0 ? `The peak: the ${dollars(d.peak)} start.` : `The peak: ${dollars(d.peak)}, ${atText(d.peakAt)}.`,
      `The low after it: ${dollars(d.low)}, ${atText(d.lowAt)} (${windowText(d)}).`,
      `1 ${MINUS} ${dollars(d.low)} / ${dollars(d.peak)} = ${pct(q.value)}.`,
      `Back up from ${dollars(d.low)} to ${dollars(d.peak)} is ${signedPct(climbOf(d.peak, d.low))}.`,
    ],
    rule: LESSON_RULE,
    source: SOURCE_RULE,
  }
}

/** The five falls for the 50% line's bars: [{ bps, dd, crossed }], smallest pick first. */
export const fallsOf = (stretch) => stretch.picks.map((p) => ({ bps: p.bps, dd: fallOf(p.deep.peak, p.deep.low), crossed: p.deep.dd >= LINE }))

// ── many stretches: the same game, 10,000 times ─────────────────────────────────────────────────────────────────
/** One stretch is one draw of luck. The end screen shows the same bag played MANY_N times, every draw kept (no
 *  tidy-reading filter): seeds MANY_FIRST_SEED onward, each through rngOf, fifty marbles each. */
export const MANY_N = 10000
export const MANY_FIRST_SEED = 1
/** A smaller real edge: 3 winners in 10 at the same +2.5R. Still a winning system, 30% × 2.5R − 70% × 1R = +0.05R a
 *  trade, and the kind of gap between the promised edge and the real one a trader never sees for sure (F9.03 q26). */
export const SMALL_WIN_PCT = 30
export const SMALL_EDGE_R100 = (SMALL_WIN_PCT * WIN_R10 - (100 - SMALL_WIN_PCT) * LOSS_R10) / 10
export const SMALL_EDGE_TEXT = `+${SMALL_EDGE_R100 / 100}R`

/** The many stretches measured, for a bag with `winPct` winners in 100, over `n` seeds from `first`. For each pick, in
 *  PICKS order: how many stretches it finished highest in (`top`), fell 50% or more from a peak (`half`), fell 30% or more
 *  (`deep30`), finished below the start (`below`); the middle finish (`median`: the finish at place (n − 1) / 2 from the
 *  bottom, rounded down) and the finish a tenth of the way up (`p10`: place (n − 1) / 10), in whole dollars. Then how many
 *  stretches dealt 7 or more losses in a row (`streak`: the run that takes half the account at 10% a trade). Measured on
 *  the exact path, so a fall is the definition's (F9.04 f08), not a rounding of it. */
export function manyOf(winPct = WIN_PCT, n = MANY_N, first = MANY_FIRST_SEED) {
  const zero = () => PICKS.map(() => 0)
  const out = { winPct, n, top: zero(), half: zero(), deep30: zero(), below: zero(), median: [], p10: [], streak: 0 }
  const finals = PICKS.map(() => [])
  const longRun = halfRun(PICKS[PICKS.length - 1]).n
  for (let i = 0; i < n; i++) {
    const wins = bagDraw(rngOf(first + i), TRADES, winPct)
    if (longestLosing(wins).length >= longRun) out.streak += 1
    let top = 0
    PICKS.forEach((bps, k) => {
      const path = pathOf(wins, bps)
      const dd = deepestOf(path).dd
      const end = path[path.length - 1]
      finals[k].push(end)
      if (dd >= LINE) out.half[k] += 1
      if (dd >= 0.3) out.deep30[k] += 1
      if (end < START) out.below[k] += 1
      if (end > finals[top][i]) top = k
    })
    out.top[top] += 1
  }
  finals.forEach((list) => {
    const sorted = list.slice().sort((a, b) => a - b)
    out.median.push(Math.round(sorted[Math.floor((n - 1) / 2)]))
    out.p10.push(Math.round(sorted[Math.floor((n - 1) / 10)]))
  })
  return out
}

/** manyOf(40) and manyOf(30), worked once and pinned (the unit test recomputes both from the definition), so the screen
 *  never plays 10,000 stretches. */
export const MANY = {
  [WIN_PCT]: {
    winPct: 40, n: 10000,
    top: [547, 0, 457, 587, 8409],
    half: [0, 0, 0, 520, 5958],
    deep30: [0, 0, 88, 5209, 9746],
    below: [547, 547, 547, 1004, 1591],
    median: [110304, 121209, 144733, 226339, 367685],
    p10: [101096, 101880, 102507, 97188, 71144],
    streak: 4197,
  },
  [SMALL_WIN_PCT]: {
    winPct: 30, n: 10000,
    top: [4462, 0, 1211, 1177, 3150],
    half: [0, 0, 3, 3422, 9115],
    deep30: [0, 2, 1352, 8693, 9988],
    below: [4462, 4462, 4462, 5673, 6850],
    median: [101096, 101880, 102507, 97188, 71144],
    p10: [94286, 88662, 77786, 49420, 19119],
    streak: 7583,
  },
}

/** A count of stretches as it reads on screen: "5,958" · "none". */
export const countText = (k) => (k ? group(k) : 'none')
const atPick = (m, key, bps) => m[key][PICKS.indexOf(bps)]

/** The 50% line's working, from the many stretches: "Across 10,000 stretches of this game, 10% a trade fell by half or
 *  more in 5,958, 5% in 520, 2% in none." Counts, never a percent that could read as a fall. */
export function manyHalfLine() {
  const m = MANY[WIN_PCT]
  const [ten, five, two] = [PICKS[4], PICKS[3], RULE_MAX_BPS]
  return `Across ${group(MANY_N)} stretches of this game, ${pickText(ten)} fell by half or more in ${countText(atPick(m, 'half', ten))}, `
    + `${pickLabel(five)} in ${countText(atPick(m, 'half', five))}, ${pickLabel(two)} in ${countText(atPick(m, 'half', two))}.`
}

/** The long-run growth a trade (the expected log return) at `bps` risk on a bag of `winPct` gold in 100, winners at
 *  WIN_R10 / 10 R and losers at -1R. Positive grows the account over many trades; negative shrinks it, whatever the
 *  average R says. The pick with the most of it is the one that grows the account fastest over time (the Kelly idea:
 *  on 3 in 10 at +2.5R that is exactly 0.3 - 0.7 / 2.5 = 2%). */
export function growthPerTrade(winPct, bps) {
  const p = winPct / 100, f = bps / 10000
  return p * Math.log(1 + f * (WIN_R10 / 10)) + (1 - p) * Math.log(1 - f)
}

/** Of the five picks, the one that grows the account fastest over many trades on this bag, and the ones that shrink it. */
export function growthOfPicks(winPct) {
  const g = PICKS.map((bps) => ({ bps, g: growthPerTrade(winPct, bps) }))
  const fastest = g.reduce((a, b) => (b.g > a.g ? b : a)).bps
  return { fastest, shrink: g.filter((x) => x.g < 0).map((x) => x.bps) }
}

/** "Over many trades on 3 in 10, 2% grows the account fastest. 5% and 10% shrink it." from growthOfPicks. */
export function smallGrowthLine(winPct) {
  const { fastest, shrink } = growthOfPicks(winPct)
  const names = shrink.map(pickLabel)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `Over many trades on ${winPct / 10} in 10, ${pickLabel(fastest)} grows the account fastest.` + (list ? ` ${list} shrink${names.length > 1 ? '' : 's'} it.` : '')
}

/** The end screen's panel: the same game 10,000 times, on the promised bag and on one a little worse. `rows` are the
 *  drawing (per pick, how many stretches fell by half or more on each bag); `lines` the mentor's reading of it. No line
 *  says bigger risk is better: the one fact in its favour (10% finished highest most often on the promised bag) is said
 *  with what it needs, an edge that big and known for sure, and beside what the same risk does on a smaller edge. */
export function manyPanel() {
  const a = MANY[WIN_PCT], b = MANY[SMALL_WIN_PCT]
  const ten = PICKS[PICKS.length - 1], two = RULE_MAX_BPS
  const bag = (pctWin) => `${pctWin / 10} in 10`
  const twoHalf = (m) => (atPick(m, 'half', two)
    ? `${pickText(two)} fell by half in ${countText(atPick(m, 'half', two))} of them.`
    : `${pickText(two)} never did, in any of the ${group(m.n)}.`)
  return {
    eyebrow: `Across ${group(MANY_N)} stretches`,
    title: `One stretch is one draw. Here is the same game ${group(MANY_N)} times.`,
    bags: [{ key: 'big', label: `${bag(WIN_PCT)} win, ${EDGE_TEXT}` }, { key: 'small', label: `${bag(SMALL_WIN_PCT)} win, ${SMALL_EDGE_TEXT}` }],
    rows: PICKS.map((bps) => ({ bps, big: atPick(a, 'half', bps), small: atPick(b, 'half', bps) })),
    n: MANY_N,
    lines: [
      `On this bag, ${bag(WIN_PCT)} at ${WIN_TEXT}, ${pickText(ten)} fell by half or more in ${countText(atPick(a, 'half', ten))} of them. ${twoHalf(a)}`,
      `${pickText(ten)} did finish highest in ${countText(atPick(a, 'top', ten))} of them. Big risk only pays like that on a big edge you know for sure.`,
      `You never know your real edge for sure. Make the bag ${bag(SMALL_WIN_PCT)}, still ${SMALL_EDGE_TEXT} a trade: ${pickText(ten)} fell by half in ${countText(atPick(b, 'half', ten))} and finished below the start in ${countText(atPick(b, 'below', ten))}. ${twoHalf(b)}`,
      smallGrowthLine(SMALL_WIN_PCT),
      `The middle stretch at ${pickText(ten)}: ${dollars(atPick(a, 'median', ten))} on ${bag(WIN_PCT)}, ${dollars(atPick(b, 'median', ten))} on ${bag(SMALL_WIN_PCT)}. At ${pickLabel(two)}: ${dollars(atPick(a, 'median', two))} and ${dollars(atPick(b, 'median', two))}.`,
      `A 50% fall needs +100% to get back. That is why our ceiling is ${pickLabel(two)}.`,
    ],
    source: SOURCE_MANY,
  }
}

// ── the chart ───────────────────────────────────────────────────────────────────────────────────────────────────
/** The y range (dollars, for a log scale) that holds every series, padded a little in log space. `doubling` also
 *  reaches the nearer of half and double the start when the lines alone would show only one doubling gridline, so a
 *  full gridline (a 50% fall, a 100% gain) is always on the chart to measure against, and no band of it sits empty. */
export function domainOf(series, doubling = false, pad = 0.06) {
  let lo = Infinity, hi = -Infinity
  for (const s of series) for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v }
  if (!Number.isFinite(lo) || !(lo > 0)) { lo = START; hi = START }
  if (doubling && ticksOf(lo, hi, true).length < 2) {
    lo = Math.min(lo, START); hi = Math.max(hi, START)
    if ((START * 2) / hi <= lo / (START / 2)) hi = START * 2
    else lo = START / 2
  }
  if (hi / lo < 1.02) { lo /= 1.01; hi *= 1.01 }
  const a = Math.log(lo), b = Math.log(hi), span = b - a
  return [Math.exp(a - span * pad), Math.exp(b + span * pad)]
}

/** A tidy step: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span, target = 4) {
  if (!(span > 0)) return 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
}

/** The gridlines inside [lo, hi]: the start doubled and halved (`doubling`), or tidy dollar steps. */
export function ticksOf(lo, hi, doubling = false) {
  const out = []
  if (doubling) {
    for (let k = Math.floor(Math.log2(lo / START)); k <= Math.ceil(Math.log2(hi / START)); k++) {
      const v = START * 2 ** k
      if (v >= lo && v <= hi) out.push(v)
    }
    return out
  }
  const st = niceStep(hi - lo, 4)
  for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(Math.round(v * 100) / 100)
  return out
}

/** Labels at the right end of each line, pushed apart so none overlaps: `ys` in screen pixels (any order), at least
 *  `gap` apart, inside [top, bottom], each keeping its order. */
export function spreadLabels(ys, gap, top, bottom) {
  const idx = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b] || a - b)
  const out = ys.slice()
  let prev = -Infinity
  for (const i of idx) { out[i] = Math.max(ys[i], top, prev + gap); prev = out[i] }
  let next = Infinity
  for (let j = idx.length - 1; j >= 0; j--) { const i = idx[j]; out[i] = Math.min(out[i], bottom, next - gap); next = out[i] }
  return out
}

/** The losers in a row that end at trade `step` (0 when the last trade won, or before the first). */
export function losingRunAt(wins, step) {
  let n = 0
  for (let i = Math.min(step, wins.length) - 1; i >= 0 && !wins[i]; i--) n += 1
  return n
}

/** The state of the curve after `step` trades, for the live header and the chart's readout: the balance, the running
 *  peak, the fall under it, the last trade (win or loss, and its dollars) and the losers in a row ending there. */
export function liveAt(stretch, bps, step) {
  const p = pickOf(stretch, bps)
  const i = Math.max(0, Math.min(stretch.n, Math.floor(step)))
  const bal = p.balances[i]
  const peak = Math.max(...p.balances.slice(0, i + 1))
  const last = i > 0 ? { win: stretch.wins[i - 1], amount: p.balances[i] - p.balances[i - 1] } : null
  return { step: i, balance: bal, peak, under: fallOf(peak, bal), last, streak: losingRunAt(stretch.wins, i), done: i >= stretch.n }
}

/** The chart's readout at trade `i`: "Trade 23 · lost 1R · $118,240, 4.2% under its peak" (or "at its high"). Until the
 *  depth question is checked (`fall` false) it gives the peak in dollars instead of the percent, so sliding to the low
 *  never answers that question: "Trade 23 · lost 1R · $118,240, its peak $123,420". */
export function readoutAt(stretch, bps, i, fall = true) {
  const st = liveAt(stretch, bps, i)
  const what = st.last ? (st.last.win ? `won ${WIN_R10 / 10}R` : `lost ${LOSS_R10 / 10}R${st.streak > 1 ? `, ${st.streak} in a row` : ''}`) : 'the start'
  const where = !(st.under > 0) ? 'at its high' : fall ? `${pct(st.under)} under its peak` : `its peak ${dollars(st.peak)}`
  return `${st.step ? `Trade ${st.step}` : 'Start'} · ${what} · ${dollars(st.balance)}, ${where}`
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** One run's id for POST /api/study/game-runs (idempotent per id on the server). */
export const runIdOf = (seed, n = 0) => `survive-${Math.abs(Math.floor(Number(seed) || 0)).toString(36)}-${n}`
