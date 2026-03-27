// app/src/components/PositionCalc.jsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import styles from './PositionCalc.module.css'

const LS_KEY = 'uct_pos_calc_account'
const DEFAULT_ACCOUNT = 50000
const DEFAULT_RISK_PCT = 1.0

function getStoredAccount() {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v) {
      const n = parseFloat(v)
      if (n > 0 && isFinite(n)) return n
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_ACCOUNT
}

function fmtDollars(v) {
  if (v == null || !isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtShares(v) {
  if (v == null || !isFinite(v) || v <= 0) return '—'
  return Math.floor(v).toLocaleString()
}

function fmtRatio(v) {
  if (v == null || !isFinite(v) || v <= 0) return '—'
  return v.toFixed(1) + 'R'
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '—'
  return v.toFixed(2) + '%'
}

export default function PositionCalc({ currentPrice, stopPrice: uct20Stop }) {
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState(getStoredAccount)
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [riskPct, setRiskPct] = useState(DEFAULT_RISK_PCT)

  // Pre-fill entry from live price when opening (only once per open)
  useEffect(() => {
    if (open && currentPrice && !entry) {
      setEntry(currentPrice.toFixed(2))
    }
  }, [open, currentPrice]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill stop from UCT20 stop or -6% default when opening
  useEffect(() => {
    if (open && !stop) {
      if (uct20Stop) {
        setStop(uct20Stop.toFixed(2))
      } else if (currentPrice) {
        setStop((currentPrice * 0.94).toFixed(2))
      }
    }
  }, [open, uct20Stop, currentPrice]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist account to localStorage
  const handleAccountChange = useCallback((val) => {
    setAccount(val)
    try { localStorage.setItem(LS_KEY, val) } catch { /* noop */ }
  }, [])

  // Parse inputs
  const entryNum = parseFloat(entry)
  const stopNum = parseFloat(stop)
  const targetNum = parseFloat(target)

  // Computed values
  const computed = useMemo(() => {
    const entryOk = isFinite(entryNum) && entryNum > 0
    const stopOk = isFinite(stopNum) && stopNum > 0
    const acctOk = isFinite(account) && account > 0
    const targetOk = isFinite(targetNum) && targetNum > 0

    if (!entryOk || !stopOk || !acctOk) return null

    const riskPerShare = Math.abs(entryNum - stopNum)
    if (riskPerShare === 0) return null

    const riskAmount = (account * riskPct) / 100
    const shares = Math.floor(riskAmount / riskPerShare)
    const positionValue = shares * entryNum
    const actualRisk = shares * riskPerShare
    const pctOfAccount = (positionValue / account) * 100

    let rrRatio = null
    if (targetOk && entryNum !== stopNum) {
      rrRatio = Math.abs(targetNum - entryNum) / riskPerShare
    }

    return {
      riskPerShare,
      shares,
      positionValue,
      actualRisk,
      pctOfAccount,
      rrRatio,
    }
  }, [entryNum, stopNum, targetNum, account, riskPct])

  // R:R bar widths
  const rrBarWidths = useMemo(() => {
    if (!computed?.rrRatio) return null
    const rr = computed.rrRatio
    const total = 1 + rr
    return {
      risk: ((1 / total) * 100).toFixed(1) + '%',
      reward: ((rr / total) * 100).toFixed(1) + '%',
    }
  }, [computed?.rrRatio])

  return (
    <div className={styles.wrapper}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        <span className={`${styles.toggleArrow} ${open ? styles.toggleArrowOpen : ''}`}>
          {'\u25B6'}
        </span>
        Position Calculator
      </button>

      {open && (
        <div className={styles.body}>
          {/* Input row */}
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>Account</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="1000"
                value={account}
                onChange={e => handleAccountChange(parseFloat(e.target.value) || 0)}
                placeholder="50000"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Entry</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                value={entry}
                onChange={e => setEntry(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Stop</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                value={stop}
                onChange={e => setStop(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Target</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>

          {/* Risk % slider */}
          <div className={styles.sliderRow}>
            <span className={styles.sliderLabel}>Risk %</span>
            <input
              className={styles.slider}
              type="range"
              min="0.5"
              max="3"
              step="0.25"
              value={riskPct}
              onChange={e => setRiskPct(parseFloat(e.target.value))}
            />
            <span className={styles.sliderVal}>{riskPct.toFixed(riskPct % 1 === 0 ? 0 : 2)}%</span>
          </div>

          {/* Computed outputs */}
          {computed && (
            <>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Shares</span>
                  <span className={styles.statVal}>{fmtShares(computed.shares)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Position</span>
                  <span className={styles.statVal}>{fmtDollars(computed.positionValue)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Risk/Share</span>
                  <span className={`${styles.statVal} ${styles.statLoss}`}>${computed.riskPerShare.toFixed(2)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Risk $</span>
                  <span className={`${styles.statVal} ${styles.statLoss}`}>{fmtDollars(computed.actualRisk)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>% of Acct</span>
                  <span className={`${styles.statVal} ${computed.pctOfAccount > 25 ? styles.statWarn : ''}`}>
                    {fmtPct(computed.pctOfAccount)}
                  </span>
                </div>
                {computed.rrRatio != null && (
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>R:R</span>
                    <span className={`${styles.statVal} ${computed.rrRatio >= 2 ? styles.statGain : computed.rrRatio >= 1 ? styles.statWarn : styles.statLoss}`}>
                      {fmtRatio(computed.rrRatio)}
                    </span>
                  </div>
                )}
              </div>

              {/* R:R visual bar */}
              {rrBarWidths && (
                <div className={styles.rrBar}>
                  <div className={styles.rrRisk} style={{ width: rrBarWidths.risk }} />
                  <div className={styles.rrReward} style={{ width: rrBarWidths.reward }} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
