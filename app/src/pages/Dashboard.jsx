import MoversSidebar from '../components/MoversSidebar'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <p style={{padding:'20px',color:'var(--text-muted)'}}>Dashboard tiles — coming soon</p>
      </div>
      <MoversSidebar />
    </div>
  )
}
