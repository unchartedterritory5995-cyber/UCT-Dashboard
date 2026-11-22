// INS CLUSTER's pure half: the cluster route's answer -> what the panel draws. No React.
//
// GET /api/insider/clusters (api/services/insider_clusters_sec.py, paid): stocks in which three or
// more insiders bought shares on the open market within ten business days, built once a night from
// the SEC's own Form 4 filings (transaction code P, acquired). The route answers ONLY from what the
// nightly read holds; until the first night has run it says `not_built` (and whether that first read
// is running now, and when the next one is due).
//
// What this module never does:
//   * it never draws a missing number as 0: a price no filer stated leaves the total as "at least"
//     the priced part, and a close the site does not hold says why in words;
//   * it never calls a list complete when some filings of the window were not read: it says how many;
//   * it never names a buyer the filings did not name, or a role the filing did not declare.
import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent,
} from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate, formatWeekdayDateTimeEt } from '../../../lib/presentation/presentationDates'

export const INS_CODE = 'INS'
export const INS_CLUSTERS_URL = '/api/insider/clusters'
/** The source the panel header names, the server's own words. */
export const INS_CLUSTERS_SOURCE = 'SEC Form 4 filings (open-market purchases)'
/** The thing read, as a failed read names it ("Insider cluster buys could not be read just now."). */
export const INS_CLUSTERS_WHAT = 'Insider cluster buys'
/** The list changes once a night: a slow look. */
export const INS_CLUSTERS_POLL_MS = 30 * 60 * 1000
/** While the first night's read is running, the panel asks again this often. */
export const INS_CLUSTERS_BUILDING_POLL_MS = 60 * 1000

/** INS's two views. `token` is what the command carries; all buys is the bare command. */
export const INS_VIEWS = Object.freeze({
  buys: Object.freeze({ label: 'All insider buys', token: null }),
  cluster: Object.freeze({ label: 'Cluster buys', token: 'CLUSTER' }),
})
/** The words the command takes after the code (args.js keeps a pinned copy). None is a function code
 *  or a listed stock today (args.insiderClusters.test.js checks both). */
export const INS_VIEW_ARG_WORDS = Object.freeze({ CLUSTER: 'cluster', CLUSTERS: 'cluster' })

export function parseInsView(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(INS_VIEW_ARG_WORDS, key) ? INS_VIEW_ARG_WORDS[key] : null
}

/** A view the panel can show; anything else is all buys (the default INS, unchanged). */
export const normInsView = (v) => (v === 'cluster' ? 'cluster' : 'buys')

/** The tokens after the code for this view (`[]` for the default). */
export function insiderViewCommandArgs({ view } = {}) {
  const token = INS_VIEWS[normInsView(view)].token
  return token ? [token] : []
}

/** The roles in the order the server ranks them, with their singular and plural words. */
export const ROLE_WORDS = Object.freeze({
  ceo: ['CEO', 'CEOs'],
  cfo: ['CFO', 'CFOs'],
  officer: ['officer', 'officers'],
  director: ['director', 'directors'],
  ten_percent: ['10% owner', '10% owners'],
  other: ['other insider', 'other insiders'],
  not_stated: ['role not stated', 'roles not stated'],
})

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) ? v.slice(0, 10) : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)

/** Pure: "CEO, CFO, 2 directors" from the server's count per role (each insider counted once, by
 *  the highest role the filing declares). '' when nothing is counted. */
export function rolesText(roles) {
  const r = roles && typeof roles === 'object' ? roles : {}
  return Object.entries(ROLE_WORDS)
    .map(([key, [one, many]]) => {
      const n = count(r[key])
      if (!n) return null
      return n === 1 ? one : `${n} ${many}`
    })
    .filter(Boolean)
    .join(', ')
}

/** Pure: one insider's role in words ("CEO", "10% owner"). */
export const roleWord = (key) => (ROLE_WORDS[key] ? ROLE_WORDS[key][0] : ROLE_WORDS.not_stated[0])

/** Pure: "Mar 10", or '' for a day it cannot read. */
export const dayText = (iso) => formatSessionDate(iso, { absent: '' })

/** Pure: the money a cluster bought, compact ("$43.3K"); "at least" when some purchases gave no price. */
export function valueText(value, complete) {
  const v = finite(value)
  if (v === null) return 'not stated'
  const text = formatCompactTerminal(v, { money: true })
  return complete ? text : `at least ${text}`
}

/** Pure: why a close is missing, in words. */
export function closeWhy(reason) {
  if (reason === 'no_ticker') return 'no ticker in the filing'
  if (reason === 'stale') return 'close not current'
  return 'close not held'
}

/** Pure: an insider in one line ("Name and Name, CEO: $12.5K, last buy Mar 10"). */
export function personLine(p) {
  const names = (Array.isArray(p?.names) ? p.names : []).filter((n) => typeof n === 'string' && n.trim())
  const who = names.length ? names.join(' and ') : 'Name not given'
  const parts = [`${who}, ${roleWord(p?.role)}`]
  const value = finite(p?.value)
  parts.push(value === null ? ': price not stated' : `: ${formatCompactTerminal(value, { money: true })}`)
  const last = dayText(p?.last_buy)
  return `${parts.join('')}${last ? `, last buy ${last}` : ''}`
}

/** Pure: the clusters as rows, in the server's order (newest last buy first). A cluster with no
 *  ticker keeps its company name and has `sym: null` (plain text, never a link). */
export function clusterRows(clusters) {
  return (Array.isArray(clusters) ? clusters : [])
    .filter((c) => c && typeof c === 'object' && (c.ticker || c.company) && count(c.insiders))
    .map((c, i) => {
      const close = c.close && typeof c.close === 'object' ? c.close : {}
      const sym = typeof c.ticker === 'string' && c.ticker.trim() ? c.ticker.trim().toUpperCase() : null
      return {
        key: `${c.issuer_cik || sym || c.company}-${c.last_buy}-${i}`,
        order: i,
        sym,
        company: typeof c.company === 'string' && c.company.trim() ? c.company.trim() : null,
        insiders: c.insiders,
        roles: rolesText(c.roles),
        people: Array.isArray(c.people) ? c.people.map(personLine) : [],
        value: finite(c.value),
        valueComplete: c.value_complete !== false,
        avgPrice: finite(c.avg_price),
        close: finite(close.value),
        closeDate: isoDay(close.date),
        closeReason: finite(close.value) === null ? (close.reason || 'not_held') : null,
        change: finite(c.change_pct),
        firstBuy: isoDay(c.first_buy),
        lastBuy: isoDay(c.last_buy),
        buys: count(c.buys),
        filings: count(c.filings),
        url: typeof c.url === 'string' && c.url.startsWith('https://www.sec.gov/') ? c.url : null,
      }
    })
}

/** Pure: the route's answer -> what the panel draws.
 *  state: 'ok' | 'not_built' | 'failed' (an answer that is neither) */
export function clustersRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed' }
  if (body.status === 'not_built') {
    return { state: 'not_built', building: body.building === true, nextRun: typeof body.next_run === 'string' ? body.next_run : null }
  }
  if (body.status !== 'ok') return { state: 'failed' }
  const cov = body.coverage && typeof body.coverage === 'object' ? body.coverage : {}
  const rows = clusterRows(body.clusters)
  return {
    state: 'ok',
    rows,
    total: count(body.total) ?? rows.length,
    truncated: body.truncated === true,
    asOf: isoDay(body.as_of),
    readAt: typeof body.read_at === 'string' ? body.read_at : null,
    building: body.building === true,
    nextRun: typeof body.next_run === 'string' ? body.next_run : null,
    rules: body.rules && typeof body.rules === 'object' ? body.rules : {},
    coverage: {
      complete: cov.complete !== false,
      listed: count(cov.listed),
      read: count(cov.read),
      givenUp: count(cov.given_up) ?? 0,
      from: isoDay(cov.from),
      to: isoDay(cov.to),
      weekdays: count(cov.window_weekdays),
    },
    lastStop: body.last_run && typeof body.last_run === 'object' ? (body.last_run.stop || null) : null,
  }
}

/** Pure: how often the panel asks again for this answer: every minute while the first night's read
 *  is running, else every 30 minutes (the list changes once a night). */
export const clustersPollMs = (body) => (body && body.status === 'not_built' && body.building === true
  ? INS_CLUSTERS_BUILDING_POLL_MS : INS_CLUSTERS_POLL_MS)

/** Pure: an ISO instant as "Sat Mar 15, 1:23 AM ET", or ''. */
export function instantText(iso) {
  const ms = Date.parse(String(iso || ''))
  return Number.isFinite(ms) ? formatWeekdayDateTimeEt(ms / 1000, { zoneSuffix: 'ET', absent: '' }) : ''
}

/** Pure: the sentence for a list that has not been built yet. */
export function notBuiltText(view) {
  if (view.building) return 'The first nightly read of the SEC\'s Form 4 filings is running now. This panel asks again every minute.'
  const when = instantText(view.nextRun)
  return when
    ? `The first read of the SEC's Form 4 filings is due ${when}, and then each night after a weekday.`
    : 'The first read of the SEC\'s Form 4 filings runs overnight after a weekday.'
}

/** Pure: the rule in one sentence, from the answer's own numbers (3 insiders, 10 business days). */
export function ruleText(rules) {
  const n = count(rules?.min_insiders) ?? 3
  const days = count(rules?.window_business_days) ?? 10
  return `Stocks where ${n} or more insiders bought shares on the open market within ${days} business days, from SEC Form 4 filings (transaction code P). Newest last buy first.`
}

/** Pure: what was read, and when, in one or two sentences. Never "complete" when it was not. */
export function readText(view) {
  const parts = []
  const read = instantText(view.readAt)
  if (view.asOf) parts.push(`Filings through ${dayText(view.asOf)}${read ? `, read ${read}` : ''}.`)
  const c = view.coverage || {}
  if (!c.complete && c.listed !== null && c.read !== null) {
    parts.push(`${formatNumber(c.read, { decimals: 0 })} of ${formatNumber(c.listed, { decimals: 0 })} Form 4 filings of the last ${c.weekdays || 12} weekdays are read so far; the rest are read on the coming nights.`)
  } else if (!c.complete) {
    parts.push('Some filing days of the window are not read yet; they are read on the coming nights.')
  }
  if (c.givenUp) parts.push(`${formatNumber(c.givenUp, { decimals: 0 })} filings could not be read after three tries.`)
  if (view.lastStop === 'refused' || view.lastStop === 'rate_limited') {
    parts.push('The last nightly read stopped early because the SEC\'s website turned the server away; it carries on the next night.')
  }
  return parts.join(' ')
}

/** Pure: the cut, said from the end it was cut from. */
export function cutText(view) {
  return view.truncated ? `Showing the newest ${formatNumber(view.rows.length, { decimals: 0 })} of ${formatNumber(view.total, { decimals: 0 })} clusters; the older ones are left off.` : ''
}

/** Pure: the price paid on average, "avg $12.74", or ''. */
export const avgText = (v) => (finite(v) === null ? '' : `avg ${formatCurrency(v)}`)

/** Pure: the change since the average buy price, "+8.04%", or ''. */
export const changeText = (v) => (finite(v) === null ? '' : formatPercent(v, { signed: true }))
