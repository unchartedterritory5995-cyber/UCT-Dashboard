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

  const doDelete = async () => {
    setError(null)
    setBusy(true)
    try {
      if (isBlocked) {
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
      // Delete
      const delRes = await fetch(`/api/j2/accounts/${account.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
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
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Move them to another account first, then this account will be deleted.
              </p>
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
            disabled={busy || (isBlocked && !moveTo)}
          >
            {busy ? 'Working…' : (isBlocked ? 'Move + Delete' : 'Delete Account')}
          </button>
        </div>
      </div>
    </div>
  )
}
