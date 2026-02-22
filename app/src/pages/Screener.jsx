import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './Screener.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function Screener() {
  const { data: rows, mutate } = useSWR('/api/screener', fetcher, { refreshInterval: 900000 })
  const [sortKey, setSortKey] = useState('rs_score')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = rows ? [...rows].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    return sortDir === 'desc' ? bv - av : av - bv
  }) : []

  function toggleSort(key) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Screener</h1>
        <button className={styles.refreshBtn} onClick={() => mutate()}>Refresh</button>
      </div>
      <TileCard title="RS / Volume / Momentum Screener">
        {rows
          ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  {['ticker','rs_score','vol_ratio','momentum','cap_tier'].map(col => (
                    <th key={col} onClick={() => toggleSort(col)} className={styles.th}>
                      {col.replaceAll('_', ' ').toUpperCase()}
                      {sortKey === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={row.ticker || i} className={styles.row}>
                    <td className={styles.sym}>{row.ticker}</td>
                    <td className={styles.num}>{row.rs_score?.toFixed(1)}</td>
                    <td className={styles.num}>{row.vol_ratio?.toFixed(2)}x</td>
                    <td className={styles.num}>{row.momentum?.toFixed(1)}</td>
                    <td className={styles.cap}>{row.cap_tier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : <p className={styles.loading}>Loading screener…</p>
        }
      </TileCard>
    </div>
  )
}
