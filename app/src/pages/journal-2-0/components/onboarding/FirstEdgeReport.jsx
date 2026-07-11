/**
 * FirstEdgeReport — "Your First Edge Report" (P0 First-Insight onboarding).
 *
 * The new-user funnel ends at a GENERATED INSIGHT, not an empty dashboard. Once
 * a user has ≥10 closed trades (via CSV import, broker first-sync, or manual
 * logging), Today leads with this single celebratory-but-sober screen — a
 * before/after story about how they trade, composed ENTIRELY from the EXISTING
 * `/api/j2/analytics` payload (zero new analytics):
 *
 *   1. Best setup   — the highest-expectancy setup from `attribution.bySetup`
 *                     (expectancy $ = totalPnl / tradeCount), ConfidenceStat-gated.
 *   2. Edge Score   — `edgeScore.score` (honest dim "—" until trades carry an R).
 *   3. Biggest leak — the top `psychology.costOfMistakes` mistake in $ (already
 *                     sorted most-negative first); else the largest drawdown from
 *                     `risk.drawdown`. Omitted entirely when neither exists.
 *   4. Win rate & expectancy — overall win rate (`edgeScore.components`) + R
 *                     expectancy (`risk.expectancyR`), each ConfidenceStat-gated.
 *
 * Every stat is coverage-gated (n<10 grays via <ConfidenceStat>) and a stat with
 * no data is simply OMITTED — never faked. One deterministic closing sentence
 * ties the best setup to the biggest leak. A subtle honesty line names the sample
 * ("Generated from your N closed trades"). CTA → the Insights hub; a "Continue to
 * Today" dismiss.
 *
 * Presentational + one fetch: it self-fetches analytics via `useJ2Analytics`
 * (SWR — no refreshInterval, so NOT a recurring poller) scoped to the account it
 * is handed. The whole surface is gated on the `firstInsight` feature flag (the
 * instant per-browser kill-switch is window.__uctJ2Feature('firstInsight', false)).
 *
 * NO emoji — every glyph is a <UIcon>.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import useJ2Analytics from '../../hooks/useJ2Analytics'
import { useFeatureFlag } from '../../featureFlags'
import { money, moneySigned, rMultiple } from '../../../../lib/journal-2-0'
import styles from './FirstEdgeReport.module.css'

const CONF_MIN = 10
const ALL_ACCOUNTS = '_all_'

// ── formatters (match the Insights sections so units read the same) ──────────
const fmtExpectancy = (v) => moneySigned(v)
const fmtPct = (v) => `${Math.round(v * 100)}%`
const fmtR = (v) => rMultiple(v)

// ── stat composition (pure — read straight off the analytics payload) ────────

/** Highest dollar-expectancy setup (expectancy = totalPnl / tradeCount). */
function pickBestSetup(data) {
  const setups = data?.attribution?.bySetup
  if (!Array.isArray(setups) || setups.length === 0) return null
  let best = null
  for (const s of setups) {
    const n = s?.tradeCount || 0
    if (n <= 0) continue
    const expectancy = s.totalPnl / n
    if (best == null || expectancy > best.expectancy) {
      best = { setup: s.setup, expectancy, n }
    }
  }
  return best
}

/**
 * The biggest leak: the top mistake in $ (byMistake is sorted most-negative
 * first) when tags exist, else the largest peak-to-trough drawdown from risk.
 * Returns null when neither is available (the stat is then omitted — never faked).
 */
function pickLeak(data) {
  const byMistake = data?.psychology?.costOfMistakes?.byMistake
  if (Array.isArray(byMistake) && byMistake.length > 0) {
    const worst = byMistake[0]
    if (worst && (worst.total ?? 0) < 0) {
      return {
        kind: 'mistake',
        label: worst.mistake,
        amount: worst.total,
        count: worst.count,
      }
    }
  }
  const risk = data?.risk
  const dd = risk?.drawdown
  if (risk?.coverageReady && dd && dd.maxDrawdownDollar > 0) {
    return { kind: 'drawdown', amount: -dd.maxDrawdownDollar }
  }
  return null
}

/** One deterministic sentence tying the edge to the leak (never an LLM call). */
function closingSentence(bestSetup, leak) {
  const leakClause = leak
    ? leak.kind === 'mistake'
      ? `your biggest leak is ${leak.label}, costing ${money(Math.abs(leak.amount))}`
      : `your biggest leak is a ${money(Math.abs(leak.amount))} drawdown`
    : null

  if (bestSetup && leakClause) {
    return `Your ${bestSetup.setup} trades carry your edge — ${leakClause}. Compass will watch both.`
  }
  if (bestSetup) {
    return `Your ${bestSetup.setup} trades carry your edge. Compass will keep watch as your sample grows.`
  }
  if (leakClause) {
    return `${leakClause.charAt(0).toUpperCase()}${leakClause.slice(1)}. Compass will watch it with you.`
  }
  return `You’ve logged a real sample now — Compass will watch your edge and your leaks with you.`
}

export default function FirstEdgeReport({ accountId, onDismiss }) {
  const flagOn = useFeatureFlag('firstInsight')
  const navigate = useNavigate()

  // Scope the report to the handed account (All-Accounts → whole-book analytics).
  const apiParams = useMemo(
    () =>
      accountId && accountId !== ALL_ACCOUNTS ? { account_id: accountId } : undefined,
    [accountId],
  )
  const { data, isLoading } = useJ2Analytics(apiParams)

  // Gate everything on the flag — the trigger already gates, but a direct render
  // must respect the instant kill-switch too. Hooks run first (rules of hooks).
  if (!flagOn) return null

  const count = data?.tradeCount ?? 0
  const bestSetup = pickBestSetup(data)
  const edge = data?.edgeScore
  const leak = pickLeak(data)
  const winRate = edge?.components?.winRate ?? null
  const winRateN = edge?.components?.tradeCount ?? count
  const risk = data?.risk
  const expectancyR = risk?.coverageReady ? (risk?.expectancyR ?? null) : null
  const expectancyN = risk?.decisiveCount ?? 0

  const onExplore = () => {
    onDismiss?.()
    navigate('/journal/insights')
  }
  const onContinue = () => {
    onDismiss?.()
  }

  return (
    <section
      className={styles.report}
      data-testid="first-edge-report"
      aria-label="Your First Edge Report"
    >
      <header className={styles.hero}>
        <span className={styles.brandMark} aria-hidden="true">
          <UIcon name="compass" size={20} />
        </span>
        <span className={styles.eyebrow}>UCT Intelligence</span>
        <h2 className={styles.title}>Your First Edge Report</h2>
        <p className={styles.lede}>
          Here’s what your trades already say about how you trade.
        </p>
      </header>

      {isLoading && !data ? (
        <div className={styles.loading} role="status">
          Reading your trades…
        </div>
      ) : (
        <>
          <div className={styles.stats}>
            {bestSetup && (
              <div className={styles.stat} data-testid="stat-best-setup">
                <span className={styles.statLabel}>Your best setup</span>
                <span className={styles.statHero}>{bestSetup.setup}</span>
                <ConfidenceStat
                  value={bestSetup.expectancy}
                  n={bestSetup.n}
                  min={CONF_MIN}
                  format={fmtExpectancy}
                  label="Expectancy / trade"
                />
              </div>
            )}

            <div className={styles.stat} data-testid="stat-edge-score">
              <span className={styles.statLabel}>Edge Score</span>
              {edge?.score != null ? (
                <span className={styles.statHero}>{edge.score.toFixed(3)}</span>
              ) : (
                <>
                  <span className={styles.statHeroDim} aria-label="Edge Score not yet available">
                    —
                  </span>
                  <span className={styles.statNote}>
                    Log stops so trades carry an R — the score appears once your
                    sample is honest.
                  </span>
                </>
              )}
            </div>

            {leak && (
              <div className={styles.stat} data-testid="stat-leak">
                <span className={styles.statLabel}>Your biggest leak</span>
                <span className={styles.statHero}>
                  {leak.kind === 'mistake' ? leak.label : 'Drawdown'}
                </span>
                <span className={`${styles.statAmount} ${styles.neg}`}>
                  {money(-Math.abs(leak.amount))}
                </span>
                <span className={styles.statSub}>
                  {leak.kind === 'mistake'
                    ? `${leak.count} trade${leak.count === 1 ? '' : 's'}`
                    : 'peak to trough'}
                </span>
              </div>
            )}

            <div className={styles.stat} data-testid="stat-winrate">
              <span className={styles.statLabel}>Win rate &amp; expectancy</span>
              <div className={styles.dualStat}>
                <ConfidenceStat
                  value={winRate}
                  n={winRateN}
                  min={CONF_MIN}
                  format={fmtPct}
                  label="Win rate"
                />
                <ConfidenceStat
                  value={expectancyR}
                  n={expectancyN}
                  min={CONF_MIN}
                  format={fmtR}
                  label="Expectancy (R)"
                />
              </div>
            </div>
          </div>

          <p className={styles.closing}>{closingSentence(bestSetup, leak)}</p>

          <p className={styles.honesty}>
            Generated from your {count} closed trade{count === 1 ? '' : 's'}.
          </p>
        </>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.ctaPrimary} onClick={onExplore}>
          Explore your Insights
          <UIcon
            name="chevronRight"
            size={14}
            gold={false}
            style={{ verticalAlign: '-2px', marginLeft: 4 }}
          />
        </button>
        <button type="button" className={styles.ctaGhost} onClick={onContinue}>
          Continue to Today
        </button>
      </div>
    </section>
  )
}
