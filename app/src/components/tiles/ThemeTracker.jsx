// app/src/components/tiles/ThemeTracker.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import { useTileCapture } from '../../hooks/useTileCapture'
import styles from './ThemeTracker.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())
const PERIODS = ['Today', '1W', '1M', '3M']
const PERIOD_KEY = { Today: '1d', '1W': '1w', '1M': '1m', '3M': '3m' }

function groupReturn(theme, key) {
  const gr = theme.group_return?.[key]
  if (gr != null) return gr
  const vals = (theme.holdings || []).map(h => h.returns?.[key]).filter(v => v != null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function buildLeadersLaggards(themes, periodKey) {
  const items = themes.map(theme => {
    const val = groupReturn(theme, periodKey)
    const pct = val == null ? '0.00%' : `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
    const bar = val == null ? 0 : Math.min(100, Math.round(Math.abs(val) * 8))
    const holdings = (theme.holdings || []).map(h => h.sym)
    return { name: theme.name, ticker: theme.ticker, etf_name: theme.etf_name || '', pct, bar, holdings, intl_count: 0, val: val ?? 0 }
  })
  items.sort((a, b) => b.val - a.val)
  return {
    leaders:  items.filter(i => i.val >= 0),
    laggards: items.filter(i => i.val < 0).reverse(),
  }
}

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
  const [period, setPeriod] = useState('Today')
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/theme-performance',
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const data = useMemo(() => {
    const raw = propData !== undefined ? propData : fetched
    if (!raw?.themes) return null
    return buildLeadersLaggards(raw.themes, PERIOD_KEY[period])
  }, [propData, fetched, period])
  const { tileRef, capturing, capture } = useTileCapture('themetracker')

  const captureBtn = (
    <button
      className={styles.captureBtn}
      onClick={capture}
      disabled={capturing}
      title="Export as PNG"
    >
      {capturing ? '…' : '📷'}
    </button>
  )

  return (
    <TileCard ref={tileRef} title="Theme Tracker" badge={period} actions={captureBtn}>
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
