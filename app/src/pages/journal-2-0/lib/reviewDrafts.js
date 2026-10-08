/**
 * Wave 13 lane 13F — reviews that write themselves, with the leak finder.
 *
 * One click drafts a daily, weekly or monthly review note. The DATA is the backend's
 * (`api/services/journal_two/review_drafts.py` + `leak_finder.py`, behind
 * `notebook_review_drafts_enabled`) — this file only turns that data into a TipTap doc
 * and lands it through the Notebook's own doors: the daily draft is APPENDED to the
 * member's daily note (`lib/dailyNote.js`'s one-per-day note), weekly and monthly each
 * create a new tagged note through `noteCreation.js`'s `createNoteViaApi` — the SAME
 * create door every other template uses. Nothing here writes a second time: every
 * number is read once from the payload and rendered once.
 *
 * ⛔ Below n=10 (`sample.band === 'too_few'`) a finding is rendered BEHIND THE REVEAL —
 * the Notebook's existing collapsed-toggle primitive (`templateBlocks.toggle`), the same
 * node the catalog's own walkthroughs use. It is never shown plainly.
 *
 * ⛔ Compass text is quoted only if the payload returned one (the backend never
 * generates it) and is wrapped in the G-064 `askInsert` node so it renders with the
 * SAME "AI" labelling every other quoted AI answer in the Notebook carries — never a
 * bespoke callout invented here.
 *
 * ⛔ No model client is reachable from this file or anything it calls.
 */
import { h, p, labeled, linkP, bullets, hr, doc } from '../../../lib/tiptapDocBuilders'
import { callout, table, toggle } from './templateBlocks'
import { getTemplate } from './notebookTemplates'
import { createNoteViaApi } from './noteCreation'
import { openDailyNote } from './dailyNote'
import { todayET } from './calendar'
import { buildAskInsertNode } from './askInsert'
import { widgetSlotNode } from './widgetEmbedCore'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { noteHasUnsentWork, STILL_SYNCING_MESSAGE } from './offline/noteHasUnsentWork'
import { openNotebookDb } from './offline/notebookDb'
import { notebookSchemaHeaders } from './notebookSchema'

// The flag's one authority is `reviewDraftsFlag.js` (wave 14 perf lane): Research Home reads it
// without loading this file. Re-exported so every existing import is unchanged.
export { REVIEW_DRAFTS_FLAG, reviewDraftsEnabled } from './reviewDraftsFlag'

const BASE = '/api/j2/review-drafts'

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Review draft request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

const qs = (params) => {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') out.set(k, v)
  }
  const s = out.toString()
  return s ? `?${s}` : ''
}

/** Fetch the daily draft's data (never writes anything). */
export function fetchDailyDraft({ day, accountId }) {
  return getJson(`${BASE}/daily${qs({ day, accountId })}`)
}

/** Fetch the weekly draft's data. */
export function fetchWeeklyDraft({ weekStart, accountId }) {
  return getJson(`${BASE}/weekly${qs({ weekStart, accountId })}`)
}

/** Fetch the monthly draft's data. */
export function fetchMonthlyDraft({ month, accountId }) {
  return getJson(`${BASE}/monthly${qs({ month, accountId })}`)
}

// ── date helpers (the EASTERN day, week and month) ─────────────────────────────────
//
// ⛔ The period a member means is the Eastern trading day. `now.toISOString()` is the UTC
// date, which is already tomorrow from 8 PM Eastern (7 PM in winter): an evening review then
// asked the server for a day, week or month that has no trades yet and wrote an empty recap.
// All three read `todayET` (lib/calendar.js, Intl-based, right across daylight-saving
// changes) -- the same authority the daily note itself is opened with. Never a typed offset.

export function todayDayIso(now = new Date()) {
  return todayET(now)
}

/** The Monday of the Eastern week containing `now`, as an ISO date. Calendar arithmetic
 *  on the Eastern day's own year, month and day; the `Date.UTC` below is only a container
 *  for that arithmetic, never a reading of the clock. */
export function mondayOfIso(now = new Date()) {
  const [y, m, d] = todayET(now).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay() // 0=Sun..6=Sat
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return date.toISOString().slice(0, 10)
}

export function thisMonthIso(now = new Date()) {
  return todayET(now).slice(0, 7)
}

// ── formatting (R3 wording lives on the server; this only RENDERS it) ──────────────

const fmtDollar = (v) => {
  if (v === null || v === undefined) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

const fmtR = (v, dp = 2) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}R`)

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)

/** A rate worded by its own sample (R3): plain for `normal`, with a range for `thin`,
 *  the wording alone (no number) for `too_few`. */
function wordedRate(stat) {
  if (!stat || !stat.n) return '—'
  if (stat.band === 'too_few') return stat.wording
  const base = fmtPct(stat.rate)
  if (stat.band === 'thin' && stat.range) {
    return `${base} (thin sample, 95% range ${fmtPct(stat.range[0])}–${fmtPct(stat.range[1])})`
  }
  return base
}

/** A mean worded by its own sample (R3), same shape as `wordedRate`. */
function wordedMean(stat) {
  if (!stat || !stat.n) return '—'
  if (stat.band === 'too_few') return stat.wording
  const base = fmtR(stat.mean)
  if (stat.band === 'thin' && stat.range) {
    return `${base} (thin sample, 95% range ${fmtR(stat.range[0])}–${fmtR(stat.range[1])})`
  }
  return base
}

const tradeLink = (t) => `/journal-2-0/trade/${encodeURIComponent(t.id)}`

// ── sections (each pure: payload in, TipTap blocks out) ─────────────────────────────

function numbersSection(aggregates) {
  const a = aggregates || {}
  return [
    h(2, 'The numbers'),
    table(['', 'Value'], [
      ['Trades taken', String(a.trade_count ?? 0)],
      ['Wins / losses / breakeven', `${a.wins ?? 0} / ${a.losses ?? 0} / ${a.bes ?? 0}`],
      ['Win rate', a.win_rate != null ? fmtPct(a.win_rate) : '—'],
      ['Average R', a.avg_r != null ? fmtR(a.avg_r) : '—'],
      ['Net P&L', fmtDollar(a.net_pnl_dollar)],
      ['Profit factor', a.profit_factor != null ? a.profit_factor.toFixed(2) : '—'],
    ]),
  ]
}

/** What a draft says in place of the discipline section while plan grading is off. */
export const DISCIPLINE_OFF_IN_DRAFT = 'Not in this draft. The discipline record comes from plan grading, which is not switched on for your account.'

function disciplineSection(discipline) {
  const d = discipline || {}
  return [
    h(2, 'Discipline record'),
    bullets([
      `Planned: ${d.plannedCount ?? 0} · Unplanned: ${d.unplannedCount ?? 0} · Needs a pick: ${d.needsPickCount ?? 0}`,
      `Plan rate: ${wordedRate(d.planRate)}`,
      `Entry kept: ${wordedRate(d.entry)}`,
      `Stop honored: ${wordedRate(d.stop)}`,
      `Size kept: ${wordedRate(d.size)}`,
      `Target hit rate: ${wordedRate(d.targetHitRate)}`,
    ]),
  ]
}

function setupChangesSection(setupChanges) {
  const rows = Array.isArray(setupChanges) ? setupChanges : []
  if (!rows.length) return [h(2, 'Setup changes'), p('No tagged setups this period.')]
  return [
    h(2, 'Setup changes'),
    table(
      ['Setup', 'Trades', 'Period avg R', 'All-time avg R', 'Change'],
      rows.map((r) => [
        r.setup,
        String(r.periodTradeCount),
        wordedMean(r.periodAvgRStat),
        r.allTimeAvgR != null ? fmtR(r.allTimeAvgR) : '— (new)',
        r.delta != null ? fmtR(r.delta) : '—',
      ]),
    ),
  ]
}

/** A bullet list of real links (`bullets()` only accepts plain strings, and these are
 *  anchors), or a plain-English "none" line when `items` is empty. */
function linkList(items, text, href, emptyText) {
  if (!items.length) return p(emptyText)
  return {
    type: 'bulletList',
    content: items.map((it) => ({ type: 'listItem', content: [linkP(text(it), href(it))] })),
  }
}

function linksSection(links) {
  const l = links || {}
  const plans = l.plans || []
  const reviews = l.reviews || []
  const resurfaced = l.resurfaced || []
  return [
    h(2, 'Links'),
    h(3, 'Plans used this period'),
    linkList(
      plans,
      (pl) => `${pl.symbol} — ${pl.noteTitle}`,
      (pl) => `/journal/notebook?note=${encodeURIComponent(pl.noteId)}`,
      'No plan notes linked to this period’s trades.',
    ),
    h(3, 'Prior reviews'),
    linkList(
      reviews,
      (r) => r.title,
      (r) => `/journal/notebook?note=${encodeURIComponent(r.noteId)}`,
      'No prior review notes found.',
    ),
    h(3, 'Resurfaced this period'),
    linkList(resurfaced, (r) => r.title, (r) => r.link, 'Nothing resurfaced this period.'),
  ]
}

/** A frozen chart of one trade, anchored to its exit — reuses the SAME node
 *  builder every chart insert in the Notebook rides (`widgetSlotNode`), never a
 *  bespoke embed. No annotations: a frozen review chart is not the live symbol's
 *  current workspace drawings. */
function frozenTradeChart(trade, label) {
  if (!trade) return null
  const toSec = Math.floor(new Date(trade.exitDate).getTime() / 1000)
  return widgetSlotNode(
    'chart',
    { symbol: trade.symbol, tf: 'D', to: Number.isFinite(toSec) ? toSec : undefined },
    {
      tradeRef: trade.tradeRef, tradeRefType: 'equity_trade', annotations: [],
      caption: `${label} — ${trade.symbol} ${fmtR(trade.rMultiple)} (${fmtDollar(trade.pnlDollar)})`,
    },
  )
}

function chartsSection(bestTrade, worstTrade) {
  const out = [h(2, 'Best and worst trade')]
  const best = frozenTradeChart(bestTrade, 'Best trade')
  const worst = frozenTradeChart(worstTrade, 'Worst trade')
  if (!best && !worst) {
    out.push(p('No graded trades this period to chart.'))
    return out
  }
  if (best) out.push(best)
  if (worst) out.push(worst)
  return out
}

/** One leak finding as a toggle: collapsed ("behind the reveal") below n=10,
 *  open otherwise. The summary always carries the label and the R3 wording/n. */
function leakToggle(finding) {
  const s = finding.sample || {}
  const tooFew = s.band === 'too_few'
  const nPart = s.wording ? ` — ${s.wording} (n=${s.n})` : ` (n=${s.n})`
  const summary = `${finding.label}${nPart}`
  const di = finding.dollarImpact || {}
  const body = [
    labeled('Net P&L:', fmtDollar(di.netPnl)),
    labeled('Average R:', `${wordedMean(s)} vs your period average of ${fmtR(di.baselineAvgR)}`),
    // Said, never silent: trades that fit this finding and have no R are in none of its numbers.
    ...(finding.excludedNoR > 0 ? [p(
      `${finding.excludedNoR} more trade${finding.excludedNoR === 1 ? '' : 's'} fit this but have no R value, `
      + `so ${finding.excludedNoR === 1 ? 'it is' : 'they are'} not in the numbers above `
      + `(${fmtDollar(finding.excludedNetPnl)} net).`)] : []),
    h(3, 'The trades'),
    bullets(
      (finding.trades || []).map(
        (t) => `${t.symbol} · ${fmtR(t.rMultiple)} · ${fmtDollar(t.pnlDollar)}`,
      ),
    ),
  ]
  // Trade links are added as a separate paragraph list so each is a real anchor
  // (bullets() only accepts plain strings).
  const linkList = {
    type: 'bulletList',
    content: (finding.trades || []).map((t) => ({
      type: 'listItem',
      content: [linkP(`Open ${t.symbol}`, tradeLink(t))],
    })),
  }
  return toggle(summary, [...body, linkList], { open: !tooFew })
}

/** The Leaks section. Two honesty rules (fin-data M6):
 *  - a finding whose trades did NOT do worse than the period average is not a leak; it is
 *    listed apart, under its own heading, never dropped and never called a leak;
 *  - when some trades have no R value they are in no finding at all, and the section says
 *    how many, including when it found nothing.
 *  A payload without `vsBaseline` (an older server) reads as before: every finding a leak. */
function leaksSection(leaks, coverage) {
  const rows = Array.isArray(leaks) ? leaks : []
  const worse = rows.filter((f) => f.vsBaseline !== 'not_worse')
  const notWorse = rows.filter((f) => f.vsBaseline === 'not_worse')
  const out = [h(2, 'Leaks')]
  const c = coverage || {}
  if (c.withoutR > 0) {
    out.push(p(`${c.withoutR} of ${c.trades} trades have no R value and are left out of every finding below.`))
  }
  if (worse.length) out.push(...worse.map(leakToggle))
  else out.push(callout('success', 'No leaks found this period.'))
  if (notWorse.length) {
    out.push(h(3, 'Checked, and not worse than your average this period'))
    out.push(...notWorse.map(leakToggle))
  }
  return out
}

// The reasons the server gives for having no Compass quote that are NOT shown (owner ruling,
// fin walk K2). Compass writes no monthly review as a product, so "there is no monthly review"
// is not news to the member: a monthly draft gets no heading and no sentence for it. Every
// other reason is shown, an unknown one included.
const COMPASS_REASONS_NOT_SHOWN = new Set(['no_monthly_review'])

function compassSection(compassText, omitted) {
  // The server either quotes Compass or says why it does not (no review for the period, its
  // windows differ from the draft's, several accounts and none chosen). The sentence is the
  // server's; this only renders it.
  if (omitted && COMPASS_REASONS_NOT_SHOWN.has(omitted.reason)) return []
  if (omitted && omitted.sentence) return [h(2, 'What Compass said'), p(omitted.sentence)]
  if (!compassText || !compassText.text) return []
  const node = buildAskInsertNode({
    answer: compassText.text,
    sources: [],
    question: compassText.kind === 'eod_recap' ? 'What Compass said about this day' : 'What Compass said about this week',
  })
  if (!node) return []
  return [h(2, 'What Compass said'), node]
}

/** Every section, in order. Returns an ARRAY OF BLOCKS (not a doc) so a caller can
 *  either wrap it in `doc()` for a new note or append it to an existing one. */
export function buildDraftBlocks(payload) {
  const blocks = []
  blocks.push(...numbersSection(payload.aggregates))
  blocks.push(hr())
  // `discipline` is null while plan grading's own switch is off (the server then grades
  // nothing and writes nothing). The section is left out, never drawn as a row of zeros.
  if (payload.discipline) {
    blocks.push(...disciplineSection(payload.discipline))
    // Grading is capped per draft; trades left ungraded are said, never silently missing.
    const cap = payload.gradingCap
    if (cap && cap.ungraded > 0) {
      blocks.push(p(`${cap.ungraded} older trade${cap.ungraded === 1 ? '' : 's'} this period `
        + `${cap.ungraded === 1 ? 'was' : 'were'} not graded against a plan (the newest ${cap.limit} are).`))
    }
  } else {
    // Said, never silently missing: the member was told the draft covers discipline.
    // The server's own sentence when it sends one (`disciplineOmitted`, lane DATA2); an older
    // answer without it still gets a plain reason.
    blocks.push(h(2, 'Discipline record'), p(payload.disciplineOmitted?.sentence || DISCIPLINE_OFF_IN_DRAFT))
    blocks.push(hr())
  }
  blocks.push(...setupChangesSection(payload.setupChanges))
  blocks.push(hr())
  blocks.push(...linksSection(payload.links))
  blocks.push(hr())
  blocks.push(...chartsSection(payload.bestTrade, payload.worstTrade))
  blocks.push(hr())
  blocks.push(...leaksSection(payload.leaks, payload.leakCoverage))
  const compass = compassSection(payload.compassText, payload.compassOmitted)
  if (compass.length) {
    blocks.push(hr())
    blocks.push(...compass)
  }
  return blocks
}

// ── titles (reuse the catalog's own title format for the matching kind) ────────────

function fmtShort(iso) {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function weeklyTitle(weekStart) {
  const tpl = getTemplate('weekly-review')
  return tpl ? tpl.defaultTitle({ weekOfText: fmtShort(weekStart) }) : `Weekly Review — wk of ${weekStart}`
}

function monthlyTitle(month) {
  const tpl = getTemplate('monthly-review')
  const d = new Date(`${month}-01T00:00:00`)
  const label = Number.isNaN(d.getTime()) ? month : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return tpl ? tpl.defaultTitle({ dateShort: label }) : `Monthly Review — ${label}`
}

/** The recap's heading inside a daily note. "Today's" only when it IS today (Eastern). */
export function recapHeading(day) {
  return `${day === todayDayIso() ? "Today's recap" : 'Recap'} — ${fmtShort(day)}`
}

// ── orchestration: fetch, build, land through the create door ──────────────────────

// ── a second click never makes a second draft (fin-data M2) ────────────────────────────────
//
// Each click on a draft door used to write again: a second recap appended to the daily note,
// a second weekly or monthly note. A draft for a period that already has one now answers the
// one that is there (`existing: true`), and nothing is fetched or written for it. To redraft,
// the member deletes the recap section or the note and clicks again -- their choice, never a
// silent overwrite of something they may have edited since.

/** The member's live note with this tag and exactly this title, or null. Best effort: any
 *  failure reads as "none", so a look-up can never block a draft. */
async function findExistingDraft(tag, title) {
  try {
    const res = await fetch(`/api/j2/notes${qs({ tag, sort: 'updated', limit: 50 })}`, { credentials: 'include' })
    if (!res.ok) return null
    const rows = (await res.json())?.notes
    return (Array.isArray(rows) ? rows : []).find((n) => n && n.title === title) || null
  } catch {
    return null
  }
}

const plainText = (node) => (node?.type === 'text' ? (node.text || '')
  : (Array.isArray(node?.content) ? node.content.map(plainText).join('') : ''))

/** Does this daily note already carry the recap for `day`? Matched on the recap's own exact
 *  heading (either wording of it), never on a heading that merely looks like one. */
function hasRecapFor(content, day) {
  const wanted = new Set([`Today's recap — ${fmtShort(day)}`, `Recap — ${fmtShort(day)}`])
  return content.some((n) => n?.type === 'heading' && wanted.has(plainText(n)))
}

/** Weekly draft: a new standalone note, tagged like the catalog's own weekly-review
 *  template so it sits beside a member's hand-written ones. One per week: a second
 *  click opens the first. */
export async function draftWeeklyReview({ accountId, weekStart } = {}) {
  const ws = weekStart || mondayOfIso()
  const existing = await findExistingDraft('weekly-review', weeklyTitle(ws))
  if (existing) return { note: existing, payload: null, existing: true }
  const payload = await fetchWeeklyDraft({ weekStart: ws, accountId })
  const body = doc([h(2, `Week of ${fmtShort(ws)}`), ...buildDraftBlocks(payload)])
  const note = await createNoteViaApi({ title: weeklyTitle(ws), bodyJson: body, tags: ['weekly-review'] })
  return { note, payload }
}

/** Monthly draft: a new standalone note, tagged like the catalog's own
 *  monthly-review template. One per month: a second click opens the first. */
export async function draftMonthlyReview({ accountId, month } = {}) {
  const m = month || thisMonthIso()
  const existing = await findExistingDraft('monthly-review', monthlyTitle(m))
  if (existing) return { note: existing, payload: null, existing: true }
  const payload = await fetchMonthlyDraft({ month: m, accountId })
  const body = doc([h(2, monthlyTitle(m)), ...buildDraftBlocks(payload)])
  const note = await createNoteViaApi({ title: monthlyTitle(m), bodyJson: body, tags: ['monthly-review'] })
  return { note, payload }
}

/**
 * Daily draft: APPENDED to the member's own daily note (opened or created via
 * `openDailyNote`), never a second standalone note — "the daily note" door.
 * A direct PUT with the CAS `baseUpdatedAt` the note was just read at (the same
 * compare-and-set every note save uses), so a concurrent edit is refused with a
 * conflict rather than silently clobbered.
 *
 * ⛔ REFUSED WHILE THE DAILY NOTE HAS UNSENT WORK (fin-frontend I3). The body this door
 * writes is the SERVER's copy plus the recap. Words this browser still holds for the note
 * and has not sent (typed offline, or a save still queued) are not in that copy, and the
 * compare-and-set cannot see them either: the server's `updatedAt` has not moved. The PUT
 * would land a body without them and then be recorded as this tab's own write
 * (`settleNoteWrite`), so the queued save would rebase over the recap or be dropped. The
 * sibling append door (`sendToJournal.js`) asks `noteHasUnsentWork` and refuses; this door
 * asks the SAME helper, with the same plain store opener, and throws its sentence. Nothing
 * is fetched for the draft and nothing is written until the note has synced.
 * With the note open and CLEAN in the editor, the write lands and `settleNoteWrite` records
 * it, so the editor's next save rebases onto it -- the same path as Send to Journal.
 */
export async function draftDailyReview({ accountId, day } = {}) {
  const d = day || todayDayIso()
  // ⛔ THE NOTE IS THE NOTE OF THE DAY BEING DRAFTED (fin-data M1). `d` is handed to the daily
  // note door as its day, so the numbers and the note they are written into cannot be two
  // different days. ⚰️ This opened TODAY's note whatever `day` was: an older recap card on
  // the Compass tab wrote a past day's numbers into today's note under "Today's recap".
  const { note: daily } = await openDailyNote({ today: () => d })
  const verdict = await noteHasUnsentWork(daily.id, { connect: openNotebookDb })
  if (verdict.unsent) {
    const err = new Error(STILL_SYNCING_MESSAGE)
    err.code = 'still-syncing'
    err.memberMessage = STILL_SYNCING_MESSAGE   // callers show THIS sentence, not their generic one
    throw err
  }
  const existing = (daily.bodyJson && Array.isArray(daily.bodyJson.content)) ? daily.bodyJson.content : []
  // One recap per day in the note (fin-data M2): a second click answers the note as it is.
  if (hasRecapFor(existing, d)) return { note: daily, payload: null, existing: true }
  const payload = await fetchDailyDraft({ day: d, accountId })
  const appended = [...existing, hr(), h(2, recapHeading(d)), ...buildDraftBlocks(payload)]
  const res = await fetch(`/api/j2/notes/${encodeURIComponent(daily.id)}`, {
    method: 'PUT',
    credentials: 'include',
    // This bundle's own read of the daily note plus blocks it built itself, so it
    // declares its own derived level (notebookSchemaHeaders with no argument) --
    // the S1 rail (notebookSchema.rail.test.js) refuses a body PUT that declares
    // nothing, because the server cannot then tell an old bundle from a new one.
    headers: { 'Content-Type': 'application/json', ...(await notebookSchemaHeaders()) },
    body: JSON.stringify({ bodyJson: doc(appended), baseUpdatedAt: daily.updatedAt }),
  })
  if (!res.ok) {
    const err = new Error(`Could not save today's recap (${res.status})`)
    err.status = res.status
    throw err
  }
  const updated = (await res.json()).note
  await settleNoteWrite(updated?.id ?? daily.id, updated)
  return { note: updated || daily, payload }
}
