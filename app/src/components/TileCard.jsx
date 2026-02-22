// app/src/components/TileCard.jsx
import styles from './TileCard.module.css'

export default function TileCard({ title, badge, children, className = '' }) {
  return (
    <div className={`${styles.tile} ${className}`}>
      {title && (
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          {badge && <span className={styles.badge}>{badge}</span>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
}
