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
import { buildAskInsertNode } from './askInsert'
import { widgetSlotNode } from './widgetEmbedCore'
import { settleNoteWrite } from './offline/settleNoteWrite'
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

// ── date helpers (ET-day spine; mirrors CompassTab's own local helpers) ────────────

export function todayDayIso(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

/** The Monday of the week containing `now` (ISO date, UTC-midnight spine — matches
 *  `coach_data_assembler.assemble_week`'s own boundary, which this draft must agree
 *  with byte for byte). */
export function mondayOfIso(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + shift)
  return d.toISOString().slice(0, 10)
}

export function thisMonthIso(now = new Date()) {
  return now.toISOString().slice(0, 7)
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

function leaksSection(leaks) {
  const rows = Array.isArray(leaks) ? leaks : []
  if (!rows.length) {
    return [h(2, 'Leaks'), callout('success', 'No leaks found this period.')]
  }
  return [h(2, 'Leaks'), ...rows.map(leakToggle)]
}

function compassSection(compassText) {
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
  blocks.push(...disciplineSection(payload.discipline))
  blocks.push(hr())
  blocks.push(...setupChangesSection(payload.setupChanges))
  blocks.push(hr())
  blocks.push(...linksSection(payload.links))
  blocks.push(hr())
  blocks.push(...chartsSection(payload.bestTrade, payload.worstTrade))
  blocks.push(hr())
  blocks.push(...leaksSection(payload.leaks))
  const compass = compassSection(payload.compassText)
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

// ── orchestration: fetch, build, land through the create door ──────────────────────

/** Weekly draft: a new standalone note, tagged like the catalog's own weekly-review
 *  template so it sits beside a member's hand-written ones. */
export async function draftWeeklyReview({ accountId, weekStart } = {}) {
  const ws = weekStart || mondayOfIso()
  const payload = await fetchWeeklyDraft({ weekStart: ws, accountId })
  const body = doc([h(2, `Week of ${fmtShort(ws)}`), ...buildDraftBlocks(payload)])
  const note = await createNoteViaApi({ title: weeklyTitle(ws), bodyJson: body, tags: ['weekly-review'] })
  return { note, payload }
}

/** Monthly draft: a new standalone note, tagged like the catalog's own
 *  monthly-review template. */
export async function draftMonthlyReview({ accountId, month } = {}) {
  const m = month || thisMonthIso()
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
 */
export async function draftDailyReview({ accountId, day } = {}) {
  const d = day || todayDayIso()
  const [payload, { note: daily }] = await Promise.all([
    fetchDailyDraft({ day: d, accountId }),
    openDailyNote(),
  ])
  const existing = (daily.bodyJson && Array.isArray(daily.bodyJson.content)) ? daily.bodyJson.content : []
  const appended = [...existing, hr(), h(2, `Today's recap — ${fmtShort(d)}`), ...buildDraftBlocks(payload)]
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
