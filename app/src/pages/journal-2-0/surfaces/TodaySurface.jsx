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
import { SkeletonLine, SkeletonBlock } from '../../../components/Skeleton'
import styles from './TodaySurface.module.css'

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

  return (
    <div className={styles.today} data-testid="today-surface">
      {scopeNote}

      {lead}

      {/* B2 — the consolidated CoachStrip: folds nudges / interventions /
          broker-review / unviewed-EOD / discipline-lock into ONE calm,
          severity-ordered strip. Renders null when there's nothing to show. */}
      <CoachStrip accountId={accountId} />

      {/* B3 — secondary modules below the lead. Suppressed on the zero-data
          experience (the guided checklist IS the surface; hero/goals/strip all
          stay hidden until there's something to show). */}
      {!zeroData && (
        <>
          <TodayWeekStrip />
          {/* GoalProgress needs a CONCRETE account — hidden on All-Accounts
              (the all-accounts lead already carries the "pick an account"
              affordance, so goals aren't a blank here). P0 poller collapse:
              feed it the goal-progress the overview poll already carries so it
              drops its own 30s poller (Today lands at ≤4 recurring requests). */}
          {account && <GoalProgress account={account} progress={overview?.goal_progress} />}
          <TodayQuickActions onLogTrade={openTrade} />
        </>
      )}

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
            await jsonFetch('/api/j2/positions', 'POST', {
              ...payload,
              accountId: payload.accountId || targetAccountId,
            })
            await refreshPositions()
            refreshTodaySignals()
            closeModal()
          }}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
