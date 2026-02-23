// app/src/components/tiles/ThemeTracker.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './ThemeTracker.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())
const PERIODS = ['1W', '1M', '3M']

function ThemeRow({ name, ticker, etf_name, pct, bar, holdings, intl_count, positive }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={styles.themeBlock}>
      <div
        className={`${styles.row} ${styles.rowClickable}`}
        onClick={() => setExpanded(e => !e)}
      >
        <span className={styles.name}>{name}</span>
        <div className={styles.barWrap}>
          <div
            className={`${styles.bar} ${positive ? styles.barGain : styles.barLoss}`}
            style={{ width: `${Math.min(100, bar)}%` }}
          />
        </div>
        <span className={`${styles.pct} ${positive ? styles.pos : styles.neg}`}>{pct}</span>
        <span className={styles.caret}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className={styles.expanded}>
          <div className={styles.etfLabel}>
            <span className={styles.etfTicker}>{ticker}</span>
            <span className={styles.etfName}>{etf_name}</span>
          </div>
          <div className={styles.chips}>
            {(holdings ?? []).map(sym => (
              <TickerPopup key={`${ticker}-${sym}`} sym={sym}>
                <span className={styles.chip}>{sym}</span>
              </TickerPopup>
            ))}
            {intl_count > 0 && (
              <span className={styles.intlBadge}>+{intl_count} intl</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ThemeTracker({ data: propData }) {
  const [period, setPeriod] = useState('1W')
  const { data: fetched } = useSWR(
    propData !== undefined ? null : `/api/themes?period=${period}`,
    fetcher
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="Theme Tracker" badge={period}>
      <div className={styles.tabs}>
        {PERIODS.map(p => (
          <button
            key={p}
            className={`${styles.tab} ${period === p ? styles.tabActive : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <div className={styles.cols}>
          <div className={styles.col}>
            <div className={styles.colHd} style={{ color: 'var(--gain)' }}>
              ▲ LEADERS ({(data.leaders ?? []).length})
            </div>
            <div className={styles.scroll}>
              {(data.leaders ?? []).map(item => (
                <ThemeRow key={item.ticker} {...item} positive />
              ))}
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.colHd} style={{ color: 'var(--loss)' }}>
              ▼ LAGGARDS ({(data.laggards ?? []).length})
            </div>
            <div className={styles.scroll}>
              {(data.laggards ?? []).map(item => (
                <ThemeRow key={item.ticker} {...item} positive={false} />
              ))}
            </div>
          </div>
        </div>
      )}
    </TileCard>
  )
}
