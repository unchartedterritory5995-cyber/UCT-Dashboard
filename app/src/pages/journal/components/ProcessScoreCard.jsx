// app/src/pages/journal/components/ProcessScoreCard.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import styles from './ProcessScoreCard.module.css'

const DIMENSIONS = [
  { key: 'ps_setup', label: 'Setup Quality', desc: 'Was this an A+ pattern with proper characteristics?' },
  { key: 'ps_entry', label: 'Entry Quality', desc: 'Did you enter at the right price, time, and trigger?' },
  { key: 'ps_exit', label: 'Exit Quality', desc: 'Did you exit according to plan, not emotion?' },
  { key: 'ps_sizing', label: 'Sizing Discipline', desc: 'Was your position size appropriate for the setup?' },
  { key: 'ps_stop', label: 'Stop Discipline', desc: 'Was your stop placed and honored correctly?' },
]

function scoreColor(score) {
  if (score >= 61) return 'var(--gain)'
  if (score >= 31) return 'var(--warn)'
  return 'var(--loss)'
}

function outcomeColor(score) {
  if (score >= 60) return 'var(--gain)'
  if (score >= 30) return 'var(--warn)'
  return 'var(--loss)'
}

function hasAnyScore(trade) {
  return trade.ps_setup != null || trade.ps_entry != null || trade.ps_exit != null ||
    trade.ps_sizing != null || trade.ps_stop != null || trade.outcome_score != null
}

export default function ProcessScoreCard({ trade, onUpdate }) {
  const [showScoring, setShowScoring] = useState(() => hasAnyScore(trade))
  const [values, setValues] = useState({
    ps_setup: trade.ps_setup ?? 10,
    ps_entry: trade.ps_entry ?? 10,
    ps_exit: trade.ps_exit ?? 10,
    ps_sizing: trade.ps_sizing ?? 10,
    ps_stop: trade.ps_stop ?? 10,
  })
  const [outcomeScore, setOutcomeScore] = useState(trade.outcome_score ?? 50)
  const debounceRef = useRef(null)

  // Sync from trade prop when tradeId changes
  useEffect(() => {
    setValues({
      ps_setup: trade.ps_setup ?? 10,
      ps_entry: trade.ps_entry ?? 10,
      ps_exit: trade.ps_exit ?? 10,
      ps_sizing: trade.ps_sizing ?? 10,
      ps_stop: trade.ps_stop ?? 10,
    })
    setOutcomeScore(trade.outcome_score ?? 50)
    setShowScoring(hasAnyScore(trade))
  }, [trade.id])

  const totalProcess = Object.values(values).reduce((a, b) => a + b, 0)

  const debouncedUpdate = useCallback((updates) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onUpdate(updates)
    }, 500)
  }, [onUpdate])

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function handleSlider(key, val) {
    const intVal = parseInt(val)
    setValues(prev => {
      const next = { ...prev, [key]: intVal }
      debouncedUpdate(next)
      return next
    })
  }

  function handleOutcome(val) {
    const intVal = parseInt(val)
    setOutcomeScore(intVal)
    debouncedUpdate({ outcome_score: intVal })
  }

  if (!showScoring) {
    return (
      <div className={styles.card}>
        <div className={styles.notScored}>
          <div className={styles.notScoredLabel}>NOT YET SCORED</div>
          <div className={styles.notScoredText}>
            Rate your process across 5 dimensions to build your scoring history.
          </div>
          <button className={styles.scoreBtn} onClick={() => setShowScoring(true)}>
            Score This Trade
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      {/* 5 Dimension sliders */}
      <div className={styles.sliders}>
        {DIMENSIONS.map(dim => (
          <div key={dim.key} className={styles.sliderRow}>
            <div className={styles.sliderHeader}>
              <span className={styles.sliderLabel}>{dim.label}</span>
              <span className={styles.sliderValue}>{values[dim.key]}/20</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={values[dim.key]}
              onChange={e => handleSlider(dim.key, e.target.value)}
              className={styles.slider}
              style={{
                background: `linear-gradient(to right, ${scoreColor(values[dim.key] * 5)} 0%, ${scoreColor(values[dim.key] * 5)} ${values[dim.key] * 5}%, var(--border) ${values[dim.key] * 5}%, var(--border) 100%)`,
              }}
            />
            <div className={styles.sliderDesc}>{dim.desc}</div>
          </div>
        ))}
      </div>

      {/* Total process score */}
      <div className={styles.totalRow}>
        <span className={styles.totalLabel}>PROCESS SCORE</span>
        <span className={styles.totalValue} style={{ color: scoreColor(totalProcess) }}>
          {totalProcess}
          <span className={styles.totalMax}>/100</span>
        </span>
      </div>

      {/* Process score bar */}
      <div className={styles.barWrap}>
        <div className={styles.barLabel}>Process</div>
        <div className={styles.barTrack}>
          <div
            className={styles.barFill}
            style={{ width: `${totalProcess}%`, background: scoreColor(totalProcess) }}
          />
        </div>
      </div>

      {/* Outcome score */}
      <div className={styles.outcomeSection}>
        <div className={styles.outcomeHeader}>
          <span className={styles.outcomeLabel}>OUTCOME SCORE</span>
          <span className={styles.outcomeValue} style={{ color: outcomeColor(outcomeScore) }}>
            {outcomeScore}
            <span className={styles.totalMax}>/100</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={outcomeScore}
          onChange={e => handleOutcome(e.target.value)}
          className={styles.slider}
          style={{
            background: `linear-gradient(to right, ${outcomeColor(outcomeScore)} 0%, ${outcomeColor(outcomeScore)} ${outcomeScore}%, var(--border) ${outcomeScore}%, var(--border) 100%)`,
          }}
        />
      </div>

      {/* Outcome bar (comparison) */}
      <div className={styles.barWrap}>
        <div className={styles.barLabel}>Outcome</div>
        <div className={styles.barTrack}>
          <div
            className={styles.barFill}
            style={{ width: `${outcomeScore}%`, background: 'var(--info)' }}
          />
        </div>
      </div>

      {/* Divergence indicator */}
      {Math.abs(totalProcess - outcomeScore) >= 20 && (
        <div className={styles.divergence}>
          {totalProcess > outcomeScore
            ? 'Good process, poor outcome \u2014 stay the course, variance will correct.'
            : 'Poor process, good outcome \u2014 review your discipline, luck fades.'}
        </div>
      )}
    </div>
  )
}
