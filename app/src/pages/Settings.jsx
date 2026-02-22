// app/src/pages/Settings.jsx
import TileCard from '../components/TileCard'
import styles from './Screener.module.css'

export default function Settings() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Settings</h1>
      </div>
      <TileCard title="Configuration">
        <p className={styles.loading}>Settings coming soon.</p>
      </TileCard>
    </div>
  )
}
