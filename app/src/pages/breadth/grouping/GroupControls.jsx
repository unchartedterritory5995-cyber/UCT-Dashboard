import styles from './GroupControls.module.css'
import { DIMENSIONS } from './useBreadthGrouping'

// Rendered FROM the shared DIMENSIONS list rather than hand-written buttons, so
// the control can never offer a dimension the persisted-value allow-list rejects
// (which would read as "the setting doesn't stick").
const DIM_LABEL = { sector: 'Sector', industry: 'Industry', theme: 'Theme' }
const DIM_TITLE = {
  sector: 'Group by GICS sector — 11 broad buckets (macro read)',
  industry: 'Group by industry — granular clusters',
  theme: 'Group by UCT theme — the same primary theme shown everywhere else',
}

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
          {DIMENSIONS.map(d => (
            <button
              key={d}
              className={`${styles.btn} ${dimension === d ? styles.active : ''}`}
              onClick={() => setDimension(d)}
              title={DIM_TITLE[d]}
            >{DIM_LABEL[d]}</button>
          ))}
        </div>
      )}
    </div>
  )
}
