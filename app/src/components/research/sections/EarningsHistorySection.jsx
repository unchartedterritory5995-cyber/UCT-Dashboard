// app/src/components/research/sections/EarningsHistorySection.jsx
//
// §4.3.2 — EPS story and price story, ONE axis, ONE section. This section
// fetches NOTHING: everything comes from the calendar enrichment already on
// `row` plus the shell's expected-move payload (`expectedMove.live.pct` for
// tonight's implied bracket). That is deliberate — it is the section
// arrow-stepping lands on most often after Setup, and a zero-fetch section
// cannot participate in a fetch storm.
//
// GOLD BUDGET: ReactionBars' implied ± bracket is this canvas's single gold
// highlight (§3.1). Nothing else here may be gold.
import { useMemo } from 'react'

import {
  EmptyState, EyebrowLabel, LollipopChart, ReactionBars, StatTile, reactionStats, formatSigned,
} from '../../research-kit'
import { IMPLIED_MOVE_INFO } from '../../../constants/disclaimer'
import { buildQuarters, historyBasis } from '../earningsHistoryModel'
import styles from './EarningsHistorySection.module.css'

// `Number(null) === 0` — the phantom-zero trap that has bitten this branch
// eight times. Every formatter below routes through this so a missing value
// can never render as a fake zero, and a genuine zero (a flat print, a met
// estimate, an unchanged reaction) can never collapse to an em dash.
const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "+3.4%" / "-2.4%" / "0.0%", em dash for null — shared with the kit's
 *  HeatGrid/MetricTrendChart so the sign convention never forks per-surface. */
const pct = (v) => formatSigned(v, { unit: '%', decimals: 1 })

/** `$0.91` / `-$0.12`, or an em dash for a missing value. */
function eps(v) {
  const n = num(v)
  return n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`
}

/** `$820M` / `$1.24B`, or an em dash — revenue actuals arrive in millions.
 *  NOTE: `beat_history` (Finnhub /stock/earnings) carries no revenue field —
 *  every REPORTED row's `revenue_actual` is null in the P2 client-side model
 *  (earningsHistoryModel.js `emptyRow`/`past` mapping never sets it), so this
 *  column reads em dash for history rows until P4's unified endpoint. Not a
 *  bug in this section: there is no revenue data upstream to show yet. */
function rev(v) {
  const n = num(v)
  if (n == null) return '—'
  return n >= 1000 ? `$${(n / 1000).toFixed(2)}B` : `$${Math.round(n)}M`
}

export default function EarningsHistorySection({ row, reportDate, expectedMove }) {
  const quarters = useMemo(() => buildQuarters({
    beatHistory: row?.beat_history, histStats: row?.hist_stats, reportDate, row,
  }), [row, reportDate])

  const reported = quarters.filter((q) => q.reported)

  if (!reported.length) {
    return (
      <EmptyState
        icon="clock"
        title="No reported quarters yet"
        hint="Estimate-versus-reported history appears once this company has reported at least one quarter on our feeds."
      />
    )
  }

  const impliedPct = num(expectedMove?.live?.pct)
  // Recomputed from `quarters` (the SAME rows the chart draws), not read off
  // `row.hist_stats.up_count`/`total` directly — the provider's own up_count
  // denominator can exceed what's actually paired+visible here (last_n caps
  // at 8, beat_history at 4; §2 "every number carries its denominator" means
  // the caption's denominator must match what the chart/table actually show).
  const stats = reactionStats(quarters)

  return (
    <div className={styles.wrap}>
      <LollipopChart quarters={quarters} valueFormatter={eps} />

      {/* Same quarter axis, directly beneath — that adjacency IS the section.
          F-1: `.reactionWrap` insets this to the SAME left/right pixels as
          LollipopChart's ECharts grid (see the CSS module comment) so the
          two axes' quarter columns actually line up on screen. */}
      <div className={styles.reactionWrap}>
        <ReactionBars
          quarters={quarters}
          impliedPct={impliedPct}
          impliedLabel={impliedPct != null ? `Implied ±${Math.abs(impliedPct).toFixed(1)}%` : undefined}
          info={IMPLIED_MOVE_INFO}
        />
      </div>

      <div className={styles.stats} data-testid="history-stats">
        <StatTile label="Avg move" value={stats.avgAbs != null ? `±${stats.avgAbs.toFixed(1)}%` : null} />
        <StatTile label="Closed up" value={stats.total ? `${stats.upCount} / ${stats.total}` : null} />
        <StatTile label="Best" value={stats.best ? pct(stats.best.pct) : null} sub={stats.best?.quarter} />
        <StatTile label="Worst" value={stats.worst ? pct(stats.worst.pct) : null} sub={stats.worst?.quarter} />
      </div>

      <EyebrowLabel>By quarter</EyebrowLabel>
      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="history-table" aria-label="Earnings by quarter">
          <thead>
            <tr>
              <th scope="col">QUARTER</th>
              <th scope="col">ACT / EST</th>
              <th scope="col">SURPRISE</th>
              <th scope="col">REV</th>
              <th scope="col">NEXT-DAY</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q, i) => {
              const surprise = num(q.surprise_pct)
              const reaction = num(q.reaction_pct)
              return (
                <tr key={`${q.quarter}-${i}`}>
                  <td>{q.quarter}</td>
                  <td className="t-num">{eps(q.eps_actual)} / {eps(q.eps_estimate)}</td>
                  <td className={`t-num ${surprise > 0 ? styles.pos : surprise < 0 ? styles.neg : ''}`}>
                    {surprise == null ? '—' : pct(surprise)}
                  </td>
                  <td className="t-num">{rev(q.revenue_actual)}</td>
                  <td className={`t-num ${reaction > 0 ? styles.pos : reaction < 0 ? styles.neg : ''}`}>
                    {reaction == null ? '—' : pct(reaction)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.basis} data-testid="history-basis">{historyBasis(quarters)}</div>
    </div>
  )
}
