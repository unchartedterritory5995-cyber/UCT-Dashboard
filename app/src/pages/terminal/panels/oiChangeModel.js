// OIC: one stock's open interest, contract by contract, against the recorded day before. The pure
// half of OiChangePanel.jsx (no React): the URL, the typed side, the answer read into one view, and
// the words each row and line shows.
//
// The read is GET /api/options-screener/oi-change/{sym}?side=any|call|put
// (api/routers/options_screener.py over api/services/options_analytics/oi_change.py). It answers
// from UCT's own options log: the two newest recorded days, every contract of the stock that had an
// ask, open interest or volume. `status` is `ok`, `computing` (the server is fetching the two
// files in the background), `no_sessions` or `one_session`.
//
// ⛔ A NUMBER THE SERVER DID NOT SEND IS NEVER A 0 HERE. A new contract carries no change and no
// percent; a contract that started from 0 carries no percent; a side with no contract in both
// records carries no total.

export const OI_CHANGE_CODE = 'OIC'
export const OI_CHANGE_WHAT = 'Open interest change'
export const OI_CHANGE_SOURCE = 'UCT options log (end-of-day options snapshot)'
/** Rows drawn before "Show more". */
export const OI_ROWS_SHOWN = 15

/** The three sides, in chip order. `token` is what the chip writes into the command. */
export const OI_SIDES = Object.freeze({
  any: Object.freeze({ label: 'All', token: null, noun: 'contract' }),
  call: Object.freeze({ label: 'Calls', token: 'C', noun: 'call' }),
  put: Object.freeze({ label: 'Puts', token: 'P', noun: 'put' }),
})

/** The words a member can type after the code: `NVDA OIC C`, `NVDA OIC PUTS`. args.js keeps a copy
 *  (pinned to this one by args.oiChange.test.js). */
export const OI_SIDE_ARG_WORDS = Object.freeze({
  C: 'call', CALL: 'call', CALLS: 'call',
  P: 'put', PUT: 'put', PUTS: 'put',
})

/** A typed word as a side, or null. */
export function parseOiSide(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(OI_SIDE_ARG_WORDS, key) ? OI_SIDE_ARG_WORDS[key] : null
}

/** Any value as a side: a side key, a typed word, else `any`. */
export function normOiSide(v) {
  const key = String(v ?? '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(OI_SIDES, key)) return key
  return parseOiSide(v) || 'any'
}

/** The command arguments for a pick: none for the default. */
export function oiChangeCommandArgs({ side } = {}) {
  const token = OI_SIDES[normOiSide(side)].token
  return token ? [token] : []
}

export function oiChangeUrl(sym, side) {
  const s = String(sym || '').trim().toUpperCase()
  if (!s) return null
  const sd = normOiSide(side)
  return `/api/options-screener/oi-change/${encodeURIComponent(s)}${sd === 'any' ? '' : `?side=${sd}`}`
}

const int = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

function readRow(r) {
  if (!r || typeof r !== 'object') return null
  const type = r.type === 'call' || r.type === 'put' ? r.type : null
  const oi = int(r.oi)
  if (!type || oi === null || !r.contract) return null
  const kind = r.kind === 'new' ? 'new' : 'change'
  const change = kind === 'change' ? int(r.change) : null
  if (kind === 'change' && change === null) return null
  return {
    contract: String(r.contract), expiration: day(r.expiration), strike: int(r.strike), type, oi, kind,
    priorOi: kind === 'change' ? int(r.prior_oi) : null,
    change,
    changePct: kind === 'change' ? int(r.change_pct) : null,
    volume: kind === 'change' ? int(r.volume) : null,
  }
}

function readSide(t) {
  const contracts = int(t?.contracts) ?? 0
  // A side with no contract in both records has no total: null, never 0.
  if (!contracts) return { contracts: 0, oi: null, priorOi: null, change: null }
  return { contracts, oi: int(t.oi), priorOi: int(t.prior_oi), change: int(t.change) }
}

/**
 * The answer as one view. `state`:
 *   'failed'       not an answer this panel can read
 *   'computing'    the server is fetching the two files; ask again
 *   'no-sessions'  the log has no recorded day
 *   'one-session'  one recorded day (`session`), nothing to compare
 *   'unknown'      two days, and the stock is in neither
 *   'ok'           rows, totals and the counts of what is left out
 */
export function oiChangeRead(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null
  const status = String(b?.status || '').toLowerCase()
  if (status === 'computing') return { state: 'computing' }
  if (status === 'no_sessions') return { state: 'no-sessions' }
  if (status === 'one_session') return { state: 'one-session', session: day(b.session) }
  const session = day(b?.session)
  const priorSession = day(b?.prior_session)
  if (status !== 'ok' || !session || !priorSession || !Array.isArray(b.rows)) return { state: 'failed' }
  const base = {
    session, priorSession,
    skipped: (Array.isArray(b.skipped_sessions) ? b.skipped_sessions : []).map(day).filter(Boolean),
    side: normOiSide(b.side),
  }
  if (b.known === false) return { state: 'unknown', ...base }
  const rows = b.rows.map(readRow).filter(Boolean)
  return {
    state: 'ok', ...base,
    rows,
    matched: Math.max(int(b.matched) ?? rows.length, rows.length),
    call: readSide(b.summary?.call),
    put: readSide(b.summary?.put),
    compared: int(b.summary?.contracts) ?? 0,
    unchanged: int(b.summary?.unchanged) ?? 0,
    fresh: { contracts: int(b.new?.contracts) ?? 0, oi: int(b.new?.oi) },
    gone: { contracts: int(b.gone?.contracts) ?? 0, priorOi: int(b.gone?.prior_oi), expired: int(b.gone?.expired) ?? 0 },
    notReported: int(b.not_reported) ?? 0,
    priorHasSymbol: b.prior_has_symbol !== false,
    hasSymbol: b.has_symbol !== false,
    volumePresent: b.volume_present === true,
    volumeSession: day(b.volume_session) || priorSession,
  }
}

// ── words ───────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  // A calendar date is read as the date it names, in no time zone: never shifted a day.
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], wd: d.getUTCDay() }
}

/** `2026-11-18` as `Wed Nov 18`. The text as sent when it is not a date. */
export function dayWords(iso) {
  const p = parts(iso)
  return p ? `${WEEKDAYS[p.wd]} ${MONTHS[p.mo]} ${p.d}` : String(iso || '')
}

/** An expiry: `Nov 20`, with its year when that is not the recorded day's year (`Jan 15, 2027`). */
export function expiryText(iso, sessionIso) {
  const p = parts(iso)
  if (!p) return 'expiry not given'
  const s = parts(sessionIso)
  return `${MONTHS[p.mo]} ${p.d}${s && s.y === p.y ? '' : `, ${p.y}`}`
}

const grouped = (n) => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
/** A whole count with thousands separators; `absent` when there is none. */
export const countText = (n, absent = 'n/a') => (n === null || n === undefined ? absent : `${n < 0 ? '-' : ''}${grouped(n)}`)
/** A signed count: `+1,200`, `-500`. An ASCII hyphen, as the rest of the terminal's numbers. */
export const signedText = (n, absent = 'n/a') => (n === null || n === undefined ? absent : `${n > 0 ? '+' : n < 0 ? '-' : ''}${grouped(n)}`)
/** `up` | `down` | null: the sign of a number, for its colour. Never a judgement. */
export const signOf = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : null)

/** `$150 call`, `$152.50 put`. */
export function contractText(row) {
  const k = row?.strike
  const strike = k === null || k === undefined ? 'strike not given'
    : `$${Number.isInteger(k) ? grouped(k) : k.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`
  return `${strike} ${row?.type || 'contract'}`
}

/** A row's change cell, as its two lines. A new contract is words, never a change from 0. */
export function changeLines(row) {
  if (row.kind === 'new') return ['New', 'not in the earlier record']
  const pct = row.changePct === null
    ? (row.priorOi === 0 ? 'from 0' : 'percent not given')
    : `${row.changePct > 0 ? '+' : row.changePct < 0 ? '-' : ''}${Math.abs(row.changePct).toFixed(1)}%`
  return [signedText(row.change), pct]
}

/** A row's open interest cell: the figure now, and what it was. */
export function oiLines(row) {
  return [countText(row.oi), row.kind === 'new' ? 'no earlier figure' : `was ${countText(row.priorOi)}`]
}

const plural = (n, one, many) => (n === 1 ? one : many)

/** The as-of line: the two recorded days, in words. */
export function asOfWords(view) {
  return `Open interest recorded ${dayWords(view.session)} against ${dayWords(view.priorSession)}.`
}

/** Whose trading the change is from. Each record holds the positions as they stood before that
 *  day's trading, so two records one session apart differ by the earlier day's trading. With a
 *  day missing between them the change covers several sessions: null, and the note says so. */
export function tradingDayWords(view) {
  if (view?.state !== 'ok' || view.skipped.length) return null
  return `The change is from trading on ${dayWords(view.priorSession)}.`
}

/** One side's total as a sentence part, or the words for a side with nothing in both records. */
export function sideTotalText(t, noun) {
  if (!t.contracts || t.change === null) return `no ${noun} is in both records`
  return `${signedText(t.change)} (${countText(t.priorOi)} to ${countText(t.oi)}, over ${countText(t.contracts)} ${plural(t.contracts, noun, `${noun}s`)})`
}

/** The cut line, or null when every changed contract is on screen. `shown` is the rows drawn. */
export function cutLine(view, shown) {
  if (view.state !== 'ok' || shown >= view.matched) return null
  const noun = OI_SIDES[view.side].noun
  const held = view.rows.length
  const head = `Showing the ${countText(shown)} biggest of ${countText(view.matched)} changed or new ${noun}s, by number of contracts.`
  if (held < view.matched && shown >= held) {
    return `${head} The ${countText(view.matched - held)} smallest are not listed: the server sends the ${countText(held)} biggest.`
  }
  return `${head} The smaller ones are cut from the bottom.`
}

/** The notes that apply, each one sentence. Order: what the comparison is against, then what is left out. */
export function limitNotes(view, sym) {
  if (view.state !== 'ok') return []
  const out = []
  const prior = dayWords(view.priorSession)
  if (view.skipped.length) {
    out.push({ key: 'skipped', text: `No record was stored for ${view.skipped.map(dayWords).join(', ')}, so this compares against ${prior}, the last stored day, and the change covers more than one session.` })
  }
  if (!view.priorHasSymbol) {
    out.push({ key: 'no-prior', text: `${sym} has no contract in the ${prior} record, so every contract here is new and there is no change to total.` })
  } else if (!view.hasSymbol) {
    out.push({ key: 'no-current', text: `${sym} has no contract in the ${dayWords(view.session)} record, so there is nothing to compare.` })
  }
  if (view.fresh.contracts && view.priorHasSymbol) {
    out.push({ key: 'new', text: `${countText(view.fresh.contracts)} ${plural(view.fresh.contracts, 'contract is', 'contracts are')} new: not in the ${prior} record, holding ${countText(view.fresh.oi)} open interest now. A new contract has no earlier figure, so it shows as new, never as a change from 0, and is left out of the totals.` })
  }
  if (view.gone.contracts) {
    const exp = view.gone.expired
    out.push({ key: 'gone', text: `${countText(view.gone.contracts)} ${plural(view.gone.contracts, 'contract', 'contracts')} from the ${prior} record ${plural(view.gone.contracts, 'is', 'are')} not in the newer one${exp ? ` (${countText(exp)} expired)` : ''}, holding ${countText(view.gone.priorOi)} open interest then. ${plural(view.gone.contracts, 'It is', 'They are')} left out of the totals.` })
  }
  if (view.notReported) {
    out.push({ key: 'not-reported', text: `${countText(view.notReported)} ${plural(view.notReported, 'contract has', 'contracts have')} no open interest figure in one of the two records and ${plural(view.notReported, 'is', 'are')} left out, not counted as 0.` })
  }
  return out
}
