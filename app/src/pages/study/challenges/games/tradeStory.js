// TRADE STORY, the rules (docs/study/GAMES.md §3, kind 'story'). Pure: no React, no clock, no Math.random(); every number
// the game shows or scores is computed here from the plan the server sends and the bars that followed, or read from the
// server's reveal.
//
// THE PLAY. A real setup fired on the last candle of a chart (POST /api/study/spot-setup with `need_plan`: a chart whose
// last candle is its setup and nothing else, and whose setup has a trade plan). The member names it (scored on the server
// through /attempts, Hard mode's answer), and the trade is entered on that setup's own plan: the reveal's `trade`
// (api/services/study_trade.py: the detector's entry and stop, the targets at 2R and 3R, the trail in the detector's
// words; docs/study/TRADE_PLANS.md). Then the bars after the signal replay, and the replay STOPS at each moment the plan
// defines, and only there:
//   2R reached         the plan takes some off (the first target)
//   3R reached         the plan takes some off again (the second target)
//   the post-gap high  the plan takes some off (Gap Support's trim, below)
//   the first return   back at the high-volume close (High Volume Edge's decision point, below; not scored until the
//                      owner rules what the plan does there)
//   the stop trades    the plan is out of what is left
//   the trail breaks   the plan is out of what is left (only where the plan names a trail the bars can measure)
// At each stop the member picks Hold, Take some off, or Sell the rest (Cover the rest on a short). Between them nothing
// is asked.
//
// THE TRIMS THE PLANS NAME (the owner, 2026-11-09, on the two trim notes in study_trade.PLANS: "yes add those stops too").
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
// The plan takes some off there: filled at the level, or at the open on a day that opened over it. On the same bar as
// 2R or 3R the replay asks once and says both (it joins the target nearest it in price); over 3R it is still asked.
// THE FIRST RETURN TO THE HIGH-VOLUME CLOSE (High Volume Edge: "the first return to the high-volume close, often weeks
// later, is the cleanest decision point"). The high-volume close is the entry. The first return: after at least one
// close over the entry (under it, on a short), the first LATER session whose low trades at or under the entry (high at
// or over, on a short), while that session does not hit the stop and the trade is still open. A day that dips to the
// close and closes back over it before any close away from it has not left the level, so it is not a return. An exit
// there fills at the entry, or at the open on a day that opened past it. On a session that also reaches a target the
// target is asked first (a daily bar does not say which came first). What the plan does there is not ruled yet
// (HVE_RETURN_CALL): until it is, the replay asks, says the plan's words and its stop, and scores nothing, either way.
//
// NO FRACTION IS INVENTED. TRADE_PLANS.md: "Trim is where to take some off: the detectors put the targets at 2R and 3R.
// They do not say how much to sell at each, so the course names the levels and does not invent a fraction." So the result
// is never one R number for the whole trade: it is the R of each exit the member made (2R, 3R, where the rest went), side
// by side with the plan's.
//
// WHEN THE TRAIL STARTS. The server's own replay question (study_trade.replay_checks) asks at 3R "What happens to the stop
// on what is left?" and answers with the plan's trail; at 2R it says "what is left rides on the stop". So the stop stays
// where the plan put it until 3R, and only then trails, where the plan names a trail.
//
// THE TRAIL, MEASURED. Four plans name "under each higher low" (the Kicker, the Oops Reversal, the Slingshot, the
// Launchpad; three of them offer an average as the other way, which would need an average type the plan does not name).
// The replay uses the higher lows, read off the bars: a day whose low sits under the lows of the days either side of it,
// and above the low before it (the signal day's low for the first one). The stop on what is left moves up under each one
// once the day after it has printed, never down, and the trail breaks when price trades under it. A plan with no trail
// (the High Volume Edge) or one whose trail is not a level the bars can place (the Gap Support's "if it drifts sideways at
// the gap") keeps what is left on the plan's stop.
//
// HOW THE BARS ARE READ. hardMode.reviewTrade, the review Hard mode, Draw it and Weekend Watchlist already draw: when each
// target traded, when the stop did (a bar that reaches the stop ends the trade before its extreme counts), with the
// Kicker's and the Oops's same-day entry. A stop or a trail that the day OPENED beyond fills at the open: "A stop cannot
// catch an overnight gap" (the owner's own line, docs/study/VOICE.md §3). A target the day opened past fills at the open
// too (the level never printed that day, so the replay never says it "traded" there). Every exit's R is measured the
// same way, on the fill and the plan's own prices to the cent, so each R agrees with the prices on the screen.
import { reviewTrade, withArticle } from '../hardMode'
import { SETUP_SKILLS } from '../challengeBank'

export const STORY_KIND = 'story'
export const STORY_TOTAL = 4
export const STORY_VIEW = 90           // sessions the question frames before the answer (a phone frames fewer)
export const STORY_VIEW_PHONE = 60
export const STORY_SOURCE = 'Our trade plans · course unit F10.05, Scaling in and out'
export const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
export const FAILED_LINE = 'The trades did not load. Check your connection and try again.'
/** Why the result is never one number for the whole trade (TRADE_PLANS.md: the course does not invent a fraction). */
export const EXIT_NOTE = 'The plan names each level, not how much to sell there, so each exit shows its own R.'
/** The trade question on the last candle. */
export const ENTRY_Q = 'A setup fired on the last candle. Which one?'
export const ENTRY_DETAIL = 'Name it, and you take the trade on its own plan: the entry, the stop, and targets at 2R and 3R.'
/** A chart whose answer could not be scored, and a reveal that came back without its plan. */
export const NOT_SCORED = 'This chart could not be scored. Skip it and the next one loads.'
export const NO_PLAN = 'No trade plan came back for this chart, so there is nothing to manage. On to the next one.'
/** A trade where nothing on the plan traded in the sessions there are. */
export const NOTHING_TRADED = 'Nothing on the plan traded in the sessions shown: no target, no stop.'

/** The setups that come with a trade plan (study_trade.PLANS). The Bear gap has none, so it never plays here. */
export const PLAN_SKILLS = Object.freeze(['setup.family3.kicker', 'setup.family1.launchpad', 'setup.family4.slingshot', 'setup.family4.oops',
  'setup.family3.hve', 'setup.family3.gap_support'])
export const STORY_SETUPS = Object.freeze(PLAN_SKILLS.map((k) => SETUP_SKILLS[k]))
export const GAP_SUPPORT = 'setup.family3.gap_support'
export const HVE = 'setup.family3.hve'

// ── the three calls ───────────────────────────────────────────────────────────────────────────────────────────────────
export const HOLD = 'hold'
export const TRIM = 'trim'
export const ALL = 'all'
export const ACTIONS = Object.freeze([HOLD, TRIM, ALL])

/** THE CALL AT THE FIRST RETURN TO THE HIGH-VOLUME CLOSE, not yet confirmed by the owner (2026-11-09). null: the replay
 *  stops there and asks, says the plan's words and its stop, and counts the call neither right nor wrong. 'hold' |
 *  'trim' | 'sell': scored like every other stop ('sell' is Sell the rest, and ends the trade there). */
export const HVE_RETURN_CALL = null
/** The call a ruling names, as the game's own: null for none (or anything else). */
export const hveAnswer = (call) => (call === 'hold' ? HOLD : call === 'trim' ? TRIM : call === 'sell' ? ALL : null)
/** The two trim notes, in study_trade.PLANS' own words (the plan's `trim_note` wins when the reveal carries it). */
export const PGH_NOTE = 'the post-gap high is the first place to take some off'
export const HVC_NOTE = 'the first return to the high-volume close, often weeks later, is the cleanest decision point'
export const trimNote = (plan) => plan?.trim_note || (plan?.skill === GAP_SUPPORT ? PGH_NOTE : plan?.skill === HVE ? HVC_NOTE : null)
/** Each decision point's name inside a sentence, and its short name in a tag. */
const NAMED = Object.freeze({ t1: '2R', t2: '3R', pgh: 'the post-gap high', hvc: 'the high-volume close' })
const SHORT = Object.freeze({ t1: '2R', t2: '3R', pgh: 'post-gap high', hvc: 'high-volume close' })

/** The tile's words. A short is bought back, so its last call is "Cover the rest". */
export function actionLabel(action, long = true) {
  if (action === HOLD) return 'Hold'
  if (action === TRIM) return 'Take some off'
  if (action === ALL) return long ? 'Sell the rest' : 'Cover the rest'
  return ''
}

/** What the plan does at a stop, said as the plan doing it ("takes some off"). */
function planVerb(action, long) {
  if (action === TRIM) return 'takes some off'
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

/** A plan this game can play: an entry, a stop on the right side of it, and both targets. */
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

/** A target the day reached: filled at the level, or at the open when the day opened past it (a gap up through a long's
 *  target, down through a short's): the level itself never printed that day, so the open is where the order filled. The
 *  signal day of a same-day entry is never a gap (the trade was entered during it). */
function targetFill(level, bar, long, session) {
  const gap = session > 0 && !!bar && (long ? bar.o > level : bar.o < level)
  return { fill: gap ? bar.o : level, gap }
}

const TARGET = { t1: { label: '2R', r: 2 }, t2: { label: '3R', r: 3 } }

const legOf = (p) => ({ id: p.id, label: p.label, level: p.level, fill: p.fill, gap: p.gap, r: p.r })
/** A decision point's levels in the order price reaches them: the two of a post-gap high that traded on the same bar as a
 *  target, else the point itself. */
export const legsOf = (p) => p?.legs || (p ? [legOf(p)] : [])
/** A point the plan makes no call at (the first return to the high-volume close, until the owner rules): never scored. */
export const isFree = (p) => !!p && p.answer == null

/** THE STORY: the decision points the plan defines on these bars, in order, and where the trade ends.
 *  points: [{ id 't1' | 't2' | 'pgh' | 'hvc' | 'stop' | 'trail', label, session (0 = the signal day, for a same-day
 *    entry), level, r (the exit's R, measured like every other number on the screen: the fill on the plan's own prices
 *    to the cent, so 2.0 and 3.0 at the targets unless the day gapped past one or the plan rounded it a cent), fill, gap,
 *    low (the higher low's session, for the trail), answer (TRIM at the targets and the post-gap high, ALL at a stop, the
 *    ruling at the high-volume close: null while there is none) }]
 *    A post-gap high on the same bar as a target is ONE point (id 'pgh') with `legs`, both levels in the order price
 *    reaches them; its level, fill, gap and r are the first leg's (where Sell the rest fills). The first return to the
 *    high-volume close also carries `above`, the session that first closed away from it.
 *  end: { session, kind 'stop' | 'trail' | 'hvc' | 'open', r }   ('open': nothing ended it on the bars there are; r at the
 *    last close; 'hvc': a 'sell' ruling at the first return)
 *  trail: the stop on what is left from 3R on, [{ known, level, low }] (each step from the end of session `known`), or null
 *  shown: hardMode.reviewTrade on the bars of the story itself, for the chart's lines and marks.
 *  pgh: the post-gap high the replay watches (pghLevel), or null.
 *  opts: { pgh: postGapHigh(chart).level, hveCall: the ruling at the first return (HVE_RETURN_CALL when left out) }.
 *  Stable on a prefix: the points found on the first L sessions are the points of the whole strip up to session L. */
export function storyOf(plan, signal, forward, opts = {}) {
  if (!planOk(plan) || !signal) return null
  const fwd = Array.isArray(forward) ? forward : []
  const long = isLong(plan)
  const t = reviewTrade(plan, signal, fwd)
  let points = []
  for (const id of ['t1', 't2']) {
    const at = id === 't1' ? t.t1At : t.t2At
    if (at == null) continue
    const tf = targetFill(plan[id], at > 0 ? fwd[at - 1] : signal, long, at)
    points.push({ id, label: TARGET[id].label, session: at, level: plan[id], r: rAt(plan, tf.fill), ...tf, low: null, answer: TRIM })
  }
  let exit = null
  let trail = null
  if (t.t2At != null && trailMeasured(plan)) {
    const lows = higherLows(signal, fwd)
    let level = plan.stop
    let low = null
    const raise = (upTo) => { for (const L of lows) if (L.known <= upTo && L.low > level) { level = L.low; low = L.session } }
    raise(t.t2At)
    trail = [{ known: t.t2At, level, low }]
    for (let s = t.t2At + 1; s <= fwd.length; s++) {
      const b = fwd[s - 1]
      // until a higher low lifts it, the trail IS the plan's stop, reached the way reviewTrade reaches it
      if (low == null ? b.l <= plan.stop : b.l < level) {
        exit = { id: low == null ? 'stop' : 'trail', session: s, level, low, ...fillAt(level, b, true) }
        break
      }
      const was = level
      raise(s)
      if (level !== was) trail.push({ known: s, level, low })
    }
  } else if (t.stoppedSession != null) {
    exit = { id: 'stop', session: t.stoppedSession, level: plan.stop, low: null, ...fillAt(plan.stop, fwd[t.stoppedSession - 1], long) }
  }
  if (exit) exit = { ...exit, label: exit.id === 'trail' ? 'Trail' : 'Stop', r: rAt(plan, exit.fill), answer: ALL }
  // the sessions before the exit: a session that hits the stop (or breaks the trail) ends the trade before its range counts
  const open = Math.min(fwd.length, exit ? exit.session - 1 : fwd.length)
  // THE POST-GAP HIGH (the header): the first session whose high reaches it; on a target's bar, one point that says both
  const pgh = pghLevel(plan, opts.pgh)
  if (pgh != null) {
    let s = 0
    for (let k = 1; k <= open && !s; k++) if (fwd[k - 1].h >= pgh) s = k
    if (s) {
      const own = { id: 'pgh', label: 'Post-gap high', session: s, level: pgh, ...targetFill(pgh, fwd[s - 1], true, s) }
      own.r = rAt(plan, own.fill)
      const same = points.filter((p) => p.session === s)
      if (same.length) {
        // the target nearest it, to the cent (a tie joins 2R, the first)
        const off = (p) => Math.abs(cents(p.level) - cents(pgh))
        const near = same.reduce((a, p) => (off(p) < off(a) ? p : a))
        const legs = [legOf(near), legOf(own)].sort((a, b) => a.level - b.level)
        points[points.indexOf(near)] = { id: 'pgh', label: cap(`${SHORT[legs[0].id]} and ${SHORT[legs[1].id]}`), session: s,
          level: legs[0].level, fill: legs[0].fill, gap: legs[0].gap, r: legs[0].r, low: null, answer: TRIM, legs }
      } else points.push({ ...own, low: null, answer: TRIM })
    }
  }
  // THE FIRST RETURN TO THE HIGH-VOLUME CLOSE (the header): a close away from it, then a later session back at it
  if (plan.skill === HVE) {
    const e = plan.entry
    let above = 0
    for (let k = 1; k <= open; k++) {
      const b = fwd[k - 1]
      if (!above) { if (long ? b.c > e : b.c < e) above = k; continue }
      if (long ? b.l > e : b.h < e) continue
      const hvc = { id: 'hvc', label: 'High-volume close', session: k, level: e, low: null, ...fillAt(e, b, long), answer: hveAnswer(opts.hveCall === undefined ? HVE_RETURN_CALL : opts.hveCall), above }
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
  const end = exit ? { session: exit.session, kind: exit.id, r: exit.r } : { session: fwd.length, kind: 'open', r: rAt(plan, last) }
  // the chart's marks: a trail that broke is marked by the game itself, so the review stops the day before it
  const shown = reviewTrade(plan, signal, fwd.slice(0, exit?.id === 'trail' ? end.session - 1 : end.session))
  return { long, points, end, trail, shown, pgh }
}

/** The sessions the replay plays slowly: the first two, and every decision point's. */
export function storyKeys(story) {
  const s = new Set([1, 2])
  for (const p of story?.points || []) if (p.session >= 1) s.add(p.session)
  return s
}

/** The trail in force after `k` whole sessions, or null before 3R (or on a plan with no trail). */
export function trailAt(story, k) {
  const steps = story?.trail
  if (!steps?.length || !(k >= steps[0].known)) return null
  let cur = steps[0]
  for (const st of steps) if (st.known <= k) cur = st
  return cur
}

/** The stop on what is left after `k` whole sessions: the trail once a higher low has lifted it, else the plan's stop. */
export function stopAt(story, plan, k) {
  const tr = trailAt(story, k)
  return tr && tr.low != null ? { kind: 'trail', level: tr.level, low: tr.low } : { kind: 'stop', level: plan.stop, low: null }
}

/** The member's exits from their calls: a Take some off at a point exits some at that point's R (at each of its levels,
 *  where it says two), a Sell the rest exits the rest there (at the first level price reaches) and the member is out; a
 *  call after that moves nothing. Unanswered points are skipped. */
export function exitsOf(points, picks) {
  const exits = []
  let out = false
  ;(points || []).forEach((p, i) => {
    const a = picks?.[i]
    if (a == null || out) return
    const legs = legsOf(p)
    if (a === TRIM) for (const l of legs) exits.push({ id: l.id, label: l.label, part: 'some', r: l.r })
    else if (a === ALL) { exits.push({ id: legs[0].id, label: legs[0].label, part: 'rest', r: legs[0].r }); out = true }
  })
  return { exits, out }
}

/** The plan's own exits: its answer at every point (none at a point it makes no call at). */
export const planExits = (story) => exitsOf(story?.points, (story?.points || []).map((p) => p.answer))

/** Where an exit was, in a sentence: a target by its name, the post-gap high and the high-volume close by name and R, a
 *  stop or a trail by its R. */
const isTarget = (id) => id === 't1' || id === 't2'
const where = (e) => (isTarget(e.id) ? `at ${e.label}` : NAMED[e.id] ? `at ${NAMED[e.id]}, ${rText(e.r)}` : `at ${rText(e.r)} on the ${e.id === 'trail' ? 'trail' : 'stop'}`)
const joinAnd = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || '')

/** The exits as plain sentences, each with its own R and no size invented: "Some off at 2R and 3R. The rest out at +2.4R
 *  on the trail." What was still held when the story ended is said too: open at the last close, or held when the plan
 *  was out. */
export function exitsText({ exits, out }, end) {
  const some = exits.filter((e) => e.part === 'some')
  const rest = exits.find((e) => e.part === 'rest')
  const parts = []
  if (some.length) parts.push(`Some off at ${joinAnd(some.map((e) => NAMED[e.id] || `${rText(e.r)} on the ${e.id === 'trail' ? 'trail' : 'stop'}`))}.`)
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
  const some = exits.filter((e) => e.part === 'some').map((e) => NAMED[e.id] || `the ${e.id === 'trail' ? 'trail' : 'stop'}`)
  return some.length ? `You took some off at ${joinAnd(some)}. The rest is still on.` : 'You hold the full position.'
}

/** The short word for the position chip. */
export function positionWord({ exits, out }) {
  if (out) return 'Out'
  return exits.some((e) => e.part === 'some') ? 'Some off' : 'Full'
}

// ── the copy at each stop ─────────────────────────────────────────────────────────────────────────────────────────────

/** What just happened, in one sentence with its price. */
export function eventLine(point, long = true) {
  const at = px(point.level)
  if (point.legs) {
    // a post-gap high and a target on one bar (a long: the lower one first)
    const [a, b] = point.legs
    if (b.gap) return `It opened over ${NAMED[a.id]} and ${NAMED[b.id]}, at ${px(b.fill)}.`
    if (a.gap) return `It opened over ${NAMED[a.id]}, at ${px(a.fill)}, and ${NAMED[b.id]} just traded, at ${px(b.level)}.`
    return `${cap(NAMED[a.id])} and ${NAMED[b.id]} both just traded, at ${px(a.level)} and ${px(b.level)}.`
  }
  if (point.id === 'pgh') return point.gap ? `It opened over the post-gap high, at ${px(point.fill)}.` : `Price just traded up to the post-gap high, ${at}.`
  if (point.id === 'hvc') {
    return point.gap ? `It opened back ${long ? 'under' : 'over'} the high-volume close, at ${px(point.fill)}.` : `Price just came back to the high-volume close, ${at}.`
  }
  if (point.id === 't1' || point.id === 't2') {
    if (point.gap) return `It opened ${long ? 'over' : 'under'} ${point.label}, at ${px(point.fill)}.`
    return point.session === 0 ? `${point.label} traded on the entry day itself, at ${at}.` : `${point.label} just traded, at ${at}.`
  }
  if (point.id === 'stop') {
    return point.gap ? `It opened ${long ? 'under' : 'over'} your stop, at ${px(point.fill)}.` : `Price just traded ${long ? 'down' : 'up'} through your stop, ${at}.`
  }
  return point.gap ? `It opened under the trail, at ${px(point.fill)}.` : `Price just traded under ${at}, the higher low of day ${point.low}.`
}

/** The question at a stop: what happened, then the call. A member who is already out is asked what the plan does (at a
 *  point the plan leaves to the member, what they would do). */
export function questionOf(point, long = true, inPosition = true) {
  const out = isFree(point) ? 'You are already out. What would you do here?' : 'You are already out. What does the plan do here?'
  return `${eventLine(point, long)} ${inPosition ? 'What do you do?' : out}`
}

/** The tag over the question. */
export const stopTag = (point) => `The replay stops · ${point.label}`

const rest = (plan) => (trailMeasured(plan) ? 'trails the rest under each higher low' : 'lets the rest ride on the stop')

/** The stop on what is left at the first return to the high-volume close: the edge bar's low (its high on a short). */
const edgeStop = (plan) => `${isLong(plan) ? 'under' : 'over'} it, at ${px(plan.stop)}, the edge bar's ${isLong(plan) ? 'low' : 'high'}`

/** Why the plan does what it does here, for the pick the member made: { ok, title, text }. Every line is the plan's own
 *  rule (docs/study/TRADE_PLANS.md, api/services/study_trade.replay_checks) or the owner's own words (VOICE.md §3). At a
 *  point the plan makes no call at, ok is null: the plan's words, its stop, and what the member did. */
export function whyOf(point, pick, plan) {
  const long = isLong(plan)
  const free = isFree(point)
  const ok = free ? null : pick === point.answer
  const out = rText(point.r)
  const gap = point.gap ? ` It opened ${point.id === 'trail' || long ? 'under' : 'over'} the level: a stop cannot catch an overnight gap.` : ''
  // a target the day opened past: the level never printed, the open is the fill
  const past = point.gap ? ` It opened past ${NAMED[point.id] || point.label}, so the open is the fill: ${out}.` : ''
  let text
  if (point.legs) {
    // the post-gap high and a target on one bar: the plan takes some off at each
    const [a, b] = point.legs
    const both = `${NAMED[a.id]} and ${NAMED[b.id]}`
    const opened = a.gap ? ` It opened past ${b.gap ? both : NAMED[a.id]}, so the open is the fill: ${rText(a.r)}.` : ''
    text = ok ? `${cap(both)} both traded: the plan takes some off at each. It names the levels, not how much to sell. What is left rides on the stop.${opened}`
      : pick === HOLD ? `At ${both} the plan takes some off. It names the levels, not how much to sell.${opened}`
        : `Neither is the exit. The plan takes some off at ${both} and ${rest(plan)}.${opened}`
  } else if (point.id === 'pgh') {
    text = ok ? `The plan names the post-gap high as the first place to take some off. It names the level, not how much to sell. What is left rides on the stop.${past}`
      : pick === HOLD ? `At the post-gap high the plan takes some off. It names the level, not how much to sell.${past}`
        : `The post-gap high is a place to take some off, not the exit. The plan takes some off here and ${rest(plan)}.${past}`
  } else if (point.id === 'hvc') {
    const opened = point.gap ? ` It opened past it, so the open is the fill: ${out}.` : ''
    if (free) {
      const did = pick === HOLD ? 'You held.' : pick === TRIM ? `You took some off at ${out}.` : `You ${long ? 'sold' : 'covered'} the rest at ${out}.`
      return { ok: null, title: 'Your call.', text: `The plan calls the first return to the high-volume close the cleanest decision point, and leaves the call to you. The stop is still ${edgeStop(plan)}. ${did}${opened} This one is not scored.` }
    }
    const tail = point.answer === HOLD ? `The stop stays ${edgeStop(plan)}.`
      : point.answer === TRIM ? 'It names the level, not how much to sell. What is left rides on the stop.' : `Out at ${out}.`
    text = `At the first return to the high-volume close, the cleanest decision point, the plan ${planVerb(point.answer, long)}. ${tail}${opened}`
  } else if (point.id === 't1') {
    text = ok ? `2R is the first target: take some off. The plan names the level, not how much to sell. What is left rides on the stop.${past}`
      : pick === HOLD ? `At 2R the plan takes some off: 2R is the first target. It names the level, not how much to sell.${past}`
        : `2R is the first of two targets. The plan takes some off here and lets the rest ride on the stop.${past}`
  } else if (point.id === 't2') {
    const after = trailMeasured(plan) ? 'What is left now trails under each higher low.' : 'What is left rides on the stop.'
    text = ok ? `3R is the second target: take some off. ${after}${past}`
      : pick === HOLD ? `At 3R the plan takes some off again: 3R is the second target. ${after}${past}`
        : `3R is the second target, not the exit. The plan takes some off and ${rest(plan)}.${past}`
  } else if (point.id === 'stop') {
    text = ok ? `The stop is an appointment, not a debate. Out at ${out}.${gap}`
      : pick === HOLD ? `The stop is an appointment, not a debate. At the stop the plan is out of all of it, at ${out}.${gap}`
        : `At the stop the plan ${planVerb(ALL, long)}, not part of it. Out at ${out}.${gap}`
  } else {
    const under = `Price traded under the higher low of day ${point.low}, ${px(point.level)}`
    text = ok ? `The trail is the stop on what is left. ${under}: out at ${out}.${gap}`
      : pick === HOLD ? `The trail is the stop on what is left. ${under}, so the plan sells the rest at ${out}.${gap}`
        : `A broken trail ends the trade. The plan sells all that is left, not part of it, at ${out}.${gap}`
  }
  return { ok, title: ok ? 'That is the plan.' : 'Not the plan.', text }
}

/** The definition the trail uses, said once where it matters (the 3R stop and the trail's). */
export const TRAIL_RULE = 'A higher low: a day whose low sits under the days either side of it, and above the last such low. The stop on what is left moves up under each one the day after, and never moves down.'

/** THE WORKING at a stop, in steps a member can check on the chart: the risk a share, the level, and the exit's R, each
 *  on the plan's own prices to the cent. A target the plan rounded a cent away from the entry plus its multiple of the
 *  rounded risk is said without the sum, so a printed sum never disagrees with the line on the chart. */
export function workingOf(point, plan) {
  const long = isLong(plan)
  const e = cents(plan.entry), st = cents(plan.stop), risk = riskCents(plan)
  const c2 = (v) => (v / 100).toFixed(2)
  const steps = [{ key: 'risk', text: long ? `Risk a share: ${c2(e)} − ${c2(st)} = ${c2(risk)}.` : `Risk a share: ${c2(st)} − ${c2(e)} = ${c2(risk)}.` }]
  const f = cents(point.fill)
  const num = long ? `(${c2(f)} − ${c2(e)})` : `(${c2(e)} − ${c2(f)})`
  const numOf = (leg) => (long ? `(${c2(cents(leg.fill))} − ${c2(e)})` : `(${c2(e)} − ${c2(cents(leg.fill))})`)
  if (point.id === 'pgh') {
    // the post-gap high, and the target that traded on the same bar when there is one, in the order price reached them
    for (const leg of legsOf(point)) {
      const lv = cents(leg.level)
      if (isTarget(leg.id)) {
        const m = TARGET[leg.id].r
        steps.push({ key: `level-${leg.id}`, text: e + m * risk === lv ? `${leg.label}: ${c2(e)} + ${m} × ${c2(risk)} = ${c2(lv)}.`
          : `${leg.label}: the entry plus ${m === 2 ? 'twice' : 'three times'} the risk, ${c2(lv)} on the plan.` })
        if (leg.gap) steps.push({ key: `fill-${leg.id}`, text: `It opened at ${c2(cents(leg.fill))}, past ${leg.label}, so that is the fill: ${numOf(leg)} ÷ ${c2(risk)} = ${rText(leg.r)}.` })
      } else {
        steps.push({ key: 'level-pgh', text: `The post-gap high: ${c2(lv)}, the highest price from the gap day through the entry day.` })
        steps.push({ key: 'fill-pgh', text: leg.gap ? `It opened at ${c2(cents(leg.fill))}, past it, so that is the fill: ${numOf(leg)} ÷ ${c2(risk)} = ${rText(leg.r)}.`
          : `At ${c2(lv)}: ${numOf(leg)} ÷ ${c2(risk)} = ${rText(leg.r)}.` })
      }
    }
    steps.push({ key: 'call', text: point.legs ? `At ${NAMED[point.legs[0].id]} and ${NAMED[point.legs[1].id]} the plan takes some off. It names the levels, not how much to sell.`
      : 'At the post-gap high the plan takes some off. It names the level, not how much to sell.' })
    return steps
  }
  if (point.id === 'hvc') {
    steps.push({ key: 'level', text: `The high-volume close: ${c2(e)}, the edge day's close and the entry.` })
    steps.push({ key: 'return', text: `It closed ${long ? 'over' : 'under'} it on day ${point.above}, and day ${point.session} came back to it.` })
    steps.push({ key: 'r', text: point.gap ? `It opened at ${c2(f)}, past it, so an exit fills there: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.`
      : `An exit there: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.` })
    steps.push({ key: 'stop', text: `The stop is still ${c2(st)}, the edge bar's ${long ? 'low' : 'high'}.` })
    steps.push({ key: 'call', text: isFree(point) ? 'The plan calls this the cleanest decision point and leaves the call to you.'
      : `At the first return the plan ${planVerb(point.answer, long)}.` })
    return steps
  }
  if (point.id === 't1' || point.id === 't2') {
    const m = TARGET[point.id].r
    const sum = long ? e + m * risk : e - m * risk
    const lv = cents(point.level)
    steps.push({ key: 'level', text: sum === lv
      ? `${point.label}: ${c2(e)} ${long ? '+' : '−'} ${m} × ${c2(risk)} = ${c2(lv)}.`
      : `${point.label}: the entry ${long ? 'plus' : 'minus'} ${m === 2 ? 'twice' : 'three times'} the risk, ${c2(lv)} on the plan.` })
    if (point.gap) steps.push({ key: 'fill', text: `It opened at ${c2(f)}, past ${point.label}, so that is the fill: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.` })
    steps.push({ key: 'call', text: `At ${point.label} the plan ${planVerb(TRIM, long)}. It names the level, not how much to sell.` })
    if (point.id === 't2') {
      steps.push({ key: 'next', text: trailMeasured(plan) ? TRAIL_RULE
        : plan?.trail ? `What is left rides on the stop here. This plan's trail is a judgment, not a level: ${plan.trail}.`
          : 'This plan names no trail, so what is left rides on the stop.' })
    }
    return steps
  }
  if (point.id === 'trail') steps.push({ key: 'level', text: `The trail: the higher low of day ${point.low}, ${px(point.level)}. Price traded under it.` })
  else steps.push({ key: 'level', text: `The stop: ${px(point.level)}, ${point.gap ? 'and the day opened past it' : 'and price traded through it'}.` })
  steps.push({ key: 'r', text: `Out at ${c2(f)}: ${num} ÷ ${c2(risk)} = ${rText(point.r)}.` })
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

/** The trade the plan takes, in one line: "Bought at 13.11 · stop 12.65 · 3.5% risk". */
export function planLine(plan) {
  if (!planOk(plan)) return ''
  return `${isLong(plan) ? 'Bought' : 'Shorted'} at ${px(plan.entry)} · stop ${px(plan.stop)} · ${riskPct(plan).toFixed(1)}% risk`
}

/** The calls in one trade: right and how many. A call at a point the plan leaves to the member is neither. */
export function callsOf(story, picks) {
  const pts = story?.points || []
  let right = 0, total = 0
  pts.forEach((p, i) => { if (picks?.[i] != null && !isFree(p)) { total += 1; if (picks[i] === p.answer) right += 1 } })
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
 *  counts, it has no calls). A trade was on the plan when the setup was named and every call matched the plan. */
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
      const ok = a === p.answer
      if (ok) right += 1
      results.push(ok)
    })
  }
  return { right, total, named, played, results }
}

/** The end screen's run log: one card per scored call, the plan's call named, the trade's ticker and setup, what was said
 *  on a miss. A call the plan leaves to the member is not a card (it is neither right nor wrong): yoursLines says it. */
export function logRows(trades) {
  const rows = []
  for (const tr of trades || []) {
    if (!tr || tr.skipped) continue
    ;(tr.story?.points || []).forEach((p, i) => {
      const a = tr.picks?.[i]
      if (a == null || isFree(p)) return
      const ok = a === p.answer
      rows.push({ name: `${p.label} · ${actionLabel(p.answer, tr.long !== false)}`, ticker: tr.ticker ? `${tr.ticker} · ${tr.name}` : tr.name, ok,
        said: ok ? null : actionLabel(a, tr.long !== false).toLowerCase(), was: '' })
    })
  }
  return rows
}

/** Each trade's ending in one line for the end screen: "JBI · Kicker: some off at 2R and 3R. The rest out at +2.4R on the
 *  trail." The member's own exits. */
export function tradeLine(tr) {
  const head = `${tr.ticker ? `${tr.ticker} · ` : ''}${tr.name}`
  if (tr.skipped) return `${head}: not scored, so not played.`
  if (!tr.story) return `${head}: no trade plan came back, so there was nothing to manage.`
  const text = exitsText(exitsOf(tr.story?.points, tr.picks), tr.story?.end)
  return `${head}: ${text ? text.charAt(0).toLowerCase() + text.slice(1) : 'nothing to manage.'}`
}

/** The end screen's line for each call the plan left to the member: "AMD · High Volume Edge: the first return to the
 *  high-volume close, day 9, was a decision point the plan leaves to you. You held." */
export function yoursLines(trades) {
  const lines = []
  for (const tr of trades || []) {
    if (!tr || tr.skipped || !tr.story) continue
    const head = `${tr.ticker ? `${tr.ticker} · ` : ''}${tr.name}`
    tr.story.points.forEach((p, i) => {
      const a = tr.picks?.[i]
      if (!isFree(p) || a == null) return
      const did = a === HOLD ? 'You held.' : a === TRIM ? `You took some off at ${rText(p.r)}.` : `You ${tr.long === false ? 'covered' : 'sold'} the rest at ${rText(p.r)}.`
      lines.push(`${head}: the first return to the high-volume close, day ${p.session}, was a decision point the plan leaves to you. ${did}`)
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
