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
import { useMemo, useState } from 'react'

import {
  EmptyState, EyebrowLabel, LollipopChart, ReactionBars, StatTile, reactionStats, formatSigned,
  LOLLI_METRICS,
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
 *  (The old note here said no revenue existed upstream: true of Finnhub
 *  `/stock/earnings`, which carries EPS only. The FMP history leg supplies
 *  `revenueActual`/`revenueEstimated`, so these are real now.) */
function rev(v) {
  const n = num(v)
  if (n == null) return '—'
  return n >= 1000 ? `$${(n / 1000).toFixed(2)}B` : `$${Math.round(n)}M`
}

export default function EarningsHistorySection({ row, reportDate, expectedMove, enrichReady = true }) {
  const quarters = useMemo(() => buildQuarters({
    beatHistory: row?.beat_history, histStats: row?.hist_stats, reportDate, row,
  }), [row, reportDate])

  const reported = quarters.filter((q) => q.reported)

  // EPS and revenue are alternate VIEWS of the same quarters, never a shared
  // axis: dollars-per-share against billions flattens EPS onto the zero line.
  // Toggling also keeps ONE chart, which matters because `.reactionWrap`
  // below pins ReactionBars to LollipopChart's exact grid insets — a second
  // chart would need that alignment maintained twice.
  const [metricKey, setMetricKey] = useState('eps')
  const metric = LOLLI_METRICS[metricKey] || LOLLI_METRICS.eps
  // Revenue is only offered when this company actually reports it — an empty
  // toggle that yields a blank chart is worse than no toggle.
  const hasRevenue = quarters.some(
    (q) => num(q.revenue_actual) != null || num(q.revenue_estimate) != null,
  )

  if (!reported.length) {
    // "Still fetching" and "genuinely never reported" looked IDENTICAL here:
    // both render with no reported quarters, and the section stated the second
    // as fact. On a fast click (Month view → day drawer → ticker) the modal
    // commits a row BEFORE the enrichment batch lands, so a company with ten
    // years of history was told it had none — then silently corrected itself a
    // second later. CalendarDayTable already draws this exact distinction on
    // the same data ("a blank column reads as broken, not loading"); this is
    // that rule reaching the modal.
    //
    // `enrichReady` is the batch-level signal (has the week's enrichment
    // response arrived at all). It is deliberately NOT "row.beat_history ==
    // null": a provider that legitimately has nothing for this ticker leaves
    // that field null forever, which would pin the section on a spinner that
    // never resolves. Once the batch is in, an absent history is an ANSWER.
    if (!enrichReady) {
      return (
        <EmptyState
          icon="clock"
          title="Loading earnings history…"
          hint="Pulling estimate-versus-reported quarters and next-day reactions."
        />
      )
    }
    // ...unless the server tells us it never got one. `enrichReady` only says
    // the BATCH arrived; the enrichment fan-out sheds individual provider
    // calls for rate budget, so a batch can arrive complete-looking with this
    // ticker's history missing. `history_unresolved` is that per-symbol
    // admission, and it outranks the batch signal.
    //
    // The distinction is not cosmetic: "No reported quarters yet" is a CLAIM
    // about the company. JAZZ -- $17B, whose own modal header read "$5.71 vs
    // $6.30 est" -- was told it had never reported a quarter (live 2026-08-06)
    // while Finnhub returned four real quarters on a direct call. Saying
    // nothing true is better than saying something false about a company.
    if (row?.history_unresolved) {
      return (
        <EmptyState
          icon="clock"
          title="Earnings history unavailable"
          hint="We couldn’t reach the history provider for this ticker just now. This refreshes on its own — check back in a few minutes."
        />
      )
    }
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
      {hasRevenue && (
        <div className={styles.metricToggle} role="group" aria-label="Chart metric">
          {[['eps', 'EPS'], ['revenue', 'Revenue']].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className={k === metricKey ? styles.metricOn : styles.metricOff}
              aria-pressed={k === metricKey}
              onClick={() => setMetricKey(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}
      <LollipopChart
        quarters={quarters}
        metric={metric}
        valueFormatter={metricKey === 'revenue' ? rev : eps}
        label={`Estimate vs reported${metricKey === 'revenue' ? ' revenue' : ''}`}
      />

      {/* Same quarter axis, directly beneath — that adjacency IS the section.
          F-1: `.reactionWrap` scopes a CSS rule (see the module comment)
          that insets ReactionBars' own SVG — NOT this wrapper, NOT the
          EyebrowLabel above it — to the SAME left/right pixels as
          LollipopChart's ECharts grid, so the two axes' quarter columns
          actually line up on screen while the two section labels stay
          aligned with each other. */}
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
