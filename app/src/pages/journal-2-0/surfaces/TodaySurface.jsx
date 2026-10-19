/**
 * Today surface — the flagship `/journal` landing (P4 B1).
 *
 * Replaces the A2 placeholder. Routes on `useTodayState()` to ONE lead
 * experience, then hangs the (B2/B3) secondary modules below it:
 *
 *   zeroData ────────► TodayZeroData (guided checklist; hero/goals suppressed)
 *   allAccounts ─────► TodayAllAccountsLead (overview lead + "pick an account")
 *   concrete account ► the SESSION lead:
 *        premarket  → TodayPremarketLead  (readiness / discipline)
 *        market     → TodayMarketLead     (BrokerAccountHero, or manual fallback)
 *        postclose  → TodayPostCloseLead  (EOD recap + reflect)
 *
 * Today IGNORES the global Scope: rather than mount a muted ScopeBar, we simply
 * show a small muted note when `useScope().isActive` (§21/§53). The coach strip
 * (B2) + week strip / goals / quick actions (B3) are stubbed slots below.
 *
 * The whole surface is single-column and aims to fit one desktop viewport;
 * phone collapse is CSS `@media (max-width:640px)` (the useIsPhone first-paint
 * trap), not JS.
 */
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import useTodayState from '../hooks/useTodayState'
import useFirstReport from '../hooks/useFirstReport'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2Positions from '../hooks/useJ2Positions'
import useCompassOverview from '../hooks/useCompassOverview'
import useScope from '../hooks/useScope'
import usePreferences from '../../../hooks/usePreferences'
import UIcon from '../../../components/ui/UIcon'
import ImportCsvModal from '../components/ImportCsvModal'
import AddTradeModal from '../components/AddTradeModal'
import AddPositionModal from '../components/AddPositionModal'
import GoalProgress from '../components/accounts/GoalProgress'
import TodayZeroData from './today/TodayZeroData'
import FirstEdgeReport from '../components/onboarding/FirstEdgeReport'
import TodayAllAccountsLead from './today/TodayAllAccountsLead'
import TodayPremarketLead from './today/TodayPremarketLead'
import TodayMarketLead from './today/TodayMarketLead'
import TodayPostCloseLead from './today/TodayPostCloseLead'
import TodayWeekStrip from './today/TodayWeekStrip'
import TodayQuickActions from './today/TodayQuickActions'
import CoachStrip from '../components/CoachStrip'
import DisciplineLockStrip from '../components/DisciplineLockStrip'
import ChecklistTodayPanel from './today/panels/ChecklistTodayPanel'
import MyRulesPanel from './today/panels/MyRulesPanel'
import RegimePanel from './today/panels/RegimePanel'
import TodayNotePanel from './today/panels/TodayNotePanel'
import NoticesPanel from './today/panels/NoticesPanel'
import { LAYOUT_PREF, DEFAULT_LAYOUT, normalizeLayout, resolvePanels } from '../lib/pageLayouts'
import { pageLayoutsEnabled } from '../lib/pageLayoutsFlag'
import { useJournalToast, JournalToast } from '../lib/useJournalToast'
// The Customize editor loads only when the button is pressed (its slot holds the lazy import).
import PageLayoutEditorSlot from '../components/layout/PageLayoutEditorSlot'
import { SkeletonLine, SkeletonBlock } from '../../../components/Skeleton'
import styles from './TodaySurface.module.css'

// The toast chip is absolutely positioned for a widget header; here it floats at the corner of the viewport.
const TOAST_STYLE = { position: 'fixed', top: 72, right: 16 }

async function jsonFetch(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = data.detail
    } catch { /* non-JSON error body */ }
    throw new Error(msg)
  }
  return res.json()
}

export default function TodaySurface() {
  const { settings } = useOutletContext() || {}
  const { session, zeroData, allAccounts, isLoading } = useTodayState()
  const { show: showFirstReport, dismiss: dismissFirstReport } = useFirstReport()
  const { accountId, account, accounts } = useJ2SelectedAccount()
  const { overview } = useCompassOverview(accountId)
  const { isActive: scopeActive } = useScope()
  const { prefs } = usePreferences()
  const { refresh: refreshPositions } = useJ2Positions()
  const { mutate } = useSWRConfig()

  // B1 fix: after the FIRST logged trade/position, the zero-data signal must
  // re-evaluate so Today "comes alive" without a remount. `useJ2AccountComparison`
  // (the closed-trade count behind `zeroData`) has no auto-revalidate, and the
  // coach `overview` (the lead + coach strip source) is a separate fetch — so
  // mutate BOTH keys here. Predicate form matches the exact keys:
  //   comparison → '/api/j2/accounts/comparison'
  //   overview   → '/api/j2/accounts/<scope>/coach/overview'
  const refreshTodaySignals = () => {
    mutate((k) => typeof k === 'string' && k.startsWith('/api/j2/accounts/comparison'))
    mutate((k) => typeof k === 'string' && k.startsWith('/api/j2/accounts/') && k.endsWith('/coach/overview'))
  }

  // Zero-data / quick-entry modals live here so every lead can trigger them.
  const [modal, setModal] = useState(null) // 'import' | 'trade' | 'position' | null

  const openTrade = () => setModal('trade')
  const openPosition = () => setModal('position')
  const openImport = () => setModal('import')
  const closeModal = () => setModal(null)

  // The Customize editor (P4a). The toast host is HERE, on the page, because the sheet that raises "Layout
  // saved." is unmounted by the very save that raises it: a toast owned by the sheet would render for no frames.
  const [customizing, setCustomizing] = useState(false)
  const [toastMsg, setToastMsg] = useJournalToast()

  const targetAccountId = accountId || accounts?.[0]?.id || null

  const scopeNote = scopeActive ? (
    <div className={styles.scopeNote} role="note">
      <UIcon name="eye" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
      Scope filter isn&apos;t applied on Today — it stays your live snapshot.
    </div>
  ) : null

  // ── loading gate ────────────────────────────────────────────────────────────
  // Until the position / option / comparison fetches settle, route to NOTHING —
  // a cold SWR cache defaults them empty, which would flash the fresh-account
  // zeroData checklist (then manual fallback → broker hero) at an established
  // broker user. A brief skeleton lets the surface land on the correct home once.
  if (isLoading) {
    return (
      <div className={styles.today} data-testid="today-surface">
        {scopeNote}
        <section
          className={styles.card}
          data-testid="today-loading"
          role="status"
          aria-busy="true"
          aria-label="Loading your day"
        >
          <div className={styles.cardEyebrow}>Loading your day…</div>
          <SkeletonLine width="55%" height={22} />
          <div
            style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
            aria-hidden="true"
          >
            <SkeletonBlock width="100%" height={60} />
            <SkeletonBlock width="100%" height={36} />
          </div>
        </section>
      </div>
    )
  }

  // ── First-Insight onboarding (P0) ───────────────────────────────────────────
  // Once the account crosses 10 closed trades and the report hasn't been seen,
  // Today leads with "Your First Edge Report" INSTEAD of the normal lead — the
  // funnel ends at a generated insight, not an empty dashboard. Evaluated AFTER
  // the loading gate so the closed-trade count has settled (no flash). A CSV
  // import / broker first-sync revalidates the comparison key, so crossing 10
  // makes this re-render and the report appear with no bespoke event. Dismissing
  // ("Continue to Today") sets the seen flag and drops through to the normal lead.
  if (showFirstReport) {
    return (
      <div className={styles.today} data-testid="today-surface">
        {scopeNote}
        <FirstEdgeReport accountId={accountId} onDismiss={dismissFirstReport} />
      </div>
    )
  }

  // ── the ONE lead module ────────────────────────────────────────────────────
  let lead
  if (zeroData) {
    lead = <TodayZeroData onImport={openImport} onLogTrade={openTrade} />
  } else if (allAccounts) {
    lead = <TodayAllAccountsLead overview={overview} />
  } else if (session === 'premarket') {
    lead = <TodayPremarketLead account={account} overview={overview} />
  } else if (session === 'market') {
    lead = (
      <TodayMarketLead
        account={account}
        settings={settings}
        overview={overview}
        onLogTrade={openTrade}
        onLogPosition={openPosition}
      />
    )
  } else {
    lead = <TodayPostCloseLead account={account} overview={overview} />
  }

  // ── the panels after the lead, from the page layout (P4a) ──────────────────
  // With the layouts switch off the list is DEFAULT_LAYOUT's, which is the fixed order Today always had
  // (coach strip, week strip, goals, quick actions). With it on, the member's saved layout for THIS session
  // phase decides which panels show and in what order; the phase changing is a read, never a write.
  // The lead above is not part of the layout. Every panel except the coach strip is suppressed on the
  // zero-data experience, whatever the layout says.
  const layout = pageLayoutsEnabled() ? normalizeLayout(prefs?.[LAYOUT_PREF]) : DEFAULT_LAYOUT
  const panels = resolvePanels(layout, 'today', session).filter((p) => p.shown)
  // Ruling P4a-T9-R2: a hidden coach strip must not hide an active discipline lock. The strip carries the lock
  // rows; when the member has hidden it, the lock rows (and nothing else from the strip) render on their own,
  // straight after the lead. DisciplineLockStrip renders nothing when the account is not locked. With the
  // layouts switch off the strip is always shown, so this never renders there.
  const coachStripShown = panels.some((p) => p.id === 'coachStrip')
  const render = {
    // B2 — the consolidated CoachStrip: folds nudges / interventions /
    // broker-review / unviewed-EOD / discipline-lock into ONE calm,
    // severity-ordered strip. Renders null when there's nothing to show.
    coachStrip: () => <CoachStrip key="coachStrip" accountId={accountId} />,
    // B3 — secondary modules below the lead. Suppressed on the zero-data
    // experience (the guided checklist IS the surface; hero/goals/strip all
    // stay hidden until there's something to show).
    weekStrip: () => !zeroData && <TodayWeekStrip key="weekStrip" />,
    // GoalProgress needs a CONCRETE account — hidden on All-Accounts
    // (the all-accounts lead already carries the "pick an account"
    // affordance, so goals aren't a blank here). P0 poller collapse:
    // feed it the goal-progress the overview poll already carries so it
    // drops its own 30s poller (Today lands at ≤4 recurring requests).
    goalProgress: () => !zeroData && account && (
      <GoalProgress key="goalProgress" account={account} progress={overview?.goal_progress} />
    ),
    quickActions: () => !zeroData && <TodayQuickActions key="quickActions" onLogTrade={openTrade} />,
    // The checklist reads the day on the basis the day page reads it on, so it is handed the SAME account and
    // account id useJ2SelectedAccount gives DayDetailPage: the basis is part of the day detail's cache key.
    checklistToday: () => !zeroData && (
      <ChecklistTodayPanel key="checklistToday" account={account} accountId={accountId} />
    ),
    myRules: () => !zeroData && <MyRulesPanel key="myRules" account={account} accountId={accountId} />,
    regime: () => !zeroData && <RegimePanel key="regime" />,
    todayNote: () => !zeroData && <TodayNotePanel key="todayNote" />,
    notices: () => !zeroData && <NoticesPanel key="notices" />,
  }

  // Customize sits in the header area beside the scope note, and only while the layouts switch is on. With
  // it off the header is the scope note alone, exactly as it was. It is not offered on the zero-data
  // experience either: every panel but the coach strip is suppressed there, so no choice in it could show.
  const header = pageLayoutsEnabled() && !zeroData ? (
    <div className={styles.headRow}>
      {scopeNote}
      <button type="button" className={styles.customizeBtn} onClick={() => setCustomizing(true)}>
        <UIcon name="gear" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Customize
      </button>
    </div>
  ) : scopeNote

  return (
    <div className={styles.today} data-testid="today-surface">
      {header}

      {lead}

      {!coachStripShown && <DisciplineLockStrip accountId={accountId} />}

      {panels.map((p) => render[p.id]?.())}

      {customizing && (
        <PageLayoutEditorSlot
          page="today"
          initialPhase={session}
          onClose={() => setCustomizing(false)}
          onSaved={() => setToastMsg('Layout saved.')}
        />
      )}
      <JournalToast msg={toastMsg} style={TOAST_STYLE} />

      {modal === 'import' && (
        <ImportCsvModal
          onConfirmed={() => {
            // Revalidate positions AND the zero-data / trade-count signals so the
            // Today re-render picks up the import naturally — when the closed-trade
            // count crosses 10, useFirstReport flips and the First Edge Report leads
            // (no bespoke event; the comparison key is the trade-count source).
            refreshPositions()
            refreshTodaySignals()
            closeModal()
          }}
          onClose={closeModal}
        />
      )}
      {modal === 'trade' && (
        <AddTradeModal
          settings={settings}
          accountId={targetAccountId}
          accountName={account?.name || accounts?.[0]?.name}
          onSave={async (payload) => {
            await jsonFetch('/api/j2/trades', 'POST', {
              ...payload,
              accountId: payload.accountId || targetAccountId,
            })
            refreshTodaySignals()
            closeModal()
          }}
          onClose={closeModal}
        />
      )}
      {modal === 'position' && (
        <AddPositionModal
          settings={settings}
          accountName={account?.name || accounts?.[0]?.name}
          onSave={async (payload) => {
            // Wave 3 (Thesis-Trade Link) / P0-18 fix: this used to (a) discard
            // the created position, so the linking step below never got a
            // real id, and (b) close the modal itself immediately — which
            // would have unmounted AddPositionModal before its own
            // handleSave could even attempt the link, let alone show the
            // retry footer on failure. AddPositionModal calls onClose itself
            // once it's actually done (see its handleSave) — this handler
            // must only write + revalidate + return the created position.
            const created = await jsonFetch('/api/j2/positions', 'POST', {
              ...payload,
              accountId: payload.accountId || targetAccountId,
            })
            await refreshPositions()
            refreshTodaySignals()
            return created
          }}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
