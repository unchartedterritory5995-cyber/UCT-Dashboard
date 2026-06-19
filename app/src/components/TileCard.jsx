// app/src/components/TileCard.jsx
import { forwardRef } from 'react'
import UIcon from './ui/UIcon'
import styles from './TileCard.module.css'

const TileCard = forwardRef(function TileCard({ title, icon, badge, actions, children, className = '' }, ref) {
  return (
    <div ref={ref} className={`${styles.tile} ${className}`} role="region" aria-label={title || undefined}>
      {title && (
        <div className={styles.header}>
          <span className={styles.title}>
            {icon && <UIcon name={icon} size={14} className={styles.titleIcon} />}
            {title}
          </span>
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
