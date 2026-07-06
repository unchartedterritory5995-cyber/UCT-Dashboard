import { useState } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import ErrorState from '../ErrorState'
import { SkeletonTable } from '../Skeleton'
import styles from './SectorRotation.module.css'

const fetcher = (url) => fetch(url).then((r) => r.json())
const PERIODS = ['Today', '1W', '1M', '3M']

/**
 * Where money is rotating — the 11 SPDR Select Sector ETFs ranked
 * strongest-to-weakest by period return. Reads the already-built, cached
 * /api/sector-strength service (Massive daily bars, 15-min cache).
 */
export default function SectorRotation() {
  const [period, setPeriod] = useState('Today')
  const { data, error, mutate } = useMobileSWR(
    `/api/sector-strength?period=${encodeURIComponent(period)}`,
    fetcher,
    { refreshInterval: 900_000, marketHoursOnly: true },
  )
  const sectors = data?.sectors || []
  const maxAbs = Math.max(1, ...sectors.map((s) => Math.abs(s.change_pct || 0)))

  const actions = (
    <div className={styles.periods} role="tablist" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p} type="button" role="tab" aria-selected={p === period}
          className={`${styles.per} ${p === period ? styles.perActive : ''}`}
          onClick={() => setPeriod(p)}
        >{p}</button>
      ))}
    </div>
  )

  return (
    <TileCard title="Sector Rotation" icon="flow" actions={actions}>
      {error && !sectors.length ? (
        <ErrorState onRetry={mutate} />
      ) : !data ? (
        <SkeletonTable />
      ) : !sectors.length ? (
        <div className={styles.empty}>Sector data unavailable right now.</div>
      ) : (
        <div className={styles.list}>
          {sectors.map((s, i) => {
            const pct = Number(s.change_pct) || 0
            const up = pct >= 0
            const w = Math.min(100, (Math.abs(pct) / maxAbs) * 100)
            return (
              <div key={s.ticker} className={styles.row}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.name} title={s.sector}>{s.sector}</span>
                <span className={styles.tk}>{s.ticker}</span>
                <span className={styles.barWrap} aria-hidden="true">
                  <span
                    className={`${styles.bar} ${up ? styles.up : styles.down}`}
                    style={{ width: `${w}%` }}
                  />
                </span>
                <span className={`${styles.pct} ${up ? styles.upTx : styles.downTx}`}>
                  {up ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </TileCard>
  )
}
