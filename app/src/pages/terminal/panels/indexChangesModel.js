// IDXC's pure half: the index changes route's answer -> what the panel draws. No React.
//
// The route (GET /api/research/index-changes?index=&sym=, api/routers/index_changes.py, paid) answers from the
// three lists the server holds, read from Financial Modeling Prep: every addition to and removal from the
// S&P 500, the Nasdaq 100 and the Dow 30 the provider holds, newest first, each with the stock added, the stock
// it replaced and the reason where the provider gives them; or (`sym`) one stock's own history across the three.
// Each index's read has its own state (a plan that lacks one index says so). With nothing held the server says
// `computing` and the panel asks again.
//
// `IDXC NASDAQ100` (args.js `idxcIndex`, a copy of IDXC_INDEX_ARG_WORDS pinned by functions.indexChanges.test.js).
// SP500, SPX, NDX, DOW and DJIA are COT's own market words, so they are not IDXC's: S&P500, NASDAQ100, DOW30.
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'

export const IDXC_CODE = 'IDXC'
export const IDXC_SOURCE = 'Financial Modeling Prep'
export const IDXC_WHAT = 'Index changes'
export const IDXC_COMPUTING_POLL_MS = 3 * 1000
export const IDXC_HELD_POLL_MS = 60 * 60 * 1000
export const IDXC_INDEXES = Object.freeze({
  sp500: Object.freeze({ label: 'S&P 500', word: 'S&P500' }),
  nasdaq100: Object.freeze({ label: 'Nasdaq 100', word: 'NASDAQ100' }),
  dow: Object.freeze({ label: 'Dow 30', word: 'DOW30' }),
})
export const IDXC_INDEX_ARG_WORDS = Object.freeze({ 'S&P500': 'sp500', NASDAQ100: 'nasdaq100', DOW30: 'dow' })

export function parseIdxcIndex(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(IDXC_INDEX_ARG_WORDS, key) ? IDXC_INDEX_ARG_WORDS[key] : null
}
export const normIdxcIndex = (v) => (Object.prototype.hasOwnProperty.call(IDXC_INDEXES, v) ? v : 'all')
/** The argument that runs a pick: all three is the bare command. */
export const idxcCommandArgs = ({ index } = {}) => (normIdxcIndex(index) === 'all' ? [] : [IDXC_INDEXES[index].word])
export function idxcUrl({ index, sym } = {}) {
  const q = [`index=${normIdxcIndex(index)}`]
  if (sym) q.push(`sym=${encodeURIComponent(sym)}`)
  return `/api/research/index-changes?${q.join('&')}`
}
export const idxcPollMs = (body) => (body && body.status === 'computing' ? IDXC_COMPUTING_POLL_MS : IDXC_HELD_POLL_MS)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const whole = (v) => (Number.isInteger(v) && v > 0 ? v : 0)
const LEG_STATES = new Set(['ok', 'none', 'not_in_plan', 'not_configured', 'rate_limited', 'failed'])

function side(raw) {
  if (!raw || typeof raw !== 'object') return null
  const sym = text(raw.sym)
  if (!sym) return null
  return { sym: sym.toUpperCase(), name: text(raw.name), covered: raw.covered === true }
}

function readChange(raw) {
  if (!raw || typeof raw !== 'object' || !ISO_DAY.test(String(raw.date || '')) || !IDXC_INDEXES[raw.index]) return null
  const added = side(raw.added)
  const removed = side(raw.removed)
  if (!added && !removed) return null
  return { index: raw.index, date: raw.date, added, removed, reason: text(raw.reason) }
}

/** The route's answer -> the panel's view. `state`: 'failed', 'computing', 'source' (none of the three reads
 *  answered: Retry), 'none' or 'ok'. */
export function idxcRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'failed' || body.status === 'unavailable') return { state: 'source', reason: text(body.reason) }
  if (body.status !== 'ok' || !Array.isArray(body.changes)) return { state: 'failed' }
  const changes = body.changes.map(readChange).filter(Boolean)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
  const legsRaw = body.indexes && typeof body.indexes === 'object' ? body.indexes : {}
  const legs = Object.fromEntries(Object.keys(IDXC_INDEXES).map((k) => {
    const leg = legsRaw[k] && typeof legsRaw[k] === 'object' ? legsRaw[k] : {}
    return [k, { state: LEG_STATES.has(leg.state) ? leg.state : 'failed', count: whole(leg.count), dropped: whole(leg.dropped) }]
  }))
  return {
    state: changes.length ? 'ok' : 'none',
    index: normIdxcIndex(body.index), sym: text(body.sym), readAt: text(body.read_at),
    check: body.check && typeof body.check === 'object' ? body.check : null,
    legs, changes, total: Math.max(whole(body.total), changes.length), cut: body.cut === true,
    dropped: (body.changes.length - changes.length),
    symbols: [...new Set(changes.flatMap((c) => [c.added, c.removed]).filter((s) => s?.covered).map((s) => s.sym))],
  }
}

/** "Mar 3, 2031". */
export function changeDayWords(iso) {
  const day = formatSessionDate(iso, { absent: '' })
  return day ? `${day}, ${String(iso).slice(0, 4)}` : 'Day not given'
}

const scopeWords = (index) => (normIdxcIndex(index) === 'all' ? 'the S&P 500, the Nasdaq 100 and the Dow 30' : `the ${IDXC_INDEXES[index].label}`)

/** The line above the table. */
export function idxcCountLine(view) {
  const n = view.changes.length
  const count = `${formatNumber(n, { decimals: 0 })} ${n === 1 ? 'change' : 'changes'}`
  if (view.sym) {
    return n ? `${view.sym}: ${count} in ${scopeWords(view.index)}, newest first.` : `${view.sym} has no addition or removal held for ${scopeWords(view.index)}.`
  }
  if (!n) return `No addition or removal is held for ${scopeWords(view.index)}.`
  const shown = view.cut ? ` (the newest ${formatNumber(n, { decimals: 0 })} of ${formatNumber(view.total, { decimals: 0 })})` : ''
  return `${count} to ${scopeWords(view.index)}, newest first${shown}.`
}

/** Each index whose read did not answer with rows, in words, or ''. */
export function legWords(view) {
  const wanted = view.index === 'all' ? Object.keys(IDXC_INDEXES) : [view.index]
  const say = { not_in_plan: 'is not available from our data provider', not_configured: 'is not switched on for this server',
    failed: 'could not be read just now', rate_limited: 'could not be read just now (the provider was busy)', none: 'holds no changes' }
  const parts = wanted.filter((k) => view.legs[k] && view.legs[k].state !== 'ok')
    .map((k) => `The ${IDXC_INDEXES[k].label} list ${say[view.legs[k].state] || say.failed}.`)
  return parts.join(' ')
}

/** Rows the server or this panel could not read, in words, or ''. */
export function droppedWords(view) {
  const n = view.dropped + Object.values(view.legs).reduce((sum, l) => sum + l.dropped, 0)
  return n ? `${n} ${n === 1 ? 'row' : 'rows'} in the provider's lists had no date or no symbol and ${n === 1 ? 'is' : 'are'} not shown.` : ''
}
