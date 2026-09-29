// app/src/components/provenance/freshnessAge.js
//
// ─── TERM-006 / RM-N03 — ONE SHELL-LEVEL FRESHNESS AUTHORITY, IN TIME UNITS ──
//
// ─── ⛔⛔ THE CEILING IS A RULING, AND THE RULING IS THE CARD — READ IT THERE ──
//
//     docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-26.md
//     CARD 33 §2 — "MAX AGE A PANEL MAY DISPLAY SILENTLY"    (fac059c23)
//
// ⛔ IT IS DELIBERATELY NOT RESTATED HERE, and neither is the quantity behind
// it. A second copy of a ruling is how "a second authority over one value" —
// this repo's most-recorded defect — is born, and RM-N03 is the instance where
// it nearly was: the card was committed 2026-09-26 13:01:42 and this module
// 21:46:40 the SAME DAY, eight hours apart, by two sessions neither of which had
// read the other. Both then shipped (both are ancestors of `origin/production`).
// This header used to open "THE RULING (the owner delegated the decision
// explicitly)" — true about the delegation, and the reason nothing pointed
// anywhere for a day. ⛔ Do not re-describe the card's rule below; cite it.
//
// WHAT EACH ONE OWNS, so the next reader does not have to re-derive it:
//
//   CARD 33 §2 owns THE CEILING — the longest a panel may stay silent, plus the
//     obligation past it ("anything older must state its as-of ON THE SURFACE").
//     It is a MAXIMUM on silence: its own word for the shape is "ceiling". It
//     therefore permits anything TIGHTER and mandates no silence at all, which
//     is the whole reason this module's floor is not a competing rule.
//   THIS MODULE owns THE IMPLEMENTATION, in time units — the two constants
//     below, and the DERIVATION of the card's ceiling from S11 instead of a
//     second statement of it (`oneTradingSessionMs`).
//
// ⛔ EDIT EITHER AND THE OTHER GOES RED. `freshnessAge.test.js` §8 reads the
// card's ceiling sentence out of the file named above and asserts this module's
// derived ceiling is still that ceiling — so it fails if the card's sentence is
// edited away, if this citation rots, or if any cadence's threshold is let past
// the derived session.
//
// THE CONTRACT THIS MODULE IMPLEMENTS (not a second ruling — the mechanics of
// obeying that one, with two numbers the card does not set):
//
//     A panel must show its age when the value is older than TWICE the cadence
//     it was fetched at — never less than 60 seconds, and never past the card's
//     ceiling, which is one trading session as S11 measures it.
//
//     thresholdMs = clamp(AGE_CADENCE_MULTIPLE x cadenceMs,
//                         AGE_FLOOR_MS,
//                         CARD 33 §2's ceiling, as S11 reports it)
//     mustShowAge <=> (now - asOf) > thresholdMs        // strictly greater
//
// ⭐ WHY TWICE ITS OWN CADENCE AND NOT AN ABSOLUTE NUMBER. A single absolute
// threshold is INCOHERENT across data classes. Set it at 5 minutes and every
// daily breadth row is permanently badged — and a badge that fires on
// everything signals nothing. Set it at 4 hours and a stale price passes
// unlabelled. Relative to the panel's own cadence, a badge says *"this missed a
// beat"* rather than *"this is a panel"*.
//
// ⭐ WHY A 60-SECOND FLOOR. So a 15s-cadence panel does not badge on ordinary
// network jitter: 2 x 15s = 30s, and a single slow round trip would light up a
// perfectly healthy panel. The floor is what keeps the fast panels quiet.
//
// ⭐ WHY A ONE-TRADING-SESSION CAP. So nothing daily-or-slower escapes
// labelling entirely. A daily panel's 2x cadence is 48 hours, which would let a
// breadth row from Tuesday render unlabelled on Thursday. With the cap it says
// so. ⛔ THE CAP IS NOT THIS FILE'S NUMBER TO CHOOSE — it is CARD 33 §2's
// ceiling, cited at the top, DERIVED below from S11 and never restated here.
//
// ⭐ WHY THE RULING IS TIGHT RATHER THAN GENEROUS — the asymmetry that decides
// every edge in this file: an UNLABELLED STALE NUMBER CAN COST A MEMBER MONEY;
// A BADGE COSTS PIXELS. Where a case is genuinely ambiguous, this module picks
// the side that labels, and says in the code why.
//
// ─── ⛔⛔ WHY THIS IS NOT A FIFTH COPY — WHAT EACH EXISTING MODULE OWNS ──────
//
// A second authority over one value is this repo's single most-recorded defect,
// so the four modules that already ship in this family are named here with the
// question each one answers. None of them answers this one.
//
//   `freshnessContract.js`   OWNS: the interpretation of D1's `FreshnessClass`
//     enum (`real_time` / `delayed_15` / `end_of_day` / `historical` / `stale`)
//     into a presentation shape, exhaustively, throwing on a sixth value.
//     It is a CLASS a vendor asserts about its own feed. It contains no
//     duration, no cadence and no clock — it cannot answer "how old is this".
//
//   `sessionStale.js`        OWNS: "has the market's session moved on since
//     this value was captured?" — a BOUNDARY-CROSSING test against S11's
//     `sessionState().boundaryAt`. Its own header is explicit that session
//     staleness is "never a flat wall-clock timeout". That is a DIFFERENT
//     question from this file's, and the two must not be merged:
//     `computeSessionStale` is true for a value captured 90 seconds before the
//     open and false for a value captured six hours into a session — neither of
//     which is an answer about age relative to cadence.
//     ⚠️ SEE "THE CONTRADICTION" BELOW — that header sentence and this ruling
//     have to be read together.
//
//   `FreshnessBadge.jsx`     OWNS: rendering. Its header states that it
//     "computes NOTHING from elapsed time itself, by design (it renders; it
//     does not decide)", and `sessionStale` arrives as a CALLER-SUPPLIED prop.
//     So the decision this file makes is exactly the decision that component
//     deliberately refuses to make, and it belongs outside it.
//
//   `lib/marketClock/marketClock.js` (S11) OWNS: sessions, holidays, half-days
//     and every boundary instant. ⛔ THIS FILE DOES NOT RE-DERIVE ANY OF THAT.
//     "One trading session" is MEASURED from S11's own `nextBoundary()` event
//     stream (`oneTradingSessionMs` below) rather than restated as a duration —
//     which is why no 6.5-hour literal appears anywhere in this module, and why
//     a half-day is automatically 3.5 hours without this file knowing what a
//     half-day is.
//
// ⚠️ ALSO NOT A COMPETITOR, and worth naming because the filename collides:
// `components/chart/engine/ast/freshness.js` is a per-formula CADENCE CLAIM
// (`live` / `as-of-snapshot` / `unknown`) stamped on an indicator definition at
// lint time. Its own header says it in capitals: *"IT IS A CADENCE CLAIM, NOT A
// STALENESS MEASUREMENT... How fresh a given symbol's row IS is a per-row
// runtime fact."* This file is that runtime fact. They are two halves, not two
// copies.
//
// ─── ⚠️ THE CONTRADICTION, STATED RATHER THAN SMOOTHED OVER ──────────────────
//
// `sessionStale.js` says session staleness is "never a flat wall-clock
// timeout... not merely 'some amount of wall-clock time has passed'" (PRD-S8
// §9.6). The ruling above IS an elapsed-time rule. Both stand, because they
// answer different questions and are rendered as different things:
//   - `computeSessionStale` -> "the view needs refreshing, the session moved on"
//   - `mustShowAge`         -> "this value must display its age"
// It is also not a FLAT timeout: it is relative to the panel's own cadence and
// bounded by a real trading session that S11 measures. If a future reader wants
// one of these to absorb the other, the thing to notice first is that
// `FreshnessBadge` already renders them through two separate, deliberately
// distinct surfaces (`session-stale-note` vs an age clause).
//
// ─── ITS CONSUMERS — ONE PANEL, NAMED (TERM-059, 2026-09-29) ─────────────────
//
// ⚰️ This section was "NO CONSUMER YET, ON PURPOSE": the authority landed with
// its rails and nothing imported it from a panel, and
// `components/screener/reachable.test.js` parked it by name with TERM-059 as its
// adoption. TERM-059 is the first consumer: the Breadth Monitor's NAAIM column
// asks this authority, through `pages/breadth/naaimAge.js`, whether the weekly
// survey's reading must state its as-of, and the cell renders the answer with
// `<FreshnessBadge age={...}>`. The parking entry came out in the same commit.
//
// ⚠️ ONE PANEL IS NOT ADOPTION. The provenance census
// (`panelAdoption.measure.test.js`) measures hundreds of non-adopting panels
// under `pages/**`; each further adopter is its own scoped decision, and
// `freshnessAge.test.js` §7 names every importer so a new one is a reviewed
// line rather than a silent spread.
//
// ⚠️ THAT NUMBER WAS RE-RUN, NOT QUOTED. `D-PAGES` reports examined=525
// adopting=6 not-adopting=519, with 204 of the 519 in
// `pages/journal-2-0/components` (census run 2026-09-26). The brief that
// commissioned this module carried 518, which is one behind — recorded here
// because a count re-typed beside the artifact that owns it is this repo's
// most-repeated defect, and this one had already drifted by one.

import { nextBoundary } from '../../lib/marketClock/marketClock'
import { coerceAsOf } from './sessionStale'

/** ⛔⛔ THE TWO CONSTANTS OF THE RULING LIVE HERE AND NOWHERE ELSE.
 *  `freshnessAge.test.js` walks every module under `app/src` for a competing
 *  declaration or a hard-coded trading-session duration, with comments
 *  stripped, and carries controls proving the check can see a real one. Do not
 *  copy either number into a consumer — import it. */
export const AGE_CADENCE_MULTIPLE = 2
export const AGE_FLOOR_MS = 60_000

/** How far to walk S11's boundary stream looking for one complete
 *  open -> close pair. A trading day emits four boundary events, and NYSE's
 *  longest gap between trading days is a long holiday weekend, so a handful of
 *  events is always enough; the bound exists so a calendar edge can never spin. */
const _MAX_BOUNDARY_WALK = 12

/**
 * The length of one trading session, in milliseconds, MEASURED FROM S11 — the
 * next `open` -> `close` pair strictly after `now` in
 * `marketClock.nextBoundary()`'s own event stream.
 *
 * ⛔ DERIVED, NEVER RESTATED. There is no 6.5-hour constant in this repo and
 * there must not be one: S11 owns session boundaries, half-days and holidays,
 * so asking it is the only way this number cannot drift away from the calendar.
 * A half-day therefore reports 3.5 hours with no code here knowing that
 * half-days exist — and a shorter session makes the cap TIGHTER, which is the
 * safe direction under the asymmetry named in the header.
 *
 * Returns `null` when the walk finds no complete pair (S11's search window
 * exhausted). ⚠️ That `null` is SURFACED, never silently replaced by a literal
 * — see `ageThresholdMs`, where it is the one case in which this authority is
 * more permissive than the ruling, and is named (`capMs: null`) rather than
 * hidden.
 */
export function oneTradingSessionMs(now = new Date()) {
  let cursor = coerceAsOf(now) || new Date()
  let openAt = null
  for (let i = 0; i < _MAX_BOUNDARY_WALK; i += 1) {
    const ev = nextBoundary(cursor)
    if (!ev) return null
    cursor = ev.at
    if (ev.kind === 'open') openAt = ev.at
    else if (ev.kind === 'close' && openAt) return ev.at.getTime() - openAt.getTime()
  }
  return null
}

/**
 * The threshold the ruling produces for one panel's cadence, plus the whole
 * derivation so a consumer never has to recompute any part of it.
 *
 * `{ thresholdMs, bound, cadenceMs, floorMs, capMs }` where `bound` names WHICH
 * of the three rules actually decided the number — `'cadence'`, `'floor'` or
 * `'session_cap'`. A consumer that wants to explain a badge reads `bound`; it
 * must never re-derive it from the numbers.
 *
 * ⚠️ A MISSING, ZERO, NEGATIVE OR NON-FINITE CADENCE FALLS TO THE FLOOR, which
 * is the TIGHTEST threshold the ruling permits (the clamp's lower bound). That
 * is deliberate and it is the asymmetry again: an undeclared cadence is a bug
 * in the caller, and the failure that costs a member money is the permissive
 * one. It is visible in the result as `cadenceMs: null` with `bound: 'floor'`.
 */
export function ageThresholdMs({ cadenceMs = null, now = new Date() } = {}) {
  const usableCadence = Number.isFinite(cadenceMs) && cadenceMs > 0 ? cadenceMs : null
  const fromCadence = usableCadence === null
    ? AGE_FLOOR_MS
    : AGE_CADENCE_MULTIPLE * usableCadence
  const floored = Math.max(fromCadence, AGE_FLOOR_MS)
  const capMs = oneTradingSessionMs(now)
  const capped = capMs === null ? floored : Math.min(floored, capMs)

  let bound
  if (capMs !== null && capMs < floored) bound = 'session_cap'
  else if (fromCadence <= AGE_FLOOR_MS) bound = 'floor'
  else bound = 'cadence'

  return Object.freeze({
    thresholdMs: capped, bound, cadenceMs: usableCadence, floorMs: AGE_FLOOR_MS, capMs,
  })
}

/**
 * ⭐ THE AUTHORITY. "Must this value display its age?", with its whole
 * derivation attached: `{ mustShow, reason, ageMs, thresholdMs, bound,
 * cadenceMs, floorMs, capMs }`.
 *
 * `asOf` is the value's own timestamp and accepts a Date, an ISO string, or
 * epoch seconds/ms — read through `sessionStale.js`'s `coerceAsOf`, so there is
 * ONE reading of a D1 timestamp in this family rather than two.
 *
 * `reason` is one of:
 *   `'no_timestamp'`      — there is no age to show, so this authority cannot
 *                           answer and returns `false`. ⚠️ It is NOT a claim of
 *                           freshness. A value whose age is unknown is
 *                           `freshnessContract`'s `unknown` tier, which is the
 *                           honest render for that case; do not read a `false`
 *                           here as permission to render it bare.
 *   `'within_threshold'`  — measured, and inside the threshold. The control
 *                           case: a fresh value must NOT badge, or the whole
 *                           thing passes by answering "yes" to everything.
 *   `'older_than_threshold'` — measured, and past it. Show the age.
 *
 * A future-dated `asOf` yields a negative age and therefore `false`: a clock
 * skew is not evidence of staleness.
 */
export function explainMustShowAge({ asOf = null, cadenceMs = null, now = new Date() } = {}) {
  const nowDate = coerceAsOf(now) || new Date()
  const threshold = ageThresholdMs({ cadenceMs, now: nowDate })
  const asOfDate = coerceAsOf(asOf)
  if (!asOfDate) {
    return Object.freeze({ ...threshold, mustShow: false, reason: 'no_timestamp', ageMs: null })
  }
  const ageMs = nowDate.getTime() - asOfDate.getTime()
  const mustShow = ageMs > threshold.thresholdMs
  return Object.freeze({
    ...threshold,
    mustShow,
    reason: mustShow ? 'older_than_threshold' : 'within_threshold',
    ageMs,
  })
}

/**
 * The one-line form of the authority, for a consumer that needs only the
 * verdict.
 *
 * ⛔ DERIVED FROM `explainMustShowAge`, never a second implementation of the
 * same decision — the two can therefore never disagree, and a rail asserts
 * exactly that over a table of cases.
 */
export function mustShowAge(input) {
  return explainMustShowAge(input).mustShow
}
