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
 *   - Edge → `EdgeScoreCard` — the branded dark/gold shareable Edge Score card
 *     (score + formula + 4 confidence-shaded components + Copy-link) read from
 *     `analytics.edgeScore` (Task B5).
 *   - Playbook → `PlaybookSection` — the real per-setup cards with
 *     PF/expectancy/exit-efficiency + scope drill-through (Task B4). It
 *     self-fetches the dedicated `/playbook` aggregate via `useJ2Playbook`.
 *   - Psychology / Regime → designed "coming soon" cards, NEVER a broken/empty
 *     chart.
 *
 * NO emoji — every glyph is a `<UIcon>`.
 */

import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import RiskExitsSection from '../analytics/RiskExitsSection'
import PlaybookSection from './PlaybookSection'
import EdgeScoreCard from './EdgeScoreCard'
import PsychologySection from './PsychologySection'
import RegimeSection from './RegimeSection'
import VerdictScorecard from './VerdictScorecard'
import useScope from '../../hooks/useScope'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { useFeatureFlag } from '../../featureFlags'
import styles from './InsightsHub.module.css'

// The six hub sections. `key` is the `?ins=` value; order = the sub-nav order.
const SECTIONS = [
  { key: 'playbook', label: 'Playbook' },
  { key: 'exit', label: 'Exit Quality' },
  { key: 'edge', label: 'Edge' },
  { key: 'psychology', label: 'Psychology' },
  { key: 'regime', label: 'Regime' },
  { key: 'coach', label: 'Coach' },
]
const SECTION_KEYS = SECTIONS.map((s) => s.key)
const DEFAULT_SECTION = 'playbook'

export default function InsightsHub({ analytics }) {
  const [searchParams, setSearchParams] = useSearchParams()
  // P5 Task A7: the Regime section is real when the `regime` feature flag is on
  // (default ON); off → the existing designed "coming soon" placeholder. The
  // instant per-browser kill-switch is window.__uctJ2Feature('regime', false).
  const regimeOn = useFeatureFlag('regime')
  // P5 Task A9: same gating shape for the Psychology section (default ON); off →
  // ComingSoon. Kill-switch: window.__uctJ2Feature('psychology', false).
  const psychologyOn = useFeatureFlag('psychology')
  // P6-3: same gating shape for the Coach (Verdict Scorecard) section (default
  // ON); off → ComingSoon. Kill-switch: window.__uctJ2Feature('verdictScore', false).
  const verdictScoreOn = useFeatureFlag('verdictScore')
  // The Coach section is Scope-aware + per-account like the Playbook — thread
  // the live account + snake_case scope params to the section (its hook builds
  // the `/accounts/{id}/verdict-scorecard?…` request from these).
  const { apiParams } = useScope()
  const { accountId } = useJ2SelectedAccount()

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
        {active === 'playbook' && <PlaybookSection />}
        {active === 'exit' && <RiskExitsSection data={analytics?.exitQuality} />}
        {active === 'edge' && <EdgeScoreCard edge={analytics?.edgeScore} />}
        {active === 'psychology' &&
          (psychologyOn ? (
            <PsychologySection analytics={analytics} />
          ) : (
            <ComingSoon
              icon="chat"
              title="Psychology"
              text="Coming with the psychology release — emotion outcomes, tilt patterns, and discipline trends over time."
            />
          ))}
        {active === 'regime' &&
          (regimeOn ? (
            <RegimeSection analytics={analytics} />
          ) : (
            <ComingSoon
              icon="compass"
              title="Regime"
              text="Coming with the regime release — how your edge holds up across bull, chop, and bear market conditions."
            />
          ))}
        {active === 'coach' &&
          (verdictScoreOn ? (
            <VerdictScorecard accountId={accountId} apiParams={apiParams} />
          ) : (
            <ComingSoon
              icon="scale"
              title="Coach"
              text="Coming with the coach release — how Compass's GO, HOLD, and SKIP verdicts actually played out in your trades."
            />
          ))}
      </div>
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
