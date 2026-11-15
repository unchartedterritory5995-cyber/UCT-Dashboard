// TRADE STORY, the rules (docs/study/GAMES.md §3, kind 'story'). Pure: no React, no clock, no Math.random(); every number
// the game shows or scores is computed here from the plan the server sends and the bars that followed, or read from the
// server's reveal.
//
// THE PLAY. A real setup fired on the last candle of a chart (POST /api/study/spot-setup with `need_plan`: a chart whose
// last candle is its setup and nothing else, and whose setup has a trade plan). The member names it (scored on the server
// through /attempts, Hard mode's answer), and the trade is entered on that setup's own plan: the reveal's `trade`
// (api/services/study_trade.py: the detector's entry and stop, the marks at 3R and 5R, the trail in the detector's words;
// docs/study/TRADE_PLANS.md). Then the bars after the signal replay, and the replay STOPS at each moment the plan
// defines, and only there:
//   3R reached         a mark on the ruler: the stop moves up to breakeven; a sell only where the day and the move say so
//   5R reached         in the 5 to 10R zone: a first sell into strength is often best from day 3 on; then the trail
//   the post-gap high  the plan's own place to take some off (Gap Support, below)
//   the first return   back at the high-volume close (High Volume Edge's decision point, below; not scored until the
//                      owner rules what the plan does there)
//   the stop trades    the plan is out of what is left (the plan's stop before 3R, breakeven after it)
//   the trail breaks   the plan is out of what is left (only where the plan names a trail the bars can measure)
// At each stop the member picks Hold, Sell some, or Sell the rest (Cover some, Cover the rest on a short). Between them
// nothing is asked.
//
// THE OWNER'S RULINGS, 2026-11-12 (docs/study/setups/RULINGS_2026-11-12.json; the Flat Base card's `management` and its
// fb.trim_1, fb.trim_2, fb.trim_gap_open, fb.breakeven and fb.trail carry the same words). They replaced the account
// rulebook's trims (docs/study/sizing_rule.md §9: B19 "a third at 3R", E51 "a third at 5R", F63 "a trim level the day
// opens past is taken at the open"), which this game used to score:
//   D-013     "sometimes it is not R based. SOmetimes it is day based. Looking for 3-5-7 day push for our first sell", and
//             in chat, "I very rarely sell on the day 1 of the buy day. I usually wait until day 3 at the earliest. SO
//             3-5-7 day or 5-10 R is often best." The first sell is a judgment, later sells are a judgment too, and what is
//             left trails. No call may key "sell a third at 3R", or any day-1 sell, as the right one.
//   breakeven the stop may move to breakeven between 2R and 5R, or at the first sell (fb.breakeven; B19's window stands).
//             This replay moves it at 3R, inside that window, whatever the member did, as it always has.
//   GAP-TRIM  "Optional, my judgment": a gap up past a level at the open is not an automatic sell; selling part into a big
//             gap is a judgment, never a rule.
//   D-021     the trail reads the 9 EMA and the 20 EMA (the plans' words, study_trade.PLANS), never the 10-day or 21-day.
//   B20       a gap through the stop: the first 30-minute low of the gap day is the new stop, out if the first 30 minutes
//             take the loss past 2R. A daily chart cannot see that bar, so the replay fills at the open ("A stop cannot
//             catch an overnight gap", VOICE.md §3) and the why says the house rule in one sentence (B20 stands: the Flat
//             Base card's `gap_against`)
//   E57       entries are market orders
// THE DAY. He counts the buy day as day 1 (the course does too: "By noon on the same day ... Rarely sell on day 1"), so
// the signal day, where every plan buys, is day 1 and session k after it is day k + 1 (hardMode.dayName). Every day this
// game names is counted that way, so "day 3" on the screen is his day 3.
// THE CALLS ON THE PLAN, at a mark (3R, 5R, the post-gap high, or two of them on one bar), read in this order:
//   early  day 1 or day 2                                   Hold only: we very rarely sell that early
//   zone   about 5R or more (5R itself, or a fill there)    Sell some is the best call; Hold is a judgment too
//   push   day 3 on, a 3, 5 or 7 day push into it           Sell some is the best call; Hold is a judgment too
//   named  the post-gap high, day 3 on                      Sell some is the best call (the plan's own words); Hold too
//   gap    it opened past the level, day 3 on               Hold is the best call; selling part is optional (GAP-TRIM)
//   mark   none of these: a mark on the ruler, nothing more Hold only: 3R alone is never a reason to sell
// A PUSH is days in a row, ending on the day the mark traded, each trading over the high of the day before; the buy day
// is the first day of a push that runs from it (pushDays). It is known when the replay stops: the mark's own day has
// already traded over the day before (a mark is reached on a new high for the trade), and the days before it are whole.
// Sell the rest is on the plan only at the stop and where the trail breaks. A point carries `answer` (the plan's best
// call, which the plan's own exits follow) and `calls` (every call on the plan there, the best first).
// THE SIZE. Sell some is part of the position; nothing here weighs the parts, so the result is never one R number for the
// whole trade: it is the R of each exit, side by side with the plan's. The server's plan carries the marks as trim_r
// [3, 5] (hardMode.trimR reads it; an older plan without it reads the same) and breakeven_at "t1".
//
// THE PLACES THE PLANS NAME (the owner, 2026-11-09, on the two notes in study_trade.PLANS: "yes add those stops too").
// THE POST-GAP HIGH (Gap Support: "the post-gap high is the first place to take some off"). The detector
// (uct_gap_support.py) builds the setup on one up-gap: the most recent true gap of 4% or more, on twice the 50-day volume,
// that held on its day, within 60 sessions, never closed back into, and tested by the signal day (its _first_passing).
// postGapHigh finds that same gap with the detector's own arithmetic on the same bars the server read, and the level is
// the highest high from the gap day through the entry day: the highest price the stock traded after the gap, on the
// chart the member saw. The detector's pullback test measures from the run's high before the test day; that is the same
// price on 5 of the 6 real Gap Support charts in the bank fixtures, and on the sixth (GOOGL 2023-02-07) the test day
// itself traded to 108.18, over the run's 107.85, so 108.18 is the post-gap high on the screen. The replay stops the
// first session after the entry whose high reaches it, while it sits at least a cent over the entry and the trade is
// still open (a session that hits the stop ends the trade before its high counts, as hardMode.reviewTrade reads it).
// From day 3 on the plan takes some off there (its own words; holding is a judgment too); on day 1 or 2 it holds (D-013).
// A sell fills at the level, or at the open on a day that opened over it. On the same bar as 3R or 5R the replay asks
// once and says both (it joins the mark nearest it in price); over 5R it is still asked.
// THE FIRST RETURN TO THE HIGH-VOLUME CLOSE (High Volume Edge: "the first return to the high-volume close, often weeks
// later, is the cleanest decision point"). The high-volume close is the entry. The first return: after at least one
// close over the entry (under it, on a short), the first LATER session whose low trades at or under the entry (high at
// or over, on a short), while that session does not hit the stop and the trade is still open. A day that dips to the
// close and closes back over it before any close away from it has not left the level, so it is not a return. An exit
// there fills at the entry, or at the open on a day that opened past it. On a session that also reaches a mark the
// mark is asked first (a daily bar does not say which came first). What the plan does there is not ruled yet
// (HVE_RETURN_CALL): until it is, the replay asks, says the plan's words and its stop, and scores nothing, either way.
// From 3R the stop IS the entry, so a return to the high-volume close from then on is the breakeven stop trading, not a
// decision point: the replay stops there as the stop.
//
// THE BREAKEVEN STOP, MEASURED. hardMode.reviewTrade reads the bars on the plan's ORIGINAL stop (when each mark traded,
// when the stop did). From the session after 3R traded, this replay reads the bars itself: the first bar whose low
// trades at or under the entry (high at or over it, on a short) exits what is left at the entry, or at the open when the
// day opened past it. A bar that hits the breakeven stop ends the trade before its range counts (the way reviewTrade
// reads a stop), so a 5R reached on or after that bar is not a point. reviewTrade's stop after 3R is never used: the
// breakeven stop replaces it (it sits closer than the plan's stop, so nothing is missed).
//
// THE TRAIL, MEASURED (the plans' own words). Four plans name "under each higher low" (the Kicker, the Oops Reversal, the
// Slingshot, the Launchpad; three of them offer the 9 or 20 EMA as the other way, which the bars here do not carry). From
// 5R on, the stop on what is left starts at breakeven and is lifted by the higher lows, read off the bars: a day whose
// low sits under the lows of the days either side of it, and above the low before it (the signal day's low for the
// first one). The stop moves up under each one once the day after it has printed, never down, and the trail breaks when
// price trades under it; until a higher low has lifted it, the trail IS the breakeven stop. A plan with no trail (the
// High Volume Edge) or one whose trail is not a level the bars can place (the Gap Support's "if it drifts sideways at the
// gap") keeps what is left on the breakeven stop.
//
// HOW THE BARS ARE READ. hardMode.reviewTrade, the review Hard mode, Draw it and Weekend Watchlist already draw: when each
// mark traded, when the plan's stop did (a bar that reaches the stop ends the trade before its extreme counts), with the
// Kicker's and the Oops's same-day entry. A stop or a trail that the day OPENED beyond fills at the open: "A stop cannot
// catch an overnight gap" (the owner's own line, docs/study/VOICE.md §3; the house gap rule, B20, is said in the why). A
// mark the day opened past is where a sell would fill at the open (the level never printed that day, so the replay never
// says it "traded" there). Every exit's R is measured the same way, on the fill and the plan's own prices to the cent,
// so each R agrees with the prices on the screen.
// Stable on a prefix: the points found on the first L sessions are the points of the whole strip up to session L.
import { SELL_ZONE_R, dayName, reviewTrade, sellTooEarly, timesWord, trimLabels, trimR, withArticle } from '../hardMode'
import { SETUP_SKILLS } from '../challengeBank'

export const STORY_KIND = 'story'
export const STORY_TOTAL = 4
export const STORY_VIEW = 90           // sessions the question frames before the answer (a phone frames fewer)
export const STORY_VIEW_PHONE = 60
export const STORY_SOURCE = 'Our trade plans and rules · course unit F10.05, Trims, trails and scaling out'
export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
export const FAILED_LINE = 'The trades did not load. Check your connection and try again.'
/** Why the result is never one number for the whole trade: each sell is part of the position, each with its own R. */
export const EXIT_NOTE = 'Each sell is part of the position, and what is left trails, so each exit shows its own R.'
/** The trade question on the last candle. */
export const ENTRY_Q = 'A setup fired on the last candle. Which one?'
export const ENTRY_DETAIL = 'Name it, and you take the trade on its own plan: the entry, the stop, and the 3R and 5R marks.'
/** A chart whose answer could not be scored, and a reveal that came back without its plan. */
export const NOT_SCORED = 'This chart could not be scored. Skip it and the next one loads.'
export const NO_PLAN = 'No trade plan came back for this chart, so there is nothing to manage. On to the next one.'
/** A trade where nothing on the plan traded in the sessions there are. */
export const NOTHING_TRADED = 'Nothing on the plan traded in the sessions shown: no mark, no stop.'

/** The setups that come with a trade plan (study_trade.PLANS). The Bear gap has none, so it never plays here. */
export const PLAN_SKILLS = Object.freeze(['setup.family3.kicker', 'setup.family1.launchpad', 'setup.family4.slingshot', 'setup.family4.oops',
  'setup.family3.hve', 'setup.family3.gap_support'])
export const STORY_SETUPS = Object.freeze(PLAN_SKILLS.map((k) => SETUP_SKILLS[k]))
export const GAP_SUPPORT = 'setup.family3.gap_support'
export const HVE = 'setup.family3.hve'

// ── the three calls ───────────────────────────────────────────────────────────────────────────────────────────────────
export const HOLD = 'hold'
export const TRIM = 'trim'      // Sell some: part of the position (the id keeps its name; the tile never says a fraction)
export const ALL = 'all'
export const ACTIONS = Object.freeze([HOLD, TRIM, ALL])

/** THE READS AT A MARK and the calls on the plan for each, the best first (the header: D-013, GAP-TRIM). */
export const READS = Object.freeze({
  early: Object.freeze([HOLD]),
  zone: Object.freeze([TRIM, HOLD]),
  push: Object.freeze([TRIM, HOLD]),
  named: Object.freeze([TRIM, HOLD]),
  gap: Object.freeze([HOLD, TRIM]),
  mark: Object.freeze([HOLD]),
})
/** "Looking for 3-5-7 day push for our first sell" (D-013): a push of this many days or more. */
export const PUSH_DAYS = 3

/** THE PUSH into session `s` (the header): the days in a row, ending on `s`, each trading over the high of the day
 *  before (under the low, on a short); when the run reaches back to the buy day (the signal, session 0), the buy day is
 *  its first day. 0 for a session that did not trade past the day before. */
export function pushDays(signal, forward, s, long = true) {
  const fwd = Array.isArray(forward) ? forward : []
  if (!signal || !Number.isInteger(s) || s < 0 || s > fwd.length) return 0
  let n = 0
  for (let k = s; k >= 1; k--) {
    const prev = k === 1 ? signal : fwd[k - 2]
    if (!(long ? fwd[k - 1].h > prev.h : fwd[k - 1].l < prev.l)) return n
    n += 1
  }
  return n + 1
}

/** Is `pick` a call on the plan at this point? (Every call in `calls`; a point from before them reads its `answer`.) */
export const onPlan = (point, pick) => pick != null && (Array.isArray(point?.calls) ? point.calls : [point?.answer]).includes(pick)

/** THE CALL AT THE FIRST RETURN TO THE HIGH-VOLUME CLOSE, not yet confirmed by the owner (2026-11-09). null: the replay
 *  stops there and asks, says the plan's words and its stop, and counts the call neither right nor wrong. 'hold' |
 *  'trim' | 'sell': scored like every other stop ('sell' is Sell the rest, and ends the trade there). */
export const HVE_RETURN_CALL = null
/** The call a ruling names, as the game's own: null for none (or anything else). */
export const hveAnswer = (call) => (call === 'hold' ? HOLD : call === 'trim' ? TRIM : call === 'sell' ? ALL : null)
/** The two plan notes, in study_trade.PLANS' own words (the plan's `trim_note` wins when the reveal carries it). */
export const PGH_NOTE = 'the post-gap high is the first place to take some off'
export const HVC_NOTE = 'the first return to the high-volume close, often weeks later, is the cleanest decision point'
export const trimNote = (plan) => plan?.trim_note || (plan?.skill === GAP_SUPPORT ? PGH_NOTE : plan?.skill === HVE ? HVC_NOTE : null)
/** The two plan-named decision points' names inside a sentence, and their short names in a tag. The marks (t1, t2) are
 *  named by their label, '3R' and '5R' (the plan's trim_r). */
const NAMED = Object.freeze({ pgh: 'the post-gap high', hvc: 'the high-volume close' })
const SHORT = Object.freeze({ pgh: 'post-gap high', hvc: 'high-volume close' })
const isTarget = (id) => id === 't1' || id === 't2'
/** A point's or a leg's name inside a sentence: a mark by its label, the others by their name. */
const nameOf = (x) => (isTarget(x.id) ? x.label : NAMED[x.id])
const shortOf = (x) => (isTarget(x.id) ? x.label : SHORT[x.id])

/** The tile's words. A partial sell is "some" (D-013: the size and the moment are a judgment, never a fixed third); a
 *  short is bought back, so its calls are "Cover". */
export function actionLabel(action, long = true) {
  if (action === HOLD) return 'Hold'
  if (action === TRIM) return long ? 'Sell some' : 'Cover some'
  if (action === ALL) return long ? 'Sell the rest' : 'Cover the rest'
  return ''
}

/** Every call on the plan at a point, as a label: "Sell some or hold", "Hold", "Sell the rest". */
export function callsLabel(point, long = true) {
  const calls = Array.isArray(point?.calls) && point.calls.length ? point.calls : [point?.answer]
  return calls.map((a, i) => (i ? actionLabel(a, long).toLowerCase() : actionLabel(a, long))).filter(Boolean).join(' or ')
}

/** What the plan does at a stop, said as the plan doing it ("sells some"). */
function planVerb(action, long) {
  if (action === TRIM) return long ? 'sells some' : 'covers some'
  if (action === ALL) return long ? 'sells the rest' : 'covers the rest'
  return 'holds'
}

// ── numbers, in whole cents so the working on the screen adds up to the cent ─────────────────────────────────────────
const cents = (v) => Math.round(Number(v) * 100)
export const px = (v) => (Number.isFinite(v) ? (cents(v) / 100).toFixed(2) : '')
/** "+2.4R" / "−1.0R" (a true minus sign, the way the chart labels read). One decimal, a tie rounded away from zero the
 *  way a member rounds it by hand: (223.22 − 192.69) ÷ 14.20 = 2.15 reads +2.2R, as 1.25 reads +1.3R (toFixed alone
 *  reads the first +2.1R, because 2.15 is stored a hair under). R here is a ratio of whole cents, so a real value is
 *  never within 1e-9 of a tie it is not on. A value that rounds to nothing reads 0.0R, with no sign. */
export const rText = (r) => {
  if (!Number.isFinite(r)) return ''
  const tenths = Math.round(Math.abs(r) * 10 + 1e-9)
  return `${tenths === 0 ? '' : r > 0 ? '+' : '−'}${(tenths / 10).toFixed(1)}R`
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)

/** A plan this game can play: an entry, a stop on the right side of it, and both marks. */
export function planOk(plan) {
  if (!plan || typeof plan !== 'object') return false
  const { entry, stop, t1, t2 } = plan
  if (![entry, stop, t1, t2].every((v) => Number.isFinite(v)) || entry <= 0) return false
  const long = plan.direction !== 'bearish'
  return long ? (stop < entry && t1 > entry && t2 > t1) : (stop > entry && t1 < entry && t2 < t1)
}

const isLong = (plan) => plan?.direction !== 'bearish'

/** The risk a share, in cents. */
export const riskCents = (plan) => Math.abs(cents(plan.entry) - cents(plan.stop))

/** Where a price sits in R from the entry, on the plan's own entry and stop, both to the cent: (price − entry) ÷ risk on a
 *  long, (entry − price) ÷ risk on a short. null when the plan has no risk. */
export function rAt(plan, price) {
  if (!plan || !Number.isFinite(price)) return null
  const risk = riskCents(plan)
  if (!risk) return null
  const d = cents(price) - cents(plan.entry)
  return (isLong(plan) ? d : -d) / risk || 0     // a short back at its entry is 0, never −0
}

/** The plan's risk as a percent of the entry, one decimal, from whole cents (scaled before the one division, so a tie is
 *  exact and rounds up: 1.01 on 20.00 is 5.05%, read 5.1%). */
export const riskPct = (plan) => (planOk(plan) ? Math.round((riskCents(plan) * 1000) / cents(plan.entry)) / 10 : null)

/** The two marks as the game names them: { t1: { label, r }, t2: { label, r } }, from the plan's trim_r ([3, 5] when a
 *  plan lacks it). */
export function trimsOf(plan) {
  const [m1, m2] = trimR(plan)
  const [l1, l2] = trimLabels(plan)
  return { t1: { label: l1, r: m1 }, t2: { label: l2, r: m2 } }
}

/** Does the plan name a trail the bars can place? The higher lows, on a long (see the header). */
export function trailMeasured(plan) {
  return isLong(plan) && /under each higher low/i.test(String(plan?.trail || ''))
}

/** THE HIGHER LOWS after the signal: forward sessions p (1 = the first day after the signal) whose low sits under the low
 *  of the day before and of the day after, and above the low before it (the signal day's low for the first). Each is
 *  known once the day after it has printed (`known` = p + 1). Equal lows are not a low of their own. */
export function higherLows(signal, forward) {
  const fwd = Array.isArray(forward) ? forward : []
  const out = []
  if (!signal || !Number.isFinite(signal.l)) return out
  let prev = signal.l
  for (let p = 1; p < fwd.length; p++) {
    const left = p === 1 ? signal : fwd[p - 2]
    const mid = fwd[p - 1]
    const right = fwd[p]
    if (!(mid.l < left.l && mid.l < right.l)) continue
    if (mid.l > prev) out.push({ session: p, low: mid.l, known: p + 1 })
    prev = mid.l
  }
  return out
}

/** THE POST-GAP HIGH on a Gap Support chart (the header): `bars` is the chart the member saw, its last bar the setup.
 *  The gap is found the way uct_gap_support.evaluate finds it, with its own numbers and the same arithmetic in the same
 *  order (uct_setups_common: the 50-day volume a running sum, the ATR the plain 14-day mean of the true range), so the
 *  same bars give the same gap: from 2 sessions back to 60 (never before session 51), the first true gap of 4% or more
 *  on twice the 50-day volume that closed over the prior high, whose test passes on the last bar (down at least 1 ATR
 *  from the run's high at the prior close, no close back into the gap, the low within a quarter ATR of the gap top, the
 *  gap day's low or the gap's middle with the close over it, and the close over the gap top). Returns { gap (its
 *  index), top, level (the highest high from the gap day through the last bar), at (that high's index) }, or null. */
export function postGapHigh(bars) {
  const b = Array.isArray(bars) ? bars : []
  const i = b.length - 1
  const sig = b[i]
  if (i < 60 || !sig || !(sig.h >= sig.l && Math.min(sig.o, sig.h, sig.l, sig.c) > 0)) return null
  const v = b.map((x) => Number(x.v) || 0)
  let tr = 0
  for (let k = i - 13; k <= i; k++) tr += Math.max(b[k].h, b[k - 1].c) - Math.min(b[k].l, b[k - 1].c)
  const atr = tr / 14
  if (!atr) return null
  const v50 = []
  let run = 0
  for (let k = 0; k < v.length; k++) { run += v[k]; if (k >= 50) run -= v[k - 50]; v50.push(k >= 49 ? run / 50 : null) }
  for (let g = i - 2; g >= Math.max(51, i - 60); g--) {
    const day = b[g], top = b[g - 1].h, c1 = b[g - 1].c
    if (!c1) continue
    const avg = v50[g - 1]
    if (!(day.l > top && day.o / c1 - 1 >= 0.04 && !!avg && v[g] >= 2 * avg && day.c > top)) continue
    let runHigh = -Infinity, minClose = Infinity
    for (let k = g; k < i; k++) { runHigh = Math.max(runHigh, b[k].h); minClose = Math.min(minClose, b[k].c) }
    const touched = [['top', top], ['glow', day.l], ['gopen', day.o], ['mid', (top + day.l) / 2]]
      .filter(([, lv]) => sig.l <= lv + 0.25 * atr && sig.c > lv).map(([n]) => n)
    const tested = touched.length > 0 && !(touched.length === 1 && touched[0] === 'gopen')
    if (!(runHigh - b[i - 1].c >= atr && minClose > top && tested && sig.c > top)) continue
    let level = -Infinity, at = g
    for (let k = g; k <= i; k++) if (b[k].h > level) { level = b[k].h; at = k }
    return { gap: g, top, level, at }
  }
  return null
}

/** The post-gap high the replay stops at: a Gap Support plan (a long), and a level at least a cent over the entry. */
export function pghLevel(plan, level) {
  return plan?.skill === GAP_SUPPORT && isLong(plan) && Number.isFinite(level) && cents(level) > cents(plan.entry) ? level : null
}

/** A stop the day traded through: filled at the level, or at the open when the day opened beyond it (a gap). */
function fillAt(level, bar, long) {
  const gap = long ? bar.o < level : bar.o > level
  return { fill: gap ? bar.o : level, gap }
}

/** A mark the day reached: a sell there fills at the level, or at the open when the day opened past it (a gap up through
 *  a long's mark, down through a short's): the level itself never printed that day, so the open is where a sell fills
 *  (GAP-TRIM: whether to sell there is a judgment, never a rule). The signal day of a same-day entry is never a gap (the
 *  trade was entered during it). */
function targetFill(level, bar, long, session) {
  const gap = session > 0 && !!bar && (long ? bar.o > level : bar.o < level)
  return { fill: gap ? bar.o : level, gap }
}

const legOf = (p) => ({ id: p.id, label: p.label, level: p.level, fill: p.fill, gap: p.gap, r: p.r, ...(p.breakeven ? { breakeven: true } : {}) })
/** A decision point's levels in the order price reaches them: the two of a post-gap high that traded on the same bar as a
 *  mark, else the point itself. */
export const legsOf = (p) => p?.legs || (p ? [legOf(p)] : [])
/** A point the plan makes no call at (the first return to the high-volume close, until the owner rules): never scored. */
export const isFree = (p) => !!p && p.answer == null

/** THE READ AT A MARK (the header's table, in its order): day 1 or 2 is early whatever the move; then about 5R or more
 *  (5R itself when the plan's second mark is 5R or over, or any level filled there) is the zone; then a push of
 *  PUSH_DAYS or more; then the post-gap high, the plan's own place; then a gap past the level; else a mark and no more. */
export function readOf(p, push, zoneMult = 5) {
  if (sellTooEarly(p.session)) return 'early'
  const legs = legsOf(p)
  if (legs.some((l) => (l.id === 't2' && zoneMult >= 5) || (Number.isFinite(l.r) && l.r >= SELL_ZONE_R))) return 'zone'
  if (push >= PUSH_DAYS) return 'push'
  if (legs.some((l) => l.id === 'pgh')) return 'named'
  if (legs.some((l) => l.gap)) return 'gap'
  return 'mark'
}

/** THE STORY: the decision points the plan defines on these bars, in order, and where the trade ends.
 *  points: [{ id 't1' | 't2' | 'pgh' | 'hvc' | 'stop' | 'trail', label, session (0 = the signal day, for a same-day
 *    entry), level, r (the exit's R, measured like every other number on the screen: the fill on the plan's own prices
 *    to the cent, so 3.0 and 5.0 at the marks unless the day gapped past one or the plan rounded it a cent), fill, gap,
 *    low (the higher low's session, for the trail), answer (the plan's best call: at a mark its read's first call, ALL
 *    at a stop, the ruling at the high-volume close, null while there is none), calls (every call on the plan there, the
 *    best first; [] at a point the plan leaves to the member), at a mark also push (pushDays) and read (readOf),
 *    breakeven (true on the breakeven stop: id 'stop', label 'Breakeven stop', level the entry) }]
 *    A post-gap high on the same bar as a mark is ONE point (id 'pgh') with `legs`, both levels in the order price
 *    reaches them; its level, fill, gap and r are the first leg's (where Sell the rest fills). The first return to the
 *    high-volume close also carries `above`, the session that first closed away from it.
 *  end: { session, kind 'stop' | 'trail' | 'hvc' | 'open', r, breakeven? }   ('open': nothing ended it on the bars there
 *    are; r at the last close; 'hvc': a 'sell' ruling at the first return; breakeven: true when the stop was the
 *    breakeven stop)
 *  trail: the stop on what is left from 5R on, [{ known, level, low }] (each step from the end of session `known`; the
 *    first at breakeven, low null, unless a higher low already sits over it), or null
 *  shown: hardMode.reviewTrade on the bars of the story itself, for the chart's lines and marks (the plan's original stop).
 *  pgh: the post-gap high the replay watches (pghLevel), or null.
 *  t1At: the session 3R traded (the stop is breakeven from the next session), or null.
 *  opts: { pgh: postGapHigh(chart).level, hveCall: the ruling at the first return (HVE_RETURN_CALL when left out) }.
 *  Stable on a prefix: the points found on the first L sessions are the points of the whole strip up to session L. */
export function storyOf(plan, signal, forward, opts = {}) {
  if (!planOk(plan) || !signal) return null
  const fwd = Array.isArray(forward) ? forward : []
  const long = isLong(plan)
  const t = reviewTrade(plan, signal, fwd)
  const labels = trimsOf(plan)
  const be = plan.entry
  let exit = null
  let trail = null
  let t2At = t.t2At
  if (t.t1At == null) {
    // before 3R the stop is the plan's, read the way reviewTrade reads it
    if (t.stoppedSession != null) {
      exit = { id: 'stop', session: t.stoppedSession, level: plan.stop, low: null, breakeven: false, ...fillAt(plan.stop, fwd[t.stoppedSession - 1], long) }
    }
  } else {
    // THE BREAKEVEN STOP (fb.breakeven, inside his 2R to 5R): from the session after 3R traded, a bar at or through the
    // entry exits what is left there, or at the open on a gap; it ends the trade before its range counts, so a 5R on or
    // after it is not a point. Where the plan names a trail the bars can measure, the trail takes over after the 5R bar.
    const trails = t2At != null && trailMeasured(plan)
    const last = trails ? t2At : fwd.length
    for (let s = t.t1At + 1; s <= last; s++) {
      const b = fwd[s - 1]
      if (long ? b.l <= be : b.h >= be) {
        exit = { id: 'stop', session: s, level: be, low: null, breakeven: true, ...fillAt(be, b, long) }
        break
      }
    }
    if (exit && t2At != null && t2At >= exit.session) t2At = null
    if (!exit && trails) {
      // THE TRAIL (the plan's own words): from 5R on, the stop on what is left starts at breakeven (the higher of the
      // plan's stop and the entry: the entry, on a long) and moves up under each higher low; until one lifts it, the trail
      // IS the breakeven stop
      const lows = higherLows(signal, fwd)
      let level = Math.max(plan.stop, be)
      let low = null
      const raise = (upTo) => { for (const L of lows) if (L.known <= upTo && L.low > level) { level = L.low; low = L.session } }
      raise(t2At)
      trail = [{ known: t2At, level, low }]
      for (let s = t2At + 1; s <= fwd.length; s++) {
        const b = fwd[s - 1]
        if (low == null ? b.l <= level : b.l < level) {
          exit = { id: low == null ? 'stop' : 'trail', session: s, level, low, breakeven: low == null, ...fillAt(level, b, true) }
          break
        }
        const was = level
        raise(s)
        if (level !== was) trail.push({ known: s, level, low })
      }
    }
  }
  let points = []
  for (const id of ['t1', 't2']) {
    const at = id === 't1' ? t.t1At : t2At
    if (at == null) continue
    const tf = targetFill(plan[id], at > 0 ? fwd[at - 1] : signal, long, at)
    points.push({ id, label: labels[id].label, session: at, level: plan[id], r: rAt(plan, tf.fill), ...tf, low: null, answer: TRIM })
  }
  if (exit) exit = { ...exit, label: exit.id === 'trail' ? 'Trail' : exit.breakeven ? 'Breakeven stop' : 'Stop', r: rAt(plan, exit.fill), answer: ALL, calls: [ALL] }
  // the sessions before the exit: a session that hits the stop (or breaks the trail) ends the trade before its range counts
  const open = Math.min(fwd.length, exit ? exit.session - 1 : fwd.length)
  // THE POST-GAP HIGH (the header): the first session whose high reaches it; on a mark's bar, one point that says both
  const pgh = pghLevel(plan, opts.pgh)
  if (pgh != null) {
    let s = 0
    for (let k = 1; k <= open && !s; k++) if (fwd[k - 1].h >= pgh) s = k
    if (s) {
      const own = { id: 'pgh', label: 'Post-gap high', session: s, level: pgh, ...targetFill(pgh, fwd[s - 1], true, s) }
      own.r = rAt(plan, own.fill)
      const same = points.filter((p) => p.session === s)
      if (same.length) {
        // the mark nearest it, to the cent (a tie joins 3R, the first)
        const off = (p) => Math.abs(cents(p.level) - cents(pgh))
        const near = same.reduce((a, p) => (off(p) < off(a) ? p : a))
        const legs = [legOf(near), legOf(own)].sort((a, b) => a.level - b.level)
        points[points.indexOf(near)] = { id: 'pgh', label: cap(`${shortOf(legs[0])} and ${shortOf(legs[1])}`), session: s,
          level: legs[0].level, fill: legs[0].fill, gap: legs[0].gap, r: legs[0].r, low: null, answer: TRIM, legs }
      } else points.push({ ...own, low: null, answer: TRIM })
    }
  }
  // THE CALLS ON THE PLAN at each mark (the header): the day, the push into it, the zone, the plan's own words, a gap. The
  // plan's best call is the first; the plan's own exits follow it.
  const zoneMult = trimR(plan)[1]
  points = points.map((p) => {
    const push = pushDays(signal, fwd, p.session, long)
    const read = readOf(p, push, zoneMult)
    return { ...p, push, read, calls: READS[read], answer: READS[read][0] }
  })
  // THE FIRST RETURN TO THE HIGH-VOLUME CLOSE (the header): a close away from it, then a later session back at it. From
  // 3R the entry is the breakeven stop, so a return then is the stop (found above), never a decision point.
  if (plan.skill === HVE) {
    const e = plan.entry
    let above = 0
    for (let k = 1; k <= open; k++) {
      const b = fwd[k - 1]
      if (!above) { if (long ? b.c > e : b.c < e) above = k; continue }
      if (long ? b.l > e : b.h < e) continue
      const hvc = { id: 'hvc', label: 'High-volume close', session: k, level: e, low: null, ...fillAt(e, b, long), answer: hveAnswer(opts.hveCall === undefined ? HVE_RETURN_CALL : opts.hveCall), above }
      hvc.calls = hvc.answer == null ? [] : [hvc.answer]
      hvc.r = rAt(plan, hvc.fill)
      // a 'sell' ruling ends the trade there: nothing after it is the plan's
      if (hvc.answer === ALL) { exit = hvc; points = points.filter((p) => p.session <= k) } else points.push(hvc)
      break
    }
  }
  const rank = (p) => (p.id === 'hvc' ? 1 : 0)
  points.sort((a, b) => a.session - b.session || rank(a) - rank(b))
  if (exit) points.push(exit)
  const last = fwd.length ? fwd[fwd.length - 1].c : (plan.enters_intraday ? signal.c : plan.entry)
  const end = exit ? { session: exit.session, kind: exit.id, r: exit.r, ...(exit.breakeven ? { breakeven: true } : {}) }
    : { session: fwd.length, kind: 'open', r: rAt(plan, last) }
  // the chart's marks: a trail that broke or a breakeven stop that traded is marked by the game itself, so the review
  // stops the day before it (the review reads the plan's original stop and would mark that day's 5R or STOPPED on its own)
  const shown = reviewTrade(plan, signal, fwd.slice(0, exit?.id === 'trail' || exit?.breakeven ? end.session - 1 : end.session))
  return { long, points, end, trail, shown, pgh, t1At: t.t1At }
}

/** The sessions the replay plays slowly: the first two, and every decision point's. */
export function storyKeys(story) {
  const s = new Set([1, 2])
  for (const p of story?.points || []) if (p.session >= 1) s.add(p.session)
  return s
}

/** The trail in force after `k` whole sessions, or null before 5R (or on a plan with no trail). */
export function trailAt(story, k) {
  const steps = story?.trail
  if (!steps?.length || !(k >= steps[0].known)) return null
  let cur = steps[0]
  for (const st of steps) if (st.known <= k) cur = st
  return cur
}

/** Has 3R traded by the end of `k` whole sessions? From then the stop on what is left is breakeven (fb.breakeven). */
export const breakevenAt = (story, k) => story?.t1At != null && k >= story.t1At

/** The stop on what is left after `k` whole sessions: the trail once a higher low has lifted it, breakeven (the entry)
 *  once 3R has traded, else the plan's stop. */
export function stopAt(story, plan, k) {
  const tr = trailAt(story, k)
  if (tr && tr.low != null) return { kind: 'trail', level: tr.level, low: tr.low }
  if (breakevenAt(story, k)) return { kind: 'breakeven', level: plan.entry, low: null }
  return { kind: 'stop', level: plan.stop, low: null }
}

/** The member's exits from their calls: a Sell some at a point exits some at that point's R (at each of its levels,
 *  where it says two), a Sell the rest exits the rest there (at the first level price reaches) and the member is out; a
 *  call after that moves nothing. Unanswered points are skipped. */
export function exitsOf(points, picks) {
  const exits = []
  let out = false
  ;(points || []).forEach((p, i) => {
    const a = picks?.[i]
    if (a == null || out) return
    const legs = legsOf(p)
    if (a === TRIM) for (const l of legs) exits.push({ ...l, part: 'some' })
    else if (a === ALL) { exits.push({ ...legs[0], part: 'rest' }); out = true }
  })
  return { exits, out }
}

/** The plan's own exits: its answer at every point (none at a point it makes no call at). */
export const planExits = (story) => exitsOf(story?.points, (story?.points || []).map((p) => p.answer))

/** Where an exit was, in a sentence: a mark by its name, the post-gap high and the high-volume close by name and R, a
 *  stop or a trail by its R. */
const stopWord = (e) => (e.id === 'trail' ? 'trail' : e.breakeven ? 'breakeven stop' : 'stop')
const where = (e) => (isTarget(e.id) ? `at ${e.label}` : NAMED[e.id] ? `at ${NAMED[e.id]}, ${rText(e.r)}` : `at ${rText(e.r)} on the ${stopWord(e)}`)
const joinAnd = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || '')

/** The exits as plain sentences, each with its own R: "Trimmed at 3R and 5R. The rest out at +4.2R on the trail." What
 *  was still held when the story ended is said too: open at the last close, or held when the plan was out. */
export function exitsText({ exits, out }, end) {
  const some = exits.filter((e) => e.part === 'some')
  const rest = exits.find((e) => e.part === 'rest')
  const parts = []
  if (some.length) parts.push(`Trimmed at ${joinAnd(some.map((e) => nameOf(e) || `${rText(e.r)} on the ${stopWord(e)}`))}.`)
  const what = some.length ? 'The rest' : 'All of it'
  if (rest) parts.push(`${some.length ? 'The rest out' : 'Out'} ${where(rest)}.`)
  else if (!out) {
    if (end?.kind === 'open') parts.push(`${what} still open, ${rText(end.r)} at the last close.`)
    else parts.push(`${what} still held when the plan was out.`)
  }
  return parts.join(' ')
}

/** Where the member stands after their calls so far, for the line under the question. */
export function positionLine({ exits, out }) {
  if (out) return 'You are out.'
  const some = exits.filter((e) => e.part === 'some').map((e) => nameOf(e) || `the ${stopWord(e)}`)
  return some.length ? `You trimmed at ${joinAnd(some)}. The rest is still on.` : 'You hold the full position.'
}

/** The short word for the position chip. */
export function positionWord({ exits, out }) {
  if (out) return 'Out'
  return exits.some((e) => e.part === 'some') ? 'Trimmed' : 'Full'
}

// ── the copy at each stop ─────────────────────────────────────────────────────────────────────────────────────────────

/** What just happened, in one sentence with its price. */
export function eventLine(point, long = true) {
  const at = px(point.level)
  if (point.legs) {
    // a post-gap high and a mark on one bar (a long: the lower one first)
    const [a, b] = point.legs
    if (b.gap) return `It opened over ${nameOf(a)} and ${nameOf(b)}, at ${px(b.fill)}.`
    if (a.gap) return `It opened over ${nameOf(a)}, at ${px(a.fill)}, and ${nameOf(b)} just traded, at ${px(b.level)}.`
    return `${cap(nameOf(a))} and ${nameOf(b)} both just traded, at ${px(a.level)} and ${px(b.level)}.`
  }
  if (point.id === 'pgh') return point.gap ? `It opened over the post-gap high, at ${px(point.fill)}.` : `Price just traded up to the post-gap high, ${at}.`
  if (point.id === 'hvc') {
    return point.gap ? `It opened back ${long ? 'under' : 'over'} the high-volume close, at ${px(point.fill)}.` : `Price just came back to the high-volume close, ${at}.`
  }
  if (isTarget(point.id)) {
    if (point.gap) return `It opened ${long ? 'over' : 'under'} ${point.label}, at ${px(point.fill)}.`
    return point.session === 0 ? `${point.label} traded on the entry day itself, at ${at}.` : `${point.label} just traded, at ${at}.`
  }
  if (point.id === 'stop') {
    if (point.breakeven) {
      return point.gap ? `It opened ${long ? 'under' : 'over'} your breakeven stop, at ${px(point.fill)}.` : `Price just traded ${long ? 'down' : 'up'} to your breakeven stop, ${at}.`
    }
    return point.gap ? `It opened ${long ? 'under' : 'over'} your stop, at ${px(point.fill)}.` : `Price just traded ${long ? 'down' : 'up'} through your stop, ${at}.`
  }
  return point.gap ? `It opened under the trail, at ${px(point.fill)}.` : `Price just traded under ${at}, the higher low of ${dayName(point.low)}.`
}

/** The question at a stop: what happened, then the call. A member who is already out is asked what the plan does (at a
 *  point the plan leaves to the member, what they would do). */
export function questionOf(point, long = true, inPosition = true) {
  const out = isFree(point) ? 'You are already out. What would you do here?' : 'You are already out. What does the plan do here?'
  return `${eventLine(point, long)} ${inPosition ? 'What do you do?' : out}`
}

/** The tag over the question. */
export const stopTag = (point) => `The replay stops · ${point.label}`

/** What the plan does with what is left after 5R: the trail it names, where the bars can measure it; else the breakeven
 *  stop. */
const restLine = (plan) => (trailMeasured(plan) ? 'What is left trails under each higher low.' : 'What is left rides on the breakeven stop.')

/** At 3R the replay moves the stop up to breakeven: inside the owner's window (fb.breakeven), said with it. */
const beLine = (plan) => `The stop moves up to breakeven, ${px(plan.entry)}: we move it between 2R and 5R, or at the first sell.`

/** A mark's name inside a sentence: "3R", "the post-gap high", "the post-gap high and 3R". */
const markName = (p) => (p.legs ? `${nameOf(p.legs[0])} and ${nameOf(p.legs[1])}` : nameOf(p) || p.label)

/** What follows a mark, whatever the call: the trail from 5R, the breakeven stop at 3R, the stop at the post-gap high. */
function markTail(p, plan) {
  const ids = legsOf(p).map((l) => l.id)
  if (ids.includes('t2')) return restLine(plan)
  if (ids.includes('t1')) return beLine(plan)
  return 'What is left rides on the stop.'
}

/** The calls on the plan at a mark and its read (a point from before them is read again here). */
function markCalls(p, plan) {
  const read = p.read || readOf(p, p.push || 0, trimR(plan)[1])
  return { read, calls: Array.isArray(p.calls) && p.calls.length ? p.calls : READS[read] }
}

/** The plan's call at a mark in one sentence: "The plan sells some; holding is a judgment too." */
function markCall(p, plan, pick = null) {
  const long = isLong(plan)
  const { calls } = markCalls(p, plan)
  const best = calls[0]
  const doing = (a) => (a === HOLD ? 'holding' : long ? 'selling some' : 'covering some')
  if (pick != null && pick !== best && calls.includes(pick)) return `The plan ${planVerb(best, long)}, and ${doing(pick)} is a judgment we make too.`
  return calls.length > 1 ? `The plan ${planVerb(best, long)}; ${doing(calls[1])} is a judgment too.` : `The plan ${planVerb(best, long)}.`
}

/** WHY AT A MARK (the header's reads, D-013 and GAP-TRIM): the day, what it and the move say, the plan's call, what
 *  follows. A Sell the rest is told first that the mark is not the exit. */
function markWhyText(p, pick, plan) {
  const long = isLong(plan)
  const sell = long ? 'sell' : 'cover'
  const selling = long ? 'selling' : 'covering'
  const { read } = markCalls(p, plan)
  const name = markName(p)
  const legs = legsOf(p)
  const zr = Math.max(...legs.map((l) => (Number.isFinite(l.r) ? l.r : -Infinity)))
  const gapLeg = legs.find((l) => l.gap)
  const pgh = legs.some((l) => l.id === 'pgh')
  // the post-gap high is the plan's own place to take some off: said beside the day or the move that decides the read
  const own = pgh && (read === 'zone' || read === 'push') ? ' The plan names the post-gap high as the first place to take some off.'
    : pgh && read === 'early' ? ' The post-gap high is the plan\'s first place to take some off, from day 3 on.' : ''
  const said = {
    early: `We very rarely ${sell} on day 1 and usually wait until day 3 at the earliest.`,
    zone: `${rText(zr)} is in the 5 to 10R zone, where a first ${sell} into strength is often best.`,
    push: `It is ${p.push} days into a push, and ${selling} some into a 3, 5 or 7 day push is often best.`,
    named: 'The plan names the post-gap high as the first place to take some off.',
    gap: `It opened ${long ? 'over' : 'under'} ${gapLeg ? nameOf(gapLeg) : name}, and a gap past a level is not an automatic ${sell}: ${selling} part into a big gap at the open is a judgment, never a rule.`,
    mark: `${cap(name)} is a mark on the ruler, not a ${sell} order, and there is no 3, 5 or 7 day push here.`,
  }[read]
  // where a sell fills on a day that opened past the level (the gap read has said it already)
  const fills = gapLeg && (read === 'zone' || read === 'push' || read === 'named') ? ` It opened ${long ? 'over' : 'under'} ${nameOf(gapLeg)}, so a ${sell} fills at the open, ${rText(gapLeg.r)}.` : ''
  const exit = pick !== ALL ? '' : p.legs ? 'Neither is the exit. ' : `${cap(name)} is not the exit. `
  return `${exit}This is ${dayName(p.session)}. ${said}${own} ${markCall(p, plan, pick)} ${markTail(p, plan)}${fills}`
}

/** The stop on what is left at the first return to the high-volume close: the edge bar's low (its high on a short). */
const edgeStop = (plan) => `${isLong(plan) ? 'under' : 'over'} it, at ${px(plan.stop)}, the edge bar's ${isLong(plan) ? 'low' : 'high'}`

/** THE HOUSE GAP RULE (B20), said once at a stop the day opened past: the first 30-minute low (high, on a short) of the
 *  gap day is the new stop, out if the first 30 minutes take the loss past 2R; a daily chart cannot see that bar. */
export const gapRule = (long = true) => `Our gap rule: the first 30-minute ${long ? 'low' : 'high'} of the gap day is the new stop, out if those 30 minutes take the loss past 2R. A daily chart cannot see that bar, so the open is the fill shown here.`

/** Why the plan does what it does here, for the pick the member made: { ok, title, text }. Every line is the owner's
 *  2026-11-12 rulings (D-013, GAP-TRIM, fb.breakeven), the plan's own rule (docs/study/TRADE_PLANS.md,
 *  api/services/study_trade.replay_checks), the house gap rule (B20) or the owner's own words (VOICE.md §3). A call is on
 *  the plan when it is one of the point's `calls`. At a point the plan makes no call at, ok is null: the plan's words,
 *  its stop, and what the member did. */
export function whyOf(point, pick, plan) {
  const long = isLong(plan)
  const free = isFree(point)
  const ok = free ? null : onPlan(point, pick)
  const out = rText(point.r)
  const { t1: T1 } = trimsOf(plan)
  const gap = point.gap ? ` It opened ${point.id === 'trail' || long ? 'under' : 'over'} the level: a stop cannot catch an overnight gap. ${gapRule(point.id === 'trail' || long)}` : ''
  let text
  if (point.legs || isTarget(point.id) || point.id === 'pgh') {
    text = markWhyText(point, pick, plan)
  } else if (point.id === 'hvc') {
    const opened = point.gap ? ` It opened past it, so the open is the fill, ${out}.` : ''
    if (free) {
      const did = pick === HOLD ? 'You held.' : `You ${long ? 'sold' : 'covered'} ${pick === TRIM ? 'some' : 'the rest'} at ${out}.`
      return { ok: null, title: 'Your call.', text: `The plan calls the first return to the high-volume close the cleanest decision point, and leaves the call to you. The stop is still ${edgeStop(plan)}. ${did}${opened} This one is not scored.` }
    }
    const tail = point.answer === HOLD ? `The stop stays ${edgeStop(plan)}.`
      : point.answer === TRIM ? 'What is left rides on the stop.' : `Out at ${out}.`
    text = `At the first return to the high-volume close, the cleanest decision point, the plan ${planVerb(point.answer, long)}. ${tail}${opened}`
  } else if (point.id === 'stop' && point.breakeven) {
    const sat = `The stop sat at breakeven, the entry, since ${T1.label} traded.`
    text = ok ? `${sat} Out at ${out}.${gap}`
      : pick === HOLD ? `${sat} At the stop the plan is out of all of it, at ${out}.${gap}`
        : `${sat} At the stop the plan ${planVerb(ALL, long)}, not part of it. Out at ${out}.${gap}`
  } else if (point.id === 'stop') {
    text = ok ? `The stop is an appointment, not a debate. Out at ${out}.${gap}`
      : pick === HOLD ? `The stop is an appointment, not a debate. At the stop the plan is out of all of it, at ${out}.${gap}`
        : `At the stop the plan ${planVerb(ALL, long)}, not part of it. Out at ${out}.${gap}`
  } else {
    const under = `Price traded under the higher low of ${dayName(point.low)}, ${px(point.level)}`
    text = ok ? `The trail is the stop on what is left. ${under}: out at ${out}.${gap}`
      : pick === HOLD ? `The trail is the stop on what is left. ${under}, so the plan sells the rest at ${out}.${gap}`
        : `A broken trail ends the trade. The plan sells all that is left, not part of it, at ${out}.${gap}`
  }
  return { ok, title: ok ? 'That is the plan.' : 'Not the plan.', text }
}

/** The definition the trail uses, said once where it matters (the 5R stop and the trail's). */
export const TRAIL_RULE = 'A higher low: a day whose low sits under the days either side of it, and above the last such low. From 5R the stop on what is left starts at breakeven and moves up under each one the day after, never down.'

/** THE WORKING at a stop, in steps a member can check on the chart: the risk a share, the level, and the exit's R, each
 *  on the plan's own prices to the cent. A mark the plan rounded a cent away from the entry plus its multiple of the
 *  rounded risk is said without the sum, so a printed sum never disagrees with the line on the chart. */
export function workingOf(point, plan) {
  const long = isLong(plan)
  const sell = long ? 'sell' : 'cover'
  const e = cents(plan.entry), st = cents(plan.stop), risk = riskCents(plan)
  const trims = trimsOf(plan)
  const c2 = (v) => (v / 100).toFixed(2)
  const steps = [{ key: 'risk', text: long ? `Risk a share: ${c2(e)} − ${c2(st)} = ${c2(risk)}.` : `Risk a share: ${c2(st)} − ${c2(e)} = ${c2(risk)}.` }]
  const f = cents(point.fill)
  const num = long ? `(${c2(f)} − ${c2(e)})` : `(${c2(e)} − ${c2(f)})`
  const numOf = (leg) => (long ? `(${c2(cents(leg.fill))} − ${c2(e)})` : `(${c2(e)} − ${c2(cents(leg.fill))})`)
  const levelLine = (leg) => {
    const m = trims[leg.id].r
    const lv = cents(leg.level)
    const sum = long ? e + m * risk : e - m * risk
    return sum === lv ? `${leg.label}: ${c2(e)} ${long ? '+' : '−'} ${m} × ${c2(risk)} = ${c2(lv)}.`
      : `${leg.label}: the entry ${long ? 'plus' : 'minus'} ${timesWord(m)} the risk, ${c2(lv)} on the plan.`
  }
  // the plan's call at a mark, its day, and what follows (markCall, markTail)
  const callLine = () => `At ${markName(point)}, ${dayName(point.session)}: ${markCall(point, plan).replace(/^The plan/, 'the plan')} ${markTail(point, plan)}`
  if (point.id === 'pgh') {
    // the post-gap high, and the mark that traded on the same bar when there is one, in the order price reached them
    for (const leg of legsOf(point)) {
      const lv = cents(leg.level)
      if (isTarget(leg.id)) {
        steps.push({ key: `level-${leg.id}`, text: levelLine(leg) })
        if (leg.gap) steps.push({ key: `fill-${leg.id}`, text: `It opened at ${c2(cents(leg.fill))}, past ${leg.label}, so a ${sell} fills there: ${numOf(leg)} ÷ ${c2(risk)} = ${rText(leg.r)}.` })
      } else {
        steps.push({ key: 'level-pgh', text: `The post-gap high: ${c2(lv)}, the highest price from the gap day through the entry day.` })
        steps.push({ key: 'fill-pgh', text: leg.gap ? `It opened at ${c2(cents(leg.fill))}, past it, so a ${sell} fills there: ${numOf(leg)} ÷ ${c2(risk)} = ${rText(leg.r)}.`
          : `At ${c2(lv)}: ${numOf(leg)} ÷ ${c2(risk)} = ${rText(leg.r)}.` })
      }
    }
    steps.push({ key: 'call', text: callLine() })
    return steps
  }
  if (point.id === 'hvc') {
    steps.push({ key: 'level', text: `The high-volume close: ${c2(e)}, the edge day's close and the entry.` })
    steps.push({ key: 'return', text: `It closed ${long ? 'over' : 'under'} it on ${dayName(point.above)}, and ${dayName(point.session)} came back to it.` })
    steps.push({ key: 'r', text: point.gap ? `It opened at ${c2(f)}, past it, so an exit fills there: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.`
      : `An exit there: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.` })
    steps.push({ key: 'stop', text: `The stop is still ${c2(st)}, the edge bar's ${long ? 'low' : 'high'}.` })
    steps.push({ key: 'call', text: isFree(point) ? 'The plan calls this the cleanest decision point and leaves the call to you.'
      : `At the first return the plan ${planVerb(point.answer, long)}.` })
    return steps
  }
  if (isTarget(point.id)) {
    steps.push({ key: 'level', text: levelLine(point) })
    if (point.gap) steps.push({ key: 'fill', text: `It opened at ${c2(f)}, past ${point.label}, so a ${sell} fills there: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.` })
    steps.push({ key: 'call', text: callLine() })
    if (point.id === 't2') {
      steps.push({ key: 'next', text: trailMeasured(plan) ? TRAIL_RULE
        : plan?.trail ? `What is left rides on the breakeven stop here. This plan's trail is a judgment, not a level: ${plan.trail}.`
          : 'This plan names no trail, so what is left rides on the breakeven stop.' })
    }
    return steps
  }
  if (point.id === 'trail') steps.push({ key: 'level', text: `The trail: the higher low of ${dayName(point.low)}, ${px(point.level)}. Price traded under it.` })
  else if (point.breakeven) steps.push({ key: 'level', text: `The breakeven stop: ${px(point.level)}, the entry, the stop since ${trims.t1.label} traded; ${point.gap ? 'the day opened past it' : 'price traded to it'}.` })
  else steps.push({ key: 'level', text: `The stop: ${px(point.level)}, ${point.gap ? 'and the day opened past it' : 'and price traded through it'}.` })
  steps.push({ key: 'r', text: `Out at ${c2(f)}: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.` })
  if (point.gap) steps.push({ key: 'gap', text: gapRule(point.id === 'trail' || long) })
  if (point.id === 'trail') steps.push({ key: 'rule', text: TRAIL_RULE })
  return steps
}

// ── the trade, start and end ──────────────────────────────────────────────────────────────────────────────────────────

/** Four setup names for the entry question: the chart's own setup and three others with a plan, in a seeded order (the
 *  same chart deals the same tiles, so a re-render never moves one under the member's finger). */
export function entryChoices(item, seed = 1, names = STORY_SETUPS) {
  let s = Math.abs(Math.floor(Number(seed) || 1)) % 2147483647 || 1
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
  const others = names.filter((x) => x !== item.name)
  const picked = []
  while (others.length && picked.length < 3) picked.push(others.splice(Math.floor(rnd() * others.length), 1)[0])
  const cards = [item.name, ...picked]
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]] }
  return cards
}

/** The verdict on the entry question. */
export const entryTitle = (named, name) => (named ? 'Named it.' : `It was ${withArticle(name)}.`)

/** The trade the plan takes, in one line: "Bought at 13.11 · stop 12.65 · 3.5% risk" (a market order, E57). */
export function planLine(plan) {
  if (!planOk(plan)) return ''
  return `${isLong(plan) ? 'Bought' : 'Shorted'} at ${px(plan.entry)} · stop ${px(plan.stop)} · ${riskPct(plan).toFixed(1)}% risk`
}

/** The calls in one trade: right (a call among the point's calls on the plan) and how many. A call at a point the plan
 *  leaves to the member is neither. */
export function callsOf(story, picks) {
  const pts = story?.points || []
  let right = 0, total = 0
  pts.forEach((p, i) => { if (picks?.[i] != null && !isFree(p)) { total += 1; if (onPlan(p, picks[i])) right += 1 } })
  return { right, total }
}

/** The calls at points the plan leaves to the member, in one trade. */
export const freeCalls = (story, picks) => (story?.points || []).filter((p, i) => isFree(p) && picks?.[i] != null).length

/** The verdict line at the end of one trade (`free`: the calls the plan left to the member). */
export function tradeTitle({ right, total }, free = 0) {
  if (!total) return free ? 'Your call on this one, not scored.' : 'Nothing to manage on this one.'
  if (right === total) return total === 1 ? 'On the plan.' : 'On the plan, every call.'
  return `${right} of ${total} calls on the plan.`
}

/** The pool, from the spot-setup answer: charts of a setup with a plan, with bars. `normalize` turns the server's bars
 *  into the chart's (useStudySession.normalizeBars; injected so this stays pure). */
export function poolItems(set, normalize = (b) => b) {
  return (set?.items || []).filter((it) => it && it.id != null && PLAN_SKILLS.includes(it.skill_id) && it.bars?.bars?.length > 1)
    .map((it) => ({ id: it.id, skill: it.skill_id, name: SETUP_SKILLS[it.skill_id], choices: it.prompt_json?.choices || ['Yes', 'No'],
      bars: normalize(it.bars), sessionId: set.session_id }))
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A trade on the run: { id, name, ticker, long, named, xp, story, picks, skipped }. `skipped` is a chart whose answer
 *  could not be scored; a scored chart whose reveal came back with no playable plan is played with `story` null (its name
 *  counts, it has no calls). A trade was on the plan when the setup was named and every call was on the plan. */
export function tradeOk(tr) {
  if (!tr || tr.skipped) return null
  const c = callsOf(tr.story, tr.picks)
  return !!tr.named && c.right === c.total
}

/** The run counted: the calls right of all calls made, one result per call, the setups named. */
export function tally(trades) {
  let right = 0, total = 0, named = 0, played = 0
  const results = []
  for (const tr of trades || []) {
    if (!tr || tr.skipped) continue
    played += 1
    if (tr.named) named += 1
    ;(tr.story?.points || []).forEach((p, i) => {
      const a = tr.picks?.[i]
      if (a == null || isFree(p)) return
      total += 1
      const ok = onPlan(p, a)
      if (ok) right += 1
      results.push(ok)
    })
  }
  return { right, total, named, played, results }
}

/** The end screen's run log: one card per scored call, the plan's calls named ("5R · Sell some or hold"), the trade's
 *  ticker and setup, what was said on a miss. A call the plan leaves to the member is not a card (it is neither right
 *  nor wrong): yoursLines says it. */
export function logRows(trades) {
  const rows = []
  for (const tr of trades || []) {
    if (!tr || tr.skipped) continue
    ;(tr.story?.points || []).forEach((p, i) => {
      const a = tr.picks?.[i]
      if (a == null || isFree(p)) return
      const ok = onPlan(p, a)
      rows.push({ name: `${p.label} · ${callsLabel(p, tr.long !== false)}`, ticker: tr.ticker ? `${tr.ticker} · ${tr.name}` : tr.name, ok,
        said: ok ? null : actionLabel(a, tr.long !== false).toLowerCase(), was: '' })
    })
  }
  return rows
}

/** Each trade's ending in one line for the end screen: "JBI · Kicker: trimmed at 3R and 5R. The rest out at +4.2R on the
 *  trail." The member's own exits. */
export function tradeLine(tr) {
  const head = `${tr.ticker ? `${tr.ticker} · ` : ''}${tr.name}`
  if (tr.skipped) return `${head}: not scored, so not played.`
  if (!tr.story) return `${head}: no trade plan came back, so there was nothing to manage.`
  const text = exitsText(exitsOf(tr.story?.points, tr.picks), tr.story?.end)
  return `${head}: ${text ? text.charAt(0).toLowerCase() + text.slice(1) : 'nothing to manage.'}`
}

/** The end screen's line for each call the plan left to the member: "AMD · High Volume Edge: the first return to the
 *  high-volume close, day 10, was a decision point the plan leaves to you. You held." (the buy day is day 1) */
export function yoursLines(trades) {
  const lines = []
  for (const tr of trades || []) {
    if (!tr || tr.skipped || !tr.story) continue
    const head = `${tr.ticker ? `${tr.ticker} · ` : ''}${tr.name}`
    const long = tr.long !== false
    tr.story.points.forEach((p, i) => {
      const a = tr.picks?.[i]
      if (!isFree(p) || a == null) return
      const did = a === HOLD ? 'You held.' : a === TRIM ? `You ${long ? 'sold' : 'covered'} some at ${rText(p.r)}.` : `You ${long ? 'sold' : 'covered'} the rest at ${rText(p.r)}.`
      lines.push(`${head}: the first return to the high-volume close, ${dayName(p.session)}, was a decision point the plan leaves to you. ${did}`)
    })
  }
  return lines
}

/** The setups named, for the end screen. */
export const namedLine = ({ named, played }) => `You named ${named} of ${plural(played, 'setup')} before the trade.`

/** The end screen's title. */
export function storyVerdict(right, total) {
  if (!total) return 'Nothing to manage'
  if (right === total) return 'Legendary'
  const r = right / total
  if (r >= 0.75) return 'Disciplined'
  if (r >= 0.5) return 'Getting there'
  return 'Tough run'
}

/** The run's XP bar: the level before the run's first scored answer and after the game run's grant. `first` is
 *  challengeBank.runXp() (the attempts' span), `res` the game run's answer. null when `res` is not a game run's answer. */
export function levelAfter(first, res) {
  const after = res?.progress?.xp
  const gained = Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0)
  if (typeof after !== 'number' || !Number.isFinite(after) || !Number.isFinite(gained)) return null
  const before = first && Number.isFinite(first.before) ? first.before : after - gained
  return { before, after }
}

/** One id per run (the server grants a run's XP once per id). */
export const runIdOf = (seed, n = 0) => `story-${Math.abs(Math.floor(Number(seed) || 0)).toString(36)}-${n}`

/** The start screen's lead. */
export const START_LEAD = 'A real setup fires. Name it, take the trade on its own plan, then manage it as the chart plays out.'

/** What the start screen says the bank holds. */
export const bankLine = (n) => `${plural(n, 'real trade')} from the UCT bank, a fresh deal every run`

/** A setup's name with a capital for a sentence start. */
export const capName = (name) => cap(withArticle(name))
