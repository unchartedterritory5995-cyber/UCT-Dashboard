import { useEffect, useState } from 'react'
import styles from '../Backtester.module.css'

const TIMEFRAMES = [
  { value: 'D', label: 'Daily' },
  { value: 'W', label: 'Weekly' },
  { value: '1hr', label: '1hr' },
  { value: '30min', label: '30min' },
  { value: '5min', label: '5min' },
]

export default function StrategyForm({ strategies, loadingStrategies, onSubmit, running }) {
  const [strategyId, setStrategyId] = useState('')
  const [paramValues, setParamValues] = useState({})
  const [sym, setSym] = useState('AAPL')
  const [tf, setTf] = useState('D')
  const [bars, setBars] = useState(500)
  const [capital, setCapital] = useState(10000)
  const [positionPct, setPositionPct] = useState(100)
  const [feesBps, setFeesBps] = useState(10)

  // Set default strategy + reset params when strategy list changes
  useEffect(() => {
    if (!strategies || strategies.length === 0) return
    if (!strategyId || !strategies.find(s => s.id === strategyId)) {
      setStrategyId(strategies[0].id)
    }
  }, [strategies, strategyId])

  // Whenever strategy changes, reset its param values to defaults
  const selected = strategies?.find(s => s.id === strategyId)
  useEffect(() => {
    if (!selected) return
    const next = {}
    for (const p of (selected.params || [])) {
      next[p.name] = p.default
    }
    setParamValues(next)
  }, [strategyId, selected])

  const handleParamChange = (name, value) => {
    setParamValues(prev => ({ ...prev, [name]: value === '' ? '' : Number(value) }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!strategyId || running) return
    onSubmit({
      strategy_id: strategyId,
      sym: (sym || '').trim().toUpperCase(),
      tf,
      bars: Number(bars),
      capital: Number(capital),
      position_pct: Number(positionPct),
      fees_bps: Number(feesBps),
      params: paramValues,
    })
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label}>Strategy</label>
        <select
          className={styles.select}
          value={strategyId}
          onChange={e => setStrategyId(e.target.value)}
          disabled={loadingStrategies || !strategies?.length}
        >
          {(strategies || []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {selected?.description && (
          <div className={styles.fieldHint}>{selected.description}</div>
        )}
      </div>

      {selected?.params?.length > 0 && (
        <div className={styles.paramsBlock}>
          <div className={styles.paramsHeader}>Strategy params</div>
          {selected.params.map(p => (
            <div key={p.name} className={styles.field}>
              <label className={styles.labelInline}>{p.name}</label>
              <input
                className={styles.input}
                type="number"
                value={paramValues[p.name] ?? ''}
                min={p.min}
                max={p.max}
                step="any"
                onChange={e => handleParamChange(p.name, e.target.value)}
              />
              <div className={styles.fieldHint}>
                default {p.default}{p.min != null && p.max != null ? ` · range ${p.min}–${p.max}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>Symbol</label>
        <input
          className={styles.input}
          type="text"
          value={sym}
          onChange={e => setSym(e.target.value)}
          onBlur={e => setSym(e.target.value.trim().toUpperCase())}
          placeholder="AAPL"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Timeframe</label>
        <select className={styles.select} value={tf} onChange={e => setTf(e.target.value)}>
          {TIMEFRAMES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Bars</label>
        <input
          className={styles.input}
          type="number"
          value={bars}
          min={30}
          max={5000}
          onChange={e => setBars(e.target.value)}
        />
        <div className={styles.fieldHint}>30 – 5000</div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Capital ($)</label>
        <input
          className={styles.input}
          type="number"
          value={capital}
          min={1}
          onChange={e => setCapital(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Position size (%)</label>
        <input
          className={styles.input}
          type="number"
          value={positionPct}
          min={1}
          max={100}
          onChange={e => setPositionPct(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Fees (bps)</label>
        <input
          className={styles.input}
          type="number"
          value={feesBps}
          min={0}
          max={100}
          onChange={e => setFeesBps(e.target.value)}
        />
        <div className={styles.fieldHint}>10 bps = 0.1%</div>
      </div>

      <button className={styles.submitBtn} type="submit" disabled={running || !strategyId}>
        {running ? 'Running…' : 'Run Backtest'}
      </button>
    </form>
  )
}
