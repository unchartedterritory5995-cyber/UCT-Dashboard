/**
 * Add Position modal — Journal 2.0.
 * Spec §8.
 *
 * Manual entry only in Phase 4. Stop-price prefill logic honors
 * `settings.defaultStop`:
 *   - custom: blank
 *   - bar_low_high: blank (no bar context in manual entry — helper text shown)
 *   - fixed_dollar_risk: stop = entry − (amount / shares) on blur (Long)
 *                       or entry + (amount / shares) (Short); clamp ≥ 0
 *   - fixed_percent_distance: entry × (1 − p/100) (Long) or × (1 + p/100) (Short)
 */

import { useState, useCallback, useId, useEffect } from 'react'
import styles from './ModalShell.module.css'
import {
  computeDefaultShares,
  computeSuggestedTarget,
  computeImpliedRiskPct,
} from '../lib/disciplineGuards'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2DisciplineState from '../hooks/useJ2DisciplineState'
import DisciplineLockBanner from './DisciplineLockBanner'
import useJ2SetupStats from '../hooks/useJ2SetupStats'
import SetupStatsPanel from './SetupStatsPanel'
import useJ2CurrentRegime from '../hooks/useJ2CurrentRegime'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

function prefillStop({ side, sharesVal, entryVal, defaultStop, barLow, barHigh }) {
  const shares = Number(sharesVal)
  const entry = Number(entryVal)
  if (!defaultStop || defaultStop.mode === 'custom') return ''
  if (!Number.isFinite(entry) || entry <= 0) return ''

  // Chart-right-click path: bar low/high available → compute immediately
  // for bar_low_high mode. No shares needed.
  if (defaultStop.mode === 'bar_low_high') {
    const anchor = side === 'Long' ? Number(barLow) : Number(barHigh)
    if (!Number.isFinite(anchor)) return ''  // manual entry — no bar context
    const buffer = Number(defaultStop.buffer) || 0
    const offset = defaultStop.bufferUnit === '%'
      ? anchor * (buffer / 100)
      : buffer
    const raw = side === 'Long' ? anchor - offset : anchor + offset
    return raw < 0 ? 0 : Math.round(raw * 100) / 100
  }

  if (defaultStop.mode === 'fixed_percent_distance') {
    const p = Number(defaultStop.percent) || 0
    if (p <= 0 || p >= 100) return ''
    const raw = side === 'Long' ? entry * (1 - p / 100) : entry * (1 + p / 100)
    return raw < 0 ? 0 : Math.round(raw * 100) / 100
  }

  // fixed_dollar_risk needs shares to distribute the $ risk across
  if (defaultStop.mode === 'fixed_dollar_risk') {
    if (!Number.isFinite(shares) || shares <= 0) return ''
    const amt = Number(defaultStop.amount) || 0
    if (amt <= 0) return ''
    const raw = side === 'Long' ? entry - amt / shares : entry + amt / shares
    return raw < 0 ? 0 : Math.round(raw * 100) / 100
  }

  return ''
}

export default function AddPositionModal({ settings, onSave, onClose, prefill, accountName }) {
  const titleId = useId()
  // `prefill` arrives from chart right-click (§8.2) — locks Symbol,
  // seeds Entry Price + Entry Date from the clicked bar, and stamps a
  // stop-source badge based on settings.defaultStop.
  const [symbol, setSymbol] = useState(prefill?.symbol || '')
  const [side, setSide] = useState('Long')
  const [entryDate, setEntryDate] = useState(prefill?.entryDate || TODAY_ISO())
  const [shares, setShares] = useState('')
  const [sharesUserEdited, setSharesUserEdited] = useState(false)
  const [entryPrice, setEntryPrice] = useState(
    prefill?.entryPrice != null ? String(prefill.entryPrice) : '',
  )
  const [stopPrice, setStopPrice] = useState('')
  const [stopUserEdited, setStopUserEdited] = useState(false)
  const [setup, setSetup] = useState('')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [overrideArmed, setOverrideArmed] = useState(false)

  const { accountId } = useJ2SelectedAccount()
  const { state: disciplineState } = useJ2DisciplineState(accountId)
  const [disciplineOverrideArmed, setDisciplineOverrideArmed] = useState(false)
  const { stats: setupStats } = useJ2SetupStats(accountId, setup)

  const { regime: regimeData } = useJ2CurrentRegime()
  const currentRegime = regimeData?.regime
  const regimeMult = (settings?.regimeSizeMultipliers || {})[currentRegime]
  const regimeMultActive = currentRegime != null && regimeMult != null && regimeMult !== 1

  const defaultStop = settings?.defaultStop
  const setups = settings?.setups ?? []
  const symbolLocked = !!prefill?.symbol

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Stop prefill on blur of shares/entryPrice/side — but never overwrite a
  // user-typed stop.
  const handleRecomputeStop = useCallback(() => {
    if (stopUserEdited) return
    const computed = prefillStop({
      side,
      sharesVal: shares,
      entryVal: entryPrice,
      defaultStop,
      barLow: prefill?.barLow,
      barHigh: prefill?.barHigh,
    })
    if (computed !== '' && computed !== stopPrice) {
      setStopPrice(String(computed))
    }
  }, [side, shares, entryPrice, defaultStop, stopPrice, stopUserEdited])

  // Also recompute on side-switch (different formula outcome).
  useEffect(() => {
    if (stopUserEdited) return
    const computed = prefillStop({
      side,
      sharesVal: shares,
      entryVal: entryPrice,
      defaultStop,
      barLow: prefill?.barLow,
      barHigh: prefill?.barHigh,
    })
    if (computed !== '') setStopPrice(String(computed))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side])

  // On mount, when chart-prefilled, auto-compute the stop so the user
  // doesn't have to blur an input to trigger it. bar_low_high +
  // fixed_percent_distance + fixed_dollar_risk (if shares default entered)
  // all populate immediately. Runs only once — afterward behaves like
  // manual entry (waits for blur).
  useEffect(() => {
    if (!prefill) return
    if (stopUserEdited) return
    const computed = prefillStop({
      side,
      sharesVal: shares,
      entryVal: entryPrice,
      defaultStop,
      barLow: prefill?.barLow,
      barHigh: prefill?.barHigh,
    })
    if (computed !== '') setStopPrice(String(computed))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-prefill shares from settings.defaultSizePct on entryPrice change.
  // Scales by regime multiplier when configured. Never overwrites a user-edited value.
  useEffect(() => {
    if (sharesUserEdited) return
    const baseSizePct = settings?.defaultSizePct
    const scaledSizePct = (baseSizePct != null && regimeMult != null)
      ? baseSizePct * regimeMult
      : baseSizePct
    const computed = computeDefaultShares({
      accountSize: settings?.accountSize,
      defaultSizePct: scaledSizePct,
      entryPrice,
    })
    if (computed != null && computed > 0) {
      setShares(String(computed))
    }
  }, [entryPrice, settings?.accountSize, settings?.defaultSizePct, regimeMult, sharesUserEdited])

  // Any change to risk-driving inputs resets the override so a user
  // can't arm-then-edit-up risk silently.
  useEffect(() => {
    setOverrideArmed(false)
  }, [shares, entryPrice, stopPrice, side])

  // Reset session-discipline override whenever the underlying lock state
  // changes (e.g., a no-trade window naturally closes, or a new loss exit
  // triggers a fresh cooling-off lock). The user must re-arm if it returns.
  useEffect(() => {
    if (!disciplineState?.locked) setDisciplineOverrideArmed(false)
  }, [disciplineState?.locked, disciplineState?.computedAt])

  const validate = useCallback(() => {
    if (!symbol.trim()) return 'Symbol is required'
    const s = Number(shares)
    if (!Number.isFinite(s) || s <= 0) return 'Shares must be > 0'
    const e = Number(entryPrice)
    if (!Number.isFinite(e) || e <= 0) return 'Entry price must be > 0'
    if (!entryDate) return 'Entry date is required'
    const sp = stopPrice === '' ? null : Number(stopPrice)
    if (sp != null) {
      if (!Number.isFinite(sp) || sp < 0) return 'Stop price must be non-negative'
      if (side === 'Long' && sp >= e) return 'Stop must be below entry for a Long position'
      if (side === 'Short' && sp <= e) return 'Stop must be above entry for a Short position'
    }
    return null
  }, [symbol, shares, entryPrice, entryDate, stopPrice, side])

  const handleSave = useCallback(async () => {
    setErrorMsg('')
    const err = validate()
    if (err) { setErrorMsg(err); return }
    setSaving(true)
    try {
      const payload = {
        symbol: symbol.trim().toUpperCase(),
        side,
        entryDate,
        shares: Number(shares),
        entryPrice: Number(entryPrice),
        stopPrice: stopPrice === '' ? null : Number(stopPrice),
        setup: setup.trim() || null,
        notes: notes.trim() || null,
      }
      await onSave(payload)
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }, [validate, symbol, side, entryDate, shares, entryPrice, stopPrice, setup, notes, onSave, onClose])

  const suggestedTarget = computeSuggestedTarget({
    side,
    entryPrice,
    stopPrice,
    rMultiple: settings?.defaultRMultipleTarget,
  })

  const impliedRiskPct = computeImpliedRiskPct({
    accountSize: settings?.accountSize,
    shares,
    entryPrice,
    stopPrice,
    side,
  })
  const baseCap = settings?.maxRiskPerTradePct
  const isAPlus = !!setup && (settings?.aPlusSetups || []).includes(setup)
  const multiplier = settings?.aPlusRiskMultiplier
  const effectiveCap = (baseCap != null && isAPlus && multiplier != null && multiplier > 1)
    ? baseCap * multiplier
    : baseCap
  const cap = effectiveCap
  const overCap = cap != null && impliedRiskPct != null && impliedRiskPct > cap

  const stopSourceBadge =
    defaultStop?.mode === 'custom'
      ? 'Custom'
      : defaultStop?.mode === 'bar_low_high'
        ? 'Bar low/high'
        : defaultStop?.mode === 'fixed_dollar_risk'
          ? 'Fixed $ Risk'
          : defaultStop?.mode === 'fixed_percent_distance'
            ? 'Fixed %'
            : null

  const hasBarContext = prefill?.barLow != null && prefill?.barHigh != null
  const stopHelperText =
    defaultStop?.mode === 'bar_low_high'
      ? hasBarContext
        ? `${side === 'Long' ? 'Bar low' : 'Bar high'} ± ${defaultStop.buffer || 0}${defaultStop.bufferUnit || '$'} — override by typing.`
        : 'No bar context in manual entry — enter manually.'
      : defaultStop?.mode === 'fixed_dollar_risk'
        ? `Auto-computed from Fixed $ Risk (${defaultStop.amount}) — enter shares to populate, or override by typing.`
        : defaultStop?.mode === 'fixed_percent_distance'
          ? `Auto-computed from Fixed % (${defaultStop.percent}%) — override by typing.`
          : null

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {prefill?.symbol ? `Add ${prefill.symbol} to Portfolio` : 'Add Position'}
          </h2>
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
                autoFocus={!symbolLocked}
                disabled={symbolLocked}
                readOnly={symbolLocked}
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
                onChange={(e) => { setShares(e.target.value); setSharesUserEdited(true) }}
                onBlur={handleRecomputeStop}
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
                  onChange={(e) => setEntryPrice(e.target.value)}
                  onBlur={handleRecomputeStop}
                  className={styles.numberInputInner}
                />
              </div>
            </label>
          </div>

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

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Stop Price
              {prefill && stopSourceBadge && (
                <span className={styles.sourceBadge}> {stopSourceBadge}</span>
              )}
            </span>
            <div className={styles.prefixInput}>
              <span className={styles.prefix}>$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={stopPrice}
                onChange={(e) => { setStopPrice(e.target.value); setStopUserEdited(true) }}
                className={styles.numberInputInner}
                placeholder="optional"
              />
            </div>
            {stopHelperText && <span className={styles.helper}>{stopHelperText}</span>}
          </label>
          {suggestedTarget != null && (
            <p
              className={styles.helper}
              style={{ color: 'var(--ut-gold, #c9a84c)', marginTop: 4 }}
            >
              Suggested target ({settings.defaultRMultipleTarget}R):{' '}
              <strong>${suggestedTarget.toFixed(2)}</strong>
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Setup</span>
            <select
              value={setup}
              onChange={(e) => setSetup(e.target.value)}
              className={styles.select}
            >
              <option value="">— none —</option>
              {setups.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
            <SetupStatsPanel stats={setupStats} isAPlus={isAPlus} />

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.textarea}
              rows={3}
            />
          </label>

          {regimeMultActive && (
            <div
              style={{
                margin: '0 0 12px',
                padding: '8px 12px',
                background: 'rgba(201, 168, 76, 0.08)',
                border: '1px solid rgba(201, 168, 76, 0.35)',
                borderRadius: 6,
                color: 'var(--text-bright)',
                fontSize: 12,
              }}
            >
              🎯 Regime is <strong>{currentRegime.toUpperCase()}</strong>.
              Default size scaled to <strong>{Math.round(regimeMult * 100)}%</strong>
              {regimeMult === 0 && ' — no size prefilled. Override by typing shares manually.'}
            </div>
          )}
          <DisciplineLockBanner
            state={disciplineState}
            overrideArmed={disciplineOverrideArmed}
            onArmOverride={() => setDisciplineOverrideArmed(true)}
          />
          {overCap && (
            <div
              role="alert"
              style={{
                margin: '0 0 12px',
                padding: '10px 14px',
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid var(--loss, #ef4444)',
                borderRadius: 8,
                color: 'var(--loss, #ef4444)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
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
                    style={{
                      marginLeft: 6, padding: '2px 10px',
                      background: 'transparent',
                      border: '1px solid var(--loss, #ef4444)',
                      color: 'var(--loss, #ef4444)',
                      borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    }}
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
            {saving ? 'Saving…' : 'Add Position'}
          </button>
        </div>
      </div>
    </div>
  )
}
