/**
 * Add Trade modal — manual Add Trade flow.
 * Spec §11.4.
 *
 * Derived fields (pnl, r, holdDays, result) are computed server-side
 * on insert. positionId is a server-generated `manual-{uuid}` sentinel.
 */

import { useState, useCallback, useEffect, useId, useMemo } from 'react'
import {
  positionPnlDollar,
  tradeRMultiple,
  moneySigned,
  rMultiple as fmtR,
} from '../../../lib/journal-2-0'
import { computeImpliedRiskPct } from '../lib/disciplineGuards'
import styles from './ModalShell.module.css'
import bannerStyles from './AlertBanner.module.css'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2DisciplineState from '../hooks/useJ2DisciplineState'
import DisciplineLockBanner from './DisciplineLockBanner'
import useJ2SetupStats from '../hooks/useJ2SetupStats'
import SetupStatsPanel from './SetupStatsPanel'
import TagChipPicker from './TagChipPicker'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

export default function AddTradeModal({ settings, onSave, onClose, accountName }) {
  const titleId = useId()
  const setups = settings?.setups ?? []

  // Core fields
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState('Long')
  const [shares, setShares] = useState('')
  const [entryPrice, setEntryPrice] = useState('')
  const [entryDate, setEntryDate] = useState(TODAY_ISO())
  const [exitPrice, setExitPrice] = useState('')
  const [exitDate, setExitDate] = useState(TODAY_ISO())
  const [originalStop, setOriginalStop] = useState('')
  const [setupVal, setSetupVal] = useState('')
  const [notes, setNotes] = useState('')
  const [fees, setFees] = useState('')
  const [selectedMistakes, setSelectedMistakes] = useState([])
  const [selectedEmotions, setSelectedEmotions] = useState([])

  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [overrideArmed, setOverrideArmed] = useState(false)

  const { accountId } = useJ2SelectedAccount()
  const { state: disciplineState } = useJ2DisciplineState(accountId)
  const [disciplineOverrideArmed, setDisciplineOverrideArmed] = useState(false)
  const { stats: setupStats } = useJ2SetupStats(accountId, setupVal)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reset override on any change to the inputs that drive risk —
  // prevents arming the override and then editing risk up silently.
  useEffect(() => {
    setOverrideArmed(false)
  }, [shares, entryPrice, originalStop, side])

  // Reset session-discipline override when the underlying lock state changes.
  useEffect(() => {
    if (!disciplineState?.locked) setDisciplineOverrideArmed(false)
  }, [disciplineState?.locked, disciplineState?.computedAt])

  // Live preview of P&L + R-multiple, same pattern as ClosePositionModal.
  const preview = useMemo(() => {
    const s = Number(shares)
    const ep = Number(entryPrice)
    const xp = Number(exitPrice)
    if (!Number.isFinite(s) || s <= 0) return null
    if (!Number.isFinite(ep) || ep <= 0) return null
    if (!Number.isFinite(xp) || xp <= 0) return null
    const pseudo = { side, shares: s, entryPrice: ep }
    const pnlD = positionPnlDollar(pseudo, xp)
    const os = originalStop === '' ? ep : Number(originalStop)
    const r = tradeRMultiple({
      side,
      entryPrice: ep,
      exitPrice: xp,
      originalStop: Number.isFinite(os) ? os : ep,
    })
    return { pnlD, r }
  }, [shares, entryPrice, exitPrice, side, originalStop])

  const validate = useCallback(() => {
    if (!symbol.trim()) return 'Symbol is required'
    const s = Number(shares)
    if (!Number.isFinite(s) || s <= 0) return 'Shares must be > 0'
    const e = Number(entryPrice)
    if (!Number.isFinite(e) || e <= 0) return 'Entry price must be > 0'
    const x = Number(exitPrice)
    if (!Number.isFinite(x) || x <= 0) return 'Exit price must be > 0'
    if (!entryDate) return 'Entry date is required'
    if (!exitDate) return 'Exit date is required'
    if (exitDate < entryDate) return 'Exit date cannot be before entry date'
    if (originalStop !== '') {
      const os = Number(originalStop)
      if (!Number.isFinite(os) || os < 0) return 'Stop must be non-negative'
      if (os > 0) {
        if (side === 'Long' && os >= e) return 'Stop must be below entry for a Long trade'
        if (side === 'Short' && os <= e) return 'Stop must be above entry for a Short trade'
      }
    }
    return null
  }, [symbol, shares, entryPrice, exitPrice, entryDate, exitDate, originalStop, side])

  const handleSave = useCallback(async () => {
    setErrorMsg('')
    const err = validate()
    if (err) { setErrorMsg(err); return }
    setSaving(true)
    try {
      await onSave({
        symbol: symbol.trim().toUpperCase(),
        side,
        shares: Number(shares),
        entryPrice: Number(entryPrice),
        entryDate,
        exitPrice: Number(exitPrice),
        exitDate,
        originalStop: originalStop === '' ? null : Number(originalStop),
        setup: setupVal.trim() || null,
        notes: notes.trim() || null,
        fees: fees === '' ? 0 : Number(fees),
        mistakeTags: selectedMistakes,
        emotionTags: selectedEmotions,
        contextAtEntry: {},
      })
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }, [
    validate, symbol, side, shares, entryPrice, entryDate, exitPrice, exitDate,
    originalStop, setupVal, notes, fees, selectedMistakes, selectedEmotions, onSave, onClose,
  ])

  const impliedRiskPct = computeImpliedRiskPct({
    accountSize: settings?.accountSize,
    shares,
    entryPrice,
    stopPrice: originalStop,
    side,
  })
  const baseCap = settings?.maxRiskPerTradePct
  const isAPlus = !!setupVal && (settings?.aPlusSetups || []).includes(setupVal)
  const multiplier = settings?.aPlusRiskMultiplier
  const effectiveCap = (baseCap != null && isAPlus && multiplier != null && multiplier > 1)
    ? baseCap * multiplier
    : baseCap
  const cap = effectiveCap
  const overCap = cap != null && impliedRiskPct != null && impliedRiskPct > cap

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>Add Trade</h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        {accountName && (
          <div style={{
            margin: '10px 20px 0', padding: '6px 12px',
            background: 'var(--ut-gold-dim)', border: '1px solid var(--ut-gold-glow)',
            color: 'var(--text-bright)', borderRadius: 6, fontSize: 12,
          }}>
            Adding to <strong style={{ color: 'var(--ut-gold)' }}>{accountName}</strong>
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Symbol *</span>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className={styles.textInput}
                placeholder="e.g. NVDA"
                autoFocus
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Side</span>
              <div className={styles.pillToggle} role="radiogroup" aria-label="Side">
                {['Long', 'Short'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.pill} ${side === s ? styles.pillActive : ''}`}
                    onClick={() => setSide(s)}
                    aria-pressed={side === s}
                  >
                    {s}
                  </button>
                ))}
              </div>
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
                onChange={(e) => setShares(e.target.value)}
                className={styles.numberInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Original Stop</span>
              <div className={styles.prefixInput}>
                <span className={styles.prefix}>$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={originalStop}
                  onChange={(e) => setOriginalStop(e.target.value)}
                  className={styles.numberInputInner}
                  placeholder="optional"
                />
              </div>
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Entry Price *</span>
              <div className={styles.prefixInput}>
                <span className={styles.prefix}>$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  className={styles.numberInputInner}
                />
              </div>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Entry Date *</span>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className={styles.textInput}
                max={TODAY_ISO()}
              />
            </label>
          </div>

          <div className={styles.grid2}>
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

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Setup</span>
              <select
                value={setupVal}
                onChange={(e) => setSetupVal(e.target.value)}
                className={styles.select}
              >
                <option value="">— none —</option>
                {setups.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </label>
            <SetupStatsPanel stats={setupStats} isAPlus={isAPlus} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Fees / Commissions</span>
              <div className={styles.prefixInput}>
                <span className={styles.prefix}>$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={fees}
                  onChange={(e) => setFees(e.target.value)}
                  className={styles.numberInputInner}
                  placeholder="0.00"
                />
              </div>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.textarea}
              rows={2}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Mistakes (optional)</span>
            <TagChipPicker
              available={settings?.mistakeTags || []}
              selected={selectedMistakes}
              onChange={setSelectedMistakes}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Emotions (optional)</span>
            <TagChipPicker
              available={settings?.emotionTags || []}
              selected={selectedEmotions}
              onChange={setSelectedEmotions}
            />
          </div>

          {preview && (
            <div className={styles.infoBanner}>
              <span>Preview P&amp;L: <strong>{moneySigned(preview.pnlD)}</strong></span>
              <span>R-multiple: <strong>{fmtR(preview.r)}</strong></span>
            </div>
          )}

          <DisciplineLockBanner
            state={disciplineState}
            overrideArmed={disciplineOverrideArmed}
            onArmOverride={() => setDisciplineOverrideArmed(true)}
          />
          {overCap && (
            <div role="alert" className={bannerStyles.alert}>
              <strong>Over risk cap.</strong>{' '}
              Implied risk <strong>{impliedRiskPct.toFixed(2)}%</strong> exceeds
              your cap of <strong>{cap}%</strong>
              {isAPlus && multiplier != null && (
                <span style={{ opacity: 0.85 }}>
                  {' '}(A+ elevated from {baseCap}% × {multiplier})
                </span>
              )}.{' '}
              {overrideArmed
                ? 'Override armed — Save will commit anyway.'
                : (
                  <button
                    type="button"
                    onClick={() => setOverrideArmed(true)}
                    className={bannerStyles.alertOverrideBtn}
                  >
                    Override
                  </button>
                )}
            </div>
          )}
          {errorMsg && <div className={styles.errorBanner} role="alert">{errorMsg}</div>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={handleSave} disabled={
              saving
              || (overCap && !overrideArmed)
              || (disciplineState?.locked && !disciplineOverrideArmed)
            }>
            {saving ? 'Saving…' : 'Add Trade'}
          </button>
        </div>
      </div>
    </div>
  )
}
