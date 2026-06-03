import styles from './GroupControls.module.css'

// Shared segmented toggles for any grouped breadth surface:
//   [ List | Grouped ]   and (when grouped) [ Sector | Industry ]
export default function GroupControls({ viewMode, setViewMode, dimension, setDimension }) {
  return (
    <div className={styles.controls}>
      <div className={styles.toggle} role="group" aria-label="View mode">
        <button
          className={`${styles.btn} ${viewMode === 'list' ? styles.active : ''}`}
          onClick={() => setViewMode('list')}
        >List</button>
        <button
          className={`${styles.btn} ${viewMode === 'grouped' ? styles.active : ''}`}
          onClick={() => setViewMode('grouped')}
          title="Group stocks — most-represented group first"
        >Grouped</button>
      </div>
      {viewMode === 'grouped' && (
        <div className={styles.toggle} role="group" aria-label="Group dimension">
          <button
            className={`${styles.btn} ${dimension === 'sector' ? styles.active : ''}`}
            onClick={() => setDimension('sector')}
            title="Group by GICS sector — 11 broad buckets (macro read)"
          >Sector</button>
          <button
            className={`${styles.btn} ${dimension === 'industry' ? styles.active : ''}`}
            onClick={() => setDimension('industry')}
            title="Group by industry — granular clusters"
          >Industry</button>
        </div>
      )}
    </div>
  )
}
