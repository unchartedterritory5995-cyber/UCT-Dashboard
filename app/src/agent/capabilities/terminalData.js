// UCT Agent — terminal data wave 1: the sector ranking (the Agent half of the SCTR terminal panel).
//
//   stock.sectorPerformance   the 11 SPDR sector funds ranked by percent change over Today / 1 week / 1 month /
//                             3 months. "which sectors are leading this month", "sector performance today".
//
// DATA: ONE `sectors.performance` gateway read (api/services/uct_agent/marketdata/sectors_performance.py over
// services/sector_strength). The rows are shaped by the SCTR panel's own pure helper (`sectorRows`,
// pages/terminal/panels/SectorsPanel.jsx), loaded when an answer is built, so the two surfaces rank one way.
// HONESTY: the ranking carries no data time (daily closes, kept up to 15 minutes; during a session the latest bar is
// still forming), and the answer says so instead of stating a time. A fund the server could not read is named, never
// shown as 0. Nothing is predicted.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// A plain vendor price fact (two daily closes), so this capability is an ordinary data read (turn.DATA_READ_ACTIONS).
// The four capabilities over model-isolated kinds live in terminalDataLocal.js: the isolation rail holds a whole
// module to its strictest reader, so the two are kept apart.
//
// Dark by construction: registered only while the server serves `sectors.performance` (UCT_AGENT_DATA_KINDS).
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { kindServed, usable, noRead, pct, andList, NO_TURN } from './terminalDataFormat'

export const SECTOR_CAPABILITY = 'stock.sectorPerformance'
export const SECTOR_KIND = 'sectors.performance'
/** The periods the kind takes (the service's own; the panel's `SECTOR_PERIODS` carries the words for each). */
export const SECTOR_PERIOD_KEYS = ['Today', '1W', '1M', '3M']
const NONE_STATED = 'No figure is stated.'
const TEXT_EACH_END = 3

export const sectorsServed = () => kindServed(SECTOR_KIND)

/**
 * The `sectors.performance` envelope → the member's answer + its facts (pure; exported for tests).
 * `panel` is the SCTR panel module: `{ sectorRows, SECTOR_PERIODS }`.
 */
export function answerFromSectors(envl, panel) {
  if (!usable(envl)) {
    return { text: noRead("UCT's sector ranking", envl, "it is not available from UCT's data at the moment (the sector funds' daily bars could not be read)", NONE_STATED) }
  }
  const d = envl.data
  const board = panel.sectorRows(d)
  const words = panel.SECTOR_PERIODS[d.period] || null
  const sessions = Number.isInteger(d.sessions) ? d.sessions : words?.sessions ?? null
  const missing = (Array.isArray(d.missing) ? d.missing : []).filter(s => typeof s === 'string' && s)
  const rows = board.rows.map((r, i) => ({ rank: i + 1, sector: r.name, fund: r.sym, change_pct: r.pct, change: pct(r.pct) }))
  const facts = { period: d.period, sessions, ranked: rows.length, rows, missing, partial: envl.status === 'partial' }
  if (!rows.length) return { text: `UCT's sector ranking came back with no fund ranked. ${NONE_STATED}`, facts }
  const span = words ? words.column.toLowerCase() : `change over ${d.period}`
  const lines = [`Sector funds ranked by ${span}${sessions ? ` (${sessions === 1 ? 'the latest daily close against the one before it' : `${sessions} sessions of daily closes`})` : ''}, ${rows.length} of them:`]
  const line = (r) => `${r.rank}. ${r.sector} (${r.fund}) ${r.change}`
  if (rows.length <= TEXT_EACH_END * 2) lines.push(...rows.map(line))
  else {
    lines.push(`Strongest: ${rows.slice(0, TEXT_EACH_END).map(line).join('; ')}.`)
    lines.push(`Weakest: ${rows.slice(-TEXT_EACH_END).map(line).join('; ')}.`)
    lines.push('The full ranking is in the table.')
  }
  if (missing.length) lines.push(`Not ranked, because ${missing.length === 1 ? 'its' : 'their'} daily bars could not be read: ${andList(missing)}.`)
  lines.push("UCT's sector ranking carries no data time: it is worked out from daily closes and kept for up to 15 minutes, and while a session is open the latest bar is still forming.")
  lines.push("Source: UCT's sector ranking (the SPDR Select Sector funds' daily closes).")
  const title = `Sector funds: ${words ? words.column : d.period}`
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'rank', label: 'Rank' }, { key: 'sector', label: 'Sector' }, { key: 'fund', label: 'Fund' }, { key: 'change', label: words ? words.column : 'Change' }],
      rows: rows.map(r => ({ rank: r.rank, sector: r.sector, fund: r.fund, change: r.change })),
    },
    present: {
      kind: 'metrics', title, short: `Sectors ${d.period}`,
      items: rows.map(r => ({ label: `${r.sector} (${r.fund})`, value: r.change, note: 'from daily closes', aka: [r.sector.toLowerCase(), r.fund.toLowerCase()] })),
    },
    facts,
  }
}

export async function answerSectors(args = {}) {
  const period = SECTOR_PERIOD_KEYS.includes(args.period) ? args.period : 'Today'
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's sector ranking: ${NO_TURN}.` }
  const envl = await readData('sectors.performance', { period }, { purpose: 'answer', turnId })
  const panel = await import('../../pages/terminal/panels/SectorsPanel')
  return answerFromSectors(envl, panel)
}

let registered = false
let unregister = null
/** Idempotent; registers stock.sectorPerformance ONLY while the server serves `sectors.performance`. */
export function registerTerminalDataCapability() {
  if (registered || !sectorsServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'stock.sectorPerformance',
    surfaces: ['*'],
    target: 'market', query: true,
    summary: 'The 11 SPDR sector funds (Technology XLK, Financials XLF, Energy XLE …) ranked by percent change over today, 1 week, 1 month or 3 months, '
      + 'from daily closes. For "which sectors are leading", "sector performance this month", "weakest sectors this week".',
    hints: 'target = the ref of the stockData entry. period: Today|1W|1M|3M (null = Today; "this week" = 1W, "this month" = 1M, "this quarter" = 3M). '
      + 'Sector FUND returns only: not UCT themes (stock.themes) and not one stock\'s sector. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: { period: { type: ['string', 'null'], enum: [...SECTOR_PERIOD_KEYS, null] } },
      required: ['period'], additionalProperties: false,
    },
    answer: (_snap, args) => answerSectors(args || {}),
  })
  return true
}
export const _resetTerminalDataForTest = () => { unregister?.(); unregister = null; registered = false }
