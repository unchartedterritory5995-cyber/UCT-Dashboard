/**
 * Global Account selector — sits in the J2.0 header.
 * Replaces the legacy "Settings $X" pill.
 *
 * Click → dropdown of accounts (with color dots + balances) +
 * "All Accounts" + "+ New Account" link.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useJ2AccountComparison from '../../hooks/useJ2AccountComparison'
import { colorHex } from '../../lib/accountColors'
import { money } from '../../../../lib/journal-2-0'
import DeleteAccountModal from './DeleteAccountModal'
import styles from './AccountSelector.module.css'

export default function AccountSelector({ onNewAccount }) {
  const { accountId, account, accounts, setAccount } = useJ2SelectedAccount()
  const { accounts: comparison } = useJ2AccountComparison()
  const { mutate } = useSWRConfig()
  const balanceById = useMemo(() => {
    const m = {}
    for (const c of comparison) m[c.id] = c.currentBalance
    return m
  }, [comparison])
  const balanceFor = (a) =>
    balanceById[a?.id] != null ? balanceById[a.id] : a?.startingBalance
  const [open, setOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConflict, setDeleteConflict] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false)
        setContextMenu(null)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (contextMenu) setContextMenu(null)
        else setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, contextMenu])

  const handleContextMenu = (e, acc) => {
    e.preventDefault()
    e.stopPropagation()
    const wrapRect = wrapRef.current?.getBoundingClientRect()
    setContextMenu({
      account: acc,
      x: e.clientX - (wrapRect?.left ?? 0),
      y: e.clientY - (wrapRect?.top ?? 0),
    })
  }

  const tryDelete = async (acc) => {
    setContextMenu(null)
    const res = await fetch(`/api/j2/accounts/${acc.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      mutate('/api/j2/accounts')
      mutate('/api/j2/accounts/comparison')
      return
    }
    const body = await res.json().catch(() => ({}))
    if (res.status === 409 && body.detail && typeof body.detail === 'object') {
      setDeleteTarget(acc)
      setDeleteConflict(body.detail)
    } else {
      setDeleteTarget(acc)
      setDeleteConflict(null)
    }
    setOpen(false)
  }

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
                {money(balanceFor(account))}
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
              onContextMenu={(e) => handleContextMenu(e, a)}
              title="Right-click to delete"
            >
              <span
                className={styles.dot}
                style={{ background: colorHex(a.color) }}
                aria-hidden="true"
              />
              <span className={styles.itemName}>{a.name}</span>
              <span className={styles.itemBalance}>
                {money(balanceFor(a))}
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

      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          <div className={styles.contextMenuHeader}>
            {contextMenu.account.name}
          </div>
          <button
            type="button"
            role="menuitem"
            className={styles.contextMenuItem}
            onClick={() => tryDelete(contextMenu.account)}
          >
            🗑 Delete account
          </button>
        </div>
      )}

      {deleteTarget && (
        <DeleteAccountModal
          account={deleteTarget}
          allAccounts={accounts}
          conflict={deleteConflict}
          onClose={() => {
            setDeleteTarget(null)
            setDeleteConflict(null)
            mutate('/api/j2/accounts')
            mutate('/api/j2/accounts/comparison')
          }}
        />
      )}
    </div>
  )
}
