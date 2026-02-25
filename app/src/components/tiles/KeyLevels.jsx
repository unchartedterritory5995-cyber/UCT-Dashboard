// app/src/components/tiles/KeyLevels.jsx
import TileCard from '../TileCard'
import styles from './KeyLevels.module.css'

export default function KeyLevels() {
  return (
    <TileCard title="Key Levels">
      <div className={styles.comingSoon}>
        <span className={styles.comingSoonText}>Coming Soon</span>
      </div>
    </TileCard>
  )
}
