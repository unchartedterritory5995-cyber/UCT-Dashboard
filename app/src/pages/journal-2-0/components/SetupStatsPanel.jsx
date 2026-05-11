/**
 * Live coaching panel rendered inline with the setup picker in
 * AddPosition / AddTrade. Shows the user's historical performance on
 * the chosen setup so the entry decision is informed by their own data.
 *
 * Props:
 *   stats: setup-stats object from useJ2SetupStats (may be undefined or null)
 *   isAPlus: boolean — whether the chosen setup is in the user's A+ whitelist
 */

const fmtPct = (x) => x == null ? '—' : `${Math.round(x * 100)}%`
const fmtR = (x, dp = 2) => x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(dp)}R`
const fmtMoney = (x) => x == null ? '—' : (
  x >= 0 ? `+$${Math.abs(x).toFixed(0)}` : `-$${Math.abs(x).toFixed(0)}`
)

import styles from './AlertBanner.module.css'

const LETTER_COLOR = {
  W: 'var(--profit, #22c55e)',
  L: 'var(--loss, #ef4444)',
  B: 'var(--text-muted)',
}

export default function SetupStatsPanel({ stats, isAPlus = false }) {
  if (!stats) return null

  const { setup, tradeCount, winRate, avgR, totalR, totalPnlDollar, lastFive } = stats

  return (
    <div
      className={styles.info}
      style={{ margin: '6px 0 4px', fontSize: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}>Your record on {setup}</strong>
        {isAPlus && (
          <span
            style={{
              padding: '0 6px',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              color: 'var(--ut-gold, #c9a84c)',
              border: '1px solid var(--ut-gold, #c9a84c)',
              borderRadius: 4,
            }}
          >
            A+
          </span>
        )}
      </div>

      {tradeCount === 0 ? (
        <span style={{ color: 'var(--text-muted)' }}>
          No history yet on <strong>{setup}</strong> in this account.
        </span>
      ) : (
        <>
          <div>
            <strong>{tradeCount}</strong> trades · win rate <strong>{fmtPct(winRate)}</strong> ·
            {' '}<strong>{fmtR(avgR)} avg</strong> · <strong>{fmtR(totalR, 1)} total</strong> ·
            {' '}<span style={{ color: 'var(--text-muted)' }}>{fmtMoney(totalPnlDollar)} P&amp;L</span>
          </div>
          <div
            aria-label="Last 5 trades"
            style={{ display: 'flex', gap: 4, marginTop: 4, fontFamily: 'var(--font-mono, monospace)', letterSpacing: 1 }}
          >
            {lastFive.map((ch, i) => (
              <span key={i} style={{ color: LETTER_COLOR[ch] || 'var(--text-muted)' }}>{ch}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
