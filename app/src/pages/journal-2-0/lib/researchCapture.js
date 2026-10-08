/**
 * Wave 13 lane 13G-1 -- research capture, the client half.
 *
 * Two capabilities, two gates (latched per tab like every Notebook capability flag):
 *   - `notebook_transcript_capture_enabled`: a call-transcript passage into a note as a cited
 *     excerpt (`components/notebook/SaveTranscriptPassage.jsx`);
 *   - `notebook_passed_setups_enabled`: the passed-setups journal
 *     (`components/notebook/PassedSetups.jsx`).
 *
 * The server is `api/routers/notebook_research_capture.py`. Nothing here computes a score or
 * decides what a transcript says: every number and every label comes from the server, and this
 * module only words them.
 */
import { notebookFlag } from './offline/notebookFlags'

export const TRANSCRIPT_FLAG = 'notebook_transcript_capture_enabled'
export const PASSED_FLAG = 'notebook_passed_setups_enabled'

/** The editor's "/transcript" insert asks THIS editor's host to open the sheet -- dispatched on
 *  the editor's own DOM root, never `window` (the I5 rule SlashMenu's other events follow). */
export const TRANSCRIPT_EVENT = 'uct-notebook:transcript-insert'

const BASE = '/api/j2/research-capture'
export const PASSED_URL = `${BASE}/passed-setups`

export function transcriptCaptureEnabled() {
  return notebookFlag(TRANSCRIPT_FLAG) === true
}

export function passedSetupsEnabled() {
  return notebookFlag(PASSED_FLAG) === true
}

export class CaptureRequestError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : ''
    throw new CaptureRequestError(detail || `Request failed (${res.status})`, res.status)
  }
  return data
}

export const fetchQuarters = (symbol) =>
  call(`${BASE}/transcripts/${encodeURIComponent(symbol)}/quarters`)

export const fetchTranscript = (symbol, quarter) =>
  call(`${BASE}/transcripts/${encodeURIComponent(symbol)}/${encodeURIComponent(quarter)}`)

export const savePassage = ({ noteId, symbol, quarter, turn, passage, annotation }) =>
  call(`${BASE}/transcripts/save`, {
    method: 'POST',
    body: { noteId, symbol, quarter, turn, passage, ...(annotation ? { annotation } : {}) },
  })

export const fetchPassedSetups = () => call(PASSED_URL)
export const addPassedSetup = ({ symbol, savedOn }) =>
  call(PASSED_URL, { method: 'POST', body: { symbol, ...(savedOn ? { savedOn } : {}) } })
export const removePassedSetup = (id) =>
  call(`${PASSED_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** A turn's text without its "Speaker: " lead -- what a member means to quote. */
export function turnWords(turn) {
  const text = turn?.text || ''
  const lead = turn?.speaker ? `${turn.speaker}: ` : ''
  return lead && text.startsWith(lead) ? text.slice(lead.length) : text
}

/** 'FY2026 Q2' from '2026Q2'. */
export function quarterText(q) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(q || ''))
  return m ? `FY${m[1]} Q${m[2]}` : String(q || '')
}

// ── passed setups: words for what the server decided ───────────────────────────────────

export const SOURCE_TEXT = Object.freeze({
  scanner: 'Scanner',
  watchlist: 'Watchlist',
  manual: 'Added by you',
  // The one row the sample notebook adds (server: passed_setups.SOURCE_SAMPLE). Labelled, so
  // an example never reads as a pass the member made.
  sample: 'Example',
})

export const HORIZON_TEXT = Object.freeze({
  r1: '+1 day', r5: '+5 days', r10: '+10 days', r20: '+20 days', best20: 'Best in 20',
})

/** "+4.2%" / "-1.0%" from a server percentage; never rounds a missing value to zero. */
export function fmtPct(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/** The cell text: the number, or the server's label for why there is none. */
export function outcomeText(o) {
  const v = fmtPct(o?.pct)
  if (v) return v
  return o?.label || 'Not yet'
}

/** 'Aug 7' from 'YYYY-MM-DD' (UTC parts -- no timezone drift). */
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
