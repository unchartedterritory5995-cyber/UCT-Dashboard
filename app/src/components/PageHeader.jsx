import UIcon from './ui/UIcon'
import styles from './PageHeader.module.css'

/**
 * PageHeader — the ONE section header across the whole app.
 *
 * Every page's top bar is identical by construction: same height, same left
 * inset, same icon size, same title size/weight/spacing/case. Section-specific
 * controls (tabs, buttons, dropdowns) flow in `children`; anything that should
 * pin to the far right goes in `right`.
 *
 *   <PageHeader icon="calendar" title="Calendar">
 *     <ViewTabs/> <FilterPills/>
 *   </PageHeader>
 *
 * Props:
 *   icon    UIcon name (rendered gold, 18px) — optional
 *   title   the section name (string)
 *   right   node pinned to the far right of the bar — optional
 *   children  the section's inline controls
 */
export default function PageHeader({ icon, title, children, right, className = '' }) {
  return (
    <header className={`${styles.header} ${className}`}>
      <h1 className={styles.title}>
        {icon && <UIcon name={icon} size={18} className={styles.icon} />}
        <span className={styles.titleText}>{title}</span>
      </h1>
      {children != null && <div className={styles.controls}>{children}</div>}
      {right != null && <div className={styles.right}>{right}</div>}
    </header>
  )
}
