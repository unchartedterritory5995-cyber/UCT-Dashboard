/**
 * Close Position modal — Journal 2.0.
 * Spec §10.
 *
 * Default shares-to-close = remaining. Default exit price = current
 * live price. Default exit date = today. On submit, the server writes
 * a Trade row and decrements/archives the Position.
 */

import { useState, useCallback, useEffect, useId, useMemo } from 'react'
import styles from './ModalShell.module.css'
import { activeStop, positionPnlDollar, tradeRMultiple, money, moneySigned, rMultiple } from '../../../lib/journal-2-0'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

export default function ClosePositionModal({ position, currentPrice, onSave, onClose }) {
  const titleId = useId()
  const [sharesToClose, setSharesToClose] = useState(String(position.shares))
  const [exitPrice, setExitPrice] = useState(
    currentPrice ? String(currentPrice) : '',
  )
  const [exitDate, setExitDate] = useState(TODAY_ISO())
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Live preview of what the Trade row will look like
  const preview = useMemo(() => {
    const s = Number(sharesToClose)
    const ep = Number(exitPrice)
    if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(ep) || ep <= 0) return null
    // Build a minimal Trade-shaped object for tradeRMultiple + pnl calc
    const pseudoPosition = { ...position, shares: s }
    const pnlD = positionPnlDollar(pseudoPosition, ep)
    const r = tradeRMultiple({
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: ep,
      originalStop: position.stopPrice,
    })
    return { pnlD, r }
  }, [sharesToClose, exitPrice, position])

  const validate = useCallback(() => {
    const s = Number(sharesToClose)
    if (!Number.isFinite(s) || s <= 0) return 'Shares to close must be > 0'
    if (s > position.shares + 1e-9) return `Cannot close more than ${position.shares} remaining`
    const ep = Number(exitPrice)
    if (!Number.isFinite(ep) || ep <= 0) return 'Exit price must be > 0'
    if (!exitDate) return 'Exit date is required'
    if (exitDate < position.entryDate.slice(0, 10)) return 'Exit date cannot be before entry date'
    return null
  }, [sharesToClose, exitPrice, exitDate, position])

  const handleSave = useCallback(async () => {
    setErrorMsg('')
    const err = validate()
    if (err) { setErrorMsg(err); return }
    setSaving(true)
    try {
      await onSave({
        shares: Number(sharesToClose),
        exitPrice: Number(exitPrice),
        exitDate,
        notes: notes.trim() || null,
      })
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }, [validate, sharesToClose, exitPrice, exitDate, notes, onSave, onClose])

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>Close {position.symbol}</h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.infoBanner}>
            <span>Remaining: <strong>{position.shares}</strong></span>
            <span>Entry: <strong>{money(position.entryPrice)}</strong></span>
            <span>Stop: <strong>{money(activeStop(position))}</strong></span>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Shares to Close *</span>
              <input
                type="number"
                min="0"
                step="any"
                value={sharesToClose}
                onChange={(e) => setSharesToClose(e.target.value)}
                className={styles.numberInput}
                autoFocus
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Exit Date *</span>
              <input
                type="date"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                className={styles.textInput}
                max={TODAY_ISO()}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Exit Price *</span>
            <div className={styles.prefixInput}>
              <span className={styles.prefix}>$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                className={styles.numberInputInner}
              />
            </div>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.textarea}
              rows={2}
            />
          </label>

          {preview && (
            <div className={styles.infoBanner}>
              <span>Preview P&amp;L: <strong>{moneySigned(preview.pnlD)}</strong></span>
              <span>R-multiple: <strong>{rMultiple(preview.r)}</strong></span>
            </div>
          )}

          {errorMsg && <div className={styles.errorBanner} role="alert">{errorMsg}</div>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Closing…' : 'Close Position'}
          </button>
        </div>
      </div>
    </div>
  )
}
