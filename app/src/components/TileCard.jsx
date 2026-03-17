// app/src/components/TileCard.jsx
import { forwardRef } from 'react'
import styles from './TileCard.module.css'

const TileCard = forwardRef(function TileCard({ title, badge, actions, children, className = '' }, ref) {
  return (
    <div ref={ref} className={`${styles.tile} ${className}`}>
      {title && (
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <div className={styles.headerRight}>
            {badge && <span className={styles.badge}>{badge}</span>}
            {actions}
          </div>
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
})

export default TileCard
