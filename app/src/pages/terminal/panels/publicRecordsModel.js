// PUBR's pure half: the public-records route's answer -> what the panel draws. No React.
//
// The route (GET /api/research/public-records/{ticker}, api/routers/public_records.py, paid) answers one company's
// records from four government sources, each its own section with its own state: federal contract awards
// (USAspending.gov), clinical trials it leads (ClinicalTrials.gov), FDA drug approvals (openFDA, Drugs@FDA) and
// lobbying reports that name it as the client (LDA.gov). A ticker is not in any agency's records, so the server
// turns it into the company's names (the site's company name, the SEC's name and recent former SEC names) and keeps
// only the records whose name matches one of them; every other name an agency's search returned is listed as not
// counted. The server never asks an agency on the request: a section it is still reading says `computing`.
//
// `NVDA PUBR TRIALS` (args.js `pubrView`, a copy pinned by functions.publicRecords.test.js).
import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { formatWeekdayDateTimeEt } from '../../../lib/presentation/presentationDates'
import { dayText } from './ratesModel'

export const PUBR_CODE = 'PUBR'
export const PUBR_WHAT = 'Public records'
export const PUBR_COMPUTING_POLL_MS = 3 * 1000
export const PUBR_HELD_POLL_MS = 60 * 60 * 1000
/** Rows a section shows on the all-sections view before "Show all". */
export const PUBR_PREVIEW_ROWS = 3

export const PUBR_VIEW_ARG_WORDS = Object.freeze({
  CONTRACTS: 'contracts', AWARDS: 'contracts', TRIALS: 'trials', FDA: 'fda', APPROVALS: 'fda', LOBBYING: 'lobbying',
})
export const PUBR_SECTIONS = Object.freeze(['contracts', 'trials', 'fda', 'lobbying'])
export const PUBR_VIEWS = Object.freeze({
  all: Object.freeze({ label: 'All', word: null }),
  contracts: Object.freeze({ label: 'Contracts', word: 'CONTRACTS', title: 'Federal contracts', short: 'USAspending.gov' }),
  trials: Object.freeze({ label: 'Trials', word: 'TRIALS', title: 'Clinical trials it leads', short: 'ClinicalTrials.gov' }),
  fda: Object.freeze({ label: 'FDA', word: 'FDA', title: 'FDA drug approvals', short: 'openFDA' }),
  lobbying: Object.freeze({ label: 'Lobbying', word: 'LOBBYING', title: 'Lobbying', short: 'LDA.gov' }),
})

export function parsePubrView(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(PUBR_VIEW_ARG_WORDS, key) ? PUBR_VIEW_ARG_WORDS[key] : null
}
export const normPubrView = (v) => (PUBR_SECTIONS.includes(v) ? v : 'all')
/** The arguments that run a pick: the all-sections view is the bare command. */
export const pubrCommandArgs = (view) => { const v = normPubrView(view); return v === 'all' ? [] : [PUBR_VIEWS[v].word] }
export const pubrUrl = (sym) => `/api/research/public-records/${encodeURIComponent(sym)}`

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v : [])
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const YM = /^\d{4}-\d{2}$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SECTION_STATES = new Set(['matched', 'no_match', 'no_name'])

function readName(n) {
  if (!n || typeof n !== 'object' || !text(n.name)) return null
  return {
    name: text(n.name), counted: n.counted !== false, how: text(n.how), howWords: text(n.how_words), against: text(n.against),
    amount: finite(n.amount), priorAmount: finite(n.prior_amount), records: int(n.records),
  }
}
const readNames = (v) => list(v).map(readName).filter(Boolean)
const readCompanyName = (n) => (n && text(n.name) ? { name: text(n.name), source: text(n.source), sourceWords: text(n.source_words), until: text(n.until) } : null)

function readSection(raw, key) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const base = { key, source: text(src.source) || PUBR_VIEWS[key].short, sourceUrl: text(src.source_url), short: PUBR_VIEWS[key].short }
  if (src.status === 'computing') return { ...base, state: 'computing' }
  if (src.status !== 'ok') {
    return { ...base, state: 'failed', reason: text(src.reason), httpStatus: Number.isInteger(src.http_status) ? src.http_status : null }
  }
  const state = SECTION_STATES.has(src.state) ? src.state : null
  if (!state) return { ...base, state: 'failed', reason: 'shape', httpStatus: null }
  const out = {
    ...base, state, readAt: text(src.read_at), searchedFor: text(src.searched_for),
    names: list(src.names).map(readCompanyName).filter(Boolean),
    counted: readNames(src.counted), notCounted: readNames(src.not_counted).map((n) => ({ ...n, counted: false })),
    notCountedTotal: int(src.not_counted_total) ?? 0, dropped: int(src.dropped) ?? 0,
    check: src.check && typeof src.check === 'object' ? src.check : null,
  }
  if (key === 'contracts') {
    const w = src.windows && typeof src.windows === 'object' ? src.windows : {}
    Object.assign(out, {
      recentTotal: finite(src.recent_total), priorTotal: finite(src.prior_total),
      windows: { recent: list(w.recent).map(text), prior: list(w.prior).map(text) },
      awards: list(src.awards).filter((a) => a && text(a.award_id) && ISO_DAY.test(String(a.date || ''))).map((a) => ({
        awardId: text(a.award_id), recipient: text(a.recipient), date: a.date, amount: finite(a.amount), agency: text(a.agency),
        subAgency: text(a.sub_agency), description: text(a.description), descriptionCut: a.description_cut === true,
        place: text(a.place), kind: text(a.kind), url: httpsOnly(a.url, 'https://www.usaspending.gov/'),
      })),
      awardsCut: src.awards_cut === true, awardsMore: src.awards_more === true, recipientsMore: src.recipients_more === true,
    })
  } else if (key === 'trials') {
    const trial = (s) => ({
      nctId: s.nct_id, title: text(s.title), status: text(s.status), phases: list(s.phases).filter((p) => typeof p === 'string'),
      conditions: list(s.conditions).map(text).filter(Boolean), conditionsMore: int(s.conditions_more) ?? 0,
      start: partial(s.start), primaryCompletion: partial(s.primary_completion), enrollment: int(s.enrollment),
      enrollmentEstimated: s.enrollment_estimated === true, lastUpdate: ISO_DAY.test(String(s.last_update || '')) ? s.last_update : null,
      url: httpsOnly(s.url, 'https://clinicaltrials.gov/'),
    })
    const okTrial = (s) => s && /^NCT\d{8}$/.test(String(s.nct_id || ''))
    Object.assign(out, {
      active: list(src.active).filter(okTrial).map(trial), closed: list(src.closed).filter(okTrial).map(trial),
      activeMatched: int(src.active_matched) ?? 0, closedMatched: int(src.closed_matched) ?? 0,
      activeRead: int(src.active_read) ?? 0, activeTotal: int(src.active_total), closedRead: int(src.closed_read) ?? 0,
      closedTotal: int(src.closed_total), activeCut: src.active_cut === true, closedCut: src.closed_cut === true,
      byPhase: counts(src.by_phase), byStatus: counts(src.by_status),
      dataProcessed: text(src.data_processed), closedSince: ISO_DAY.test(String(src.closed_since || '')) ? src.closed_since : null,
    })
  } else if (key === 'fda') {
    Object.assign(out, {
      actions: list(src.actions).filter((a) => a && text(a.application) && ISO_DAY.test(String(a.date || ''))).map((a) => ({
        application: text(a.application), applicationWords: text(a.application_words), sponsor: text(a.sponsor), drug: text(a.drug),
        drugsMore: int(a.drugs_more) ?? 0, ingredients: text(a.ingredients), date: a.date, action: text(a.action),
        priority: text(a.priority), classWords: text(a.class_words), url: httpsOnly(a.url, 'https://www.accessdata.fda.gov/'),
      })),
      actionsCut: src.actions_cut === true, actionsMatched: int(src.actions_matched) ?? 0, otherChanges: int(src.other_changes) ?? 0,
      since: ISO_DAY.test(String(src.since || '')) ? src.since : null, dataAsOf: ISO_DAY.test(String(src.data_as_of || '')) ? src.data_as_of : null,
      notice: text(src.notice), applicationsCounted: int(src.applications_counted) ?? 0,
    })
  } else {
    Object.assign(out, {
      quarters: list(src.quarters).filter((q) => q && Number.isInteger(q.year) && Number.isInteger(q.quarter)).map((q) => ({
        year: q.year, quarter: q.quarter, label: text(q.label) || `Q${q.quarter} ${q.year}`, reportsDue: q.reports_due === true,
        due: ISO_DAY.test(String(q.due || '')) ? q.due : null, filings: int(q.filings) ?? 0,
        own: finite(q.own), ownReports: int(q.own_reports) ?? 0, ownNoFigure: int(q.own_no_figure) ?? 0,
        firms: finite(q.firms), firmReports: int(q.firm_reports) ?? 0, firmsNoFigure: int(q.firms_no_figure) ?? 0,
        firmNames: list(q.firm_names).map(text).filter(Boolean),
        issues: list(q.issues).filter((i) => i && text(i.issue)).map((i) => ({ issue: text(i.issue), filings: int(i.filings) ?? 0 })),
        issuesMore: int(q.issues_more) ?? 0, links: list(q.links).map((u) => httpsOnly(u, 'https://lda.gov/')).filter(Boolean),
      })),
      cut: src.cut === true, filingsRead: int(src.filings_read) ?? 0, filingsHeld: int(src.filings_held),
    })
  }
  return out
}

function counts(v) {
  const out = {}
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (int(n) != null) out[k] = n
  return out
}
function partial(v) {
  const d = v && typeof v === 'object' ? v.date : null
  return { date: typeof d === 'string' && (ISO_DAY.test(d) || YM.test(d)) ? d : null, estimated: v?.estimated === true ? true : v?.estimated === false ? false : null }
}
/** A link the panel opens: https on the agency's own site only, else null. */
export function httpsOnly(url, prefix) {
  return typeof url === 'string' && url.startsWith(prefix) ? url : null
}

/** The route's answer -> `{state: 'failed'}` (not an answer) or `{state: 'ok', sym, company, sections}`. */
export function pubrRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.status !== 'ok') return { state: 'failed' }
  if (!PUBR_SECTIONS.every((k) => body[k] && typeof body[k] === 'object')) return { state: 'failed' }
  const c = body.company && typeof body.company === 'object' ? body.company : {}
  const company = c.status === 'ok'
    ? { state: 'ok', cik: text(c.cik), secState: text(c.sec_state), names: list(c.names).map(readCompanyName).filter(Boolean), readAt: text(c.read_at) }
    : { state: 'computing', names: [] }
  const sections = Object.fromEntries(PUBR_SECTIONS.map((k) => [k, readSection(body[k], k)]))
  return { state: 'ok', sym: text(body.sym), company, sections }
}

/** Ask again in 3 seconds while anything is still being read, else hourly (the server holds a day). */
export function pubrPollMs(body) {
  const r = pubrRead(body)
  if (r.state !== 'ok') return PUBR_HELD_POLL_MS
  return r.company.state === 'computing' || PUBR_SECTIONS.some((k) => r.sections[k].state === 'computing')
    ? PUBR_COMPUTING_POLL_MS : PUBR_HELD_POLL_MS
}

// ── words ────────────────────────────────────────────────────────────────────────────────────

/** "$1.25M", "-$40.0K"; a missing figure is words, never $0. */
export const moneyWords = (v, missing = 'No figure') => (finite(v) == null ? missing : formatCompactTerminal(v, { money: true }))
export const countWords = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`
/** "May 14, 2030" for a day, "Feb 2029" for a month (ClinicalTrials.gov's partial dates), '' for nothing. */
export function dateWords(d) {
  if (typeof d !== 'string') return ''
  if (ISO_DAY.test(d)) return dayText(d)
  if (YM.test(d)) return `${MONTHS[Number(d.slice(5, 7)) - 1] || ''} ${d.slice(0, 4)}`.trim()
  return ''
}
/** When the server read a source, in New York time ("Tue May 14, 10:42 AM ET"), or ''. */
export function readWhen(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? formatWeekdayDateTimeEt(t / 1000, { zoneSuffix: 'ET', absent: '' }) : ''
}

/** "Jan 15, 2031 (estimated)" for a trial date, or "Not given". */
export function trialDateWords(p) {
  const d = dateWords(p?.date)
  if (!d) return 'Not given'
  return p.estimated === true ? `${d} (estimated)` : p.estimated === false ? `${d} (actual)` : d
}

const PHASE_WORDS = { EARLY_PHASE1: 'Early phase 1', PHASE1: 'Phase 1', PHASE2: 'Phase 2', PHASE3: 'Phase 3', PHASE4: 'Phase 4', NA: 'Phase not applicable' }
/** "Phase 1/2" for a combined phase, "No phase given" for none. */
export function phaseWords(phases) {
  const ps = list(phases)
  if (!ps.length) return 'No phase given'
  if (ps.length === 2 && ps.every((p) => /^PHASE\d$/.test(p))) return `Phase ${ps[0].slice(-1)}/${ps[1].slice(-1)}`
  return ps.map((p) => PHASE_WORDS[p] || p).join(', ')
}
/** The same for a server phase key ('PHASE1+PHASE2', 'NONE'). */
export const phaseKeyWords = (key) => phaseWords(key === 'NONE' ? [] : String(key || '').split('+').filter(Boolean))
const PHASE_ORDER = ['EARLY_PHASE1', 'PHASE1', 'PHASE1+PHASE2', 'PHASE2', 'PHASE2+PHASE3', 'PHASE3', 'PHASE4', 'NA', 'NONE']
export const phaseOrder = (key) => { const i = PHASE_ORDER.indexOf(key); return i < 0 ? PHASE_ORDER.length : i }

const STATUS_WORDS = {
  RECRUITING: 'Recruiting', NOT_YET_RECRUITING: 'Not yet recruiting', ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
  ENROLLING_BY_INVITATION: 'Enrolling by invitation', COMPLETED: 'Completed', TERMINATED: 'Terminated', SUSPENDED: 'Suspended',
  WITHDRAWN: 'Withdrawn',
}
export function statusWords(s) {
  if (STATUS_WORDS[s]) return STATUS_WORDS[s]
  const w = String(s || '').toLowerCase().replace(/_/g, ' ')
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Status not given'
}

const ACTION_WORDS = { approval: 'Approved (original application)', new_use: 'New use approved (efficacy supplement)', tentative: 'Tentative approval' }
export const fdaActionWords = (a) => ACTION_WORDS[a] || 'Approved'
/** A trial's enrollment: "1,200 (est.)", or "Not given". */
export const enrollmentWords = (n, estimated) => (int(n) == null ? 'Not given' : `${formatNumber(n)}${estimated ? ' (est.)' : ''}`)
export const priorityWords = (p) => (p === 'PRIORITY' ? 'priority review' : p === 'STANDARD' ? 'standard review' : null)

/** The company's name for a sentence: the first name the server searched with, else the symbol. */
export const companyLabel = (read, sym) => read?.company?.names?.[0]?.name || sym

/** What a section that could not be read says (a title and why), never "no records". */
export function sectionFailWords(s) {
  const src = s.short
  const why = {
    refused: `${src} refused the server's request.`,
    rate_limited: `${src} asked the server to slow down.`,
    budget: `The server's daily allowance of reads from ${src} is used up; it reads again after midnight UTC.`,
    shape: `${src} answered in a form the server could not read.`,
    busy: `The server is reading other companies from ${src}; it tries again within a minute.`,
    company: "The company's names were not ready yet.",
    timeout: `${src} did not answer in time.`,
  }[s.reason] || `${src} could not be read just now.`
  return { title: `${PUBR_VIEWS[s.key].title} could not be read.`, body: `${why} That is not the same as no records. The server tries again later.` }
}

/** The sentence for a section with no match, which never says that no records exist. */
export function noMatchWords(s, company) {
  if (s.state === 'no_name') return `The server holds no company name for this stock to search ${s.short} with, so nothing was searched.`
  const q = s.searchedFor ? `"${s.searchedFor}"` : 'the company\'s name'
  switch (s.key) {
    case 'contracts':
      return `No contract recipient that ${s.short} returned for ${q} in the last 24 months matched ${company}'s names.`
    case 'trials':
      return `No trial that ${s.short} returned for ${q} (active, or closed in the last year) has ${company} as its lead sponsor.`
    case 'fda':
      return `No drug application that ${s.short} returned for ${q} with an action since ${dateWords(s.since) || 'two years ago'} has a sponsor matching ${company}'s names.`
    default:
      return `No lobbying report that ${s.short} returned for ${q} in the last 8 quarters names a client matching ${company}'s names.`
  }
}
export const NOT_NONE = 'No record matched; that is not the same as no record existing: a subsidiary or a business that reports under another name is not matched.'

/** "3 other names were returned and not counted" style line, or ''. */
export function notCountedWords(s) {
  const n = s.notCountedTotal || s.notCounted.length
  if (!n) return ''
  const shown = s.notCounted.length
  return `${countWords(n, 'other name', 'other names')} ${n === 1 ? 'was' : 'were'} returned and not counted${shown < n ? ` (the first ${formatNumber(shown)} are listed)` : ''}.`
}

/** The contracts section's headline. */
export function contractsLede(s) {
  if (s.state !== 'matched') return ''
  const since = dateWords(s.windows.recent[0])
  const r = moneyWords(s.recentTotal)
  const p = moneyWords(s.priorTotal)
  let change = ''
  if (finite(s.recentTotal) != null && finite(s.priorTotal) != null && s.priorTotal > 0) {
    change = ` (${formatPercent(((s.recentTotal - s.priorTotal) / s.priorTotal) * 100, { decimals: 0, signed: true })})`
  }
  return `Obligated to the matched names in the last 12 months${since ? ` (since ${since})` : ''}: ${r}, against ${p} in the 12 months before${change}.`
}

/** The trials section's headline. */
export function trialsLede(s) {
  if (s.state !== 'matched') return ''
  const phases = Object.entries(s.byPhase).sort(([a], [b]) => phaseOrder(a) - phaseOrder(b))
    .map(([k, n]) => `${phaseKeyWords(k)} ${formatNumber(n)}`).join(', ')
  const closed = ['COMPLETED', 'TERMINATED', 'SUSPENDED', 'WITHDRAWN'].filter((k) => s.byStatus[k])
    .map((k) => `${statusWords(k).toLowerCase()} ${formatNumber(s.byStatus[k])}`).join(', ')
  return `${countWords(s.activeMatched, 'active trial', 'active trials')} with the company as lead sponsor${phases ? ` (${phases})` : ''}; `
    + `${countWords(s.closedMatched, 'trial', 'trials')} closed or updated as closed in the last year${closed ? ` (${closed})` : ''}.`
}

/** The FDA section's headline. */
export function fdaLede(s) {
  if (s.state !== 'matched') return ''
  const latest = s.actions[0]
  const head = `${countWords(s.actionsMatched, 'approval or new use', 'approvals and new uses')} since ${dateWords(s.since) || 'two years ago'}`
  const tail = latest ? `; the latest: ${latest.drug || latest.application}, ${dateWords(latest.date)}` : ''
  const other = s.otherChanges ? ` ${countWords(s.otherChanges, 'labeling or manufacturing change was', 'labeling or manufacturing changes were')} approved too (not listed).` : ''
  return `${head}${tail}.${other}`
}

/** Sums of the last four quarters and the four before, each figure kind on its own (null when no figure). */
export function lobbyingSums(quarters) {
  const sum = (qs, k) => { const xs = qs.map((q) => q[k]).filter((v) => finite(v) != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null }
  const recent = quarters.slice(0, 4)
  const prior = quarters.slice(4, 8)
  return { recentOwn: sum(recent, 'own'), recentFirms: sum(recent, 'firms'), priorOwn: sum(prior, 'own'), priorFirms: sum(prior, 'firms') }
}
export function lobbyingLede(s) {
  if (s.state !== 'matched') return ''
  const t = lobbyingSums(s.quarters)
  return `Last 4 quarters: ${moneyWords(t.recentOwn)} in the company's own reports, ${moneyWords(t.recentFirms)} reported by outside firms. `
    + `The 4 before: ${moneyWords(t.priorOwn)} and ${moneyWords(t.priorFirms)}.`
}

/** A cut or partly read section, in words, or ''. */
export function sectionNoteWords(s) {
  const parts = []
  if (s.key === 'contracts') {
    if (s.recipientsMore) parts.push(`${s.short}'s search returned more recipient names than the server reads (the first 100 by amount); smaller ones are not in the totals.`)
    if (s.awardsCut) parts.push('More matched awards were read than are listed; the oldest are left out.')
    if (s.awardsMore) parts.push('The awards are the 100 largest new awards of the last 12 months the search returned; smaller ones are not listed.')
  } else if (s.key === 'trials') {
    if (s.activeTotal != null && s.activeTotal > s.activeRead) parts.push(`${s.short} holds ${formatNumber(s.activeTotal)} active trials for the search; the server read the ${formatNumber(s.activeRead)} most recently updated.`)
    if (s.closedTotal != null && s.closedTotal > s.closedRead) parts.push(`It holds ${formatNumber(s.closedTotal)} recently closed ones; the server read ${formatNumber(s.closedRead)}.`)
    if (s.activeCut || s.closedCut) parts.push('More matched trials were read than are listed.')
  } else if (s.key === 'fda') {
    if (s.actionsCut) parts.push('More actions matched than are listed; the oldest are left out.')
  } else if (s.cut) {
    parts.push(`${s.short} holds more reports for the search than the server reads at once (${formatNumber(s.filingsRead)} read); the oldest quarters may be incomplete.`)
  }
  if (s.dropped) parts.push(`${countWords(s.dropped, 'record', 'records')} in the answer could not be read and ${s.dropped === 1 ? 'is' : 'are'} not shown.`)
  return parts.join(' ')
}

/** A held answer beside a refresh that failed, in words, or ''. */
export function staleWords(s) {
  if (!s.check || !s.check.state) return ''
  const when = readWhen(s.readAt)
  return `The server's latest look at ${s.short} did not go well; this is the answer it read before${when ? ` (${when})` : ''}.`
}

/** The rows a section draws, and whether the all-sections view cuts them. */
export function sectionRows(s, view) {
  const rows = s.key === 'contracts' ? s.awards : s.key === 'trials' ? s.active : s.key === 'fda' ? s.actions : s.quarters
  const all = normPubrView(view) !== 'all'
  return { rows: all ? rows : rows.slice(0, PUBR_PREVIEW_ROWS), more: all ? 0 : Math.max(0, rows.length - PUBR_PREVIEW_ROWS), total: rows.length }
}

/** The lobbying quarter's issue areas, in a line. */
export function issuesWords(q) {
  if (!q.issues.length) return q.filings ? 'No issue area given' : ''
  return q.issues.map((i) => i.issue).join(', ') + (q.issuesMore ? `, and ${formatNumber(q.issuesMore)} more` : '')
}

/** One quarter's figure cell: the amount and how many reports, or why there is no figure. */
export function quarterFigureWords(amount, reports, noFigure, one, many) {
  if (!reports) return { amount: 'None filed', detail: null }
  const detail = `${countWords(reports, one, many)}${noFigure ? `, ${formatNumber(noFigure)} with no figure` : ''}`
  return { amount: finite(amount) == null ? 'No figure' : moneyWords(amount), detail }
}

/** The matching rule, in one paragraph. */
export const MATCH_RULE = 'A record counts for the company when its name, with legal forms such as Inc or Corp set aside, is the same as one '
  + 'of the company\'s names, has the same words in another order, or is the same name apart from one business word such as '
  + 'Laboratories, Pharmaceuticals or Holdings. Anything else an agency returned is listed as not counted. Names are matched from the '
  + 'names alone: no parent or subsidiary is assumed.'
