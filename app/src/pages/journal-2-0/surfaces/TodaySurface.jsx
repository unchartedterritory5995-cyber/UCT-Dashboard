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
import TodayAllAccountsLead from './today/TodayAllAccountsLead'
import TodayPremarketLead from './today/TodayPremarketLead'
import TodayMarketLead from './today/TodayMarketLead'
import TodayPostCloseLead from './today/TodayPostCloseLead'
import TodayWeekStrip from './today/TodayWeekStrip'
import TodayQuickActions from './today/TodayQuickActions'
import CoachStrip from '../components/CoachStrip'
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
  const { session, zeroData, allAccounts } = useTodayState()
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
              affordance, so goals aren't a blank here). */}
          {account && <GoalProgress account={account} />}
          <TodayQuickActions onLogTrade={openTrade} />
        </>
      )}

      {modal === 'import' && (
        <ImportCsvModal
          onConfirmed={() => { refreshPositions(); closeModal() }}
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
