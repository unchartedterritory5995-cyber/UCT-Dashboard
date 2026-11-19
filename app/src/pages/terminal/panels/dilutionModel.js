// DILU: the dilution watch. What one company has filed with the SEC that bears on selling new
// shares. The pure half (no React and no imports, so an agent capability can reuse it).
//
//   GET /api/research/dilution-watch/{sym}   api/routers/dilution_watch.py -> api/services/dilution_watch.py
//     GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag.
//     SPEED  never built on the request: the held answer, else a few seconds' wait on ONE
//            background build, else `{ status: 'computing' }` and this panel asks again. A held
//            answer is fresh for an hour; past that the last good one is sent at once, marked
//            `refreshing`, while its replacement is built.
//     DATA   the company's public SEC EDGAR filing index, and nothing else. No filing document is
//            read, so there is no share count and no dollar amount anywhere in the answer.
//
//   status   'ok' | 'none' (reason 'no_cik': the SEC lists no filer for the symbol | 'no_filings')
//            | 'computing' | 'unavailable' (reason 'refused' with http_status | 'shape')
//            | 'failed' (reason 'rate_limited' | 'timeout' | 'source' | 'error') | 'bad_symbol'
//   ok: { sym, cik, company, entity_type, fund_like,
//         window { years, from, to, recent_months, recent_from },
//         coverage { complete, from, requests, pages_unread }   how far back the read reaches
//         newest_filing    the day of the newest filing of ANY form in the index
//         summary { live_shelves, newest_live_shelf, pending_shelves, newest_pending_shelf,
//                   offerings { m12, y3, latest }, unregistered {...}, registrations {...} }
//                          a count is null when the read does not reach back that far
//         shelves [{ form, what, file_number, filed, url, automatic, effective,
//                    effective_basis ('automatic' | 'notice'), expires_estimate,
//                    state ('live' | 'expired' | 'not_effective' | 'withdrawal_requested'),
//                    withdrawal_requested, amendments, offerings, latest_offering }]
//         rows [{ date, form, kind, what, url, accession, file_number, items,
//                 under { form, filed, shelf } | null }]   newest first
//         rows_total, cut, counts, shelf_life_years, read_at, source, refreshing? }
//     kind   'shelf' | 'shelf_amendment' | 'effect' | 'offering' | 'fwp' | 'registration' |
//            'registration_amendment' | 'plan' | 'withdrawal' | 'unregistered' | 'agreement'
//
// ⛔ NOTHING HERE SAYS MORE THAN THE FILING INDEX DOES. No amounts, no share counts, and never
// that a company "will" sell: every sentence says what was FILED and when.
// ⛔ "LIVE" IS AN ESTIMATE FROM DATES (a shelf may be used for three years after it takes
// effect), and every sentence that uses it says so.
// ⛔ A COUNT THE READ DOES NOT REACH BACK FOR IS NEVER DRAWN AS A NUMBER, and never as 0.
// ⛔ NO GREEN OR RED. Whether a filing is good or bad news is the trader's judgement.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const DILUTION_CODE = 'DILU'
export const dilutionUrl = (sym) => `/api/research/dilution-watch/${encodeURIComponent(sym)}`
export const SOURCE = 'SEC EDGAR filings'
/** Timeline rows drawn at first; "Show all" draws every row sent. */
export const ROWS_SHOWN = 20
/** Shelf registrations drawn in the list above the timeline (newest first). */
export const SHELVES_SHOWN = 3
/** Kinds listed apart, behind their own switch: they are rarely about selling shares to the market. */
export const MINOR_KINDS = Object.freeze(['plan', 'agreement'])
/** A filing's page on sec.gov: the only address a row may link to. */
export const SEC_FILING_PREFIX = 'https://www.sec.gov/Archives/edgar/data/'

/** What each kind of filing is, in a sentence, for the list under the timeline (in the order drawn). */
export const KIND_NOTES = Object.freeze([
  ['shelf', 'Shelf registration',
    "Registers securities so they can be sold later, in one sale or many. It is the capacity to sell, not a sale. An automatic shelf takes effect the day it is filed; any other needs the SEC's notice first."],
  ['shelf_amendment', 'Shelf registration, amended', 'A change to a shelf registration already filed.'],
  ['effect', 'SEC notice that a registration took effect', 'From its date the securities registered may be sold.'],
  ['offering', 'Prospectus or prospectus supplement',
    'Filed when securities are offered under a registration. Form 424B5 is the usual one for a sale under a shelf, including an at-the-market program; 424B7 names holders who are selling, not the company.'],
  ['fwp', 'Free writing prospectus', 'Marketing material for an offering. Listed, not counted as an offering document.'],
  ['registration', 'Registration statement', 'A new registration of securities (Form S-1 or F-1), or more securities added to one. It cannot be used until it takes effect.'],
  ['registration_amendment', 'Registration statement, amended', 'A change to a registration statement already filed.'],
  ['withdrawal', 'Request to withdraw a registration', 'The company asked the SEC to withdraw a registration statement.'],
  ['unregistered', 'Unregistered sale of equity securities',
    'A current report (8-K, item 3.02) that the company sold equity securities without registering them, for example in a private placement.'],
  ['plan', 'Employee plan registration', 'Form S-8: shares for employee benefit plans. Not a market offering.'],
  ['agreement', 'Material agreement', 'A current report (8-K, item 1.01) of a material agreement. Most are not about selling shares, and the index does not say what the agreement is.'],
])
const KINDS = new Set(KIND_NOTES.map(([kind]) => kind))
const SHELF_STATES = new Set(['live', 'expired', 'not_effective', 'withdrawal_requested'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: a calendar date as "Oct 30, 2026" (`short`: "Oct 30"). Anything else comes back as it is. */
export function dayText(iso, { short = false } = {}) {
  const d = day(iso)
  if (!d) return iso ? String(iso) : ''
  const [y, m, dd] = d.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return short ? `${mon} ${dd}` : `${mon} ${dd}, ${y}`
}

/** Pure: the New York calendar date of an ISO instant ('YYYY-MM-DD'), or null. */
export function etDayOf(iso) {
  const d = typeof iso === 'string' && iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

/** Pure: the address when it is a filing's page on sec.gov, else null (a row never links anywhere else). */
export const secUrl = (v) => (typeof v === 'string' && v.startsWith(SEC_FILING_PREFIX) && !/[\s"'<>]/.test(v) ? v : null)

function rowOf(r) {
  const date = isObj(r) ? day(r.date) : null
  const form = isObj(r) ? str(r.form) : null
  if (!date || !form) return null
  const under = isObj(r.under) && day(r.under.filed) ? { form: str(r.under.form), filed: r.under.filed, shelf: r.under.shelf === true } : null
  return {
    date, form, kind: KINDS.has(r.kind) ? r.kind : 'other', what: str(r.what) || `Form ${form}`, url: secUrl(r.url),
    accession: str(r.accession), fileNumber: str(r.file_number),
    items: Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string' && /^\d{1,2}\.\d{2}$/.test(x)) : [],
    under,
  }
}

function shelfOf(s) {
  const filed = isObj(s) ? day(s.filed) : null
  const form = isObj(s) ? str(s.form) : null
  if (!filed || !form || !SHELF_STATES.has(s.state)) return null
  return {
    form, what: str(s.what) || 'Shelf registration', filed, url: secUrl(s.url), fileNumber: str(s.file_number),
    automatic: s.automatic === true, effective: day(s.effective),
    effectiveBasis: s.effective_basis === 'automatic' || s.effective_basis === 'notice' ? s.effective_basis : null,
    expires: day(s.expires_estimate), state: s.state, withdrawalRequested: day(s.withdrawal_requested),
    amendments: count(s.amendments) || 0, offerings: count(s.offerings), latestOffering: day(s.latest_offering),
  }
}

const horizonOf = (h) => ({ m12: count(h?.m12), y3: count(h?.y3), latest: day(h?.latest) })

/**
 * Pure: the route's answer as the panel draws it.
 *   state   'ok' | 'none' (reason) | 'computing' | 'unavailable' (reason, httpStatus) | 'bad-symbol'
 *           | 'failed' (reason: the server's own word, or null when the answer is not this route's)
 */
export function dilutionRead(body) {
  if (!isObj(body)) return { state: 'failed', reason: null }
  const status = String(body.status || '')
  const httpStatus = count(body.http_status)
  if (status === 'computing') return { state: 'computing', busy: body.busy === true }
  if (status === 'bad_symbol') return { state: 'bad-symbol' }
  if (status === 'none') return { state: 'none', reason: body.reason === 'no_filings' ? 'no_filings' : 'no_cik' }
  if (status === 'unavailable') return { state: 'unavailable', reason: str(body.reason), httpStatus }
  if (status === 'failed') return { state: 'failed', reason: str(body.reason) || 'error', httpStatus }
  const win = isObj(body.window) ? body.window : {}
  if (status !== 'ok' || !Array.isArray(body.rows) || !isObj(body.summary) || !day(win.from) || !day(win.to)) {
    return { state: 'failed', reason: null }
  }
  const cov = isObj(body.coverage) ? body.coverage : {}
  const sum = body.summary
  const shelves = (Array.isArray(body.shelves) ? body.shelves : []).map(shelfOf).filter(Boolean)
  const rows = body.rows.map(rowOf).filter(Boolean)
  // an answer with rows of which none can be read is a failed read, never "nothing filed"
  if (body.rows.length && !rows.length) return { state: 'failed', reason: null }
  const live = shelves.filter((s) => s.state === 'live')
  const pending = shelves.filter((s) => s.state === 'not_effective')
  const complete = cov.complete === true
  return {
    state: 'ok',
    sym: str(body.sym),
    company: str(body.company),
    entityType: str(body.entity_type),
    fundLike: body.fund_like === true,
    window: { years: count(win.years) || 3, from: win.from, to: win.to, recentMonths: count(win.recent_months) || 12 },
    coverage: { complete, from: complete ? null : day(cov.from), pagesUnread: count(cov.pages_unread) || 0 },
    newestFiling: day(body.newest_filing),
    readAt: str(body.read_at),
    refreshing: body.refreshing === true,
    shelfLifeYears: count(body.shelf_life_years) || 3,
    summary: {
      liveShelves: live.length, liveShelf: live[0] || null, pendingShelves: pending.length, pendingShelf: pending[0] || null,
      offerings: horizonOf(sum.offerings), unregistered: horizonOf(sum.unregistered), registrations: horizonOf(sum.registrations),
    },
    shelves,
    rows,
    rowsTotal: Math.max(count(body.rows_total) || 0, rows.length),
    cut: body.cut === true,
  }
}

/** Pure: the timeline as drawn: every row, or every row but the kinds listed apart. */
export const rowsFor = (rows, withMinor) => (withMinor ? rows : rows.filter((r) => !MINOR_KINDS.includes(r.kind)))
/** Pure: how many of the rows are of the kinds listed apart. */
export const minorCount = (rows) => rows.filter((r) => MINOR_KINDS.includes(r.kind)).length

const years = (n) => `${n} ${plural(n, 'year', 'years')}`
const reach = (view) => (view.coverage.from ? `the filings read reach back only to ${dayText(view.coverage.from)}` : 'the filings read do not reach back that far')

/** Pure: the newest shelf that appears to be in force, in a sentence that says it is an estimate. */
export function liveShelfSentence(shelf, liveCount, lifeYears = 3) {
  if (!shelf) return ''
  const how = shelf.effectiveBasis === 'automatic'
    ? 'it took effect the day it was filed'
    : `the SEC's notice that it took effect is dated ${dayText(shelf.effective)}`
  const until = shelf.expires ? `, to about ${dayText(shelf.expires)}` : ''
  const more = liveCount > 1 ? ` It is the newest of ${liveCount} that appear to be live.` : ''
  return `${shelf.automatic ? 'An automatic shelf registration' : 'A shelf registration'} filed on ${dayText(shelf.filed)} appears to be live: `
    + `${how}, and a shelf may be used for ${years(lifeYears)} from then${until} (an estimate from the dates).${more}`
}

/** Pure: an offering-document count in a sentence, saying so when a count cannot be given. */
export function offeringsSentence(sym, view) {
  const { m12, y3, latest } = view.summary.offerings
  const yrs = years(view.window.years)
  const last = latest ? `, the latest on ${dayText(latest)}` : ''
  const docs = (n) => `${n} offering ${plural(n, 'document', 'documents')}`
  if (y3 === 0) return `No offering document (a prospectus or a prospectus supplement) was filed in the last ${yrs}.`
  if (y3 != null && m12 != null) {
    return `${sym} filed ${docs(m12)} (prospectuses and prospectus supplements) in the last ${view.window.recentMonths} months and ${y3} in the last ${yrs}${last}.`
  }
  if (m12 != null) {
    return `${sym} filed ${docs(m12)} (prospectuses and prospectus supplements) in the last ${view.window.recentMonths} months${last}. `
      + `The ${view.window.years}-year count is not given: ${reach(view)}.`
  }
  return latest
    ? `${sym}'s latest offering document (a prospectus or a prospectus supplement) was filed on ${dayText(latest)}. Counts are not given: ${reach(view)}.`
    : `No offering document appears in the filings read. Counts are not given: ${reach(view)}.`
}

/**
 * Pure: what was filed, in plain sentences a trader can act on. It says what was filed and when,
 * never what a company will do.
 */
export function summarySentences(sym, view) {
  const s = view.summary
  const yrs = years(view.window.years)
  const majors = rowsFor(view.rows, false).length
  if (view.coverage.complete && !view.shelves.length && !majors && s.offerings.y3 === 0 && !s.unregistered.y3) {
    return [`No shelf registration, offering document or unregistered sale was filed by ${sym} in the last ${yrs}.`]
  }
  const out = []
  if (s.liveShelf) out.push(liveShelfSentence(s.liveShelf, s.liveShelves, view.shelfLifeYears))
  if (s.pendingShelf) {
    out.push(`${s.liveShelf ? 'Another shelf registration, filed' : 'A shelf registration filed'} on ${dayText(s.pendingShelf.filed)}${s.liveShelf ? ',' : ''} `
      + 'has no SEC notice that it took effect in the filing index yet.')
  }
  if (!s.liveShelf && !s.pendingShelf) {
    if (view.shelves.length) out.push(`No shelf registration filed in the last ${yrs} appears to be live.`)
    else if (view.coverage.complete) out.push(`No shelf registration was filed in the last ${yrs}.`)
    else {
      out.push(`No shelf registration appears in the filings read, which ${view.coverage.from ? `reach back only to ${dayText(view.coverage.from)}` : `do not reach back the full ${yrs}`}; `
        + 'a shelf filed before that would not show here.')
    }
  }
  out.push(offeringsSentence(sym, view))
  const u = s.unregistered
  if (u.y3 != null && u.y3 > 0) {
    out.push(`It reported ${u.y3} unregistered ${plural(u.y3, 'sale', 'sales')} of equity securities (8-K item 3.02) in the last ${yrs}, the latest on ${dayText(u.latest)}.`)
  } else if (u.y3 == null && u.latest) {
    out.push(`It reported an unregistered sale of equity securities (8-K item 3.02) on ${dayText(u.latest)}.`)
  }
  const r = s.registrations
  if (r.y3 != null && r.y3 > 0) {
    out.push(`It filed ${r.y3} new registration ${plural(r.y3, 'statement', 'statements')} (the Form S-1 or F-1 family) in the last ${yrs}, the latest on ${dayText(r.latest)}.`)
  }
  return out
}

/** Pure: one shelf registration in a line: when it was filed, when it took effect, and what was filed under it. */
export function shelfSentence(shelf, lifeYears = 3) {
  const parts = []
  if (shelf.state === 'withdrawal_requested') parts.push(`The company asked to withdraw it on ${dayText(shelf.withdrawalRequested)}.`)
  else if (shelf.state === 'not_effective') parts.push('No SEC notice that it took effect is in the filing index yet.')
  else {
    parts.push(shelf.effectiveBasis === 'automatic' ? 'Took effect the day it was filed.' : `Took effect by the SEC's notice dated ${dayText(shelf.effective)}.`)
    if (shelf.expires) {
      parts.push(shelf.state === 'live'
        ? `It may be used until about ${dayText(shelf.expires)}, ${years(lifeYears)} from then (an estimate from the dates).`
        : `Its ${years(lifeYears)} ran to about ${dayText(shelf.expires)} (an estimate from the dates).`)
    }
  }
  if (shelf.offerings) {
    parts.push(`${shelf.offerings} offering ${plural(shelf.offerings, 'document', 'documents')} filed under it${shelf.latestOffering ? `, the latest ${dayText(shelf.latestOffering)}` : ''}.`)
  } else if (shelf.offerings === 0) parts.push('No offering document filed under it in the filings read.')
  return parts.join(' ')
}

/** Pure: the second line of a timeline row: what the filing was filed under, or its 8-K items ('' with nothing to add). */
export function rowDetail(row) {
  if (row.under) return `Under the ${row.under.shelf ? 'shelf' : 'registration'} filed ${dayText(row.under.filed)}`
  if (row.kind === 'effect') return row.fileNumber ? `File ${row.fileNumber}; its registration statement is not among the filings read` : ''
  if ((row.kind === 'unregistered' || row.kind === 'agreement') && row.items.length > 1) return `Items ${row.items.join(', ')}`
  return ''
}

/** Pure: the kinds on screen, in the order of KIND_NOTES, each with its name and its sentence. */
export function notesFor(rows) {
  const seen = new Set(rows.map((r) => r.kind))
  return KIND_NOTES.filter(([kind]) => seen.has(kind)).map(([kind, name, note]) => ({ kind, name, note }))
}

/** Pure: why the SEC's filing index is not available, in a sentence. */
export function unavailableWords(reason, httpStatus) {
  if (reason === 'shape') return "SEC filings are not available right now: the SEC's website answered, but not with a filing index this screen can read."
  return `SEC filings are not available right now: the SEC's website refused the server's request${httpStatus ? ` (it answered ${httpStatus})` : ''}.`
}

/** Pure: a failed read in plain words: { title, hint, retry } (retry false when asking again cannot help yet). */
export function failedWords(reason, sym, cmd = sym) {
  if (reason === 'rate_limited') {
    return { title: "The SEC's website said the server was asking too often.", retry: false,
      hint: 'The server waits about 15 minutes before it asks the SEC again, for any company, and this panel fills in on its own after that. That is not the same as no filings.' }
  }
  if (reason === 'timeout') {
    return { title: "The SEC's website did not answer in time.", retry: true,
      hint: `That is not the same as no filings. The server tries again within a minute; Retry, or run ${cmd} again.` }
  }
  return { title: `SEC filings for ${sym} could not be read just now.`, retry: true,
    hint: `That is not the same as no filings. Retry, or run ${cmd} again.` }
}

/** Pure: a count over the two horizons in words; a count the read does not reach back for is said, never drawn. */
export function horizonWords(h, view) {
  const yrs = years(view.window.years)
  if (h.y3 === 0) return `None in the last ${yrs}`
  const recent = `${h.m12 === 0 ? 'None' : h.m12} in the last ${view.window.recentMonths} months`
  if (h.y3 != null && h.m12 != null) return `${recent}, ${h.y3} in the last ${yrs}`
  if (h.m12 != null) return `${recent}; the ${view.window.years}-year count is not given`
  return `Not counted: ${reach(view)}`
}
