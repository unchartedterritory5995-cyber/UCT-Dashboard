//
// The §4.5 report-night state machine. PURE FUNCTIONS OF DATA TIMESTAMPS —
// there are no scheduled UI timers here beyond the polling cadence the modal
// applies, and `nowMs` is always injected so no test can be a weekday bomb.
//
// TIME HANDLING (decided): all ET arithmetic runs on WALL-CLOCK PARTS pulled
// through Intl with timeZone 'America/New_York', never on epoch offsets, so
// DST is correct by construction. The calendar's `time_et` is documented as ET
// but is NOT guaranteed to carry an offset, and `new Date('2026-08-06T16:30')`
// parses as LOCAL time (this box is CT) — an hour of silent skew across the
// whole machine. So `time_et` is honoured only when it carries an explicit
// offset or Z; otherwise the session anchor wins.

export const IMMINENT_LEAD_MINUTES = 15

/** ET wall-clock anchors for the report window when no precise time is given. */
export const SESSION_ANCHOR_MINUTES = { bmo: 7 * 60, amc: 16 * 60, tbd: 16 * 60 }

/** §4.5: 30-60s while the modal is open on a today-reporter. Nothing else. */
export const ACTUALS_POLL_MS = 45000

const HAS_OFFSET = /([Zz]|[+-]\d{2}:?\d{2})$/

const _fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** { date: 'YYYY-MM-DD', minutes } in ET for an epoch ms value. */
export function etParts(ms) {
  const parts = Object.fromEntries(
    _fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  )
  // Intl can render midnight as hour '24' in some engines; normalise it.
  const hour = Number(parts.hour) % 24
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  }
}

/** The ET wall-clock instant the report window opens, or null. */
export function windowStart({ reportDate, timing, timeEt } = {}) {
  const date = typeof reportDate === 'string' ? reportDate.slice(0, 10) : null
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (typeof timeEt === 'string' && HAS_OFFSET.test(timeEt.trim())) {
    const ms = Date.parse(timeEt)
    if (Number.isFinite(ms)) return etParts(ms)
  }
  const key = (timing || '').toLowerCase()
  const minutes = SESSION_ANCHOR_MINUTES[key] ?? SESSION_ANCHOR_MINUTES.amc
  return { date, minutes }
}

/** Signed minutes from `a` to `b`, both { date, minutes }. */
function minutesBetween(a, b) {
  const days = (Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${a.date}T00:00:00Z`)) / 86400000
  return days * 1440 + (b.minutes - a.minutes)
}

/**
 * The state, in strict precedence order:
 *   POST       a recap exists (whatever else is true)
 *   CALL_LIVE  actuals present AND the call start has passed, recap absent
 *   PRINTED    actuals present
 *   IMMINENT   the window (minus the lead) has been entered, no actuals
 *   PRE        everything else, including an unknown report date
 */
export function computeLifecycle({
  nowMs, reportDate, timing, timeEt, reported, recapPresent, callStartMs,
} = {}) {
  if (recapPresent) return 'POST'
  if (reported) {
    if (Number.isFinite(callStartMs) && Number.isFinite(nowMs) && nowMs >= callStartMs) {
      return 'CALL_LIVE'
    }
    return 'PRINTED'
  }
  const start = windowStart({ reportDate, timing, timeEt })
  if (!start || !Number.isFinite(nowMs)) return 'PRE'
  return minutesBetween(etParts(nowMs), start) <= IMMINENT_LEAD_MINUTES ? 'IMMINENT' : 'PRE'
}

/** 'in 4h 12m' / 'in 48m', or null once the window is reached. */
export function countdownText(nowMs, start) {
  if (!start || !Number.isFinite(nowMs)) return null
  const mins = minutesBetween(etParts(nowMs), start)
  if (mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h >= 1 ? `in ${h}h ${m}m` : `in ${m}m`
}

/** §4.5 step 2 — the ONLY condition under which the actuals poll may run. */
export function shouldPollActuals({ lifecycle, isTodayReporter, modalOpen } = {}) {
  return lifecycle === 'IMMINENT' && !!isTodayReporter && !!modalOpen
}
