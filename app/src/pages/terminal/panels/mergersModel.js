// MNA's pure half: the mergers and acquisitions route's answer -> what the panel draws. No React.
//
// The route (GET /api/research/mergers[?sym=], api/routers/mergers.py, paid) answers from what the server
// holds, read from Financial Modeling Prep: the latest announced deals across the market (`MNA`), or the deals
// that name one company (`NVDA MNA`: rows whose acquirer or target is the stock, by symbol or by its name). Each
// deal: the day, the acquirer and the target (a symbol, a name, whether the site follows the stock), and a link
// to the SEC filing when the feed gives one on sec.gov. A provider that refuses the site's plan is an answer
// (`unavailable`), not an error. With nothing held the server says `computing` and the panel asks again.
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'

export const MNA_CODE = 'MNA'
export const MNA_SOURCE = 'Financial Modeling Prep'
export const MNA_WHAT = 'Mergers and acquisitions'
export const MNA_COMPUTING_POLL_MS = 3 * 1000
export const MNA_HELD_POLL_MS = 30 * 60 * 1000

export const mnaUrl = (sym) => (sym ? `/api/research/mergers?sym=${encodeURIComponent(sym)}` : '/api/research/mergers')
export const mnaPollMs = (body) => (body && body.status === 'computing' ? MNA_COMPUTING_POLL_MS : MNA_HELD_POLL_MS)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const whole = (v) => (Number.isInteger(v) && v > 0 ? v : 0)
const SEC_LINK = /^https:\/\/(www\.)?sec\.gov\//

function party(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const sym = text(src.sym)
  const name = text(src.name)
  if (!sym && !name) return null
  return { sym: sym ? sym.toUpperCase() : null, name, covered: src.covered === true && !!sym }
}

function readDeal(raw) {
  if (!raw || typeof raw !== 'object' || !ISO_DAY.test(String(raw.date || ''))) return null
  const acquirer = party(raw.acquirer)
  if (!acquirer?.sym) return null
  return {
    date: raw.date, acceptedAt: text(raw.accepted_at), acquirer, target: party(raw.target),
    link: typeof raw.link === 'string' && SEC_LINK.test(raw.link) ? raw.link : null,
  }
}

/** The route's answer -> the panel's view. `state`: 'failed' (not an answer), 'computing', 'source' (the
 *  server could not read the provider: Retry), 'unavailable' (the provider refused the site's plan, or is not
 *  switched on: no Retry), 'none' or 'ok'. */
export function mnaRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'unavailable') return { state: 'unavailable', reason: text(body.reason) }
  if (body.status === 'failed') return { state: 'source', reason: text(body.reason) }
  if (body.status !== 'ok' || !Array.isArray(body.deals)) return { state: 'failed' }
  const deals = body.deals.map(readDeal).filter(Boolean)
    .sort((a, b) => (a.date === b.date ? ((b.acceptedAt || '') < (a.acceptedAt || '') ? -1 : 1) : a.date < b.date ? 1 : -1))
  return {
    state: deals.length ? 'ok' : 'none',
    scope: body.scope === 'company' ? 'company' : 'latest',
    sym: text(body.sym), name: text(body.name), readAt: text(body.read_at),
    check: body.check && typeof body.check === 'object' ? body.check : null,
    deals, cut: body.cut === true,
    dropped: whole(body.dropped) + (body.deals.length - deals.length),
    search: text(body.search), otherCompanies: whole(body.other_companies), fromLatest: whole(body.from_latest),
    symbols: [...new Set(deals.flatMap((d) => [d.acquirer, d.target]).filter((p) => p?.covered).map((p) => p.sym))],
  }
}

/** "Mar 12, 2031". */
export function dealDayWords(iso) {
  const day = formatSessionDate(iso, { absent: '' })
  return day ? `${day}, ${String(iso).slice(0, 4)}` : 'Day not given'
}

/** The line above the table. */
export function mnaCountLine(view) {
  const n = view.deals.length
  const count = `${formatNumber(n, { decimals: 0 })} ${n === 1 ? 'deal' : 'deals'}`
  if (view.scope === 'company') {
    const who = view.name ? `${view.sym} (${view.name})` : view.sym
    return n ? `${count} naming ${who}, newest first.` : `No deal naming ${who} is listed.`
  }
  if (!n) return 'No deal is listed in the latest filings.'
  const span = n > 1 ? `, filed ${dealDayWords(view.deals[n - 1].date)} to ${dealDayWords(view.deals[0].date)}` : ''
  return `The latest ${count}, newest first${span}.`
}

/** What the company search did, in words, or ''. */
export function searchWords(view) {
  if (view.scope !== 'company') return ''
  const parts = []
  switch (view.search) {
    case 'no_name':
      parts.push(`The server holds no company name for ${view.sym}, so only the latest filings were looked through, by symbol.`)
      break
    case 'not_in_plan':
      parts.push('The name search is not available from our data provider, so only the latest filings were looked through.')
      break
    case 'failed':
    case 'rate_limited':
      parts.push('The name search could not be read just now, so only the latest filings are shown. That is not the same as no other deals.')
      break
    default:
      break
  }
  if (view.otherCompanies) {
    parts.push(`${view.otherCompanies} more ${view.otherCompanies === 1 ? 'deal' : 'deals'} matched the name search but ${view.otherCompanies === 1 ? 'names' : 'name'} a different company; ${view.otherCompanies === 1 ? 'it is' : 'they are'} not shown.`)
  }
  return parts.join(' ')
}

/** A cut list or rows that could not be read, in words, or ''. */
export function mnaNoteWords(view) {
  const parts = []
  if (view.cut) parts.push(view.scope === 'company' ? 'More deals are held than the panel lists; the oldest are left out.' : 'The feed holds older deals than these.')
  if (view.dropped) parts.push(`${view.dropped} ${view.dropped === 1 ? 'row' : 'rows'} in the answer had no day or no acquirer symbol and ${view.dropped === 1 ? 'is' : 'are'} not shown.`)
  return parts.join(' ')
}

/** A provider refusal or switch-off, in words. */
export const unavailableWords = (reason) => (reason === 'not_configured'
  ? `${MNA_WHAT} are not switched on for this server yet.`
  : `${MNA_WHAT} are not available from our data provider.`)
