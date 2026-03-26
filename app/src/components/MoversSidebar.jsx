// app/src/components/MoversSidebar.jsx
import { useState } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import TickerPopup from './TickerPopup'
import ErrorState from './ErrorState'
import { SkeletonTable } from './Skeleton'
import styles from './MoversSidebar.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function MoverSection({ label, items, positive }) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionLabel} ${positive ? styles.green : styles.red}`}>
        {positive ? '▲' : '▼'} {label}
      </div>
      <div className={styles.rows}>
        {items.map(item => (
          <div key={item.sym} className={styles.row}>
            <TickerPopup sym={item.sym}>
              <span className={styles.sym}>{item.sym}</span>
            </TickerPopup>
            <span className={`${styles.pct} ${positive ? styles.green : styles.red}`}>
              {item.pct}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MoversSidebar({ data: propData }) {
  const [open, setOpen] = useState(true)

  const { data: fetched, error, mutate } = useMobileSWR(
    propData !== undefined ? null : '/api/movers',
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <div className={styles.tile}>
      <button className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={styles.title}>Movers at the Open</span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {error ? (
            <ErrorState compact message="Failed to load movers" onRetry={() => mutate()} />
          ) : !data ? (
            <SkeletonTable rows={6} cols={2} />
          ) : (
            <div className={styles.scroll}>
              <div className={styles.moversGrid}>
                <MoverSection label="RIPPING" items={data.ripping ?? []} positive />
                <MoverSection label="DRILLING" items={data.drilling ?? []} positive={false} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
