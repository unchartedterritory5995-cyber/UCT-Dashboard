/**
 * Add Option Strategy modal.
 *
 * Two-step flow:
 *   1. Pick strategy template (icon grid)
 *   2. Fill underlying, entry date, per-leg details (strike/exp/qty/entry$),
 *      fees, setup, notes, direction
 *
 * Sticky footer shows live calc — net entry, debit/credit label, max risk,
 * DTE, total fees — and the Save button.
 */

import { useState, useId, useEffect, useMemo, useCallback } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import StrategyIcon from './StrategyIcon'
import {
  STRATEGY_TEMPLATES,
  STRATEGY_TEMPLATES_BY_CATEGORY,
} from '../../lib/strategyTemplates'
import {
  computeNetEntry,
  computeMaxRisk,
  computeDaysToExpiration,
  classifyDebitCredit,
  prettyStrategyType,
} from '../../lib/optionCalcs'
import { money, moneySigned } from '../../../../lib/journal-2-0'
import styles from './AddOptionStrategyModal.module.css'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

export default function AddOptionStrategyModal({
  defaultFeePerContract = 0,
  setups = [],
  accountName,
  onSave,
  onClose,
}) {
  const titleId = useId()
  const [step, setStep] = useState(1) // 1 = picker, 2 = form
  const [templateKey, setTemplateKey] = useState(null)

  // Common fields
  const [underlying, setUnderlying] = useState('')
  const [direction, setDirection] = useState('bullish')
  const [entryDate, setEntryDate] = useState(TODAY_ISO())
  const [setup, setSetup] = useState('')
  const [notes, setNotes] = useState('')
  const [fees, setFees] = useState('')
  // Tri-state: null = never auto-filled, true = auto, false = user touched
  const [feesAutoFilled, setFeesAutoFilled] = useState(null)
  const [legs, setLegs] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // When the user picks a template, seed the legs and direction.
  const pickTemplate = useCallback((key) => {
    const tpl = STRATEGY_TEMPLATES[key]
    if (!tpl) return
    setTemplateKey(key)
    setDirection(tpl.direction)
    setLegs(tpl.legs.map(l => ({ ...l })))
    setStep(2)
  }, [])

  // Live-calc derivations
  const netEntry = useMemo(() => computeNetEntry(legs), [legs])
  const creditDebit = classifyDebitCredit(netEntry)
  const maxRisk = useMemo(
    () => computeMaxRisk(templateKey, legs, netEntry),
    [templateKey, legs, netEntry],
  )
  const dte = useMemo(() => computeDaysToExpiration(legs), [legs])

  // Auto-fill fees based on defaultFeePerContract × total contracts.
  // Runs once on initial template pick (feesAutoFilled === null) and
  // on subsequent leg qty changes only if the current value is still
  // the auto-filled one (feesAutoFilled === true). Never overrides a
  // user edit or a deliberate clear.
  useEffect(() => {
    if (!defaultFeePerContract || defaultFeePerContract <= 0) return
    if (!legs.length) return
    if (feesAutoFilled === false) return  // user touched — hands-off
    const totalContracts = legs.reduce((s, l) => s + (Number(l.qty) || 0), 0)
    if (totalContracts === 0) return
    const auto = Math.round(defaultFeePerContract * totalContracts * 100) / 100
    setFees(String(auto))
    setFeesAutoFilled(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, defaultFeePerContract])

  const updateLeg = (idx, patch) => {
    setLegs((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  const addLeg = () => {
    if (legs.length >= 8) return
    setLegs([...legs, {
      side: 'buy', contractType: 'call',
      strike: '', expiration: '', qty: 1, entryPrice: '',
    }])
  }

  const removeLeg = (idx) => {
    if (legs.length <= 1) return
    setLegs(legs.filter((_, i) => i !== idx))
  }

  const validate = () => {
    if (!underlying.trim()) return 'Underlying symbol is required.'
    if (underlying.trim().length > 16) return 'Underlying symbol too long.'
    if (!entryDate) return 'Entry date is required.'
    if (legs.length === 0) return 'At least one leg is required.'
    if (legs.length > 8) return 'Max 8 legs.'
    const today = TODAY_ISO()
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i]
      if (!l.strike || Number(l.strike) <= 0) return `Leg ${i + 1}: strike must be > 0.`
      if (!l.expiration) return `Leg ${i + 1}: expiration is required.`
      if (l.expiration < today) return `Leg ${i + 1}: expiration is in the past.`
      if (!l.qty || Number(l.qty) <= 0) return `Leg ${i + 1}: qty must be > 0.`
      if (!Number.isInteger(Number(l.qty))) return `Leg ${i + 1}: qty must be a whole number.`
      if (l.entryPrice === '' || Number(l.entryPrice) < 0) {
        return `Leg ${i + 1}: entry price must be ≥ 0.`
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
        underlying: underlying.trim().toUpperCase(),
        strategy_type: templateKey,
        direction,
        entry_date: entryDate,
        fees: fees === '' ? 0 : Number(fees),
        setup: setup || null,
        notes: notes || null,
        linked_playbook_id: null,
        legs: legs.map((l) => ({
          side: l.side,
          contract_type: l.contractType,
          strike: Number(l.strike),
          expiration: l.expiration,
          qty: Number(l.qty),
          entry_price: Number(l.entryPrice),
        })),
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
            {step === 1 ? 'New Option Strategy' : `New ${prettyStrategyType(templateKey)}`}
          </h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {accountName && (
          <div className={styles.accountBanner}>
            Adding to <strong>{accountName}</strong>
          </div>
        )}

        <div className={styles.body}>
          {step === 1 && (
            <TemplatePicker onPick={pickTemplate} />
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => setStep(1)}
              >
                ← Change strategy
              </button>

              {errorMsg && (
                <div className={styles.errorBanner} role="alert">{errorMsg}</div>
              )}

              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Underlying *</span>
                  <input
                    type="text"
                    value={underlying}
                    onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
                    className={styles.textInput}
                    placeholder="e.g. NVDA"
                    autoFocus
                    maxLength={16}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Direction</span>
                  <div className={styles.pillToggle}>
                    {['bullish', 'bearish', 'neutral'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`${styles.pill} ${direction === d ? styles.pillActive : ''}`}
                        onClick={() => setDirection(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </label>
              </div>

              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Entry Date *</span>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    max={TODAY_ISO()}
                    className={styles.textInput}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    Fees
                    {feesAutoFilled && <span className={styles.autoTag}> auto</span>}
                  </span>
                  <div className={styles.prefixInput}>
                    <span className={styles.prefix}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={fees}
                      onChange={(e) => { setFees(e.target.value); setFeesAutoFilled(false) }}
                      className={styles.numberInputInner}
                      placeholder="0.00"
                    />
                  </div>
                </label>
              </div>

              <LegsEditor
                legs={legs}
                onChange={updateLeg}
                onAdd={addLeg}
                onRemove={removeLeg}
                strategyType={templateKey}
              />

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Setup</span>
                {setups.length > 0 ? (
                  <div className={styles.setupRow}>
                    <input
                      list={`${titleId}-setup-list`}
                      value={setup}
                      onChange={(e) => setSetup(e.target.value)}
                      className={styles.textInput}
                      placeholder="Pick or type a setup"
                    />
                    <datalist id={`${titleId}-setup-list`}>
                      {setups.map((s) => <option key={s} value={s}>{s}</option>)}
                    </datalist>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={setup}
                    onChange={(e) => setSetup(e.target.value)}
                    className={styles.textInput}
                    placeholder="e.g. IV crush, earnings play"
                  />
                )}
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={styles.textarea}
                  placeholder="Thesis, plan, context…"
                  rows={3}
                />
              </label>

              {STRATEGY_TEMPLATES[templateKey]?.hints && (
                <div className={styles.hintBox}>
                  <div className={styles.hintTitle}>Coaching</div>
                  {STRATEGY_TEMPLATES[templateKey].hints.map((h, i) => (
                    <div key={i} className={styles.hintLine}>• {h}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {step === 2 && (
          <div className={styles.stickyFooter}>
            <LiveCalc
              netEntry={netEntry}
              creditDebit={creditDebit}
              maxRisk={maxRisk}
              dte={dte}
              fees={fees === '' ? 0 : Number(fees)}
            />
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
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Create Strategy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TemplatePicker({ onPick }) {
  return (
    <div className={styles.pickerWrap}>
      {Object.entries(STRATEGY_TEMPLATES_BY_CATEGORY).map(([cat, tpls]) => (
        <div key={cat} className={styles.pickerGroup}>
          <div className={styles.pickerGroupTitle}>{cat}</div>
          <div className={styles.pickerGrid}>
            {tpls.map((tpl) => (
              <button
                key={tpl.type}
                type="button"
                className={styles.pickerCard}
                onClick={() => onPick(tpl.type)}
                title={tpl.label}
              >
                <StrategyIcon type={tpl.type} size={36} />
                <div className={styles.pickerLabel}>{tpl.label}</div>
                <div className={styles.pickerDirection}>
                  {tpl.direction === 'bullish' && '↗ bullish'}
                  {tpl.direction === 'bearish' && '↘ bearish'}
                  {tpl.direction === 'neutral' && '— neutral'}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function LegsEditor({ legs, onChange, onAdd, onRemove, strategyType }) {
  return (
    <div className={styles.legsWrap}>
      <div className={styles.legsHeader}>
        <span className={styles.legsTitle}>Legs</span>
        {strategyType !== 'custom' && strategyType !== 'calendar' && strategyType !== 'diagonal' && (
          <span className={styles.legsHint}>
            Template-seeded — fill strike, exp, qty, price.
          </span>
        )}
        <button
          type="button"
          className={styles.addLegBtn}
          onClick={onAdd}
          disabled={legs.length >= 8}
        >
          + Add leg
        </button>
      </div>
      <table className={styles.legsTable}>
        <thead>
          <tr>
            <th>#</th>
            <th>Side</th>
            <th>Type</th>
            <th>Strike</th>
            <th>Expiration</th>
            <th>Qty</th>
            <th>Entry $</th>
            <th aria-label="remove" />
          </tr>
        </thead>
        <tbody>
          {legs.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <select
                  value={l.side}
                  onChange={(e) => onChange(i, { side: e.target.value })}
                  className={styles.legSelect}
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </td>
              <td>
                <select
                  value={l.contractType}
                  onChange={(e) => onChange(i, { contractType: e.target.value })}
                  className={styles.legSelect}
                >
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={l.strike}
                  onChange={(e) => onChange(i, { strike: e.target.value })}
                  className={styles.legInput}
                  placeholder="550"
                />
              </td>
              <td>
                <input
                  type="date"
                  value={l.expiration}
                  onChange={(e) => onChange(i, { expiration: e.target.value })}
                  min={TODAY_ISO()}
                  className={styles.legInput}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={l.qty}
                  onChange={(e) => onChange(i, { qty: e.target.value })}
                  className={styles.legInput}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.entryPrice}
                  onChange={(e) => onChange(i, { entryPrice: e.target.value })}
                  className={styles.legInput}
                  placeholder="5.00"
                />
              </td>
              <td>
                <button
                  type="button"
                  className={styles.removeLegBtn}
                  onClick={() => onRemove(i)}
                  disabled={legs.length <= 1}
                  aria-label={`Remove leg ${i + 1}`}
                >
                  <UIcon name="x" size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LiveCalc({ netEntry, creditDebit, maxRisk, dte, fees }) {
  const entryLabel =
    creditDebit === 'credit' ? 'Net Credit' :
    creditDebit === 'debit'  ? 'Net Debit'  : 'Net Entry'
  // No sign prefix — the label tells direction. Tone reserved for P&L.
  return (
    <div className={styles.liveCalc}>
      <Cell
        label={entryLabel}
        value={money(Math.abs(netEntry))}
      />
      <Cell
        label="Fees"
        value={money(fees || 0)}
      />
      <Cell
        label="Max Risk"
        value={maxRisk == null ? '—' : money(maxRisk)}
        warn={maxRisk == null}
        warnTitle={maxRisk == null ? 'Undefined (naked short / custom)' : undefined}
      />
      <Cell
        label="DTE"
        value={dte == null ? '—' : `${dte}d`}
        warn={dte != null && dte <= 7}
      />
    </div>
  )
}

function Cell({ label, value, tone, warn, warnTitle }) {
  return (
    <div className={styles.calcCell} title={warnTitle}>
      <div className={styles.calcLabel}>{label}</div>
      <div
        className={[
          styles.calcValue,
          tone === 'pos' ? styles.pos : '',
          tone === 'neg' ? styles.neg : '',
          warn ? styles.warn : '',
        ].filter(Boolean).join(' ')}
      >
        {value}
      </div>
    </div>
  )
}
