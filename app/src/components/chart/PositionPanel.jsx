// app/src/components/chart/PositionPanel.jsx — Elite position sizing calculator overlay
import styles from './PositionPanel.module.css'

export default function PositionPanel({
  entry, stop, target,
  accountSize, riskPct,
  onChange,           // ({entry, stop, target}) => void
  onConfigChange,     // ({accountSize, riskPct}) => void
  onClear,
  onClose,
}) {
  const e = parseFloat(entry) || 0
  const s = parseFloat(stop) || 0
  const t = parseFloat(target) || 0
  const acct = parseFloat(accountSize) || 0
  const risk = parseFloat(riskPct) || 0

  // Calculations
  const riskPerShare = Math.abs(e - s)
  const rewardPerShare = Math.abs(t - e)
  const maxRisk = (acct * risk) / 100
  const shares = riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 0
  const positionValue = shares * e
  const totalRisk = shares * riskPerShare
  const totalReward = shares * rewardPerShare
  const rrRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0

  // Direction: long if target > entry > stop, short if target < entry < stop
  const isLong = t > e && e > s
  const isShort = t > 0 && e > 0 && s > 0 && t < e && e < s
  const direction = isLong ? 'long' : isShort ? 'short' : 'invalid'

  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Position Calculator</span>
        <button onClick={onClose} className={styles.close} aria-label="Close">×</button>
      </div>

      <div className={styles.priceGroup}>
        <label>
          <span className={styles.priceLabel} style={{ color: '#60a5fa' }}>Entry</span>
          <input type="number" step="0.01" value={entry || ''}
            onChange={ev => onChange({ entry: ev.target.value, stop, target })} />
        </label>
        <label>
          <span className={styles.priceLabel} style={{ color: '#f87171' }}>Stop</span>
          <input type="number" step="0.01" value={stop || ''}
            onChange={ev => onChange({ entry, stop: ev.target.value, target })} />
        </label>
        <label>
          <span className={styles.priceLabel} style={{ color: '#4ade80' }}>Target</span>
          <input type="number" step="0.01" value={target || ''}
            onChange={ev => onChange({ entry, stop, target: ev.target.value })} />
        </label>
      </div>

      <div className={styles.configGroup}>
        <label>
          <span>Account $</span>
          <input type="number" step="100" value={accountSize}
            onChange={ev => onConfigChange({ accountSize: ev.target.value, riskPct })} />
        </label>
        <label>
          <span>Risk %</span>
          <input type="number" step="0.1" min="0.1" max="100" value={riskPct}
            onChange={ev => onConfigChange({ accountSize, riskPct: ev.target.value })} />
        </label>
      </div>

      <div className={styles.calcGroup}>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>Direction</span>
          <span className={`${styles.calcValue} ${styles[direction]}`}>
            {direction.toUpperCase()}
          </span>
        </div>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>Shares</span>
          <span className={styles.calcValue}>{shares.toLocaleString()}</span>
        </div>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>Position $</span>
          <span className={styles.calcValue}>{fmtMoney(positionValue)}</span>
        </div>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>Risk $</span>
          <span className={`${styles.calcValue} ${styles.riskValue}`}>
            {fmtMoney(totalRisk)}
          </span>
        </div>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>Reward $</span>
          <span className={`${styles.calcValue} ${styles.rewardValue}`}>
            {fmtMoney(totalReward)}
          </span>
        </div>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>R:R</span>
          <span className={styles.calcValue}>
            {rrRatio > 0 ? `1:${rrRatio.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className={styles.calcRow}>
          <span className={styles.calcLabel}>Max Risk Allowed</span>
          <span className={styles.calcValue}>{fmtMoney(maxRisk)}</span>
        </div>
      </div>

      {onClear && (
        <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear Prices</button>
      )}
    </div>
  )
}
