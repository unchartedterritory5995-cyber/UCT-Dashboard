import TileCard from '../components/TileCard'
import styles from './OptionsFlow.module.css'

export default function OptionsFlow() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Options Flow</h1>
      <TileCard title="Options Flow">
        <div className={styles.placeholder}>
          <p className={styles.title}>Coming Soon</p>
          <p className={styles.text}>Options flow data will be available when an options feed is integrated.</p>
        </div>
      </TileCard>
      <TileCard title="Dark Pool" className={styles.darkPool}>
        <div className={styles.placeholder}>
          <p className={styles.title}>Coming Soon</p>
          <p className={styles.text}>Dark pool print data will be available when a dark pool feed is integrated.</p>
        </div>
      </TileCard>
    </div>
  )
}
