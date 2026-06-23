import UIcon from '../../../components/ui/UIcon'
import styles from './BrokerImportingBanner.module.css'

export default function BrokerImportingBanner({ broker }) {
  const name = broker || 'your brokerage'
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.spin}><UIcon name="refresh" size={18} /></span>
      <div className={styles.copy}>
        <strong>Importing your full {name} history</strong>
        <span className={styles.sub}>
          Your trades and equity curve fill in over the next few minutes — no need to refresh.
        </span>
      </div>
    </div>
  )
}
