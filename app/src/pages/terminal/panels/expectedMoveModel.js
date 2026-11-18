// EXMV: what the options market prices for one stock's next earnings report, against what the
// stock actually did on its past reports. The pure half (no React, no imports, so an agent
// capability can reuse it).
//
// ⭐ NO NEW ROUTE. Two existing reads:
//
//   GET /api/research/expected-move/{sym}?grade=0[&report_date=YYYY-MM-DD]   api/routers/expected_move.py
//     GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. Always mounted, no flag.
//     { live, live_outcome, history, history_since, grade }   (`grade=0` leaves the Setup Grade out)
//     live          the at-the-money straddle from OUR option chain read (api/services/implied_move.py
//                   over polygon_options, `source: 'massive-chain'`; not a Schwab chain), or null:
//                   { pct (PERCENT of the stock price), dollar, strike, spot, call_mid, put_mid,
//                     iv_atm, expiry, horizon, asof (ISO instant), source }
//                   ⛔ WHICH EXPIRY DEPENDS ON `report_date`. With one, it is the first expiry ON OR
//                   AFTER that day; with none it is simply the NEAREST expiry, which only holds the
//                   earnings move when the report falls before it. So this panel reads the next
//                   report date first (below) and passes it. A report beyond every listed expiry
//                   answers no number rather than a wrong one.
//                   The route does not take the report's time of day: for a report AFTER the close
//                   on an expiry day it still picks that same-day expiry, which settles before the
//                   report. `expiryIsReportDay` flags that case so the panel can warn.
//     live_outcome  { kind: 'ok' | 'refused' | 'unavailable', reason } from the same evaluation.
//                   refused = the chain was read and no trustworthy number came out; unavailable =
//                   the chain or the price could not be read. The reason vocabulary belongs to the
//                   server; this file switches on `kind` only and prints the reason as words.
//     history       up to 8 rows, newest first: what the straddle priced BEFORE each report, captured
//                   once by the nightly job: { sym, report_date, captured_at, pct, dollar, expiry,
//                   fiscal_year, fiscal_quarter }. The store began recently, so most stocks have
//                   few rows; a row whose report is still ahead is the coming report's capture.
//     history_since the earliest report date in that store for the stock.
//     A read that raises inside the route still answers 200 (live null, history []).
//
//   GET /api/earnings-intel/{sym}   api/routers/fundamentals.py (ungated by product decision, no flag)
//     the Research Earnings tab's payload. Used here for two things only:
//       next_report_date   the next scheduled report (YYYY-MM-DD), or absent
//       reaction           { events: [{ quarter, report_date, reaction_pct, eps_actual,
//                            eps_estimate }], avg_abs_move_pct, n_quarters } newest LAST, or null
//                          when fewer than 4 of the last 8 reports could be measured.
//                          reaction_pct is PERCENT: the close-to-close move of the session that
//                          first traded the result (of the report day and the next session, the
//                          one that opened furthest from its prior close), from our own daily bars.
//     a fund   { not_applicable: 'fund', reason, quarters: [] }.
//     ⛔ A REPORT TOO RECENT TO MEASURE. Until the session AFTER the report day has closed, the
//     server can only measure the report day itself, which for an after-close report is the
//     session BEFORE the news. `settled` holds such a move back as 'too-recent' instead of
//     printing it as the reaction.
//
// ⛔ THE TWO READS FAIL APART, AND A MISSING NUMBER IS NEVER 0. No implied move is a reason in
// words; no past move is "not on file"; nothing is compared unless both sides are real.
// ⛔ THE TWO SIDES ARE NOT THE SAME MEASURE, and the panel says so: the priced move runs to the
// option expiry (days), the actual move is one session.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const EXPECTED_MOVE_CODE = 'EXMV'

export const earningsIntelUrl = (sym) => `/api/earnings-intel/${encodeURIComponent(sym)}`
export const expectedMoveUrl = (sym, reportDate = null) => (
  `/api/research/expected-move/${encodeURIComponent(sym)}?grade=0${reportDate ? `&report_date=${reportDate}` : ''}`
)

/** A stored priced move and a measured report are taken as the same report when this close in days. */
export const PAIR_WINDOW_DAYS = 3

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())

/** Pure: the calendar date at the front of a value (`2026-11-19`, `2026-11-19T21:35:00Z`), or null. */
export function dayOf(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(raw))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const utc = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const DAY_MS = 86400000
const daysApart = (a, b) => Math.abs(utc(a) - utc(b)) / DAY_MS

/** Pure: the next weekday after `day` (weekends skipped; a market holiday is not known here). */
export function nextWeekday(day) {
  const d = dayOf(day)
  if (!d) return null
  let t = utc(d)
  do { t += DAY_MS } while ([0, 6].includes(new Date(t).getUTCDay()))
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Pure: has the session AFTER a report day closed, given today's date in New York? Only then can
 * the reacting session be chosen between the report day and the next one.
 */
export function settled(reportDay, today) {
  const next = nextWeekday(reportDay)
  const t = dayOf(today)
  return !!next && !!t && next < t
}

/**
 * Pure: the earnings read as this panel needs it.
 *   state       'ok' | 'fund' (funds do not report earnings; `reason` is the server's sentence) |
 *               'failed' (an error in the body, or not this route's answer)
 *   nextReport  the next report date when it is today or later, else null (a past date is not "next")
 *   events      past reports, newest first: { day, label, pct, state: 'measured' | 'too-recent' |
 *               'missing' }. `pct` is null unless measured.
 *   measured    false when the server sent no reaction block at all (fewer than 4 reports could be
 *               measured, or none are on file)
 */
export function earningsRead(body, today) {
  const none = { state: 'failed', reason: null, nextReport: null, events: [], measured: false }
  if (!isObj(body) || body.error) return none
  if (body.not_applicable) return { ...none, state: 'fund', reason: text(body.reason) || null }
  if (!Array.isArray(body.quarters)) return none
  const t = dayOf(today)
  const next = dayOf(body.next_report_date) || dayOf(isObj(body.summary) ? body.summary.next_report_date : null)
  const sent = isObj(body.reaction) && Array.isArray(body.reaction.events) ? body.reaction.events : null
  const seen = new Set()
  const events = []
  for (const it of sent || []) {
    const day = dayOf(it?.report_date)
    if (!day || seen.has(day) || (t && day > t)) continue
    seen.add(day)
    const pct = num(it.reaction_pct)
    const label = text(it.quarter)
    events.push({
      day,
      label: label && !dayOf(label) ? label : null,
      pct: pct !== null && settled(day, t) ? pct : null,
      state: pct === null ? 'missing' : settled(day, t) ? 'measured' : 'too-recent',
    })
  }
  events.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  return { state: 'ok', reason: null, nextReport: next && t && next >= t ? next : null, events, measured: sent !== null }
}

/** Pure: a server reason token as words (`some_server_reason` -> `some server reason`). Never a lookup table.
 *  ⛔ The example is deliberately NOT a real token: the server owns the vocabulary, and
 *  tests/test_implied_reason_on_the_wire.py fails on any copy of it under app/src, prose included. */
export const reasonWords = (reason) => text(reason).replace(/_/g, ' ').trim()

/**
 * Pure: the expected-move read as this panel needs it.
 *   state     'ok' | 'failed' (not this route's answer)
 *   live      null, or { pct, dollars, strike, spot, callMid, putMid, expiry, low, high, asOf }.
 *             `low` / `high` are the break-even prices (spot less / plus the straddle), null
 *             without both numbers.
 *   outcome   why there is no live number: { kind: 'refused' | 'unavailable', reason (words) },
 *             or null when the server said nothing about it
 *   history   what was priced before each report, newest first: { day, pct, dollars, expiry,
 *             capturedDay, fiscalYear, fiscalQuarter }
 *   since     the earliest report date in the store for this stock, or null
 */
export function moveRead(body) {
  const none = { state: 'failed', live: null, outcome: null, history: [], since: null }
  if (!isObj(body) || !('live' in body) || !Array.isArray(body.history)) return none
  let live = null
  if (isObj(body.live) && pos(body.live.pct) !== null) {
    const l = body.live
    const spot = pos(l.spot)
    const dollars = pos(l.dollar)
    live = {
      pct: pos(l.pct),
      dollars,
      strike: pos(l.strike),
      spot,
      callMid: pos(l.call_mid),
      putMid: pos(l.put_mid),
      expiry: dayOf(l.expiry),
      low: spot !== null && dollars !== null && spot > dollars ? spot - dollars : null,
      high: spot !== null && dollars !== null ? spot + dollars : null,
      asOf: text(l.asof) || null,
    }
  }
  let outcome = null
  if (!live && isObj(body.live_outcome) && body.live_outcome.kind !== 'ok') {
    outcome = { kind: body.live_outcome.kind === 'refused' ? 'refused' : 'unavailable', reason: reasonWords(body.live_outcome.reason) || null }
  }
  const seen = new Set()
  const history = []
  for (const it of body.history) {
    const day = dayOf(it?.report_date)
    const pct = pos(it?.pct)
    if (!day || pct === null || seen.has(day)) continue
    seen.add(day)
    const fq = num(it.fiscal_quarter)
    history.push({
      day, pct, dollars: pos(it.dollar), expiry: dayOf(it.expiry), capturedDay: dayOf(it.captured_at),
      fiscalYear: num(it.fiscal_year), fiscalQuarter: fq !== null && fq >= 1 && fq <= 4 ? fq : null,
    })
  }
  history.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  return { state: 'ok', live, outcome, history, since: dayOf(body.history_since) }
}

/** Pure: the live straddle's expiry is the report day itself (it settles before an after-close report). */
export const expiryIsReportDay = (live, nextReport) => !!live?.expiry && !!nextReport && live.expiry === nextReport

/**
 * Pure: ONE list of reports, newest first, each with what was priced before it (when the store
 * holds it) and what the stock then did (when it could be measured).
 *   row      { key, day, label, impliedPct, impliedDollars, capturedDay, actualPct, state, verdict }
 *   state    'upcoming' (the report is today or ahead) | 'measured' | 'too-recent' | 'no-actual'
 *   verdict  'beyond' (the stock moved MORE than was priced) | 'within' (as much or less) | null
 *            (one side is missing: nothing is compared)
 * A stored priced move is matched to a measured report on the same day, else to the nearest one
 * within PAIR_WINDOW_DAYS (a report date can differ by a day between two sources).
 */
export function reportRows({ history: historyIn = [], events: eventsIn = [], today = null } = {}) {
  const history = Array.isArray(historyIn) ? historyIn : []
  const events = Array.isArray(eventsIn) ? eventsIn : []
  const t = dayOf(today)
  const used = new Set()
  const rows = []
  for (const h of history) {
    const upcoming = !!t && h.day >= t
    let ev = null
    if (!upcoming) {
      ev = events.find((e) => e.day === h.day && !used.has(e.day)) || null
      if (!ev) {
        const near = events.filter((e) => !used.has(e.day) && daysApart(e.day, h.day) <= PAIR_WINDOW_DAYS)
          .sort((a, b) => daysApart(a.day, h.day) - daysApart(b.day, h.day))
        ev = near[0] || null
      }
      if (ev) used.add(ev.day)
    }
    const actualPct = ev && ev.state === 'measured' ? ev.pct : null
    rows.push({
      key: `r-${h.day}`,
      day: ev ? ev.day : h.day,
      label: (ev && ev.label) || (h.fiscalQuarter && h.fiscalYear ? `Q${h.fiscalQuarter} ${h.fiscalYear}` : null),
      impliedPct: h.pct,
      impliedDollars: h.dollars ?? null,
      capturedDay: h.capturedDay ?? null,
      actualPct,
      state: upcoming ? 'upcoming' : !ev ? 'no-actual' : ev.state === 'missing' ? 'no-actual' : ev.state,
      verdict: actualPct === null ? null : Math.abs(actualPct) > h.pct ? 'beyond' : 'within',
    })
  }
  for (const e of events) {
    if (used.has(e.day)) continue
    rows.push({
      key: `r-${e.day}`, day: e.day, label: e.label, impliedPct: null, impliedDollars: null, capturedDay: null,
      actualPct: e.state === 'measured' ? e.pct : null, state: e.state === 'missing' ? 'no-actual' : e.state, verdict: null,
    })
  }
  const seen = new Set()
  return rows
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .filter((r) => (seen.has(r.key) ? false : seen.add(r.key)))
}

/**
 * Pure: the past reports against TODAY'S priced move.
 *   n        measured past reports
 *   avgAbs   their average size (percent), null with none
 *   beyond   how many moved more than `livePct`, null when there is no live number
 *   biggest  the largest of them in size (signed percent), null with none
 */
export function recordVsToday(rows, livePct) {
  const moves = (Array.isArray(rows) ? rows : []).filter((r) => r.state === 'measured' && r.actualPct !== null).map((r) => r.actualPct)
  const live = pos(livePct)
  if (!moves.length) return { n: 0, avgAbs: null, beyond: null, biggest: null }
  return {
    n: moves.length,
    avgAbs: moves.reduce((s, m) => s + Math.abs(m), 0) / moves.length,
    beyond: live === null ? null : moves.filter((m) => Math.abs(m) > live).length,
    biggest: moves.reduce((best, m) => (Math.abs(m) > Math.abs(best) ? m : best), moves[0]),
  }
}

/**
 * Pure: the reports where BOTH numbers are real (priced before, measured after).
 *   n, beyond, avgImplied, avgAbs   (the averages null with none)
 */
export function pairedRecord(rows) {
  const both = (Array.isArray(rows) ? rows : []).filter((r) => r.verdict !== null)
  if (!both.length) return { n: 0, beyond: 0, avgImplied: null, avgAbs: null }
  return {
    n: both.length,
    beyond: both.filter((r) => r.verdict === 'beyond').length,
    avgImplied: both.reduce((s, r) => s + r.impliedPct, 0) / both.length,
    avgAbs: both.reduce((s, r) => s + Math.abs(r.actualPct), 0) / both.length,
  }
}
