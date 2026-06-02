/** Style switcher for the Breadth Views tab. */
import styles from './BreadthViewSwitcher.module.css'

const OPTIONS = [
  { key: 'treemap', label: 'Treemap' },
  { key: 'rings',   label: 'Rings' },
  { key: 'tug',     label: 'Tug' },
  { key: 'meters',  label: 'Meters' },
]

export default function BreadthViewSwitcher({ viewStyle, onSelect }) {
  return (
    <div className={styles.switcher} role="group" aria-label="Visualization style">
      {OPTIONS.map(o => (
        <button key={o.key} type="button"
                className={`${styles.btn} ${viewStyle === o.key ? styles.btnActive : ''}`}
                aria-pressed={viewStyle === o.key}
                onClick={() => onSelect(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
