/** Style switcher for the Breadth Views tab. Renders whatever the registry
 *  declares, grouped by kind — it owns no list of styles or labels. */
import { viewsByKind } from './views/viewRegistry'
import styles from './BreadthViewSwitcher.module.css'

const GROUP_LABELS = { board: 'Boards', lens: 'Lenses' }

/**
 * ⛔ THE GROUP NAME IS ON THE GROUP, NOT ONLY ON THE VISIBLE LABEL.
 *
 * Board-vs-lens is the whole organising idea of this switcher, and it used to
 * exist for sighted desktop users alone: the `<span>` carried `aria-hidden`
 * (right — it is decorative text beside the buttons it describes) and the phone
 * stylesheet hides it outright (`.groupLabel { display: none }` under 640px),
 * so between them assistive tech was told the distinction TWICE that it was not
 * there. A screen-reader user heard sixteen sibling buttons in one flat list.
 *
 * `role="group"` + `aria-label` puts the name on the container instead, so it
 * survives both the `aria-hidden` span and the phone breakpoint that removes
 * the span from the layout entirely.
 */
export default function BreadthViewSwitcher({ viewStyle, onSelect }) {
  const groups = viewsByKind()
  return (
    <div className={styles.switcher} role="group" aria-label="Visualization style">
      {['board', 'lens'].map(kind => (
        groups[kind].length === 0 ? null : (
          <div key={kind} className={styles.group}
               role="group" aria-label={GROUP_LABELS[kind]}>
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
