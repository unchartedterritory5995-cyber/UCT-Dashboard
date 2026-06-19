/**
 * Delete Account modal — two states:
 *   1. Empty account → simple confirm.
 *   2. Has trades or positions → block with move-to picker that does
 *      atomic move + delete in sequence.
 */

import { useEffect, useState } from 'react'
import { useSWRConfig } from 'swr'
import { colorHex } from '../../lib/accountColors'
import styles from './NewAccountModal.module.css'

export default function DeleteAccountModal({ account, allAccounts, conflict, onClose }) {
  const { mutate } = useSWRConfig()
  const others = allAccounts.filter((a) => a.id !== account.id)
  const [moveTo, setMoveTo] = useState(others[0]?.id || '')
  // When blocked, the user picks how to resolve it: 'move' (relocate trades to
  // another account, then delete) or 'purge' (delete the account AND all its
  // trades/positions outright). Purge requires an explicit confirm checkbox.
  const [mode, setMode] = useState('move')
  const [purgeConfirmed, setPurgeConfirmed] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isBlocked = !!conflict && (
    (conflict.openPositionCount || 0) > 0 ||
    (conflict.tradeCount || 0) > 0
  )
  const isPurge = isBlocked && mode === 'purge'

  const doDelete = async () => {
    setError(null)
    setBusy(true)
    try {
      if (isBlocked && mode === 'move') {
        if (!moveTo) {
          setError('Pick an account to move trades to.')
          setBusy(false)
          return
        }
        // Move first
        const moveRes = await fetch(
          `/api/j2/accounts/${account.id}/move-all-to/${moveTo}`,
          { method: 'POST', credentials: 'include' },
        )
        if (!moveRes.ok) {
          const body = await moveRes.json().catch(() => ({}))
          throw new Error(body.detail || `Move failed: ${moveRes.status}`)
        }
      }
      // Delete (purge=true when wiping the account's trades along with it)
      const delRes = await fetch(
        `/api/j2/accounts/${account.id}${isPurge ? '?purge=true' : ''}`,
        { method: 'DELETE', credentials: 'include' },
      )
      if (!delRes.ok) {
        const body = await delRes.json().catch(() => ({}))
        throw new Error(body.detail?.message || body.detail || `${delRes.status}`)
      }
      mutate('/api/j2/accounts')
      mutate('/api/j2/accounts/comparison')
      onClose?.()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const primaryDisabled = busy
    || (isBlocked && mode === 'move' && !moveTo)
    || (isPurge && !purgeConfirmed)

  let primaryLabel = 'Delete Account'
  if (busy) primaryLabel = 'Working…'
  else if (isPurge) primaryLabel = 'Delete Everything'
  else if (isBlocked) primaryLabel = 'Move + Delete'

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            Delete "{account.name}"?
          </h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          {isBlocked ? (
            <>
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong style={{ color: 'var(--loss)' }}>
                  {conflict.tradeCount} trades
                </strong>
                {' and '}
                <strong style={{ color: 'var(--loss)' }}>
                  {conflict.openPositionCount} open positions
                </strong>
                {' are in this account.'}
              </p>

              <div role="radiogroup" aria-label="How to delete this account" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="radio"
                    name="deleteMode"
                    checked={mode === 'move'}
                    onChange={() => setMode('move')}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <strong>Move trades, then delete</strong>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                      Relocate everything to another account first.
                    </span>
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="radio"
                    name="deleteMode"
                    checked={mode === 'purge'}
                    onChange={() => setMode('purge')}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <strong style={{ color: 'var(--loss)' }}>Delete the account and all its trades</strong>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                      Permanently remove this account along with its {conflict.tradeCount} trades and {conflict.openPositionCount} positions.
                    </span>
                  </span>
                </label>
              </div>

              {mode === 'move' ? (
                <label className={styles.field}>
                  <span className={styles.label}>Move all to</span>
                  <select
                    value={moveTo}
                    onChange={(e) => setMoveTo(e.target.value)}
                    className={styles.select}
                  >
                    <option value="" disabled>— pick an account —</option>
                    {others.map((a) => (
                      <option key={a.id} value={a.id}>
                        ● {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12, color: 'var(--loss)' }}>
                  <input
                    type="checkbox"
                    checked={purgeConfirmed}
                    onChange={(e) => setPurgeConfirmed(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>This cannot be undone. Delete "{account.name}" and all of its trades permanently.</span>
                </label>
              )}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13 }}>
              This account has no trades or positions. It will be removed permanently.
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            style={{ background: 'var(--loss)', color: '#fff' }}
            onClick={doDelete}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
