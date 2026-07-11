/**
 * InsightsHub — the organized entry point for Journal 2.0 Analytics (P3 §7).
 *
 * A horizontal sub-nav of five insight sections — Playbook · Exit Quality ·
 * Edge · Psychology · Regime — that sits ABOVE the classic accordion in the
 * Analytics tab. Only ONE section mounts at a time (the inactive ones are not
 * rendered at all), so the heavy ECharts inside a hidden section never mount —
 * the same "unmount-when-hidden" benefit `CollapsibleSection` gives the classic
 * accordion, applied to the hub.
 *
 * The active section persists in the URL as `?ins=<key>` so a hub view is
 * shareable + survives a refresh. Real routes arrive in P4; a query param now.
 * The write clones the existing params and sets ONLY `ins`, so `?j2tab=` (the
 * permanent deep-link contract) and every `sc_*` scope param ride through
 * untouched — mirroring how `useScope`/`ScopeBar` preserve non-scope params.
 *
 * P3 status:
 *   - Exit Quality → the existing `RiskExitsSection`, reused UNCHANGED (already
 *     headerless + coverage-gated).
 *   - Edge → a lightweight score + 4-component summary read from
 *     `analytics.edgeScore` (the shareable Edge card is Task B5).
 *   - Playbook → a minimal placeholder + per-setup list (the real cards with
 *     PF/expectancy/exit-efficiency + scope drill-through are Task B4).
 *   - Psychology / Regime → designed "coming soon" cards, NEVER a broken/empty
 *     chart.
 *
 * NO emoji — every glyph is a `<UIcon>`.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import RiskExitsSection from '../analytics/RiskExitsSection'
import { fmtSignedDollar } from '../../lib/calendar'
import styles from './InsightsHub.module.css'

// The five hub sections. `key` is the `?ins=` value; order = the sub-nav order.
const SECTIONS = [
  { key: 'playbook', label: 'Playbook' },
  { key: 'exit', label: 'Exit Quality' },
  { key: 'edge', label: 'Edge' },
  { key: 'psychology', label: 'Psychology' },
  { key: 'regime', label: 'Regime' },
]
const SECTION_KEYS = SECTIONS.map((s) => s.key)
const DEFAULT_SECTION = 'playbook'

export default function InsightsHub({ analytics }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const raw = searchParams.get('ins')
  const active = SECTION_KEYS.includes(raw) ? raw : DEFAULT_SECTION

  // Clone all params, set ONLY `ins` — j2tab + sc_* ride through untouched.
  // `{replace:true}` so sub-nav clicks don't spam browser history.
  const select = useCallback(
    (key) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('ins', key)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return (
    <div className={styles.hub}>
      <nav className={styles.subnav} aria-label="Insights sections">
        {SECTIONS.map((s) => {
          const on = s.key === active
          return (
            <button
              key={s.key}
              type="button"
              className={`${styles.tab} ${on ? styles.tabActive : ''}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => select(s.key)}
            >
              {s.label}
            </button>
          )
        })}
      </nav>

      <div className={styles.body}>
        {active === 'playbook' && <PlaybookPlaceholder analytics={analytics} />}
        {active === 'exit' && <RiskExitsSection data={analytics?.exitQuality} />}
        {active === 'edge' && <EdgeSection edge={analytics?.edgeScore} />}
        {active === 'psychology' && (
          <ComingSoon
            icon="chat"
            title="Psychology"
            text="Coming with the psychology release — emotion outcomes, tilt patterns, and discipline trends over time."
          />
        )}
        {active === 'regime' && (
          <ComingSoon
            icon="compass"
            title="Regime"
            text="Coming with the regime release — how your edge holds up across bull, chop, and bear market conditions."
          />
        )}
      </div>
    </div>
  )
}

// ── Edge summary (lightweight — the shareable card is Task B5) ────────────────

function EdgeSection({ edge }) {
  const score = edge?.score
  const c = edge?.components || {}
  const hasComponents = c.winRate != null

  return (
    <section className={styles.edgeCard}>
      <div className={styles.edgeMain}>
        {score == null ? (
          <>
            <span className={styles.edgeScoreDim}>—</span>
            <span className={styles.edgeNeed}>
              Need 10+ trades with R-multiples to compute an Edge Score.
            </span>
          </>
        ) : (
          <>
            <span className={styles.edgeScore}>{score.toFixed(3)}</span>
            <span className={styles.edgeFormula}>= Win × PF × R-consistency</span>
          </>
        )}
      </div>

      {hasComponents && (
        <div className={styles.edgeComps}>
          <EdgeComp label="Win Rate" value={`${(c.winRate * 100).toFixed(1)}%`} />
          <EdgeComp
            label="Profit Factor"
            value={c.profitFactor === 5 ? '5.0+' : Number(c.profitFactor).toFixed(2)}
          />
          <EdgeComp
            label="R Consistency"
            value={c.rConsistency != null ? `${(c.rConsistency * 100).toFixed(0)}%` : '—'}
          />
          <EdgeComp label="Trades" value={c.tradeCount} />
        </div>
      )}
    </section>
  )
}

function EdgeComp({ label, value }) {
  return (
    <div className={styles.edgeComp}>
      <span className={styles.edgeCompLabel}>{label}</span>
      <span className={styles.edgeCompValue}>{value}</span>
    </div>
  )
}

// ── Playbook placeholder (real cards + drill-through arrive in Task B4) ───────

function PlaybookPlaceholder({ analytics }) {
  const bySetup = useMemo(
    () => analytics?.attribution?.bySetup ?? [],
    [analytics],
  )

  return (
    <div className={styles.playbook}>
      <div className={styles.placeholderHead}>
        <h4 className={styles.placeholderTitle}>Setup performance</h4>
        <p className={styles.placeholderSub}>
          Full Playbook cards — profit factor, expectancy, exit efficiency, and
          click-to-scope drill-through — arrive with the next release.
        </p>
      </div>
      {bySetup.length > 0 ? (
        <ul className={styles.setupList}>
          {bySetup.map((s) => (
            <li key={s.setup} className={styles.setupRow}>
              <span className={styles.setupName}>{s.setup}</span>
              <span className={styles.setupMeta}>
                {s.tradeCount} trade{s.tradeCount === 1 ? '' : 's'}
              </span>
              <span
                className={`${styles.setupPnl} ${s.totalPnl >= 0 ? styles.pos : styles.neg}`}
              >
                {fmtSignedDollar(s.totalPnl)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>
          Tag your trades with a setup to see per-setup performance here.
        </p>
      )}
    </div>
  )
}

// ── Designed "coming soon" placeholder (NEVER a broken/empty chart) ──────────

function ComingSoon({ icon, title, text }) {
  return (
    <div className={styles.comingSoon}>
      <UIcon name={icon} size={26} className={styles.comingSoonGlyph} />
      <h4 className={styles.comingSoonTitle}>{title}</h4>
      <p className={styles.comingSoonText}>{text}</p>
    </div>
  )
}
