/**
 * Tier 2 part B, item 11 (R-T2B-7) -- the door that MAKES an earnings follow-up note. The same shape as
 * /plan's createPlanNote: createNoteViaApi (the one network path every creation uses) as a styled create
 * of the member's default Earnings follow-up style; the server adds the prep-note link and the quarter's
 * numbers in the SAME insert (api/services/journal_two/followup_prefill.py). Landed with settleNoteWrite
 * before any editor can meet it. Imported only by the lazy FollowupOffer card.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'

// ⛔ The ONE shape a symbol may take here is the server's: api/services/journal_two/notes.py `_validate_ticker`
// strips, upper-cases, refuses an empty or over-long (`MAX_TICKER_LENGTH`, 16) value, and then requires
// `^[A-Z0-9.\-]+$` -- digits included, so 3M and BRK.B are tickers. This mirrors it in the same order, and it
// mirrors it rather than restating a narrower one (planCreate.js's letters-only pattern would silently refuse a
// ticker the follow-up job offers). No lookbehind anywhere in this file (iOS 16 floor).
export const MAX_TICKER_LENGTH = 16
const TICKER_SHAPE = /^[A-Z0-9.-]+$/
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export const FOLLOWUP_TAGS = Object.freeze(['earnings', 'earnings-followup'])

/** The ticker as the server would store it, or null when `_validate_ticker` would refuse it. */
function serverTicker(raw) {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toUpperCase()
  if (!t || t.length > MAX_TICKER_LENGTH || !TICKER_SHAPE.test(t)) return null
  return t
}

function realDay(iso) {
  const m = ISO_RE.exec(String(iso || ''))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null
}

const fmt = (d, withYear) => d.toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
})

export function followupWhen(iso) {
  const d = realDay(iso)
  return d ? fmt(d, true) : String(iso || '')
}

export function followupTitle(symbol, iso) {
  const d = realDay(iso)
  return `Earnings follow-up — ${String(symbol).toUpperCase()}${d ? ` (${fmt(d, false)})` : ''}`
}

/** `{ symbol, reportDate }` from the bell's link, or null for anything that is not exactly that. */
export function parseFollowupParams(searchParams) {
  const symbol = serverTicker(searchParams?.get?.('followup') || '')
  const reportDate = String(searchParams?.get?.('reportDate') || '').trim()
  if (!symbol || !realDay(reportDate)) return null
  return { symbol, reportDate }
}

export async function createFollowupNote({ symbol, reportDate, folderId } = {}) {
  const p = parseFollowupParams(new URLSearchParams({ followup: symbol || '', reportDate: reportDate || '' }))
  if (!p) throw new Error('not a follow-up')
  const created = await createNoteViaApi({
    title: followupTitle(p.symbol, p.reportDate), kindId: 'earnings_followup', ticker: p.symbol,
    tags: [...FOLLOWUP_TAGS], earningsFollowup: { reportDate: p.reportDate },
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
