/**
 * PlaybookSection — the Insights → Playbook section (P3 Task B4).
 *
 * One CARD per setup (from the B1 `/accounts/{id}/playbook` aggregate, fetched
 * Scope-aware via `useJ2Playbook`). Each card surfaces win-rate / profit-factor
 * / expectancy ($) / avg-R / exit-efficiency through `<ConfidenceStat>` so any
 * stat computed on n<10 trades renders grayed with the "n=X, need 10"
 * affordance (Global Constraint: confidence threshold = 10 everywhere), plus a
 * small last-five W/L/B streak.
 *
 * ── Drill-through (the P3 headline) ──────────────────────────────────────────
 * The whole card is a native <button> (keyboard-operable for free). Clicking it
 * sets the global Scope `setups` facet to THIS setup and lands on the Trade
 * Journal, which then shows that setup scoped:
 *   1. `setFacet('setups', [name])` — the canonical scope write (preserves every
 *      other URL param).
 *   2. `navigate(target)` where `target` = the CURRENT querystring + `sc_setup`
 *      + `j2tab=journal`. We build the complete target ourselves so the tab
 *      switch can't clobber the setup facet: setFacet and this navigate are two
 *      `{replace}` navigations in the same tick, and the later, COMPLETE one
 *      wins. `sc_setup` is member-encoded exactly like the A6 scope codec
 *      (`encodeURIComponent` per member) so `useScope` reads it back cleanly on
 *      the journal tab.
 *
 * NO emoji — the drill affordance glyph is a `<UIcon>`.
 */

import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import useScope from '../../hooks/useScope'
import useJ2Playbook from '../../hooks/useJ2Playbook'
import { SCOPE_VERSION } from '../../../../lib/journal-2-0/scope'
import styles from './PlaybookSection.module.css'

const CONF_MIN = 10

// ── Exit-efficiency confidence gate — MIRRORS the P2 Exit Quality tab ─────────
// RiskExitsSection.jsx gates exit quality on `coverageReady && computed >=
// MIN_COMPUTED`, where MIN_COMPUTED = 10 (the backend's
// `_EXIT_QUALITY_MIN_COMPUTED`, replicated there as a module const) and
// `coverageReady` means the excursion coverage ratio computed/eligible >= 0.9.
// playbook_stats gives us `exitEffCoverage:{eligible, computed}` but no
// per-setup `coverageReady` boolean, so we derive the same gate here. Without
// this, the SAME setup+scope could show a confident "62%" on the Playbook card
// while Exit Quality withholds it — the cross-surface contradiction this fixes.
// (Neither constant is exported by RiskExitsSection, so they're replicated.)
const EXIT_EFF_MIN_COMPUTED = 10
const EXIT_EFF_MIN_COVERAGE = 0.9

function exitEffConfident(coverage) {
  const eligible = coverage?.eligible ?? 0
  const computed = coverage?.computed ?? 0
  if (computed < EXIT_EFF_MIN_COMPUTED) return false
  if (eligible === 0) return false
  return computed / eligible >= EXIT_EFF_MIN_COVERAGE
}

// ── stat formatters ──────────────────────────────────────────────────────────
const fmtPct = (v) => `${(v * 100).toFixed(0)}%`
const fmtPF = (v) => (v >= 5 ? '5.0+' : Number(v).toFixed(2))
const fmtDollar = (v) => {
  if (v === 0) return '$0'
  const sign = v > 0 ? '+' : '-'
  return `${sign}$${Math.abs(v).toFixed(2)}`
}
const fmtR = (v) => {
  if (v === 0) return '0R'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}R`
}

const PIP_CLASS = { W: styles.pipW, L: styles.pipL, B: styles.pipB }

export default function PlaybookSection() {
  const { apiParams, setFacet } = useScope()
  const { stats, isLoading, error, allAccounts } = useJ2Playbook(apiParams)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const openSetup = useCallback(
    (name) => {
      // 1. Canonical scope write (also preserves the rest of the querystring).
      setFacet('setups', [name])
      // 2. Land on the Trade Journal, scoped to this setup — build the COMPLETE
      //    target so the tab switch can't drop the facet (later nav wins).
      const next = new URLSearchParams(searchParams)
      next.set('sc_setup', encodeURIComponent(name)) // member-encode (A6 codec)
      next.set('sc_v', String(SCOPE_VERSION))
      next.set('j2tab', 'journal')
      navigate(`?${next.toString()}`, { replace: true })
    },
    [setFacet, navigate, searchParams],
  )

  // ── Non-card states — never a bare blank ──────────────────────────────────
  if (allAccounts) {
    return (
      <Note
        icon="dollar"
        text="Select a single account to see per-setup playbook stats. The Playbook is built per account so its profit factor, expectancy, and exit efficiency stay honest."
      />
    )
  }
  if (error) {
    return (
      <Note
        icon="warning"
        text="Couldn't load your playbook right now. Refresh to try again."
      />
    )
  }
  if (isLoading && stats.length === 0) {
    return <Note icon="chart" text="Loading your playbook…" />
  }
  if (stats.length === 0) {
    return (
      <Note
        icon="tag"
        text="No setup performance yet — tag your trades' setups to see your playbook: win rate, profit factor, expectancy, and exit efficiency per setup."
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h4 className={styles.title}>Setup performance</h4>
        <p className={styles.sub}>
          Every setup you've tagged, ranked by total P&amp;L. Click a card to see
          those trades in the journal. Stats on fewer than {CONF_MIN} trades are
          grayed — they're estimates, not an edge yet.
        </p>
      </div>

      <div className={styles.grid}>
        {stats.map((s) => (
          <SetupCard key={s.setup} s={s} onOpen={openSetup} />
        ))}
      </div>
    </div>
  )
}

function SetupCard({ s, onOpen }) {
  const n = s.tradeCount || 0
  const computed = s.exitEffCoverage?.computed ?? 0
  // Only surface a confident exit-efficiency number when the excursion coverage
  // clears the SAME gate the P2 Exit Quality tab uses. Below it, withhold the
  // number (value=null) so ConfidenceStat renders the honest dim "—" state.
  const exitEffOk = exitEffConfident(s.exitEffCoverage)
  const lastFive = Array.isArray(s.lastFive) ? s.lastFive : []

  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onOpen(s.setup)}
      aria-label={`View ${n} ${s.setup} trade${n === 1 ? '' : 's'} in the journal`}
    >
      <div className={styles.cardTop}>
        <span className={styles.setupName}>{s.setup}</span>
        <span className={styles.count}>
          {n} trade{n === 1 ? '' : 's'}
        </span>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCell}>
          <ConfidenceStat value={s.winRate} n={n} min={CONF_MIN} format={fmtPct} label="Win Rate" />
        </div>
        <div className={styles.statCell}>
          <ConfidenceStat value={s.profitFactor} n={n} min={CONF_MIN} format={fmtPF} label="Profit Factor" />
        </div>
        <div className={styles.statCell}>
          <ConfidenceStat value={s.expectancy} n={n} min={CONF_MIN} format={fmtDollar} label="Expectancy" />
        </div>
        <div className={styles.statCell}>
          <ConfidenceStat value={s.avgR} n={n} min={CONF_MIN} format={fmtR} label="Avg R" />
        </div>
        <div className={styles.statCell}>
          {/* Exit efficiency confidence keys off computed excursion COVERAGE,
              not tradeCount — a well-traded setup with thin excursion data is
              still a thin exit-efficiency estimate. The gate matches the P2 Exit
              Quality tab (computed >= 10 AND coverage ratio >= 0.9); below it the
              number is withheld (value=null → honest dim "—") so the two surfaces
              can never disagree on the same setup+scope. */}
          <ConfidenceStat
            value={exitEffOk ? s.exitEfficiency : null}
            n={computed}
            min={CONF_MIN}
            format={fmtPct}
            label="Exit Eff."
          />
        </div>
      </div>

      {lastFive.length > 0 && (
        <div className={styles.lastFive}>
          <span className={styles.lastFiveLabel}>Last {lastFive.length}</span>
          <span className={styles.streak}>
            {lastFive.map((r, i) => (
              <span key={i} className={`${styles.pip} ${PIP_CLASS[r] || styles.pipB}`}>
                {r}
              </span>
            ))}
          </span>
        </div>
      )}

      <span className={styles.viewRow}>
        View {n} trade{n === 1 ? '' : 's'}
        <span className={styles.viewIcon} aria-hidden="true">
          <UIcon name="chevronRight" size={13} />
        </span>
      </span>
    </button>
  )
}

function Note({ icon, text }) {
  return (
    <div className={styles.note}>
      <UIcon name={icon} size={24} className={styles.noteGlyph} />
      <p className={styles.noteText}>{text}</p>
    </div>
  )
}
