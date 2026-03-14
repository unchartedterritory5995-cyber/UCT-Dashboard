import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './Breadth.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function Breadth() {
  const { data } = useSWR('/api/breadth', fetcher, { refreshInterval: 5 * 60 * 1000 })

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Breadth</h1>
      </div>
      <TileCard title="Market Breadth">
        <p className={styles.placeholder}>Metrics coming soon.</p>
      </TileCard>
    </div>
  )
}
