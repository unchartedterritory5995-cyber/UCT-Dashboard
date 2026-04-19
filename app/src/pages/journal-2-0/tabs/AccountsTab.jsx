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
import { colorHex } from '../lib/accountColors'
import { money } from '../../../lib/journal-2-0'
import styles from './AccountsTab.module.css'

export default function AccountsTab({ onNewAccount }) {
  const { accounts, isLoading, error, refresh } = useJ2Accounts()
  const { accounts: comparison, isLoading: cmpLoading } = useJ2AccountComparison()
  const { setAccount } = useJ2SelectedAccount()

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConflict, setDeleteConflict] = useState(null)

  const tradeCountByAccount = {}
  for (const a of comparison) tradeCountByAccount[a.id] = a.tradeCount

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

      <section className={styles.section}>
        <h3 className={styles.sectionHeader}>Your Accounts</h3>
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
                  <span className={styles.name}>{a.name}</span>
                  {a.broker && (
                    <span className={styles.broker}>{a.broker}</span>
                  )}
                </div>
                <span className={styles.balance}>
                  {money(a.startingBalance)}
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

      <section className={styles.section}>
        <h3 className={styles.sectionHeader}>Account Comparison</h3>
        <ComparisonGrid accounts={comparison} isLoading={cmpLoading} />
      </section>

      <section className={`${styles.section} ${styles.helpSection}`}>
        <h3 className={styles.sectionHeader}>How Accounts Work</h3>
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
            Open settings (⚙ in header) while a single account is selected.
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
