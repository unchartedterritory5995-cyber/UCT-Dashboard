// BRK-01 increment 4 (roadmap RM-L01): the words and numbers of the options strategy backtester.
// Pure; no React. The server (api/services/options_backtest.py) does every computation; this file
// only says what came back, and never fills a gap the server left open.
import { formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dollars, num } from '../../optionsAnalytics/optionsFormat'

export const ENTRY_DTES = [7, 14, 30, 45]
export const EXIT_PCTS = [25, 50, 75, 100]
export const OFFSETS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
export const WIDTHS = [1, 2, 3, 4, 5]

export const offsetLabel = (k) => {
  if (k === 0) return 'At the money'
  const n = Math.abs(k)
  return `${n} strike${n === 1 ? '' : 's'} ${k > 0 ? 'above' : 'below'} the money`
}

// Whole dollars, grouped, the "$" from the shared primitive (was a hand-made `-$`): "$1,234",
// "-$560". A loss that rounds to nothing reads "$0", never "-$0".
export function money(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return dollars(Number(v))
}

const strikeTxt = (k) => (Number.isInteger(k) ? String(k) : num(k))

/** "560 call" or "Long 560 call / short 570 call". */
export function legsLabel(legs) {
  if (!Array.isArray(legs) || !legs.length) return '—'
  if (legs.length === 1) return `${strikeTxt(legs[0].strike)} ${legs[0].type}`
  return legs.map((l) => `${l.side > 0 ? 'long' : 'short'} ${strikeTxt(l.strike)} ${l.type}`).join(' / ')
}

const EXIT_WORDS = { expiry: 'held to expiry', take_profit: 'take-profit', stop_loss: 'stop-loss', after_print: 'closed after the print' }
export function exitLabel(exit) {
  if (!exit) return '—'
  return `${exit.date} (${EXIT_WORDS[exit.kind] || exit.kind})`
}

/** The summary line, or null when the server refused one (n under its floor). */
export function summaryFacts(s) {
  if (!s) return null
  return [
    `${s.n} trades`,
    `Win rate ${formatPercent(s.win_rate * 100, { decimals: 0 })}`,
    `Avg ${money(s.avg_pnl)}`,
    `Median ${money(s.median_pnl)}`,
    `Worst ${money(s.worst)}`,
    `Max drawdown ${money(s.max_drawdown)}`,
  ].join(' · ')
}

// Audit 2026-10-08 (OBT, point 20): the server's reasons and IV note name our data vendor and its
// request budget ("the vendor request budget ran out", "Massive keeps no historical IV"). That is
// engineering detail, not member copy; this says the same thing in plain words.
const PLAIN = [
  [/the vendor request budget ran out/gi, 'the run reached its data limit'],
  [/the vendor read failed/gi, 'the data read failed'],
  [/,? not the vendor's/gi, ', not a data feed\'s'],
  [/Massive keeps no historical IV\.?/gi, 'Historical IV is not available from our data provider.'],
]
export function plainBacktest(s) {
  if (s == null) return s
  return PLAIN.reduce((t, [re, to]) => t.replace(re, to), String(s))
}

/** "3 excluded: 2025-11-21 no contracts listed ...; ..." -- always a sentence, 0 included. */
export function excludedText(result) {
  const n = result?.excluded_count ?? 0
  if (!n) return 'No expiration was excluded.'
  const parts = (result.excluded || []).map((e) => `${e.expiry || `print ${e.report_date}`}: ${plainBacktest(e.reason)}`)
  return `${n} expiration${n === 1 ? ' was' : 's were'} excluded and not simulated — ${parts.join('; ')}.`
}

export function notRunText(result) {
  const n = result?.not_run_count ?? 0
  if (!n) return null
  const parts = (result.not_run || []).map((e) => `${e.expiry || `print ${e.report_date}`}: ${plainBacktest(e.reason)}`)
  return `${n} expiration${n === 1 ? ' was' : 's were'} not run — ${parts.join('; ')}.`
}

export const ivText = (v) => (v === null || v === undefined ? 'n/a' : formatPercent(Number(v) * 100, { decimals: 1 }))
