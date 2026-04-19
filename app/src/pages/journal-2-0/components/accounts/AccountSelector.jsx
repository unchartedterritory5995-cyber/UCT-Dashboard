/**
 * Global Account selector — sits in the J2.0 header.
 * Replaces the legacy "Settings $X" pill.
 *
 * Click → dropdown of accounts (with color dots + balances) +
 * "All Accounts" + "+ New Account" link.
 */

import { useEffect, useRef, useState } from 'react'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { colorHex } from '../../lib/accountColors'
import { money } from '../../../../lib/journal-2-0'
import styles from './AccountSelector.module.css'

export default function AccountSelector({ onNewAccount }) {
  const { accountId, account, accounts, setAccount } = useJ2SelectedAccount()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const isAll = accountId === null

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.pill}
        onClick={() => setOpen((x) => !x)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {isAll ? (
          <>
            <span className={styles.allDot}>🌐</span>
            <span className={styles.name}>All Accounts</span>
          </>
        ) : (
          <>
            <span
              className={styles.dot}
              style={{ background: colorHex(account?.color) }}
              aria-hidden="true"
            />
            <span className={styles.name}>{account?.name || '—'}</span>
            {account && (
              <span className={styles.balance}>
                {money(account.startingBalance)}
              </span>
            )}
          </>
        )}
        <span className={styles.chev} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={styles.menu} role="listbox">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === accountId}
              className={`${styles.item} ${a.id === accountId ? styles.itemActive : ''}`}
              onClick={() => { setAccount(a.id); setOpen(false) }}
            >
              <span
                className={styles.dot}
                style={{ background: colorHex(a.color) }}
                aria-hidden="true"
              />
              <span className={styles.itemName}>{a.name}</span>
              <span className={styles.itemBalance}>
                {money(a.startingBalance)}
              </span>
            </button>
          ))}
          <div className={styles.sep} />
          <button
            type="button"
            role="option"
            aria-selected={isAll}
            className={`${styles.item} ${isAll ? styles.itemActive : ''}`}
            onClick={() => { setAccount(null); setOpen(false) }}
          >
            <span className={styles.allDot}>🌐</span>
            <span className={styles.itemName}>All Accounts</span>
          </button>
          <div className={styles.sep} />
          <button
            type="button"
            className={styles.newBtn}
            onClick={() => { setOpen(false); onNewAccount?.() }}
          >
            + New Account
          </button>
        </div>
      )}
    </div>
  )
}
