/**
 * Delete All Trades confirmation modal — Journal 2.0.
 * Spec §11.4, §15.9.
 *
 * Destructive: hard-deletes every trade for the user. Primary button
 * stays disabled until the user types the exact string `DELETE` in
 * the confirmation input. Matches the §13.4/§15.9 pattern for
 * destructive actions.
 */

import { useState, useCallback, useEffect, useId } from 'react'
import styles from './ModalShell.module.css'

const REQUIRED = 'DELETE'

export default function DeleteAllModal({ tradeCount, onConfirm, onClose }) {
  const titleId = useId()
  const [confirmText, setConfirmText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canConfirm = confirmText === REQUIRED && !deleting

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return
    setErrorMsg('')
    setDeleting(true)
    try {
      await onConfirm()
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setDeleting(false)
    }
  }, [canConfirm, onConfirm, onClose])

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>Delete all trades?</h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.errorBanner}>
            <strong>This cannot be undone.</strong> You will permanently delete{' '}
            <strong>{tradeCount}</strong> trade{tradeCount === 1 ? '' : 's'} from
            your Journal 2.0. Open Positions are not affected.
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Type <strong>{REQUIRED}</strong> to confirm:
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={styles.textInput}
              autoFocus
              aria-describedby="confirm-hint"
              placeholder={REQUIRED}
            />
            <span id="confirm-hint" className={styles.helper}>
              Case-sensitive. Primary button is disabled until the string matches.
            </span>
          </label>

          {errorMsg && <div className={styles.errorBanner} role="alert">{errorMsg}</div>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {deleting ? 'Deleting…' : 'Delete All Trades'}
          </button>
        </div>
      </div>
    </div>
  )
}
