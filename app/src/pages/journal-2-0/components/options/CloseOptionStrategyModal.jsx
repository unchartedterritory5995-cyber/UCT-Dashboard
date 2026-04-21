/**
 * CloseOptionStrategyModal — per-leg exit price entry for an open strategy.
 *
 * Body posted to POST /api/j2/options/:id/close:
 *   exitPrices: { "0": 1.23, "1": 0.45, ... } keyed by leg_index
 *   exitDate:   "YYYY-MM-DD"
 *   exitFees:   number
 *   status:     "closed" | "expired" | "assigned" | "rolled"
 *   notes:      optional append string
 *
 * Live P&L preview shows gross P&L (exit − entry) and net (minus fees)
 * using optionCalcs mirror. Same fee-autofill story as Add modal.
 */

import { useState, useId, useEffect, useMemo } from 'react'
import StrategyIcon from './StrategyIcon'
import {
  computeNetEntry,
  computeNetExit,
  computePnl,
  computeMaxRisk,
  prettyStrategyType,
  buildStrategyLabel,
} from '../../lib/optionCalcs'
import { money, moneySigned, percent } from '../../../../lib/journal-2-0'
import styles from './AddOptionStrategyModal.module.css'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

const STATUS_OPTIONS = [
  { value: 'closed', label: 'Closed' },
  { value: 'expired', label: 'Expired' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'rolled', label: 'Rolled' },
]

export default function CloseOptionStrategyModal({
  strategy,
  defaultFeePerContract = 0,
  onSave,
  onClose,
}) {
  const titleId = useId()
  const legs = strategy.legs || []
  const [exitPrices, setExitPrices] = useState(
    () => Object.fromEntries(legs.map((l) => [String(l.legIndex), ''])),
  )
  const [exitDate, setExitDate] = useState(TODAY_ISO())
  const [exitFees, setExitFees] = useState('')
  const [feesAuto, setFeesAuto] = useState(null) // null | true | false
  const [status, setStatus] = useState('closed')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // When user picks "expired", all legs default to 0. Don't overwrite
  // explicit user prices though — only fill in the blanks.
  useEffect(() => {
    if (status !== 'expired') return
    setExitPrices((prev) => {
      const next = { ...prev }
      for (const l of legs) {
        const key = String(l.legIndex)
        if (next[key] === '' || next[key] === undefined) next[key] = '0'
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Auto-fill exit-side fees based on defaultFeePerContract × total contracts.
  useEffect(() => {
    if (!defaultFeePerContract || defaultFeePerContract <= 0) return
    if (feesAuto === false) return
    const totalContracts = legs.reduce((s, l) => s + (l.qty || 0), 0)
    if (totalContracts === 0) return
    const auto = Math.round(defaultFeePerContract * totalContracts * 100) / 100
    setExitFees(String(auto))
    setFeesAuto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFeePerContract])

  // Live P&L preview from entered exit prices (falls back to null if incomplete)
  const preview = useMemo(() => {
    const legsWithExit = legs.map((l) => {
      const raw = exitPrices[String(l.legIndex)]
      const exitPrice = raw === '' || raw == null ? null : Number(raw)
      return {
        side: l.side,
        qty: l.qty,
        entryPrice: l.entryPrice,
        exitPrice,
      }
    })
    const netExit = computeNetExit(legsWithExit)
    if (netExit == null) return null
    const feesNum = Number(strategy.fees) || 0
    const exitFeesNum = exitFees === '' ? 0 : Number(exitFees) || 0
    const pnl = computePnl(strategy.netEntry, netExit, feesNum, exitFeesNum)
    const pnlGross = Math.round((netExit - strategy.netEntry) * 100) / 100
    const maxRisk = computeMaxRisk(strategy.strategyType, legs, strategy.netEntry)
    const rMult = maxRisk != null && maxRisk > 0 ? pnl / maxRisk : null
    const pnlPct = Math.abs(strategy.netEntry) > 1e-9
      ? pnl / Math.abs(strategy.netEntry)
      : 0
    return { netExit, pnl, pnlGross, rMult, pnlPct }
  }, [legs, exitPrices, exitFees, strategy])

  const validate = () => {
    if (!exitDate) return 'Exit date is required.'
    for (const l of legs) {
      const raw = exitPrices[String(l.legIndex)]
      if (raw === '' || raw == null) {
        return `Exit price required for leg ${l.legIndex + 1}.`
      }
      if (Number(raw) < 0) {
        return `Leg ${l.legIndex + 1}: exit price must be ≥ 0.`
      }
    }
    return null
  }

  const submit = async () => {
    const e = validate()
    if (e) { setErrorMsg(e); return }
    setSaving(true)
    setErrorMsg('')
    try {
      const payload = {
        exitPrices: Object.fromEntries(
          Object.entries(exitPrices).map(([k, v]) => [k, Number(v)]),
        ),
        exitDate,
        exitFees: exitFees === '' ? 0 : Number(exitFees),
        status,
        ...(notes ? { notes } : {}),
      }
      await onSave?.(payload)
    } catch (err) {
      setErrorMsg(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Close {strategy.underlying} {prettyStrategyType(strategy.strategyType)}
          </h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={{ margin: '10px 22px 0', display: 'flex', gap: 10, alignItems: 'center' }}>
          <StrategyIcon type={strategy.strategyType} size={28} />
          <div style={{ fontSize: 13, color: 'var(--text-bright)' }}>
            {buildStrategyLabel(strategy)}
          </div>
        </div>

        <div className={styles.body}>
          {errorMsg && <div className={styles.errorBanner} role="alert">{errorMsg}</div>}

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Exit Date *</span>
              <input
                type="date"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                max={TODAY_ISO()}
                className={styles.textInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Outcome</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={styles.textInput}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.legsWrap}>
            <div className={styles.legsHeader}>
              <span className={styles.legsTitle}>Exit Prices (per leg)</span>
              {status === 'expired' && (
                <span className={styles.legsHint}>Defaulted to 0 (expired worthless)</span>
              )}
            </div>
            <table className={styles.legsTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Leg</th>
                  <th>Entry $</th>
                  <th>Exit $ *</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.legIndex + 1}</td>
                    <td>
                      <span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>
                        {l.side === 'buy' ? '+' : '−'}{l.qty} {l.contractType === 'call' ? 'C' : 'P'}
                      </span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                        {l.strike} · {l.expiration}
                      </span>
                    </td>
                    <td>${Number(l.entryPrice).toFixed(2)}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={exitPrices[String(l.legIndex)] ?? ''}
                        onChange={(e) => setExitPrices({
                          ...exitPrices,
                          [String(l.legIndex)]: e.target.value,
                        })}
                        className={styles.legInput}
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Exit Fees
              {feesAuto && <span className={styles.autoTag}> auto</span>}
            </span>
            <div className={styles.prefixInput}>
              <span className={styles.prefix}>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={exitFees}
                onChange={(e) => { setExitFees(e.target.value); setFeesAuto(false) }}
                className={styles.numberInputInner}
                placeholder="0.00"
              />
            </div>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Close Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.textarea}
              placeholder="What happened? Why did you close?"
              rows={3}
            />
          </label>
        </div>

        <div className={styles.stickyFooter}>
          <ClosePreview preview={preview} entryFees={strategy.fees} />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={submit}
              disabled={saving || !preview}
            >
              {saving ? 'Saving…' : 'Close Strategy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClosePreview({ preview, entryFees }) {
  if (!preview) {
    return (
      <div className={styles.liveCalc}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>
          Enter exit prices to see P&L preview
        </span>
      </div>
    )
  }
  const { pnl, pnlGross, rMult, pnlPct } = preview
  const tone = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : null
  return (
    <div className={styles.liveCalc}>
      <Cell label="Gross P&L" value={moneySigned(pnlGross)} tone={pnlGross > 0 ? 'pos' : pnlGross < 0 ? 'neg' : null} />
      <Cell label="Net P&L" value={moneySigned(pnl)} tone={tone} title={`After entry fees (${money(entryFees || 0)}) + exit fees`} />
      <Cell label="P&L %" value={percent(pnlPct, { dp: 1, isRatio: true, signed: true })} tone={tone} />
      <Cell label="R-Multiple" value={rMult == null ? '—' : `${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R`} tone={tone} />
    </div>
  )
}

function Cell({ label, value, tone, title }) {
  return (
    <div className={styles.calcCell} title={title}>
      <div className={styles.calcLabel}>{label}</div>
      <div
        className={[
          styles.calcValue,
          tone === 'pos' ? styles.pos : '',
          tone === 'neg' ? styles.neg : '',
        ].filter(Boolean).join(' ')}
      >
        {value}
      </div>
    </div>
  )
}
