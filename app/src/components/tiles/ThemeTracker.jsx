// app/src/components/tiles/ThemeTracker.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './ThemeTracker.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())
const PERIODS = ['1W', '1M', '3M']

function ThemeRow({ name, pct, bar, positive }) {
  return (
    <div className={styles.row}>
      <span className={styles.name}>{name}</span>
      <div className={styles.barWrap}>
        <div
          className={`${styles.bar} ${positive ? styles.barGain : styles.barLoss}`}
          style={{ width: `${Math.min(100, bar)}%` }}
        />
      </div>
      <span className={`${styles.pct} ${positive ? styles.pos : styles.neg}`}>{pct}</span>
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
            <div className={styles.colHd} style={{ color: 'var(--gain)' }}>▲ LEADERS</div>
            {(data.leaders ?? []).map(item => (
              <ThemeRow key={item.name} {...item} positive />
            ))}
          </div>
          <div className={styles.col}>
            <div className={styles.colHd} style={{ color: 'var(--loss)' }}>▼ LAGGARDS</div>
            {(data.laggards ?? []).map(item => (
              <ThemeRow key={item.name} {...item} positive={false} />
            ))}
          </div>
        </div>
      )}
    </TileCard>
  )
}
