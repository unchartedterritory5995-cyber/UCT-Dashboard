/** Style switcher for the Breadth Views tab. Renders whatever the registry
 *  declares, grouped by kind — it owns no list of styles or labels. */
import { viewsByKind } from './views/viewRegistry'
import styles from './BreadthViewSwitcher.module.css'

const GROUP_LABELS = { board: 'Boards', lens: 'Lenses' }

export default function BreadthViewSwitcher({ viewStyle, onSelect }) {
  const groups = viewsByKind()
  return (
    <div className={styles.switcher} role="group" aria-label="Visualization style">
      {['board', 'lens'].map(kind => (
        groups[kind].length === 0 ? null : (
          <div key={kind} className={styles.group}>
            <span className={styles.groupLabel} aria-hidden="true">{GROUP_LABELS[kind]}</span>
            {groups[kind].map(o => (
              <button key={o.key} type="button"
                      className={`${styles.btn} ${viewStyle === o.key ? styles.btnActive : ''}`}
                      aria-pressed={viewStyle === o.key}
                      onClick={() => onSelect(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        )
      ))}
    </div>
  )
}
