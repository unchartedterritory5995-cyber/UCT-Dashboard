/**
 * Wave 13 lane 13B — how My Playbook words its numbers. The ONE place the page and its frozen
 * snapshot note format a value, so the two can never disagree, and so the rail that checks every
 * displayed number against the server's payload can format the payload the same way.
 *
 * Every number is the server's (`playbook_stats`, worded by `sample_size`); nothing here computes
 * a statistic. The R3 wording itself is `sampleSize.js`.
 */
import { WORDING } from './sampleSize'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export const fmtPct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '—')
export const fmtR = (v) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}R` : '—')
export const fmtDollar = (v) => {
  if (!isNum(v)) return '—'
  if (v === 0) return '$0.00'
  return `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`
}
export const fmtPF = (v) => (isNum(v) ? (v >= 5 ? '5.0+' : v.toFixed(2)) : '—')

/**
 * The stats one setup card shows, each with the sample it was computed on and the trades it opens.
 * `drill(trade)` says whether a trade is behind that number — the same rule the server used.
 */
export function cardStats(rec) {
  const all = rec.sample || { n: rec.tradeCount, band: null }
  return [
    {
      key: 'winRate', label: 'Win rate', fmt: fmtPct,
      stat: rec.winRateStat ? { ...rec.winRateStat, value: rec.winRateStat.rate } : null,
      drill: (t) => t.result === 'Win' || t.result === 'Loss',
      drillLabel: 'wins and losses',
    },
    {
      key: 'avgR', label: 'Avg R', fmt: fmtR,
      stat: rec.avgRStat ? { ...rec.avgRStat, value: rec.avgRStat.mean } : null,
      drill: (t) => t.rMultiple != null,
      drillLabel: 'trades with an R',
    },
    {
      key: 'expectancy', label: 'Expectancy', fmt: fmtDollar,
      stat: rec.expectancyStat ? { ...rec.expectancyStat, value: rec.expectancyStat.mean } : null,
      drill: () => true,
      drillLabel: 'trades',
    },
    {
      // A profit factor has no simple interval: worded by the setup's sample, with no range.
      key: 'profitFactor', label: 'Profit factor', fmt: fmtPF,
      stat: { n: all.n, band: all.band, value: rec.profitFactor, range: null, noRange: true },
      drill: () => true,
      drillLabel: 'trades',
    },
    {
      key: 'totalPnl', label: 'Total P&L', fmt: fmtDollar,
      stat: { n: all.n, band: all.band, value: rec.totalPnlDollar, range: null, noRange: true },
      drill: () => true,
      drillLabel: 'trades',
    },
  ]
}

/** One stat as plain text, for the snapshot note: the R3 wording carried in words. */
export function statText(stat, fmt) {
  if (!stat || !stat.n) return '— (no trades)'
  const n = `n=${stat.n}`
  if (stat.band === 'too_few') return `${WORDING.too_few} (${n}; ${fmt(stat.value)})`
  if (stat.band === 'thin') {
    const range = Array.isArray(stat.range) ? `, likely ${fmt(stat.range[0])} to ${fmt(stat.range[1])}` : ''
    return `${fmt(stat.value)} (${n}; ${WORDING.thin}${range})`
  }
  return `${fmt(stat.value)} (${n})`
}

/** A pattern finding as one sentence: both counts, both n. */
export function findingText(f) {
  return `“${f.term}”: before ${f.losses.k} of ${f.losses.n} losses and ${f.wins.k} of ${f.wins.n} wins`
}
