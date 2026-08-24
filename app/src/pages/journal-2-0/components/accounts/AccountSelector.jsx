/**
 * Global Account selector — sits in the J2.0 header.
 * Replaces the legacy "Settings $X" pill.
 *
 * Click → dropdown of accounts (with color dots + balances) +
 * "All Accounts" + "+ New Account" link.
 *
 * Delete an account: long-press a row on touch, or right-click on desktop.
 * Both open a ContextPopover (bottom-sheet on touch / anchored menu on
 * desktop) with a 44px "Delete account" action that feeds the existing
 * DeleteAccountModal confirmation flow.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import ContextPopover from '../../../../components/mobile/ContextPopover'
import useLongPress from '../../../../components/mobile/useLongPress'
import UIcon from '../../../../components/ui/UIcon'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useJ2AccountComparison from '../../hooks/useJ2AccountComparison'
import { colorHex } from '../../lib/accountColors'
import { money } from '../../../../lib/journal-2-0'
import DeleteAccountModal from './DeleteAccountModal'
import styles from './AccountSelector.module.css'

/* One account row in the dropdown. Long-press (touch) / right-click (desktop)
 * both surface the delete affordance via onRequestDelete. */
function AccountRow({ acc, active, onSelect, onRequestDelete }) {
  const lp = useLongPress((e) => onRequestDelete(e, acc))
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`${styles.item} ${active ? styles.itemActive : ''}`}
      onClick={() => onSelect(acc.id)}
      title="Long-press or right-click to delete"
      {...lp}
    >
      <span
        className={styles.dot}
        style={{ background: colorHex(acc.color) }}
        aria-hidden="true"
      />
      <span className={styles.itemName}>{acc.name}</span>
      <span className={styles.itemBalance}>{money(acc.balance)}</span>
    </button>
  )
}

export default function AccountSelector({ onNewAccount }) {
  const { accountId, account, accounts, setAccount } = useJ2SelectedAccount()
  const { accounts: comparison } = useJ2AccountComparison()
  const { mutate } = useSWRConfig()
  const balanceById = useMemo(() => {
    const m = {}
    for (const c of comparison) m[c.id] = c.currentBalance
    return m
  }, [comparison])
  // Key the startingBalance fallback on PRESENCE, not null: a broker account
  // that's synced-but-pending (INV-1) has a real null currentBalance and must
  // render "—" (money(null)), NOT the $1.00 startingBalance seed. Only fall back
  // when the comparison row hasn't loaded for this id yet.
  const balanceFor = (a) =>
    (a?.id != null && a.id in balanceById) ? balanceById[a.id] : a?.startingBalance
  const [open, setOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConflict, setDeleteConflict] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      // While the delete popover is open it owns dismissal (it portals outside
      // wrapRef); don't let the dropdown's outside-click steal that click.
      if (contextMenu) return
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false)
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
    e.preventDefault?.()
    e.stopPropagation?.()
    // ContextPopover anchors in viewport coordinates (it clamps to the
    // viewport on desktop and ignores the anchor on touch → bottom-sheet).
    setContextMenu({
      account: acc,
      x: e.clientX ?? 0,
      y: e.clientY ?? 0,
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
            <span className={styles.allDot}><UIcon name="globe" size={14} /></span>
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
            <AccountRow
              key={a.id}
              acc={{ ...a, balance: balanceFor(a) }}
              active={a.id === accountId}
              onSelect={(id) => { setAccount(id); setOpen(false) }}
              onRequestDelete={handleContextMenu}
            />
          ))}
          <div className={styles.sep} />
          <button
            type="button"
            role="option"
            aria-selected={isAll}
            className={`${styles.item} ${isAll ? styles.itemActive : ''}`}
            onClick={() => { setAccount(null); setOpen(false) }}
          >
            <span className={styles.allDot}><UIcon name="globe" size={14} /></span>
            <span className={styles.itemName}>All Accounts</span>
          </button>
          <div className={styles.sep} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => { setOpen(false); onNewAccount?.() }}
          >
            + New Account
          </button>
        </div>
      )}

      <ContextPopover
        open={!!contextMenu}
        onClose={() => setContextMenu(null)}
        anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        title={contextMenu?.account?.name}
        items={
          contextMenu
            ? [
                {
                  key: 'delete',
                  label: 'Delete account',
                  icon: <UIcon name="trash" size={18} />,
                  danger: true,
                  onClick: () => tryDelete(contextMenu.account),
                },
              ]
            : []
        }
      />

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
