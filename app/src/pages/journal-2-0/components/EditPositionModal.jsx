/**
 * Edit Position modal — Journal 2.0.
 * Spec §9.
 *
 * Raise-to-breakeven toggle is the critical feature here. When enabled,
 * reveals a `breakevenStop` input defaulted to `entryPrice`. The user
 * may set it above entry. `stopPrice` (original stop) is a separate
 * field — users CAN edit it directly but the toggle never touches it.
 *
 * Server-side invariant (spec §18): stopPrice in the PUT payload is
 * only sent when the user explicitly edited that field; the toggle
 * never adds it.
 */

import { useState, useCallback, useId, useEffect, useRef } from 'react'
import styles from './ModalShell.module.css'

export default function EditPositionModal({ position, settings, onSave, onClose }) {
  const titleId = useId()
  const [side, setSide] = useState(position.side)
  const [entryDate, setEntryDate] = useState(position.entryDate.slice(0, 10))
  const [shares, setShares] = useState(String(position.shares))
  const [entryPrice, setEntryPrice] = useState(String(position.entryPrice))
  const [stopPrice, setStopPrice] = useState(String(position.stopPrice))
  const [raiseToBe, setRaiseToBe] = useState(position.raiseToBreakeven)
  const [beStop, setBeStop] = useState(
    String(position.breakevenStop ?? position.entryPrice),
  )
  const [setupVal, setSetupVal] = useState(position.setup || '')
  const [notes, setNotes] = useState(position.notes || '')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  // Track which fields the user actually modified — only those are sent
  // in the patch. Prevents the toggle from accidentally reaffirming
  // stopPrice in the payload (defense-in-depth).
  const touched = useRef(new Set())
  const markTouched = (key) => touched.current.add(key)

  const setups = settings?.setups ?? []

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const validate = useCallback(() => {
    const s = Number(shares)
    const e = Number(entryPrice)
    const sp = Number(stopPrice)
    if (!Number.isFinite(s) || s <= 0) return 'Shares must be > 0'
    if (!Number.isFinite(e) || e <= 0) return 'Entry price must be > 0'
    if (stopPrice !== '') {
      if (!Number.isFinite(sp) || sp < 0) return 'Stop price must be non-negative'
      if (side === 'Long' && sp >= e) return 'Stop must be below entry for Long'
      if (side === 'Short' && sp <= e) return 'Stop must be above entry for Short'
    }
    if (raiseToBe) {
      const bs = Number(beStop)
      if (!Number.isFinite(bs) || bs < 0) return 'Breakeven stop must be non-negative'
    }
    return null
  }, [shares, entryPrice, stopPrice, side, raiseToBe, beStop])

  const handleSave = useCallback(async () => {
    setErrorMsg('')
    const err = validate()
    if (err) { setErrorMsg(err); return }
    setSaving(true)
    try {
      const patch = {}
      if (touched.current.has('side')) patch.side = side
      if (touched.current.has('entryDate')) patch.entryDate = entryDate
      if (touched.current.has('shares')) patch.shares = Number(shares)
      if (touched.current.has('entryPrice')) patch.entryPrice = Number(entryPrice)
      if (touched.current.has('stopPrice')) patch.stopPrice = Number(stopPrice)
      if (touched.current.has('setupVal')) patch.setup = setupVal.trim() || null
      if (touched.current.has('notes')) patch.notes = notes.trim() || null

      // Raise-to-BE is always reconciled — it's the toggle's whole purpose.
      patch.raiseToBreakeven = raiseToBe
      if (raiseToBe) {
        patch.breakevenStop = Number(beStop)
      } else {
        patch.breakevenStop = null
      }

      await onSave(patch)
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }, [validate, side, entryDate, shares, entryPrice, stopPrice, setupVal, notes, raiseToBe, beStop, onSave, onClose])

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>Edit {position.symbol}</h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Side</span>
              <div className={styles.pillToggle} role="radiogroup" aria-label="Side">
                {['Long', 'Short'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.pill} ${side === s ? styles.pillActive : ''}`}
                    onClick={() => { setSide(s); markTouched('side') }}
                    aria-pressed={side === s}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Entry Date *</span>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => { setEntryDate(e.target.value); markTouched('entryDate') }}
                className={styles.textInput}
              />
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Shares *</span>
              <input
                type="number"
                min="0"
                step="any"
                value={shares}
                onChange={(e) => { setShares(e.target.value); markTouched('shares') }}
                className={styles.numberInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Entry Price *</span>
              <div className={styles.prefixInput}>
                <span className={styles.prefix}>$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={entryPrice}
                  onChange={(e) => { setEntryPrice(e.target.value); markTouched('entryPrice') }}
                  className={styles.numberInputInner}
                />
              </div>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Stop Price</span>
            <div className={styles.prefixInput}>
              <span className={styles.prefix}>$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={stopPrice}
                onChange={(e) => { setStopPrice(e.target.value); markTouched('stopPrice') }}
                className={styles.numberInputInner}
              />
            </div>
          </label>

          <div className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={raiseToBe}
              onChange={(e) => setRaiseToBe(e.target.checked)}
              id="raiseToBe"
            />
            <div className={styles.checkboxBody}>
              <label htmlFor="raiseToBe" className={styles.checkboxTitle}>
                Raise stop to breakeven (or better)
              </label>
              <span className={styles.checkboxSub}>
                Used for live portfolio risk &amp; heat calculations. Your
                original stop is still recorded on the trade record when the
                position closes (so journal R-multiples stay accurate).
              </span>
              {raiseToBe && (
                <div className={styles.subInput}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Breakeven Stop</span>
                    <div className={styles.prefixInput}>
                      <span className={styles.prefix}>$</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={beStop}
                        onChange={(e) => setBeStop(e.target.value)}
                        className={styles.numberInputInner}
                      />
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Setup</span>
            <select
              value={setupVal}
              onChange={(e) => { setSetupVal(e.target.value); markTouched('setupVal') }}
              className={styles.select}
            >
              <option value="">— none —</option>
              {/* include any setup the position already has, even if it's been removed from settings */}
              {setupVal && !setups.includes(setupVal) && (
                <option value={setupVal}>{setupVal}</option>
              )}
              {setups.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); markTouched('notes') }}
              className={styles.textarea}
              rows={3}
            />
          </label>

          {errorMsg && <div className={styles.errorBanner} role="alert">{errorMsg}</div>}
        </div>

        <div className={styles.footer}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
