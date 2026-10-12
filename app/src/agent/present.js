// ── RESPONSE PRESENTATION: one contract for every Agent answer (2026-10-12) ─────────────────────
//
// "Give the member exactly the information they need, in the simplest useful format, with more
// detail only when appropriate or requested." Every answer UCT shows becomes ONE `view`, chosen
// from the RESULT's structure and the member's intent — never from a list of exact phrases:
//
//   value       one figure, prominent                       { value, label, note }
//   comparison  values side by side + the change            { items: [{label, value, note}] }
//   metrics     a few labelled figures                      { items }
//   range       a period summarised (first/last/low/high)   { items, note }
//   table       rows (ranked lists, screens)                { table }  — stacks on narrow panels
//   headlines   news items                                  { headlines: [{title, meta}] , source }
//   text        prose                                       { text }
//   error       a refusal / missing data + what to do next  { text }
//
// Any view may carry `details` (the full text, the full table, the source and methodology) shown
// collapsed, and a `link` into UCT. A capability may return `present` itself; one that returns only
// `{text, table, link}` (or a string) still gets a sensible view here, so new tools inherit it.
//
// ⛔ TWO CHANNELS. The view is the MEMBER's transcript: it is saved in the outcome row's data and
// restored on reload. It is never read into a model request — the server's history door replays only
// a row's text (and, for a local-only row, a fixed note): api/services/uct_agent/turn.py.

export const VIEW_KINDS = ['value', 'comparison', 'metrics', 'range', 'table', 'headlines', 'text', 'error']
export const VIEW_VERSION = 1

const str = (v, n = 400) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n))
const items = (xs, n = 24) => (Array.isArray(xs) ? xs : []).filter(x => x && x.label != null && x.value != null).slice(0, n)
  .map(x => ({ label: str(x.label, 120), value: str(x.value, 120), ...(x.note ? { note: str(x.note, 160) } : {}), ...(x.tone ? { tone: str(x.tone, 12) } : {}),
    ...(Array.isArray(x.aka) && x.aka.length ? { aka: x.aka.slice(0, 6).map(a => str(a, 40).toLowerCase()) } : {}) }))
const table = (t, n = 60) => (t && Array.isArray(t.columns) && Array.isArray(t.rows) && t.columns.length
  ? { columns: t.columns.slice(0, 8).map(c => ({ key: String(c.key), label: str(c.label, 60) })), rows: t.rows.slice(0, n) }
  : null)
const link = (l) => (l && typeof l.href === 'string' && l.href.startsWith('/') ? { href: l.href, label: str(l.label, 80) || 'Open' } : null)

// The member's words ask for depth: then the full answer is shown, not just its lead.
const DETAIL_WORDS = /\b(why|how come|explain\w*|in detail|detailed|details|methodolog\w*|how (is|was|are|do|does) (it|that|this|they) (calculated|computed|measured|defined)|walk me through|step by step|tutorial|break (it|that) down|full (list|table|breakdown|answer)|all (the )?(rows|fields|details)|everything|show (me )?the table)\b/i
export const wantsDetail = (message) => DETAIL_WORDS.test(String(message || ''))

// Words of a label the member's message names ("what's NVDA's market cap" names "Market cap").
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%/ -]+/g, ' ').split(/[\s/-]+/).filter(w => w.length > 1 && !STOP.has(w))
const STOP = new Set(['the', 'of', 'and', 'or', 'a', 'an', 'to', 'in', 'on', 'for', 'vs', 'ttm', 'trailing'])
function named(item, message) {
  const m = ` ${words(message).join(' ')} `
  const w = words(item.label)
  if (w.length > 0 && w.every(x => m.includes(` ${x} `))) return true
  // a result may name other ways to say its label ("P/E" → "pe", "price to earnings")
  const raw = ` ${String(message || '').toLowerCase().replace(/[^a-z0-9%/ -]+/g, ' ')} `
  return (item.aka || []).some(a => raw.includes(` ${a} `) || m.includes(` ${a} `))
}

const LEAD_CHARS = 220
/** Concise text: the lead (first line/paragraph) shown; the rest in details — unless depth was asked. */
function conciseText(text, detail) {
  const t = String(text || '').trim()
  if (!t) return { lead: '', rest: '' }
  if (detail) return { lead: t, rest: '' }
  const lines = t.split('\n')
  if (t.length <= LEAD_CHARS && lines.length <= 2) return { lead: t, rest: '' }
  return { lead: lines[0].length <= LEAD_CHARS * 1.6 ? lines[0] : `${lines[0].slice(0, LEAD_CHARS)}…`, rest: t }
}

/** Is this a usable view (a known kind with something to show)? */
export function isView(v) {
  if (!v || typeof v !== 'object' || !VIEW_KINDS.includes(v.kind)) return false
  switch (v.kind) {
    case 'value': return !!str(v.value)
    case 'comparison': case 'metrics': case 'range': return items(v.items).length > 0
    case 'table': return !!table(v.table)
    case 'headlines': return Array.isArray(v.headlines) && v.headlines.length > 0
    default: return !!str(v.text, 20000)
  }
}

/**
 * Any answer → one view. `answer` is what a query capability returned: a string, or
 * { text, table?, link?, sources?, present? }. `message` is the member's request (intent).
 */
export function presentOf(answer, { message = '' } = {}) {
  const a = typeof answer === 'string' || answer == null ? { text: answer || '' } : answer
  const detail = wantsDetail(message)
  const full = String(a.text || '').trim()
  const tbl = table(a.table)
  const lnk = link(a.link)
  const p = a.present && VIEW_KINDS.includes(a.present.kind) ? a.present : null
  let view
  if (p) {
    view = { kind: p.kind }
    if (p.title) view.title = str(p.title, 120)
    if (p.kind === 'value') Object.assign(view, { value: str(p.value, 80), label: str(p.label, 140), ...(p.note ? { note: str(p.note, 200) } : {}) })
    else if (['comparison', 'metrics', 'range'].includes(p.kind)) Object.assign(view, { items: items(p.items), ...(p.note ? { note: str(p.note, 200) } : {}) })
    else if (p.kind === 'table') view.table = table(p.table) || tbl
    else if (p.kind === 'headlines') Object.assign(view, { headlines: (p.headlines || []).slice(0, 12).map(h => ({ title: str(h.title, 220), meta: str(h.meta, 120) })) })
    if (p.text) view.text = str(p.text, 4000)
    if (p.source) view.source = str(p.source, 160)
    // FOCUS: a metrics result whose labels the member NAMED shows just those (the rest is in details).
    if (view.kind === 'metrics' && !detail) {
      const hit = view.items.filter(it => named(it, message))
      if (hit.length === 1) {
        const it = hit[0]
        view = { kind: 'value', value: it.value, label: [view.title, it.label].filter(Boolean).join(' · '), ...(it.note ? { note: it.note } : {}),
          details: { items: items(p.items) } }
      } else if (hit.length > 1 && hit.length < view.items.length) {
        view = { ...view, items: hit, details: { items: items(p.items) } }
      }
    }
    if (detail && view.kind !== 'table' && view.kind !== 'text' && full) view.text = view.text || full
  } else if (tbl) {
    const { lead, rest } = conciseText(full, detail)
    view = { kind: 'table', table: tbl, ...(lead ? { text: lead } : {}) }
    if (rest) view.details = { text: rest }
  } else {
    const { lead, rest } = conciseText(full, detail)
    view = { kind: a.error ? 'error' : 'text', text: lead }
    if (rest) view.details = { text: rest }
  }
  // Everything the full answer had stays one tap away (unless it IS what is shown).
  const det = { ...(view.details || {}) }
  if (p && full && !det.text && view.text !== full) det.text = full
  if (p && tbl && view.kind !== 'table' && !det.table) det.table = tbl
  if (Object.keys(det).length) view.details = det
  if (lnk) view.link = lnk
  if (Array.isArray(a.sources) && a.sources.length) view.sources = a.sources.filter(s => typeof s === 'string').slice(0, 5)
  return isView(view) ? view : (full ? { kind: 'text', text: full } : null)
}

// ── persistence: the member's transcript keeps the view, bounded ──────────────────────────────
// The store keeps ≤ 20,000 characters of a row's data; a view is held well under that so the row's
// kind / actions / local flag (what the server's history door reads) are never at risk.
export const VIEW_MAX_CHARS = 9000
export function compactView(view, max = VIEW_MAX_CHARS) {
  if (!isView(view)) return null
  const v = JSON.parse(JSON.stringify(view))
  const size = () => JSON.stringify(v).length
  if (size() > max && v.details?.table) { delete v.details.table; v.details.trimmed = true }
  if (size() > max && v.details?.text) { v.details.text = `${v.details.text.slice(0, 1500)}…`; v.details.trimmed = true }
  if (size() > max && v.table) { v.table = { ...v.table, rows: v.table.rows.slice(0, 12) }; v.trimmed = true }
  if (size() > max && v.details) { delete v.details; v.trimmed = true }
  if (size() > max) return null
  return { ...v, v: VIEW_VERSION }
}
/** Several answers in one turn share the budget; a view that cannot fit is left out (its text stays). */
export const compactViews = (views) => {
  const vs = (views || []).filter(isView)
  return vs.length ? vs.map(v => compactView(v, Math.floor(VIEW_MAX_CHARS * 1.5 / vs.length))).filter(Boolean) : []
}

// ── restore: stored rows → the transcript items the panel renders (both restore paths) ────────
const RECEIPT_KINDS = new Set(['applied', 'applied-unsaved', 'undo', 'undo-unsaved', 'failed'])
const REFUSAL_KINDS = /^(refused|undo-refused|undo-none|error|dismissed|unsupported)/
const QUESTION_KINDS = /^clarify/

/**
 * One stored turn → zero or one transcript item. Never an empty bubble. Older rows (text only, or
 * no data at all) still render as plain text.
 */
export function itemFromTurn(t) {
  const many = viewsOf(t)
  if (many) return many
  const base = { id: `h${t.id}`, history: true, at: t.created_at ? t.created_at * 1000 : undefined }
  const text = String(t.text || '').trim()
  const data = t.data && typeof t.data === 'object' ? t.data : null
  if (t.role === 'member') return text ? { ...base, role: 'member', text, ...(data?.voice ? { voice: true } : {}) } : null
  if (t.role === 'agent') {
    const q = data?.envelope?.disposition === 'clarify' ? data.envelope.question : null
    if (q && str(q.text)) return { ...base, role: 'question', text: str(q.text, 2000), choices: [] }
    return text ? { ...base, role: 'agent', text, ...(Array.isArray(data?.citations) && data.citations.length ? { sources: data.citations.slice(0, 5) } : {}) } : null
  }
  // outcome rows
  const kind = data?.kind || null
  if (!text) return null
  if (kind && RECEIPT_KINDS.has(kind)) return { ...base, role: 'receipt', lines: Array.isArray(data.lines) && data.lines.length ? data.lines.map(l => str(l, 300)) : [text], restored: true }
  if (kind === 'proposed') return { ...base, role: 'proposal', lines: [text.replace(/^Proposed:\s*/, '')], status: 'history' }
  if (kind && QUESTION_KINDS.test(kind)) return { ...base, role: 'question', text, choices: [] }
  if (kind && REFUSAL_KINDS.test(kind)) return { ...base, role: 'refusal', text }
  return { ...base, role: 'agent', text }
}

// An outcome row that saved the answers' VIEWS restores one card per answer (the member's channel).
function viewsOf(t) {
  if (t.role !== 'outcome' || !t.data || typeof t.data !== 'object') return null
  const vs = (Array.isArray(t.data.views) ? t.data.views : []).filter(isView)
  if (!vs.length) return null
  const at = t.created_at ? t.created_at * 1000 : undefined
  return vs.map((v, i) => ({ id: `h${t.id}.${i}`, history: true, at, role: 'agent', present: v, text: '' }))
}

export const itemsFromTurns = (turns) => (Array.isArray(turns) ? turns : []).flatMap(t => {
  const r = itemFromTurn(t)
  return Array.isArray(r) ? r : (r ? [r] : [])
})
