// UCT Terminal: share a panel. THE WORDS: the rows as a spreadsheet file and as pasted text, the
// file name, and the lines every share carries (what it is, its as-of time, its source).
//
// Pure: no React, no DOM, no network. The UCT Agent can call every function here with rows it
// built itself.
//
// ⛔ VALUES EXACTLY AS SHOWN. A cell is the text the panel drew, never re-read from the data and
// never given more decimals. The one change is a safety one: see `safeCell`.
import { cellLines } from './shareRead'

const ET = 'America/New_York'
/** What joins the lines of a two-line cell on one line of a file. The app's own separator. */
export const LINE_JOIN = ' \u00B7 '
/** UTF-8 byte order mark: with it Excel opens the file as UTF-8 instead of guessing. */
export const BOM = '\uFEFF'

/**
 * A signed number as the panels print one: +12.3%, -$1,204.50, +2.5R, -0.42. A spreadsheet reads
 * it as a number or as plain text; it cannot be a formula, because nothing follows the number.
 */
const SIGNED_NUMBER = /^[+-][$\u20AC\u00A3]?\d[\d,]*(\.\d+)?\s?(%|[KMBTx]|R|bps|pts)?$/

/**
 * Spreadsheet formula injection: a cell that opens with `=`, `+`, `-` or `@` (or a tab or a
 * carriage return, which some programs strip first) is run as a formula by Excel, Sheets and
 * LibreOffice, and a formula can read other cells or call out. Such a cell gets a leading
 * apostrophe, which every one of them reads as "this is text".
 *
 * A plain signed number is left alone: it is most of what a list of gains and losses holds,
 * and it is not a formula. Anything after the number (`+1+cmd|...`, `-2+3`) is not a plain
 * number and is made safe.
 */
export function safeCell(value) {
  const text = String(value ?? '')
  const lead = text.replace(/^[\s\u00A0]+/, '')
  if (!lead) return text
  if (!/^[=+\-@\t\r]/.test(lead) && !/^[\t\r]/.test(text)) return text
  if (SIGNED_NUMBER.test(lead.trim())) return text
  return `'${text}`
}

/** One CSV field: made safe, then quoted when it holds a comma, a quote, a line break or outer space. */
export function csvField(value) {
  const text = safeCell(value)
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One pasted-text field: made safe, with any tab or line break flattened to a space. */
export function tsvField(value) {
  return safeCell(String(value ?? '').replace(/[\t\r\n]+/g, ' '))
}

/** A cell's text for a file: its lines on one line. */
export function cellText(cell) {
  return cellLines(cell).join(LINE_JOIN)
}

function formatEt(date, opts) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: ET, ...opts }).format(date) } catch { return '' }
}

/** A Date from what a panel reports: an ISO string, epoch seconds, or epoch milliseconds. */
function toDate(at) {
  if (at == null || at === '') return null
  const d = at instanceof Date ? at : typeof at === 'number' ? new Date(at > 1e11 ? at : at * 1000) : new Date(at)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Nov 17, 2026, 3:42 PM ET" in Eastern time. */
export function stampEt(at) {
  const d = toDate(at)
  if (!d) return ''
  const text = formatEt(d, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return text ? `${text.replace(/\u202F/g, ' ')} ET` : ''
}

/** The Eastern calendar day of an instant, `YYYY-MM-DD`. */
export function dayEt(at) {
  const d = toDate(at) || new Date()
  const parts = Object.fromEntries((() => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d).map((p) => [p.type, p.value])
    } catch { return [] }
  })())
  return parts.year ? `${parts.year}-${parts.month}-${parts.day}` : d.toISOString().slice(0, 10)
}

/**
 * The data's own as-of line, from the report the panel gave its header (`usePanelFreshness`):
 * the calendar date or time the panel named, else the instant the server stamped. Empty when
 * the panel reported none: a share never invents one, and never uses the time it was made.
 */
export function asOfLine(report) {
  const named = report?.age?.asOfDate
  if (typeof named === 'string' && named.trim()) return `As of ${named.trim()}`
  const stamp = stampEt(report?.asOf ?? report?.observedAt)
  return stamp ? `As of ${stamp}` : ''
}

/** "Source: ..." in the panel's own words, or empty. */
export function sourceLine(report) {
  const s = typeof report?.source === 'string' ? report.source.trim() : ''
  return s ? `Source: ${s}` : ''
}

export const NO_AS_OF = 'As-of time not given by this panel'
export const BRAND = 'UCT Intelligence'
export const SITE = 'uctintelligence.com'

/**
 * The lines every share carries. `meta` is `{ code, command, label, sym, report }` from the
 * frame: the function code, the command on the panel's title bar, the function's plain name, the
 * security a one-stock panel shows, and the panel's own freshness report.
 */
export function shareLines(meta, now = new Date()) {
  const command = String(meta?.command || meta?.code || '').trim()
  const label = String(meta?.label || '').trim()
  const sym = String(meta?.sym || '').trim().toUpperCase()
  return {
    // A one-stock panel leads with the stock: "NVDA \u00B7 Fails to deliver".
    title: [sym, label].filter(Boolean).join(LINE_JOIN) || command || 'UCT Terminal',
    command,
    asOf: asOfLine(meta?.report) || NO_AS_OF,
    source: sourceLine(meta?.report),
    shared: `Shared ${stampEt(now)}`,
  }
}

/**
 * `uct-<code>-<date>.<ext>`, or `uct-<code>-<symbol>-<date>.<ext>` for a one-stock panel: lower
 * case, the Eastern date, nothing a file system refuses.
 */
export function shareFileName(code, ext, now = new Date(), sym = '') {
  const part = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `uct-${[part(code) || 'panel', part(sym)].filter(Boolean).join('-')}-${dayEt(now)}.${part(ext) || 'csv'}`
}

/** The rows of a read as arrays of text, one array per line of the file. */
function fileRows(read, meta, now) {
  const lines = shareLines(meta, now)
  const head = [`${lines.title}${lines.command && lines.command !== lines.title ? ` (${lines.command})` : ''}`, lines.asOf]
  if (lines.source) head.push(lines.source)
  head.push(`${BRAND} Terminal, ${lines.shared.replace(/^Shared/, 'shared')}`)
  const out = [head]
  for (const note of read.notes || []) out.push([note])
  for (const table of read.tables || []) {
    out.push([])
    if (table.caption) out.push([table.caption])
    out.push(table.columns.map((c) => c.text))
    for (const row of table.rows) out.push(row.cells ? row.cells.map(cellText) : [row.band])
  }
  return out
}

/**
 * The spreadsheet file: a first line naming the panel, its as-of time and its source; what the
 * panel says about a cut list; then each table's header and rows. CRLF line ends and a byte order
 * mark, so Excel opens it cleanly.
 */
export function toCsv(read, meta, now = new Date()) {
  return `${BOM}${fileRows(read, meta, now).map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`
}

/** The same rows as tab-separated text, for pasting into a message or a sheet. */
export function toTsv(read, meta, now = new Date()) {
  return fileRows(read, meta, now).map((r) => r.map(tsvField).join('\t')).join('\n')
}
