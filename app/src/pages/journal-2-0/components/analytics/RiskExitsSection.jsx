/**
 * Risk & Exits — the honest exit-quality section of the Analytics tab.
 *
 * Renders the `exitQuality` block from GET /api/j2/analytics. Two plain-language
 * modules ("How much of the move did you capture?" / "What did your exits leave
 * on the table?") over the bar-approximate excursions computed nightly.
 *
 * Honesty is the whole point of this section:
 *   - It is COVERAGE-GATED. Until ~90% of eligible equity trades have a real
 *     excursion AND at least 10 are computed, the aggregates are null and we
 *     show a designed "check back" state with the real counts — NOT an empty
 *     chart pretending to be data.
 *   - There are no fabricated dollars. R is the only honest unit (the backend
 *     omits missed-$ deliberately), so every figure here is a ratio or an R.
 *   - Options are excluded from these equity-only figures; that exclusion is
 *     surfaced in the footer, never silent.
 *
 * NO own header — CollapsibleSection supplies it (children unmount when collapsed).
 */

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { CHART_FONT_FAMILY } from '../../../../utils/chartFont'
import { percent, rMultiple } from '../../../../lib/journal-2-0'
import styles from './RiskExitsSection.module.css'

// Mirrors the backend gate (_EXIT_QUALITY_MIN_COMPUTED). coverageReady alone
// isn't enough — the aggregates are also suppressed below this many computed.
const MIN_COMPUTED = 10

// ── ECharts theme tokens (mirrors AnalyticsTab) ──────────────────────────────

const CHART_COLORS = {
  gain: '#3cb868',
  loss: '#e74c3c',
  gold: '#c9a84c',
  text: '#a8a290',
  textBright: '#e0dac8',
  border: '#2e3127',
  bg: '#1a1c17',
}

const baseChart = {
  backgroundColor: 'transparent',
  textStyle: { fontFamily: CHART_FONT_FAMILY, color: CHART_COLORS.text },
  grid: { left: 40, right: 18, top: 20, bottom: 30, containLabel: true },
  tooltip: {
    backgroundColor: '#22251e',
    borderColor: CHART_COLORS.border,
    textStyle: { color: CHART_COLORS.textBright },
    confine: true,
  },
}

const categoryAxis = {
  type: 'category',
  axisLine: { lineStyle: { color: CHART_COLORS.border } },
  axisLabel: { color: CHART_COLORS.text },
}

const countAxis = {
  type: 'value',
  minInterval: 1,
  axisLine: { lineStyle: { color: CHART_COLORS.border } },
  splitLine: { lineStyle: { color: CHART_COLORS.border, type: 'dashed' } },
  axisLabel: { color: CHART_COLORS.text },
}

// ── RiskExitsSection ─────────────────────────────────────────────────────────

export default function RiskExitsSection({ data }) {
  const coverage = data?.coverage || { eligible: 0, computed: 0, optionsExcluded: 0 }
  const eligible = coverage.eligible ?? 0
  const computed = coverage.computed ?? 0
  const optionsExcluded = coverage.optionsExcluded ?? 0

  // Hooks run unconditionally (before any early return). Both guard on possibly
  // gated/empty data so they're safe in the not-ready branch too.
  const efficiencyOption = useMemo(() => {
    const buckets = data?.efficiencyBuckets || []
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { ...categoryAxis, data: buckets.map((b) => b.bucket) },
      yAxis: countAxis,
      series: [{
        type: 'bar',
        data: buckets.map((b) => b.count),
        itemStyle: { color: CHART_COLORS.gold },
        barWidth: '55%',
        label: { show: true, position: 'top', color: CHART_COLORS.textBright },
      }],
    }
  }, [data?.efficiencyBuckets])

  const avpOption = useMemo(() => {
    const pts = data?.actualVsPotential || []
    return {
      ...baseChart,
      grid: { ...baseChart.grid, top: 34 },
      tooltip: {
        ...baseChart.tooltip,
        trigger: 'axis',
        valueFormatter: (v) => (v == null ? '—' : `${Number(v).toFixed(1)}R`),
      },
      legend: { data: ['Actual', 'Potential'], textStyle: { color: CHART_COLORS.text }, top: 0 },
      xAxis: {
        ...categoryAxis,
        boundaryGap: false,
        data: pts.map((p) => `#${p.i}`),
        name: 'Trade #',
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: CHART_COLORS.text, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: 'Cumulative R',
        nameTextStyle: { color: CHART_COLORS.text, fontSize: 11 },
        axisLine: { lineStyle: { color: CHART_COLORS.border } },
        splitLine: { lineStyle: { color: CHART_COLORS.border, type: 'dashed' } },
        axisLabel: { color: CHART_COLORS.text, formatter: (v) => `${v}R` },
      },
      series: [
        {
          name: 'Potential',
          type: 'line',
          data: pts.map((p) => p.potential),
          symbol: 'none',
          smooth: true,
          lineStyle: { color: CHART_COLORS.gain, type: 'dashed', width: 2 },
          itemStyle: { color: CHART_COLORS.gain },
        },
        {
          name: 'Actual',
          type: 'line',
          data: pts.map((p) => p.actual),
          symbol: 'none',
          smooth: true,
          lineStyle: { color: CHART_COLORS.gold, width: 2 },
          itemStyle: { color: CHART_COLORS.gold },
          areaStyle: { color: 'rgba(201, 168, 76, 0.12)' },
        },
      ],
    }
  }, [data?.actualVsPotential])

  const aggregatesReady = Boolean(data?.coverageReady) && computed >= MIN_COMPUTED

  // ── Honest gate: no aggregates yet → designed check-back state, no chart ──
  if (!aggregatesReady) {
    return (
      <div className={styles.section}>
        <CheckBackState
          eligible={eligible}
          computed={computed}
          coverageReady={Boolean(data?.coverageReady)}
        />
      </div>
    )
  }

  const {
    avgExitEfficiency,
    efficiencySampleSize,
    efficiencyExcludedNoFavorable,
    missedRTotal,
    avgMissedR,
    actualVsPotential,
  } = data

  const hasCurve = Array.isArray(actualVsPotential) && actualVsPotential.length > 0

  return (
    <div className={styles.section}>
      {/* Module 1 — exit efficiency */}
      <div className={styles.module}>
        <div className={styles.moduleHead}>
          <h4 className={styles.moduleTitle}>How much of the move did you capture?</h4>
          <span className={styles.moduleSub}>Exit efficiency</span>
        </div>
        <div className={styles.headlineRow}>
          <div className={styles.headlineBlock}>
            <span className={styles.headline}>{percent(avgExitEfficiency, { isRatio: true })}</span>
            <span className={styles.headlineLabel}>
              average of the favorable move captured
              {efficiencySampleSize != null && ` · ${efficiencySampleSize} trade${efficiencySampleSize === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>Exit efficiency distribution</div>
          <ReactECharts option={efficiencyOption} style={{ height: 220 }} />
        </div>
        {efficiencyExcludedNoFavorable > 0 && (
          <p className={styles.note}>
            {efficiencyExcludedNoFavorable} trade{efficiencyExcludedNoFavorable === 1 ? '' : 's'} had
            {' '}no favorable excursion (excluded from the efficiency average).
          </p>
        )}
      </div>

      {/* Module 2 — missed R + actual-vs-potential */}
      <div className={styles.module}>
        <div className={styles.moduleHead}>
          <h4 className={styles.moduleTitle}>What did your exits leave on the table?</h4>
          <span className={styles.moduleSub}>Missed R</span>
        </div>
        <div className={styles.headlineRow}>
          <div className={styles.headlineBlock}>
            <span className={styles.headline}>{rMultiple(missedRTotal)}</span>
            <span className={styles.headlineLabel}>total left on the table</span>
          </div>
          <div className={styles.headlineBlock}>
            <span className={styles.headlineSecondary}>{rMultiple(avgMissedR)}</span>
            <span className={styles.headlineLabel}>average per trade</span>
          </div>
        </div>
        {hasCurve ? (
          <div className={styles.chartCard}>
            <div className={styles.chartTitle}>Actual vs potential (cumulative R)</div>
            <ReactECharts option={avpOption} style={{ height: 260 }} />
          </div>
        ) : (
          <p className={styles.note}>
            Need at least 2 analyzed trades with R-multiples to chart actual vs potential.
          </p>
        )}
      </div>

      {/* Methodology footer — coverage + exclusions visible, never silent */}
      <p className={styles.footer}>
        Bar-approximate excursions from intraday bars.
        {optionsExcluded > 0 &&
          ` ${optionsExcluded} option trade${optionsExcluded === 1 ? '' : 's'} excluded from these figures.`}
      </p>
    </div>
  )
}

// ── Check-back / empty states ────────────────────────────────────────────────

function CheckBackState({ eligible, computed, coverageReady }) {
  if (eligible === 0) {
    return (
      <div className={styles.checkBack}>
        <p className={styles.checkBackTitle}>No closed equity trades yet.</p>
        <p className={styles.checkBackText}>
          Close an equity trade and exit quality will be computed from its intraday history.
        </p>
      </div>
    )
  }

  const pct = eligible > 0 ? Math.min(100, Math.round((computed / eligible) * 100)) : 0

  return (
    <div className={styles.checkBack}>
      <p className={styles.checkBackTitle}>Exit quality is being computed</p>
      <p className={styles.checkBackText}>
        {coverageReady
          ? `Exit quality needs at least ${MIN_COMPUTED} analyzed trades. So far ${computed} of ${eligible} eligible trades are analyzed — check back after tonight's analysis (~3 AM ET).`
          : `Exit quality is computed from your intraday trade history. So far ${computed} of ${eligible} eligible trades are analyzed — check back after tonight's analysis (~3 AM ET).`}
      </p>
      <div className={styles.coverageMeter} aria-hidden="true">
        <div className={styles.coverageFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.coverageLabel}>{computed} of {eligible} analyzed</span>
    </div>
  )
}
