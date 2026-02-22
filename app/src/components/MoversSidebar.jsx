// app/src/components/MoversSidebar.jsx
import useSWR from 'swr'
import styles from './MoversSidebar.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function MoverSection({ label, items, positive }) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionLabel} ${positive ? styles.green : styles.red}`}>
        {positive ? '▲' : '▼'} {label}
      </div>
      {items.map(item => (
        <div key={item.sym} className={styles.row}>
          <span className={styles.sym}>{item.sym}</span>
          <span className={`${styles.pct} ${positive ? styles.green : styles.red}`}>
            {item.pct}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function MoversSidebar({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/movers',
    fetcher,
    { refreshInterval: 30000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <aside className={styles.sidebar}>
      <div className={styles.title}>MOVERS AT THE OPEN</div>
      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <>
          <MoverSection label="RIPPING" items={data.ripping ?? []} positive />
          <MoverSection label="DRILLING" items={data.drilling ?? []} positive={false} />
        </>
      )}
    </aside>
  )
}
