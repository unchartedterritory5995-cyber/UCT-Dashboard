// app/src/components/chart/IndicatorAlertPopover.jsx
// Popover for managing chart indicator alerts on the current symbol.
// Pattern mirrors ComparisonPicker.jsx (top:40px, right:8px, position absolute inside the chart wrapper).
import { useState, useMemo, useRef, useEffect } from 'react'
import styles from './IndicatorAlertPopover.module.css'
import {
  useIndicatorAlerts,
  createIndicatorAlert,
  deleteIndicatorAlert,
  toggleIndicatorAlert,
} from '../../hooks/useIndicatorAlerts'
import { formatET } from '../../utils/timeAgo'
import UIcon from '../ui/UIcon'

const INDICATORS = [
  { value: 'rsi', label: 'RSI' },
  { value: 'macd', label: 'MACD' },
  { value: 'bb', label: 'Bollinger Bands' },
  { value: 'stoch', label: 'Stochastic' },
  { value: 'williams_r', label: 'Williams %R' },
  { value: 'cci', label: 'CCI' },
  { value: 'mfi', label: 'MFI' },
  { value: 'price_vs_ma', label: 'Price vs MA' },
]

// Oscillator-style conditions reused for several indicators.
const OSCILLATOR_CONDITIONS = [
  { value: 'above', label: 'Above threshold' },
  { value: 'below', label: 'Below threshold' },
  { value: 'cross_above', label: 'Crosses above' },
  { value: 'cross_below', label: 'Crosses below' },
]

const CONDITIONS = {
  rsi: OSCILLATOR_CONDITIONS,
  stoch: OSCILLATOR_CONDITIONS,
  williams_r: OSCILLATOR_CONDITIONS,
  cci: OSCILLATOR_CONDITIONS,
  mfi: OSCILLATOR_CONDITIONS,
  macd: [
    { value: 'cross_above', label: 'Crosses above signal' },
    { value: 'cross_below', label: 'Crosses below signal' },
    { value: 'cross_zero', label: 'Crosses zero line' },
  ],
  bb: [
    { value: 'touch_upper', label: 'Price touches upper band' },
    { value: 'touch_lower', label: 'Price touches lower band' },
  ],
  price_vs_ma: [
    { value: 'above', label: 'Price above MA' },
    { value: 'below', label: 'Price below MA' },
  ],
}

const TFS = [
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '60', label: '1h' },
  { value: 'D', label: 'Daily' },
]

// Conditions that read a numeric threshold from the input.
const THRESHOLD_CONDITIONS = new Set(['above', 'below', 'cross_above', 'cross_below'])

const INDICATOR_LABELS = Object.fromEntries(INDICATORS.map((i) => [i.value, i.label]))

function conditionLabel(indicator, condition) {
  const list = CONDITIONS[indicator] || []
  const found = list.find((c) => c.value === condition)
  return found ? found.label : condition
}

function fmtTriggeredAt(epochSec) {
  if (!epochSec) return null
  return formatET(epochSec * 1000)
}

export default function IndicatorAlertPopover({ sym, onClose }) {
  const ownSym = sym ? String(sym).toUpperCase() : ''
  const { alerts } = useIndicatorAlerts()

  const [indicator, setIndicator] = useState('rsi')
  const [condition, setCondition] = useState('above')
  const [threshold, setThreshold] = useState('70')
  const [tf, setTf] = useState('D')
  const [submitting, setSubmitting] = useState(false)
  const firstFieldRef = useRef(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  // When the indicator changes, reset to a sensible default condition for it.
  useEffect(() => {
    const list = CONDITIONS[indicator] || []
    if (!list.find((c) => c.value === condition)) {
      setCondition(list[0]?.value || '')
    }
    // sensible default thresholds per indicator
    if (indicator === 'rsi' || indicator === 'mfi') setThreshold('70')
    else if (indicator === 'williams_r') setThreshold('-20')
    else if (indicator === 'cci') setThreshold('100')
    else if (indicator === 'stoch') setThreshold('80')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator])

  const needsThreshold = THRESHOLD_CONDITIONS.has(condition)
  const conditionOptions = CONDITIONS[indicator] || []

  // Alerts filtered to this symbol; most-recently created first.
  const symAlerts = useMemo(() => {
    return alerts
      .filter((a) => String(a.sym || '').toUpperCase() === ownSym)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }, [alerts, ownSym])

  async function handleAdd(e) {
    e?.preventDefault?.()
    if (!ownSym || submitting) return
    const payload = {
      sym: ownSym,
      indicator,
      condition,
      tf,
    }
    if (needsThreshold) {
      const num = parseFloat(threshold)
      if (!Number.isFinite(num)) return
      payload.threshold = num
    }
    setSubmitting(true)
    try {
      await createIndicatorAlert(payload)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.popover} role="dialog" aria-label="Indicator alerts">
      <div className={styles.header}>
        <span className={styles.title}>
          Indicator Alerts
          {ownSym && <span className={styles.sym}>{ownSym}</span>}
        </span>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <form className={styles.form} onSubmit={handleAdd}>
        <div className={styles.row}>
          <span className={styles.label}>Indicator</span>
          <select
            ref={firstFieldRef}
            className={styles.select}
            value={indicator}
            onChange={(e) => setIndicator(e.target.value)}
          >
            {INDICATORS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Condition</span>
          <select
            className={styles.select}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            {conditionOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {needsThreshold && (
          <div className={styles.row}>
            <span className={styles.label}>Threshold</span>
            <input
              className={styles.input}
              type="number"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="e.g. 70"
            />
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Timeframe</span>
          <select className={styles.select} value={tf} onChange={(e) => setTf(e.target.value)}>
            {TFS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className={styles.addBtn}
          disabled={!ownSym || submitting || (needsThreshold && !threshold)}
        >
          {submitting ? 'Adding…' : 'Add Alert'}
        </button>
      </form>

      <div className={styles.listHeader}>
        Active alerts {ownSym ? `for ${ownSym}` : ''} ({symAlerts.length})
      </div>

      <div className={styles.list}>
        {symAlerts.length === 0 ? (
          <div className={styles.empty}>
            {ownSym ? 'No alerts on this symbol yet.' : 'Select a symbol to manage alerts.'}
          </div>
        ) : (
          symAlerts.map((a) => {
            const trigAt = fmtTriggeredAt(a.triggered_at)
            const indLbl = INDICATOR_LABELS[a.indicator] || a.indicator
            const condLbl = conditionLabel(a.indicator, a.condition)
            const thrTxt =
              a.threshold !== null && a.threshold !== undefined ? ` @ ${a.threshold}` : ''
            return (
              <div
                key={a.id}
                className={`${styles.alertRow} ${!a.active ? styles.inactive : ''} ${
                  trigAt ? styles.triggered : ''
                }`}
              >
                <div className={styles.alertMain}>
                  <div className={styles.alertText}>
                    {indLbl} {condLbl}
                    {thrTxt} · {a.tf}
                  </div>
                  <div className={styles.alertSub}>
                    {trigAt && (
                      <>
                        <span className={styles.trigCheck}><UIcon name="check" size={13} /></span>
                        <span>Triggered {trigAt}</span>
                      </>
                    )}
                    {!trigAt && a.last_value !== null && a.last_value !== undefined && (
                      <span>last: {Number(a.last_value).toFixed(2)}</span>
                    )}
                    {a.trigger_count > 0 && <span>· {a.trigger_count}×</span>}
                  </div>
                </div>
                <button
                  className={`${styles.toggle} ${a.active ? styles.on : ''}`}
                  onClick={() => toggleIndicatorAlert(a.id)}
                  title={a.active ? 'Disable' : 'Enable'}
                >
                  {a.active ? 'ON' : 'OFF'}
                </button>
                <button
                  className={styles.remove}
                  onClick={() => deleteIndicatorAlert(a.id)}
                  title="Delete alert"
                  aria-label="Delete alert"
                >
                  ×
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
