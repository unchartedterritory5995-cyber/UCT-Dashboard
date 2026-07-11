/**
 * RegimeSection — the Insights → Regime section (P5 Task A7).
 *
 * "Your edge, by market regime." Renders ONE win-rate-by-regime bar set from
 * `analytics.regime.byRegime` — one row per regime (green/amber/orange/red)
 * that has trades, each with a color-coded name, a win-rate bar, and a
 * <ConfidenceStat> that grays the win rate on n<10 (the canonical confidence
 * threshold). Trades with no regime tag (broker/historical imports, or days
 * with no backfill match) are surfaced as an HONEST `unknownCount` footnote —
 * never miscounted as a real regime, never a bar.
 *
 * An inline "What are regimes?" popover explains the four labels = the market
 * exposure backdrop at entry.
 *
 * Presentational — reads its slice off `analytics.regime`, no fetching. NO
 * emoji: the glyph is a <UIcon>.
 */

import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import styles from './RegimeSection.module.css'

const CONF_MIN = 10

// Closed vocabulary + severity order (best→worst), color-coded like the app's
// exposure backdrop. green = risk-on tailwind … red = hostile / risk-off. The
// backend only ever emits these four keys in byRegime; anything else was folded
// into unknownCount, so a row always resolves to one of these.
const REGIME_META = {
  green: { label: 'Green', color: '#3cb868', blurb: 'Risk-on — broad-market tailwind at entry.' },
  amber: { label: 'Amber', color: '#e0a83a', blurb: 'Mixed — proceed with size discipline.' },
  orange: { label: 'Orange', color: '#e6822e', blurb: 'Defensive — breadth deteriorating.' },
  red: { label: 'Red', color: '#e74c3c', blurb: 'Risk-off — hostile backdrop at entry.' },
}

// Match PlaybookSection's formatters so units read consistently across Insights.
const fmtPct = (v) => `${(v * 100).toFixed(0)}%`
const fmtR = (v) => (v === 0 ? '0R' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`)
const fmtDollar = (v) => {
  if (v === 0) return '$0'
  return `${v > 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`
}

export default function RegimeSection({ analytics }) {
  const [helpOpen, setHelpOpen] = useState(false)

  const regime = analytics?.regime || {}
  const byRegime = Array.isArray(regime.byRegime) ? regime.byRegime : []
  const unknownCount = regime.unknownCount || 0

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h4 className={styles.title}>Win rate by regime</h4>
          <button
            type="button"
            className={styles.helpBtn}
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          >
            <UIcon name="compass" size={13} />
            What are regimes?
          </button>
        </div>
        <p className={styles.sub}>
          How your edge holds up across the market's exposure backdrop at entry.
          Bars on fewer than {CONF_MIN} trades are grayed — they're estimates,
          not an edge yet.
        </p>
      </div>

      {helpOpen && (
        <div className={styles.help} role="note">
          <p className={styles.helpLede}>
            A trade's <strong>regime</strong> is the market's exposure backdrop
            the day you entered — how friendly conditions were for taking risk.
          </p>
          <ul className={styles.helpList}>
            {Object.entries(REGIME_META).map(([key, m]) => (
              <li key={key} className={styles.helpRow}>
                <span className={styles.helpDot} style={{ background: m.color }} />
                <span className={styles.helpLabel}>{m.label}</span>
                <span className={styles.helpBlurb}>{m.blurb}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {byRegime.length === 0 ? (
        <div className={styles.empty}>
          <UIcon name="compass" size={24} className={styles.emptyGlyph} />
          <p className={styles.emptyText}>
            Not enough regime-tagged trades yet. As you log trades on days with a
            market-regime read, your win rate by regime fills in here.
          </p>
        </div>
      ) : (
        <div className={styles.rows}>
          {byRegime.map((b) => (
            <RegimeRow key={b.regime} b={b} />
          ))}
        </div>
      )}

      {unknownCount > 0 && (
        <p className={styles.footnote}>
          {unknownCount} trade{unknownCount === 1 ? '' : 's'} without a regime tag
          — imported or logged before regime tracking. Not counted in any bar.
        </p>
      )}
    </div>
  )
}

function RegimeRow({ b }) {
  const meta = REGIME_META[b.regime] || {
    label: b.regime,
    color: 'var(--text-muted)',
    blurb: '',
  }
  const n = b.tradeCount || 0
  const confident = n >= CONF_MIN
  const wr = typeof b.winRate === 'number' ? b.winRate : null
  // Bar length tracks win rate (0..1). A null win rate (no decided trades) →
  // empty bar; ConfidenceStat renders the honest "—" beside it.
  const pct = wr === null ? 0 : Math.max(0, Math.min(1, wr))

  return (
    <div className={styles.row}>
      <div className={styles.rowTop}>
        <div className={styles.rowLabel}>
          <span className={styles.dot} style={{ background: meta.color }} />
          <span className={styles.name}>{meta.label}</span>
        </div>

        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${confident ? '' : styles.barDim}`}
            style={{ width: `${pct * 100}%`, background: meta.color }}
          />
        </div>

        <div className={styles.rowStat}>
          <ConfidenceStat value={wr} n={n} min={CONF_MIN} format={fmtPct} label="Win Rate" />
        </div>
      </div>

      <div className={styles.rowSecondary}>
        <span className={styles.count}>
          {n} trade{n === 1 ? '' : 's'}
        </span>
        <span className={styles.secStat}>Avg R {b.avgR != null ? fmtR(b.avgR) : '—'}</span>
        <span className={styles.secStat}>
          Expectancy {b.expectancy != null ? fmtDollar(b.expectancy) : '—'}
        </span>
      </div>
    </div>
  )
}
