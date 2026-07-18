/**
 * Accounts tab — list + Comparison view.
 * Spec §7.3.
 */

import { useState } from 'react'
import useJ2Accounts from '../hooks/useJ2Accounts'
import useJ2AccountComparison from '../hooks/useJ2AccountComparison'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import ComparisonGrid from '../components/accounts/ComparisonGrid'
import DeleteAccountModal from '../components/accounts/DeleteAccountModal'
import GoalProgress from '../components/accounts/GoalProgress'
import Milestones from '../components/accounts/Milestones'
import BrokerConnectionsCard from '../components/BrokerConnectionsCard'
import { colorHex } from '../lib/accountColors'
import { money } from '../../../lib/journal-2-0'
import UIcon from '../../../components/ui/UIcon'
import styles from './AccountsTab.module.css'

export default function AccountsTab({ onNewAccount }) {
  const { accounts, isLoading, error, refresh } = useJ2Accounts()
  const { accounts: comparison, isLoading: cmpLoading } = useJ2AccountComparison()
  const { accountId, account, setAccount } = useJ2SelectedAccount()
  const currentComparison = comparison.find((c) => c.id === accountId) || comparison[0]

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConflict, setDeleteConflict] = useState(null)
  const [renameId, setRenameId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState(null)

  const saveRename = async (account) => {
    const name = renameValue.trim()
    setRenameId(null)
    if (!name || name === account.name) return
    setRenameError(null)
    const res = await fetch(`/api/j2/accounts/${account.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setRenameError(typeof body.detail === 'string' ? body.detail : 'Could not rename the account.')
    }
    refresh()
  }

  const tradeCountByAccount = {}
  const balanceByAccount = {}
  for (const a of comparison) {
    tradeCountByAccount[a.id] = a.tradeCount
    // currentBalance is the resolver's truth: real broker net-liq for broker
    // accounts, startingBalance + realized P&L for manual ones. Mirrors
    // AccountSelector — the static startingBalance seed is NOT the balance.
    balanceByAccount[a.id] = a.currentBalance
  }

  const tryDelete = async (account) => {
    // Probe with DELETE — if 409, surface the conflict modal with counts.
    const res = await fetch(`/api/j2/accounts/${account.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      refresh()
      return
    }
    const body = await res.json().catch(() => ({}))
    if (res.status === 409 && body.detail && typeof body.detail === 'object') {
      setDeleteTarget(account)
      setDeleteConflict(body.detail)
    } else {
      // Fallback — open modal with no conflict (will show generic confirm)
      setDeleteTarget(account)
      setDeleteConflict(null)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Trading Accounts</h2>
          <p className={styles.subtitle}>
            Manage your trading accounts and compare performance.
          </p>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={onNewAccount}
        >
          + New Account
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Couldn't load accounts: {String(error.message || error)}
        </div>
      )}
      {renameError && (
        <div className={styles.errorBanner} role="alert">
          {renameError}
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionHeader}><UIcon name="user" size={13} /> Your Accounts</h3>
        {isLoading && accounts.length === 0 ? (
          <p className={styles.hint}>Loading…</p>
        ) : (
          <div className={styles.list}>
            {accounts.map((a) => (
              <div key={a.id} className={styles.row}>
                <span
                  className={styles.dot}
                  style={{ background: colorHex(a.color) }}
                />
                <div className={styles.identity}>
                  {renameId === a.id ? (
                    <input
                      className={styles.renameInput}
                      value={renameValue}
                      autoFocus
                      maxLength={60}
                      aria-label={`Rename ${a.name}`}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(a)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(a)
                        if (e.key === 'Escape') setRenameId(null)
                      }}
                    />
                  ) : (
                    <span className={styles.name}>
                      {a.name}
                      <button
                        type="button"
                        className={styles.renameBtn}
                        title="Rename account"
                        aria-label={`Rename ${a.name}`}
                        onClick={() => { setRenameId(a.id); setRenameValue(a.name) }}
                      >
                        <UIcon name="edit" size={12} />
                      </button>
                    </span>
                  )}
                  {a.broker && (
                    <span className={styles.broker}>{a.broker}</span>
                  )}
                </div>
                <span className={styles.balance}>
                  {money(balanceByAccount[a.id] != null ? balanceByAccount[a.id] : a.startingBalance)}
                </span>
                <span className={styles.tradeCount}>
                  {tradeCountByAccount[a.id] ?? 0} trades
                </span>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => setAccount(a.id)}
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.danger}`}
                    onClick={() => tryDelete(a)}
                    aria-label={`Delete ${a.name}`}
                  >
                    Del
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Brokerage Connection — the canonical broker connect/disconnect + dup
          review home (B6). Self-titled via its own TileCard (UIcon "link" +
          "Brokerage Connections"), so it stands as its own section without a
          redundant stacked header. Self-contained SWR; also rendered in global
          Settings (safe to appear in both). */}
      <BrokerConnectionsCard />

      {(accountId != null && account) && (
        <>
          <GoalProgress account={account} />
          {currentComparison && (
            <Milestones totalReturn={currentComparison.totalReturn} />
          )}
        </>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionHeader}><UIcon name="chart" size={13} /> Account Comparison</h3>
        <ComparisonGrid accounts={comparison} isLoading={cmpLoading} />
      </section>

      <section className={`${styles.section} ${styles.helpSection}`}>
        <h3 className={styles.sectionHeader}><UIcon name="book" size={13} /> How Accounts Work</h3>
        <ol className={styles.helpList}>
          <li>
            <strong>Create accounts</strong> for each broker, strategy, or
            book you want to track separately. Distinct names + colors
            keep them visually identifiable everywhere in the app.
          </li>
          <li>
            <strong>Switch accounts</strong> using the selector pill in the
            J2.0 header — every tab (Open Positions, Trade Journal, Calendar)
            scopes to the selected account. "All Accounts" aggregates across.
          </li>
          <li>
            <strong>New trades + positions</strong> are tagged with the
            currently-selected account. Switch first, then add.
          </li>
          <li>
            <strong>Per-account settings</strong> — each account has its
            own size, stop style, breakeven range, and setups list.
            Open settings (<UIcon name="gear" size={13} style={{ verticalAlign: '-2px' }} /> in header) while a single account is selected.
          </li>
        </ol>
      </section>

      {deleteTarget && (
        <DeleteAccountModal
          account={deleteTarget}
          allAccounts={accounts}
          conflict={deleteConflict}
          onClose={() => { setDeleteTarget(null); setDeleteConflict(null); refresh() }}
        />
      )}
    </div>
  )
}
