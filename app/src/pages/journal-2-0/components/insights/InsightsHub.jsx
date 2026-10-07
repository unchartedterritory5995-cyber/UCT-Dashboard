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

import { useCallback, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import RiskExitsSection from '../analytics/RiskExitsSection'
import PlaybookSection from './PlaybookSection'
import EdgeScoreCard from './EdgeScoreCard'
import PsychologySection from './PsychologySection'
import RegimeSection from './RegimeSection'
import VerdictScorecard from './VerdictScorecard'
import DisciplineRecord from './DisciplineRecord'
import { planGradingEnabled } from '../../hooks/usePlanGrade'
import useScope from '../../hooks/useScope'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { useFeatureFlag } from '../../featureFlags'
import {
  reviewDraftsEnabled, draftDailyReview, draftWeeklyReview, draftMonthlyReview,
  todayDayIso, mondayOfIso, thisMonthIso,
} from '../../lib/reviewDrafts'
import { compassScope } from '../../hooks/compassScope'
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
// Wave 13 lane 13A: the Discipline section exists only while notebook_plan_grading_enabled is
// latched on (dark by default), so the six sections above are unchanged with the flag off.
const DISCIPLINE_SECTION = { key: 'discipline', label: 'Discipline' }
// Wave 13 lane 13F: the Reviews section (one click drafts a daily/weekly/monthly review note)
// exists only while notebook_review_drafts_enabled is latched on (dark by default).
const REVIEWS_SECTION = { key: 'reviews', label: 'Reviews' }
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

  const sections = [
    ...SECTIONS,
    ...(planGradingEnabled() ? [DISCIPLINE_SECTION] : []),
    ...(reviewDraftsEnabled() ? [REVIEWS_SECTION] : []),
  ]
  const raw = searchParams.get('ins')
  const active = sections.some((s) => s.key === raw) ? raw : DEFAULT_SECTION

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
        {sections.map((s) => {
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
        {active === 'exit' && (
          <RiskExitsSection data={analytics?.exitQuality} risk={analytics?.risk} />
        )}
        {active === 'edge' && <EdgeScoreCard edge={analytics?.edgeScore} />}
        {active === 'psychology' &&
          (psychologyOn ? (
            <PsychologySection analytics={analytics} accountId={accountId} />
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
        {active === 'discipline' && <DisciplineRecord accountId={accountId} />}
        {active === 'reviews' && <ReviewDraftsSection accountId={accountId} />}
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

// ── Reviews that write themselves (wave 13 lane 13F) — the "Home" door ──────────
//
// One click per period. The data is the backend's (api/services/journal_two/
// review_drafts.py + leak_finder.py); this only calls the lib and navigates to
// whatever note it landed — daily appends to the member's own daily note, weekly
// and monthly create a new tagged note through the Notebook's one create door.

function ReviewDraftsSection({ accountId }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null) // 'daily' | 'weekly' | 'monthly' | null
  const [error, setError] = useState(null)

  const run = useCallback(async (period, fn) => {
    if (busy) return
    setBusy(period)
    setError(null)
    try {
      const { note } = await fn()
      navigate(`/journal/notebook?note=${encodeURIComponent(note.id)}`)
    } catch (e) {
      // `memberMessage` is a sentence the door wrote for the member (the note is still syncing).
      setError(e?.memberMessage || `Could not draft the ${period} review — try again.`)
    } finally {
      setBusy(null)
    }
  }, [busy, navigate])

  const scope = compassScope(accountId)

  return (
    <div className={styles.comingSoon} data-testid="review-drafts-section">
      <UIcon name="book" size={26} className={styles.comingSoonGlyph} />
      <h4 className={styles.comingSoonTitle}>Reviews that write themselves</h4>
      <p className={styles.comingSoonText}>
        One click drafts the trades and P&amp;L, the discipline record, setup changes,
        links to plans and prior reviews, the best and worst trade, and any leaks —
        from your own numbers, never generated.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="touchTarget"
          onClick={() => run('daily', () => draftDailyReview({ accountId: scope, day: todayDayIso() }))}
          disabled={Boolean(busy)}
        >
          {busy === 'daily' ? 'Drafting…' : 'Draft today’s recap'}
        </button>
        <button
          type="button"
          className="touchTarget"
          onClick={() => run('weekly', () => draftWeeklyReview({ accountId: scope, weekStart: mondayOfIso() }))}
          disabled={Boolean(busy)}
        >
          {busy === 'weekly' ? 'Drafting…' : 'Draft this week’s review'}
        </button>
        <button
          type="button"
          className="touchTarget"
          onClick={() => run('monthly', () => draftMonthlyReview({ accountId: scope, month: thisMonthIso() }))}
          disabled={Boolean(busy)}
        >
          {busy === 'monthly' ? 'Drafting…' : 'Draft this month’s review'}
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--loss, #ef4444)', fontSize: 12, marginTop: 10 }}>{error}</p>
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
