/**
 * Wave 13 lane 13C-2 -- the earnings-prep SCAFFOLD, the one authority both doors draw from.
 *
 * Phase 1 (13C-1) built this body-building logic inside `earningsPrep.js`, reachable only from
 * the one-click door (`createEarningsPrepNote`), and left the catalog's static "Earnings Prep"
 * template (`lib/notebookTemplates.js`) untouched -- a second, hand-typed scaffold with its own
 * placeholder text and its own table shapes. Phase 2 moves the body-building half of
 * `earningsPrep.js` HERE, with no dependency on note-creation (`noteCreation.js` -> `createNote
 * ViaApi`, which the one-click door needs and the catalog entry's `build(ctx)` must not reach --
 * `noteCreation.js` itself imports `templateContext.js`, which imports `requestPrepDraft` FROM
 * HERE, so a dependency back onto `earningsPrep.js` or `noteCreation.js` would be a cycle).
 *
 * Both doors now read the SAME `buildPrepDoc`:
 *   * the one-click door (`earningsPrep.js::createEarningsPrepNote`) calls it on the draft its
 *     own POST just fetched;
 *   * the catalog's `earnings-prep` template (`notebookTemplates.js`) calls it on
 *     `ctx.earningsPrepDraft` -- the SAME draft, fetched by `templateContext.js::
 *     assembleTemplateContext` when the template declares `needs.earningsPrepDraft` and a ticker
 *     is known -- or on `{}` when no ticker was given, which `buildPrepDoc` already renders as a
 *     whole, valid, all-missing doc (13C-1's own `earningsPrep.test.js` proves `buildPrepDoc({})`
 *     builds in the real editor schema; this phase adds nothing new for that case).
 *
 * ⛔ NEVER CREATES A NOTE (decision R5). This module only builds a doc and reads two GETs/one
 * POST; it has no `createNoteViaApi` import and must never gain one.
 *
 * ⛔ FROZEN BY CONSTRUCTION. The values are written into the note as TEXT. Nothing in the note
 * re-reads a source, so a later data change cannot move what the member was shown.
 *
 * ⛔ MISSING IS SAID, NEVER INVENTED. A cell the server marks missing is written as
 * `MISSING_DASH` followed by the server's own sentence -- never a zero, never a guess. A cell
 * that was never fetched at all (no ticker given, so `buildPrepDoc({})`) reads the same way,
 * through the identical code path -- there is no separate "no ticker" sentence to invent.
 *
 * ⛔ NO NEW NODE TYPE. Every node below is level 0 in `notebookSchema.js` (heading, paragraph,
 * lists, table, callout, noteLink, link), so every bundle since before wave 5 reads it.
 */
import { h, p, labeled, bullets, hr, doc } from '../../../lib/tiptapDocBuilders'
import { callout, table } from './templateBlocks'
import { notebookFlag } from './offline/notebookFlags'
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'

export const EARNINGS_PREP_FLAG = 'notebook_earnings_prep_enabled'
export const SOON_URL = '/api/j2/earnings-prep/soon'
export const draftUrl = (symbol) => `/api/j2/earnings-prep/${encodeURIComponent(symbol)}/draft`
/** The tags the built-in Earnings Prep template carries, so both kinds of prep file together. */
export const PREP_TAGS = Object.freeze(['earnings', 'earnings-prep'])
export const MISSING_DASH = '—'

const SOURCE_LABELS = Object.freeze({ positions: 'Open position', watchlist: 'Watchlist', flagged: 'Flagged' })
const TIMING_LABELS = Object.freeze({ bmo: 'before the open', amc: 'after the close' })

/** The gate, latched per tab like every Notebook capability flag. */
export function earningsPrepEnabled() {
  return notebookFlag(EARNINGS_PREP_FLAG) === true
}

export const sourceLabel = (s) => SOURCE_LABELS[s] || s
export const timingLabel = (t) => TIMING_LABELS[t] || null

async function readError(res, fallback) {
  let detail = ''
  try {
    const body = await res.json()
    if (body && typeof body.detail === 'string') detail = body.detail
  } catch { /* a body that is not JSON keeps the fallback sentence */ }
  const err = new Error(detail || fallback)
  err.status = res.status
  return err
}

/** The member's names reporting soon. THROWS on a failed read: a failure is not a quiet week. */
export async function fetchReportingSoon(url = SOON_URL) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw await readError(res, `Could not load the earnings calendar (${res.status})`)
  return res.json()
}

/** The facts a prep note opens with. Counts one of the member's daily drafts -- the SAME POST
 *  whether the member clicked "Create prep note" or picked the Earnings Prep template with a
 *  ticker already known: both produce a real, drafted note, so both rightly spend the cap. */
export async function requestPrepDraft(symbol) {
  const res = await fetch(draftUrl(symbol), { method: 'POST', credentials: 'include' })
  if (!res.ok) throw await readError(res, `Could not draft the prep note (${res.status})`)
  return res.json()
}

// ── formatting ──────────────────────────────────────────────────────────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export function fmtDay(iso) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso))
  if (!m) return String(iso)
  // Noon UTC so no timezone can move a calendar day onto its neighbour.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function fmtShortDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return iso || ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function fmtAsOf(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const fmtPct = (v, { signed = true } = {}) => {
  if (!isNum(v)) return null
  const s = Math.abs(v).toFixed(1)
  if (!signed) return `${s}%`
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}%`
}

const fmtEps = (v) => (isNum(v) ? `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}` : null)

// This grammar's own ladder (B at two decimals, M at one, nothing below a million),
// passed to the one K/M/B primitive rather than hand-rolled; the sign stays OUTSIDE
// the dollar ("−$1.50B"), so the magnitude is formatted and the sign prepended here.
const MONEY_TIERS = Object.freeze([
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 2 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
])

const fmtMoney = (v) => {
  if (!isNum(v)) return null
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e6) return `${sign}${formatCompact(a, { tiers: MONEY_TIERS, prefix: '$' })}`
  return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

const fmtPrice = (v) => (isNum(v) ? `$${v.toFixed(2)}` : null)

// ── cells ───────────────────────────────────────────────────────────────────────────────

const has = (cell) => cell && cell.value !== null && cell.value !== undefined && !cell.missing

/** "Source: X, as of Y." -- every value in the note carries one of these. */
export function sourceLine(cell) {
  if (!cell) return null
  const as = fmtAsOf(cell.asOf)
  return `Source: ${cell.source || 'unknown'}${as ? `, as of ${as}` : ''}.`
}

/** A missing value, written as a dash and the server's own reason. */
export function missingText(cell) {
  const why = (cell && cell.missing) || 'Not available.'
  return `${MISSING_DASH} not available: ${why}`
}

const muted = (text) => ({ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text }] })
const sourceP = (cell) => muted(has(cell) ? sourceLine(cell) : `Source: ${cell?.source || 'unknown'}.`)
const cellText = (cell, fmt) => (has(cell) ? (fmt(cell.value) ?? MISSING_DASH) : MISSING_DASH)

/** A labelled line: "Label: value" or "Label: — not available: why", with its source below. */
function factBlock(label, cell, fmt) {
  if (has(cell)) {
    const text = fmt(cell.value)
    if (text) return [labeled(`${label}:`, text), sourceP(cell)]
  }
  return [labeled(`${label}:`, missingText(cell)), sourceP(cell)]
}

function moveText(v) {
  if (!v || !isNum(v.pct)) return null
  const dollar = isNum(v.dollar) ? ` (${fmtPrice(v.dollar)})` : ''
  return `±${fmtPct(v.pct, { signed: false })}${dollar}`
}

function beatText(beat, pct) {
  if (beat === null || beat === undefined) return MISSING_DASH
  const word = beat ? 'Beat' : 'Miss'
  const p2 = fmtPct(pct)
  return p2 ? `${word} ${p2}` : word
}

function trackedP(parts) {
  return { type: 'paragraph', content: parts.filter(Boolean) }
}

const txt = (text, marks) => (text ? { type: 'text', text, ...(marks ? { marks } : {}) } : null)

// ── the body ────────────────────────────────────────────────────────────────────────────

/** Title the note is created with. */
export function prepTitle(draft) {
  const sym = draft?.symbol || ''
  const day = has(draft?.report?.date) ? fmtShortDay(draft.report.date.value) : null
  return day ? `Earnings Prep — ${sym} (${day})` : `Earnings Prep — ${sym}`
}

function reportSection(draft) {
  const date = draft?.report?.date
  const timing = draft?.report?.timing
  const out = [h(2, 'The report')]
  out.push(...factBlock('Date', date, (v) => fmtDay(v)))
  out.push(...factBlock('Before or after the bell', timing, (v) => timingLabel(v)))
  out.push(...factBlock('Expected move (from options)', draft?.expectedMove, moveText))
  return out
}

function streetSection(draft) {
  const s = draft?.street || {}
  const title = s.quarter ? `What the Street expects (${s.quarter})` : 'What the Street expects'
  const growth = (v) => fmtPct(v) || MISSING_DASH
  const rows = [
    ['EPS', cellText(s.eps, fmtEps), cellText(s.epsYearAgo, fmtEps), has(s.eps) && has(s.epsYearAgo) ? growth(s.epsGrowthPct) : MISSING_DASH],
    ['Revenue', cellText(s.revenue, fmtMoney), cellText(s.revenueYearAgo, fmtMoney), has(s.revenue) && has(s.revenueYearAgo) ? growth(s.revenueGrowthPct) : MISSING_DASH],
  ]
  const out = [h(2, title), table(['', 'Estimate', 'A year ago', 'Growth'], rows)]
  const missing = [
    ['EPS estimate', s.eps], ['Revenue estimate', s.revenue],
    ['EPS a year ago', s.epsYearAgo], ['Revenue a year ago', s.revenueYearAgo],
  ].filter(([, c]) => !has(c))
  const firstSourced = [s.eps, s.revenue, s.epsYearAgo, s.revenueYearAgo].find(has)
  if (firstSourced) out.push(muted(sourceLine(firstSourced)))
  for (const [label, c] of missing) out.push(muted(`${label}: ${missingText(c)}`))
  return out
}

function reactionsSection(draft) {
  const cell = draft?.reactions
  const out = [h(2, 'The last four reactions')]
  if (!has(cell) || !Array.isArray(cell.value) || cell.value.length === 0) {
    out.push(p(missingText(cell)), sourceP(cell))
    return out
  }
  const rows = cell.value.map((r) => [
    r.quarter || MISSING_DASH,
    r.reportDate ? fmtShortDay(r.reportDate) : MISSING_DASH,
    beatText(r.epsBeat, r.epsSurprisePct),
    beatText(r.revenueBeat, r.revenueSurprisePct),
    isNum(r.impliedPct) ? `±${fmtPct(r.impliedPct, { signed: false })}` : MISSING_DASH,
    fmtPct(r.reactionPct) || MISSING_DASH,
  ])
  out.push(table(['Quarter', 'Reported', 'EPS', 'Revenue', 'Implied move', 'Reaction'], rows))
  out.push(sourceP(cell))
  out.push(muted(`${MISSING_DASH} in a cell: UCT holds no value for it (no consensus to score against, no implied move captured before that report, or no bars for that day).`))
  return out
}

function recapSection(draft) {
  const cell = draft?.recap
  const out = []
  if (!has(cell)) {
    out.push(h(2, 'Last call recap'), p(missingText(cell)), sourceP(cell))
    return out
  }
  const v = cell.value
  out.push(h(2, v.quarter ? `Last call recap (${v.quarter})` : 'Last call recap'))
  if (v.headline) out.push(labeled('Headline:', v.headline))
  if (v.sentiment) out.push(labeled('Tone:', String(v.sentiment)))
  if (Array.isArray(v.bullets) && v.bullets.length) out.push(bullets(v.bullets.map(String)))
  if (v.guidance) out.push(labeled('Guidance:', v.guidance))
  out.push(sourceP(cell))
  return out
}

function notesList(cell) {
  if (!has(cell) || !Array.isArray(cell.value) || cell.value.length === 0) return [p(missingText(cell))]
  return [{
    type: 'bulletList',
    content: cell.value.map((n) => ({
      type: 'listItem',
      content: [trackedP([
        { type: 'noteLink', attrs: { noteId: n.id } },
        n.updatedAt ? txt(` (last edited ${fmtShortDay(n.updatedAt)})`) : null,
      ])],
    })),
  }]
}

function tradeLine(t) {
  const parts = [t.side || 'Trade']
  if (t.entryDate) parts.push(`in ${fmtShortDay(t.entryDate)}`)
  if (t.exitDate) parts.push(`out ${fmtShortDay(t.exitDate)}`)
  if (isNum(t.pnlPercent)) parts.push(fmtPct(t.pnlPercent))
  if (isNum(t.rMultiple)) parts.push(`${t.rMultiple.toFixed(1)}R`)
  if (t.result) parts.push(t.result)
  return parts.join(' · ')
}

function tradesList(cell) {
  if (!has(cell) || !Array.isArray(cell.value) || cell.value.length === 0) return [p(missingText(cell))]
  return [{
    type: 'bulletList',
    content: cell.value.map((t) => ({
      type: 'listItem',
      content: [trackedP([txt(tradeLine(t), [{ type: 'link', attrs: { href: `/journal-2-0/trade/${encodeURIComponent(t.id)}` } }])])],
    })),
  }]
}

function positionLine(pos) {
  const parts = [`${pos.side || 'Long'} ${isNum(pos.shares) ? pos.shares.toLocaleString('en-US') : MISSING_DASH} shares`]
  if (isNum(pos.entryPrice)) parts.push(`at ${fmtPrice(pos.entryPrice)}`)
  // A broker import stores the entry as its stop placeholder: never show that as a stop.
  if (isNum(pos.stopPrice) && pos.stopPrice !== pos.entryPrice) parts.push(`stop ${fmtPrice(pos.stopPrice)}`)
  if (pos.entryDate) parts.push(`since ${fmtShortDay(pos.entryDate)}`)
  return parts.join(', ')
}

function historySection(draft) {
  return [
    h(2, 'My history on the name'),
    h(3, 'My notes'),
    ...notesList(draft?.myNotes),
    sourceP(draft?.myNotes),
    h(3, 'My trades'),
    ...tradesList(draft?.myTrades),
    sourceP(draft?.myTrades),
  ]
}

function positionSection(draft) {
  const cell = draft?.myPosition
  const out = [h(2, 'My position going in')]
  if (has(cell) && Array.isArray(cell.value) && cell.value.length) {
    out.push(bullets(cell.value.map(positionLine)))
  } else {
    out.push(p(missingText(cell)))
  }
  out.push(sourceP(cell))
  out.push(p('Holding through it, trimming, or flat? Say why before the print, not after.'))
  return out
}

/**
 * The note body. Pure: the same draft always builds the same doc, and an all-missing draft
 * still builds a whole, valid doc whose every fact reads as a labelled dash.
 *
 * ⛔ THE SCAFFOLD, SHARED BY BOTH DOORS. `earningsPrep.js::createEarningsPrepNote` calls this on
 * a freshly-POSTed draft; `notebookTemplates.js`'s `earnings-prep` catalog entry calls it on
 * `ctx.earningsPrepDraft` (the same shape, fetched the same way when a ticker is known) or on
 * `{}` (no ticker given -- every cell renders as a generic, honest "not available", never a
 * second, hand-typed placeholder scaffold).
 */
export function buildPrepDoc(draft) {
  const frozen = fmtAsOf(draft?.frozenAt)
  return doc([
    callout('info', `Drafted by UCT${frozen ? ` on ${frozen}` : ''} from the sources named under each value. `
      + 'The values are frozen in this note: they will not change when the data does.'),
    ...reportSection(draft),
    ...streetSection(draft),
    ...reactionsSection(draft),
    ...recapSection(draft),
    hr(),
    h(2, 'What the market will listen for'),
    bullets(['Guidance: —', 'The metric that moves this stock: —', 'Anything new: —']),
    ...historySection(draft),
    ...positionSection(draft),
    h(2, 'Where the stock sits going in'),
    p('In a base near highs, extended after a run, or broken down? The setup decides how much a good report can do.'),
    h(2, 'After the report'),
    p('The numbers, the reaction, and whether the setup you described held.'),
  ])
}
