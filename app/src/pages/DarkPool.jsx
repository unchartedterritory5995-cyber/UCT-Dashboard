import TileCard from '../components/TileCard'
import styles from './DarkPool.module.css'

export default function DarkPool() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Dark Pool</h1>
      <TileCard title="Dark Pool">
        <div className={styles.placeholder}>
          <p className={styles.title}>Coming Soon</p>
          <p className={styles.text}>Dark pool print data will be available when a dark pool feed is integrated.</p>
        </div>
      </TileCard>
    </div>
  )
}
