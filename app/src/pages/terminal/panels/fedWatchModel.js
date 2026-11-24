// FED's pure half: the route's answer -> what the panel draws. No React.
//
// GET /api/research/fed-watch (paid; api/routers/fed_watch.py over api/services/fed_watch.py) answers
// seven blocks, each with its own `state`, its source in words and its own as-of:
//   statement    Federal Reserve Board: the newest FOMC statement and the word-level difference from
//                the one before (`redline.segments`: same | added | removed | break)
//   speeches     Federal Reserve Board: speeches and testimony, newest 15 (title and link only)
//   headlines    TradeXchange: the newest Fed headlines from the news wire's own store, newest 30
//   calendar     the economic calendar: the next FOMC decision and this week's Fed speakers
//   rates        Federal Reserve Bank of New York: the effective rate and the target range, each dated
//   projections  Federal Reserve Board: the officials' median projection of the rate by year
//   survey       Federal Reserve Bank of New York: the Survey of Market Expectations
// A block that is still being read says `computing`; the panel asks again sooner while one does.
// ⛔ A missing number is never 0: it is null on the wire and words on the screen.
import { formatNumber, formatPercent, formatPercentAsSent } from '../../../lib/presentation/presentationPrimitives'
import { dayText, etDayOf } from './ratesModel'

export const FED_CODE = 'FED'
export const FED_URL = '/api/research/fed-watch'
/** The thing read, as a failed read names it ("Fed watch could not be read just now."). */
export const FED_WHAT = 'Fed watch'
export const FED_SOURCE = 'Federal Reserve Board, Federal Reserve Bank of New York, TradeXchange'
/** While a block is still being read the panel asks again this often; otherwise every minute (the headlines are live). */
export const COMPUTING_POLL_MS = 3 * 1000
export const HELD_POLL_MS = 60 * 1000
/** The Board's disclaimer asks to be cited; the server sends the words, this is the fallback. */
export const BOARD_CITE = 'Source: Board of Governors of the Federal Reserve System.'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const whole = (v) => (num(v) != null && v >= 0 ? Math.floor(v) : null)
const list = (v) => (Array.isArray(v) ? v : [])
const url = (v) => (typeof v === 'string' && /^https:\/\/(www\.federalreserve\.gov|www\.newyorkfed\.org)\//.test(v) ? v : null)
const check = (v) => (isObj(v) ? { state: str(v.state), reason: str(v.reason), httpStatus: num(v.http_status) } : null)

const STATES = new Set(['ok', 'computing', 'unavailable', 'failed', 'none', 'unreadable', 'off', 'not_started', 'not_held', 'no_data'])
const stateOf = (v, fallback = 'failed') => (STATES.has(v) ? v : fallback)
const REDLINE_STATES = new Set(['ok', 'same', 'no_previous', 'computing', 'unreadable', 'too_long'])

function readStatement(raw) {
  const s = isObj(raw) ? raw : {}
  const red = isObj(s.redline) ? s.redline : null
  const segments = list(red?.segments)
    .filter((g) => isObj(g) && ['same', 'added', 'removed', 'break'].includes(g.op))
    .map((g) => ({ op: g.op, text: typeof g.text === 'string' ? g.text : '' }))
  return {
    state: stateOf(s.state),
    check: check(s.check) || check(s.page_check),
    date: day(s.date),
    url: url(s.url),
    implementationNoteUrl: url(s.implementation_note_url),
    minutes: isObj(s.minutes) && url(s.minutes.url) ? { meeting: str(s.minutes.meeting), url: s.minutes.url, date: day(s.minutes.date) } : null,
    paragraphs: list(s.paragraphs).filter((p) => typeof p === 'string' && p.trim()),
    readAt: str(s.read_at),
    redline: red ? {
      state: REDLINE_STATES.has(red.state) ? red.state : 'no_previous',
      segments,
      added: whole(red.added) ?? 0,
      removed: whole(red.removed) ?? 0,
      previous: isObj(red.previous) ? { date: day(red.previous.date), url: url(red.previous.url) } : null,
    } : null,
  }
}

function readSpeeches(raw) {
  const s = isObj(raw) ? raw : {}
  const items = list(s.items).filter(isObj).map((it) => ({
    kind: it.kind === 'testimony' ? 'testimony' : 'speech',
    speaker: str(it.speaker),
    title: str(it.title) || 'Untitled',
    where: str(it.where),
    venue: str(it.venue),
    published: str(it.published),
    url: url(it.url),
  }))
  const checks = isObj(s.checks) ? Object.values(s.checks).map(check).filter(Boolean) : []
  return { state: stateOf(s.state), items, total: Math.max(whole(s.total) ?? 0, items.length), missing: list(s.missing).filter((m) => typeof m === 'string'), readAt: str(s.read_at), checks }
}

function readHeadlines(raw) {
  const s = isObj(raw) ? raw : {}
  const items = list(s.items).filter((h) => isObj(h) && str(h.text)).map((h) => ({
    seq: num(h.seq),
    text: h.text.trim(),
    receivedAtMs: num(h.received_at_ms),
    tickers: list(h.tickers).filter((t) => typeof t === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t)),
  }))
  return { state: stateOf(s.state), items, matched: whole(s.matched) ?? items.length, scanned: whole(s.scanned), limit: whole(s.limit) }
}

function readCalendar(raw) {
  const c = isObj(raw) ? raw : {}
  const nm = isObj(c.next_meeting) ? c.next_meeting : {}
  const wk = isObj(c.this_week) ? c.this_week : {}
  return {
    today: day(c.today),
    weekStart: day(c.week_start),
    weekEnd: day(c.week_end),
    nextMeeting: {
      state: nm.state === 'ok' && day(nm.date) ? 'ok' : 'none',
      date: day(nm.date),
      time: str(nm.time),
      event: str(nm.event),
      label: str(nm.label),
      daysToGo: num(nm.days_to_go),
      source: str(nm.source),
    },
    thisWeek: {
      state: wk.state === 'ok' ? 'ok' : 'not_held',
      items: list(wk.items).filter((r) => isObj(r) && day(r.date) && str(r.event)).map((r) => ({ date: r.date, time: str(r.time), event: r.event.trim() })),
      total: whole(wk.total) ?? 0,
    },
  }
}

const point = (v) => (isObj(v) ? { value: num(v.value), date: day(v.date), reason: str(v.reason) } : { value: null, date: null, reason: 'failed' })

function readRates(raw) {
  const r = isObj(raw) ? raw : {}
  return { state: stateOf(r.state), effective: point(r.effective), upper: point(r.upper), lower: point(r.lower), notice: str(r.notice) }
}

function readProjections(raw) {
  const p = isObj(raw) ? raw : {}
  return {
    state: stateOf(p.state),
    check: check(p.check) || check(p.page_check),
    date: day(p.date),
    meeting: str(p.meeting),
    pageUrl: url(p.page_url),
    releaseUrl: url(p.release_url),
    medians: list(p.medians).filter((m) => isObj(m) && str(m.label) && num(m.value) != null).map((m) => ({ label: m.label.trim(), value: m.value })),
  }
}

function readSurvey(raw) {
  const s = isObj(raw) ? raw : {}
  const path = list(s.path).filter((h) => isObj(h) && str(h.label)).map((h) => ({
    label: h.label.trim(), date: day(h.date), median: num(h.median), p25: num(h.p25), p75: num(h.p75), respondents: whole(h.respondents),
  }))
  const distributions = list(s.distributions).filter((d) => isObj(d) && str(d.label)).map((d) => ({
    label: d.label.trim(),
    date: day(d.date),
    respondents: whole(d.respondents),
    buckets: list(d.buckets).filter((b) => isObj(b) && str(b.range)).map((b) => ({
      range: b.range.trim(), low: num(b.low), high: num(b.high), probability: num(b.probability),
    })),
  }))
  return {
    state: stateOf(s.state),
    check: check(s.check) || check(s.page_check),
    survey: str(s.survey),
    questionsSent: day(s.questions_sent),
    responsesDue: day(s.responses_due),
    beforeMeeting: isObj(s.before_meeting) && str(s.before_meeting.label) ? { label: s.before_meeting.label.trim(), date: day(s.before_meeting.date) } : null,
    path,
    distributions,
    passed: whole(s.passed) ?? 0,
    more: whole(s.more) ?? 0,
    credit: str(s.credit),
    pageUrl: url(s.page_url),
    fileUrl: url(s.file_url),
  }
}

/** The route's answer -> the panel's view. `state` 'failed' when the body is not the route's shape. */
export function fedRead(body) {
  if (!isObj(body) || body.status !== 'ok') return { state: 'failed', computing: false }
  const view = {
    state: 'ok',
    statement: readStatement(body.statement),
    speeches: readSpeeches(body.speeches),
    headlines: readHeadlines(body.headlines),
    calendar: readCalendar(body.calendar),
    rates: readRates(body.rates),
    projections: readProjections(body.projections),
    survey: readSurvey(body.survey),
    boardCite: str(body.board_cite) || BOARD_CITE,
    builtAt: str(body.built_at),
  }
  // The headlines and the rates are served from what the server holds and refreshed off the request (speed pass 3):
  // until the first copy is held they say `computing` too, and the panel asks again sooner.
  view.computing = [view.statement, view.speeches, view.projections, view.survey, view.headlines, view.rates]
    .some((b) => b.state === 'computing')
    || view.statement.redline?.state === 'computing'
  return view
}

// ── words ─────────────────────────────────────────────────────────────────────────────────────

/** A rate in percent with two decimals ("3.88%"); null is "No figure". */
export const rateText = (v) => (num(v) == null ? 'No figure' : formatPercent(v, { decimals: 2 }))

/** The target range ("3.75% to 4.00%"), one end alone when only one is held, or null. */
export function rangeText(rates) {
  const lo = rates.lower.value
  const hi = rates.upper.value
  if (lo != null && hi != null) return `${formatPercent(lo, { decimals: 2 })} to ${formatPercent(hi, { decimals: 2 })}`
  if (hi != null) return `up to ${formatPercent(hi, { decimals: 2 })} (the lower end is not held)`
  if (lo != null) return `from ${formatPercent(lo, { decimals: 2 })} (the upper end is not held)`
  return null
}

/** Why a rate is missing, in words. */
export function rateMissingWords(rates) {
  if (rates.state === 'off') return 'Not shown: the economic data feature is not switched on for this server.'
  if (rates.state === 'failed') return 'Could not be read just now.'
  return 'No figure is held yet.'
}

/** "in 18 days" | "today" | "tomorrow" | "" */
export function daysToGoWords(n) {
  if (num(n) == null || n < 0) return ''
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  return `in ${n} days`
}

/** The next meeting line: "Dec 9, 2026, in 18 days", or the reason it is missing. */
export function meetingWords(m) {
  if (m.state !== 'ok' || !m.date) return 'No FOMC decision ahead is in the calendar the server holds.'
  const when = daysToGoWords(m.daysToGo)
  return `${dayText(m.date)}${m.time ? `, ${m.time} ET` : ''}${when ? ` (${when})` : ''}`
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** The sentence above the redline. */
export function redlineSummary(st) {
  const red = st.redline
  const prev = red?.previous?.date ? dayText(red.previous.date) : null
  if (!red || red.state === 'no_previous') return 'There is no earlier statement held to compare it with, so the whole statement is shown.'
  if (red.state === 'computing') return `Reading the statement before it${prev ? ` (${prev})` : ''} to compare.`
  if (red.state === 'unreadable') return `The statement before it${prev ? ` (${prev})` : ''} could not be read, so the whole statement is shown.`
  if (red.state === 'too_long') return 'The statements are too long to compare here, so the whole statement is shown.'
  if (red.state === 'same') return `Not one word changed from the statement of ${prev || 'the meeting before'}.`
  return `Against the statement of ${prev || 'the meeting before'}: ${plural(red.added, 'word', 'words')} added, ${plural(red.removed, 'word', 'words')} removed.`
}

/** True when the panel draws the redline (added and removed marks) rather than the plain statement. */
export const showsRedline = (st) => !!st.redline && (st.redline.state === 'ok' || st.redline.state === 'same') && st.redline.segments.length > 0

/** The redline as paragraphs of segments (a `break` starts a new paragraph). */
export function redlineParagraphs(segments) {
  const out = [[]]
  for (const s of segments) {
    if (s.op === 'break') { if (out[out.length - 1].length) out.push([]) } else out[out.length - 1].push(s)
  }
  return out.filter((p) => p.length)
}

/** The plain-text alternative of one redline paragraph, read in order: "… added: … removed: …". */
export function redlineAlt(paragraph) {
  return paragraph.map((s) => (s.op === 'added' ? `added: ${s.text}` : s.op === 'removed' ? `removed: ${s.text}` : s.text)).join(' ')
}

/** "Dec 9" style date of a feed instant, in New York time; '' when it cannot be read. */
export const instantDay = (iso, opts = { short: false }) => dayText(etDayOf(iso), opts)

/** "Thu Nov 19" for a calendar day. */
export function weekdayText(iso) {
  const d = day(iso)
  if (!d) return ''
  const name = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T12:00:00Z`).getUTCDay()]
  return `${name} ${dayText(d, { short: true })}`
}

/** The day a headline arrived ('YYYY-MM-DD', New York), for grouping "today" from older ones. */
export const headlineDay = (ms) => (num(ms) == null ? null : etDayOf(new Date(ms).toISOString()))

/** What the headline list was cut from, in words, or null when nothing was cut. */
export function headlineCutWords(h) {
  if (h.scanned == null) return null
  const base = `Picked from the newest ${formatNumber(h.scanned, { decimals: 0 })} headlines on the wire`
  if (h.matched > h.items.length) return `${base}: ${formatNumber(h.matched, { decimals: 0 })} are about the Fed, the newest ${h.items.length} are shown.`
  return `${base}.`
}

/** A survey rate (percent, as the file gives it after the fraction is read) as printed: "4.13%". */
export const surveyRate = (v) => (num(v) == null ? 'No figure' : formatPercentAsSent(v))
/** A probability in percent ("27%"); null is "No figure". */
export const chanceText = (v) => (num(v) == null ? 'No figure' : formatPercentAsSent(v))

/** True when the target range's upper end falls in this bucket (the survey's buckets run by upper end). */
export function holdsToday(bucket, upper) {
  if (num(upper) == null) return false
  const lo = bucket.low == null ? -Infinity : bucket.low
  const hi = bucket.high == null ? Infinity : bucket.high
  return upper >= lo - 1e-9 && upper <= hi + 1e-9
}

/** The buckets worth a row: every one with a probability above zero (the rest are counted). */
export function shownBuckets(dist) {
  const shown = dist.buckets.filter((b) => b.probability != null && b.probability > 0)
  return { shown, hidden: dist.buckets.length - shown.length }
}

/** The note above Board figures still shown after a newer look did not go well, or null. */
export function staleBoardWords(state, checks) {
  if (state !== 'ok' || !checks.length) return null
  const refused = checks.some((c) => c.state === 'unavailable')
  return `${refused ? "The Board's website did not let the server look for anything newer" : 'The newest look at the Board’s feed did not get an answer'}, so this is what the server read before. It looks again by itself.`
}

/** The survey's header line. */
export function surveyLine(sv) {
  const parts = [sv.survey ? `New York Fed Survey of Market Expectations, ${sv.survey}` : 'New York Fed Survey of Market Expectations']
  if (sv.responsesDue) parts.push(`responses due ${dayText(sv.responsesDue)}`)
  if (sv.beforeMeeting) parts.push(`taken before the ${sv.beforeMeeting.label} meeting`)
  return `${parts.join(', ')}.`
}

/** A projection median as the Board prints it ("4.1%"). */
export const projectionText = (v) => (num(v) == null ? 'No figure' : formatPercentAsSent(v))

/** Why a Board block could not be shown, in words. */
export function boardMissingWords(state, what) {
  if (state === 'computing') return `Reading ${what} from the Board's website. This fills in on its own.`
  if (state === 'unavailable') return `The Board's website did not let the server read ${what} just now. The server asks again by itself.`
  if (state === 'unreadable') return `${what.charAt(0).toUpperCase()}${what.slice(1)} could not be read from the Board's page.`
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} could not be read just now.`
}

